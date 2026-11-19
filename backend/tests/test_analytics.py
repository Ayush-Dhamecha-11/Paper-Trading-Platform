from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import Mock

import pandas as pd
import pytest

import api.services.analytics_helper as analytics_helper
from api.services.analytics_helper import (
    build_performance_series,
    build_summary,
    build_trading_metrics,
    compute_annualized_return_pct,
    compute_drawdown_series,
    compute_max_drawdown,
    compute_sharpe_ratio,
    match_trades_average_cost,
)


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


def test_sharpe_is_unavailable_without_two_observations_or_variation():
    assert compute_sharpe_ratio(pd.Series([0.0])) is None
    assert compute_sharpe_ratio(pd.Series([0.01, 0.01])) is None


def test_stock_return_annualizes_over_observed_trading_days():
    closes = pd.Series([100 * (1.1 ** (i / 20)) for i in range(21)])

    assert compute_annualized_return_pct(closes) == pytest.approx(
        (1.1 ** (252 / 20) - 1) * 100
    )


def test_drawdown_handles_zero_equity_without_nan():
    values = pd.Series([0.0, 0.0, 100.0, 90.0])

    assert compute_drawdown_series(values).tolist() == [0.0, 0.0, 0.0, -10.0]
    assert compute_max_drawdown(values) == -10.0


def test_trading_metrics_use_na_for_missing_closed_trade_data():
    metrics = build_trading_metrics([])

    assert [metric["value"] for metric in metrics] == ["N/A"] * 6


def test_profit_factor_is_na_when_there_are_no_wins_or_losses():
    metrics = build_trading_metrics([{"pnl": 0.0}])

    assert metrics[3]["value"] == "N/A"


def test_winning_trades_without_losses_have_infinite_profit_factor():
    metrics = build_trading_metrics([{"pnl": 100.0}])

    assert metrics[3]["value"] == "∞"
    assert metrics[2]["value"] == "N/A"


def test_performance_series_uses_cash_flow_adjusted_returns():
    snapshots = pd.DataFrame(
        {
            "account_equity": [1000.0, 2000.0],
            "daily_return": [0.0, 0.02],
        },
        index=pd.to_datetime(["2026-09-10", "2026-09-11"]),
    )

    points = build_performance_series(
        snapshots,
        pd.Series(dtype=float),
        "ALL",
        datetime(2026, 9, 11).date(),
    )

    assert [point["portfolio"] for point in points] == [100.0, 102.0]
    assert [point["pnl"] for point in points] == [0.0, 20.0]


def test_summary_uses_cash_flow_adjusted_portfolio_return(monkeypatch):
    state = SimpleNamespace(
        portfolio_value=2000.0,
        net_contributed_capital=1000.0,
        invested_capital=200.0,
        total_profit=50.0,
        today_pnl=0.0,
    )
    monkeypatch.setattr(
        analytics_helper,
        "build_portfolio_state",
        Mock(return_value=state),
    )
    snapshots = pd.DataFrame(
        {
            "account_equity": [1000.0, 2100.0],
            "daily_return": [0.0, 0.05],
        },
        index=pd.to_datetime(["2026-09-10", "2026-09-11"]),
    )
    benchmark = pd.Series(
        [100.0, 102.0],
        index=pd.to_datetime(["2026-09-10", "2026-09-11"]),
    )

    summary = build_summary(None, None, snapshots, benchmark, [])
    values = {metric["label"]: metric["value"] for metric in summary}

    assert values["Total Return"] == "+5.0%"
    assert values["Alpha vs NIFTY 50"] == "+3.0%"


def test_summary_marks_sharpe_and_drawdown_na_without_return_history(monkeypatch):
    state = SimpleNamespace(
        portfolio_value=1000.0,
        net_contributed_capital=1000.0,
        invested_capital=0.0,
        total_profit=0.0,
        today_pnl=0.0,
    )
    monkeypatch.setattr(
        analytics_helper,
        "build_portfolio_state",
        Mock(return_value=state),
    )
    snapshots = pd.DataFrame(
        {"account_equity": [1000.0], "daily_return": [0.0]},
        index=pd.to_datetime(["2026-09-10"]),
    )

    summary = build_summary(None, None, snapshots, pd.Series(dtype=float), [])
    values = {metric["label"]: metric["value"] for metric in summary}

    assert values["Sharpe Ratio"] == "N/A"
    assert values["Max Drawdown"] == "N/A"
