import type { CandleData, IndicatorSignal, TradingDecision, OrderBookData, OrderBookLevel } from './types';
import { getStrategy, type StrategyConfig } from './strategies';

// ============================================================
// Indicator Calculations (kept for display purposes & filters)
// ============================================================

function ema(data: number[], period: number): number[] {
  const result: number[] = [];
  const k = 2 / (period + 1);
  let prev: number | null = null;
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { result.push(NaN); continue; }
    if (prev === null) {
      let s = 0; for (let j = i - period + 1; j <= i; j++) s += data[j];
      prev = s / period;
    } else {
      prev = data[i] * k + prev * (1 - k);
    }
    result.push(prev);
  }
  return result;
}

function calcRSI(closes: number[], period: number = 14): number {
  if (closes.length < period + 1) return 50;
  const m = 1 / period;
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) avgGain += d; else avgLoss += Math.abs(d);
  }
  avgGain /= period; avgLoss /= period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) avgGain = avgGain * (1 - m) + d * m;
    else avgLoss = avgLoss * (1 - m) + Math.abs(d) * m;
  }
  if (avgLoss === 0) return 100;
  return 100 - (100 / (1 + avgGain / avgLoss));
}

function calcMACD(closes: number[]): { macdLine: number; signalLine: number; histogram: number } {
  const e12 = ema(closes, 12), e26 = ema(closes, 26);
  const mArr: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (isNaN(e12[i]) || isNaN(e26[i])) mArr.push(NaN);
    else mArr.push(e12[i] - e26[i]);
  }
  if (closes.length < 35) return { macdLine: 0, signalLine: 0, histogram: 0 };
  const v = mArr.slice(26);
  if (v.length < 9) return { macdLine: 0, signalLine: 0, histogram: 0 };
  const s = ema(v, 9);
  const ml = v[v.length - 1], sl = s[s.length - 1] || 0;
  return { macdLine: ml, signalLine: sl, histogram: ml - sl };
}

function calcBollingerBands(closes: number[], period: number = 20, stdDev: number = 2): { upper: number; middle: number; lower: number; position: number } {
  if (closes.length < period) return { upper: 0, middle: 0, lower: 0, position: 0.5 };
  const sl = closes.slice(-period);
  const mid = sl.reduce((a, b) => a + b, 0) / period;
  const v = sl.reduce((s, val) => s + Math.pow(val - mid, 2), 0) / (period - 1);
  const sd = Math.sqrt(v);
  const up = mid + stdDev * sd, lo = mid - stdDev * sd;
  const cp = closes[closes.length - 1];
  return { upper: up, middle: mid, lower: lo, position: up === lo ? 0.5 : Math.max(0, Math.min(1, (cp - lo) / (up - lo))) };
}

function calcATR(candles: CandleData[], period: number = 14): number {
  if (candles.length < period + 1) return 0;
  let s = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    s += Math.max(candles[i].high - candles[i].low, Math.abs(candles[i].high - candles[i - 1].close), Math.abs(candles[i].low - candles[i - 1].close));
  }
  return s / period;
}

function calcADX(candles: CandleData[], period: number = 14): { adx: number; plusDI: number; minusDI: number } {
  if (candles.length < period * 2) return { adx: 0, plusDI: 0, minusDI: 0 };
  const tr: number[] = [], pdm: number[] = [], mdm: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const h = candles[i].high, l = candles[i].low, ph = candles[i-1].high, pl = candles[i-1].low, pc = candles[i-1].close;
    tr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
    const up = h - ph, dn = pl - l;
    pdm.push(up > dn && up > 0 ? up : 0);
    mdm.push(dn > up && dn > 0 ? dn : 0);
  }
  const sm = (d: number[], p: number) => {
    const r: number[] = []; let s = 0;
    for (let i = 0; i < p && i < d.length; i++) s += d[i];
    r.push(s);
    for (let i = p; i < d.length; i++) { s = s - s / p + d[i]; r.push(s); }
    return r;
  };
  const sTR = sm(tr, period), sPDM = sm(pdm, period), sMDM = sm(mdm, period);
  const di: number[] = [], pdi: number[] = [], mdi: number[] = [];
  for (let i = 0; i < sTR.length; i++) {
    const p = sTR[i] > 0 ? (sPDM[i] / sTR[i]) * 100 : 0;
    const m = sTR[i] > 0 ? (sMDM[i] / sTR[i]) * 100 : 0;
    pdi.push(p); mdi.push(m);
    const ds = p + m; di.push(ds > 0 ? (Math.abs(p - m) / ds) * 100 : 0);
  }
  const adxS: number[] = [];
  if (di.length >= period) {
    let s = 0; for (let i = 0; i < period; i++) s += di[i];
    adxS.push(s / period);
    for (let i = period; i < di.length; i++) adxS.push((adxS[adxS.length - 1] * (period - 1) + di[i]) / period);
  }
  return { adx: adxS.length > 0 ? adxS[adxS.length - 1] : 0, plusDI: pdi[pdi.length - 1] || 0, minusDI: mdi[mdi.length - 1] || 0 };
}

function calcStochRSI(closes: number[], rp: number = 14, sp: number = 14): number {
  if (closes.length < rp + sp) return 0.5;
  const rv: number[] = [];
  for (let i = rp; i <= closes.length; i++) rv.push(calcRSI(closes.slice(0, i), rp));
  const r = rv.slice(-sp);
  const mn = Math.min(...r), mx = Math.max(...r);
  return mx === mn ? 0.5 : (r[r.length - 1] - mn) / (mx - mn);
}

function calcVWAP(candles: CandleData[], period: number = 20): { vwap: number; signal: number } {
  if (candles.length < period) return { vwap: 0, signal: 0 };
  const sl = candles.slice(-period);
  let cvp = 0, cv = 0;
  for (const c of sl) { const tp = (c.high + c.low + c.close) / 3; cvp += tp * c.volume; cv += c.volume; }
  const v = cv > 0 ? cvp / cv : 0;
  const p = candles[candles.length - 1].close;
  return { vwap: v, signal: v > 0 ? (p - v) / v : 0 };
}

function calcOBV(candles: CandleData[]): { obv: number; trend: number } {
  if (candles.length < 20) return { obv: 0, trend: 0 };
  let obv = 0; const h: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    if (candles[i].close > candles[i-1].close) obv += candles[i].volume;
    else if (candles[i].close < candles[i-1].close) obv -= candles[i].volume;
    h.push(obv);
  }
  if (h.length < 10) return { obv, trend: 0 };
  const r = h.slice(-10).reduce((a, b) => a + b, 0) / 10;
  const e = h.slice(-20, -10).reduce((a, b) => a + b, 0) / Math.min(10, h.length - 10);
  return e === 0 ? { obv, trend: 0 } : { obv, trend: Math.max(-1, Math.min(1, (r - e) / Math.abs(e))) };
}

// ============================================================
// ANTI-SPIKE / ANTI-CHASE FILTER
// ============================================================

function calcROC(closes: number[], p: number = 3): number {
  if (closes.length < p + 1) return 0;
  const c = closes[closes.length - 1], past = closes[closes.length - 1 - p];
  return past === 0 ? 0 : ((c - past) / past) * 100;
}

function calcCCI(candles: CandleData[], period: number = 20): number {
  if (candles.length < period) return 0;
  const sl = candles.slice(-period);
  const tp = sl.map(c => (c.high + c.low + c.close) / 3);
  const sm = tp.reduce((s, v) => s + v, 0) / period;
  const md = tp.reduce((s, v) => s + Math.abs(v - sm), 0) / period;
  return md === 0 ? 0 : (tp[tp.length - 1] - sm) / (0.015 * md);
}

