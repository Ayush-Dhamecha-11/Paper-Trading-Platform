"""
Computes the 23 firm characteristics from price_history, plus cross-sectional medians and
rank-normalisation, and writes them to a single Parquet file ("characteristics panel")
kept in Supabase Storage - replacing the old `characteristics` SQL table.

Two modes:
    backfill_all(start_date, end_date)
        One-time full computation over a date range, across the whole universe.
        Builds the panel from scratch and uploads it as one Parquet object.

    compute_for_date(target_date)
        Incremental daily step, called from jobs/price_fetch_cron.py right
        after the price fetch. Downloads the existing panel, pulls a bounded
        trailing window (~800 trading days) per symbol from price_history,
        computes ONE new row per symbol, re-runs the cross-sectional step
        over [recent tail of stored panel + new rows], appends only the 
        new rows to the panel, and re-uploads it.


Storage Layout in Supabase Storage:
-----------------------------------
Bucket:  characteristics 
        (create this bucket in Supabase Storage first)
Object:  characteristics_panel.parquet             
        (single file holding the whole panel, 
        MultiIndex (symbol, day) written as regular columns)
"""

import io
import os
import logging
import sys
import time
from pathlib import Path
from datetime import date, datetime, timedelta
from typing import Optional
import numpy as np
import pandas as pd
from sqlalchemy import select
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# path of the current directory
current_dir = Path(__file__).resolve().parent

# path of the parent directory
parent_dir = current_dir.parent

# Adding the parent directory to the Python path
sys.path.append(str(parent_dir))

from db.database import SessionLocal
from db.models import PriceHistory, UniverseStock
from supabase import create_client, Client  # pip install supabase

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

MARKET_INDEX_SYMBOL = "^CNX100"
TRAILING_WINDOW_DAYS = 800
RAW_CHARACTERISTICS = [
    "Ret_D1", "Ret_W1", "STD_W1", "ST_Rev", "r12_2", "r12_7", "r36_13",
    "Variance", "HighLowVol", "Resid_Var", "Beta",
    "Vol", "SUV", "LTurnover", "Amihud", "Rel2High",
    "MktCap_Proxy", "PriceMom_Acc", "VolMom", "RSI14", "MACD_Sig",
    "DistMA50", "DistMA200",
]

# Supabase Storage config
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
STORAGE_BUCKET = "characteristics"
PANEL_OBJECT_PATH = "characteristics_panel.parquet"

# How many extra calendar days of the stored panel to pull back for the
# daily cross-section recompute. Must cover `rolling_days=30` trading days
# with slack for weekends/holidays - 60 calendar days is a safe margin.
CROSS_SECTION_LOOKBACK_CALENDAR_DAYS = 60

def get_supabase_client() -> Client:
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

def get_universe_symbols(db) -> list[str]:
    return db.execute(select(UniverseStock.symbol)).scalars().all()


def load_price_history(db, symbol: str, start: Optional[date] = None, end: Optional[date] = None) -> pd.DataFrame:
    """Load one symbol's price_history as a DataFrame indexed by date."""

    stmt = select(
        PriceHistory.day, PriceHistory.open, PriceHistory.high,
        PriceHistory.low, PriceHistory.close, PriceHistory.volume,
    ).where(PriceHistory.symbol == symbol)

    if start is not None:
        stmt = stmt.where(PriceHistory.day >= start)
    if end is not None:
        stmt = stmt.where(PriceHistory.day <= end)

    stmt = stmt.order_by(PriceHistory.day)
    rows = db.execute(stmt).all()

    if not rows:
        return pd.DataFrame()

    df = pd.DataFrame(rows, columns=["day", "open", "high", "low", "close", "volume"])
    df["day"] = pd.to_datetime(df["day"])
    df = df.set_index("day")

    for col in ("open", "high", "low", "close"):
        df[col] = df[col].astype(float)
    df["volume"] = df["volume"].astype(float)

    return df


