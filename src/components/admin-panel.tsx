'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { STRATEGIES, type StrategyConfig } from '@/lib/strategies';
import { invalidateSettingsCache } from '@/lib/settings-cache';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  X,
  Save,
  RotateCcw,
  ShieldCheck,
  Activity,
  TrendingUp,
  Crosshair,
  Settings2,
  Loader2,
  Check,
  Eye,
  EyeOff,
  Copy,
  Plus,
  Trash2,
  Clock,
  Users,
  KeyRound,
  RefreshCw,
  AlertCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ============================================================
// Settings definitions — what each strategy exposes for editing
// ============================================================

type SettingType = 'number' | 'boolean' | 'select';

interface SettingDef {
  key: string;
  label: string;
  description: string;
  type: SettingType;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: { value: string; label: string }[];
  /** How to extract default from StrategyConfig */
  getDefault: (s: StrategyConfig) => number | boolean | string;
}

const STRATEGY_SETTINGS: SettingDef[] = [
  // Trading
  {
    key: 'maxOpenTrades',
    label: 'Макс. открытых сделок',
    description: 'Лимит одновременных открытых позиций для стратегии',
    type: 'number',
    min: 1,
    max: 30,
    step: 1,
    unit: 'шт',
    getDefault: s => s.maxOpenTrades,
  },
  {
    key: 'maxLeverage',
    label: 'Макс. плечо',
    description: 'Максимальное плечо для сделок стратегии',
    type: 'number',
    min: 1,
    max: 20,
    step: 1,
    unit: 'x',
    getDefault: s => s.maxLeverage,
  },
  {
    key: 'riskRewardRatio',
    label: 'Risk:Reward',
    description: 'Отношение риска к прибыли (TP = SL × это значение)',
    type: 'number',
    min: 1,
    max: 10,
    step: 0.5,
    unit: 'R',
    getDefault: s => s.riskRewardRatio,
  },
  {
    key: 'tradeSizePercent',
    label: 'Размер сделки',
    description: '% от баланса на одну сделку',
    type: 'number',
    min: 0.005,
    max: 0.5,
    step: 0.005,
    unit: '%',
    getDefault: s => s.tradeSizePercent,
  },

  // Engine
  {
    key: 'scoreThreshold',
    label: 'Порог сигнала',
    description: 'Минимальный скор для входа в сделку (ниже = больше сделок)',
    type: 'number',
    min: 0.01,
    max: 0.8,
    step: 0.01,
    getDefault: s => s.scoreThreshold,
  },
  {
    key: 'adxMin',
    label: 'Мин. ADX',
    description: 'Минимальная сила тренда (0 = без фильтра)',
    type: 'number',
    min: 0,
    max: 60,
    step: 5,
    getDefault: s => s.adxMin ?? 0,
  },
  {
    key: 'mtfEnabled',
    label: 'MTF фильтр',
    description: 'Мульти-таймфрейм подтверждение направления',
    type: 'boolean',
    getDefault: s => s.mtfEnabled,
  },

  // Time
  {
    key: 'defaultInterval',
    label: 'Таймфрейм свечей',
    description: 'Интервал данных для анализа (младше = быстрее сигналы)',
    type: 'select',
    options: [
      { value: '1m', label: '1 минута' },
      { value: '5m', label: '5 минут' },
      { value: '15m', label: '15 минут' },
      { value: '1h', label: '1 час' },
      { value: '4h', label: '4 часа' },
      { value: '1d', label: '1 день' },
    ],
    getDefault: s => s.defaultInterval,
  },
  {
    key: 'candleLimit',
    label: 'Лимит свечей',
    description: 'Количество свечей для запроса к API',
    type: 'number',
    min: 100,
    max: 2000,
    step: 50,
    unit: 'шт',
    getDefault: s => s.candleLimit,
  },
  {
    key: 'monitorInterval',
    label: 'Интервал мониторинга',
    description: 'Как часто проверять SL/TP (по закрытии свечи)',
    type: 'select',
    options: [
      { value: '1m', label: 'Каждую минуту' },
      { value: '5m', label: 'Каждые 5 мин' },
      { value: '15m', label: 'Каждые 15 мин' },
      { value: '1h', label: 'Каждый час' },
      { value: '4h', label: 'Каждые 4 часа' },
      { value: '1d', label: 'Раз в день' },
    ],
    getDefault: s => s.monitorInterval,
  },
  {
    key: 'maxHoldMinutes',
    label: 'Макс. удержание',
    description: 'Макс. время в позиции (убывающие закроются)',
    type: 'number',
    min: 5,
    max: 20160,
    step: 5,
    unit: 'мин',
    getDefault: s => s.maxHoldMinutes,
  },
  {
    key: 'timeFilterEnabled',
    label: 'Временной фильтр',
    description: 'Торговать только в заданные часы (МСК)',
    type: 'boolean',
    getDefault: s => s.timeFilterEnabled,
  },
  {
    key: 'timeFilterStart',
    label: 'Начало торгов (МСК)',
    description: 'Час начала торгового окна',
    type: 'number',
    min: 0,
    max: 23,
    step: 1,
    unit: 'ч',
    getDefault: s => s.timeFilterStart,
  },
  {
    key: 'timeFilterEnd',
    label: 'Конец торгов (МСК)',
    description: 'Час окончания торгового окна',
    type: 'number',
    min: 0,
    max: 23,
    step: 1,
    unit: 'ч',
    getDefault: s => s.timeFilterEnd,
  },
];

interface SystemSettingDef {
  key: string;
  label: string;
  description: string;
  type: SettingType;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  defaultValue: number | boolean | string;
}

