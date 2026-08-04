import { NextRequest } from 'next/server';
import { getTursoClient } from '@/lib/db';
import { fetchTopSymbols, calcATR } from '@/lib/trading-engine';
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
  id: string; symbol: string; strategyId: string; direction: 'long' | 'short';
  entryPrice: number; amount: number; leverage: number;
  stopLoss: number; takeProfit: number; openTime: number;
  closeTime?: number; closePrice?: number; pnl?: number; reason?: string;
}

interface AccountResult {
  id: number; strategyId: string; startBalance: number; endBalance: number;
  pnl: number; pnlPct: number; totalTrades: number; wins: number; losses: number;
  winRate: number; maxDrawdownPct: number; avgWin: number; avgLoss: number;
  profitFactor: number; trades: SimTrade[];
}

// Pre-computed indicators per symbol
interface SymInd {
  candles: CandleData[];
  tm: Map<number, number>; // time → index
  n: number;
  // Per-candle: 1=bull, -1=bear, 0=neutral
  rsiB: Int8Array;
  macdB: Int8Array;
  ema50B: Int8Array;
  emaX: Int8Array;  // ema12 vs ema26
  adxD: Int8Array;
  canD: Int8Array; // last 3 candles direction
  // Pre-computed scores
  bScore: Float32Array;
  sScore: Float32Array;
  // Pre-computed confluence counts
  bCount: Uint8Array;
  sCount: Uint8Array;
}

