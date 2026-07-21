import type { CandleData, TradingDecision, Trade, IndicatorSignal } from './types';
import { TOP_50_SYMBOLS } from './types';
import { makeTradingDecision, analyzeIndicators } from './trading-engine';

// ============================================================
// Client-side Binance data fetching (CORS works from browser)
// ============================================================

export async function fetchCandlesClient(symbol: string, interval: string = '1h', limit: number = 720): Promise<CandleData[]> {
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
  weights: Record<string, number>,
): Promise<TradingDecision | null> {
  const candles = await fetchCandlesClient(symbol, interval, limit);
  if (candles.length < 50) return null;
  const decision = makeTradingDecision(symbol, candles, weights, 30);
  return decision;
}

// ============================================================
// Client-side auto-trade: find best signal
// ============================================================

export async function findBestSignal(
  weights: Record<string, number>,
  openTradeSymbols: Set<string>,
  interval: string = '1h',
  limit: number = 720,
): Promise<{ decision: TradingDecision; price: number; symbol: string } | null> {
  // Only trade symbols that are in the coin list (TOP_50_SYMBOLS)
  const symbols = TOP_50_SYMBOLS;
  const available = symbols.filter(s => !openTradeSymbols.has(s));
  // Shuffle and check more symbols for better signal detection
  const checkSymbols = available.sort(() => Math.random() - 0.5).slice(0, 10);

  let best: { decision: TradingDecision; price: number; symbol: string } | null = null;
  let bestScore = 0;

  for (const sym of checkSymbols) {
    try {
      const candles = await fetchCandlesClient(sym, interval, limit);
      if (candles.length < 50) continue;
      const decision = makeTradingDecision(sym, candles, weights, 0);
      if (decision.direction === 'none') continue;

      // ============================================================
      // POINT 4: Multi-timeframe filter — 4H EMA 50 trend must align
      // ============================================================
      try {
        const h4candles = await fetchCandlesClient(sym, '4h', 200);
        if (h4candles.length >= 50) {
          const ema50 = calcEMA50(h4candles.map(c => c.close), 50);
          const h4price = h4candles[h4candles.length - 1].close;
          if (!isNaN(ema50)) {
            const h4Bullish = h4price > ema50;
            if (decision.direction === 'long' && !h4Bullish) continue;
            if (decision.direction === 'short' && h4Bullish) continue;
          }
        }
      } catch { /* 4H fetch failed — allow trade without MTF filter */ }

      // ============================================================
      // POINT 5: Order book imbalance must confirm direction
      // ============================================================
      const imbalance = await fetchOrderBookImbalance(sym);
      if (Math.abs(imbalance) < 0.05) continue; // No clear pressure — skip
      if (decision.direction === 'long' && imbalance < 0) continue; // Bearish OB — skip long
      if (decision.direction === 'short' && imbalance > 0) continue; // Bullish OB — skip short

      if (Math.abs(decision.score) > bestScore) {
        bestScore = Math.abs(decision.score);
        best = { decision, price: candles[candles.length - 1].close, symbol: sym };
      }
    } catch {
      continue;
    }
  }

  return best;
}

// Simple EMA 50 calculation for MTF filter
function calcEMA50(data: number[], period: number): number {
  if (data.length < period) return NaN;
  const k = 2 / (period + 1);
  let ema = data.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < data.length; i++) {
    ema = data[i] * k + ema * (1 - k);
  }
  return ema;
}

// ============================================================
// POINT 5: Order book imbalance check
// ============================================================

async function fetchOrderBookImbalance(symbol: string): Promise<number> {
  try {
    const res = await fetch(`https://api.binance.com/api/v3/depth?symbol=${symbol}&limit=20`);
    if (!res.ok) return 0;
    const data = await res.json();
    let bidVol = 0;
    let askVol = 0;
    for (const [price, qty] of data.bids as [string, string][]) bidVol += parseFloat(qty);
    for (const [price, qty] of data.asks as [string, string][]) askVol += parseFloat(qty);
    const total = bidVol + askVol;
    if (total === 0) return 0;
    return (bidVol - askVol) / total; // +0.3 = bid heavy, -0.3 = ask heavy
  } catch {
    return 0;
  }
}

// ============================================================
// Client-side TP/SL monitoring
// ============================================================

export interface MonitorResult {
  closedTrades: Array<{ tradeId: string; symbol: string; direction: string; pnl: number; reason: string; exitPrice: number }>;
  trailingUpdates: Array<{ tradeId: string; newStopLoss: number; reason: string }>;
}

