'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import {
  Play, Loader2, CheckCircle2, XCircle, TrendingUp, TrendingDown, BarChart3,
  Target, Activity, Users, Trophy, AlertTriangle, Zap, Clock,
} from 'lucide-react';

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
    id: string;
    interval: string;
    count: number;
    profitable: number;
    avgPnl: string;
    avgWR: string;
    avgDD: string;
    bestPnl: string;
    worstPnl: string;
    totalTrades: number;
  }[];
  distribution: { from: number; to: number; count: number }[];
  bestUserId: string;
  medianUserId: string;
  allResults: {
    id: number;
    strategyId: string;
    pnlPct: number;
    totalTrades: number;
    winRate: number;
    maxDrawdownPct: number;
    profitFactor: number;
  }[];
}

const STRAT_NAMES: Record<string, string> = {
  momentum: 'Momentum Pro',
  scalper: 'Pattern Pro',
  'position-alpha': 'Position Alpha',
};

const STRAT_COLORS: Record<string, string> = {
  momentum: 'text-amber-400',
  scalper: 'text-violet-400',
  'position-alpha': 'text-blue-400',
};

const STRAT_BG: Record<string, string> = {
  momentum: 'bg-amber-500/10',
  scalper: 'bg-violet-500/10',
  'position-alpha': 'bg-blue-500/10',
};

const STRAT_BORDER: Record<string, string> = {
  momentum: 'border-amber-500/20',
  scalper: 'border-violet-500/20',
  'position-alpha': 'border-blue-500/20',
};

