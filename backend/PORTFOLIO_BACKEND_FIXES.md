# Paper Trading Backend — Portfolio / P&L Accounting Fixes

## What was fixed

The uploaded backend had several different definitions of portfolio value and profit/loss. The corrected version makes live valuation, holdings, dashboard, analytics, trade execution, and EOD snapshots use the same accounting rules.

### 1. One source of truth for live portfolio valuation

Added `api/services/portfolio_accounting.py`.

For a long position:

- Market value = `quantity × current_price`
- Cost basis = `quantity × average_entry_price`
- Unrealized P&L = `(current_price - average_entry_price) × quantity`
- Day P&L = `(current_price - previous_close) × quantity`

For a short position, the simulator treats the short sale proceeds as non-spendable cash and uses the existing locked-margin model:

- Equity contribution = `margin_locked + (average_entry_price - current_price) × abs(quantity)`
- Unrealized P&L = `(average_entry_price - current_price) × abs(quantity)`
- Day P&L = `(previous_close - current_price) × abs(quantity)`
- Gross exposure = `abs(quantity) × current_price`

Overall:

`portfolio_value / equity = cash_balance + long_market_value + short_margin + short_unrealized_pnl`

`total_profit = current_equity - initial_capital`

This means realized profit remains part of total account profit after a position is closed.

### 2. Dashboard and Portfolio now agree

`api/routers/dashboard.py` and `api/routers/portfolio.py` both call `build_portfolio_state()`.

The stored `Portfolio.portfolio_value` field is now only a cache. It is not used as the authoritative live value, so the two pages cannot disagree merely because one is reading a stale database value.

### 3. Holdings now show the actual current market price

`PortfolioHoldingOut.currentPrice` now comes from the shared live market-data service.

The old behavior that could fall back to `avg_entry_price` has been removed. When live data is unavailable, the backend falls back to stored EOD `PriceHistory` rather than manufacturing a zero-P&L mark from the entry price.

Each holding also returns backend-computed:

- `unrealizedPnL`
- `dayPnL`
- `marketValue`

### 4. Shared market-data implementation

Added `api/services/market_data.py`.

It is now the single quote implementation used by:

- `/api/stocks`
- `/api/dashboard`
- `/api/portfolio`
- trade execution

During the NSE session it uses the latest available regular-session 1-minute price. After the session it uses the latest completed session close.

`previous_close` is explicitly taken from the trading session before the current/latest session, rather than accidentally treating an older row as today's price.

A short 10-second in-process cache prevents two endpoints requested close together from receiving different marks because of separate quote downloads.

### 5. Trade execution no longer trusts a browser-supplied price

`api/services/trade_service.py` now obtains execution prices on the backend from the shared market-data service.

`OrderRequest.price` remains accepted only for backward compatibility; API execution ignores it.

This matters because portfolio accounting is only meaningful if the recorded execution price is the price actually used by the backend.

Trusted internal code/tests may pass `execution_prices` directly.

### 6. Long/short execution accounting was corrected and made Decimal-based

The execution engine now uses `Decimal` for monetary arithmetic and handles:

- weighted-average long entries
- long sells and realized P&L
- opening/add-to-short margin
- partial and full short covers
- short-to-long flips
- long-to-short flips

The portfolio row and locked position rows are also locked during execution so concurrent requests cannot both spend the same cash balance.

### 7. Today's P&L is no longer a static snapshot-only number

For a request made today:

`todayPnL = current_equity - previous_trading_day_close_equity`

The previous-close account state is reconstructed from the order ledger and then marked to the exact previous trading day's close.

That keeps today's P&L correct even when a position was opened, partially closed, fully closed, or flipped during today.

### 8. Historical P&L / performance snapshots are now actually produced

The old cron flow had TODOs around snapshots and short mark-to-market.

`jobs/cron_job.py` now performs, for a real trading day:

1. EOD price ingestion
2. short maintenance-margin / force-close processing using that exact day
3. EOD portfolio snapshot creation/update
4. characteristics computation

`api/services/portfolio_accounting.write_daily_snapshots()` reconstructs historical holdings from the immutable order ledger instead of using today's current `Position` table to pretend that those were the historical holdings.

Added `jobs/rebuild_snapshots.py` for repairing existing snapshot history.

### 9. Short analytics were corrected

`api/services/analytics_helper.py` now uses signed average-cost matching for realized trades and correctly handles short round trips and direction flips.

Short risk/return contribution is also direction-aware rather than treating a short like a long.

Sector/stock allocation uses gross exposure (`abs(quantity) × current_price`) so short positions do not create negative allocation percentages.

### 10. Historical price consistency was improved

`data/stock_price_fetch_migration.py` was changed from adjusted historical prices to raw prices (`auto_adjust=False`) so stored execution/valuation prices use the same price convention as the live quote path.

The daily migration now also handles an empty individual ticker without aborting the complete batch and closes/rolls back its database session safely.

## Files changed

### New

- `api/services/market_data.py`
- `api/services/portfolio_accounting.py`
- `jobs/rebuild_snapshots.py`
- `tests/test_trade_service.py`
- `tests/test_analytics.py`
- `tests/test_portfolio_accounting.py`

### Modified

- `api/routers/dashboard.py`
- `api/routers/portfolio.py`
- `api/routers/trade.py`
- `api/routers/analytics.py`
- `api/schemas/portfolio.py`
- `api/schemas/trade.py`
- `api/services/analytics_helper.py`
- `api/services/trade_service.py`
- `data/stock_price_fetch_migration.py`
- `jobs/cron_job.py`

## Important deployment / data-repair steps

### Existing portfolio snapshots

Run the one-time snapshot rebuild after deploying the corrected code:

```bash
cd backend
# activate your normal virtual environment first
PYTHONPATH=. python -m jobs.rebuild_snapshots
```

The utility uses the earliest available `PriceHistory.day` through today and reconstructs EOD account value from the order ledger.

### Existing PriceHistory data

The corrected fetcher uses `auto_adjust=False`. If the existing `PriceHistory` table was populated by the old `auto_adjust=True` implementation, reloading/backfilling that history is recommended before relying on long-term comparisons between old and new values.

### Existing Order prices

Trades executed before this fix may already contain browser-supplied prices. The new code cannot safely infer the exact historical execution price from the existing `Order` row alone. Those records should be reconciled separately if they are known to be incorrect.

### Capital changes

`/profile/capital` is now restricted after the first trade/snapshot. The current schema does not contain a deposit/withdrawal cash ledger, so allowing arbitrary post-trade capital edits would make return and historical P&L accounting internally inconsistent.

## Frontend refresh requirement

The backend now recalculates the live price, holdings P&L, and portfolio value on every request. The frontend still has to request the endpoint again to display a new value.

Therefore, if the frontend currently fetches `/api/dashboard` or `/api/portfolio` only once when the page mounts, the UI will remain visually static even though the backend is correct. Periodic polling or a push mechanism is needed for continuous on-screen updates. The uploaded archive did not contain the frontend source needed to change that behavior.

## Verification

Regression tests added for:

- long weighted-average cost
- long realized profit
- short mark-to-market equity
- short cover profit + margin release
- short-to-long flip
- long-to-short flip
- mixed long/short equity

Result:

```text
8 passed
```

All Python source files in the corrected backend also compile successfully.

## GitHub note

The supplied GitHub branch URL could not be fetched in this environment, so the correction was based on the uploaded `gpt.zip`. The archive is the authoritative corrected source delivered from this review.

## Database migration note

These accounting changes use the existing `Position.margin_locked` field already present in the uploaded schema/migration. No new Alembic migration is required solely for these code changes.
