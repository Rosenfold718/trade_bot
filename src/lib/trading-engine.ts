import type { CandleData, IndicatorSignal, TradingDecision } from './types';
import { getStrategy, type StrategyConfig } from './strategies';
import { calcVolumeFlow as calcVolumeFlowRegime } from './volume-regime';

// ============================================================
// Indicator Calculations
// ============================================================

function sma(data: number[], period: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(NaN);
      continue;
    }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sum += data[j];
    }
    result.push(sum / period);
  }
  return result;
}

function ema(data: number[], period: number): number[] {
  const result: number[] = [];
  const multiplier = 2 / (period + 1);
  let prevEma: number | null = null;
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(NaN);
      continue;
    }
    if (prevEma === null) {
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) sum += data[j];
      prevEma = sum / period;
    } else {
      prevEma = (data[i] - prevEma) * multiplier + prevEma;
    }
    result.push(prevEma);
  }
  return result;
}

function calcLocalEMA(data: number[], period: number): number | null {
  const result = ema(data, period);
  const last = result[result.length - 1];
  return (last !== undefined && isFinite(last)) ? last : null;
}

function calcRSI(closes: number[], period: number = 14): number {
  if (closes.length < period + 1) return 50;
  // Wilder's smoothing method
  const multiplier = 1 / period;
  let avgGain = 0;
  let avgLoss = 0;

  // Initial SMA for first period
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) avgGain += change;
    else avgLoss += Math.abs(change);
  }
  avgGain /= period;
  avgLoss /= period;

  // Wilder's smoothing for remaining periods
  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) avgGain = avgGain * (1 - multiplier) + change * multiplier;
    else avgLoss = avgLoss * (1 - multiplier) + Math.abs(change) * multiplier;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function calcMACD(closes: number[]): { macdLine: number; signalLine: number; histogram: number } {
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const macdLineArr: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (isNaN(ema12[i]) || isNaN(ema26[i])) macdLineArr.push(NaN);
    else macdLineArr.push(ema12[i] - ema26[i]);
  }
  if (closes.length < 35) return { macdLine: 0, signalLine: 0, histogram: 0 };
  // Filter NaN only for signal EMA, but use full array length
  const validMacd = macdLineArr.slice(26); // Start from where EMA26 becomes valid
  if (validMacd.length < 9) return { macdLine: 0, signalLine: 0, histogram: 0 };
  const signalArr = ema(validMacd, 9);
  const macdLine = validMacd[validMacd.length - 1];
  const signalLine = signalArr[signalArr.length - 1] || 0;
  return { macdLine, signalLine, histogram: macdLine - signalLine };
}

function calcBollingerBands(closes: number[], period: number = 20, stdDev: number = 2): { upper: number; middle: number; lower: number; position: number } {
  if (closes.length < period) return { upper: 0, middle: 0, lower: 0, position: 0.5 };
  const slice = closes.slice(-period);
  const middle = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((sum, val) => sum + Math.pow(val - middle, 2), 0) / (period - 1);
  const std = Math.sqrt(variance);
  const upper = middle + stdDev * std;
  const lower = middle - stdDev * std;
  const currentPrice = closes[closes.length - 1];
  const position = (currentPrice - lower) / (upper - lower);
  return { upper, middle, lower, position: Math.max(0, Math.min(1, position)) };
}

function calcATR(candles: CandleData[], period: number = 14): number {
  if (candles.length < period + 1) return 0;
  let sum = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    const tr = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close)
    );
    sum += tr;
  }
  return sum / period;
}

function calcVolumeSignal(candles: CandleData[], period: number = 20): number {
  if (candles.length < period) return 0;
  const recentVol = candles.slice(-period).reduce((s, c) => s + c.volume, 0) / period;
  const currentVol = candles[candles.length - 1].volume;
  if (recentVol === 0) return 0;
  const ratio = currentVol / recentVol;
  if (ratio > 2.0) return 1;
  if (ratio > 1.5) return 0.5;
  if (ratio < 0.5) return -0.5;
  return 0;
}

// ============================================================
// Additional Indicator Calculations
// ============================================================

function calcStochRSI(closes: number[], rsiPeriod: number = 14, stochPeriod: number = 14): number {
  if (closes.length < rsiPeriod + stochPeriod) return 0.5;
  // Calculate RSI for each window
  const rsiValues: number[] = [];
  for (let i = rsiPeriod; i <= closes.length; i++) {
    rsiValues.push(calcRSI(closes.slice(0, i), rsiPeriod));
  }
  // Take last stochPeriod RSI values
  const recentRSI = rsiValues.slice(-stochPeriod);
  const minRSI = Math.min(...recentRSI);
  const maxRSI = Math.max(...recentRSI);
  const currentRSI = recentRSI[recentRSI.length - 1];
  if (maxRSI === minRSI) return 0.5;
  return (currentRSI - minRSI) / (maxRSI - minRSI);
}

function calcADX(candles: CandleData[], period: number = 14): { adx: number; plusDI: number; minusDI: number } {
  if (candles.length < period * 2) return { adx: 0, plusDI: 0, minusDI: 0 };

  const trueRanges: number[] = [];
  const plusDM: number[] = [];
  const minusDM: number[] = [];

  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevHigh = candles[i - 1].high;
    const prevLow = candles[i - 1].low;
    const prevClose = candles[i - 1].close;

    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    trueRanges.push(tr);

    const upMove = high - prevHigh;
    const downMove = prevLow - low;

    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }

  // Smooth with Wilder's method
  const smooth = (data: number[], p: number) => {
    const result: number[] = [];
    let sum = 0;
    for (let i = 0; i < p && i < data.length; i++) sum += data[i];
    result.push(sum);
    for (let i = p; i < data.length; i++) {
      sum = sum - sum / p + data[i];
      result.push(sum);
    }
    return result;
  };

  const smoothTR = smooth(trueRanges, period);
  const smoothPlusDM = smooth(plusDM, period);
  const smoothMinusDM = smooth(minusDM, period);

  const diValues: number[] = [];
  const plusDIValues: number[] = [];
  const minusDIValues: number[] = [];

  for (let i = 0; i < smoothTR.length; i++) {
    const pdi = smoothTR[i] > 0 ? (smoothPlusDM[i] / smoothTR[i]) * 100 : 0;
    const mdi = smoothTR[i] > 0 ? (smoothMinusDM[i] / smoothTR[i]) * 100 : 0;
    plusDIValues.push(pdi);
    minusDIValues.push(mdi);
    const diSum = pdi + mdi;
    diValues.push(diSum > 0 ? (Math.abs(pdi - mdi) / diSum) * 100 : 0);
  }

  // Smooth ADX
  const adxSmoothed: number[] = [];
  if (diValues.length >= period) {
    let adxSum = 0;
    for (let i = 0; i < period; i++) adxSum += diValues[i];
    adxSmoothed.push(adxSum / period);
    for (let i = period; i < diValues.length; i++) {
      adxSmoothed.push((adxSmoothed[adxSmoothed.length - 1] * (period - 1) + diValues[i]) / period);
    }
  }

  const lastIdx = adxSmoothed.length - 1;
  return {
    adx: adxSmoothed.length > 0 ? adxSmoothed[lastIdx] : 0,
    plusDI: plusDIValues.length > 0 ? plusDIValues[plusDIValues.length - 1] : 0,
    minusDI: minusDIValues.length > 0 ? minusDIValues[minusDIValues.length - 1] : 0,
  };
}

function calcOBV(candles: CandleData[]): { obv: number; trend: number } {
  if (candles.length < 2) return { obv: 0, trend: 0 };
  let obv = 0;
  const obvHistory: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    if (candles[i].close > candles[i - 1].close) obv += candles[i].volume;
    else if (candles[i].close < candles[i - 1].close) obv -= candles[i].volume;
    obvHistory.push(obv);
  }
  // Simple trend: compare recent OBV vs earlier OBV
  if (obvHistory.length < 10) return { obv, trend: 0 };
  const recent = obvHistory.slice(-10).reduce((a, b) => a + b, 0) / 10;
  const earlier = obvHistory.slice(-20, -10).reduce((a, b) => a + b, 0) / Math.min(10, obvHistory.length - 10);
  const trend = earlier !== 0 ? (recent - earlier) / Math.abs(earlier) : 0;
  return { obv, trend: Math.max(-1, Math.min(1, trend)) };
}

function calcVWAP(candles: CandleData[], period: number = 20): { vwap: number; signal: number } {
  if (candles.length < period) return { vwap: 0, signal: 0 };
  const slice = candles.slice(-period);
  let cumVolumePrice = 0;
  let cumVolume = 0;
  for (const c of slice) {
    const typicalPrice = (c.high + c.low + c.close) / 3;
    cumVolumePrice += typicalPrice * c.volume;
    cumVolume += c.volume;
  }
  const vwap = cumVolume > 0 ? cumVolumePrice / cumVolume : 0;
  const price = candles[candles.length - 1].close;
  const signal = vwap > 0 ? (price - vwap) / vwap : 0;
  return { vwap, signal: Math.max(-1, Math.min(1, signal * 100)) }; // scale up
}

// ============================================================
// Anti-Chase / Spike Detection Indicators
// (Based on freqtrade community strategies + ta4j patterns)
// ============================================================

/**
 * ATR Ratio — current candle range vs ATR(14).
 * Values > 2.5 = spike candle (the move already happened).
 * Used to BLOCK entry on spike candles.
 */
function calcCandleATRRatio(candles: CandleData[], atr: number): number {
  if (atr <= 0) return 1;
  const last = candles[candles.length - 1];
  return (last.high - last.low) / atr;
}

