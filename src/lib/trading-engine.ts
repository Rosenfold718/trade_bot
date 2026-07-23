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
    case 'mean-reversion':
      return makeMeanReversionDecision(symbol, candles, strategy, idleMinutes);
    case 'trend-pullback':
      return makeTrendPullbackDecision(symbol, candles, strategy, idleMinutes);
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
// Strategy 2: Mean Reversion
// ============================================================

function makeMeanReversionDecision(
  symbol: string,
  candles: CandleData[],
  strategy: StrategyConfig,
  _idleMinutes: number = 0,
): TradingDecision {
  if (candles.length < 50) return noDecision(symbol, candles);

  const closes = candles.map(c => c.close);
  const price = closes[closes.length - 1];
  const atr = calcATR(candles);
  const indicators: IndicatorSignal[] = [];

  // ── EMA-50 trend filter: don't catch falling knives ──
  const ema50Arr = ema(closes, 50);
  const ema50 = ema50Arr[ema50Arr.length - 1];
  const aboveEma50 = !isNaN(ema50) && price > ema50;

  // Indicator 1: RSI(14) — more extreme thresholds
  const rsi = calcRSI(closes, 14);
  const rsiLong = rsi < 28;   // was 35 — require deeper oversold
  const rsiShort = rsi > 72;  // was 65 — require deeper overbought
  const rsiStrength = rsiLong ? (28 - rsi) / 28 : rsiShort ? (rsi - 72) / 28 : 0;
  indicators.push({
    name: 'RSI',
    signal: rsiLong ? 1 : rsiShort ? -1 : 0,
    strength: rsiStrength,
  });

  // Indicator 2: Bollinger Bands(20, 2)
  const bb = calcBollingerBands(closes, 20, 2);
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

  // Indicator 3: StochRSI — more extreme thresholds
  const stochRSI = calcStochRSI(closes, 14, 14);
  const stochLong = stochRSI < 0.15;   // was 0.25
  const stochShort = stochRSI > 0.85;  // was 0.75
  const stochStrength = stochLong ? (0.15 - stochRSI) / 0.15 : stochShort ? (stochRSI - 0.85) / 0.15 : 0;
  indicators.push({
    name: 'StochRSI',
    signal: stochLong ? 1 : stochShort ? -1 : 0,
    strength: stochStrength,
  });

  // Indicator 4: Volume confirmation
  const volRatio = candles.length >= 20
    ? candles[candles.length - 1].volume / (candles.slice(-20).reduce((s, c) => s + c.volume, 0) / 20)
    : 0;
  const volSpike = volRatio > 1.3;  // lowered from 1.5
  const volStrength = volSpike ? Math.min((volRatio - 1.3) / 2, 1) : 0;
  indicators.push({ name: 'Volume', signal: 0, strength: volStrength });

  // Count confluence for long and short (volume is bonus, not counted)
  let longCount = 0;
  let shortCount = 0;
  let longScore = 0;
  let shortScore = 0;

  for (const ind of indicators) {
    if (ind.signal > 0) { longCount++; longScore += ind.strength; }
    else if (ind.signal < 0) { shortCount++; shortScore += ind.strength; }
  }

  // Volume bonus
  if (volSpike) {
    longScore += volStrength * 0.3;
    shortScore += volStrength * 0.3;
  }

  // ── STRICT: require ALL 3 indicators to agree (was 2 of 3) ──
  if (longCount < 3 && shortCount < 3) {
    return { symbol, direction: 'none', score: 0, leverage: 1, stopLoss: 0, takeProfit: 0, indicators };
  }

  // ── EMA-50 trend filter for longs: don't buy below EMA-50 (falling knife) ──
  // For shorts: don't sell above EMA-50
  const longEntry = longCount >= 3 && aboveEma50;
  const shortEntry = shortCount >= 3 && !aboveEma50;

  let direction: 'long' | 'short' | 'none' = 'none';
  let score = 0;

  if (longEntry && longScore >= strategy.scoreThreshold) {
    direction = 'long';
    score = longScore;
  } else if (shortEntry && shortScore >= strategy.scoreThreshold) {
    direction = 'short';
    score = shortScore;
  }

  if (direction === 'none') {
    return { symbol, direction: 'none', score: Math.max(longScore, shortScore), leverage: 1, stopLoss: 0, takeProfit: 0, indicators };
  }

  const leverage = Math.min(strategy.maxLeverage, Math.max(1, Math.round(score * 1.5)));
  // Wide stop: 2.5× ATR to give trades room to breathe on 1H timeframe
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
// Strategy 3: Trend Pullback
// ============================================================

function makeTrendPullbackDecision(
  symbol: string,
  candles: CandleData[],
  strategy: StrategyConfig,
  _idleMinutes: number = 0,
): TradingDecision {
  if (candles.length < 100) return noDecision(symbol, candles);

  const closes = candles.map(c => c.close);
  const price = closes[closes.length - 1];
  const atr = calcATR(candles);
  const rsi = calcRSI(closes);
  const indicators: IndicatorSignal[] = [];

  // Indicator 1: EMA9
  const ema9Arr = ema(closes, 9);
  const ema9 = ema9Arr[ema9Arr.length - 1];

  // Indicator 2: EMA21
  const ema21Arr = ema(closes, 21);
  const ema21 = ema21Arr[ema21Arr.length - 1];

  // Indicator 3: EMA99
  const ema99Arr = ema(closes, 99);
  const ema99 = ema99Arr[ema99Arr.length - 1];

  // Indicator 4: ADX
  const adxResult = calcADX(candles);

  // ADX filter: require strong trend
  if (strategy.adxMin !== null && adxResult.adx < strategy.adxMin) {
    indicators.push({ name: 'ADX', signal: 0, strength: 0 });
    return { symbol, direction: 'none', score: 0, leverage: 1, stopLoss: 0, takeProfit: 0, indicators };
  }

  // Determine trend direction
  const isUptrend = !isNaN(ema9) && !isNaN(ema21) && ema9 > ema21 && price > ema21;
  const isDowntrend = !isNaN(ema9) && !isNaN(ema21) && ema9 < ema21 && price < ema21;

  if (!isUptrend && !isDowntrend) {
    indicators.push(
      { name: 'EMA9', signal: 0, strength: 0 },
      { name: 'EMA21', signal: 0, strength: 0 },
      { name: 'EMA99', signal: 0, strength: 0 },
      { name: 'ADX', signal: 0, strength: 0 },
      { name: 'OBV', signal: 0, strength: 0 },
      { name: 'Volume', signal: 0, strength: 0 },
    );
    return { symbol, direction: 'none', score: 0, leverage: 1, stopLoss: 0, takeProfit: 0, indicators };
  }

  const trendDir = isUptrend ? 1 : -1;

  // ── RSI exhaustion filter: don't enter long if RSI > 75, short if RSI < 25 ──
  if (isUptrend && rsi > 75) {
    indicators.push(
      { name: 'EMA9', signal: 0, strength: 0 }, { name: 'EMA21', signal: 0, strength: 0 },
      { name: 'EMA99', signal: 0, strength: 0 }, { name: 'ADX', signal: 0, strength: 0 },
      { name: 'OBV', signal: 0, strength: 0 }, { name: 'Volume', signal: 0, strength: 0 },
    );
    return { symbol, direction: 'none', score: 0, leverage: 1, stopLoss: 0, takeProfit: 0, indicators };
  }
  if (isDowntrend && rsi < 25) {
    indicators.push(
      { name: 'EMA9', signal: 0, strength: 0 }, { name: 'EMA21', signal: 0, strength: 0 },
      { name: 'EMA99', signal: 0, strength: 0 }, { name: 'ADX', signal: 0, strength: 0 },
      { name: 'OBV', signal: 0, strength: 0 }, { name: 'Volume', signal: 0, strength: 0 },
    );
    return { symbol, direction: 'none', score: 0, leverage: 1, stopLoss: 0, takeProfit: 0, indicators };
  }

  // Check pullback to EMA21 — widened to 2% for more entry opportunities
  const ema21Dist = Math.abs(price - ema21) / ema21;
  const isNearEma21 = ema21Dist <= 0.02;  // was 0.015

  // Indicator signals
  indicators.push({
    name: 'EMA9',
    signal: trendDir,
    strength: Math.min(Math.abs(ema9 - ema21) / ema21 * 100, 1),
  });

  indicators.push({
    name: 'EMA21',
    signal: trendDir,
    strength: Math.min(ema21Dist / 0.005, 1),
  });

  const ema99Signal = !isNaN(ema99) ? (price > ema99 ? 1 : price < ema99 ? -1 : 0) : 0;
  const ema99Strength = !isNaN(ema99) ? Math.min(Math.abs(price - ema99) / ema99 * 20, 1) : 0;
  indicators.push({
    name: 'EMA99',
    signal: ema99Signal === trendDir ? trendDir : 0,
    strength: ema99Signal === trendDir ? ema99Strength : 0,
  });

  indicators.push({
    name: 'ADX',
    signal: adxResult.plusDI > adxResult.minusDI ? 1 : -1,
    strength: Math.min((adxResult.adx - 25) / 25, 1),
  });

  const obvResult = calcOBV(candles);
  indicators.push({
    name: 'OBV',
    signal: obvResult.trend > 0.05 ? 1 : obvResult.trend < -0.05 ? -1 : 0,
    strength: Math.min(Math.abs(obvResult.trend) * 5, 1),
  });

  const volRatio = candles.length >= 20
    ? candles[candles.length - 1].volume / (candles.slice(-20).reduce((s, c) => s + c.volume, 0) / 20)
    : 0;
  indicators.push({
    name: 'Volume',
    signal: volRatio > 1.2 ? trendDir : 0,
    strength: volRatio > 1.2 ? Math.min((volRatio - 1.2) / 2, 1) : 0,
  });

  // Count confluence
  let agreeCount = 0;
  let score = 0;

  for (const ind of indicators) {
    if (ind.signal === trendDir) {
      agreeCount++;
      score += ind.strength;
    }
  }

  // Require ≥4 of 6 indicators to agree (was 3)
  if (agreeCount < 4) {
    return { symbol, direction: 'none', score, leverage: 1, stopLoss: 0, takeProfit: 0, indicators };
  }

  // Require pullback near EMA21
  if (!isNearEma21) {
    return { symbol, direction: 'none', score, leverage: 1, stopLoss: 0, takeProfit: 0, indicators };
  }

  // Score threshold check
  if (score < strategy.scoreThreshold) {
    return { symbol, direction: 'none', score, leverage: 1, stopLoss: 0, takeProfit: 0, indicators };
  }

  const direction: 'long' | 'short' = isUptrend ? 'long' : 'short';
  const leverage = Math.min(strategy.maxLeverage, Math.max(1, Math.round(score * 1.5)));

  // Wide stop: 2.5× ATR to give trades room to breathe on 1H timeframe
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