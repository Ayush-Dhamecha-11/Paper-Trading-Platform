"""
backend/api/services/analytics_helper.py

All the actual computation behind GET /api/analytics.
Every function here takes plain Python/pandas structures 
in and returns plain structures out.

Data sources:
    PortfolioSnapshot  - one row/day/portfolio, written by the daily cron
                         (jobs/daily_pipeline.py, snapshot step not yet
                         built). Powers every time-series chart:
                         portfolio value, alpha, drawdown, volatility,
                         monthly returns.
    Order              - flat buy/sell log. Powers realized trade P&L
                         (win rate, avg win/loss, best/worst trade,
                         cumulative trade P&L) via average-cost-basis
                         matching - see match_trades_average_cost().
    Position           - current holdings. Powers sector/stock
                         allocation and P&L-by-stock (unrealized).
    PriceHistory       - '^CNX100' rows specifically, for the NIFTY
                         benchmark series. Read from our own DB (already
                         fetched daily by the existing price cron) rather
                         than a live external call - see module docstring
                         reasoning: same table/query pattern as any other
                         symbol, no added network latency or external
                         dependency on every /api/analytics request.

Until PortfolioSnapshot has real history (i.e. a brand new
portfolio, or before the snapshot step is built), every time-series
function below returns an empty list rather than raising - the frontend
charts just render blank, which is correct behaviour for "no data yet,"
not an error state.
"""

import logging
import math
from datetime import date, timedelta
from typing import Optional
import pandas as pd
from sqlalchemy import select
from sqlalchemy.orm import Session

from api.services.market_data import MarketDataError, today_ist
from api.services.portfolio_accounting import build_portfolio_state, get_position_quotes
from db.models import Order, OrderStatus, OrderType, Portfolio, PortfolioSnapshot, Position, PriceHistory, UniverseStock

logger = logging.getLogger(__name__)

MARKET_INDEX_SYMBOL = "^CNX100"

RANGE_DAYS = {"1W": 7, "1M": 30, "3M": 91, "6M": 182, "1Y": 365, "ALL": None}

SECTOR_COLORS = {
    "Banking": "#5996eb", "Finance": "#5996eb", "Financial Services": "#5996eb",
    "IT": "#24c6dc", "Technology": "#24c6dc",
    "Energy": "#20d89b",
    "FMCG": "#f5b942", "Consumer": "#f5b942",
    "Pharma": "#f56b6b", "Healthcare": "#f56b6b",
}
DEFAULT_SECTOR_COLOR = "#94a3b8"

STOCK_PALETTE = [
    "#20d89b", "#5996eb", "#f5b942", "#f56b6b", "#24c6dc",
    "#8b7cff", "#d9a441", "#c86be8", "#6ee7b7", "#fb923c",
]


# Snapshot loading + derived series (Sharpe, drawdown, volatility, alpha)
def load_snapshots(db: Session, portfolio_id: int) -> pd.DataFrame:
    """All PortfolioSnapshot rows as a DataFrame indexed by date, sorted ascending."""
    rows = db.execute(
        select(PortfolioSnapshot)
        .where(PortfolioSnapshot.user_id == portfolio_id)
        .order_by(PortfolioSnapshot.day)
    ).scalars().all()

    if not rows:
        return pd.DataFrame(columns=["day", "portfolio_value", "account_equity", "cash_balance", "daily_return", "cumulative_return", "user_id"])

    df = pd.DataFrame(
        [
            {
                "day": r.day,
                # Portfolio value = holdings only. Analytics performance uses
                # account_equity so cash movements do not disappear from the curve.
                "portfolio_value": float(r.portfolio_value),
                "account_equity": float(r.account_equity),
                "cash_balance": float(r.cash_balance),
                "daily_return": float(r.daily_return) if r.daily_return is not None else None,
                "cumulative_return": float(r.cumulative_return) if r.cumulative_return is not None else None,
                "user_id": r.user_id
            }
            for r in rows
        ]
    )
    df["day"] = pd.to_datetime(df["day"])
    df = df.set_index("day").sort_index()

    # daily_return may be NULL for early rows; use account equity as the return
    # base because cash is part of the trading account value.
    pct_change = df["account_equity"].pct_change()
    df["daily_return"] = df["daily_return"].fillna(pct_change)
    df.loc[df.index[0], "daily_return"] = 0.0 if pd.isna(df["daily_return"].iloc[0]) else df["daily_return"].iloc[0]

    return df


