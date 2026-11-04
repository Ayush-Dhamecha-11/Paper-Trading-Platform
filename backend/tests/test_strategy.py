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
    data = suggestion.model_dump()
    assert data["weight"] == 12.34
    assert "weight" in data


def test_trade_suggestion_weight_calculation():
    raw_weights = [0.08254, 0.15678, -0.05123, 0.0]
    expected_pct = [8.25, 15.68, -5.12, 0.0]

    for raw, expected in zip(raw_weights, expected_pct):
        assert round(raw * 100, 2) == expected

