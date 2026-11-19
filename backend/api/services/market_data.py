"""
Shared market-data access for the paper-trading application.

The application has two kinds of prices:

* LIVE/LATEST MARKET PRICE: latest available 1-minute NSE regular-session
  price from Yahoo Finance while the market is open. After the market closes,
  the latest completed session close is used.
* PREVIOUS CLOSE: the close of the trading session immediately before the
  latest/current session.

This module is deliberately the single live-price implementation used by
stocks, dashboard, portfolio and trade execution. It also caches quotes for a
short period so two pages requested close together see the same market mark.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from threading import Lock
from typing import Iterable
from zoneinfo import ZoneInfo

import pandas as pd

logger = logging.getLogger(__name__)

IST = ZoneInfo("Asia/Kolkata")
NSE_OPEN = time(9, 15)
NSE_CLOSE = time(15, 30)
DEFAULT_CACHE_SECONDS = 10

# Known National / NSE Trading Holidays (Month, Day)
STANDARD_NSE_HOLIDAYS_MD: set[tuple[int, int]] = {
    (1, 26),   # Republic Day
    (5, 1),    # Maharashtra Day / May Day
    (8, 15),   # Independence Day
    (10, 2),   # Gandhi Jayanti
    (12, 25),  # Christmas
}

# Variable holiday calendar for active trading years (GRCh/NSE observed)
NSE_VARIABLE_HOLIDAYS: set[date] = {
    # 2025
    date(2025, 2, 26),  # Mahashivratri
    date(2025, 3, 14),  # Holi
    date(2025, 3, 31),  # Id-Ul-Fitr
    date(2025, 4, 10),  # Mahavir Jayanti
    date(2025, 4, 14),  # Dr. Baba Saheb Ambedkar Jayanti
    date(2025, 4, 18),  # Good Friday
    date(2025, 6, 7),   # Bakri Id
    date(2025, 8, 27),  # Ganesh Chaturthi
    date(2025, 10, 2),  # Mahatma Gandhi Jayanti / Dussehra
    date(2025, 10, 21), # Diwali Laxmi Pujan
    date(2025, 10, 22), # Diwali Balipratipada
    date(2025, 11, 5),  # Gurunanak Jayanti
    # 2026
    date(2026, 1, 26),  # Republic Day
    date(2026, 2, 16),  # Mahashivratri
    date(2026, 3, 4),   # Holi
    date(2026, 3, 20),  # Id-Ul-Fitr
    date(2026, 4, 3),   # Good Friday
    date(2026, 4, 14),  # Ambedkar Jayanti
    date(2026, 5, 1),   # Maharashtra Day
    date(2026, 5, 27),  # Bakri Id
    date(2026, 8, 15),  # Independence Day
    date(2026, 9, 15),  # Ganesh Chaturthi
    date(2026, 10, 2),  # Gandhi Jayanti
    date(2026, 10, 20), # Dussehra
    date(2026, 11, 8),  # Diwali
    date(2026, 11, 24), # Guru Nanak Jayanti
    date(2026, 12, 25), # Christmas
}


def is_trading_day(target_date: date) -> bool:
    """Return True if target_date is a valid NSE trading day (Mon-Fri and not holiday)."""
    if target_date.weekday() >= 5:
        return False
    if (target_date.month, target_date.day) in STANDARD_NSE_HOLIDAYS_MD:
        return False
    if target_date in NSE_VARIABLE_HOLIDAYS:
        return False
    return True


def get_previous_trading_day(target_date: date) -> date:
    """Return the NSE trading day immediately preceding target_date."""
    d = target_date - timedelta(days=1)
    while not is_trading_day(d):
        d -= timedelta(days=1)
    return d


class MarketDataError(RuntimeError):
    """Raised when a usable market price cannot be obtained."""


@dataclass(frozen=True)
class MarketQuote:
    symbol: str
    current_price: float
    previous_close: float | None
    session_open: float | None
    volume: int
    market_open: bool
    as_of: datetime


@dataclass(frozen=True)
class _CachedQuote:
    quote: MarketQuote
    fetched_at: datetime


_CACHE: dict[str, _CachedQuote] = {}
_CACHE_LOCK = Lock()


def now_ist() -> datetime:
    return datetime.now(IST)


def today_ist() -> date:
    return now_ist().date()


def _market_hours(now: datetime) -> bool:
    """Return whether the clock is inside the NSE regular session."""
    return now.weekday() < 5 and NSE_OPEN <= now.time() < NSE_CLOSE


def to_yahoo_symbol(symbol: str) -> str:
    return symbol if symbol == "^CNX100" else f"{symbol}.NS"


def _ticker_frame(df: pd.DataFrame, yahoo_symbol: str) -> pd.DataFrame:
    """Extract one ticker's OHLCV frame from yfinance's varying layouts."""
    if df is None or df.empty:
        return pd.DataFrame()

    if isinstance(df.columns, pd.MultiIndex):
        level0 = df.columns.get_level_values(0)
        if yahoo_symbol in level0:
            result = df[yahoo_symbol]
        else:
            level1 = df.columns.get_level_values(1)
            if yahoo_symbol in level1:
                result = df.xs(yahoo_symbol, axis=1, level=1)
            else:
                return pd.DataFrame()
    else:
        result = df

    # yfinance has used both title-case and lower-case names over time.
    result = result.copy()
    result.columns = [str(col).lower() for col in result.columns]
    return result


def _row_date_ist(value) -> date:
    ts = pd.Timestamp(value)
    if ts.tzinfo is not None:
        ts = ts.tz_convert(IST)
    return ts.date()


def _clean_ohlcv(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return df

    required = {"open", "close"}
    if not required.issubset(df.columns):
        return pd.DataFrame()

    cleaned = df.dropna(subset=["open", "close"]).copy()
    if cleaned.empty:
        return cleaned

    cleaned = cleaned.sort_index()
    cleaned["session_date"] = [_row_date_ist(v) for v in cleaned.index]
    return cleaned


def _download(tickers: list[str], *, period: str, interval: str) -> pd.DataFrame:
    # Import lazily so all non-live accounting/unit tests can run without the
    # optional network dependency being installed.
    try:
        import yfinance as yf
    except ImportError as exc:
        raise MarketDataError(
            "yfinance is required for live market prices; install it with "
            "'pip install yfinance'."
        ) from exc

    try:
        return yf.download(
            tickers=tickers,
            period=period,
            interval=interval,
            group_by="ticker",
            auto_adjust=False,
            prepost=False,
            threads=True,
            progress=False,
        )
    except Exception as exc:  # pragma: no cover - depends on network/provider
        raise MarketDataError(f"Yahoo Finance request failed: {exc}") from exc


def _fetch_uncached(symbols: list[str]) -> dict[str, MarketQuote]:
    if not symbols:
        return {}

    now = now_ist()
    today = now.date()
    yahoo_symbols = [to_yahoo_symbol(s) for s in symbols]

    intraday = _download(yahoo_symbols, period="1d", interval="1m")
    daily = _download(yahoo_symbols, period="10d", interval="1d")

    quotes: dict[str, MarketQuote] = {}

    for symbol, yahoo_symbol in zip(symbols, yahoo_symbols):
        intraday_df = _clean_ohlcv(_ticker_frame(intraday, yahoo_symbol))
        daily_df = _clean_ohlcv(_ticker_frame(daily, yahoo_symbol))

        intraday_today = intraday_df[
            intraday_df["session_date"] == today
        ] if not intraday_df.empty else pd.DataFrame()

        # The latest intraday close is the best live mark when today's
        # regular-session data is available.
        if not intraday_today.empty:
            latest_intraday = intraday_today.iloc[-1]
            current_price = float(latest_intraday["close"])
            session_open = float(intraday_today.iloc[0]["open"])
            if "volume" in intraday_today.columns:
                volume = int(
                    pd.to_numeric(
                        intraday_today["volume"], errors="coerce"
                    ).fillna(0).sum()
                )
            else:
                volume = 0
            live_data_available = True
            as_of = pd.Timestamp(intraday_today.index[-1]).to_pydatetime()
            if as_of.tzinfo is None:
                as_of = as_of.replace(tzinfo=IST)
            else:
                as_of = as_of.astimezone(IST)
        else:
            live_data_available = False
            if daily_df.empty:
                logger.warning("No market data returned for %s", symbol)
                continue

            latest_daily = daily_df.iloc[-1]
            current_price = float(latest_daily["close"])
            session_open = float(latest_daily["open"])
            volume = int(
                float(latest_daily["volume"])
            ) if "volume" in daily_df.columns and pd.notna(latest_daily["volume"]) else 0
            as_of = pd.Timestamp(daily_df.index[-1]).to_pydatetime()
            if as_of.tzinfo is None:
                as_of = as_of.replace(tzinfo=IST)
            else:
                as_of = as_of.astimezone(IST)

        previous_close: float | None = None
        if not daily_df.empty:
            if not intraday_today.empty:
                # We are marking today's live session, so the previous close
                # is the latest completed session strictly before today.
                previous_rows = daily_df[daily_df["session_date"] < today]
                if not previous_rows.empty:
                    previous_close = float(previous_rows.iloc[-1]["close"])
            else:
                # The latest price is the latest completed session, so the
                # previous close is the session immediately before it.
                latest_session_date = daily_df.iloc[-1]["session_date"]
                previous_rows = daily_df[
                    daily_df["session_date"] < latest_session_date
                ]
                if not previous_rows.empty:
                    previous_close = float(previous_rows.iloc[-1]["close"])

        market_open = (
            _market_hours(now)
            and live_data_available
            and not intraday_today.empty
        )

        quotes[symbol] = MarketQuote(
            symbol=symbol,
            current_price=current_price,
            previous_close=previous_close,
            session_open=session_open,
            volume=volume,
            market_open=market_open,
            as_of=as_of,
        )

    return quotes


def get_market_quotes(
    symbols: Iterable[str],
    *,
    cache_seconds: int = DEFAULT_CACHE_SECONDS,
) -> dict[str, MarketQuote]:
    """Return latest market quotes for the requested symbols."""
    unique_symbols = sorted(set(symbols))
    if not unique_symbols:
        return {}

    now = now_ist()
    uncached: list[str] = []
    result: dict[str, MarketQuote] = {}

    with _CACHE_LOCK:
        for symbol in unique_symbols:
            cached = _CACHE.get(symbol)
            if cached is None:
                uncached.append(symbol)
                continue
            age = (now - cached.fetched_at).total_seconds()
            if age > cache_seconds:
                uncached.append(symbol)
            else:
                result[symbol] = cached.quote

    if uncached:
        fresh = _fetch_uncached(uncached)
        fetched_at = now_ist()
        with _CACHE_LOCK:
            for symbol, quote in fresh.items():
                _CACHE[symbol] = _CachedQuote(quote=quote, fetched_at=fetched_at)
                result[symbol] = quote

    return result


def clear_market_quote_cache() -> None:
    """Useful in tests and after deliberate market-data refreshes."""
    with _CACHE_LOCK:
        _CACHE.clear()
