"""
historical_analysis.py

Date-range historical evaluation for the Attention Factor + LongConv model.

This module combines the useful parts of the previous data_loader.py and
test_oos.py, but removes training/rolling-window responsibilities.

Pipeline:
    requested dates
      -> include s previous trading sessions for LongConv warm-up
      -> load normalized characteristics panel and prices
      -> build aligned X (T,N,M) and R (T,N)
      -> load the trained Hugging Face checkpoint
      -> run forward_sequence once over warm-up + requested period
      -> retain only requested-period returns
      -> calculate performance metrics

IMPORTANT:
- The characteristics panel must use exactly the same feature definitions,
  ordering, normalization and point-in-time rules used during model training.
- The asset universe/order must match the checkpoint.
- `download_panel()` currently downloads the complete Parquet object. This
  module filters it in memory; it does not perform remote Parquet row filtering.
- `s` means previous MODEL OBSERVATIONS / trading sessions, not calendar days.
"""

from __future__ import annotations

import logging
import math
import os
import sys
from dataclasses import asdict, is_dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Optional, Sequence, Tuple, List, Any

import yfinance as yf
import numpy as np
import pandas as pd
import torch
from sqlalchemy import func, select

# Resilient paths regardless of execution directory
current_file_dir = Path(__file__).resolve().parent
backend_root = current_file_dir.parent.parent
for extra_p in [
    str(current_file_dir),
    str(backend_root),
    str(backend_root / "data"),
    str(backend_root / "db"),
]:
    if extra_p not in sys.path:
        sys.path.append(extra_p)

# These are the same model-loading interfaces used by the existing tester.
try:
    from train import ModelConfig
    from predict_new import _load_model
except ImportError:
    from ML.models.train import ModelConfig
    from ML.models.predict_new import _load_model

from db.database import SessionLocal
from db.models import PriceHistory
from data.feature_comp_migration import download_panel, get_supabase_client


logger = logging.getLogger(__name__)

_PANEL_CACHE: Optional[pd.DataFrame] = None


