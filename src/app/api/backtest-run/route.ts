import { NextResponse } from 'next/server';
import { getTursoClient } from '@/lib/db';
import { makeStrategyDecision, fetchKlines, fetchTopSymbols } from '@/lib/trading-engine';
import type { CandleData } from '@/lib/types';

const BACKTEST_USER_ID_BEST = 'backtest_100_best';
const BACKTEST_USER_ID_MEDIAN = 'backtest_100_median';

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
  t0: number, t1: number, log: (msg: string) => void,
): Promise<AccountResult> {
  const trades: SimTrade[] = [];
  let bal = balance0, maxBal = bal, maxDD = 0, totPnl = 0;
  let wins = 0, losses = 0, winSum = 0, lossSum = 0;
  let rng = seed;
  const rand = () => { rng = (rng * 1664525 + 1013904223) & 0xFFFFFFFF; return (rng >>> 0) / 0xFFFFFFFF; };
  const iSec = strat.interval === '15m' ? 900 : strat.interval === '4h' ? 14400 : 3600;
  const cdMap = new Map<string, number>(); // cooldowns
  let dayTrades = 0, lastDay = -1;

  for (let t = t0 + strat.warmup * iSec; t <= t1; t += iSec) {
    const day = Math.floor(t / 86400);
    if (day !== lastDay) { dayTrades = 0; lastDay = day; }
    if (dayTrades >= strat.maxDaily) continue;

    // Check open trades
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

  // Close remaining
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

  // Max DD
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
  for (const tr of result.trades) {
    await db.execute({
      sql: `INSERT INTO trades (id, user_id, symbol, strategy_id, entry_price, exit_price, amount, leverage, direction, pnl, status, stop_loss, take_profit, opened_at, closed_at, remaining_amount, entry_quality, partial_state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 'full')`,
      args: [`${userId}_${tr.id}`, userId, tr.symbol, tr.strategyId, tr.entryPrice, tr.closePrice ?? null, tr.amount, tr.leverage, tr.direction, tr.pnl ?? null, 'closed', tr.stopLoss, tr.takeProfit, new Date(tr.openTime * 1000).toISOString(), tr.closeTime ? new Date(tr.closeTime * 1000).toISOString() : null, null],
    });
  }
}

// POST /api/backtest-run
export async function POST(req: Request) {
  const logs: string[] = [];
  const log = (m: string) => { logs.push(m); console.log(m); };

  try {
    const t1 = Math.floor(Date.now() / 1000);
    const t0 = t1 - 60 * 86400;

    log('🔄 Загрузка топ-50 монет...');
    const symbols = await fetchTopSymbols();
    log(`✅ ${symbols.length} монет`);

    const allCandles = new Map<string, CandleData[]>();
    for (const strat of STRATS) {
      log(`
📈 Загрузка свечей (${strat.interval}, 60 дней)...`);
      await Promise.all(symbols.map(async (sym) => {
        try {
          const c = await fetchCandlesBT(sym, strat.interval, t0 * 1000, t1 * 1000);
          if (c.length > 100) allCandles.set(`${sym}_${strat.interval}`, c);
        } catch { /* skip */ }
      }));
      log(`  ✅ ${[...allCandles.keys()].filter(k => k.endsWith(strat.interval)).length} монет (${strat.interval})`);
    }

    const results: AccountResult[] = [];
    const perStrat = 34;

    for (let si = 0; si < STRATS.length; si++) {
      const strat = STRATS[si];
      const stratCandles = new Map<string, CandleData[]>();
      for (const sym of symbols) {
        const c = allCandles.get(`${sym}_${strat.interval}`);
        if (c) stratCandles.set(sym, c);
      }

      log(`
🚀 ${strat.id} (${strat.interval}): ${perStrat} аккаунтов...`);
      for (let i = 0; i < perStrat; i++) {
        const accId = si * perStrat + i + 1;
        const result = await simulate(accId, strat, 100, stratCandles, symbols, 42 + accId * 7919, t0, t1, log);
        results.push(result);
        const e = result.pnl >= 0 ? '✅' : '❌';
        log(`  #${String(accId).padStart(3)}: ${result.totalTrades} сделок | ${result.winRate}% WR | ${result.pnl >= 0 ? '+' : ''}${result.pnlPct}% ${e}`);
      }
    }

    // Stats
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

    log(`
${'━'.repeat(50)}`);
    log(`  СВОДКА: ${profitable}/100 прибыльных`);
    log(`  Средний PnL: ${avgPnlPct >= 0 ? '+' : ''}${avgPnlPct.toFixed(1)}%`);
    log(`  Лучший: +${best.pnlPct.toFixed(1)}% (#${best.id} ${best.strategyId})`);
    log(`  Худший: ${worst.pnlPct.toFixed(1)}% (#${worst.id} ${worst.strategyId})`);
    log(`  Медиана: ${median.pnlPct >= 0 ? '+' : ''}${median.pnlPct.toFixed(1)}%`);
    log(`  Всего сделок: ${totalTrades} (${totalWins}W/${totalLosses}L) WR: ${globalWR}%`);

    // Save best + median to DB
    log(`
💾 Сохранение лучшего и медианного в БД...`);
    await saveResult(BACKTEST_USER_ID_BEST, best);
    await saveResult(BACKTEST_USER_ID_MEDIAN, median);
    log('✅ Сохранено!');

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
        bestPnl: Math.max(...sr.map(r => r.pnlPct)).toFixed(1),
        worstPnl: Math.min(...sr.map(r => r.pnlPct)).toFixed(1),
      };
    });

    return NextResponse.json({
      success: true,
      summary: { profitable, totalTrades, avgPnlPct: avgPnlPct.toFixed(1), bestPnl: best.pnlPct, worstPnl: worst.pnlPct, medianPnl: median.pnlPct, globalWR, stratStats },
      logs: logs.slice(-50),
      bestUserId: BACKTEST_USER_ID_BEST,
      medianUserId: BACKTEST_USER_ID_MEDIAN,
    });
  } catch (err: any) {
    log(`❌ Ошибка: ${err.message}`);
    return NextResponse.json({ success: false, error: err.message, logs: logs.slice(-20) }, { status: 500 });
  }
}

// GET /api/backtest-run — статус
export async function GET() {
  return NextResponse.json({ status: 'ready' });
}