const SYSTEM_SETTINGS: SystemSettingDef[] = [
  {
    key: 'system.dailyLossLimit',
    label: 'Дневной лимит убытков',
    description: 'При достижении убытка N% от баланса — остановить торговлю до следующего дня',
    type: 'number',
    min: 1,
    max: 30,
    step: 1,
    unit: '%',
    defaultValue: 5,
  },
  {
    key: 'system.maxTPDistance',
    label: 'Макс. дистанция TP',
    description: 'Ограничение максимальной дистанции тейк-профита от входа',
    type: 'number',
    min: 1,
    max: 30,
    step: 1,
    unit: '%',
    defaultValue: 8,
  },
  {
    key: 'system.maxSLDistance',
    label: 'Макс. дистанция SL',
    description: 'Ограничение максимальной дистанции стоп-лосса от входа',
    type: 'number',
    min: 1,
    max: 15,
    step: 0.5,
    unit: '%',
    defaultValue: 5,
  },
  {
    key: 'system.maxSLCapDistance',
    label: 'Auto-repair SL кап',
    description: 'Авто-ремонт: SL дальше N% будет обрезан',
    type: 'number',
    min: 1,
    max: 15,
    step: 0.5,
    unit: '%',
    defaultValue: 5,
  },
  {
    key: 'system.maxTPCapDistance',
    label: 'Auto-repair TP кап',
    description: 'Авто-ремонт: TP дальше N% будет обрезан',
    type: 'number',
    min: 1,
    max: 25,
    step: 1,
    unit: '%',
    defaultValue: 10,
  },
  {
    key: 'system.trailing1x',
    label: 'Trailing 1-й уровень',
    description: 'После прибыли = 1× SL → стоп на безубыток',
    type: 'boolean',
    defaultValue: true,
  },
  {
    key: 'system.trailing2x',
    label: 'Trailing 2-й уровень',
    description: 'После прибыли = 2× SL → стоп в плюсе на 1× SL',
    type: 'boolean',
    defaultValue: true,
  },
  {
    key: 'system.trailing3x',
    label: 'Trailing 3-й уровень',
    description: 'После прибыли = 3× SL → стоп в плюсе на 2× SL',
    type: 'boolean',
    defaultValue: true,
  },
  {
    key: 'system.scanSymbols',
    label: 'Символов за цикл',
    description: 'Сколько монет сканировать за один торговый цикл',
    type: 'number',
    min: 5,
    max: 50,
    step: 5,
    unit: 'шт',
    defaultValue: 20,
  },
  {
    key: 'system.volumeBoost',
    label: 'Буст объёма',
    description: 'Множитель объёма для буста сигнала (1.0 = нет буста)',
    type: 'number',
    min: 1.0,
    max: 2.5,
    step: 0.1,
    unit: 'x',
    defaultValue: 1.2,
  },
];

// ============================================================
// Helper: format minutes to human-readable
// ============================================================

function formatMinutes(m: number): string {
  if (m < 60) return `${m} мин`;
  if (m < 1440) return `${(m / 60).toFixed(0)} ч`;
  return `${(m / 1440).toFixed(0)} д`;
}

// ============================================================
// SliderRow — one setting with slider / switch / select
// ============================================================