/**
 * Rate of Change (ROC) — % price change over N candles.
 * Detects velocity. ROC_3 > 8% = sharp 3-candle move = block entry.
 */
function calcROC(closes: number[], period: number = 3): number {
  if (closes.length < period + 1) return 0;
  const current = closes[closes.length - 1];
  const past = closes[closes.length - 1 - period];
  if (past === 0) return 0;
  return ((current - past) / past) * 100;
}

/**
 * CCI (Commodity Channel Index) — detects overbought/oversold cyclical extremes.
 * |CCI| > 200 = extreme, likely to revert.
 */
function calcCCI(candles: CandleData[], period: number = 20): number {
  if (candles.length < period) return 0;
  const slice = candles.slice(-period);
  const typicalPrices = slice.map(c => (c.high + c.low + c.close) / 3);
  const smaTP = typicalPrices.reduce((s, v) => s + v, 0) / period;
  const meanDev = typicalPrices.reduce((s, v) => s + Math.abs(v - smaTP), 0) / period;
  if (meanDev === 0) return 0;
  const currentTP = typicalPrices[typicalPrices.length - 1];
  return (currentTP - smaTP) / (0.015 * meanDev);
}

/**
 * Volume spike ratio — current volume vs 20-period average.
 * > 5.0 = extreme volume anomaly (pump/dump signature).
 */
function calcVolumeRatio(candles: CandleData[], period: number = 20): number {
  if (candles.length < period + 1) return 1;
  const avgVol = candles.slice(-period - 1, -1).reduce((s, c) => s + c.volume, 0) / period;
  if (avgVol === 0) return 1;
  return candles[candles.length - 1].volume / avgVol;
}

/**
 * Candle body/wick analysis — detects directional spike candles.
 * Returns { bodyRatio, closePosition } where:
 *   bodyRatio > 0.85 = strong directional candle (likely a pump candle)
 *   closePosition > 0.95 = closed at top (buying the top for longs)
 */
function analyzeCandleShape(candle: CandleData): { bodyRatio: number; closePosition: number; upperWickRatio: number; lowerWickRatio: number } {
  const range = candle.high - candle.low;
  if (range === 0) return { bodyRatio: 0, closePosition: 0.5, upperWickRatio: 0, lowerWickRatio: 0 };
  const body = Math.abs(candle.close - candle.open);
  const upperWick = candle.high - Math.max(candle.close, candle.open);
  const lowerWick = Math.min(candle.close, candle.open) - candle.low;
  return {
    bodyRatio: body / range,
    closePosition: (candle.close - candle.low) / range,
    upperWickRatio: upperWick / range,
    lowerWickRatio: lowerWick / range,
  };
}

/**
 * Distance from EMA — detects overextension.
 * distance > 5% from EMA20 = overextended (will revert).
 */
function calcDistanceFromMA(closes: number[], ma: number): number {
  if (ma === 0) return 0;
  const price = closes[closes.length - 1];
  return ((price - ma) / ma) * 100;
}

/**
 * ── SPIKE GUARD ──
 * Comprehensive anti-chase filter. Returns { blocked, reason } if any
 * spike/exhaustion condition is detected. Used by ALL strategies.
 *
 * Based on freqtrade community "Complete Spike Guard" pattern:
 *   1. Candle ATR ratio > 2.5 (current candle IS the spike)
 *   2. ROC(3) > 8% (3-candle move too large)
 *   3. Volume ratio > 5.0 AND ROC(1) > 2% (FOMO candle)
 *   4. RSI extreme (direction-dependent)
 *   5. Distance from EMA20 > 5% (overextended)
 *   6. CCI > ±200 (cyclical extreme)
 *   7. Candle closed at extreme (closePosition > 0.95 for longs)
 */
function spikeGuard(
  candles: CandleData[],
  closes: number[],
  atr: number,
  rsi: number,
  direction: 'long' | 'short' | 'none',
  ema20: number,
  thresholds?: {
    atrRatioMax?: number;
    roc3Max?: number;
    rsiOverbought?: number;
    rsiOversold?: number;
    emaDistMax?: number;
    cciMax?: number;
  }
): { blocked: boolean; reason: string } {
  if (direction === 'none') return { blocked: false, reason: '' };

  // Default thresholds (for 1H/4H)
  const t = {
    atrRatioMax: thresholds?.atrRatioMax ?? 2.5,
    roc3Max: thresholds?.roc3Max ?? 8,
    rsiOverbought: thresholds?.rsiOverbought ?? 78,
    rsiOversold: thresholds?.rsiOversold ?? 22,
    emaDistMax: thresholds?.emaDistMax ?? 5,
    cciMax: thresholds?.cciMax ?? 200,
  };

  const last = candles[candles.length - 1];
  const candleShape = analyzeCandleShape(last);
  const candleATRRatio = calcCandleATRRatio(candles, atr);
  const roc3 = calcROC(closes, 3);
  const roc1 = calcROC(closes, 1);
  const cci = calcCCI(candles, 20);
  const volRatio = calcVolumeRatio(candles, 20);
  const distFromEMA20 = calcDistanceFromMA(closes, ema20);

  const isLong = direction === 'long';

  // 1. Current candle is a spike (ATR ratio)
  if (candleATRRatio > t.atrRatioMax) {
    return { blocked: true, reason: `Спайк-свеча (ATR×${candleATRRatio.toFixed(1)})` };
  }

  // 2. 3-candle velocity too high
  if (roc3 > t.roc3Max) {
    return { blocked: true, reason: `Сильное движение ROC3=${roc3.toFixed(1)}%` };
  }

  // 3. FOMO candle: high volume + sharp move
  if (volRatio > 5.0 && Math.abs(roc1) > 2.0) {
    return { blocked: true, reason: `FOMO свеча (vol×${volRatio.toFixed(1)}, ROC=${roc1.toFixed(1)}%)` };
  }

  // 4. RSI extreme — don't buy overbought, don't sell oversold
  if (isLong && rsi > t.rsiOverbought) {
    return { blocked: true, reason: `RSI перекуплен (${rsi.toFixed(0)})` };
  }
  if (!isLong && rsi < t.rsiOversold) {
    return { blocked: true, reason: `RSI перепродан (${rsi.toFixed(0)})` };
  }

  // 5. Overextended from EMA20
  if (isLong && distFromEMA20 > t.emaDistMax) {
    return { blocked: true, reason: `Цена выше EMA20 на ${distFromEMA20.toFixed(1)}%` };
  }
  if (!isLong && distFromEMA20 < -t.emaDistMax) {
    return { blocked: true, reason: `Цена ниже EMA20 на ${Math.abs(distFromEMA20).toFixed(1)}%` };
  }

  // 6. CCI extreme
  if (isLong && cci > t.cciMax) {
    return { blocked: true, reason: `CCI перекуплен (${cci.toFixed(0)})` };
  }
  if (!isLong && cci < -t.cciMax) {
    return { blocked: true, reason: `CCI перепродан (${cci.toFixed(0)})` };
  }

  // 7. Closed at extreme of candle (buying the top / selling the bottom)
  if (isLong && candleShape.closePosition > 0.95 && candleShape.bodyRatio > 0.7) {
    return { blocked: true, reason: `Закрытие на вершине свечи (покупка верха)` };
  }
  if (!isLong && candleShape.closePosition < 0.05 && candleShape.bodyRatio > 0.7) {
    return { blocked: true, reason: `Закрытие на дне свечи (продажа низа)` };
  }

  return { blocked: false, reason: '' };
}

// ============================================================
// Signal Generation
// ============================================================

