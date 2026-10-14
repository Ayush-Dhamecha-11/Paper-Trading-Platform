import logging
from typing import List

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from api.dependencies.auth import get_current_user
from api.dependencies.portfolio import get_or_create_portfolio
from api.schemas.strategy import TradeSuggestionOut
from api.services.market_data import MarketDataError, today_ist
from api.services.portfolio_accounting import (
    _ist_day_bounds,
    build_portfolio_state,
    get_position_quotes,
)
from db.database import get_db
from db.models import ModelPrediction, Order, Position, UniverseStock

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["strategy"])


@router.get("/strategy/suggestions", response_model=List[TradeSuggestionOut])
def get_strategy_suggestions(
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """
    Returns trade suggestions for the authenticated user based on latest model predictions.

    If the user has already executed predicted orders today (Order.predicted is True in today's date),
    returns those executed orders with status="executed" and executedAt set to the order timestamp.

    Otherwise, calculates the difference between latest model predictions and current portfolio
    holdings (target_quantity - current_quantity) and returns suggestions with status="pending".
    """
    user_id = user["id"]
    today = today_ist()
    start_utc, end_utc = _ist_day_bounds(today)

    # 1. Check if there are any predicted orders already executed today
    executed_orders = (
        db.execute(
            select(Order)
            .where(
                Order.user_id == user_id,
                Order.predicted.is_(True),
                Order.timestamp >= start_utc,
                Order.timestamp < end_utc,
            )
            .order_by(Order.timestamp.desc())
        )
        .scalars()
        .all()
    )

    universe_stocks = (
        db.execute(select(UniverseStock).order_by(UniverseStock.symbol.asc()))
        .scalars()
        .all()
    )
    stock_name_map = {s.symbol: s.name for s in universe_stocks}

    if executed_orders:
        return [
            TradeSuggestionOut(
                id=f"order_{order.symbol}_{int(order.timestamp.timestamp())}",
                ticker=order.symbol,
                name=stock_name_map.get(order.symbol, order.symbol),
                action="buy" if str(order.order_type).lower() == "buy" else "sell",
                quantity=float(order.quantity),
                price=float(order.price),
                status="executed",
                executedAt=order.timestamp.isoformat(),
            )
            for order in executed_orders
        ]

    # 2. If no predicted orders executed today, compute pending suggestions
    latest_pred = (
        db.execute(
            select(ModelPrediction)
            .order_by(ModelPrediction.as_of_date.desc())
            .limit(1)
        )
        .scalar_one_or_none()
    )

    if latest_pred is None or not latest_pred.weight_for_symbols:
        return []

    portfolio = get_or_create_portfolio(db, user_id)
    positions = (
        db.execute(select(Position).where(Position.user_id == user_id))
        .scalars()
        .all()
    )
    current_qty_by_symbol = {p.symbol: float(p.quantity) for p in positions}

    raw_weights = [float(w) for w in latest_pred.weight_for_symbols]
    symbol_target_raw: dict[str, float] = {}
    for stock, w in zip(universe_stocks, raw_weights):
        symbol_target_raw[stock.symbol] = w

    # Determine whether raw_weights are fractional portfolio weights (e.g. 0.05, 0.15)
    # or direct target share counts (e.g. 10.0, 20.0).
    is_portfolio_weights = any(0.0 < abs(w) < 1.0 for w in raw_weights)

    active_symbols = sorted(
        set(
            [sym for sym, w in symbol_target_raw.items() if w != 0]
            + list(current_qty_by_symbol.keys())
        )
    )

    quotes = {}
    if active_symbols:
        try:
            quotes = get_position_quotes(db, active_symbols)
        except MarketDataError as exc:
            logger.warning("Could not fetch quotes for all active symbols: %s", exc)

    if is_portfolio_weights:
        try:
            portfolio_state = build_portfolio_state(
                db, portfolio, positions=positions, quotes=quotes
            )
            equity = float(portfolio_state.account_equity)
        except Exception as exc:
            logger.warning("Error calculating account equity: %s", exc)
            equity = float(portfolio.cash_balance)
    else:
        equity = 0.0

    suggestions: list[TradeSuggestionOut] = []

    for sym in active_symbols:
        quote = quotes.get(sym)
        current_price = float(quote.current_price) if quote else 0.0

        if is_portfolio_weights:
            weight = symbol_target_raw.get(sym, 0.0)
            if current_price > 0:
                target_qty = round((equity * weight) / current_price)
            else:
                target_qty = 0
        else:
            target_qty = round(symbol_target_raw.get(sym, 0.0))

        current_qty = current_qty_by_symbol.get(sym, 0.0)
        diff = target_qty - current_qty

        # Only suggest trades with positive quantity difference
        if round(abs(diff)) <= 0:
            continue

        trade_qty = float(abs(round(diff)))
        action = "buy" if diff > 0 else "sell"

        suggestions.append(
            TradeSuggestionOut(
                id=f"pending_{sym}_{latest_pred.as_of_date.isoformat()}",
                ticker=sym,
                name=stock_name_map.get(sym, sym),
                action=action,
                quantity=trade_qty,
                price=current_price,
                status="pending",
                executedAt=None,
            )
        )

    return suggestions