class DateRangeDataLoader:
    """
    Load only the requested date interval plus the s preceding trading
    observations required to warm up LongConv.

    Parameters
    ----------
    start_date, end_date:
        Inclusive user-requested evaluation dates.
    lookback:
        ModelConfig.s. Number of previous trading observations needed.
    symbols:
        Optional fixed ordered universe. Supply the exact training universe
        and order whenever it is available. If omitted, symbols are inferred
        from the characteristics panel for this interval.
    feature_names:
        Optional fixed ordered feature list. Supply the training feature
        order whenever it is available.
    """

    def __init__(
        self,
        start_date: date | str,
        end_date: date | str,
        lookback: int,
        symbols: Optional[Sequence[str]] = None,
        feature_names: Optional[Sequence[str]] = None,
        device: str | torch.device = "cpu",
    ):
        self.start_date = pd.Timestamp(start_date).normalize()
        self.end_date = pd.Timestamp(end_date).normalize()
        self.lookback = int(lookback)
        self.requested_symbols = list(symbols) if symbols is not None else None
        self.requested_features = (
            list(feature_names) if feature_names is not None else None
        )
        self.device = torch.device(device)

        if self.start_date > self.end_date:
            raise ValueError("start_date must be on or before end_date.")
        if self.lookback < 1:
            raise ValueError("lookback must be at least 1.")

    @staticmethod
    def _normalise_panel_index(panel: pd.DataFrame) -> pd.DataFrame:
        if not isinstance(panel.index, pd.MultiIndex):
            raise TypeError("Characteristics panel must have a MultiIndex.")

        names = list(panel.index.names)
        if "symbol" not in names or "day" not in names:
            raise ValueError(
                "Expected panel MultiIndex levels named 'symbol' and 'day'; "
                f"received {names}."
            )

        return panel.swaplevel("symbol", "day").sort_index()

    def _load_panel(self) -> pd.DataFrame:
        global _PANEL_CACHE
        if "_PANEL_CACHE" in globals() and _PANEL_CACHE is not None:
            return _PANEL_CACHE

        sb = get_supabase_client()
        panel = download_panel(sb)

        if panel is None or panel.empty:
            raise RuntimeError(
                "No characteristics Parquet panel found in Supabase Storage."
            )

        _PANEL_CACHE = self._normalise_panel_index(panel)
        return _PANEL_CACHE

    def _select_universe_and_features(
        self, panel: pd.DataFrame
    ) -> tuple[list[str], list[str]]:
        symbols_in_panel = set(
            panel.index.get_level_values("symbol").unique().tolist()
        )
        features_in_panel = list(panel.columns)

        symbols = (
            self.requested_symbols
            if self.requested_symbols is not None
            else sorted(symbols_in_panel)
        )
        features = (
            self.requested_features
            if self.requested_features is not None
            else features_in_panel
        )

        missing_symbols = sorted(set(symbols) - symbols_in_panel)
        missing_features = sorted(set(features) - set(features_in_panel))

        if missing_symbols:
            raise ValueError(
                "Requested model-universe symbols are missing from the panel: "
                + ", ".join(missing_symbols[:20])
            )
        if missing_features:
            raise ValueError(
                "Checkpoint features are missing from the panel: "
                + ", ".join(missing_features[:20])
            )
        if not symbols or not features:
            raise RuntimeError("No symbols or features found for this date range.")

        return list(symbols), list(features)

    def _load_price_history(
        self,
        symbols: list[str],
        first_tensor_date: pd.Timestamp,
        last_tensor_date: pd.Timestamp,
    ) -> pd.DataFrame:
        """
        Fetch one price observation before first_tensor_date as well as all
        prices through last_tensor_date. The extra close is required so the
        first R row is a real pct_change rather than an artificial zero.
        """
        db = SessionLocal()
        try:
            previous_day = db.execute(
                select(func.max(PriceHistory.day))
                .where(PriceHistory.symbol.in_(symbols))
                .where(PriceHistory.day < first_tensor_date.date())
            ).scalar_one_or_none()

            if previous_day is None:
                raise RuntimeError(
                    "No prior closing-price observation exists before "
                    f"{first_tensor_date.date()}; cannot calculate the first "
                    "daily return correctly."
                )

            rows = db.execute(
                select(
                    PriceHistory.day,
                    PriceHistory.symbol,
                    PriceHistory.close,
                )
                .where(PriceHistory.symbol.in_(symbols))
                .where(PriceHistory.day >= previous_day)
                .where(PriceHistory.day <= last_tensor_date.date())
                .order_by(PriceHistory.day, PriceHistory.symbol)
            ).all()
        finally:
            db.close()

        if not rows:
            raise RuntimeError("No matching price_history rows were found.")

        long_df = pd.DataFrame(rows, columns=["day", "symbol", "close"])
        long_df["day"] = pd.to_datetime(long_df["day"]).dt.normalize()
        long_df["close"] = pd.to_numeric(long_df["close"], errors="coerce")

        if long_df.duplicated(["day", "symbol"]).any():
            raise ValueError(
                "Duplicate (day, symbol) price rows found; resolve duplicates "
                "before building returns."
            )

        prices = (
            long_df.pivot(index="day", columns="symbol", values="close")
            .sort_index()
            .reindex(columns=symbols)
        )

        # A missing close should not silently become a zero return.
        requested_prices = prices.loc[
            (prices.index >= first_tensor_date)
            & (prices.index <= last_tensor_date)
        ]
        missing_cols = requested_prices.columns[
            requested_prices.isna().all()
        ].tolist()
        if missing_cols:
            raise ValueError(
                "No price observations in the selected interval for: "
                + ", ".join(missing_cols[:20])
            )

        returns = prices.pct_change(fill_method=None)
        return returns, prices

    @staticmethod
    def _clean_tensors(
        X: torch.Tensor, R: torch.Tensor
    ) -> tuple[torch.Tensor, torch.Tensor]:
        """
        Keep the same missing-value conventions as the existing loader:
        missing normalized characteristics -> 0.5 (median rank);
        missing returns -> 0.0.

        Infinities are replaced explicitly rather than left in the model input.
        """
        if torch.isinf(X).any():
            X = torch.nan_to_num(X, nan=0.5, posinf=10.0, neginf=-10.0)
        else:
            X = torch.nan_to_num(X, nan=0.5)

        if torch.isinf(R).any():
            R = torch.nan_to_num(R, nan=0.0, posinf=0.5, neginf=-0.5)
        else:
            R = torch.nan_to_num(R, nan=0.0)

        return X, R

    def build_X(
        self,
        panel: pd.DataFrame,
        dates: pd.DatetimeIndex,
        symbols: list[str],
        feature_names: list[str],
    ) -> torch.Tensor:
        """Build X with shape (T,N,M), explicitly aligned to symbol/feature order."""
        wide = panel.unstack(level="symbol")
        wide.columns = wide.columns.swaplevel(0, 1)
        wide = wide.sort_index(axis=1)

        expected_cols = pd.MultiIndex.from_product(
            [symbols, feature_names], names=["symbol", None]
        )
        wide = wide.reindex(index=dates, columns=expected_cols)

        arr = wide.to_numpy(dtype=np.float32, copy=True)
        expected_shape = (len(dates), len(symbols) * len(feature_names))
        if arr.shape != expected_shape:
            raise RuntimeError(
                f"Unexpected X matrix shape {arr.shape}; expected {expected_shape}."
            )

        return torch.from_numpy(
            arr.reshape(len(dates), len(symbols), len(feature_names))
        )

    @staticmethod
    def build_R(
        returns_df: pd.DataFrame,
        dates: pd.DatetimeIndex,
        symbols: list[str],
    ) -> torch.Tensor:
        """Build R with shape (T,N), in exactly the same date/symbol order as X."""
        aligned = returns_df.reindex(index=dates, columns=symbols)
        return torch.tensor(
            aligned.to_numpy(dtype=np.float32, copy=True),
            dtype=torch.float32,
        )

    def load(self) -> dict:
        logger.info(
            "Loading historical model inputs: %s --> %s (lookback=%d sessions)",
            self.start_date.date(),
            self.end_date.date(),
            self.lookback,
        )

        panel = self._load_panel()
        symbols, feature_names = self._select_universe_and_features(panel)

        all_panel_dates = pd.DatetimeIndex(
            panel.index.get_level_values("day").unique()
        ).sort_values().normalize()

        # The evaluation period consists of actual trading dates represented
        # in the characteristics panel.
        evaluation_dates = all_panel_dates[
            (all_panel_dates >= self.start_date)
            & (all_panel_dates <= self.end_date)
        ]
        if len(evaluation_dates) == 0:
            raise RuntimeError(
                "No characteristics/trading dates found inside the requested "
                f"range {self.start_date.date()} to {self.end_date.date()}."
            )

        prior_dates = all_panel_dates[all_panel_dates < evaluation_dates[0]]
        if len(prior_dates) < self.lookback:
            raise RuntimeError(
                f"Need {self.lookback} prior trading sessions for LongConv, "
                f"but only {len(prior_dates)} are available before "
                f"{evaluation_dates[0].date()}."
            )

        warmup_dates = prior_dates[-self.lookback:]
        tensor_dates = all_panel_dates[
            (all_panel_dates >= warmup_dates[0])
            & (all_panel_dates <= evaluation_dates[-1])
        ]

        # Restrict panel rows before tensor construction.
        day_values = panel.index.get_level_values("day")
        selected = panel[
            day_values.isin(tensor_dates)
            & panel.index.get_level_values("symbol").isin(symbols)
        ]
        selected = selected.reindex(
            pd.MultiIndex.from_product(
                [tensor_dates, symbols], names=["day", "symbol"]
            )
        )

        # Preserve feature order exactly.
        selected = selected.reindex(columns=feature_names)

        # Include a previous close so R[tensor_dates[0]] is correctly computed.
        returns_df, prices_df = self._load_price_history(
            symbols=symbols,
            first_tensor_date=tensor_dates[0],
            last_tensor_date=tensor_dates[-1],
        )

        X = self.build_X(selected, tensor_dates, symbols, feature_names)
        R = self.build_R(returns_df, tensor_dates, symbols)
        X, R = self._clean_tensors(X, R)

        if not torch.isfinite(X).all() or not torch.isfinite(R).all():
            raise ValueError("Non-finite values remain in X or R after cleaning.")

        logger.info(
            "Built tensors: X=%s, R=%s; tensor dates %s --> %s; "
            "evaluation dates %s --> %s",
            tuple(X.shape),
            tuple(R.shape),
            tensor_dates[0].date(),
            tensor_dates[-1].date(),
            evaluation_dates[0].date(),
            evaluation_dates[-1].date(),
        )

        return {
            "X": X.to(self.device),
            "R": R.to(self.device),
            "dates": list(tensor_dates),
            "evaluation_dates": list(evaluation_dates),
            "symbols": symbols,
            "feature_names": feature_names,
            "warmup_start": tensor_dates[0],
            "requested_start": self.start_date,
            "requested_end": self.end_date,
            "prices": prices_df,
        }


