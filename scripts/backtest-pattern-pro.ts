// ============================================================
// Бэктест: 50 аккаунтов × 2 недели — Pattern Pro v2 (FIXED)
// 15m свечи, SL 1.5×ATR, TP 2.0-3.5R, partial TP, trailing
// Структурные паттерны как основной сигнал, односвечные — конфлюэнс
// ============================================================

const BINANCE = 'https://api.binance.com/api/v3';

interface Candle {
  time: number; open: number; high: number; low: number; close: number; volume: number;
}

interface SimTrade {
  id: string;
  symbol: string;
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
  patternName?: string;
  // Partial TP state
  partialState: 'full' | 'tp1_hit' | 'tp2_hit';
  remainingAmount: number;
  realizedPnl: number; // from partial closes
  // Trailing
  trailingLevel: number;
}

// ── Math helpers ──
function calcEMA(data: number[], period: number): number[] {
  const result: number[] = [];
  const mult = 2 / (period + 1);
  let prev: number | null = null;
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { result.push(NaN); continue; }
    if (prev === null) {
      let s = 0; for (let j = i - period + 1; j <= i; j++) s += data[j];
      prev = s / period;
    } else { prev = (data[i] - prev) * mult + prev; }
    result.push(prev);
  }
  return result;
}

function calcATR(candles: Candle[], period: number = 14): number[] {
  const result: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    if (i < period) { result.push(0); continue; }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sum += Math.max(
        candles[j].high - candles[j].low,
        Math.abs(candles[j].high - candles[j - 1].close),
        Math.abs(candles[j].low - candles[j - 1].close)
      );
    }
    result.push(sum / period);
  }
  return result;
}

function calcRSI(closes: number[], period: number = 14): number[] {
  const result: number[] = [];
  if (closes.length < period + 1) return closes.map(() => 50);
  const mult = 1 / period;
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const ch = closes[i] - closes[i - 1];
    if (ch > 0) avgGain += ch; else avgLoss += Math.abs(ch);
  }
  avgGain /= period; avgLoss /= period;
  result.push(...Array(period).fill(50)); // fill warmup
  for (let i = period + 1; i < closes.length; i++) {
    const ch = closes[i] - closes[i - 1];
    if (ch > 0) avgGain = avgGain * (1 - mult) + ch * mult;
    else avgLoss = avgLoss * (1 - mult) + Math.abs(ch) * mult;
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    result.push(100 - (100 / (1 + rs)));
  }
  return result;
}

// ── Pattern Detection (mirrors trading-engine.ts) ──

type PDir = 'bullish' | 'bearish' | 'neutral';

interface DetectedPattern {
  name: string; direction: PDir; reliability: number;
  avgMoveATR: number; strength: number;
  startIndex: number; endIndex: number;
  zoneHigh: number; zoneLow: number;
}

const TIER1_NAMES = new Set([
  'Утренняя звезда', 'Вечерняя звезда',
  'Бычий флаг', 'Медвежий флаг',
  'Близнецы (дно)',
]);
const TIER2_NAMES = new Set([
  'Бычье поглощение', 'Медвежье поглощение',
  'Проникающая линия', 'Тёмное облако',
  'Три белых солдата', 'Три чёрных ворона',
  'Двойное дно', 'Двойная вершина',
  'Восходящий клин', 'Нисходящий клин',
  'Близнецы (вершина)',
]);
const STRUCTURAL_NAMES = new Set([...TIER1_NAMES, ...TIER2_NAMES]);

function candleBody(c: Candle): number { return Math.abs(c.close - c.open); }
function candleRange(c: Candle): number { return c.high - c.low; }
function isBullish(c: Candle): boolean { return c.close > c.open; }
function isBearish(c: Candle): boolean { return c.close < c.open; }
function upperWick(c: Candle): number { return c.high - Math.max(c.close, c.open); }
function lowerWick(c: Candle): number { return Math.min(c.close, c.open) - c.low; }
function bodyMid(c: Candle): number { return (c.open + c.close) / 2; }

function detectHammer(candles: Candle[], idx: number): DetectedPattern | null {
  const c = candles[idx]; const range = candleRange(c);
  if (range === 0) return null;
  const body = candleBody(c), lw = lowerWick(c), uw = upperWick(c);
  if (lw >= body * 2 && uw <= range * 0.1 && body >= range * 0.05)
    return { name: 'Молот', direction: 'bullish', reliability: 0.60, avgMoveATR: 1.0, strength: Math.min(lw / (body * 3), 1), startIndex: idx, endIndex: idx, zoneHigh: c.high, zoneLow: c.low };
  return null;
}

function detectShootingStar(candles: Candle[], idx: number): DetectedPattern | null {
  const c = candles[idx]; const range = candleRange(c);
  if (range === 0) return null;
  const body = candleBody(c), uw = upperWick(c), lw = lowerWick(c);
  if (uw >= body * 2 && lw <= range * 0.1 && body >= range * 0.05)
    return { name: 'Падающая звезда', direction: 'bearish', reliability: 0.59, avgMoveATR: 1.0, strength: Math.min(uw / (body * 3), 1), startIndex: idx, endIndex: idx, zoneHigh: c.high, zoneLow: c.low };
  return null;
}

function detectDoji(candles: Candle[], idx: number): DetectedPattern | null {
  const c = candles[idx]; const range = candleRange(c);
  if (range === 0) return null;
  if (candleBody(c) < range * 0.05)
    return { name: 'Доджи', direction: 'neutral', reliability: 0.0, avgMoveATR: 0.5, strength: 0.5, startIndex: idx, endIndex: idx, zoneHigh: c.high, zoneLow: c.low };
  return null;
}

function detectMarubozu(candles: Candle[], idx: number): DetectedPattern | null {
  const c = candles[idx]; const range = candleRange(c);
  if (range === 0) return null;
  const body = candleBody(c), uw = upperWick(c), lw = lowerWick(c);
  if (body > range * 0.9 && uw < range * 0.05 && lw < range * 0.05) {
    const dir = isBullish(c) ? 'bullish' : 'bearish';
    return { name: 'Марубозу', direction: dir as PDir, reliability: 0.70, avgMoveATR: 1.3, strength: 0.9, startIndex: idx, endIndex: idx, zoneHigh: c.high, zoneLow: c.low };
  }
  return null;
}