# Per-stock raw characteristics (UNCHANGED from your original - this logic
# is correct and has nothing to do with the storage migration)
def compute_past_returns(hist: pd.DataFrame) -> pd.DataFrame:
    df = pd.DataFrame(index=hist.index)
    ret = hist["close"].pct_change()

    df["Ret_D1"] = ret.shift(1)
    df["Ret_W1"] = hist["close"].pct_change(5).shift(1)
    df["STD_W1"] = ret.rolling(window=5).std().shift(1)
    df["ST_Rev"] = hist["close"].pct_change(21).shift(1)
    df["r12_2"] = (hist["close"].shift(21) / hist["close"].shift(252) - 1)
    df["r12_7"] = (hist["close"].shift(126) / hist["close"].shift(252) - 1)
    df["r36_13"] = (hist["close"].shift(252) / hist["close"].shift(756) - 1)
    return df


def compute_volatility(hist: pd.DataFrame, market_hist: Optional[pd.DataFrame],
                        incremental: bool = False) -> pd.DataFrame:
    """
    incremental=True computes Beta/Resid_Var for only the LAST row
    (used by compute_for_date), instead of looping over every row in
    the slice (used by backfill_all, matching the original algorithm
    exactly). Both give identical values for the last row - incremental
    mode just skips redoing the regression for every earlier date,
    which daily mode never needs.
    """
    df = pd.DataFrame(index=hist.index)
    ret = hist["close"].pct_change()

    df["Variance"] = ret.rolling(21).var().shift(1)

    ln_hl_sq = np.log(hist["high"] / hist["low"]) ** 2
    park_var = ln_hl_sq.rolling(21).sum() / (4 * np.log(2) * 21)
    df["HighLowVol"] = park_var.shift(1)

    if market_hist is None or market_hist.empty:
        logger.warning("market_hist not provided - Beta=NaN, Resid_Var≈0.7×Variance")
        df["Beta"] = np.nan
        df["Resid_Var"] = df["Variance"] * 0.7
        return df

    mkt_hist = market_hist.reindex(hist.index, method="ffill")
    mkt_ret = mkt_hist["close"].pct_change().rename("mkt")
    combined = pd.concat([ret.rename("stock"), mkt_ret], axis=1).dropna()

    n = len(hist.index)
    resid_var_arr = np.full(n, np.nan)
    beta_arr = np.full(n, np.nan)
    hist_dates = hist.index

    # NOTE: Resid_Var/Beta get .shift(1) applied below, so whatever we
    # compute at position i ends up on row i+1. To fill in the LAST row
    # (index n-1) in incremental mode, we must compute position n-2, not
    # n-1 - otherwise the shift pushes the one value we bothered to
    # compute off the end of the series entirely (silent all-NaN result).
    positions = [n - 2] if incremental else list(range(252, n))

    for i in positions:
        if i < 252:
            continue
        window_end_date = hist_dates[i]
        mask = combined.index < window_end_date
        window = combined.loc[mask].iloc[-252:]

        if len(window) < 60:
            continue

        X = np.column_stack([np.ones(len(window)), window["mkt"].values])
        y = window["stock"].values

        try:
            coeffs, _, _, _ = np.linalg.lstsq(X, y, rcond=None)
            beta_arr[i] = coeffs[1]
            resid = y - X @ coeffs
            resid_var_arr[i] = np.var(resid, ddof=2)
        except np.linalg.LinAlgError:
            pass

    df["Resid_Var"] = pd.Series(resid_var_arr, index=hist.index).shift(1)
    df["Beta"] = pd.Series(beta_arr, index=hist.index).shift(1)
    return df


