'use client';

import {
  TrendingUp, Zap, Target, ShieldAlert, Activity, BarChart3, BookOpen, X,
  Layers, Radar, Gauge, ArrowRightLeft, Timer, Clock, Scale, ChevronRight,
} from 'lucide-react';
import { useState } from 'react';

// ─── Main Component ───────────────────────────────────────────
export default function ManualDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [activeSection, setActiveSection] = useState<string | null>(null);

  if (!open) return null;

  const toggle = (s: string) => setActiveSection(prev => prev === s ? null : s);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6" onClick={onClose}>
      <div className="fixed inset-0 bg-black/80 backdrop-blur-md" />
      <div
        className="relative w-full max-w-2xl max-h-[90vh] overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0a0a12] shadow-[0_0_80px_rgba(0,0,0,0.6)]"
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="relative px-5 sm:px-6 pt-5 sm:pt-6 pb-4 border-b border-white/[0.06]">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-sky-500/40 to-transparent" />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-sky-500/20 to-violet-500/20 border border-white/[0.08] flex items-center justify-center">
                <BookOpen className="w-4 h-4 text-sky-400" />
              </div>
              <div>
                <h2 className="text-white text-sm font-semibold tracking-tight" style={{ fontFamily: 'var(--font-geist-sans), system-ui, sans-serif' }}>
                  Справка
                </h2>
                <p className="text-[10px] text-white/30 mt-0.5" style={{ fontFamily: 'var(--font-geist-sans), system-ui, sans-serif' }}>
                  Терминал управления торговлей
                </p>
              </div>
            </div>
            <button onClick={onClose} className="p-2 rounded-xl hover:bg-white/[0.05] text-white/20 hover:text-white/50 transition-all duration-200">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* ── Content ── */}
        <div className="overflow-y-auto max-h-[calc(90vh-80px)] px-5 sm:px-6 py-4 space-y-2.5 custom-scrollbar" style={{ fontFamily: 'var(--font-geist-sans), system-ui, sans-serif' }}>

          {/* ─ О системе ─ */}
          <Accordion id="about" icon={<Layers className="w-3.5 h-3.5" />} iconColor="text-sky-400" title="О системе" active={activeSection === 'about'} onToggle={toggle}>
            <div className="space-y-2.5 text-white/60 text-[11px] leading-relaxed">
              <p>
                Мультистратегийная торговая система институционального уровня. Анализирует топ-50
                криптовалют по объёму торгов через 11+ технических индикаторов, корреляцию с биткоином,
                объёмный анализ и детекцию пробоев ключевых уровней.
                           </p>
              <p>
                Каждая сделка проходит <span className="text-white/80 font-medium">6 уровней фильтрации</span> перед открытием.
                Позиции автоматически мониторятся с трейлинг-стопами, защитой от тайм-эксита
                и перерасчётом стоп-лосса/тейк-профита при необходимости.
              </p>
              <div className="grid grid-cols-3 gap-2 pt-1">
                <StatBadge label="Монет" value="50" />
                <StatBadge label="Индикаторов" value="11+" />
                <StatBadge label="Фильтров" value="6" />
              </div>
            </div>
          </Accordion>

          {/* ─ Объёмные режимы ─ */}
          <Accordion id="volume" icon={<BarChart3 className="w-3.5 h-3.5" />} iconColor="text-violet-400" title="Объёмные режимы" active={activeSection === 'volume'} onToggle={toggle}>
            <div className="space-y-3 text-white/60 text-[11px] leading-relaxed">
              <p className="text-white/40 text-[10px] italic">
                Аналог чтения ленты торгов — определение реального направления денег
              </p>
              <div className="space-y-2">
                <FeatureRow label="Всплеск объёмов" desc="Текущий объём относительно скользящей средней. ×2,5 — аномалия, ×4 — экстремум (новости, киты)" />
                <FeatureRow label="Поток объёмов" desc="Чистое направление: покупки минус продажи за 5 свечей. Показывает, куда реально идут деньги" />
                <FeatureRow label="Уровни поддержки/сопротивления" desc="Автоматическая детекция с кластеризацией и подсчётом касаний" />
                <FeatureRow label="Детекция пробоев" desc="Цена пробивает уровень + объём подтверждает пробой = реальное движение" />
              </div>
              <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.06] space-y-1.5">
                <div className="text-[9px] uppercase tracking-widest text-white/30 font-medium">Правила фильтрации</div>
                <FilterRule color="red" text="Пробой вверх + шорт → блокировка" />
                <FilterRule color="red" text="Пробой вниз + лонг → блокировка" />
                <FilterRule color="amber" text="Волатильность по направлению → размер ×0,7" />
                <FilterRule color="amber" text="Волатильность против → размер ×0,4" />
                <FilterRule color="green" text="Объём подтверждает сигнал → размер ×1,15" />
              </div>
            </div>
          </Accordion>

          {/* ─ Стратегии ─ */}
          <Accordion id="strategies" icon={<Target className="w-3.5 h-3.5" />} iconColor="text-amber-400" title="Стратегии" active={activeSection === 'strategies'} onToggle={toggle}>
            <div className="space-y-2.5">
              <StrategyCard
                name="Импульс"
                color="text-amber-400" borderColor="border-amber-500/15" bgGradient="from-amber-500/5"
                timeframe="1 час"
                desc="Жёсткий отбор: 6/8 индикаторов, порог 0.50. Узкий стоп 2×ATR, тейк-профит 1:4. Мало сделок — высокий профит-фактор."
                points={['Тейк-профит 1:4 — одна прибыльная перекрывает 4 убыточных', 'Узкий стоп 2×ATR — минимальные потери', 'Строгий отбор 6/8 индикаторов — только сильные сигналы', 'Фильтр качества входа — не входить на хае/лое', 'Объёмный фильтр — не против пробоя', 'Корреляция с биткоином — не против рынка']}
                params={[{ l: 'Плечо', v: 'до 3×' }, { l: 'Лимит', v: '5 сделок' }, { l: 'Цикл', v: '5 мин' }, { l: 'День', v: '6 сделок' }]}
              />
              <StrategyCard
                name="Скальпер"
                color="text-violet-400" borderColor="border-violet-500/15" bgGradient="from-violet-500/5"
                timeframe="5 мин"
                desc="Быстрая торговля на микро-движениях. Жёсткие критерии входа, узкие стопы, кулдаун после убытка."
                points={['Быстрый вход/выход — минуты и часы', 'Строгий порог — только сильные сигналы', 'Жёсткий стоп-лосс для контроля риска', 'Пауза после стопа на том же инструменте']}
                params={[{ l: 'Плечо', v: 'до 2×' }, { l: 'Лимит', v: '3 сделки' }, { l: 'Цикл', v: '1 мин' }, { l: 'День', v: '8 сделок' }]}
                disabled
              />
              <StrategyCard
                name="Позиционная"
                color="text-cyan-400" borderColor="border-cyan-500/15" bgGradient="from-cyan-500/5"
                timeframe="4 часа"
                desc="Долгосрочная торговля на разворотах тренда. Пересечение скользящих средних, расхождение макродивергенций, объёмный профиль."
                points={['Золотой крест скользящих средних — редкий, но мощный сигнал', 'Широкий стоп — даёт позиции «дышать»', 'Максимальное соотношение прибыли к риску — 1 к 5', 'Только сильные тренды — высокий порог входа']}
                params={[{ l: 'Плечо', v: 'до 2×' }, { l: 'Лимит', v: '3 сделки' }, { l: 'Цикл', v: '30 мин' }, { l: 'День', v: '2 сделки' }]}
              />
            </div>
          </Accordion>

          {/* ─ Риск-менеджмент ─ */}
          <Accordion id="risk" icon={<ShieldAlert className="w-3.5 h-3.5" />} iconColor="text-red-400" title="Риск-менеджмент" active={activeSection === 'risk'} onToggle={toggle}>
            <div className="space-y-3 text-white/60 text-[11px] leading-relaxed">
              <p>Шесть уровней фильтрации защищают капитал:</p>
              <div className="space-y-1.5">
                <FilterLevel num={1} title="Объёмный режим" desc="Блокировка сделок против пробоя уровня" />
                <FilterLevel num={2} title="Корреляция с биткоином" desc="Штраф за конфликт с трендом биткоина" />
                <FilterLevel num={3} title="Старший таймфрейм" desc="Не торговать против глобального направления" />
                <FilterLevel num={4} title="Страж всплесков" desc="7 проверок: волатильность, импульс, риск-аппетит и другие" />
                <FilterLevel num={5} title="Прерыватель просадки" desc="Пауза при серии убыточных сделок" />
                <FilterLevel num={6} title="Дневной лимит убытков" desc="Полная остановка при потере 5% за день" />
              </div>
            </div>
          </Accordion>

          {/* ─ Размер позиции ─ */}
          <Accordion id="sizing" icon={<Scale className="w-3.5 h-3.5" />} iconColor="text-cyan-400" title="Размер позиции" active={activeSection === 'sizing'} onToggle={toggle}>
            <div className="space-y-3 text-white/60 text-[11px] leading-relaxed">
              <p>Прогрессивный размер позиции зависит от депозита:</p>
              <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.06] space-y-1.5 font-mono text-[10px]">
                <SizingRow deposit="до $200" amount="до $8" />
                <SizingRow deposit="$200 – 1 000" amount="до $50" />
                <SizingRow deposit="$1 000 – 5 000" amount="до $150" />
                <SizingRow deposit="$5 000+" amount="до $500" />
                <div className="border-t border-white/[0.06] pt-1.5 mt-2 space-y-0.5 text-white/30 font-sans">
                  <div className="flex items-center gap-1.5"><div className="w-1 h-1 rounded-full bg-white/20" />Максимум 50% свободного баланса на одну сделку</div>
                  <div className="flex items-center gap-1.5"><div className="w-1 h-1 rounded-full bg-white/20" />Объёмный мультипликатор: от ×0,4 до ×1,15</div>
                </div>
              </div>
            </div>
          </Accordion>

          {/* ─ Трейлинг-стопы ─ */}
          <Accordion id="trailing" icon={<TrendingUp className="w-3.5 h-3.5" />} iconColor="text-emerald-400" title="Трейлинг-стопы" active={activeSection === 'trailing'} onToggle={toggle}>
            <div className="space-y-3 text-white/60 text-[11px] leading-relaxed">
              <p>Автоматическое подтягивание стоп-лосса по мере роста прибыли:</p>
              <div className="space-y-2">
                <TrailLevel step={1} desc="Перенос в безубыток" />
                <TrailLevel step={2} desc="Фиксация прибыли" />
                <TrailLevel step={3} desc="Двойная фиксация" />
              </div>
            </div>
          </Accordion>

          {/* ─ Как пользоваться ─ */}
          <Accordion id="howto" icon={<Zap className="w-3.5 h-3.5" />} iconColor="text-yellow-400" title="Как пользоваться" active={activeSection === 'howto'} onToggle={toggle}>
            <div className="space-y-2.5 text-white/60 text-[11px] leading-relaxed">
              <HowToStep num={1} title="Задайте депозит" desc="Нажмите на сумму депозита в панели управления и введите нужную сумму. Баланс пересчитается автоматически с учётом текущих результатов и открытых позиций." />
              <HowToStep num={2} title="Включите автоторговлю" desc="Кнопка в панели управления. Все активные стратегии начнут параллельно сканировать рынок и открывать сделки." />
              <HowToStep num={3} title="Следите за логами" desc="В нижней панели отображаются все действия: сигналы, открытия, закрытия и срабатывания фильтров." />
              <HowToStep num={4} title="Анализ биткоина" desc="Кнопка вверху показывает режим биткоина, корреляции и объёмный профиль. Обновляется автоматически." />
              <HowToStep num={5} title="Перезапуск" desc="Очищает всю историю и устанавливает новый депозит. Полная перезагрузка стратегии." />
              <HowToStep num={6} title="Ручное закрытие" desc="Нажмите на открытую сделку для закрытия по текущей цене в любой момент." />
            </div>
          </Accordion>

        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────