function analyzeCandleShape(c: CandleData): { bodyRatio: number; closePos: number; upperWick: number; lowerWick: number } {
  const rng = c.high - c.low;
  if (rng === 0) return { bodyRatio: 0, closePos: 0.5, upperWick: 0, lowerWick: 0 };
  const body = Math.abs(c.close - c.open);
  return {
    bodyRatio: body / rng,
    closePos: (c.close - c.low) / rng,
    upperWick: (c.high - Math.max(c.close, c.open)) / rng,
    lowerWick: (Math.min(c.close, c.open) - c.low) / rng,
  };
}

function spikeGuard(
  candles: CandleData[], closes: number[], atr: number, rsi: number,
  dir: 'long' | 'short' | 'none', ema20: number,
  t?: { atrMax?: number; rocMax?: number; rsiOB?: number; rsiOS?: number; emaMax?: number; cciMax?: number },
): { blocked: boolean; reason: string } {
  if (dir === 'none') return { blocked: false, reason: '' };
  const th = { atrMax: t?.atrMax ?? 2.5, rocMax: t?.rocMax ?? 8, rsiOB: t?.rsiOB ?? 78, rsiOS: t?.rsiOS ?? 22, emaMax: t?.emaMax ?? 5, cciMax: t?.cciMax ?? 200 };
  const last = candles[candles.length - 1];
  if (atr > 0 && (last.high - last.low) / atr > th.atrMax) return { blocked: true, reason: `Спайк ATR×${((last.high - last.low) / atr).toFixed(1)}` };
  const roc3 = calcROC(closes, 3);
  if (roc3 > th.rocMax) return { blocked: true, reason: `ROC3=${roc3.toFixed(1)}%` };
  const volAvg = candles.slice(-21, -1).reduce((s, c) => s + c.volume, 0) / 20 || 1;
  const roc1 = calcROC(closes, 1);
  if (last.volume / volAvg > 5.0 && Math.abs(roc1) > 2.0) return { blocked: true, reason: `FOMO vol×${(last.volume / volAvg).toFixed(1)}` };
  const isL = dir === 'long';
  if (isL && rsi > th.rsiOB) return { blocked: true, reason: `RSI ${rsi.toFixed(0)}` };
  if (!isL && rsi < th.rsiOS) return { blocked: true, reason: `RSI ${rsi.toFixed(0)}` };
  const dEma = ema20 > 0 ? ((closes[closes.length - 1] - ema20) / ema20) * 100 : 0;
  if (isL && dEma > th.emaMax) return { blocked: true, reason: `EMA+${dEma.toFixed(1)}%` };
  if (!isL && dEma < -th.emaMax) return { blocked: true, reason: `EMA-${Math.abs(dEma).toFixed(1)}%` };
  const cci = calcCCI(candles, 20);
  if (isL && cci > th.cciMax) return { blocked: true, reason: `CCI ${cci.toFixed(0)}` };
  if (!isL && cci < -th.cciMax) return { blocked: true, reason: `CCI ${cci.toFixed(0)}` };
  const cs = analyzeCandleShape(last);
  if (isL && cs.closePos > 0.95 && cs.bodyRatio > 0.7) return { blocked: true, reason: 'Закрытие на вершине' };
  if (!isL && cs.closePos < 0.05 && cs.bodyRatio > 0.7) return { blocked: true, reason: 'Закрытие на дне' };
  return { blocked: false, reason: '' };
}

// ============================================================
// INDICATOR ANALYSIS (for UI display only — NOT used for entry)
// ============================================================

export function analyzeIndicators(candles: CandleData[], weights: Record<string, number>): IndicatorSignal[] {
  if (candles.length < 50) return [];
  const closes = candles.map(c => c.close);
  const signals: IndicatorSignal[] = [];
  const rsi = calcRSI(closes);
  signals.push({ name: 'RSI', signal: rsi < 30 ? 1 : rsi > 70 ? -1 : 0, strength: rsi < 30 ? (30 - rsi) / 30 : rsi > 70 ? (rsi - 70) / 30 : 0 });
  const macd = calcMACD(closes);
  signals.push({ name: 'MACD', signal: macd.histogram > 0 && macd.macdLine > macd.signalLine ? 1 : macd.histogram < 0 ? -1 : 0, strength: Math.min(Math.abs(macd.histogram) / (Math.abs(macd.signalLine) || 1), 1) });
  const e50 = ema(closes, 50), e50v = e50[e50.length - 1], p = closes[closes.length - 1];
  signals.push({ name: 'EMA_50', signal: !isNaN(e50v) ? (p > e50v ? 1 : -1) : 0, strength: !isNaN(e50v) ? Math.min(Math.abs(p - e50v) / e50v * 10, 1) : 0 });
  const e200 = ema(closes, 200), e200v = e200[e200.length - 1];
  signals.push({ name: 'EMA_200', signal: !isNaN(e200v) ? (p > e200v ? 1 : -1) : 0, strength: !isNaN(e200v) ? Math.min(Math.abs(p - e200v) / e200v * 10, 1) : 0 });
  const bb = calcBollingerBands(closes);
  signals.push({ name: 'Bollinger', signal: bb.position < 0.1 ? 1 : bb.position > 0.9 ? -1 : 0, strength: bb.position < 0.1 ? (0.1 - bb.position) / 0.1 : bb.position > 0.9 ? (bb.position - 0.9) / 0.1 : 0 });
  const volAvg = candles.slice(-20).reduce((s, c) => s + c.volume, 0) / 20;
  const vr = volAvg > 0 ? candles[candles.length - 1].volume / volAvg : 0;
  signals.push({ name: 'Volume', signal: vr > 2.0 ? 1 : vr < 0.5 ? -1 : 0, strength: Math.max(0, (vr - 1) / 2) });
  const sr = calcStochRSI(closes);
  signals.push({ name: 'StochRSI', signal: sr > 0.8 ? -1 : sr < 0.2 ? 1 : 0, strength: sr > 0.8 ? (sr - 0.8) / 0.2 : sr < 0.2 ? (0.2 - sr) / 0.2 : 0 });
  const adx = calcADX(candles);
  signals.push({ name: 'ADX', signal: adx.adx > 25 ? (adx.plusDI > adx.minusDI ? 1 : -1) : 0, strength: adx.adx > 25 ? Math.min((adx.adx - 25) / 25, 1) : 0 });
  const obv = calcOBV(candles);
  const pc = closes.length > 5 ? (closes[closes.length - 1] - closes[closes.length - 6]) / closes[closes.length - 6] : 0;
  let obvSig = 0, obvStr = 0;
  if (obv.trend > 0.05 && pc > 0) { obvSig = 1; obvStr = Math.min(obv.trend * 5, 1); }
  else if (obv.trend < -0.05 && pc < 0) { obvSig = -1; obvStr = Math.min(Math.abs(obv.trend) * 5, 1); }
  else if (obv.trend > 0.05 && pc < 0) { obvSig = 1; obvStr = Math.min(obv.trend * 3, 0.7); }
  else if (obv.trend < -0.05 && pc > 0) { obvSig = -1; obvStr = Math.min(Math.abs(obv.trend) * 3, 0.7); }
  signals.push({ name: 'OBV', signal: obvSig, strength: obvStr });
  const vw = calcVWAP(candles);
  signals.push({ name: 'VWAP', signal: vw.signal > 0.005 ? 1 : vw.signal < -0.005 ? -1 : 0, strength: Math.min(Math.abs(vw.signal) * 10, 1) });
  return signals;
}

// ============================================================
// STRUCTURE-FIRST TRADING ENGINE
// Core Principle: NEVER enter unless price TOUCHED an S/R level
// ============================================================

// --- Support / Resistance Types & Detection ---

