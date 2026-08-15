// ============================================================
// Бэктест: 50 аккаунтов × 2 месяца — ТЕКУЩИЙ PRODUCTION (CORE+TRAIL)
// Зеркальное повторение логики из trading-engine.ts + client-trader.ts
// Ничего не меняется — чисто собираем данные
// ============================================================

const BINANCE = 'https://api.binance.com/api/v3';

interface Candle {
  time: number;
  open: number; high: number; low: number; close: number; volume: number;
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
  // Trailing state
  trailingLevel?: number; // 0=initial, 1=breakeven, 2=lock1R, 3=lock2R
  peakFavorable?: number; // max favorable excursion in ATR units
}

// ── Indicator Cache (precompute once per symbol) ──
interface Indicators {
  ema7: number[];
  ema25: number[];
  ema50: number[];
  ema99: number[];
  ema200: number[];
  ema12: number[];
  ema26: number[];
  atr14: number[];
  rsi14: number[];
  stochRSI: number[];
  adx: number[];
  plusDI: number[];
  minusDI: number[];
  macdLine: number[];
  macdSignal: number[];
  macdHist: number[];
  bbUpper: number[];
  bbMiddle: number[];
  bbLower: number[];
  obv: number[];
  obvTrend: number[];
  vwap: number[];
  volFlowDir: number[];
  volFlowStr: number[];
}

// ── Math helpers ──
function calcEMA(data: number[], period: number): number[] {
  const result: number[] = [];
  if (data.length < period) return result;
  const k = 2 / (period + 1);
  let val = data.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = 0; i < period - 1; i++) result.push(NaN);
  result[period - 1] = val;
  for (let i = period; i < data.length; i++) {
    val = data[i] * k + val * (1 - k);
    result.push(val);
  }
  return result;
}

function calcATR(candles: Candle[], period = 14): number[] {
  const result: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    if (i === 0) { result.push(candles[0].high - candles[0].low); continue; }
    const tr = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close),
    );
    if (i < period) {
      const avg = result.slice(0, i).reduce((s, v) => s + (isNaN(v) ? 0 : v), 0) / (i + 1);
      result.push(avg);
    } else {
      result.push((result[i - 1] * (period - 1) + tr) / period);
    }
  }
  return result;
}

function calcRSI(closes: number[], period = 14): number[] {
  const rsi: number[] = new Array(closes.length).fill(50);
  if (closes.length <= period) return rsi;
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) avgGain += d; else avgLoss -= d;
  }
  avgGain /= period; avgLoss /= period;
  rsi[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (d > 0 ? d : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (d < 0 ? -d : 0)) / period;
    rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return rsi;
}

function calcMACD(closes: number[]): { line: number[]; signal: number[]; hist: number[] } {
  const ema12 = calcEMA(closes, 12);
  const ema26 = calcEMA(closes, 26);
  const line: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    line.push(isNaN(ema12[i]) || isNaN(ema26[i]) ? 0 : ema12[i] - ema26[i]);
  }
  const signal = calcEMA(line, 9);
  const hist: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    hist.push(isNaN(signal[i]) ? 0 : line[i] - signal[i]);
  }
  return { line, signal, hist };
}

function calcBollinger(closes: number[], period = 20, mult = 2.0): { upper: number[]; middle: number[]; lower: number[] } {
  const middle = calcEMA(closes, period);
  const upper: number[] = [];
  const lower: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period || isNaN(middle[i])) {
      upper.push(NaN); lower.push(NaN); continue;
    }
    const slice = closes.slice(i - period + 1, i + 1);
    const std = Math.sqrt(slice.reduce((s, v) => s + (v - middle[i]) ** 2, 0) / period);
    upper.push(middle[i] + mult * std);
    lower.push(middle[i] - mult * std);
  }
  return { upper, middle, lower };
}

function calcStochRSI(closes: number[], rsiPeriod = 14, stochPeriod = 14): number[] {
  const rsi = calcRSI(closes, rsiPeriod);
  const result: number[] = new Array(closes.length).fill(0.5);
  for (let i = stochPeriod; i < closes.length; i++) {
    const slice = rsi.slice(i - stochPeriod + 1, i + 1);
    const min = Math.min(...slice);
    const max = Math.max(...slice);
    result[i] = max === min ? 0.5 : (rsi[i] - min) / (max - min);
  }
  return result;
}

function calcADXData(candles: Candle[], period = 14): { adx: number[]; plusDI: number[]; minusDI: number[] } {
  const len = candles.length;
  const plusDM: number[] = [0];
  const minusDM: number[] = [0];
  const tr: number[] = [candles[0].high - candles[0].low];

  for (let i = 1; i < len; i++) {
    const upMove = candles[i].high - candles[i - 1].high;
    const downMove = candles[i - 1].low - candles[i].low;
    plusDM.push((upMove > downMove && upMove > 0) ? upMove : 0);
    minusDM.push((downMove > upMove && downMove > 0) ? downMove : 0);
    tr.push(Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close),
    ));
  }

  // Smooth with Wilder's method
  const smooth = (arr: number[]): number[] => {
    const out: number[] = [0];
    for (let i = 1; i < len; i++) {
      if (i < period) out.push(out[i - 1] + arr[i]);
      else if (i === period) out.push(out[i - 1] / period);
      else out.push((out[i - 1] * (period - 1) + arr[i]) / period);
    }
    return out;
  };

  const smoothTR = smooth(tr);
  const smoothPlusDM = smooth(plusDM);
  const smoothMinusDM = smooth(minusDM);

  const plusDI: number[] = [];
  const minusDI: number[] = [];
  const diValues: number[] = [];

  for (let i = 0; i < len; i++) {
    const pdi = smoothTR[i] > 0 ? (smoothPlusDM[i] / smoothTR[i]) * 100 : 0;
    const mdi = smoothTR[i] > 0 ? (smoothMinusDM[i] / smoothTR[i]) * 100 : 0;
    plusDI.push(pdi);
    minusDI.push(mdi);
    const diSum = pdi + mdi;
    diValues.push(diSum > 0 ? (Math.abs(pdi - mdi) / diSum) * 100 : 0);
  }

  const adx: number[] = new Array(len).fill(0);
  if (diValues.length >= period) {
    let adxSum = 0;
    for (let i = 0; i < period; i++) adxSum += diValues[i];
    adx[period] = adxSum / period;
    for (let i = period + 1; i < len; i++) {
      adx[i] = (adx[i - 1] * (period - 1) + diValues[i]) / period;
    }
  }

  return { adx, plusDI, minusDI };
}

