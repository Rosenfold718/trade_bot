// ============================================================
// Фаза 2: Уточнение топ-10 конфигов × 20 аккаунтов
// ============================================================

const BINANCE = 'https://api.binance.com/api/v3';

interface Candle { time: number; open: number; high: number; low: number; close: number; volume: number; }
interface SD {
  symbol: string; times: number[]; opens: number[]; highs: number[]; lows: number[];
  closes: number[]; volumes: number[]; ema7: number[]; ema25: number[]; ema99: number[];
  ema12: number[]; ema26: number[]; atr: number[]; rsi: number[];
  plusDI: number[]; minusDI: number[]; adx: number[]; bbUpper: number[]; bbLower: number[];
  volRatio20: number[];
}

function calcEMA(d: number[], p: number): number[] {
  const e: number[] = []; if (d.length < p) return e;
  const k = 2 / (p + 1); let v = d.slice(0, p).reduce((s, x) => s + x, 0) / p;
  for (let i = 0; i < p - 1; i++) e.push(NaN); e[p - 1] = v;
  for (let i = p; i < d.length; i++) { v = d[i] * k + v * (1 - k); e.push(v); } return e;
}
function calcATR(h: number[], l: number[], c: number[], p = 14): number[] {
  const a: number[] = [], t: number[] = [h[0] - l[0]];
  for (let i = 1; i < h.length; i++) t.push(Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1])));
  let v = t.slice(0, p).reduce((s, x) => s + x, 0) / p;
  for (let i = 0; i < p; i++) a.push(v);
  for (let i = p; i < t.length; i++) { v = (v * (p - 1) + t[i]) / p; a.push(v); } return a;
}
function calcRSI(c: number[], p = 14): number[] {
  const r = new Array(c.length).fill(50); if (c.length <= p) return r;
  let ag = 0, al = 0;
  for (let i = 1; i <= p; i++) { const d = c[i] - c[i - 1]; if (d > 0) ag += d; else al -= d; }
  ag /= p; al /= p; r[p] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  for (let i = p + 1; i < c.length; i++) { const d = c[i] - c[i - 1]; ag = (ag * (p - 1) + (d > 0 ? d : 0)) / p; al = (al * (p - 1) + (d < 0 ? -d : 0)) / p; r[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); } return r;
}
function calcADX(h: number[], l: number[], c: number[], p = 14) {
  const n = h.length, pdm: number[] = [0], mdm: number[] = [0], tr: number[] = [h[0] - l[0]];
  for (let i = 1; i < n; i++) { const u = h[i] - h[i - 1], dn = l[i - 1] - l[i]; pdm.push(u > dn && u > 0 ? u : 0); mdm.push(dn > u && dn > 0 ? dn : 0); tr.push(Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]))); }
  const sm = (a: number[]) => { const o: number[] = []; let v = a.slice(0, p).reduce((s, x) => s + x, 0); for (let i = 0; i < p - 1; i++) o.push(0); o[p - 1] = v; for (let i = p; i < a.length; i++) { v = v - v / p + a[i]; o.push(v); } return o; };
  const sTR = sm(tr), sP = sm(pdm), sM = sm(mdm);
  const pDI = sTR.map((v, i) => v > 0 ? (sP[i] / v) * 100 : 0), mDI = sTR.map((v, i) => v > 0 ? (sM[i] / v) * 100 : 0);
  const dx = pDI.map((p2, i) => { const m = mDI[i]; const s = p2 + m; return s > 0 ? Math.abs(p2 - m) / s * 100 : 0; });
  const adx: number[] = new Array(n).fill(0);
  if (n > p * 2) { let v = dx.slice(p, p * 2).reduce((s, x) => s + x, 0) / p; for (let i = 0; i < p * 2 - 1; i++) adx[i] = 0; adx[p * 2 - 1] = v; for (let i = p * 2; i < n; i++) { v = (v * (p - 1) + dx[i]) / p; adx[i] = v; } }
  return { plusDI: pDI, minusDI: mDI, adx };
}
function calcVolR(v: number[], p = 20): number[] { const r = new Array(v.length).fill(1); for (let i = p; i < v.length; i++) { const a = v.slice(i - p, i).reduce((s, x) => s + x, 0) / p; r[i] = a > 0 ? v[i] / a : 1; } return r; }