def simulate_integer_portfolio(
    dates: Sequence[Any],
    symbols: Sequence[str],
    weights: np.ndarray | Sequence[Sequence[float]],
    prices: pd.DataFrame | np.ndarray,
    returns: Optional[pd.DataFrame | np.ndarray] = None,
    initial_capital: float = 1_000_000.0,
    trading_days: int = 252,
    risk_free_daily: float = 0.0002,
) -> dict:
    """
    Simulate a portfolio in the Indian market using integer-share allocation (via floor),
    and quantify the decimal error loss against the theoretical continuous portfolio.

    In the Indian stock market (NSE/BSE), fractional shares are not permitted.
    All stock allocations must be whole integer units:
        shares_int = floor(equity * weight / price)  [if weight > 0]
        shares_int = -floor(equity * |weight| / price) [if weight < 0]

    The difference:
        diff_shares = shares_ideal - shares_int
    induces unallocated idle cash and tracking discrepancy (error loss).
    """
    initial_capital = float(initial_capital)
    if initial_capital <= 0:
        raise ValueError("initial_capital must be positive.")

    n_days = len(dates)
    n_symbols = len(symbols)
    if n_days == 0:
        return {
            "initial_capital": initial_capital,
            "metrics_ideal": {},
            "metrics_floored": {},
            "total_error_loss_amount": 0.0,
            "total_error_loss_pct": 0.0,
            "mean_daily_unallocated_cash": 0.0,
            "mean_daily_unallocated_cash_pct": 0.0,
            "daily": [],
        }

    # Ensure weights is 2D numpy array (T, N)
    weights_arr = np.asarray(weights, dtype=float)
    if weights_arr.ndim == 1:
        weights_arr = weights_arr.reshape(n_days, -1)

    # Ensure prices is 2D numpy array (T, N)
    if isinstance(prices, pd.DataFrame):
        prices_df = prices.reindex(index=dates, columns=symbols)
        prices_arr = prices_df.to_numpy(dtype=float)
    else:
        prices_arr = np.asarray(prices, dtype=float)

    # Ensure returns is 2D numpy array (T, N)
    if returns is not None:
        if isinstance(returns, pd.DataFrame):
            returns_df = returns.reindex(index=dates, columns=symbols)
            returns_arr = returns_df.to_numpy(dtype=float)
        else:
            returns_arr = np.asarray(returns, dtype=float)
    else:
        returns_arr = np.zeros_like(prices_arr)
        for t in range(1, n_days):
            prev_p = prices_arr[t - 1]
            curr_p = prices_arr[t]
            valid = (prev_p > 0) & np.isfinite(prev_p) & np.isfinite(curr_p)
            returns_arr[t, valid] = (curr_p[valid] - prev_p[valid]) / prev_p[valid]

    # Clean NaNs and Infinities
    weights_arr = np.nan_to_num(weights_arr, nan=0.0)
    prices_arr = np.nan_to_num(prices_arr, nan=0.0)
    returns_arr = np.nan_to_num(returns_arr, nan=0.0)

    equity_ideal = initial_capital
    equity_floored = initial_capital

    daily_points = []
    rets_ideal = []
    rets_floored = []
    unallocated_cash_list = []
    daily_error_loss_amounts = []

    for t in range(n_days):
        d_val = dates[t]
        date_str = str(pd.Timestamp(d_val).date()) if not isinstance(d_val, str) else d_val
        w_t = weights_arr[t]
        p_t = prices_arr[t]
        r_t = returns_arr[t]

        day_ideal_pnl = 0.0
        day_floored_pnl = 0.0
        day_unallocated_cash = 0.0
        stock_details = []

        for i in range(n_symbols):
            sym = symbols[i]
            w_i = float(w_t[i])
            p_i = float(p_t[i])
            r_i = float(r_t[i])

            if p_i <= 0 or not np.isfinite(p_i):
                continue

            # Theoretical continuous/decimal shares
            shares_ideal = (equity_ideal * w_i) / p_i

            # Integer shares floored for India market
            if w_i > 0:
                shares_floored = int(math.floor((equity_floored * w_i) / p_i))
            elif w_i < 0:
                shares_floored = -int(math.floor((equity_floored * abs(w_i)) / p_i))
            else:
                shares_floored = 0

            # Discrepancy due to decimal rounding
            diff_shares = shares_ideal - shares_floored
            unallocated_cash_i = abs(diff_shares) * p_i

            # Daily PnL
            pnl_ideal_i = shares_ideal * p_i * r_i
            pnl_floored_i = shares_floored * p_i * r_i
            error_loss_pnl_i = pnl_ideal_i - pnl_floored_i

            day_ideal_pnl += pnl_ideal_i
            day_floored_pnl += pnl_floored_i
            day_unallocated_cash += unallocated_cash_i

            if abs(w_i) > 1e-5 or shares_floored != 0:
                stock_details.append({
                    "symbol": sym,
                    "weight": round(w_i, 6),
                    "price": round(p_i, 2),
                    "shares_ideal": round(shares_ideal, 4),
                    "shares_floored": int(shares_floored),
                    "diff_shares": round(diff_shares, 4),
                    "unallocated_cash": round(unallocated_cash_i, 2),
                    "pnl_ideal": round(pnl_ideal_i, 2),
                    "pnl_floored": round(pnl_floored_i, 2),
                    "error_loss_pnl": round(error_loss_pnl_i, 2),
                })

        ret_ideal = (day_ideal_pnl / equity_ideal) if equity_ideal > 0 else 0.0
        ret_floored = (day_floored_pnl / equity_floored) if equity_floored > 0 else 0.0
        error_loss_amount = day_ideal_pnl - day_floored_pnl
        error_loss_return = ret_ideal - ret_floored

        equity_ideal += day_ideal_pnl
        equity_floored += day_floored_pnl
        cumulative_error_loss = equity_ideal - equity_floored

        rets_ideal.append(ret_ideal)
        rets_floored.append(ret_floored)
        unallocated_cash_list.append(day_unallocated_cash)
        daily_error_loss_amounts.append(error_loss_amount)

        daily_points.append({
            "date": date_str,
            "equity_ideal": round(equity_ideal, 2),
            "equity_floored": round(equity_floored, 2),
            "return_ideal": round(ret_ideal, 6),
            "return_floored": round(ret_floored, 6),
            "error_loss_pnl": round(error_loss_amount, 2),
            "error_loss_return": round(error_loss_return, 6),
            "cumulative_error_loss": round(cumulative_error_loss, 2),
            "unallocated_cash": round(day_unallocated_cash, 2),
            "unallocated_cash_pct": round((day_unallocated_cash / max(equity_floored, 1.0)) * 100.0, 4),
            "stocks": stock_details,
        })

    rets_ideal_np = np.array(rets_ideal)
    rets_floored_np = np.array(rets_floored)

    def calc_metrics(r_arr: np.ndarray, final_equity: float) -> dict:
        tot_ret = ((final_equity / initial_capital) - 1.0) * 100.0
        wealth = float(np.prod(1.0 + r_arr))
        ann_ret = (wealth ** (trading_days / max(len(r_arr), 1)) - 1.0) * 100.0 if wealth > 0 else float("nan")
        daily_std = float(np.std(r_arr, ddof=1)) if len(r_arr) > 1 else 0.0
        ann_vol = daily_std * np.sqrt(trading_days) * 100.0
        excess = r_arr - risk_free_daily
        ann_sharpe = float(np.sqrt(trading_days) * np.mean(excess) / daily_std) if daily_std > 1e-12 else 0.0
        return {
            "initial_capital": round(initial_capital, 2),
            "final_equity": round(final_equity, 2),
            "total_return_pct": round(tot_ret, 2),
            "annualized_return_pct": round(ann_ret, 2) if np.isfinite(ann_ret) else 0.0,
            "annualized_volatility_pct": round(ann_vol, 2),
            "annualized_sharpe": round(ann_sharpe, 2),
        }

    metrics_ideal = calc_metrics(rets_ideal_np, equity_ideal)
    metrics_floored = calc_metrics(rets_floored_np, equity_floored)

    total_error_loss_amount = equity_ideal - equity_floored
    total_error_loss_pct = (total_error_loss_amount / initial_capital) * 100.0
    mean_unallocated_cash = float(np.mean(unallocated_cash_list)) if unallocated_cash_list else 0.0
    mean_unallocated_cash_pct = (mean_unallocated_cash / initial_capital) * 100.0

    return {
        "initial_capital": round(initial_capital, 2),
        "metrics_ideal": metrics_ideal,
        "metrics_floored": metrics_floored,
        "total_error_loss_amount": round(total_error_loss_amount, 2),
        "total_error_loss_pct": round(total_error_loss_pct, 2),
        "mean_daily_unallocated_cash": round(mean_unallocated_cash, 2),
        "mean_daily_unallocated_cash_pct": round(mean_unallocated_cash_pct, 4),
        "daily": daily_points,
    }


