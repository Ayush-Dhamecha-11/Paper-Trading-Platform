"""
Auto-Trade Cron Job and Rebalancing Engine.

Searches all users who have `auto_trade` enabled in `user_preferences`.
Calculates the delta between each user's current portfolio holdings and the latest
model prediction target portfolio.

Key Trading & Operational Rules:
1. Rebalancing Target: The final portfolio matches the predicted weights/quantities.
2. Capital Management:
   - Sells are always executed first to liquidate unwanted positions and release cash.
   - Buys only execute if the user has available cash capital.
   - If available capital is less than total desired buy costs, buy quantities are
     scaled and allocated strictly within available cash (never overdrafting).
3. Market Hours & Off-Market Days:
   - Trades ONLY execute after market opens during the NSE regular session (09:15 - 15:30 IST, Mon-Fri).
   - Execution is blocked on off-market days (weekends & official NSE trading holidays).
4. Restart & Sleep Catch-Up:
   - The execution date, time, and status are recorded in `auto_trade_executions`
     and `Order` (with `predicted=True`).
   - If the server was asleep, suspended, or shut down when market opened, it automatically
     executes pending trades on restart during market hours if not already executed today.
"""

from __future__ import annotations

import argparse
import logging
import math
import sys
import threading
import time as time_module
import uuid
from dataclasses import dataclass, field
from datetime import date, datetime, time, timezone
from decimal import Decimal
from typing import Mapping, Sequence
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

# Allow running as standalone script or imported module
try:
    from api.dependencies.portfolio import get_or_create_portfolio
    from api.services.market_data import (
        IST,
        NSE_CLOSE,
        NSE_OPEN,
        MarketDataError,
        MarketQuote,
        get_market_quotes,
        now_ist,
        today_ist,
    )
    from api.services.portfolio_accounting import (
        _ist_day_bounds,
        build_portfolio_state,
        get_position_quotes,
    )
    from api.services.trade_service import (
        D,
        OrderRequest,
        SelfFinancingTrade,
        TradeError,
        calculate_self_financing_rebalance,
        execute_batch,
    )
    from db.database import SessionLocal, engine
    from db.models import (
        AutoTradeExecution,
        ModelPrediction,
        Order,
        Portfolio,
        Position,
        UniverseStock,
        UserPreference,
    )
except ImportError:
    # Handle direct execution from backend directory
    import os
    backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if backend_dir not in sys.path:
        sys.path.insert(0, backend_dir)
    from api.dependencies.portfolio import get_or_create_portfolio
    from api.services.market_data import (
        IST,
        NSE_CLOSE,
        NSE_OPEN,
        MarketDataError,
        MarketQuote,
        get_market_quotes,
        now_ist,
        today_ist,
    )
    from api.services.portfolio_accounting import (
        _ist_day_bounds,
        build_portfolio_state,
        get_position_quotes,
    )
    from api.services.trade_service import (
        D,
        OrderRequest,
        SelfFinancingTrade,
        TradeError,
        calculate_self_financing_rebalance,
        execute_batch,
    )
    from db.database import SessionLocal, engine
    from db.models import (
        AutoTradeExecution,
        ModelPrediction,
        Order,
        Portfolio,
        Position,
        UniverseStock,
        UserPreference,
    )

logger = logging.getLogger("jobs.auto_trade_cron")

ZERO = Decimal("0")
INITIAL_MARGIN_RATE = Decimal("0.30")

# Known National / NSE Trading Holidays (Month, Day)
# Automatically recognized across years
STANDARD_NSE_HOLIDAYS_MD: set[tuple[int, int]] = {
    (1, 26),   # Republic Day
    (5, 1),    # Maharashtra Day / May Day
    (8, 15),   # Independence Day
    (10, 2),   # Gandhi Jayanti
    (12, 25),  # Christmas
}

