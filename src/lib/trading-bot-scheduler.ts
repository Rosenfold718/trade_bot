/*
 * Server-side trading bot scheduler.
 * Self-starts when startTradingBot() is called.
 * Runs trading cycles every 60 seconds for all active users.
 */

import { initDB, getTraderState, getOpenTrades, openTrade, closeTrade, updateBalance, updateStopLoss, updateTakeProfit, initUserTradingData } from '@/lib/db';
import { fetchKlines, makeStrategyDecision } from '@/lib/trading-engine';
import { STRATEGIES } from '@/lib/strategies';
import { getAllSettings } from '@/lib/db';
import { getAuthClient } from '@/lib/auth-db';
import { initAuthTables } from '@/lib/init-auth-tables';
import { TOP_50_SYMBOLS } from '@/lib/types';

const CYCLE_INTERVAL_MS = 60_000;

const SYMBOLS = TOP_50_SYMBOLS;

let started = (globalThis as any).__tradingBotStarted === true;
let cycleInProgress = false;

// Helper to read system setting
function getSys(settings: Record<string, string>, key: string, defaultVal: number): number {
  const raw = settings[key];
  if (raw === undefined) return defaultVal;
  const n = parseFloat(raw);
  return isNaN(n) ? defaultVal : n;
}

// Helper to apply strategy overrides
function getEffectiveStrategies(settings: Record<string, string>) {
  return STRATEGIES.map(base => {
    const prefix = `strategy.${base.id}.`;
    const num = (field: string, fallback: number): number => {
      const raw = settings[prefix + field];
      if (raw === undefined) return fallback;
      const n = parseFloat(raw);
      return isNaN(n) ? fallback : n;
    };
    const bool = (field: string, fallback: boolean): boolean => {
      const raw = settings[prefix + field];
      return raw !== undefined ? raw === 'true' : fallback;
    };
    const str = (field: string, fallback: string): string => {
      const raw = settings[prefix + field];
      return raw !== undefined ? raw : fallback;
    };
    return {
      ...base,
      maxOpenTrades: num('maxOpenTrades', base.maxOpenTrades),
      scoreThreshold: num('scoreThreshold', base.scoreThreshold),
      mtfEnabled: bool('mtfEnabled', base.mtfEnabled),
      timeFilterEnabled: bool('timeFilterEnabled', base.timeFilterEnabled),
      timeFilterStart: num('timeFilterStart', base.timeFilterStart),
      timeFilterEnd: num('timeFilterEnd', base.timeFilterEnd),
      defaultInterval: str('defaultInterval', base.defaultInterval),
      candleLimit: num('candleLimit', base.candleLimit),
      monitorInterval: str('monitorInterval', base.monitorInterval),
      maxHoldMinutes: num('maxHoldMinutes', base.maxHoldMinutes),
      enabled: bool('enabled', base.enabled),
      riskRewardRatio: num('riskRewardRatio', base.riskRewardRatio),
      tradeSizePercent: num('tradeSizePercent', base.tradeSizePercent),
    };
  });
}

