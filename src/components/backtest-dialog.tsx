'use client';

import { useState, useEffect, useRef, useCallback, Component, type ReactNode } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import {
  Play, Loader2, XCircle, TrendingUp, TrendingDown, BarChart3,
  Target, Activity, Users, Clock, RotateCcw, FileText, ArrowLeft,
  ArrowUpRight, ArrowDownRight, DollarSign, ChevronDown, ChevronUp,
  Sparkles, Terminal, Layers, Crown,
} from 'lucide-react';

// ============================================================
// Types
// ============================================================

interface BacktestDialogProps { open: boolean; onClose: () => void; }

interface AccountLine {
  id: number; strategyId: string; totalTrades: number; winRate: number; pnlPct: number; emoji: string;
}

interface Progress {
  stage: string; interval?: string; strategyId?: string; current: number; total: number;
}

interface TradeForReport {
  symbol: string; direction: 'long' | 'short';
  entryPrice: number; closePrice: number | null;
  amount: number; leverage: number; pnl: number | null; reason: string;
  openTime: string; closeTime: string | null; stopLoss: number; takeProfit: number;
}

interface BestAccountReport {
  id: number; strategyId: string; strategyLabel: string;
  startBalance: number; endBalance: number; pnl: number; pnlPct: number;
  totalTrades: number; wins: number; losses: number; winRate: number;
  maxDrawdownPct: number; avgWin: number; avgLoss: number; profitFactor: number;
  longTrades: number; shortTrades: number; longWinRate: number; shortWinRate: number;
  largestWin: number; largestLoss: number;
  trades: TradeForReport[];
  equityCurve: { time: number; equity: number }[];
  symbolPerformance: Record<string, { count: number; wins: number; pnl: number }>;
}

interface FinalResult {
  profitable: number; totalTrades: number; avgPnlPct: string;
  bestPnl: number; worstPnl: number; medianPnl: number;
  globalWR: string; avgDD: string;
  stratStats: {
    id: string; interval: string; count: number; profitable: number;
    avgPnl: string; avgWR: string; avgDD: string; bestPnl: string; worstPnl: string; totalTrades: number;
  }[];
  distribution: { from: number; to: number; count: number }[];
  bestUserId: string; medianUserId: string;
  allResults: {
    id: number; strategyId: string; pnlPct: number; totalTrades: number;
    winRate: number; maxDrawdownPct: number; profitFactor: number;
  }[];
  strategyReports: {
    strategyId: string; strategyLabel: string;
    account: BestAccountReport;
  }[];
  bestAccount?: BestAccountReport;
  usedRealData?: boolean; dataSource?: string;
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
  'position-alpha': 'text-sky-400',
};

const STRAT_GRADIENT: Record<string, string> = {
  momentum: 'from-amber-500/15 via-amber-500/5 to-transparent',
  scalper: 'from-violet-500/15 via-violet-500/5 to-transparent',
  'position-alpha': 'from-sky-500/15 via-sky-500/5 to-transparent',
};