function detectBullishEngulfing(candles: Candle[], idx: number): DetectedPattern | null {
  const prev = candles[idx - 1]; const curr = candles[idx];
  if (!isBearish(prev) || !isBullish(curr)) return null;
  const prevBody = candleBody(prev), currBody = candleBody(curr);
  if (currBody <= prevBody) return null;
  if (curr.close >= prev.open && curr.open <= prev.close)
    return { name: 'Бычье поглощение', direction: 'bullish', reliability: 0.63, avgMoveATR: 1.2, strength: Math.min(currBody / (prevBody * 1.5), 1), startIndex: idx - 1, endIndex: idx, zoneHigh: Math.max(prev.high, curr.high), zoneLow: Math.min(prev.low, curr.low) };
  return null;
}

function detectBearishEngulfing(candles: Candle[], idx: number): DetectedPattern | null {
  const prev = candles[idx - 1]; const curr = candles[idx];
  if (!isBullish(prev) || !isBearish(curr)) return null;
  const prevBody = candleBody(prev), currBody = candleBody(curr);
  if (currBody <= prevBody) return null;
  if (curr.open >= prev.close && curr.close <= prev.open)
    return { name: 'Медвежье поглощение', direction: 'bearish', reliability: 0.65, avgMoveATR: 1.2, strength: Math.min(currBody / (prevBody * 1.5), 1), startIndex: idx - 1, endIndex: idx, zoneHigh: Math.max(prev.high, curr.high), zoneLow: Math.min(prev.low, curr.low) };
  return null;
}

function detectPiercingLine(candles: Candle[], idx: number): DetectedPattern | null {
  const prev = candles[idx - 1]; const curr = candles[idx];
  if (!isBearish(prev) || !isBullish(curr)) return null;
  if (curr.open < prev.close && curr.close > bodyMid(prev))
    return { name: 'Проникающая линия', direction: 'bullish', reliability: 0.58, avgMoveATR: 0.9, strength: Math.min((curr.close - bodyMid(prev)) / candleBody(prev), 1), startIndex: idx - 1, endIndex: idx, zoneHigh: Math.max(prev.high, curr.high), zoneLow: Math.min(prev.low, curr.low) };
  return null;
}

function detectDarkCloudCover(candles: Candle[], idx: number): DetectedPattern | null {
  const prev = candles[idx - 1]; const curr = candles[idx];
  if (!isBullish(prev) || !isBearish(curr)) return null;
  if (curr.open > prev.close && curr.close < bodyMid(prev))
    return { name: 'Тёмное облако', direction: 'bearish', reliability: 0.60, avgMoveATR: 0.9, strength: Math.min((bodyMid(prev) - curr.close) / candleBody(prev), 1), startIndex: idx - 1, endIndex: idx, zoneHigh: Math.max(prev.high, curr.high), zoneLow: Math.min(prev.low, curr.low) };
  return null;
}

function detectTweezerBottom(candles: Candle[], idx: number): DetectedPattern | null {
  const c1 = candles[idx - 2]; const c2 = candles[idx - 1]; const c3 = candles[idx];
  if (!isBearish(c1) || Math.abs(c2.low - c3.low) > candleRange(c2) * 0.05) return null;
  if (c2.low <= c1.low * 1.002 && c3.low <= c1.low * 1.002 && isBullish(c3))
    return { name: 'Близнецы (дно)', direction: 'bullish', reliability: 0.61, avgMoveATR: 1.0, strength: 0.7, startIndex: idx - 2, endIndex: idx, zoneHigh: Math.max(c1.high, c2.high, c3.high), zoneLow: Math.min(c1.low, c2.low, c3.low) };
  return null;
}

function detectTweezerTop(candles: Candle[], idx: number): DetectedPattern | null {
  const c1 = candles[idx - 2]; const c2 = candles[idx - 1]; const c3 = candles[idx];
  if (!isBullish(c1) || Math.abs(c2.high - c3.high) > candleRange(c2) * 0.05) return null;
  if (c2.high >= c1.high * 0.998 && c3.high >= c1.high * 0.998 && isBearish(c3))
    return { name: 'Близнецы (вершина)', direction: 'bearish', reliability: 0.62, avgMoveATR: 1.0, strength: 0.7, startIndex: idx - 2, endIndex: idx, zoneHigh: Math.max(c1.high, c2.high, c3.high), zoneLow: Math.min(c1.low, c2.low, c3.low) };
  return null;
}

function detectMorningStar(candles: Candle[], idx: number): DetectedPattern | null {
  const c1 = candles[idx - 2]; const c2 = candles[idx - 1]; const c3 = candles[idx];
  if (!isBearish(c1) || !isBullish(c3)) return null;
  const r2 = candleRange(c2);
  if (r2 > 0 && candleBody(c2) < r2 * 0.15) {
    const gapDown = c2.high < c1.close;
    const closesIntoPrev = c3.close > bodyMid(c1);
    if ((gapDown || c2.open < c1.close) && closesIntoPrev)
      return { name: 'Утренняя звезда', direction: 'bullish', reliability: 0.78, avgMoveATR: 1.5, strength: gapDown ? 1.0 : 0.7, startIndex: idx - 2, endIndex: idx, zoneHigh: Math.max(c1.high, c2.high, c3.high), zoneLow: Math.min(c1.low, c2.low, c3.low) };
  }
  return null;
}

function detectEveningStar(candles: Candle[], idx: number): DetectedPattern | null {
  const c1 = candles[idx - 2]; const c2 = candles[idx - 1]; const c3 = candles[idx];
  if (!isBullish(c1) || !isBearish(c3)) return null;
  const r2 = candleRange(c2);
  if (r2 > 0 && candleBody(c2) < r2 * 0.15) {
    const gapUp = c2.low > c1.close;
    const closesIntoPrev = c3.close < bodyMid(c1);
    if ((gapUp || c2.open > c1.close) && closesIntoPrev)
      return { name: 'Вечерняя звезда', direction: 'bearish', reliability: 0.75, avgMoveATR: 1.4, strength: gapUp ? 1.0 : 0.7, startIndex: idx - 2, endIndex: idx, zoneHigh: Math.max(c1.high, c2.high, c3.high), zoneLow: Math.min(c1.low, c2.low, c3.low) };
  }
  return null;
}

function detectThreeWhiteSoldiers(candles: Candle[], idx: number): DetectedPattern | null {
  const c1 = candles[idx - 2]; const c2 = candles[idx - 1]; const c3 = candles[idx];
  if (!isBullish(c1) || !isBullish(c2) || !isBullish(c3)) return null;
  const ok = c2.open > c1.open && c2.close > c1.close && c3.open > c2.open && c3.close > c2.close;
  const noWick = [c1, c2, c3].every(c => upperWick(c) < candleBody(c) * 0.3);
  if (ok && noWick)
    return { name: 'Три белых солдата', direction: 'bullish', reliability: 0.73, avgMoveATR: 1.4, strength: 0.85, startIndex: idx - 2, endIndex: idx, zoneHigh: Math.max(c1.high, c2.high, c3.high), zoneLow: Math.min(c1.low, c2.low, c3.low) };
  return null;
}