function calcOBVData(candles: Candle[]): { obv: number[]; trend: number[] } {
  const obv: number[] = [0];
  for (let i = 1; i < candles.length; i++) {
    const prev = obv[i - 1];
    if (candles[i].close > candles[i - 1].close) obv.push(prev + candles[i].volume);
    else if (candles[i].close < candles[i - 1].close) obv.push(prev - candles[i].volume);
    else obv.push(prev);
  }
  const trend: number[] = new Array(candles.length).fill(0);
  for (let i = 20; i < candles.length; i++) {
    const recent = obv.slice(i - 9, i + 1).reduce((s, v) => s + v, 0) / 10;
    const earlier = obv.slice(i - 19, i - 9).reduce((s, v) => s + v, 0) / 10;
    if (earlier !== 0) trend[i] = Math.max(-1, Math.min(1, (recent - earlier) / Math.abs(earlier)));
  }
  return { obv, trend };
}

function calcVWAPData(candles: Candle[], period = 20): number[] {
  const vwap: number[] = new Array(candles.length).fill(0);
  for (let i = period; i < candles.length; i++) {
    let cumVP = 0, cumV = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const tp = (candles[j].high + candles[j].low + candles[j].close) / 3;
      cumVP += tp * candles[j].volume;
      cumV += candles[j].volume;
    }
    vwap[i] = cumV > 0 ? cumVP / cumV : 0;
  }
  return vwap;
}

function calcVolFlowData(candles: Candle[], period = 5): { dir: number[]; str: number[] } {
  const dir: number[] = new Array(candles.length).fill(0);
  const str: number[] = new Array(candles.length).fill(0);
  for (let i = period; i < candles.length; i++) {
    let buyVol = 0, sellVol = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const bullish = candles[j].close > candles[j].open;
      if (bullish) buyVol += candles[j].volume; else sellVol += candles[j].volume;
    }
    const total = buyVol + sellVol;
    const imbalance = total > 0 ? (buyVol - sellVol) / total : 0;
    dir[i] = imbalance > 0.1 ? 1 : imbalance < -0.1 ? -1 : 0;
    str[i] = Math.abs(imbalance);
  }
  return { dir, str };
}

// ── Build full indicator cache for a symbol ──
function buildIndicators(candles: Candle[]): Indicators {
  const closes = candles.map(c => c.close);
  const ema7 = calcEMA(closes, 7);
  const ema25 = calcEMA(closes, 25);
  const ema50 = calcEMA(closes, 50);
  const ema99 = calcEMA(closes, 99);
  const ema200 = calcEMA(closes, 200);
  const ema12 = calcEMA(closes, 12);
  const ema26 = calcEMA(closes, 26);
  const atr14 = calcATR(candles, 14);
  const rsi14 = calcRSI(closes, 14);
  const stochRSI = calcStochRSI(closes);
  const { adx, plusDI, minusDI } = calcADXData(candles);
  const macd = calcMACD(closes);
  const bb = calcBollinger(closes);
  const obvData = calcOBVData(candles);
  const vwap = calcVWAPData(candles);
  const volFlow = calcVolFlowData(candles);

  return {
    ema7, ema25, ema50, ema99, ema200, ema12, ema26,
    atr14, rsi14, stochRSI, adx, plusDI, minusDI,
    macdLine: macd.line, macdSignal: macd.signal, macdHist: macd.hist,
    bbUpper: bb.upper, bbMiddle: bb.middle, bbLower: bb.lower,
    obv: obvData.obv, obvTrend: obvData.trend,
    vwap, volFlowDir: volFlow.dir, volFlowStr: volFlow.str,
  };
}

