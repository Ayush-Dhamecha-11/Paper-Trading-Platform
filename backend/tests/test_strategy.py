from decimal import Decimal
from api.schemas.strategy import TradeSuggestionOut


def test_trade_suggestion_schema_weight():
    # Test with explicit rounded percentage weight
    suggestion = TradeSuggestionOut(
        id="pending_RELIANCE_2026-11-03",
        ticker="RELIANCE",
        name="Reliance Industries",
        action="buy",
        quantity=10.0,
        price=2500.0,
        weight=12.34,
        status="pending",
    )
    assert suggestion.weight == 12.34
    assert suggestion.status == "pending"
    assert suggestion.is_executed is False
    assert suggestion.executed is False
    assert suggestion.executedAt is None
    data = suggestion.model_dump()
    assert data["weight"] == 12.34
    assert "weight" in data
    assert data["is_executed"] is False
    assert data["status"] == "pending"


def test_trade_suggestion_executed_schema():
    suggestion = TradeSuggestionOut(
        id="order_ADANIPOWER_1700000000",
        ticker="ADANIPOWER",
        name="Adani Power",
        action="buy",
        quantity=1.0,
        price=600.0,
        weight=5.0,
        status="executed",
        executedAt="2026-11-19T10:00:00Z",
        is_executed=True,
        executed=True,
    )
    assert suggestion.status == "executed"
    assert suggestion.is_executed is True
    assert suggestion.executed is True
    assert suggestion.executedAt == "2026-11-19T10:00:00Z"


def test_trade_suggestion_weight_calculation():
    raw_weights = [0.08254, 0.15678, -0.05123, 0.0]
    expected_pct = [8.25, 15.68, -5.12, 0.0]

    for raw, expected in zip(raw_weights, expected_pct):
        assert round(raw * 100, 2) == expected


def test_previous_trading_day_calculation():
    from datetime import date
    from api.services.market_data import get_previous_trading_day

    # 2026-11-18 is Tuesday, previous trading day is Monday 2026-11-17
    tuesday = date(2026, 11, 18)
    assert get_previous_trading_day(tuesday) == date(2026, 11, 17)

    # 2026-11-19 is Wednesday, previous trading day is Tuesday 2026-11-18
    wednesday = date(2026, 11, 19)
    assert get_previous_trading_day(wednesday) == date(2026, 11, 18)

    # 2026-11-16 is Monday, previous trading day is Friday 2026-11-13
    monday = date(2026, 11, 16)
    assert get_previous_trading_day(monday) == date(2026, 11, 13)


def test_prediction_freshness_validation():
    from datetime import date, timedelta
    from api.services.market_data import get_previous_trading_day

    # On Nov 18, prediction from Nov 17 is valid
    today_18 = date(2026, 11, 18)
    valid_dates_18 = {get_previous_trading_day(today_18), today_18 - timedelta(days=1)}
    assert date(2026, 11, 17) in valid_dates_18

    # On Nov 19, prediction from Nov 17 is outdated because Nov 18 prediction is required
    today_19 = date(2026, 11, 19)
    valid_dates_19 = {get_previous_trading_day(today_19), today_19 - timedelta(days=1)}
    assert date(2026, 11, 17) not in valid_dates_19
    assert date(2026, 11, 18) in valid_dates_19

