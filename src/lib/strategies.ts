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
}

export const STRATEGIES: StrategyConfig[] = [
  // ──────────────────────────────────────────────────────────────
  // Стратегия 1: Импульс Pro
  // Консервативная версия: высокие пороги, широкий стоп, 1:3 R:R
  // ──────────────────────────────────────────────────────────────
  {
    id: 'momentum',
    name: 'Импульс Pro',
    description: 'Следование за сильным трендом. Требует ADX > 25, ≥6/10 индикаторов, score > 0.35. Стоп 2.5× ATR, TP 1:3. Проверка SL/TP по закрытию 1H свечи.',
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
    defaultInterval: '1h',
    candleLimit: 1440,
    monitorInterval: '1h',
    maxHoldMinutes: 720, // 12 часов
  },

  // ──────────────────────────────────────────────────────────────
  // Стратегия 2: Scalp Hunter
  // Скальпинг: множество быстрых сделок на микро-движениях
  // ──────────────────────────────────────────────────────────────
  {
    id: 'scalper',
    name: 'Scalp Hunter',
    description: 'Скальпинг: множество быстрых сделок на микро-движениях. StochRSI, Bollinger squeeze, volume spikes, VWAP deviation. Узкий стоп 0.8× ATR, TP 1:1.5. Удержание: минуты–часы.',
    color: 'text-violet-400',
    bgColor: 'bg-violet-500/10',
    borderColor: 'border-violet-500/30',
    chartIndicators: {
      sma7: { visible: false },
      sma25: { visible: false },
      sma99: { visible: false },
      ema12: { visible: true, color: '#a78bfa' },
      ema26: { visible: false },
      bb: { visible: true, color: '#c084fc' },
      'bb-middle': { visible: true, color: '#a78bfa' },
      sr: { visible: false },
      swings: { visible: false },
    },
    maxLeverage: 2,
    riskRewardRatio: 1.5,
    tradeSizePercent: 0.03,
    maxOpenTrades: 5,
    scoreThreshold: 0.15,
    adxMin: null,
    mtfEnabled: false,
    timeFilterEnabled: false,
    timeFilterStart: 0,
    timeFilterEnd: 0,
    defaultInterval: '5m',
    candleLimit: 500,
    monitorInterval: '5m',
    maxHoldMinutes: 60, // 1 час максимальное удержание
  },

  // ──────────────────────────────────────────────────────────────
  // Стратегия 3: Position Alpha
  // Позиционная торговля: редкие входы на сильных разворотах
  // ──────────────────────────────────────────────────────────────
  {
    id: 'position-alpha',
    name: 'Position Alpha',
    description: 'Позиционная торговля: редкие входы на сильных разворотах. EMA50/200 crossover, MACD divergence, OBV долгосрочный тренд. Широкий стоп 4× ATR, TP 1:5. Удержание: дни–неделя.',
    color: 'text-blue-400',
    bgColor: 'bg-blue-500/10',
    borderColor: 'border-blue-500/30',
    chartIndicators: {
      sma7: { visible: false },
      sma25: { visible: false },
      sma99: { visible: false },
      ema12: { visible: true, color: '#60a5fa' },
      ema26: { visible: true, color: '#93c5fd' },
      bb: { visible: false },
      'bb-middle': { visible: false },
      sr: { visible: true },
      swings: { visible: true },
    },
    maxLeverage: 2,
    riskRewardRatio: 5,
    tradeSizePercent: 0.04,
    maxOpenTrades: 2,
    scoreThreshold: 0.40,
    adxMin: 30,
    mtfEnabled: true,
    timeFilterEnabled: false,
    timeFilterStart: 0,
    timeFilterEnd: 0,
    defaultInterval: '4h',
    candleLimit: 500,
    monitorInterval: '4h',
    maxHoldMinutes: 10080, // 7 дней максимальное удержание
  },
];

export function getStrategy(id: string): StrategyConfig | undefined {
  return STRATEGIES.find(s => s.id === id);
}
