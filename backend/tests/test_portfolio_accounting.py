from decimal import Decimal
from types import SimpleNamespace

from api.services.portfolio_accounting import calculate_equity_from_positions


def position(symbol, quantity, avg_entry_price, margin_locked=0):
    return SimpleNamespace(
        symbol=symbol,
        quantity=Decimal(str(quantity)),
        avg_entry_price=Decimal(str(avg_entry_price)),
        margin_locked=Decimal(str(margin_locked)),
    )


def test_mixed_long_short_equity_uses_mark_to_market_value():
    cash = Decimal("8000")
    positions = [
        position("LONG", 10, 100),       # current 120 => +1200 equity value
        position("SHORT", -10, 100, 200), # current 80 => margin 200 + 200 P&L
    ]

    equity = calculate_equity_from_positions(
        cash,
        positions,
        {"LONG": Decimal("120"), "SHORT": Decimal("80")},
    )

    assert equity == Decimal("9600")


def test_holdings_value_excludes_free_cash_and_short_is_negative_notional():
    from api.services.portfolio_accounting import _holdings_value_from_working_state
    from api.services.trade_service import WorkingPosition

    working = {
        "LONG": WorkingPosition(Decimal("10"), Decimal("100"), Decimal("0")),
        "SHORT": WorkingPosition(Decimal("-5"), Decimal("100"), Decimal("100")),
    }

    value = _holdings_value_from_working_state(
        working,
        {"LONG": Decimal("120"), "SHORT": Decimal("80")},
    )

    # 10*120 - 5*80 = 800. Cash/capital is deliberately excluded.
    assert value == Decimal("800")
