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
}

export const STRATEGIES: StrategyConfig[] = [
  // ──────────────────────────────────────────────────────────────
  // Стратегия 1: Импульс Pro
  // Консервативная версия: высокие пороги, широкий стоп, 1:3 R:R
  // ──────────────────────────────────────────────────────────────
  {
    id: 'momentum',
    name: 'Импульс Pro',
    description: 'Следование за сильным трендом. Требует ADX > 25, ≥6/10 индикаторов, score > 0.35. Стоп 1.5× ATR, TP 1:3.',
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
    maxLeverage: 3,
    riskRewardRatio: 3,
    tradeSizePercent: 0.06,
    maxOpenTrades: 5,
    scoreThreshold: 0.35,
    adxMin: 25,
    mtfEnabled: true,
    timeFilterEnabled: false,
    timeFilterStart: 0,
    timeFilterEnd: 0,
  },

  // ──────────────────────────────────────────────────────────────
  // Стратегия 2: Возврат к среднему
  // Все 3 индикатора должны соглашаться + фильтр EMA-50
  // ──────────────────────────────────────────────────────────────
  {
    id: 'mean-reversion',
    name: 'Возврат к среднему',
    description: 'Торговля на экстремальных отклонениях. Все 3 индикатора + EMA-50 тренд. Время 10:00–23:00 МСК.',
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
    maxLeverage: 2,
    riskRewardRatio: 2.5,
    tradeSizePercent: 0.05,
    maxOpenTrades: 3,
    scoreThreshold: 0.25,
    adxMin: null,
    mtfEnabled: false,
    timeFilterEnabled: true,
    timeFilterStart: 10,
    timeFilterEnd: 23,
  },

  // ──────────────────────────────────────────────────────────────
  // Стратегия 3: Тренд на откатах
  // Более широкая зона отката, RSI фильтр истощения
  // ──────────────────────────────────────────────────────────────
  {
    id: 'trend-pullback',
    name: 'Тренд на откатах',
    description: 'Вход на откатах к EMA21 в сильном тренде. ADX > 25, ≥4/6 согласия, RSI фильтр, стоп 1.5× ATR.',
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
    maxLeverage: 3,
    riskRewardRatio: 3,
    tradeSizePercent: 0.06,
    maxOpenTrades: 3,
    scoreThreshold: 0.30,
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