export function analyzeIndicators(
  candles: CandleData[],
  weights: Record<string, number>
): IndicatorSignal[] {
  if (candles.length < 50) return [];
  const closes = candles.map(c => c.close);
  const signals: IndicatorSignal[] = [];

  // RSI
  const rsi = calcRSI(closes);
  const rsiWeight = weights['rsi'] ?? 1;
  if (rsi < 30) {
    signals.push({ name: 'RSI', signal: 1, strength: (30 - rsi) / 30 });
  } else if (rsi > 70) {
    signals.push({ name: 'RSI', signal: -1, strength: (rsi - 70) / 30 });
  } else {
    signals.push({ name: 'RSI', signal: 0, strength: 0 });
  }

  // MACD
  const macd = calcMACD(closes);
  const macdWeight = weights['macd'] ?? 1;
  if (macd.histogram > 0 && macd.macdLine > macd.signalLine) {
    signals.push({ name: 'MACD', signal: 1, strength: Math.min(Math.abs(macd.histogram) / (macd.signalLine || 1), 1) });
  } else if (macd.histogram < 0) {
    signals.push({ name: 'MACD', signal: -1, strength: Math.min(Math.abs(macd.histogram) / (macd.signalLine || 1), 1) });
  } else {
    signals.push({ name: 'MACD', signal: 0, strength: 0 });
  }

  // EMA 50
  const ema50Arr = ema(closes, 50);
  const ema50 = ema50Arr[ema50Arr.length - 1];
  const price = closes[closes.length - 1];
  const ema50Weight = weights['ema50'] ?? 1;
  if (!isNaN(ema50)) {
    signals.push({
      name: 'EMA_50',
      signal: price > ema50 ? 1 : -1,
      strength: Math.min(Math.abs(price - ema50) / ema50 * 10, 1),
    });
  } else {
    signals.push({ name: 'EMA_50', signal: 0, strength: 0 });
  }

  // EMA 200
  const ema200Arr = ema(closes, 200);
  const ema200 = ema200Arr[ema200Arr.length - 1];
  const ema200Weight = weights['ema200'] ?? 1;
  if (!isNaN(ema200)) {
    signals.push({
      name: 'EMA_200',
      signal: price > ema200 ? 1 : -1,
      strength: Math.min(Math.abs(price - ema200) / ema200 * 10, 1),
    });
  } else {
    signals.push({ name: 'EMA_200', signal: 0, strength: 0 });
  }

  // Bollinger Bands
  const bb = calcBollingerBands(closes);
  const bbWeight = weights['bollinger'] ?? 1;
  if (bb.position < 0.1) {
    signals.push({ name: 'Bollinger', signal: 1, strength: (0.1 - bb.position) / 0.1 });
  } else if (bb.position > 0.9) {
    signals.push({ name: 'Bollinger', signal: -1, strength: (bb.position - 0.9) / 0.1 });
  } else {
    signals.push({ name: 'Bollinger', signal: 0, strength: 0 });
  }

  // Volume
  const volSignal = calcVolumeSignal(candles);
  const volWeight = weights['volume'] ?? 1;
  signals.push({ name: 'Volume', signal: volSignal > 0 ? 1 : volSignal < 0 ? -1 : 0, strength: Math.abs(volSignal) });

  // StochRSI
  const stochRSI = calcStochRSI(closes);
  if (stochRSI > 0.8) {
    signals.push({ name: 'StochRSI', signal: -1, strength: (stochRSI - 0.8) / 0.2 });
  } else if (stochRSI < 0.2) {
    signals.push({ name: 'StochRSI', signal: 1, strength: (0.2 - stochRSI) / 0.2 });
  } else {
    signals.push({ name: 'StochRSI', signal: 0, strength: 0 });
  }

  // ADX as indicator (CORE+TRAIL): always give directional signal when DI diverge
  const adxResult = calcADX(candles);
  if (adxResult.plusDI > adxResult.minusDI + 5) {
    signals.push({ name: 'ADX', signal: 1, strength: Math.min((adxResult.plusDI - adxResult.minusDI) / 50, 1) });
  } else if (adxResult.minusDI > adxResult.plusDI + 5) {
    signals.push({ name: 'ADX', signal: -1, strength: Math.min((adxResult.minusDI - adxResult.plusDI) / 50, 1) });
  } else {
    signals.push({ name: 'ADX', signal: 0, strength: 0 });
  }

  // OBV
  const obvResult = calcOBV(candles);
  const priceChange = closes.length > 5
    ? (closes[closes.length - 1] - closes[closes.length - 6]) / closes[closes.length - 6]
    : 0;
  if (obvResult.trend > 0.05 && priceChange > 0) {
    // Rising OBV + rising price = bullish confirmation
    signals.push({ name: 'OBV', signal: 1, strength: Math.min(Math.abs(obvResult.trend) * 5, 1) });
  } else if (obvResult.trend < -0.05 && priceChange < 0) {
    // Falling OBV + falling price = bearish confirmation
    signals.push({ name: 'OBV', signal: -1, strength: Math.min(Math.abs(obvResult.trend) * 5, 1) });
  } else if (obvResult.trend > 0.05 && priceChange < 0) {
    // Divergence: OBV rising but price falling — potential reversal up
    signals.push({ name: 'OBV', signal: 1, strength: Math.min(Math.abs(obvResult.trend) * 3, 0.7) });
  } else if (obvResult.trend < -0.05 && priceChange > 0) {
    // Divergence: OBV falling but price rising — potential reversal down
    signals.push({ name: 'OBV', signal: -1, strength: Math.min(Math.abs(obvResult.trend) * 3, 0.7) });
  } else {
    signals.push({ name: 'OBV', signal: 0, strength: 0 });
  }

  // VWAP
  const vwapResult = calcVWAP(candles);
  if (vwapResult.signal > 0.005) {
    signals.push({ name: 'VWAP', signal: 1, strength: Math.min(vwapResult.signal * 10, 1) });
  } else if (vwapResult.signal < -0.005) {
    signals.push({ name: 'VWAP', signal: -1, strength: Math.min(Math.abs(vwapResult.signal) * 10, 1) });
  } else {
    signals.push({ name: 'VWAP', signal: 0, strength: 0 });
  }

  // Volume Flow Direction (tape reading — net buying vs selling pressure over last 5 candles)
  // This detects when money is actively flowing in one direction regardless of price.
  const volFlow = calcVolumeFlowRegime(candles, 5);
  if (volFlow.strength > 0.3) {
    signals.push({ name: 'VolFlow', signal: volFlow.direction === 'up' ? 1 : -1, strength: volFlow.strength });
  } else {
    signals.push({ name: 'VolFlow', signal: 0, strength: 0 });
  }

  return signals;
}

// ============================================================
// Trading Decision
// ============================================================

export function makeTradingDecision(
  symbol: string,
  candles: CandleData[],
  weights: Record<string, number>,
  idleMinutes: number = 0,
): TradingDecision {
  const indicators = analyzeIndicators(candles, weights);
  const closes = candles.map(c => c.close);
  const price = closes[closes.length - 1];
  const atr = calcATR(candles);

  // ============================================================
  // POINT 1: ADX regime filter — skip if market is ranging (ADX < 20)
  // ============================================================
  const adxResult = calcADX(candles);
  if (adxResult.adx < 20) {
    // Market is choppy/ranging — don't trade
    return {
      symbol,
      direction: 'none',
      score: 0,
      leverage: 1,
      stopLoss: 0,
      takeProfit: 0,
      indicators,
    };
  }

  let longScore = 0;
  let shortScore = 0;
  let longCount = 0;  // POINT 3: count agreeing indicators
  let shortCount = 0;

  for (const ind of indicators) {
    const w = weights[ind.name] ?? 1;
    if (ind.signal > 0) {
      longScore += ind.strength * w;
      longCount++;
    } else if (ind.signal < 0) {
      shortScore += ind.strength * w;
      shortCount++;
    }
  }

  const OPEN_THRESHOLD = 0.15;
  const absLongScore = Math.abs(longScore);
  const absShortScore = Math.abs(shortScore);
  const maxScore = Math.max(absLongScore, absShortScore);

  // ============================================================
  // POINT 3: Confluence filter — require ≥6 indicators to agree
  // Stricter filtering: only take high-conviction signals
  // ============================================================
  const bestCount = Math.max(longCount, shortCount);
  if (bestCount < 6) {
    return {
      symbol,
      direction: 'none',
      score: maxScore,
      leverage: 1,
      stopLoss: 0,
      takeProfit: 0,
      indicators,
    };
  }

  // ============================================================
  // POINT 2: Removed sub-threshold fallback — only trade with real signals
  // ============================================================
  let direction: 'long' | 'short' | 'none' = 'none';
  let score = 0;

  if (absLongScore >= OPEN_THRESHOLD && absLongScore >= absShortScore) {
    direction = 'long';
    score = longScore;
  } else if (absShortScore >= OPEN_THRESHOLD && absShortScore > absLongScore) {
    direction = 'short';
    score = shortScore;
  }
  // No more fallback at score > 0.02

  // Leverage based on signal strength (1x to 10x), lower for weak signals
  const leverage = direction === 'none' ? 1 : Math.min(10, Math.max(1, Math.round(maxScore * 3)));

  // Stop loss and take profit based on ATR
  const stopLossPercent = atr / price;
  const takeProfitPercent = stopLossPercent * 2.5; // Improved: 1:2.5 risk/reward

  const stopLoss = direction === 'long'
    ? price * (1 - stopLossPercent)
    : price * (1 + stopLossPercent);
  const takeProfit = direction === 'long'
    ? price * (1 + takeProfitPercent)
    : price * (1 - takeProfitPercent);

  return {
    symbol,
    direction,
    score,
    leverage,
    stopLoss,
    takeProfit,
    indicators,
  };
}

// ============================================================
// Multi-Strategy Decision Router
// ============================================================

function noDecision(symbol: string, _candles: CandleData[]): TradingDecision {
  return {
    symbol,
    direction: 'none',
    score: 0,
    leverage: 1,
    stopLoss: 0,
    takeProfit: 0,
    indicators: [],
    pattern: null,
  };
}

export type StrategyOverrides = {
  scoreThreshold?: number;
  maxLeverage?: number;
  riskRewardRatio?: number;
  adxMin?: number | null;
  mtfEnabled?: boolean;
};

export function makeStrategyDecision(
  strategyId: string,
  symbol: string,
  candles: CandleData[],
  idleMinutes: number = 0,
  strategyOverride?: StrategyOverrides & Partial<StrategyConfig>,
  weights?: Record<string, number>,
): TradingDecision {
  const base = getStrategy(strategyId);
  if (!base) return noDecision(symbol, candles);

  // Merge overrides with base strategy config
  const strategy: StrategyConfig = strategyOverride
    ? { ...base, ...strategyOverride } as StrategyConfig
    : base;

  const effectiveWeights = weights ?? {};

  switch (strategyId) {
    case 'scalper':
      return makePatternProDecision(symbol, candles, strategy, idleMinutes, effectiveWeights);
    case 'position-alpha':
      return makePositionAlphaDecision(symbol, candles, strategy, idleMinutes, effectiveWeights);
    default:
      return makeMomentumDecision(symbol, candles, strategy, idleMinutes, effectiveWeights);
  }
}

// ============================================================
// Strategy 1: Momentum Pro (adapted from makeTradingDecision)
// ============================================================

