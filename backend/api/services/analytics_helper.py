"""
backend/api/services/analytics_helper.py

All the actual computation behind GET /api/analytics, kept separate from
the router (api/routers/analytics.py) so the math can be unit tested
without spinning up FastAPI. Every function here takes plain Python/
pandas structures in and returns plain structures out - no DB session,
no request/response objects.

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

from db.models import Order, OrderType, Portfolio, PortfolioSnapshot, Position, PriceHistory, UniverseStock

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
        .where(PortfolioSnapshot.portfolio_id == portfolio_id)
        .order_by(PortfolioSnapshot.date)
    ).scalars().all()

    if not rows:
        return pd.DataFrame(columns=["date", "portfolio_value", "cash_balance", "daily_return"])

    df = pd.DataFrame(
        [
            {
                "date": r.date,
                "portfolio_value": float(r.portfolio_value),
                "cash_balance": float(r.cash_balance),
                "daily_return": float(r.daily_return) if r.daily_return is not None else None,
            }
            for r in rows
        ]
    )
    df["date"] = pd.to_datetime(df["date"])
    df = df.set_index("date").sort_index()

    # daily_return may be NULL for early rows if the snapshot step hasn't
    # always populated it - recompute from portfolio_value as a fallback
    # rather than leaving gaps that would silently break Sharpe/vol calcs.
    pct_change = df["portfolio_value"].pct_change()
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
        select(PriceHistory.date, PriceHistory.close)
        .where(PriceHistory.symbol == MARKET_INDEX_SYMBOL)
        .where(PriceHistory.date >= start)
        .where(PriceHistory.date <= end)
        .order_by(PriceHistory.date)
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

    base_value = ranged["portfolio_value"].iloc[0]
    portfolio_rebased = ranged["portfolio_value"] / base_value * 100

    bench_ranged = benchmark.reindex(ranged.index, method="ffill") if not benchmark.empty else None
    if bench_ranged is not None and not bench_ranged.empty and not pd.isna(bench_ranged.iloc[0]):
        bench_base = bench_ranged.iloc[0]
        bench_rebased = bench_ranged / bench_base * 100
    else:
        bench_rebased = None

    pnl = ranged["portfolio_value"] - base_value
    drawdown = compute_drawdown_series(ranged["portfolio_value"])
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
    Turn a flat buy/sell Order log into a list of realized "trades" -
    one record per SELL, valued against the running average cost basis
    at the moment of that sell.

    Per-symbol, processed in chronological order:
        BUY  -> avg_cost = (avg_cost*qty + price*buy_qty) / (qty+buy_qty)
        SELL -> pnl = (sell_price - avg_cost) * sell_qty
                avg_cost is unchanged by a sell (remaining shares keep
                the same cost basis) - matches standard average-cost
                accounting, not FIFO lot-by-lot matching.

    A SELL that exceeds current tracked quantity (shouldn't happen if
    the trading engine enforces valid orders, but data can be messy) is
    clipped to the available quantity rather than going negative, and
    logged - never raises, since one bad row shouldn't break the whole
    analytics page.
    """
    by_symbol: dict[str, list[Order]] = {}
    for o in orders:
        by_symbol.setdefault(o.symbol, []).append(o)

    trades = []
    for symbol, symbol_orders in by_symbol.items():
        symbol_orders.sort(key=lambda o: o.timestamp)
        qty = 0.0
        avg_cost = 0.0

        for o in symbol_orders:
            o_qty = float(o.quantity)
            o_price = float(o.price)

            if o.order_type == OrderType.BUY.value or o.order_type == OrderType.BUY:
                new_qty = qty + o_qty
                avg_cost = (avg_cost * qty + o_price * o_qty) / new_qty if new_qty > 0 else 0.0
                qty = new_qty
            else:
                if o_qty > qty:
                    logger.warning(
                        f"SELL exceeds tracked position for {symbol} "
                        f"(sell={o_qty}, held={qty}) - clipping to {qty}"
                    )
                    o_qty = qty

                pnl = (o_price - avg_cost) * o_qty
                trades.append(
                    {
                        "symbol": symbol,
                        "date": o.timestamp.date(),
                        "quantity": o_qty,
                        "exit_price": o_price,
                        "avg_cost_at_exit": avg_cost,
                        "pnl": pnl,
                    }
                )
                qty -= o_qty

    trades.sort(key=lambda t: t["date"])
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
def load_open_positions_with_meta(db: Session, portfolio_id: int):
    positions = db.execute(
        select(Position).where(Position.portfolio_id == portfolio_id)
    ).scalars().all()

    if not positions:
        return [], {}, {}

    symbols = [p.symbol for p in positions]
    meta = {
        s.symbol: s
        for s in db.execute(select(UniverseStock).where(UniverseStock.symbol.in_(symbols))).scalars()
    }

    latest_date = db.execute(
        select(PriceHistory.date).order_by(PriceHistory.date.desc()).limit(1)
    ).scalar_one_or_none()
    prices = {}
    if latest_date is not None:
        rows = db.execute(
            select(PriceHistory.symbol, PriceHistory.close)
            .where(PriceHistory.symbol.in_(symbols))
            .where(PriceHistory.date == latest_date)
        ).all()
        prices = {sym: float(c) for sym, c in rows}

    return positions, meta, prices