function detectThreeBlackCrows(candles: Candle[], idx: number): DetectedPattern | null {
  const c1 = candles[idx - 2]; const c2 = candles[idx - 1]; const c3 = candles[idx];
  if (!isBearish(c1) || !isBearish(c2) || !isBearish(c3)) return null;
  const ok = c2.open < c1.open && c2.close < c1.close && c3.open < c2.open && c3.close < c2.close;
  const noWick = [c1, c2, c3].every(c => lowerWick(c) < candleBody(c) * 0.3);
  if (ok && noWick)
    return { name: 'Три чёрных ворона', direction: 'bearish', reliability: 0.71, avgMoveATR: 1.3, strength: 0.85, startIndex: idx - 2, endIndex: idx, zoneHigh: Math.max(c1.high, c2.high, c3.high), zoneLow: Math.min(c1.low, c2.low, c3.low) };
  return null;
}

function detectDoubleBottom(candles: Candle[]): DetectedPattern | null {
  if (candles.length < 15) return null;
  const n = candles.length; const last20 = candles.slice(-20);
  const lows = last20.map(c => c.low);
  const min1 = Math.min(...lows.slice(0, -5));
  const min1Idx = lows.slice(0, -5).indexOf(min1);
  const min2 = Math.min(...lows.slice(-8));
  const min2Idx = lows.length - 8 + lows.slice(-8).indexOf(min2);
  if (Math.abs(min1 - min2) / min1 < 0.01 && min2Idx > min1Idx + 3) {
    const between = last20.slice(min1Idx, min2Idx);
    if (between.length > 2) {
      const peakHigh = Math.max(...between.map(c => c.high));
      if ((peakHigh - Math.min(min1, min2)) / Math.min(min1, min2) > 0.005)
        return { name: 'Двойное дно', direction: 'bullish', reliability: 0.78, avgMoveATR: 2.0, strength: Math.min((peakHigh - Math.min(min1, min2)) / Math.min(min1, min2) / 0.03, 1), startIndex: n - 20 + min1Idx, endIndex: n - 20 + min2Idx, zoneHigh: peakHigh, zoneLow: Math.min(min1, min2) };
    }
  }
  return null;
}

function detectDoubleTop(candles: Candle[]): DetectedPattern | null {
  if (candles.length < 15) return null;
  const n = candles.length; const last20 = candles.slice(-20);
  const highs = last20.map(c => c.high);
  const max1 = Math.max(...highs.slice(0, -5));
  const max1Idx = highs.slice(0, -5).indexOf(max1);
  const max2 = Math.max(...highs.slice(-8));
  const max2Idx = highs.length - 8 + highs.slice(-8).indexOf(max2);
  if (Math.abs(max1 - max2) / max1 < 0.01 && max2Idx > max1Idx + 3) {
    const between = last20.slice(max1Idx, max2Idx);
    if (between.length > 2) {
      const troughLow = Math.min(...between.map(c => c.low));
      if ((max1 - troughLow) / max1 > 0.005)
        return { name: 'Двойная вершина', direction: 'bearish', reliability: 0.76, avgMoveATR: 2.0, strength: Math.min((max1 - troughLow) / max1 / 0.03, 1), startIndex: n - 20 + max1Idx, endIndex: n - 20 + max2Idx, zoneHigh: max1, zoneLow: troughLow };
    }
  }
  return null;
}

function detectBullFlag(candles: Candle[]): DetectedPattern | null {
  if (candles.length < 15) return null;
  const n = candles.length; const last15 = candles.slice(-15);
  const pole = last15.slice(0, 5), flag = last15.slice(5);
  if (flag.length < 5) return null;
  const poleMove = (pole[pole.length - 1].close - pole[0].open) / pole[0].open;
  if (poleMove < 0.015) return null;
  const flagHigh = Math.max(...flag.map(c => c.high));
  const flagLow = Math.min(...flag.map(c => c.low));
  const poleHigh = Math.max(...pole.map(c => c.high));
  const retracement = (flagHigh - flagLow) / (poleHigh - pole[0].open);
  if (retracement < 0.5 && flag[flag.length - 1].close > flagLow)
    return { name: 'Бычий флаг', direction: 'bullish', reliability: 0.65, avgMoveATR: 1.5, strength: Math.min(poleMove / 0.04, 1), startIndex: n - 15, endIndex: n - 1, zoneHigh: poleHigh, zoneLow: pole[0].open };
  return null;
}

function detectBearFlag(candles: Candle[]): DetectedPattern | null {
  if (candles.length < 15) return null;
  const n = candles.length; const last15 = candles.slice(-15);
  const pole = last15.slice(0, 5), flag = last15.slice(5);
  if (flag.length < 5) return null;
  const poleMove = (pole[0].open - pole[pole.length - 1].close) / pole[0].open;
  if (poleMove < 0.015) return null;
  const flagHigh = Math.max(...flag.map(c => c.high));
  const flagLow = Math.min(...flag.map(c => c.low));
  const poleLow = Math.min(...pole.map(c => c.low));
  const retracement = (flagHigh - flagLow) / (pole[0].open - poleLow);
  if (retracement < 0.5 && flag[flag.length - 1].close < flagHigh)
    return { name: 'Медвежий флаг', direction: 'bearish', reliability: 0.64, avgMoveATR: 1.5, strength: Math.min(poleMove / 0.04, 1), startIndex: n - 15, endIndex: n - 1, zoneHigh: pole[0].open, zoneLow: poleLow };
  return null;
}

function detectAscendingWedge(candles: Candle[]): DetectedPattern | null {
  if (candles.length < 20) return null;
  const n = candles.length; const last20 = candles.slice(-20);
  const highs = last20.map(c => c.high), lows = last20.map(c => c.low);
  const nn = highs.length;
  let sumXYH = 0, sumX2 = 0, sumYH = 0, sumYL = 0, sumXYL = 0;
  for (let i = 0; i < nn; i++) {
    sumXYH += i * highs[i]; sumX2 += i * i; sumYH += highs[i];
    sumXYL += i * lows[i]; sumYL += lows[i];
  }
  const denom = nn * sumX2 - (nn * (nn - 1) / 2) ** 2;
  if (denom === 0) return null;
  const slopeH = (nn * sumXYH - (nn * (nn - 1) / 2) * sumYH) / denom;
  const slopeL = (nn * sumXYL - (nn * (nn - 1) / 2) * sumYL) / denom;
  if (slopeH > 0 && slopeL > 0 && slopeH > slopeL * 1.1) {
    const convergence = (slopeH - slopeL) / slopeH;
    if (convergence > 0.05)
      return { name: 'Восходящий клин', direction: 'bearish', reliability: 0.71, avgMoveATR: 1.8, strength: Math.min(convergence / 0.3, 1), startIndex: n - 20, endIndex: n - 1, zoneHigh: Math.max(...highs), zoneLow: Math.min(...lows) };
  }
  return null;
}

