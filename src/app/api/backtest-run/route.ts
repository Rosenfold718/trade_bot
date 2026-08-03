import { NextRequest } from 'next/server';
import { getTursoClient } from '@/lib/db';
import { makeStrategyDecision, fetchTopSymbols } from '@/lib/trading-engine';
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

function calcAmount(balance: number, freeBalance: number, tradeSizePct: number): number {
  const maxByBalance = freeBalance * Math.min(tradeSizePct, 0.5);
  let amount: number;
  if (freeBalance < 200) amount = Math.max(1.5, Math.min(freeBalance * 0.08, 8));
  else if (freeBalance < 1000) amount = Math.max(5, Math.min(freeBalance * 0.05, 50));
  else if (freeBalance < 5000) amount = Math.max(20, Math.min(freeBalance * 0.03, 150));
  else amount = Math.max(50, Math.min(freeBalance * 0.02, 500));
  return Math.round(Math.min(amount, maxByBalance) * 100) / 100;
}

const STRATS = [
  { id: 'momentum', interval: '1h', maxOpen: 5, cooldownCandles: 3, maxDaily: 5, maxHoldHours: 8, tradeSizePct: 0.10, warmup: 120 },
  { id: 'scalper', interval: '15m', maxOpen: 5, cooldownCandles: 3, maxDaily: 8, maxHoldHours: 8, tradeSizePct: 0.08, warmup: 25 },
  { id: 'position-alpha', interval: '4h', maxOpen: 3, cooldownCandles: 2, maxDaily: 2, maxHoldHours: 168, tradeSizePct: 0.06, warmup: 250 },
];

