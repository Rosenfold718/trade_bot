import type { CandleData, TradingDecision, Trade } from './types';
import { TOP_50_SYMBOLS } from './types';
import { makeStrategyDecision } from './trading-engine';
import { getStrategy } from './strategies';

// ============================================================
// Client-side Binance data fetching (CORS works from browser)
// ============================================================

export async function fetchCandlesClient(symbol: string, interval: string = '1h', limit: number = 1440): Promise<CandleData[]> {
  const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
  if (!res.ok) throw new Error(`Failed to fetch klines for ${symbol}`);
  const raw = await res.json();
  if (!Array.isArray(raw) || raw.length === 0) return [];
  return raw.map((k: (string | number)[]) => ({
    time: Math.floor(Number(k[0]) / 1000),
    open: parseFloat(String(k[1])),
    high: parseFloat(String(k[2])),
    low: parseFloat(String(k[3])),
    close: parseFloat(String(k[4])),
    volume: parseFloat(String(k[5])),
  }));
}

export async function fetchCurrentPrice(symbol: string): Promise<number> {
  const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`);
  if (!res.ok) throw new Error(`Failed to fetch price for ${symbol}`);
  const data = await res.json();
  return parseFloat(data.price);
}

export async function fetchTopSymbolsClient(): Promise<string[]> {
  const res = await fetch('https://api.binance.com/api/v3/ticker/24hr');
  if (!res.ok) return [];
  const data = await res.json();
  return data
    .filter((t: { symbol: string; quoteVolume: string }) => t.symbol.endsWith('USDT') && Number(t.quoteVolume) > 0)
    .sort((a: { quoteVolume: string }, b: { quoteVolume: string }) => Number(b.quoteVolume) - Number(a.quoteVolume))
    .slice(0, 50)
    .map((t: { symbol: string }) => t.symbol);
}

// ============================================================
// Client-side analysis
// ============================================================

export async function analyzeSymbol(
  symbol: string,
  interval: string,
  limit: number,
  strategyId: string = 'momentum',
): Promise<TradingDecision | null> {
  const candles = await fetchCandlesClient(symbol, interval, limit);
  if (candles.length < 50) return null;
  const decision = makeStrategyDecision(strategyId, symbol, candles, 30);
  return decision;
}

// ============================================================
// Client-side auto-trade: find best signal
// ============================================================

export async function findBestSignal(
  openTradeSymbols: Set<string>,
  strategyId: string = 'momentum',
  interval: string = '1h',
  limit: number = 1440,
): Promise<{ decision: TradingDecision; price: number; symbol: string } | null> {
  const strategy = getStrategy(strategyId);
  if (!strategy) return null;

  // Use strategy-specific interval if no override provided matching strategy default
  const effectiveInterval = interval;
  const effectiveLimit = limit;

  const symbols = TOP_50_SYMBOLS;
  const available = symbols.filter(s => !openTradeSymbols.has(s));
  const checkSymbols = available.sort(() => Math.random() - 0.5).slice(0, 20);

  if (strategy.timeFilterEnabled) {
    const mskHour = new Date().toLocaleTimeString('en-US', { timeZone: 'Europe/Moscow', hour: 'numeric', hour12: false }).padStart(2, '0');
    const hour = parseInt(mskHour, 10);
    if (hour < strategy.timeFilterStart || hour > strategy.timeFilterEnd) {
      console.log(`[findBestSignal][${strategyId}] Skipped: outside trading hours (${hour}h, allowed ${strategy.timeFilterStart}-${strategy.timeFilterEnd})`);
      return null;
    }
  }

  let best: { decision: TradingDecision; price: number; symbol: string } | null = null;
  let bestScore = 0;
  let noneCount = 0;
  let mtfRejected = 0;

  for (const sym of checkSymbols) {
    try {
      const candles = await fetchCandlesClient(sym, effectiveInterval, effectiveLimit);
      if (candles.length < 50) continue;
      const decision = makeStrategyDecision(strategyId, sym, candles, 0);
      if (decision.direction === 'none') { noneCount++; continue; }

      const avgVol = candles.slice(-20).reduce((s, c) => s + c.volume, 0) / Math.min(20, candles.length);
      const currentVol = candles[candles.length - 1].volume;
      if (avgVol > 0 && currentVol > avgVol * 1.2) {
        decision.score *= 1.15;
      }

      if (strategy.mtfEnabled) {
        try {
          // Use higher timeframe for MTF confirmation
          const mtfInterval = effectiveInterval === '1m' || effectiveInterval === '5m' ? '1h' 
            : effectiveInterval === '15m' ? '4h' 
            : '1d';
          const mtfCandles = await fetchCandlesClient(sym, mtfInterval, 200);
          if (mtfCandles.length >= 50) {
            const ema50 = calcEMA50(mtfCandles.map(c => c.close), 50);
            const mtfPrice = mtfCandles[mtfCandles.length - 1].close;
            if (!isNaN(ema50)) {
              const h4Bullish = mtfPrice > ema50;
              if (decision.direction === 'long' && !h4Bullish) { mtfRejected++; continue; }
              if (decision.direction === 'short' && h4Bullish) { mtfRejected++; continue; }
            }
          }
        } catch { /* MTF fetch failed — allow trade without MTF filter */ }
      }

      if (Math.abs(decision.score) > bestScore) {
        bestScore = Math.abs(decision.score);
        best = { decision, price: candles[candles.length - 1].close, symbol: sym };
      }
    } catch { continue; }
  }

  console.log(`[findBestSignal][${strategyId}] Interval:${effectiveInterval} Checked ${checkSymbols.length}, none=${noneCount}, mtf_rejected=${mtfRejected}, best=${best?.symbol ?? 'null'} score=${bestScore.toFixed(2)}`);

  return best;
}

function calcEMA50(data: number[], period: number): number {
  if (data.length < period) return NaN;
  const k = 2 / (period + 1);
  let ema = data.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < data.length; i++) { ema = data[i] * k + ema * (1 - k); }
  return ema;
}

// ============================================================
// Client-side TP/SL monitoring
// Uses LAST COMPLETED 1H candle close — aligns exit with signal timeframe
// ============================================================

export interface MonitorResult {
  closedTrades: Array<{ tradeId: string; symbol: string; direction: string; pnl: number; reason: string; exitPrice: number }>;
  trailingUpdates: Array<{ tradeId: string; newStopLoss: number; reason: string }>;
}

async function fetchLastCandleClose(symbol: string, interval: string = '1h'): Promise<number> {
  const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=2`);
  if (!res.ok) throw new Error(`Failed to fetch klines for ${symbol}`);
  const data = await res.json();
  if (!Array.isArray(data) || data.length < 1) throw new Error('No kline data');
  const completedCandle = data.length >= 2 ? data[0] : data[data.length - 1];
  return parseFloat(String(completedCandle[4]));
}