def load_benchmark(db: Session, start: date, end: date) -> pd.Series:
    """
    Daily close for MARKET_INDEX_SYMBOL from our own price_history (see
    module docstring for why DB over a live external call). Returns an
    empty Series if the index isn't in price_history yet - callers treat
    that as "no benchmark available" rather than failing the whole
    request.
    """
    rows = db.execute(
        select(PriceHistory.day, PriceHistory.close)
        .where(PriceHistory.symbol == MARKET_INDEX_SYMBOL)
        .where(PriceHistory.day >= start)
        .where(PriceHistory.day <= end)
        .order_by(PriceHistory.day)
    ).all()

    if not rows:
        logger.warning(f"No price_history for benchmark symbol {MARKET_INDEX_SYMBOL}")
        return pd.Series(dtype=float)

    s = pd.Series(
        {pd.Timestamp(d): float(c) for d, c in rows}
    ).sort_index()
    return s


def compute_drawdown_series(portfolio_value: pd.Series) -> pd.Series:
    """Drawdown at each point = % below the running peak so far."""
    running_max = portfolio_value.cummax()
    return (portfolio_value - running_max) / running_max * 100


def compute_rolling_volatility(daily_return: pd.Series, window: int = 21) -> pd.Series:
    """Annualised rolling volatility (%) from daily returns."""
    return daily_return.rolling(window, min_periods=5).std() * math.sqrt(252) * 100


def compute_sharpe_ratio(daily_return: pd.Series, risk_free_annual: float = 0.06) -> float:
    """Annualised Sharpe ratio from a daily return series."""
    if daily_return.empty or daily_return.std() == 0 or daily_return.isna().all():
        return 0.0
    rf_daily = risk_free_annual / 252
    excess = daily_return - rf_daily
    return float((excess.mean() / excess.std()) * math.sqrt(252))


def compute_max_drawdown(portfolio_value: pd.Series) -> float:
    if portfolio_value.empty:
        return 0.0
    dd = compute_drawdown_series(portfolio_value)
    return float(dd.min())


def slice_range(df: pd.DataFrame, range_key: str, as_of: date) -> pd.DataFrame:
    if df.empty:
        return df

    days = RANGE_DAYS[range_key]
    if days is None:
        return df
    start = pd.Timestamp(as_of - timedelta(days=days))
    return df.loc[df.index >= start]


