import { create } from 'zustand';
import type { CoinPrice, TraderState, Trade, IndicatorWeight, BacktestResult, TradingDecision } from '@/lib/types';

interface TerminalStore {
  // Coin prices
  coins: CoinPrice[];
  setCoins: (coins: CoinPrice[]) => void;
  updateCoinPrice: (ticker: { s: string; c: string; P: string; v: string; h: string; l: string; o: string }) => void;

  // Selected symbol
  selectedSymbol: string;
  setSelectedSymbol: (symbol: string) => void;

  // Trader state
  traderState: TraderState | null;
  setTraderState: (state: TraderState) => void;

  // Indicator weights
  weights: IndicatorWeight[];
  setWeights: (weights: IndicatorWeight[]) => void;

  // Open trades
  openTrades: Trade[];
  setOpenTrades: (trades: Trade[]) => void;

  // Recent trades
  recentTrades: Trade[];
  setRecentTrades: (trades: Trade[]) => void;

  // Backtest results
  backtestResults: BacktestResult[];
  setBacktestResults: (results: BacktestResult[]) => void;

  // Current analysis
  currentAnalysis: TradingDecision | null;
  setCurrentAnalysis: (analysis: TradingDecision | null) => void;

  // Activity log
  activityLog: Array<{ time: string; message: string; type: 'info' | 'trade' | 'error' }>;
  addLog: (message: string, type?: 'info' | 'trade' | 'error') => void;

  // UI state
  isLoading: boolean;
  setIsLoading: (loading: boolean) => void;
  backtestLoading: boolean;
  setBacktestLoading: (loading: boolean) => void;
  autoTrading: boolean;
  setAutoTrading: (trading: boolean) => void;
}

export const useTerminalStore = create<TerminalStore>((set) => ({
  coins: [],
  setCoins: (coins) => set({ coins }),
  updateCoinPrice: (ticker) =>
    set((state) => {
      const newPrice = parseFloat(ticker.c);
      const coins = [...state.coins];
      const idx = coins.findIndex((c) => c.symbol === ticker.s);
      if (idx >= 0) {
        const prevPrice = coins[idx].price;
        coins[idx] = {
          ...coins[idx],
          price: newPrice,
          change24h: parseFloat(ticker.P),
          volume: parseFloat(ticker.v),
          high: parseFloat(ticker.h),
          low: parseFloat(ticker.l),
          prevPrice,
          flashDirection: newPrice > prevPrice ? 'up' : newPrice < prevPrice ? 'down' : null,
        };
      } else {
        coins.push({
          symbol: ticker.s,
          price: newPrice,
          change24h: parseFloat(ticker.P),
          volume: parseFloat(ticker.v),
          high: parseFloat(ticker.h),
          low: parseFloat(ticker.l),
          prevPrice: newPrice,
          flashDirection: null,
        });
      }
      return { coins };
    }),

  selectedSymbol: 'BTCUSDT',
  setSelectedSymbol: (symbol) => set({ selectedSymbol: symbol }),

  traderState: null,
  setTraderState: (traderState) => set({ traderState }),

  weights: [],
  setWeights: (weights) => set({ weights }),

  openTrades: [],
  setOpenTrades: (openTrades) => set({ openTrades }),

  recentTrades: [],
  setRecentTrades: (recentTrades) => set({ recentTrades }),

  backtestResults: [],
  setBacktestResults: (backtestResults) => set({ backtestResults }),

  currentAnalysis: null,
  setCurrentAnalysis: (currentAnalysis) => set({ currentAnalysis }),

  activityLog: [],
  addLog: (message, type = 'info') =>
    set((state) => ({
      activityLog: [
        { time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }), message, type },
        ...state.activityLog,
      ].slice(0, 50), // keep last 50
    })),

  isLoading: false,
  setIsLoading: (isLoading) => set({ isLoading }),
  backtestLoading: false,
  setBacktestLoading: (backtestLoading) => set({ backtestLoading }),
  autoTrading: false,
  setAutoTrading: (autoTrading) => set({ autoTrading }),
}));