export function getCurrentCandleHour(): number {
  return Math.floor(Date.now() / 3600000);
}

export async function monitorTradesClient(
  openTrades: Trade[],
  lastCandleHour: number,
  monitorInterval: string = '1h',
  maxHoldMinutes: number = 720,
): Promise<MonitorResult> {
  const closedTrades: MonitorResult['closedTrades'] = [];
  const trailingUpdates: MonitorResult['trailingUpdates'] = [];
  const currentCandleHour = getCurrentCandleHour();

  if (currentCandleHour <= lastCandleHour) {
    return { closedTrades: [], trailingUpdates: [] };
  }

  for (const trade of openTrades) {
    try {
      const candleClose = await fetchLastCandleClose(trade.symbol, monitorInterval);
      let shouldClose = false;
      let reason = '';

      // TIME-BASED EXIT: close losing trades after maxHoldMinutes
      const openMs = Date.now() - new Date(trade.opened_at).getTime();
      const openMinutes = openMs / 60000;
      if (openMinutes > maxHoldMinutes) {
        const unrealizedPnl = trade.direction === 'long'
          ? (candleClose - trade.entry_price) / trade.entry_price
          : (trade.entry_price - candleClose) / trade.entry_price;
        if (unrealizedPnl < 0) {
          shouldClose = true;
          const hours = Math.round(openMinutes / 60);
          reason = `Тайм-эксит (${hours}ч)`;
        }
      }

      // TP check
      if (!shouldClose && trade.direction === 'long' && trade.take_profit && candleClose >= trade.take_profit) {
        shouldClose = true; reason = 'TP hit';
      } else if (!shouldClose && trade.direction === 'short' && trade.take_profit && candleClose <= trade.take_profit) {
        shouldClose = true; reason = 'TP hit';
      }

      // SL check
      if (!shouldClose && trade.direction === 'long' && trade.stop_loss && candleClose <= trade.stop_loss) {
        shouldClose = true; reason = 'SL hit';
      } else if (!shouldClose && trade.direction === 'short' && trade.stop_loss && candleClose >= trade.stop_loss) {
        shouldClose = true; reason = 'SL hit';
      }

      // Trailing stop: 3 levels
      if (!shouldClose && trade.stop_loss && trade.entry_price) {
        const initialSlDistance = Math.abs(trade.entry_price - trade.stop_loss);
        const isLong = trade.direction === 'long';
        const favorableMove = isLong ? candleClose - trade.entry_price : trade.entry_price - candleClose;

        if (favorableMove >= initialSlDistance * 3) {
          const trailedSL = isLong ? trade.entry_price + initialSlDistance * 2 : trade.entry_price - initialSlDistance * 2;
          if ((isLong && trailedSL > (trade.stop_loss ?? 0)) || (!isLong && trailedSL < (trade.stop_loss ?? Infinity))) {
            trailingUpdates.push({ tradeId: trade.id, newStopLoss: trailedSL, reason: 'Trailing lock 2× profit' });
          }
        } else if (favorableMove >= initialSlDistance * 2) {
          const trailedSL = isLong ? trade.entry_price + initialSlDistance : trade.entry_price - initialSlDistance;
          if ((isLong && trailedSL > (trade.stop_loss ?? 0)) || (!isLong && trailedSL < (trade.stop_loss ?? Infinity))) {
            trailingUpdates.push({ tradeId: trade.id, newStopLoss: trailedSL, reason: 'Trailing lock profit' });
          }
        } else if (favorableMove >= initialSlDistance) {
          const breakevenSL = isLong ? trade.entry_price * 1.001 : trade.entry_price * 0.999;
          if ((isLong && breakevenSL > (trade.stop_loss ?? 0)) || (!isLong && breakevenSL < (trade.stop_loss ?? Infinity))) {
            trailingUpdates.push({ tradeId: trade.id, newStopLoss: breakevenSL, reason: 'Trailing to breakeven' });
          }
        }
      }

      if (shouldClose) {
        const priceChange = trade.direction === 'long'
          ? (candleClose - trade.entry_price) / trade.entry_price
          : (trade.entry_price - candleClose) / trade.entry_price;
        const pnl = trade.amount * priceChange * trade.leverage - trade.amount * 0.001;
        closedTrades.push({ tradeId: trade.id, symbol: trade.symbol, direction: trade.direction, pnl, reason, exitPrice: candleClose });
      }
    } catch { continue; }
  }

  return { closedTrades, trailingUpdates };
}

