// ============================================================
// Оптимизация стратегий — полный перебор параметров
// Предрассчёт индикаторов → быстрый перебор сотен конфигов
// ============================================================

const BINANCE = 'https://api.binance.com/api/v3';

interface Candle {
  time: number; open: number; high: number; low: number; close: number; volume: number;
}

// ── Pre-computed indicator cache per symbol ──
interface SymbolData {
  symbol: string;
  times: number[];
  opens: number[]; highs: number[]; lows: number[]; closes: number[]; volumes: number[];
  ema7: number[]; ema25: number[]; ema99: number[]; ema12: number[]; ema26: number[];
  atr: number[]; rsi: number[];
  plusDI: number[]; minusDI: number[]; adx: number[];
  bbUpper: number[]; bbLower: number[];
  volRatio20: number[]; // current vol / 20-candle avg
}

function calcEMA(data: number[], period: number): number[] {
  const ema: number[] = [];
  if (data.length < period) return ema;
  const k = 2 / (period + 1);
  let val = data.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = 0; i < period - 1; i++) ema.push(NaN);
  ema[period - 1] = val;
  for (let i = period; i < data.length; i++) { val = data[i] * k + val * (1 - k); ema.push(val); }
  return ema;
}

function calcATR(h: number[], l: number[], c: number[], period = 14): number[] {
  const atr: number[] = [];
  const trs: number[] = [h[0] - l[0]];
  for (let i = 1; i < h.length; i++) {
    trs.push(Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1])));
  }
  let val = trs.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = 0; i < period; i++) atr.push(val);
  for (let i = period; i < trs.length; i++) { val = (val * (period - 1) + trs[i]) / period; atr.push(val); }
  return atr;
}

function calcRSI(closes: number[], period = 14): number[] {
  const rsi = new Array(closes.length).fill(50);
  if (closes.length <= period) return rsi;
  let ag = 0, al = 0;
  for (let i = 1; i <= period; i++) { const d = closes[i] - closes[i - 1]; if (d > 0) ag += d; else al -= d; }
  ag /= period; al /= period;
  rsi[period] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    ag = (ag * (period - 1) + (d > 0 ? d : 0)) / period;
    al = (al * (period - 1) + (d < 0 ? -d : 0)) / period;
    rsi[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  }
  return rsi;
}

function calcADX(h: number[], l: number[], c: number[], period = 14): { plusDI: number[]; minusDI: number[]; adx: number[] } {
  const len = h.length;
  const plusDM: number[] = [0], minusDM: number[] = [0], tr: number[] = [h[0] - l[0]];
  for (let i = 1; i < len; i++) {
    const up = h[i] - h[i - 1], dn = l[i - 1] - l[i];
    plusDM.push(up > dn && up > 0 ? up : 0);
    minusDM.push(dn > up && dn > 0 ? dn : 0);
    tr.push(Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1])));
  }
  const smooth = (arr: number[]) => {
    const out: number[] = [];
    let val = arr.slice(0, period).reduce((s, v) => s + v, 0);
    for (let i = 0; i < period - 1; i++) out.push(0);
    out[period - 1] = val;
    for (let i = period; i < arr.length; i++) { val = val - val / period + arr[i]; out.push(val); }
    return out;
  };
  const sTR = smooth(tr), sPDM = smooth(plusDM), sMDM = smooth(minusDM);
  const plusDI = sTR.map((v, i) => v > 0 ? (sPDM[i] / v) * 100 : 0);
  const minusDI = sTR.map((v, i) => v > 0 ? (sMDM[i] / v) * 100 : 0);
  const dx = plusDI.map((p, i) => { const m = minusDI[i]; const sum = p + m; return sum > 0 ? Math.abs(p - m) / sum * 100 : 0; });
  const adx: number[] = new Array(len).fill(0);
  if (len > period * 2) {
    let val = dx.slice(period, period * 2).reduce((s, v) => s + v, 0) / period;
    for (let i = 0; i < period * 2 - 1; i++) adx[i] = 0;
    adx[period * 2 - 1] = val;
    for (let i = period * 2; i < len; i++) { val = (val * (period - 1) + dx[i]) / period; adx[i] = val; }
  }
  return { plusDI, minusDI, adx };
}