function detectDescendingWedge(candles: Candle[]): DetectedPattern | null {
  if (candles.length < 20) return null;
  const n = candles.length; const last20 = candles.slice(-20);
  const highs = last20.map(c => c.high), lows = last20.map(c => c.low);
  const nn = highs.length;
  let sumXYH = 0, sumX2 = 0, sumYH = 0, sumYL = 0, sumXYL = 0;
  for (let i = 0; i < nn; i++) {
    sumXYH += i * highs[i]; sumX2 += i * i; sumYH += highs[i];
    sumXYL += i * lows[i]; sumYL += lows[i];
  }
  const denom = nn * sumX2 - (nn * (nn - 1) / 2) ** 2;
  if (denom === 0) return null;
  const slopeH = (nn * sumXYH - (nn * (nn - 1) / 2) * sumYH) / denom;
  const slopeL = (nn * sumXYL - (nn * (nn - 1) / 2) * sumYL) / denom;
  if (slopeH < 0 && slopeL < 0 && Math.abs(slopeL) > Math.abs(slopeH) * 1.1) {
    const convergence = (Math.abs(slopeL) - Math.abs(slopeH)) / Math.abs(slopeL);
    if (convergence > 0.05)
      return { name: 'Нисходящий клин', direction: 'bullish', reliability: 0.68, avgMoveATR: 1.8, strength: Math.min(convergence / 0.3, 1), startIndex: n - 20, endIndex: n - 1, zoneHigh: Math.max(...highs), zoneLow: Math.min(...lows) };
  }
  return null;
}

function scanPatterns(candles: Candle[]): DetectedPattern[] {
  if (candles.length < 20) return [];
  const n = candles.length;
  const patterns: DetectedPattern[] = [];
  const add = (p: DetectedPattern | null) => { if (p) patterns.push(p); };

  // Single candle
  add(detectHammer(candles, n - 1));
  add(detectShootingStar(candles, n - 1));
  add(detectDoji(candles, n - 1));
  add(detectMarubozu(candles, n - 1));
  // Two candle
  add(detectBullishEngulfing(candles, n - 1));
  add(detectBearishEngulfing(candles, n - 1));
  add(detectPiercingLine(candles, n - 1));
  add(detectDarkCloudCover(candles, n - 1));
  add(detectTweezerBottom(candles, n - 1));
  add(detectTweezerTop(candles, n - 1));
  // Three candle
  add(detectMorningStar(candles, n - 1));
  add(detectEveningStar(candles, n - 1));
  add(detectThreeWhiteSoldiers(candles, n - 1));
  add(detectThreeBlackCrows(candles, n - 1));
  // Structural
  add(detectDoubleBottom(candles));
  add(detectDoubleTop(candles));
  add(detectBullFlag(candles));
  add(detectBearFlag(candles));
  add(detectAscendingWedge(candles));
  add(detectDescendingWedge(candles));

  return patterns;
}

// ── Pattern Pro v2 Decision Logic (mirrors fixed makePatternProDecision) ──
function makePatternDecision(candles: Candle[], atr: number, ema20: number, rsi: number): {
  direction: 'long' | 'short' | 'none'; score: number;
  stopLoss: number; takeProfit: number; leverage: number;
  patternName?: string;
} {
  const n = candles.length;
  if (n < 50) return { direction: 'none', score: 0, stopLoss: 0, takeProfit: 0, leverage: 1 };

  const price = candles[n - 1].close;
  const patterns = scanPatterns(candles);
  if (patterns.length === 0) return { direction: 'none', score: 0, stopLoss: 0, takeProfit: 0, leverage: 1 };

  // EMA20 soft trend
  const emaDist = ema20 > 0 ? (price - ema20) / ema20 : 0;
  const trendUp = emaDist > 0.005;
  const trendDown = emaDist < -0.005;
  const atEma = !trendUp && !trendDown;

  // Volume confirmation
  const lastCandle = candles[n - 1];
  const avgVol20 = candles.slice(-20).reduce((s, c) => s + c.volume, 0) / 20;
  const volRatio = avgVol20 > 0 ? lastCandle.volume / avgVol20 : 1;
  const volConfirmed = volRatio > 0.7;

  // Soft trend filter
  const trendFiltered = patterns.filter(p => {
    if (p.direction === 'neutral') return false;
    const isStruct = STRUCTURAL_NAMES.has(p.name);
    if (p.direction === 'bullish') {
      return isStruct ? emaDist >= -0.01 : (trendUp || atEma);
    }
    if (p.direction === 'bearish') {
      return isStruct ? emaDist <= 0.01 : (trendDown || atEma);
    }
    return false;
  });

  if (trendFiltered.length === 0) return { direction: 'none', score: 0, stopLoss: 0, takeProfit: 0, leverage: 1 };

  // Require TIER-1 pattern
  const tier1 = trendFiltered.filter(p => TIER1_NAMES.has(p.name));
  const tier2 = trendFiltered.filter(p => TIER2_NAMES.has(p.name));
  if (tier1.length === 0) return { direction: 'none', score: 0, stopLoss: 0, takeProfit: 0, leverage: 1 };

  // Require strength > 0.25
  const strongT1 = tier1.filter(p => p.strength > 0.25);
  if (strongT1.length === 0) return { direction: 'none', score: 0, stopLoss: 0, takeProfit: 0, leverage: 1 };

  // Score
  let bullScore = 0, bearScore = 0, bestBullMove = 0, bestBearMove = 0;
  let bestBullName = '', bestBearName = '';

  for (const p of trendFiltered) {
    if (p.direction === 'neutral') continue;
    const tierMult = TIER1_NAMES.has(p.name) ? 1.5 : TIER2_NAMES.has(p.name) ? 0.6 : 0.3;
    const w = p.reliability * p.strength * (1 + p.avgMoveATR / 2) * tierMult;
    if (p.direction === 'bullish') {
      bullScore += w; bestBullMove = Math.max(bestBullMove, p.avgMoveATR);
      if (!bestBullName || (TIER1_NAMES.has(p.name) && !TIER1_NAMES.has(bestBullName))) bestBullName = p.name;
    } else {
      bearScore += w; bestBearMove = Math.max(bestBearMove, p.avgMoveATR);
      if (!bestBearName || (TIER1_NAMES.has(p.name) && !TIER1_NAMES.has(bestBearName))) bestBearName = p.name;
    }
  }

  // Volume bonus
  if (volConfirmed) { if (bullScore > 0) bullScore *= 1.15; if (bearScore > 0) bearScore *= 1.15; }

  // RSI filter
  if (bullScore > 0 && rsi > 72 && !strongT1.some(p => p.direction === 'bullish' && p.reliability > 0.73))
    return { direction: 'none', score: bullScore, stopLoss: 0, takeProfit: 0, leverage: 1 };
  if (bearScore > 0 && rsi < 28 && !strongT1.some(p => p.direction === 'bearish' && p.reliability > 0.73))
    return { direction: 'none', score: bearScore, stopLoss: 0, takeProfit: 0, leverage: 1 };

  // Confluence bonus
  const t1BC = strongT1.filter(p => p.direction === 'bullish').length;
  const t1BC2 = strongT1.filter(p => p.direction === 'bearish').length;
  const t2BC = tier2.filter(p => p.direction === 'bullish').length;
  const t2BC2 = tier2.filter(p => p.direction === 'bearish').length;
  if (t1BC >= 2) bullScore *= 1.3;
  if (t1BC2 >= 2) bearScore *= 1.3;
  if (t1BC >= 1 && t2BC >= 1) bullScore *= 1.15;
  if (t1BC2 >= 1 && t2BC2 >= 1) bearScore *= 1.15;

  let direction: 'long' | 'short' | 'none' = 'none';
  let score = 0, expectedMoveATR = 0, patternName = '';

  if (bullScore >= 0.50 && bullScore >= bearScore) {
    direction = 'long'; score = bullScore; expectedMoveATR = bestBullMove; patternName = bestBullName;
  } else if (bearScore >= 0.50 && bearScore > bullScore) {
    direction = 'short'; score = bearScore; expectedMoveATR = bestBearMove; patternName = bestBearName;
  }

  if (direction === 'none') return { direction: 'none', score: Math.max(bullScore, bearScore), stopLoss: 0, takeProfit: 0, leverage: 1 };

  // SL: 2.0×ATR
  const slDist = 2.0 * atr;
  const stopLoss = direction === 'long' ? price - slDist : price + slDist;

  // TP: 2.0-3.0×SL
  const tpMult = Math.max(2.0, Math.min(expectedMoveATR * 1.5, 3.0));
  const takeProfit = direction === 'long' ? price + slDist * tpMult : price - slDist * tpMult;

  const leverage = Math.min(3, Math.max(1, Math.round(score * 1.5)));

  return { direction, score, stopLoss, takeProfit, leverage, patternName };
}

