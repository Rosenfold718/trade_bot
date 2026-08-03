import { NextRequest } from 'next/server';
import { getTursoClient } from '@/lib/db';
import { fetchTopSymbols, analyzeIndicators, calcATR } from '@/lib/trading-engine';
import type { CandleData } from '@/lib/types';

const ADMIN_SETUP_KEY = process.env.ADMIN_SETUP_KEY || 'trade-bot-admin-2024';
const BACKTEST_USER_ID_BEST = 'backtest_100_best';
const BACKTEST_USER_ID_MEDIAN = 'backtest_100_median';

function checkAuth(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization');
  return authHeader === `Bearer ${ADMIN_SETUP_KEY}`;
}

export const maxDuration = 300;

interface SimTrade {
  id: string;
  symbol: string;
  strategyId: string;
  direction: 'long' | 'short';
  entryPrice: number;
  amount: number;
  leverage: number;
  stopLoss: number;
  takeProfit: number;
  openTime: number;
  closeTime?: number;
  closePrice?: number;
  pnl?: number;
  reason?: string;
}

interface AccountResult {
  id: number;
  strategyId: string;
  startBalance: number;
  endBalance: number;
  pnl: number;
  pnlPct: number;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  maxDrawdownPct: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  trades: SimTrade[];
}

