import { create } from 'zustand';
import type { CoinPrice, TraderState, Trade, IndicatorWeight, BacktestResult, TradingDecision } from '@/lib/types';

interface StrategySnapshot {
  traderState: TraderState | null;
  openTrades: Trade[];
  recentTrades: Trade[];
}

interface TerminalStore {
  // Coin prices
  coins: CoinPrice[];
  setCoins: (coins: CoinPrice[]) => void;
  updateCoinPrice: (ticker: { s: string; c: string; P: string; v: string; h: string; l: string; o: string }) => void;

  // Selected symbol
  selectedSymbol: string;
  setSelectedSymbol: (symbol: string) => void;

  // Strategy selection
  activeStrategy: string;
  setActiveStrategy: (id: string) => void;

  // Per-strategy states (keyed by strategy id)
  strategyStates: Record<string, StrategySnapshot>;

  // Trader state — computed alias from strategyStates[activeStrategy]
  traderState: TraderState | null;
  setTraderState: (state: TraderState) => void;

  // Indicator weights
  weights: IndicatorWeight[];
  setWeights: (weights: IndicatorWeight[]) => void;

  // Open trades — computed alias from strategyStates[activeStrategy]
  openTrades: Trade[];
  setOpenTrades: (trades: Trade[]) => void;

  // Recent trades — computed alias from strategyStates[activeStrategy]
  recentTrades: Trade[];
  setRecentTrades: (trades: Trade[]) => void;

  // Per-strategy setters
  setStrategyTraderState: (strategyId: string, state: TraderState) => void;
  setStrategyOpenTrades: (strategyId: string, trades: Trade[]) => void;
  setStrategyRecentTrades: (strategyId: string, trades: Trade[]) => void;

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

  // Strategy selection
  activeStrategy: 'momentum',
  setActiveStrategy: (id) => set((state) => {
    const ss = state.strategyStates[id];
    return {
      activeStrategy: id,
      traderState: ss?.traderState ?? null,
      openTrades: ss?.openTrades ?? [],
      recentTrades: ss?.recentTrades ?? [],
    };
  }),

  // Per-strategy states
  strategyStates: {},

  // Trader state — also syncs into strategyStates[activeStrategy]
  traderState: null,
  setTraderState: (traderState) => set((state) => {
    const id = state.activeStrategy;
    return {
      traderState,
      strategyStates: {
        ...state.strategyStates,
        [id]: { ...state.strategyStates[id], traderState },
      },
    };
  }),

  weights: [],
  setWeights: (weights) => set({ weights }),

  // Open trades — also syncs into strategyStates[activeStrategy]
  openTrades: [],
  setOpenTrades: (openTrades) => set((state) => {
    const id = state.activeStrategy;
    return {
      openTrades,
      strategyStates: {
        ...state.strategyStates,
        [id]: { ...state.strategyStates[id], openTrades },
      },
    };
  }),

  // Recent trades — also syncs into strategyStates[activeStrategy]
  recentTrades: [],
  setRecentTrades: (recentTrades) => set((state) => {
    const id = state.activeStrategy;
    return {
      recentTrades,
      strategyStates: {
        ...state.strategyStates,
        [id]: { ...state.strategyStates[id], recentTrades },
      },
    };
  }),

  // Per-strategy setters — update strategyStates and sync if active
  setStrategyTraderState: (strategyId, traderState) => set((state) => ({
    strategyStates: {
      ...state.strategyStates,
      [strategyId]: { ...state.strategyStates[strategyId], traderState },
    },
    // If this is the active strategy, also update the alias
    ...(state.activeStrategy === strategyId ? { traderState } : {}),
  })),

  setStrategyOpenTrades: (strategyId, openTrades) => set((state) => ({
    strategyStates: {
      ...state.strategyStates,
      [strategyId]: { ...state.strategyStates[strategyId], openTrades },
    },
    ...(state.activeStrategy === strategyId ? { openTrades } : {}),
  })),

  setStrategyRecentTrades: (strategyId, recentTrades) => set((state) => ({
    strategyStates: {
      ...state.strategyStates,
      [strategyId]: { ...state.strategyStates[strategyId], recentTrades },
    },
    ...(state.activeStrategy === strategyId ? { recentTrades } : {}),
  })),

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
  autoTrading: true,
  setAutoTrading: (autoTrading) => set({ autoTrading }),
}));