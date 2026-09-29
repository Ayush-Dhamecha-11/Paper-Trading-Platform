"""
backend/api/services/trade_service.py

Everything that changes money or shares goes through here
the router (api/routers/trade.py) only validates
the request shape and calls execute_batch().

SHORT SELLING: modelled on real SEBI cash-segment rules

  - Opening a short (SELL exceeding currently held quantity) locks
    INITIAL_MARGIN_RATE (20%) of the trade's value from cash_balance,
    The other 80% of "proceeds" is NOT credited as
    spendable cash - a short is a liability (shares owed back), not a
    sale you can spend the full proceeds of.
  - Every day, each open short is re-priced at that day's close. If the
    locked margin no longer covers MAINTENANCE_MARGIN_RATE (25%) of
    current exposure, the position is force-closed (bought back) at
    that day's close
  - Closing a short (BUY that covers an existing short position)
    realizes P&L as (entry_price - exit_price) * qty_covered - a short
    profits when price falls - and releases the proportional locked
    margin back to cash_balance.

BATCH SEMANTICS: a basket of orders is all-or-nothing. Every order is
validated against the portfolio's state as it would be AFTER every
earlier order in the same batch has applied (so basket-level netting
across a buy and a sell of different stocks works correctly), and the
whole batch commits or rolls back together in one DB transaction -
matches the frontend's "net required cash" framing, which assumes the
basket executes as a single unit.
"""

import logging
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from db.models import Order, OrderStatus, OrderType, Portfolio, Position, PriceHistory

logger = logging.getLogger(__name__)

INITIAL_MARGIN_RATE = 0.20      # SEBI cash-segment minimum upfront margin (VaR+ELM)
MAINTENANCE_MARGIN_RATE = 0.25  # common broker maintenance buffer above the regulatory floor

# Smallest absolute quantity a position can sit at before we just treat
# it as flat and delete the row - avoids leaving 1e-9-share dust
# positions around from floating point rounding.
QUANTITY_EPSILON = 1e-6


class TradeError(Exception):
    """Raised for any order/batch that cannot be executed as requested.
    The router catches this and returns it as the HTTP error body -
    kept as plain text messages since TradeModal.tsx just surfaces
    response.text() directly to the user."""


@dataclass
class OrderRequest:
    symbol: str
    action: str
    quantity: float
    price: float

    def __post_init__(self):
        if self.action not in ("buy", "sell"):
            raise TradeError(f"Invalid action '{self.action}' for {self.symbol}")
        if self.quantity <= 0:
            raise TradeError(f"Quantity must be positive for {self.symbol}")

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


# Price lookup - the one and only source of truth for order pricing

def get_latest_prices(db: Session, symbols: list[str]) -> dict[str, float]:
    """Batch version of get_latest_price - one query instead of N, for
    pricing an entire basket at once."""
    if not symbols:
        return {}

    latest_date = db.execute(
        select(PriceHistory.day).order_by(PriceHistory.day.desc()).limit(1)
    ).scalar_one_or_none()
    if latest_date is None:
        return {}

    rows = db.execute(
        select(PriceHistory.symbol, PriceHistory.close)
        .where(PriceHistory.symbol.in_(symbols))
        .where(PriceHistory.day == latest_date)
    ).all()
    return {sym: float(close) for sym, close in rows}


@dataclass
class WorkingPosition:
    quantity: float
    avg_entry_price: float
    margin_locked: float