async function simulate(
  accId: number, strat: typeof STRATS[0], balance0: number,
  candles: Map<string, CandleData[]>, symbols: string[], seed: number,
  t0: number, t1: number,
): Promise<AccountResult> {
  const trades: SimTrade[] = [];
  let bal = balance0, maxDD = 0, totPnl = 0;
  let wins = 0, losses = 0, winSum = 0, lossSum = 0;
  let rng = seed;
  const rand = () => { rng = (rng * 1664525 + 1013904223) & 0xFFFFFFFF; return (rng >>> 0) / 0xFFFFFFFF; };
  const iSec = strat.interval === '15m' ? 900 : strat.interval === '4h' ? 14400 : 3600;
  const cdMap = new Map<string, number>();
  let dayTrades = 0, lastDay = -1;

  for (let t = t0 + strat.warmup * iSec; t <= t1; t += iSec) {
    const day = Math.floor(t / 86400);
    if (day !== lastDay) { dayTrades = 0; lastDay = day; }
    if (dayTrades >= strat.maxDaily) continue;

    for (const tr of [...trades]) {
      if (tr.closeTime) continue;
      const sc = candles.get(tr.symbol);
      if (!sc) continue;
      const ci = sc.findIndex(c => c.time >= t);
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
        totPnl += tr.pnl; bal += tr.amount + tr.pnl;
        if (tr.pnl >= 0) { wins++; winSum += tr.pnl; } else { losses++; lossSum += Math.abs(tr.pnl); }
        if (reason === 'SL' || reason === 'Тайм') cdMap.set(tr.symbol, t + strat.cooldownCandles * iSec);
      }
    }

    const open = trades.filter(x => !x.closeTime);
    if (open.length >= strat.maxOpen || bal < 5) continue;

    const shuffled = [...symbols].sort(() => rand() - 0.5).slice(0, 20);
    const openSyms = new Set(open.map(x => x.symbol));
    let bSym = '', bScore = 0, bDir: 'long' | 'short' | null = null, bLev = 1, bSL = 0, bTP = 0;

    for (const sym of shuffled) {
      if (openSyms.has(sym)) continue;
      const cd = cdMap.get(sym); if (cd && t < cd) continue;
      const sc = candles.get(sym); if (!sc) continue;
      const ci = sc.findIndex(c => c.time >= t); if (ci < strat.warmup) continue;
      try {
        const d = makeStrategyDecision(strat.id, sym, sc.slice(0, ci + 1));
        if (d.direction === 'none') continue;
        const s = Math.abs(d.score);
        if (s > bScore) { bScore = s; bSym = sym; bDir = d.direction; bLev = d.leverage; bSL = d.stopLoss; bTP = d.takeProfit; }
      } catch { continue; }
    }

    if (!bDir || !bSym || bSL === 0 || bTP === 0) continue;
    const sc = candles.get(bSym)!;
    const ci = sc.findIndex(c => c.time >= t);
    const price = sc[ci].close;
    const free = Math.max(0, bal - open.reduce((s, x) => s + x.amount, 0));
    const amt = calcAmount(bal, free, strat.tradeSizePct);
    if (amt < 1) continue;

    trades.push({ id: `bt_${accId}_t${trades.length}`, symbol: bSym, strategyId: strat.id, direction: bDir, entryPrice: price, amount: amt, leverage: bLev, stopLoss: bSL, takeProfit: bTP, openTime: t });
    bal -= amt; dayTrades++;
  }

  for (const tr of trades) {
    if (tr.closeTime) continue;
    const sc = candles.get(tr.symbol); if (!sc) continue;
    const lp = sc[sc.length - 1].close;
    const pc = tr.direction === 'long' ? (lp - tr.entryPrice) / tr.entryPrice : (tr.entryPrice - lp) / tr.entryPrice;
    const fees = tr.amount * 0.001 + (tr.amount / tr.leverage) * 0.001;
    tr.pnl = tr.amount * pc * tr.leverage - fees;
    tr.closeTime = t1; tr.closePrice = lp; tr.reason = 'конец';
    totPnl += tr.pnl; bal += tr.amount + tr.pnl;
    if (tr.pnl >= 0) { wins++; winSum += tr.pnl; } else { losses++; lossSum += Math.abs(tr.pnl); }
  }

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
  };
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
  // Batch insert in chunks of 50 to avoid Turso limits
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
    async start(ctrl) {
      controller = ctrl;
    },
    async cancel() {
      controller = null;
    },
  });

  // Run backtest in background
  (async () => {
    try {
      const t1 = Math.floor(Date.now() / 1000);
      const t0 = t1 - 60 * 86400;

      send('log', { msg: '🔄 Загрузка топ-50 монет с Binance...' });
      const symbols = await fetchTopSymbols();
      send('log', { msg: `✅ ${symbols.length} монет загружено` });

      const allCandles = new Map<string, CandleData[]>();

      for (const strat of STRATS) {
        send('log', { msg: `📈 Загрузка свечей (${strat.interval}, 60 дней)...` });
        let loaded = 0;
        await Promise.all(symbols.map(async (sym) => {
          try {
            const c = await fetchCandlesBT(sym, strat.interval, t0 * 1000, t1 * 1000);
            if (c.length > 100) allCandles.set(`${sym}_${strat.interval}`, c);
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

      for (let si = 0; si < STRATS.length; si++) {
        const strat = STRATS[si];
        const stratCandles = new Map<string, CandleData[]>();
        for (const sym of symbols) {
          const c = allCandles.get(`${sym}_${strat.interval}`);
          if (c) stratCandles.set(sym, c);
        }

        send('log', { msg: `🚀 ${strat.id.toUpperCase()} (${strat.interval}): ${perStrat} аккаунтов...` });

        for (let i = 0; i < perStrat; i++) {
          const accId = si * perStrat + i + 1;
          const result = await simulate(accId, strat, 100, stratCandles, symbols, 42 + accId * 7919, t0, t1);
          results.push(result);
          doneAccounts++;
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

      // Calculate stats
      const profitable = results.filter(r => r.pnl > 0).length;
      const totalTrades = results.reduce((s, r) => s + r.totalTrades, 0);
      const avgPnlPct = results.reduce((s, r) => s + r.pnlPct, 0) / results.length;
      const best = [...results].sort((a, b) => b.pnlPct - a.pnlPct)[0];
      const worst = [...results].sort((a, b) => a.pnlPct - b.pnlPct)[0];
      const sorted = [...results].sort((a, b) => a.pnlPct - b.pnlPct);
      const median = sorted[Math.floor(sorted.length / 2)];
      const totalWins = results.reduce((s, r) => s + r.wins, 0);
      const totalLosses = results.reduce((s, r) => s + r.losses, 0);
      const globalWR = totalTrades > 0 ? ((totalWins / totalTrades) * 100).toFixed(1) : '0';
      const avgDD = (results.reduce((s, r) => s + r.maxDrawdownPct, 0) / results.length).toFixed(1);

      // PnL distribution
      const buckets = [-100, -50, -25, -10, 0, 10, 25, 50, 100, 500];
      const distribution: { from: number; to: number; count: number }[] = [];
      for (let i = 0; i < buckets.length - 1; i++) {
        const count = results.filter(r => r.pnlPct >= buckets[i] && r.pnlPct < buckets[i + 1]).length;
        if (count > 0) distribution.push({ from: buckets[i], to: buckets[i + 1], count });
      }

      // Per-strategy breakdown
      const stratStats = STRATS.map(s => {
        const sr = results.filter(r => r.strategyId === s.id);
        return {
          id: s.id,
          interval: s.interval,
          count: sr.length,
          profitable: sr.filter(r => r.pnl > 0).length,
          avgPnl: (sr.reduce((sum, r) => sum + r.pnlPct, 0) / sr.length).toFixed(1),
          avgWR: (sr.reduce((sum, r) => sum + r.winRate, 0) / sr.length).toFixed(1),
          avgDD: (sr.reduce((sum, r) => sum + r.maxDrawdownPct, 0) / sr.length).toFixed(1),
          bestPnl: Math.max(...sr.map(r => r.pnlPct)).toFixed(1),
          worstPnl: Math.min(...sr.map(r => r.pnlPct)).toFixed(1),
          totalTrades: sr.reduce((sum, r) => sum + r.totalTrades, 0),
        };
      });

      send('log', { msg: '💾 Сохранение результатов в БД...' });
      await saveResult(BACKTEST_USER_ID_BEST, best);
      await saveResult(BACKTEST_USER_ID_MEDIAN, median);
      send('log', { msg: '✅ Сохранено!' });

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