# Variable holiday calendar for active trading years (GRCh/NSE observed)
NSE_VARIABLE_HOLIDAYS: set[date] = {
    # 2025
    date(2025, 2, 26),  # Mahashivratri
    date(2025, 3, 14),  # Holi
    date(2025, 3, 31),  # Id-Ul-Fitr
    date(2025, 4, 10),  # Mahavir Jayanti
    date(2025, 4, 14),  # Dr. Baba Saheb Ambedkar Jayanti
    date(2025, 4, 18),  # Good Friday
    date(2025, 6, 7),   # Bakri Id
    date(2025, 8, 27),  # Ganesh Chaturthi
    date(2025, 10, 2),  # Mahatma Gandhi Jayanti / Dussehra
    date(2025, 10, 21), # Diwali Laxmi Pujan
    date(2025, 10, 22), # Diwali Balipratipada
    date(2025, 11, 5),  # Gurunanak Jayanti
    # 2026
    date(2026, 1, 26),  # Republic Day
    date(2026, 2, 16),  # Mahashivratri
    date(2026, 3, 4),   # Holi
    date(2026, 3, 20),  # Id-Ul-Fitr
    date(2026, 4, 3),   # Good Friday
    date(2026, 4, 14),  # Ambedkar Jayanti
    date(2026, 5, 1),   # Maharashtra Day
    date(2026, 5, 27),  # Bakri Id
    date(2026, 8, 15),  # Independence Day
    date(2026, 9, 15),  # Ganesh Chaturthi
    date(2026, 10, 2),  # Gandhi Jayanti
    date(2026, 10, 20), # Dussehra
    date(2026, 11, 8),  # Diwali
    date(2026, 11, 24), # Guru Nanak Jayanti
    date(2026, 12, 25), # Christmas
}


@dataclass
class PlannedTrade:
    symbol: str
    action: str  # "buy" or "sell"
    quantity: Decimal
    price: Decimal
    cost: Decimal


@dataclass
class AutoTradeExecutionResult:
    user_id: uuid.UUID
    status: str
    orders_count: int
    executed_at: datetime
    message: str
    trades: list[PlannedTrade] = field(default_factory=list)


def ensure_auto_trade_tables() -> None:
    """Ensure the auto_trade_executions table is created in the database."""
    try:
        AutoTradeExecution.__table__.create(bind=engine, checkfirst=True)
    except Exception as exc:
        logger.debug("Table check: %s", exc)


def is_trading_day(target_date: date) -> bool:
    """Return True if target_date is a valid NSE trading day (Mon-Fri and not holiday)."""
    # 1. Weekends: Saturday (5) and Sunday (6) are off-market
    if target_date.weekday() >= 5:
        return False

    # 2. Fixed national holidays
    if (target_date.month, target_date.day) in STANDARD_NSE_HOLIDAYS_MD:
        return False

    # 3. Variable NSE holidays
    if target_date in NSE_VARIABLE_HOLIDAYS:
        return False

    return True


def is_market_open_now(now: datetime | None = None) -> tuple[bool, str]:
    """
    Check if the market is currently open for trade execution.

    Requirements:
    - Must be a trading day (Monday-Friday, not a holiday).
    - Must be after market open (NSE_OPEN = 09:15 IST).
    - Must be before market close (NSE_CLOSE = 15:30 IST).
    """
    if now is None:
        now = now_ist()

    current_date = now.date()
    current_time = now.time()

    if not is_trading_day(current_date):
        day_name = current_date.strftime("%A")
        return (
            False,
            f"Off-market day ({day_name}, {current_date}). Execution halted.",
        )

    if current_time < NSE_OPEN:
        return (
            False,
            f"Market has not opened yet. Current time {current_time.strftime('%H:%M:%S')} IST, opens at {NSE_OPEN.strftime('%H:%M')} IST.",
        )

    if current_time >= NSE_CLOSE:
        return (
            False,
            f"Market is closed for the day. Current time {current_time.strftime('%H:%M:%S')} IST, closed at {NSE_CLOSE.strftime('%H:%M')} IST.",
        )

    return (True, "Market is open.")


