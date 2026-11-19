from datetime import timedelta
import logging
from typing import List, Optional

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from api.dependencies.auth import get_current_user
from api.dependencies.portfolio import get_or_create_portfolio
from api.schemas.strategy import TradeSuggestionOut
from api.services.market_data import (
    MarketDataError,
    get_previous_trading_day,
    today_ist,
)
from api.services.portfolio_accounting import (
    _ist_day_bounds,
    build_portfolio_state,
    get_position_quotes,
)
from api.services.trade_service import calculate_self_financing_rebalance
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

    Otherwise, calculates self-financing target allocations:
    1. Conceptually liquidates portfolio to determine available capital (account_equity).
    2. Uses integer floor on target allocations to guarantee the portfolio is self-financing
       and cash never goes negative.
    3. Handles long positions and short selling in 1 net trade per stock.
    4. Orders suggestions so cash-releasing actions (sells of longs, covers of shorts) come first.
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

    # Fetch latest prediction from database to map weights for each symbol
    latest_pred = (
        db.execute(
            select(ModelPrediction)
            .order_by(ModelPrediction.as_of_date.desc())
            .limit(1)
        )
        .scalar_one_or_none()
    )

    # Validate prediction freshness: today's suggestions can ONLY use yesterday's / previous trading day's prediction.
    # For example, a prediction with as_of_date = 2026-11-17 can only be used for 2026-11-18 suggestions.
    # If today is 2026-11-19 and the 2026-11-18 prediction is not in the table, the backend returns empty suggestions ([]).
    prev_trading_day = get_previous_trading_day(today)
    valid_prediction_dates = {prev_trading_day, today - timedelta(days=1)}

    is_prediction_current = (
        latest_pred is not None
        and latest_pred.as_of_date in valid_prediction_dates
        and bool(latest_pred.weight_for_symbols)
    )

    symbol_target_raw: dict[str, float] = {}
    symbol_weights_pct: dict[str, float] = {}
    if is_prediction_current and latest_pred.weight_for_symbols:
        raw_weights = [float(w) for w in latest_pred.weight_for_symbols]
        for stock, w in zip(universe_stocks, raw_weights):
            symbol_target_raw[stock.symbol] = w
            symbol_weights_pct[stock.symbol] = round(w * 100, 2)

    if executed_orders:
        return [
            TradeSuggestionOut(
                id=f"order_{order.symbol}_{int(order.timestamp.timestamp())}",
                ticker=order.symbol,
                name=stock_name_map.get(order.symbol, order.symbol),
                action="buy" if str(order.order_type).lower() == "buy" else "sell",
                quantity=float(order.quantity),
                price=float(order.price),
                weight=symbol_weights_pct.get(order.symbol, 0.0),
                status="executed",
                executedAt=order.timestamp.isoformat(),
                is_executed=True,
                executed=True,
                predicted=True,
            )
            for order in executed_orders
        ]

    # 2. If no predicted orders executed today, compute pending suggestions.
    # If the latest prediction is not from yesterday / previous trading day, return 0 suggestions.
    if not is_prediction_current:
        return []

    portfolio = get_or_create_portfolio(db, user_id)
    positions = (
        db.execute(select(Position).where(Position.user_id == user_id))
        .scalars()
        .all()
    )
    current_qty_by_symbol = {p.symbol: float(p.quantity) for p in positions}

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

    prices = {
        sym: float(quotes[sym].current_price)
        for sym in active_symbols
        if sym in quotes and quotes[sym].current_price > 0
    }

    # Calculate self-financing rebalancing trades using integer floor and single-trade delta
    rebalance_trades = calculate_self_financing_rebalance(
        current_positions=current_qty_by_symbol,
        account_equity=equity,
        symbol_weights=symbol_target_raw,
        prices=prices,
        is_portfolio_weights=is_portfolio_weights,
    )

    suggestions: list[TradeSuggestionOut] = []
    for t in rebalance_trades:
        suggestions.append(
            TradeSuggestionOut(
                id=f"pending_{t.symbol}_{latest_pred.as_of_date.isoformat()}",
                ticker=t.symbol,
                name=stock_name_map.get(t.symbol, t.symbol),
                action=t.action,
                quantity=float(t.quantity),
                price=float(t.price),
                weight=symbol_weights_pct.get(t.symbol, 0.0),
                status="pending",
                executedAt=None,
                is_executed=False,
                executed=False,
                predicted=True,
            )
        )

    return suggestions

@router.get("/strategy/simulation")
def get_strategy_simulation(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    initial_capital: float = 1_000_000.0,
    model_name: Optional[str] = "attention_factor_longconv",
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """Alias for /api/simulation within the strategy router."""
    from api.routers.simulation import get_simulation

    return get_simulation(
        start_date=start_date,
        end_date=end_date,
        initial_capital=initial_capital,
        model_name=model_name,
        db=db,
    )

