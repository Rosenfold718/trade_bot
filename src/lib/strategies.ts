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

  // Risk management additions
  enabled: boolean;           // стратегия активна (можно отключить без удаления)
  cycleIntervalMs: number;    // интервал авто-цикла в мс (привязан к ТФ)
  cooldownCandles: number;    // кол-во свечей cooldown после SL на символе
  entryStalenessMaxPct: number; // макс. допустимое отклонение цены при входе
  drawdownPausePct: number;   // % просадки за последние N сделок — пауза
  drawdownLookback: number;   // кол-во последних сделок для расчёта просадки
  maxDailyTrades: number;     // макс сделок в день (0 = без лимита)
}

export const STRATEGIES: StrategyConfig[] = [
  // ──────────────────────────────────────────────────────────────
  // Стратегия 1: Импульс Pro
  // Консервативная версия: высокие пороги, широкий стоп, 1:3 R:R
  // ──────────────────────────────────────────────────────────────
  {
    id: 'momentum',
    name: 'Импульс Pro',
    description: 'CORE+TRAIL: SL 3×ATR, RR 1:2.5, TE 8h, безубыток + трейлинг. ADX как индикатор. Скан каждые 2ч. ≥6 индикаторов, score > 0.50.',
    color: 'text-amber-400',
    bgColor: 'bg-amber-500/10',
    borderColor: 'border-amber-500/30',
    chartIndicators: {
      sma7: { visible: false, color: '#f59e0b' },
      sma25: { visible: false, color: '#fbbf24' },
      sma99: { visible: false, color: '#d97706' },
      ema12: { visible: false, color: '#f97316' },
      ema26: { visible: false, color: '#fb923c' },
      bb: { visible: false },
      sr: { visible: false },
      swings: { visible: false },
    },
    maxLeverage: 3,
    riskRewardRatio: 2.5,         // CORE+TRAIL: RR 2.5 (было 4)
    tradeSizePercent: 0.06,
    maxOpenTrades: 4,         // CORE+TRAIL: макс 4 (было 5)
    scoreThreshold: 0.50,     // CORE+TRAIL: порог 0.50 (было 0.58)
    adxMin: null,               // CORE+TRAIL: ADX как индикатор, не фильтр
    mtfEnabled: true,
    timeFilterEnabled: false,
    timeFilterStart: 0,
    timeFilterEnd: 0,
    defaultInterval: '1h',
    candleLimit: 1440,
    monitorInterval: '1h',
    maxHoldMinutes: 480, // CORE+TRAIL: 8 часов (было 14)
    enabled: true,
    cycleIntervalMs: 5 * 60 * 1000,  // 5 минут (1h ТФ — нет смысла чаще)
    cooldownCandles: 4,             // 4 часа cooldown после SL на символе
    entryStalenessMaxPct: 0.003,    // 0.3% — строгий для 1h
    drawdownPausePct: 10,           // пауза при 10% просадке
    drawdownLookback: 5,            // за последние 5 сделок
    maxDailyTrades: 3,              // CORE+TRAIL: макс 3 сделки в день
  },

  // ──────────────────────────────────────────────────────────────
  // Стратегия 2: Pattern Pro
  // Распознавание свечных фигур с реальной статистикой
  // ──────────────────────────────────────────────────────────────
  {
    id: 'scalper',
    name: 'Pattern Pro',
    description: 'Свечные фигуры: Молот, Поглощение, Утренняя/Вечерняя звезда, Двойное дно/вершина, Клин, Флаг. Bulkowski статистика. SL 1.5×ATR, TP по фигуре.',
    color: 'text-violet-400',
    bgColor: 'bg-violet-500/10',
    borderColor: 'border-violet-500/30',
    chartIndicators: {
      sma7: { visible: false },
      sma25: { visible: false },
      sma99: { visible: false },
      ema12: { visible: false, color: '#a78bfa' },
      ema26: { visible: false },
      bb: { visible: false, color: '#c084fc' },
      'bb-middle': { visible: false, color: '#a78bfa' },
      sr: { visible: false },
      swings: { visible: false },
    },
    maxLeverage: 3,
    riskRewardRatio: 1.5,
    tradeSizePercent: 0.04,
    maxOpenTrades: 4,
    scoreThreshold: 0.35,
    adxMin: null,
    mtfEnabled: false,
    timeFilterEnabled: false,
    timeFilterStart: 0,
    timeFilterEnd: 0,
    defaultInterval: '15m',
    candleLimit: 500,
    monitorInterval: '15m',
    maxHoldMinutes: 240, // 4 часа макс удержание (фигурам нужно время)
    enabled: true,
    cycleIntervalMs: 3 * 60 * 1000,  // 3 минуты (15m ТФ)
    cooldownCandles: 4,            // 1 час cooldown после SL
    entryStalenessMaxPct: 0.003,   // 0.3%
    drawdownPausePct: 10,
    drawdownLookback: 5,
    maxDailyTrades: 6,
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
      ema12: { visible: false, color: '#60a5fa' },
      ema26: { visible: false, color: '#93c5fd' },
      bb: { visible: false },
      'bb-middle': { visible: false },
      sr: { visible: false },
      swings: { visible: false },
    },
    maxLeverage: 2,
    riskRewardRatio: 5,
    tradeSizePercent: 0.04,
    maxOpenTrades: 3,              // ↓ с 10 до 3
    scoreThreshold: 0.30,
    adxMin: 30,
    mtfEnabled: true,
    timeFilterEnabled: false,
    timeFilterStart: 0,
    timeFilterEnd: 0,
    defaultInterval: '4h',
    candleLimit: 500,
    monitorInterval: '4h',
    maxHoldMinutes: 10080, // 7 дней максимальное удержание
    enabled: true,
    cycleIntervalMs: 30 * 60 * 1000, // 30 минут (4h ТФ — редко проверяем)
    cooldownCandles: 2,               // 8 часов cooldown после SL
    entryStalenessMaxPct: 0.005,      // 0.5% — допустимо для широких позиций
    drawdownPausePct: 12,             // пауза при 12% просадке
    drawdownLookback: 5,
    maxDailyTrades: 2,                // макс 2 сделки в день
  },
];

export function getStrategy(id: string): StrategyConfig | undefined {
  return STRATEGIES.find(s => s.id === id);
}