// ── Production signal logic (mirror of makeMomentumDecision) ──
// CORE+TRAIL params: SL=3×ATR, RR=2.5, threshold=0.50, minInd=6, lev=3
function makeDecision(ind: Indicators, candles: Candle[], idx: number): {
  direction: 'long' | 'short' | 'none';
  score: number;
  leverage: number;
  stopLoss: number;
  takeProfit: number;
  agreeCount: number;
  blockedReason?: string;
} {
  if (idx < 200) return { direction: 'none', score: 0, leverage: 1, stopLoss: 0, takeProfit: 0, agreeCount: 0 };

  const price = candles[idx].close;
  const atr = ind.atr14[idx];
  const rsi = ind.rsi14[idx];
  if (!atr || isNaN(atr)) return { direction: 'none', score: 0, leverage: 1, stopLoss: 0, takeProfit: 0, agreeCount: 0 };

  // ── 10 indicators, each votes long/short/neutral ──
  const signals: Array<{ name: string; signal: number; strength: number }> = [];

  // 1. RSI(14)
  if (rsi < 30) signals.push({ name: 'RSI', signal: 1, strength: (30 - rsi) / 30 });
  else if (rsi > 70) signals.push({ name: 'RSI', signal: -1, strength: (rsi - 70) / 30 });
  else signals.push({ name: 'RSI', signal: 0, strength: 0 });

  // 2. MACD
  if (ind.macdHist[idx] > 0 && ind.macdLine[idx] > ind.macdSignal[idx]) {
    signals.push({ name: 'MACD', signal: 1, strength: Math.min(Math.abs(ind.macdHist[idx]) / (Math.abs(ind.macdSignal[idx]) || 1), 1) });
  } else if (ind.macdHist[idx] < 0) {
    signals.push({ name: 'MACD', signal: -1, strength: Math.min(Math.abs(ind.macdHist[idx]) / (Math.abs(ind.macdSignal[idx]) || 1), 1) });
  } else {
    signals.push({ name: 'MACD', signal: 0, strength: 0 });
  }

  // 3. EMA_7 (price vs EMA7)
  if (!isNaN(ind.ema7[idx])) {
    signals.push({ name: 'EMA7', signal: price > ind.ema7[idx] ? 1 : -1, strength: 0.3 });
  } else signals.push({ name: 'EMA7', signal: 0, strength: 0 });

  // 4. EMA_25 (price vs EMA25)
  if (!isNaN(ind.ema25[idx])) {
    signals.push({ name: 'EMA25', signal: price > ind.ema25[idx] ? 1 : -1, strength: 0.3 });
  } else signals.push({ name: 'EMA25', signal: 0, strength: 0 });

  // 5. EMA_200 (price vs EMA200)
  if (!isNaN(ind.ema200[idx])) {
    signals.push({ name: 'EMA200', signal: price > ind.ema200[idx] ? 1 : -1, strength: Math.min(Math.abs(price - ind.ema200[idx]) / ind.ema200[idx] * 10, 1) });
  } else signals.push({ name: 'EMA200', signal: 0, strength: 0 });

  // 6. Bollinger
  if (!isNaN(ind.bbLower[idx]) && !isNaN(ind.bbUpper[idx])) {
    const bbPos = ind.bbUpper[idx] - ind.bbLower[idx] > 0
      ? (price - ind.bbLower[idx]) / (ind.bbUpper[idx] - ind.bbLower[idx]) : 0.5;
    if (bbPos < 0.1) signals.push({ name: 'BB', signal: 1, strength: (0.1 - bbPos) / 0.1 });
    else if (bbPos > 0.9) signals.push({ name: 'BB', signal: -1, strength: (bbPos - 0.9) / 0.1 });
    else signals.push({ name: 'BB', signal: 0, strength: 0 });
  } else signals.push({ name: 'BB', signal: 0, strength: 0 });

  // 7. Volume (last 20 candles ratio)
  {
    const volSlice = candles.slice(Math.max(0, idx - 19), idx + 1).map(c => c.volume);
    const avgVol = volSlice.reduce((s, v) => s + v, 0) / volSlice.length;
    const volRatio = avgVol > 0 ? candles[idx].volume / avgVol : 1;
    const bullish = candles[idx].close > candles[idx].open;
    if (volRatio > 1.3) {
      signals.push({ name: 'Vol', signal: bullish ? 1 : -1, strength: Math.min((volRatio - 1.3) / 2, 1) });
    } else signals.push({ name: 'Vol', signal: 0, strength: 0 });
  }

  // 8. StochRSI
  if (ind.stochRSI[idx] > 0.8) signals.push({ name: 'StRSI', signal: -1, strength: (ind.stochRSI[idx] - 0.8) / 0.2 });
  else if (ind.stochRSI[idx] < 0.2) signals.push({ name: 'StRSI', signal: 1, strength: (0.2 - ind.stochRSI[idx]) / 0.2 });
  else signals.push({ name: 'StRSI', signal: 0, strength: 0 });

  // 9. ADX as INDICATOR (CORE+TRAIL: not a filter!)
  if (ind.plusDI[idx] > ind.minusDI[idx] + 5) {
    signals.push({ name: 'ADX', signal: 1, strength: Math.min((ind.plusDI[idx] - ind.minusDI[idx]) / 50, 1) });
  } else if (ind.minusDI[idx] > ind.plusDI[idx] + 5) {
    signals.push({ name: 'ADX', signal: -1, strength: Math.min((ind.minusDI[idx] - ind.plusDI[idx]) / 50, 1) });
  } else signals.push({ name: 'ADX', signal: 0, strength: 0 });

  // 10. OBV
  {
    const priceChange = idx >= 5 ? (candles[idx].close - candles[idx - 5].close) / candles[idx - 5].close : 0;
    const t = ind.obvTrend[idx];
    if (t > 0.05 && priceChange > 0) signals.push({ name: 'OBV', signal: 1, strength: Math.min(Math.abs(t) * 5, 1) });
    else if (t < -0.05 && priceChange < 0) signals.push({ name: 'OBV', signal: -1, strength: Math.min(Math.abs(t) * 5, 1) });
    else if (t > 0.05 && priceChange < 0) signals.push({ name: 'OBV', signal: 1, strength: Math.min(Math.abs(t) * 3, 0.7) }); // divergence
    else if (t < -0.05 && priceChange > 0) signals.push({ name: 'OBV', signal: -1, strength: Math.min(Math.abs(t) * 3, 0.7) }); // divergence
    else signals.push({ name: 'OBV', signal: 0, strength: 0 });
  }

  // 11. VWAP
  if (ind.vwap[idx] > 0) {
    const vwapSignal = (price - ind.vwap[idx]) / ind.vwap[idx];
    if (vwapSignal > 0.005) signals.push({ name: 'VWAP', signal: 1, strength: Math.min(vwapSignal * 10, 1) });
    else if (vwapSignal < -0.005) signals.push({ name: 'VWAP', signal: -1, strength: Math.min(Math.abs(vwapSignal) * 10, 1) });
    else signals.push({ name: 'VWAP', signal: 0, strength: 0 });
  } else signals.push({ name: 'VWAP', signal: 0, strength: 0 });

  // 12. VolFlow
  signals.push({ name: 'VolFlow', signal: ind.volFlowDir[idx], strength: ind.volFlowStr[idx] });

  // ── Aggregate scores ──
  let longScore = 0, shortScore = 0, longCount = 0, shortCount = 0;
  for (const s of signals) {
    if (s.signal > 0) { longScore += s.strength; longCount++; }
    else if (s.signal < 0) { shortScore += s.strength; shortCount++; }
  }

  const absLong = Math.abs(longScore);
  const absShort = Math.abs(shortScore);
  const maxScore = Math.max(absLong, absShort);
  const bestCount = Math.max(longCount, shortCount);

  // ── Confluence: require ≥6 indicators to agree (CORE+TRAIL) ──
  if (bestCount < 6) {
    return { direction: 'none', score: maxScore, leverage: 1, stopLoss: 0, takeProfit: 0, agreeCount: bestCount };
  }

  // ── RSI exhaustion: don't buy overbought >78, don't sell oversold <22 ──
  if (absLong >= absShort && rsi > 78) {
    return { direction: 'none', score: maxScore, leverage: 1, stopLoss: 0, takeProfit: 0, agreeCount: bestCount, blockedReason: `RSI ${rsi.toFixed(0)}` };
  }
  if (absShort > absLong && rsi < 22) {
    return { direction: 'none', score: maxScore, leverage: 1, stopLoss: 0, takeProfit: 0, agreeCount: bestCount, blockedReason: `RSI ${rsi.toFixed(0)}` };
  }

  // ── Score threshold (CORE+TRAIL: 0.50) ──
  let direction: 'long' | 'short' | 'none' = 'none';
  let score = 0;
  if (absLong >= 0.50 && absLong >= absShort) { direction = 'long'; score = longScore; }
  else if (absShort >= 0.50 && absShort > absLong) { direction = 'short'; score = shortScore; }

  if (direction === 'none') {
    return { direction: 'none', score: maxScore, leverage: 1, stopLoss: 0, takeProfit: 0, agreeCount: bestCount };
  }

  // ── Spike guard (anti-chase) ──
  {
    const ema20 = calcEMA(candles.map(c => c.close), 20);
    const e20 = ema20[idx];
    if (!isNaN(e20) && e20 > 0) {
      const emaDist = Math.abs(price - e20) / atr;
      if (emaDist > 4.0) {
        return { direction: 'none', score: maxScore, leverage: 1, stopLoss: 0, takeProfit: 0, agreeCount: bestCount, blockedReason: `overext ${emaDist.toFixed(1)}×ATR` };
      }
      // Candle ATR ratio
      const candleRange = candles[idx].high - candles[idx].low;
      if (candleRange / atr > 3.0) {
        return { direction: 'none', score: maxScore, leverage: 1, stopLoss: 0, takeProfit: 0, agreeCount: bestCount, blockedReason: `spike candle` };
      }
      // ROC3
      if (idx >= 3) {
        const roc3 = ((price - candles[idx - 3].close) / candles[idx - 3].close) * 100;
        if (roc3 > 8) {
          return { direction: 'none', score: maxScore, leverage: 1, stopLoss: 0, takeProfit: 0, agreeCount: bestCount, blockedReason: `ROC3=${roc3.toFixed(1)}%` };
        }
      }
    }
  }

  // ── Leverage: min(3, max(1, round(score × 1.5))) (CORE+TRAIL) ──
  const leverage = Math.min(3, Math.max(1, Math.round(maxScore * 1.5)));

  // ── SL: 3×ATR, min 0.8%, max 5% (CORE+TRAIL) ──
  const stopLossPercent = Math.max(0.008, Math.min(3.0 * atr / price, 0.05));
  const takeProfitPercent = Math.min(stopLossPercent * 2.5, 0.20);

  const stopLoss = direction === 'long' ? price * (1 - stopLossPercent) : price * (1 + stopLossPercent);
  const takeProfit = direction === 'long' ? price * (1 + takeProfitPercent) : price * (1 - takeProfitPercent);

  return { direction, score, leverage, stopLoss, takeProfit, agreeCount: bestCount };
}