function makeMomentumDecision(
  symbol: string,
  candles: CandleData[],
  strategy: StrategyConfig,
  _idleMinutes: number = 0,
  weights: Record<string, number> = {},
): TradingDecision {
  const indicators = analyzeIndicators(candles, weights);
  const closes = candles.map(c => c.close);
  const price = closes[closes.length - 1];
  const atr = calcATR(candles);
  const rsi = calcRSI(closes);
  const adxResult = calcADX(candles);

  // ADX regime filter — require strong trend
  if (strategy.adxMin !== null && adxResult.adx < strategy.adxMin) {
    return { symbol, direction: 'none', score: 0, leverage: 1, stopLoss: 0, takeProfit: 0, indicators };
  }

  let longScore = 0;
  let shortScore = 0;
  let longCount = 0;
  let shortCount = 0;

  for (const ind of indicators) {
    const w = weights[ind.name] ?? 1;
    if (ind.signal > 0) {
      longScore += ind.strength * w;
      longCount++;
    } else if (ind.signal < 0) {
      shortScore += ind.strength * w;
      shortCount++;
    }
  }

  const absLongScore = Math.abs(longScore);
  const absShortScore = Math.abs(shortScore);
  const maxScore = Math.max(absLongScore, absShortScore);

  // Confluence: require ≥6 of 10 indicators to agree
  const bestCount = Math.max(longCount, shortCount);
  if (bestCount < 6) {
    return { symbol, direction: 'none', score: maxScore, leverage: 1, stopLoss: 0, takeProfit: 0, indicators };
  }

  // Trend exhaustion filter: don't buy at the top, don't sell at the bottom
  if (absLongScore >= absShortScore && rsi > 78) {
    return { symbol, direction: 'none', score: maxScore, leverage: 1, stopLoss: 0, takeProfit: 0, indicators };
  }
  if (absShortScore > absLongScore && rsi < 22) {
    return { symbol, direction: 'none', score: maxScore, leverage: 1, stopLoss: 0, takeProfit: 0, indicators };
  }

  let direction: 'long' | 'short' | 'none' = 'none';
  let score = 0;

  if (absLongScore >= strategy.scoreThreshold && absLongScore >= absShortScore) {
    direction = 'long';
    score = longScore;
  } else if (absShortScore >= strategy.scoreThreshold && absShortScore > absLongScore) {
    direction = 'short';
    score = shortScore;
  }

  // ── SPIKE GUARD: Anti-chase filter ──
  // Block entry if the market just had a sharp move (pump/dump).
  // Computes EMA20 for overextension check.
  if (direction !== 'none') {
    const ema20Arr = ema(closes, 20);
    const ema20 = ema20Arr[ema20Arr.length - 1] || price;
    const guard = spikeGuard(candles, closes, atr, rsi, direction, ema20);
    if (guard.blocked) {
      console.log(`[Momentum] ${symbol} ${direction.toUpperCase()} blocked: ${guard.reason}`);
      return { symbol, direction: 'none', score: maxScore, leverage: 1, stopLoss: 0, takeProfit: 0, indicators };
    }
  }

  // Conservative leverage: 1x for weak signals, max 3x for very strong
  const leverage = direction === 'none'
    ? 1
    : Math.min(strategy.maxLeverage, Math.max(1, Math.round(maxScore * 1.5)));

  // Stop loss: 3× ATR (CORE+TRAIL — wider, less noise stop-outs), floored at 0.8%, capped at 5%
  const stopLossPercent = Math.max(0.008, Math.min(3.0 * atr / price, 0.05));
  // TP uses strategy.riskRewardRatio (2.5× for Momentum = 1:2.5 R:R CORE+TRAIL)
  const takeProfitPercent = Math.min(stopLossPercent * strategy.riskRewardRatio, 0.20);

  const stopLoss = direction === 'long'
    ? price * (1 - stopLossPercent)
    : price * (1 + stopLossPercent);
  const takeProfit = direction === 'long'
    ? price * (1 + takeProfitPercent)
    : price * (1 - takeProfitPercent);

  return { symbol, direction, score, leverage, stopLoss, takeProfit, indicators };
}

// ============================================================
// Candlestick Pattern Recognition — Pattern Pro Strategy
// Comprehensive pattern detection with real statistical win rates
// Source: Bulkowski's Encyclopedia of Candlestick Charts, Nison
// ============================================================

type PatternDirection = 'bullish' | 'bearish' | 'neutral';

interface DetectedPattern {
  name: string;
  direction: PatternDirection;
  reliability: number;   // 0-1, real-world win rate from research
  avgMoveATR: number;    // expected move in ATR multiples
  strength: number;      // 0-1, how well-formed the pattern is
  // Visualization: which candles the pattern spans
  startIndex: number;    // index in the candles array
  endIndex: number;      // index in the candles array
  zoneHigh: number;      // highest high in the pattern zone
  zoneLow: number;       // lowest low in the pattern zone
}

// ── Helpers ──

function candleBody(c: CandleData): number { return Math.abs(c.close - c.open); }
function candleRange(c: CandleData): number { return c.high - c.low; }
function isBullish(c: CandleData): boolean { return c.close > c.open; }
function isBearish(c: CandleData): boolean { return c.close < c.open; }
function upperWick(c: CandleData): number { return c.high - Math.max(c.close, c.open); }
function lowerWick(c: CandleData): number { return Math.min(c.close, c.open) - c.low; }
function bodyMid(c: CandleData): number { return (c.open + c.close) / 2; }

// ── SINGLE CANDLE PATTERNS ──

function detectHammer(candles: CandleData[], idx: number, _prevTrend: 'down' | 'up' | 'flat'): DetectedPattern | null {
  const c = candles[idx];
  const range = candleRange(c);
  if (range === 0) return null;
  const body = candleBody(c);
  const lw = lowerWick(c);
  const uw = upperWick(c);
  // Hammer: small body at top, long lower shadow (≥2× body), tiny upper shadow (≤10% range)
  if (lw >= body * 2 && uw <= range * 0.1 && body >= range * 0.05) {
    return { name: 'Молот', direction: 'bullish', reliability: 0.60, avgMoveATR: 1.0, strength: Math.min(lw / (body * 3), 1), startIndex: idx, endIndex: idx, zoneHigh: c.high, zoneLow: c.low };
  }
  return null;
}

function detectShootingStar(candles: CandleData[], idx: number, _prevTrend: 'down' | 'up' | 'flat'): DetectedPattern | null {
  const c = candles[idx];
  const range = candleRange(c);
  if (range === 0) return null;
  const body = candleBody(c);
  const uw = upperWick(c);
  const lw = lowerWick(c);
  if (uw >= body * 2 && lw <= range * 0.1 && body >= range * 0.05) {
    return { name: 'Падающая звезда', direction: 'bearish', reliability: 0.59, avgMoveATR: 1.0, strength: Math.min(uw / (body * 3), 1), startIndex: idx, endIndex: idx, zoneHigh: c.high, zoneLow: c.low };
  }
  return null;
}

function detectDoji(candles: CandleData[], idx: number): DetectedPattern | null {
  const c = candles[idx];
  const range = candleRange(c);
  if (range === 0) return null;
  const body = candleBody(c);
  // Doji: body < 5% of range
  if (body < range * 0.05) {
    return { name: 'Доджи', direction: 'neutral', reliability: 0.0, avgMoveATR: 0.5, strength: 0.5, startIndex: idx, endIndex: idx, zoneHigh: c.high, zoneLow: c.low };
  }
  return null;
}

function detectDragonflyDoji(candles: CandleData[], idx: number): DetectedPattern | null {
  const c = candles[idx];
  const range = candleRange(c);
  if (range === 0) return null;
  const body = candleBody(c);
  const lw = lowerWick(c);
  const uw = upperWick(c);
  if (body < range * 0.05 && lw > range * 0.6 && uw < range * 0.05) {
    return { name: 'Доджи стрекоза', direction: 'bullish', reliability: 0.62, avgMoveATR: 1.1, strength: Math.min(lw / range, 1), startIndex: idx, endIndex: idx, zoneHigh: c.high, zoneLow: c.low };
  }
  return null;
}

function detectGravestoneDoji(candles: CandleData[], idx: number): DetectedPattern | null {
  const c = candles[idx];
  const range = candleRange(c);
  if (range === 0) return null;
  const body = candleBody(c);
  const uw = upperWick(c);
  const lw = lowerWick(c);
  if (body < range * 0.05 && uw > range * 0.6 && lw < range * 0.05) {
    return { name: 'Доджи надгробие', direction: 'bearish', reliability: 0.61, avgMoveATR: 1.0, strength: Math.min(uw / range, 1), startIndex: idx, endIndex: idx, zoneHigh: c.high, zoneLow: c.low };
  }
  return null;
}

function detectMarubozu(candles: CandleData[], idx: number): DetectedPattern | null {
  const c = candles[idx];
  const range = candleRange(c);
  if (range === 0) return null;
  const body = candleBody(c);
  const uw = upperWick(c);
  const lw = lowerWick(c);
  if (body > range * 0.9 && uw < range * 0.05 && lw < range * 0.05) {
    const dir = isBullish(c) ? 'bullish' : 'bearish';
    return { name: 'Марубозу', direction: dir as PatternDirection, reliability: 0.70, avgMoveATR: 1.3, strength: 0.9, startIndex: idx, endIndex: idx, zoneHigh: c.high, zoneLow: c.low };
  }
  return null;
}

// ── TWO-CANDLE PATTERNS ──