function preprocess(candles: Candle[]): SD {
  const c = candles.map(x => x.close), h = candles.map(x => x.high), l = candles.map(x => x.low), o = candles.map(x => x.open), v = candles.map(x => x.volume), t = candles.map(x => x.time);
  const e25 = calcEMA(c, 25), at = calcATR(h, l, c);
  const { plusDI, minusDI, adx } = calcADX(h, l, c);
  return { symbol: '', times: t, opens: o, highs: h, lows: l, closes: c, volumes: v, ema7: calcEMA(c, 7), ema25: e25, ema99: calcEMA(c, 99), ema12: calcEMA(c, 12), ema26: calcEMA(c, 26), atr: at, rsi: calcRSI(c), plusDI, minusDI, adx, bbUpper: e25.map((e, i) => isNaN(e) ? NaN : e + 2 * at[i]), bbLower: e25.map((e, i) => isNaN(e) ? NaN : e - 2 * at[i]), volRatio20: calcVolR(v) };
}

interface Cfg { st: number; mi: number; adxMin: number; rr: number; slAtr: number; lev: number; maxTrades: number; maxH: number; eh: number; es: number; mtf: boolean; }

function decide(d: SD, i: number, c: Cfg): { dir: 'long' | 'short' | 'none'; score: number } {
  if (i < 100) return { dir: 'none', score: 0 };
  const p = d.closes[i], e7 = d.ema7[i], e25 = d.ema25[i], e99 = d.ema99[i], at = d.atr[i], rsi = d.rsi[i], adx = d.adx[i], bbU = d.bbUpper[i], bbL = d.bbLower[i], vr = d.volRatio20[i], pDI = d.plusDI[i], mDI = d.minusDI[i], e12 = d.ema12[i], e26 = d.ema26[i];
  if (isNaN(e7) || isNaN(e25) || isNaN(e99) || !at || isNaN(e12) || isNaN(e26)) return { dir: 'none', score: 0 };
  let ls = 0, ss = 0, lc = 0, sc = 0;
  const add = (long: boolean, s: number) => { if (long) { ls += s; lc++; } else { ss += s; sc++; } };
  add(p > e7, 0.12); add(e7 > e25, 0.10); add(e25 > e99, 0.10);
  if (i >= 3) { const m = (d.closes[i] - d.closes[i - 3]) / d.closes[i - 3]; if (m > 0.005) { ls += 0.08; lc++; } else if (m < -0.005) { ss += 0.08; sc++; } }
  if (rsi < 35) { ls += 0.15; lc++; } else if (rsi > 65) { ss += 0.15; sc++; }
  if (!isNaN(bbL) && !isNaN(bbU)) { if (p < bbL) { ls += 0.12; lc++; } else if (p > bbU) { ss += 0.12; sc++; } }
  if (vr > 1.3) { const bull = d.closes[i] > d.opens[i]; if (bull) { ls += 0.08; lc++; } else { ss += 0.08; sc++; } }
  if (adx > c.adxMin) { if (pDI > mDI) { ls += 0.10; lc++; } else { ss += 0.10; sc++; } }
  const macd = e12 - e26, macdP = d.ema12[i - 1] - d.ema26[i - 1];
  if (!isNaN(macdP)) { if (macd > 0 && macd > macdP) { ls += 0.10; lc++; } else if (macd < 0 && macd < macdP) { ss += 0.10; sc++; } }
  if (i >= 2) {
    const pb = d.opens[i - 1] > d.closes[i - 1], cb = d.closes[i] > d.opens[i];
    if (pb && cb && d.closes[i] > d.opens[i - 1] && d.opens[i] < d.closes[i - 1]) { ls += 0.12; lc++; }
    else if (!pb && !cb && d.closes[i] < d.opens[i - 1] && d.opens[i] > d.closes[i - 1]) { ss += 0.12; sc++; }
  }
  const isL = ls > ss, score = Math.abs(ls - ss), agr = isL ? lc : sc;
  if (score < c.st || agr < c.mi) return { dir: 'none', score };
  return { dir: isL ? 'long' : 'short', score: isL ? ls : -ss };
}