// ── Entry quality (mirror of assessEntryQuality in client-trader) ──
function assessEntry(ind: Indicators, candles: Candle[], idx: number, direction: 'long' | 'short'): { pass: boolean; multiplier: number } {
  const price = candles[idx].close;
  const e20 = ind.ema25[idx]; // use EMA25 as proxy for EMA20
  const atr = ind.atr14[idx];
  const rsi = ind.rsi14[idx];
  if (isNaN(e20) || !atr || atr <= 0) return { pass: true, multiplier: 1.0 };

  const emaDist = (price - e20) / atr;
  const extension = direction === 'long' ? emaDist : -emaDist;

  // Hard rejects
  if (extension > 3.0) return { pass: false, multiplier: 0 };
  if (direction === 'long' && rsi > 78) return { pass: false, multiplier: 0 };
  if (direction === 'short' && rsi < 22) return { pass: false, multiplier: 0 };

  // Consecutive candles check
  let consecutive = 0;
  for (let i = idx; i >= Math.max(0, idx - 4); i--) {
    const bull = candles[i].close > candles[i].open;
    if ((direction === 'long' && bull) || (direction === 'short' && !bull)) consecutive++;
    else break;
  }
  if (consecutive >= 4 && extension > 1.5) return { pass: false, multiplier: 0 };

  // ROC check
  if (idx >= 2) {
    const last3Range = Math.abs(candles[idx].close - candles[idx - 2].close) / atr;
    if (last3Range > 3.0) return { pass: false, multiplier: 0 };
  }

  let mult = 1.0;
  if (extension > 2.0) mult *= 0.5;
  else if (extension > 1.0) mult *= 0.75;
  if (consecutive >= 3 && extension > 1.0) mult *= 0.7;
  if (idx >= 2) {
    const last3Range = Math.abs(candles[idx].close - candles[idx - 2].close) / atr;
    if (last3Range > 2.0) mult *= 0.8;
  }
  if (extension < 1.0 && extension > -0.5) mult *= 1.15;

  return { pass: mult >= 0.3, multiplier: mult };
}