function detectBullishEngulfing(candles: CandleData[], idx: number): DetectedPattern | null {
  const prev = candles[idx - 1]; const curr = candles[idx];
  if (!isBearish(prev) || !isBullish(curr)) return null;
  const prevBody = candleBody(prev);
  const currBody = candleBody(curr);
  if (currBody <= prevBody) return null;
  if (curr.close >= prev.open && curr.open <= prev.close) {
    return { name: 'Бычье поглощение', direction: 'bullish', reliability: 0.63, avgMoveATR: 1.2, strength: Math.min(currBody / (prevBody * 1.5), 1), startIndex: idx - 1, endIndex: idx, zoneHigh: Math.max(prev.high, curr.high), zoneLow: Math.min(prev.low, curr.low) };
  }
  return null;
}

function detectBearishEngulfing(candles: CandleData[], idx: number): DetectedPattern | null {
  const prev = candles[idx - 1]; const curr = candles[idx];
  if (!isBullish(prev) || !isBearish(curr)) return null;
  const prevBody = candleBody(prev);
  const currBody = candleBody(curr);
  if (currBody <= prevBody) return null;
  if (curr.open >= prev.close && curr.close <= prev.open) {
    return { name: 'Медвежье поглощение', direction: 'bearish', reliability: 0.65, avgMoveATR: 1.2, strength: Math.min(currBody / (prevBody * 1.5), 1), startIndex: idx - 1, endIndex: idx, zoneHigh: Math.max(prev.high, curr.high), zoneLow: Math.min(prev.low, curr.low) };
  }
  return null;
}

function detectPiercingLine(candles: CandleData[], idx: number): DetectedPattern | null {
  const prev = candles[idx - 1]; const curr = candles[idx];
  if (!isBearish(prev) || !isBullish(curr)) return null;
  const prevBody = candleBody(prev);
  const prevMid = bodyMid(prev);
  if (curr.open < prev.close && curr.close > prevMid) {
    return { name: 'Проникающая линия', direction: 'bullish', reliability: 0.58, avgMoveATR: 0.9, strength: Math.min((curr.close - prevMid) / prevBody, 1), startIndex: idx - 1, endIndex: idx, zoneHigh: Math.max(prev.high, curr.high), zoneLow: Math.min(prev.low, curr.low) };
  }
  return null;
}

function detectDarkCloudCover(candles: CandleData[], idx: number): DetectedPattern | null {
  const prev = candles[idx - 1]; const curr = candles[idx];
  if (!isBullish(prev) || !isBearish(curr)) return null;
  const prevBody = candleBody(prev);
  const prevMid = bodyMid(prev);
  if (curr.open > prev.close && curr.close < prevMid) {
    return { name: 'Тёмное облако', direction: 'bearish', reliability: 0.60, avgMoveATR: 0.9, strength: Math.min((prevMid - curr.close) / prevBody, 1), startIndex: idx - 1, endIndex: idx, zoneHigh: Math.max(prev.high, curr.high), zoneLow: Math.min(prev.low, curr.low) };
  }
  return null;
}

function detectTweezerBottom(candles: CandleData[], idx: number): DetectedPattern | null {
  const c1 = candles[idx - 2]; const c2 = candles[idx - 1]; const c3 = candles[idx];
  if (!isBearish(c1) || Math.abs(c2.low - c3.low) > candleRange(c2) * 0.05) return null;
  if (c2.low <= c1.low * 1.002 && c3.low <= c1.low * 1.002 && isBullish(c3)) {
    return { name: 'Близнецы (дно)', direction: 'bullish', reliability: 0.61, avgMoveATR: 1.0, strength: 0.7, startIndex: idx - 2, endIndex: idx, zoneHigh: Math.max(c1.high, c2.high, c3.high), zoneLow: Math.min(c1.low, c2.low, c3.low) };
  }
  return null;
}

function detectTweezerTop(candles: CandleData[], idx: number): DetectedPattern | null {
  const c1 = candles[idx - 2]; const c2 = candles[idx - 1]; const c3 = candles[idx];
  if (!isBullish(c1) || Math.abs(c2.high - c3.high) > candleRange(c2) * 0.05) return null;
  if (c2.high >= c1.high * 0.998 && c3.high >= c1.high * 0.998 && isBearish(c3)) {
    return { name: 'Близнецы (вершина)', direction: 'bearish', reliability: 0.62, avgMoveATR: 1.0, strength: 0.7, startIndex: idx - 2, endIndex: idx, zoneHigh: Math.max(c1.high, c2.high, c3.high), zoneLow: Math.min(c1.low, c2.low, c3.low) };
  }
  return null;
}

// ── THREE-CANDLE PATTERNS ──

function detectMorningStar(candles: CandleData[], idx: number): DetectedPattern | null {
  const c1 = candles[idx - 2]; const c2 = candles[idx - 1]; const c3 = candles[idx];
  if (!isBearish(c1) || !isBullish(c3)) return null;
  const r2 = candleRange(c2);
  if (r2 > 0 && candleBody(c2) < r2 * 0.15) {
    const gapDown = c2.high < c1.close;
    const gapUp = c2.low > c3.open;
    const closesIntoPrev = c3.close > bodyMid(c1);
    if ((gapDown || c2.open < c1.close) && closesIntoPrev) {
      return { name: 'Утренняя звезда', direction: 'bullish', reliability: 0.78, avgMoveATR: 1.5, strength: gapDown && gapUp ? 1.0 : 0.7, startIndex: idx - 2, endIndex: idx, zoneHigh: Math.max(c1.high, c2.high, c3.high), zoneLow: Math.min(c1.low, c2.low, c3.low) };
    }
  }
  return null;
}

function detectEveningStar(candles: CandleData[], idx: number): DetectedPattern | null {
  const c1 = candles[idx - 2]; const c2 = candles[idx - 1]; const c3 = candles[idx];
  if (!isBullish(c1) || !isBearish(c3)) return null;
  const r2 = candleRange(c2);
  if (r2 > 0 && candleBody(c2) < r2 * 0.15) {
    const gapUp = c2.low > c1.close;
    const gapDown = c2.high < c3.open;
    const closesIntoPrev = c3.close < bodyMid(c1);
    if ((gapUp || c2.open > c1.close) && closesIntoPrev) {
      return { name: 'Вечерняя звезда', direction: 'bearish', reliability: 0.75, avgMoveATR: 1.4, strength: gapUp && gapDown ? 1.0 : 0.7, startIndex: idx - 2, endIndex: idx, zoneHigh: Math.max(c1.high, c2.high, c3.high), zoneLow: Math.min(c1.low, c2.low, c3.low) };
    }
  }
  return null;
}

function detectThreeWhiteSoldiers(candles: CandleData[], idx: number): DetectedPattern | null {
  const c1 = candles[idx - 2]; const c2 = candles[idx - 1]; const c3 = candles[idx];
  if (!isBullish(c1) || !isBullish(c2) || !isBullish(c3)) return null;
  const ok = c2.open > c1.open && c2.close > c1.close && c3.open > c2.open && c3.close > c2.close;
  const noWick = [c1, c2, c3].every(c => upperWick(c) < candleBody(c) * 0.3);
  if (ok && noWick) {
    return { name: 'Три белых солдата', direction: 'bullish', reliability: 0.73, avgMoveATR: 1.4, strength: 0.85, startIndex: idx - 2, endIndex: idx, zoneHigh: Math.max(c1.high, c2.high, c3.high), zoneLow: Math.min(c1.low, c2.low, c3.low) };
  }
  return null;
}

function detectThreeBlackCrows(candles: CandleData[], idx: number): DetectedPattern | null {
  const c1 = candles[idx - 2]; const c2 = candles[idx - 1]; const c3 = candles[idx];
  if (!isBearish(c1) || !isBearish(c2) || !isBearish(c3)) return null;
  const ok = c2.open < c1.open && c2.close < c1.close && c3.open < c2.open && c3.close < c2.close;
  const noWick = [c1, c2, c3].every(c => lowerWick(c) < candleBody(c) * 0.3);
  if (ok && noWick) {
    return { name: 'Три чёрных ворона', direction: 'bearish', reliability: 0.71, avgMoveATR: 1.3, strength: 0.85, startIndex: idx - 2, endIndex: idx, zoneHigh: Math.max(c1.high, c2.high, c3.high), zoneLow: Math.min(c1.low, c2.low, c3.low) };
  }
  return null;
}

// ── MULTI-CANDLE STRUCTURAL PATTERNS ──

function detectDoubleBottom(candles: CandleData[]): DetectedPattern | null {
  if (candles.length < 15) return null;
  const n = candles.length;
  const last20 = candles.slice(-20);
  const lows = last20.map(c => c.low);
  const min1 = Math.min(...lows.slice(0, -5));
  const min1Idx = lows.slice(0, -5).indexOf(min1);
  const min2 = Math.min(...lows.slice(-8));
  const min2Idx = lows.length - 8 + lows.slice(-8).indexOf(min2);
  const priceDiff = Math.abs(min1 - min2) / min1;
  if (priceDiff < 0.01 && min2Idx > min1Idx + 3) {
    const between = last20.slice(min1Idx, min2Idx);
    if (between.length > 2) {
      const peakHigh = Math.max(...between.map(c => c.high));
      const peakLow = Math.min(min1, min2);
      const peakHeight = (peakHigh - peakLow) / peakLow;
      if (peakHeight > 0.005) {
        const globalStart = n - 20 + min1Idx;
        const globalEnd = n - 20 + min2Idx;
        return { name: 'Двойное дно', direction: 'bullish', reliability: 0.78, avgMoveATR: 2.0, strength: Math.min(peakHeight / 0.03, 1), startIndex: globalStart, endIndex: globalEnd, zoneHigh: peakHigh, zoneLow: peakLow };
      }
    }
  }
  return null;
}

