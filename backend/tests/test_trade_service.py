from decimal import Decimal

from api.services.trade_service import WorkingPosition, apply_buy, apply_sell


def test_long_buy_uses_weighted_average_cost():
    positions = {}
    cash = Decimal("10000")

    positions, cash = apply_buy(positions, cash, "ABC", Decimal("10"), Decimal("100"))
    positions, cash = apply_buy(positions, cash, "ABC", Decimal("10"), Decimal("120"))

    assert cash == Decimal("7800")
    assert positions["ABC"].quantity == Decimal("20")
    assert positions["ABC"].avg_entry_price == Decimal("110")


def test_long_sell_realizes_profit_and_flattens():
    positions = {"ABC": WorkingPosition(Decimal("10"), Decimal("100"), Decimal("0"))}
    cash = Decimal("9000")

    positions, cash = apply_sell(positions, cash, "ABC", Decimal("10"), Decimal("120"))

    assert cash == Decimal("10200")
    assert "ABC" not in positions


def test_short_mark_to_market_equity_is_correct():
    positions = {}
    cash = Decimal("10000")

    positions, cash = apply_sell(positions, cash, "ABC", Decimal("10"), Decimal("100"))

    # 200 margin is locked; spendable cash is 9,800.
    assert cash == Decimal("9800")
    assert positions["ABC"].margin_locked == Decimal("200")

    short = positions["ABC"]
    current_price = Decimal("80")
    equity = cash + short.margin_locked + (short.avg_entry_price - current_price) * (-short.quantity)
    assert equity == Decimal("10200")


def test_buying_to_cover_short_realizes_short_profit_and_releases_margin():
    positions = {"ABC": WorkingPosition(Decimal("-10"), Decimal("100"), Decimal("200"))}
    cash = Decimal("9800")

    positions, cash = apply_buy(positions, cash, "ABC", Decimal("10"), Decimal("80"))

    assert cash == Decimal("10200")
    assert "ABC" not in positions


def test_short_to_long_flip_is_accounted_for_in_one_buy():
    positions = {"ABC": WorkingPosition(Decimal("-5"), Decimal("100"), Decimal("100"))}
    cash = Decimal("8900")

    positions, cash = apply_buy(positions, cash, "ABC", Decimal("8"), Decimal("80"))

    # Cover 5: +100 realized P&L + 100 released margin => 9,100 cash.
    # Open 3 long: -240 => 8,860 cash.
    assert cash == Decimal("8860")
    assert positions["ABC"].quantity == Decimal("3")
    assert positions["ABC"].avg_entry_price == Decimal("80")
    assert positions["ABC"].margin_locked == Decimal("0")


def test_capital_delta_classifies_deposit_and_withdrawal():
    from api.services.trade_service import calculate_capital_delta

    delta, kind = calculate_capital_delta(Decimal("1000"), Decimal("1500"))
    assert delta == Decimal("500")
    assert kind == "deposit"

    delta, kind = calculate_capital_delta(Decimal("1500"), Decimal("800"))
    assert delta == Decimal("-700")
    assert kind == "withdrawal"

    delta, kind = calculate_capital_delta(Decimal("800"), Decimal("800"))
    assert delta == Decimal("0")
    assert kind == "none"