def compute_liquidity(hist: pd.DataFrame) -> pd.DataFrame:
    df = pd.DataFrame(index=hist.index)
    close = hist["close"]
    volume = hist["volume"].clip(lower=1)
    ret = close.pct_change()

    df["Vol"] = np.log(volume.rolling(5).sum()).shift(1)

    log_vol = np.log(volume)
    roll_mean = log_vol.rolling(252, min_periods=60).mean()
    roll_std = log_vol.rolling(252, min_periods=60).std().clip(lower=1e-8)
    df["SUV"] = ((log_vol - roll_mean) / roll_std).shift(1)

    avg_21 = volume.rolling(21, min_periods=5).mean()
    avg_252 = volume.rolling(252, min_periods=60).mean().clip(lower=1)
    df["LTurnover"] = np.log((avg_21 / avg_252).clip(lower=1e-6)).shift(1)

    rupee_vol = close * volume
    amihud_daily = ret.abs() / rupee_vol.clip(lower=1)
    df["Amihud"] = (amihud_daily.rolling(21, min_periods=5).mean() * 1e7).shift(1)

    high_252 = hist["high"].rolling(252, min_periods=60).max().shift(1)
    df["Rel2High"] = (close / high_252.clip(lower=1e-8)).shift(1)

    return df


def compute_price_level_signal(hist: pd.DataFrame) -> pd.DataFrame:
    df = pd.DataFrame(index=hist.index)
    c = hist["close"]
    vol = hist["volume"].clip(lower=1)

    avg_vol_21 = vol.rolling(21, min_periods=5).mean()
    df["MktCap_Proxy"] = np.log((c * avg_vol_21).clip(lower=1)).shift(1)

    r2_1 = c.shift(1) / c.shift(2) - 1
    r12_2 = c.shift(21) / c.shift(252) - 1
    df["PriceMom_Acc"] = (r2_1 - r12_2).shift(1)

    avg_vol_5 = vol.rolling(5, min_periods=2).mean()
    avg_vol_21_b = vol.rolling(21, min_periods=5).mean().clip(lower=1)
    df["VolMom"] = (avg_vol_5 / avg_vol_21_b).shift(1)

    delta = c.diff()
    gain = delta.clip(lower=0)
    loss = (-delta).clip(lower=0)
    avg_gain = gain.rolling(14, min_periods=14).mean()
    avg_loss = loss.rolling(14, min_periods=14).mean().clip(lower=1e-10)
    rs = avg_gain / avg_loss
    rsi = 100.0 - (100.0 / (1.0 + rs))
    df["RSI14"] = rsi.shift(1)

    ema12 = c.ewm(span=12, adjust=False).mean()
    ema26 = c.ewm(span=26, adjust=False).mean()
    macd = ema12 - ema26
    signal = macd.ewm(span=9, adjust=False).mean()
    price_std = c.rolling(252, min_periods=60).std().clip(lower=1e-8)
    df["MACD_Sig"] = (signal / price_std).shift(1)

    ma50 = c.rolling(50, min_periods=25).mean().clip(lower=1e-8)
    df["DistMA50"] = ((c - ma50) / ma50).shift(1)

    ma200 = c.rolling(200, min_periods=100).mean().clip(lower=1e-8)
    df["DistMA200"] = ((c - ma200) / ma200).shift(1)

    return df


def compute_raw_characteristics_for_symbol(
    hist: pd.DataFrame, market_hist: Optional[pd.DataFrame], incremental: bool
) -> pd.DataFrame:
    """Returns a DataFrame of the 23 raw characteristics, one row per date in hist."""
    frames = [
        compute_past_returns(hist),
        compute_volatility(hist, market_hist, incremental=incremental),
        compute_liquidity(hist),
        compute_price_level_signal(hist),
    ]
    return pd.concat(frames, axis=1)