// ── Config ──
const CFG = {
  maxOpenTrades: 4,
  maxDailyTrades: 6,
  cooldownCandles: 4,
  timeExitHours: 8,
  scoreThreshold: 0.50,
  tradeSizePct: 0.04,
};

// ── Simulation ──
interface AccountResult {
  id: number; startBalance: number; endBalance: number;
  pnl: number; pnlPct: number; totalTrades: number;
  wins: number; losses: number; winRate: number;
  maxDrawdown: number; maxDrawdownPct: number;
  avgWin: number; avgLoss: number; profitFactor: number;
  slExits: number; tpExits: number; tp1Exits: number; tp2Exits: number;
  timeExits: number; trailExits: number; beExits: number;
  avgHoldHours: number;
  trades: SimTrade[];
}

function simulate(
  accountId: number, startBalance: number,
  candleMap: Map<string, { candles: Candle[]; atr: number[]; ema20: number[]; rsi: number[]; timeIndex: Map<number, number> }>,
  symbols: string[], globalTimes: number[], seed: number,
): AccountResult {
  const trades: SimTrade[] = [];
  let balance = startBalance, peak = startBalance;
  let maxDD = 0, maxDDPct = 0;
  let wins = 0, losses = 0, winSum = 0, lossSum = 0;
  let slExits = 0, tpExits = 0, tp1Exits = 0, tp2Exits = 0, timeExits = 0, trailExits = 0;
  let totalHoldMinutes = 0;

  const cooldowns = new Map<string, number>();
  let dailyTrades = 0, lastDay = -1;
  const fifteenMin = 900;

  let rng = seed;
  const rand = () => { rng = (rng * 1664525 + 1013904223) & 0xFFFFFFFF; return (rng >>> 0) / 0xFFFFFFFF; };

  const warmupIdx = 50;

  // Helper: calculate PnL for a portion
  const calcPnl = (amt: number, entryPrice: number, exitPrice: number, isLong: boolean, lev: number) => {
    const priceChange = isLong
      ? (exitPrice - entryPrice) / entryPrice
      : (entryPrice - exitPrice) / entryPrice;
    const fees = amt * 0.001 + (amt / lev) * 0.001;
    return amt * priceChange * lev - fees;
  };

  for (const t of globalTimes) {
    const currentDay = Math.floor(t / 86400);
    if (currentDay !== lastDay) { dailyTrades = 0; lastDay = currentDay; }

    // ── Step 1: Monitor open trades ──
    for (const trade of [...trades]) {
      if (trade.closeTime) continue; // already fully closed
      const data = candleMap.get(trade.symbol);
      if (!data) continue;
      const ci = data.timeIndex.get(t);
      if (ci === undefined || ci < 1) continue;
      const c = data.candles[ci];
      const isLong = trade.direction === 'long';
      const initialSlDist = Math.abs(trade.entryPrice - trade.stopLoss);
      if (initialSlDist <= 0) continue;

      const favorableMove = isLong ? (c.close - trade.entryPrice) : (trade.entryPrice - c.close);

      // ── TRAILING STOP (update before checks) ──
      if (trade.trailingLevel >= 1 && initialSlDist > 0) {
        let newSL: number | null = null;
        if (favorableMove >= initialSlDist * 3 && trade.trailingLevel < 3) {
          trade.trailingLevel = 3;
          newSL = isLong ? trade.entryPrice + initialSlDist * 2 : trade.entryPrice - initialSlDist * 2;
        } else if (favorableMove >= initialSlDist * 2 && trade.trailingLevel < 2) {
          trade.trailingLevel = 2;
          newSL = isLong ? trade.entryPrice + initialSlDist : trade.entryPrice - initialSlDist;
        }
        if (newSL !== null) {
          if (isLong) trade.stopLoss = Math.max(trade.stopLoss, newSL);
          else trade.stopLoss = Math.min(trade.stopLoss, newSL);
        }
      }

      // ── PARTIAL TP1 (close 50%, move SL to BE) ──
      if (trade.partialState === 'full') {
        const tp1Price = isLong ? trade.entryPrice + initialSlDist : trade.entryPrice - initialSlDist;
        const hitTP1 = isLong ? (c.high >= tp1Price) : (c.low <= tp1Price);
        if (hitTP1) {
          const closeAmt = trade.remainingAmount * 0.5;
          const pnl = calcPnl(closeAmt, trade.entryPrice, tp1Price, isLong, trade.leverage);
          trade.remainingAmount -= closeAmt;
          trade.realizedPnl += pnl;
          trade.partialState = 'tp1_hit';
          trade.stopLoss = isLong ? trade.entryPrice * 1.001 : trade.entryPrice * 0.999;
          trade.trailingLevel = Math.max(trade.trailingLevel, 1);
          balance += closeAmt + pnl; // return margin + profit
          if (balance > peak) peak = balance;
          const dd = peak - balance;
          if (dd > maxDD) maxDD = dd;
          const ddPct = peak > 0 ? (dd / peak) * 100 : 0;
          if (ddPct > maxDDPct) maxDDPct = ddPct;
          tp1Exits++;
        }
      }

      // ── PARTIAL TP2 (close 50% of remaining = 25% of original) ──
      if (trade.partialState === 'tp1_hit') {
        const tp2Price = isLong ? trade.entryPrice + initialSlDist * 1.5 : trade.entryPrice - initialSlDist * 1.5;
        const hitTP2 = isLong ? (c.high >= tp2Price) : (c.low <= tp2Price);
        if (hitTP2) {
          const closeAmt = trade.remainingAmount * 0.5;
          const pnl = calcPnl(closeAmt, trade.entryPrice, tp2Price, isLong, trade.leverage);
          trade.remainingAmount -= closeAmt;
          trade.realizedPnl += pnl;
          trade.partialState = 'tp2_hit';
          balance += closeAmt + pnl;
          if (balance > peak) peak = balance;
          const dd = peak - balance;
          if (dd > maxDD) maxDD = dd;
          const ddPct = peak > 0 ? (dd / peak) * 100 : 0;
          if (ddPct > maxDDPct) maxDDPct = ddPct;
          tp2Exits++;
        }
      }

      // ── MAIN SL/TP CHECK (on remaining amount) ──
      let shouldClose = false, reason = '', exitPrice = c.close;

      if (isLong && trade.stopLoss && c.low <= trade.stopLoss) {
        shouldClose = true; reason = 'SL'; exitPrice = trade.stopLoss;
      } else if (!isLong && trade.stopLoss && c.high >= trade.stopLoss) {
        shouldClose = true; reason = 'SL'; exitPrice = trade.stopLoss;
      }
      if (!shouldClose && isLong && trade.takeProfit && c.high >= trade.takeProfit) {
        shouldClose = true; reason = 'TP'; exitPrice = trade.takeProfit;
      } else if (!shouldClose && !isLong && trade.takeProfit && c.low <= trade.takeProfit) {
        shouldClose = true; reason = 'TP'; exitPrice = trade.takeProfit;
      }

      // Time exit: 8h for losing remaining
      if (!shouldClose && favorableMove < 0) {
        const holdMinutes = (t - trade.openTime) / 60;
        if (holdMinutes > CFG.timeExitHours * 60) {
          shouldClose = true; reason = `Тайм-${Math.round(holdMinutes / 60)}ч`; exitPrice = c.close;
        }
      }

      if (shouldClose) {
        trade.closeTime = t;
        trade.closePrice = exitPrice;
        const pnl = calcPnl(trade.remainingAmount, trade.entryPrice, exitPrice, isLong, trade.leverage);
        trade.realizedPnl += pnl;
        trade.pnl = trade.realizedPnl;
        trade.reason = reason;
        balance += trade.remainingAmount + pnl; // return margin + P/L
        totalHoldMinutes += (t - trade.openTime) / 60;

        // Count win/loss on TOTAL trade PnL (including partial closes)
        if (trade.pnl >= 0) { wins++; winSum += trade.pnl; } else { losses++; lossSum += Math.abs(trade.pnl); }
        if (reason === 'SL') slExits++;
        else if (reason === 'TP') tpExits++;
        else if (reason.startsWith('Тайм')) timeExits++;
        if (trade.trailingLevel >= 1) trailExits++;

        // Cooldown
        if (reason === 'SL' || reason.startsWith('Тайм')) {
          cooldowns.set(trade.symbol, t + CFG.cooldownCandles * fifteenMin);
        }

        if (balance > peak) peak = balance;
        const dd = peak - balance;
        if (dd > maxDD) maxDD = dd;
        const ddPct = peak > 0 ? (dd / peak) * 100 : 0;
        if (ddPct > maxDDPct) maxDDPct = ddPct;
      }
    }

    // ── Step 2: Open new trade ──
    const openTrades = trades.filter(tr => !tr.closeTime);
    if (openTrades.length >= CFG.maxOpenTrades) continue;
    if (dailyTrades >= CFG.maxDailyTrades) continue;

    const lockedInOpen = openTrades.reduce((s, tr) => s + tr.remainingAmount, 0);
    const freeBalance = Math.max(0, balance - lockedInOpen);
    if (freeBalance < 1) continue;

    const shuffled = [...symbols].sort(() => rand() - 0.5);
    const toScan = shuffled.slice(0, 30);
    const openSymbols = new Set(openTrades.map(tr => tr.symbol));

    let bestSymbol = '', bestDir: 'long' | 'short' | null = null;
    let bestScore = 0, bestSL = 0, bestTP = 0, bestLev = 1, bestPattern = '';

    for (const sym of toScan) {
      if (openSymbols.has(sym)) continue;
      const cd = cooldowns.get(sym);
      if (cd && t < cd) continue;

      const data = candleMap.get(sym);
      if (!data) continue;
      const ci = data.timeIndex.get(t);
      if (ci === undefined || ci < warmupIdx) continue;

      const sliceCandles = data.candles.slice(0, ci + 1);
      const atr = data.atr[ci];
      const ema20Val = data.ema20[ci];
      const rsiVal = data.rsi[ci];

      if (atr <= 0 || isNaN(ema20Val) || isNaN(rsiVal)) continue;

      const decision = makePatternDecision(sliceCandles, atr, ema20Val, rsiVal);
      if (decision.direction === 'none') continue;

      const absScore = Math.abs(decision.score);
      if (absScore > bestScore) {
        bestScore = absScore;
        bestSymbol = sym;
        bestDir = decision.direction;
        bestSL = decision.stopLoss;
        bestTP = decision.takeProfit;
        bestLev = decision.leverage;
        bestPattern = decision.patternName || '';
      }
    }

    if (!bestDir || !bestSymbol) continue;

    const amount = freeBalance < 200
      ? Math.max(1.5, Math.min(freeBalance * 0.08, 8))
      : freeBalance < 1000
        ? Math.max(5, Math.min(freeBalance * 0.05, 50))
        : Math.max(20, Math.min(freeBalance * 0.04, 150));
    const cappedAmount = Math.min(amount, freeBalance * 0.5);
    if (cappedAmount < 1) continue;

    const data = candleMap.get(bestSymbol)!;
    const ci = data.timeIndex.get(t)!;
    const entryPrice = data.candles[ci].close;

    trades.push({
      id: `t${trades.length}`, symbol: bestSymbol, direction: bestDir,
      entryPrice, amount: cappedAmount, leverage: bestLev,
      stopLoss: bestSL, takeProfit: bestTP,
      openTime: t, patternName: bestPattern,
      partialState: 'full', remainingAmount: cappedAmount, realizedPnl: 0,
      trailingLevel: 0,
    });
    balance -= cappedAmount;
    dailyTrades++;
  }

  // Close remaining open trades at last price
  for (const trade of trades) {
    if (trade.closeTime) continue;
    const data = candleMap.get(trade.symbol);
    if (!data) continue;
    const lastPrice = data.candles[data.candles.length - 1].close;
    const isLong = trade.direction === 'long';
    const pnl = calcPnl(trade.remainingAmount, trade.entryPrice, lastPrice, isLong, trade.leverage);
    trade.realizedPnl += pnl;
    trade.pnl = trade.realizedPnl;
    trade.closeTime = globalTimes[globalTimes.length - 1];
    trade.closePrice = lastPrice;
    trade.reason = 'конец';
    balance += trade.remainingAmount + pnl;
    totalHoldMinutes += (trade.closeTime - trade.openTime) / 60;
    if (trade.pnl >= 0) { wins++; winSum += trade.pnl; } else { losses++; lossSum += Math.abs(trade.pnl); }
  }

  const closedTrades = trades.filter(t => t.closeTime);
  const totalPnl = balance - startBalance;
  return {
    id: accountId, startBalance,
    endBalance: Math.round(balance * 100) / 100,
    pnl: Math.round(totalPnl * 100) / 100,
    pnlPct: Math.round((totalPnl / startBalance) * 10000) / 100,
    totalTrades: trades.length, wins, losses,
    winRate: trades.length > 0 ? Math.round((wins / trades.length) * 1000) / 10 : 0,
    maxDrawdown: Math.round(maxDD * 100) / 100,
    maxDrawdownPct: Math.round(maxDDPct * 10) / 10,
    avgWin: wins > 0 ? Math.round((winSum / wins) * 100) / 100 : 0,
    avgLoss: losses > 0 ? Math.round((lossSum / losses) * 100) / 100 : 0,
    profitFactor: lossSum > 0 ? Math.round((winSum / lossSum) * 100) / 100 : wins > 0 ? 99.99 : 0,
    slExits, tpExits, tp1Exits, tp2Exits, timeExits, trailExits, beExits: 0,
    avgHoldHours: closedTrades.length > 0 ? Math.round(totalHoldMinutes / closedTrades.length / 60 * 10) / 10 : 0,
    trades,
  };
}