export default function BacktestDialog({ open, onClose }: BacktestDialogProps) {
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [accounts, setAccounts] = useState<AccountLine[]>([]);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [result, setResult] = useState<FinalResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const reset = useCallback(() => {
    setLogs([]);
    setAccounts([]);
    setProgress(null);
    setResult(null);
    setError(null);
  }, []);

  const handleClose = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
    setRunning(false);
    onClose();
  }, [onClose]);

  const handleStart = useCallback(async () => {
    reset();
    setRunning(true);
    abortRef.current = new AbortController();

    try {
      const res = await fetch('/api/backtest-run', {
        method: 'POST',
        signal: abortRef.current.signal,
      });

      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status}`);
      }

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
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (currentEvent === 'log') {
                setLogs(prev => [...prev, data.msg]);
              } else if (currentEvent === 'progress') {
                setProgress(data);
              } else if (currentEvent === 'account') {
                setAccounts(prev => [...prev, data]);
              } else if (currentEvent === 'done') {
                setResult(data);
                setRunning(false);
              } else if (currentEvent === 'error') {
                setError(data.msg);
                setRunning(false);
              }
            } catch { /* skip */ }
            currentEvent = '';
          }
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setError(err.message);
      }
      setRunning(false);
    }
  }, [reset]);

  const progressPct = progress
    ? progress.stage === 'candles'
      ? Math.round((progress.current / progress.total) * 30)
      : Math.round(30 + (progress.current / progress.total) * 70)
    : result ? 100 : 0;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="bg-[#0e0e1a] border-white/[0.08] max-w-2xl w-[95vw] max-h-[90vh] flex flex-col p-0 gap-0 overflow-hidden">
        <DialogHeader className="p-4 pb-2 shrink-0">
          <DialogTitle className="text-sm font-semibold text-white flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-emerald-400" />
            Бэктест: 100 аккаунтов × 2 месяца
          </DialogTitle>
          <DialogDescription className="text-[11px] text-white/40">
            Реальные свечи Binance · 3 стратегии · $100 начальный депозит каждый
          </DialogDescription>
        </DialogHeader>

        {!result && !error && (
          <div className="px-4 pb-2 shrink-0">
            {/* Progress bar */}
            <div className="h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
              <div
                className={cn(
                  'h-full rounded-full transition-all duration-500',
                  running ? 'bg-emerald-500' : 'bg-white/10',
                )}
                style={{ width: `${progressPct}%` }}
              />
            </div>
            {progress && (
              <p className="text-[10px] text-white/30 mt-1 font-mono">
                {progress.stage === 'candles'
                  ? `Загрузка свечей ${progress.interval}: ${progress.current}/${progress.total}`
                  : `Симуляция: ${progress.current}/${progress.total} аккаунтов`}
              </p>
            )}
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-hidden px-4 pb-4">
          {error && (
            <div className="flex items-center gap-2 text-red-400 text-xs">
              <XCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {!result && !error && (
            <ScrollArea className="h-[400px] rounded-lg bg-black/30 border border-white/[0.04] p-3">
              <div className="space-y-0.5 font-mono text-[11px]">
                {logs.length === 0 && !running && (
                  <p className="text-white/20 text-center py-8">
                    Нажмите «Запустить» для старта бэктеста
                  </p>
                )}
                {logs.map((log, i) => (
                  <div key={i} className="text-white/50 leading-relaxed">
                    {log}
                  </div>
                ))}
                {accounts.map((a, i) => (
                  <div key={i} className={cn(
                    'leading-relaxed',
                    a.pnlPct >= 0 ? 'text-emerald-400/60' : 'text-red-400/60',
                  )}>
                    {a.emoji} #{String(a.id).padStart(3)} {a.strategyId.padEnd(15)} {String(a.totalTrades).padStart(3)} сделок | {String(a.winRate).padStart(5)}% WR | {a.pnlPct >= 0 ? '+' : ''}{a.pnlPct}%
                  </div>
                ))}
                {running && (
                  <div className="text-white/20 animate-pulse">
                    <Loader2 className="h-3 w-3 inline mr-1 animate-spin" />
                    Вычисление...
                  </div>
                )}
                <div ref={logsEndRef} />
              </div>
            </ScrollArea>
          )}

          {result && <ResultsPanel result={result} />}
        </div>

        {/* Footer */}
        <div className="px-4 pb-4 shrink-0 flex items-center gap-2">
          {!result && (
            <Button
              onClick={handleStart}
              disabled={running}
              className={cn(
                'flex-1 h-10 text-xs font-semibold rounded-lg transition-all',
                running
                  ? 'bg-white/[0.04] text-white/30 cursor-not-allowed'
                  : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/20',
              )}
            >
              {running ? (
                <><Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" /> Выполняется...</>
              ) : (
                <><Play className="h-3.5 w-3.5 mr-2" /> Запустить бэктест</>
              )}
            </Button>
          )}
          <Button
            variant="outline"
            onClick={handleClose}
            className="h-10 text-xs rounded-lg border-white/[0.08] text-white/40 hover:bg-white/[0.04]"
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

function ResultsPanel({ result }: { result: FinalResult }) {
  return (
    <ScrollArea className="h-[400px] space-y-3 pr-1">
      {/* Hero stats */}
      <div className="grid grid-cols-3 gap-2">
        <StatCard
          label="Прибыльных"
          value={`${result.profitable}/100`}
          icon={<Users className="h-3.5 w-3.5" />}
          color={result.profitable >= 50 ? 'emerald' : result.profitable >= 30 ? 'amber' : 'red'}
        />
        <StatCard
          label="Средний PnL"
          value={`${parseFloat(result.avgPnlPct) >= 0 ? '+' : ''}${result.avgPnlPct}%`}
          icon={<TrendingUp className="h-3.5 w-3.5" />}
          color={parseFloat(result.avgPnlPct) >= 0 ? 'emerald' : 'red'}
        />
        <StatCard
          label="Глобальный WR"
          value={`${result.globalWR}%`}
          icon={<Target className="h-3.5 w-3.5" />}
          color="emerald"
        />
      </div>

      {/* Best / Median / Worst */}
      <div className="grid grid-cols-3 gap-2">
        <MiniStat label="Лучший" value={`+${result.bestPnl.toFixed(1)}%`} positive />
        <MiniStat label="Медиана" value={`${result.medianPnl >= 0 ? '+' : ''}${result.medianPnl.toFixed(1)}%`} positive={result.medianPnl >= 0} />
        <MiniStat label="Худший" value={`${result.worstPnl.toFixed(1)}%`} positive={result.worstPnl >= 0} />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <MiniStat label="Всего сделок" value={`${result.totalTrades}`} neutral />
        <MiniStat label="Ср. просадка" value={`${result.avgDD}%`} neutral />
      </div>

      {/* Per-strategy breakdown */}
      <div className="space-y-2">
        <h3 className="text-[10px] uppercase tracking-widest text-white/25 font-medium">По стратегиям</h3>
        {result.stratStats.map(s => (
          <div
            key={s.id}
            className={cn(
              'rounded-lg border p-3 space-y-2',
              STRAT_BG[s.id], STRAT_BORDER[s.id],
            )}
          >
            <div className="flex items-center justify-between">
              <span className={cn('text-xs font-semibold', STRAT_COLORS[s.id])}>
                {STRAT_NAMES[s.id] ?? s.id}
              </span>
              <span className="text-[10px] text-white/30 font-mono">{s.interval} · {s.totalTrades} сделок</span>
            </div>
            <div className="grid grid-cols-4 gap-2 text-center">
              <div>
                <div className="text-[10px] text-white/30">Прибыльных</div>
                <div className={cn('text-xs font-bold font-mono', s.profitable >= s.count / 2 ? 'text-emerald-400' : 'text-red-400')}>
                  {s.profitable}/{s.count}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-white/30">Ср. PnL</div>
                <div className={cn('text-xs font-bold font-mono', parseFloat(s.avgPnl) >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                  {parseFloat(s.avgPnl) >= 0 ? '+' : ''}{s.avgPnl}%
                </div>
              </div>
              <div>
                <div className="text-[10px] text-white/30">Ср. WR</div>
                <div className="text-xs font-bold font-mono text-white/60">{s.avgWR}%</div>
              </div>
              <div>
                <div className="text-[10px] text-white/30">Диапазон</div>
                <div className="text-xs font-mono text-white/40">
                  {s.worstPnl}% / +{s.bestPnl}%
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Distribution histogram */}
      {result.distribution.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-[10px] uppercase tracking-widest text-white/25 font-medium">Распределение PnL</h3>
          <div className="space-y-1">
            {result.distribution.map((d, i) => {
              const maxCount = Math.max(...result.distribution.map(x => x.count));
              const w = maxCount > 0 ? (d.count / maxCount) * 100 : 0;
              const isProfit = d.from >= 0;
              return (
                <div key={i} className="flex items-center gap-2 text-[10px] font-mono">
                  <span className="text-white/30 w-24 text-right shrink-0">
                    {d.from}% to {d.to}%
                  </span>
                  <div className="flex-1 h-4 bg-white/[0.03] rounded overflow-hidden">
                    <div
                      className={cn(
                        'h-full rounded transition-all duration-700',
                        isProfit ? 'bg-emerald-500/50' : 'bg-red-500/50',
                      )}
                      style={{ width: `${Math.max(w, 2)}%` }}
                    />
                  </div>
                  <span className={cn('w-6 text-right shrink-0', isProfit ? 'text-emerald-400/60' : 'text-red-400/60')}>
                    {d.count}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* All accounts table (collapsible) */}
      <details className="group">
        <summary className="text-[10px] uppercase tracking-widest text-white/25 font-medium cursor-pointer hover:text-white/40 transition-colors flex items-center gap-1">
          Все 100 аккаунтов
          <span className="text-white/15">▼</span>
        </summary>
        <div className="mt-2 rounded-lg bg-black/20 border border-white/[0.04] overflow-hidden">
          <div className="grid grid-cols-6 gap-1 px-3 py-1.5 text-[9px] text-white/25 font-mono uppercase border-b border-white/[0.04]">
            <span>#</span>
            <span>Стратегия</span>
            <span className="text-right">Сделок</span>
            <span className="text-right">WR%</span>
            <span className="text-right">PnL%</span>
            <span className="text-right">DD%</span>
          </div>
          <ScrollArea className="max-h-48">
            {result.allResults
              .sort((a, b) => b.pnlPct - a.pnlPct)
              .map(a => (
                <div
                  key={a.id}
                  className="grid grid-cols-6 gap-1 px-3 py-1 text-[10px] font-mono border-b border-white/[0.02] hover:bg-white/[0.02]"
                >
                  <span className="text-white/30">{a.id}</span>
                  <span className={STRAT_COLORS[a.strategyId]}>{STRAT_NAMES[a.strategyId]?.split(' ')[0]}</span>
                  <span className="text-right text-white/40">{a.totalTrades}</span>
                  <span className="text-right text-white/50">{a.winRate}%</span>
                  <span className={cn('text-right font-semibold', a.pnlPct >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                    {a.pnlPct >= 0 ? '+' : ''}{a.pnlPct}%
                  </span>
                  <span className="text-right text-white/30">{a.maxDrawdownPct}%</span>
                </div>
              ))}
          </ScrollArea>
        </div>
      </details>
    </ScrollArea>
  );
}

// ============================================================
// Mini stat components
// ============================================================

function StatCard({ label, value, icon, color }: { label: string; value: string; icon: React.ReactNode; color: string }) {
  const colors: Record<string, string> = {
    emerald: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
    amber: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
    red: 'text-red-400 bg-red-500/10 border-red-500/20',
  };
  return (
    <div className={cn('rounded-lg border p-3 text-center', colors[color])}>
      <div className="flex items-center justify-center gap-1 mb-1 opacity-60">
        {icon}
        <span className="text-[10px] uppercase tracking-wider">{label}</span>
      </div>
      <div className="text-lg font-bold font-mono">{value}</div>
    </div>
  );
}

function MiniStat({ label, value, positive, neutral }: { label: string; value: string; positive?: boolean; neutral?: boolean }) {
  return (
    <div className="rounded-lg bg-white/[0.03] border border-white/[0.05] p-2.5 text-center">
      <div className="text-[10px] text-white/25 mb-0.5">{label}</div>
      <div className={cn(
        'text-sm font-bold font-mono',
        neutral ? 'text-white/60' : positive ? 'text-emerald-400' : 'text-red-400',
      )}>
        {value}
      </div>
    </div>
  );
}