# Cross-sectional step (rank-norm + median), applied to one or many dates
# (UNCHANGED from your original)
def apply_cross_section(panel_raw: pd.DataFrame) -> pd.DataFrame:
    """
    Takes a raw panel with MultiIndex (symbol, day) and the RAW_CHARACTERISTICS
    columns, and returns a single DataFrame with raw + csmedian + rank-norm
    columns for every characteristic, plus RFR
    """

    char_cols = [c for c in panel_raw.columns if c in RAW_CHARACTERISTICS]
    rolling_days = 30

    median_cols = {}
    for col in char_cols:
        median_cols[f"{col}_csmedian"] = panel_raw[col].groupby(level="day").transform("median")
    median_df = pd.DataFrame(median_cols, index=panel_raw.index)
    panel_ext = pd.concat([panel_raw, median_df], axis=1)

    all_cols = char_cols + list(median_cols.keys())
    for col in all_cols:
        is_nan = panel_ext[col].isna()
        if is_nan.any():
            cs_med = panel_ext[col].groupby(level="day").transform("median")
            panel_ext[col] = panel_ext[col].fillna(cs_med)

    panel_norm = panel_ext.copy()
    dates = panel_norm.index.get_level_values("day")

    for col in char_cols:
        panel_norm[col] = panel_ext[col].groupby(level="day").transform(lambda x: x.rank(pct=True))
        med_col = f"{col}_csmedian"
        extract = panel_ext[med_col].groupby(level="day").first()
        roll_mean = extract.rolling(rolling_days, min_periods=5).mean()
        roll_std = extract.rolling(rolling_days, min_periods=5).std()
        z = (extract - roll_mean) / roll_std
        z = z.replace([np.inf, -np.inf], np.nan).fillna(0)
        panel_norm[med_col] = panel_norm.index.get_level_values("day").map(z)

    return panel_norm


# Storage helpers (Parquet <-> Supabase Storage)
def panel_to_parquet_bytes(panel: pd.DataFrame) -> bytes:
    "Flattens the MultiIndex and writes to Parquet bytes for upload to Supabase Storage."

    flat = panel.reset_index()  # symbol, day become normal columns
    buf = io.BytesIO()
    flat.to_parquet(buf, engine="pyarrow", index=False, compression="snappy")
    return buf.getvalue()

    # CSV alternative
    # buf = io.StringIO()
    # flat.to_csv(buf, index=False)
    # return buf.getvalue().encode("utf-8")


def parquet_bytes_to_panel(data: bytes) -> pd.DataFrame:
    """Inverse of panel_to_parquet_bytes: rebuilds the (symbol, day) MultiIndex."""

    flat = pd.read_parquet(io.BytesIO(data), engine="pyarrow")
    flat["day"] = pd.to_datetime(flat["day"])
    return flat.set_index(["symbol", "day"]).sort_index()

    # --- CSV alternative ---
    # flat = pd.read_csv(io.BytesIO(data))
    # flat["day"] = pd.to_datetime(flat["day"])
    # return flat.set_index(["symbol", "day"]).sort_index()


def download_panel(sb: Client) -> Optional[pd.DataFrame]:
    """Returns None if no panel exists yet (first-ever run before backfill)."""
    try:
        data = sb.storage.from_(STORAGE_BUCKET).download(PANEL_OBJECT_PATH)
    except Exception as e:
        logger.info(f"No existing panel found at {STORAGE_BUCKET}/{PANEL_OBJECT_PATH} ({e}) - treating as empty.")
        return None
    return parquet_bytes_to_panel(data)