function Accordion({ id, icon, iconColor, title, active, onToggle, children }: {
  id: string; icon: React.ReactNode; iconColor: string; title: string;
  active: boolean; onToggle: (id: string) => void; children: React.ReactNode;
}) {
  return (
    <div className={cn(
      'rounded-xl border transition-all duration-300 overflow-hidden',
      active
        ? 'border-white/[0.08] bg-white/[0.02]'
        : 'border-white/[0.04] hover:border-white/[0.08] hover:bg-white/[0.01]'
    )}>
      <button
        onClick={() => onToggle(id)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left group"
      >
        <span className={iconColor}>{icon}</span>
        <span className="text-[11px] font-semibold text-white/80 tracking-wide flex-1" style={{ fontFamily: 'var(--font-geist-sans), system-ui, sans-serif' }}>{title}</span>
        <ChevronRight className={cn(
          'w-3.5 h-3.5 text-white/20 transition-transform duration-300',
          active && 'rotate-90 text-white/40'
        )} />
      </button>
      {active && (
        <div className="px-4 pb-4 pt-0">
          {children}
        </div>
      )}
    </div>
  );
}

function cn(...classes: (string | false | undefined)[]) {
  return classes.filter(Boolean).join(' ');
}

function StatBadge({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center p-2 rounded-lg bg-white/[0.02] border border-white/[0.04]">
      <div className="text-sm font-bold text-white/80" style={{ fontFamily: 'var(--font-geist-mono), monospace' }}>{value}</div>
      <div className="text-[9px] text-white/30 mt-0.5 uppercase tracking-wider">{label}</div>
    </div>
  );
}

function FeatureRow({ label, desc }: { label: string; desc: string }) {
  return (
    <div className="flex gap-2.5">
      <div className="w-1 rounded-full bg-white/[0.08] shrink-0 mt-0.5" />
      <div>
        <div className="text-white/80 font-medium text-[11px]">{label}</div>
        <div className="text-white/40 text-[10px] mt-0.5">{desc}</div>
      </div>
    </div>
  );
}

function FilterRule({ color, text }: { color: 'red' | 'amber' | 'green'; text: string }) {
  const colors = { red: 'text-red-400/70', amber: 'text-amber-400/70', green: 'text-emerald-400/70' };
  const icons = { red: '⛔', amber: '⚡', green: '📊' };
  return (
    <div className="text-[10px]" style={{ fontFamily: 'var(--font-geist-mono), monospace' }}>
      <span className="opacity-60">{icons[color]}</span>{' '}
      <span className={colors[color]}>{text}</span>
    </div>
  );
}

function FilterLevel({ num, title, desc }: { num: number; title: string; desc: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <div className="w-5 h-5 rounded-lg bg-white/[0.04] border border-white/[0.06] flex items-center justify-center shrink-0 mt-0.5">
        <span className="text-[9px] font-bold text-white/40" style={{ fontFamily: 'var(--font-geist-mono), monospace' }}>{num}</span>
      </div>
      <div>
        <div className="text-white/70 font-medium text-[11px]">{title}</div>
        <div className="text-white/35 text-[10px]">{desc}</div>
      </div>
    </div>
  );
}

function StrategyCard({ name, color, borderColor, bgGradient, timeframe, desc, points, params, disabled }: {
  name: string; color: string; borderColor: string; bgGradient: string;
  timeframe: string; desc: string; points: string[];
  params: { l: string; v: string }[];
  disabled?: boolean;
}) {
  return (
    <div className={cn(
      'p-3.5 rounded-xl border transition-all duration-200',
      borderColor, `bg-gradient-to-br ${bgGradient} to-transparent`,
      disabled && 'opacity-40'
    )}>
      <div className="flex items-center justify-between mb-2">
        <span className={cn('text-[11px] font-bold', color)}>{name}</span>
        <div className="flex items-center gap-2">
          <span className="text-[9px] text-white/25 uppercase tracking-wider" style={{ fontFamily: 'var(--font-geist-mono), monospace' }}>{timeframe}</span>
          {disabled && <span className="text-[8px] px-1.5 py-0.5 rounded-md bg-red-500/10 border border-red-500/20 text-red-400/70 uppercase tracking-wider">выкл</span>}
        </div>
      </div>
      <p className="text-white/40 text-[10px] leading-relaxed mb-2.5">{desc}</p>
      <div className="grid grid-cols-4 gap-1.5 mb-2.5">
        {params.map(p => (
          <div key={p.l} className="text-center p-1.5 rounded-lg bg-white/[0.02] border border-white/[0.04]">
            <div className="text-[8px] text-white/25 uppercase tracking-wider">{p.l}</div>
            <div className="text-[10px] text-white/50 font-medium" style={{ fontFamily: 'var(--font-geist-mono), monospace' }}>{p.v}</div>
          </div>
        ))}
      </div>
      <ul className="space-y-0.5">
        {points.map((p, i) => (
          <li key={i} className="text-[10px] text-emerald-400/50 flex items-start gap-1.5">
            <span className="mt-1.5 w-1 h-1 rounded-full bg-emerald-400/30 shrink-0" />
            {p}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SizingRow({ deposit, amount }: { deposit: string; amount: string }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-white/40">{deposit}</span>
      <span className="text-white/60">{amount}</span>
    </div>
  );
}

function TrailLevel({ step, desc }: { step: number; desc: string }) {
  return (
    <div className="flex items-center gap-3 p-2.5 rounded-lg bg-white/[0.02] border border-white/[0.04]">
      <div className="w-6 h-6 rounded-lg bg-emerald-500/10 border border-emerald-500/15 flex items-center justify-center shrink-0">
        <span className="text-[10px] font-bold text-emerald-400" style={{ fontFamily: 'var(--font-geist-mono), monospace' }}>{step}×</span>
      </div>
      <div className="text-[10px] text-white/60">{desc}</div>
    </div>
  );
}

function HowToStep({ num, title, desc }: { num: number; title: string; desc: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-5 h-5 rounded-lg bg-yellow-500/10 border border-yellow-500/15 flex items-center justify-center shrink-0 mt-0.5">
        <span className="text-[9px] font-bold text-yellow-400" style={{ fontFamily: 'var(--font-geist-mono), monospace' }}>{num}</span>
      </div>
      <div>
        <div className="text-white/80 font-medium text-[11px]">{title}</div>
        <div className="text-white/40 text-[10px] mt-0.5 leading-relaxed">{desc}</div>
      </div>
    </div>
  );
}