// ── Position sizing (mirror of client-trader) ──
function calcAmount(freeBalance: number): number {
  let amount: number;
  if (freeBalance < 200) amount = Math.max(1.5, Math.min(freeBalance * 0.08, 8));
  else if (freeBalance < 1000) amount = Math.max(5, Math.min(freeBalance * 0.05, 50));
  else if (freeBalance < 5000) amount = Math.max(20, Math.min(freeBalance * 0.03, 150));
  else amount = Math.max(50, Math.min(freeBalance * 0.02, 500));
  amount = Math.min(amount, freeBalance * 0.06); // tradeSizePercent
  amount = Math.min(amount, freeBalance * 0.5);
  return Math.round(amount * 100) / 100;
}

// ── Fetch from Binance ──
async function fetchCandles(symbol: string, interval = '1h', limit = 1440): Promise<Candle[]> {
  const res = await fetch(`${BINANCE}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
  if (!res.ok) return [];
  const raw = await res.json();
  return raw.map((k: any) => ({
    time: Math.floor(Number(k[0]) / 1000),
    open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5],
  }));
}

async function fetchTop50(): Promise<string[]> {
  const res = await fetch(`${BINANCE}/ticker/24hr`);
  const data = await res.json();
  return data
    .filter((t: any) => t.symbol.endsWith('USDT') && Number(t.quoteVolume) > 0)
    .sort((a: any, b: any) => Number(b.quoteVolume) - Number(a.quoteVolume))
    .slice(0, 50)
    .map((t: any) => t.symbol);
}

// ── Account result ──
interface AccountResult {
  id: number;
  startBalance: number;
  endBalance: number;
  pnl: number;
  pnlPct: number;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  maxDrawdown: number;
  maxDrawdownPct: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  beExits: number;
  trailExits: number;
  slExits: number;
  tpExits: number;
  timeExits: number;
  avgHoldHours: number;
  trades: SimTrade[];
}

// ── CORE+TRAIL Parameters (from strategies.ts + client-trader.ts) ──
const CFG = {
  slAtrMult: 3.0,
  rrRatio: 2.5,
  timeExitHours: 8,
  maxOpenTrades: 4,
  maxDailyTrades: 3,
  cooldownCandles: 4,
  scanEveryNH: 2,
  scoreThreshold: 0.50,
  minIndicators: 6,
  maxLeverage: 3,
  breakevenAtrMult: 1.0,
  trailingAtrMult: 1.5, // used for 3-level trailing
  tradeSizePercent: 0.06,
};

// ── Simulation ──
function simulate(
  accountId: number,
  startBalance: number,
  indMap: Map<string, { candles: Candle[]; ind: Indicators; timeIndex: Map<number, number> }>,
  symbols: string[],
  globalTimes: number[],
  seed: number,
): AccountResult {
  const trades: SimTrade[] = [];
  let balance = startBalance;
  let peak = startBalance;
  let maxDD = 0, maxDDPct = 0;
  let totalPnl = 0, wins = 0, losses = 0, winSum = 0, lossSum = 0;
  let beExits = 0, trailExits = 0, slExits = 0, tpExits = 0, timeExits = 0;
  let totalHoldHours = 0;

  const cooldowns = new Map<string, number>();
  let dailyTrades = 0;
  let lastDay = -1;

  // Seeded random for symbol shuffle
  let rng = seed;
  const rand = () => { rng = (rng * 1664525 + 1013904223) & 0xFFFFFFFF; return (rng >>> 0) / 0xFFFFFFFF; };

  const oneHour = 3600;
  const warmupIdx = 200; // first 200 candles for indicator warmup

  for (const t of globalTimes) {
    const currentDay = Math.floor(t / 86400);
    if (currentDay !== lastDay) { dailyTrades = 0; lastDay = currentDay; }

    // ── Step 1: Monitor all open trades ──
    for (const trade of [...trades]) {
      if (trade.closeTime) continue;
      const data = indMap.get(trade.symbol);
      if (!data) continue;
      const ci = data.timeIndex.get(t);
      if (ci === undefined || ci < 1) continue;
      const c = data.candles[ci];

      let shouldClose = false;
      let reason = '';
      let exitPrice = c.close;

      // Trailing stop update (check BEFORE TP/SL)
      if (trade.stopLoss && trade.entryPrice) {
        const isLong = trade.direction === 'long';
        const favorableMove = isLong
          ? c.close - trade.entryPrice
          : trade.entryPrice - c.close;
        const initialSlDist = Math.abs(trade.entryPrice - trade.stopLoss);

        // Track peak favorable
        if (!trade.peakFavorable || favorableMove > trade.peakFavorable) {
          trade.peakFavorable = favorableMove;
        }

        // Level 1: +1×SL → breakeven
        if (favorableMove >= initialSlDist && trade.trailingLevel === 0) {
          trade.trailingLevel = 1;
          const beSL = isLong ? trade.entryPrice * 1.001 : trade.entryPrice * 0.999;
          trade.stopLoss = Math.max(trade.stopLoss, beSL); // only move up (long) or down (short)
          // For short: only move down
          if (!isLong) trade.stopLoss = Math.min(trade.stopLoss, beSL);
          beExits++; // count BE activations
        }
        // Level 2: +2×SL → lock 1R
        else if (favorableMove >= initialSlDist * 2 && trade.trailingLevel === 1) {
          trade.trailingLevel = 2;
          const lockSL = isLong
            ? trade.entryPrice + initialSlDist
            : trade.entryPrice - initialSlDist;
          if (isLong) trade.stopLoss = Math.max(trade.stopLoss, lockSL);
          else trade.stopLoss = Math.min(trade.stopLoss, lockSL);
        }
        // Level 3: +3×SL → lock 2R
        else if (favorableMove >= initialSlDist * 3 && trade.trailingLevel === 2) {
          trade.trailingLevel = 3;
          const lockSL = isLong
            ? trade.entryPrice + initialSlDist * 2
            : trade.entryPrice - initialSlDist * 2;
          if (isLong) trade.stopLoss = Math.max(trade.stopLoss, lockSL);
          else trade.stopLoss = Math.min(trade.stopLoss, lockSL);
        }
      }

      // TP check (on high/low of current candle)
      if (trade.direction === 'long') {
        if (c.low <= trade.stopLoss) { shouldClose = true; reason = 'SL'; exitPrice = trade.stopLoss; }
        else if (c.high >= trade.takeProfit) { shouldClose = true; reason = 'TP'; exitPrice = trade.takeProfit; }
      } else {
        if (c.high >= trade.stopLoss) { shouldClose = true; reason = 'SL'; exitPrice = trade.stopLoss; }
        else if (c.low <= trade.takeProfit) { shouldClose = true; reason = 'TP'; exitPrice = trade.takeProfit; }
      }

      // Time exit: 8h, ONLY for losing trades (CORE+TRAIL)
      if (!shouldClose) {
        const holdHours = (t - trade.openTime) / oneHour;
        if (holdHours > CFG.timeExitHours) {
          const unrealized = trade.direction === 'long'
            ? (c.close - trade.entryPrice) / trade.entryPrice
            : (trade.entryPrice - c.close) / trade.entryPrice;
          if (unrealized < 0) {
            shouldClose = true;
            reason = `Тайм-${Math.round(holdHours)}ч`;
            exitPrice = c.close;
          }
        }
      }

      if (shouldClose) {
        trade.closeTime = t;
        trade.closePrice = exitPrice;
        const priceChange = trade.direction === 'long'
          ? (exitPrice - trade.entryPrice) / trade.entryPrice
          : (trade.entryPrice - exitPrice) / trade.entryPrice;
        const fees = trade.amount * 0.001 + (trade.amount / trade.leverage) * 0.001;
        trade.pnl = trade.amount * priceChange * trade.leverage - fees;
        trade.reason = reason;
        totalPnl += trade.pnl;
        balance += trade.amount + trade.pnl;
        totalHoldHours += (t - trade.openTime) / oneHour;

        if (trade.pnl >= 0) { wins++; winSum += trade.pnl; } else { losses++; lossSum += Math.abs(trade.pnl); }
        if (reason === 'SL') slExits++;
        else if (reason === 'TP') tpExits++;
        else if (reason.startsWith('Тайм')) timeExits++;
        if (trade.trailingLevel && trade.trailingLevel >= 1) trailExits++;

        // Cooldown on SL/time exit
        if (reason === 'SL' || reason.startsWith('Тайм')) {
          cooldowns.set(trade.symbol, t + CFG.cooldownCandles * oneHour);
        }

        // Track drawdown
        if (balance > peak) peak = balance;
        const dd = peak - balance;
        if (dd > maxDD) maxDD = dd;
        const ddPct = peak > 0 ? (dd / peak) * 100 : 0;
        if (ddPct > maxDDPct) maxDDPct = ddPct;
      }
    }

    // ── Step 2: Check if we can open new trade ──
    const openTrades = trades.filter(tr => !tr.closeTime);
    if (openTrades.length >= CFG.maxOpenTrades) continue;
    if (dailyTrades >= CFG.maxDailyTrades) continue;

    // Scan frequency: only scan every N hours (CORE+TRAIL)
    const utcHour = new Date(t * 1000).getUTCHours();
    if (utcHour % CFG.scanEveryNH !== 0) continue;

    const freeBalance = Math.max(0, balance - openTrades.reduce((s, tr) => s + tr.amount, 0));
    if (freeBalance < 1) continue;

    // Shuffle symbols (account-specific order)
    const shuffled = [...symbols].sort(() => rand() - 0.5);
    const toScan = shuffled.slice(0, 30); // scan top 30 random
    const openSymbols = new Set(openTrades.map(tr => tr.symbol));

    let bestSymbol = '';
    let bestScore = 0;
    let bestDir: 'long' | 'short' | null = null;
    let bestSL = 0, bestTP = 0, bestLev = 1;
    let bestAgreeCount = 0;

    for (const sym of toScan) {
      if (openSymbols.has(sym)) continue;
      const cd = cooldowns.get(sym);
      if (cd && t < cd) continue;

      const data = indMap.get(sym);
      if (!data) continue;
      const ci = data.timeIndex.get(t);
      if (ci === undefined || ci < warmupIdx) continue;

      const decision = makeDecision(data.ind, data.candles, ci);
      if (decision.direction === 'none') continue;

      // Entry quality check
      const eq = assessEntry(data.ind, data.candles, ci, decision.direction);
      if (!eq.pass) continue;

      // MTF filter (price vs EMA50)
      const e50 = data.ind.ema50[ci];
      if (!isNaN(e50)) {
        const price = data.candles[ci].close;
        const bullish = price > e50;
        if ((decision.direction === 'long' && !bullish) || (decision.direction === 'short' && bullish)) continue;
      }

      const absScore = Math.abs(decision.score) * eq.multiplier;
      if (absScore > bestScore) {
        bestScore = absScore;
        bestSymbol = sym;
        bestDir = decision.direction;
        bestSL = decision.stopLoss;
        bestTP = decision.takeProfit;
        bestLev = decision.leverage;
        bestAgreeCount = decision.agreeCount;
      }
    }

    if (!bestDir || !bestSymbol) continue;

    const amount = calcAmount(freeBalance);
    if (amount < 1) continue;

    trades.push({
      id: `t${trades.length}`,
      symbol: bestSymbol,
      direction: bestDir,
      entryPrice: bestSL > 0 ? (bestDir === 'long' ? bestSL / (1 - Math.abs(bestSL - 0) / 1) : bestSL / (1 + Math.abs(bestSL - 0) / 1)) : 0,
      amount,
      leverage: bestLev,
      stopLoss: bestSL,
      takeProfit: bestTP,
      openTime: t,
      trailingLevel: 0,
      peakFavorable: 0,
    });
    // Fix entryPrice from SL/TP
    const lastTrade = trades[trades.length - 1];
    const data = indMap.get(bestSymbol)!;
    const ci = data.timeIndex.get(t)!;
    lastTrade.entryPrice = data.candles[ci].close;
    balance -= amount;
    dailyTrades++;
  }

  // Close remaining open trades at last price
  for (const trade of trades) {
    if (trade.closeTime) continue;
    const data = indMap.get(trade.symbol);
    if (!data) continue;
    const lastPrice = data.candles[data.candles.length - 1].close;
    const priceChange = trade.direction === 'long'
      ? (lastPrice - trade.entryPrice) / trade.entryPrice
      : (trade.entryPrice - lastPrice) / trade.entryPrice;
    const fees = trade.amount * 0.001 + (trade.amount / trade.leverage) * 0.001;
    trade.pnl = trade.amount * priceChange * trade.leverage - fees;
    trade.closeTime = globalTimes[globalTimes.length - 1];
    trade.closePrice = lastPrice;
    trade.reason = 'конец';
    totalPnl += trade.pnl;
    balance += trade.amount + trade.pnl;
    totalHoldHours += (trade.closeTime - trade.openTime) / 3600;
    if (trade.pnl >= 0) { wins++; winSum += trade.pnl; } else { losses++; lossSum += Math.abs(trade.pnl); }
  }

  const endBalance = balance;
  const pnl = endBalance - startBalance;
  const closedTrades = trades.filter(t => t.closeTime);

  return {
    id: accountId,
    startBalance,
    endBalance: Math.round(endBalance * 100) / 100,
    pnl: Math.round(pnl * 100) / 100,
    pnlPct: Math.round((pnl / startBalance) * 10000) / 100,
    totalTrades: trades.length,
    wins, losses,
    winRate: trades.length > 0 ? Math.round((wins / trades.length) * 1000) / 10 : 0,
    maxDrawdown: Math.round(maxDD * 100) / 100,
    maxDrawdownPct: Math.round(maxDDPct * 10) / 10,
    avgWin: wins > 0 ? Math.round((winSum / wins) * 100) / 100 : 0,
    avgLoss: losses > 0 ? Math.round((lossSum / losses) * 100) / 100 : 0,
    profitFactor: lossSum > 0 ? Math.round((winSum / lossSum) * 100) / 100 : wins > 0 ? 99.99 : 0,
    beExits, trailExits, slExits, tpExits, timeExits,
    avgHoldHours: closedTrades.length > 0 ? Math.round(totalHoldHours / closedTrades.length * 10) / 10 : 0,
    trades,
  };
}

// ── Main ──
async function main() {
  const start = Date.now();
  console.log('━'.repeat(70));
  console.log('  БЭКТЕСТ: 50 аккаунтов × 2 месяца — PRODUCTION CORE+TRAIL');
  console.log('  SL=3×ATR, RR=2.5, TE=8h, BE+Trail, Scan=2h, ADX=indicator, S=0.50, MI=6');
  console.log('━'.repeat(70));
  console.log('');

  console.log('Загрузка топ-50 монет...');
  const symbols = await fetchTop50();
  console.log(`  ${symbols.length} монет`);

  console.log('Загрузка свечей (1H, 1440 шт/монету ≈ 2 месяца)...');
  const indMap = new Map<string, { candles: Candle[]; ind: Indicators; timeIndex: Map<number, number> }>();
  let loaded = 0;

  // Fetch in batches of 10 to avoid rate limits
  for (let i = 0; i < symbols.length; i += 10) {
    const batch = symbols.slice(i, i + 10);
    await Promise.all(batch.map(async (sym) => {
      try {
        const candles = await fetchCandles(sym, '1h', 1440);
        if (candles.length < 300) return;
        const ind = buildIndicators(candles);
        const timeIndex = new Map<number, number>();
        for (let j = 0; j < candles.length; j++) timeIndex.set(candles[j].time, j);
        indMap.set(sym, { candles, ind, timeIndex });
        loaded++;
      } catch { /* skip */ }
    }));
    process.stdout.write(`\r  Загружено ${loaded}/${symbols.length} монет...`);
  }
  console.log(`\r  Загружено ${indMap.size} монет со свечами и индикаторами      `);

  // Build global time grid
  const allTimes = new Set<number>();
  for (const data of indMap.values()) {
    for (const c of data.candles) allTimes.add(c.time);
  }
  const globalTimes = [...allTimes].sort((a, b) => a - b);
  const warmupEnd = globalTimes[200];
  const tradingTimes = globalTimes.filter(t => t >= warmupEnd);

  const startDate = new Date(tradingTimes[0] * 1000);
  const endDate = new Date(tradingTimes[tradingTimes.length - 1] * 1000);
  const days = Math.round((endDate.getTime() - startDate.getTime()) / 86400000);
  console.log(`  Период: ${startDate.toLocaleDateString('ru')} — ${endDate.toLocaleDateString('ru')} (${days} дней, ${tradingTimes.length} часов)`);
  console.log('');

  console.log('Запуск 50 аккаунтов...');
  const results: AccountResult[] = [];
  for (let i = 0; i < 50; i++) {
    const result = simulate(i + 1, 1000, indMap, symbols, tradingTimes, 42 + i * 7919);
    results.push(result);
    const emoji = result.pnl >= 0 ? '✅' : '❌';
    const wr = `${result.winRate}%`.padStart(5);
    const pnlStr = `${result.pnl >= 0 ? '+' : ''}$${result.pnl.toFixed(2)}`.padStart(10);
    process.stdout.write(`\r  Аккаунт ${String(i + 1).padStart(2)}/50: ${result.totalTrades} сделок | WR ${wr} | PnL ${pnlStr} | DD ${result.maxDrawdownPct}% ${emoji}      `);
  }
  console.log('');
  console.log('');

  // ── AGGREGATE STATISTICS ──
  console.log('━'.repeat(70));
  console.log('  СВОДНАЯ СТАТИСТИКА');
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
  const medianPnl = results.sort((a, b) => a.pnl - b.pnl)[25]?.pnl ?? 0;
  const globalWR = totalTrades > 0 ? ((totalWins / totalTrades) * 100).toFixed(1) : '0';
  const totalBE = results.reduce((s, r) => s + r.beExits, 0);
  const totalTrail = results.reduce((s, r) => s + r.trailExits, 0);
  const totalSL = results.reduce((s, r) => s + r.slExits, 0);
  const totalTP = results.reduce((s, r) => s + r.tpExits, 0);
  const totalTE = results.reduce((s, r) => s + r.timeExits, 0);
  const avgHold = results.reduce((s, r) => s + r.avgHoldHours, 0) / results.length;
  const avgTrades = totalTrades / 50;

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
  Среднее сделок/акк: ${avgTrades.toFixed(1)}
  Среднее удержание:  ${avgHold.toFixed(1)}ч`);
  console.log(`
  ── Выходы по причинам ──
  TP (тейк-профит):    ${totalTP}
  SL (стоп-лосс):     ${totalSL}
  BE (безубыток):      ${totalBE} активаций
  Trailing (трейлинг):  ${totalTrail} сделок закрыто через trailing
  Тайм-эксит:         ${totalTE}
  Конец данных:       ${results.reduce((s, r) => s + r.trades.filter(t => t.reason === 'конец').length, 0)}`);

  // Distribution
  console.log('\n  Распределение PnL по аккаунтам:');
  const sorted = [...results].sort((a, b) => a.pnl - b.pnl);
  const buckets = [-200, -100, -50, -25, -10, 0, 10, 25, 50, 100, 200, 500, 1000, 5000];
  for (let i = 0; i < buckets.length - 1; i++) {
    const count = sorted.filter(r => r.pnl >= buckets[i] && r.pnl < buckets[i + 1]).length;
    if (count > 0) {
      const bar = '█'.repeat(Math.min(count, 40));
      console.log(`    $${String(buckets[i]).padStart(5)} to $${String(buckets[i + 1]).padStart(5)}: ${bar} (${count})`);
    }
  }

  // Per-reason breakdown for closed trades
  console.log('\n  Детализация по типам сделок:');
  const allTrades = results.flatMap(r => r.trades).filter(t => t.closeTime);
  const byReason = new Map<string, { count: number; pnl: number; avgPnl: number }>();
  for (const t of allTrades) {
    const r = t.reason || 'unknown';
    const prev = byReason.get(r) || { count: 0, pnl: 0, avgPnl: 0 };
    prev.count++;
    prev.pnl += t.pnl ?? 0;
    byReason.set(r, prev);
  }
  for (const [reason, data] of byReason) {
    const avg = data.count > 0 ? data.pnl / data.count : 0;
    console.log(`    ${reason.padEnd(12)}: ${String(data.count).padStart(4)} сделок | суммарно ${data.pnl >= 0 ? '+' : ''}$${data.pnl.toFixed(2)} | среднее ${avg >= 0 ? '+' : ''}$${avg.toFixed(2)}`);
  }

  // Top 5 best and worst accounts
  console.log('\n  Топ-5 лучших:');
  for (const r of sorted.slice(-5).reverse()) {
    console.log(`    #${String(r.id).padStart(2)}: ${r.totalTrades} сделок, WR ${r.winRate}%, PnL ${r.pnl >= 0 ? '+' : ''}$${r.pnl.toFixed(2)}, PF ${r.profitFactor}, DD ${r.maxDrawdownPct}%`);
  }
  console.log('  Топ-5 худших:');
  for (const r of sorted.slice(0, 5)) {
    console.log(`    #${String(r.id).padStart(2)}: ${r.totalTrades} сделок, WR ${r.winRate}%, PnL ${r.pnl >= 0 ? '+' : ''}$${r.pnl.toFixed(2)}, PF ${r.profitFactor}, DD ${r.maxDrawdownPct}%`);
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\n  Время выполнения: ${elapsed}с`);
  console.log('');
}

main().catch(console.error);