const STRAT_ACCENT: Record<string, string> = {
  momentum: 'border-amber-500/20',
  scalper: 'border-violet-500/20',
  'position-alpha': 'border-sky-500/20',
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
  const [selectedReport, setSelectedReport] = useState<BestAccountReport | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => { logsEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs]);

  const reset = useCallback(() => {
    setLogs([]); setAccounts([]); setProgress(null); setResult(null); setError(null); setView('results'); setSelectedReport(null);
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
      let currentEvent = ''; // OUTSIDE the while loop — survives chunk boundaries
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (line.startsWith('event: ')) { currentEvent = line.slice(7).trim(); }
          else if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (currentEvent === 'log') setLogs(prev => [...prev, data.msg]);
              else if (currentEvent === 'progress') setProgress(data);
              else if (currentEvent === 'account') setAccounts(prev => [...prev, data]);
              else if (currentEvent === 'done') { setResult(prev => ({ ...data, bestAccount: prev?.bestAccount })); setRunning(false); }
              else if (currentEvent === 'report') { setResult(prev => prev ? { ...prev, bestAccount: data } : null); }
              else if (currentEvent === 'error') { setError(data.msg); setRunning(false); }
            } catch { /* partial chunk — buffer re-assembles on next read */ }
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
      <DialogContent className={cn(
        'bg-[#0a0a16] border-white/[0.06] flex flex-col p-0 gap-0 overflow-hidden shadow-2xl shadow-black/50 backdrop-blur-xl',
        view === 'report' ? 'max-w-5xl w-[96vw] h-[94vh]' : 'max-w-5xl w-[96vw] h-[92vh]'
      )}>
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-emerald-500/40 to-transparent" />
        <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-emerald-500/[0.03] to-transparent pointer-events-none" />

        <DialogHeader className="px-6 pt-5 pb-1 shrink-0 relative">
          <DialogTitle className="text-sm font-semibold text-white flex items-center gap-2.5">
            <div className="flex items-center justify-center h-7 w-7 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
              <BarChart3 className="h-3.5 w-3.5 text-emerald-400" />
            </div>
            {view === 'report' && selectedReport ? (
              <div className="flex items-center gap-2">
                <button onClick={() => { setView('results'); setSelectedReport(null); }} className="flex items-center gap-1 text-white/30 hover:text-white/60 transition-colors rounded-md px-1.5 py-0.5 hover:bg-white/[0.04]">
                  <ArrowLeft className="h-3.5 w-3.5" />
                </button>
                <span className="text-white/70">Отчет:</span>
                <span className={cn('font-medium', STRAT_COLORS[selectedReport.strategyId])}>#{selectedReport.id} {selectedReport.strategyLabel}</span>
              </div>
            ) : (
              <span className="text-white/90">Бэктест: 100 аккаунтов × 2 месяца</span>
            )}
          </DialogTitle>
          <DialogDescription className="text-[11px] text-white/30 ml-[38px]">
            {view === 'report' && selectedReport
              ? `${selectedReport.strategyLabel} · ${selectedReport.totalTrades} сделок · 2 месяца`
              : 'Детерминированные данные · 3 стратегии · $100 начальный депозит каждый'
            }
          </DialogDescription>
        </DialogHeader>

        {!result && !error && (
          <div className="px-6 py-3 shrink-0">
            <div className="flex items-center gap-3">
              <div className="flex-1 h-1 bg-white/[0.06] rounded-full overflow-hidden">
                <div className={cn('h-full rounded-full transition-all duration-700 ease-out relative', running ? 'bg-gradient-to-r from-emerald-600 via-emerald-500 to-emerald-400' : 'bg-white/10')} style={{ width: `${progressPct}%` }}>
                  {running && <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-pulse" />}
                </div>
              </div>
              <span className="text-[10px] font-mono text-white/25 tabular-nums w-8 text-right">{progressPct}%</span>
            </div>
            {progress && (
              <p className="text-[10px] text-white/20 mt-1.5 font-mono tracking-tight">
                <span className="inline-flex items-center gap-1">
                  <span className={cn('inline-block h-1 w-1 rounded-full', progress.stage === 'candles' ? 'bg-violet-400 animate-pulse' : 'bg-emerald-400 animate-pulse')} />
                  {progress.stage === 'candles'
                    ? `Генерация свечей ${progress.interval}: ${progress.current}/${progress.total}`
                    : `Симуляция: ${progress.current}/${progress.total} аккаунтов`}
                </span>
              </p>
            )}
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-hidden px-6 pb-2">
          {error && (
            <div className="flex items-center gap-2.5 text-red-400 text-xs bg-red-500/[0.08] border border-red-500/15 rounded-xl px-4 py-3">
              <XCircle className="h-4 w-4 shrink-0" /><span>{error}</span>
            </div>
          )}

          {!result && !error && (
            <div className="h-[420px] rounded-xl bg-[#08080f] border border-white/[0.05] overflow-hidden flex flex-col">
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
                    <span className="h-1 w-1 rounded-full bg-emerald-400 animate-pulse" />RUNNING
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
                    <div key={i} className={cn('flex gap-2', a.pnlPct >= 0 ? 'text-emerald-400/50' : 'text-red-400/50')}>
                      <span className="text-white/10 select-none shrink-0 w-5 text-right">{logs.length + i + 1}</span>
                      <span>{a.emoji} <span className="text-white/25">#{String(a.id).padStart(3)}</span>{' '}<span className="text-white/30">{a.strategyId}</span>{' '}<span className="text-white/20">{String(a.totalTrades).padStart(3)} trades</span>{' '}<span className="text-white/20">|</span>{' '}<span className="text-white/40">{String(a.winRate).padStart(5)}% WR</span>{' '}<span className="text-white/20">|</span>{' '}<span className="font-semibold">{a.pnlPct >= 0 ? '+' : ''}{a.pnlPct}%</span></span>
                    </div>
                  ))}
                  {running && (
                    <div className="text-white/15 animate-pulse flex items-center gap-1.5">
                      <Loader2 className="h-3 w-3 animate-spin" /><span>Вычисление...</span>
                    </div>
                  )}
                  <div ref={logsEndRef} />
                </div>
              </ScrollArea>
            </div>
          )}

          {result && view === 'results' && (
            <DialogSafe><ResultsPanel result={result} onSelectAccount={(acct) => {
              // Find strategy report for this account's strategy
              const sr = result.strategyReports?.find(r => r.account.id === acct.id);
              if (sr) { setSelectedReport(sr.account); setView('report'); }
            }} /></DialogSafe>
          )}
          {result && view === 'report' && selectedReport && (
            <DialogSafe><ReportPanel account={selectedReport} /></DialogSafe>
          )}
        </div>

        <div className="px-6 py-4 shrink-0 border-t border-white/[0.04] bg-white/[0.01] flex items-center gap-2.5">
          {!result && (
            <Button onClick={handleStart} disabled={running} className={cn('flex-1 h-11 text-xs font-semibold rounded-xl transition-all duration-300', running ? 'bg-white/[0.04] text-white/25 cursor-not-allowed border border-white/[0.06]' : 'bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white shadow-lg shadow-emerald-600/20 hover:shadow-emerald-500/30 hover:scale-[1.01] active:scale-[0.99]')}>
              {running ? <><Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />Выполняется...</> : <><Sparkles className="h-3.5 w-3.5 mr-2" />Запустить бэктест</>}
            </Button>
          )}
          {result && view === 'results' && (
            <>
              {result.strategyReports && result.strategyReports.length > 0 && (
                <Button onClick={() => { if (result.strategyReports[0]) { setSelectedReport(result.strategyReports[0].account); setView('report'); } }} className="flex-1 h-11 text-xs font-semibold rounded-xl bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white shadow-lg shadow-blue-600/20 hover:shadow-blue-500/30 transition-all duration-300 hover:scale-[1.01] active:scale-[0.99]">
                  <FileText className="h-3.5 w-3.5 mr-2" />Лучший по стратегии
                </Button>
              )}
              <Button onClick={handleStart} disabled={running} className="h-11 text-xs font-semibold rounded-xl bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-white shadow-lg shadow-amber-600/20 hover:shadow-amber-500/30 transition-all duration-300 hover:scale-[1.01] active:scale-[0.99]">
                <RotateCcw className="h-3.5 w-3.5 mr-2" />Заново
              </Button>
            </>
          )}
          {result && view === 'report' && (
            <Button onClick={() => setView('results')} className="flex-1 h-11 text-xs font-semibold rounded-xl bg-white/[0.05] hover:bg-white/[0.08] text-white/60 border border-white/[0.08] transition-all duration-200">
              <ArrowLeft className="h-3.5 w-3.5 mr-2" />К результатам
            </Button>
          )}
          <Button variant="outline" onClick={handleClose} className="h-11 text-xs rounded-xl border-white/[0.06] text-white/30 hover:bg-white/[0.04] hover:text-white/50 transition-all duration-200">
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

function ResultsPanel({ result, onSelectAccount }: { result: FinalResult; onSelectAccount: (acct: { id: number; strategyId: string }) => void }) {
  const sorted = [...result.allResults].sort((a, b) => b.pnlPct - a.pnlPct);
  const bestId = sorted[0]?.id;
  const worstId = sorted[sorted.length - 1]?.id;
  const reportableIds = new Set(result.strategyReports?.map(r => r.account.id) ?? []);
  return (
    <ScrollArea className="h-[520px] space-y-4 pr-1">
      <div className="grid grid-cols-3 gap-2.5">
        <HS label="Прибыльных" value={`${result.profitable}/102`} icon={<Users className="h-3.5 w-3.5" />} color={result.profitable >= 50 ? 'emerald' : result.profitable >= 30 ? 'amber' : 'red'} />
        <HS label="Средний PnL" value={`${parseFloat(result.avgPnlPct) >= 0 ? '+' : ''}${result.avgPnlPct}%`} icon={<TrendingUp className="h-3.5 w-3.5" />} color={parseFloat(result.avgPnlPct) >= 0 ? 'emerald' : 'red'} />
        <HS label="Глобальный WR" value={`${result.globalWR}%`} icon={<Target className="h-3.5 w-3.5" />} color="emerald" />
      </div>
      <div className="grid grid-cols-3 gap-2.5">
        <GS label="Лучший" value={`+${result.bestPnl.toFixed(1)}%`} positive />
        <GS label="Медиана" value={`${result.medianPnl >= 0 ? '+' : ''}${result.medianPnl.toFixed(1)}%`} positive={result.medianPnl >= 0} />
        <GS label="Худший" value={`${result.worstPnl.toFixed(1)}%`} positive={result.worstPnl >= 0} />
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <GS label="Всего сделок" value={`${result.totalTrades}`} neutral />
        <GS label="Ср. просадка" value={`${result.avgDD}%`} neutral />
      </div>

      <SH title="По стратегиям (клик → отчёт лучшего аккаунта)" icon={<Layers className="h-3 w-3" />} />
      <div className="grid grid-cols-3 gap-2.5">
        {result.stratStats.map(s => {
          const sr = result.strategyReports?.find(r => r.strategyId === s.id);
          return (
            <button key={s.id} onClick={() => sr && onSelectAccount({ id: sr.account.id, strategyId: s.id })}
              className={cn('rounded-xl border bg-gradient-to-r p-4 transition-all duration-200 hover:scale-[1.01] text-left', STRAT_GRADIENT[s.id], STRAT_ACCENT[s.id], sr ? 'cursor-pointer hover:brightness-125' : 'opacity-60')}>
              <div className="flex items-center justify-between mb-2">
                <span className={cn('text-xs font-bold', STRAT_COLORS[s.id])}>{STRAT_NAMES[s.id] ?? s.id}</span>
                {sr && <span className="text-[9px] text-white/20">#{sr.account.id}</span>}
              </div>
              <div className="text-[10px] text-white/25 font-mono mb-3">{s.interval} · {s.totalTrades} сделок</div>
              <div className="grid grid-cols-2 gap-2">
                <div><div className="text-[9px] text-white/20 uppercase mb-1">Прибыльных</div><div className={cn('text-xs font-bold font-mono', s.profitable >= s.count / 2 ? 'text-emerald-400' : 'text-red-400')}>{s.profitable}/{s.count}</div></div>
                <div><div className="text-[9px] text-white/20 uppercase mb-1">Ср. PnL</div><div className={cn('text-xs font-bold font-mono', parseFloat(s.avgPnl) >= 0 ? 'text-emerald-400' : 'text-red-400')}>{parseFloat(s.avgPnl) >= 0 ? '+' : ''}{s.avgPnl}%</div></div>
              </div>
            </button>
          );
        })}
      </div>

      <SH title="Все 102 аккаунта (зелёный=прибыль, красный=убыток)" icon={<Users className="h-3 w-3" />} />
      <div className="grid grid-cols-6 sm:grid-cols-8 md:grid-cols-10 lg:grid-cols-12 xl:grid-cols-17 gap-1">
        {sorted.map(a => {
          const isBest = a.id === bestId;
          const isWorst = a.id === worstId;
          const hasReport = reportableIds.has(a.id);
          const pct = a.pnlPct;
          const intensity = Math.min(Math.abs(pct) / 50, 1);
          return (
            <button key={a.id} onClick={() => hasReport && onSelectAccount(a)}
              title={`#${a.id} ${STRAT_NAMES[a.strategyId]?.split(' ')[0]} · ${a.totalTrades} trades · ${a.winRate}% WR · ${pct >= 0 ? '+' : ''}${pct}%`}
              className={cn('rounded-lg border text-center py-2 px-1 transition-all duration-150 hover:scale-110 hover:z-10 relative',
                hasReport ? 'cursor-pointer' : 'cursor-default opacity-50',
                isBest && 'ring-1 ring-emerald-400/50 z-10 border-emerald-500/40',
                isWorst && !isBest && 'ring-1 ring-red-400/50 z-10 border-red-500/40',
                !isBest && !isWorst && 'border-white/[0.04]')} style={{ background: pct >= 0 ? `rgba(16,185,129,${(0.06 + intensity * 0.4).toFixed(2)})` : `rgba(239,68,68,${(0.06 + intensity * 0.4).toFixed(2)})` }}>
              <div className={cn('text-[10px] font-bold font-mono leading-none', pct >= 0 ? 'text-emerald-200' : 'text-red-200')}>{pct >= 0 ? '+' : ''}{pct.toFixed(0)}%</div>
              <div className="text-[7px] text-white/20 font-mono mt-1 leading-none truncate">{STRAT_NAMES[a.strategyId]?.split(' ')[0]?.slice(0, 5)}</div>
              {isBest && <div className="absolute -top-1 -right-1 text-[8px]">🏆</div>}
              {isWorst && !isBest && <div className="absolute -top-1 -right-1 text-[8px]">💀</div>}
            </button>
          );
        })}
      </div>

      {result.distribution.length > 0 && (<>
        <SH title="Распределение PnL" icon={<BarChart3 className="h-3 w-3" />} />
        <div className="rounded-xl bg-white/[0.02] border border-white/[0.04] p-4 space-y-1.5">
          {result.distribution.map((d, i) => {
            const maxCount = Math.max(...result.distribution.map(x => x.count));
            const w = maxCount > 0 ? (d.count / maxCount) * 100 : 0;
            const isProfit = d.from >= 0;
            return (
              <div key={i} className="flex items-center gap-2.5 text-[10px] font-mono tabular-nums">
                <span className="text-white/25 w-28 text-right shrink-0">{d.from >= 0 ? '+' : ''}{d.from}% → {d.to >= 0 ? '+' : ''}{d.to}%</span>
                <div className="flex-1 h-5 bg-white/[0.03] rounded-md overflow-hidden">
                  <div className={cn('h-full rounded-md transition-all duration-1000 ease-out', isProfit ? 'bg-gradient-to-r from-emerald-600/40 to-emerald-500/60' : 'bg-gradient-to-r from-red-600/40 to-red-500/60')} style={{ width: `${Math.max(w, 3)}%` }} />
                </div>
                <span className={cn('w-6 text-right shrink-0 font-semibold tabular-nums', isProfit ? 'text-emerald-400/60' : 'text-red-400/60')}>{d.count}</span>
              </div>);
          })}
        </div>
      </>)}
    </ScrollArea>
  );
}

// ============================================================
// Equity Curve Canvas
// ============================================================

function EquityCurveCanvas({ data, startBalance, isPositive }: { data: { time: number; equity: number }[]; startBalance: number; isPositive: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawRef = useRef<(() => void) | null>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || data.length < 2) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) return; // not laid out yet
    canvas.width = rect.width * dpr; canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    const W = rect.width, H = rect.height;
    const pad = { top: 14, right: 16, bottom: 28, left: 56 };
    const cW = W - pad.left - pad.right, cH = H - pad.top - pad.bottom;
    const vals = data.map(d => d.equity);
    const min = Math.min(...vals), max = Math.max(...vals);
    const range = max - min || 1;
    const yPad = range * 0.1;
    const yMin = min - yPad, yMax = max + yPad, yRange = yMax - yMin;
    const toX = (i: number) => pad.left + (i / (data.length - 1)) * cW;
    const toY = (v: number) => pad.top + (1 - (v - yMin) / yRange) * cH;
    ctx.clearRect(0, 0, W, H);
    // Grid
    const steps = 5;
    ctx.strokeStyle = 'rgba(255,255,255,0.04)'; ctx.lineWidth = 1;
    ctx.font = '10px monospace'; ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let i = 0; i <= steps; i++) {
      const val = yMin + (i / steps) * yRange;
      const y = toY(val);
      ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
      ctx.fillText(`$${val.toFixed(0)}`, pad.left - 8, y);
    }
    // Time labels
    const t0 = data[0].time, t1 = data[data.length - 1].time;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillStyle = 'rgba(255,255,255,0.15)';
    for (let i = 0; i <= 4; i++) {
      const t = t0 + (i / 4) * (t1 - t0);
      const x = pad.left + (i / 4) * cW;
      const d = new Date(t * 1000);
      ctx.fillText(`${d.getDate()}.${String(d.getMonth() + 1).padStart(2, '0')}`, x, H - pad.bottom + 10);
    }
    // Start line
    const sY = toY(startBalance);
    if (sY >= pad.top && sY <= pad.top + cH) {
      ctx.setLineDash([4, 4]); ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(pad.left, sY); ctx.lineTo(W - pad.right, sY); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.font = '9px monospace'; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
      ctx.fillText(`$${startBalance}`, W - pad.right, sY - 4);
    }
    // Area
    const color = isPositive ? '#10b981' : '#ef4444';
    const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + cH);
    grad.addColorStop(0, isPositive ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.beginPath(); ctx.moveTo(toX(0), toY(data[0].equity));
    for (let i = 1; i < data.length; i++) ctx.lineTo(toX(i), toY(data[i].equity));
    ctx.lineTo(toX(data.length - 1), pad.top + cH); ctx.lineTo(toX(0), pad.top + cH); ctx.closePath();
    ctx.fillStyle = grad; ctx.fill();
    // Line
    ctx.beginPath(); ctx.moveTo(toX(0), toY(data[0].equity));
    for (let i = 1; i < data.length; i++) ctx.lineTo(toX(i), toY(data[i].equity));
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke();
    // End dot
    const lx = toX(data.length - 1), ly = toY(data[data.length - 1].equity);
    ctx.beginPath(); ctx.arc(lx, ly, 6, 0, Math.PI * 2);
    ctx.fillStyle = isPositive ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)'; ctx.fill();
    ctx.beginPath(); ctx.arc(lx, ly, 3, 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.fill();
  }, [data, startBalance, isPositive]);

  useEffect(() => { drawRef.current = draw; });

  useEffect(() => {
    // Initial draw + redraw on resize
    const timer = setTimeout(() => drawRef.current?.(), 50);
    let ro: ResizeObserver | undefined;
    if (canvasRef.current) {
      ro = new ResizeObserver(() => drawRef.current?.());
      ro.observe(canvasRef.current);
    }
    return () => { clearTimeout(timer); ro?.disconnect(); };
  }, []);

  return <canvas ref={canvasRef} className="w-full h-full" style={{ display: 'block' }} />;
}

