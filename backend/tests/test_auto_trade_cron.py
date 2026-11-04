from datetime import date, datetime, time
from decimal import Decimal
from zoneinfo import ZoneInfo

from api.services.trade_service import calculate_self_financing_rebalance
from jobs.auto_trade_cron import (
    IST,
    NSE_CLOSE,
    NSE_OPEN,
    is_market_open_now,
    is_trading_day,
    plan_auto_trade_orders,
)


def test_market_days_and_holidays():
    # Saturday & Sunday are off-market days
    saturday = date(2026, 10, 24)
    sunday = date(2026, 10, 25)
    assert not is_trading_day(saturday)
    assert not is_trading_day(sunday)

    # Regular weekday is a trading day
    tuesday = date(2026, 10, 27)
    assert is_trading_day(tuesday)

    # National holidays are off-market days
    republic_day = date(2026, 1, 26)
    independence_day = date(2026, 8, 15)
    gandhi_jayanti = date(2026, 10, 2)
    assert not is_trading_day(republic_day)
    assert not is_trading_day(independence_day)
    assert not is_trading_day(gandhi_jayanti)


def test_market_hours_status():
    # During market hours on a Tuesday
    market_open_dt = datetime(2026, 10, 27, 10, 30, tzinfo=IST)
    is_open, msg = is_market_open_now(market_open_dt)
    assert is_open
    assert "Market is open" in msg

    # Before market open on a trading day (08:30 IST)
    before_open_dt = datetime(2026, 10, 27, 8, 30, tzinfo=IST)
    is_open, msg = is_market_open_now(before_open_dt)
    assert not is_open
    assert "has not opened yet" in msg

    # After market close on a trading day (16:00 IST)
    after_close_dt = datetime(2026, 10, 27, 16, 0, tzinfo=IST)
    is_open, msg = is_market_open_now(after_close_dt)
    assert not is_open
    assert "closed for the day" in msg

    # Weekend (Sunday 11:00 IST)
    weekend_dt = datetime(2026, 10, 25, 11, 0, tzinfo=IST)
    is_open, msg = is_market_open_now(weekend_dt)
    assert not is_open
    assert "Off-market day" in msg


def test_capital_management_sells_fund_buys():
    """
    Selling existing positions releases cash proceeds to fund target buys.
    """
    current_positions = {"OLD_STOCK": Decimal("10")}
    cash_balance = Decimal("500")
    # Target: flatten OLD_STOCK, buy 15 of NEW_STOCK
    target_quantities = {"OLD_STOCK": Decimal("0"), "NEW_STOCK": Decimal("15")}
    prices = {"OLD_STOCK": Decimal("100"), "NEW_STOCK": Decimal("100")}

    planned = plan_auto_trade_orders(
        current_positions=current_positions,
        cash_balance=cash_balance,
        target_quantities=target_quantities,
        prices=prices,
    )

    # Must execute sell first, then buy
    assert len(planned) == 2
    assert planned[0].action == "sell"
    assert planned[0].symbol == "OLD_STOCK"
    assert planned[0].quantity == Decimal("10")

    assert planned[1].action == "buy"
    assert planned[1].symbol == "NEW_STOCK"
    assert planned[1].quantity == Decimal("15")
    # Total buy expenditure (1500) <= initial cash (500) + sell proceeds (1000)
    assert planned[1].cost == Decimal("1500")


def test_capital_management_scales_buys_when_cash_is_limited():
    """
    When available cash is insufficient for all desired buys, buy quantities are
    scaled down so the total expenditure strictly never exceeds available cash.
    """
    current_positions = {}
    cash_balance = Decimal("500")  # Only 500 cash available
    # Desired: 10 shares of STOCK_A (cost 1000) and 10 shares of STOCK_B (cost 1000)
    target_quantities = {"STOCK_A": Decimal("10"), "STOCK_B": Decimal("10")}
    prices = {"STOCK_A": Decimal("100"), "STOCK_B": Decimal("100")}

    planned = plan_auto_trade_orders(
        current_positions=current_positions,
        cash_balance=cash_balance,
        target_quantities=target_quantities,
        prices=prices,
    )

    total_expenditure = sum(t.cost for t in planned if t.action == "buy")
    assert total_expenditure <= cash_balance
    assert total_expenditure == Decimal("500")

    # Quantities should sum to 5 whole shares total
    total_qty = sum(t.quantity for t in planned)
    assert total_qty == Decimal("5")


def test_capital_management_skips_buys_if_zero_cash():
    """
    If a user has 0 cash and no sells to generate cash, no buys are placed.
    """
    current_positions = {}
    cash_balance = Decimal("0")
    target_quantities = {"STOCK_A": Decimal("10")}
    prices = {"STOCK_A": Decimal("100")}

    planned = plan_auto_trade_orders(
        current_positions=current_positions,
        cash_balance=cash_balance,
        target_quantities=target_quantities,
        prices=prices,
    )

    # 0 buys planned because user has no capital
    assert len(planned) == 0