// ── Monitor open trades for a user + strategy ──
async function monitorTrades(
  userId: string, strategyId: string, strategy: any,
  settings: Record<string, string>
): Promise<{ closed: number; trailed: number }> {
  const openTrades = await getOpenTrades(userId, strategyId);
  let closedCount = 0, trailedCount = 0;

  for (const trade of openTrades) {
    try {
      const klineUrl = `https://api.binance.com/api/v3/klines?symbol=${trade.symbol}&interval=${strategy.monitorInterval}&limit=2`;
      const res = await fetch(klineUrl);
      if (!res.ok) continue;
      const data = await res.json();
      if (!Array.isArray(data) || data.length < 1) continue;

      const completed = data.length >= 2 ? data[0] : data[data.length - 1];
      const current = data.length >= 2 ? data[1] : data[data.length - 1];
      const cHigh = parseFloat(String(completed[2]));
      const cLow = parseFloat(String(completed[3]));
      const curHigh = parseFloat(String(current[2]));
      const curLow = parseFloat(String(current[3]));
      const livePrice = parseFloat(String(current[4]));

      // Auto-repair inverted SL/TP
      if (trade.stop_loss && trade.take_profit && trade.entry_price) {
        const isLong = trade.direction === 'long';
        const slBad = isLong ? trade.stop_loss >= trade.entry_price : trade.stop_loss <= trade.entry_price;
        const tpBad = isLong ? trade.take_profit <= trade.entry_price : trade.take_profit >= trade.entry_price;
        if (slBad) {
          const fixedSL = isLong ? trade.entry_price * 0.98 : trade.entry_price * 1.02;
          await updateStopLoss(trade.id, fixedSL);
          trade.stop_loss = fixedSL;
        }
        if (tpBad) {
          const fixedTP = isLong ? trade.entry_price * 1.05 : trade.entry_price * 0.95;
          await updateTakeProfit(trade.id, fixedTP);
          trade.take_profit = fixedTP;
        }
      }

      let shouldClose = false;
      let reason = '';
      let exitPrice = 0;

      // Time-based exit
      const openMs = Date.now() - new Date(trade.opened_at).getTime();
      const openMinutes = openMs / 60000;
      if (openMinutes > strategy.maxHoldMinutes) {
        const unrealizedPnl = trade.direction === 'long'
          ? (livePrice - trade.entry_price) / trade.entry_price
          : (trade.entry_price - livePrice) / trade.entry_price;
        if (unrealizedPnl < 0) {
          shouldClose = true;
          reason = `Time-exit (${Math.round(openMinutes / 60)}h)`;
          exitPrice = livePrice;
        }
      }

      // TP check
      if (!shouldClose && trade.take_profit) {
        const isLong = trade.direction === 'long';
        if (isLong && (cHigh >= trade.take_profit || curHigh >= trade.take_profit)) {
          shouldClose = true; reason = 'TP hit'; exitPrice = trade.take_profit;
        } else if (!isLong && (cLow <= trade.take_profit || curLow <= trade.take_profit)) {
          shouldClose = true; reason = 'TP hit'; exitPrice = trade.take_profit;
        }
      }

      // SL check
      if (!shouldClose && trade.stop_loss) {
        const isLong = trade.direction === 'long';
        if (isLong && (cLow <= trade.stop_loss || curLow <= trade.stop_loss)) {
          shouldClose = true; reason = 'SL hit'; exitPrice = trade.stop_loss;
        } else if (!isLong && (cHigh >= trade.stop_loss || curHigh >= trade.stop_loss)) {
          shouldClose = true; reason = 'SL hit'; exitPrice = trade.stop_loss;
        }
      }

      // Trailing stop
      if (!shouldClose && trade.stop_loss && trade.entry_price) {
        const isLong = trade.direction === 'long';
        const initialSlDist = Math.abs(trade.entry_price - trade.stop_loss);
        const favorableMove = isLong ? livePrice - trade.entry_price : trade.entry_price - livePrice;
        if (favorableMove >= initialSlDist && initialSlDist > 0) {
          const breakevenSL = isLong ? trade.entry_price * 1.001 : trade.entry_price * 0.999;
          const shouldTrail = isLong ? breakevenSL > (trade.stop_loss ?? 0) : breakevenSL < (trade.stop_loss ?? Infinity);
          if (shouldTrail) {
            await updateStopLoss(trade.id, breakevenSL);
            trailedCount++;
          }
        }
      }

      if (shouldClose) {
        const effectiveExit = exitPrice > 0 ? exitPrice : livePrice;
        const priceChange = trade.direction === 'long'
          ? (effectiveExit - trade.entry_price) / trade.entry_price
          : (trade.entry_price - effectiveExit) / trade.entry_price;
        const notional = trade.amount * trade.leverage;
        const fee = notional * 0.001 * 2;
        const pnl = trade.amount * priceChange * trade.leverage - fee;

        await closeTrade(trade.id, effectiveExit, pnl);

        const state = await getTraderState(userId, strategyId);
        if (state) {
          const newBalance = Math.max(0, state.balance + trade.amount + pnl);
          await updateBalance(userId, newBalance, strategyId);
        }

        closedCount++;
      }
    } catch (err) {
      console.error(`  [monitor] Error:`, err);
    }
  }
  return { closed: closedCount, trailed: trailedCount };
}