def build_performance_series(
    snapshots: pd.DataFrame,
    benchmark: pd.Series,
    range_key: str,
    as_of: date,
) -> list[dict]:
    """
    One TimeSeriesPoint per day in the requested range: {label, portfolio,
    benchmark, pnl, alpha, drawdown, volatility}. Portfolio/benchmark are
    both rebased to 100 at the start of the range (matches
    DUMMY_ANALYTICS_DATA's convention of starting every series at 100).
    """
    ranged = slice_range(snapshots, range_key, as_of)
    if ranged.empty:
        return []

    # Performance is account performance, so free cash + marked positions are
    # represented in the curve. Holdings-only portfolio value is intentionally
    # kept separate for the portfolio summary card.
    base_value = ranged["account_equity"].iloc[0]
    portfolio_rebased = ranged["account_equity"] / base_value * 100

    bench_ranged = benchmark.reindex(ranged.index, method="ffill") if not benchmark.empty else None
    if bench_ranged is not None and not bench_ranged.empty and not pd.isna(bench_ranged.iloc[0]):
        bench_base = bench_ranged.iloc[0]
        bench_rebased = bench_ranged / bench_base * 100
    else:
        bench_rebased = None

    pnl = ranged["account_equity"] - base_value
    drawdown = compute_drawdown_series(ranged["account_equity"])
    volatility = compute_rolling_volatility(ranged["daily_return"])

    label_fmt = "%d %b" if range_key in ("1W", "1M") else "%b"

    points = []
    for i, (dt, row) in enumerate(ranged.iterrows()):
        alpha = None
        if bench_rebased is not None:
            alpha = float(portfolio_rebased.iloc[i] - bench_rebased.iloc[i])

        points.append(
            {
                "label": dt.strftime(label_fmt),
                "portfolio": round(float(portfolio_rebased.iloc[i]), 2),
                "benchmark": round(float(bench_rebased.iloc[i]), 2) if bench_rebased is not None else None,
                "pnl": round(float(pnl.iloc[i]), 2),
                "alpha": round(alpha, 2) if alpha is not None else None,
                "drawdown": round(float(drawdown.iloc[i]), 2) if not pd.isna(drawdown.iloc[i]) else 0.0,
                "volatility": round(float(volatility.iloc[i]), 2) if not pd.isna(volatility.iloc[i]) else None,
            }
        )
    return points


def build_monthly_returns(snapshots: pd.DataFrame) -> list[dict]:
    """Last 12 calendar months' return %, compounded from daily_return."""
    if snapshots.empty:
        return []

    monthly = (1 + snapshots["daily_return"]).resample("ME").prod() - 1
    monthly = monthly.tail(12) * 100

    return [
        {"month": dt.strftime("%b"), "value": round(float(val), 2)}
        for dt, val in monthly.items()
        if not pd.isna(val)
    ]


# Trade matching (average cost basis) - realized P&L, win rate, etc.
def match_trades_average_cost(orders: list[Order]) -> list[dict]:
    """
    Match the order ledger using a signed position and average cost.

    This handles long trades, short trades, partial covers, and position flips.
    Every time an order reduces the existing signed position, a realized trade
    record is emitted.
    """
    by_symbol: dict[str, list[Order]] = {}
    for order in orders:
        if order.status not in (
            OrderStatus.FILLED.value,
            OrderStatus.FORCE_CLOSED.value,
            OrderStatus.FILLED,
            OrderStatus.FORCE_CLOSED,
        ):
            continue
        by_symbol.setdefault(order.symbol, []).append(order)

    trades: list[dict] = []

    for symbol, symbol_orders in by_symbol.items():
        symbol_orders.sort(key=lambda order: order.timestamp)
        qty = 0.0  # positive long, negative short
        avg_cost = 0.0

        for order in symbol_orders:
            order_qty = float(order.quantity)
            order_price = float(order.price)

            is_buy = order.order_type in (OrderType.BUY.value, OrderType.BUY)

            if is_buy:
                if qty < 0:
                    cover_qty = min(order_qty, -qty)
                    pnl = (avg_cost - order_price) * cover_qty
                    trades.append({
                        "symbol": symbol,
                        "date": order.timestamp.date(),
                        "quantity": cover_qty,
                        "exit_price": order_price,
                        "avg_cost_at_exit": avg_cost,
                        "pnl": pnl,
                        "side": "short",
                    })

                    qty += cover_qty
                    order_qty -= cover_qty
                    if abs(qty) < 1e-12:
                        qty = 0.0

                    if order_qty > 1e-12:
                        # Excess BUY opens a fresh long.
                        qty = order_qty
                        avg_cost = order_price
                elif qty > 0:
                    new_qty = qty + order_qty
                    avg_cost = (avg_cost * qty + order_price * order_qty) / new_qty
                    qty = new_qty
                else:
                    qty = order_qty
                    avg_cost = order_price

            else:
                if qty > 0:
                    sell_qty = min(order_qty, qty)
                    pnl = (order_price - avg_cost) * sell_qty
                    trades.append({
                        "symbol": symbol,
                        "date": order.timestamp.date(),
                        "quantity": sell_qty,
                        "exit_price": order_price,
                        "avg_cost_at_exit": avg_cost,
                        "pnl": pnl,
                        "side": "long",
                    })

                    qty -= sell_qty
                    order_qty -= sell_qty
                    if abs(qty) < 1e-12:
                        qty = 0.0

                    if order_qty > 1e-12:
                        # Excess SELL opens a fresh short.
                        qty = -order_qty
                        avg_cost = order_price
                elif qty < 0:
                    short_qty = -qty
                    new_short_qty = short_qty + order_qty
                    avg_cost = (
                        avg_cost * short_qty + order_price * order_qty
                    ) / new_short_qty
                    qty = -new_short_qty
                else:
                    qty = -order_qty
                    avg_cost = order_price

    trades.sort(key=lambda trade: (trade["date"], trade["symbol"]))
    return trades


