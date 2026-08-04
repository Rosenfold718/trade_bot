'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  Play, Loader2, XCircle, TrendingUp, TrendingDown, BarChart3,
  Target, Activity, Users, Trophy, Zap, Clock, RotateCcw, FileText, ArrowLeft,
  ArrowUpRight, ArrowDownRight, DollarSign, ChevronDown, ChevronUp,
  Sparkles, Terminal, Layers, Crown,
} from 'lucide-react';

// ============================================================
// Types
// ============================================================

interface BacktestDialogProps {
  open: boolean;
  onClose: () => void;
}

interface AccountLine {
  id: number;
  strategyId: string;
  totalTrades: number;
  winRate: number;
  pnlPct: number;
  emoji: string;
}

interface Progress {
  stage: string;
  interval?: string;
  strategyId?: string;
  current: number;
  total: number;
}

interface TradeForReport {
  symbol: string;
  direction: 'long' | 'short';
  entryPrice: number;
  closePrice: number | null;
  amount: number;
  leverage: number;
  pnl: number | null;
  reason: string;
  openTime: string;
  closeTime: string | null;
  stopLoss: number;
  takeProfit: number;
}

interface BestAccountReport {
  id: number;
  strategyId: string;
  strategyLabel: string;
  startBalance: number;
  endBalance: number;
  pnl: number;
  pnlPct: number;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  maxDrawdownPct: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  longTrades: number;
  shortTrades: number;
  longWinRate: number;
  shortWinRate: number;
  largestWin: number;
  largestLoss: number;
  trades: TradeForReport[];
  equityCurve: { time: number; equity: number }[];
  symbolPerformance: Record<string, { count: number; wins: number; pnl: number }>;
}

interface FinalResult {
  profitable: number;
  totalTrades: number;
  avgPnlPct: string;
  bestPnl: number;
  worstPnl: number;
  medianPnl: number;
  globalWR: string;
  avgDD: string;
  stratStats: {
    id: string; interval: string; count: number; profitable: number;
    avgPnl: string; avgWR: string; avgDD: string; bestPnl: string; worstPnl: string; totalTrades: number;
  }[];
  distribution: { from: number; to: number; count: number }[];
  bestUserId: string;
  medianUserId: string;
  allResults: {
    id: number; strategyId: string; pnlPct: number; totalTrades: number;
    winRate: number; maxDrawdownPct: number; profitFactor: number;
  }[];
  bestAccount?: BestAccountReport;
  usedRealData?: boolean;
  dataSource?: string;
}

// ============================================================
// Constants
// ============================================================

const STRAT_NAMES: Record<string, string> = {
  momentum: 'Трендовая торговля',
  scalper: 'Паттерны',
  'position-alpha': 'Инвестиции',
};

const STRAT_COLORS: Record<string, string> = {
  momentum: 'text-amber-400',
  scalper: 'text-violet-400',
  'position-alpha': 'text-blue-400',
};

const STRAT_GLOW: Record<string, string> = {
  momentum: 'shadow-amber-500/10',
  scalper: 'shadow-violet-500/10',
  'position-alpha': 'shadow-blue-500/10',
};

const STRAT_GRADIENT: Record<string, string> = {
  momentum: 'from-amber-500/15 via-amber-500/5 to-transparent',
  scalper: 'from-violet-500/15 via-violet-500/5 to-transparent',
  'position-alpha': 'from-blue-500/15 via-blue-500/5 to-transparent',
};

const STRAT_ACCENT: Record<string, string> = {
  momentum: 'border-amber-500/20',
  scalper: 'border-violet-500/20',
  'position-alpha': 'border-blue-500/20',
};

type View = 'results' | 'report';

// ============================================================
// Main Component
// ============================================================

