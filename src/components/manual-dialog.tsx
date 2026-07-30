'use client';

import { Brain, TrendingUp, Zap, Target, ShieldAlert, Activity, BarChart3, BookOpen, X } from 'lucide-react';

export default function ManualDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm" />
      <div
        className="relative bg-[#0d0d14] border border-white/10 rounded-2xl max-w-2xl w-full max-h-[85vh] overflow-y-auto shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-[#0d0d14] border-b border-white/5 p-4 sm:p-5 flex items-center justify-between z-10">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
              <BookOpen className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <h2 className="text-white text-sm font-bold">Руководство пользователя</h2>
              <p className="text-[10px] text-white/30">AI Trading Terminal — Aladdin-class risk management</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/5 text-white/30 hover:text-white/60 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 sm:p-5 space-y-5 text-white/70 text-xs leading-relaxed">
          {/* Intro */}
          <Section icon={<Brain className="w-4 h-4 text-emerald-400" />} title="О системе">
            <p>
              Это мультистратегийная AI-торговая система, аналогичная institutional-платформам уровня BlackRock Aladdin.
              Система анализирует топ-50 криптовалют по объёму, использует 11+ технических индикаторов, корреляцию с BTC,
              объёмный анализ ленты (tape reading), детекцию пробоев уровней S/R и режимов рынка.
            </p>
            <p className="mt-2">
              Каждая сделка проходит через 6 уровней фильтрации перед открытием. Позиции автоматически
              мониторятся с трейлинг-стопами и тайм-экситами.
            </p>
          </Section>

          {/* Volume Regime */}
          <Section icon={<BarChart3 className="w-4 h-4 text-violet-400" />} title="Система Volume Regime (объёмные режимы)">
            <p>Новая система, аналогичная чтению ленты (tape reading) из «Привода Бондаря»:</p>
            <ul className="mt-1.5 space-y-1 ml-3">
              <li><strong>Volume Spike</strong> — текущий объём vs скользящее среднее (×2.5 = аномалия, ×4 = экстремум/новости)</li>
              <li><strong>Volume Flow</strong> — чистое направление денежных потоков (покупки vs продажи за 5 свечей)</li>
              <li><strong>S/R уровни</strong> — автоматическая детекция поддержки/сопротивления с подсчётом касаний</li>
              <li><strong>Пробой S/R</strong> — цена пробивает уровень + объём подтверждает = реальный пробой</li>
            </ul>
            <div className="mt-2 p-2.5 rounded-lg bg-white/[0.03] border border-white/5 text-[10px] font-mono">
              <div className="text-white/40 mb-1">Правила фильтрации:</div>
              <div>⛔ <span className="text-red-400">BREAKOUT_UP + шорт</span> → блок (не шортить памп)</div>
              <div>⛔ <span className="text-red-400">BREAKOUT_DOWN + лонг</span> → блок (не лонговать дамп)</div>
              <div>⚡ <span className="text-amber-400">Волатильность по направлению</span> → размер ×0.7</div>
              <div>⚡ <span className="text-amber-400">Волатильность против направления</span> → размер ×0.4</div>
              <div>📊 <span className="text-emerald-400">Объём подтверждает сигнал</span> → размер ×1.15, скор ×1.1</div>
            </div>
          </Section>

          {/* Strategies */}
          <Section icon={<Target className="w-4 h-4 text-amber-400" />} title="Стратегии">
            <StrategyCard
              name="Импульс Pro"
              color="text-amber-400"
              interval="1H"
              desc="Следование за сильным трендом. Требует ADX > 25, ≥6/10 индикаторов, score > 0.35."
              pros={["Широкий стоп 2.5× ATR — не выбивает шумом", "TP 1:3 R:R — асимметричный профит", "MTF фильтр — не торгует против старшего ТФ", "BTC корреляция — не торгует против рынка"]}
              config={{ leverage: 'до 3x', maxTrades: 5, cycle: '5 мин', maxDaily: 6, hold: '12ч' }}
            />
            <StrategyCard
              name="Scalp Hunter"
              color="text-violet-400"
              interval="5M"
              desc="Скальпинг на микро-движениях. StochRSI, Bollinger squeeze, volume spikes."
              pros={["Быстрый вход/выход — минуты/часы", "Строгий порог score > 0.40 — только сильные сигналы", "Стоп 1.2× ATR (мин 0.5%) — жёсткий риск-менеджмент", "Кулдаун 30 мин после SL на символе"]}
              config={{ leverage: 'до 2x', maxTrades: 3, cycle: '1 мин', maxDaily: 8, hold: '1ч' }}
              disabled
            />
            <StrategyCard
              name="Position Alpha"
              color="text-blue-400"
              interval="4H"
              desc="Позиционная торговля на разворотах. EMA50/200 crossover, MACD divergence, OBV."
              pros={['Золотой крест EMA50/200 — редкий, но мощный сигнал', 'Широкий стоп 4× ATR — даёт позиции дышать', 'TP 1:5 R:R — максимальное соотношение', 'ADX > 30 — только сильные тренды']}
              config={{ leverage: 'до 2x', maxTrades: 3, cycle: '30 мин', maxDaily: 2, hold: '7 дней' }}
            />
          </Section>

          {/* Risk Management */}
          <Section icon={<ShieldAlert className="w-4 h-4 text-red-400" />} title="Риск-менеджмент (6 уровней фильтрации)">
            <ol className="space-y-1.5 ml-3 list-decimal">
              <li><strong>Volume Regime</strong> — блокировка контр-пробойных сделок</li>
              <li><strong>BTC корреляция</strong> — штраф 30% за конфликт с BTC трендом</li>
              <li><strong>MTF фильтр</strong> — не торговать против старшего таймфрейма</li>
              <li><strong>Spike Guard</strong> — 7 проверок: ATR ratio, ROC, FOMO, RSI, EMA distance, CCI, свечная форма</li>
              <li><strong>Drawdown circuit breaker</strong> — пауза при просадке за последние N сделок</li>
              <li><strong>Дневной лимит убытков</strong> — стоп торговли при -5% за день</li>
            </ol>
          </Section>

          {/* Position Sizing */}
          <Section icon={<Activity className="w-4 h-4 text-cyan-400" />} title="Размер позиции (прогрессивный)">
            <div className="p-2.5 rounded-lg bg-white/[0.03] border border-white/5 font-mono text-[10px] space-y-0.5">
              <div>Баланс &lt; $200: <span className="text-white/50">max(1.5, min(8% от баланса, $8))</span></div>
              <div>Баланс $200–1000: <span className="text-white/50">max(5, min(5%, $50))</span></div>
              <div>Баланс $1000–5000: <span className="text-white/50">max(20, min(3%, $150))</span></div>
              <div>Баланс $5000+: <span className="text-white/50">max(50, min(2%, $500))</span></div>
              <div className="text-white/30 mt-1">+ Ограничение: не более 50% свободного баланса на сделку</div>
              <div className="text-white/30">+ Volume Regime мультипликатор: ×0.4–1.15 в зависимости от режима</div>
            </div>
          </Section>

          {/* How to Use */}
          <Section icon={<Zap className="w-4 h-4 text-yellow-400" />} title="Как пользоваться">
            <ol className="space-y-2 ml-3 list-decimal">
              <li><strong>Задайте депозит</strong> — нажмите на сумму депозита в панели управления, введите нужную сумму. Баланс пересчитается автоматически с учётом текущих PnL и открытых позиций.</li>
              <li><strong>Включите авто-трейдинг</strong> — кнопка в панели управления. Все активные стратегии начнут сканировать рынок параллельно.</li>
              <li><strong>Следите за логами</strong> — в нижней панели отображаются все действия: сигналы, открытия, закрытия, фильтры (Volume Regime, BTC, MTF).</li>
              <li><strong>Анализ BTC</strong> — кнопка вверху показывает режим BTC, корреляции и объёмный профиль. Обновляется каждые 5 минут.</li>
              <li><strong>Перезапуск стратегии</strong> — очищает всю историю и устанавливает новый депозит. Полная перезагрузка.</li>
              <li><strong>Ручное закрытие</strong> — нажмите на открытую сделку для ручного закрытия по текущей цене.</li>
            </ol>
          </Section>

          {/* Trailing Stops */}
          <Section icon={<TrendingUp className="w-4 h-4 text-emerald-400" />} title="Трейлинг-стопы">
            <p>Система автоматически подтягивает стоп-лосс по мере роста прибыли:</p>
            <ul className="mt-1.5 space-y-1 ml-3">
              <li><strong>1× расстояние SL</strong> → перенос в безубыток (breakeven)</li>
              <li><strong>2× расстояние SL</strong> → фиксация прибыли (lock profit)</li>
              <li><strong>3× расстояние SL</strong> → двойная фиксация (lock 2× profit)</li>
            </ul>
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <h3 className="text-white text-xs font-bold uppercase tracking-wider">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function StrategyCard({ name, color, interval, desc, pros, config, disabled }: {
  name: string; color: string; interval: string; desc: string; pros: string[];
  config: { leverage: string; maxTrades: number; cycle: string; maxDaily: number; hold: string };
  disabled?: boolean;
}) {
  return (
    <div className={`p-3 rounded-lg border ${disabled ? 'border-white/5 bg-white/[0.01] opacity-50' : 'border-white/[0.08] bg-white/[0.02]'}`}>
      <div className="flex items-center justify-between mb-1">
        <span className={`font-bold text-[11px] ${color}`}>{name}</span>
        <div className="flex items-center gap-2 text-[9px] text-white/30 font-mono">
          <span>{interval}</span>
          {disabled && <span className="text-red-400/60">ОТКЛЮЧЕН</span>}
        </div>
      </div>
      <p className="text-white/40 text-[10px] mb-2">{desc}</p>
      <div className="grid grid-cols-5 gap-1 text-[9px] font-mono text-white/25 mb-2">
        <div>Плечо: <span className="text-white/40">{config.leverage}</span></div>
        <div>Лимит: <span className="text-white/40">{config.maxTrades}</span></div>
        <div>Цикл: <span className="text-white/40">{config.cycle}</span></div>
        <div>День: <span className="text-white/40">{config.maxDaily}</span></div>
        <div>Холд: <span className="text-white/40">{config.hold}</span></div>
      </div>
      <ul className="space-y-0.5">
        {pros.map((p, i) => <li key={i} className="text-[10px] text-emerald-400/50">+ {p}</li>)}
      </ul>
    </div>
  );
}