async function fetchCandles(symbol: string, interval: string, st: number, et: number): Promise<CandleData[]> {
  const all: CandleData[] = [];
  let cur = st;
  while (cur < et) {
    const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&startTime=${cur}&endTime=${et}&limit=1500`);
    if (!res.ok) break;
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) break;
    for (const k of data) all.push({ time: Math.floor(+k[0] / 1000), open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] });
    cur = +data[data.length - 1][6] + 1;
    if (data.length < 1500) break;
  }
  return all;
}

// Lightweight EMA computation
function emaCalc(data: number[], p: number): number[] {
  const r: number[] = [];
  const m = 2 / (p + 1);
  let prev: number | null = null;
  for (let i = 0; i < data.length; i++) {
    if (i < p - 1) { r.push(NaN); continue; }
    if (prev === null) { let s = 0; for (let j = i - p + 1; j <= i; j++) s += data[j]; prev = s / p; }
    else prev = (data[i] - prev) * m + prev;
    r.push(prev);
  }
  return r;
}

// Lightweight RSI — inline, no external deps
function rsiCalc(closes: number[], period = 14): number[] {
  const n = closes.length;
  const r = new Array(n).fill(50);
  if (n < period + 1) return r;
  let ag = 0, al = 0;
  for (let i = 1; i <= period; i++) { const d = closes[i] - closes[i - 1]; if (d > 0) ag += d; else al += Math.abs(d); }
  ag /= period; al /= period;
  for (let i = period; i < n; i++) {
    if (i > period) { const d = closes[i] - closes[i - 1]; ag = (ag * 13 + (d > 0 ? d : 0)) / 14; al = (al * 13 + (d < 0 ? Math.abs(d) : 0)) / 14; }
    r[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  }
  return r;
}

// Lightweight ADX at a single point
function adxSingle(candles: CandleData[], endIdx: number, period = 14): { adx: number; pDI: number; mDI: number } {
  const len = endIdx + 1;
  if (len < period * 2) return { adx: 0, pDI: 0, mDI: 0 };
  const tr: number[] = [], pdm: number[] = [], mdm: number[] = [];
  for (let i = 1; i < len; i++) {
    const h = candles[i].high, l = candles[i].low, pc = candles[i - 1].close;
    tr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
    const up = candles[i].high - candles[i - 1].high, dn = candles[i - 1].low - candles[i].low;
    pdm.push(up > dn && up > 0 ? up : 0);
    mdm.push(dn > up && dn > 0 ? dn : 0);
  }
  if (tr.length < period) return { adx: 0, pDI: 0, mDI: 0 };
  let sTR = 0, sP = 0, sM = 0;
  for (let i = 0; i < period; i++) { sTR += tr[i]; sP += pdm[i]; sM += mdm[i]; }
  let pDI = sTR ? (sP / sTR) * 100 : 0, mDI = sTR ? (sM / sTR) * 100 : 0;
  const dx: number[] = [];
  for (let i = period; i < tr.length; i++) {
    sTR = sTR - sTR / period + tr[i]; sP = sP - sP / period + pdm[i]; sM = sM - sM / period + mdm[i];
    pDI = sTR ? (sP / sTR) * 100 : 0; mDI = sTR ? (sM / sTR) * 100 : 0;
    const sum = pDI + mDI; dx.push(sum ? (Math.abs(pDI - mDI) / sum) * 100 : 0);
  }
  if (dx.length < period) return { adx: 0, pDI, mDI };
  let adx = dx.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < dx.length; i++) adx = (adx * (period - 1) + dx[i]) / period;
  return { adx, pDI, mDI };
}

// Pre-compute ALL indicators for one symbol — called ONCE per symbol per interval
function precompute(candles: CandleData[]): SymInd {
  const n = candles.length;
  const s: SymInd = {
    candles, tm: new Map(), n,
    rsiB: new Int8Array(n), macdB: new Int8Array(n), ema50B: new Int8Array(n),
    emaX: new Int8Array(n), adxD: new Int8Array(n), canD: new Int8Array(n),
    bScore: new Float32Array(n), sScore: new Float32Array(n),
    bCount: new Uint8Array(n), sCount: new Uint8Array(n),
  };
  for (let i = 0; i < n; i++) s.tm.set(candles[i].time, i);

  const cl = candles.map(c => c.close);

  // RSI (wide bands: <42 bull, >58 bear)
  const rsi = rsiCalc(cl);
  for (let i = 0; i < n; i++) s.rsiB[i] = rsi[i] < 42 ? 1 : rsi[i] > 58 ? -1 : 0;

  // MACD + EMA cross
  const e12 = emaCalc(cl, 12), e26 = emaCalc(cl, 26);
  const ml: number[] = [];
  for (let i = 0; i < n; i++) ml.push((e12[i] || 0) - (e26[i] || 0));
  const sig = emaCalc(ml, 9);
  for (let i = 0; i < n; i++) {
    const h = (ml[i] || 0) - (sig[i] || 0);
    s.macdB[i] = h > 0 ? 1 : h < 0 ? -1 : 0;
    s.emaX[i] = (e12[i] || 0) > (e26[i] || 0) ? 1 : -1; // always directional
  }

  // EMA50
  const e50 = emaCalc(cl, 50);
  for (let i = 0; i < n; i++) { const v = e50[i]; s.ema50B[i] = isNaN(v) ? 0 : cl[i] > v ? 1 : -1; }

  // ADX (every 3 candles)
  for (let i = 28; i < n; i += 3) {
    const a = adxSingle(candles, i);
    const v = a.adx > 15 ? (a.pDI > a.mDI ? 1 : -1) : 0;
    for (let j = i; j < Math.min(i + 3, n); j++) s.adxD[j] = v;
  }

  // Last 3 candles direction (always directional)
  for (let i = 2; i < n; i++) {
    const g = (cl[i] > candles[i].open ? 1 : 0) + (cl[i - 1] > candles[i - 1].open ? 1 : 0) + (cl[i - 2] > candles[i - 2].open ? 1 : 0);
    s.canD[i] = g >= 2 ? 1 : -1;
  }

  // Pre-compute confluence counts and scores
  for (let i = 0; i < n; i++) {
    let bc = 0, sc = 0, bs = 0, ss = 0;
    // RSI
    if (s.rsiB[i] > 0) { bc++; bs += 0.5; } else if (s.rsiB[i] < 0) { sc++; ss += 0.5; }
    // MACD
    if (s.macdB[i] > 0) { bc++; bs += 0.5; } else if (s.macdB[i] < 0) { sc++; ss += 0.5; }
    // EMA50
    if (s.ema50B[i] > 0) { bc++; bs += 0.5; } else if (s.ema50B[i] < 0) { sc++; ss += 0.5; }
    // EMA cross (always counts)
    if (s.emaX[i] > 0) { bc++; bs += 0.5; } else { sc++; ss += 0.5; }
    // ADX
    if (s.adxD[i] > 0) { bc++; bs += 0.5; } else if (s.adxD[i] < 0) { sc++; ss += 0.5; }
    // Candle dir (always counts)
    if (s.canD[i] > 0) { bc++; bs += 0.3; } else { sc++; ss += 0.3; }
    s.bCount[i] = bc; s.sCount[i] = sc;
    s.bScore[i] = bs; s.sScore[i] = ss;
  }

  return s;
}

function fIdx(tm: Map<number, number>, t: number): number {
  let i = tm.get(t);
  if (i !== undefined) return i;
  for (let d = 1; d <= 5; d++) { i = tm.get(t - d); if (i !== undefined) return i; }
  return -1;
}

function calcAmt(free: number): number {
  if (free < 5) return 0;
  if (free < 50) return Math.min(Math.max(free * 0.10, 1.5), 8);
  if (free < 200) return Math.min(Math.max(free * 0.06, 5), 30);
  return Math.min(Math.max(free * 0.04, 10), 50);
}

const STRATS = [
  { id: 'momentum', label: 'Momentum Pro', interval: '1h', maxOpen: 4, cd: 3, maxD: 4, maxH: 12, rr: 2.5, warmup: 60 },
  { id: 'scalper', label: 'Pattern Pro', interval: '15m', maxOpen: 4, cd: 4, maxD: 6, maxH: 6, rr: 2.0, warmup: 55 },
  { id: 'position-alpha', label: 'Position Alpha', interval: '4h', maxOpen: 2, cd: 2, maxD: 2, maxH: 120, rr: 3.0, warmup: 60 },
];

function simulate(
  aid: number, strat: typeof STRATS[0], b0: number,
  data: Map<string, SymInd>, syms: string[], seed: number, t0: number, t1: number,
): AccountResult {
  const trades: SimTrade[] = [];
  let bal = b0, maxDD = 0, w = 0, l = 0, wS = 0, lS = 0;
  let rng = seed;
  const rand = () => { rng = (rng * 1664525 + 1013904223) & 0xFFFFFFFF; return (rng >>> 0) / 0xFFFFFFFF; };
  const iS = strat.interval === '15m' ? 900 : strat.interval === '4h' ? 14400 : 3600;
  const cds = new Map<string, number>();
  let dT = 0, lD = -1, ev = 0, sg = 0;
  const valid = syms.filter(s => { const d = data.get(s); return d && d.n >= strat.warmup + 10; });

  for (let t = t0 + strat.warmup * iS; t <= t1; t += iS) {
    const day = Math.floor(t / 86400);
    if (day !== lD) { dT = 0; lD = day; }
    if (dT >= strat.maxD) continue;

    // Close trades
    for (const tr of trades) {
      if (tr.closeTime) continue;
      const sd = data.get(tr.symbol); if (!sd) continue;
      const ci = fIdx(sd.tm, t); if (ci < 1 || ci >= sd.n) continue;
      const c = sd.candles[ci];
      let cl = false, rsn = '', ex = c.close;
      if (tr.direction === 'long') {
        if (c.low <= tr.stopLoss) { cl = true; rsn = 'SL'; ex = tr.stopLoss; }
        else if (c.high >= tr.takeProfit) { cl = true; rsn = 'TP'; ex = tr.takeProfit; }
      } else {
        if (c.high >= tr.stopLoss) { cl = true; rsn = 'SL'; ex = tr.stopLoss; }
        else if (c.low <= tr.takeProfit) { cl = true; rsn = 'TP'; ex = tr.takeProfit; }
      }
      if (!cl && (t - tr.openTime) / 3600 > strat.maxH) { cl = true; rsn = 'Тайм'; ex = c.close; }
      if (cl) {
        tr.closeTime = t; tr.closePrice = ex;
        const pc = tr.direction === 'long' ? (ex - tr.entryPrice) / tr.entryPrice : (tr.entryPrice - ex) / tr.entryPrice;
        const fees = tr.amount * 0.001 + (tr.amount / tr.leverage) * 0.001;
        tr.pnl = tr.amount * pc * tr.leverage - fees; tr.reason = rsn;
        bal += tr.amount + tr.pnl;
        if (tr.pnl >= 0) { w++; wS += tr.pnl; } else { l++; lS += Math.abs(tr.pnl); }
        if (rsn === 'SL' || rsn === 'Тайм') cds.set(tr.symbol, t + strat.cd * iS);
      }
    }

    const open = trades.filter(x => !x.closeTime);
    if (open.length >= strat.maxOpen || bal < 5) continue;

    const shuffled = [...valid].sort(() => rand() - 0.5).slice(0, 20);
    const oS = new Set(open.map(x => x.symbol));
    let found = false;

    for (const sym of shuffled) {
      if (found) break;
      if (oS.has(sym)) continue;
      const cd = cds.get(sym); if (cd && t < cd) continue;
      const sd = data.get(sym); if (!sd) continue;
      const ci = fIdx(sd.tm, t); if (ci < strat.warmup || ci >= sd.n) continue;
      ev++;

      // O(1) signal check using pre-computed data
      const bc = sd.bCount[ci], sc_ = sd.sCount[ci];
      if (Math.max(bc, sc_) < 3) continue; // confluence ≥ 3
      const score = Math.max(sd.bScore[ci], sd.sScore[ci]);
      if (score < 0.15) continue;
      sg++;

      const dir: 'long' | 'short' = sd.bScore[ci] >= sd.sScore[ci] ? 'long' : 'short';
      const lev = Math.min(5, Math.max(2, Math.round(score * 3)));
      const price = sd.candles[ci].close;
      const atr = calcATR(sd.candles.slice(Math.max(0, ci - 20), ci + 1));
      if (atr <= 0 || price <= 0) continue;
      const slP = Math.max(0.008, Math.min(2.5 * atr / price, 0.08));
      const tpP = Math.min(slP * strat.rr, 0.15);
      const sl = dir === 'long' ? price * (1 - slP) : price * (1 + slP);
      const tp = dir === 'long' ? price * (1 + tpP) : price * (1 - tpP);
      const free = Math.max(0, bal - open.reduce((s, x) => s + x.amount, 0));
      const amt = calcAmt(free); if (amt < 1) continue;
      trades.push({ id: `bt_${aid}_${trades.length}`, symbol: sym, strategyId: strat.id, direction: dir, entryPrice: price, amount: amt, leverage: lev, stopLoss: sl, takeProfit: tp, openTime: t });
      bal -= amt; dT++; found = true;
    }
  }

  // Close remaining
  for (const tr of trades) {
    if (tr.closeTime) continue;
    const sd = data.get(tr.symbol); if (!sd) continue;
    const lp = sd.candles[sd.n - 1].close;
    const pc = tr.direction === 'long' ? (lp - tr.entryPrice) / tr.entryPrice : (tr.entryPrice - lp) / tr.entryPrice;
    const fees = tr.amount * 0.001 + (tr.amount / tr.leverage) * 0.001;
    tr.pnl = tr.amount * pc * tr.leverage - fees; tr.closeTime = t1; tr.closePrice = lp; tr.reason = 'конец';
    bal += tr.amount + tr.pnl;
    if (tr.pnl >= 0) { w++; wS += tr.pnl; } else { l++; lS += Math.abs(tr.pnl); }
  }

  let peak = b0, run = b0;
  for (const tr of trades) { if (!tr.closeTime) continue; run += tr.amount + (tr.pnl ?? 0); if (run > peak) peak = run; const dd = peak > 0 ? ((peak - run) / peak) * 100 : 0; if (dd > maxDD) maxDD = dd; }

  return { id: aid, strategyId: strat.id, startBalance: b0, endBalance: Math.round(bal * 100) / 100, pnl: Math.round((bal - b0) * 100) / 100, pnlPct: Math.round(((bal - b0) / b0) * 10000) / 100, totalTrades: trades.length, wins: w, losses: l, winRate: trades.length > 0 ? Math.round((w / trades.length) * 1000) / 10 : 0, maxDrawdownPct: Math.round(maxDD * 10) / 10, avgWin: w > 0 ? Math.round((wS / w) * 100) / 100 : 0, avgLoss: l > 0 ? Math.round((lS / l) * 100) / 100 : 0, profitFactor: lS > 0 ? Math.round((wS / lS) * 100) / 100 : w > 0 ? 99.99 : 0, trades, _debug: { ev, sg } } as any;
}

async function saveResult(uid: string, r: AccountResult) {
  const db = getTursoClient();
  await db.execute({ sql: `DELETE FROM trades WHERE user_id = ?`, args: [uid] });
  await db.execute({ sql: `DELETE FROM trader_state WHERE user_id = ?`, args: [uid] });
  await db.execute({ sql: `INSERT INTO trader_state (id, user_id, strategy_id, balance, borrowed_funds, debt_to_repay, is_active, initial_balance, updated_at) VALUES (?, ?, ?, ?, 0, 0, 0, ?, datetime('now'))`, args: [`bt_${uid}`, uid, r.strategyId, r.endBalance, r.startBalance] });
  const bs = r.trades.map(tr => ({ sql: `INSERT INTO trades (id, user_id, symbol, strategy_id, entry_price, exit_price, amount, leverage, direction, pnl, status, stop_loss, take_profit, opened_at, closed_at, remaining_amount, entry_quality, partial_state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 'full')`, args: [`${uid}_${tr.id}`, uid, tr.symbol, tr.strategyId, tr.entryPrice, tr.closePrice ?? null, tr.amount, tr.leverage, tr.direction, tr.pnl ?? null, 'closed', tr.stopLoss, tr.takeProfit, new Date(tr.openTime * 1000).toISOString(), tr.closeTime ? new Date(tr.closeTime * 1000).toISOString() : null, null] as any[] }));
  for (let i = 0; i < bs.length; i += 50) await db.batch(bs.slice(i, i + 50));
}

export async function POST(request: NextRequest) {
  if (!checkAuth(request)) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  const enc = new TextEncoder();
  let ctrl: ReadableStreamDefaultController | null = null;
  const send = (ev: string, d: any) => { if (!ctrl) return; ctrl.enqueue(enc.encode(`event: ${ev}\ndata: ${JSON.stringify(d)}\n\n`)); };

  const stream = new ReadableStream({ async start(c) { ctrl = c; }, async cancel() { ctrl = null; } });

  (async () => {
    try {
      const t1 = Math.floor(Date.now() / 1000), t0 = t1 - 60 * 86400;
      send('log', { msg: '🔄 Загрузка топ-50 монет...' });
      const symbols = await fetchTopSymbols();
      send('log', { msg: `✅ ${symbols.length} монет` });

      const allData = new Map<string, Map<string, SymInd>>();

      for (const strat of STRATS) {
        send('log', { msg: `📈 ${strat.interval}: загрузка + расчёт...` });
        const dm = new Map<string, SymInd>();
        for (let b = 0; b < symbols.length; b += 10) {
          const batch = symbols.slice(b, b + 10);
          const res = await Promise.all(batch.map(async sym => {
            try { const c = await fetchCandles(sym, strat.interval, t0 * 1000, t1 * 1000); if (c.length > 60) return { sym, sd: precompute(c) }; } catch { /* */ } return null;
          }));
          for (const r of res) if (r) dm.set(r.sym, r.sd);
          send('progress', { stage: 'candles', interval: strat.interval, current: Math.min(b + 10, symbols.length), total: symbols.length });
        }
        allData.set(strat.interval, dm);
        send('log', { msg: `  ✅ ${dm.size} монет (${strat.interval})` });
      }

      const results: AccountResult[] = [];
      const pS = 34, total = STRATS.length * pS;
      let done = 0, gEv = 0, gSg = 0;

      for (let si = 0; si < STRATS.length; si++) {
        const strat = STRATS[si];
        const dm = allData.get(strat.interval) ?? new Map();
        send('log', { msg: `🚀 ${strat.label}: ${pS} аккаунтов...` });
        for (let i = 0; i < pS; i++) {
          const aid = si * pS + i + 1;
          const r = simulate(aid, strat, 100, dm, symbols, 42 + aid * 7919, t0, t1);
          results.push(r); done++;
          gEv += (r as any)._debug?.ev ?? 0; gSg += (r as any)._debug?.sg ?? 0;
          send('account', { id: aid, strategyId: strat.id, totalTrades: r.totalTrades, winRate: r.winRate, pnlPct: r.pnlPct, emoji: r.pnl >= 0 ? '✅' : '❌' });
          send('progress', { stage: 'simulate', strategyId: strat.id, current: done, total });
        }
      }

      send('log', { msg: `📊 ${gEv} оценок, ${gSg} сигналов (${(gSg / Math.max(gEv, 1) * 100).toFixed(1)}%)` });

      const profitable = results.filter(r => r.pnl > 0).length;
      const totalTrades = results.reduce((s, r) => s + r.totalTrades, 0);
      const avgPnl = results.reduce((s, r) => s + r.pnlPct, 0) / results.length;
      const best = [...results].sort((a, b) => b.pnlPct - a.pnlPct)[0];
      const worst = [...results].sort((a, b) => a.pnlPct - b.pnlPct)[0];
      const sorted = [...results].sort((a, b) => a.pnlPct - b.pnlPct);
      const median = sorted[Math.floor(sorted.length / 2)];
      const gWR = totalTrades > 0 ? ((results.reduce((s, r) => s + r.wins, 0) / totalTrades) * 100).toFixed(1) : '0';
      const aDD = (results.reduce((s, r) => s + r.maxDrawdownPct, 0) / results.length).toFixed(1);
      const bkts = [-100, -50, -25, -10, 0, 10, 25, 50, 100, 500];
      const dist: { from: number; to: number; count: number }[] = [];
      for (let i = 0; i < bkts.length - 1; i++) { const c = results.filter(r => r.pnlPct >= bkts[i] && r.pnlPct < bkts[i + 1]).length; if (c > 0) dist.push({ from: bkts[i], to: bkts[i + 1], count: c }); }
      const sSt = STRATS.map(s => { const sr = results.filter(r => r.strategyId === s.id); return { id: s.id, interval: s.interval, count: sr.length, profitable: sr.filter(r => r.pnl > 0).length, avgPnl: sr.length ? (sr.reduce((a, r) => a + r.pnlPct, 0) / sr.length).toFixed(1) : '0.0', avgWR: sr.length ? (sr.reduce((a, r) => a + r.winRate, 0) / sr.length).toFixed(1) : '0.0', avgDD: sr.length ? (sr.reduce((a, r) => a + r.maxDrawdownPct, 0) / sr.length).toFixed(1) : '0.0', bestPnl: sr.length ? Math.max(...sr.map(r => r.pnlPct)).toFixed(1) : '0.0', worstPnl: sr.length ? Math.min(...sr.map(r => r.pnlPct)).toFixed(1) : '0.0', totalTrades: sr.reduce((a, r) => a + r.totalTrades, 0) }; });

      send('log', { msg: '💾 Сохранение...' });
      try { await saveResult(BACKTEST_USER_ID_BEST, best); } catch (e: any) { send('log', { msg: `⚠️ ${e.message}` }); }
      try { await saveResult(BACKTEST_USER_ID_MEDIAN, median); } catch (e: any) { send('log', { msg: `⚠️ ${e.message}` }); }
      send('log', { msg: '✅ Готово!' });

      send('done', { profitable, totalTrades, avgPnlPct: avgPnl.toFixed(1), bestPnl: best.pnlPct, worstPnl: worst.pnlPct, medianPnl: median.pnlPct, globalWR: gWR, avgDD: aDD, stratStats: sSt, distribution: dist, bestUserId: BACKTEST_USER_ID_BEST, medianUserId: BACKTEST_USER_ID_MEDIAN, allResults: results.map(r => ({ id: r.id, strategyId: r.strategyId, pnlPct: r.pnlPct, totalTrades: r.totalTrades, winRate: r.winRate, maxDrawdownPct: r.maxDrawdownPct, profitFactor: r.profitFactor })) });
    } catch (err: any) { send('error', { msg: err.message }); } finally { ctrl?.close(); }
  })();

  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' } });
}

export async function GET() { return Response.json({ status: 'ready' }); }