async function fetchCandlesBT(symbol: string, interval: string, startTime: number, endTime: number): Promise<CandleData[]> {
  const all: CandleData[] = [];
  let cur = startTime;
  while (cur < endTime) {
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&startTime=${cur}&endTime=${endTime}&limit=1500`;
    const res = await fetch(url);
    if (!res.ok) break;
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) break;
    for (const k of data) {
      all.push({ time: Math.floor(Number(k[0]) / 1000), open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] });
    }
    cur = Number(data[data.length - 1][6]) + 1;
    if (data.length < 1500) break;
  }
  return all;
}

function calcAmount(balance: number, freeBalance: number): number {
  if (freeBalance < 5) return 0;
  if (freeBalance < 50) return Math.min(Math.max(freeBalance * 0.10, 1.5), 8);
  if (freeBalance < 200) return Math.min(Math.max(freeBalance * 0.06, 5), 30);
  return Math.min(Math.max(freeBalance * 0.04, 10), 50);
}

const STRATS = [
  { id: 'momentum', label: 'Momentum Pro', interval: '1h', maxOpen: 4, cooldownCandles: 3, maxDaily: 4, maxHoldHours: 12, rr: 2.5, warmup: 60 },
  { id: 'scalper', label: 'Pattern Pro', interval: '15m', maxOpen: 4, cooldownCandles: 4, maxDaily: 6, maxHoldHours: 6, rr: 2.0, warmup: 50 },
  { id: 'position-alpha', label: 'Position Alpha', interval: '4h', maxOpen: 2, cooldownCandles: 2, maxDaily: 2, maxHoldHours: 120, rr: 3.0, warmup: 60 },
];

// Build O(1) lookup: candleTime → index in the array
type TimeMap = Map<number, number>;
function buildTimeMap(candles: CandleData[]): TimeMap {
  const m = new Map<number, number>();
  for (let i = 0; i < candles.length; i++) m.set(candles[i].time, i);
  return m;
}

// Find candle index at or just after timestamp t (O(1) average)
function findCandleIdx(candles: CandleData[], tm: TimeMap, t: number): number {
  let idx = tm.get(t);
  if (idx !== undefined) return idx;
  // No exact match — find next available candle
  for (let d = 1; d <= 5; d++) {
    idx = tm.get(t - d);
    if (idx !== undefined) return idx;
  }
  // Fallback: binary search
  let lo = 0, hi = candles.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (candles[mid].time < t) lo = mid + 1; else hi = mid;
  }
  return lo;
}

// Simple, fast backtest signal generator
// Uses analyzeIndicators (10 indicators) with confluence ≥3 instead of ≥4
function btSignal(
  candles: CandleData[],
  idx: number,
  atr: number,
  price: number,
  rr: number,
): { direction: 'long' | 'short' | null; leverage: number; sl: number; tp: number } {
  if (idx < 50) return { direction: null, leverage: 1, sl: 0, tp: 0 };
  const slice = candles.slice(0, idx + 1);
  const indicators = analyzeIndicators(slice, {});
  if (indicators.length === 0) return { direction: null, leverage: 1, sl: 0, tp: 0 };

  let longCount = 0, shortCount = 0, longScore = 0, shortScore = 0;
  for (const ind of indicators) {
    if (ind.signal > 0) { longCount++; longScore += ind.strength; }
    else if (ind.signal < 0) { shortCount++; shortScore += ind.strength; }
  }

  // Confluence: require ≥3 of 10 (relaxed from 4)
  const bestCount = Math.max(longCount, shortCount);
  if (bestCount < 3) return { direction: null, leverage: 1, sl: 0, tp: 0 };

  const absLong = Math.abs(longScore);
  const absShort = Math.abs(shortScore);
  const score = Math.max(absLong, absShort);
  // Lower score threshold for backtest: 0.10 instead of 0.20
  if (score < 0.10) return { direction: null, leverage: 1, sl: 0, tp: 0 };

  const direction: 'long' | 'short' | null = absLong >= absShort ? 'long' : 'short';
  const leverage = Math.min(5, Math.max(2, Math.round(score * 3)));

  // SL: 2.5× ATR, capped at 8%
  const slPct = Math.max(0.008, Math.min(2.5 * atr / price, 0.08));
  // TP: SL × risk/reward ratio, capped at 15%
  const tpPct = Math.min(slPct * rr, 0.15);

  const sl = direction === 'long' ? price * (1 - slPct) : price * (1 + slPct);
  const tp = direction === 'long' ? price * (1 + tpPct) : price * (1 - tpPct);

  return { direction, leverage, sl, tp };
}

function simulate(
  accId: number, strat: typeof STRATS[0], balance0: number,
  candleData: Map<string, CandleData[]>, timeMaps: Map<string, TimeMap>,
  symbols: string[], seed: number, t0: number, t1: number,
): AccountResult {
  const trades: SimTrade[] = [];
  let bal = balance0, maxDD = 0;
  let wins = 0, losses = 0, winSum = 0, lossSum = 0;
  let rng = seed;
  const rand = () => { rng = (rng * 1664525 + 1013904223) & 0xFFFFFFFF; return (rng >>> 0) / 0xFFFFFFFF; };
  const iSec = strat.interval === '15m' ? 900 : strat.interval === '4h' ? 14400 : 3600;
  const cdMap = new Map<string, number>();
  let dayTrades = 0, lastDay = -1;
  let totalEvals = 0, signalFound = 0;

  // Pre-filter to only symbols that have enough candles
  const validSymbols = symbols.filter(s => {
    const cd = candleData.get(s);
    return cd && cd.length >= strat.warmup + 10;
  });

  for (let t = t0 + strat.warmup * iSec; t <= t1; t += iSec) {
    const day = Math.floor(t / 86400);
    if (day !== lastDay) { dayTrades = 0; lastDay = day; }
    if (dayTrades >= strat.maxDaily) continue;

    // Close existing trades
    for (const tr of trades) {
      if (tr.closeTime) continue;
      const sc = candleData.get(tr.symbol);
      const tm = timeMaps.get(tr.symbol);
      if (!sc || !tm) continue;
      const ci = findCandleIdx(sc, tm, t);
      if (ci < 1) continue;
      const c = sc[ci];
      let close = false, reason = '', exit = c.close;
      if (tr.direction === 'long') {
        if (c.low <= tr.stopLoss) { close = true; reason = 'SL'; exit = tr.stopLoss; }
        else if (c.high >= tr.takeProfit) { close = true; reason = 'TP'; exit = tr.takeProfit; }
      } else {
        if (c.high >= tr.stopLoss) { close = true; reason = 'SL'; exit = tr.stopLoss; }
        else if (c.low <= tr.takeProfit) { close = true; reason = 'TP'; exit = tr.takeProfit; }
      }
      if (!close && (t - tr.openTime) / 3600 > strat.maxHoldHours) { close = true; reason = 'Тайм'; exit = c.close; }
      if (close) {
        tr.closeTime = t; tr.closePrice = exit;
        const pc = tr.direction === 'long' ? (exit - tr.entryPrice) / tr.entryPrice : (tr.entryPrice - exit) / tr.entryPrice;
        const fees = tr.amount * 0.001 + (tr.amount / tr.leverage) * 0.001;
        tr.pnl = tr.amount * pc * tr.leverage - fees;
        tr.reason = reason;
        bal += tr.amount + tr.pnl;
        if (tr.pnl >= 0) { wins++; winSum += tr.pnl; } else { losses++; lossSum += Math.abs(tr.pnl); }
        if (reason === 'SL' || reason === 'Тайм') cdMap.set(tr.symbol, t + strat.cooldownCandles * iSec);
      }
    }

    // Check if we can open new trades
    const open = trades.filter(x => !x.closeTime);
    if (open.length >= strat.maxOpen || bal < 5) continue;

    // Shuffle and pick up to 20 symbols to evaluate
    const shuffled = [...validSymbols].sort(() => rand() - 0.5).slice(0, 20);
    const openSyms = new Set(open.map(x => x.symbol));
    let bSym = '', bScore = 0, bDir: 'long' | 'short' | null = null, bLev = 1, bSL = 0, bTP = 0;

    for (const sym of shuffled) {
      if (openSyms.has(sym)) continue;
      const cd = cdMap.get(sym); if (cd && t < cd) continue;
      const sc = candleData.get(sym);
      const tm = timeMaps.get(sym);
      if (!sc || !tm) continue;
      const ci = findCandleIdx(sc, tm, t);
      if (ci < strat.warmup) continue;

      totalEvals++;
      const atr = calcATR(sc.slice(Math.max(0, ci - 20), ci + 1));
      const price = sc[ci].close;
      if (atr <= 0 || price <= 0) continue;

      const sig = btSignal(sc, ci, atr, price, strat.rr);
      if (!sig.direction) continue;

      signalFound++;
      bScore = 1; bSym = sym; bDir = sig.direction; bLev = sig.leverage; bSL = sig.sl; bTP = sig.tp;
      break; // take first valid signal to save time
    }

    if (!bDir || !bSym || bSL === 0 || bTP === 0) continue;
    const sc = candleData.get(bSym)!;
    const tm = timeMaps.get(bSym)!;
    const ci = findCandleIdx(sc, tm, t);
    const price = sc[ci].close;
    const free = Math.max(0, bal - open.reduce((s, x) => s + x.amount, 0));
    const amt = calcAmount(bal, free);
    if (amt < 1) continue;

    trades.push({ id: `bt_${accId}_t${trades.length}`, symbol: bSym, strategyId: strat.id, direction: bDir, entryPrice: price, amount: amt, leverage: bLev, stopLoss: bSL, takeProfit: bTP, openTime: t });
    bal -= amt; dayTrades++;
  }

  // Close remaining open trades at last price
  for (const tr of trades) {
    if (tr.closeTime) continue;
    const sc = candleData.get(tr.symbol); if (!sc) continue;
    const lp = sc[sc.length - 1].close;
    const pc = tr.direction === 'long' ? (lp - tr.entryPrice) / tr.entryPrice : (tr.entryPrice - lp) / tr.entryPrice;
    const fees = tr.amount * 0.001 + (tr.amount / tr.leverage) * 0.001;
    tr.pnl = tr.amount * pc * tr.leverage - fees;
    tr.closeTime = t1; tr.closePrice = lp; tr.reason = 'конец';
    bal += tr.amount + tr.pnl;
    if (tr.pnl >= 0) { wins++; winSum += tr.pnl; } else { losses++; lossSum += Math.abs(tr.pnl); }
  }

  // Max drawdown
  let peak = balance0, run = balance0;
  for (const tr of trades) {
    if (!tr.closeTime) continue;
    run += tr.amount + (tr.pnl ?? 0);
    if (run > peak) peak = run;
    const dd = peak > 0 ? ((peak - run) / peak) * 100 : 0;
    if (dd > maxDD) maxDD = dd;
  }

  return {
    id: accId, strategyId: strat.id, startBalance: balance0,
    endBalance: Math.round(bal * 100) / 100,
    pnl: Math.round((bal - balance0) * 100) / 100,
    pnlPct: Math.round(((bal - balance0) / balance0) * 10000) / 100,
    totalTrades: trades.length, wins, losses,
    winRate: trades.length > 0 ? Math.round((wins / trades.length) * 1000) / 10 : 0,
    maxDrawdownPct: Math.round(maxDD * 10) / 10,
    avgWin: wins > 0 ? Math.round((winSum / wins) * 100) / 100 : 0,
    avgLoss: losses > 0 ? Math.round((lossSum / losses) * 100) / 100 : 0,
    profitFactor: lossSum > 0 ? Math.round((winSum / lossSum) * 100) / 100 : wins > 0 ? 99.99 : 0,
    trades,
    _debug: { totalEvals, signalFound },
  } as any;
}

async function saveResult(userId: string, result: AccountResult) {
  const db = getTursoClient();
  await db.execute({ sql: `DELETE FROM trades WHERE user_id = ?`, args: [userId] });
  await db.execute({ sql: `DELETE FROM trader_state WHERE user_id = ?`, args: [userId] });
  await db.execute({
    sql: `INSERT INTO trader_state (id, user_id, strategy_id, balance, borrowed_funds, debt_to_repay, is_active, initial_balance, updated_at) VALUES (?, ?, ?, ?, 0, 0, 0, ?, datetime('now'))`,
    args: [`bt_${userId}`, userId, result.strategyId, result.endBalance, result.startBalance],
  });
  const batchStmts = result.trades.map(tr => ({
    sql: `INSERT INTO trades (id, user_id, symbol, strategy_id, entry_price, exit_price, amount, leverage, direction, pnl, status, stop_loss, take_profit, opened_at, closed_at, remaining_amount, entry_quality, partial_state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 'full')`,
    args: [`${userId}_${tr.id}`, userId, tr.symbol, tr.strategyId, tr.entryPrice, tr.closePrice ?? null, tr.amount, tr.leverage, tr.direction, tr.pnl ?? null, 'closed', tr.stopLoss, tr.takeProfit, new Date(tr.openTime * 1000).toISOString(), tr.closeTime ? new Date(tr.closeTime * 1000).toISOString() : null, null] as any[],
  }));
  for (let i = 0; i < batchStmts.length; i += 50) {
    await db.batch(batchStmts.slice(i, i + 50));
  }
}

// POST /api/backtest-run — SSE streaming (admin only)
export async function POST(request: NextRequest) {
  if (!checkAuth(request)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController | null = null;

  const send = (event: string, data: any) => {
    if (!controller) return;
    controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
  };

  const stream = new ReadableStream({
    async start(ctrl) { controller = ctrl; },
    async cancel() { controller = null; },
  });

  (async () => {
    try {
      const t1 = Math.floor(Date.now() / 1000);
      const t0 = t1 - 60 * 86400;

      send('log', { msg: '🔄 Загрузка топ-50 монет с Binance...' });
      const symbols = await fetchTopSymbols();
      send('log', { msg: `✅ ${symbols.length} монет загружено` });

      const allCandles = new Map<string, CandleData[]>();
      const allTimeMaps = new Map<string, TimeMap>();

      for (const strat of STRATS) {
        send('log', { msg: `📈 Загрузка свечей (${strat.interval}, 60 дней)...` });
        let loaded = 0;
        await Promise.all(symbols.map(async (sym) => {
          try {
            const c = await fetchCandlesBT(sym, strat.interval, t0 * 1000, t1 * 1000);
            if (c.length > 50) {
              const key = `${sym}_${strat.interval}`;
              allCandles.set(key, c);
              allTimeMaps.set(key, buildTimeMap(c));
            }
            loaded++;
            if (loaded % 10 === 0) send('progress', { stage: 'candles', interval: strat.interval, current: loaded, total: symbols.length });
          } catch { /* skip */ }
        }));
        const count = [...allCandles.keys()].filter(k => k.endsWith(strat.interval)).length;
        send('log', { msg: `  ✅ ${count} монет (${strat.interval})` });
      }

      const results: AccountResult[] = [];
      const perStrat = 34;
      const totalAccounts = STRATS.length * perStrat;
      let doneAccounts = 0;
      let globalEvals = 0, globalSignals = 0;

      for (let si = 0; si < STRATS.length; si++) {
        const strat = STRATS[si];
        const stratCandles = new Map<string, CandleData[]>();
        const stratTimeMaps = new Map<string, TimeMap>();
        for (const sym of symbols) {
          const c = allCandles.get(`${sym}_${strat.interval}`);
          const tm = allTimeMaps.get(`${sym}_${strat.interval}`);
          if (c && tm) { stratCandles.set(sym, c); stratTimeMaps.set(sym, tm); }
        }

        send('log', { msg: `🚀 ${strat.label} (${strat.interval}): ${perStrat} аккаунтов...` });

        for (let i = 0; i < perStrat; i++) {
          const accId = si * perStrat + i + 1;
          const result = simulate(accId, strat, 100, stratCandles, stratTimeMaps, symbols, 42 + accId * 7919, t0, t1);
          results.push(result);
          doneAccounts++;
          globalEvals += (result as any)._debug?.totalEvals ?? 0;
          globalSignals += (result as any)._debug?.signalFound ?? 0;
          const e = result.pnl >= 0 ? '✅' : '❌';
          send('account', {
            id: accId, strategyId: strat.id, totalTrades: result.totalTrades,
            winRate: result.winRate, pnlPct: result.pnlPct, emoji: e,
          });
          send('progress', {
            stage: 'simulate', strategyId: strat.id,
            current: doneAccounts, total: totalAccounts,
          });
        }
      }

      // Diagnostics
      send('log', { msg: `📊 Диагностика: ${globalEvals} оценок, ${globalSignals} сигналов (${(globalSignals / Math.max(globalEvals, 1) * 100).toFixed(1)}%)` });

      // Calculate stats
      const profitable = results.filter(r => r.pnl > 0).length;
      const totalTrades = results.reduce((s, r) => s + r.totalTrades, 0);
      const avgPnlPct = results.reduce((s, r) => s + r.pnlPct, 0) / results.length;
      const best = [...results].sort((a, b) => b.pnlPct - a.pnlPct)[0];
      const worst = [...results].sort((a, b) => a.pnlPct - b.pnlPct)[0];
      const sorted = [...results].sort((a, b) => a.pnlPct - b.pnlPct);
      const median = sorted[Math.floor(sorted.length / 2)];
      const totalWins = results.reduce((s, r) => s + r.wins, 0);
      const globalWR = totalTrades > 0 ? ((totalWins / totalTrades) * 100).toFixed(1) : '0';
      const avgDD = (results.reduce((s, r) => s + r.maxDrawdownPct, 0) / results.length).toFixed(1);

      const buckets = [-100, -50, -25, -10, 0, 10, 25, 50, 100, 500];
      const distribution: { from: number; to: number; count: number }[] = [];
      for (let i = 0; i < buckets.length - 1; i++) {
        const count = results.filter(r => r.pnlPct >= buckets[i] && r.pnlPct < buckets[i + 1]).length;
        if (count > 0) distribution.push({ from: buckets[i], to: buckets[i + 1], count });
      }

      const stratStats = STRATS.map(s => {
        const sr = results.filter(r => r.strategyId === s.id);
        return {
          id: s.id,
          interval: s.interval,
          count: sr.length,
          profitable: sr.filter(r => r.pnl > 0).length,
          avgPnl: sr.length > 0 ? (sr.reduce((sum, r) => sum + r.pnlPct, 0) / sr.length).toFixed(1) : '0.0',
          avgWR: sr.length > 0 ? (sr.reduce((sum, r) => sum + r.winRate, 0) / sr.length).toFixed(1) : '0.0',
          avgDD: sr.length > 0 ? (sr.reduce((sum, r) => sum + r.maxDrawdownPct, 0) / sr.length).toFixed(1) : '0.0',
          bestPnl: sr.length > 0 ? Math.max(...sr.map(r => r.pnlPct)).toFixed(1) : '0.0',
          worstPnl: sr.length > 0 ? Math.min(...sr.map(r => r.pnlPct)).toFixed(1) : '0.0',
          totalTrades: sr.reduce((sum, r) => sum + r.totalTrades, 0),
        };
      });

      send('log', { msg: '💾 Сохранение лучших результатов в БД...' });
      try { await saveResult(BACKTEST_USER_ID_BEST, best); } catch (e: any) { send('log', { msg: `⚠️ Ошибка сохранения best: ${e.message}` }); }
      try { await saveResult(BACKTEST_USER_ID_MEDIAN, median); } catch (e: any) { send('log', { msg: `⚠️ Ошибка сохранения median: ${e.message}` }); }
      send('log', { msg: '✅ Готово!' });

      send('done', {
        profitable,
        totalTrades,
        avgPnlPct: avgPnlPct.toFixed(1),
        bestPnl: best.pnlPct,
        worstPnl: worst.pnlPct,
        medianPnl: median.pnlPct,
        globalWR,
        avgDD,
        stratStats,
        distribution,
        bestUserId: BACKTEST_USER_ID_BEST,
        medianUserId: BACKTEST_USER_ID_MEDIAN,
        allResults: results.map(r => ({
          id: r.id, strategyId: r.strategyId, pnlPct: r.pnlPct,
          totalTrades: r.totalTrades, winRate: r.winRate, maxDrawdownPct: r.maxDrawdownPct,
          profitFactor: r.profitFactor,
        })),
      });
    } catch (err: any) {
      send('error', { msg: err.message });
    } finally {
      controller?.close();
    }
  })();

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

// GET /api/backtest-run — статус
export async function GET() {
  return Response.json({ status: 'ready' });
}
