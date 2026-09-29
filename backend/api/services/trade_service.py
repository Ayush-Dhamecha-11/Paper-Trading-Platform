"""
Paper-trading execution and short-position accounting.

All money/share mutations go through this module.

Important accounting rules:

* API trade prices are NEVER trusted from the browser. Execution uses the
  latest market price obtained by the backend, unless an explicit
  `execution_prices` mapping is supplied by trusted internal code/tests.
* Long buys consume cash at execution price.
* Long sells add sale proceeds to cash and realize P&L against average cost.
* Opening/adding a short locks 20% initial margin and does not credit the
  short-sale proceeds to spendable cash.
* Covering a short releases proportional margin and realizes
  (entry - cover_price) * covered_quantity.
* Position average entry prices are recalculated with Decimal arithmetic.
* Batch execution is all-or-nothing and locks the portfolio/affected
  positions to prevent concurrent orders from overspending cash.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Mapping, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from api.services.market_data import MarketDataError, get_market_quotes, today_ist
from db.models import Order, OrderStatus, OrderType, Portfolio, Position, PriceHistory

logger = logging.getLogger(__name__)

INITIAL_MARGIN_RATE = Decimal("0.20")
MAINTENANCE_MARGIN_RATE = Decimal("0.25")
QUANTITY_EPSILON = Decimal("0.000001")
ZERO = Decimal("0")


class TradeError(Exception):
    """Raised when an order/batch cannot be executed."""


def D(value) -> Decimal:
    if isinstance(value, Decimal):
        return value
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError) as exc:
        raise TradeError(f"Invalid numeric value: {value!r}") from exc


@dataclass
class OrderRequest:
    symbol: str
    action: str
    quantity: float | Decimal
    # Kept for backward compatibility with older callers. This value is not
    # used by execute_batch for API execution.
    price: float | Decimal | None = None

    def __post_init__(self):
        self.symbol = self.symbol.strip().upper()
        self.action = self.action.strip().lower()
        if self.action not in ("buy", "sell"):
            raise TradeError(f"Invalid action '{self.action}' for {self.symbol}")
        qty = D(self.quantity)
        if not qty.is_finite() or qty <= ZERO:
            raise TradeError(f"Quantity must be positive for {self.symbol}")
        self.quantity = qty


@dataclass
class OrderResult:
    symbol: str
    action: str
    quantity: float
    price: float
    status: str = "filled"


@dataclass
class BatchResult:
    success: bool
    message: str
    orders: list[OrderResult] = field(default_factory=list)


@dataclass
class WorkingPosition:
    quantity: Decimal
    avg_entry_price: Decimal
    margin_locked: Decimal


def get_latest_prices(db: Session, symbols: list[str]) -> dict[str, float]:
    """Compatibility helper: return the latest backend market prices."""
    unique_symbols = sorted(set(symbols))
    if not unique_symbols:
        return {}

    try:
        quotes = get_market_quotes(unique_symbols)
    except MarketDataError as exc:
        logger.warning("Live market price lookup failed: %s", exc)
        return {}

    return {symbol: quote.current_price for symbol, quote in quotes.items()}


def calculate_capital_delta(
    current_cash: Decimal | float,
    target_cash: Decimal | float,
) -> tuple[Decimal, str]:
    """Return (delta, transaction_type) for a requested target cash balance."""
    current = D(current_cash)
    target = D(target_cash)
    if not current.is_finite() or current < ZERO:
        raise TradeError("Current cash balance is invalid")
    if not target.is_finite() or target < ZERO:
        raise TradeError("Target capital must be a finite non-negative amount")
    delta = target - current
    if delta > ZERO:
        return delta, "deposit"
    if delta < ZERO:
        return delta, "withdrawal"
    return ZERO, "none"


def _validate_price(price: Decimal, symbol: str) -> Decimal:
    if not price.is_finite() or price <= ZERO:
        raise TradeError(f"Invalid execution price for {symbol}")
    return price


def apply_buy(
    working_positions: dict[str, WorkingPosition],
    cash: Decimal,
    symbol: str,
    qty: Decimal | float,
    price: Decimal | float,
) -> tuple[dict[str, WorkingPosition], Decimal]:
    qty = D(qty)
    price = _validate_price(D(price), symbol)
    cash = D(cash)
    if qty <= ZERO:
        raise TradeError(f"Quantity must be positive for {symbol}")

    pos = working_positions.get(symbol, WorkingPosition(ZERO, ZERO, ZERO))

    if pos.quantity < ZERO:
        # Buy-to-cover an existing short.
        cover_qty = min(qty, -pos.quantity)
        pnl = (pos.avg_entry_price - price) * cover_qty
        margin_released = pos.margin_locked * (cover_qty / (-pos.quantity))

        cash += pnl + margin_released
        new_qty = pos.quantity + cover_qty
        new_margin = pos.margin_locked - margin_released

        remaining_buy_qty = qty - cover_qty
        if remaining_buy_qty > QUANTITY_EPSILON:
            # The excess crosses from short to long and starts a new long at
            # this order's execution price.
            cost = remaining_buy_qty * price
            if cash < cost:
                raise TradeError(
                    f"Insufficient cash for {symbol}: need {cost:.2f}, have {cash:.2f}"
                )
            cash -= cost
            pos = WorkingPosition(remaining_buy_qty, price, ZERO)
        else:
            pos = WorkingPosition(new_qty, pos.avg_entry_price, new_margin)

    else:
        cost = qty * price
        if cash < cost:
            raise TradeError(
                f"Insufficient cash for {symbol}: need {cost:.2f}, have {cash:.2f}"
            )
        cash -= cost
        new_qty = pos.quantity + qty
        new_avg = (
            ((pos.avg_entry_price * pos.quantity) + (price * qty)) / new_qty
            if new_qty > ZERO
            else ZERO
        )
        pos = WorkingPosition(new_qty, new_avg, pos.margin_locked)

    if abs(pos.quantity) < QUANTITY_EPSILON:
        working_positions.pop(symbol, None)
    else:
        working_positions[symbol] = pos

    return working_positions, cash


def apply_sell(
    working_positions: dict[str, WorkingPosition],
    cash: Decimal,
    symbol: str,
    qty: Decimal | float,
    price: Decimal | float,
) -> tuple[dict[str, WorkingPosition], Decimal]:
    qty = D(qty)
    price = _validate_price(D(price), symbol)
    cash = D(cash)
    if qty <= ZERO:
        raise TradeError(f"Quantity must be positive for {symbol}")

    pos = working_positions.get(symbol, WorkingPosition(ZERO, ZERO, ZERO))

    if pos.quantity > ZERO:
        # Sell an existing long first.
        sell_qty = min(qty, pos.quantity)
        proceeds = sell_qty * price
        cash += proceeds
        new_qty = pos.quantity - sell_qty

        remaining_sell_qty = qty - sell_qty
        if remaining_sell_qty > QUANTITY_EPSILON:
            # The excess opens a new short.
            trade_value = remaining_sell_qty * price
            margin_needed = trade_value * INITIAL_MARGIN_RATE
            if cash < margin_needed:
                raise TradeError(
                    f"Insufficient margin to short {symbol}: need "
                    f"{margin_needed:.2f}, have {cash:.2f} cash available"
                )
            cash -= margin_needed
            pos = WorkingPosition(-remaining_sell_qty, price, margin_needed)
        else:
            pos = WorkingPosition(new_qty, pos.avg_entry_price, pos.margin_locked)

    else:
        # Add to an existing short or open a fresh one.
        trade_value = qty * price
        margin_needed = trade_value * INITIAL_MARGIN_RATE
        if cash < margin_needed:
            raise TradeError(
                f"Insufficient margin to short {symbol}: need "
                f"{margin_needed:.2f}, have {cash:.2f} cash available"
            )
        cash -= margin_needed
        new_qty = pos.quantity - qty
        old_short_qty = -pos.quantity
        new_avg = (
            (pos.avg_entry_price * old_short_qty + price * qty) / (-new_qty)
            if new_qty != ZERO
            else ZERO
        )
        pos = WorkingPosition(
            new_qty,
            new_avg,
            pos.margin_locked + margin_needed,
        )

    if abs(pos.quantity) < QUANTITY_EPSILON:
        working_positions.pop(symbol, None)
    else:
        working_positions[symbol] = pos

    return working_positions, cash


def _equity_for_working_positions(
    cash: Decimal,
    working_positions: Mapping[str, WorkingPosition],
    prices: Mapping[str, Decimal],
) -> Decimal:
    """Mark a working state to a supplied price map."""
    equity = D(cash)
    for symbol, pos in working_positions.items():
        price = _validate_price(D(prices[symbol]), symbol)
        if pos.quantity > ZERO:
            equity += pos.quantity * price
        elif pos.quantity < ZERO:
            equity += pos.margin_locked + (pos.avg_entry_price - price) * (-pos.quantity)
    return equity


def _holdings_value_for_working_positions(
    working_positions: Mapping[str, WorkingPosition],
    prices: Mapping[str, Decimal],
) -> Decimal:
    """Return signed market value of holdings only; free cash is excluded."""
    value = ZERO
    for symbol, pos in working_positions.items():
        price = _validate_price(D(prices[symbol]), symbol)
        value += pos.quantity * price
    return value


def execute_batch(
    db: Session,
    portfolio: Portfolio,
    requests: list[OrderRequest],
    *,
    execution_prices: Mapping[str, Decimal | float] | None = None,
) -> BatchResult:
    if not requests:
        raise TradeError("No orders submitted")

    # Lock the account row so two concurrent requests cannot both spend the
    # same cash balance.
    locked_portfolio = db.execute(
        select(Portfolio)
        .where(Portfolio.user_id == portfolio.user_id)
        .with_for_update()
    ).scalar_one()
    portfolio = locked_portfolio

    symbols = sorted({request.symbol for request in requests})

    if execution_prices is None:
        try:
            live_quotes = get_market_quotes(symbols)
        except MarketDataError as exc:
            raise TradeError(f"Unable to obtain current market prices: {exc}") from exc
        prices = {
            symbol: D(live_quotes[symbol].current_price)
            for symbol in symbols
            if symbol in live_quotes
        }
    else:
        prices = {symbol: D(execution_prices[symbol]) for symbol in symbols if symbol in execution_prices}

    missing = [symbol for symbol in symbols if symbol not in prices]
    if missing:
        raise TradeError(
            "No current execution price is available for: " + ", ".join(missing)
        )

    existing_positions = db.execute(
        select(Position)
        .where(Position.user_id == portfolio.user_id)
        .where(Position.symbol.in_(symbols))
        .with_for_update()
    ).scalars().all()

    working_positions: dict[str, WorkingPosition] = {
        p.symbol: WorkingPosition(
            D(p.quantity),
            D(p.avg_entry_price),
            D(p.margin_locked),
        )
        for p in existing_positions
    }
    cash = D(portfolio.cash_balance)

    results: list[OrderResult] = []

    # First validate/apply the complete basket in memory. No DB mutation occurs
    # until every request succeeds.
    for req in requests:
        price = _validate_price(prices[req.symbol], req.symbol)
        if req.action == "buy":
            working_positions, cash = apply_buy(
                working_positions, cash, req.symbol, req.quantity, price
            )
        else:
            working_positions, cash = apply_sell(
                working_positions, cash, req.symbol, req.quantity, price
            )

        results.append(
            OrderResult(
                symbol=req.symbol,
                action=req.action,
                quantity=float(req.quantity),
                price=float(price),
            )
        )

    existing_by_symbol = {p.symbol: p for p in existing_positions}

    for symbol in symbols:
        working = working_positions.get(symbol)
        existing = existing_by_symbol.get(symbol)

        if working is None:
            if existing is not None:
                db.delete(existing)
            continue

        if existing is not None:
            existing.quantity = working.quantity
            existing.avg_entry_price = working.avg_entry_price
            existing.margin_locked = working.margin_locked
        else:
            db.add(
                Position(
                    user_id=portfolio.user_id,
                    symbol=symbol,
                    quantity=working.quantity,
                    avg_entry_price=working.avg_entry_price,
                    margin_locked=working.margin_locked,
                )
            )

    for result in results:
        db.add(
            Order(
                user_id=portfolio.user_id,
                symbol=result.symbol,
                quantity=D(result.quantity),
                price=D(result.price),
                order_type=OrderType.BUY.value if result.action == "buy" else OrderType.SELL.value,
                status=OrderStatus.FILLED.value,
            )
        )

    portfolio.cash_balance = cash
    portfolio.portfolio_value = _holdings_value_for_working_positions(
        working_positions,
        prices,
    )

    db.commit()

    logger.info(
        "Executed batch of %s order(s) for portfolio %s: %s",
        len(results),
        portfolio.user_id,
        [(r.symbol, r.action, r.quantity, r.price) for r in results],
    )

    return BatchResult(
        success=True,
        message=f"Executed {len(results)} order{'s' if len(results) != 1 else ''} successfully",
        orders=results,
    )


def _historical_closing_prices(
    db: Session,
    symbols: list[str],
    as_of: date,
) -> dict[str, Decimal]:
    if not symbols:
        return {}

    rows = db.execute(
        select(PriceHistory.symbol, PriceHistory.close)
        .where(PriceHistory.symbol.in_(symbols))
        .where(PriceHistory.day == as_of)
    ).all()
    return {symbol: D(close) for symbol, close in rows}


def mark_to_market_all_shorts(db: Session, as_of: Optional[date] = None) -> int:
    """
    Apply the maintenance-margin rule using the requested day's EOD close.
    The old implementation used whatever date happened to be globally latest
    in PriceHistory, which could be a different day from `as_of`.
    """
    as_of = as_of or today_ist()

    short_positions = db.execute(
        select(Position)
        .where(Position.quantity < 0)
        .with_for_update()
    ).scalars().all()

    if not short_positions:
        return 0

    symbols = sorted({p.symbol for p in short_positions})
    prices = _historical_closing_prices(db, symbols, as_of)
    force_closed_count = 0

    by_portfolio: dict[object, list[Position]] = {}
    for position in short_positions:
        by_portfolio.setdefault(position.user_id, []).append(position)

    for portfolio_id, positions in by_portfolio.items():
        portfolio = db.execute(
            select(Portfolio)
            .where(Portfolio.user_id == portfolio_id)
            .with_for_update()
        ).scalar_one_or_none()
        if portfolio is None:
            continue

        cash = D(portfolio.cash_balance)

        for pos in positions:
            price = prices.get(pos.symbol)
            if price is None:
                logger.warning(
                    "No historical close for %s on/before %s; skipping margin check",
                    pos.symbol,
                    as_of,
                )
                continue

            qty_short = -D(pos.quantity)
            exposure = qty_short * price
            required_margin = exposure * MAINTENANCE_MARGIN_RATE

            if D(pos.margin_locked) >= required_margin:
                continue

            pnl = (D(pos.avg_entry_price) - price) * qty_short
            cash += D(pos.margin_locked) + pnl

            db.add(
                Order(
                    user_id=portfolio_id,
                    symbol=pos.symbol,
                    quantity=qty_short,
                    price=price,
                    order_type=OrderType.BUY.value,
                    status=OrderStatus.FORCE_CLOSED.value,
                )
            )
            db.delete(pos)
            force_closed_count += 1

            logger.warning(
                "Margin call: force-closed short %s in portfolio %s at %s "
                "(P&L=%s, as_of=%s)",
                pos.symbol,
                portfolio_id,
                price,
                pnl,
                as_of,
            )

        portfolio.cash_balance = cash

    db.commit()
    return force_closed_count
