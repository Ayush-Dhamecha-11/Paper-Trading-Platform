"""
For frontend/src/pages/dashboard.tsx.

Two endpoints:
    1. GET /api/stocks
        Powers StockTable ("Available Stocks"). Returns the full
        universe with today's price snapshot. Shape matches
        frontend/src/data/stocksData.ts's `Stock` type exactly:
        { ticker, name, sector, price, changePct, open, close, volume }.
        Note the frontend's `close` field is actually "yesterday's
        close" (changePct is computed as (price - close) / close) - we
        map today's close to `price` and yesterday's close to `close`
        to match that convention, not because the naming is intuitive.

    GET /api/dashboard
        Powers the summary cards, holdings table, sector-allocation
        donut, and performance line chart. Shape matches what
        DashboardPage currently hardcodes as `holdings`,
        `sectorAllocation`, and the summary card values - see
        DashboardData below for the exact contract.

Both auto-create an empty portfolio for first-time users
"""
import yfinance as yf
import logging
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Cookie
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session
from api.dependencies.auth import get_current_user
from api.routers.profile import get_session_from_cookies
from api.dependencies.portfolio import get_or_create_portfolio
from api.schemas.dashboard import StockOut, HoldingOut, SectorAllocationOut, PerformancePointOut, DashboardData
from db.database import get_db
from db.models import Portfolio, PortfolioSnapshot, Position, PriceHistory, UniverseStock

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["dashboard"])

# Colors for sector allocation - frontend expects a hex string per
SECTOR_COLORS = {
    "Technology": "#21d9a3", "IT": "#21d9a3",
    "Healthcare": "#34b3ff", "Pharma": "#34b3ff",
    "Finance": "#8b7cff", "Financial Services": "#8b7cff", "Banking": "#8b7cff",
    "Energy": "#fbbf24",
    "Consumer": "#ff7b72", "FMCG": "#ff7b72",
}
DEFAULT_SECTOR_COLOR = "#94a3b8"


# GET /api/stocks

@router.get("/stocks", response_model=list[StockOut])
def get_stocks(db: Session = Depends(get_db)):
    """
    Get current market data for all stocks in the universe.

    Database is used only for:
        - symbol
        - name
        - sector

    Yahoo Finance is used for:
        - current/latest price
        - today's open
        - previous trading day's close
        - today's volume
        - percentage change

    Intraday data is used so that while the market is open,
    the frontend receives the latest available market price.
    """

    # Get stock universe from database
    stocks = db.execute(
        select(
            UniverseStock.symbol,
            UniverseStock.name,
            UniverseStock.sector,
        )
    ).all()

    if not stocks:
        return []

    symbols = [stock.symbol for stock in stocks]

    yahoo_symbols = [
        f"{symbol}.NS" if symbol!='^CNX100' else symbol
        for symbol in symbols
    ]

    # Download today's intraday data
    try:
        intraday = yf.download(
            tickers=yahoo_symbols,
            period="1d",
            interval="1m",
            group_by="ticker",
            auto_adjust=False,
            prepost=False,
            threads=True,
            progress=False,
        )
    except Exception as e:
        raise HTTPException(
            status_code=502,
            detail=f"Failed to fetch current market data: {str(e)}",
        )

    # Download daily data for previous close
    try:
        daily = yf.download(
            tickers=yahoo_symbols,
            period="5d",
            interval="1d",
            group_by="ticker",
            auto_adjust=False,
            prepost=False,
            threads=True,
            progress=False,
        )
    except Exception as e:
        raise HTTPException(
            status_code=502,
            detail=f"Failed to fetch previous close data: {str(e)}",
        )

    # Construct response
    out = []

    india_time = datetime.now(ZoneInfo("Asia/Kolkata"))
    market_open = time(9, 15)
    market_close = time(15, 30)

    is_market_open = market_open <= india_time.time() < market_close

    for stock in stocks:

        symbol = stock.symbol
        yahoo_symbol = f"{symbol}.NS" if symbol != '^CNX100' else symbol

        try:
            # Intraday data for this stock
            if yahoo_symbol not in intraday.columns.get_level_values(0):
                continue

            intraday_df = intraday[yahoo_symbol].dropna(
                subset=["Open", "Close"]
            )

            if intraday_df.empty:
                continue

            # First candle of today's session
            first_candle = intraday_df.iloc[0]

            # Latest available candle
            latest_candle = intraday_df.iloc[-1]

            open_price = float(first_candle["Open"])

            current_price = float(latest_candle["Close"])

            volume = int(
                latest_candle["Volume"]
            ) if latest_candle["Volume"] == latest_candle["Volume"] else 0

            # Previous trading day's close
            if yahoo_symbol not in daily.columns.get_level_values(0):
                continue

            daily_df = daily[yahoo_symbol].dropna(
                subset=["Close"]
            )

            if len(daily_df) < 2:
                continue

            previous_close = float(
                daily_df["Close"].iloc[-2]
            )

            # Percentage change
            change_pct = (
                (current_price - previous_close)
                / previous_close
                * 100
                if previous_close
                else 0.0
            )

            # Build response

            out.append(
                StockOut(
                    ticker=symbol,
                    name=stock.name,
                    sector=stock.sector or "Other",
                    price=current_price,
                    changePct=change_pct,
                    open=open_price,
                    close=current_price if not is_market_open else None, 
                    volume=volume,
                )
            )

        except Exception:
            # Don't let one problematic ticker break
            # the entire endpoint.
            continue

    return out