function detectDoubleTop(candles: CandleData[]): DetectedPattern | null {
  if (candles.length < 15) return null;
  const n = candles.length;
  const last20 = candles.slice(-20);
  const highs = last20.map(c => c.high);
  const max1 = Math.max(...highs.slice(0, -5));
  const max1Idx = highs.slice(0, -5).indexOf(max1);
  const max2 = Math.max(...highs.slice(-8));
  const max2Idx = highs.length - 8 + highs.slice(-8).indexOf(max2);
  const priceDiff = Math.abs(max1 - max2) / max1;
  if (priceDiff < 0.01 && max2Idx > max1Idx + 3) {
    const between = last20.slice(max1Idx, max2Idx);
    if (between.length > 2) {
      const troughLow = Math.min(...between.map(c => c.low));
      const troughDepth = (max1 - troughLow) / max1;
      if (troughDepth > 0.005) {
        const globalStart = n - 20 + max1Idx;
        const globalEnd = n - 20 + max2Idx;
        return { name: 'Двойная вершина', direction: 'bearish', reliability: 0.76, avgMoveATR: 2.0, strength: Math.min(troughDepth / 0.03, 1), startIndex: globalStart, endIndex: globalEnd, zoneHigh: max1, zoneLow: troughLow };
      }
    }
  }
  return null;
}

function detectBullFlag(candles: CandleData[]): DetectedPattern | null {
  if (candles.length < 15) return null;
  const n = candles.length;
  const last15 = candles.slice(-15);
  const poleCandles = last15.slice(0, 5);
  const poleMove = (poleCandles[poleCandles.length - 1].close - poleCandles[0].open) / poleCandles[0].open;
  if (poleMove < 0.015) return null;
  const flagCandles = last15.slice(5);
  if (flagCandles.length < 5) return null;
  const flagHigh = Math.max(...flagCandles.map(c => c.high));
  const flagLow = Math.min(...flagCandles.map(c => c.low));
  const poleHigh = Math.max(...poleCandles.map(c => c.high));
  const poleLow = poleCandles[0].open;
  const retracement = (flagHigh - flagLow) / (poleHigh - poleLow);
  if (retracement < 0.5 && flagCandles[flagCandles.length - 1].close > flagLow) {
    return { name: 'Бычий флаг', direction: 'bullish', reliability: 0.65, avgMoveATR: 1.5, strength: Math.min(poleMove / 0.04, 1), startIndex: n - 15, endIndex: n - 1, zoneHigh: poleHigh, zoneLow: poleLow };
  }
  return null;
}

function detectBearFlag(candles: CandleData[]): DetectedPattern | null {
  if (candles.length < 15) return null;
  const n = candles.length;
  const last15 = candles.slice(-15);
  const poleCandles = last15.slice(0, 5);
  const poleMove = (poleCandles[0].open - poleCandles[poleCandles.length - 1].close) / poleCandles[0].open;
  if (poleMove < 0.015) return null;
  const flagCandles = last15.slice(5);
  if (flagCandles.length < 5) return null;
  const flagHigh = Math.max(...flagCandles.map(c => c.high));
  const flagLow = Math.min(...flagCandles.map(c => c.low));
  const poleHigh = poleCandles[0].open;
  const poleLow = Math.min(...poleCandles.map(c => c.low));
  const retracement = (flagHigh - flagLow) / (poleHigh - poleLow);
  if (retracement < 0.5 && flagCandles[flagCandles.length - 1].close < flagHigh) {
    return { name: 'Медвежий флаг', direction: 'bearish', reliability: 0.64, avgMoveATR: 1.5, strength: Math.min(poleMove / 0.04, 1), startIndex: n - 15, endIndex: n - 1, zoneHigh: poleHigh, zoneLow: poleLow };
  }
  return null;
}

function detectAscendingWedge(candles: CandleData[]): DetectedPattern | null {
  if (candles.length < 20) return null;
  const n = candles.length;
  const last20 = candles.slice(-20);
  const highs = last20.map(c => c.high);
  const lows = last20.map(c => c.low);
  const nn = highs.length;
  const xMean = (nn - 1) / 2;
  let sumXYH = 0, sumX2 = 0, sumYH = 0, sumYL = 0, sumXYL = 0;
  for (let i = 0; i < nn; i++) {
    sumXYH += i * highs[i]; sumX2 += i * i; sumYH += highs[i];
    sumXYL += i * lows[i]; sumYL += lows[i];
  }
  const slopeH = (nn * sumXYH - (nn * (nn - 1) / 2) * sumYH) / (nn * sumX2 - (nn * (nn - 1) / 2) ** 2);
  const slopeL = (nn * sumXYL - (nn * (nn - 1) / 2) * sumYL) / (nn * sumX2 - (nn * (nn - 1) / 2) ** 2);
  if (slopeH > 0 && slopeL > 0 && slopeH > slopeL * 1.1) {
    const convergence = (slopeH - slopeL) / slopeH;
    if (convergence > 0.05) {
      return { name: 'Восходящий клин', direction: 'bearish', reliability: 0.71, avgMoveATR: 1.8, strength: Math.min(convergence / 0.3, 1), startIndex: n - 20, endIndex: n - 1, zoneHigh: Math.max(...highs), zoneLow: Math.min(...lows) };
    }
  }
  return null;
}

function detectDescendingWedge(candles: CandleData[]): DetectedPattern | null {
  if (candles.length < 20) return null;
  const n = candles.length;
  const last20 = candles.slice(-20);
  const highs = last20.map(c => c.high);
  const lows = last20.map(c => c.low);
  const nn = highs.length;
  let sumXYH = 0, sumX2 = 0, sumYH = 0, sumYL = 0, sumXYL = 0;
  for (let i = 0; i < nn; i++) {
    sumXYH += i * highs[i]; sumX2 += i * i; sumYH += highs[i];
    sumXYL += i * lows[i]; sumYL += lows[i];
  }
  const slopeH = (nn * sumXYH - (nn * (nn - 1) / 2) * sumYH) / (nn * sumX2 - (nn * (nn - 1) / 2) ** 2);
  const slopeL = (nn * sumXYL - (nn * (nn - 1) / 2) * sumYL) / (nn * sumX2 - (nn * (nn - 1) / 2) ** 2);
  if (slopeH < 0 && slopeL < 0 && Math.abs(slopeL) > Math.abs(slopeH) * 1.1) {
    const convergence = (Math.abs(slopeL) - Math.abs(slopeH)) / Math.abs(slopeL);
    if (convergence > 0.05) {
      return { name: 'Нисходящий клин', direction: 'bullish', reliability: 0.68, avgMoveATR: 1.8, strength: Math.min(convergence / 0.3, 1), startIndex: n - 20, endIndex: n - 1, zoneHigh: Math.max(...highs), zoneLow: Math.min(...lows) };
    }
  }
  return null;
}

// ── MASTER PATTERN SCANNER ──

function scanPatterns(candles: CandleData[]): DetectedPattern[] {
  if (candles.length < 20) return [];
  const patterns: DetectedPattern[] = [];
  const n = candles.length;

  // Determine recent trend (last 5-10 candles)
  const recent5 = candles.slice(-6, -1);
  const trendDown = recent5.length >= 3 && recent5.every((x, i) => i === 0 || x.close < recent5[i - 1].close);
  const trendUp = recent5.length >= 3 && recent5.every((x, i) => i === 0 || x.close > recent5[i - 1].close);
  const prevTrend = trendDown ? 'down' : trendUp ? 'up' : 'flat';

  // ── Single candle patterns ──
  const add = (p: DetectedPattern | null) => { if (p) patterns.push(p); };
  add(detectHammer(candles, n - 1, prevTrend));
  add(detectShootingStar(candles, n - 1, prevTrend));
  add(detectDoji(candles, n - 1));
  add(detectDragonflyDoji(candles, n - 1));
  add(detectGravestoneDoji(candles, n - 1));
  add(detectMarubozu(candles, n - 1));

  // ── Two-candle patterns ──
  add(detectBullishEngulfing(candles, n - 1));
  add(detectBearishEngulfing(candles, n - 1));
  add(detectPiercingLine(candles, n - 1));
  add(detectDarkCloudCover(candles, n - 1));
  add(detectTweezerBottom(candles, n - 1));
  add(detectTweezerTop(candles, n - 1));

  // ── Three-candle patterns ──
  add(detectMorningStar(candles, n - 1));
  add(detectEveningStar(candles, n - 1));
  add(detectThreeWhiteSoldiers(candles, n - 1));
  add(detectThreeBlackCrows(candles, n - 1));

  // ── Multi-candle structural patterns ──
  add(detectDoubleBottom(candles));
  add(detectDoubleTop(candles));
  add(detectBullFlag(candles));
  add(detectBearFlag(candles));
  add(detectAscendingWedge(candles));
  add(detectDescendingWedge(candles));

  return patterns;
}

// ============================================================
// Strategy 2: Pattern Pro — Candlestick Pattern Recognition
// Scans all candlestick patterns, scores by reliability + confluence
// Source: Bulkowski's Encyclopedia, Nison's Japanese Candlestick Charting
// SL: 1.5×ATR, TP: based on pattern's avg move, with partial closes
// ============================================================

