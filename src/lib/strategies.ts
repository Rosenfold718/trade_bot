// ============================================================
// Multi-Strategy Trading System — Strategy Definitions
// ============================================================

export interface StrategyConfig {
  id: string;
  name: string;
  description: string;
  color: string;
  bgColor: string;
  borderColor: string;

  // Indicator visibility for chart
  chartIndicators: Record<string, { visible: boolean; color?: string }>;

  // Trading parameters
  maxLeverage: number;
  riskRewardRatio: number;    // TP = SL * this
  tradeSizePercent: number;   // % of balance per trade
  maxOpenTrades: number;

  // Engine parameters
  scoreThreshold: number;
  adxMin: number | null;      // null = no ADX filter
  mtfEnabled: boolean;
  timeFilterEnabled: boolean;
  timeFilterStart: number;    // hour in Moscow time (0-23)
  timeFilterEnd: number;
}

export const STRATEGIES: StrategyConfig[] = [
  // ──────────────────────────────────────────────────────────────
  // Strategy 1: Momentum Pro
  // ──────────────────────────────────────────────────────────────
  {
    id: 'momentum',
    name: 'Momentum Pro',
    description: 'Aggressive momentum following with all 10 indicators. Requires strong trend (ADX > 20) and multi-timeframe confirmation.',
    color: 'text-amber-400',
    bgColor: 'bg-amber-500/10',
    borderColor: 'border-amber-500/30',
    chartIndicators: {
      sma7: { visible: true, color: '#f59e0b' },
      sma25: { visible: true, color: '#fbbf24' },
      sma99: { visible: true, color: '#d97706' },
      ema12: { visible: true, color: '#f97316' },
      ema26: { visible: true, color: '#fb923c' },
      bb: { visible: true },
      sr: { visible: true },
      swings: { visible: true },
    },
    maxLeverage: 5,
    riskRewardRatio: 2,
    tradeSizePercent: 0.10,
    maxOpenTrades: 10,
    scoreThreshold: 0.15,
    adxMin: 20,
    mtfEnabled: true,
    timeFilterEnabled: false,
    timeFilterStart: 0,
    timeFilterEnd: 0,
  },

  // ──────────────────────────────────────────────────────────────
  // Strategy 2: Mean Reversion
  // ──────────────────────────────────────────────────────────────
  {
    id: 'mean-reversion',
    name: 'Mean Reversion',
    description: 'Fades overextended moves using RSI, Bollinger Bands and StochRSI. Best in ranging markets. Time-filtered (10:00–23:00 MSK).',
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-500/10',
    borderColor: 'border-emerald-500/30',
    chartIndicators: {
      sma7: { visible: false },
      sma25: { visible: true, color: '#10b981' },
      sma99: { visible: false },
      ema12: { visible: false },
      ema26: { visible: false },
      bb: { visible: true, color: '#34d399' },
      'bb-middle': { visible: true, color: '#6ee7b7' },
      sr: { visible: true },
      swings: { visible: false },
    },
    maxLeverage: 3,
    riskRewardRatio: 1.5,
    tradeSizePercent: 0.08,
    maxOpenTrades: 5,
    scoreThreshold: 0.1,
    adxMin: null,
    mtfEnabled: false,
    timeFilterEnabled: true,
    timeFilterStart: 10,
    timeFilterEnd: 23,
  },

  // ──────────────────────────────────────────────────────────────
  // Strategy 3: Trend Pullback
  // ──────────────────────────────────────────────────────────────
  {
    id: 'trend-pullback',
    name: 'Trend Pullback',
    description: 'Enters on pullbacks to EMA21 in established trends. Requires ADX > 25 for strong trend confirmation.',
    color: 'text-cyan-400',
    bgColor: 'bg-cyan-500/10',
    borderColor: 'border-cyan-500/30',
    chartIndicators: {
      sma7: { visible: false },
      sma25: { visible: false },
      sma99: { visible: false },
      ema12: { visible: true, color: '#06b6d4' },
      ema26: { visible: true, color: '#22d3ee' },
      bb: { visible: false },
      sr: { visible: true },
      swings: { visible: true },
    },
    maxLeverage: 5,
    riskRewardRatio: 2,
    tradeSizePercent: 0.10,
    maxOpenTrades: 5,
    scoreThreshold: 0.12,
    adxMin: 25,
    mtfEnabled: true,
    timeFilterEnabled: false,
    timeFilterStart: 0,
    timeFilterEnd: 0,
  },
];

export function getStrategy(id: string): StrategyConfig | undefined {
  return STRATEGIES.find(s => s.id === id);
}