interface SRLevel {
  price: number;
  type: 'support' | 'resistance';
  touches: number;
  lastTouchIdx: number;
  strength: number;       // 0-1 quality score
  heldCount: number;      // how many times the level held
  brokenCount: number;    // how many times the level was broken
  zoneHigh: number;
  zoneLow: number;
}

/**
 * Find swing highs and lows using a lookback window.
 * A swing high must be the highest high among `lookback` bars on each side.
 * A swing low must be the lowest low among `lookback` bars on each side.
 */
function findSwingPoints(candles: CandleData[], lookback: number = 7): Array<{ price: number; index: number; type: 'high' | 'low' }> {
  const points: Array<{ price: number; index: number; type: 'high' | 'low' }> = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    let isHigh = true, isLow = true;
    for (let j = 1; j <= lookback; j++) {
      if (candles[i].high <= candles[i - j].high || candles[i].high <= candles[i + j].high) isHigh = false;
      if (candles[i].low >= candles[i - j].low || candles[i].low >= candles[i + j].low) isLow = false;
    }
    if (isHigh) points.push({ price: candles[i].high, index: i, type: 'high' });
    if (isLow) points.push({ price: candles[i].low, index: i, type: 'low' });
  }
  return points;
}

/**
 * Find consolidation zones — areas where price spent significant time.
 * These are stronger S/R than single-swing points.
 */
function findConsolidationZones(candles: CandleData[], zoneSize: number = 0.003): Array<{ price: number; strength: number; touches: number }> {
  const n = candles.length;
  if (n < 50) return [];
  const zones: Map<string, { totalWeight: number; candleCount: number; priceSum: number; volumeSum: number }> = new Map();

  for (let i = Math.floor(n * 0.4); i < n; i++) {
    const c = candles[i];
    const tickSize = c.close * zoneSize;
    const bucket = Math.floor(c.close / tickSize);
    const key = `z_${bucket}`;
    const existing = zones.get(key);
    if (existing) {
      existing.totalWeight += 1 + (c.volume / (candles.slice(Math.max(0, i - 20), i).reduce((s, x) => s + x.volume, 0) / 20 || 1));
      existing.candleCount++;
      existing.priceSum += c.close;
      existing.volumeSum += c.volume;
    } else {
      zones.set(key, { totalWeight: 1, candleCount: 1, priceSum: c.close, volumeSum: c.volume });
    }
  }

  const avgWeight = Array.from(zones.values()).reduce((s, z) => s + z.totalWeight, 0) / (zones.size || 1);
  const result: Array<{ price: number; strength: number; touches: number }> = [];

  for (const [, z] of zones) {
    if (z.candleCount >= 3 && z.totalWeight > avgWeight * 1.5) {
      result.push({
        price: z.priceSum / z.candleCount,
        strength: Math.min(z.totalWeight / (avgWeight * 3), 1),
        touches: z.candleCount,
      });
    }
  }

  return result.sort((a, b) => b.strength - a.strength).slice(0, 10);
}

/**
 * Find all S/R levels by clustering swing points and consolidation zones.
 * Returns levels sorted by strength (strongest first).
 */
function findSRLevels(candles: CandleData[], lookback: number = 7, clusterPct: number = 0.4, minTouches: number = 2): SRLevel[] {
  const n = candles.length;
  const swings = findSwingPoints(candles, lookback);
  const consolidations = findConsolidationZones(candles);
  const levels: SRLevel[] = [];

  // Add swing-based levels
  for (const sw of swings) {
    let matched = false;
    for (const lv of levels) {
      const dist = Math.abs(sw.price - lv.price) / lv.price * 100;
      if (dist < clusterPct) {
        lv.price = (lv.price * lv.touches + sw.price) / (lv.touches + 1);
        lv.touches++;
        lv.lastTouchIdx = Math.max(lv.lastTouchIdx, sw.index);
        if (sw.type === 'high' && lv.type === 'resistance') lv.heldCount++;
        else if (sw.type === 'low' && lv.type === 'support') lv.heldCount++;
        else lv.brokenCount++;
        matched = true;
        break;
      }
    }
    if (!matched) {
      levels.push({
        price: sw.price,
        type: sw.type === 'high' ? 'resistance' : 'support',
        touches: 1,
        lastTouchIdx: sw.index,
        strength: 0,
        heldCount: 1,
        brokenCount: 0,
        zoneHigh: sw.price * 1.002,
        zoneLow: sw.price * 0.998,
      });
    }
  }

  // Add consolidation zones as levels
  for (const cz of consolidations) {
    let matched = false;
    for (const lv of levels) {
      if (Math.abs(cz.price - lv.price) / lv.price * 100 < clusterPct * 1.5) {
        lv.strength += cz.strength * 0.3;
        lv.touches += Math.floor(cz.touches * 0.3);
        matched = true;
        break;
      }
    }
    if (!matched) {
      const price = candles[n - 1].close;
      levels.push({
        price: cz.price,
        type: cz.price > price ? 'resistance' : 'support',
        touches: Math.max(minTouches, Math.floor(cz.touches * 0.5)),
        lastTouchIdx: n - 1,
        strength: cz.strength * 0.5,
        heldCount: Math.floor(cz.touches * 0.3),
        brokenCount: 0,
        zoneHigh: cz.price * 1.003,
        zoneLow: cz.price * 0.997,
      });
    }
  }

  // Filter, compute strength, and sort
  return levels
    .filter(lv => lv.touches >= minTouches)
    .map(lv => {
      const recency = 0.3 + 0.7 * (lv.lastTouchIdx / n);
      const touchScore = Math.min(lv.touches / 6, 1);
      const holdRate = lv.heldCount + lv.brokenCount > 0
        ? lv.heldCount / (lv.heldCount + lv.brokenCount)
        : 0.5;
      const strength = Math.min(touchScore * recency * (0.5 + holdRate * 0.5) + lv.strength, 1);
      const zoneSize = Math.max(0.002, calcATR(candles, 14) / candles[n - 1].close * 0.5);
      return {
        ...lv,
        strength,
        zoneHigh: lv.price * (1 + zoneSize),
        zoneLow: lv.price * (1 - zoneSize),
      };
    })
    .sort((a, b) => b.strength - a.strength);
}

// --- Level Touch Verification (CRITICAL) ---

interface TouchResult {
  touched: boolean;
  touchCandleIdx: number;
  touchType: 'wick' | 'close' | 'body';
  touchDistance: number;  // % distance from the level
}

/**
 * CRITICAL: Verify that price actually TOUCHED an S/R level.
 * This prevents the #1 bug: entering BEFORE price reaches the level.
 *
 * For resistance: check if last `lookbackCandles` candles' HIGH reached within `thresholdPct`.
 * For support: check if last `lookbackCandles` candles' LOW reached within `thresholdPct`.
 */
function verifyLevelTouch(
  candles: CandleData[],
  level: SRLevel,
  direction: 'test_resistance' | 'test_support',
  lookbackCandles: number = 3,
  thresholdPct: number = 0.15,
): TouchResult {
  const n = candles.length;
  const startIdx = Math.max(0, n - lookbackCandles);

  for (let i = startIdx; i < n; i++) {
    const c = candles[i];
    const distPct = (Math.abs(c.close - level.price) / level.price) * 100;

    if (direction === 'test_resistance') {
      // For resistance, the candle's HIGH must reach the level
      const highDist = (Math.abs(c.high - level.price) / level.price) * 100;
      if (highDist <= thresholdPct) {
        // Classify touch type
        const closeAbove = c.close >= level.price;
        const bodyHigh = Math.max(c.close, c.open);
        const bodyDist = (Math.abs(bodyHigh - level.price) / level.price) * 100;

        let touchType: TouchResult['touchType'];
        if (bodyDist <= thresholdPct) {
          touchType = 'body';
        } else if (closeAbove) {
          touchType = 'close';
        } else {
          touchType = 'wick';
        }

        return { touched: true, touchCandleIdx: i, touchType, touchDistance: highDist };
      }
    } else {
      // For support, the candle's LOW must reach the level
      const lowDist = (Math.abs(c.low - level.price) / level.price) * 100;
      if (lowDist <= thresholdPct) {
        const closeBelow = c.close <= level.price;
        const bodyLow = Math.min(c.close, c.open);
        const bodyDist = (Math.abs(bodyLow - level.price) / level.price) * 100;

        let touchType: TouchResult['touchType'];
        if (bodyDist <= thresholdPct) {
          touchType = 'body';
        } else if (closeBelow) {
          touchType = 'close';
        } else {
          touchType = 'wick';
        }

        return { touched: true, touchCandleIdx: i, touchType, touchDistance: lowDist };
      }
    }
  }

  return { touched: false, touchCandleIdx: -1, touchType: 'wick', touchDistance: 100 };
}