def test_no_trades_when_portfolio_matches_prediction():
    """
    When current positions already equal target quantities, 0 trades are generated.
    """
    current_positions = {"RELIANCE": Decimal("20"), "TCS": Decimal("10")}
    cash_balance = Decimal("5000")
    target_quantities = {"RELIANCE": Decimal("20"), "TCS": Decimal("10")}
    prices = {"RELIANCE": Decimal("2500"), "TCS": Decimal("3500")}

    planned = plan_auto_trade_orders(
        current_positions=current_positions,
        cash_balance=cash_balance,
        target_quantities=target_quantities,
        prices=prices,
    )

    assert len(planned) == 0


def test_self_financing_rebalance_floor_prevents_negative_capital():
    """
    Using floor on (equity * weight / price) guarantees that the sum of purchase
    costs strictly never exceeds available capital, preventing negative cash balances.
    """
    equity = Decimal("10000")
    # 3 stocks with 33% target weight each
    weights = {"A": Decimal("0.33"), "B": Decimal("0.33"), "C": Decimal("0.33")}
    # Price is 340. 3300 / 340 = 9.70588.
    # If rounded up, 10 shares * 340 = 3400. 3 * 3400 = 10,200 > 10,000 (overdraft!).
    # With floor, 9 shares * 340 = 3060. 3 * 3060 = 9,180 <= 10,000.
    prices = {"A": Decimal("340"), "B": Decimal("340"), "C": Decimal("340")}
    current_positions = {}

    trades = calculate_self_financing_rebalance(
        current_positions=current_positions,
        account_equity=equity,
        symbol_weights=weights,
        prices=prices,
        is_portfolio_weights=True,
    )

    assert len(trades) == 3
    for t in trades:
        assert t.action == "buy"
        assert t.quantity == Decimal("9")  # floor(9.705) = 9

    total_cost = sum(t.quantity * t.price for t in trades)
    assert total_cost == Decimal("9180")
    assert total_cost <= equity


def test_self_financing_rebalance_short_selling_in_one_trade():
    """
    Target short weights produce negative target quantities using floor,
    and are executed in 1 single trade.
    """
    equity = Decimal("10000")
    # Target 20% short in STOCK_S
    weights = {"STOCK_S": Decimal("-0.20")}
    prices = {"STOCK_S": Decimal("100")}
    current_positions = {}

    trades = calculate_self_financing_rebalance(
        current_positions=current_positions,
        account_equity=equity,
        symbol_weights=weights,
        prices=prices,
        is_portfolio_weights=True,
    )

    assert len(trades) == 1
    trade = trades[0]
    assert trade.symbol == "STOCK_S"
    assert trade.action == "sell"
    assert trade.quantity == Decimal("20")  # floor(2000 / 100) = 20
    assert trade.target_qty == Decimal("-20")


def test_self_financing_rebalance_flips_in_one_trade():
    """
    Position flipping (long to short, short to long) is handled as a single net trade.
    """
    equity = Decimal("10000")
    prices = {"STOCK_A": Decimal("100"), "STOCK_B": Decimal("100")}

    # Case 1: Long 10 -> Target Short 5 => single SELL 15
    # Case 2: Short 5 -> Target Long 10 => single BUY 15
    current_positions = {"STOCK_A": Decimal("10"), "STOCK_B": Decimal("-5")}
    weights = {"STOCK_A": Decimal("-0.05"), "STOCK_B": Decimal("0.10")}

    trades = calculate_self_financing_rebalance(
        current_positions=current_positions,
        account_equity=equity,
        symbol_weights=weights,
        prices=prices,
        is_portfolio_weights=True,
    )

    trade_by_sym = {t.symbol: t for t in trades}

    # STOCK_A: diff = -5 - 10 = -15 -> SELL 15
    assert trade_by_sym["STOCK_A"].action == "sell"
    assert trade_by_sym["STOCK_A"].quantity == Decimal("15")

    # STOCK_B: diff = 10 - (-5) = +15 -> BUY 15
    assert trade_by_sym["STOCK_B"].action == "buy"
    assert trade_by_sym["STOCK_B"].quantity == Decimal("15")


def test_self_financing_priority_execution_order():
    """
    Trades are sorted so cash-releasing trades (long sells, short covers)
    execute before cash-consuming trades (long buys, short sells).
    """
    equity = Decimal("20000")
    prices = {
        "HOLDING_LONG": Decimal("100"),
        "HOLDING_SHORT": Decimal("100"),
        "TARGET_LONG": Decimal("100"),
        "TARGET_SHORT": Decimal("100"),
    }
    current_positions = {
        "HOLDING_LONG": Decimal("10"),   # Liquidate to 0 -> SELL (Priority 1)
        "HOLDING_SHORT": Decimal("-5"),  # Cover to 0 -> BUY (Priority 2)
    }
    weights = {
        "TARGET_LONG": Decimal("0.20"),   # Open long -> BUY (Priority 3)
        "TARGET_SHORT": Decimal("-0.10"), # Open short -> SELL (Priority 4)
    }

    trades = calculate_self_financing_rebalance(
        current_positions=current_positions,
        account_equity=equity,
        symbol_weights=weights,
        prices=prices,
        is_portfolio_weights=True,
    )

    actions_and_priorities = [(t.symbol, t.action, t.priority) for t in trades]
    expected = [
        ("HOLDING_LONG", "sell", 1),
        ("HOLDING_SHORT", "buy", 2),
        ("TARGET_LONG", "buy", 3),
        ("TARGET_SHORT", "sell", 4),
    ]
    assert actions_and_priorities == expected