function entryQ(d: SD, i: number, dir: 'long' | 'short', c: Cfg): { pass: boolean; m: number } {
  const e20 = calcEMA(d.closes, 20), v = e20[i]; if (isNaN(v) || !d.atr[i]) return { pass: true, m: 1.0 };
  const ext = dir === 'long' ? (d.closes[i] - v) / d.atr[i] : (v - d.closes[i]) / d.atr[i];
  if (ext > c.eh) return { pass: false, m: 0 };
  let cons = 0; for (let j = i; j >= Math.max(0, i - 4); j--) { const b = d.closes[j] > d.opens[j]; if ((dir === 'long' && b) || (dir === 'short' && !b)) cons++; else break; }
  if (cons >= 4 && ext > 1.5) return { pass: false, m: 0 };
  if (dir === 'long' && d.rsi[i] > 78) return { pass: false, m: 0 };
  if (dir === 'short' && d.rsi[i] < 22) return { pass: false, m: 0 };
  let m = 1.0; if (ext > c.es) m *= 0.5; else if (ext > 1.0) m *= 0.75; if (cons >= 3 && ext > 1.0) m *= 0.7; if (ext < 1.0 && ext > -0.5) m *= 1.15;
  return { pass: m >= 0.3, m };
}

interface Tr { sym: string; dir: 'long' | 'short'; entry: number; amt: number; sl: number; tp: number; oi: number; ci?: number; cp?: number; pnl?: number; }