// --- Market Structure Detection ---

interface TrendInfo {
  direction: 'up' | 'down' | 'range';
  strength: number;    // 0.0 to 1.0
  ema50Slope: number;  // positive = rising
  structure: 'HH_HL' | 'LH_LL' | 'mixed';
}

/**
 * Detect market trend using EMA50 slope and HH/HL/LH/LL structure.
 * Uses 10-bar EMA50 slope for smoothness.
 * Requires at least 2 consecutive HH+HL or LH+LL for structure confirmation.
 */
function detectTrend(candles: CandleData[]): TrendInfo {
  if (candles.length < 60) return { direction: 'range', strength: 0, ema50Slope: 0, structure: 'mixed' };

  const closes = candles.map(c => c.close);
  const e50 = ema(closes, 50);
  const e20 = ema(closes, 20);

  // EMA50 slope over 10 bars
  const n = e50.length;
  const slopeIdx = n - 1;
  const slopeLookback = 10;
  if (slopeIdx < slopeLookback || isNaN(e50[slopeIdx]) || isNaN(e50[slopeIdx - slopeLookback])) {
    return { direction: 'range', strength: 0, ema50Slope: 0, structure: 'mixed' };
  }
  const ema50Slope = (e50[slopeIdx] - e50[slopeIdx - slopeLookback]) / e50[slopeIdx - slopeLookback];
  const slopeStrength = Math.min(Math.abs(ema50Slope) / 0.02, 1); // 2% over 10 bars = max strength

  // Price vs EMA50
  const price = closes[closes.length - 1];
  const ema50Val = e50[slopeIdx];
  const priceAboveEma = price > ema50Val;

  // EMA20 vs EMA50 alignment
  const e20Val = e20[n - 1];
  const emasAligned = !isNaN(e20Val) && !isNaN(ema50Val)
    ? (priceAboveEma ? e20Val > ema50Val : e20Val < ema50Val)
    : true;

  // HH/HL/LH/LL structure detection (last 30 bars)
  const structureBars = Math.min(30, candles.length - 1);
  const startBar = candles.length - 1 - structureBars;
  let higherHighs = 0, higherLows = 0, lowerHighs = 0, lowerLows = 0;

  for (let i = startBar + 1; i < candles.length; i++) {
    if (candles[i].high > candles[i - 1].high) higherHighs++;
    else if (candles[i].high < candles[i - 1].high) lowerHighs++;
    if (candles[i].low > candles[i - 1].low) higherLows++;
    else if (candles[i].low < candles[i - 1].low) lowerLows++;
  }

  let structure: TrendInfo['structure'] = 'mixed';
  if (higherHighs >= 2 && higherLows >= 2 && higherHighs > lowerHighs) {
    structure = 'HH_HL';
  } else if (lowerHighs >= 2 && lowerLows >= 2 && lowerHighs > higherHighs) {
    structure = 'LH_LL';
  }

  // Determine direction
  let direction: TrendInfo['direction'] = 'range';
  if (ema50Slope > 0.005 && priceAboveEma && emasAligned && structure === 'HH_HL') {
    direction = 'up';
  } else if (ema50Slope < -0.005 && !priceAboveEma && emasAligned && structure === 'LH_LL') {
    direction = 'down';
  } else if (ema50Slope > 0.003 && priceAboveEma) {
    direction = 'up';
  } else if (ema50Slope < -0.003 && !priceAboveEma) {
    direction = 'down';
  }

  return {
    direction,
    strength: direction === 'range' ? slopeStrength * 0.3 : slopeStrength,
    ema50Slope,
    structure,
  };
}

// --- Candle Pattern Detection ---

interface CandlePattern {
  type: 'pin_bar_bullish' | 'pin_bar_bearish' | 'engulfing_bullish' | 'engulfing_bearish' | 'doji' | 'long_wick_bullish' | 'long_wick_bearish' | 'none';
  strength: number;  // 0-1
}

/**
 * Detect candlestick patterns on the last candle.
 * Includes long wick detection (>50% of range, body <35%) as valid rejection.
 */
function detectCandlePattern(candles: CandleData[]): CandlePattern {
  if (candles.length < 3) return { type: 'none', strength: 0 };
  const c = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const shape = analyzeCandleShape(c);
  const prevShape = analyzeCandleShape(prev);

  // Doji: very small body relative to range
  if (shape.bodyRatio < 0.15 && (c.high - c.low) > 0) {
    return { type: 'doji', strength: 0.6 };
  }

  // Long upper wick bearish (rejection of higher prices)
  if (shape.upperWick > 0.50 && shape.bodyRatio < 0.35) {
    return { type: 'long_wick_bearish', strength: Math.min(shape.upperWick, 0.9) };
  }

  // Long lower wick bullish (rejection of lower prices)
  if (shape.lowerWick > 0.50 && shape.bodyRatio < 0.35) {
    return { type: 'long_wick_bullish', strength: Math.min(shape.lowerWick, 0.9) };
  }

  // Pin bar bearish: small body at top, long lower shadow... wait, pin bar bearish = long upper wick
  // Classic pin bar: body < 1/3 of range, one wick > 2/3 of range
  const range = c.high - c.low;
  if (range > 0) {
    const bodyTop = Math.max(c.close, c.open);
    const bodyBottom = Math.min(c.close, c.open);
    const upperWickLen = c.high - bodyTop;
    const lowerWickLen = bodyBottom - c.low;

    // Bearish pin bar: long upper wick, body at bottom
    if (upperWickLen > range * 0.6 && shape.bodyRatio < 0.35 && c.close < c.open) {
      return { type: 'pin_bar_bearish', strength: Math.min(upperWickLen / range, 1) };
    }

    // Bullish pin bar: long lower wick, body at top
    if (lowerWickLen > range * 0.6 && shape.bodyRatio < 0.35 && c.close > c.open) {
      return { type: 'pin_bar_bullish', strength: Math.min(lowerWickLen / range, 1) };
    }
  }

  // Engulfing patterns
  if (c.close > c.open && prev.close < prev.open) { // Bullish engulfing
    if (c.open <= prev.close && c.close >= prev.open) {
      return { type: 'engulfing_bullish', strength: Math.min(shape.bodyRatio * 1.5, 1) };
    }
  }
  if (c.close < c.open && prev.close > prev.open) { // Bearish engulfing
    if (c.open >= prev.close && c.close <= prev.open) {
      return { type: 'engulfing_bearish', strength: Math.min(shape.bodyRatio * 1.5, 1) };
    }
  }

  return { type: 'none', strength: 0 };
}

// --- Helper: Find nearest S/R level ---