# GET /api/dashboard

@router.get("/dashboard", response_model=DashboardData)
def get_dashboard(db: Session = Depends(get_db), 
    access_token: str | None = Cookie(default=None),
    refresh_token: str | None = Cookie(default=None)):

    user = get_session_from_cookies(
        access_token,
        refresh_token
    )
    print(f"User: {user}")  # Debugging line
    portfolio = get_or_create_portfolio(db, user.id)     

    holdings, sector_alloc, invested_capital, market_value = build_holding(db, portfolio)

    total_profit = market_value - invested_capital
    today_pnl = compute_today_pnl(db, portfolio)
    #performance = build_performance_series(db, portfolio)

    return DashboardData(
        totalPortfolioValue=portfolio.portfolio_value,
        investedCapital=invested_capital,
        totalProfit=total_profit,
        todayPnL=today_pnl,
    )


def build_holding(db: Session, portfolio: Portfolio):
    """
    Mark every open position to today's close, and roll up sector
    weights for the allocation donut. Returns (holdings, sector_alloc,
    invested_capital, market_value).
    """
    positions = db.execute(
        select(Position).where(Position.user_id == portfolio.user_id)
    ).scalars().all()

    if not positions:
        return [], [], 0.0, 0.0

    symbols = [p.symbol for p in positions]

    latest_date = db.execute(
        select(PriceHistory.day).order_by(PriceHistory.day.desc()).limit(1)
    ).scalar_one_or_none()

    latest_prices = {}
    if latest_date is not None:
        rows = db.execute(
            select(PriceHistory.symbol, PriceHistory.close)
            .where(PriceHistory.symbol.in_(symbols))
            .where(PriceHistory.day == latest_date)
        ).all()
        latest_prices = {sym: float(close) for sym, close in rows}

    stock_meta = {
        s.symbol: s
        for s in db.execute(
            select(UniverseStock).where(UniverseStock.symbol.in_(symbols))
        ).scalars()
    }

    holdings: list[HoldingOut] = []
    sector_value: dict[str, float] = {}
    invested_capital = 0.0
    market_value = 0.0

    for pos in positions:
        qty = float(pos.quantity)
        avg_price = float(pos.avg_entry_price)
        current_price = latest_prices.get(pos.symbol, avg_price)  # fall back to cost basis if no fresh price yet
        meta = stock_meta.get(pos.symbol)

        position_cost = qty * avg_price
        position_value = qty * current_price
        profit = position_value - position_cost

        invested_capital += position_cost
        market_value += position_value

        sector = (meta.sector if meta else None) or "Other"
        sector_value[sector] = sector_value.get(sector, 0.0) + position_value

        holdings.append(
            HoldingOut(
                ticker=pos.symbol,
                name=meta.name if meta else pos.symbol,
                price=current_price,
                quantity=qty,
                profit=profit,
            )
        )

    sector_alloc = []
    if market_value > 0:
        for sector, value in sorted(sector_value.items(), key=lambda kv: -kv[1]):
            sector_alloc.append(
                SectorAllocationOut(
                    name=sector,
                    value=round(value / market_value * 100, 2),
                    color=SECTOR_COLORS.get(sector, DEFAULT_SECTOR_COLOR),
                )
            )

    return holdings, sector_alloc, invested_capital, market_value


def compute_today_pnl(db: Session, portfolio: Portfolio) -> float:
    """
    Today's P&L = today's portfolio_value - yesterday's snapshot value.
    Requires PortfolioSnapshot rows, written once daily by the pipeline
    (see jobs/daily_pipeline.py - snapshot step not built yet). Returns
    0.0 until that exists, rather than raising, so the dashboard still
    renders.
    """
    latest_two = db.execute(
        select(PortfolioSnapshot)
        .where(PortfolioSnapshot.user_id == portfolio.user_id)
        .order_by(PortfolioSnapshot.day.desc())
        .limit(2)
    ).scalars().all()

    if len(latest_two) < 2:
        return 0.0

    today_snap, prev_snap = latest_two[0], latest_two[1]
    return float(today_snap.portfolio_value) - float(prev_snap.portfolio_value)


def build_performance_series(db: Session, portfolio: Portfolio) -> dict[str, list[PerformancePointOut]]:
    """
    30D/6M/1Y portfolio-value series from PortfolioSnapshot, for the
    "Profit over time" line chart. Empty lists until the snapshot step
    exists and has accumulated history - the chart just renders blank,
    not broken.
    """
    ranges = {"30D": 30, "6M": 182, "1Y": 365}
    today = date.today()

    result: dict[str, list[PerformancePointOut]] = {}
    for key, days in ranges.items():
        start = today - timedelta(days=days)
        rows = db.execute(
            select(PortfolioSnapshot)
            .where(PortfolioSnapshot.user_id == portfolio.user_id)
            .where(PortfolioSnapshot.day >= start)
            .order_by(PortfolioSnapshot.day)
        ).scalars().all()

        result[key] = [
            PerformancePointOut(label=r.day.strftime("%d %b"), value=float(r.portfolio_value))
            for r in rows
        ]

    return result