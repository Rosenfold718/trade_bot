import type { CandleData, TradingDecision, Trade, IndicatorWeight, IndicatorSignal } from './types';
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
  const symbols = await fetchTopSymbolsClient();
  const available = symbols.filter(s => !openTradeSymbols.has(s));
  const checkSymbols = available.sort(() => Math.random() - 0.5).slice(0, 15);

  let best: { decision: TradingDecision; price: number; symbol: string } | null = null;
  let bestScore = 0;

  for (const sym of checkSymbols) {
    try {
      const candles = await fetchCandlesClient(sym, interval, limit);
      if (candles.length < 50) continue;
      const decision = makeTradingDecision(sym, candles, weights, 30);
      if (decision.direction !== 'none' && Math.abs(decision.score) > bestScore) {
        bestScore = Math.abs(decision.score);
        best = { decision, price: candles[candles.length - 1].close, symbol: sym };
      }
    } catch {
      continue;
    }
  }

  return best;
}

// ============================================================
// Client-side TP/SL monitoring
// ============================================================

export interface MonitorResult {
 closedTrades: Array<{ tradeId: string; symbol: string; direction: string; pnl: number; reason: string; exitPrice: number }>;
}

export async function monitorTradesClient(openTrades: Trade[]): Promise<MonitorResult> {
  const closedTrades: MonitorResult['closedTrades'] = [];

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

  return { closedTrades };
}

// ============================================================
// Full auto-trade cycle (runs entirely client-side)
// ============================================================

export async function runAutoTradeCycle(
  openTrades: Trade[],
  weights: Record<string, number>,
  interval: string,
): Promise<{
    action: 'monitor' | 'new-trade' | 'idle';
    closedTrades: MonitorResult['closedTrades'];
    newTrade?: { symbol: string; direction: string; price: number; leverage: number; stopLoss: number; takeProfit: number; amount: number };
    message: string;
  }> {
  // Step 1: Monitor open trades
  const { closedTrades } = await monitorTradesClient(openTrades);
  const updatedOpenTrades = openTrades.filter(t => !closedTrades.some(c => c.tradeId === t.id));

  if (closedTrades.length > 0) {
    return {
      action: 'monitor',
      closedTrades,
      message: `Closed ${closedTrades.length} trade(s): ${closedTrades.map(c => `${c.symbol} (${c.reason})`).join(', ')}`,
    };
  }

  // Step 2: If < 3 open trades, look for new signals
  if (updatedOpenTrades.length >= 3) {
    return { action: 'idle', closedTrades: [], message: 'Max 3 open trades' };
  }

  const openSymbols = new Set(updatedOpenTrades.map(t => t.symbol));
  const limitMap: Record<string, number> = { '1m': 1000, '5m': 1000, '15m': 1000, '1h': 720 };
  const limit = limitMap[interval] || 720;

  const best = await findBestSignal(weights, openSymbols, interval, limit);
  if (!best || best.decision.direction === 'none') {
    return { action: 'idle', closedTrades: [], message: 'No strong signals found' };
  }

  const tradeAmount = 15; // $15 per trade from $100 balance

  return {
    action: 'new-trade',
    closedTrades: [],
    newTrade: {
      symbol: best.symbol,
      direction: best.decision.direction,
      price: best.price,
      leverage: best.decision.leverage,
      stopLoss: best.decision.stopLoss,
      takeProfit: best.decision.takeProfit,
      amount: tradeAmount,
    },
    message: `Signal: ${best.decision.direction.toUpperCase()} ${best.symbol} @ ${best.price} (${best.decision.leverage}x, score ${best.decision.score.toFixed(2)})`,
  };
}