export default function BacktestDialog({ open, onClose }: BacktestDialogProps) {
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [accounts, setAccounts] = useState<AccountLine[]>([]);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [result, setResult] = useState<FinalResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>('results');
  const logsEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => { logsEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs]);

  const reset = useCallback(() => {
    setLogs([]); setAccounts([]); setProgress(null); setResult(null); setError(null); setView('results');
  }, []);

  const handleClose = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
    setRunning(false);
    onClose();
  }, [onClose]);

  const handleStart = useCallback(async () => {
    reset(); setRunning(true);
    abortRef.current = new AbortController();
    try {
      const res = await fetch('/api/backtest-run', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer trade-bot-admin-2024' },
        signal: abortRef.current.signal,
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        let currentEvent = '';
        for (const line of lines) {
          if (line.startsWith('event: ')) { currentEvent = line.slice(7).trim(); }
          else if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (currentEvent === 'log') setLogs(prev => [...prev, data.msg]);
              else if (currentEvent === 'progress') setProgress(data);
              else if (currentEvent === 'account') setAccounts(prev => [...prev, data]);
              else if (currentEvent === 'done') { setResult(data); setRunning(false); }
              else if (currentEvent === 'error') { setError(data.msg); setRunning(false); }
            } catch { /* skip */ }
            currentEvent = '';
          }
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') setError(err.message);
      setRunning(false);
    }
  }, [reset]);

  const progressPct = progress
    ? progress.stage === 'candles' ? Math.round((progress.current / progress.total) * 30) : Math.round(30 + (progress.current / progress.total) * 70)
    : result ? 100 : 0;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="bg-[#0a0a16] border-white/[0.06] max-w-2xl w-[95vw] max-h-[92vh] flex flex-col p-0 gap-0 overflow-hidden shadow-2xl shadow-black/50 backdrop-blur-xl">
        {/* Subtle gradient accent at the top */}
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-emerald-500/40 to-transparent" />
        <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-emerald-500/[0.03] to-transparent pointer-events-none" />

        {/* Header */}
        <DialogHeader className="px-6 pt-5 pb-1 shrink-0 relative">
          <DialogTitle className="text-sm font-semibold text-white flex items-center gap-2.5">
            <div className="flex items-center justify-center h-7 w-7 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
              <BarChart3 className="h-3.5 w-3.5 text-emerald-400" />
            </div>
            {view === 'report' && result?.bestAccount ? (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setView('results')}
                  className="flex items-center gap-1 text-white/30 hover:text-white/60 transition-colors rounded-md px-1.5 py-0.5 hover:bg-white/[0.04]"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                </button>
                <span className="text-white/70">Отчет:</span>
                <span className="text-amber-400">Аккаунт #{result.bestAccount.id}</span>
              </div>
            ) : (
              <span className="text-white/90">Бэктест: 100 аккаунтов × 2 месяца</span>
            )}
          </DialogTitle>
          <DialogDescription className="text-[11px] text-white/30 ml-[38px]">
            {view === 'report' && result?.bestAccount
              ? `${result.bestAccount.strategyLabel} · ${result.bestAccount.totalTrades} сделок · 2 месяца`
              : 'Детерминированные данные · 3 стратегии · $100 начальный депозит каждый'
            }
          </DialogDescription>
        </DialogHeader>

        {/* Progress bar */}
        {!result && !error && (
          <div className="px-6 py-3 shrink-0">
            <div className="flex items-center gap-3">
              <div className="flex-1 h-1 bg-white/[0.06] rounded-full overflow-hidden">
                <div
                  className={cn(
                    'h-full rounded-full transition-all duration-700 ease-out relative',
                    running
                      ? 'bg-gradient-to-r from-emerald-600 via-emerald-500 to-emerald-400'
                      : 'bg-white/10'
                  )}
                  style={{ width: `${progressPct}%` }}
                >
                  {running && (
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-pulse" />
                  )}
                </div>
              </div>
              <span className="text-[10px] font-mono text-white/25 tabular-nums w-8 text-right">{progressPct}%</span>
            </div>
            {progress && (
              <p className="text-[10px] text-white/20 mt-1.5 font-mono tracking-tight">
                <span className="inline-flex items-center gap-1">
                  <span className={cn(
                    'inline-block h-1 w-1 rounded-full',
                    progress.stage === 'candles' ? 'bg-violet-400 animate-pulse' : 'bg-emerald-400 animate-pulse'
                  )} />
                  {progress.stage === 'candles'
                    ? `Генерация свечей ${progress.interval}: ${progress.current}/${progress.total}`
                    : `Симуляция: ${progress.current}/${progress.total} аккаунтов`}
                </span>
              </p>
            )}
          </div>
        )}

        {/* Main content */}
        <div className="flex-1 min-h-0 overflow-hidden px-6 pb-2">
          {error && (
            <div className="flex items-center gap-2.5 text-red-400 text-xs bg-red-500/[0.08] border border-red-500/15 rounded-xl px-4 py-3">
              <XCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {!result && !error && (
            <div className="h-[420px] rounded-xl bg-[#08080f] border border-white/[0.05] overflow-hidden flex flex-col">
              {/* Terminal header bar */}
              <div className="flex items-center gap-2 px-4 py-2 border-b border-white/[0.04] bg-white/[0.01] shrink-0">
                <div className="flex items-center gap-1.5">
                  <div className="h-2 w-2 rounded-full bg-white/[0.08]" />
                  <div className="h-2 w-2 rounded-full bg-white/[0.08]" />
                  <div className="h-2 w-2 rounded-full bg-white/[0.08]" />
                </div>
                <Terminal className="h-3 w-3 text-white/15" />
                <span className="text-[9px] text-white/15 font-mono uppercase tracking-widest">Backtest Engine</span>
                {running && (
                  <span className="ml-auto flex items-center gap-1 text-[9px] text-emerald-400/50">
                    <span className="h-1 w-1 rounded-full bg-emerald-400 animate-pulse" />
                    RUNNING
                  </span>
                )}
              </div>
              <ScrollArea className="flex-1">
                <div className="p-4 space-y-0.5 font-mono text-[11px] leading-relaxed">
                  {logs.length === 0 && !running && (
                    <div className="flex flex-col items-center justify-center py-16 gap-3 text-white/15">
                      <div className="h-12 w-12 rounded-2xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center">
                        <Play className="h-5 w-5 text-white/20" />
                      </div>
                      <p className="text-xs">Нажмите «Запустить» для старта бэктеста</p>
                    </div>
                  )}
                  {logs.map((log, i) => (
                    <div key={i} className="text-white/40 flex gap-2">
                      <span className="text-white/15 select-none shrink-0 w-5 text-right">{i + 1}</span>
                      <span>{log}</span>
                    </div>
                  ))}
                  {accounts.map((a, i) => (
                    <div key={i} className={cn(
                      'flex gap-2',
                      a.pnlPct >= 0 ? 'text-emerald-400/50' : 'text-red-400/50'
                    )}>
                      <span className="text-white/10 select-none shrink-0 w-5 text-right">{logs.length + i + 1}</span>
                      <span>
                        {a.emoji} <span className="text-white/25">#{String(a.id).padStart(3)}</span>{' '}
                        <span className="text-white/30">{a.strategyId}</span>{' '}
                        <span className="text-white/20">{String(a.totalTrades).padStart(3)} trades</span>{' '}
                        <span className="text-white/20">|</span>{' '}
                        <span className="text-white/40">{String(a.winRate).padStart(5)}% WR</span>{' '}
                        <span className="text-white/20">|</span>{' '}
                        <span className="font-semibold">{a.pnlPct >= 0 ? '+' : ''}{a.pnlPct}%</span>
                      </span>
                    </div>
                  ))}
                  {running && (
                    <div className="text-white/15 animate-pulse flex items-center gap-1.5">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      <span>Вычисление...</span>
                    </div>
                  )}
                  <div ref={logsEndRef} />
                </div>
              </ScrollArea>
            </div>
          )}

          {result && view === 'results' && <ResultsPanel result={result} onReport={() => setView('report')} />}
          {result && view === 'report' && result.bestAccount && <ReportPanel account={result.bestAccount} />}
        </div>

        {/* Footer actions */}
        <div className="px-6 py-4 shrink-0 border-t border-white/[0.04] bg-white/[0.01] flex items-center gap-2.5">
          {!result && (
            <Button
              onClick={handleStart}
              disabled={running}
              className={cn(
                'flex-1 h-11 text-xs font-semibold rounded-xl transition-all duration-300',
                running
                  ? 'bg-white/[0.04] text-white/25 cursor-not-allowed border border-white/[0.06]'
                  : 'bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white shadow-lg shadow-emerald-600/20 hover:shadow-emerald-500/30 hover:scale-[1.01] active:scale-[0.99]'
              )}
            >
              {running
                ? <><Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />Выполняется...</>
                : <><Sparkles className="h-3.5 w-3.5 mr-2" />Запустить бэктест</>
              }
            </Button>
          )}
          {result && view === 'results' && (
            <>
              {result.bestAccount && (
                <Button
                  onClick={() => setView('report')}
                  className="flex-1 h-11 text-xs font-semibold rounded-xl bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white shadow-lg shadow-blue-600/20 hover:shadow-blue-500/30 transition-all duration-300 hover:scale-[1.01] active:scale-[0.99]"
                >
                  <FileText className="h-3.5 w-3.5 mr-2" />Создать отчет
                </Button>
              )}
              <Button
                onClick={handleStart}
                disabled={running}
                className="h-11 text-xs font-semibold rounded-xl bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-white shadow-lg shadow-amber-600/20 hover:shadow-amber-500/30 transition-all duration-300 hover:scale-[1.01] active:scale-[0.99]"
              >
                <RotateCcw className="h-3.5 w-3.5 mr-2" />Заново
              </Button>
            </>
          )}
          {result && view === 'report' && (
            <Button
              onClick={() => setView('results')}
              className="flex-1 h-11 text-xs font-semibold rounded-xl bg-white/[0.05] hover:bg-white/[0.08] text-white/60 border border-white/[0.08] transition-all duration-200"
            >
              <ArrowLeft className="h-3.5 w-3.5 mr-2" />К результатам
            </Button>
          )}
          <Button
            variant="outline"
            onClick={handleClose}
            className="h-11 text-xs rounded-xl border-white/[0.06] text-white/30 hover:bg-white/[0.04] hover:text-white/50 transition-all duration-200"
          >
            {result ? 'Закрыть' : running ? 'Отменить' : 'Закрыть'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// Results Panel
// ============================================================

function ResultsPanel({ result, onReport }: { result: FinalResult; onReport: () => void }) {
  const bestId = result.allResults.sort((a, b) => b.pnlPct - a.pnlPct)[0]?.id;

  return (
    <ScrollArea className="h-[420px] space-y-4 pr-1">
      {/* Best account hero card */}
      {result.bestAccount && (
        <div className="relative rounded-2xl border border-amber-500/20 bg-gradient-to-br from-amber-500/[0.08] via-amber-500/[0.03] to-transparent p-5 overflow-hidden">
          {/* Decorative glow */}
          <div className="absolute -top-12 -right-12 h-32 w-32 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />

          <div className="relative">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center h-9 w-9 rounded-xl bg-amber-500/15 border border-amber-500/20">
                  <Crown className="h-4 w-4 text-amber-400" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-amber-300">Лучший аккаунт #{result.bestAccount.id}</span>
                    <Badge variant="outline" className="text-[9px] px-2 py-0 border-amber-500/25 text-amber-400/60 font-medium">
                      {result.bestAccount.strategyLabel}
                    </Badge>
                  </div>
                  <span className="text-[11px] text-white/25">
                    {result.bestAccount.totalTrades} сделок · 2 месяца
                  </span>
                </div>
              </div>
              <div className="text-right">
                <div className={cn(
                  'text-2xl font-bold font-mono tabular-nums',
                  result.bestAccount.pnlPct >= 0 ? 'text-emerald-400' : 'text-red-400'
                )}>
                  {result.bestAccount.pnlPct >= 0 ? '+' : ''}{result.bestAccount.pnlPct}%
                </div>
              </div>
            </div>

            <div className="grid grid-cols-4 gap-3">
              <MetricPill label="Сделок" value={`${result.bestAccount.totalTrades}`} />
              <MetricPill label="Win Rate" value={`${result.bestAccount.winRate}%`} />
              <MetricPill label="Просадка" value={`${result.bestAccount.maxDrawdownPct}%`} negative />
              <MetricPill label="Баланс" value={`$${result.bestAccount.endBalance.toFixed(2)}`} positive />
            </div>
          </div>
        </div>
      )}

      {/* Data source badge */}
      <div className="flex items-center gap-2">
        {result.usedRealData ? (
          <Badge variant="outline" className="text-[9px] px-2 py-0.5 border-emerald-500/25 text-emerald-400/60 bg-emerald-500/[0.05]">
            Binance API
          </Badge>
        ) : (
          <Badge variant="outline" className="text-[9px] px-2 py-0.5 border-amber-500/25 text-amber-400/60 bg-amber-500/[0.05]">
            Синтетические данные
          </Badge>
        )}
        <span className="text-[10px] text-white/15">
          {result.usedRealData ? 'Реальные свечи за 2 месяца' : 'Детерминированная симуляция'}
        </span>
      </div>

      {/* Hero stat cards */}
      <div className="grid grid-cols-3 gap-2.5">
        <HeroStat
          label="Прибыльных"
          value={`${result.profitable}/102`}
          icon={<Users className="h-3.5 w-3.5" />}
          color={result.profitable >= 50 ? 'emerald' : result.profitable >= 30 ? 'amber' : 'red'}
        />
        <HeroStat
          label="Средний PnL"
          value={`${parseFloat(result.avgPnlPct) >= 0 ? '+' : ''}${result.avgPnlPct}%`}
          icon={<TrendingUp className="h-3.5 w-3.5" />}
          color={parseFloat(result.avgPnlPct) >= 0 ? 'emerald' : 'red'}
        />
        <HeroStat
          label="Глобальный WR"
          value={`${result.globalWR}%`}
          icon={<Target className="h-3.5 w-3.5" />}
          color="emerald"
        />
      </div>

      {/* Secondary stats row */}
      <div className="grid grid-cols-3 gap-2.5">
        <GlassStat label="Лучший" value={`+${result.bestPnl.toFixed(1)}%`} positive />
        <GlassStat label="Медиана" value={`${result.medianPnl >= 0 ? '+' : ''}${result.medianPnl.toFixed(1)}%`} positive={result.medianPnl >= 0} />
        <GlassStat label="Худший" value={`${result.worstPnl.toFixed(1)}%`} positive={result.worstPnl >= 0} />
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <GlassStat label="Всего сделок" value={`${result.totalTrades}`} neutral />
        <GlassStat label="Ср. просадка" value={`${result.avgDD}%`} neutral />
      </div>

      {/* Per-strategy breakdown */}
      <SectionHeader title="По стратегиям" icon={<Layers className="h-3 w-3" />} />
      <div className="space-y-2">
        {result.stratStats.map(s => (
          <div
            key={s.id}
            className={cn(
              'rounded-xl border bg-gradient-to-r p-4 transition-all duration-200 hover:scale-[1.005]',
              STRAT_GRADIENT[s.id],
              STRAT_ACCENT[s.id]
            )}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className={cn('text-xs font-bold', STRAT_COLORS[s.id])}>
                  {STRAT_NAMES[s.id] ?? s.id}
                </span>
              </div>
              <span className="text-[10px] text-white/25 font-mono tabular-nums">
                {s.interval} · {s.totalTrades} сделок
              </span>
            </div>
            <div className="grid grid-cols-4 gap-3 text-center">
              <div>
                <div className="text-[9px] text-white/20 uppercase tracking-wider mb-1">Прибыльных</div>
                <div className={cn(
                  'text-xs font-bold font-mono tabular-nums',
                  s.profitable >= s.count / 2 ? 'text-emerald-400' : 'text-red-400'
                )}>{s.profitable}/{s.count}</div>
              </div>
              <div>
                <div className="text-[9px] text-white/20 uppercase tracking-wider mb-1">Ср. PnL</div>
                <div className={cn(
                  'text-xs font-bold font-mono tabular-nums',
                  parseFloat(s.avgPnl) >= 0 ? 'text-emerald-400' : 'text-red-400'
                )}>{parseFloat(s.avgPnl) >= 0 ? '+' : ''}{s.avgPnl}%</div>
              </div>
              <div>
                <div className="text-[9px] text-white/20 uppercase tracking-wider mb-1">Ср. WR</div>
                <div className="text-xs font-bold font-mono tabular-nums text-white/50">{s.avgWR}%</div>
              </div>
              <div>
                <div className="text-[9px] text-white/20 uppercase tracking-wider mb-1">Диапазон</div>
                <div className="text-xs font-mono tabular-nums text-white/35">{s.worstPnl}% / +{s.bestPnl}%</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* PnL Distribution */}
      {result.distribution.length > 0 && (
        <>
          <SectionHeader title="Распределение PnL" icon={<BarChart3 className="h-3 w-3" />} />
          <div className="rounded-xl bg-white/[0.02] border border-white/[0.04] p-4 space-y-1.5">
            {result.distribution.map((d, i) => {
              const maxCount = Math.max(...result.distribution.map(x => x.count));
              const w = maxCount > 0 ? (d.count / maxCount) * 100 : 0;
              const isProfit = d.from >= 0;
              return (
                <div key={i} className="flex items-center gap-2.5 text-[10px] font-mono tabular-nums">
                  <span className="text-white/25 w-28 text-right shrink-0">
                    {d.from >= 0 ? '+' : ''}{d.from}% → {d.to >= 0 ? '+' : ''}{d.to}%
                  </span>
                  <div className="flex-1 h-5 bg-white/[0.03] rounded-md overflow-hidden">
                    <div
                      className={cn(
                        'h-full rounded-md transition-all duration-1000 ease-out',
                        isProfit
                          ? 'bg-gradient-to-r from-emerald-600/40 to-emerald-500/60'
                          : 'bg-gradient-to-r from-red-600/40 to-red-500/60'
                      )}
                      style={{ width: `${Math.max(w, 3)}%` }}
                    />
                  </div>
                  <span className={cn(
                    'w-6 text-right shrink-0 font-semibold tabular-nums',
                    isProfit ? 'text-emerald-400/60' : 'text-red-400/60'
                  )}>{d.count}</span>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* All accounts table */}
      <details className="group">
        <summary className="cursor-pointer hover:text-white/40 transition-colors flex items-center gap-1.5 py-1 text-white/20">
          <Users className="h-3 w-3" />
          <span className="text-[10px] uppercase tracking-[0.15em] font-semibold">Все 102 аккаунта</span>
        </summary>
        <div className="mt-2 rounded-xl bg-[#08080f] border border-white/[0.04] overflow-hidden">
          <div className="grid grid-cols-6 gap-1 px-4 py-2 text-[9px] text-white/20 font-mono uppercase tracking-wider border-b border-white/[0.04] bg-white/[0.01]">
            <span>#</span><span>Стратегия</span><span className="text-right">Сделок</span><span className="text-right">WR%</span><span className="text-right">PnL%</span><span className="text-right">DD%</span>
          </div>
          <ScrollArea className="max-h-56">
            {result.allResults.sort((a, b) => b.pnlPct - a.pnlPct).map((a, idx) => (
              <div key={a.id} className={cn(
                'grid grid-cols-6 gap-1 px-4 py-2 text-[10px] font-mono tabular-nums border-b border-white/[0.02] transition-colors hover:bg-white/[0.02]',
                a.id === bestId && 'bg-amber-500/[0.04] border-l-2 border-l-amber-500/30',
                idx % 2 === 1 && a.id !== bestId && 'bg-white/[0.01]'
              )}>
                <span className="text-white/25">{a.id === bestId ? '🏆' : a.id}</span>
                <span className={STRAT_COLORS[a.strategyId]}>{STRAT_NAMES[a.strategyId]?.split(' ')[0]}</span>
                <span className="text-right text-white/35">{a.totalTrades}</span>
                <span className="text-right text-white/45">{a.winRate}%</span>
                <span className={cn('text-right font-semibold', a.pnlPct >= 0 ? 'text-emerald-400' : 'text-red-400')}>{a.pnlPct >= 0 ? '+' : ''}{a.pnlPct}%</span>
                <span className="text-right text-white/25">{a.maxDrawdownPct}%</span>
              </div>
            ))}
          </ScrollArea>
        </div>
      </details>
    </ScrollArea>
  );
}

// ============================================================
// Report Panel (Best Account Detail)
// ============================================================

function ReportPanel({ account }: { account: BestAccountReport }) {
  const [expanded, setExpanded] = useState(false);
  const stratColor = STRAT_COLORS[account.strategyId] ?? 'text-emerald-400';

  // Equity curve SVG
  const eqCurve = account.equityCurve.length > 1 ? account.equityCurve : [
    { time: 0, equity: account.startBalance },
    { time: 1, equity: account.endBalance },
  ];
  const eqMin = Math.min(...eqCurve.map(p => p.equity));
  const eqMax = Math.max(...eqCurve.map(p => p.equity));
  const eqRange = eqMax - eqMin || 1;
  const eqW = 580, eqH = 140;
  const eqPoints = eqCurve.map((p, i) => {
    const x = (i / (eqCurve.length - 1)) * eqW;
    const y = eqH - ((p.equity - eqMin) / eqRange) * (eqH - 16) - 8;
    return `${x},${y}`;
  });
  const eqPath = eqPoints.map((p, i) => `${i === 0 ? 'M' : 'L'}${p}`).join(' ');
  const eqAreaPath = eqPath + ` L${eqW},${eqH} L0,${eqH} Z`;
  const startLine = eqH - ((account.startBalance - eqMin) / eqRange) * (eqH - 16) - 8;
  const isPositive = account.pnlPct >= 0;
  const strokeColor = isPositive ? '#10b981' : '#ef4444';

  // Grid lines for chart
  const gridLines = [0, 0.25, 0.5, 0.75, 1].map(pct => {
    const y = 8 + pct * (eqH - 16);
    const val = eqMax - pct * eqRange;
    return { y, val };
  });

  // Sorted trades
  const tradesSorted = [...account.trades].sort((a, b) => new Date(b.openTime).getTime() - new Date(a.openTime).getTime());

  // Symbol perf sorted by PnL
  const symPerfSorted = Object.entries(account.symbolPerformance)
    .map(([sym, d]) => ({ sym, ...d, wr: d.count > 0 ? Math.round((d.wins / d.count) * 1000) / 10 : 0 }))
    .sort((a, b) => b.pnl - a.pnl);

  return (
    <ScrollArea className="h-[420px] space-y-4 pr-1">
      {/* Hero card */}
      <div className="relative rounded-2xl border border-amber-500/20 bg-gradient-to-br from-amber-500/[0.08] via-amber-500/[0.03] to-transparent p-5 overflow-hidden">
        <div className="absolute -top-12 -right-12 h-32 w-32 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-8 -left-8 h-24 w-24 bg-emerald-500/5 rounded-full blur-2xl pointer-events-none" />

        <div className="relative">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center h-10 w-10 rounded-xl bg-amber-500/15 border border-amber-500/20">
                <Crown className="h-5 w-5 text-amber-400" />
              </div>
              <div>
                <div className="text-sm font-bold text-white">Аккаунт #{account.id}</div>
                <div className={cn('text-xs font-medium', stratColor)}>{account.strategyLabel}</div>
              </div>
            </div>
            <div className="text-right">
              <div className={cn(
                'text-3xl font-bold font-mono tabular-nums',
                isPositive ? 'text-emerald-400' : 'text-red-400'
              )}>
                {isPositive ? '+' : ''}{account.pnlPct}%
              </div>
              <div className="text-[11px] text-white/25 font-mono tabular-nums mt-0.5">
                ${account.startBalance} → ${account.endBalance.toFixed(2)}
              </div>
            </div>
          </div>

          {/* Equity curve */}
          <div className="rounded-xl bg-[#08080f] border border-white/[0.05] p-3 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[9px] text-white/20 uppercase tracking-widest font-medium">Кривая эквити</span>
              <span className="text-[9px] text-white/15 font-mono tabular-nums">
                ${eqMin.toFixed(2)} – ${eqMax.toFixed(2)}
              </span>
            </div>
            <svg viewBox={`0 0 ${eqW} ${eqH}`} className="w-full h-auto" preserveAspectRatio="none">
              <defs>
                <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={strokeColor} stopOpacity="0.25" />
                  <stop offset="100%" stopColor={strokeColor} stopOpacity="0" />
                </linearGradient>
                <linearGradient id="eqStroke" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor={strokeColor} stopOpacity="0.6" />
                  <stop offset="50%" stopColor={strokeColor} stopOpacity="1" />
                  <stop offset="100%" stopColor={strokeColor} stopOpacity="0.6" />
                </linearGradient>
              </defs>
              {/* Grid lines */}
              {gridLines.map((line, i) => (
                <g key={i}>
                  <line x1="0" y1={line.y} x2={eqW} y2={line.y} stroke="white" strokeOpacity="0.03" />
                  <text x="2" y={line.y - 3} fill="white" fillOpacity="0.1" fontSize="7" fontFamily="monospace">
                    ${line.val.toFixed(0)}
                  </text>
                </g>
              ))}
              {/* Starting balance line */}
              <line x1="0" y1={startLine} x2={eqW} y2={startLine} stroke="white" strokeOpacity="0.08" strokeDasharray="3 5" />
              <text x={eqW - 2} y={startLine - 3} fill="white" fillOpacity="0.15" fontSize="7" fontFamily="monospace" textAnchor="end">
                Start
              </text>
              {/* Area fill */}
              <path d={eqAreaPath} fill="url(#eqGrad)" />
              {/* Line */}
              <path d={eqPath} fill="none" stroke="url(#eqStroke)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              {/* End dot */}
              <circle
                cx={eqPoints[eqPoints.length - 1].split(',')[0]}
                cy={eqPoints[eqPoints.length - 1].split(',')[1]}
                r="3"
                fill={strokeColor}
                fillOpacity="0.8"
              />
              <circle
                cx={eqPoints[eqPoints.length - 1].split(',')[0]}
                cy={eqPoints[eqPoints.length - 1].split(',')[1]}
                r="6"
                fill={strokeColor}
                fillOpacity="0.15"
              />
            </svg>
          </div>
        </div>
      </div>

      {/* Key metrics grid */}
      <div className="grid grid-cols-4 gap-2.5">
        <MetricBox label="Сделок" value={`${account.totalTrades}`} icon={<Activity className="h-3 w-3" />} />
        <MetricBox label="Win Rate" value={`${account.winRate}%`} icon={<Target className="h-3 w-3" />} positive={account.winRate >= 50} />
        <MetricBox label="Profit Factor" value={`${account.profitFactor}`} icon={<TrendingUp className="h-3 w-3" />} positive={account.profitFactor >= 1} />
        <MetricBox label="Макс. DD" value={`${account.maxDrawdownPct}%`} icon={<TrendingDown className="h-3 w-3" />} positive={false} />
      </div>

      <div className="grid grid-cols-4 gap-2.5">
        <MetricBox label="Лонги" value={`${account.longTrades}`} subvalue={`${account.longWinRate}% WR`} positive={account.longWinRate >= 50} />
        <MetricBox label="Шорты" value={`${account.shortTrades}`} subvalue={`${account.shortWinRate}% WR`} positive={account.shortWinRate >= 50} />
        <MetricBox label="Ср. Win" value={`$${account.avgWin.toFixed(2)}`} positive />
        <MetricBox label="Ср. Loss" value={`$${account.avgLoss.toFixed(2)}`} positive={false} />
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <MetricBox label="Макс. прибыль" value={`+$${account.largestWin.toFixed(2)}`} positive />
        <MetricBox label="Макс. убыток" value={`-$${Math.abs(account.largestLoss).toFixed(2)}`} positive={false} />
      </div>

      {/* Symbol performance */}
      <SectionHeader title="По монетам" icon={<DollarSign className="h-3 w-3" />} />
      <div className="rounded-xl bg-[#08080f] border border-white/[0.04] overflow-hidden">
        <div className="grid grid-cols-4 gap-1 px-4 py-2 text-[9px] text-white/20 font-mono uppercase tracking-wider border-b border-white/[0.04] bg-white/[0.01]">
          <span>Монета</span>
          <span className="text-center">Сделок</span>
          <span className="text-center">WR</span>
          <span className="text-right">PnL</span>
        </div>
        <ScrollArea className="max-h-44">
          {symPerfSorted.slice(0, 20).map((s, idx) => (
            <div
              key={s.sym}
              className={cn(
                'grid grid-cols-4 gap-1 px-4 py-2 text-[10px] font-mono tabular-nums border-b border-white/[0.02] transition-colors hover:bg-white/[0.02]',
                idx % 2 === 1 && 'bg-white/[0.01]'
              )}
            >
              <span className="text-white/50 truncate">{s.sym.replace('USDT', '')}</span>
              <span className="text-center text-white/25">{s.count}</span>
              <span className="text-center text-white/35">{s.wr}%</span>
              <span className={cn('text-right font-semibold', s.pnl >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                ${s.pnl >= 0 ? '+' : ''}{s.pnl.toFixed(2)}
              </span>
            </div>
          ))}
        </ScrollArea>
      </div>

      {/* Trade history */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="text-[10px] uppercase tracking-widest text-white/20 font-medium hover:text-white/40 transition-colors flex items-center gap-1.5 w-full py-1 group"
      >
        <Clock className="h-3 w-3" />
        <span>Все сделки ({account.trades.length})</span>
        <span className="ml-1 text-white/10 group-hover:text-white/20 transition-colors">
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </span>
      </button>
      {expanded && (
        <div className="mt-2 rounded-xl bg-[#08080f] border border-white/[0.04] overflow-hidden">
            <div className="grid grid-cols-12 gap-1 px-4 py-2 text-[8px] text-white/20 font-mono uppercase tracking-wider border-b border-white/[0.04] bg-white/[0.01]">
              <span className="col-span-2">Монета</span>
              <span>Dir</span>
              <span className="text-right col-span-2">Вход</span>
              <span className="text-right col-span-2">Выход</span>
              <span className="text-right">Сумма</span>
              <span className="text-right">Плечо</span>
              <span className="text-right">Причина</span>
              <span className="text-right">PnL</span>
            </div>
            <ScrollArea className="max-h-64">
              {tradesSorted.map((tr, i) => (
                <div
                  key={i}
                  className={cn(
                    'grid grid-cols-12 gap-1 px-4 py-2 text-[10px] font-mono tabular-nums border-b border-white/[0.02] transition-colors hover:bg-white/[0.02]',
                    i % 2 === 1 && 'bg-white/[0.01]'
                  )}
                >
                  <span className="col-span-2 text-white/45 truncate">{tr.symbol.replace('USDT', '')}</span>
                  <span>
                    {tr.direction === 'long'
                      ? <ArrowUpRight className="h-3 w-3 text-emerald-400" />
                      : <ArrowDownRight className="h-3 w-3 text-red-400" />}
                  </span>
                  <span className="text-right text-white/35 col-span-2">
                    {tr.entryPrice < 1 ? tr.entryPrice.toPrecision(4) : tr.entryPrice.toFixed(2)}
                  </span>
                  <span className="text-right text-white/35 col-span-2">
                    {tr.closePrice != null ? (tr.closePrice < 1 ? tr.closePrice.toPrecision(4) : tr.closePrice.toFixed(2)) : '—'}
                  </span>
                  <span className="text-right text-white/30">${tr.amount.toFixed(1)}</span>
                  <span className="text-right text-white/20">{tr.leverage}x</span>
                  <span className="text-right text-white/20 text-[9px] truncate">{tr.reason}</span>
                  <span className={cn(
                    'text-right font-semibold',
                    (tr.pnl ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'
                  )}>
                    {(tr.pnl ?? 0) >= 0 ? '+' : ''}{(tr.pnl ?? 0).toFixed(2)}
                  </span>
                </div>
              ))}
            </ScrollArea>
          </div>
        )}
    </ScrollArea>
  );
}

// ============================================================
// Shared Components
// ============================================================

function SectionHeader({ title, icon }: { title: string; icon: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-white/20">
      {icon}
      <h3 className="text-[10px] uppercase tracking-[0.15em] font-semibold">{title}</h3>
    </div>
  );
}

function HeroStat({ label, value, icon, color }: {
  label: string;
  value: string;
  icon: React.ReactNode;
  color: string;
}) {
  const palette = {
    emerald: {
      iconBg: 'bg-emerald-500/10',
      iconBorder: 'border-emerald-500/20',
      iconColor: 'text-emerald-400',
      valueColor: 'text-emerald-400',
      glow: 'shadow-emerald-500/5',
    },
    amber: {
      iconBg: 'bg-amber-500/10',
      iconBorder: 'border-amber-500/20',
      iconColor: 'text-amber-400',
      valueColor: 'text-amber-400',
      glow: 'shadow-amber-500/5',
    },
    red: {
      iconBg: 'bg-red-500/10',
      iconBorder: 'border-red-500/20',
      iconColor: 'text-red-400',
      valueColor: 'text-red-400',
      glow: 'shadow-red-500/5',
    },
  };
  const p = palette[color as keyof typeof palette];

  return (
    <div className={cn('rounded-xl border border-white/[0.05] bg-white/[0.02] p-3.5 shadow-lg', p.glow)}>
      <div className="flex items-center justify-between mb-2.5">
        <span className="text-[9px] uppercase tracking-[0.12em] text-white/25 font-medium">{label}</span>
        <div className={cn('flex items-center justify-center h-6 w-6 rounded-lg border', p.iconBg, p.iconBorder, p.iconColor)}>
          {icon}
        </div>
      </div>
      <div className={cn('text-xl font-bold font-mono tabular-nums leading-none', p.valueColor)}>{value}</div>
    </div>
  );
}

function GlassStat({ label, value, positive, neutral }: {
  label: string;
  value: string;
  positive?: boolean;
  neutral?: boolean;
}) {
  return (
    <div className="rounded-xl bg-white/[0.02] border border-white/[0.04] p-3 text-center transition-colors hover:bg-white/[0.03]">
      <div className="text-[9px] text-white/20 uppercase tracking-[0.1em] mb-1.5 font-medium">{label}</div>
      <div className={cn(
        'text-sm font-bold font-mono tabular-nums',
        neutral ? 'text-white/50' : positive ? 'text-emerald-400' : 'text-red-400'
      )}>{value}</div>
    </div>
  );
}

function MetricPill({ label, value, positive, negative }: {
  label: string;
  value: string;
  positive?: boolean;
  negative?: boolean;
}) {
  return (
    <div className="text-center">
      <div className="text-[9px] text-white/20 uppercase tracking-[0.1em] mb-1">{label}</div>
      <div className={cn(
        'text-xs font-bold font-mono tabular-nums',
        positive ? 'text-emerald-400' : negative ? 'text-red-400' : 'text-white/60'
      )}>{value}</div>
    </div>
  );
}

function MetricBox({ label, value, icon, subvalue, positive }: {
  label: string;
  value: string;
  icon?: React.ReactNode;
  subvalue?: string;
  positive?: boolean;
}) {
  return (
    <div className="rounded-xl bg-white/[0.02] border border-white/[0.04] p-3 text-center transition-colors hover:bg-white/[0.03] group">
      {icon && (
        <div className="flex items-center justify-center mb-1.5 text-white/15 group-hover:text-white/25 transition-colors">
          {icon}
        </div>
      )}
      <div className="text-[8px] text-white/15 uppercase tracking-[0.12em] mb-1 font-medium">{label}</div>
      <div className={cn(
        'text-sm font-bold font-mono tabular-nums',
        positive === undefined ? 'text-white/50' : positive ? 'text-emerald-400' : 'text-red-400'
      )}>{value}</div>
      {subvalue && <div className="text-[9px] text-white/20 font-mono tabular-nums mt-0.5">{subvalue}</div>}
    </div>
  );
}