function calcVolRatio(volumes: number[], period = 20): number[] {
  const ratio: number[] = new Array(volumes.length).fill(1);
  for (let i = period; i < volumes.length; i++) {
    const avg = volumes.slice(i - period, i).reduce((s, v) => s + v, 0) / period;
    ratio[i] = avg > 0 ? volumes[i] / avg : 1;
  }
  return ratio;
}

function preprocessSymbol(candles: Candle[]): SymbolData {
  const c = candles.map(cd => cd.close), h = candles.map(cd => cd.high);
  const l = candles.map(cd => cd.low), o = candles.map(cd => cd.open);
  const v = candles.map(cd => cd.volume), t = candles.map(cd => cd.time);
  const ema25 = calcEMA(c, 25);
  const atr = calcATR(h, l, c);
  const bbUpper = ema25.map((e, i) => isNaN(e) ? NaN : e + 2 * atr[i]);
  const bbLower = ema25.map((e, i) => isNaN(e) ? NaN : e - 2 * atr[i]);
  const { plusDI, minusDI, adx } = calcADX(h, l, c);
  return {
    symbol: candles[0] ? '' : '',
    times: t, opens: o, highs: h, lows: l, closes: c, volumes: v,
    ema7: calcEMA(c, 7), ema25, ema99: calcEMA(c, 99),
    ema12: calcEMA(c, 12), ema26: calcEMA(c, 26),
    atr, rsi: calcRSI(c), plusDI, minusDI, adx,
    bbUpper, bbLower, volRatio20: calcVolRatio(v),
  };
}

// ── Fast decision using pre-computed data ──
interface Config {
  scoreThreshold: number;
  minIndicators: number;
  adxMin: number;
  rr: number;
  slAtrMult: number;
  leverage: number;
  maxOpenTrades: number;
  maxHoldHours: number;
  entryHardLimit: number; // ATR from EMA to hard-reject
  essionSoftLimit: number;
  mtfEnabled: boolean;
}

function makeDecisionFast(d: SymbolData, idx: number, cfg: Config): { dir: 'long' | 'short' | 'none'; score: number } {
  if (idx < 100) return { dir: 'none', score: 0 };
  const price = d.closes[idx];
  const e7 = d.ema7[idx], e25 = d.ema25[idx], e99 = d.ema99[idx];
  const atr = d.atr[idx], rsi = d.rsi[idx], adx = d.adx[idx];
  const bbU = d.bbUpper[idx], bbL = d.bbLower[idx];
  const volR = d.volRatio20[idx];
  const pDI = d.plusDI[idx], mDI = d.minusDI[idx];
  const ema12 = d.ema12[idx], ema26 = d.ema26[idx];
  if (isNaN(e7) || isNaN(e25) || isNaN(e99) || !atr || isNaN(ema12) || isNaN(ema26)) return { dir: 'none', score: 0 };

  let ls = 0, ss = 0, lc = 0, sc = 0;
  const add = (long: boolean, s: number) => { if (long) { ls += s; lc++; } else { ss += s; sc++; } };

  // 1. EMA alignment
  add(price > e7, 0.12); add(e7 > e25, 0.10); add(e25 > e99, 0.10);

  // 2. Price momentum (3 candles)
  if (idx >= 3) {
    const mom = (d.closes[idx] - d.closes[idx - 3]) / d.closes[idx - 3];
    if (mom > 0.005) { ls += 0.08; lc++; }
    else if (mom < -0.005) { ss += 0.08; sc++; }
  }

  // 3. RSI
  if (rsi < 35) { ls += 0.15; lc++; }
  else if (rsi > 65) { ss += 0.15; sc++; }

  // 4. Bollinger
  if (!isNaN(bbL) && !isNaN(bbU)) {
    if (price < bbL) { ls += 0.12; lc++; }
    else if (price > bbU) { ss += 0.12; sc++; }
  }

  // 5. Volume confirmation
  if (volR > 1.3) {
    const bull = d.closes[idx] > d.opens[idx];
    if (bull) { ls += 0.08; lc++; } else { ss += 0.08; sc++; }
  }

  // 6. ADX/DI
  if (adx > cfg.adxMin) {
    if (pDI > mDI) { ls += 0.10; lc++; } else { ss += 0.10; sc++; }
  }

  // 7. MACD
  if (idx >= 1) {
    const macd = ema12 - ema26;
    const macdPrev = d.ema12[idx - 1] - d.ema26[idx - 1];
    if (!isNaN(macdPrev)) {
      if (macd > 0 && macd > macdPrev) { ls += 0.10; lc++; }
      else if (macd < 0 && macd < macdPrev) { ss += 0.10; sc++; }
    }
  }

  // 8. Candlestick pattern (engulfing)
  if (idx >= 2) {
    const prevBear = d.opens[idx - 1] > d.closes[idx - 1];
    const prevBull = d.closes[idx - 1] > d.opens[idx - 1];
    const currBull = d.closes[idx] > d.opens[idx];
    const currBear = d.opens[idx] > d.closes[idx];
    if (prevBear && currBull && d.closes[idx] > d.opens[idx - 1] && d.opens[idx] < d.closes[idx - 1]) {
      ls += 0.12; lc++; // bullish engulfing
    } else if (prevBull && currBear && d.closes[idx] < d.opens[idx - 1] && d.opens[idx] > d.closes[idx - 1]) {
      ss += 0.12; sc++; // bearish engulfing
    }
  }

  const isLong = ls > ss;
  const score = Math.abs(ls - ss);
  const agreement = isLong ? lc : sc;

  if (score < cfg.scoreThreshold || agreement < cfg.minIndicators) return { dir: 'none', score };
  return { dir: isLong ? 'long' : 'short', score: isLong ? ls : -ss };
}