function makePatternProDecision(
  symbol: string,
  candles: CandleData[],
  strategy: StrategyConfig,
  _idleMinutes: number = 0,
  _weights: Record<string, number> = {},
): TradingDecision {
  if (candles.length < 50) return noDecision(symbol, candles);

  const closes = candles.map(c => c.close);
  const price = closes[closes.length - 1];
  const atr = calcATR(candles, 14);
  const patterns = scanPatterns(candles);

  // ── EMA20 TREND FILTER ──
  // Don't buy in a downtrend, don't sell in an uptrend
  const ema20 = calcLocalEMA(closes, 20);
  if (ema20 === null || !isFinite(ema20)) return noDecision(symbol, candles);
  const trendUp = price > ema20;
  const trendDown = price < ema20;

  if (patterns.length === 0) {
    return { symbol, direction: 'none', score: 0, leverage: 1, stopLoss: 0, takeProfit: 0, indicators: [], pattern: null };
  }

  // Filter patterns by trend: only keep bullish in uptrend, bearish in downtrend
  const trendFiltered = patterns.filter(p => {
    if (p.direction === 'neutral') return false;
    if (p.direction === 'bullish') return trendUp;
    if (p.direction === 'bearish') return trendDown;
    return false;
  });

  if (trendFiltered.length === 0) {
    return { symbol, direction: 'none', score: 0, leverage: 1, stopLoss: 0, takeProfit: 0, indicators: [], pattern: null };
  }

  // Convert patterns to indicators for logging/display
  const indicators: IndicatorSignal[] = trendFiltered.map(p => ({
    name: p.name,
    signal: p.direction === 'bullish' ? 1 : p.direction === 'bearish' ? -1 : 0,
    strength: p.strength,
  }));

  // Score bullish and bearish separately
  // Weight = reliability × strength × (1 + avgMoveATR/2)
  let bullScore = 0, bearScore = 0;
  let bullCount = 0, bearCount = 0;
  let bestBullMove = 0, bestBearMove = 0;
  let bestBullPattern: DetectedPattern | null = null;
  let bestBearPattern: DetectedPattern | null = null;

  for (const p of trendFiltered) {
    if (p.direction === 'neutral') continue;
    const weight = p.reliability * p.strength * (1 + p.avgMoveATR / 2);
    if (p.direction === 'bullish') {
      bullScore += weight;
      bullCount++;
      bestBullMove = Math.max(bestBullMove, p.avgMoveATR);
      if (!bestBullPattern || weight > bestBullPattern.reliability * bestBullPattern.strength * (1 + bestBullPattern.avgMoveATR / 2)) {
        bestBullPattern = p;
      }
    } else {
      bearScore += weight;
      bearCount++;
      bestBearMove = Math.max(bestBearMove, p.avgMoveATR);
      if (!bestBearPattern || weight > bestBearPattern.reliability * bestBearPattern.strength * (1 + bestBearPattern.avgMoveATR / 2)) {
        bestBearPattern = p;
      }
    }
  }

  // Need at least 1 strong pattern (reliability > 0.60)
  const hasStrongBull = trendFiltered.some(p => p.direction === 'bullish' && p.reliability > 0.60);
  const hasStrongBear = trendFiltered.some(p => p.direction === 'bearish' && p.reliability > 0.60);

  if ((!hasStrongBull || bullCount < 1) && (!hasStrongBear || bearCount < 1)) {
    return { symbol, direction: 'none', score: Math.max(bullScore, bearScore), leverage: 1, stopLoss: 0, takeProfit: 0, indicators, pattern: null };
  }

  // RSI filter: don't buy overbought, don't sell oversold (unless pattern is very strong)
  const rsi = calcRSI(closes, 14);
  if (bullScore > 0 && rsi > 75 && !trendFiltered.some(p => p.direction === 'bullish' && p.reliability > 0.75)) {
    return { symbol, direction: 'none', score: bullScore, leverage: 1, stopLoss: 0, takeProfit: 0, indicators, pattern: null };
  }
  if (bearScore > 0 && rsi < 25 && !trendFiltered.some(p => p.direction === 'bearish' && p.reliability > 0.75)) {
    return { symbol, direction: 'none', score: bearScore, leverage: 1, stopLoss: 0, takeProfit: 0, indicators, pattern: null };
  }

  let direction: 'long' | 'short' | 'none' = 'none';
  let score = 0;
  let expectedMoveATR = 0;

  if (bullScore >= strategy.scoreThreshold && bullScore >= bearScore) {
    direction = 'long';
    score = bullScore;
    expectedMoveATR = bestBullMove;
  } else if (bearScore >= strategy.scoreThreshold && bearScore > bullScore) {
    direction = 'short';
    score = bearScore;
    expectedMoveATR = bestBearMove;
  }

  if (direction === 'none') {
    return { symbol, direction: 'none', score: Math.max(bullScore, bearScore), leverage: 1, stopLoss: 0, takeProfit: 0, indicators };
  }

  // SL: 2.5× ATR (wider to avoid noise stop-outs)
  const slDist = 2.5 * atr;
  const stopLoss = direction === 'long' ? price - slDist : price + slDist;

  // TP: based on pattern's expected move (min 1.5× SL = 1:1.5, max 3× SL = 1:3)
  const tpMult = Math.max(1.5, Math.min(expectedMoveATR, 3));
  const takeProfit = direction === 'long' ? price + slDist * tpMult : price - slDist * tpMult;

  const leverage = Math.min(strategy.maxLeverage, Math.max(1, Math.round(score * 2)));

  // Build pattern info for the best matching pattern
  const bestPattern = direction === 'long' ? bestBullPattern : bestBearPattern;
  const pattern = bestPattern ? toPatternInfo(bestPattern, candles) : null;

  return { symbol, direction, score, leverage, stopLoss, takeProfit, indicators, pattern };
}

/** Convert internal DetectedPattern to serializable PatternInfo */
function toPatternInfo(p: DetectedPattern, candles: CandleData[]) {
  return {
    name: p.name,
    direction: p.direction,
    reliability: p.reliability,
    strength: p.strength,
    zone_high: p.zoneHigh,
    zone_low: p.zoneLow,
    start_time: candles[p.startIndex]?.time ?? 0,
    end_time: candles[p.endIndex]?.time ?? 0,
  };
}

// ============================================================
// Strategy 3: Position Alpha
// Long-term position trading: rare entries on strong reversals
// Uses EMA50/200 crossover, MACD, ADX>30, OBV long-term, price vs EMA200, RSI
// Entry: EMA50/200 crossover PLUS ≥3 of 5 more indicators, score ≥ 0.40
// SL: 4× ATR (wide), TP: 1:5 R:R
// ============================================================

