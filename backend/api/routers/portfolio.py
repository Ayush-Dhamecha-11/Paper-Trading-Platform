"""Portfolio endpoint with centralized live valuation/accounting."""

import logging
from datetime import date, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from api.dependencies.auth import get_current_user
from api.dependencies.portfolio import get_or_create_portfolio
from api.schemas.portfolio import (
    AllocationPointOut,
    PortfolioData,
    PortfolioHoldingOut,
    PortfolioSummaryOut,
    TimeSeriesPointOut,
)
from api.services import analytics_helper as svc
from api.services.market_data import today_ist
from api.services.portfolio_accounting import PortfolioState, build_portfolio_state
from db.database import get_db
from db.models import PortfolioSnapshot, UniverseStock

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["portfolio"])

SECTOR_COLORS = {
    "Technology": "#21d9a3",
    "IT": "#21d9a3",
    "Healthcare": "#34b3ff",
    "Pharma": "#34b3ff",
    "Finance": "#8b7cff",
    "Financial Services": "#8b7cff",
    "Banking": "#8b7cff",
    "Energy": "#fbbf24",
    "Consumer": "#ff7b72",
    "FMCG": "#ff7b72",
}
DEFAULT_SECTOR_COLOR = "#94a3b8"


@router.get("/portfolio", response_model=PortfolioData)
def get_portfolio(
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    portfolio = get_or_create_portfolio(db, user["id"])
    state = build_portfolio_state(db, portfolio)

    snapshots = svc.load_snapshots(db, portfolio.user_id)

    if not snapshots.empty:
        bench_start = snapshots.index.min().date()
        bench_end = snapshots.index.max().date()
    else:
        bench_end = today_ist()
        bench_start = bench_end - timedelta(days=365)

    benchmark = svc.load_benchmark(db, bench_start, bench_end)
    performance_series = build_flat_performance_series(snapshots, benchmark)

    meta = load_stock_meta(db, [p.symbol for p in state.positions])
    sector_allocation = build_sector_allocation(state, meta)
    holdings = build_holding_details(state, meta)
    summary = build_summary(portfolio, state)

    return PortfolioData(
        summary=summary,
        performanceSeries=performance_series,
        sectorAllocation=[AllocationPointOut(**item) for item in sector_allocation],
        holdings=holdings,
    )


def load_stock_meta(db: Session, symbols: list[str]) -> dict[str, UniverseStock]:
    if not symbols:
        return {}
    return {
        stock.symbol: stock
        for stock in db.execute(
            select(UniverseStock).where(UniverseStock.symbol.in_(symbols))
        ).scalars()
    }


def build_summary(portfolio, state: PortfolioState) -> PortfolioSummaryOut:
    contributed_capital = float(state.net_contributed_capital)
    total_return_pct = (
        float(state.total_profit) / contributed_capital * 100
        if contributed_capital > 0
        else 0.0
    )

    return PortfolioSummaryOut(
        portfolioValue=round(float(state.portfolio_value), 2),
        capitalBalance=round(float(state.cash_balance), 2),
        accountEquity=round(float(state.account_equity), 2),
        investedCapital=round(float(state.invested_capital), 2),
        totalProfit=round(float(state.total_profit), 2),
        todayPnL=round(float(state.today_pnl), 2),
        totalReturnPct=round(total_return_pct, 2),
    )


def build_flat_performance_series(snapshots, benchmark) -> list[TimeSeriesPointOut]:
    points = svc.build_performance_series(
        snapshots,
        benchmark,
        "ALL",
        today_ist(),
    )
    return [
        TimeSeriesPointOut(
            label=point["label"],
            portfolio=point["portfolio"],
            benchmark=point["benchmark"],
            pnl=point["pnl"],
        )
        for point in points
    ]


def build_sector_allocation(
    state: PortfolioState,
    meta: dict[str, UniverseStock],
) -> list[dict]:
    """
    Allocation is based on gross market exposure, so a short position is
    represented by its absolute notional rather than a negative percentage.
    Portfolio equity itself is handled separately in PortfolioState.
    """
    sector_exposure: dict[str, float] = {}
    total_exposure = 0.0

    for position in state.positions:
        stock = meta.get(position.symbol)
        sector = (stock.sector if stock else None) or "Other"
        exposure = float(position.gross_exposure)
        sector_exposure[sector] = sector_exposure.get(sector, 0.0) + exposure
        total_exposure += exposure

    if total_exposure <= 0:
        return []

    return [
        {
            "label": sector,
            "value": round(value / total_exposure * 100, 2),
            "color": SECTOR_COLORS.get(sector, DEFAULT_SECTOR_COLOR),
        }
        for sector, value in sorted(
            sector_exposure.items(),
            key=lambda item: -item[1],
        )
    ]


def build_holding_details(
    state: PortfolioState,
    meta: dict[str, UniverseStock],
) -> list[PortfolioHoldingOut]:
    holdings: list[PortfolioHoldingOut] = []

    for position in state.positions:
        stock = meta.get(position.symbol)
        holdings.append(
            PortfolioHoldingOut(
                ticker=position.symbol,
                name=stock.name if stock else position.symbol,
                sector=(stock.sector if stock else None) or "Other",
                quantity=float(position.quantity),
                averagePrice=round(float(position.avg_entry_price), 6),
                currentPrice=round(float(position.current_price), 6),
                previousClose=round(float(position.previous_close), 6),
                unrealizedPnL=round(float(position.unrealized_pnl), 2),
                dayPnL=round(float(position.day_pnl), 2),
                marketValue=round(
                    float(position.current_price * position.quantity),
                    2,
                ),
            )
        )

    return holdings
