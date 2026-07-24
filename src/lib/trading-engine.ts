import type { CandleData, IndicatorSignal, TradingDecision, BacktestTrade, BacktestSummary } from './types';
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
  let gains = 0;
  let losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) gains += change;
    else losses += Math.abs(change);
  }
  if (losses === 0) return 100;
  const rs = (gains / period) / (losses / period);
  return 100 - (100 / (1 + rs));
}

function calcMACD(closes: number[]): { macdLine: number; signalLine: number; histogram: number } {
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const macdLineArr = ema12.map((v, i) => (isNaN(v) || isNaN(ema26[i])) ? NaN : v - ema26[i]);
  const validMacd = macdLineArr.filter(v => !isNaN(v));
  if (validMacd.length < 9) return { macdLine: 0, signalLine: 0, histogram: 0 };
  const signalArr = ema(validMacd, 9);
  const macdLine = validMacd[validMacd.length - 1];
  const signalLine = signalArr[signalArr.length - 1];
  return { macdLine, signalLine, histogram: macdLine - signalLine };
}

function calcBollingerBands(closes: number[], period: number = 20, stdDev: number = 2): { upper: number; middle: number; lower: number; position: number } {
  if (closes.length < period) return { upper: 0, middle: 0, lower: 0, position: 0.5 };
  const slice = closes.slice(-period);
  const middle = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((sum, val) => sum + Math.pow(val - middle, 2), 0) / period;
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
  // POINT 3: Confluence filter — require ≥5 indicators to agree
  // ============================================================
  const bestCount = Math.max(longCount, shortCount);
  if (bestCount < 5) {
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

export function makeStrategyDecision(
  strategyId: string,
  symbol: string,
  candles: CandleData[],
  idleMinutes: number = 0,
): TradingDecision {
  const strategy = getStrategy(strategyId);
  if (!strategy) return noDecision(symbol, candles);

  switch (strategyId) {
    case 'scalper':
      return makeScalpHunterDecision(symbol, candles, strategy, idleMinutes);
    case 'position-alpha':
      return makePositionAlphaDecision(symbol, candles, strategy, idleMinutes);
    default:
      return makeMomentumDecision(symbol, candles, strategy, idleMinutes);
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
): TradingDecision {
  const indicators = analyzeIndicators(candles, {});
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
    if (ind.signal > 0) {
      longScore += ind.strength;
      longCount++;
    } else if (ind.signal < 0) {
      shortScore += ind.strength;
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

  // Conservative leverage: 1x for weak signals, max 3x for very strong
  const leverage = direction === 'none'
    ? 1
    : Math.min(strategy.maxLeverage, Math.max(1, Math.round(maxScore * 1.5)));

  // Wide stop loss: 2.5× ATR to give trades room to breathe on 1H timeframe
  const stopLossPercent = 2.5 * atr / price;
  const takeProfitPercent = stopLossPercent * strategy.riskRewardRatio;

  const stopLoss = direction === 'long'
    ? price * (1 - stopLossPercent)
    : price * (1 + stopLossPercent);
  const takeProfit = direction === 'long'
    ? price * (1 + takeProfitPercent)
    : price * (1 - takeProfitPercent);

  return { symbol, direction, score, leverage, stopLoss, takeProfit, indicators };
}

// ============================================================
// Strategy 2: Scalp Hunter
// Fast scalping: many quick trades on micro-movements
// Uses StochRSI(5,5), BB(10,1.5), volume spikes, VWAP, RSI(7), 3-candle momentum
// Entry: ≥3 of 6 indicators agree, score ≥ 0.15
// SL: 0.8× ATR, TP: 1:1.5 R:R
// ============================================================

function makeScalpHunterDecision(
  symbol: string,
  candles: CandleData[],
  strategy: StrategyConfig,
  _idleMinutes: number = 0,
): TradingDecision {
  if (candles.length < 25) return noDecision(symbol, candles);

  const closes = candles.map(c => c.close);
  const price = closes[closes.length - 1];
  const atr = calcATR(candles, 14);
  const indicators: IndicatorSignal[] = [];

  // Indicator 1: StochRSI(5, 5) — very fast
  const stochRSI = calcStochRSI(closes, 5, 5);
  const stochLong = stochRSI < 0.15;
  const stochShort = stochRSI > 0.85;
  const stochStrength = stochLong
    ? (0.15 - stochRSI) / 0.15
    : stochShort
      ? (stochRSI - 0.85) / 0.15
      : 0;
  indicators.push({
    name: 'StochRSI',
    signal: stochLong ? 1 : stochShort ? -1 : 0,
    strength: stochStrength,
  });

  // Indicator 2: Bollinger Bands(10, 1.5) — tighter bands
  const bb = calcBollingerBands(closes, 10, 1.5);
  const bbLong = price <= bb.lower;
  const bbShort = price >= bb.upper;
  const bbStrength = bbLong
    ? Math.min((bb.middle - bb.lower) > 0 ? (bb.middle - price) / (bb.middle - bb.lower) : 0, 1)
    : bbShort
      ? Math.min((bb.upper - bb.middle) > 0 ? (price - bb.middle) / (bb.upper - bb.middle) : 0, 1)
      : 0;
  indicators.push({
    name: 'Bollinger',
    signal: bbLong ? 1 : bbShort ? -1 : 0,
    strength: bbStrength,
  });

  // Indicator 3: Volume spike — last 5 candles avg vs last 20
  let volSpike = false;
  let volStrength = 0;
  if (candles.length >= 20) {
    const recent5Vol = candles.slice(-5).reduce((s, c) => s + c.volume, 0) / 5;
    const last20Vol = candles.slice(-20).reduce((s, c) => s + c.volume, 0) / 20;
    const volRatio = last20Vol > 0 ? recent5Vol / last20Vol : 0;
    volSpike = volRatio > 1.8;
    volStrength = volSpike ? Math.min((volRatio - 1.8) / 3, 1) : 0;
  }
  indicators.push({
    name: 'Volume',
    signal: volSpike ? 1 : 0, // direction-neutral boost, counted as agreement
    strength: volStrength,
  });

  // Indicator 4: VWAP deviation — >0.3% above VWAP = short, below = long
  const vwapResult = calcVWAP(candles, 20);
  const vwapLong = vwapResult.signal < -0.3;   // price below VWAP by >0.3%
  const vwapShort = vwapResult.signal > 0.3;    // price above VWAP by >0.3%
  const vwapStrength = vwapLong
    ? Math.min(Math.abs(vwapResult.signal) / 1, 1)
    : vwapShort
      ? Math.min(Math.abs(vwapResult.signal) / 1, 1)
      : 0;
  indicators.push({
    name: 'VWAP',
    signal: vwapLong ? 1 : vwapShort ? -1 : 0,
    strength: vwapStrength,
  });

  // Indicator 5: RSI(7) — very fast, aggressive thresholds
  const rsi = calcRSI(closes, 7);
  const rsiLong = rsi < 25;
  const rsiShort = rsi > 75;
  const rsiStrength = rsiLong ? (25 - rsi) / 25 : rsiShort ? (rsi - 75) / 25 : 0;
  indicators.push({
    name: 'RSI',
    signal: rsiLong ? 1 : rsiShort ? -1 : 0,
    strength: rsiStrength,
  });

  // Indicator 6: Price momentum — last 3 candles all up = long, all down = short
  let momentumLong = false;
  let momentumShort = false;
  let momentumStrength = 0;
  if (closes.length >= 3) {
    const last3 = closes.slice(-3);
    const allUp = last3[1] > last3[0] && last3[2] > last3[1];
    const allDown = last3[1] < last3[0] && last3[2] < last3[1];
    momentumLong = allUp;
    momentumShort = allDown;
    const moveSize = Math.abs(last3[2] - last3[0]) / last3[0];
    momentumStrength = Math.min(moveSize * 50, 1);
  }
  indicators.push({
    name: 'Momentum',
    signal: momentumLong ? 1 : momentumShort ? -1 : 0,
    strength: momentumStrength,
  });

  // Count confluence: require ≥3 of 6 indicators to agree
  let longCount = 0;
  let shortCount = 0;
  let longScore = 0;
  let shortScore = 0;

  for (const ind of indicators) {
    if (ind.signal > 0) { longCount++; longScore += ind.strength; }
    else if (ind.signal < 0) { shortCount++; shortScore += ind.strength; }
  }

  if (longCount < 3 && shortCount < 3) {
    return { symbol, direction: 'none', score: Math.max(longScore, shortScore), leverage: 1, stopLoss: 0, takeProfit: 0, indicators };
  }

  let direction: 'long' | 'short' | 'none' = 'none';
  let score = 0;

  if (longCount >= 3 && longScore >= strategy.scoreThreshold && longScore >= shortScore) {
    direction = 'long';
    score = longScore;
  } else if (shortCount >= 3 && shortScore >= strategy.scoreThreshold && shortScore > longScore) {
    direction = 'short';
    score = shortScore;
  }

  if (direction === 'none') {
    return { symbol, direction: 'none', score: Math.max(longScore, shortScore), leverage: 1, stopLoss: 0, takeProfit: 0, indicators };
  }

  const leverage = Math.min(strategy.maxLeverage, Math.max(1, Math.round(score * 2)));
  // Narrow stop: 0.8× ATR for scalping
  const stopLossPercent = 0.8 * atr / price;
  const takeProfitPercent = stopLossPercent * strategy.riskRewardRatio;

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
      score += indicators[i].strength;
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
  const leverage = Math.min(strategy.maxLeverage, Math.max(1, Math.round(score * 1.2)));

  // Wide stop: 4× ATR — give position room to breathe for days
  // Cap SL at 5% max from entry to prevent absurdly wide stops
  const stopLossPercent = Math.min(4 * atr / price, 0.05);
  const takeProfitPercent = stopLossPercent * strategy.riskRewardRatio;

  const stopLoss = direction === 'long'
    ? price * (1 - stopLossPercent)
    : price * (1 + stopLossPercent);
  const takeProfit = direction === 'long'
    ? price * (1 + takeProfitPercent)
    : price * (1 - takeProfitPercent);

  return { symbol, direction, score, leverage, stopLoss, takeProfit, indicators };
}

// ============================================================
// Backtesting
// ============================================================

export function runBacktest(
  symbol: string,
  candles: CandleData[],
  weights: Record<string, number>,
  initialBalance: number = 100,
): BacktestSummary {
  const minCandles = 200;
  if (candles.length < minCandles) {
    return {
      symbol,
      total_trades: 0,
      winning_trades: 0,
      losing_trades: 0,
      total_pnl: 0,
      winrate: 0,
      profit_factor: 0,
      indicator_performance: {},
    };
  }

  let balance = initialBalance;
  const trades: BacktestTrade[] = [];
  const indicatorPerformance: Record<string, { wins: number; losses: number; pnl: number }> = {};
  const indicatorNames = ['RSI', 'MACD', 'EMA_50', 'EMA_200', 'Bollinger', 'Volume', 'StochRSI', 'ADX', 'OBV', 'VWAP'];
  for (const name of indicatorNames) {
    indicatorPerformance[name] = { wins: 0, losses: 0, pnl: 0 };
  }

  let i = minCandles;
  while (i < candles.length - 1) {
    const historicalCandles = candles.slice(0, i + 1);
    const decision = makeTradingDecision(symbol, historicalCandles, weights);

    if (decision.direction !== 'none' && balance > 0) {
      const amount = balance * 0.1 * decision.leverage;
      if (amount < 0.01) { i++; continue; }

      const entryPrice = candles[i].close;
      let exitPrice = entryPrice;
      let j = i + 1;
      const maxHold = Math.min(i + 24, candles.length); // max 24h hold

      while (j < maxHold) {
        const candle = candles[j];
        if (decision.direction === 'long') {
          if (candle.low <= decision.stopLoss) { exitPrice = decision.stopLoss; break; }
          if (candle.high >= decision.takeProfit) { exitPrice = decision.takeProfit; break; }
        } else {
          if (candle.high >= decision.stopLoss) { exitPrice = decision.stopLoss; break; }
          if (candle.low <= decision.takeProfit) { exitPrice = decision.takeProfit; break; }
        }
        exitPrice = candle.close;
        j++;
      }

      const priceChange = decision.direction === 'long'
        ? (exitPrice - entryPrice) / entryPrice
        : (entryPrice - exitPrice) / entryPrice;
      const pnl = (amount * priceChange) - (amount * 0.001); // 0.1% fee
      balance += pnl;

      const activeIndicators = decision.indicators
        .filter(ind => ind.signal !== 0)
        .map(ind => ind.name);

      const isWin = pnl > 0;
      trades.push({
        symbol,
        entry_price: entryPrice,
        exit_price: exitPrice,
        amount,
        leverage: decision.leverage,
        direction: decision.direction,
        pnl,
        indicators_used: activeIndicators,
      });

      for (const indName of activeIndicators) {
        if (indicatorPerformance[indName]) {
          if (isWin) {
            indicatorPerformance[indName].wins++;
            indicatorPerformance[indName].pnl += pnl;
          } else {
            indicatorPerformance[indName].losses++;
            indicatorPerformance[indName].pnl += pnl;
          }
        }
      }

      i = j; // Move past the trade duration
    } else {
      i++;
    }
  }

  const winningTrades = trades.filter(t => t.pnl > 0);
  const losingTrades = trades.filter(t => t.pnl <= 0);
  const totalWins = winningTrades.reduce((s, t) => s + t.pnl, 0);
  const totalLosses = Math.abs(losingTrades.reduce((s, t) => s + t.pnl, 0));
  const winrate = trades.length > 0 ? (winningTrades.length / trades.length) * 100 : 0;
  const profitFactor = totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? 999 : 0;

  return {
    symbol,
    total_trades: trades.length,
    winning_trades: winningTrades.length,
    losing_trades: losingTrades.length,
    total_pnl: balance - initialBalance,
    winrate,
    profit_factor,
    indicator_performance: indicatorPerformance,
  };
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
// Weight Optimization (Post-Backtest Learning)
// ============================================================

export function optimizeWeights(
  currentWeights: Record<string, number>,
  allSummaries: BacktestSummary[],
): Record<string, number> {
  const newWeights: Record<string, number> = { ...currentWeights };
  const indicatorAgg: Record<string, { totalWins: number; totalTrades: number; totalPnl: number }> = {};

  for (const summary of allSummaries) {
    for (const [name, perf] of Object.entries(summary.indicator_performance)) {
      if (!indicatorAgg[name]) indicatorAgg[name] = { totalWins: 0, totalTrades: 0, totalPnl: 0 };
      indicatorAgg[name].totalWins += perf.wins;
      indicatorAgg[name].totalTrades += perf.wins + perf.losses;
      indicatorAgg[name].totalPnl += perf.pnl;
    }
  }

  for (const [name, agg] of Object.entries(indicatorAgg)) {
    if (agg.totalTrades < 3) continue; // Not enough data
    const indicatorWinrate = agg.totalWins / agg.totalTrades;
    // Scale weight: bad indicators get 0.2, good ones get up to 2.5
    if (indicatorWinrate > 0.55) {
      newWeights[name] = Math.min(2.5, 1.0 + (indicatorWinrate - 0.5) * 5);
    } else if (indicatorWinrate < 0.45) {
      newWeights[name] = Math.max(0.2, 1.0 - (0.5 - indicatorWinrate) * 5);
    } else {
      newWeights[name] = 1.0;
    }
  }

  return newWeights;
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