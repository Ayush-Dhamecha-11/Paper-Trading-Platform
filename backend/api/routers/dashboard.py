"""
Dashboard and market-stock endpoints.

All portfolio valuation comes from api.services.portfolio_accounting so the
Dashboard, Portfolio and Analytics endpoints cannot disagree about portfolio
value or P&L.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from api.dependencies.auth import get_current_user
from api.dependencies.portfolio import get_or_create_portfolio
from api.schemas.dashboard import (
    DashboardData,
    HoldingOut,
    StockOut,
)
from api.services.market_data import MarketDataError, get_market_quotes
from api.services.portfolio_accounting import build_portfolio_state
from db.database import get_db
from db.models import Portfolio, Position, UniverseStock

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["dashboard"])


@router.get("/stocks", response_model=list[StockOut])
def get_stocks(db: Session = Depends(get_db)):
    """Return the latest available market quote for every stock in the universe."""
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

    try:
        quotes = get_market_quotes(symbols)
    except MarketDataError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Failed to fetch current market data: {exc}",
        ) from exc

    out: list[StockOut] = []
    for stock in stocks:
        quote = quotes.get(stock.symbol)
        if quote is None:
            # Do not manufacture a price from an order's entry price or zero.
            logger.warning("Skipping %s: no usable market quote", stock.symbol)
            continue

        previous_close = quote.previous_close
        change_pct = (
            ((quote.current_price - previous_close) / previous_close) * 100
            if previous_close not in (None, 0)
            else 0.0
        )

        out.append(
            StockOut(
                ticker=stock.symbol,
                name=stock.name,
                sector=stock.sector or "Other",
                price=quote.current_price,
                changePct=change_pct,
                open=quote.session_open or quote.current_price,
                # During regular market hours `price` is the live/latest mark;
                # after close it is the latest completed session close.
                close=None if quote.market_open else quote.current_price,
                volume=quote.volume,
            )
        )

    return out


@router.get("/dashboard", response_model=DashboardData)
def get_dashboard(
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    portfolio = get_or_create_portfolio(db, current_user["id"])
    state = build_portfolio_state(db, portfolio)

    return DashboardData(
        totalPortfolioValue=float(round(state.portfolio_value, 2)),
        capitalBalance=float(round(state.cash_balance, 2)),
        accountEquity=float(round(state.account_equity, 2)),
        investedCapital=float(round(state.invested_capital, 2)),
        totalProfit=float(round(state.total_profit, 2)),
        todayPnL=float(round(state.today_pnl, 2)),
    )


def build_holding(db: Session, portfolio: Portfolio):
    state = build_portfolio_state(db, portfolio)
    holdings = [
        HoldingOut(
            ticker=position.symbol,
            name=position.symbol,
            price=float(round(position.current_price, 2)),
            quantity=float(position.quantity),
            profit=float(round(position.unrealized_pnl, 2)),
        )
        for position in state.positions
    ]
    return holdings, [], float(state.invested_capital), float(state.long_market_value)