def upload_panel(sb: Client, panel: pd.DataFrame, retries: int = 3) -> None:
    """
    Uploads the FULL panel, overwriting the existing object (upsert=True).
    Retries a few times since this is a single large PUT over the network
    and the daily cron shouldn't fail the whole job on one flaky request.

    For files that reliably exceed a few hundred MB, Supabase recommends
    TUS resumable upload over the standard client method for reliability
    (see supabase.com/docs/guides/storage/uploads/resumable-uploads).
    The standard method used here supports up to 5GB and is simpler to
    call from a server-side cron job with a stable connection; switch to
    TUS if you start seeing upload failures in practice.
    """

    payload = panel_to_parquet_bytes(panel)
    size_mb = len(payload) / (1024 * 1024)
    logger.info(f"Uploading panel: {panel.shape[0]:,} rows x {panel.shape[1]} cols, {size_mb:.1f} MB")

    last_err = None
    for attempt in range(1, retries + 1):
        try:
            sb.storage.from_(STORAGE_BUCKET).upload(
                path=PANEL_OBJECT_PATH,
                file=payload,
                file_options={"content-type": "application/octet-stream", "upsert": "true"},
            )
            logger.info(f"Panel uploaded to {STORAGE_BUCKET}/{PANEL_OBJECT_PATH}")
            return
        except Exception as e:
            last_err = e
            logger.warning(f"Upload attempt {attempt}/{retries} failed: {e}")
            time.sleep(2 ** attempt)

    raise RuntimeError(f"Failed to upload panel after {retries} attempts: {last_err}")


def panel_row_to_features(row: pd.Series) -> dict:
    """Kept for parity with the old code / callers that want a dict-per-row view."""
    return {k: (None if pd.isna(v) else float(v)) for k, v in row.items()}


# Incremental daily mode
def compute_for_date(target_date: date) -> tuple[int, int]:
    """
    Compute characteristics for target_date only, using a bounded
    trailing window per symbol, and APPEND the result to the stored
    characteristics_panel.parquet in Supabase Storage.
    """
    db = SessionLocal()
    sb = get_supabase_client()
    written, skipped = 0, 0
    try:
        symbols = get_universe_symbols(db)
        if not symbols:
            logger.warning("universe_stocks is empty - nothing to compute.")
            return 0, 0

        existing_panel = download_panel(sb)
        if existing_panel is None:
            logger.error(
                "No characteristics_panel.parquet found in storage - run backfill_all first. "
                "compute_for_date cannot bootstrap the panel on its own."
            )
            return 0, 0

        window_start = target_date - timedelta(days=int(TRAILING_WINDOW_DAYS * 1.6))
        # *1.6 buffer converts "trading days" to a safe calendar-day lookback

        market_hist = load_price_history(db, MARKET_INDEX_SYMBOL, start=window_start, end=target_date)

        raw_frames = {}
        for i, symbol in enumerate(symbols):
            hist = load_price_history(db, symbol, start=window_start, end=target_date)
            if hist.empty or hist.index[-1].date() != target_date:
                logger.warning(f"{symbol}: no price row for {target_date} - skipping")
                skipped += 1
                continue

            if symbol == MARKET_INDEX_SYMBOL:
                continue  # don't compute characteristics for the market index
            logger.info(f"[{i+1}/{len(symbols)}] computing raw characteristics for {symbol}")

            try:
                raw = compute_raw_characteristics_for_symbol(hist, market_hist, incremental=True)
                raw_frames[symbol] = raw.iloc[[-1]]  # only target_date's row
            except Exception as e:
                logger.error(f"{symbol}: characteristic computation failed - {e}")
                skipped += 1

        if not raw_frames:
            logger.warning(f"No characteristics computed for {target_date}")
            return 0, skipped

        pieces = []
        for symbol, row_df in raw_frames.items():
            tmp = row_df.copy()
            tmp.index.name = "day"
            tmp["symbol"] = symbol
            pieces.append(tmp.reset_index().set_index(["symbol", "day"]))

        panel_raw_new = pd.concat(pieces).sort_index()

        # Cross-section needs a trailing window of PREVIOUSLY STORED raw
        # characteristics (not the normalized columns) so the 30-day
        # rolling z-score on the cross-sectional median is correct for
        # target_date. Pull only the raw characteristic columns from the
        # tail of the existing panel - cheap, since this is ~60 calendar
        # days x N symbols, not the full 15-year history.
        lookback_start = pd.Timestamp(target_date) - pd.Timedelta(days=CROSS_SECTION_LOOKBACK_CALENDAR_DAYS)
        raw_cols_in_panel = [c for c in RAW_CHARACTERISTICS if c in existing_panel.columns]
        recent_tail = existing_panel[
            existing_panel.index.get_level_values("day") >= lookback_start
        ][raw_cols_in_panel]

        combined_raw = pd.concat([recent_tail, panel_raw_new[raw_cols_in_panel]]).sort_index()
        combined_norm = apply_cross_section(combined_raw)

        # Keep only target_date's rows - everything before it was already
        # normalized and stored on a prior run.
        new_rows_norm = combined_norm[
            combined_norm.index.get_level_values("day") == pd.Timestamp(target_date)
        ]

        if new_rows_norm.empty:
            logger.warning(f"Cross-section step produced no rows for {target_date}")
            return 0, skipped

        # Align columns with the existing panel (new panel may introduce
        # columns not present historically, e.g. a first-ever run) and append.
        updated_panel = pd.concat([existing_panel, new_rows_norm]).sort_index()
        # Guard against accidental duplicate (symbol, day) rows if this is
        # ever re-run for a date that was already written.
        updated_panel = updated_panel[~updated_panel.index.duplicated(keep="last")]

        upload_panel(sb, updated_panel)
        written = len(new_rows_norm)

        logger.info(f"characteristics for {target_date}: written={written} skipped={skipped}")
        return written, skipped

    finally:
        db.close()