def _format_inr(value: float, show_plus: bool = False) -> str:
    """₹ formatting that puts the sign before the ₹ symbol, e.g. -₹25 or
    +₹1,240 - not ₹-25 - f"₹{value:,.0f}" gets negatives wrong, and
    f"{value:+,.0f}" puts the ₹ in the wrong place for positives."""
    if value < 0:
        return f"-₹{abs(value):,.0f}"
    sign = "+" if show_plus else ""
    return f"{sign}₹{value:,.0f}"


def build_trading_metrics(trades: list[dict]) -> list[dict]:
    if not trades:
        return [
            {"label": "Win Rate", "value": "N/A", "tone": "neutral"},
            {"label": "Average Win", "value": "₹0", "tone": "neutral"},
            {"label": "Average Loss", "value": "₹0", "tone": "neutral"},
            {"label": "Profit Factor", "value": "N/A", "tone": "neutral"},
            {"label": "Best Trade", "value": "₹0", "tone": "neutral"},
            {"label": "Worst Trade", "value": "₹0", "tone": "neutral"},
        ]

    pnls = [t["pnl"] for t in trades]
    wins = [p for p in pnls if p > 0]
    losses = [p for p in pnls if p <= 0]

    win_rate = len(wins) / len(pnls) * 100
    avg_win = sum(wins) / len(wins) if wins else 0.0
    avg_loss = sum(losses) / len(losses) if losses else 0.0
    gross_profit = sum(wins)
    gross_loss = abs(sum(losses))
    profit_factor = (gross_profit / gross_loss) if gross_loss > 0 else float("inf")
    best_trade = max(pnls)
    worst_trade = min(pnls)

    return [
        {"label": "Win Rate", "value": f"{win_rate:.0f}%", "tone": "good" if win_rate >= 50 else "bad"},
        {"label": "Average Win", "value": _format_inr(avg_win), "tone": "good"},
        {"label": "Average Loss", "value": _format_inr(avg_loss), "tone": "bad"},
        {
            "label": "Profit Factor",
            "value": f"{profit_factor:.2f}" if profit_factor != float("inf") else "∞",
            "tone": "good" if profit_factor >= 1 else "bad",
        },
        {"label": "Best Trade", "value": _format_inr(best_trade), "tone": "good" if best_trade >= 0 else "bad"},
        {"label": "Worst Trade", "value": _format_inr(worst_trade), "tone": "bad" if worst_trade < 0 else "good"},
    ]


