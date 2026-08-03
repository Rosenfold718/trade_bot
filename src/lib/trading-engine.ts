import type { CandleData, IndicatorSignal, TradingDecision } from './types';
import { getStrategy, type StrategyConfig } from './strategies';

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

export function calcATR(candles: CandleData[], period: number = 14): number {
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

  // ADX
  const adxResult = calcADX(candles);
  if (adxResult.adx > 25) {
    // Strong trend — follow +DI vs -DI
    const adxStrength = Math.min((adxResult.adx - 25) / 25, 1);
    if (adxResult.plusDI > adxResult.minusDI) {
      signals.push({ name: 'ADX', signal: 1, strength: adxStrength });
    } else {
      signals.push({ name: 'ADX', signal: -1, strength: adxStrength });
    }
  } else if (adxResult.adx < 20) {
    // Weak/ranging — avoid, slight neutral
    signals.push({ name: 'ADX', signal: 0, strength: 0.1 });
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
  // POINT 3: Confluence filter — require ≥4 indicators to agree
  // ============================================================
  const bestCount = Math.max(longCount, shortCount);
  if (bestCount < 4) {
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

function noDecision(symbol: string, candles: CandleData[]): TradingDecision {
  return {
    symbol,
    direction: 'none',
    score: 0,
    leverage: 1,
    stopLoss: 0,
    takeProfit: 0,
    indicators: [],
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

  // Confluence: require ≥4 of 10 indicators to agree
  const bestCount = Math.max(longCount, shortCount);
  if (bestCount < 4) {
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

  // Leverage: scale with signal strength
  const leverage = direction === 'none'
    ? 1
    : Math.min(strategy.maxLeverage, Math.max(1, Math.round(maxScore * 2)));

  // Wide stop loss: 3.0× ATR, floored at 0.8%, capped at 5% max from entry
  // (floor prevents noise stop-outs on low-ATR assets; cap limits risk)
  const stopLossPercent = Math.max(0.008, Math.min(3.0 * atr / price, 0.05));
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
// Strategy 2: Pattern Pro
// Candlestick pattern recognition on 15m timeframe
// Detects: Morning/Evening Star, Bull/Bear Flags, Wedges,
// Double Bottom, Twins (bottom pattern)
// SL: 2.5× ATR, TP: 1:2.5 R:R, strength > 0.15
// ============================================================

const TIER1_NAMES = [
  'Утренняя звезда',
  'Вечерняя звезда',
  'Бычий флаг',
  'Медвежий флаг',
  'Близнецы (дно)',
  'Нисходящий клин',
  'Двойное дно',
];

function detectCandlePatterns(candles: CandleData[]): { name: string; direction: 'long' | 'short'; strength: number }[] {
  const patterns: { name: string; direction: 'long' | 'short'; strength: number }[] = [];
  if (candles.length < 10) return patterns;

  const c = candles;
  const len = c.length;
  const last = c[len - 1];
  const prev = c[len - 2];
  const prev2 = c[len - 3];
  const prev3 = len >= 4 ? c[len - 4] : null;

  // ── Morning Star (Утренняя звезда) ──
  // 3-candle bullish reversal: big red, small body (star), big green
  if (prev3 && prev2) {
    const body1 = Math.abs(prev3.close - prev3.open);
    const body2 = Math.abs(prev2.close - prev2.open);
    const body3 = Math.abs(last.close - last.open);
    const range1 = prev3.high - prev3.low;
    const range2 = prev2.high - prev2.low;
    const isBearish1 = prev3.close < prev3.open;
    const isBullish3 = last.close > last.open;
    const starSmall = range1 > 0 ? body2 / range1 < 0.3 : false;
    const body3Big = range1 > 0 ? body3 / range1 > 0.5 : false;
    if (isBearish1 && starSmall && isBullish3 && body3Big && last.close > (prev3.open + prev3.close) / 2) {
      const strength = Math.min(0.4 + body3 / (range1 || 1) * 0.6, 1);
      patterns.push({ name: 'Утренняя звезда', direction: 'long', strength });
    }
  }

  // ── Evening Star (Вечерняя звезда) ──
  if (prev3 && prev2) {
    const body1 = Math.abs(prev3.close - prev3.open);
    const body2 = Math.abs(prev2.close - prev2.open);
    const body3 = Math.abs(last.close - last.open);
    const range1 = prev3.high - prev3.low;
    const isBullish1 = prev3.close > prev3.open;
    const isBearish3 = last.close < last.open;
    const starSmall = range1 > 0 ? body2 / range1 < 0.3 : false;
    const body3Big = range1 > 0 ? body3 / range1 > 0.5 : false;
    if (isBullish1 && starSmall && isBearish3 && body3Big && last.close < (prev3.open + prev3.close) / 2) {
      const strength = Math.min(0.4 + body3 / (range1 || 1) * 0.6, 1);
      patterns.push({ name: 'Вечерняя звезда', direction: 'short', strength });
    }
  }

  // ── Bull Flag (Бычий флаг) ──
  // Strong upward move (pole) then 3-5 candles consolidating slightly down
  if (len >= 8) {
    const poleEnd = c[len - 6];
    const poleStart = c[len - 10] ?? c[0];
    const poleMove = (poleEnd.close - poleStart.close) / poleStart.close;
    if (poleMove > 0.02) {
      // Flag: last 5 candles consolidating (small range, slightly down)
      const flagCandles = c.slice(-5);
      const flagHigh = Math.max(...flagCandles.map(x => x.high));
      const flagLow = Math.min(...flagCandles.map(x => x.low));
      const flagRange = (flagHigh - flagLow) / flagLow;
      const flagDrift = (flagCandles[flagCandles.length - 1].close - flagCandles[0].open) / flagCandles[0].open;
      if (flagRange < 0.015 && flagDrift > -0.01) {
        const strength = Math.min(poleMove * 20, 1) * Math.min((0.015 - flagRange) / 0.01, 1);
        patterns.push({ name: 'Бычий флаг', direction: 'long', strength: Math.max(0.2, Math.min(strength, 1)) });
      }
    }
  }

  // ── Bear Flag (Медвежий флаг) ──
  if (len >= 8) {
    const poleEnd = c[len - 6];
    const poleStart = c[len - 10] ?? c[0];
    const poleMove = (poleStart.close - poleEnd.close) / poleStart.close;
    if (poleMove > 0.02) {
      const flagCandles = c.slice(-5);
      const flagHigh = Math.max(...flagCandles.map(x => x.high));
      const flagLow = Math.min(...flagCandles.map(x => x.low));
      const flagRange = (flagHigh - flagLow) / flagLow;
      const flagDrift = (flagCandles[0].open - flagCandles[flagCandles.length - 1].close) / flagCandles[0].open;
      if (flagRange < 0.015 && flagDrift > -0.01) {
        const strength = Math.min(poleMove * 20, 1) * Math.min((0.015 - flagRange) / 0.01, 1);
        patterns.push({ name: 'Медвежий флаг', direction: 'short', strength: Math.max(0.2, Math.min(strength, 1)) });
      }
    }
  }

  // ── Descending Wedge (Нисходящий клин) — bullish reversal ──
  if (len >= 10) {
    const recent = c.slice(-10);
    const highs = recent.map(x => x.high);
    const lows = recent.map(x => x.low);
    const highSlope = (highs[highs.length - 1] - highs[0]) / highs[0];
    const lowSlope = (lows[lows.length - 1] - lows[0]) / lows[0];
    // Both highs and lows declining, but lows decline faster (converging)
    if (highSlope < -0.005 && lowSlope < highSlope * 1.5 && last.close > prev.close) {
      const convergence = Math.abs(lowSlope - highSlope);
      const strength = Math.min(convergence * 100, 1);
      patterns.push({ name: 'Нисходящий клин', direction: 'long', strength: Math.max(0.2, strength) });
    }
  }

  // ── Double Bottom (Двойное дно) ──
  if (len >= 15) {
    const recent = c.slice(-15);
    const lows: { price: number; idx: number }[] = [];
    for (let i = 1; i < recent.length - 1; i++) {
      if (recent[i].low < recent[i - 1].low && recent[i].low < recent[i + 1].low) {
        lows.push({ price: recent[i].low, idx: i });
      }
    }
    if (lows.length >= 2) {
      const lastTwo = lows.slice(-2);
      const priceDiff = Math.abs(lastTwo[0].price - lastTwo[1].price) / lastTwo[0].price;
      if (priceDiff < 0.01 && last.close > recent[recent.length - 2].close) {
        const strength = Math.min((0.01 - priceDiff) / 0.005, 1) * 0.8;
        patterns.push({ name: 'Двойное дно', direction: 'long', strength: Math.max(0.3, strength) });
      }
    }
  }

  // ── Twins Bottom (Близнецы (дно)) — two consecutive doji/small candles at bottom ──
  if (prev3 && prev2) {
    const body2 = Math.abs(prev.close - prev.open);
    const body3 = Math.abs(prev2.close - prev2.open);
    const range2 = prev.high - prev.low;
    const range3 = prev2.high - prev2.low;
    const isSmall2 = range2 > 0 ? body2 / range2 < 0.2 : false;
    const isSmall3 = range3 > 0 ? body3 / range3 < 0.2 : false;
    const lowsNear = range2 > 0 ? Math.abs(prev.low - prev2.low) / range2 < 0.3 : false;
    const bullishClose = last.close > prev.close && last.close > prev2.close;
    if (isSmall2 && isSmall3 && lowsNear && bullishClose) {
      patterns.push({ name: 'Близнецы (дно)', direction: 'long', strength: 0.5 });
    }
  }

  return patterns;
}

function makePatternProDecision(
  symbol: string,
  candles: CandleData[],
  strategy: StrategyConfig,
  _idleMinutes: number = 0,
  weights: Record<string, number> = {},
): TradingDecision {
  if (candles.length < 25) return noDecision(symbol, candles);

  const closes = candles.map(c => c.close);
  const price = closes[closes.length - 1];
  const atr = calcATR(candles, 14);
  const indicators: IndicatorSignal[] = [];

  // ── Pattern Detection ──
  const patterns = detectCandlePatterns(candles);
  const tier1Patterns = patterns.filter(p => TIER1_NAMES.includes(p.name) && p.strength > 0.15);

  if (tier1Patterns.length === 0) {
    return { symbol, direction: 'none', score: 0, leverage: 1, stopLoss: 0, takeProfit: 0, indicators };
  }

  // Score based on pattern strength and count
  let longScore = 0;
  let shortScore = 0;
  for (const p of tier1Patterns) {
    if (p.direction === 'long') longScore += p.strength;
    else shortScore += p.strength;
    indicators.push({ name: p.name, signal: p.direction === 'long' ? 1 : -1, strength: p.strength });
  }

  // ── Supplementary: RSI context ──
  const rsi = calcRSI(closes, 14);
  const rsiBoost = rsi < 35 ? 0.15 : rsi > 65 ? -0.15 : 0;
  indicators.push({ name: 'RSI', signal: rsiBoost > 0 ? 1 : rsiBoost < 0 ? -1 : 0, strength: Math.abs(rsiBoost) });
  if (rsiBoost > 0) longScore += rsiBoost;
  else if (rsiBoost < 0) shortScore += Math.abs(rsiBoost);

  // ── Supplementary: Volume confirmation ──
  if (candles.length >= 20) {
    const recent5Vol = candles.slice(-5).reduce((s, c) => s + c.volume, 0) / 5;
    const last20Vol = candles.slice(-20).reduce((s, c) => s + c.volume, 0) / 20;
    const volRatio = last20Vol > 0 ? recent5Vol / last20Vol : 0;
    if (volRatio > 1.2) {
      indicators.push({ name: 'Volume', signal: 1, strength: Math.min((volRatio - 1.2) / 2, 0.5) });
    }
  }

  let direction: 'long' | 'short' | 'none' = 'none';
  let score = 0;

  if (longScore >= strategy.scoreThreshold && longScore >= shortScore) {
    direction = 'long';
    score = longScore;
  } else if (shortScore >= strategy.scoreThreshold && shortScore > longScore) {
    direction = 'short';
    score = shortScore;
  }

  if (direction === 'none') {
    return { symbol, direction: 'none', score: Math.max(longScore, shortScore), leverage: 1, stopLoss: 0, takeProfit: 0, indicators };
  }

  // ── Spike Guard (15m thresholds) ──
  {
    const ema20Arr = ema(closes, 20);
    const ema20 = ema20Arr[ema20Arr.length - 1] || price;
    const guard = spikeGuard(candles, closes, atr, rsi, direction, ema20, {
      atrRatioMax: 4.0,
      roc3Max: 12,
      rsiOverbought: 85,
      rsiOversold: 15,
      emaDistMax: 6,
      cciMax: 250,
    });
    if (guard.blocked) {
      console.log(`[PatternPro] ${symbol} ${direction.toUpperCase()} blocked: ${guard.reason}`);
      return { symbol, direction: 'none', score: Math.max(longScore, shortScore), leverage: 1, stopLoss: 0, takeProfit: 0, indicators };
    }
  }

  const leverage = Math.min(strategy.maxLeverage, Math.max(1, Math.round(score * 2.5)));
  // SL: 2.5× ATR for 15m noise tolerance, floored at 0.5%, capped at 4%
  const stopLossPercent = Math.max(0.005, Math.min(2.5 * atr / price, 0.04));
  const takeProfitPercent = Math.min(stopLossPercent * strategy.riskRewardRatio, 0.10);

  const stopLoss = direction === 'long'
    ? price * (1 - stopLossPercent)
    : price * (1 + stopLossPercent);
  const takeProfit = direction === 'long'
    ? price * (1 + takeProfitPercent)
    : price * (1 - takeProfitPercent);

  return { symbol, direction, score, leverage, stopLoss, takeProfit, indicators };
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

// ============================================================
// Fetch Klines from Binance
// ============================================================

export async function fetchKlines(symbol: string, interval: string = '1h', limit: number = 1440): Promise<CandleData[]> {
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch klines for ${symbol}: ${res.statusText}`);
  const data = await res.json();
  return data.map((k: (string | number)[]) => ({
    time: Math.floor(Number(k[0]) / 1000),
    open: parseFloat(String(k[1])),
    high: parseFloat(String(k[2])),
    low: parseFloat(String(k[3])),
    close: parseFloat(String(k[4])),
    volume: parseFloat(String(k[5])),
  }));
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