"""
backend/api/routers/portfolio.py

"""

import logging
from datetime import date, timedelta
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from api.dependencies.auth import get_current_user
from api.dependencies.portfolio import get_or_create_portfolio
from api.schemas.portfolio import PortfolioData, AllocationPointOut, PortfolioHoldingOut, TimeSeriesPointOut, PortfolioSummaryOut
from api.services import analytics_helper as svc
from db.database import get_db
from db.models import UniverseStock

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["portfolio"])



# GET /api/portfolio
@router.get("/portfolio", response_model=PortfolioData)
def get_portfolio(db: Session = Depends(get_db), user=Depends(get_current_user)):

    user_id = user["id"]
    portfolio = get_or_create_portfolio(db, user_id)

    positions, meta, prices = svc.load_open_positions_with_meta(db, portfolio.user_id)
    prev_prices = load_prev_close(db, positions)

    snapshots = svc.load_snapshots(db, portfolio.user_id)

    if not snapshots.empty:
        bench_start = snapshots.index.min().date()
        bench_end = snapshots.index.max().date()
    else:
        bench_end = date.today()
        bench_start = bench_end - timedelta(days=365)

    benchmark = svc.load_benchmark(db, bench_start, bench_end)

    summary = build_summary(portfolio, snapshots, benchmark, positions, prices)
    performance_series = build_flat_performance_series(snapshots, benchmark)
    allocation = svc.build_allocation_charts(positions, meta, prices)
    holdings = build_holding_details(positions, meta, prices, prev_prices)

    return PortfolioData(
        summary=summary,
        performanceSeries=performance_series,
        sectorAllocation=[AllocationPointOut(**a) for a in allocation["sectorAllocation"]],
        holdings=holdings,
    )


# Helpers specific to this page
def load_prev_close(db: Session, positions) -> dict[str, float]:
    """
    Previous trading day's close per held symbol, for the holdings
    table's "Last price" column and day-change calculation. Separate
    from svc.load_open_positions_with_meta, which only loads the LATEST
    close - this page needs both latest and previous.
    """

    if not positions:
        return {}

    from sqlalchemy import select
    from db.models import PriceHistory

    symbols = [p.symbol for p in positions]

    latest_date = db.execute(
        select(PriceHistory.day).order_by(PriceHistory.day.desc()).limit(1)
    ).scalar_one_or_none()
    if latest_date is None:
        return {}

    prev_date = db.execute(
        select(PriceHistory.day)
        .where(PriceHistory.day < latest_date)
        .order_by(PriceHistory.day.desc())
        .limit(1)
    ).scalar_one_or_none()
    if prev_date is None:
        return {}

    rows = db.execute(
        select(PriceHistory.symbol, PriceHistory.close)
        .where(PriceHistory.symbol.in_(symbols))
        .where(PriceHistory.day == prev_date)
    ).all()
    return {sym: float(close) for sym, close in rows}


def build_summary(portfolio, snapshots, benchmark, positions, prices) -> PortfolioSummaryOut:
    """
    Same underlying numbers as analytics_service.build_summary, but
    PortfolioSummaryOut has fewer fields (no alpha/sharpe/maxDrawdown -
    those stay analytics-only) - so this reshapes rather than reusing
    that function directly.
    """

    market_value = sum(
        float(p.quantity) * prices.get(p.symbol, float(p.avg_entry_price)) for p in positions
    )
    portfolio_value = float(portfolio.cash_balance) + market_value

    invested_capital = sum(float(p.quantity) * float(p.avg_entry_price) for p in positions)
    total_profit = market_value - invested_capital

    total_return_pct = 0.0
    if float(portfolio.initial_capital) > 0:
        total_return_pct = (
            (portfolio_value - float(portfolio.initial_capital))
            / float(portfolio.initial_capital)
            * 100
        )

    today_pnl = 0.0
    if len(snapshots) >= 2:
        today_pnl = float(snapshots["portfolio_value"].iloc[-1] - snapshots["portfolio_value"].iloc[-2])

    return PortfolioSummaryOut(
        portfolioValue=round(portfolio_value, 2),
        investedCapital=round(invested_capital, 2),
        totalProfit=round(total_profit, 2),
        todayPnL=round(today_pnl, 2),
        totalReturnPct=round(total_return_pct, 2),
    )


def build_flat_performance_series(snapshots, benchmark) -> list[TimeSeriesPointOut]:
    """
    portfolio.tsx wants ONE series (no range selector on this page,
    unlike Analytics), rebased to 100 at the start of all available
    history. Reuses svc.build_performance_series with range_key="ALL".
    """

    points = svc.build_performance_series(snapshots, benchmark, "ALL", date.today())
    return [
        TimeSeriesPointOut(
            label=p["label"], portfolio=p["portfolio"], benchmark=p["benchmark"], pnl=p["pnl"]
        )
        for p in points
    ]


def build_holding_details(positions, meta, prices, prev_prices) -> list[PortfolioHoldingOut]:
    """
    Per-position detail for the Portfolio page's holdings table -
    includes averagePrice/previousClose, which the dashboard's simpler
    holdings view (removed from dashboard.tsx) never needed. All P/L,
    day-change, and filtering math is computed client-side in
    portfolio.tsx from these raw fields - this endpoint only supplies
    the inputs, not derived values.
    """
    
    holdings = []
    for pos in positions:
        symbol = pos.symbol
        stock_meta = meta.get(symbol)
        current_price = prices.get(symbol, float(pos.avg_entry_price))
        previous_close = prev_prices.get(symbol, current_price)

        holdings.append(
            PortfolioHoldingOut(
                ticker=symbol,
                name=stock_meta.name if stock_meta else symbol,
                sector=(stock_meta.sector if stock_meta else None) or "Other",
                quantity=float(pos.quantity),
                averagePrice=float(pos.avg_entry_price),
                currentPrice=current_price,
                previousClose=previous_close,
            )
        )

    return holdings