def has_user_executed_today(db: Session, user_id: uuid.UUID, today: date) -> tuple[bool, str]:
    """
    Check whether auto-trade has already executed for this user on the specified date.

    Checks:
    1. Orders table: Were any predicted orders executed today?
    2. AutoTradeExecution table: Is there a completed execution record for today?
    """
    start_utc, end_utc = _ist_day_bounds(today)

    # Check 1: Orders executed with predicted=True today
    executed_order = (
        db.execute(
            select(Order)
            .where(
                Order.user_id == user_id,
                Order.predicted.is_(True),
                Order.timestamp >= start_utc,
                Order.timestamp < end_utc,
            )
            .limit(1)
        )
        .scalars()
        .first()
    )
    if executed_order is not None:
        return (
            True,
            f"Predicted orders already executed at {executed_order.timestamp.isoformat()}",
        )

    # Check 2: AutoTradeExecution record
    try:
        exec_record = (
            db.execute(
                select(AutoTradeExecution)
                .where(
                    AutoTradeExecution.user_id == user_id,
                    AutoTradeExecution.execution_date == today,
                    AutoTradeExecution.status.in_(["success", "no_trades_needed"]),
                )
                .limit(1)
            )
            .scalars()
            .first()
        )
        if exec_record is not None:
            return (
                True,
                f"Auto-trade run already completed today (status: {exec_record.status}) at {exec_record.executed_at.isoformat()}",
            )
    except Exception as exc:
        logger.debug("Error checking AutoTradeExecution table: %s", exc)

    return (False, "Not executed yet today.")