def build_allocation_charts(positions, meta, prices) -> dict:
    """Returns sectorAllocation, stockAllocation, pnlByStock - all AllocationPoint[]."""
    if not positions:
        return {"sectorAllocation": [], "stockAllocation": [], "pnlByStock": []}

    sector_value: dict[str, float] = {}
    stock_value: dict[str, float] = {}
    stock_pnl: dict[str, float] = {}
    total_value = 0.0

    for pos in positions:
        qty = float(pos.quantity)
        avg_cost = float(pos.avg_entry_price)
        current_price = prices.get(pos.symbol, avg_cost)
        value = qty * current_price
        pnl = (current_price - avg_cost) * qty

        sector = (meta.get(pos.symbol).sector if meta.get(pos.symbol) else None) or "Other"
        sector_value[sector] = sector_value.get(sector, 0.0) + value
        stock_value[pos.symbol] = value
        stock_pnl[pos.symbol] = pnl
        total_value += value

    sector_allocation = []
    if total_value > 0:
        for sector, value in sorted(sector_value.items(), key=lambda kv: -kv[1]):
            sector_allocation.append(
                {
                    "label": sector,
                    "value": round(value / total_value * 100, 2),
                    "color": SECTOR_COLORS.get(sector, DEFAULT_SECTOR_COLOR),
                }
            )

    stock_allocation = []
    pnl_by_stock = []
    if total_value > 0:
        for i, (symbol, value) in enumerate(sorted(stock_value.items(), key=lambda kv: -kv[1])):
            color = STOCK_PALETTE[i % len(STOCK_PALETTE)]
            stock_allocation.append(
                {"label": symbol, "value": round(value / total_value * 100, 2), "color": color}
            )
        for symbol, pnl in stock_pnl.items():
            pnl_by_stock.append(
                {"label": symbol, "value": round(pnl, 2), "color": "#20d89b" if pnl >= 0 else "#f56b6b"}
            )

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
    start = date.today() - timedelta(days=lookback_days)

    rows = db.execute(
        select(PriceHistory.symbol, PriceHistory.date, PriceHistory.close)
        .where(PriceHistory.symbol.in_(symbols))
        .where(PriceHistory.date >= start)
        .order_by(PriceHistory.symbol, PriceHistory.date)
    ).all()

    if not rows:
        return []

    df = pd.DataFrame(rows, columns=["symbol", "date", "close"])
    df["close"] = df["close"].astype(float)

    out = []
    for symbol, group in df.groupby("symbol"):
        closes = group.sort_values("date")["close"]
        if len(closes) < 5:
            continue
        daily_ret = closes.pct_change().dropna()
        if daily_ret.empty:
            continue
        total_return_pct = (closes.iloc[-1] / closes.iloc[0] - 1) * 100
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
    portfolio: Portfolio,
    snapshots: pd.DataFrame,
    benchmark: pd.Series,
    positions,
    prices,
) -> list[dict]:
    market_value = sum(float(p.quantity) * prices.get(p.symbol, float(p.avg_entry_price)) for p in positions)
    portfolio_value = float(portfolio.cash_balance) + market_value

    total_return_pct = 0.0
    if float(portfolio.initial_capital) > 0:
        total_return_pct = (portfolio_value - float(portfolio.initial_capital)) / float(portfolio.initial_capital) * 100

    today_pnl = 0.0
    if len(snapshots) >= 2:
        today_pnl = snapshots["portfolio_value"].iloc[-1] - snapshots["portfolio_value"].iloc[-2]

    alpha_pct = 0.0
    if not snapshots.empty and not benchmark.empty:
        aligned_bench = benchmark.reindex(snapshots.index, method="ffill").dropna()
        if len(aligned_bench) >= 2:
            bench_return_pct = (aligned_bench.iloc[-1] / aligned_bench.iloc[0] - 1) * 100
            portfolio_return_pct = (
                (snapshots["portfolio_value"].iloc[-1] / snapshots["portfolio_value"].iloc[0]) - 1
            ) * 100
            alpha_pct = portfolio_return_pct - bench_return_pct

    sharpe = compute_sharpe_ratio(snapshots["daily_return"]) if not snapshots.empty else 0.0
    max_dd = compute_max_drawdown(snapshots["portfolio_value"]) if not snapshots.empty else 0.0

    def tone(v: float) -> str:
        return "good" if v >= 0 else "bad"

    return [
        {"label": "Portfolio Value", "value": f"₹{portfolio_value:,.0f}", "tone": "neutral"},
        {"label": "Total Return", "value": f"{total_return_pct:+.1f}%", "tone": tone(total_return_pct)},
        {"label": "Today's P&L", "value": _format_inr(today_pnl, show_plus=True), "tone": tone(today_pnl)},
        {"label": "Alpha vs NIFTY 50", "value": f"{alpha_pct:+.1f}%", "tone": tone(alpha_pct)},
        {"label": "Sharpe Ratio", "value": f"{sharpe:.2f}", "tone": tone(sharpe)},
        {"label": "Max Drawdown", "value": f"{max_dd:.1f}%", "tone": "bad" if max_dd < 0 else "neutral"},
    ]