def apply_buy(
    working_positions: dict[str, WorkingPosition],
    cash: float,
    symbol: str,
    qty: float,
    price: float,
) -> tuple[dict[str, WorkingPosition], float]:
    pos = working_positions.get(symbol, WorkingPosition(0.0, 0.0, 0.0))

    if pos.quantity < 0:
        # Buying to cover an existing short (fully or partially).
        cover_qty = min(qty, -pos.quantity)
        pnl = (pos.avg_entry_price - price) * cover_qty  # short profits when price falls
        margin_released = pos.margin_locked * (cover_qty / -pos.quantity)

        cash += pnl + margin_released
        new_qty = pos.quantity + cover_qty
        new_margin = pos.margin_locked - margin_released

        remaining_buy_qty = qty - cover_qty
        if remaining_buy_qty > QUANTITY_EPSILON:
            # Order flips the position from short to long: the part
            # beyond what was needed to cover starts a fresh long at
            # this order's price.
            cash -= remaining_buy_qty * price
            new_qty = remaining_buy_qty
            pos = WorkingPosition(new_qty, price, 0.0)
        else:
            pos = WorkingPosition(new_qty, pos.avg_entry_price, new_margin)

    else:
        # Ordinary long buy (new or adding to an existing long) -
        # weighted-average cost basis, same as portfolio/engine.py's
        # position upsert logic.
        cost = qty * price
        if cash < cost:
            raise TradeError(
                f"Insufficient cash for {symbol}: need {cost:.2f}, have {cash:.2f}"
            )
        cash -= cost
        new_qty = pos.quantity + qty
        new_avg = (pos.avg_entry_price * pos.quantity + price * qty) / new_qty if new_qty > 0 else 0.0
        pos = WorkingPosition(new_qty, new_avg, pos.margin_locked)

    if abs(pos.quantity) < QUANTITY_EPSILON:
        working_positions.pop(symbol, None)
    else:
        working_positions[symbol] = pos

    return working_positions, cash


def apply_sell(
    working_positions: dict[str, WorkingPosition],
    cash: float,
    symbol: str,
    qty: float,
    price: float,
) -> tuple[dict[str, WorkingPosition], float]:
    pos = working_positions.get(symbol, WorkingPosition(0.0, 0.0, 0.0))

    if pos.quantity > 0:
        # Selling out of an existing long (fully or partially).
        sell_qty = min(qty, pos.quantity)
        proceeds = sell_qty * price
        cash += proceeds
        new_qty = pos.quantity - sell_qty

        remaining_sell_qty = qty - sell_qty
        if remaining_sell_qty > QUANTITY_EPSILON:
            # Sells past what was held: the excess OPENS a new short at
            # this order's price - matches TradeModal's short-sell
            # warning UI, which allows exactly this.
            trade_value = remaining_sell_qty * price
            margin_needed = trade_value * INITIAL_MARGIN_RATE
            if cash < margin_needed:
                raise TradeError(
                    f"Insufficient margin to short {symbol}: need "
                    f"{margin_needed:.2f} margin, have {cash:.2f} cash available"
                )
            cash -= margin_needed
            pos = WorkingPosition(-remaining_sell_qty, price, margin_needed)
        else:
            pos = WorkingPosition(new_qty, pos.avg_entry_price, pos.margin_locked)

    else:
        # Adding to an existing short, or opening a fresh one.
        trade_value = qty * price
        margin_needed = trade_value * INITIAL_MARGIN_RATE
        if cash < margin_needed:
            raise TradeError(
                f"Insufficient margin to short {symbol}: need "
                f"{margin_needed:.2f} margin, have {cash:.2f} cash available"
            )
        cash -= margin_needed
        new_qty = pos.quantity - qty  # more negative
        # Weighted-average entry price across the combined short size.
        new_avg = (
            (pos.avg_entry_price * -pos.quantity + price * qty) / -new_qty
        ) if new_qty != 0 else 0.0
        pos = WorkingPosition(new_qty, new_avg, pos.margin_locked + margin_needed)

    if abs(pos.quantity) < QUANTITY_EPSILON:
        working_positions.pop(symbol, None)
    else:
        working_positions[symbol] = pos

    return working_positions, cash