// ============================================================
// Full auto-trade cycle — institutional money management
// ============================================================

export type NewTradeInfo = {
  symbol: string; direction: string; price: number; leverage: number;
  stopLoss: number; takeProfit: number; amount: number; strategyId: string;
  label: 'secure' | 'runner';
};

export async function runAutoTradeCycle(
  openTrades: Trade[],
  strategyId: string,
  _interval: string,
  balance: number,
  lastCandleHour: number = 0,
  recentPnl24h: number = 0,
): Promise<{
    action: 'monitor' | 'new-trade' | 'idle';
    closedTrades: MonitorResult['closedTrades'];
    trailingUpdates: MonitorResult['trailingUpdates'];
    newTrades?: NewTradeInfo[];
    message: string;
    scannedCount: number;
    bestScore: number;
    newCandleHour: number;
  }> {
  const strategy = getStrategy(strategyId);
  const maxTrades = strategy?.maxOpenTrades ?? 10;
  const tradeSizePct = strategy?.tradeSizePercent ?? 0.10;
  const currentCandleHour = getCurrentCandleHour();

  // Use strategy-specific interval and candle limit
  const strategyInterval = strategy?.defaultInterval ?? '1h';
  const strategyLimit = strategy?.candleLimit ?? 1440;
  const monitorInterval = strategy?.monitorInterval ?? '1h';
  const maxHoldMinutes = strategy?.maxHoldMinutes ?? 720;

  // DAILY LOSS LIMIT: stop trading if lost >5% in 24h
  const dailyLossLimit = balance * 0.05;
  if (recentPnl24h < -dailyLossLimit) {
    return {
      action: 'idle', closedTrades: [], trailingUpdates: [],
      message: `Дневной лимит: -$${Math.abs(recentPnl24h).toFixed(2)} (>5%). Пауза до завтра.`,
      scannedCount: 0, bestScore: 0, newCandleHour: currentCandleHour,
    };
  }

  // Step 1: Monitor open trades
  const { closedTrades, trailingUpdates } = await monitorTradesClient(openTrades, lastCandleHour, monitorInterval, maxHoldMinutes);
  const updatedOpenTrades = openTrades.filter(t => !closedTrades.some(c => c.tradeId === t.id));

  if (closedTrades.length > 0 || trailingUpdates.length > 0) {
    const parts: string[] = [];
    if (closedTrades.length > 0) parts.push(`Закрыто ${closedTrades.length}: ${closedTrades.map(c => `${c.symbol.replace('USDT', '')} (${c.reason})`).join(', ')}`);
    if (trailingUpdates.length > 0) parts.push(`Trailing SL: ${trailingUpdates.length}`);
    return { action: 'monitor', closedTrades, trailingUpdates, message: parts.join(' | '), scannedCount: 0, bestScore: 0, newCandleHour: currentCandleHour };
  }

  // Each signal opens 2 trades (secure + runner), need room for the pair
  if (updatedOpenTrades.length + 2 > maxTrades) {
    return { action: 'idle', closedTrades: [], trailingUpdates: [], message: `Лимит: ${updatedOpenTrades.length}/${maxTrades}, жду...`, scannedCount: 0, bestScore: 0, newCandleHour: currentCandleHour };
  }

  if (balance < 1) {
    return { action: 'idle', closedTrades: [], trailingUpdates: [], message: 'Баланс исчерпан (<$1)', scannedCount: 0, bestScore: 0, newCandleHour: currentCandleHour };
  }

  const openSymbols = new Set(updatedOpenTrades.map(t => t.symbol));

  const best = await findBestSignal(openSymbols, strategyId, strategyInterval, strategyLimit);
  if (!best || best.decision.direction === 'none') {
    return { action: 'idle', closedTrades: [], trailingUpdates: [], message: 'Сигналов не найдено, сканирую...', scannedCount: 20, bestScore: 0, newCandleHour: currentCandleHour };
  }

  // ============================================================
  // MULTI-LEVEL TP: Secure (50%) + Runner (50%)
  // Secure: TP at 1.5× SL distance → locks profit early
  // Runner: TP at full R:R → lets winners run
  // Trailing logic automatically moves runner SL to breakeven
  // ============================================================
  const totalAmount = Math.max(1.5, Math.min(balance * tradeSizePct, 20));
  // For scalper: allow even smaller amounts, increase frequency
  const secureAmount = Math.round(totalAmount * 0.5 * 100) / 100;
  const runnerAmount = Math.round((totalAmount - secureAmount) * 100) / 100;

  const slDist = Math.abs(best.price - best.decision.stopLoss);
  const isLong = best.decision.direction === 'long';
  const secureTP = isLong ? best.price + slDist * 1.5 : best.price - slDist * 1.5;

  const newTrades: NewTradeInfo[] = [
    { symbol: best.symbol, direction: best.decision.direction, price: best.price, leverage: best.decision.leverage, stopLoss: best.decision.stopLoss, takeProfit: secureTP, amount: secureAmount, strategyId, label: 'secure' },
    { symbol: best.symbol, direction: best.decision.direction, price: best.price, leverage: best.decision.leverage, stopLoss: best.decision.stopLoss, takeProfit: best.decision.takeProfit, amount: runnerAmount, strategyId, label: 'runner' },
  ];

  const coinName = best.symbol.replace('USDT', '');
  return {
    action: 'new-trade', closedTrades: [], trailingUpdates: [], newTrades,
    message: `СИГНАЛ: ${best.decision.direction.toUpperCase()} ${coinName} @ $${best.price.toFixed(2)} | ${best.decision.leverage}x | Secure 1.5R + Runner ${strategy?.riskRewardRatio ?? 3}R`,
    scannedCount: 20, bestScore: Math.abs(best.decision.score), newCandleHour: currentCandleHour,
  };
}