class HistoricalAnalysis:
    """
    Load a trained model checkpoint, run the requested historical period,
    and return portfolio metrics plus daily series.

    `config` must be the same ModelConfig used for the trained checkpoint,
    including K, d, s, mode, device and any architecture-affecting settings.
    """

    def __init__(
        self,
        config: ModelConfig,
        repo_id: Optional[str] = None,
        checkpoint_filename: Optional[str] = None,
        risk_free_daily: float = 0.0002,
        trading_days: int = 252,
    ):
        self.config = config
        self.device = torch.device(config.device)
        self.repo_id = (repo_id or os.getenv("HF_REPO_ID") or "").strip()
        self.checkpoint_filename = checkpoint_filename or (
            f"K{config.K}_checkpoint_{config.s}.pt"
        )
        self.risk_free_daily = float(risk_free_daily)
        self.trading_days = int(trading_days)

        if not self.repo_id:
            raise ValueError(
                "HF_REPO_ID is not configured. Pass repo_id or set the "
                "HF_REPO_ID environment variable."
            )

    def load_model(self, n_assets: int, n_features: int):
        model = _load_model(
            repo_id=self.repo_id,
            checkpoint_filename=self.checkpoint_filename,
            n_assets=n_assets,
            n_features=n_features,
            device=self.device,
            feature_names=None,
            config=self.config,
            strict=True,
        ).to(self.device)

        model.eval()
        if hasattr(model, "reset_omega_prev"):
            model.reset_omega_prev()
        if hasattr(model, "omega_prev"):
            model.omega_prev = model.omega_prev.to(self.device)

        return model

    def compute_metrics(
        self,
        returns_gross: np.ndarray,
        returns_net: np.ndarray,
        costs: np.ndarray,
        market_returns: Optional[np.ndarray] = None,
    ) -> dict:
        if len(returns_gross) == 0:
            raise ValueError("No evaluation returns remain after warm-up/date filtering.")
        if len(returns_net) != len(returns_gross):
            raise ValueError("Gross and net return arrays have different lengths.")

        def annualized_return(r: np.ndarray) -> float:
            wealth = float(np.prod(1.0 + r))
            if wealth <= 0:
                return float("nan")
            return float((wealth ** (self.trading_days / len(r)) - 1.0) * 100.0)

        def annualized_volatility(r: np.ndarray) -> float:
            daily_std = float(np.std(r, ddof=1)) if len(r) > 1 else 0.0
            return daily_std * np.sqrt(self.trading_days) * 100.0

        def annualized_sharpe(r: np.ndarray) -> float:
            excess = r - self.risk_free_daily
            daily_std = float(np.std(excess, ddof=1)) if len(r) > 1 else 0.0
            if daily_std < 1e-12:
                return 0.0
            return float(
                np.sqrt(self.trading_days) * np.mean(excess) / daily_std
            )

        beta = None
        beta_observations = 0

        if market_returns is not None:

            market_returns = np.asarray(market_returns, dtype=float)

            if len(market_returns) != len(returns_gross):
                raise ValueError(
                    "market_returns must be aligned to evaluation return dates."
                )

            # Pairwise valid observations
            valid = (
                np.isfinite(returns_gross)
                & np.isfinite(market_returns)
            )

            portfolio_valid = returns_gross[valid]
            market_valid = market_returns[valid]

            beta_observations = len(market_valid)

            if beta_observations >= 2:

                market_var = np.var(market_valid, ddof=1)

                if market_var > 1e-12:

                    beta = float(
                        np.cov(
                            portfolio_valid,
                            market_valid,
                            ddof=1
                        )[0, 1] / market_var
                    )

        return {
            "trading_days": int(len(returns_gross)),
            "annualized_return_pct": annualized_return(returns_gross),
            "annualized_volatility_pct": annualized_volatility(returns_gross),
            "annualized_sharpe": annualized_sharpe(returns_gross),
            "annualized_net_return_pct": annualized_return(returns_net),
            "annualized_net_volatility_pct": annualized_volatility(returns_net),
            "annualized_net_sharpe": annualized_sharpe(returns_net),
            "mean_daily_cost": float(np.mean(costs)) if len(costs) else 0.0,
            "beta": beta,
            "beta_observations": beta_observations,
        }

    def run(
        self,
        start_date: date | str,
        end_date: date | str,
        symbols: Optional[Sequence[str]] = None,
        feature_names: Optional[Sequence[str]] = None,
        initial_capital: float = 1_000_000.0,
    ) -> dict:
        loader = DateRangeDataLoader(
            start_date=start_date,
            end_date=end_date,
            lookback=self.config.s,
            symbols=symbols,
            feature_names=feature_names,
            device=self.device,
        )
        data = loader.load()

        X = data["X"]
        R = data["R"]
        dates = pd.DatetimeIndex(data["dates"])
        evaluation_dates = pd.DatetimeIndex(data["evaluation_dates"])

        model = self.load_model(
            n_assets=len(data["symbols"]),
            n_features=len(data["feature_names"]),
        )

        with torch.inference_mode():
            output = model.forward_sequence(
                X,
                R,
                None,
                self.config.mode,
            )

        gross_all = output["returns_gross"].detach().cpu().numpy().reshape(-1)
        net_all = output["returns_net"].detach().cpu().numpy().reshape(-1)
        costs_all = output["costs"].detach().cpu().numpy().reshape(-1)

        # The existing forward_sequence starts emitting portfolio returns
        # after its s-observation warm-up. Map outputs to dates[s:].
        output_dates = dates[self.config.s:]
        if len(output_dates) != len(gross_all):
            raise RuntimeError(
                "Cannot align model outputs to dates: forward_sequence returned "
                f"{len(gross_all)} returns, while dates[s:] contains "
                f"{len(output_dates)} dates. Check forward_sequence warm-up logic."
            )

        start_ts = pd.Timestamp(start_date).normalize()
        end_ts = pd.Timestamp(end_date).normalize()

        requested_mask = (
            (output_dates >= start_ts)
            & (output_dates <= end_ts)
        )
        selected_dates = output_dates[requested_mask]

        gross = gross_all[requested_mask]
        net = net_all[requested_mask]
        costs = costs_all[requested_mask]

        market_returns = self.fetch_market_index(dates[0], dates[-1])
        mkt_ret = market_returns["close"].pct_change(fill_method=None)
        mkt_ret = mkt_ret.dropna()

        aligned_market = None

        if market_returns is not None:

            # Support both DataFrame (Yahoo Finance output)
            # and Series (already calculated market returns).

            if isinstance(market_returns, pd.DataFrame):
                market = market_returns["close"].pct_change(fill_method=None)
            else:
                market = market_returns.copy()

            # Standardize market return index
            market.index = pd.to_datetime(market.index)

            if market.index.tz is not None:
                market.index = market.index.tz_localize(None)

            market.index = market.index.normalize()

            # Align market returns with portfolio evaluation dates
            market = market[~market.index.duplicated(keep="last")]

            aligned_market = market.reindex(selected_dates).to_numpy(dtype=float)

            # Do not raise an error for missing market observations.
            missing_count = np.isnan(aligned_market).sum()

            if missing_count > 0:
                logger.warning(
                    f"Missing {missing_count} benchmark returns. "
                    "These dates will be excluded only from beta calculation."
                )


        metrics = self.compute_metrics(
            returns_gross=gross,
            returns_net=net,
            costs=costs,
            market_returns=aligned_market,
        )

        result = {
            "requested_start": str(pd.Timestamp(start_date).date()),
            "requested_end": str(pd.Timestamp(end_date).date()),
            "warmup_start": str(pd.Timestamp(data["warmup_start"]).date()),
            "actual_first_evaluation_date": str(selected_dates[0].date())
                if len(selected_dates) else None,
            "actual_last_evaluation_date": str(selected_dates[-1].date())
                if len(selected_dates) else None,
            "symbols": data["symbols"],
            "feature_names": data["feature_names"],
            "metrics": metrics,
            "daily": {
                "dates": [d.strftime("%Y-%m-%d") for d in selected_dates],
                "returns_gross": gross.tolist(),
                "returns_net": net.tolist(),
                "costs": costs.tolist(),
            },
        }

        # Include model diagnostics/outputs when available, aligned to the
        # same post-warm-up requested-date slice.
        for key in ("att_w", "betas", "omegas"):
            if key in output:
                value = output[key]
                if torch.is_tensor(value):
                    value = value.detach().cpu().numpy()
                value = np.asarray(value)
                if len(value) == len(output_dates):
                    result["daily"][key] = value[requested_mask].tolist()

        # Run integer flooring simulation for Indian market & quantify decimal error loss
        if "omegas" in output:
            omegas_val = output["omegas"]
            if torch.is_tensor(omegas_val):
                omegas_val = omegas_val.detach().cpu().numpy()
            omegas_arr = np.asarray(omegas_val)
            if len(omegas_arr) == len(output_dates):
                selected_omegas = omegas_arr[requested_mask]
                prices_df = data.get("prices")
                if prices_df is not None and len(selected_dates) > 0:
                    eval_prices = prices_df.reindex(
                        index=selected_dates, columns=data["symbols"]
                    )
                    sim_result = simulate_integer_portfolio(
                        dates=selected_dates,
                        symbols=data["symbols"],
                        weights=selected_omegas,
                        prices=eval_prices,
                        initial_capital=initial_capital,
                        trading_days=self.trading_days,
                        risk_free_daily=self.risk_free_daily,
                    )
                    result["simulation"] = sim_result

        logger.info("Historical analysis completed: %s", metrics)
        return result

    def fetch_market_index(self, start_date=None, end_date=None) -> Optional[pd.DataFrame]:

        """Fetch Nifty 100 index history for market-model computations."""

        try:
            logger.info("Fetching market index (Nifty100)...")

            ticker = yf.Ticker("^CNX100")
            df = ticker.history(
                start=start_date,
                end=end_date,
                interval="1d"
            )

            if df.empty:
                logger.warning("No market index data retrieved")
                return None

            df.columns = [c.lower() for c in df.columns]

            # Remove timezone and normalize dates
            df.index = pd.to_datetime(df.index)

            if df.index.tz is not None:
                df.index = df.index.tz_localize(None)

            df.index = df.index.normalize()

            logger.info(f"Market index: {len(df)} trading days")

            return df

        except Exception as e:
            logger.error(f"Market index fetch failed: {e}")
            return None

    def align_market_returns(
        self,
        market_returns: pd.Series,
        oos_gross: np.ndarray,
        oos_net: np.ndarray,
        oos_R_f: np.ndarray,
        oos_dates: List[str],
    ) -> Tuple[Optional[np.ndarray], Optional[np.ndarray]]:
        """
        Slice the full market_returns array down to just the OOS dates used across
        all rolling windows.
        """
        mkt_ret = market_returns.copy()
        mkt_ret.index = mkt_ret.index.strftime('%Y-%m-%d')

        port_gross = pd.Series(oos_gross, index=oos_dates)
        port_net = pd.Series(oos_net, index=oos_dates)
        R_f = pd.Series(oos_R_f, index=oos_dates)
        common_dates = sorted(set(mkt_ret.index).intersection(set(port_gross.index)))
        #print("comm: ", len(common_dates))

        if not common_dates:
            logger.warning(
                "  No common dates between market_returns and oos_dates — "
                "skipping beta"
            )
            return None, None
 
        n_dropped_mkt = len(mkt_ret) - len(common_dates)
        n_dropped_port = len(port_gross) - len(common_dates)
 
        r_mkt_common  = mkt_ret.loc[common_dates].values
        r_gport_common = port_gross.loc[common_dates].values
        r_nport_common = port_net.loc[common_dates].values
        R_f_common = R_f[common_dates].values
 
        return r_gport_common, r_nport_common, r_mkt_common, R_f_common, common_dates