export async function monitorTradesClient(openTrades: Trade[]): Promise<MonitorResult> {
  const closedTrades: MonitorResult['closedTrades'] = [];
  const trailingUpdates: MonitorResult['trailingUpdates'] = [];

  for (const trade of openTrades) {
    try {
      const currentPrice = await fetchCurrentPrice(trade.symbol);
      let shouldClose = false;
      let reason = '';

      if (trade.direction === 'long' && trade.take_profit && currentPrice >= trade.take_profit) {
        shouldClose = true; reason = 'TP hit';
      } else if (trade.direction === 'short' && trade.take_profit && currentPrice <= trade.take_profit) {
        shouldClose = true; reason = 'TP hit';
      }

      if (trade.direction === 'long' && trade.stop_loss && currentPrice <= trade.stop_loss) {
        shouldClose = true; reason = 'SL hit';
      } else if (trade.direction === 'short' && trade.stop_loss && currentPrice >= trade.stop_loss) {
        shouldClose = true; reason = 'SL hit';
      }

      // ============================================================
      // POINT 6: Trailing stop logic
      // ============================================================
      if (!shouldClose && trade.stop_loss && trade.entry_price) {
        const initialSlDistance = Math.abs(trade.entry_price - trade.stop_loss);
        const isLong = trade.direction === 'long';
        const favorableMove = isLong
          ? currentPrice - trade.entry_price
          : trade.entry_price - currentPrice;

        if (favorableMove >= initialSlDistance) {
          // Price moved ≥1× SL distance in our favor — trail to breakeven
          const breakevenSL = isLong
            ? trade.entry_price * 1.001 // tiny buffer above entry
            : trade.entry_price * 0.999;
          if ((isLong && breakevenSL > (trade.stop_loss ?? 0)) ||
              (!isLong && breakevenSL < (trade.stop_loss ?? Infinity))) {
            trailingUpdates.push({ tradeId: trade.id, newStopLoss: breakevenSL, reason: 'Trailing to breakeven' });
          }
        } else if (favorableMove >= initialSlDistance * 2) {
          // Price moved ≥2× SL distance — trail to +1× from entry
          const trailedSL = isLong
            ? trade.entry_price + initialSlDistance
            : trade.entry_price - initialSlDistance;
          if ((isLong && trailedSL > (trade.stop_loss ?? 0)) ||
              (!isLong && trailedSL < (trade.stop_loss ?? Infinity))) {
            trailingUpdates.push({ tradeId: trade.id, newStopLoss: trailedSL, reason: 'Trailing lock profit' });
          }
        }
      }

      if (shouldClose) {
        const priceChange = trade.direction === 'long'
          ? (currentPrice - trade.entry_price) / trade.entry_price
          : (trade.entry_price - currentPrice) / trade.entry_price;
        const pnl = trade.amount * priceChange * trade.leverage - trade.amount * 0.001;
        closedTrades.push({ tradeId: trade.id, symbol: trade.symbol, direction: trade.direction, pnl, reason, exitPrice: currentPrice });
      }
    } catch {
      continue;
    }
  }

  return { closedTrades, trailingUpdates };
}

// ============================================================
// Full auto-trade cycle (runs entirely client-side)
// ============================================================

export async function runAutoTradeCycle(
  openTrades: Trade[],
  weights: Record<string, number>,
  interval: string,
  balance: number,
): Promise<{
    action: 'monitor' | 'new-trade' | 'idle';
    closedTrades: MonitorResult['closedTrades'];
    trailingUpdates: MonitorResult['trailingUpdates'];
    newTrade?: { symbol: string; direction: string; price: number; leverage: number; stopLoss: number; takeProfit: number; amount: number };
    message: string;
    scannedCount: number;
    bestScore: number;
  }> {
  // Step 1: Monitor open trades
  const { closedTrades, trailingUpdates } = await monitorTradesClient(openTrades);
  const updatedOpenTrades = openTrades.filter(t => !closedTrades.some(c => c.tradeId === t.id));

  if (closedTrades.length > 0 || trailingUpdates.length > 0) {
    const parts: string[] = [];
    if (closedTrades.length > 0) parts.push(`Closed ${closedTrades.length} trade(s): ${closedTrades.map(c => `${c.symbol} (${c.reason})`).join(', ')}`);
    if (trailingUpdates.length > 0) parts.push(`Trailing SL: ${trailingUpdates.length} trade(s)`);
    return {
      action: 'monitor',
      closedTrades,
      trailingUpdates,
      message: parts.join(' | '),
      scannedCount: 0,
      bestScore: 0,
    };
  }

  // Hard limit: max 10 concurrent open trades
  if (updatedOpenTrades.length >= 10) {
    return { action: 'idle', closedTrades: [], trailingUpdates: [], message: `Лимит сделок: ${updatedOpenTrades.length}/10, жду закрытия...`, scannedCount: 0, bestScore: 0 };
  }

  // Step 3: If balance too low, skip
  if (balance < 5) {
    return { action: 'idle', closedTrades: [], trailingUpdates: [], message: 'Недостаточно баланса ($<5)', scannedCount: 0, bestScore: 0 };
  }

  const openSymbols = new Set(updatedOpenTrades.map(t => t.symbol));
  const limitMap: Record<string, number> = { '1m': 1000, '5m': 1000, '15m': 1000, '1h': 720, '4h': 500 };
  const limit = limitMap[interval] || 720;

  const best = await findBestSignal(weights, openSymbols, interval, limit);
  if (!best || best.decision.direction === 'none') {
    return { action: 'idle', closedTrades: [], trailingUpdates: [], message: 'Сигналов не найдено, сканирую...', scannedCount: 10, bestScore: 0 };
  }

  // Trade amount: scale with balance — 10% per trade, min $3, max $20
  const tradeAmount = Math.max(3, Math.min(balance * 0.10, 20));

  return {
    action: 'new-trade',
    closedTrades: [],
    trailingUpdates: [],
    newTrade: {
      symbol: best.symbol,
      direction: best.decision.direction,
      price: best.price,
      leverage: best.decision.leverage,
      stopLoss: best.decision.stopLoss,
      takeProfit: best.decision.takeProfit,
      amount: tradeAmount,
    },
    message: `СИГНАЛ: ${best.decision.direction.toUpperCase()} ${best.symbol.replace('USDT', '')} @ $${best.price.toFixed(2)} | ${best.decision.leverage}x | Score: ${best.decision.score.toFixed(2)}`,
    scannedCount: 10,
    bestScore: Math.abs(best.decision.score),
  };
}