function findNearestLevel(
  price: number,
  levels: SRLevel[],
  direction: 'above' | 'below' | 'any',
  maxDistPct: number = 5,
): SRLevel | null {
  let best: SRLevel | null = null;
  let bestDist = Infinity;

  for (const lv of levels) {
    const dist = Math.abs(lv.price - price) / price * 100;
    if (dist > maxDistPct) continue;

    if (direction === 'above' && lv.price <= price) continue;
    if (direction === 'below' && lv.price >= price) continue;

    if (dist < bestDist) {
      bestDist = dist;
      best = lv;
    }
  }

  return best;
}

// --- Helper: Average volume of last N candles ---

function avgVolume(candles: CandleData[], n: number = 20): number {
  const sl = candles.slice(-n);
  return sl.reduce((s, c) => s + c.volume, 0) / sl.length;
}

// --- Helper: No decision ---

function noDecision(symbol: string): TradingDecision {
  return { symbol, direction: 'none', score: 0, leverage: 1, stopLoss: 0, takeProfit: 0, indicators: [] };
}

// ============================================================
// Strategy 1: Momentum Pro (1H) — "Smart Pullback"
// Only 4 valid entry patterns, ALL require S/R touch.
// ============================================================

function makeMomentumDecision(symbol: string, candles: CandleData[]): TradingDecision {
  if (candles.length < 100) return noDecision(symbol);

  const n = candles.length;
  const price = candles[n - 1].close;
  const closes = candles.map(c => c.close);

  // Calculate indicators for filtering
  const atr = calcATR(candles, 14);
  const adxData = calcADX(candles);
  const rsi = calcRSI(closes);
  const e20arr = ema(closes, 20);
  const ema20 = e20arr[e20arr.length - 1] || 0;

  // ADX regime filter: ADX < 15 → return none (very choppy)
  // With S/R-first entry, we can trade in moderate ADX since the level provides the edge
  if (adxData.adx < 15) return noDecision(symbol);

  // Step 1: Detect market structure
  const trend = detectTrend(candles);

  // Step 2: Find S/R levels (lookback=7 for 1H)
  const levels = findSRLevels(candles, 7);
  if (levels.length === 0) return noDecision(symbol);

  // Step 3: Detect candle pattern
  const pattern = detectCandlePattern(candles);

  // Step 4: Volume check — any of last 3 candles above average?
  const volAvg = avgVolume(candles, 20);
  const volAboveAvg = candles.slice(-3).some(c => c.volume > volAvg);

  // ==================================================================
  // PATTERN A: Rejection at Resistance → SHORT
  // ==================================================================
  if (trend.direction === 'down' || trend.direction === 'range') {
    // Find nearest resistance above price
    const resistLevel = findNearestLevel(price, levels, 'above', 3);
    if (resistLevel) {
      const touch = verifyLevelTouch(candles, resistLevel, 'test_resistance', 3, 0.15);
      if (touch.touched) {
        // Check for rejection candle pattern
        const isBearishRejection =
          pattern.type === 'pin_bar_bearish' ||
          pattern.type === 'engulfing_bearish' ||
          pattern.type === 'long_wick_bearish';
        const isDojiAtResistance = pattern.type === 'doji';

        if (isBearishRejection && price < resistLevel.price && volAboveAvg) {
          const sl = resistLevel.price + atr * 1.2;
          const slDist = sl - price;
          const nextSupport = findNearestLevel(price, levels, 'below', 10);
          let tp: number;
          if (nextSupport && nextSupport.price < price) {
            tp = nextSupport.price;
          } else {
            tp = price - slDist * 3; // 1:3 R:R
          }

          // Cap TP at 15%
          tp = Math.max(tp, price * (1 - 0.15));

          // Ensure minimum R:R of 2:1
          {
            const slDist = Math.abs(sl - price) / price;
            const tpDist = Math.abs(tp - price) / price;
            if (tpDist < slDist * 2) {
              tp = price - slDist * 2.5;
            }
          }

          // Spike guard
          const guard = spikeGuard(candles, closes, atr, rsi, 'short', ema20);
          if (guard.blocked) return noDecision(symbol);

          const score = 0.35 + resistLevel.strength * 0.3 + pattern.strength * 0.2 + (volAboveAvg ? 0.1 : 0);

          console.log(`[Momentum] ${symbol} SHORT @ ${price.toFixed(4)} | reason: rejection_resistance | level: ${resistLevel.price.toFixed(4)} | touched: ${touch.touchType} | pattern: ${pattern.type} | trend: ${trend.direction}(${trend.strength.toFixed(2)})`);

          return {
            symbol,
            direction: 'short',
            score: Math.min(score, 1),
            leverage: 3,
            stopLoss: Math.round(sl * 1e8) / 1e8,
            takeProfit: Math.round(tp * 1e8) / 1e8,
            indicators: [],
          };
        }

        // Doji at resistance in range/down trend = potential reversal
        if (isDojiAtResistance && price < resistLevel.price && volAboveAvg) {
          const sl = resistLevel.price + atr * 1.2;
          const slDist = sl - price;
          const nextSupport = findNearestLevel(price, levels, 'below', 10);
          let tp: number;
          if (nextSupport && nextSupport.price < price) {
            tp = nextSupport.price;
          } else {
            tp = price - slDist * 3;
          }
          tp = Math.max(tp, price * (1 - 0.15));

          // Ensure minimum R:R of 2:1
          {
            const slDist = Math.abs(sl - price) / price;
            const tpDist = Math.abs(tp - price) / price;
            if (tpDist < slDist * 2) {
              tp = price - slDist * 2.5;
            }
          }

          const guard = spikeGuard(candles, closes, atr, rsi, 'short', ema20);
          if (guard.blocked) return noDecision(symbol);

          const score = 0.35 + resistLevel.strength * 0.2 + 0.1;

          console.log(`[Momentum] ${symbol} SHORT @ ${price.toFixed(4)} | reason: doji_resistance | level: ${resistLevel.price.toFixed(4)} | touched: ${touch.touchType} | trend: ${trend.direction}(${trend.strength.toFixed(2)})`);

          return {
            symbol,
            direction: 'short',
            score: Math.min(score, 0.8),
            leverage: 2,
            stopLoss: Math.round(sl * 1e8) / 1e8,
            takeProfit: Math.round(tp * 1e8) / 1e8,
            indicators: [],
          };
        }
      }
    }
  }

  // ==================================================================
  // PATTERN B: Bounce at Support → LONG
  // ==================================================================
  if (trend.direction === 'up' || trend.direction === 'range') {
    const supportLevel = findNearestLevel(price, levels, 'below', 3);
    if (supportLevel) {
      const touch = verifyLevelTouch(candles, supportLevel, 'test_support', 3, 0.15);
      if (touch.touched) {
        const isBullishBounce =
          pattern.type === 'pin_bar_bullish' ||
          pattern.type === 'engulfing_bullish' ||
          pattern.type === 'long_wick_bullish';
        const isDojiAtSupport = pattern.type === 'doji';

        if (isBullishBounce && price > supportLevel.price && volAboveAvg) {
          const sl = supportLevel.price - atr * 1.2;
          const slDist = price - sl;
          const nextResistance = findNearestLevel(price, levels, 'above', 10);
          let tp: number;
          if (nextResistance && nextResistance.price > price) {
            tp = nextResistance.price;
          } else {
            tp = price + slDist * 3;
          }
          tp = Math.min(tp, price * (1 + 0.15));

          // Ensure minimum R:R of 2:1
          {
            const slDist = Math.abs(sl - price) / price;
            const tpDist = Math.abs(tp - price) / price;
            if (tpDist < slDist * 2) {
              tp = price + slDist * 2.5;
            }
          }

          const guard = spikeGuard(candles, closes, atr, rsi, 'long', ema20);
          if (guard.blocked) return noDecision(symbol);

          const score = 0.35 + supportLevel.strength * 0.3 + pattern.strength * 0.2 + (volAboveAvg ? 0.1 : 0);

          console.log(`[Momentum] ${symbol} LONG @ ${price.toFixed(4)} | reason: bounce_support | level: ${supportLevel.price.toFixed(4)} | touched: ${touch.touchType} | pattern: ${pattern.type} | trend: ${trend.direction}(${trend.strength.toFixed(2)})`);

          return {
            symbol,
            direction: 'long',
            score: Math.min(score, 1),
            leverage: 3,
            stopLoss: Math.round(sl * 1e8) / 1e8,
            takeProfit: Math.round(tp * 1e8) / 1e8,
            indicators: [],
          };
        }

        if (isDojiAtSupport && price > supportLevel.price && volAboveAvg) {
          const sl = supportLevel.price - atr * 1.2;
          const slDist = price - sl;
          const nextResistance = findNearestLevel(price, levels, 'above', 10);
          let tp: number;
          if (nextResistance && nextResistance.price > price) {
            tp = nextResistance.price;
          } else {
            tp = price + slDist * 3;
          }
          tp = Math.min(tp, price * (1 + 0.15));

          // Ensure minimum R:R of 2:1
          {
            const slDist = Math.abs(sl - price) / price;
            const tpDist = Math.abs(tp - price) / price;
            if (tpDist < slDist * 2) {
              tp = price + slDist * 2.5;
            }
          }

          const guard = spikeGuard(candles, closes, atr, rsi, 'long', ema20);
          if (guard.blocked) return noDecision(symbol);

          const score = 0.35 + supportLevel.strength * 0.2 + 0.1;

          console.log(`[Momentum] ${symbol} LONG @ ${price.toFixed(4)} | reason: doji_support | level: ${supportLevel.price.toFixed(4)} | touched: ${touch.touchType} | trend: ${trend.direction}(${trend.strength.toFixed(2)})`);

          return {
            symbol,
            direction: 'long',
            score: Math.min(score, 0.8),
            leverage: 2,
            stopLoss: Math.round(sl * 1e8) / 1e8,
            takeProfit: Math.round(tp * 1e8) / 1e8,
            indicators: [],
          };
        }
      }
    }
  }

  // ==================================================================
  // PATTERN C: Pullback to Support in Uptrend → LONG
  // ==================================================================
  if (trend.direction === 'up' && (trend.structure === 'HH_HL' || trend.strength > 0.3)) {
    const supportLevel = findNearestLevel(price, levels, 'below', 5);
    if (supportLevel) {
      const touch = verifyLevelTouch(candles, supportLevel, 'test_support', 3, 0.15);
      if (touch.touched) {
        // At minimum: doji or small body at support
        const lastShape = analyzeCandleShape(candles[n - 1]);
        const isIndecision = lastShape.bodyRatio < 0.35;
        const isBullish = candles[n - 1].close > candles[n - 1].open;

        if (isIndecision || isBullish) {
          const sl = supportLevel.price - atr * 1.2;
          const slDist = price - sl;
          // Target previous swing high or 1:3 R:R
          const nextResistance = findNearestLevel(price, levels, 'above', 10);
          let tp: number;
          if (nextResistance && nextResistance.price > price) {
            tp = nextResistance.price;
          } else {
            tp = price + slDist * 3;
          }
          tp = Math.min(tp, price * (1 + 0.15));

          // Ensure minimum R:R of 2:1
          {
            const slDist = Math.abs(sl - price) / price;
            const tpDist = Math.abs(tp - price) / price;
            if (tpDist < slDist * 2) {
              tp = price + slDist * 2.5;
            }
          }

          const guard = spikeGuard(candles, closes, atr, rsi, 'long', ema20);
          if (guard.blocked) return noDecision(symbol);

          const score = 0.4 + trend.strength * 0.2 + supportLevel.strength * 0.2 + (isBullish ? 0.1 : 0);

          console.log(`[Momentum] ${symbol} LONG @ ${price.toFixed(4)} | reason: pullback_support_uptrend | level: ${supportLevel.price.toFixed(4)} | touched: ${touch.touchType} | trend: ${trend.direction}(${trend.strength.toFixed(2)})`);

          return {
            symbol,
            direction: 'long',
            score: Math.min(score, 1),
            leverage: 3,
            stopLoss: Math.round(sl * 1e8) / 1e8,
            takeProfit: Math.round(tp * 1e8) / 1e8,
            indicators: [],
          };
        }
      }
    }
  }

  // ==================================================================
  // PATTERN D: Pullback to Resistance in Downtrend → SHORT
  // ==================================================================
  if (trend.direction === 'down' && (trend.structure === 'LH_LL' || trend.strength > 0.3)) {
    const resistLevel = findNearestLevel(price, levels, 'above', 5);
    if (resistLevel) {
      const touch = verifyLevelTouch(candles, resistLevel, 'test_resistance', 3, 0.15);
      if (touch.touched) {
        const lastShape = analyzeCandleShape(candles[n - 1]);
        const isIndecision = lastShape.bodyRatio < 0.35;
        const isBearish = candles[n - 1].close < candles[n - 1].open;

        if (isIndecision || isBearish) {
          const sl = resistLevel.price + atr * 1.2;
          const slDist = sl - price;
          const nextSupport = findNearestLevel(price, levels, 'below', 10);
          let tp: number;
          if (nextSupport && nextSupport.price < price) {
            tp = nextSupport.price;
          } else {
            tp = price - slDist * 3;
          }
          tp = Math.max(tp, price * (1 - 0.15));

          // Ensure minimum R:R of 2:1
          {
            const slDist = Math.abs(sl - price) / price;
            const tpDist = Math.abs(tp - price) / price;
            if (tpDist < slDist * 2) {
              tp = price - slDist * 2.5;
            }
          }

          const guard = spikeGuard(candles, closes, atr, rsi, 'short', ema20);
          if (guard.blocked) return noDecision(symbol);

          const score = 0.4 + trend.strength * 0.2 + resistLevel.strength * 0.2 + (isBearish ? 0.1 : 0);

          console.log(`[Momentum] ${symbol} SHORT @ ${price.toFixed(4)} | reason: pullback_resistance_downtrend | level: ${resistLevel.price.toFixed(4)} | touched: ${touch.touchType} | trend: ${trend.direction}(${trend.strength.toFixed(2)})`);

          return {
            symbol,
            direction: 'short',
            score: Math.min(score, 1),
            leverage: 3,
            stopLoss: Math.round(sl * 1e8) / 1e8,
            takeProfit: Math.round(tp * 1e8) / 1e8,
            indicators: [],
          };
        }
      }
    }
  }

  // No pattern matched → no trade. Period.
  return noDecision(symbol);
}