function makePositionAlphaDecision(
  symbol: string,
  candles: CandleData[],
  strategy: StrategyConfig,
  _idleMinutes: number = 0,
  weights: Record<string, number> = {},
): TradingDecision {
  if (candles.length < 250) return noDecision(symbol, candles);

  const closes = candles.map(c => c.close);
  const price = closes[closes.length - 1];
  const atr = calcATR(candles, 14);
  const indicators: IndicatorSignal[] = [];

  // ── Compute EMAs ──
  const ema50Arr = ema(closes, 50);
  const ema200Arr = ema(closes, 200);
  const ema50 = ema50Arr[ema50Arr.length - 1];
  const ema200 = ema200Arr[ema200Arr.length - 1];

  if (isNaN(ema50) || isNaN(ema200)) {
    return noDecision(symbol, candles);
  }

  // ── GATE CHECK: EMA50/200 crossover — the GOLDEN signal ──
  // Check if crossover happened in the last 5 candles
  let crossoverSignal: 'long' | 'short' | 'none' = 'none';
  let crossoverStrength = 0;
  const ema50Prev = ema50Arr.length >= 2 ? ema50Arr[ema50Arr.length - 2] : ema50;
  const ema200Prev = ema200Arr.length >= 2 ? ema200Arr[ema200Arr.length - 2] : ema200;

  if (ema50 > ema200 && ema50Prev <= ema200Prev) {
    // Golden cross just happened — very strong long signal
    crossoverSignal = 'long';
    crossoverStrength = 1.0;
  } else if (ema50 < ema200 && ema50Prev >= ema200Prev) {
    // Death cross just happened — very strong short signal
    crossoverSignal = 'short';
    crossoverStrength = 1.0;
  } else if (ema50 > ema200) {
    // Still bullish (crossed earlier) — reduced strength
    crossoverSignal = 'long';
    crossoverStrength = 0.3;
  } else if (ema50 < ema200) {
    // Still bearish — reduced strength
    crossoverSignal = 'short';
    crossoverStrength = 0.3;
  }

  // No trade if no crossover signal at all
  if (crossoverSignal === 'none') {
    return noDecision(symbol, candles);
  }

  indicators.push({
    name: 'EMA_Cross',
    signal: crossoverSignal === 'long' ? 1 : -1,
    strength: crossoverStrength,
  });

  // ── ADX filter: require > 30 (very strong trend) ──
  const adxResult = calcADX(candles);
  const adxPass = adxResult.adx >= 30;
  const adxStrength = adxPass ? Math.min((adxResult.adx - 30) / 20, 1) : 0;
  indicators.push({
    name: 'ADX',
    signal: adxPass
      ? (adxResult.plusDI > adxResult.minusDI ? 1 : -1)
      : 0,
    strength: adxStrength,
  });

  // ── MACD(12,26,9) — cross in direction of EMA trend ──
  const macd = calcMACD(closes);
  const macdTrend = crossoverSignal === 'long'
    ? (macd.macdLine > macd.signalLine ? 1 : 0)
    : crossoverSignal === 'short'
      ? (macd.macdLine < macd.signalLine ? -1 : 0)
      : 0;
  const macdStrength = macdTrend !== 0
    ? Math.min(Math.abs(macd.histogram) / (Math.abs(macd.signalLine) || 1), 1)
    : 0;
  indicators.push({
    name: 'MACD',
    signal: macdTrend,
    strength: macdStrength,
  });

  // ── OBV long-term trend — compare 50 candles vs 50 before ──
  let obvTrendLong = false;
  let obvTrendShort = false;
  let obvStrength = 0;
  if (candles.length >= 100) {
    // Build OBV history
    let obv = 0;
    const obvHistory: number[] = [];
    for (let i = 1; i < candles.length; i++) {
      if (candles[i].close > candles[i - 1].close) obv += candles[i].volume;
      else if (candles[i].close < candles[i - 1].close) obv -= candles[i].volume;
      obvHistory.push(obv);
    }
    if (obvHistory.length >= 100) {
      const recent50 = obvHistory.slice(-50).reduce((a, b) => a + b, 0) / 50;
      const prev50 = obvHistory.slice(-100, -50).reduce((a, b) => a + b, 0) / 50;
      if (prev50 !== 0) {
        const obvChange = (recent50 - prev50) / Math.abs(prev50);
        obvTrendLong = obvChange > 0.1;
        obvTrendShort = obvChange < -0.1;
        obvStrength = Math.min(Math.abs(obvChange) * 3, 1);
      }
    }
  }
  indicators.push({
    name: 'OBV',
    signal: obvTrendLong ? 1 : obvTrendShort ? -1 : 0,
    strength: obvStrength,
  });

  // ── Price vs EMA200 — must be on right side ──
  const priceAboveEma200 = price > ema200;
  const priceBelowEma200 = price < ema200;
  const ema200Dist = Math.abs(price - ema200) / ema200;
  const ema200Strength = Math.min(ema200Dist * 50, 1);
  indicators.push({
    name: 'EMA_200',
    signal: priceAboveEma200 ? 1 : priceBelowEma200 ? -1 : 0,
    strength: ema200Strength,
  });

  // ── RSI(14): 45-70 for longs, 30-55 for shorts ──
  const rsi = calcRSI(closes, 14);
  const rsiLong = rsi >= 45 && rsi <= 70;    // healthy uptrend confirmation
  const rsiShort = rsi >= 30 && rsi <= 55;    // healthy downtrend confirmation
  const rsiStrength = rsiLong
    ? (rsi >= 50 ? 0.5 : (50 - rsi) / 5)   // stronger when closer to 45 (not overbought)
    : rsiShort
      ? (rsi <= 40 ? 0.5 : (rsi - 40) / 15)
      : 0;
  indicators.push({
    name: 'RSI',
    signal: rsiLong ? 1 : rsiShort ? -1 : 0,
    strength: rsiStrength,
  });

  // ── Score calculation ──
  const trendDir = crossoverSignal === 'long' ? 1 : -1;
  let agreeCount = 0;
  let score = 0;

  // EMA crossover always counts (it's the gate)
  score += crossoverStrength;

  // Count how many other indicators agree with the trend direction
  for (let i = 1; i < indicators.length; i++) {
    if (indicators[i].signal === trendDir) {
      agreeCount++;
      const w = weights[indicators[i].name] ?? 1;
      score += indicators[i].strength * w;
    }
  }

  // Require EMA crossover PLUS ≥3 more of 5 indicators
  if (agreeCount < 3) {
    return { symbol, direction: 'none', score, leverage: 1, stopLoss: 0, takeProfit: 0, indicators };
  }

  // Score threshold
  if (score < strategy.scoreThreshold) {
    return { symbol, direction: 'none', score, leverage: 1, stopLoss: 0, takeProfit: 0, indicators };
  }

  const direction: 'long' | 'short' = trendDir === 1 ? 'long' : 'short';

  // ── SPIKE GUARD: Anti-chase filter ──
  // Block entry if market just had a sharp move (4h/1d spikes are rare but devastating).
  // Position Alpha uses EMA50 as the reference MA (longer-term than Momentum's EMA20).
  {
    const ema50Val = ema50Arr[ema50Arr.length - 1] || price;
    const guard = spikeGuard(candles, closes, atr, rsi, direction, ema50Val);
    if (guard.blocked) {
      console.log(`[PositionAlpha] ${symbol} ${direction.toUpperCase()} blocked: ${guard.reason}`);
      return { symbol, direction: 'none', score, leverage: 1, stopLoss: 0, takeProfit: 0, indicators };
    }
  }

  const leverage = Math.min(strategy.maxLeverage, Math.max(1, Math.round(score * 1.2)));

  // Wide stop: 4× ATR — give position room to breathe for days
  // Floored at 1.5% (prevents noise stop-outs), capped at 5% max, TP at 15% max from entry
  const stopLossPercent = Math.max(0.015, Math.min(4 * atr / price, 0.05));
  const takeProfitPercent = Math.min(stopLossPercent * strategy.riskRewardRatio, 0.15);

  const stopLoss = direction === 'long'
    ? price * (1 - stopLossPercent)
    : price * (1 + stopLossPercent);
  const takeProfit = direction === 'long'
    ? price * (1 + takeProfitPercent)
    : price * (1 - takeProfitPercent);

  return { symbol, direction, score, leverage, stopLoss, takeProfit, indicators };
}

// ============================================================
// Order Book Analysis
// ============================================================

export function analyzeOrderBook(
  bids: Array<{ price: number; quantity: number; total: number }>,
  asks: Array<{ price: number; quantity: number; total: number }>,
  midPrice: number
): IndicatorSignal {
  // Calculate bid/ask volume imbalance
  const totalBidVol = bids.reduce((sum, b) => sum + b.quantity, 0);
  const totalAskVol = asks.reduce((sum, a) => sum + a.quantity, 0);
  const totalVol = totalBidVol + totalAskVol;

  let imbalance = 0;
  if (totalVol > 0) {
    imbalance = (totalBidVol - totalAskVol) / totalVol;
  }

  // Detect walls — large orders (>3x average) near price
  let bidWallPressure = 0;
  let askWallPressure = 0;

  if (bids.length > 1) {
    const avgBidQty = totalBidVol / bids.length;
    const largeBids = bids.filter(b => b.quantity > avgBidQty * 3);
    bidWallPressure = largeBids.reduce((sum, b) => {
      const distance = (midPrice - b.price) / midPrice;
      return sum + (b.quantity * Math.exp(-distance * 100)); // closer walls matter more
    }, 0);
  }

  if (asks.length > 1) {
    const avgAskQty = totalAskVol / asks.length;
    const largeAsks = asks.filter(a => a.quantity > avgAskQty * 3);
    askWallPressure = largeAsks.reduce((sum, a) => {
      const distance = (a.price - midPrice) / midPrice;
      return sum + (a.quantity * Math.exp(-distance * 100));
    }, 0);
  }

  // Combine signals
  const wallImbalance = bidWallPressure > 0 || askWallPressure > 0
    ? (bidWallPressure - askWallPressure) / (bidWallPressure + askWallPressure)
    : 0;

  const combinedSignal = imbalance * 0.6 + wallImbalance * 0.4;

  let signal: number;
  let strength: number;

  if (combinedSignal > 0.15) {
    signal = 1;
    strength = Math.min(combinedSignal / 0.5, 1);
  } else if (combinedSignal < -0.15) {
    signal = -1;
    strength = Math.min(Math.abs(combinedSignal) / 0.5, 1);
  } else {
    signal = 0;
    strength = 0;
  }

  return {
    name: 'OrderBook',
    signal,
    strength,
  };
}

// Fetch Klines from Binance (30s cache + in-flight dedup)
const klinesCache = new Map<string, { data: CandleData[]; ts: number }>();
const klinesInFlight = new Map<string, Promise<CandleData[]>>();
const KLINES_TTL_MS = 30_000;

function klinesKey(symbol: string, interval: string, limit: number) {
  return `${symbol}:${interval}:${limit}`;
}

export async function fetchKlines(symbol: string, interval: string = '1h', limit: number = 1440): Promise<CandleData[]> {
  const key = klinesKey(symbol, interval, limit);
  const cached = klinesCache.get(key);
  if (cached && Date.now() - cached.ts < KLINES_TTL_MS) {
    return cached.data;
  }
  const pending = klinesInFlight.get(key);
  if (pending) return pending;
  const fetchPromise = (async () => {
    try {
      const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Failed to fetch klines for ${symbol}: ${res.statusText}`);
      const data = await res.json();
      const klines: CandleData[] = data.map((k: (string | number)[]) => ({
        time: Math.floor(Number(k[0]) / 1000),
        open: parseFloat(String(k[1])),
        high: parseFloat(String(k[2])),
        low: parseFloat(String(k[3])),
        close: parseFloat(String(k[4])),
        volume: parseFloat(String(k[5])),
      }));
      klinesCache.set(key, { data: klines, ts: Date.now() });
      return klines;
    } finally {
      klinesInFlight.delete(key);
    }
  })();
  klinesInFlight.set(key, fetchPromise);
  return fetchPromise;
}

// ============================================================
// Fetch Top Symbols from Binance
// ============================================================

export async function fetchTopSymbols(): Promise<string[]> {
  const url = 'https://api.binance.com/api/v3/ticker/24hr';
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json();
  // Filter USDT pairs, sort by quote volume, take top 50
  const usdtPairs = data
    .filter((t: { symbol: string; quoteVolume: string }) => t.symbol.endsWith('USDT') && Number(t.quoteVolume) > 0)
    .sort((a: { quoteVolume: string }, b: { quoteVolume: string }) => Number(b.quoteVolume) - Number(a.quoteVolume))
    .slice(0, 50)
    .map((t: { symbol: string }) => t.symbol);
  return usdtPairs;
}