def build_return_distribution(trades: list[dict]) -> list[dict]:
    """
    Histogram of trade returns (%) into fixed buckets, matching
    DUMMY_ANALYTICS_DATA's -3%..+3% bucket layout.
    """
    buckets = [-3, -2, -1, 0, 1, 2, 3]
    labels = ["-3%", "-2%", "-1%", "0%", "+1%", "+2%", "+3%"]
    counts = [0] * len(buckets)

    for t in trades:
        cost = t["avg_cost_at_exit"] * t["quantity"]
        if cost <= 0:
            continue
        return_pct = (t["pnl"] / cost) * 100
        # clamp into the nearest bucket rather than dropping outliers -
        # keeps the histogram's total count matching len(trades)
        idx = min(range(len(buckets)), key=lambda i: abs(buckets[i] - return_pct))
        counts[idx] += 1

    colors = ["#f56b6b", "#f56b6b", "#f5b942", "#24c6dc", "#20d89b", "#20d89b", "#20d89b"]
    return [
        {"label": labels[i], "value": counts[i], "color": colors[i]}
        for i in range(len(buckets))
    ]


# Current holdings -> allocation charts (sector/stock/pnl/risk)
def load_open_positions_with_meta(db: Session, portfolio_id):
    positions = db.execute(
        select(Position).where(Position.user_id == portfolio_id)
    ).scalars().all()

    if not positions:
        return [], {}, {}

    symbols = [position.symbol for position in positions]
    meta = {
        stock.symbol: stock
        for stock in db.execute(
            select(UniverseStock).where(UniverseStock.symbol.in_(symbols))
        ).scalars()
    }

    try:
        quotes = get_position_quotes(db, symbols)
    except MarketDataError as exc:
        logger.warning("Falling back to stored price history for analytics: %s", exc)
        quotes = {}

    prices = {symbol: quote.current_price for symbol, quote in quotes.items()}
    return positions, meta, prices


def build_allocation_charts(positions, meta, prices) -> dict:
    """Return allocation and current unrealized P&L data for open positions."""
    if not positions:
        return {"sectorAllocation": [], "stockAllocation": [], "pnlByStock": []}

    sector_exposure: dict[str, float] = {}
    stock_exposure: dict[str, float] = {}
    stock_pnl: dict[str, float] = {}
    total_exposure = 0.0

    for position in positions:
        qty = float(position.quantity)
        avg_cost = float(position.avg_entry_price)
        current_price = prices.get(position.symbol)

        if current_price is None:
            # A missing market price must not be converted to entry price; it
            # would make current P&L look artificially equal to zero.
            logger.warning("Skipping %s in allocation: current price missing", position.symbol)
            continue

        if qty > 0:
            exposure = qty * current_price
            pnl = (current_price - avg_cost) * qty
        else:
            short_qty = -qty
            exposure = short_qty * current_price
            pnl = (avg_cost - current_price) * short_qty

        sector = (meta.get(position.symbol).sector if meta.get(position.symbol) else None) or "Other"
        sector_exposure[sector] = sector_exposure.get(sector, 0.0) + exposure
        stock_exposure[position.symbol] = exposure
        stock_pnl[position.symbol] = pnl
        total_exposure += exposure

    sector_allocation = []
    stock_allocation = []
    pnl_by_stock = []

    if total_exposure > 0:
        for sector, exposure in sorted(sector_exposure.items(), key=lambda kv: -kv[1]):
            sector_allocation.append({
                "label": sector,
                "value": round(exposure / total_exposure * 100, 2),
                "color": SECTOR_COLORS.get(sector, DEFAULT_SECTOR_COLOR),
            })

        for i, (symbol, exposure) in enumerate(
            sorted(stock_exposure.items(), key=lambda kv: -kv[1])
        ):
            stock_allocation.append({
                "label": symbol,
                "value": round(exposure / total_exposure * 100, 2),
                "color": STOCK_PALETTE[i % len(STOCK_PALETTE)],
            })

    for symbol, pnl in stock_pnl.items():
        pnl_by_stock.append({
            "label": symbol,
            "value": round(pnl, 2),
            "color": "#20d89b" if pnl >= 0 else "#f56b6b",
        })

    return {
        "sectorAllocation": sector_allocation,
        "stockAllocation": stock_allocation,
        "pnlByStock": pnl_by_stock,
    }