function sim(dm: Map<string, SD>, syms: string[], c: Cfg, seed: number, sb: number) {
  const ts = [...dm.values()][0]?.times; if (!ts || ts.length < 120) return { pnl: 0, tr: 0, w: 0, l: 0, dd: 0, pf: 0 };
  let rng = seed; const rand = () => { rng = (rng * 1664525 + 1013904223) & 0xFFFFFFFF; return (rng >>> 0) / 0xFFFFFFFF; };
  let bal = sb, peak = sb, maxDD = 0; const trades: Tr[] = []; const cd = new Map<string, number>(); let dt = 0, ld = -1;
  const amt = (f: number) => { let a = f < 200 ? Math.max(1.5, Math.min(f * 0.08, 8)) : f < 1000 ? Math.max(5, Math.min(f * 0.05, 50)) : f < 5000 ? Math.max(20, Math.min(f * 0.03, 150)) : Math.max(50, Math.min(f * 0.02, 500)); return Math.min(a, f * 0.06, f * 0.5); };
  for (let ti = 120; ti < ts.length; ti++) {
    const day = Math.floor(ts[ti] / 86400); if (day !== ld) { dt = 0; ld = day; } if (dt >= 6) continue;
    for (const tr of [...trades]) {
      if (tr.ci !== undefined) continue; const d = dm.get(tr.sym); if (!d || ti >= d.closes.length) continue;
      let cl = false, ex = d.closes[ti];
      if (tr.dir === 'long') { if (d.lows[ti] <= tr.sl) { cl = true; ex = tr.sl; } else if (d.highs[ti] >= tr.tp) { cl = true; ex = tr.tp; } }
      else { if (d.highs[ti] >= tr.sl) { cl = true; ex = tr.sl; } else if (d.lows[ti] <= tr.tp) { cl = true; ex = tr.tp; } }
      if (!cl && (ti - tr.oi) > c.maxH) { const pc = tr.dir === 'long' ? (d.closes[ti] - tr.entry) / tr.entry : (tr.entry - d.closes[ti]) / tr.entry; if (pc < 0) { cl = true; ex = d.closes[ti]; } }
      if (cl) { tr.ci = ti; tr.cp = ex; const pc = tr.dir === 'long' ? (ex - tr.entry) / tr.entry : (tr.entry - ex) / tr.entry; tr.pnl = tr.amt * pc * c.lev - tr.amt * 0.001 - (tr.amt / c.lev) * 0.001; bal += tr.amt + tr.pnl; if (bal > peak) peak = bal; const dd = peak - bal; if (dd > maxDD) maxDD = dd; }
    }
    const open = trades.filter(t => t.ci === undefined); if (open.length >= c.maxTrades || bal < 10) continue;
    const sh = [...syms].sort(() => rand() - 0.5).slice(0, 20); const os = new Set(open.map(t => t.sym));
    let bs = '', bsc = 0, bd: 'long' | 'short' | null = null;
    for (const sym of sh) {
      if (os.has(sym)) continue; const v = cd.get(sym); if (v !== undefined && ti < v) continue; const d = dm.get(sym); if (!d) continue;
      const dec = decide(d, ti, c); if (dec.dir === 'none') continue;
      const eq = entryQ(d, ti, dec.dir, c); if (!eq.pass) continue; dec.score *= eq.m;
      if (c.mtf && ti >= 50) { const e50 = calcEMA(d.closes, 50); const ev = e50[ti]; if (!isNaN(ev)) { if (dec.dir === 'long' && d.closes[ti] < ev) continue; if (dec.dir === 'short' && d.closes[ti] > ev) continue; } }
      if (Math.abs(dec.score) > bsc) { bsc = Math.abs(dec.score); bs = sym; bd = dec.dir; }
    }
    if (!bd || !bs) continue; const d = dm.get(bs)!; const p = d.closes[ti], a = d.atr[ti]; if (!a) continue;
    const f = Math.max(0, bal - open.reduce((s, t) => s + t.amt, 0)), am = amt(f); if (am < 1) continue;
    trades.push({ sym: bs, dir: bd, entry: p, amt: am, sl: bd === 'long' ? p - a * c.slAtr : p + a * c.slAtr, tp: bd === 'long' ? p + a * c.slAtr * c.rr : p - a * c.slAtr * c.rr, oi: ti });
    bal -= am; dt++;
  }
  for (const tr of trades) { if (tr.ci !== undefined) continue; const d = dm.get(tr.sym); if (!d) continue; const lp = d.closes[d.closes.length - 1]; const pc = tr.dir === 'long' ? (lp - tr.entry) / tr.entry : (tr.entry - lp) / tr.entry; tr.pnl = tr.amt * pc * c.lev - tr.amt * 0.001 - (tr.amt / c.lev) * 0.001; tr.cp = lp; bal += tr.amt + tr.pnl; }
  const w = trades.filter(t => (t.pnl ?? 0) >= 0).length, l = trades.filter(t => (t.pnl ?? 0) < 0).length;
  const ws = trades.filter(t => (t.pnl ?? 0) > 0).reduce((s, t) => s + (t.pnl ?? 0), 0);
  const ls = trades.filter(t => (t.pnl ?? 0) < 0).reduce((s, t) => s + Math.abs(t.pnl ?? 0), 0);
  return { pnl: Math.round((bal - sb) * 100) / 100, tr: trades.length, w, l, dd: Math.round(maxDD * 100) / 100, pf: ls > 0 ? Math.round(ws / ls * 100) / 100 : (ws > 0 ? 99 : 0) };
}