function SliderRow({
  label,
  description,
  value,
  defaultValue,
  onChange,
  type,
  min,
  max,
  step,
  unit,
  options,
  colorClass,
}: {
  label: string;
  description: string;
  value: number | boolean | string;
  defaultValue: number | boolean | string;
  onChange: (v: number | boolean | string) => void;
  type: SettingType;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: { value: string; label: string }[];
  colorClass: string;
}) {
  const isModified = value !== defaultValue;

  if (type === 'boolean') {
    return (
      <div className={cn('flex items-center justify-between py-3 px-4 rounded-xl border transition-colors', isModified ? 'border-yellow-500/30 bg-yellow-500/5' : 'border-white/[0.06] bg-white/[0.02]')}>
        <div className="min-w-0">
          <div className={cn('text-sm font-medium', colorClass)}>{label}</div>
          <div className="text-[11px] text-white/35 mt-0.5">{description}</div>
        </div>
        <div className="flex items-center gap-3 shrink-0 ml-4">
          {isModified && <span className="text-[9px] text-yellow-400/60 font-mono">MOD</span>}
          <Switch
            checked={value as boolean}
            onCheckedChange={onChange as (v: boolean) => void}
            className="scale-90"
          />
        </div>
      </div>
    );
  }

  if (type === 'select' && options) {
    const currentOption = options.find(o => o.value === value);
    return (
      <div className={cn('py-3 px-4 rounded-xl border transition-colors', isModified ? 'border-yellow-500/30 bg-yellow-500/5' : 'border-white/[0.06] bg-white/[0.02]')}>
        <div className="flex items-center justify-between mb-2">
          <div className="min-w-0">
            <div className={cn('text-sm font-medium', colorClass)}>{label}</div>
            <div className="text-[11px] text-white/35 mt-0.5">{description}</div>
          </div>
          {isModified && <span className="text-[9px] text-yellow-400/60 font-mono shrink-0">MOD</span>}
        </div>
        <Select value={value as string} onValueChange={onChange as (v: string) => void}>
          <SelectTrigger className="w-full h-9 bg-white/[0.04] border-white/[0.1] text-white/80 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-[#16161e] border-white/[0.1]">
            {options.map(o => (
              <SelectItem key={o.value} value={o.value} className="text-white/80 text-xs">{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }

  // Number slider
  const numValue = value as number;
  const numMin = min ?? 0;
  const numMax = max ?? 100;
  const numStep = step ?? 1;
  const displayValue = unit === '%'
    ? `${(numValue * 100).toFixed(step && step < 0.01 ? 2 : 1)}%`
    : unit === 'мин'
      ? formatMinutes(numValue)
      : unit === 'R'
        ? `1:${numValue.toFixed(1)}`
        : `${numValue}${unit ? ' ' + unit : ''}`;

  return (
    <div className={cn('py-3 px-4 rounded-xl border transition-colors', isModified ? 'border-yellow-500/30 bg-yellow-500/5' : 'border-white/[0.06] bg-white/[0.02]')}>
      <div className="flex items-center justify-between mb-2.5">
        <div className="min-w-0">
          <div className={cn('text-sm font-medium', colorClass)}>{label}</div>
          <div className="text-[11px] text-white/35 mt-0.5">{description}</div>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-3">
          {isModified && <span className="text-[9px] text-yellow-400/60 font-mono">MOD</span>}
          <span className={cn('text-sm font-mono font-bold min-w-[60px] text-right', isModified ? 'text-yellow-400' : colorClass)}>
            {displayValue}
          </span>
        </div>
      </div>
      <Slider
        value={[numValue]}
        min={numMin}
        max={numMax}
        step={numStep}
        onValueChange={([v]) => onChange(v)}
        className="w-full"
      />
      <div className="flex justify-between mt-1.5 text-[10px] text-white/20 font-mono">
        <span>{unit === '%' ? `${(numMin * 100).toFixed(0)}%` : unit === 'мин' ? formatMinutes(numMin) : numMin}</span>
        <span>{unit === '%' ? `${(numMax * 100).toFixed(0)}%` : unit === 'мин' ? formatMinutes(numMax) : numMax}</span>
      </div>
    </div>
  );
}

// ============================================================
// StrategyTab — settings for one strategy
// ============================================================

function StrategyTab({
  strategy,
  dbSettings,
  pendingChanges,
  setPending,
}: {
  strategy: StrategyConfig;
  dbSettings: Record<string, string>;
  pendingChanges: Record<string, string>;
  setPending: (updater: (prev: Record<string, string>) => Record<string, string>) => void;
}) {
  const prefix = `strategy.${strategy.id}.`;

  const getValue = useCallback(
    (def: SettingDef) => {
      const fullKey = prefix + def.key;
      // 1) Check pending changes
      if (fullKey in pendingChanges) {
        return def.type === 'boolean'
          ? pendingChanges[fullKey] === 'true'
          : def.type === 'number'
            ? parseFloat(pendingChanges[fullKey])
            : pendingChanges[fullKey];
      }
      // 2) Check DB overrides
      if (fullKey in dbSettings) {
        return def.type === 'boolean'
          ? dbSettings[fullKey] === 'true'
          : def.type === 'number'
            ? parseFloat(dbSettings[fullKey])
            : dbSettings[fullKey];
      }
      // 3) Default from strategy config
      return def.getDefault(strategy);
    },
    [prefix, strategy, dbSettings, pendingChanges],
  );

  const getDefaultValue = useCallback(
    (def: SettingDef) => def.getDefault(strategy),
    [strategy],
  );

  const handleChange = useCallback(
    (key: string, value: number | boolean | string) => {
      const fullKey = prefix + key;
      setPending(prev => {
        const strVal = String(value);
        // If new value matches default, remove override
        const defaultVal = String(getDefaultValue(STRATEGY_SETTINGS.find(d => d.key === key)!));
        if (strVal === defaultVal) {
          const next = { ...prev };
          delete next[fullKey];
          return next;
        }
        return { ...prev, [fullKey]: strVal };
      });
    },
    [prefix, setPending, getDefaultValue],
  );

  // Categorize settings
  const trading = STRATEGY_SETTINGS.filter(d => ['maxOpenTrades', 'maxLeverage', 'riskRewardRatio', 'tradeSizePercent'].includes(d.key));
  const engine = STRATEGY_SETTINGS.filter(d => ['scoreThreshold', 'adxMin', 'mtfEnabled'].includes(d.key));
  const timing = STRATEGY_SETTINGS.filter(d => ['defaultInterval', 'candleLimit', 'monitorInterval', 'maxHoldMinutes', 'timeFilterEnabled', 'timeFilterStart', 'timeFilterEnd'].includes(d.key));

  return (
    <ScrollArea className="h-[calc(100vh-200px)] sm:h-[calc(100vh-160px)] pr-2">
      <div className="space-y-4 pb-8 max-w-xl mx-auto">
        {/* Strategy header */}
        <div className={cn('rounded-xl border p-4', strategy.borderColor, strategy.bgColor)}>
          <div className="flex items-center gap-3">
            <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center', strategy.bgColor, strategy.borderColor, 'border')}>
              {strategy.id === 'momentum' && <TrendingUp className={cn('w-5 h-5', strategy.color)} />}
              {strategy.id === 'scalper' && <Crosshair className={cn('w-5 h-5', strategy.color)} />}
              {strategy.id === 'position-alpha' && <Activity className={cn('w-5 h-5', strategy.color)} />}
            </div>
            <div>
              <div className={cn('text-base font-bold', strategy.color)}>{strategy.name}</div>
              <div className="text-[11px] text-white/30 mt-0.5 line-clamp-2">{strategy.description}</div>
            </div>
          </div>
        </div>

        {/* Trading section */}
        <div>
          <div className="text-[10px] font-bold uppercase tracking-widest text-white/25 mb-2 px-1">
            Торговые параметры
          </div>
          <div className="space-y-2">
            {trading.map(def => (
              <SliderRow
                key={def.key}
                label={def.label}
                description={def.description}
                value={getValue(def)}
                defaultValue={getDefaultValue(def)}
                onChange={v => handleChange(def.key, v)}
                type={def.type}
                min={def.min}
                max={def.max}
                step={def.step}
                unit={def.unit}
                options={def.options}
                colorClass={strategy.color}
              />
            ))}
          </div>
        </div>

        <Separator className="bg-white/[0.04]" />

        {/* Engine section */}
        <div>
          <div className="text-[10px] font-bold uppercase tracking-widest text-white/25 mb-2 px-1">
            Движок сигналов
          </div>
          <div className="space-y-2">
            {engine.map(def => (
              <SliderRow
                key={def.key}
                label={def.label}
                description={def.description}
                value={getValue(def)}
                defaultValue={getDefaultValue(def)}
                onChange={v => handleChange(def.key, v)}
                type={def.type}
                min={def.min}
                max={def.max}
                step={def.step}
                unit={def.unit}
                colorClass={strategy.color}
              />
            ))}
          </div>
        </div>

        <Separator className="bg-white/[0.04]" />

        {/* Timing section */}
        <div>
          <div className="text-[10px] font-bold uppercase tracking-widest text-white/25 mb-2 px-1">
            Тайминг и мониторинг
          </div>
          <div className="space-y-2">
            {timing.map(def => (
              <SliderRow
                key={def.key}
                label={def.label}
                description={def.description}
                value={getValue(def)}
                defaultValue={getDefaultValue(def)}
                onChange={v => handleChange(def.key, v)}
                type={def.type}
                min={def.min}
                max={def.max}
                step={def.step}
                unit={def.unit}
                options={def.options}
                colorClass={strategy.color}
              />
            ))}
          </div>
        </div>
      </div>
    </ScrollArea>
  );
}

// ============================================================
// SystemTab — system-wide settings
// ============================================================

function SystemTab({
  dbSettings,
  pendingChanges,
  setPending,
}: {
  dbSettings: Record<string, string>;
  pendingChanges: Record<string, string>;
  setPending: (updater: (prev: Record<string, string>) => Record<string, string>) => void;
}) {
  const getValue = useCallback(
    (def: SystemSettingDef) => {
      // 1) Pending
      if (def.key in pendingChanges) {
        return def.type === 'boolean'
          ? pendingChanges[def.key] === 'true'
          : def.type === 'number'
            ? parseFloat(pendingChanges[def.key])
            : pendingChanges[def.key];
      }
      // 2) DB
      if (def.key in dbSettings) {
        return def.type === 'boolean'
          ? dbSettings[def.key] === 'true'
          : def.type === 'number'
            ? parseFloat(dbSettings[def.key])
            : dbSettings[def.key];
      }
      // 3) Default
      return def.defaultValue;
    },
    [dbSettings, pendingChanges],
  );

  const getDefaultValue = useCallback(
    (def: SystemSettingDef) => def.defaultValue,
    [],
  );

  const handleChange = useCallback(
    (key: string, def: SystemSettingDef, value: number | boolean | string) => {
      setPending(prev => {
        const strVal = String(value);
        const defaultVal = String(def.defaultValue);
        if (strVal === defaultVal) {
          const next = { ...prev };
          delete next[key];
          return next;
        }
        return { ...prev, [key]: strVal };
      });
    },
    [setPending],
  );

  const risk = SYSTEM_SETTINGS.filter(d => d.key.startsWith('system.dailyLoss') || d.key.startsWith('system.max') || d.key.startsWith('system.SL') || d.key.startsWith('system.TP'));
  const trailing = SYSTEM_SETTINGS.filter(d => d.key.startsWith('system.trailing'));
  const scan = SYSTEM_SETTINGS.filter(d => d.key.startsWith('system.scan') || d.key.startsWith('system.volume'));

  return (
    <ScrollArea className="h-[calc(100vh-200px)] sm:h-[calc(100vh-160px)] pr-2">
      <div className="space-y-4 pb-8 max-w-xl mx-auto">
        {/* System header */}
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-emerald-500/10 border border-emerald-500/20">
              <Settings2 className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <div className="text-base font-bold text-emerald-400">Системные параметры</div>
              <div className="text-[11px] text-white/30 mt-0.5">Глобальные ограничения и фильтры для всех стратегий</div>
            </div>
          </div>
        </div>

        {/* Risk management */}
        <div>
          <div className="text-[10px] font-bold uppercase tracking-widest text-white/25 mb-2 px-1">
            Управление рисками
          </div>
          <div className="space-y-2">
            {risk.map(def => (
              <SliderRow
                key={def.key}
                label={def.label}
                description={def.description}
                value={getValue(def)}
                defaultValue={getDefaultValue(def)}
                onChange={v => handleChange(def.key, def, v)}
                type={def.type}
                min={def.min}
                max={def.max}
                step={def.step}
                unit={def.unit}
                colorClass="text-emerald-400"
              />
            ))}
          </div>
        </div>

        <Separator className="bg-white/[0.04]" />

        {/* Trailing stops */}
        <div>
          <div className="text-[10px] font-bold uppercase tracking-widest text-white/25 mb-2 px-1">
            Трейлинг-стопы
          </div>
          <div className="space-y-2">
            {trailing.map(def => (
              <SliderRow
                key={def.key}
                label={def.label}
                description={def.description}
                value={getValue(def)}
                defaultValue={getDefaultValue(def)}
                onChange={v => handleChange(def.key, def, v)}
                type={def.type}
                colorClass="text-emerald-400"
              />
            ))}
          </div>
        </div>

        <Separator className="bg-white/[0.04]" />

        {/* Scanning */}
        <div>
          <div className="text-[10px] font-bold uppercase tracking-widest text-white/25 mb-2 px-1">
            Сканирование рынка
          </div>
          <div className="space-y-2">
            {scan.map(def => (
              <SliderRow
                key={def.key}
                label={def.label}
                description={def.description}
                value={getValue(def)}
                defaultValue={getDefaultValue(def)}
                onChange={v => handleChange(def.key, def, v)}
                type={def.type}
                min={def.min}
                max={def.max}
                step={def.step}
                unit={def.unit}
                colorClass="text-emerald-400"
              />
            ))}
          </div>
        </div>
      </div>
    </ScrollArea>
  );
}

// ============================================================
// UsersTab — user management with password visibility + reset
// ============================================================

interface UserInfo {
  id: string;
  username: string;
  password: string;
  email: string;
  role: string;
  isDemo: string;
  demoExpiresAt: string | null;
  createdAt: string;
  subscription: {
    isActive: boolean;
    expiresAt: string | null;
  } | null;
}

const ADMIN_AUTH = 'Bearer trade-bot-admin-2024';
const ADMIN_HEADERS: HeadersInit = {
  'Authorization': ADMIN_AUTH,
  'Content-Type': 'application/json',
};

function UsersTab() {
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [showPasswordId, setShowPasswordId] = useState<string | null>(null);
  const [resettingId, setResettingId] = useState<string | null>(null);
  const [newPasswords, setNewPasswords] = useState<Record<string, string>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/users', { headers: { 'Authorization': ADMIN_AUTH } });
      const data = await res.json();
      // Filter: regular users only (not demo, not admin)
      const filtered = (data.users ?? []).filter((u: UserInfo) => u.role !== 'admin' && u.isDemo !== '1');
      setUsers(filtered);
    } catch (err) {
      console.error('Failed to load users:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleResetPassword = useCallback(async (userId: string) => {
    setResettingId(userId);
    try {
      const res = await fetch('/api/admin/reset-password', {
        method: 'POST',
        headers: ADMIN_HEADERS,
        body: JSON.stringify({ userId }),
      });
      const data = await res.json();
      if (data.success && data.newPassword) {
        setNewPasswords(prev => ({ ...prev, [userId]: data.newPassword }));
        setShowPasswordId(userId);
      }
    } catch (err) {
      console.error('Failed to reset password:', err);
    } finally {
      setResettingId(null);
    }
  }, []);

  const handleDelete = useCallback(async (userId: string) => {
    setDeletingId(userId);
    try {
      await fetch(`/api/admin/users?id=${userId}`, {
        method: 'DELETE',
        headers: { 'Authorization': ADMIN_AUTH },
      });
      setUsers(prev => prev.filter(u => u.id !== userId));
    } catch (err) {
      console.error('Failed to delete user:', err);
    } finally {
      setDeletingId(null);
    }
  }, []);

  const handleCopy = useCallback(async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {
      // fallback
    }
  }, []);

  const formatDate = (d: string) => {
    if (!d) return '—';
    try {
      return new Date(d).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' });
    } catch {
      return d;
    }
  };

  return (
    <ScrollArea className="h-[calc(100vh-200px)] sm:h-[calc(100vh-160px)] pr-2">
      <div className="space-y-4 pb-8 max-w-3xl mx-auto">
        {/* Header */}
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-blue-500/10 border border-blue-500/20">
              <Users className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <div className="text-base font-bold text-blue-400">Пользователи</div>
              <div className="text-[11px] text-white/30 mt-0.5">Управление аккаунтами, просмотр паролей и подписок</div>
            </div>
          </div>
        </div>

        {/* Users count */}
        <div className="flex items-center justify-between px-1">
          <span className="text-[11px] text-white/40 font-mono">
            {loading ? 'Загрузка...' : `${users.length} пользователей`}
          </span>
          <button
            onClick={fetchUsers}
            disabled={loading}
            className="text-[11px] text-white/40 hover:text-white/60 transition-colors flex items-center gap-1"
          >
            <RefreshCw className={cn('w-3 h-3', loading && 'animate-spin')} />
            Обновить
          </button>
        </div>

        {/* Table */}
        <div className="max-h-[500px] overflow-y-auto rounded-xl border border-white/[0.06]">
          {users.length === 0 ? (
            <div className="flex items-center justify-center py-16 text-white/20 text-sm">
              {loading ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : null}
              {loading ? 'Загрузка...' : 'Нет пользователей'}
            </div>
          ) : (
            <table className="w-full text-[11px] font-mono">
              <thead>
                <tr className="border-b border-white/[0.06] bg-white/[0.02]">
                  <th className="text-left py-2.5 px-3 text-white/40 font-medium">Логин</th>
                  <th className="text-left py-2.5 px-3 text-white/40 font-medium">Email</th>
                  <th className="text-left py-2.5 px-3 text-white/40 font-medium">Роль</th>
                  <th className="text-left py-2.5 px-3 text-white/40 font-medium">Подписка</th>
                  <th className="text-left py-2.5 px-3 text-white/40 font-medium">Пароль</th>
                  <th className="text-left py-2.5 px-3 text-white/40 font-medium">Создан</th>
                  <th className="text-right py-2.5 px-3 text-white/40 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {users.map(user => {
                  const isNewPassword = !!newPasswords[user.id];
                  const isShowingPassword = showPasswordId === user.id;
                  const displayPassword = isNewPassword
                    ? newPasswords[user.id]
                    : isShowingPassword
                      ? user.password
                      : '•'.repeat(12);

                  return (
                    <tr key={user.id} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
                      <td className="py-2.5 px-3 text-white/80 font-medium">{user.username}</td>
                      <td className="py-2.5 px-3 text-white/50 max-w-[120px] truncate">{user.email || '—'}</td>
                      <td className="py-2.5 px-3">
                        <span className={cn(
                          'px-2 py-0.5 rounded-full text-[10px] font-medium',
                          user.role === 'admin'
                            ? 'bg-red-500/15 text-red-400 border border-red-500/20'
                            : user.isDemo === '1'
                              ? 'bg-amber-500/15 text-amber-400 border border-amber-500/20'
                              : 'bg-white/[0.06] text-white/50 border border-white/[0.08]',
                        )}>
                          {user.role === 'admin' ? 'admin' : user.isDemo === '1' ? 'demo' : 'user'}
                        </span>
                      </td>
                      <td className="py-2.5 px-3">
                        {user.subscription?.isActive ? (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
                            Активна
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-red-500/15 text-red-400 border border-red-500/20">
                            Истекла
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-1.5">
                          <span className={cn(
                            'text-[10px] truncate max-w-[100px]',
                            isNewPassword ? 'text-emerald-400 font-semibold' : isShowingPassword ? 'text-white/40' : 'text-white/20',
                          )}>
                            {displayPassword}
                          </span>
                          <button
                            onClick={() => setShowPasswordId(isShowingPassword ? null : user.id)}
                            className="w-5 h-5 rounded flex items-center justify-center text-white/20 hover:text-white/50 transition-colors"
                            title={isShowingPassword ? 'Скрыть' : 'Показать'}
                          >
                            {isShowingPassword ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                          </button>
                          {isNewPassword && (
                            <button
                              onClick={() => handleCopy(newPasswords[user.id], user.id)}
                              className="w-5 h-5 rounded flex items-center justify-center text-emerald-400/60 hover:text-emerald-400 transition-colors"
                              title="Копировать"
                            >
                              {copiedId === user.id ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                            </button>
                          )}
                          <button
                            onClick={() => handleResetPassword(user.id)}
                            disabled={resettingId === user.id}
                            className="w-5 h-5 rounded flex items-center justify-center text-amber-400/60 hover:text-amber-400 transition-colors disabled:opacity-40"
                            title="Сбросить пароль"
                          >
                            {resettingId === user.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                          </button>
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-white/40">{formatDate(user.createdAt)}</td>
                      <td className="py-2.5 px-3 text-right">
                        <button
                          onClick={() => handleDelete(user.id)}
                          disabled={deletingId === user.id}
                          className="w-6 h-6 rounded-lg flex items-center justify-center ml-auto text-red-400/50 hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-40"
                          title="Удалить"
                        >
                          {deletingId === user.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </ScrollArea>
  );
}

// ============================================================
// DemoTab — demo account management
// ============================================================

interface DemoAccount {
  id: string;
  username: string;
  password: string;
  createdAt: string;
  demoExpiresAt: string | null;
  subscription: {
    isActive: boolean;
    expiresAt: string | null;
  } | null;
}

function formatCountdown(expiresAt: string | null): string {
  if (!expiresAt) return '—';
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return 'Истёк';
  const totalSec = Math.floor(diff / 1000);
  const hrs = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  return `${hrs}ч ${mins}мин`;
}

function isExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return true;
  return new Date(expiresAt).getTime() <= Date.now();
}

function DemoTab() {
  const [accounts, setAccounts] = useState<DemoAccount[]>([]);
  const [loading, setLoading] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newAccount, setNewAccount] = useState<{ username: string; password: string; expiresAt: string } | null>(null);
  const [resettingId, setResettingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [, setTick] = useState(0);

  const fetchAccounts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/demo', { headers: { 'Authorization': ADMIN_AUTH } });
      const data = await res.json();
      setAccounts(data.accounts ?? []);
    } catch (err) {
      console.error('Failed to load demo accounts:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch + auto-refresh every 30s
  useEffect(() => {
    fetchAccounts();
    const interval = setInterval(fetchAccounts, 30_000);
    return () => clearInterval(interval);
  }, [fetchAccounts]);

  // Tick every minute for countdown timers
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 60_000);
    return () => clearInterval(interval);
  }, []);

  const handleCreate = useCallback(async () => {
    setCreating(true);
    try {
      const res = await fetch('/api/admin/demo', {
        method: 'POST',
        headers: ADMIN_HEADERS,
      });
      const data = await res.json();
      setNewAccount({ username: data.username, password: data.password, expiresAt: data.expiresAt });
      fetchAccounts();
      // Auto-hide card after 15s
      setTimeout(() => setNewAccount(null), 15_000);
    } catch (err) {
      console.error('Failed to create demo account:', err);
    } finally {
      setCreating(false);
    }
  }, [fetchAccounts]);

  const handleReset = useCallback(async (id: string) => {
    setResettingId(id);
    try {
      await fetch('/api/admin/demo?action=reset&id=' + id, {
        method: 'POST',
        headers: ADMIN_HEADERS,
      });
      fetchAccounts();
    } catch (err) {
      console.error('Failed to reset demo account:', err);
    } finally {
      setResettingId(null);
    }
  }, [fetchAccounts]);

  const handleDelete = useCallback(async (id: string) => {
    setDeletingId(id);
    try {
      await fetch('/api/admin/demo?id=' + id, {
        method: 'DELETE',
        headers: { 'Authorization': ADMIN_AUTH },
      });
      setAccounts(prev => prev.filter(a => a.id !== id));
    } catch (err) {
      console.error('Failed to delete demo account:', err);
    } finally {
      setDeletingId(null);
    }
  }, []);

  const handleCopy = useCallback(async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 1500);
    } catch {
      // fallback
    }
  }, []);

  const formatDate = (d: string) => {
    if (!d) return '—';
    try {
      return new Date(d).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    } catch {
      return d;
    }
  };

  const activeCount = accounts.filter(a => !isExpired(a.demoExpiresAt)).length;
  const expiredCount = accounts.filter(a => isExpired(a.demoExpiresAt)).length;

  return (
    <ScrollArea className="h-[calc(100vh-200px)] sm:h-[calc(100vh-160px)] pr-2">
      <div className="space-y-4 pb-8 max-w-3xl mx-auto">
        {/* Header */}
        <div className="rounded-xl border border-amber-500/15 bg-amber-500/[0.03] p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-amber-500/10 border border-amber-500/20">
                <KeyRound className="w-5 h-5 text-amber-400" />
              </div>
              <div>
                <div className="text-base font-bold text-amber-400">Демо доступ</div>
                <div className="text-[11px] text-white/30 mt-0.5">Управление тестовыми аккаунтами с ограниченным доступом</div>
              </div>
            </div>
            <button
              onClick={handleCreate}
              disabled={creating}
              className="h-8 px-3 rounded-lg bg-amber-500/15 border border-amber-500/25 text-amber-400 text-[11px] font-medium hover:bg-amber-500/25 transition-colors flex items-center gap-1.5 disabled:opacity-50"
            >
              {creating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
              Создать
            </button>
          </div>
        </div>

        {/* New account card */}
        {newAccount && (
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.05] p-4 animate-in fade-in slide-in-from-top-2 duration-300">
            <div className="flex items-center gap-2 mb-3">
              <Check className="w-4 h-4 text-emerald-400" />
              <span className="text-[12px] font-medium text-emerald-400">Новый демо аккаунт создан</span>
            </div>
            <div className="grid grid-cols-2 gap-3 text-[11px] font-mono">
              <div className="rounded-lg bg-white/[0.04] border border-white/[0.06] p-2.5">
                <div className="text-white/30 text-[10px] mb-1">Логин</div>
                <div className="text-white/90 font-medium">{newAccount.username}</div>
              </div>
              <div className="rounded-lg bg-white/[0.04] border border-white/[0.06] p-2.5">
                <div className="text-white/30 text-[10px] mb-1">Пароль</div>
                <div className="flex items-center justify-between">
                  <span className="text-emerald-400 font-medium">{newAccount.password}</span>
                  <button
                    onClick={() => handleCopy(newAccount.password, 'new-pw')}
                    className="text-emerald-400/60 hover:text-emerald-400 transition-colors ml-2"
                  >
                    {copiedField === 'new-pw' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  </button>
                </div>
              </div>
            </div>
            <div className="mt-2 text-[10px] text-white/25">Истекает: {formatDate(newAccount.expiresAt)}</div>
          </div>
        )}

        {/* Stats */}
        <div className="flex items-center gap-4 px-1">
          <span className="text-[11px] text-white/40 font-mono">
            {loading ? 'Загрузка...' : `${accounts.length} аккаунтов`}
          </span>
          {activeCount > 0 && (
            <span className="text-[10px] text-emerald-400/60 font-mono">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400/60 mr-1" />
              {activeCount} активных
            </span>
          )}
          {expiredCount > 0 && (
            <span className="text-[10px] text-red-400/60 font-mono">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-400/60 mr-1" />
              {expiredCount} истёкших
            </span>
          )}
          <button
            onClick={fetchAccounts}
            disabled={loading}
            className="ml-auto text-[11px] text-white/40 hover:text-white/60 transition-colors flex items-center gap-1"
          >
            <RefreshCw className={cn('w-3 h-3', loading && 'animate-spin')} />
            Обновить
          </button>
        </div>

        {/* Demo accounts list */}
        <div className="max-h-[500px] overflow-y-auto rounded-xl border border-amber-500/10">
          {accounts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-white/20 text-sm gap-2">
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <AlertCircle className="w-5 h-5" />}
              {loading ? 'Загрузка...' : 'Нет демо аккаунтов'}
            </div>
          ) : (
            <table className="w-full text-[11px] font-mono">
              <thead>
                <tr className="border-b border-white/[0.06] bg-amber-500/[0.04]">
                  <th className="text-left py-2.5 px-3 text-amber-400/50 font-medium">Логин</th>
                  <th className="text-left py-2.5 px-3 text-amber-400/50 font-medium">Пароль</th>
                  <th className="text-left py-2.5 px-3 text-amber-400/50 font-medium">Создан</th>
                  <th className="text-left py-2.5 px-3 text-amber-400/50 font-medium">Осталось</th>
                  <th className="text-left py-2.5 px-3 text-amber-400/50 font-medium">Статус</th>
                  <th className="text-right py-2.5 px-3 text-amber-400/50 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {accounts.map(account => {
                  const expired = isExpired(account.demoExpiresAt);
                  return (
                    <tr key={account.id} className={cn(
                      'border-b border-white/[0.04] transition-colors',
                      expired ? 'opacity-50' : 'hover:bg-amber-500/[0.03]',
                    )}>
                      <td className="py-2.5 px-3 text-white/80 font-medium">{account.username}</td>
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-1.5">
                          <span className="text-white/40 truncate max-w-[80px]">{account.password}</span>
                          <button
                            onClick={() => handleCopy(account.password, account.id + '-pw')}
                            className="w-5 h-5 rounded flex items-center justify-center text-white/20 hover:text-amber-400 transition-colors"
                            title="Копировать"
                          >
                            {copiedField === account.id + '-pw' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                          </button>
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-white/40">{formatDate(account.createdAt)}</td>
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-1.5">
                          <Clock className={cn('w-3 h-3', expired ? 'text-red-400/40' : 'text-amber-400/40')} />
                          <span className={expired ? 'text-red-400/60' : 'text-amber-400'}>
                            {formatCountdown(account.demoExpiresAt)}
                          </span>
                        </div>
                      </td>
                      <td className="py-2.5 px-3">
                        {expired ? (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-red-500/15 text-red-400 border border-red-500/20">
                            Истёк
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
                            Активен
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {!expired && (
                            <button
                              onClick={() => handleReset(account.id)}
                              disabled={resettingId === account.id}
                              className="w-6 h-6 rounded-lg flex items-center justify-center text-amber-400/50 hover:text-amber-400 hover:bg-amber-500/10 transition-colors disabled:opacity-40"
                              title="Продлить на 2ч"
                            >
                              {resettingId === account.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                            </button>
                          )}
                          <button
                            onClick={() => handleDelete(account.id)}
                            disabled={deletingId === account.id}
                            className="w-6 h-6 rounded-lg flex items-center justify-center text-red-400/50 hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-40"
                            title="Удалить"
                          >
                            {deletingId === account.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </ScrollArea>
  );
}

// ============================================================
// Main AdminPanel component
// ============================================================

interface AdminPanelProps {
  open: boolean;
  onClose: () => void;
}

export default function AdminPanel({ open, onClose }: AdminPanelProps) {
  const [dbSettings, setDbSettings] = useState<Record<string, string>>({});
  const [pendingChanges, setPendingChanges] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [activeTab, setActiveTab] = useState('system');

  // Load settings on open
  useEffect(() => {
    if (!open) return;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch('/api/settings');
        const data = await res.json();
        setDbSettings(data.settings ?? {});
        setPendingChanges({});
      } catch (err) {
        console.error('Failed to load settings:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, [open]);

  const modifiedCount = useMemo(() => Object.keys(pendingChanges).length, [pendingChanges]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaved(false);
    try {
      // Find keys that were reset to default — need to delete them
      const deletes: string[] = [];
      const updates: Record<string, string> = {};

      for (const [key, value] of Object.entries(pendingChanges)) {
        updates[key] = value;
      }

      // Also: find DB keys that are no longer in pending but were in DB with non-default values
      // (handled by the delete flow when user resets to default)

      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates, deletes }),
      });
      const data = await res.json();
      setDbSettings(data.settings ?? {});
      setPendingChanges({});
      setSaved(true);
      // Invalidate client-side cache so next trade cycle picks up new values
      invalidateSettingsCache();
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error('Failed to save settings:', err);
    } finally {
      setSaving(false);
    }
  }, [pendingChanges]);

  const handleReset = useCallback(() => {
    setPendingChanges({});
  }, []);

  const handleResetStrategy = useCallback(
    (strategyId: string) => {
      const prefix = `strategy.${strategyId}.`;
      setPendingChanges(prev => {
        const next = { ...prev };
        for (const key of Object.keys(next)) {
          if (key.startsWith(prefix)) {
            delete next[key];
          }
        }
        return next;
      });
    },
    [],
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="relative w-full h-full sm:h-[92vh] sm:max-h-[900px] sm:max-w-[700px] sm:rounded-2xl bg-[#0d0d14] border border-white/[0.08] shadow-2xl flex flex-col animate-in zoom-in-95 slide-in-from-bottom-4 duration-300 overflow-hidden">
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-4 sm:px-6 py-3.5 border-b border-white/[0.06] bg-[#0d0d14]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white/90">Админ-панель</h2>
              <p className="text-[10px] text-white/30">Управление параметрами стратегий и системы</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {modifiedCount > 0 && (
              <span className="text-[10px] font-mono text-yellow-400 bg-yellow-500/10 border border-yellow-500/20 px-2 py-0.5 rounded-full">
                {modifiedCount} изм.
              </span>
            )}
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg bg-white/[0.04] border border-white/[0.06] flex items-center justify-center hover:bg-white/[0.08] transition-colors"
            >
              <X className="w-4 h-4 text-white/60" />
            </button>
          </div>
        </div>

        {/* Body */}
        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="w-6 h-6 text-white/30 animate-spin" />
            <span className="ml-3 text-sm text-white/30">Загрузка настроек...</span>
          </div>
        ) : (
          <div className="flex-1 overflow-hidden flex flex-col">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col h-full">
              <TabsList className="shrink-0 mx-4 sm:mx-6 mt-3 mb-2 bg-white/[0.03] border border-white/[0.06] rounded-xl p-1 h-auto overflow-x-auto no-scrollbar">
                <TabsTrigger
                  value="system"
                  className="text-[11px] font-medium px-3 py-2 rounded-lg data-[state=active]:bg-emerald-500/15 data-[state=active]:text-emerald-400 data-[state=active]:shadow-none"
                >
                  <Settings2 className="w-3 h-3 mr-1.5" />
                  Система
                </TabsTrigger>
                {STRATEGIES.map(s => (
                  <TabsTrigger
                    key={s.id}
                    value={s.id}
                    className={cn(
                      'text-[11px] font-medium px-3 py-2 rounded-lg data-[state=active]:shadow-none',
                      `data-[state=active]:bg-${s.color.replace('text-', '')}/15`,
                    )}
                    style={{
                      '--tw-text-opacity': 1,
                    }}
                  >
                    {s.id === 'momentum' && <TrendingUp className="w-3 h-3 mr-1.5" />}
                    {s.id === 'scalper' && <Crosshair className="w-3 h-3 mr-1.5" />}
                    {s.id === 'position-alpha' && <Activity className="w-3 h-3 mr-1.5" />}
                    <span className={activeTab === s.id ? s.color : ''}>{s.name}</span>
                  </TabsTrigger>
                ))}
                <TabsTrigger
                  value="users"
                  className="text-[11px] font-medium px-3 py-2 rounded-lg data-[state=active]:bg-blue-500/15 data-[state=active]:text-blue-400 data-[state=active]:shadow-none"
                >
                  <Users className="w-3 h-3 mr-1.5" />
                  Пользователи
                </TabsTrigger>
                <TabsTrigger
                  value="demo"
                  className="text-[11px] font-medium px-3 py-2 rounded-lg data-[state=active]:bg-amber-500/15 data-[state=active]:text-amber-400 data-[state=active]:shadow-none"
                >
                  <KeyRound className="w-3 h-3 mr-1.5" />
                  Демо доступ
                </TabsTrigger>
              </TabsList>

              {/* System tab */}
              <TabsContent value="system" className="flex-1 mt-0 px-4 sm:px-6 overflow-y-auto custom-scrollbar">
                <SystemTab
                  dbSettings={dbSettings}
                  pendingChanges={pendingChanges}
                  setPending={setPendingChanges}
                />
              </TabsContent>

              {/* Strategy tabs */}
              {STRATEGIES.map(s => (
                <TabsContent key={s.id} value={s.id} className="flex-1 mt-0 px-4 sm:px-6 overflow-y-auto custom-scrollbar">
                  <StrategyTab
                    strategy={s}
                    dbSettings={dbSettings}
                    pendingChanges={pendingChanges}
                    setPending={setPendingChanges}
                  />
                </TabsContent>
              ))}

              {/* Users tab */}
              <TabsContent value="users" className="flex-1 mt-0 px-4 sm:px-6 overflow-y-auto custom-scrollbar">
                <UsersTab />
              </TabsContent>

              {/* Demo tab */}
              <TabsContent value="demo" className="flex-1 mt-0 px-4 sm:px-6 overflow-y-auto custom-scrollbar">
                <DemoTab />
              </TabsContent>
            </Tabs>
          </div>
        )}

        {/* Footer */}
        <div className="shrink-0 flex items-center justify-between px-4 sm:px-6 py-3 border-t border-white/[0.06] bg-[#0d0d14]">
          <div className="flex items-center gap-2">
            {modifiedCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={activeTab === 'system' ? handleReset : () => handleResetStrategy(activeTab)}
                className="text-white/40 hover:text-white/60 text-[11px] h-7 px-2.5"
              >
                <RotateCcw className="w-3 h-3 mr-1" />
                Сброс
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {saved && (
              <span className="text-[11px] text-emerald-400 flex items-center gap-1 animate-in fade-in slide-in-from-right-2">
                <Check className="w-3 h-3" />
                Сохранено
              </span>
            )}
            <Button
              onClick={handleSave}
              disabled={modifiedCount === 0 || saving}
              className={cn(
                'text-[11px] font-semibold h-8 px-4 rounded-lg transition-all',
                modifiedCount > 0
                  ? 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-lg shadow-emerald-500/20'
                  : 'bg-white/[0.04] text-white/20 cursor-not-allowed',
              )}
            >
              {saving ? (
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              ) : (
                <Save className="w-3.5 h-3.5 mr-1.5" />
              )}
              Сохранить
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
