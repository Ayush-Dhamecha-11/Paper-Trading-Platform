"""
Single source of truth for portfolio valuation and P&L.

Rules:

* Long position: market value = quantity * current price.
* Short position: it is a liability, so equity contribution is locked margin
  plus unrealized short P&L. The short-sale proceeds are never treated as
  spendable cash by this simulator.
* `portfolio_value` is holdings value only (long notional minus short notional).
  It never includes free cash/capital.
* `account_equity` is the marked value of the complete account, including
  cash and the simulator's short-margin accounting.
* Total P&L = current account equity - net external capital contributed.
* Today's P&L excludes today's deposits/withdrawals; only market/trading P&L
  remains. Historical account state is reconstructed from the trade and capital
  ledgers, not from the mutable current Position rows.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo
from decimal import Decimal
from typing import Mapping

from sqlalchemy import select
from sqlalchemy.orm import Session

from api.services.market_data import MarketDataError, MarketQuote, get_market_quotes, today_ist
from db.models import CapitalTransaction, Order, OrderStatus, OrderType, Portfolio, PortfolioSnapshot, Position, PriceHistory, UniverseStock

logger = logging.getLogger(__name__)

ZERO = Decimal("0")


@dataclass(frozen=True)
class MarkedPosition:
    symbol: str
    quantity: Decimal
    avg_entry_price: Decimal
    current_price: Decimal
    previous_close: Decimal
    margin_locked: Decimal
    market_value: Decimal
    gross_exposure: Decimal
    cost_basis: Decimal
    unrealized_pnl: Decimal
    day_pnl: Decimal


@dataclass(frozen=True)
class PortfolioState:
    cash_balance: Decimal
    invested_capital: Decimal
    long_market_value: Decimal
    holdings_value: Decimal
    gross_exposure: Decimal
    unrealized_pnl: Decimal
    portfolio_value: Decimal
    account_equity: Decimal
    net_contributed_capital: Decimal
    total_profit: Decimal
    today_pnl: Decimal
    positions: tuple[MarkedPosition, ...]


def D(value) -> Decimal:
    """Convert persisted/numeric values without introducing binary-float noise."""
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value))


def _is_finite_positive(value: Decimal) -> bool:
    return value.is_finite() and value > ZERO


def _validate_price(value: Decimal, symbol: str) -> Decimal:
    if not _is_finite_positive(value):
        raise MarketDataError(f"Invalid market price for {symbol}")
    return value


def _load_latest_db_quotes(
    db: Session,
    symbols: list[str],
    *,
    as_of: date | None = None,
) -> dict[str, tuple[float, float | None]]:
    """Return (latest_close, previous_close) per symbol from PriceHistory."""
    if not symbols:
        return {}

    stmt = select(PriceHistory.symbol, PriceHistory.day, PriceHistory.close).where(
        PriceHistory.symbol.in_(symbols)
    )
    if as_of is not None:
        stmt = stmt.where(PriceHistory.day <= as_of)
    stmt = stmt.order_by(PriceHistory.symbol, PriceHistory.day.desc())

    rows = db.execute(stmt).all()
    grouped: dict[str, list[tuple[date, float]]] = {}
    for symbol, day, close in rows:
        grouped.setdefault(symbol, []).append((day, float(close)))

    out: dict[str, tuple[float, float | None]] = {}
    for symbol, symbol_rows in grouped.items():
        if not symbol_rows:
            continue
        latest_day, latest_close = symbol_rows[0]
        previous_close = None
        for day, close in symbol_rows[1:]:
            if day < latest_day:
                previous_close = close
                break
        out[symbol] = (latest_close, previous_close)
    return out


def get_position_quotes(db: Session, symbols: list[str]) -> dict[str, MarketQuote]:
    """
    Get live/latest quotes with DB EOD fallback.

    We never fall back to the position's entry price. That would manufacture
    zero P&L when live market data is unavailable.
    """
    unique_symbols = sorted(set(symbols))
    if not unique_symbols:
        return {}

    db_fallback = _load_latest_db_quotes(db, unique_symbols)

    try:
        live_quotes = get_market_quotes(unique_symbols)
    except MarketDataError as exc:
        logger.warning("Live market data unavailable; using PriceHistory fallback: %s", exc)
        live_quotes = {}

    out: dict[str, MarketQuote] = {}
    for symbol in unique_symbols:
        live = live_quotes.get(symbol)
        fallback = db_fallback.get(symbol)

        if live is not None:
            current_price = live.current_price
            previous_close = live.previous_close
            if previous_close is None and fallback is not None:
                previous_close = fallback[1]
            out[symbol] = MarketQuote(
                symbol=symbol,
                current_price=current_price,
                previous_close=previous_close,
                session_open=live.session_open,
                volume=live.volume,
                market_open=live.market_open,
                as_of=live.as_of,
            )
            continue

        if fallback is not None:
            current_price, previous_close = fallback
            out[symbol] = MarketQuote(
                symbol=symbol,
                current_price=current_price,
                previous_close=previous_close,
                session_open=None,
                volume=0,
                market_open=False,
                as_of=datetime.now(timezone.utc),
            )

    missing = [symbol for symbol in unique_symbols if symbol not in out]
    if missing:
        raise MarketDataError(
            "No current or historical market price is available for: "
            + ", ".join(missing)
        )

    return out


def _position_mark(pos: Position, quote: MarketQuote) -> MarkedPosition:
    qty = D(pos.quantity)
    avg = D(pos.avg_entry_price)
    current = D(quote.current_price)
    previous = D(quote.previous_close if quote.previous_close is not None else quote.current_price)
    margin = D(pos.margin_locked)

    if qty > ZERO:
        market_value = qty * current
        gross_exposure = market_value
        cost_basis = qty * avg
        unrealized = (current - avg) * qty
        day_pnl = (current - previous) * qty
    else:
        short_qty = -qty
        # Signed holdings value: a short is a negative notional/liability.
        market_value = -short_qty * current
        gross_exposure = short_qty * current
        cost_basis = short_qty * avg
        unrealized = (avg - current) * short_qty
        day_pnl = (previous - current) * short_qty

    return MarkedPosition(
        symbol=pos.symbol,
        quantity=qty,
        avg_entry_price=avg,
        current_price=current,
        previous_close=previous,
        margin_locked=margin,
        market_value=market_value,
        gross_exposure=gross_exposure,
        cost_basis=cost_basis,
        unrealized_pnl=unrealized,
        day_pnl=day_pnl,
    )


def calculate_equity_from_positions(
    cash_balance: Decimal,
    positions: list[Position] | tuple[Position, ...] | dict[str, object],
    prices: dict[str, float | Decimal],
) -> Decimal:
    """Pure equity calculation used by live valuation and tests."""
    equity = D(cash_balance)
    iterable = positions.values() if isinstance(positions, dict) else positions

    for pos in iterable:
        qty = D(pos.quantity)
        price = D(prices[pos.symbol])
        avg = D(pos.avg_entry_price)
        margin = D(pos.margin_locked)

        if qty > ZERO:
            equity += qty * price
        elif qty < ZERO:
            short_qty = -qty
            equity += margin + (avg - price) * short_qty

    return equity


def _load_previous_trading_day(db: Session, as_of: date) -> date | None:
    return db.execute(
        select(PriceHistory.day)
        .where(PriceHistory.day < as_of)
        .order_by(PriceHistory.day.desc())
        .limit(1)
    ).scalar_one_or_none()


def _prices_for_exact_day(
    db: Session,
    symbols: list[str],
    target_day: date,
) -> dict[str, Decimal]:
    if not symbols:
        return {}

    rows = db.execute(
        select(PriceHistory.symbol, PriceHistory.close)
        .where(PriceHistory.symbol.in_(symbols))
        .where(PriceHistory.day == target_day)
    ).all()
    return {symbol: D(close) for symbol, close in rows}


def _prices_for_day_or_before(
    db: Session,
    symbols: list[str],
    target_day: date,
) -> dict[str, Decimal]:
    """Latest available close on or before a date, for live fallback only."""
    if not symbols:
        return {}

    rows = db.execute(
        select(PriceHistory.symbol, PriceHistory.day, PriceHistory.close)
        .where(PriceHistory.symbol.in_(symbols))
        .where(PriceHistory.day <= target_day)
        .order_by(PriceHistory.symbol, PriceHistory.day.desc())
    ).all()

    prices: dict[str, Decimal] = {}
    for symbol, _day, close in rows:
        if symbol not in prices:
            prices[symbol] = D(close)
    return prices


IST = ZoneInfo("Asia/Kolkata")


def _created_at_ist(value: datetime) -> datetime:
    """Normalize a DB timestamp to a timezone-aware IST datetime."""
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(IST)


def _ist_day_bounds(day: date) -> tuple[datetime, datetime]:
    start = datetime.combine(day, time.min, tzinfo=IST)
    end = start + timedelta(days=1)
    return start.astimezone(timezone.utc), end.astimezone(timezone.utc)


def _capital_transactions(
    db: Session,
    user_id,
) -> list[CapitalTransaction]:
    return db.execute(
        select(CapitalTransaction)
        .where(CapitalTransaction.user_id == user_id)
        .order_by(CapitalTransaction.created_at)
    ).scalars().all()


def _net_contributed_capital(
    db: Session,
    portfolio: Portfolio,
    *,
    through_day: date | None = None,
) -> Decimal:
    transactions = _capital_transactions(db, portfolio.user_id)
    if transactions:
        total = ZERO
        for tx in transactions:
            if tx.created_at is None:
                continue
            if through_day is not None and _created_at_ist(tx.created_at).date() > through_day:
                continue
            total += D(tx.amount)
        return total

    # Compatibility fallback for portfolios created before the capital ledger.
    return D(portfolio.initial_capital)


def _net_capital_flow_for_day(db: Session, user_id, day: date) -> Decimal:
    start_utc, end_utc = _ist_day_bounds(day)
    rows = db.execute(
        select(CapitalTransaction.amount)
        .where(CapitalTransaction.user_id == user_id)
        .where(CapitalTransaction.created_at >= start_utc)
        .where(CapitalTransaction.created_at < end_utc)
    ).all()
    return sum((D(amount) for (amount,) in rows), ZERO)


def _holdings_value_from_working_state(
    working: Mapping[str, object],
    prices: Mapping[str, Decimal],
) -> Decimal:
    value = ZERO
    for symbol, pos in working.items():
        price = _validate_price(D(prices[symbol]), symbol)
        value += D(pos.quantity) * price
    return value


def _replay_orders_until(
    portfolio: Portfolio,
    orders: list[Order],
    *,
    through_day: date,
    capital_transactions: list[CapitalTransaction] | None = None,
) -> tuple[dict[str, object], Decimal]:
    """Replay capital and trade events chronologically to reconstruct a day."""
    from api.services.trade_service import WorkingPosition, apply_buy, apply_sell

    working: dict[str, WorkingPosition] = {}
    events: list[tuple[datetime, int, str, object]] = []

    if capital_transactions is None:
        capital_transactions = []

    for tx in capital_transactions:
        if tx.created_at is None or _created_at_ist(tx.created_at).date() > through_day:
            continue
        # Capital changes are applied before a trade at the exact same timestamp.
        events.append((_created_at_ist(tx.created_at), 0, "capital", tx))

    for order in orders:
        if order.timestamp is None or _created_at_ist(order.timestamp).date() > through_day:
            continue
        if order.status not in (
            OrderStatus.FILLED.value,
            OrderStatus.FORCE_CLOSED.value,
            OrderStatus.FILLED,
            OrderStatus.FORCE_CLOSED,
        ):
            continue
        events.append((_created_at_ist(order.timestamp), 1, "order", order))

    # Legacy compatibility when no ledger exists yet.
    cash = ZERO if capital_transactions else D(portfolio.initial_capital)

    events.sort(key=lambda item: (item[0], item[1]))

    for _timestamp, _priority, event_type, event in events:
        if event_type == "capital":
            cash += D(event.amount)
            continue

        order = event
        if order.order_type in (OrderType.BUY.value, OrderType.BUY):
            working, cash = apply_buy(
                working,
                cash,
                order.symbol,
                D(order.quantity),
                D(order.price),
            )
        else:
            working, cash = apply_sell(
                working,
                cash,
                order.symbol,
                D(order.quantity),
                D(order.price),
            )

    return working, cash


def _equity_from_working_state(
    cash: Decimal,
    working: dict[str, object],
    prices: dict[str, Decimal],
) -> Decimal:
    equity = D(cash)
    for symbol, pos in working.items():
        if symbol not in prices:
            raise MarketDataError(f"Missing historical close for {symbol}")
        qty = D(pos.quantity)
        price = D(prices[symbol])
        avg = D(pos.avg_entry_price)
        margin = D(pos.margin_locked)
        if qty > ZERO:
            equity += qty * price
        elif qty < ZERO:
            equity += margin + (avg - price) * (-qty)
    return equity


def calculate_previous_close_equity(db: Session, portfolio: Portfolio, as_of: date) -> Decimal | None:
    previous_day = _load_previous_trading_day(db, as_of)
    if previous_day is None:
        return None

    orders = db.execute(
        select(Order)
        .where(Order.user_id == portfolio.user_id)
        .order_by(Order.timestamp)
    ).scalars().all()
    capital_transactions = _capital_transactions(db, portfolio.user_id)

    working, cash = _replay_orders_until(
        portfolio,
        orders,
        through_day=previous_day,
        capital_transactions=capital_transactions,
    )

    symbols = list(working.keys())
    prices = _prices_for_exact_day(db, symbols, previous_day)
    return _equity_from_working_state(cash, working, prices)


def build_portfolio_state(
    db: Session,
    portfolio: Portfolio,
    *,
    positions: list[Position] | None = None,
    quotes: dict[str, MarketQuote] | None = None,
) -> PortfolioState:
    if positions is None:
        positions = db.execute(
            select(Position).where(Position.user_id == portfolio.user_id)
        ).scalars().all()

    symbols = [p.symbol for p in positions]
    quotes = quotes if quotes is not None else get_position_quotes(db, symbols)

    marked = tuple(_position_mark(p, quotes[p.symbol]) for p in positions)

    cash = D(portfolio.cash_balance)
    invested_capital = sum(
        (m.cost_basis if m.quantity > ZERO else m.margin_locked)
        for m in marked
    )
    long_market_value = sum(
        m.market_value for m in marked if m.quantity > ZERO
    )
    holdings_value = sum((m.market_value for m in marked), ZERO)
    gross_exposure = sum(m.gross_exposure for m in marked)
    unrealized_pnl = sum((m.unrealized_pnl for m in marked), ZERO)

    account_equity = cash + long_market_value + sum(
        m.margin_locked + m.unrealized_pnl
        for m in marked
        if m.quantity < ZERO
    )

    net_contributed_capital = _net_contributed_capital(db, portfolio)
    total_profit = account_equity - net_contributed_capital

    current_day = today_ist()
    previous_close_equity = calculate_previous_close_equity(
        db,
        portfolio,
        current_day,
    )
    today_capital_flow = _net_capital_flow_for_day(
        db,
        portfolio.user_id,
        current_day,
    )
    if previous_close_equity is not None:
        # Deposits/withdrawals are not trading P&L.
        today_pnl = account_equity - previous_close_equity - today_capital_flow
    else:
        today_pnl = ZERO

    return PortfolioState(
        cash_balance=cash,
        invested_capital=invested_capital,
        long_market_value=long_market_value,
        holdings_value=holdings_value,
        gross_exposure=gross_exposure,
        unrealized_pnl=unrealized_pnl,
        portfolio_value=holdings_value,
        account_equity=account_equity,
        net_contributed_capital=net_contributed_capital,
        total_profit=total_profit,
        today_pnl=today_pnl,
        positions=marked,
    )


def _net_capital_flow_between_days(
    db: Session,
    user_id,
    previous_day: date,
    current_day: date,
) -> Decimal:
    """Net external capital movement after previous close through current day."""
    _prev_start, prev_end = _ist_day_bounds(previous_day)
    _current_start, current_end = _ist_day_bounds(current_day)
    rows = db.execute(
        select(CapitalTransaction.amount)
        .where(CapitalTransaction.user_id == user_id)
        .where(CapitalTransaction.created_at >= prev_end)
        .where(CapitalTransaction.created_at < current_end)
    ).all()
    return sum((D(amount) for (amount,) in rows), ZERO)



def write_daily_snapshots(db: Session, as_of: date) -> int:
    """
    Create/update one end-of-day snapshot per portfolio.

    Historical holdings are reconstructed from the immutable Order ledger;
    current Position rows are intentionally not used because they cannot tell
    us what a portfolio held on an earlier day.
    """
    portfolios = db.execute(select(Portfolio)).scalars().all()
    if not portfolios:
        return 0

    written = 0

    for portfolio in portfolios:
        orders = db.execute(
            select(Order)
            .where(Order.user_id == portfolio.user_id)
            .order_by(Order.timestamp)
        ).scalars().all()

        capital_transactions = _capital_transactions(db, portfolio.user_id)
        working, cash = _replay_orders_until(
            portfolio,
            orders,
            through_day=as_of,
            capital_transactions=capital_transactions,
        )
        symbols = list(working.keys())
        prices = _prices_for_exact_day(db, symbols, as_of)

        if any(symbol not in prices for symbol in symbols):
            missing = [symbol for symbol in symbols if symbol not in prices]
            logger.warning(
                "Skipping snapshot for portfolio %s: missing close(s) %s",
                portfolio.user_id,
                missing,
            )
            continue

        equity = _equity_from_working_state(cash, working, prices)
        holdings_value = _holdings_value_from_working_state(working, prices)
        net_contributed_capital = _net_contributed_capital(
            db, portfolio, through_day=as_of
        )

        previous_snapshot = db.execute(
            select(PortfolioSnapshot)
            .where(PortfolioSnapshot.user_id == portfolio.user_id)
            .where(PortfolioSnapshot.day < as_of)
            .order_by(PortfolioSnapshot.day.desc())
            .limit(1)
        ).scalar_one_or_none()

        if previous_snapshot is not None and D(previous_snapshot.account_equity) != ZERO:
            capital_flow = _net_capital_flow_between_days(
                db,
                portfolio.user_id,
                previous_snapshot.day,
                as_of,
            )
            daily_return = (
                (equity - capital_flow) / D(previous_snapshot.account_equity)
                - Decimal("1")
            )
        else:
            daily_return = ZERO

        cumulative_return = (
            (equity - net_contributed_capital) / net_contributed_capital
            if net_contributed_capital != ZERO
            else ZERO
        )

        existing = db.execute(
            select(PortfolioSnapshot)
            .where(PortfolioSnapshot.user_id == portfolio.user_id)
            .where(PortfolioSnapshot.day == as_of)
        ).scalar_one_or_none()

        if existing is None:
            db.add(
                PortfolioSnapshot(
                    day=as_of,
                    user_id=portfolio.user_id,
                    portfolio_value=holdings_value,
                    account_equity=equity,
                    cash_balance=cash,
                    daily_return=daily_return,
                    cumulative_return=cumulative_return,
                )
            )
        else:
            existing.portfolio_value = holdings_value
            existing.account_equity = equity
            existing.cash_balance = cash
            existing.daily_return = daily_return
            existing.cumulative_return = cumulative_return

        # Keep the cache semantically correct at EOD. Live APIs still calculate
        # from current quotes and never trust this field as authoritative.
        portfolio.portfolio_value = holdings_value
        written += 1

    db.commit()
    return written


def rebuild_all_snapshots(db: Session, start_day: date, end_day: date) -> int:
    """One-time maintenance helper for correcting previously bad snapshots."""
    trading_days = db.execute(
        select(PriceHistory.day)
        .where(PriceHistory.day >= start_day)
        .where(PriceHistory.day <= end_day)
        .distinct()
        .order_by(PriceHistory.day)
    ).scalars().all()

    total = 0
    for trading_day in trading_days:
        total += write_daily_snapshots(db, trading_day)
    return total