# Batch execution - the main entrypoint
def execute_batch(db: Session, portfolio: Portfolio, requests: list[OrderRequest]) -> BatchResult:
    if not requests:
        raise TradeError("No orders submitted")

    symbols = list({r.symbol for r in requests})
    prices = {r.symbol: r.price for r in requests}

    missing = [s for s in symbols if s not in prices]
    if missing:
        raise TradeError(f"No current price available for: {', '.join(missing)}")

    existing_positions = db.execute(
        select(Position).where(Position.user_id == portfolio.user_id).where(Position.symbol.in_(symbols))
    ).scalars().all()

    working_positions: dict[str, WorkingPosition] = {
        p.symbol: WorkingPosition(float(p.quantity), float(p.avg_entry_price), float(p.margin_locked))
        for p in existing_positions
    }
    cash = float(portfolio.cash_balance)

    results: list[OrderResult] = []

    # Validate + apply the whole batch against working state first - if
    # ANY order fails, we raise before touching the DB at all, so a bad
    # 3rd order in a 5-order basket can't partially execute the first 2.
    for req in requests:
        price = prices[req.symbol]

        if req.action == "buy":
            working_positions, cash = apply_buy(working_positions, cash, req.symbol, req.quantity, price)
        else:
            working_positions, cash = apply_sell(working_positions, cash, req.symbol, req.quantity, price)

        results.append(OrderResult(symbol=req.symbol, action=req.action, quantity=req.quantity, price=price))

    # Working state validated cleanly - now persist everything in one
    # go: upsert positions, delete flattened ones, write the Order log,
    # update cash_balance. All within the caller's existing db session/
    # transaction, so a failure anywhere here still rolls back as a unit.
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

    for res in results:
        db.add(
            Order(
                user_id=portfolio.user_id,
                symbol=res.symbol,
                quantity=res.quantity,
                price=res.price,
                order_type=OrderType.BUY.value if res.action == "buy" else OrderType.SELL.value,
                status=OrderStatus.FILLED.value,
            )
        )

    portfolio.cash_balance = cash

    db.commit()

    logger.info(
        f"Executed batch of {len(results)} order(s) for portfolio {portfolio.user_id}: "
        f"{[(r.symbol, r.action, r.quantity, r.price) for r in results]}"
    )

    return BatchResult(
        success=True,
        message=f"Executed {len(results)} order{'s' if len(results) != 1 else ''} successfully",
        orders=results,
    )


# Daily mark-to-market - called from jobs/daily_pipeline.py, not the API
def mark_to_market_all_shorts(db: Session, as_of: Optional[date] = None) -> int:
    """
    Runs once daily (see jobs/daily_pipeline.py). For every open short
    position across every portfolio, checks whether locked margin still
    covers MAINTENANCE_MARGIN_RATE of current exposure at today's close;
    force-closes (buys back) any that don't, exactly like a broker's
    automatic margin-call square-off.

    Returns the number of positions force-closed.
    """
    as_of = as_of or date.today()

    short_positions = db.execute(
        select(Position).where(Position.quantity < 0)
    ).scalars().all()

    if not short_positions:
        return 0

    symbols = list({p.symbol for p in short_positions})
    prices = get_latest_prices(db, symbols)

    force_closed_count = 0

    # Group by portfolio so each portfolio's cash_balance is only
    # touched once per portfolio, not once per position.
    by_portfolio: dict[int, list[Position]] = {}
    for p in short_positions:
        by_portfolio.setdefault(p.user_id, []).append(p)

    for portfolio_id, positions in by_portfolio.items():
        portfolio = db.get(Portfolio, portfolio_id)
        if portfolio is None:
            continue

        cash = float(portfolio.cash_balance)

        for pos in positions:
            price = prices.get(pos.symbol)
            if price is None:
                logger.warning(f"No price for {pos.symbol} on {as_of} - skipping margin check")
                continue

            qty_short = -float(pos.quantity)
            exposure = qty_short * price
            required_margin = exposure * MAINTENANCE_MARGIN_RATE

            if float(pos.margin_locked) >= required_margin:
                continue  # sufficiently margined, nothing to do

            pnl = (float(pos.avg_entry_price) - price) * qty_short
            cash += float(pos.margin_locked) + pnl

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
                f"Margin call: force-closed short {pos.symbol} in portfolio "
                f"{portfolio_id} at {price} (P&L={pnl:.2f}, as_of={as_of})"
            )

        portfolio.cash_balance = cash

    db.commit()
    return force_closed_count