def plan_auto_trade_orders(
    current_positions: Mapping[str, Decimal],
    cash_balance: Decimal,
    target_quantities: Mapping[str, Decimal | int],
    prices: Mapping[str, Decimal],
) -> list[PlannedTrade]:
    """
    Calculate and balance orders required to transition current portfolio to predicted portfolio.

    Capital Management Rules:
    1. Sells are executed first, crediting sale proceeds to cash.
    2. Buys only execute using available cash capital.
    3. If total desired buy expenditure exceeds available cash, buy quantities are
       proportionately scaled down and iteratively capped so total expenditure <= available cash.
    """
    cash = D(cash_balance)
    all_symbols = sorted(set(list(current_positions.keys()) + list(target_quantities.keys())))

    sells: list[PlannedTrade] = []
    desired_buys: list[tuple[str, Decimal, Decimal]] = []  # (symbol, qty, price)

    # Step 1: Compute diffs and separate sells vs desired buys
    for sym in all_symbols:
        curr_qty = D(current_positions.get(sym, ZERO))
        target_qty = D(target_quantities.get(sym, ZERO))
        diff = target_qty - curr_qty

        # Skip negligible differences (< 1 whole share)
        rounded_diff = round(diff)
        if rounded_diff == 0:
            print(
                f"  [PLAN AUTO-TRADE] {sym:<10} | Target: {float(target_qty):>6.2f} | Curr: {float(curr_qty):>6.2f} | "
                f"Diff: {float(diff):>+7.4f} -> SKIPPED (diff < 1 share, floored to 0)",
                flush=True,
            )
            continue

        price = D(prices.get(sym, ZERO))
        if price <= ZERO:
            logger.warning("No valid price for %s, skipping trade planning", sym)
            continue

        if rounded_diff < 0:
            sell_qty = Decimal(abs(rounded_diff))
            cost = sell_qty * price
            sells.append(
                PlannedTrade(
                    symbol=sym,
                    action="sell",
                    quantity=sell_qty,
                    price=price,
                    cost=cost,
                )
            )
        else:
            buy_qty = Decimal(rounded_diff)
            desired_buys.append((sym, buy_qty, price))

    # Step 2: Simulate cash impact of sells
    simulated_cash = cash
    for s in sells:
        curr = D(current_positions.get(s.symbol, ZERO))
        if curr > ZERO:
            # Selling an existing long credits proceeds to spendable cash
            long_closed = min(curr, s.quantity)
            simulated_cash += long_closed * s.price
            excess_short = s.quantity - long_closed
            if excess_short > ZERO:
                # Excess opens short and locks margin
                simulated_cash -= excess_short * s.price * INITIAL_MARGIN_RATE
        else:
            # Adding to or opening short locks margin
            simulated_cash -= s.quantity * s.price * INITIAL_MARGIN_RATE

    # Step 3: Capital management for buys
    buys: list[PlannedTrade] = []
    available_cash = simulated_cash

    if available_cash > ZERO and desired_buys:
        total_buy_cost = sum(qty * price for _, qty, price in desired_buys)

        if total_buy_cost <= available_cash:
            # Sufficient capital for all desired buys
            for sym, qty, price in desired_buys:
                buys.append(
                    PlannedTrade(
                        symbol=sym,
                        action="buy",
                        quantity=qty,
                        price=price,
                        cost=qty * price,
                    )
                )
        else:
            # Capital constraint: Scale down buys so we never exceed available cash
            logger.info(
                "Capital constrained: Need %.2f, have %.2f available. Scaling buy orders.",
                total_buy_cost,
                available_cash,
            )
            scale_ratio = available_cash / total_buy_cost

            # Allocate base whole shares proportionately
            scaled_buys: list[dict] = []
            spent = ZERO

            for sym, qty, price in desired_buys:
                # Target affordable quantity
                scaled_qty = Decimal(math.floor(float(qty * scale_ratio)))
                cost = scaled_qty * price
                spent += cost
                scaled_buys.append({
                    "symbol": sym,
                    "qty": scaled_qty,
                    "max_qty": qty,
                    "price": price,
                })

            # Greedily allocate remaining cash 1 share at a time where possible
            remaining_cash = available_cash - spent
            # Sort by highest unit price or shortfall to maximize capital usage
            scaled_buys.sort(key=lambda item: item["price"], reverse=True)

            for item in scaled_buys:
                if remaining_cash < item["price"]:
                    continue
                if item["qty"] < item["max_qty"]:
                    item["qty"] += Decimal("1")
                    remaining_cash -= item["price"]

            for item in scaled_buys:
                if item["qty"] > ZERO:
                    buys.append(
                        PlannedTrade(
                            symbol=item["symbol"],
                            action="buy",
                            quantity=item["qty"],
                            price=item["price"],
                            cost=item["qty"] * item["price"],
                        )
                    )
    elif desired_buys:
        logger.warning(
            "User has no available cash capital (%.2f) after sells; skipping all buy orders.",
            available_cash,
        )

    # Order trades strictly by self-financing execution priority:
    # 1. Long sells (adds proceeds to cash)
    # 2. Short covers (releases margin & P&L to cash)
    # 3. Long buys (consumes cash)
    # 4. Short sells (locks margin)
    long_sells = [s for s in sells if D(current_positions.get(s.symbol, ZERO)) > ZERO]
    short_sells = [s for s in sells if D(current_positions.get(s.symbol, ZERO)) <= ZERO]
    cover_buys = [b for b in buys if D(current_positions.get(b.symbol, ZERO)) < ZERO]
    long_buys = [b for b in buys if D(current_positions.get(b.symbol, ZERO)) >= ZERO]

    return long_sells + cover_buys + long_buys + short_sells