// ============================================================
// Strategy 2: Scalp Hunter (5M) — "Level Scalper"
// S/R-first on 5M with tighter parameters
// ============================================================

function makeScalpHunterDecision(symbol: string, candles: CandleData[]): TradingDecision {
  if (candles.length < 100) return noDecision(symbol);

  const n = candles.length;
  const price = candles[n - 1].close;
  const closes = candles.map(c => c.close);

  const atr = calcATR(candles, 14);
  const rsi = calcRSI(closes, 7); // Faster RSI for scalping
  const e20arr = ema(closes, 20);
  const ema20 = e20arr[e20arr.length - 1] || 0;
  const volAvg = avgVolume(candles, 20);
  const lastVol = candles[n - 1].volume;
  const volSpike = lastVol > volAvg * 1.5;

  // Find S/R levels with lookback=10 for 5M (need more bars)
  const levels = findSRLevels(candles, 10, 0.4, 3); // minTouches=3 for stronger threshold
  const strongLevels = levels.filter(l => l.strength > 0.3);
  if (strongLevels.length === 0) return noDecision(symbol);

  const pattern = detectCandlePattern(candles);

  // RSI direction: rising = long-biased, falling = short-biased
  const rsiPrev = calcRSI(closes.slice(0, -1), 7);
  const rsiRising = rsi > rsiPrev;

  // Max 2 indicators need to agree (RSI direction + volume), but S/R touch is MANDATORY
  let indicatorAgree = 0;
  if (rsiRising) indicatorAgree++;
  else indicatorAgree--;
  if (volSpike) indicatorAgree++; // volume spike always helps

  // Touch verification: 0.1% (tighter for scalping)
  // ==================================================================
  // SHORT: Price touched resistance, rejection pattern + volume spike
  // ==================================================================
  const resistLevel = findNearestLevel(price, strongLevels, 'above', 2);
  if (resistLevel) {
    const touch = verifyLevelTouch(candles, resistLevel, 'test_resistance', 3, 0.1);
    if (touch.touched) {
      const isBearishRejection =
        pattern.type === 'pin_bar_bearish' ||
        pattern.type === 'engulfing_bearish' ||
        pattern.type === 'long_wick_bearish' ||
        pattern.type === 'doji';

      if (isBearishRejection && price < resistLevel.price) {
        // Require at least RSI falling or volume spike
        if (indicatorAgree <= 0 || volSpike) {
          const sl = price + Math.max(atr * 1.2, price * 0.005); // 1.2×ATR, min 0.5%
          const slDist = sl - price;
          let tp = price - slDist * 2.5; // 1:2.5 R:R
          tp = Math.max(tp, price * (1 - 0.05)); // cap 5%

          const guard = spikeGuard(candles, closes, atr, rsi, 'short', ema20, {
            atrMax: 2.0, rocMax: 5, rsiOS: 15,
          });
          if (guard.blocked) return noDecision(symbol);

          const score = 0.2 + resistLevel.strength * 0.3 + pattern.strength * 0.2 + (volSpike ? 0.2 : 0);

          console.log(`[Scalper] ${symbol} SHORT @ ${price.toFixed(4)} | reason: rejection_resistance | level: ${resistLevel.price.toFixed(4)} | touched: ${touch.touchType} | volSpike: ${volSpike} | rsi: ${rsi.toFixed(1)}`);

          return {
            symbol,
            direction: 'short',
            score: Math.min(score, 0.9),
            leverage: 2,
            stopLoss: Math.round(sl * 1e8) / 1e8,
            takeProfit: Math.round(tp * 1e8) / 1e8,
            indicators: [],
          };
        }
      }
    }
  }

  // ==================================================================
  // LONG: Price touched support, bounce pattern + volume spike
  // ==================================================================
  const supportLevel = findNearestLevel(price, strongLevels, 'below', 2);
  if (supportLevel) {
    const touch = verifyLevelTouch(candles, supportLevel, 'test_support', 3, 0.1);
    if (touch.touched) {
      const isBullishBounce =
        pattern.type === 'pin_bar_bullish' ||
        pattern.type === 'engulfing_bullish' ||
        pattern.type === 'long_wick_bullish' ||
        pattern.type === 'doji';

      if (isBullishBounce && price > supportLevel.price) {
        if (indicatorAgree >= 0 || volSpike) {
          const sl = price - Math.max(atr * 1.2, price * 0.005);
          const slDist = price - sl;
          let tp = price + slDist * 2.5;
          tp = Math.min(tp, price * (1 + 0.05)); // cap 5%

          const guard = spikeGuard(candles, closes, atr, rsi, 'long', ema20, {
            atrMax: 2.0, rocMax: 5, rsiOB: 85,
          });
          if (guard.blocked) return noDecision(symbol);

          const score = 0.2 + supportLevel.strength * 0.3 + pattern.strength * 0.2 + (volSpike ? 0.2 : 0);

          console.log(`[Scalper] ${symbol} LONG @ ${price.toFixed(4)} | reason: bounce_support | level: ${supportLevel.price.toFixed(4)} | touched: ${touch.touchType} | volSpike: ${volSpike} | rsi: ${rsi.toFixed(1)}`);

          return {
            symbol,
            direction: 'long',
            score: Math.min(score, 0.9),
            leverage: 2,
            stopLoss: Math.round(sl * 1e8) / 1e8,
            takeProfit: Math.round(tp * 1e8) / 1e8,
            indicators: [],
          };
        }
      }
    }
  }

  return noDecision(symbol);
}

