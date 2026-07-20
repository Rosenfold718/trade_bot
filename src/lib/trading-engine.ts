import type { CandleData, IndicatorSignal, TradingDecision, BacktestTrade, BacktestSummary } from './types';

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

  let longScore = 0;
  let shortScore = 0;

  for (const ind of indicators) {
    const w = weights[ind.name] ?? 1;
    if (ind.signal > 0) {
      longScore += ind.strength * w;
    } else if (ind.signal < 0) {
      shortScore += ind.strength * w;
    }
  }

  const OPEN_THRESHOLD = idleMinutes > 5 ? 1 : 3; // Lower threshold when idle
  const absLongScore = Math.abs(longScore);
  const absShortScore = Math.abs(shortScore);
  const maxScore = Math.max(absLongScore, absShortScore);

  let direction: 'long' | 'short' | 'none' = 'none';
  let score = 0;

  if (absLongScore >= OPEN_THRESHOLD && absLongScore >= absShortScore) {
    direction = 'long';
    score = longScore;
  } else if (absShortScore >= OPEN_THRESHOLD && absShortScore > absLongScore) {
    direction = 'short';
    score = shortScore;
  }

  // Leverage based on signal strength (1x to 10x)
  const leverage = direction === 'none' ? 1 : Math.min(10, Math.max(1, Math.round(maxScore * 2)));

  // Stop loss and take profit based on ATR
  const stopLossPercent = atr / price; // e.g., 0.02 for 2%
  const takeProfitPercent = stopLossPercent * 2; // 1:2 risk/reward

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
  const indicatorNames = ['RSI', 'MACD', 'EMA_50', 'EMA_200', 'Bollinger', 'Volume'];
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

export async function fetchKlines(symbol: string, interval: string = '1h', limit: number = 720): Promise<CandleData[]> {
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