def execute_user_auto_trade(
    db: Session,
    user_id: uuid.UUID,
    today: date,
    universe_stocks: list[UniverseStock],
    latest_pred: ModelPrediction,
    quotes: dict[str, MarketQuote],
    dry_run: bool = False,
) -> AutoTradeExecutionResult:
    """
    Execute auto-trade for a single user to align their portfolio with latest prediction.
    """
    now = now_ist()

    # Verify not executed today
    already_done, reason = has_user_executed_today(db, user_id, today)
    if already_done:
        return AutoTradeExecutionResult(
            user_id=user_id,
            status="skipped",
            orders_count=0,
            executed_at=now,
            message=reason,
        )

    portfolio = get_or_create_portfolio(db, user_id)
    positions = (
        db.execute(select(Position).where(Position.user_id == user_id))
        .scalars()
        .all()
    )
    current_positions = {p.symbol: D(p.quantity) for p in positions}

    raw_weights = [float(w) for w in latest_pred.weight_for_symbols]
    symbol_target_raw: dict[str, float] = {}
    for stock, w in zip(universe_stocks, raw_weights):
        symbol_target_raw[stock.symbol] = w

    is_portfolio_weights = any(0.0 < abs(w) < 1.0 for w in raw_weights)

    if is_portfolio_weights:
        try:
            portfolio_state = build_portfolio_state(
                db, portfolio, positions=positions, quotes=quotes
            )
            equity = float(portfolio_state.account_equity)
        except Exception as exc:
            logger.warning("Error calculating account equity for %s: %s", user_id, exc)
            equity = float(portfolio.cash_balance)
    else:
        equity = 0.0

    prices: dict[str, Decimal] = {}
    for stock in universe_stocks:
        sym = stock.symbol
        quote = quotes.get(sym)
        prices[sym] = D(quote.current_price) if quote else ZERO

    # Calculate self-financing rebalance trades using integer floor and single-trade delta
    rebalance_trades = calculate_self_financing_rebalance(
        current_positions=current_positions,
        account_equity=equity,
        symbol_weights=symbol_target_raw,
        prices=prices,
        is_portfolio_weights=is_portfolio_weights,
    )

    planned_trades = [
        PlannedTrade(
            symbol=t.symbol,
            action=t.action,
            quantity=t.quantity,
            price=t.price,
            cost=t.quantity * t.price,
        )
        for t in rebalance_trades
    ]

    if not planned_trades:
        # Portfolio is already identical to predicted or no trades required
        if not dry_run:
            try:
                exec_log = AutoTradeExecution(
                    user_id=user_id,
                    execution_date=today,
                    executed_at=now,
                    status="no_trades_needed",
                    orders_count=0,
                    details={"message": "Portfolio already matches predicted portfolio"},
                )
                db.add(exec_log)
                db.commit()
            except Exception as exc:
                db.rollback()
                logger.warning("Could not log no_trades_needed: %s", exc)

        return AutoTradeExecutionResult(
            user_id=user_id,
            status="no_trades_needed",
            orders_count=0,
            executed_at=now,
            message="Portfolio already matches predicted target; no trades needed.",
        )

    if dry_run:
        return AutoTradeExecutionResult(
            user_id=user_id,
            status="dry_run",
            orders_count=len(planned_trades),
            executed_at=now,
            message=f"Dry run: {len(planned_trades)} orders planned",
            trades=planned_trades,
        )

    # Convert to OrderRequest list (predicted=True)
    requests = [
        OrderRequest(
            symbol=trade.symbol,
            action=trade.action,
            quantity=trade.quantity,
            predicted=True,
        )
        for trade in planned_trades
    ]

    try:
        batch_result = execute_batch(db, portfolio, requests)

        # Record execution timestamp in AutoTradeExecution audit table
        exec_log = AutoTradeExecution(
            user_id=user_id,
            execution_date=today,
            executed_at=now,
            status="success",
            orders_count=len(planned_trades),
            details={
                "orders": [
                    {
                        "symbol": t.symbol,
                        "action": t.action,
                        "quantity": float(t.quantity),
                        "price": float(t.price),
                    }
                    for t in planned_trades
                ],
                "message": batch_result.message,
            },
        )
        db.add(exec_log)
        db.commit()

        logger.info(
            "Auto-trade executed for user %s: %s orders placed.",
            user_id,
            len(planned_trades),
        )

        return AutoTradeExecutionResult(
            user_id=user_id,
            status="success",
            orders_count=len(planned_trades),
            executed_at=now,
            message=batch_result.message,
            trades=planned_trades,
        )

    except TradeError as exc:
        db.rollback()
        logger.error("TradeError during auto-trade for user %s: %s", user_id, exc)

        try:
            fail_log = AutoTradeExecution(
                user_id=user_id,
                execution_date=today,
                executed_at=now,
                status="failed",
                orders_count=0,
                details={"error": str(exc)},
            )
            db.add(fail_log)
            db.commit()
        except Exception:
            db.rollback()

        return AutoTradeExecutionResult(
            user_id=user_id,
            status="failed",
            orders_count=0,
            executed_at=now,
            message=f"Execution failed: {exc}",
        )
    except Exception as exc:
        db.rollback()
        logger.exception("Unexpected error executing auto-trade for %s: %s", user_id, exc)
        return AutoTradeExecutionResult(
            user_id=user_id,
            status="error",
            orders_count=0,
            executed_at=now,
            message=f"Unexpected error: {exc}",
        )