def build_risk_by_stock(db: Session, positions, lookback_days: int = 90) -> list[dict]:
    """
    Per-holding annualised return % and volatility % over the trailing
    lookback window, for the risk/return scatter plot.
    """
    if not positions:
        return []

    symbols = [p.symbol for p in positions]
    start = today_ist() - timedelta(days=lookback_days)

    rows = db.execute(
        select(PriceHistory.symbol, PriceHistory.day, PriceHistory.close)
        .where(PriceHistory.symbol.in_(symbols))
        .where(PriceHistory.day >= start)
        .order_by(PriceHistory.symbol, PriceHistory.day)
    ).all()

    if not rows:
        return []

    df = pd.DataFrame(rows, columns=["symbol", "day", "close"])
    df["close"] = df["close"].astype(float)

    out = []
    for symbol, group in df.groupby("symbol"):
        closes = group.sort_values("day")["close"]
        if len(closes) < 5:
            continue
        daily_ret = closes.pct_change().dropna()
        if daily_ret.empty:
            continue
        underlying_return_pct = (closes.iloc[-1] / closes.iloc[0] - 1) * 100
        position = next((p for p in positions if p.symbol == symbol), None)
        total_return_pct = (
            underlying_return_pct
            if position is None or float(position.quantity) >= 0
            else -underlying_return_pct
        )
        vol_pct = daily_ret.std() * math.sqrt(252) * 100
        out.append(
            {
                "ticker": symbol,
                "returnPct": round(float(total_return_pct), 2),
                "volatilityPct": round(float(vol_pct), 2),
            }
        )

    return out


# Summary cards
def build_summary(
    db: Session,
    portfolio: Portfolio,
    snapshots: pd.DataFrame,
    benchmark: pd.Series,
    positions,
) -> list[dict]:
    """Build analytics summary cards from the central portfolio accounting."""
    state = build_portfolio_state(db, portfolio, positions=positions)
    portfolio_value = float(state.portfolio_value)
    total_return_pct = (
        float(state.total_profit) / float(state.net_contributed_capital) * 100
        if float(state.net_contributed_capital) > 0
        else 0.0
    )

    alpha_pct = 0.0
    if not snapshots.empty and not benchmark.empty:
        aligned_bench = benchmark.reindex(snapshots.index, method="ffill").dropna()
        if len(aligned_bench) >= 2:
            bench_return_pct = (aligned_bench.iloc[-1] / aligned_bench.iloc[0] - 1) * 100
            portfolio_return_pct = (
                snapshots["account_equity"].iloc[-1] / snapshots["account_equity"].iloc[0] - 1
            ) * 100
            alpha_pct = portfolio_return_pct - bench_return_pct

    sharpe = compute_sharpe_ratio(snapshots["daily_return"]) if not snapshots.empty else 0.0
    max_dd = compute_max_drawdown(snapshots["account_equity"]) if not snapshots.empty else 0.0

    def tone(value: float) -> str:
        return "good" if value >= 0 else "bad"

    return [
        {"label": "Portfolio Value", "value": f"₹{portfolio_value:,.0f}", "tone": "neutral"},
        {"label": "Total Return", "value": f"{total_return_pct:+.1f}%", "tone": tone(total_return_pct)},
        {"label": "Today's P&L", "value": _format_inr(float(state.today_pnl), show_plus=True), "tone": tone(float(state.today_pnl))},
        {"label": "Alpha vs NIFTY 50", "value": f"{alpha_pct:+.1f}%", "tone": tone(alpha_pct)},
        {"label": "Sharpe Ratio", "value": f"{sharpe:.2f}", "tone": tone(sharpe)},
        {"label": "Max Drawdown", "value": f"{max_dd:.1f}%", "tone": "bad" if max_dd < 0 else "neutral"},
    ]

