export type { StrategyConfig } from './strategies';

// ============================================================
// Binance API Types
// ============================================================

export interface BinanceTicker {
  s: string;  // Symbol e.g. "BTCUSDT"
  c: string;  // Last price
  P: string;  // Price change percent
  v: string;  // Total traded base asset volume
  q: string;  // Total traded quote asset volume
  h: string;  // High price
  l: string;  // Low price
  o: string;  // Open price
}

export interface BinanceKline {
  openTime: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  closeTime: number;
  quoteAssetVolume: string;
  numberOfTrades: number;
  takerBuyBaseAssetVolume: string;
  takerBuyQuoteAssetVolume: string;
}

export interface CandleData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// ============================================================
// Database Types
// ============================================================

export interface TraderState {
  id: string;
  strategy_id: string;
  balance: number;
  borrowed_funds: number;
  debt_to_repay: number;
  initial_balance: number;
  is_active: boolean;
  updated_at?: string;
}

export interface PatternInfo {
  name: string;
  direction: string;
  reliability: number;
  strength: number;
  zone_high: number;
  zone_low: number;
  start_time: number; // unix seconds
  end_time: number;   // unix seconds
}

export interface Trade {
  id: string;
  symbol: string;
  strategy_id: string;
  entry_price: number;
  exit_price: number | null;
  amount: number;
  leverage: number;
  direction: 'long' | 'short';
  pnl: number | null;
  status: 'open' | 'closed';
  stop_loss: number | null;
  take_profit: number | null;
  opened_at: string;
  closed_at: string | null;
  // v2: partial TP + entry quality
  remaining_amount?: number;
  entry_quality?: number;
  partial_state?: 'full' | 'tp1_hit' | 'tp2_hit';
  // v3: pattern info for visualization
  pattern_name?: string | null;
  pattern_direction?: string | null;
  pattern_reliability?: number | null;
  pattern_strength?: number | null;
  pattern_zone_high?: number | null;
  pattern_zone_low?: number | null;
  pattern_start_time?: number | null;
  pattern_end_time?: number | null;
}

export interface IndicatorWeight {
  id: string;
  indicator_name: string;
  weight: number;
  calculated_winrate: number | null;
}

// BacktestResult removed — backtest feature disabled

// ============================================================
// Trading Engine Types
// ============================================================

export interface IndicatorSignal {
  name: string;
  signal: number; // +1 = long, -1 = short, 0 = neutral
  strength: number; // 0.0 to 1.0
}

export interface TradingDecision {
  symbol: string;
  direction: 'long' | 'short' | 'none';
  score: number;
  leverage: number;
  stopLoss: number;
  takeProfit: number;
  indicators: IndicatorSignal[];
  // Pattern info (set by Pattern Pro strategy)
  pattern?: PatternInfo | null;
}

// BacktestTrade removed — backtest feature disabled
export interface _BacktestTrade {
  symbol: string;
  entry_price: number;
  exit_price: number;
  amount: number;
  leverage: number;
  direction: 'long' | 'short';
  pnl: number;
  indicators_used: string[];
}

export interface _BacktestSummary {
  symbol: string;
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  total_pnl: number;
  winrate: number;
  profit_factor: number;
  indicator_performance: Record<string, { wins: number; losses: number; pnl: number }>;
}

// ============================================================
// UI State Types
// ============================================================

// ============================================================
// Order Book Types
// ============================================================

export interface OrderBookLevel {
  price: number;
  quantity: number;
  total: number; // cumulative total from best bid/ask
}

export interface OrderBookData {
  asks: OrderBookLevel[]; // sorted ascending (lowest ask = index 0)
  bids: OrderBookLevel[]; // sorted descending (highest bid = index 0)
  spread: number;
  spreadPercent: number;
  midPrice: number;
}

export interface CoinPrice {
  symbol: string;
  price: number;
  change24h: number;
  volume: number;
  high: number;
  low: number;
  prevPrice: number;
  flashDirection: 'up' | 'down' | null;
}

export const TOP_50_SYMBOLS: string[] = [
  'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT',
  'ADAUSDT', 'DOGEUSDT', 'AVAXUSDT', 'DOTUSDT', 'POLUSDT',
  'LINKUSDT', 'LTCUSDT', 'UNIUSDT', 'ATOMUSDT', 'ETCUSDT',
  'XLMUSDT', 'APTUSDT', 'NEARUSDT', 'FILUSDT', 'ARBUSDT',
  'OPUSDT', 'INJUSDT', 'SUIUSDT', 'SEIUSDT', 'TIAUSDT',
  'FETUSDT', 'RUNEUSDT', 'GRTUSDT', 'IMXUSDT', 'AAVEUSDT',
  'MKRUSDT', 'SNXUSDT', 'COMPUSDT', 'CRVUSDT', 'LDOUSDT',
  'RPLUSDT', 'PENDLEUSDT', 'STXUSDT', 'TONUSDT', 'TRXUSDT',
  'SHIBUSDT', 'PEPEUSDT', 'WIFUSDT', 'JUPUSDT', 'ENAUSDT',
  'FLOKIUSDT', 'WBTCUSDT', 'BLURUSDT', 'RENDERUSDT', 'ONDOUSDT',
];