async function main() {
  console.log('Загрузка данных...');
  const res = await fetch(`${BINANCE}/ticker/24hr`); const tickers = await res.json();
  const syms = tickers.filter((t: any) => t.symbol.endsWith('USDT') && Number(t.quoteVolume) > 0).sort((a: any, b: any) => Number(b.quoteVolume) - Number(a.quoteVolume)).slice(0, 50).map((t: any) => t.symbol);
  const dm = new Map<string, SD>(); let done = 0;
  await Promise.all(syms.map(async (sym) => {
    const r = await fetch(`${BINANCE}/klines?symbol=${sym}&interval=1h&limit=500`); const raw = await r.json();
    if (!Array.isArray(raw) || raw.length < 200) return;
    const cd: Candle[] = raw.map((k: any) => ({ time: Math.floor(Number(k[0]) / 1000), open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] }));
    const sd = preprocess(cd); sd.symbol = sym; dm.set(sym, sd); done++; if (done % 10 === 0) process.stdout.write(`\r  ${done}/50...`);
  }));
  const sample = [...dm.values()][0]; const days = Math.round((sample.times[sample.times.length - 1] - sample.times[0]) / 86400);
  console.log(`\r  ${dm.size} монет, ${days} дней данных\n`);

  // Top 10 configs from Phase 1 + fine-tuned variants
  const configs = [
    { name: '🏆 S0.5 RR5 SL2×ATR', cfg: { st: 0.5, mi: 5, adxMin: 20, rr: 5, slAtr: 2.0, lev: 3, maxTrades: 5, maxH: 12, eh: 3.0, es: 2.0, mtf: true } },
    { name: '🏆 S0.35 RR3 SL2.5 MI6', cfg: { st: 0.35, mi: 6, adxMin: 20, rr: 3, slAtr: 2.5, lev: 3, maxTrades: 5, maxH: 12, eh: 3.0, es: 2.0, mtf: true } },
    { name: '🏆 S0.5 RR5 SL3×ATR', cfg: { st: 0.5, mi: 5, adxMin: 20, rr: 5, slAtr: 3.0, lev: 3, maxTrades: 5, maxH: 12, eh: 3.0, es: 2.0, mtf: true } },
    { name: '🏆 S0.5 RR5 SL2.5×ATR', cfg: { st: 0.5, mi: 5, adxMin: 20, rr: 5, slAtr: 2.5, lev: 3, maxTrades: 5, maxH: 12, eh: 3.0, es: 2.0, mtf: true } },
    { name: '🏆 S0.3 RR4 SL3×ATR', cfg: { st: 0.30, mi: 5, adxMin: 20, rr: 4, slAtr: 3.0, lev: 3, maxTrades: 5, maxH: 12, eh: 3.0, es: 2.0, mtf: true } },
    { name: 'Уточн S0.5 RR4 SL2×ATR MI5', cfg: { st: 0.5, mi: 5, adxMin: 20, rr: 4, slAtr: 2.0, lev: 3, maxTrades: 5, maxH: 12, eh: 3.0, es: 2.0, mtf: true } },
    { name: 'Уточн S0.5 RR4 SL2.5 MI5', cfg: { st: 0.5, mi: 5, adxMin: 20, rr: 4, slAtr: 2.5, lev: 3, maxTrades: 5, maxH: 12, eh: 3.0, es: 2.0, mtf: true } },
    { name: 'Уточн S0.45 RR4 SL2×ATR MI5', cfg: { st: 0.45, mi: 5, adxMin: 20, rr: 4, slAtr: 2.0, lev: 3, maxTrades: 5, maxH: 12, eh: 3.0, es: 2.0, mtf: true } },
    { name: 'Уточн S0.4 RR5 SL2×ATR MI5', cfg: { st: 0.40, mi: 5, adxMin: 20, rr: 5, slAtr: 2.0, lev: 3, maxTrades: 5, maxH: 12, eh: 3.0, es: 2.0, mtf: true } },
    { name: 'Уточн S0.5 RR5 SL2 MI6 L2', cfg: { st: 0.5, mi: 6, adxMin: 20, rr: 5, slAtr: 2.0, lev: 2, maxTrades: 5, maxH: 12, eh: 3.0, es: 2.0, mtf: true } },
    { name: 'Уточн S0.5 RR5 SL2 MI6 MT3', cfg: { st: 0.5, mi: 6, adxMin: 20, rr: 5, slAtr: 2.0, lev: 2, maxTrades: 3, maxH: 12, eh: 3.0, es: 2.0, mtf: true } },
    { name: 'Уточн S0.5 RR5 SL2 MI5 L2', cfg: { st: 0.5, mi: 5, adxMin: 20, rr: 5, slAtr: 2.0, lev: 2, maxTrades: 5, maxH: 12, eh: 3.0, es: 2.0, mtf: true } },
    { name: 'Уточн S0.5 RR4 SL2 MI6', cfg: { st: 0.5, mi: 6, adxMin: 20, rr: 4, slAtr: 2.0, lev: 3, maxTrades: 5, maxH: 12, eh: 3.0, es: 2.0, mtf: true } },
    { name: 'Уточн S0.35 RR4 SL2 MI6', cfg: { st: 0.35, mi: 6, adxMin: 20, rr: 4, slAtr: 2.0, lev: 3, maxTrades: 5, maxH: 12, eh: 3.0, es: 2.0, mtf: true } },
    { name: 'Базовый (текущий)', cfg: { st: 0.35, mi: 5, adxMin: 25, rr: 3, slAtr: 2.5, lev: 3, maxTrades: 5, maxH: 12, eh: 3.0, es: 2.0, mtf: true } },
  ];

  const ACCTS = 20;
  console.log(`${configs.length} конфигов × ${ACCTS} аккаунтов...\n`);
  const results: any[] = [];
  for (let ci = 0; ci < configs.length; ci++) {
    const { name, cfg } = configs[ci];
    let tPnl = 0, tWR = 0, tPF = 0, tDD = 0, tTr = 0, prof = 0, minPnl = Infinity, maxPnl = -Infinity;
    for (let a = 0; a < ACCTS; a++) {
      const r = sim(dm, syms, cfg, 42 + a * 7919, 1000);
      tPnl += r.pnl; tWR += r.tr > 0 ? (r.w / r.tr) * 100 : 0; tPF += r.pf; tDD += r.dd; tTr += r.tr;
      if (r.pnl > 0) prof++; if (r.pnl < minPnl) minPnl = r.pnl; if (r.pnl > maxPnl) maxPnl = r.pnl;
    }
    results.push({ name, avgPnl: Math.round(tPnl / ACCTS * 100) / 100, minPnl: Math.round(minPnl * 100) / 100, maxPnl: Math.round(maxPnl * 100) / 100, avgWR: Math.round(tWR / ACCTS * 10) / 10, avgPF: Math.round(tPF / ACCTS * 100) / 100, avgDD: Math.round(tDD / ACCTS * 100) / 100, avgTr: Math.round(tTr / ACCTS * 10) / 10, prof });
    process.stdout.write(`\r  ${ci + 1}/${configs.length}...`);
  }
  console.log(`\r  Готово!\n`);

  results.sort((a, b) => b.avgPnl - a.avgPnl);
  console.log('━'.repeat(90));
  console.log('  РЕЗУЛЬТАТЫ: 20 аккаунтов × 21 день реальных данных');
  console.log('━'.repeat(90));
  console.log(`  ${'#'.padEnd(3)} ${'Конфигурация'.padEnd(30)} ${'Ср.PnL'.padStart(10)} ${'Худш'.padStart(8)} ${'Лучш'.padStart(8)} ${'WR%'.padStart(6)} ${'PF'.padStart(5)} ${'DD$'.padStart(6)} ${'Сдел'.padStart(5)} ${'Прб'.padEnd(4)}`);
  console.log('  ' + '─'.repeat(88));
  for (let i = 0; i < results.length; i++) {
    const r = results[i]; const e = r.avgPnl >= 0 ? '🟢' : '🔴';
    console.log(`  ${String(i + 1).padEnd(3)} ${r.name.padEnd(30)} ${(r.avgPnl >= 0 ? '+' : '') + ('$' + r.avgPnl.toFixed(2)).padStart(9)} ${('$' + r.minPnl.toFixed(0)).padStart(7)} ${('+$' + r.maxPnl.toFixed(0)).padStart(7)} ${r.avgWR.toFixed(1).padStart(5)}% ${r.avgPF.toFixed(2).padStart(4)} ${('$' + r.avgDD.toFixed(0)).padStart(5)} ${r.avgTr.toFixed(0).padStart(5)} ${r.prof + '/' + ACCTS}${e}`);
  }
  console.log('');
  const b = results[0];
  console.log('━'.repeat(90));
  console.log(`  ⭐ ЛУЧШАЯ: ${b.name}`);
  console.log(`     Средний PnL за ${days} дней: ${b.avgPnl >= 0 ? '+' : ''}$${b.avgPnl.toFixed(2)} (${(b.avgPnl / 10 * 30).toFixed(1)}$/мес)`);
  console.log(`     Винрейт: ${b.avgWR.toFixed(1)}% | PF: ${b.avgPF.toFixed(2)} | Просадка: $${b.avgDD.toFixed(0)}`);
  console.log(`     Прибыльных: ${b.prof}/${ACCTS} (${Math.round(b.prof / ACCTS * 100)}%)`);
  console.log(`     Худший аккаунт: $${b.minPnl.toFixed(2)}, Лучший: +$${b.maxPnl.toFixed(2)}`);
  console.log('━'.repeat(90));
}
main().catch(console.error);
