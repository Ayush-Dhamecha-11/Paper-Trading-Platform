"""
backend/api/routers/analytics.py

Backs frontend/src/pages/analytics.tsx via GET /api/analytics - the
frontend fetches this once, then switches between ranges client-side
using pre-computed performanceSeries for all 6 AnalyticsRangeKey values
("1W","1M","3M","6M","1Y","ALL"). Response shape matches
frontend/src/data/analyticsData.ts's `AnalyticsData` type field-for-field.

All computation logic lives in api/services/analytics_service.py - this
file only orchestrates: load portfolio -> load raw data -> call service
functions -> assemble the response.
"""

import logging
from datetime import date, timedelta

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from api.dependencies.auth import get_current_user
from api.dependencies.portfolio import get_or_create_portfolio
from api.schemas.analytics import (
    AnalyticsData, 
    TradingMetricOut,
    TimeSeriesPointOut,
    AllocationPointOut,
    StockRiskPointOut,
    MonthlyReturnOut
)
from api.services import analytics_helper as svc
from db.database import get_db
from db.models import Order

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["analytics"])


RANGE_KEYS = ["1W", "1M", "3M", "6M", "1Y", "ALL"]


# GET /api/analytics
@router.get("/analytics", response_model=AnalyticsData)
def get_analytics(
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    portfolio = get_or_create_portfolio(db, user["id"])

    snapshots = svc.load_snapshots(db, portfolio.id)

    if not snapshots.empty:
        bench_start = snapshots.index.min().date()
        bench_end = snapshots.index.max().date()
    else:
        bench_end = date.today()
        bench_start = bench_end - timedelta(days=365)
    benchmark = svc.load_benchmark(db, bench_start, bench_end)

    positions, meta, prices = svc.load_open_positions_with_meta(db, portfolio.id)

    orders = db.execute(
        select(Order).where(Order.portfolio_id == portfolio.id).order_by(Order.timestamp)
    ).scalars().all()
    trades = svc.match_trades_average_cost(orders)

    as_of = date.today()
    performance_series = {
        range_key: svc.build_performance_series(snapshots, benchmark, range_key, as_of)
        for range_key in RANGE_KEYS
    }

    allocation = svc.build_allocation_charts(positions, meta, prices)
    risk_by_stock = svc.build_risk_by_stock(db, positions)
    summary = svc.build_summary(portfolio, snapshots, benchmark, positions, prices)
    trading_metrics = svc.build_trading_metrics(trades)
    return_distribution = svc.build_return_distribution(trades)
    monthly_returns = svc.build_monthly_returns(snapshots)
    trade_pnl = [round(t["pnl"], 2) for t in trades]

    return AnalyticsData(
        summary=summary,
        tradingMetrics=trading_metrics,
        performanceSeries=performance_series,
        sectorAllocation=allocation["sectorAllocation"],
        stockAllocation=allocation["stockAllocation"],
        pnlByStock=allocation["pnlByStock"],
        returnDistribution=return_distribution,
        riskByStock=risk_by_stock,
        tradePnl=trade_pnl,
        monthlyReturns=monthly_returns,
    )