function entryQuality(d: SymbolData, idx: number, dir: 'long' | 'short', cfg: Config): { pass: boolean; mult: number } {
  const e20 = calcEMA(d.closes, 20);
  const val = e20[idx];
  if (isNaN(val)) return { pass: true, mult: 1.0 };
  const price = d.closes[idx];
  const ext = dir === 'long' ? (price - val) / d.atr[idx] : (val - price) / d.atr[idx];

  if (ext > cfg.entryHardLimit) return { pass: false, mult: 0 };

  let cons = 0;
  for (let i = idx; i >= Math.max(0, idx - 4); i--) {
    const bull = d.closes[i] > d.opens[i];
    if ((dir === 'long' && bull) || (dir === 'short' && !bull)) cons++; else break;
  }
  if (cons >= 4 && ext > 1.5) return { pass: false, mult: 0 };
  if (dir === 'long' && d.rsi[idx] > 78) return { pass: false, mult: 0 };
  if (dir === 'short' && d.rsi[idx] < 22) return { pass: false, mult: 0 };

  let m = 1.0;
  if (ext > cfg.essionSoftLimit) m *= 0.5;
  else if (ext > 1.0) m *= 0.75;
  if (cons >= 3 && ext > 1.0) m *= 0.7;
  if (ext < 1.0 && ext > -0.5) m *= 1.15;
  return { pass: m >= 0.3, mult: m };
}

// ── Fast simulation ──
interface Trade {
  symbol: string; dir: 'long' | 'short'; entry: number; amount: number;
  sl: number; tp: number; openIdx: number; closeIdx?: number; closePrice?: number; pnl?: number;
}

