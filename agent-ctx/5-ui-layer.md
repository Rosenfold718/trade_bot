# Task 5 — UI Layer Agent Work Record

## Task: Update UI for Multi-Strategy Trading System

## Files Modified

### 1. `src/app/page.tsx` (main page)
- **Strategy Selector**: Added horizontal row of 3 strategy cards between header and main grid. Each card shows: strategy name, short description (first sentence), balance, open trade count badge. Active card highlighted with strategy-specific `borderColor`/`bgColor`/`color`.
- **Strategy-based Indicators**: Created `mergeStrategyIndicators()` helper that takes a strategyId and merges `DEFAULT_INDICATORS` with the strategy's `chartIndicators` (overriding visibility and color). When strategy changes, indicator state resets to strategy defaults while preserving user localStorage overrides for indicators that exist in the new strategy.
- **Indicator Toggles**: Chart control bar now filters indicator buttons to only show indicators defined in the active strategy's `chartIndicators`. A strategy name badge is displayed next to timeframe buttons.
- **Init**: Fetches all 3 strategies in parallel via `Promise.all(STRATEGIES.map(s => fetch('/api/init?strategyId=${s.id}')))`, stores results per-strategy using `setStrategyTraderState`, `setStrategyOpenTrades`, `setStrategyRecentTrades`.
- **Auto-trade Loop**: Completely rewritten to run ALL 3 strategies in parallel. Each cycle:
  1. Calls `Promise.all(STRATEGIES.map(s => runAutoTradeCycle(sOpenTrades, s.id, interval, balance)))` 
  2. Processes closed trades, trailing updates, new trades per-strategy
  3. All POST bodies include `strategyId`
  4. After processing, refreshes each strategy's state via per-strategy setters
- **Analyze**: Uses `activeStrategy` as the strategyId for `analyzeSymbol()`
- **Polling**: Fetches `/api/trader?strategyId=${activeStrategy}` every 15 seconds
- **Top Bar**: Balance display colored with strategy's color class
- **TradesTable**: Footer now shows both unrealized PnL (from open trades) and realized PnL (from closed trades)

### 2. `src/components/control-panel.tsx` (right sidebar controls)
- **Strategy Info Card**: Shows active strategy name (colored), full description, and risk parameters (max leverage, risk-reward ratio, max trades) in a compact card at the top.
- **Auto-trading Card**: Shows total balance across all 3 strategies, total open count, "3 СТРАТЕГИИ АКТИВНЫ" label when active. Includes a mini 3-column grid showing per-strategy balance and open trade count.
- **API Calls**: All fetch calls to `/api/credit`, `/api/backtest`, `/api/reset`, `/api/weights` now include `strategyId` in body or query params.
- **Reset**: Iterates all 3 strategies and sends reset for each. TraderState reset includes `strategy_id` field.

### 3. `src/components/trading-dashboard.tsx` (right sidebar stats)
- **Strategy Badge**: Added colored badge at top showing strategy name with a colored dot and leverage/risk params.
- **Stat Cards**: Balance card icon uses strategy color instead of hardcoded blue. Weight progress bar uses amber for neutral weights (was blue).
- **Class Composition**: All conditional classes use `cn()` utility.

## No Changes Made To
- `src/lib/` files (store, strategies, types, db, client-trader, trading-engine) — already updated
- `src/app/api/` route files — already updated by Store & API Layer agent