// ── Find signal and open trade ──
async function findAndOpen(
  userId: string, strategy: any, balance: number,
  settings: Record<string, string>
): Promise<boolean> {
  const openTrades = await getOpenTrades(userId, strategy.id);
  if (openTrades.length >= strategy.maxOpenTrades) return false;
  if (balance < 1) return false;

  // Time filter
  if (strategy.timeFilterEnabled) {
    const mskHour = parseInt(
      new Date().toLocaleTimeString('en-US', { timeZone: 'Europe/Moscow', hour: 'numeric', hour12: false }), 10
    );
    if (mskHour < strategy.timeFilterStart || mskHour > strategy.timeFilterEnd) return false;
  }

  // Daily loss limit
  const dailyLossPct = getSys(settings, 'system.dailyLossLimit', 5) / 100;
  try {
    const { tursoDb } = await import('@/lib/db');
    const r = await tursoDb.execute(
      `SELECT COALESCE(SUM(pnl), 0) as total FROM trades WHERE user_id = ? AND status = 'closed' AND closed_at > datetime('now', '-1 day')`,
      [userId]
    );
    const recentPnl = Number(r.rows[0]?.total ?? 0);
    if (recentPnl < -balance * dailyLossPct) return false;
  } catch { /* ignore */ }

  const openSymbols = new Set(openTrades.map(t => t.symbol));
  const available = SYMBOLS.filter(s => !openSymbols.has(s));
  const scanLimit = strategy.id === 'scalper' ? 30 : 20;
  const toScan = available.sort(() => Math.random() - 0.5).slice(0, scanLimit);

  let best: any = null;
  let bestScore = 0;

  for (const sym of toScan) {
    try {
      const candles = await fetchKlines(sym, strategy.defaultInterval, strategy.candleLimit);
      if (candles.length < 50) continue;
      const decision = makeStrategyDecision(strategy.id, sym, candles, 0);
      if (decision.direction !== 'none' && Math.abs(decision.score) > bestScore && Math.abs(decision.score) >= strategy.scoreThreshold) {
        bestScore = Math.abs(decision.score);
        best = { symbol: sym, decision, price: candles[candles.length - 1].close };
      }
    } catch { continue; }
  }

  if (!best) return false;

  // Position sizing
  let amount: number;
  if (balance < 200) amount = Math.max(1.5, Math.min(balance * 0.08, 8));
  else if (balance < 1000) amount = Math.max(5, Math.min(balance * 0.05, 50));
  else if (balance < 5000) amount = Math.max(20, Math.min(balance * 0.03, 150));
  else amount = Math.max(50, Math.min(balance * 0.02, 500));
  amount = Math.min(amount, balance * strategy.tradeSizePercent);

  // Cap TP distance
  const maxTPDist = best.price * getSys(settings, 'system.maxTPDistance', 15) / 100;
  let tp = best.decision.takeProfit;
  if (best.decision.direction === 'long') tp = Math.min(tp, best.price + maxTPDist);
  else tp = Math.max(tp, best.price - maxTPDist);

  await openTrade(
    userId, best.symbol, best.price, amount, best.decision.leverage,
    best.decision.direction as 'long' | 'short', best.decision.stopLoss, tp, strategy.id
  );
  await updateBalance(userId, balance - amount, strategy.id);

  return true;
}

// ── Core cycle logic (exported so both scheduler and API route can use it) ──
export async function runTradingCycle(): Promise<{ users: number; opened: number; closed: number; trailed: number; elapsed: string }> {
  const startTime = Date.now();

  await initAuthTables();
  await initDB();

  const settings = await getAllSettings();
  const strategies = getEffectiveStrategies(settings);

  // Get active subscribed users (including demo accounts with active subscriptions)
  const authDb = getAuthClient();
  const now = new Date().toISOString();
  const usersRes = await authDb.execute(
    `SELECT u.id FROM "User" u
     JOIN "Subscription" s ON s.userId = u.id
     WHERE s.isActive = 1 AND s.expiresAt > ? AND u.role != 'admin'`,
    [now]
  );
  const userIds = usersRes.rows.map(r => r.id as string);

  let totalOpened = 0;
  let totalClosed = 0;
  let totalTrailed = 0;

  for (const userId of userIds) {
    for (const strategy of strategies) {
      if (!strategy.enabled) continue;

      try {
        let state: any = null;
        try { state = await getTraderState(userId, strategy.id); } catch { /* not init */ }
        if (!state) {
          await initUserTradingData(userId);
          try { state = await getTraderState(userId, strategy.id); } catch { continue; }
        }
        if (!state || !state.is_active) continue;

        const { closed, trailed } = await monitorTrades(userId, strategy.id, strategy, settings);
        totalClosed += closed;
        totalTrailed += trailed;

        const freshState = await getTraderState(userId, strategy.id);
        if (freshState) {
          const opened = await findAndOpen(userId, strategy, freshState.balance, settings);
          if (opened) totalOpened++;
        }
      } catch (err) {
        console.error(`[cycle][${userId.slice(0, 8)}][${strategy.id}]`, err);
      }
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  return { users: userIds.length, opened: totalOpened, closed: totalClosed, trailed: totalTrailed, elapsed: `${elapsed}s` };
}

// ── Scheduler: starts the background interval ──
async function scheduledCycle() {
  if (cycleInProgress) return;
  cycleInProgress = true;
  try {
    const result = await runTradingCycle();
    console.log(`[trading-bot] ✅ ${result.elapsed} | users=${result.users} opened=${result.opened} closed=${result.closed} trailed=${result.trailed}`);
  } catch (err) {
    console.error('[trading-bot] ❌ Cycle error:', err);
  }
  cycleInProgress = false;
}

export function startTradingBot() {
  if (started) return;
  if (typeof window !== 'undefined') return;
  started = true;
  (globalThis as any).__tradingBotStarted = true;
  console.log('[trading-bot] 🤖 Background scheduler started — interval:', CYCLE_INTERVAL_MS / 1000, 's');

  setTimeout(() => {
    scheduledCycle();
    setInterval(scheduledCycle, CYCLE_INTERVAL_MS);
  }, 30_000);
}

export function isBotRunning(): boolean {
  return started;
}