// ============================================================
// Strategy 3: Position Alpha (4H) — "Major Reversal"
// EMA50/200 crossover MUST happen near a major S/R level
// ============================================================

function makePositionAlphaDecision(symbol: string, candles: CandleData[]): TradingDecision {
  if (candles.length < 220) return noDecision(symbol); // Need 200+ for EMA200

  const n = candles.length;
  const price = candles[n - 1].close;
  const closes = candles.map(c => c.close);

  const atr = calcATR(candles, 14);
  const adxData = calcADX(candles);
  const rsi = calcRSI(closes);
  const e20arr = ema(closes, 20);
  const ema20 = e20arr[e20arr.length - 1] || 0;

  // ADX > 25 required (config says 30, but 25 is the strategy adxMin)
  if (adxData.adx < 25) return noDecision(symbol);

  // EMA50 and EMA200
  const e50 = ema(closes, 50);
  const e200 = ema(closes, 200);
  const ema50Now = e50[n - 1];
  const ema200Now = e200[n - 1];
  const ema50Prev = e50[n - 2];
  const ema200Prev = e200[n - 2];

  if (isNaN(ema50Now) || isNaN(ema200Now) || isNaN(ema50Prev) || isNaN(ema200Prev)) {
    return noDecision(symbol);
  }

  // Detect crossover in the last 5 candles
  let crossoverType: 'golden' | 'death' | null = null;
  let crossoverIdx = -1;
  for (let i = n - 5; i < n; i++) {
    if (isNaN(e50[i]) || isNaN(e200[i]) || isNaN(e50[i-1]) || isNaN(e200[i-1])) continue;
    if (e50[i-1] <= e200[i-1] && e50[i] > e200[i]) {
      crossoverType = 'golden';
      crossoverIdx = i;
      break;
    }
    if (e50[i-1] >= e200[i-1] && e50[i] < e200[i]) {
      crossoverType = 'death';
      crossoverIdx = i;
      break;
    }
  }

  // If no recent crossover, no trade
  if (!crossoverType) return noDecision(symbol);

  // Find S/R levels
  const levels = findSRLevels(candles, 7, 0.5, 2);
  if (levels.length === 0) return noDecision(symbol);

  // CRITICAL: Crossover must happen near a major S/R level (within 2%)
  const nearLevel = findNearestLevel(price, levels, 'any', 2);
  if (!nearLevel) {
    console.log(`[PositionAlpha] ${symbol} SKIP: crossover(${crossoverType}) but no S/R level within 2% (price=${price.toFixed(4)})`);
    return noDecision(symbol);
  }

  // Additional confirmation: MACD direction
  const macd = calcMACD(closes);
  const macdBullish = macd.histogram > 0 && macd.macdLine > macd.signalLine;
  const macdBearish = macd.histogram < 0 && macd.macdLine < macd.signalLine;

  // Additional confirmation: OBV trend alignment
  const obv = calcOBV(candles);

  // Spike guard
  const guard = spikeGuard(candles, closes, atr, rsi, crossoverType === 'golden' ? 'long' : 'short', ema20);
  if (guard.blocked) return noDecision(symbol);

  // ==================================================================
  // Golden Cross near support → LONG
  // ==================================================================
  if (crossoverType === 'golden') {
    const levelTypeOk = nearLevel.type === 'support';
    if (levelTypeOk && macdBullish) {
      const sl = price - atr * 4; // Wide SL: 4×ATR
      const slDist = price - sl;
      let tp = price + slDist * 5; // 1:5 R:R
      tp = Math.min(tp, price * (1 + 0.15)); // cap 15%

      const score = 0.4 + nearLevel.strength * 0.2 + (adxData.adx > 30 ? 0.15 : 0.05) + (obv.trend > 0 ? 0.1 : 0);

      console.log(`[PositionAlpha] ${symbol} LONG @ ${price.toFixed(4)} | reason: golden_cross_at_SR | level: ${nearLevel.price.toFixed(4)}(${nearLevel.type}) | adx: ${adxData.adx.toFixed(1)} | macd: bullish`);

      return {
        symbol,
        direction: 'long',
        score: Math.min(score, 1),
        leverage: 2,
        stopLoss: Math.round(sl * 1e8) / 1e8,
        takeProfit: Math.round(tp * 1e8) / 1e8,
        indicators: [],
      };
    }
  }

  // ==================================================================
  // Death Cross near resistance → SHORT
  // ==================================================================
  if (crossoverType === 'death') {
    const levelTypeOk = nearLevel.type === 'resistance';
    if (levelTypeOk && macdBearish) {
      const sl = price + atr * 4;
      const slDist = sl - price;
      let tp = price - slDist * 5;
      tp = Math.max(tp, price * (1 - 0.15));

      const score = 0.4 + nearLevel.strength * 0.2 + (adxData.adx > 30 ? 0.15 : 0.05) + (obv.trend < 0 ? 0.1 : 0);

      console.log(`[PositionAlpha] ${symbol} SHORT @ ${price.toFixed(4)} | reason: death_cross_at_SR | level: ${nearLevel.price.toFixed(4)}(${nearLevel.type}) | adx: ${adxData.adx.toFixed(1)} | macd: bearish`);

      return {
        symbol,
        direction: 'short',
        score: Math.min(score, 1),
        leverage: 2,
        stopLoss: Math.round(sl * 1e8) / 1e8,
        takeProfit: Math.round(tp * 1e8) / 1e8,
        indicators: [],
      };
    }
  }

  return noDecision(symbol);
}