// ── Main ──
async function main() {
  const start = Date.now();
  console.log('━'.repeat(70));
  console.log('  БЭКТЕСТ: 50 аккаунтов × 2 недели — Pattern Pro v2 (FIXED)');
  console.log('  15m свечи, SL 1.5×ATR, TP 2.0-3.5R, partial TP, trailing');
  console.log('  Структурные паттерны = основной сигнал, односвечные = конфлюэнс');
  console.log('━'.repeat(70));
  console.log('');

  console.log('Загрузка топ-50 монет...');
  const res = await fetch(`${BINANCE}/ticker/24hr`);
  const allTickers = await res.json() as any[];
  const usdtPairs = allTickers
    .filter((t: any) => t.symbol.endsWith('USDT') && !t.symbol.includes('UP') && !t.symbol.includes('DOWN') && !t.symbol.includes('BULL') && !t.symbol.includes('BEAR'))
    .sort((a: any, b: any) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume));
  const symbols = usdtPairs.slice(0, 50).map((t: any) => t.symbol);
  console.log(`  ${symbols.length} монет`);

  // 2 weeks of 15m candles = 2*7*24*4 = 1344 candles
  const CANDLE_LIMIT = 1400;
  console.log(`Загрузка 15m свечей (${CANDLE_LIMIT} шт/монету ≈ 2 недели)...`);
  const candleMap = new Map<string, { candles: Candle[]; atr: number[]; ema20: number[]; rsi: number[]; timeIndex: Map<number, number> }>();
  let loaded = 0;

  for (let i = 0; i < symbols.length; i += 10) {
    const batch = symbols.slice(i, i + 10);
    await Promise.all(batch.map(async (sym) => {
      try {
        const r = await fetch(`${BINANCE}/klines?symbol=${sym}&interval=15m&limit=${CANDLE_LIMIT}`);
        const raw = await r.json() as any[];
        if (!Array.isArray(raw) || raw.length < 100) return;
        const candles: Candle[] = raw.map(k => ({
          time: Math.floor(Number(k[0]) / 1000),
          open: parseFloat(k[1]), high: parseFloat(k[2]), low: parseFloat(k[3]),
          close: parseFloat(k[4]), volume: parseFloat(k[5]),
        }));
        const closes = candles.map(c => c.close);
        const atr = calcATR(candles, 14);
        const ema20 = calcEMA(closes, 20);
        const rsi = calcRSI(closes, 14);
        const timeIndex = new Map<number, number>();
        for (let j = 0; j < candles.length; j++) timeIndex.set(candles[j].time, j);
        candleMap.set(sym, { candles, atr, ema20, rsi, timeIndex });
        loaded++;
      } catch { /* skip */ }
    }));
    process.stdout.write(`\r  Загружено ${loaded}/${symbols.length} монет...`);
  }
  console.log(`\r  Загружено ${candleMap.size} монет со свечами и индикаторами      `);

  // Build global time grid
  const allTimes = new Set<number>();
  for (const data of candleMap.values()) {
    for (const c of data.candles) allTimes.add(c.time);
  }
  const globalTimes = [...allTimes].sort((a, b) => a - b);
  const tradingTimes = globalTimes.filter(t => t >= globalTimes[50]);

  const startDate = new Date(tradingTimes[0] * 1000);
  const endDate = new Date(tradingTimes[tradingTimes.length - 1] * 1000);
  const days = Math.round((endDate.getTime() - startDate.getTime()) / 86400000);
  console.log(`  Период: ${startDate.toLocaleDateString('ru')} — ${endDate.toLocaleDateString('ru')} (${days} дней, ${tradingTimes.length} свечей 15m)`);
  console.log('');

  console.log('Запуск 50 аккаунтов...');
  const results: AccountResult[] = [];
  for (let i = 0; i < 50; i++) {
    const result = simulate(i + 1, 1000, candleMap, symbols, tradingTimes, 42 + i * 7919);
    results.push(result);
    const emoji = result.pnl >= 0 ? '✅' : '❌';
    const wr = `${result.winRate}%`.padStart(5);
    const pnlStr = `${result.pnl >= 0 ? '+' : ''}$${result.pnl.toFixed(2)}`.padStart(10);
    process.stdout.write(`\r  Аккаунт ${String(i + 1).padStart(2)}/50: ${String(result.totalTrades).padStart(3)} сделок | WR ${wr} | PnL ${pnlStr} | DD ${result.maxDrawdownPct}% ${emoji}      `);
  }
  console.log('');
  console.log('');

  // ── AGGREGATE STATISTICS ──
  console.log('━'.repeat(70));
  console.log('  СВОДНАЯ СТАТИСТИКА — Pattern Pro v2');
  console.log('━'.repeat(70));

  const profitable = results.filter(r => r.pnl > 0).length;
  const totalTrades = results.reduce((s, r) => s + r.totalTrades, 0);
  const totalWins = results.reduce((s, r) => s + r.wins, 0);
  const totalLosses = results.reduce((s, r) => s + r.losses, 0);
  const avgPnl = results.reduce((s, r) => s + r.pnl, 0) / results.length;
  const avgPnlPct = results.reduce((s, r) => s + r.pnlPct, 0) / results.length;
  const avgWR = results.reduce((s, r) => s + r.winRate, 0) / results.length;
  const avgDD = results.reduce((s, r) => s + r.maxDrawdownPct, 0) / results.length;
  const avgPF = results.reduce((s, r) => s + r.profitFactor, 0) / results.length;
  const bestPnl = Math.max(...results.map(r => r.pnl));
  const worstPnl = Math.min(...results.map(r => r.pnl));
  const medianPnl = [...results].sort((a, b) => a.pnl - b.pnl)[25]?.pnl ?? 0;
  const globalWR = totalTrades > 0 ? ((totalWins / totalTrades) * 100).toFixed(1) : '0';
  const totalTP1 = results.reduce((s, r) => s + r.tp1Exits, 0);
  const totalTP2 = results.reduce((s, r) => s + r.tp2Exits, 0);
  const totalSL = results.reduce((s, r) => s + r.slExits, 0);
  const totalTP = results.reduce((s, r) => s + r.tpExits, 0);
  const totalTE = results.reduce((s, r) => s + r.timeExits, 0);
  const totalBE = results.reduce((s, r) => s + r.beExits, 0);
  const totalTrail = results.reduce((s, r) => s + r.trailExits, 0);
  const avgHold = results.reduce((s, r) => s + r.avgHoldHours, 0) / results.length;

  console.log(`
  Прибыльных:          ${profitable}/50 (${profitable * 2}%)
  Средний PnL:         ${avgPnl >= 0 ? '+' : ''}$${avgPnl.toFixed(2)} (${avgPnlPct}%)`);
  console.log(`  Медиана PnL:        ${medianPnl >= 0 ? '+' : ''}$${medianPnl.toFixed(2)}`);
  console.log(`  Лучший:             +$${bestPnl.toFixed(2)}
  Худший:             $${worstPnl.toFixed(2)}`);
  console.log(`
  Всего сделок:       ${totalTrades} (${totalWins}W / ${totalLosses}L)
  Глобальный WR:      ${globalWR}%
  Средний WR:         ${avgWR.toFixed(1)}%`);
  console.log(`
  Средний PF:         ${avgPF.toFixed(2)}
  Средняя DD:         ${avgDD.toFixed(1)}%
  Среднее сделок/акк: ${(totalTrades / 50).toFixed(1)}
  Среднее удержание:  ${avgHold.toFixed(1)}ч`);
  console.log(`
  ── Выходы по причинам ──
  TP (основной):       ${totalTP}
  TP1 (1R, 50%):      ${totalTP1}
  TP2 (1.5R, 25%):    ${totalTP2}
  SL (стоп-лосс):      ${totalSL}
  BE активации:       ${totalBE}
  Trailing:           ${totalTrail}
  Тайм-эксит:         ${totalTE}
  Конец данных:       ${results.reduce((s, r) => s + r.trades.filter(t => t.reason === 'конец').length, 0)}`);

  // Pattern breakdown
  console.log('\n  ── Детализация по паттернам ──');
  const allTrades = results.flatMap(r => r.trades).filter(t => t.closeTime);
  const byPattern = new Map<string, { count: number; pnl: number; wins: number }>();
  for (const t of allTrades) {
    const name = t.patternName || 'unknown';
    const prev = byPattern.get(name) || { count: 0, pnl: 0, wins: 0 };
    prev.count++;
    prev.pnl += t.pnl ?? 0;
    if ((t.pnl ?? 0) >= 0) prev.wins++;
    byPattern.set(name, prev);
  }
  const patternSorted = [...byPattern.entries()].sort((a, b) => b[1].count - a[1].count);
  for (const [name, data] of patternSorted) {
    const avg = data.count > 0 ? data.pnl / data.count : 0;
    const wr = data.count > 0 ? ((data.wins / data.count) * 100).toFixed(0) : '0';
    console.log(`    ${name.padEnd(22)}: ${String(data.count).padStart(4)} сделок | WR ${wr.padStart(3)}% | среднее ${avg >= 0 ? '+' : ''}$${avg.toFixed(2)}`);
  }

  // Distribution
  console.log('\n  Распределение PnL по аккаунтам:');
  const sorted = [...results].sort((a, b) => a.pnl - b.pnl);
  const buckets = [-100, -50, -25, -10, -5, 0, 5, 10, 25, 50, 100, 200, 500];
  for (let i = 0; i < buckets.length - 1; i++) {
    const count = sorted.filter(r => r.pnl >= buckets[i] && r.pnl < buckets[i + 1]).length;
    if (count > 0) {
      const bar = '█'.repeat(Math.min(count, 40));
      console.log(`    $${String(buckets[i]).padStart(5)} to $${String(buckets[i + 1]).padStart(5)}: ${bar} (${count})`);
    }
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\n  Время выполнения: ${elapsed}с`);
  console.log('');
}

main().catch(console.error);