def run_auto_trade_job(
    db: Session | None = None,
    force: bool = False,
    dry_run: bool = False,
) -> dict:
    """
    Main entry point for the auto-trade cron job.

    1. Checks if market is open (unless force=True).
    2. Searches all users with auto_trade=True.
    3. Checks if each user has already executed today.
    4. Executes rebalancing trades for eligible users.
    5. Saves execution date, time, and audit log.
    """
    should_close_session = False
    if db is None:
        db = SessionLocal()
        should_close_session = True

    try:
        ensure_auto_trade_tables()

        now = now_ist()
        today = now.date()

        # Step 1: Check market hours & off-market days
        is_open, open_reason = is_market_open_now(now)
        if not is_open and not force:
            logger.info("Auto-trade cron skipped: %s", open_reason)
            return {
                "status": "skipped",
                "reason": open_reason,
                "timestamp": now.isoformat(),
                "users_processed": 0,
            }

        logger.info(
            "Auto-trade cron started at %s IST (force=%s, dry_run=%s)",
            now.strftime("%Y-%m-%d %H:%M:%S"),
            force,
            dry_run,
        )

        # Step 2: Query latest model prediction
        latest_pred = (
            db.execute(
                select(ModelPrediction)
                .order_by(ModelPrediction.as_of_date.desc())
                .limit(1)
            )
            .scalar_one_or_none()
        )

        if latest_pred is None or not latest_pred.weight_for_symbols:
            logger.warning("No model predictions available in database. Auto-trade halted.")
            return {
                "status": "aborted",
                "reason": "No model prediction found",
                "timestamp": now.isoformat(),
                "users_processed": 0,
            }

        universe_stocks = (
            db.execute(select(UniverseStock).order_by(UniverseStock.symbol.asc()))
            .scalars()
            .all()
        )
        if not universe_stocks:
            logger.warning("Universe stocks list is empty. Auto-trade halted.")
            return {
                "status": "aborted",
                "reason": "No universe stocks found",
                "timestamp": now.isoformat(),
                "users_processed": 0,
            }

        # Step 3: Fetch live quotes for universe stocks
        symbols = [s.symbol for s in universe_stocks]
        try:
            quotes = get_position_quotes(db, symbols)
        except MarketDataError as exc:
            logger.warning("Could not obtain live quotes for universe stocks: %s", exc)
            quotes = {}

        # Step 4: Search all users with auto_trade enabled
        auto_trade_users = (
            db.execute(
                select(UserPreference.user_id)
                .where(UserPreference.auto_trade.is_(True))
            )
            .scalars()
            .all()
        )

        logger.info("Found %d user(s) with auto_trade enabled.", len(auto_trade_users))

        results: list[dict] = []
        executed_count = 0
        skipped_count = 0
        failed_count = 0

        # Step 5: Process each auto-trade user
        for user_id in auto_trade_users:
            exec_res = execute_user_auto_trade(
                db=db,
                user_id=user_id,
                today=today,
                universe_stocks=universe_stocks,
                latest_pred=latest_pred,
                quotes=quotes,
                dry_run=dry_run,
            )

            if exec_res.status == "success":
                executed_count += 1
            elif exec_res.status in ("skipped", "no_trades_needed"):
                skipped_count += 1
            else:
                failed_count += 1

            results.append({
                "user_id": str(user_id),
                "status": exec_res.status,
                "orders_count": exec_res.orders_count,
                "message": exec_res.message,
                "executed_at": exec_res.executed_at.isoformat(),
            })

        summary = {
            "status": "completed",
            "timestamp": now.isoformat(),
            "users_processed": len(auto_trade_users),
            "executed": executed_count,
            "skipped": skipped_count,
            "failed": failed_count,
            "results": results,
        }

        logger.info(
            "Auto-trade cron completed: %d executed, %d skipped, %d failed.",
            executed_count,
            skipped_count,
            failed_count,
        )

        return summary

    finally:
        if should_close_session:
            db.close()


