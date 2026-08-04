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
  Play, Loader2, CheckCircle2, XCircle, TrendingUp, TrendingDown, BarChart3,
  Target, Activity, Users, Trophy, Zap, Clock, RotateCcw, FileText, ArrowLeft,
  ArrowUpRight, ArrowDownRight, Shield, DollarSign, Percent, ChevronDown, ChevronUp,
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

type View = 'results' | 'report';

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
      <DialogContent className="bg-[#0e0e1a] border-white/[0.08] max-w-2xl w-[95vw] max-h-[90vh] flex flex-col p-0 gap-0 overflow-hidden">
        <DialogHeader className="p-4 pb-2 shrink-0">
          <DialogTitle className="text-sm font-semibold text-white flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-emerald-400" />
            {view === 'report' && result?.bestAccount ? (
              <>
                <button onClick={() => setView('results')} className="flex items-center gap-1 text-white/40 hover:text-white/70 transition-colors">
                  <ArrowLeft className="h-3.5 w-3.5" />
                </button>
                Отчет: Аккаунт #{result.bestAccount.id}
              </>
            ) : (
              'Бэктест: 100 аккаунтов × 2 месяца'
            )}
          </DialogTitle>
          <DialogDescription className="text-[11px] text-white/40">
            {view === 'report' && result?.bestAccount
              ? `${result.bestAccount.strategyLabel} · ${result.bestAccount.totalTrades} сделок · 2 месяца`
              : 'Детерминированные данные · 3 стратегии · $100 начальный депозит каждый'
            }
          </DialogDescription>
        </DialogHeader>

        {!result && !error && (
          <div className="px-4 pb-2 shrink-0">
            <div className="h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
              <div className={cn('h-full rounded-full transition-all duration-500', running ? 'bg-emerald-500' : 'bg-white/10')} style={{ width: `${progressPct}%` }} />
            </div>
            {progress && (
              <p className="text-[10px] text-white/30 mt-1 font-mono">
                {progress.stage === 'candles'
                  ? `Генерация свечей ${progress.interval}: ${progress.current}/${progress.total}`
                  : `Симуляция: ${progress.current}/${progress.total} аккаунтов`}
              </p>
            )}
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-hidden px-4 pb-4">
          {error && (
            <div className="flex items-center gap-2 text-red-400 text-xs">
              <XCircle className="h-4 w-4 shrink-0" /><span>{error}</span>
            </div>
          )}

          {!result && !error && (
            <ScrollArea className="h-[400px] rounded-lg bg-black/30 border border-white/[0.04] p-3">
              <div className="space-y-0.5 font-mono text-[11px]">
                {logs.length === 0 && !running && (
                  <p className="text-white/20 text-center py-8">Нажмите «Запустить» для старта бэктеста</p>
                )}
                {logs.map((log, i) => (
                  <div key={i} className="text-white/50 leading-relaxed">{log}</div>
                ))}
                {accounts.map((a, i) => (
                  <div key={i} className={cn('leading-relaxed', a.pnlPct >= 0 ? 'text-emerald-400/60' : 'text-red-400/60')}>
                    {a.emoji} #{String(a.id).padStart(3)} {a.strategyId.padEnd(15)} {String(a.totalTrades).padStart(3)} сделок | {String(a.winRate).padStart(5)}% WR | {a.pnlPct >= 0 ? '+' : ''}{a.pnlPct}%
                  </div>
                ))}
                {running && (
                  <div className="text-white/20 animate-pulse">
                    <Loader2 className="h-3 w-3 inline mr-1 animate-spin" />Вычисление...
                  </div>
                )}
                <div ref={logsEndRef} />
              </div>
            </ScrollArea>
          )}

          {result && view === 'results' && <ResultsPanel result={result} onReport={() => setView('report')} />}
          {result && view === 'report' && result.bestAccount && <ReportPanel account={result.bestAccount} />}
        </div>

        <div className="px-4 pb-4 shrink-0 flex items-center gap-2">
          {!result && (
            <Button onClick={handleStart} disabled={running}
              className={cn('flex-1 h-10 text-xs font-semibold rounded-lg transition-all',
                running ? 'bg-white/[0.04] text-white/30 cursor-not-allowed' : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/20'
              )}>
              {running ? <><Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />Выполняется...</> : <><Play className="h-3.5 w-3.5 mr-2" />Запустить бэктест</>}
            </Button>
          )}
          {result && view === 'results' && (
            <>
              {result.bestAccount && (
                <Button onClick={() => setView('report')}
                  className="flex-1 h-10 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-600/20 transition-all">
                  <FileText className="h-3.5 w-3.5 mr-2" />Создать отчет
                </Button>
              )}
              <Button onClick={handleStart} disabled={running}
                className="h-10 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white shadow-lg shadow-amber-600/20 transition-all">
                <RotateCcw className="h-3.5 w-3.5 mr-2" />Заново
              </Button>
            </>
          )}
          {result && view === 'report' && (
            <Button onClick={() => setView('results')}
              className="flex-1 h-10 text-xs font-semibold rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-white/70 border border-white/[0.08] transition-all">
              <ArrowLeft className="h-3.5 w-3.5 mr-2" />К результатам
            </Button>
          )}
          <Button variant="outline" onClick={handleClose}
            className="h-10 text-xs rounded-lg border-white/[0.08] text-white/40 hover:bg-white/[0.04]">
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
    <ScrollArea className="h-[400px] space-y-3 pr-1">
      {/* Best account highlight */}
      {result.bestAccount && (
        <div className="rounded-xl border border-amber-500/30 bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent p-4 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Trophy className="h-4 w-4 text-amber-400" />
              <span className="text-xs font-bold text-amber-400">Лучший аккаунт #{result.bestAccount.id}</span>
              <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-amber-500/30 text-amber-400/70">
                {result.bestAccount.strategyLabel}
              </Badge>
            </div>
            <span className={cn('text-lg font-bold font-mono', result.bestAccount.pnlPct >= 0 ? 'text-emerald-400' : 'text-red-400')}>
              {result.bestAccount.pnlPct >= 0 ? '+' : ''}{result.bestAccount.pnlPct}%
            </span>
          </div>
          <div className="grid grid-cols-4 gap-3 text-center">
            <div>
              <div className="text-[10px] text-white/30">Сделок</div>
              <div className="text-sm font-bold font-mono text-white/80">{result.bestAccount.totalTrades}</div>
            </div>
            <div>
              <div className="text-[10px] text-white/30">Win Rate</div>
              <div className="text-sm font-bold font-mono text-white/80">{result.bestAccount.winRate}%</div>
            </div>
            <div>
              <div className="text-[10px] text-white/30">Просадка</div>
              <div className="text-sm font-bold font-mono text-red-400/70">{result.bestAccount.maxDrawdownPct}%</div>
            </div>
            <div>
              <div className="text-[10px] text-white/30">Баланс</div>
              <div className="text-sm font-bold font-mono text-emerald-400/70">${result.bestAccount.endBalance.toFixed(2)}</div>
            </div>
          </div>
        </div>
      )}

      {/* Hero stats */}
      <div className="flex items-center gap-2 mb-3">
        {result.usedRealData ? (
          <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-emerald-500/30 text-emerald-400/70">Binance API</Badge>
        ) : (
          <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-amber-500/30 text-amber-400/70">Синтетические данные</Badge>
        )}
        <span className="text-[10px] text-white/20">{result.usedRealData ? 'Реальные свечи за 2 месяца' : 'Детерминированная симуляция'}</span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <StatCard label="Прибыльных" value={`${result.profitable}/102`} icon={<Users className="h-3.5 w-3.5" />} color={result.profitable >= 50 ? 'emerald' : result.profitable >= 30 ? 'amber' : 'red'} />
        <StatCard label="Средний PnL" value={`${parseFloat(result.avgPnlPct) >= 0 ? '+' : ''}${result.avgPnlPct}%`} icon={<TrendingUp className="h-3.5 w-3.5" />} color={parseFloat(result.avgPnlPct) >= 0 ? 'emerald' : 'red'} />
        <StatCard label="Глобальный WR" value={`${result.globalWR}%`} icon={<Target className="h-3.5 w-3.5" />} color="emerald" />
      </div>

      <div className="grid grid-cols-3 gap-2">
        <MiniStat label="Лучший" value={`+${result.bestPnl.toFixed(1)}%`} positive />
        <MiniStat label="Медиана" value={`${result.medianPnl >= 0 ? '+' : ''}${result.medianPnl.toFixed(1)}%`} positive={result.medianPnl >= 0} />
        <MiniStat label="Худший" value={`${result.worstPnl.toFixed(1)}%`} positive={result.worstPnl >= 0} />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <MiniStat label="Всего сделок" value={`${result.totalTrades}`} neutral />
        <MiniStat label="Ср. просадка" value={`${result.avgDD}%`} neutral />
      </div>

      {/* Per-strategy */}
      <div className="space-y-2">
        <h3 className="text-[10px] uppercase tracking-widest text-white/25 font-medium">По стратегиям</h3>
        {result.stratStats.map(s => (
          <div key={s.id} className={cn('rounded-lg border p-3 space-y-2', STRAT_BG[s.id], STRAT_BORDER[s.id])}>
            <div className="flex items-center justify-between">
              <span className={cn('text-xs font-semibold', STRAT_COLORS[s.id])}>{STRAT_NAMES[s.id] ?? s.id}</span>
              <span className="text-[10px] text-white/30 font-mono">{s.interval} · {s.totalTrades} сделок</span>
            </div>
            <div className="grid grid-cols-4 gap-2 text-center">
              <div><div className="text-[10px] text-white/30">Прибыльных</div><div className={cn('text-xs font-bold font-mono', s.profitable >= s.count / 2 ? 'text-emerald-400' : 'text-red-400')}>{s.profitable}/{s.count}</div></div>
              <div><div className="text-[10px] text-white/30">Ср. PnL</div><div className={cn('text-xs font-bold font-mono', parseFloat(s.avgPnl) >= 0 ? 'text-emerald-400' : 'text-red-400')}>{parseFloat(s.avgPnl) >= 0 ? '+' : ''}{s.avgPnl}%</div></div>
              <div><div className="text-[10px] text-white/30">Ср. WR</div><div className="text-xs font-bold font-mono text-white/60">{s.avgWR}%</div></div>
              <div><div className="text-[10px] text-white/30">Диапазон</div><div className="text-xs font-mono text-white/40">{s.worstPnl}% / +{s.bestPnl}%</div></div>
            </div>
          </div>
        ))}
      </div>

      {/* Distribution */}
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
                  <span className="text-white/30 w-24 text-right shrink-0">{d.from}% to {d.to}%</span>
                  <div className="flex-1 h-4 bg-white/[0.03] rounded overflow-hidden">
                    <div className={cn('h-full rounded transition-all duration-700', isProfit ? 'bg-emerald-500/50' : 'bg-red-500/50')} style={{ width: `${Math.max(w, 2)}%` }} />
                  </div>
                  <span className={cn('w-6 text-right shrink-0', isProfit ? 'text-emerald-400/60' : 'text-red-400/60')}>{d.count}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* All accounts table */}
      <details className="group">
        <summary className="text-[10px] uppercase tracking-widest text-white/25 font-medium cursor-pointer hover:text-white/40 transition-colors flex items-center gap-1">
          Все 102 аккаунта <span className="text-white/15">▼</span>
        </summary>
        <div className="mt-2 rounded-lg bg-black/20 border border-white/[0.04] overflow-hidden">
          <div className="grid grid-cols-6 gap-1 px-3 py-1.5 text-[9px] text-white/25 font-mono uppercase border-b border-white/[0.04]">
            <span>#</span><span>Стратегия</span><span className="text-right">Сделок</span><span className="text-right">WR%</span><span className="text-right">PnL%</span><span className="text-right">DD%</span>
          </div>
          <ScrollArea className="max-h-48">
            {result.allResults.sort((a, b) => b.pnlPct - a.pnlPct).map(a => (
              <div key={a.id} className={cn(
                'grid grid-cols-6 gap-1 px-3 py-1 text-[10px] font-mono border-b border-white/[0.02] hover:bg-white/[0.02]',
                a.id === bestId && 'bg-amber-500/5'
              )}>
                <span className="text-white/30">{a.id === bestId ? '🏆' : a.id}</span>
                <span className={STRAT_COLORS[a.strategyId]}>{STRAT_NAMES[a.strategyId]?.split(' ')[0]}</span>
                <span className="text-right text-white/40">{a.totalTrades}</span>
                <span className="text-right text-white/50">{a.winRate}%</span>
                <span className={cn('text-right font-semibold', a.pnlPct >= 0 ? 'text-emerald-400' : 'text-red-400')}>{a.pnlPct >= 0 ? '+' : ''}{a.pnlPct}%</span>
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
// Report Panel (Best Account Detail)
// ============================================================

function ReportPanel({ account }: { account: BestAccountReport }) {
  const [expanded, setExpanded] = useState(false);
  const stratColor = STRAT_COLORS[account.strategyId] ?? 'text-emerald-400';

  // Equity curve SVG
  const eqCurve = account.equityCurve;
  const eqMin = Math.min(...eqCurve.map(p => p.equity));
  const eqMax = Math.max(...eqCurve.map(p => p.equity));
  const eqRange = eqMax - eqMin || 1;
  const eqW = 560, eqH = 120;
  const eqPath = eqCurve.map((p, i) => {
    const x = (i / (eqCurve.length - 1)) * eqW;
    const y = eqH - ((p.equity - eqMin) / eqRange) * (eqH - 10) - 5;
    return `${i === 0 ? 'M' : 'L'}${x},${y}`;
  }).join(' ');
  const eqAreaPath = eqPath + ` L${eqW},${eqH} L0,${eqH} Z`;
  const startLine = eqH - ((account.startBalance - eqMin) / eqRange) * (eqH - 10) - 5;

  // Sorted trades
  const tradesSorted = [...account.trades].sort((a, b) => new Date(b.openTime).getTime() - new Date(a.openTime).getTime());

  // Symbol perf sorted by PnL
  const symPerfSorted = Object.entries(account.symbolPerformance)
    .map(([sym, d]) => ({ sym, ...d, wr: d.count > 0 ? Math.round((d.wins / d.count) * 1000) / 10 : 0 }))
    .sort((a, b) => b.pnl - a.pnl);

  return (
    <ScrollArea className="h-[400px] space-y-3 pr-1">
      {/* Hero: best account */}
      <div className="rounded-xl border border-amber-500/30 bg-gradient-to-br from-amber-500/10 to-transparent p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-amber-400" />
            <div>
              <div className="text-sm font-bold text-white">Аккаунт #{account.id}</div>
              <div className={cn('text-xs', stratColor)}>{account.strategyLabel}</div>
            </div>
          </div>
          <div className="text-right">
            <div className={cn('text-2xl font-bold font-mono', account.pnlPct >= 0 ? 'text-emerald-400' : 'text-red-400')}>
              {account.pnlPct >= 0 ? '+' : ''}{account.pnlPct}%
            </div>
            <div className="text-[10px] text-white/30 font-mono">
              ${account.startBalance} → ${account.endBalance.toFixed(2)}
            </div>
          </div>
        </div>

        {/* Equity curve */}
        <div className="rounded-lg bg-black/30 border border-white/[0.04] p-2">
          <div className="text-[9px] text-white/25 uppercase tracking-wider mb-1">Кривая эквити</div>
          <svg viewBox={`0 0 ${eqW} ${eqH}`} className="w-full h-auto" preserveAspectRatio="none">
            <defs>
              <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={account.pnlPct >= 0 ? '#10b981' : '#ef4444'} stopOpacity="0.3" />
                <stop offset="100%" stopColor={account.pnlPct >= 0 ? '#10b981' : '#ef4444'} stopOpacity="0" />
              </linearGradient>
            </defs>
            <line x1="0" y1={startLine} x2={eqW} y2={startLine} stroke="white" strokeOpacity="0.1" strokeDasharray="4 4" />
            <path d={eqAreaPath} fill="url(#eqGrad)" />
            <path d={eqPath} fill="none" stroke={account.pnlPct >= 0 ? '#10b981' : '#ef4444'} strokeWidth="1.5" />
          </svg>
        </div>
      </div>

      {/* Key metrics grid */}
      <div className="grid grid-cols-4 gap-2">
        <MetricBox label="Сделок" value={`${account.totalTrades}`} />
        <MetricBox label="Win Rate" value={`${account.winRate}%`} positive={account.winRate >= 50} />
        <MetricBox label="Profit Factor" value={`${account.profitFactor}`} positive={account.profitFactor >= 1} />
        <MetricBox label="Макс. DD" value={`${account.maxDrawdownPct}%`} positive={false} />
      </div>

      <div className="grid grid-cols-4 gap-2">
        <MetricBox label="Лонги" value={`${account.longTrades} (${account.longWinRate}%)`} positive={account.longWinRate >= 50} />
        <MetricBox label="Шорты" value={`${account.shortTrades} (${account.shortWinRate}%)`} positive={account.shortWinRate >= 50} />
        <MetricBox label="Ср.Win" value={`$${account.avgWin.toFixed(2)}`} positive />
        <MetricBox label="Ср.Loss" value={`$${account.avgLoss.toFixed(2)}`} positive={false} />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <MetricBox label="Макс. прибыль" value={`+$${account.largestWin.toFixed(2)}`} positive />
        <MetricBox label="Макс. убыток" value={`-$${Math.abs(account.largestLoss).toFixed(2)}`} positive={false} />
      </div>

      {/* Symbol performance */}
      <div className="space-y-2">
        <h3 className="text-[10px] uppercase tracking-widest text-white/25 font-medium">По монетам</h3>
        <ScrollArea className="max-h-40 rounded-lg bg-black/20 border border-white/[0.04]">
          <div className="p-2 space-y-0.5">
            {symPerfSorted.slice(0, 20).map(s => (
              <div key={s.sym} className="flex items-center justify-between text-[10px] font-mono py-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-white/50 w-16 truncate">{s.sym.replace('USDT','')}</span>
                  <span className="text-white/25">{s.count} сделок</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-white/30">{s.wr}%</span>
                  <span className={cn(s.pnl >= 0 ? 'text-emerald-400' : 'text-red-400', 'w-20 text-right')}>${s.pnl >= 0 ? '+' : ''}{s.pnl.toFixed(2)}</span>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </div>

      {/* Trade history */}
      <div className="space-y-2">
        <button onClick={() => setExpanded(!expanded)} className="text-[10px] uppercase tracking-widest text-white/25 font-medium hover:text-white/40 transition-colors flex items-center gap-1 w-full">
          Все сделки ({account.trades.length})
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>
        {expanded && (
          <ScrollArea className="max-h-60 rounded-lg bg-black/20 border border-white/[0.04]">
            <div className="divide-y divide-white/[0.03]">
              {/* Header */}
              <div className="grid grid-cols-12 gap-1 px-3 py-1.5 text-[8px] text-white/25 font-mono uppercase">
                <span className="col-span-2">Монета</span>
                <span>Напр.</span>
                <span className="text-right col-span-2">Вход</span>
                <span className="text-right col-span-2">Выход</span>
                <span className="text-right">Сумма</span>
                <span className="text-right">Плечо</span>
                <span className="text-right">Причина</span>
                <span className="text-right">PnL</span>
              </div>
              {tradesSorted.map((tr, i) => (
                <div key={i} className="grid grid-cols-12 gap-1 px-3 py-1.5 text-[10px] font-mono hover:bg-white/[0.02]">
                  <span className="col-span-2 text-white/50 truncate">{tr.symbol.replace('USDT','')}</span>
                  <span>
                    {tr.direction === 'long'
                      ? <ArrowUpRight className="h-3 w-3 text-emerald-400" />
                      : <ArrowDownRight className="h-3 w-3 text-red-400" />}
                  </span>
                  <span className="text-right text-white/40 col-span-2">{tr.entryPrice < 1 ? tr.entryPrice.toPrecision(4) : tr.entryPrice.toFixed(2)}</span>
                  <span className="text-right text-white/40 col-span-2">{tr.closePrice != null ? (tr.closePrice < 1 ? tr.closePrice.toPrecision(4) : tr.closePrice.toFixed(2)) : '—'}</span>
                  <span className="text-right text-white/40">${tr.amount.toFixed(1)}</span>
                  <span className="text-right text-white/30">{tr.leverage}x</span>
                  <span className="text-right text-white/30 text-[9px]">{tr.reason}</span>
                  <span className={cn('text-right font-semibold', (tr.pnl ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                    {(tr.pnl ?? 0) >= 0 ? '+' : ''}{(tr.pnl ?? 0).toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </div>
    </ScrollArea>
  );
}

// ============================================================
// Shared mini components
// ============================================================

function StatCard({ label, value, icon, color }: { label: string; value: string; icon: React.ReactNode; color: string }) {
  const colors: Record<string, string> = {
    emerald: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
    amber: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
    red: 'text-red-400 bg-red-500/10 border-red-500/20',
  };
  return (
    <div className={cn('rounded-lg border p-3 text-center', colors[color])}>
      <div className="flex items-center justify-center gap-1 mb-1 opacity-60">{icon}<span className="text-[10px] uppercase tracking-wider">{label}</span></div>
      <div className="text-lg font-bold font-mono">{value}</div>
    </div>
  );
}

function MiniStat({ label, value, positive, neutral }: { label: string; value: string; positive?: boolean; neutral?: boolean }) {
  return (
    <div className="rounded-lg bg-white/[0.03] border border-white/[0.05] p-2.5 text-center">
      <div className="text-[10px] text-white/25 mb-0.5">{label}</div>
      <div className={cn('text-sm font-bold font-mono', neutral ? 'text-white/60' : positive ? 'text-emerald-400' : 'text-red-400')}>{value}</div>
    </div>
  );
}

function MetricBox({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return (
    <div className="rounded-lg bg-white/[0.03] border border-white/[0.05] p-2.5 text-center">
      <div className="text-[9px] text-white/25 mb-0.5 uppercase tracking-wider">{label}</div>
      <div className={cn('text-xs font-bold font-mono', positive ? 'text-emerald-400' : 'text-red-400')}>{value}</div>
    </div>
  );
}