# Backfill mode
def backfill_all(start_date: date, end_date: date) -> tuple[int, int]:
    """
    Full historical computation across the whole universe. Run this once
    to create characteristics_panel.parquet, or re-run a date range if a characteristic's
    formula changes (this OVERWRITES the whole panel object).
    """
    db = SessionLocal()
    sb = get_supabase_client()
    written, skipped = 0, 0
    try:
        symbols = get_universe_symbols(db)
        if not symbols:
            logger.warning("universe_stocks is empty - nothing to compute.")
            return 0, 0

        market_hist = load_price_history(db, MARKET_INDEX_SYMBOL, start=start_date, end=end_date)

        pieces = []
        for i, symbol in enumerate(symbols):
            logger.info(f"[{i+1}/{len(symbols)}] computing raw characteristics for {symbol}")
            hist = load_price_history(db, symbol, start=start_date, end=end_date)
            if hist.empty:
                logger.warning(f"{symbol}: no price history in range - skipping")
                skipped += 1
                continue

            if symbol == MARKET_INDEX_SYMBOL:
                continue  # don't compute characteristics for the market index

            try:
                raw = compute_raw_characteristics_for_symbol(hist, market_hist, incremental=False)
            except Exception as e:
                logger.error(f"{symbol}: characteristic computation failed - {e}")
                skipped += 1
                continue

            tmp = raw.copy()
            tmp.index.name = "day"
            tmp["symbol"] = symbol
            pieces.append(tmp.reset_index().set_index(["symbol", "day"]))

        if not pieces:
            logger.error("No characteristics computed - aborting backfill.")
            return 0, skipped

        panel_raw = pd.concat(pieces).sort_index()
        logger.info(f"Stacked panel: {panel_raw.shape[0]:,} rows x {panel_raw.shape[1]} cols")

        logger.info("Applying cross-sectional rank-norm + median step...")
        panel_norm = apply_cross_section(panel_raw)

        logger.info(f"Uploading {len(panel_norm):,} rows as characteristics_panel.parquet ...")
        upload_panel(sb, panel_norm)
        written = len(panel_norm)

        logger.info(f"Backfill complete: written={written} skipped_symbols={skipped}")
        return written, skipped

    finally:
        db.close()


def main():
    backfill = False

    if backfill:
        end_date = datetime(2026, 9, 6)
        start_date = datetime(2011, 12, 1)
        written, _ = backfill_all(start_date, end_date)
    else:
        target = date(2026, 9, 7)
        written, _ = compute_for_date(target)

    if written == 0:
        logger.error("Zero rows written - failing the job.")
        sys.exit(1)


if __name__ == "__main__":
    main()