function simulate(dataMap: Map<string, SymbolData>, symbols: string[], cfg: Config, seed: number, startBalance: number): { pnl: number; trades: number; wins: number; losses: number; maxDD: number; pf: number } {
  const times = [...dataMap.values()][0]?.times;
  if (!times || times.length < 120) return { pnl: 0, trades: 0, wins: 0, losses: 0, maxDD: 0, pf: 0 };

  let rng = seed;
  const rand = () => { rng = (rng * 1664525 + 1013904223) & 0xFFFFFFFF; return (rng >>> 0) / 0xFFFFFFFF; };

  let balance = startBalance;
  let peak = balance;
  let maxDD = 0;
  const trades: Trade[] = [];
  const cooldowns = new Map<string, number>();
  let dailyTrades = 0, lastDay = -1;
  const oneH = 3600;

  const amount = (free: number) => {
    let a = free < 200 ? Math.max(1.5, Math.min(free * 0.08, 8))
      : free < 1000 ? Math.max(5, Math.min(free * 0.05, 50))
      : free < 5000 ? Math.max(20, Math.min(free * 0.03, 150))
      : Math.max(50, Math.min(free * 0.02, 500));
    return Math.min(a, free * 0.06, free * 0.5);
  };

  for (let ti = 120; ti < times.length; ti++) {
    const t = times[ti];
    const day = Math.floor(t / 86400);
    if (day !== lastDay) { dailyTrades = 0; lastDay = day; }
    if (dailyTrades >= 6) continue;

    // Monitor open trades
    for (const tr of [...trades]) {
      if (tr.closeIdx !== undefined) continue;
      const d = dataMap.get(tr.symbol);
      if (!d || ti >= d.closes.length) continue;
      const c = { h: d.highs[ti], l: d.lows[ti], c: d.closes[ti] };
      let close = false, reason = '', exit = c.c;
      if (tr.dir === 'long') {
        if (c.l <= tr.sl) { close = true; reason = 'SL'; exit = tr.sl; }
        else if (c.h >= tr.tp) { close = true; reason = 'TP'; exit = tr.tp; }
      } else {
        if (c.h >= tr.sl) { close = true; reason = 'SL'; exit = tr.sl; }
        else if (c.l <= tr.tp) { close = true; reason = 'TP'; exit = tr.tp; }
      }
      const holdH = (ti - tr.openIdx);
      if (!close && holdH > cfg.maxHoldHours) {
        const pc = tr.dir === 'long' ? (c.c - tr.entry) / tr.entry : (tr.entry - c.c) / tr.entry;
        if (pc < 0) { close = true; reason = 'Тайм'; exit = c.c; }
      }
      if (close) {
        tr.closeIdx = ti; tr.closePrice = exit;
        const pc = tr.dir === 'long' ? (exit - tr.entry) / tr.entry : (tr.entry - exit) / tr.entry;
        const fees = tr.amount * 0.001 + (tr.amount / cfg.leverage) * 0.001;
        tr.pnl = tr.amount * pc * cfg.leverage - fees;
        balance += tr.amount + tr.pnl;
        if (balance > peak) peak = balance;
        const dd = peak - balance;
        if (dd > maxDD) maxDD = dd;
        if (reason === 'SL' || reason === 'Тайм') cooldowns.set(tr.symbol, ti + 4);
      }
    }

    const open = trades.filter(t => t.closeIdx === undefined);
    if (open.length >= cfg.maxOpenTrades || balance < 10) continue;

    const shuffled = [...symbols].sort(() => rand() - 0.5).slice(0, 20);
    const openSyms = new Set(open.map(t => t.symbol));
    let bestSym = '', bestScore = 0, bestDir: 'long' | 'short' | null = null;

    for (const sym of shuffled) {
      if (openSyms.has(sym)) continue;
      const cd = cooldowns.get(sym); if (cd !== undefined && ti < cd) continue;
      const d = dataMap.get(sym); if (!d) continue;

      const dec = makeDecisionFast(d, ti, cfg);
      if (dec.dir === 'none') continue;

      const eq = entryQuality(d, ti, dec.dir, cfg);
      if (!eq.pass) continue;
      dec.score *= eq.mult;

      // MTF
      if (cfg.mtfEnabled && ti >= 50) {
        const ema50 = calcEMA(d.closes, 50);
        const e50 = ema50[ti];
        if (!isNaN(e50)) {
          if (dec.dir === 'long' && d.closes[ti] < e50) continue;
          if (dec.dir === 'short' && d.closes[ti] > e50) continue;
        }
      }

      if (Math.abs(dec.score) > bestScore) { bestScore = Math.abs(dec.score); bestSym = sym; bestDir = dec.dir; }
    }

    if (!bestDir || !bestSym) continue;
    const d = dataMap.get(bestSym)!;
    const price = d.closes[ti], atrVal = d.atr[ti];
    if (!atrVal) continue;
    const free = Math.max(0, balance - open.reduce((s, t) => s + t.amount, 0));
    const amt = amount(free);
    if (amt < 1) continue;
    const slDist = atrVal * cfg.slAtrMult;
    const tpDist = slDist * cfg.rr;
    trades.push({
      symbol: bestSym, dir: bestDir, entry: price, amount: amt,
      sl: bestDir === 'long' ? price - slDist : price + slDist,
      tp: bestDir === 'long' ? price + tpDist : price - tpDist,
      openIdx: ti,
    });
    balance -= amt;
    dailyTrades++;
  }

  // Close remaining
  for (const tr of trades) {
    if (tr.closeIdx !== undefined) continue;
    const d = dataMap.get(tr.symbol); if (!d) continue;
    const last = d.closes[d.closes.length - 1];
    const pc = tr.dir === 'long' ? (last - tr.entry) / tr.entry : (tr.entry - last) / tr.entry;
    const fees = tr.amount * 0.001 + (tr.amount / cfg.leverage) * 0.001;
    tr.pnl = tr.amount * pc * cfg.leverage - fees;
    tr.closePrice = last;
    balance += tr.amount + tr.pnl;
  }

  const wins = trades.filter(t => (t.pnl ?? 0) >= 0).length;
  const losses = trades.filter(t => (t.pnl ?? 0) < 0).length;
  const wSum = trades.filter(t => (t.pnl ?? 0) > 0).reduce((s, t) => s + (t.pnl ?? 0), 0);
  const lSum = trades.filter(t => (t.pnl ?? 0) < 0).reduce((s, t) => s + Math.abs(t.pnl ?? 0), 0);
  return {
    pnl: Math.round((balance - startBalance) * 100) / 100,
    trades: trades.length, wins, losses,
    maxDD: Math.round(maxDD * 100) / 100,
    pf: lSum > 0 ? Math.round(wSum / lSum * 100) / 100 : (wSum > 0 ? 99 : 0),
  };
}

