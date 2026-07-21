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
  balance: number;
  borrowed_funds: number;
  debt_to_repay: number;
  is_active: boolean;
  updated_at?: string;
}

export interface Trade {
  id: string;
  symbol: string;
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
}

export interface IndicatorWeight {
  id: string;
  indicator_name: string;
  weight: number;
  calculated_winrate: number | null;
}

export interface BacktestResult {
  id: string;
  strategy_name: string;
  symbol: string;
  total_trades: number;
  winrate: number;
  profit_factor: number;
  timestamp: string;
}

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
}

export interface BacktestTrade {
  symbol: string;
  entry_price: number;
  exit_price: number;
  amount: number;
  leverage: number;
  direction: 'long' | 'short';
  pnl: number;
  indicators_used: string[];
}

export interface BacktestSummary {
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
  'ADAUSDT', 'DOGEUSDT', 'AVAXUSDT', 'DOTUSDT', 'MATICUSDT',
  'LINKUSDT', 'LTCUSDT', 'UNIUSDT', 'ATOMUSDT', 'ETCUSDT',
  'XLMUSDT', 'APTUSDT', 'NEARUSDT', 'FILUSDT', 'ARBUSDT',
  'OPUSDT', 'INJUSDT', 'SUIUSDT', 'SEIUSDT', 'TIAUSDT',
  'FETUSDT', 'RUNEUSDT', 'GRTUSDT', 'IMXUSDT', 'AAVEUSDT',
  'MKRUSDT', 'SNXUSDT', 'COMPUSDT', 'CRVUSDT', 'LDOUSDT',
  'RPLUSDT', 'PENDLEUSDT', 'STXUSDT', 'TONUSDT', 'TRXUSDT',
  'SHIBUSDT', 'PEPEUSDT', 'WIFUSDT', 'JUPUSDT', 'ENAUSDT',
  'WUSDT', 'WBTCUSDT', 'STETHUSDT', 'RENDERUSDT', 'ONDOUSDT',
];