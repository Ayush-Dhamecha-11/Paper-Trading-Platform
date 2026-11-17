"""
backend/api/services/simulation_service.py

Service layer for running portfolio simulations:
1. Continuous decimal allocation (ideal)
2. Integer-floored allocation (matching Indian market rules on NSE/BSE)
3. Decimal tracking error loss and unallocated cash calculation
"""

from __future__ import annotations

import logging
import math
from datetime import date
from typing import Any, Optional, Sequence

import numpy as np
import pandas as pd
from sqlalchemy import select
from sqlalchemy.orm import Session

from db.models import ModelPrediction, PriceHistory, UniverseStock

logger = logging.getLogger(__name__)


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
    """
    initial_capital = float(initial_capital)
    if initial_capital <= 0:
        raise ValueError("initial_capital must be positive.")

    n_days = len(dates)
    n_symbols = len(symbols)
    if n_days == 0 or n_symbols == 0:
        return {
            "initial_capital": initial_capital,
            "metrics_ideal": {
                "initial_capital": initial_capital,
                "final_equity": initial_capital,
                "total_return_pct": 0.0,
                "annualized_return_pct": 0.0,
                "annualized_volatility_pct": 0.0,
                "annualized_sharpe": 0.0,
            },
            "metrics_floored": {
                "initial_capital": initial_capital,
                "final_equity": initial_capital,
                "total_return_pct": 0.0,
                "annualized_return_pct": 0.0,
                "annualized_volatility_pct": 0.0,
                "annualized_sharpe": 0.0,
            },
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


def run_database_simulation(
    db: Session,
    start_date: date,
    end_date: date,
    initial_capital: float,
    model_name: Optional[str] = None,
) -> Optional[dict]:
    """Execute integer simulation directly against stored ModelPrediction and PriceHistory tables."""
    universe_stocks = (
        db.execute(select(UniverseStock).order_by(UniverseStock.symbol.asc()))
        .scalars()
        .all()
    )
    if not universe_stocks:
        return None
    symbols = [s.symbol for s in universe_stocks]

    query = select(ModelPrediction).where(
        ModelPrediction.as_of_date >= start_date,
        ModelPrediction.as_of_date <= end_date,
    )
    if model_name:
        query = query.where(ModelPrediction.model_name == model_name)
    predictions = (
        db.execute(query.order_by(ModelPrediction.as_of_date.asc()))
        .scalars()
        .all()
    )
    if not predictions:
        return None

    pred_dates = [p.as_of_date for p in predictions]
    weights_list = [[float(w) for w in p.weight_for_symbols] for p in predictions]
    weights_arr = np.array(weights_list, dtype=float)

    min_date = pred_dates[0]
    max_date = pred_dates[-1]

    price_rows = db.execute(
        select(PriceHistory.day, PriceHistory.symbol, PriceHistory.close)
        .where(
            PriceHistory.symbol.in_(symbols),
            PriceHistory.day >= min_date,
            PriceHistory.day <= max_date,
        )
        .order_by(PriceHistory.day.asc(), PriceHistory.symbol.asc())
    ).all()

    if not price_rows:
        return None

    price_df = pd.DataFrame(price_rows, columns=["day", "symbol", "close"])
    price_df["day"] = pd.to_datetime(price_df["day"]).dt.date
    price_df["close"] = pd.to_numeric(price_df["close"], errors="coerce")

    pivoted_prices = (
        price_df.pivot(index="day", columns="symbol", values="close")
        .sort_index()
        .reindex(index=pred_dates, columns=symbols)
    )
    pivoted_prices = pivoted_prices.ffill().bfill().fillna(0.0)

    return simulate_integer_portfolio(
        dates=pred_dates,
        symbols=symbols,
        weights=weights_arr,
        prices=pivoted_prices,
        initial_capital=initial_capital,
    )


def run_model_historical_simulation(
    start_date: date | str,
    end_date: date | str,
    initial_capital: float = 1_000_000.0,
    model_name: Optional[str] = "learnable",
) -> Optional[dict]:
    """
    Execute historical model backtest via AttentionFactorModel + LongConv
    over any arbitrary date range using characteristics panel from Supabase.
    """
    try:
        from ML.models.train import ModelConfig
        from ML.models.historical_analysis import HistoricalAnalysis

        mdd = model_name if model_name in ["learnable", "pca"] else "learnable"
        config = ModelConfig(
            K=5,
            d=32,
            s=50,
            epochs=30,
            lr=0.008,
            weight_decay=0.002,
            d_hidden_conv=32,
            lambda_var=0.0,
            lambda_ridge=0.01,
            lambda_squash=0.001,
            patience=8,
            save_dir="",
            device="cpu",
            mode=mdd,
        )
        analyzer = HistoricalAnalysis(config=config)
        output = analyzer.run(
            start_date=str(start_date),
            end_date=str(end_date),
            initial_capital=initial_capital,
        )
        sim = output.get("simulation")
        if sim and sim.get("daily"):
            return sim
        return None
    except Exception as exc:
        logger.error("Failed to run historical model simulation: %s", exc, exc_info=True)
        return None


def execute_simulation(
    db: Session,
    start_date: date,
    end_date: date,
    initial_capital: float,
    model_name: Optional[str] = None,
) -> Optional[dict]:
    """
    Run simulation prioritizing DB predictions if present, or dynamically running
    the historical model pipeline for any requested date range.
    """
    # 1. Try DB first if there are sufficient predictions stored
    sim_data = run_database_simulation(
        db=db,
        start_date=start_date,
        end_date=end_date,
        initial_capital=initial_capital,
        model_name=model_name,
    )
    if sim_data is not None and len(sim_data.get("daily", [])) >= 2:
        return sim_data

    # 2. Run the full historical analysis model pipeline
    return run_model_historical_simulation(
        start_date=start_date,
        end_date=end_date,
        initial_capital=initial_capital,
        model_name=model_name,
    )