// ============================================================
// Report Panel — Investor Grade
// ============================================================

function ReportPanel({ account }: { account: BestAccountReport }) {
  const [expanded, setExpanded] = useState(false);
  const stratColor = STRAT_COLORS[account.strategyId] ?? 'text-emerald-400';
  const isPositive = account.pnlPct >= 0;
  const eqData = account.equityCurve.length > 1 ? account.equityCurve : [
    { time: 0, equity: account.startBalance }, { time: 1, equity: account.endBalance },
  ];
  const tradesSorted = [...account.trades].sort((a, b) => new Date(b.openTime).getTime() - new Date(a.openTime).getTime());
  const symPerfSorted = Object.entries(account.symbolPerformance)
    .map(([sym, d]) => ({ sym, ...d, wr: d.count > 0 ? Math.round((d.wins / d.count) * 1000) / 10 : 0 }))
    .sort((a, b) => b.pnl - a.pnl);

  return (
    <ScrollArea className="h-[520px] space-y-4 pr-1">
      {/* Hero + Equity Curve */}
      <div className="relative rounded-2xl border border-amber-500/20 bg-gradient-to-br from-amber-500/[0.08] via-amber-500/[0.03] to-transparent p-5 overflow-hidden">
        <div className="absolute -top-12 -right-12 h-32 w-32 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="relative">
          <div className="flex items-center justify-between mb-4">
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
              <div className={cn('text-3xl font-bold font-mono tabular-nums', isPositive ? 'text-emerald-400' : 'text-red-400')}>
                {isPositive ? '+' : ''}{account.pnlPct}%
              </div>
              <div className="text-[11px] text-white/25 font-mono tabular-nums mt-0.5">
                ${account.startBalance} → ${account.endBalance.toFixed(2)}
              </div>
            </div>
          </div>
          <div className="rounded-xl bg-[#06060c] border border-white/[0.05] p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] text-white/25 uppercase tracking-[0.15em] font-semibold">Динамика депозита</span>
              <span className="text-[9px] text-white/15 font-mono tabular-nums">2 месяца</span>
            </div>
            <div className="h-[180px] w-full">
              <EquityCurveCanvas data={eqData} startBalance={account.startBalance} isPositive={isPositive} />
            </div>
          </div>
        </div>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-4 gap-2.5">
        <MB label="Сделок" value={`${account.totalTrades}`} icon={<Activity className="h-3 w-3" />} />
        <MB label="Win Rate" value={`${account.winRate}%`} icon={<Target className="h-3 w-3" />} positive={account.winRate >= 50} />
        <MB label="Profit Factor" value={`${account.profitFactor}`} icon={<TrendingUp className="h-3 w-3" />} positive={account.profitFactor >= 1} />
        <MB label="Макс. DD" value={`${account.maxDrawdownPct}%`} icon={<TrendingDown className="h-3 w-3" />} />
      </div>
      <div className="grid grid-cols-4 gap-2.5">
        <MB label="Лонги" value={`${account.longTrades}`} sub={`${account.longWinRate}% WR`} positive={account.longWinRate >= 50} />
        <MB label="Шорты" value={`${account.shortTrades}`} sub={`${account.shortWinRate}% WR`} positive={account.shortWinRate >= 50} />
        <MB label="Ср. прибыль" value={`$${account.avgWin.toFixed(2)}`} positive />
        <MB label="Ср. убыток" value={`$${account.avgLoss.toFixed(2)}`} />
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <MB label="Макс. прибыль" value={`+$${account.largestWin.toFixed(2)}`} positive />
        <MB label="Макс. убыток" value={`-$${Math.abs(account.largestLoss).toFixed(2)}`} />
      </div>

      {/* Symbols */}
      <SH title="Результаты по монетам" icon={<DollarSign className="h-3 w-3" />} />
      <div className="rounded-xl bg-[#08080f] border border-white/[0.04] overflow-hidden">
        <div className="grid grid-cols-4 gap-1 px-4 py-2 text-[9px] text-white/20 font-mono uppercase tracking-wider border-b border-white/[0.04] bg-white/[0.01]">
          <span>Монета</span><span className="text-center">Сделок</span><span className="text-center">WR</span><span className="text-right">PnL</span>
        </div>
        <ScrollArea className="max-h-40">
          {symPerfSorted.slice(0, 20).map((s, idx) => (
            <div key={s.sym} className={cn('grid grid-cols-4 gap-1 px-4 py-2 text-[10px] font-mono tabular-nums border-b border-white/[0.02] transition-colors hover:bg-white/[0.02]', idx % 2 === 1 && 'bg-white/[0.01]')}>
              <span className="text-white/50 truncate">{s.sym.replace('USDT', '')}</span>
              <span className="text-center text-white/25">{s.count}</span>
              <span className="text-center text-white/35">{s.wr}%</span>
              <span className={cn('text-right font-semibold', s.pnl >= 0 ? 'text-emerald-400' : 'text-red-400')}>${s.pnl >= 0 ? '+' : ''}{s.pnl.toFixed(2)}</span>
            </div>
          ))}
        </ScrollArea>
      </div>

      {/* Trades */}
      <button onClick={() => setExpanded(!expanded)} className="text-[10px] uppercase tracking-widest text-white/20 font-medium hover:text-white/40 transition-colors flex items-center gap-1.5 w-full py-1 group">
        <Clock className="h-3 w-3" /><span>Все сделки ({account.trades.length})</span>
        <span className="ml-1 text-white/10 group-hover:text-white/20 transition-colors">{expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}</span>
      </button>
      {expanded && (
        <div className="rounded-xl bg-[#08080f] border border-white/[0.04] overflow-hidden">
          <div className="grid grid-cols-12 gap-1 px-4 py-2 text-[8px] text-white/20 font-mono uppercase tracking-wider border-b border-white/[0.04] bg-white/[0.01]">
            <span className="col-span-2">Монета</span><span>Dir</span><span className="text-right col-span-2">Вход</span><span className="text-right col-span-2">Выход</span><span className="text-right">Сумма</span><span className="text-right">Плечо</span><span className="text-right">Причина</span><span className="text-right">PnL</span>
          </div>
          <ScrollArea className="max-h-64">
            {tradesSorted.map((tr, i) => (
              <div key={i} className={cn('grid grid-cols-12 gap-1 px-4 py-2 text-[10px] font-mono tabular-nums border-b border-white/[0.02] transition-colors hover:bg-white/[0.02]', i % 2 === 1 && 'bg-white/[0.01]')}>
                <span className="col-span-2 text-white/45 truncate">{tr.symbol.replace('USDT', '')}</span>
                <span>{tr.direction === 'long' ? <ArrowUpRight className="h-3 w-3 text-emerald-400" /> : <ArrowDownRight className="h-3 w-3 text-red-400" />}</span>
                <span className="text-right text-white/35 col-span-2">{tr.entryPrice < 1 ? tr.entryPrice.toPrecision(4) : tr.entryPrice.toFixed(2)}</span>
                <span className="text-right text-white/35 col-span-2">{tr.closePrice != null ? (tr.closePrice < 1 ? tr.closePrice.toPrecision(4) : tr.closePrice.toFixed(2)) : '—'}</span>
                <span className="text-right text-white/30">${tr.amount.toFixed(1)}</span>
                <span className="text-right text-white/20">{tr.leverage}x</span>
                <span className="text-right text-white/20 text-[9px] truncate">{tr.reason}</span>
                <span className={cn('text-right font-semibold', (tr.pnl ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400')}>{(tr.pnl ?? 0) >= 0 ? '+' : ''}{(tr.pnl ?? 0).toFixed(2)}</span>
              </div>
            ))}
          </ScrollArea>
        </div>
      )}
    </ScrollArea>
  );
}

// ============================================================
// Inline Error Boundary (prevents dialog crash)
// ============================================================

class DialogSafe extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null };
  static getDerivedStateFromError(e: any) { return { error: e?.message ?? String(e) }; }
  render() {
    if (this.state.error) {
      return (
        <div className="h-full flex flex-col items-center justify-center gap-3 p-6">
          <div className="w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
            <XCircle className="h-5 w-5 text-red-400" />
          </div>
          <p className="text-xs text-white/40 text-center max-w-xs">Ошибка рендеринга: {this.state.error}</p>
          <button onClick={() => this.setState({ error: null })} className="px-3 py-1.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.08] text-white/50 text-[10px] transition-colors">
            Попробовать снова
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ============================================================
// Shared Components
// ============================================================

function SH({ title, icon }: { title: string; icon: React.ReactNode }) {
  return <div className="flex items-center gap-2 text-white/20">{icon}<h3 className="text-[10px] uppercase tracking-[0.15em] font-semibold">{title}</h3></div>;
}

function HS({ label, value, icon, color }: { label: string; value: string; icon: React.ReactNode; color: string }) {
  const p: Record<string, { i: string; v: string; g: string }> = {
    emerald: { i: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400', v: 'text-emerald-400', g: 'shadow-emerald-500/5' },
    amber: { i: 'bg-amber-500/10 border-amber-500/20 text-amber-400', v: 'text-amber-400', g: 'shadow-amber-500/5' },
    red: { i: 'bg-red-500/10 border-red-500/20 text-red-400', v: 'text-red-400', g: 'shadow-red-500/5' },
  };
  const c = p[color] || p.emerald;
  return (
    <div className={cn('rounded-xl border border-white/[0.05] bg-white/[0.02] p-3.5 shadow-lg', c.g)}>
      <div className="flex items-center justify-between mb-2.5">
        <span className="text-[9px] uppercase tracking-[0.12em] text-white/25 font-medium">{label}</span>
        <div className={cn('flex items-center justify-center h-6 w-6 rounded-lg border', c.i)}>{icon}</div>
      </div>
      <div className={cn('text-xl font-bold font-mono tabular-nums leading-none', c.v)}>{value}</div>
    </div>
  );
}

function GS({ label, value, positive, neutral }: { label: string; value: string; positive?: boolean; neutral?: boolean }) {
  return (
    <div className="rounded-xl bg-white/[0.02] border border-white/[0.04] p-3 text-center transition-colors hover:bg-white/[0.03]">
      <div className="text-[9px] text-white/20 uppercase tracking-[0.1em] mb-1.5 font-medium">{label}</div>
      <div className={cn('text-sm font-bold font-mono tabular-nums', neutral ? 'text-white/50' : positive ? 'text-emerald-400' : 'text-red-400')}>{value}</div>
    </div>
  );
}

function MP({ label, value, positive, negative }: { label: string; value: string; positive?: boolean; negative?: boolean }) {
  return (
    <div className="text-center">
      <div className="text-[9px] text-white/20 uppercase tracking-[0.1em] mb-1">{label}</div>
      <div className={cn('text-xs font-bold font-mono tabular-nums', positive ? 'text-emerald-400' : negative ? 'text-red-400' : 'text-white/60')}>{value}</div>
    </div>
  );
}

function MB({ label, value, icon, sub, positive }: { label: string; value: string; icon?: React.ReactNode; sub?: string; positive?: boolean }) {
  return (
    <div className="rounded-xl bg-white/[0.02] border border-white/[0.04] p-3 text-center transition-colors hover:bg-white/[0.03] group">
      {icon && <div className="flex items-center justify-center mb-1.5 text-white/15 group-hover:text-white/25 transition-colors">{icon}</div>}
      <div className="text-[8px] text-white/15 uppercase tracking-[0.12em] mb-1 font-medium">{label}</div>
      <div className={cn('text-sm font-bold font-mono tabular-nums', positive === undefined ? 'text-white/50' : positive ? 'text-emerald-400' : 'text-red-400')}>{value}</div>
      {sub && <div className="text-[9px] text-white/20 font-mono tabular-nums mt-0.5">{sub}</div>}
    </div>
  );
}
