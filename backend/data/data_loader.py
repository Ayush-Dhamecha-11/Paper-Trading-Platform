"""
backend/ml/data_loader.py

Reads directly from the `characteristics` and `price_history` tables 
and builds the (T, N, M) / (T, N) tensors
"""

import logging
import sys
from pathlib import Path
from datetime import date
from typing import List, Optional, Tuple

import numpy as np
import pandas as pd
import torch
from sqlalchemy import select

# path of the current directory
current_dir = Path(__file__).resolve().parent

# path of the parent directory
parent_dir = current_dir.parent

# Adding the parent directory to the Python path
sys.path.append(str(parent_dir))

from db.database import SessionLocal
from db.models import PriceHistory, UniverseStock
# Characteristics no longer lives in SQL - pulled from Supabase Storage instead.
# download_panel/get_supabase_client are the same helpers used by the
# backfill/compute_for_date script; reuse them rather than duplicating the
# Parquet<->panel logic here.
from data.feature_comp_migration import download_panel, get_supabase_client

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

# Characteristics before this date are dropped becuase they have many NaN values in columns.
CHARACTERISTICS_START_DATE = date(2013, 1, 1)


class DataLoader:
    """
    Loads characteristics + returns from the database and exposes clean
    tensors to the model, split into a single train/val/current-year
    partition

    Parameters
        train_years : Number of calendar years used for training.
        val_years : Number of calendar years used for validation.
        characteristics_start : Earliest date to include (drops the NaN-populated period).
        as_of_date : Treat this as "today" for determining the current (excluded) year.
    """

    def __init__(
        self,
        train_years: int = 10,
        val_years: int = 3,
        characteristics_start: date = CHARACTERISTICS_START_DATE,
        as_of_date: Optional[date] = None,
    ):
        self.train_years = train_years
        self.val_years = val_years
        self.characteristics_start = characteristics_start
        self.as_of_date = as_of_date or date.today()

        self._full_panel: Optional[pd.DataFrame] = None # whole Parquet panel, downloaded once
        self._X: Optional[torch.Tensor] = None # (T, N, M)
        self._R: Optional[torch.Tensor] = None # (T, N)
        self._dates: Optional[List[pd.Timestamp]] = None # length T
        self._symbols: Optional[List[str]] = None # length N
        self._feature_names: Optional[List[str]] = None # length M
        self._split: Optional[dict] = None # single split dict

        logger.info("-" * 60)
        logger.info("DataLoader (DB-backed) - initialising")
        logger.info("-" * 60)

        self.master_load()


    def get_tensors(self) -> Tuple[torch.Tensor, torch.Tensor, List, List[str]]:
        """X (T,N,M), R (T,N), dates (len T), symbols (len N)."""
        return self._X, self._R, self._dates, self._symbols

    def get_split(self) -> dict:
        """
        The single train/val/current-year split.
        """
        return self._split

    def get_window_tensors(
        self,
        split: dict,
        X: Optional[torch.Tensor] = None,
        R: Optional[torch.Tensor] = None,
    ) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor]:
        """
        Slice X and R for one split.
        """

        if X is None:
            X = self._X
        if R is None:
            R = self._R

        X_train = X[split["train_idx_start"]: split["train_idx_end"]]
        R_train = R[split["train_idx_start"]: split["train_idx_end"]]

        X_val = X[split["val_idx_start"]: split["val_idx_end"]]
        R_val = R[split["val_idx_start"]: split["val_idx_end"]]

        X_test, R_test, dates_cur, symbols_cur = self.load_current_year_tensors()

        return X_train, R_train, X_val, R_val, X_test, R_test

    def describe(self) -> None:
        sp = self._split
        n_tr = sp["train_idx_end"] - sp["train_idx_start"]
        n_val = sp["val_idx_end"] - sp["val_idx_start"]
        n_cur = sp["test_idx_end"] - sp["test_idx_start"]

        print("\n" + "-" * 65)
        print("  DataLoader (DB-backed) - Data Summary")
        print("-" * 65)
        print(f"  Tensor X      : {tuple(self._X.shape)} (T, N, M)")
        print(f"  Tensor R      : {tuple(self._R.shape)} (T, N)")
        print(f"  Trading days  : {len(self._dates)}")
        print(f"  Stocks        : {len(self._symbols)}")
        print(f"  Features      : {len(self._feature_names)}")
        print(f"  Date range    : {self._dates[0]} --> {self._dates[-1]}")
        print()
        print(f"  Train : {sp['train_start']} --> {sp['train_end']}  ({n_tr} days)")
        print(f"  Val   : {sp['val_start']} --> {sp['val_end']}  ({n_val} days)")
        print(f"  Current year (live/forward-pass only): "
              f"{sp['test_start']} --> {sp['test_end']}  ({n_cur} days)")
        print()
        print(f"  NaN in X      : {torch.isnan(self._X).sum().item()}")
        print(f"  NaN in R      : {torch.isnan(self._R).sum().item()}")
        print("-" * 65 + "\n")

    # Load pipeline

    def master_load(self) -> None:
        # Panel is downloaded ONCE here and reused for both the historical
        # load and the current-year load below - avoids hitting Supabase
        # Storage twice for what's now a single flat file instead of two
        # separate SQL queries.
        sb = get_supabase_client()
        full_panel = download_panel(sb)
        if full_panel is None:
            raise RuntimeError(
                "No panel.parquet found in Supabase Storage - run backfill_all first."
            )
        self._full_panel = full_panel

        panel_df, panel_dates, panel_symbols, feature_names = self.load_characteristics()
        returns_df = self.load_returns(panel_symbols, panel_dates)

        X = self.build_X(panel_df, panel_dates, panel_symbols, feature_names)
        R = self.build_R(returns_df, panel_dates, panel_symbols)

        nan_X = torch.isnan(X).sum().item()
        nan_R = torch.isnan(R).sum().item()
        if nan_X > 0:
            logger.warning(f"  {nan_X} NaN values in X - replacing with 0.5 (median rank)")
            X = torch.nan_to_num(X, nan=0.5)
        if nan_R > 0:
            logger.warning(f"  {nan_R} NaN values in R - replacing with 0.0")
            R = torch.nan_to_num(R, nan=0.0)

        inf_X = torch.isinf(X).sum().item()
        inf_R = torch.isinf(R).sum().item()
        if inf_X > 0:
            X = torch.clamp(X, -10.0, 10.0)
        if inf_R > 0:
            R = torch.clamp(R, -0.5, 0.5)

        split = self.make_split(panel_dates)
        all_test_dates, test_start, test_end, test_n = self.current_year_bounds()

        tot_dates = panel_dates.tolist() + all_test_dates
        
        self._X, self._R = X, R
        self._dates, self._symbols, self._feature_names = tot_dates, panel_symbols, feature_names
        self._split = split

        logger.info("-" * 60)
        logger.info("Load complete.")
        logger.info(f"  X shape : {tuple(X.shape)}   R shape : {tuple(R.shape)}")
        logger.info(f"  Date range : {panel_dates[0].date()} --> {panel_dates[-1].date()}")
        logger.info("-" * 60)

    def load_characteristics(self):
        """
        Slice all characteristics rows from CHARACTERISTICS_START_DATE
        through the end of last year (current year excluded here at the
        source, not just at split time - it never even enters X/R) out of
        the in-memory panel downloaded once in master_load - no DB/network
        round trips per year any more.
        """
        logger.info("-" * 60)
        logger.info(f"Loading characteristics from panel (>= {self.characteristics_start})")
        logger.info("-" * 60)

        current_year_start = date(self.as_of_date.year, 1, 1)

        # self._full_panel has MultiIndex (symbol, day) - see
        # feature_comp_storage.parquet_bytes_to_panel. build_X's
        # `.unstack(level="symbol")` works with either index order, but we
        # standardize to (day, symbol) here to match every downstream
        # method's existing expectations (load_current_year_tensors etc.)
        # unchanged.
        panel = self._full_panel.swaplevel("symbol", "day").sort_index()
        day_index = panel.index.get_level_values("day")
        panel = panel[
            (day_index >= pd.Timestamp(self.characteristics_start))
            & (day_index < pd.Timestamp(current_year_start))
        ]

        if panel.empty:
            raise RuntimeError(
                f"No characteristics found for date >= {self.characteristics_start} "
                f"and < {current_year_start}. Has the backfill been run?"
            )

        panel_dates = panel.index.get_level_values("day").unique().sort_values()
        panel_symbols = sorted(panel.index.get_level_values("symbol").unique().tolist())
        feature_names = list(panel.columns)

        logger.info(f"  Panel shape    : {panel.shape}")
        logger.info(f"  Trading days   : {len(panel_dates)}")
        logger.info(f"  Unique symbols : {len(panel_symbols)}")
        logger.info(f"  Feature cols   : {len(feature_names)}")
        logger.info(
            f"  Date range     : {panel_dates.min().date()} --> {panel_dates.max().date()}"
        )

        return panel, panel_dates, panel_symbols, feature_names

    def load_returns(self, symbols: List[str], dates: pd.DatetimeIndex) -> pd.DataFrame:
        """
        Pull closing prices for exactly the symbols/date range the
        characteristics panel covers, and compute daily simple returns -
        DB equivalent of the old per-symbol CSV read + pct_change().
        """
        logger.info("-" * 60)
        logger.info("Loading returns from price_history")
        logger.info("-" * 60)

        start, end = dates.min().date(), dates.max().date()

        db = SessionLocal()
        try:
            rows = db.execute(
                select(PriceHistory.day, PriceHistory.symbol, PriceHistory.close)
                .where(PriceHistory.symbol.in_(symbols))
                .where(PriceHistory.day >= start)
                .where(PriceHistory.day <= end)
                .order_by(PriceHistory.day)
            ).all()
        finally:
            db.close()

        if not rows:
            raise RuntimeError("No price_history rows found for the characteristics date range.")

        prices_long = pd.DataFrame(rows, columns=["day", "symbol", "close"])
        prices_long["day"] = pd.to_datetime(prices_long["day"])
        prices_long["close"] = prices_long["close"].astype(float)

        prices_df = prices_long.pivot(index="day", columns="symbol", values="close")
        prices_df = prices_df.sort_index()

        missing_symbols = set(symbols) - set(prices_df.columns)
        if missing_symbols:
            logger.warning(
                f"  {len(missing_symbols)} symbols have characteristics but no "
                f"price_history in range: {sorted(missing_symbols)[:10]}"
                f"{'...' if len(missing_symbols) > 10 else ''}"
            )

        returns_df = prices_df.pct_change()

        logger.info(
            f"  Returns shape : {returns_df.shape} "
            f"({returns_df.shape[0]} days x {returns_df.shape[1]} stocks)"
        )
        return returns_df

    def build_X(self, panel_df, dates, symbols, feature_names) -> torch.Tensor:
        """Pivot (date, symbol)-indexed panel into a (T, N, M) tensor. Same
        unstack-and-reshape approach as the old loader's build_X."""
        logger.info("Building X tensor (T, N, M)")

        T, N, M = len(dates), len(symbols), len(feature_names)

        wide = panel_df.unstack(level="symbol")     # (T, M*N), cols=(feature, symbol)
        wide.columns = wide.columns.swaplevel(0, 1)  # (symbol, feature)
        wide = wide.sort_index(axis=1)

        expected_cols = pd.MultiIndex.from_product(
            [symbols, feature_names], names=["symbol", "feature"]
        )
        wide = wide.reindex(index=pd.DatetimeIndex(dates), columns=expected_cols)

        arr = wide.values.astype(np.float32)
        if arr.shape != (T, N * M):
            raise RuntimeError(
                f"Unexpected array shape after unstack: {arr.shape}. "
                f"Expected ({T}, {N * M})."
            )

        X = torch.tensor(arr.reshape(T, N, M), dtype=torch.float32)
        logger.info(f"  X shape : {tuple(X.shape)}   (T={T}, N={N}, M={M})")
        return X

    def build_R(self, returns_df: pd.DataFrame, dates, symbols: List[str]) -> torch.Tensor:
        """Align returns to the exact (dates, symbols) ordering X uses."""
        logger.info("Building R tensor (T, N)")
        aligned = returns_df.reindex(index=pd.DatetimeIndex(dates), columns=symbols)
        R = torch.tensor(aligned.values.astype(np.float32), dtype=torch.float32)
        logger.info(f"  R shape : {tuple(R.shape)}")
        return R

    # Splitting - single (train, val, current-year) split, not a rolling list

    def make_split(self, dates: pd.DatetimeIndex) -> dict:
        """
        Build the single split dict.

        Given usable_years (all years present in `dates`, which already
        excludes the current year per load_characteristics), this
        allocates:
            val   = last val_years of usable_years
            train = the train_years years immediately before val

        test_idx_start/end point at the current calendar year's rows in
        price_history.
        """

        logger.info("-" * 60)
        logger.info(f"Computing split (train_years={self.train_years}, val_years={self.val_years})")
        logger.info("-" * 60)

        dates_series = pd.Series(dates)
        usable_years = sorted(dates_series.dt.year.unique().tolist())

        if len(usable_years) < self.train_years + self.val_years:
            raise RuntimeError(
                f"Not enough years for this split. Have {len(usable_years)} usable "
                f"years ({usable_years[0]}-{usable_years[-1]}), need at least "
                f"{self.train_years + self.val_years} for train_years={self.train_years} "
                f"+ val_years={self.val_years}."
            )

        val_end_year = usable_years[-1]
        val_start_year = val_end_year - self.val_years + 1
        train_end_year = val_start_year - 1
        train_start_year = train_end_year - self.train_years + 1

        if train_start_year < usable_years[0]:
            raise RuntimeError(
                f"train_years={self.train_years} reaches back to {train_start_year}, "
                f"before the earliest usable year {usable_years[0]}. "
                f"Reduce train_years or val_years."
            )

        def year_bounds(yr: int) -> tuple:
            mask = dates_series.dt.year == yr
            idx = dates_series[mask].index.tolist()
            if not idx:
                raise RuntimeError(f"No trading days found for year {yr}")
            return idx[0], idx[-1]

        train_idx_start, _ = year_bounds(train_start_year)
        _, train_idx_end_incl = year_bounds(train_end_year)
        val_idx_start, _ = year_bounds(val_start_year)
        _, val_idx_end_incl = year_bounds(val_end_year)

        split = {
            "window": 1,
            "train_start": dates[train_idx_start],
            "train_end": dates[train_idx_end_incl],
            "val_start": dates[val_idx_start],
            "val_end": dates[val_idx_end_incl],
            "train_idx_start": train_idx_start,
            "train_idx_end": train_idx_end_incl + 1,   # exclusive, matches old convention
            "val_idx_start": val_idx_start,
            "val_idx_end": val_idx_end_incl + 1,
        }

        # Current-year ("test") bounds come from price_history directly,
        # since that year was intentionally excluded from `dates`/X/R.
        all_test_dates, test_start, test_end, test_n = self.current_year_bounds()
        split["test_start"] = test_start
        split["test_end"] = test_end
        split["test_idx_start"] = 0
        split["test_idx_end"] = test_n

        logger.info(
            f"  Train : {split['train_start'].date()} --> {split['train_end'].date()} "
            f"(idx {split['train_idx_start']}:{split['train_idx_end']})"
        )
        logger.info(
            f"  Val   : {split['val_start'].date()} --> {split['val_end'].date()} "
            f"(idx {split['val_idx_start']}:{split['val_idx_end']})"
        )
        logger.info(
            f"  Current year : "
            f"{split['test_start']} --> {split['test_end']}"
        )
        return split

    def current_year_bounds(self) -> tuple:
        """How many trading days exist so far in the current year"""
        current_year_start = date(self.as_of_date.year, 1, 1)
        db = SessionLocal()
        try:
            rows = db.execute(
                select(PriceHistory.day)
                .where(PriceHistory.day >= current_year_start)
                .where(PriceHistory.day <= self.as_of_date)
                .distinct()
            ).all()
        finally:
            db.close()

        if not rows:
            return current_year_start, self.as_of_date, 0
        all_dates = sorted(r[0] for r in rows)
        return all_dates, all_dates[0], all_dates[-1], len(all_dates)

    def load_current_year_tensors(self) -> Tuple[torch.Tensor, torch.Tensor, List, List[str]]:
        """
        Build X/R for the current (live) year only, for the daily
        forward-pass step. Reuses the panel downloaded once in
        master_load - if this is called standalone (before master_load, or
        from a fresh instance), it falls back to downloading directly, since
        the daily cron may call this without going through master_load.
        """
        current_year_start = date(self.as_of_date.year, 1, 1)

        full_panel = getattr(self, "_full_panel", None)
        if full_panel is None:
            sb = get_supabase_client()
            full_panel = download_panel(sb)
            if full_panel is None:
                raise RuntimeError(
                    "No panel.parquet found in Supabase Storage - run backfill_all first."
                )
            self._full_panel = full_panel

        panel = full_panel.swaplevel("symbol", "day").sort_index()
        day_index = panel.index.get_level_values("day")
        panel = panel[
            (day_index >= pd.Timestamp(current_year_start))
            & (day_index <= pd.Timestamp(self.as_of_date))
        ]

        if panel.empty:
            raise RuntimeError(
                f"No characteristics found for current year >= {current_year_start}."
            )

        cur_dates = panel.index.get_level_values("day").unique().sort_values()
        cur_symbols = self._symbols or sorted(panel.index.get_level_values("symbol").unique().tolist())
        feature_names = self._feature_names or list(panel.columns)

        X_cur = self.build_X(panel, cur_dates, cur_symbols, feature_names)
        returns_df = self.load_returns(cur_symbols, cur_dates)
        R_cur = self.build_R(returns_df, cur_dates, cur_symbols)

        return X_cur, R_cur, cur_dates, cur_symbols


if __name__ == "__main__":
    loader = DataLoader(train_years=10, val_years=3)
    loader.describe()

    X, R, dates, symbols = loader.get_tensors()
    split = loader.get_split()
    X_tr, R_tr, X_val, R_val, X_test, R_test = loader.get_window_tensors(split)

    print(f"X_train : {tuple(X_tr.shape)}   R_train : {tuple(R_tr.shape)}")
    print(f"X_val   : {tuple(X_val.shape)}   R_val   : {tuple(R_val.shape)}")