// ============================================================
// Multi-Strategy Decision Router
// ============================================================

export function makeStrategyDecision(
  strategyId: string,
  symbol: string,
  candles: CandleData[],
  _idleMinutes: number,
  _strategyOverride?: StrategyConfig,
): TradingDecision {
  let decision: TradingDecision;
  switch (strategyId) {
    case 'momentum':
      decision = makeMomentumDecision(symbol, candles);
      break;
    case 'scalper':
      decision = makeScalpHunterDecision(symbol, candles);
      break;
    case 'position-alpha':
      decision = makePositionAlphaDecision(symbol, candles);
      break;
    default:
      decision = makeMomentumDecision(symbol, candles);
      break;
  }

  // Minimum R:R validation
  const currentPrice = candles[candles.length - 1]?.close ?? 0;
  if (decision.direction !== 'none' && decision.stopLoss && decision.takeProfit && currentPrice > 0) {
    const slDist = Math.abs(decision.stopLoss - currentPrice) / currentPrice;
    const tpDist = Math.abs(decision.takeProfit - currentPrice) / currentPrice;
    const rr = tpDist / Math.max(slDist, 0.0001);
    if (rr < 1.5) {
      decision.direction = 'none';
      decision.score = 0;
    }
  }

  return decision;
}

// ============================================================
// Generic Trading Decision (legacy — for backward compatibility)
// Uses indicator confluence only, NOT used by new strategies
// ============================================================

export function makeTradingDecision(
  symbol: string,
  candles: CandleData[],
  weights: Record<string, number>,
): TradingDecision {
  if (candles.length < 50) return noDecision(symbol);

  const closes = candles.map(c => c.close);
  const atr = calcATR(candles, 14);
  const rsi = calcRSI(closes);
  const signals = analyzeIndicators(candles, weights);

  let longScore = 0, shortScore = 0;
  for (const sig of signals) {
    const w = weights[sig.name] ?? 1;
    if (sig.signal > 0) longScore += sig.strength * w;
    if (sig.signal < 0) shortScore += sig.strength * w;
  }

  const direction = longScore > shortScore ? 'long' : shortScore > longScore ? 'short' : 'none';
  const score = Math.max(longScore, shortScore) / 10;

  if (direction === 'none' || score < 0.3) return noDecision(symbol);

  const price = candles[candles.length - 1].close;
  const e20arr = ema(closes, 20);
  const ema20 = e20arr[e20arr.length - 1] || 0;
  const guard = spikeGuard(candles, closes, atr, rsi, direction, ema20);
  if (guard.blocked) return noDecision(symbol);

  const slDist = Math.max(atr * 2.5, price * 0.01);
  const isLong = direction === 'long';
  const sl = isLong ? price - slDist : price + slDist;
  const tp = isLong ? price + slDist * 3 : price - slDist * 3;

  return {
    symbol,
    direction: direction as 'long' | 'short',
    score: Math.min(score, 1),
    leverage: 2,
    stopLoss: Math.round(sl * 1e8) / 1e8,
    takeProfit: Math.round(tp * 1e8) / 1e8,
    indicators: signals,
  };
}

// ============================================================
// Order Book Analysis (unchanged)
// ============================================================

export function analyzeOrderBook(bids: Array<[string, string]>, asks: Array<[string, string]>): OrderBookData {
  const bidLevels: OrderBookLevel[] = [];
  const askLevels: OrderBookLevel[] = [];
  let bidTotal = 0, askTotal = 0;

  for (const [priceStr, qtyStr] of bids) {
    const price = parseFloat(priceStr);
    const quantity = parseFloat(qtyStr);
    bidTotal += price * quantity;
    bidLevels.push({ price, quantity, total: bidTotal });
  }

  for (const [priceStr, qtyStr] of asks) {
    const price = parseFloat(priceStr);
    const quantity = parseFloat(qtyStr);
    askTotal += price * quantity;
    askLevels.push({ price, quantity, total: askTotal });
  }

  bidLevels.sort((a, b) => b.price - a.price);
  askLevels.sort((a, b) => a.price - b.price);

  const bestBid = bidLevels[0]?.price ?? 0;
  const bestAsk = askLevels[0]?.price ?? 0;
  const spread = bestAsk - bestBid;
  const midPrice = (bestBid + bestAsk) / 2;
  const spreadPercent = midPrice > 0 ? (spread / midPrice) * 100 : 0;

  return { asks: askLevels, bids: bidLevels, spread, spreadPercent, midPrice };
}

// ============================================================
// Data Fetching (unchanged)
// ============================================================

export async function fetchKlines(symbol: string, interval: string = '1h', limit: number = 1440): Promise<CandleData[]> {
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch klines for ${symbol}: ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) return [];
  return data.map((k: (string | number)[]) => ({
    time: Math.floor(Number(k[0]) / 1000),
    open: parseFloat(String(k[1])),
    high: parseFloat(String(k[2])),
    low: parseFloat(String(k[3])),
    close: parseFloat(String(k[4])),
    volume: parseFloat(String(k[5])),
  }));
}

export async function fetchTopSymbols(): Promise<string[]> {
  const res = await fetch('https://api.binance.com/api/v3/ticker/24hr');
  if (!res.ok) return [];
  const data = await res.json();
  return data
    .filter((t: { symbol: string; quoteVolume: string }) =>
      t.symbol.endsWith('USDT') && Number(t.quoteVolume) > 0
    )
    .sort((a: { quoteVolume: string }, b: { quoteVolume: string }) =>
      Number(b.quoteVolume) - Number(a.quoteVolume)
    )
    .slice(0, 50)
    .map((t: { symbol: string }) => t.symbol);
}