if __name__ == "__main__":

    data_dir = "../data"
    years_to_train = 11
    years_to_validate = 2
    years_to_test = 1
    k = 15
    mdd = "learnable"  # ["learnable", "pca"]
    proj_dim = 32
    hidden_projection_dim = 32
    lookback_length = 40
    epoch = 30
    learning_rate = 0.003
    weight_decay = 0.001
    lambda_var_coeff = 0.0
    lambda_ridge = 0.001
    lambda_squash = 0.001
    early_stop_patience = 8
    dropout = 0.0
    temperature = 0.05
    dev = "auto"
   
    # Example only. Keep these values identical to the trained checkpoint.
    config = ModelConfig(
        K = k,
        d = proj_dim,
        s = lookback_length,
        epochs = epoch,
        lr = learning_rate,
        weight_decay = weight_decay,
        d_hidden_conv = hidden_projection_dim,
        lambda_var = lambda_var_coeff,
        lambda_ridge = lambda_ridge,
        lambda_squash = lambda_squash,
        patience = early_stop_patience,
        save_dir = f"{data_dir}/../model_results_{mdd}",
        device=dev,
        mode=mdd,
    )

    analyzer = HistoricalAnalysis(config=config)
    output = analyzer.run(
        start_date="2026-01-01",
        end_date="2026-03-01",
        # Prefer passing the exact training universe and feature order:
        # symbols=TRAINING_SYMBOLS,
        # feature_names=TRAINING_FEATURE_NAMES,
    )

    print(output["metrics"])