def run_auto_trade_catchup() -> None:
    """
    Called whenever the backend server restarts or wakes up.

    If the server was off or asleep when market opened, this immediately checks if
    the market is currently open and runs the auto-trade job for any users who have
    not yet executed today.
    """
    logger.info("Checking for restart/catch-up auto-trade execution...")
    now = now_ist()
    is_open, reason = is_market_open_now(now)

    if not is_open:
        logger.info(
            "Restart catch-up skipped: %s Auto-trade will execute when the market opens.",
            reason,
        )
        return

    logger.info("Server active during market hours! Running auto-trade catch-up.")
    try:
        run_auto_trade_job()
    except Exception as exc:
        logger.exception("Error during auto-trade catchup execution: %s", exc)


class AutoTradeScheduler(threading.Thread):
    """
    Background scheduler daemon thread.

    Runs inside the FastAPI process:
    1. Immediately triggers catch-up execution on startup if market is open.
    2. Periodically checks during trading days at 09:15 IST (market open) and executes.
    3. Sleeps efficiently outside market hours and on weekends.
    """

    def __init__(self, check_interval_seconds: int = 60):
        super().__init__(name="AutoTradeSchedulerDaemon", daemon=True)
        self.check_interval_seconds = check_interval_seconds
        self._stop_event = threading.Event()

    def stop(self) -> None:
        self._stop_event.set()

    def run(self) -> None:
        logger.info("AutoTradeScheduler background worker started.")

        # Immediate catch-up check on server startup/restart
        try:
            run_auto_trade_catchup()
        except Exception as exc:
            logger.error("Error in initial catch-up check: %s", exc)

        while not self._stop_event.is_set():
            try:
                now = now_ist()
                is_open, _ = is_market_open_now(now)

                if is_open:
                    # During market open session: check and execute for any unexecuted auto-trade users
                    run_auto_trade_job()
            except Exception as exc:
                logger.error("Error in auto-trade scheduler cycle: %s", exc)

            # Wait for next check cycle or stop signal
            self._stop_event.wait(self.check_interval_seconds)

        logger.info("AutoTradeScheduler background worker stopped.")


_scheduler_instance: AutoTradeScheduler | None = None
_scheduler_lock = threading.Lock()


def start_auto_trade_scheduler(check_interval_seconds: int = 60) -> AutoTradeScheduler:
    """Start the background auto-trade scheduler daemon if not already running."""
    global _scheduler_instance
    with _scheduler_lock:
        if _scheduler_instance is None or not _scheduler_instance.is_alive():
            _scheduler_instance = AutoTradeScheduler(check_interval_seconds=check_interval_seconds)
            _scheduler_instance.start()
            logger.info("Started background auto-trade scheduler.")
        return _scheduler_instance


def stop_auto_trade_scheduler() -> None:
    """Stop the background auto-trade scheduler daemon."""
    global _scheduler_instance
    with _scheduler_lock:
        if _scheduler_instance is not None and _scheduler_instance.is_alive():
            _scheduler_instance.stop()
            _scheduler_instance = None
            logger.info("Stopped background auto-trade scheduler.")


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    parser = argparse.ArgumentParser(description="Paper Trading Platform - Auto-Trade Cron Job")
    parser.add_argument("--force", action="store_true", help="Force execution even if market is closed")
    parser.add_argument("--dry-run", action="store_true", help="Calculate trades and capital without executing")
    parser.add_argument("--daemon", action="store_true", help="Run continuously as a background daemon scheduler")
    args = parser.parse_args()

    if args.daemon:
        scheduler = start_auto_trade_scheduler()
        try:
            while True:
                time_module.sleep(1)
        except KeyboardInterrupt:
            stop_auto_trade_scheduler()
    else:
        result = run_auto_trade_job(force=args.force, dry_run=args.dry_run)
        print("\n=== Auto-Trade Execution Result ===")
        print(result)
