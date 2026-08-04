// ============================================================
// Мультисигнатурная торговая система — Определения стратегий
// ============================================================

export interface StrategyConfig {
  id: string;
  name: string;
  description: string;
  color: string;
  bgColor: string;
  borderColor: string;

  // Видимость индикаторов на графике
  chartIndicators: Record<string, { visible: boolean; color?: string }>;

  // Торговые параметры
  maxLeverage: number;
  riskRewardRatio: number;    // TP = SL * this
  tradeSizePercent: number;   // % от баланса на сделку
  maxOpenTrades: number;

  // Параметры движка
  scoreThreshold: number;
  adxMin: number | null;      // null = без фильтра ADX
  mtfEnabled: boolean;
  timeFilterEnabled: boolean;
  timeFilterStart: number;    // час по московскому времени (0-23)
  timeFilterEnd: number;
  defaultInterval: string;    // таймфрейм свечей для этой стратегии ('1m', '5m', '15m', '1h', '4h', '1d')
  candleLimit: number;        // лимит свечей для запроса
  monitorInterval: string;     // таймфрейм для мониторинга SL/TP ('1m', '5m', '1h')
  maxHoldMinutes: number;     // максимальное время удержания сделки в минутах

  // Advanced control fields
  enabled: boolean;
  cycleIntervalMs: number;
  cooldownCandles: number;
  entryStalenessMaxPct: number;
  drawdownPausePct: number;
  drawdownLookback: number;
  maxDailyTrades: number;
}

export const STRATEGIES: StrategyConfig[] = [
  // Strategy 1: Трендовая торговля — Trend following
  {
    id: 'momentum',
    name: 'Трендовая торговля',
    description: 'Trend following: ADX>20, ≥5/10 indicators agree, score>0.20. SL 3×ATR, TP 1:3 R:R. Trailing stop after 1R.',
    color: 'text-amber-400',
    bgColor: 'bg-amber-500/10',
    borderColor: 'border-amber-500/30',
    chartIndicators: {
      sma7: { visible: false }, sma25: { visible: false }, sma99: { visible: false },
      ema12: { visible: false, color: '#f97316' }, ema26: { visible: false, color: '#fb923c' },
      bb: { visible: false }, sr: { visible: false }, swings: { visible: false },
    },
    maxLeverage: 5,
    riskRewardRatio: 3,
    tradeSizePercent: 0.10,
    maxOpenTrades: 5,
    scoreThreshold: 0.20,
    adxMin: 20,
    mtfEnabled: true,
    timeFilterEnabled: false,
    timeFilterStart: 0,
    timeFilterEnd: 0,
    defaultInterval: '1h',
    candleLimit: 1440,
    monitorInterval: '1h',
    maxHoldMinutes: 480,
    enabled: true,
    cycleIntervalMs: 5 * 60 * 1000,
    cooldownCandles: 3,
    entryStalenessMaxPct: 0.005,
    drawdownPausePct: 15,
    drawdownLookback: 5,
    maxDailyTrades: 5,
  },

  // Strategy 2: Паттерны — Candlestick pattern recognition
  {
    id: 'scalper',
    name: 'Паттерны',
    description: 'Candlestick patterns: Morning/Evening Star, Flags, Wedges, Double Bottom. SL 2×ATR, TP 2-3R, partial TP, trailing.',
    color: 'text-violet-400',
    bgColor: 'bg-violet-500/10',
    borderColor: 'border-violet-500/30',
    chartIndicators: {
      sma7: { visible: false }, sma25: { visible: false }, sma99: { visible: false },
      ema12: { visible: false, color: '#a78bfa' }, ema26: { visible: false },
      bb: { visible: false, color: '#c084fc' }, 'bb-middle': { visible: false, color: '#a78bfa' },
      sr: { visible: false }, swings: { visible: false },
    },
    maxLeverage: 5,
    riskRewardRatio: 2.5,
    tradeSizePercent: 0.08,
    maxOpenTrades: 5,
    scoreThreshold: 0.20,
    adxMin: null,
    mtfEnabled: false,
    timeFilterEnabled: false,
    timeFilterStart: 0,
    timeFilterEnd: 0,
    defaultInterval: '15m',
    candleLimit: 500,
    monitorInterval: '15m',
    maxHoldMinutes: 480,
    enabled: true,
    cycleIntervalMs: 3 * 60 * 1000,
    cooldownCandles: 3,
    entryStalenessMaxPct: 0.005,
    drawdownPausePct: 15,
    drawdownLookback: 5,
    maxDailyTrades: 8,
  },

  // Strategy 3: Инвестиции — Long-term position trading
  {
    id: 'position-alpha',
    name: 'Инвестиции',
    description: 'Position trading: EMA50/200 crossover, MACD, OBV. SL 4×ATR, TP 1:5 R:R. Hold days-weeks.',
    color: 'text-blue-400',
    bgColor: 'bg-blue-500/10',
    borderColor: 'border-blue-500/30',
    chartIndicators: {
      sma7: { visible: false }, sma25: { visible: false }, sma99: { visible: false },
      ema12: { visible: false, color: '#60a5fa' }, ema26: { visible: false, color: '#93c5fd' },
      bb: { visible: false }, 'bb-middle': { visible: false },
      sr: { visible: false }, swings: { visible: false },
    },
    maxLeverage: 3,
    riskRewardRatio: 5,
    tradeSizePercent: 0.06,
    maxOpenTrades: 3,
    scoreThreshold: 0.25,
    adxMin: 25,
    mtfEnabled: true,
    timeFilterEnabled: false,
    timeFilterStart: 0,
    timeFilterEnd: 0,
    defaultInterval: '4h',
    candleLimit: 500,
    monitorInterval: '4h',
    maxHoldMinutes: 10080,
    enabled: true,
    cycleIntervalMs: 30 * 60 * 1000,
    cooldownCandles: 2,
    entryStalenessMaxPct: 0.008,
    drawdownPausePct: 20,
    drawdownLookback: 5,
    maxDailyTrades: 2,
  },
];

export function getStrategy(id: string): StrategyConfig | undefined {
  return STRATEGIES.find(s => s.id === id);
}
