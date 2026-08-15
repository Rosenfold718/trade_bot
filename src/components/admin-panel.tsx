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
    min: 1, max: 30, step: 1, unit: 'шт',
    getDefault: s => s.maxOpenTrades,
  },
  {
    key: 'maxLeverage',
    label: 'Макс. плечо',
    description: 'Максимальное плечо для сделок стратегии',
    type: 'number',
    min: 1, max: 20, step: 1, unit: 'x',
    getDefault: s => s.maxLeverage,
  },
  {
    key: 'riskRewardRatio',
    label: 'Risk:Reward',
    description: 'Отношение риска к прибыли (TP = SL × это значение)',
    type: 'number',
    min: 1, max: 10, step: 0.5, unit: 'R',
    getDefault: s => s.riskRewardRatio,
  },
  {
    key: 'tradeSizePercent',
    label: 'Размер сделки',
    description: '% от баланса на одну сделку',
    type: 'number',
    min: 0.005, max: 0.5, step: 0.005, unit: '%',
    getDefault: s => s.tradeSizePercent,
  },

  // Engine
  {
    key: 'scoreThreshold',
    label: 'Порог сигнала',
    description: 'Минимальный скор для входа в сделку (ниже = больше сделок)',
    type: 'number',
    min: 0.01, max: 0.8, step: 0.01,
    getDefault: s => s.scoreThreshold,
  },
  {
    key: 'adxMin',
    label: 'Мин. ADX',
    description: 'Минимальная сила тренда (0 = без фильтра)',
    type: 'number',
    min: 0, max: 60, step: 5,
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
    min: 100, max: 2000, step: 50, unit: 'шт',
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
    min: 5, max: 20160, step: 5, unit: 'мин',
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
    min: 0, max: 23, step: 1, unit: 'ч',
    getDefault: s => s.timeFilterStart,
  },
  {
    key: 'timeFilterEnd',
    label: 'Конец торгов (МСК)',
    description: 'Час окончания торгового окна',
    type: 'number',
    min: 0, max: 23, step: 1, unit: 'ч',
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
    min: 1, max: 30, step: 1, unit: '%',
    defaultValue: 5,
  },
  {
    key: 'system.maxTPDistance',
    label: 'Макс. дистанция TP',
    description: 'Ограничение максимальной дистанции тейк-профита от входа',
    type: 'number',
    min: 1, max: 30, step: 1, unit: '%',
    defaultValue: 8,
  },
  {
    key: 'system.maxSLDistance',
    label: 'Макс. дистанция SL',
    description: 'Ограничение максимальной дистанции стоп-лосса от входа',
    type: 'number',
    min: 1, max: 15, step: 0.5, unit: '%',
    defaultValue: 5,
  },
  {
    key: 'system.maxSLCapDistance',
    label: 'Auto-repair SL кап',
    description: 'Авто-ремонт: SL дальше N% будет обрезан',
    type: 'number',
    min: 1, max: 15, step: 0.5, unit: '%',
    defaultValue: 5,
  },
  {
    key: 'system.maxTPCapDistance',
    label: 'Auto-repair TP кап',
    description: 'Авто-ремонт: TP дальше N% будет обрезан',
    type: 'number',
    min: 1, max: 25, step: 1, unit: '%',
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
    min: 5, max: 50, step: 5, unit: 'шт',
    defaultValue: 20,
  },
  {
    key: 'system.volumeBoost',
    label: 'Буст объёма',
    description: 'Множитель объёма для буста сигнала (1.0 = нет буста)',
    type: 'number',
    min: 1.0, max: 2.5, step: 0.1, unit: 'x',
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
      if (fullKey in pendingChanges) {
        return def.type === 'boolean'
          ? pendingChanges[fullKey] === 'true'
          : def.type === 'number'
            ? parseFloat(pendingChanges[fullKey])
            : pendingChanges[fullKey];
      }
      if (fullKey in dbSettings) {
        return def.type === 'boolean'
          ? dbSettings[fullKey] === 'true'
          : def.type === 'number'
            ? parseFloat(dbSettings[fullKey])
            : dbSettings[fullKey];
      }
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

  const trading = STRATEGY_SETTINGS.filter(d => ['maxOpenTrades', 'maxLeverage', 'riskRewardRatio', 'tradeSizePercent'].includes(d.key));
  const engine = STRATEGY_SETTINGS.filter(d => ['scoreThreshold', 'adxMin', 'mtfEnabled'].includes(d.key));
  const timing = STRATEGY_SETTINGS.filter(d => ['defaultInterval', 'candleLimit', 'monitorInterval', 'maxHoldMinutes', 'timeFilterEnabled', 'timeFilterStart', 'timeFilterEnd'].includes(d.key));

  return (
    <ScrollArea className="h-[calc(100vh-200px)] sm:h-[calc(100vh-160px)] pr-2">
      <div className="space-y-4 pb-8 max-w-xl mx-auto">
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

        <div>
          <div className="text-[10px] font-bold uppercase tracking-widest text-white/25 mb-2 px-1">Торговые параметры</div>
          <div className="space-y-2">
            {trading.map(def => (
              <SliderRow key={def.key} label={def.label} description={def.description} value={getValue(def)} defaultValue={getDefaultValue(def)} onChange={v => handleChange(def.key, v)} type={def.type} min={def.min} max={def.max} step={def.step} unit={def.unit} options={def.options} colorClass={strategy.color} />
            ))}
          </div>
        </div>

        <Separator className="bg-white/[0.04]" />

        <div>
          <div className="text-[10px] font-bold uppercase tracking-widest text-white/25 mb-2 px-1">Движок сигналов</div>
          <div className="space-y-2">
            {engine.map(def => (
              <SliderRow key={def.key} label={def.label} description={def.description} value={getValue(def)} defaultValue={getDefaultValue(def)} onChange={v => handleChange(def.key, v)} type={def.type} min={def.min} max={def.max} step={def.step} unit={def.unit} options={def.options} colorClass={strategy.color} />
            ))}
          </div>
        </div>

        <Separator className="bg-white/[0.04]" />

        <div>
          <div className="text-[10px] font-bold uppercase tracking-widest text-white/25 mb-2 px-1">Тайминг и мониторинг</div>
          <div className="space-y-2">
            {timing.map(def => (
              <SliderRow key={def.key} label={def.label} description={def.description} value={getValue(def)} defaultValue={getDefaultValue(def)} onChange={v => handleChange(def.key, v)} type={def.type} min={def.min} max={def.max} step={def.step} unit={def.unit} options={def.options} colorClass={strategy.color} />
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
      if (def.key in pendingChanges) {
        return def.type === 'boolean'
          ? pendingChanges[def.key] === 'true'
          : def.type === 'number'
            ? parseFloat(pendingChanges[def.key])
            : pendingChanges[def.key];
      }
      if (def.key in dbSettings) {
        return def.type === 'boolean'
          ? dbSettings[def.key] === 'true'
          : def.type === 'number'
            ? parseFloat(dbSettings[def.key])
            : dbSettings[def.key];
      }
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

        <div>
          <div className="text-[10px] font-bold uppercase tracking-widest text-white/25 mb-2 px-1">Управление рисками</div>
          <div className="space-y-2">
            {risk.map(def => (
              <SliderRow key={def.key} label={def.label} description={def.description} value={getValue(def)} defaultValue={getDefaultValue(def)} onChange={v => handleChange(def.key, def, v)} type={def.type} min={def.min} max={def.max} step={def.step} unit={def.unit} colorClass="text-emerald-400" />
            ))}
          </div>
        </div>

        <Separator className="bg-white/[0.04]" />

        <div>
          <div className="text-[10px] font-bold uppercase tracking-widest text-white/25 mb-2 px-1">Трейлинг-стопы</div>
          <div className="space-y-2">
            {trailing.map(def => (
              <SliderRow key={def.key} label={def.label} description={def.description} value={getValue(def)} defaultValue={getDefaultValue(def)} onChange={v => handleChange(def.key, def, v)} type={def.type} colorClass="text-emerald-400" />
            ))}
          </div>
        </div>

        <Separator className="bg-white/[0.04]" />

        <div>
          <div className="text-[10px] font-bold uppercase tracking-widest text-white/25 mb-2 px-1">Сканирование рынка</div>
          <div className="space-y-2">
            {scan.map(def => (
              <SliderRow key={def.key} label={def.label} description={def.description} value={getValue(def)} defaultValue={getDefaultValue(def)} onChange={v => handleChange(def.key, def, v)} type={def.type} min={def.min} max={def.max} step={def.step} unit={def.unit} colorClass="text-emerald-400" />
            ))}
          </div>
        </div>
      </div>
    </ScrollArea>
  );
}

// ============================================================
// Main AdminPanel component — System + Strategy settings only
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
      const updates: Record<string, string> = { ...pendingChanges };
      const deletes: string[] = [];

      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates, deletes }),
      });
      const data = await res.json();
      setDbSettings(data.settings ?? {});
      setPendingChanges({});
      setSaved(true);
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
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200" onClick={onClose} />
      <div className="relative w-full h-full sm:h-[92vh] sm:max-h-[900px] sm:max-w-[700px] sm:rounded-2xl bg-[#0d0d14] border border-white/[0.08] shadow-2xl flex flex-col animate-in zoom-in-95 slide-in-from-bottom-4 duration-300 overflow-hidden">
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-4 sm:px-6 py-3.5 border-b border-white/[0.06] bg-[#0d0d14]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white/90">Настройки</h2>
              <p className="text-[10px] text-white/30">Параметры стратегий и системы</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {modifiedCount > 0 && (
              <span className="text-[10px] font-mono text-yellow-400 bg-yellow-500/10 border border-yellow-500/20 px-2 py-0.5 rounded-full">
                {modifiedCount} изм.
              </span>
            )}
            <button onClick={onClose} className="w-8 h-8 rounded-lg bg-white/[0.04] border border-white/[0.06] flex items-center justify-center hover:bg-white/[0.08] transition-colors">
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
                    style={{ '--tw-text-opacity': 1 as unknown as number } as React.CSSProperties}
                  >
                    {s.id === 'momentum' && <TrendingUp className="w-3 h-3 mr-1.5" />}
                    {s.id === 'scalper' && <Crosshair className="w-3 h-3 mr-1.5" />}
                    {s.id === 'position-alpha' && <Activity className="w-3 h-3 mr-1.5" />}
                    <span className={activeTab === s.id ? s.color : ''}>{s.name}</span>
                  </TabsTrigger>
                ))}
              </TabsList>

              <TabsContent value="system" className="flex-1 mt-0 px-4 sm:px-6 overflow-y-auto custom-scrollbar">
                <SystemTab dbSettings={dbSettings} pendingChanges={pendingChanges} setPending={setPendingChanges} />
              </TabsContent>

              {STRATEGIES.map(s => (
                <TabsContent key={s.id} value={s.id} className="flex-1 mt-0 px-4 sm:px-6 overflow-y-auto custom-scrollbar">
                  <StrategyTab strategy={s} dbSettings={dbSettings} pendingChanges={pendingChanges} setPending={setPendingChanges} />
                </TabsContent>
              ))}
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