// ── Main ──
async function main() {
  console.log('Загрузка данных...');
  const res = await fetch(`${BINANCE}/ticker/24hr`);
  const tickers = await res.json();
  const symbols = tickers
    .filter((t: any) => t.symbol.endsWith('USDT') && Number(t.quoteVolume) > 0)
    .sort((a: any, b: any) => Number(b.quoteVolume) - Number(a.quoteVolume))
    .slice(0, 50)
    .map((t: any) => t.symbol);

  const dataMap = new Map<string, SymbolData>();
  let done = 0;
  await Promise.all(symbols.map(async (sym) => {
    const r = await fetch(`${BINANCE}/klines?symbol=${sym}&interval=1h&limit=500`);
    const raw = await r.json();
    if (!Array.isArray(raw) || raw.length < 200) return;
    const candles: Candle[] = raw.map((k: any) => ({
      time: Math.floor(Number(k[0]) / 1000), open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5],
    }));
    const sd = preprocessSymbol(candles);
    sd.symbol = sym;
    dataMap.set(sym, sd);
    done++;
    if (done % 10 === 0) process.stdout.write(`\r  ${done}/${symbols.length} монет...`);
  }));
  console.log(`\r  ${dataMap.size} монет загружено (${[...dataMap.values()][0].closes.length} часов данных)`);

  const sample = [...dataMap.values()][0];
  const days = Math.round((sample.times[sample.times.length - 1] - sample.times[0]) / 86400);
  console.log(`  Период: ${days} дней\n`);

  // ── PARAMETER GRID ──
  const configs: { name: string; cfg: Config }[] = [];

  // Score threshold × R:R × SL ATR (core triangle)
  const scores = [0.25, 0.30, 0.35, 0.40, 0.50];
  const rrs = [2, 2.5, 3, 4, 5];
  const slAts = [1.5, 2.0, 2.5, 3.0, 3.5];
  const levs = [2, 3];
  const maxTrades = [3, 5];
  const minInds = [4, 5, 6];
  const holdHours = [8, 12, 24];

  for (const st of scores) for (const rr of rrs) for (const sl of slAts) {
    // Only test a subset to keep it manageable
    if (st === 0.35 && rr === 3 && sl === 2.5) continue; // baseline, already know
    configs.push({
      name: `S${st} RR${rr} SL${sl}×ATR L3 M5 H12`,
      cfg: { scoreThreshold: st, minIndicators: 5, adxMin: 20, rr, slAtrMult: sl, leverage: 3, maxOpenTrades: 5, maxHoldHours: 12, entryHardLimit: 3.0, essionSoftLimit: 2.0, mtfEnabled: true },
    });
  }

  // Test leverage variants on promising configs
  for (const lev of levs) {
    configs.push({ name: `S0.35 RR3 SL2.5 L${lev}`, cfg: { scoreThreshold: 0.35, minIndicators: 5, adxMin: 20, rr: 3, slAtrMult: 2.5, leverage: lev, maxOpenTrades: 5, maxHoldHours: 12, entryHardLimit: 3.0, essionSoftLimit: 2.0, mtfEnabled: true } });
    configs.push({ name: `S0.30 RR3 SL2 L${lev}`, cfg: { scoreThreshold: 0.30, minIndicators: 5, adxMin: 20, rr: 3, slAtrMult: 2.0, leverage: lev, maxOpenTrades: 5, maxHoldHours: 12, entryHardLimit: 3.0, essionSoftLimit: 2.0, mtfEnabled: true } });
    configs.push({ name: `S0.40 RR4 SL2 L${lev}`, cfg: { scoreThreshold: 0.40, minIndicators: 5, adxMin: 20, rr: 4, slAtrMult: 2.0, leverage: lev, maxOpenTrades: 5, maxHoldHours: 12, entryHardLimit: 3.0, essionSoftLimit: 2.0, mtfEnabled: true } });
  }

  // Min indicators variants
  for (const mi of minInds) {
    configs.push({ name: `S0.35 RR3 SL2.5 MI${mi}`, cfg: { scoreThreshold: 0.35, minIndicators: mi, adxMin: 20, rr: 3, slAtrMult: 2.5, leverage: 3, maxOpenTrades: 5, maxHoldHours: 12, entryHardLimit: 3.0, essionSoftLimit: 2.0, mtfEnabled: true } });
  }

  // Max hold variants
  for (const hh of holdHours) {
    configs.push({ name: `S0.35 RR3 SL2.5 H${hh}h`, cfg: { scoreThreshold: 0.35, minIndicators: 5, adxMin: 20, rr: 3, slAtrMult: 2.5, leverage: 3, maxOpenTrades: 5, maxHoldHours: hh, entryHardLimit: 3.0, essionSoftLimit: 2.0, mtfEnabled: true } });
  }

  // Max trades variants
  for (const mt of maxTrades) {
    configs.push({ name: `S0.35 RR3 SL2.5 MT${mt}`, cfg: { scoreThreshold: 0.35, minIndicators: 5, adxMin: 20, rr: 3, slAtrMult: 2.5, leverage: 3, maxOpenTrades: mt, maxHoldHours: 12, entryHardLimit: 3.0, essionSoftLimit: 2.0, mtfEnabled: true } });
  }

  // ADX variants
  for (const adx of [15, 25, 30]) {
    configs.push({ name: `S0.35 RR3 SL2.5 ADX${adx}`, cfg: { scoreThreshold: 0.35, minIndicators: 5, adxMin: adx, rr: 3, slAtrMult: 2.5, leverage: 3, maxOpenTrades: 5, maxHoldHours: 12, entryHardLimit: 3.0, essionSoftLimit: 2.0, mtfEnabled: true } });
  }

  // Entry quality strictness
  for (const eh of [2.0, 2.5, 3.5]) {
    configs.push({ name: `S0.35 RR3 SL2.5 EH${eh}`, cfg: { scoreThreshold: 0.35, minIndicators: 5, adxMin: 20, rr: 3, slAtrMult: 2.5, leverage: 3, maxOpenTrades: 5, maxHoldHours: 12, entryHardLimit: eh, essionSoftLimit: Math.max(1.0, eh - 1), mtfEnabled: true } });
  }

  // No MTF
  configs.push({ name: `S0.35 RR3 SL2.5 noMTF`, cfg: { scoreThreshold: 0.35, minIndicators: 5, adxMin: 20, rr: 3, slAtrMult: 2.5, leverage: 3, maxOpenTrades: 5, maxHoldHours: 12, entryHardLimit: 3.0, essionSoftLimit: 2.0, mtfEnabled: false } });
  configs.push({ name: `S0.30 RR3 SL2 noMTF`, cfg: { scoreThreshold: 0.30, minIndicators: 5, adxMin: 20, rr: 3, slAtrMult: 2.0, leverage: 3, maxOpenTrades: 5, maxHoldHours: 12, entryHardLimit: 3.0, essionSoftLimit: 2.0, mtfEnabled: false } });

  // Remove duplicates by name
  const unique = new Map<string, { name: string; cfg: Config }>();
  for (const c of configs) unique.set(c.name, c);
  const allConfigs = [...unique.values()];

  console.log(`Перебор ${allConfigs.length} конфигураций × 10 аккаунтов...\n`);

  const ACCOUNTS = 10;
  const results: { name: string; avgPnl: number; avgWR: number; avgPF: number; avgDD: number; avgTrades: number; profitable: number }[] = [];

  for (let ci = 0; ci < allConfigs.length; ci++) {
    const { name, cfg } = allConfigs[ci];
    let totalPnl = 0, totalWR = 0, totalPF = 0, totalDD = 0, totalTrades = 0, profitable = 0;

    for (let a = 0; a < ACCOUNTS; a++) {
      const r = simulate(dataMap, symbols, cfg, 42 + a * 7919, 1000);
      totalPnl += r.pnl;
      totalWR += r.trades > 0 ? (r.wins / r.trades) * 100 : 0;
      totalPF += r.pf;
      totalDD += r.maxDD;
      totalTrades += r.trades;
      if (r.pnl > 0) profitable++;
    }

    results.push({
      name,
      avgPnl: Math.round(totalPnl / ACCOUNTS * 100) / 100,
      avgWR: Math.round(totalWR / ACCOUNTS * 10) / 10,
      avgPF: Math.round(totalPF / ACCOUNTS * 100) / 100,
      avgDD: Math.round(totalDD / ACCOUNTS * 100) / 100,
      avgTrades: Math.round(totalTrades / ACCOUNTS * 10) / 10,
      profitable,
    });

    if ((ci + 1) % 20 === 0) process.stdout.write(`\r  ${ci + 1}/${allConfigs.length} конфигов...`);
  }
  console.log(`\r  ${allConfigs.length}/${allConfigs.length} конфигов готово!\n`);

  // Sort by avgPnl descending
  results.sort((a, b) => b.avgPnl - a.avgPnl);

  console.log('━'.repeat(80));
  console.log('  ТОП-20 КОНФИГУРАЦИЙ (по среднему PnL)');
  console.log('━'.repeat(80));
  console.log(`  ${'#'.padStart(3)}  ${'Конфиг'.padEnd(32)} ${'Ср.PnL'.padStart(10)} ${'Ср.WR%'.padStart(7)} ${'PF'.padStart(5)} ${'DD$'.padStart(7)} ${'Сдел'.padStart(5)} ${'Прб%'.padStart(5)}`);
  console.log('  ' + '─'.repeat(76));

  for (let i = 0; i < Math.min(20, results.length); i++) {
    const r = results[i];
    const emoji = r.avgPnl >= 0 ? '🟢' : '🔴';
    console.log(`  ${String(i + 1).padStart(3)}  ${r.name.padEnd(32)} ${(r.avgPnl >= 0 ? '+' : '') + ('$' + r.avgPnl.toFixed(2)).padStart(9)} ${r.avgWR.toFixed(1).padStart(6)}% ${r.avgPF.toFixed(2).padStart(4)} ${('$' + r.avgDD.toFixed(0)).padStart(6)} ${r.avgTrades.toFixed(1).padStart(5)} ${(r.profitable * 10).toFixed(0).padStart(4)}% ${emoji}`);
  }

  console.log('\n' + '━'.repeat(80));
  console.log('  ХУДШИЕ 10 (для сравнения)');
  console.log('━'.repeat(80));
  const worst = [...results].sort((a, b) => a.avgPnl - b.avgPnl).slice(0, 10);
  for (let i = 0; i < worst.length; i++) {
    const r = worst[i];
    console.log(`  ${String(i + 1).padStart(3)}  ${r.name.padEnd(32)} ${(r.avgPnl >= 0 ? '+' : '') + ('$' + r.avgPnl.toFixed(2)).padStart(9)} ${r.avgWR.toFixed(1).padStart(6)}% PF ${r.avgPF.toFixed(2)} DD $${r.avgDD.toFixed(0)}`);
  }

  // Key insights
  console.log('\n' + '━'.repeat(80));
  console.log('  КЛЮЧЕВЫЕ ВЫВОДЫ');
  console.log('━'.repeat(80));
  const top5 = results.slice(0, 5);
  const best = top5[0];
  console.log(`\n  Лучшая конфигурация: ${best.name}`);
  console.log(`    Средний PnL: ${best.avgPnl >= 0 ? '+' : ''}$${best.avgPnl.toFixed(2)}`);
  console.log(`    Винрейт: ${best.avgWR.toFixed(1)}% | PF: ${best.avgPF.toFixed(2)} | Просадка: $${best.avgDD.toFixed(0)}`);
  console.log(`    Прибыльных: ${best.profitable}/${ACCOUNTS} (${best.profitable * 10}%)`);

  // Parameter sensitivity
  console.log('\n  Чувствительность к R:R:');
  const byRR = new Map<number, number[]>();
  for (const r of results) {
    const m = r.name.match(/RR([\d.]+)/);
    if (m) { const v = parseFloat(m[1]); if (!byRR.has(v)) byRR.set(v, []); byRR.get(v)!.push(r.avgPnl); }
  }
  for (const [rr, pnls] of [...byRR.entries()].sort((a, b) => a[0] - b[0])) {
    const avg = pnls.reduce((s, v) => s + v, 0) / pnls.length;
    console.log(`    RR ${rr}: ср. PnL = ${avg >= 0 ? '+' : ''}$${avg.toFixed(2)} (${pnls.length} конфигов)`);
  }

  console.log('\n  Чувствительность к порогу скоринга:');
  const byScore = new Map<number, number[]>();
  for (const r of results) {
    const m = r.name.match(/S([\d.]+)/);
    if (m) { const v = parseFloat(m[1]); if (!byScore.has(v)) byScore.set(v, []); byScore.get(v)!.push(r.avgPnl); }
  }
  for (const [s, pnls] of [...byScore.entries()].sort((a, b) => a[0] - b[0])) {
    const avg = pnls.reduce((s, v) => s + v, 0) / pnls.length;
    console.log(`    Score ${s}: ср. PnL = ${avg >= 0 ? '+' : ''}$${avg.toFixed(2)} (${pnls.length} конфигов)`);
  }

  console.log('\n  Чувствительность к SL (ATR множитель):');
  const bySL = new Map<number, number[]>();
  for (const r of results) {
    const m = r.name.match(/SL([\d.]+)/);
    if (m) { const v = parseFloat(m[1]); if (!bySL.has(v)) bySL.set(v, []); bySL.get(v)!.push(r.avgPnl); }
  }
  for (const [s, pnls] of [...bySL.entries()].sort((a, b) => a[0] - b[0])) {
    const avg = pnls.reduce((s, v) => s + v, 0) / pnls.length;
    console.log(`    SL ${s}×ATR: ср. PnL = ${avg >= 0 ? '+' : ''}$${avg.toFixed(2)} (${pnls.length} конфигов)`);
  }
}

main().catch(console.error);
