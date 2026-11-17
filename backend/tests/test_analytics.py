from datetime import datetime, timezone
from types import SimpleNamespace

from api.services.analytics_helper import match_trades_average_cost


def order(symbol, qty, price, order_type, minute):
    return SimpleNamespace(
        symbol=symbol,
        quantity=qty,
        price=price,
        order_type=order_type,
        status="filled",
        timestamp=datetime(2026, 9, 10, 10, minute, tzinfo=timezone.utc),
    )


def test_match_trades_supports_short_round_trip():
    orders = [
        order("ABC", 10, 100, "sell", 0),
        order("ABC", 10, 80, "buy", 1),
    ]

    trades = match_trades_average_cost(orders)

    assert len(trades) == 1
    assert trades[0]["side"] == "short"
    assert trades[0]["quantity"] == 10
    assert trades[0]["pnl"] == 200


def test_match_trades_handles_long_to_short_flip():
    orders = [
        order("ABC", 5, 100, "buy", 0),
        order("ABC", 8, 120, "sell", 1),
        order("ABC", 3, 90, "buy", 2),
    ]

    trades = match_trades_average_cost(orders)

    assert len(trades) == 2
    assert trades[0]["side"] == "long"
    assert trades[0]["quantity"] == 5
    assert trades[0]["pnl"] == 100
    assert trades[1]["side"] == "short"
    assert trades[1]["quantity"] == 3
    assert trades[1]["pnl"] == 90
