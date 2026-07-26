'use client';

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { useTerminalStore } from '@/lib/store';
import { STRATEGIES, getStrategy } from '@/lib/strategies';
import { cn } from '@/lib/utils';
import { Menu, X, ChevronDown, BarChart3, RotateCcw, FileSpreadsheet, ShieldCheck } from 'lucide-react';
import CoinList from '@/components/coin-list';
import TradingDashboard from '@/components/trading-dashboard';
import ControlPanel from '@/components/control-panel';
import OrderBook from '@/components/order-book';
import { DEFAULT_INDICATORS, type IndicatorConfig } from '@/components/chart';
import type { CandleData, TraderState, Trade, IndicatorWeight } from '@/lib/types';
import AdminPanel from '@/components/admin-panel';
import { fetchSettings, invalidateSettingsCache } from '@/lib/settings-cache';

const MomentumReport = dynamic(() => import('@/components/momentum-report'), {
  ssr: false,
});

const TradingChart = dynamic(() => import('@/components/chart'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full min-h-[300px] flex items-center justify-center bg-[#0d0d14]">
      <div className="flex items-center gap-2 text-xs text-white/40">
        <div className="w-3 h-3 border-2 border-white/15 border-t-white/50 rounded-full animate-spin" />
        Загрузка графика...
      </div>
    </div>
  ),
});

const TIMEFRAMES = [
  { label: '1m', interval: '1m', limit: 1000 },
  { label: '5m', interval: '5m', limit: 1000 },
  { label: '15m', interval: '15m', limit: 1000 },
  { label: '1H', interval: '1h', limit: 1440 },
] as const;

export type Timeframe = (typeof TIMEFRAMES)[number];

// Merge strategy chartIndicators with DEFAULT_INDICATORS to produce full config
function mergeStrategyIndicators(strategyId: string): Record<string, IndicatorConfig> {
  const strategy = getStrategy(strategyId);
  const base = { ...DEFAULT_INDICATORS };
  if (strategy) {
    for (const [key, cfg] of Object.entries(strategy.chartIndicators)) {
      if (base[key]) {
        base[key] = {
          ...base[key],
          visible: cfg.visible,
          ...(cfg.color ? { color: cfg.color } : {}),
        };
      }
    }
  }
  // Also add bb-middle if the strategy defines it
  if (strategy?.chartIndicators['bb-middle'] && !base['bb-middle']) {
    base['bb-middle'] = {
      id: 'bb-middle',
      label: 'BB mid',
      color: strategy.chartIndicators['bb-middle'].color ?? '#6ee7b7',
      lineWidth: 1,
      visible: strategy.chartIndicators['bb-middle'].visible,
    };
  }
  return base;
}

export default function TradingTerminal() {
  const {
    selectedSymbol,
    setSelectedSymbol,
    coins,
    traderState,
    setTraderState,
    weights,
    setWeights,
    openTrades,
    setOpenTrades,
    recentTrades,
    setRecentTrades,
    setCurrentAnalysis,
    isLoading,
    autoTrading,
    setAutoTrading,
    addLog,
    activeStrategy,
    setActiveStrategy,
    strategyStates,
    setStrategyTraderState,
    setStrategyOpenTrades,
    setStrategyRecentTrades,
    setStrategyTotalClosedPnl,
    setStrategyClosedTradeCount,
    totalClosedPnl,
    closedTradeCount,
  } = useTerminalStore();

  const strategy = getStrategy(activeStrategy);

  const [candles, setCandles] = useState<CandleData[]>([]);
  const [chartLoading, setChartLoading] = useState(false);
  const [timeframe, setTimeframe] = useState<Timeframe>(TIMEFRAMES[3]);
  const [focusedTradeId, setFocusedTradeId] = useState<string | null>(null);
  const [showCoinSheet, setShowCoinSheet] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [reportStrategyId, setReportStrategyId] = useState<string | null>(null);
  const [showMobilePanel, setShowMobilePanel] = useState<string | null>(null);
  const [showAdminPanel, setShowAdminPanel] = useState(false);

  // Indicator state — derived from active strategy, with localStorage override
  const [indicators, setIndicators] = useState<Record<string, IndicatorConfig>>(() => {
    const base = mergeStrategyIndicators('momentum');
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('chart-indicators');
        if (saved) return { ...base, ...JSON.parse(saved) };
      } catch { /* ignore */ }
    }
    return base;
  });

  // When strategy changes, reset indicators to strategy defaults (keep localStorage overrides)
  useEffect(() => {
    const base = mergeStrategyIndicators(activeStrategy);
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('chart-indicators');
        if (saved) {
          const overrides: Record<string, Partial<IndicatorConfig>> = JSON.parse(saved);
          // Only apply overrides for indicators that exist in the new strategy's config
          for (const key of Object.keys(overrides)) {
            if (base[key]) {
              base[key] = { ...base[key], ...overrides[key] };
            }
          }
          return setIndicators(base);
        }
      } catch { /* ignore */ }
    }
    setIndicators(base);
  }, [activeStrategy]);

  const toggleIndicator = useCallback((id: string) => {
    setIndicators(prev => ({ ...prev, [id]: { ...prev[id], visible: !prev[id].visible } }));
  }, []);

  useEffect(() => {
    try { localStorage.setItem('chart-indicators', JSON.stringify(indicators)); } catch { /* ignore */ }
  }, [indicators]);

  const initDone = useRef(false);
  const [initFailed, setInitFailed] = useState(false);
  const openTradesRef = useRef(openTrades);
  openTradesRef.current = openTrades;

  const initData = useCallback(async () => {
    if (initDone.current) return;
    initDone.current = true;
    try {
      // Fetch all 3 strategies in parallel
      const results = await Promise.all(
        STRATEGIES.map(async (s) => {
          try {
            const res = await fetch(`/api/init?strategyId=${s.id}`);
            if (!res.ok) return { strategyId: s.id, data: {} };
            const data = await res.json();
            return { strategyId: s.id, data };
          } catch {
            return { strategyId: s.id, data: {} };
          }
        })
      );

      let anyStateLoaded = false;
      for (const { strategyId, data } of results) {
        if (data.state) {
          setStrategyTraderState(strategyId, data.state as TraderState);
          anyStateLoaded = true;
        }
        if (data.openTrades) setStrategyOpenTrades(strategyId, data.openTrades as Trade[]);
        if (data.recentTrades) setStrategyRecentTrades(strategyId, data.recentTrades as Trade[]);
        if (data.totalClosedPnl !== undefined) setStrategyTotalClosedPnl(strategyId, data.totalClosedPnl as number);
        if (data.closedTradeCount !== undefined) setStrategyClosedTradeCount(strategyId, data.closedTradeCount as number);
      }

      // Also set the global weights (shared across strategies)
      const firstData = results[0]?.data;
      if (firstData?.weights) setWeights(firstData.weights as IndicatorWeight[]);

      // If no state loaded at all, allow retry
      if (!anyStateLoaded) {
        initDone.current = false;
        setInitFailed(true);
      }
    } catch (err) {
      console.error('Init error:', err);
      initDone.current = false;
      setInitFailed(true);
    }
  }, [setWeights, setStrategyTraderState, setStrategyOpenTrades, setStrategyRecentTrades, setStrategyTotalClosedPnl, setStrategyClosedTradeCount]);

  useEffect(() => { initData(); }, [initData]);

  // Retry init if it failed — check every 5s until data loads
  useEffect(() => {
    if (!initFailed) return;
    const interval = setInterval(() => { initData(); }, 5000);
    return () => clearInterval(interval);
  }, [initFailed, initData]);

  const fetchCandles = useCallback(async (symbol: string, tf: Timeframe) => {
    setChartLoading(true);
    try {
      const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${tf.interval}&limit=${tf.limit}`);
      const raw = await res.json();
      if (Array.isArray(raw) && raw.length > 0) {
        const c: CandleData[] = raw.map((k: (string | number)[]) => ({
          time: Math.floor(Number(k[0]) / 1000),
          open: parseFloat(String(k[1])),
          high: parseFloat(String(k[2])),
          low: parseFloat(String(k[3])),
          close: parseFloat(String(k[4])),
          volume: parseFloat(String(k[5])),
        }));
        setCandles(c);
      }
    } catch (err) {
      console.error('Klines error:', err);
    } finally {
      setChartLoading(false);
    }
  }, []);

  useEffect(() => {
    setCandles([]);
    fetchCandles(selectedSymbol, timeframe);
  }, [selectedSymbol, timeframe, fetchCandles]);

  // Poll active strategy state
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/trader?strategyId=${activeStrategy}`);
        const data = await res.json();
        if (data.state) setTraderState(data.state as TraderState);
        if (data.openTrades) setOpenTrades(data.openTrades as Trade[]);
        if (data.recentTrades) setRecentTrades(data.recentTrades as Trade[]);
        if (data.totalClosedPnl !== undefined) setStrategyTotalClosedPnl(activeStrategy, data.totalClosedPnl as number);
        if (data.closedTradeCount !== undefined) setStrategyClosedTradeCount(activeStrategy, data.closedTradeCount as number);
      } catch { /* silent */ }
    }, 15000);
    return () => clearInterval(interval);
  }, [setTraderState, setOpenTrades, setRecentTrades, setStrategyTotalClosedPnl, setStrategyClosedTradeCount, activeStrategy]);

  // Auto-trading loop — runs for ALL strategies in parallel
  // NOTE: autoTrading and addLog are the ONLY reactive deps — all state is read fresh via refs/callbacks
  useEffect(() => {
    if (!autoTrading) return;
    let cancelled = false;

    const runCycle = async () => {
      if (cancelled) return;
      try {
        const { runAutoTradeCycle } = await import('@/lib/client-trader');

        // Load settings once per cycle for all strategies (non-blocking fallback on failure)
        let sysSettings: Record<string, string> = {};
        try {
          sysSettings = await fetchSettings();
        } catch (err) {
          console.warn('[AutoTrade] Settings fetch failed, using defaults:', err);
        }

        // Read fresh state for each strategy (avoids stale closure)
        const currentStates = useTerminalStore.getState().strategyStates;

        // Run cycle for all strategies in parallel
        const results = await Promise.all(
          STRATEGIES.map(async (s) => {
            const ss = currentStates[s.id];
            const sOpenTrades = ss?.openTrades ?? [];
            const sTraderState = ss?.traderState;
            const balance = sTraderState?.balance ?? 100;

            // Calculate actual PnL from trades closed in the last 24h (enables daily loss limit)
            const now = Date.now();
            const dayMs = 24 * 60 * 60 * 1000;
            const recentPnl24h = (ss?.recentTrades ?? [])
              .filter(t => t.closed_at && (now - new Date(t.closed_at).getTime()) < dayMs)
              .reduce((sum, t) => sum + (t.pnl ?? 0), 0);

            try {
              const result = await runAutoTradeCycle(sOpenTrades, s.id, timeframe.interval, balance, 0, recentPnl24h, sysSettings);
              return { strategyId: s.id, result };
            } catch (err) {
              console.error(`[AutoTrade][${s.id}] Error:`, err);
              return { strategyId: s.id, result: { message: `Error: ${err instanceof Error ? err.message : 'unknown'}`, action: 'idle' as const, closedTrades: [], trailingUpdates: [], tpRepairs: [] } };
            }
          })
        );

        if (cancelled) return;

        for (const { strategyId, result } of results) {
          const r = result as {
            action: string;
            message: string;
            closedTrades: Array<{ tradeId: string; symbol: string; direction: string; pnl: number; reason: string; exitPrice: number }>;
            trailingUpdates: Array<{ tradeId: string; newStopLoss: number; reason: string }>;
            tpRepairs: Array<{ tradeId: string; newTakeProfit: number; reason: string }>;
            newTrades?: Array<{ symbol: string; direction: string; price: number; leverage: number; stopLoss: number; takeProfit: number; amount: number; strategyId: string; label: string }>;
          };

          console.log(`[AutoTrade][${strategyId}]`, r.message);
          addLog(`[${getStrategy(strategyId)?.name ?? strategyId}] ${r.message}`, r.action === 'new-trade' ? 'trade' : 'info');

          // Process closed trades
          for (const ct of r.closedTrades) {
            try {
              const closeRes = await fetch('/api/trader', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'close-trade', tradeId: ct.tradeId, exitPrice: ct.exitPrice, strategyId }),
              });
              const closeData = await closeRes.json();
              if (closeData.success) {
                addLog(`[${getStrategy(strategyId)?.name ?? strategyId}] Закрыта ${ct.symbol}: ${ct.reason} | PnL: ${ct.pnl >= 0 ? '+' : ''}$${ct.pnl.toFixed(2)}`, ct.pnl >= 0 ? 'trade' : 'error');
              }
            } catch { /* silent */ }
          }

          // Apply trailing stop updates
          for (const tu of r.trailingUpdates ?? []) {
            try {
              await fetch('/api/trader', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'update-sl', tradeId: tu.tradeId, newStopLoss: tu.newStopLoss, strategyId }),
              });
              addLog(`[${getStrategy(strategyId)?.name ?? strategyId}] Trailing SL: ${tu.reason}`, 'info');
            } catch { /* silent */ }
          }

          // Apply TP repairs
          for (const tpr of r.tpRepairs ?? []) {
            try {
              await fetch('/api/trader', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'update-tp', tradeId: tpr.tradeId, newTakeProfit: tpr.newTakeProfit, strategyId }),
              });
              addLog(`[${getStrategy(strategyId)?.name ?? strategyId}] TP ремонт: ${tpr.reason}`, 'warn');
            } catch { /* silent */ }
          }

          // Open new trades (may be multiple: secure + runner)
          for (const nt of (r.newTrades ?? [])) {
            try {
              const openRes = await fetch('/api/trader', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  action: 'open-trade',
                  symbol: nt.symbol, entryPrice: nt.price, amount: nt.amount,
                  leverage: nt.leverage, direction: nt.direction,
                  stopLoss: nt.stopLoss, takeProfit: nt.takeProfit,
                  strategyId,
                }),
              });
              const openData = await openRes.json();
              if (openData.success) {
                addLog(`[${getStrategy(strategyId)?.name ?? strategyId}] Открыта ${nt.label === 'secure' ? '🔒' : '🏃'} ${nt.direction.toUpperCase()} ${nt.symbol.replace('USDT', '')} @ $${nt.price.toFixed(2)} | ${nt.leverage}x | $${nt.amount.toFixed(2)}`, 'trade');
              } else {
                addLog(`[${getStrategy(strategyId)?.name ?? strategyId}] Ошибка открытия: ${openData.error || 'unknown'}`, 'error');
              }
            } catch (err) {
              addLog(`[${getStrategy(strategyId)?.name ?? strategyId}] Ошибка сети: ${err instanceof Error ? err.message : 'unknown'}`, 'error');
            }
          }

          // Refresh this strategy's state
          try {
            const res = await fetch(`/api/trader?strategyId=${strategyId}`);
            const data = await res.json();
            if (data.state) setStrategyTraderState(strategyId, data.state as TraderState);
            if (data.openTrades) setStrategyOpenTrades(strategyId, data.openTrades as Trade[]);
            if (data.recentTrades) setStrategyRecentTrades(strategyId, data.recentTrades as Trade[]);
            if (data.totalClosedPnl !== undefined) setStrategyTotalClosedPnl(strategyId, data.totalClosedPnl);
            if (data.closedTradeCount !== undefined) setStrategyClosedTradeCount(strategyId, data.closedTradeCount);
          } catch { /* silent */ }
        }
      } catch (err) {
        console.error('[AutoTrade] Cycle error:', err);
        addLog(`Ошибка цикла: ${err instanceof Error ? err.message : 'unknown'}`, 'error');
      }
    };

    addLog('Авто-трейдинг запущен (3 стратегии)', 'trade');
    runCycle();
    const interval = setInterval(runCycle, 30000);
    return () => {
      cancelled = true;
      clearInterval(interval);
      addLog('Авто-трейдинг остановлен', 'info');
    };
  }, [autoTrading, addLog]);

  // Analyze on symbol change — uses active strategy
  useEffect(() => {
    if (candles.length < 50) return;
    let cancelled = false;
    const analyze = async () => {
      try {
        const { analyzeSymbol } = await import('@/lib/client-trader');
        const decision = await analyzeSymbol(selectedSymbol, timeframe.interval, timeframe.limit, activeStrategy);
        if (!cancelled && decision) setCurrentAnalysis(decision);
      } catch { /* silent */ }
    };
    const timeout = setTimeout(analyze, 300);
    return () => { cancelled = true; clearTimeout(timeout); };
  }, [selectedSymbol, candles.length, timeframe, setCurrentAnalysis, activeStrategy]);

  return (
    <div className="h-full w-full flex flex-col overflow-hidden bg-[#0a0a0f]">
      {/* Top Bar */}
      <header className="h-12 flex items-center justify-between px-4 md:px-5 border-b border-white/[0.06] bg-[#0d0d14]/95 backdrop-blur-xl shrink-0 z-20 safe-top">
        <div className="flex items-center gap-3 md:gap-4 min-w-0">
          <div className="flex items-center gap-2.5 shrink-0">
            <div className={`w-2 h-2 rounded-full ${autoTrading ? 'bg-emerald-400 animate-pulse shadow-lg shadow-emerald-400/30' : 'bg-white/20'}`} />
            <span className="text-sm font-bold text-white tracking-tight">Trade Terminal</span>
            {autoTrading && (
              <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
                LIVE
              </span>
            )}
          </div>
          {/* Mobile coin selector button */}
          <button
            onClick={() => setShowCoinSheet(true)}
            className="md:hidden flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.08] active:bg-white/[0.08] transition-colors"
          >
            <Menu className="w-4 h-4 text-white/50" />
            <span className="text-xs font-semibold text-white/80">{selectedSymbol.replace('USDT', '')}</span>
            <ChevronDown className="w-3.5 h-3.5 text-white/25" />
          </button>
        </div>
        <div className="flex items-center gap-2">
          {traderState && (
            <div className="hidden md:flex items-center gap-3 text-xs font-mono">
              <div className="flex items-center gap-1.5">
                <span className="text-white/25">Баланс</span>
                <span className={cn('font-bold', strategy?.color ?? 'text-white')}>${traderState.balance.toFixed(2)}</span>
              </div>
              {totalClosedPnl !== 0 && (
                <div className="flex items-center gap-1.5">
                  <span className="text-white/25">PnL</span>
                  <span className={cn('font-bold', totalClosedPnl >= 0 ? 'text-green-400' : 'text-red-400')}>
                    {totalClosedPnl >= 0 ? '+' : ''}${totalClosedPnl.toFixed(2)}
                  </span>
                  <span className={cn('text-[10px]', totalClosedPnl >= 0 ? 'text-green-400/60' : 'text-red-400/60')}>
                    ({totalClosedPnl >= 0 ? '+' : ''}{totalClosedPnl.toFixed(1)}%)
                  </span>
                </div>
              )}
              {traderState.debt_to_repay > 0 && (
                <div className="flex items-center gap-1.5">
                  <span className="text-white/25">Долг</span>
                  <span className="text-red-400 font-medium">${traderState.debt_to_repay.toFixed(2)}</span>
                </div>
              )}
            </div>
          )}
          <div className="w-px h-5 bg-white/[0.06] hidden sm:block" />
          <button
            onClick={() => setShowReport(true)}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border transition-all duration-200',
              strategy?.bgColor ?? 'bg-amber-500/10', strategy?.borderColor ?? 'border-amber-500/20',
              strategy?.color ?? 'text-amber-400/80',
            )}
            title={`Отчёт: ${strategy?.name ?? ''}`}
          >
            <BarChart3 className="w-3.5 h-3.5" />
            <span className="text-[10px] font-medium tracking-wide hidden sm:inline">ОТЧЁТ</span>
          </button>
          <button
            onClick={() => setShowAdminPanel(true)}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border transition-all duration-200',
              'bg-emerald-500/10 border-emerald-500/20 text-emerald-400/80',
              'hover:bg-emerald-500/20 hover:border-emerald-500/30',
            )}
            title="Админ-панель"
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span className="text-[10px] font-medium tracking-wide hidden sm:inline">АДМИН</span>
          </button>
        </div>
      </header>

      {/* Strategy Selector — compact tabs */}
      <div className="shrink-0 px-3 sm:px-4 py-2 border-b border-white/[0.06] bg-[#0d0d14]/80 flex sm:grid sm:grid-cols-3 gap-1.5 sm:gap-2 overflow-x-auto no-scrollbar" style={{ scrollbarWidth: 'none' }}>
        {STRATEGIES.map(s => {
          const ss = strategyStates[s.id];
          const balance = ss?.traderState?.balance ?? 0;
          const openCount = ss?.openTrades?.length ?? 0;
          const isActive = activeStrategy === s.id;
          return (
            <button
              key={s.id}
              onClick={() => setActiveStrategy(s.id)}
              className={cn(
                'min-w-[150px] sm:min-w-0 w-full rounded-lg px-3 py-2 text-left transition-all duration-200 flex items-center gap-3',
                isActive
                  ? `${s.bgColor} ${s.borderColor}`
                  : 'border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] hover:border-white/[0.10]',
              )}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={cn('text-xs font-semibold truncate', isActive ? s.color : 'text-white/40')}>{s.name}</span>
                  {openCount > 0 && (
                    <span className="text-[9px] font-mono text-yellow-400/70 bg-yellow-500/10 px-1.5 py-px rounded-full shrink-0">
                      {openCount}
                    </span>
                  )}
                </div>
                <span className={cn('text-[10px] font-mono mt-0.5 block', isActive ? 'text-white/50' : 'text-white/20')}>
                  ${balance.toFixed(2)}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {/* Row: Coin List (sidebar) + Center + Right Panel */}
        <div className="flex-1 flex min-h-0 overflow-hidden">
          {/* Left Panel — hidden on mobile/tablet */}
          <aside className="w-40 lg:w-52 shrink-0 overflow-hidden hidden md:block">
            <CoinList />
          </aside>

          {/* Center — Chart + Order Book + Trades Table */}
          <main className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {/* Chart + Order Book Row */}
          <div className="h-[45dvh] sm:h-[50dvh] md:h-[55dvh] lg:flex-1 flex min-h-0 shrink-0">
            {/* Chart Area */}
            <div className="flex-1 relative min-h-0 overflow-hidden" id="chart-area">
              {chartLoading && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#0d0d14]/60 backdrop-blur-sm">
                  <div className="flex items-center gap-2 text-xs text-white/50">
                    <div className="w-3 h-3 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
                    Загрузка графика...
                  </div>
                </div>
              )}

              {/* Top bar: Symbol + Timeframes + Indicators */}
              <div className="absolute top-2 sm:top-3 left-2 sm:left-3 z-10 flex items-center gap-1 flex-wrap max-w-[calc(100%-1.5rem)] sm:max-w-[calc(100%-2rem)]">
                <div className="px-2.5 py-1 rounded-lg bg-[#12121e]/90 backdrop-blur-md border border-white/[0.08] mr-1 shrink-0">
                  <span className="text-sm font-semibold text-white">{selectedSymbol.replace('USDT', '')}</span>
                  <span className="text-xs text-white/40 ml-1.5">/USDT</span>
                </div>
                {TIMEFRAMES.map((tf) => (
                  <button
                    key={tf.interval}
                    onClick={() => setTimeframe(tf)}
                    className={cn(
                      'px-2.5 py-1 rounded-lg text-xs font-mono font-medium transition-all duration-200 border shrink-0',
                      timeframe.interval === tf.interval
                        ? 'bg-white/[0.08] text-white border-white/[0.12]'
                        : 'bg-[#12121e]/70 text-white/30 border-white/[0.04] hover:bg-white/[0.04] hover:text-white/50',
                    )}
                  >
                    {tf.label}
                  </button>
                ))}
                {/* Separator — hidden on mobile */}
                <div className="w-px h-4 bg-white/10 mx-0.5 shrink-0 hidden sm:block" />
                {/* Strategy name badge */}
                {strategy && (
                  <div className={cn('px-1.5 py-1 rounded-md text-[9px] font-mono font-bold border shrink-0', strategy.bgColor, strategy.borderColor, strategy.color)}>
                    {strategy.name}
                  </div>
                )}
                {/* Indicator toggles */}
                {Object.entries(indicators).filter(([, cfg]) => {
                  if (!strategy) return true;
                  return strategy.chartIndicators[cfg.id] !== undefined;
                }).map(([key, ind]) => (
                  <button
                    key={ind.id}
                    onClick={() => toggleIndicator(ind.id)}
                    className={cn(
                      'hidden sm:block px-1.5 py-1 rounded-md text-[10px] font-mono font-medium border transition-all duration-200 shrink-0',
                      ind.visible
                        ? 'border-white/20 bg-white/10 text-white/80'
                        : 'border-white/5 bg-white/[0.02] text-white/20 hover:text-white/40',
                    )}
                  >
                    <span className="inline-block w-1.5 h-1.5 rounded-full mr-1 align-middle" style={{ backgroundColor: ind.visible ? ind.color : 'rgba(255,255,255,0.12)' }} />
                    {ind.label}
                  </button>
                ))}
              </div>

              <TradingChart data={candles} symbol={selectedSymbol} timeframe={timeframe} openTrades={openTrades} recentTrades={recentTrades} indicators={indicators} />

              {/* Draggable trade info — desktop only (not touch-friendly) */}
              <div className="hidden md:block">
                <DraggableTradePanel focusedTradeId={focusedTradeId} symbol={selectedSymbol} onClose={() => setFocusedTradeId(null)} />
              </div>
            </div>

            {/* Order Book — desktop only */}
            <div className="w-56 xl:w-64 2xl:w-72 shrink-0 border-l border-white/[0.06] hidden lg:block">
              <OrderBook key={selectedSymbol} />
            </div>
          </div>

          {/* Bottom Trades Table */}
          <div className="border-t border-white/[0.06] bg-[#0d0d14] lg:h-44 xl:h-52 shrink-0 overflow-x-auto overflow-y-auto custom-scrollbar" style={{ maxHeight: '25dvh' }}>
            <TradesTable openTrades={openTrades} recentTrades={recentTrades} totalClosedPnl={totalClosedPnl} closedTradeCount={closedTradeCount} coins={coins} onSelectTrade={(trade) => {
              setSelectedSymbol(trade.symbol);
              setFocusedTradeId(trade.id);
            }} />
          </div>
          {/* Dashboard + Controls — tablet view */}
          <div className="xl:hidden lg:block border-t border-white/[0.06] overflow-y-auto max-h-[30dvh]">
            <div className="p-3">
              <TradingDashboard />
            </div>
            <ActivityLog />
            <div className="border-t border-white/[0.06]">
              <ControlPanel />
            </div>
          </div>
          {/* Mobile-only bottom control bar */}
          <div className="lg:hidden border-t border-white/[0.06] bg-[#0d0d14] px-4 py-2.5 flex items-center justify-between gap-3 safe-bottom shrink-0">
            <div className="flex items-center gap-2.5">
              <div className={cn('w-2 h-2 rounded-full shrink-0', autoTrading ? 'bg-emerald-400 animate-pulse shadow-sm shadow-emerald-400/30' : 'bg-white/20')} />
              <span className="text-xs font-mono text-white/60">
                {traderState ? `$${traderState.balance.toFixed(0)}` : '---'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowMobilePanel('dashboard')}
                className="h-10 px-3 rounded-lg bg-white/[0.04] border border-white/[0.08] text-[10px] text-white/50 active:bg-white/[0.08] transition-colors"
              >Аналитика</button>
              <button
                onClick={() => setShowMobilePanel('control')}
                className="h-10 px-3 rounded-lg bg-white/[0.04] border border-white/[0.08] text-[10px] text-white/50 active:bg-white/[0.08] transition-colors"
              >Управление</button>
              <button
                onClick={() => setAutoTrading(!autoTrading)}
                className={cn(
                  'h-10 px-4 rounded-lg text-xs font-semibold transition-all duration-200',
                  autoTrading
                    ? 'bg-emerald-600 text-white shadow-sm shadow-emerald-600/20'
                    : 'bg-white/[0.04] border border-white/[0.08] text-white/50',
                )}
              >{autoTrading ? '● LIVE' : 'СТАРТ'}</button>
            </div>
          </div>
        </main>

        {/* Right Panel */}
        <aside className="w-64 xl:w-72 2xl:w-80 shrink-0 overflow-y-auto border-l border-white/[0.06] hidden xl:block">
          <div className="p-3">
            <TradingDashboard />
          </div>
          <ActivityLog />
          <div className="border-t border-white/[0.06]">
            <ControlPanel />
          </div>
        </aside>
        </div>

        {/* Mobile Coin List Sheet */}
        <CoinListSheet open={showCoinSheet} onClose={() => setShowCoinSheet(false)} />

        {/* Mobile Dashboard Sheet */}
        <MobileSheet open={showMobilePanel === 'dashboard'} onClose={() => setShowMobilePanel(null)}>
          <div className="p-3"><TradingDashboard /></div>
          <ActivityLog />
        </MobileSheet>

        {/* Mobile Control Sheet */}
        <MobileSheet open={showMobilePanel === 'control'} onClose={() => setShowMobilePanel(null)}>
          <div className="p-3"><ControlPanel /></div>
        </MobileSheet>

        {/* Strategy Report */}
        {showReport && <MomentumReport onClose={() => { setShowReport(false); setReportStrategyId(null); }} strategyId={reportStrategyId ?? activeStrategy} />}

        {/* Admin Panel */}
        <AdminPanel open={showAdminPanel} onClose={() => setShowAdminPanel(false)} />
      </div>
    </div>
  );
}

// ============================================================
// Generic Mobile Sheet
// ============================================================

function MobileSheet({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 lg:hidden animate-fade-in" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="absolute bottom-0 left-0 right-0 bg-[#0d0d14] border-t border-white/10 rounded-t-2xl flex flex-col animate-slide-up safe-bottom"
        style={{ height: '70vh', maxHeight: 'min(600px, 80dvh)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-end px-4 py-2 border-b border-white/5 shrink-0">
          <button
            onClick={onClose}
            className="p-2 -mr-2 text-white/40 hover:text-white/70 transition-colors rounded-lg active:bg-white/10"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto">
          {children}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Coin List Sheet (mobile bottom sheet)
// ============================================================

function CoinListSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 md:hidden animate-fade-in" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="absolute bottom-0 left-0 right-0 bg-[#0d0d14] border-t border-white/10 rounded-t-2xl flex flex-col animate-slide-up safe-bottom"
        style={{ height: '75vh', maxHeight: 'min(600px, 80dvh)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 shrink-0">
          <span className="text-sm font-semibold text-white/90">Выберите монету</span>
          <button
            onClick={onClose}
            className="p-2 -mr-2 text-white/40 hover:text-white/70 transition-colors rounded-lg active:bg-white/10"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-hidden">
          <CoinList />
        </div>
      </div>
    </div>
  );
}

// ============================================================
// TradesTable with live PnL and total PnL row
// ============================================================

function TradesTable({ openTrades, recentTrades, totalClosedPnl, closedTradeCount, coins, onSelectTrade }: {
  openTrades: Trade[]; recentTrades: Trade[]; totalClosedPnl?: number; closedTradeCount?: number; coins: Array<{ symbol: string; price: number }>;
  onSelectTrade: (trade: Trade) => void;
}) {
  const allTrades = useMemo(
    () => [...openTrades, ...recentTrades].slice(0, 30),
    [openTrades, recentTrades],
  );

  // Calculate total unrealized PnL for open trades
  const totalOpenPnl = useMemo(() => {
    let total = 0;
    for (const trade of openTrades) {
      if (trade.status !== 'open') continue;
      const livePrice = coins.find(c => c.symbol === trade.symbol)?.price;
      if (!livePrice || livePrice <= 0) continue;
      const isLong = trade.direction === 'long';
      const priceChange = isLong
        ? (livePrice - trade.entry_price) / trade.entry_price
        : (trade.entry_price - livePrice) / trade.entry_price;
      total += trade.amount * priceChange * trade.leverage;
    }
    return total;
  }, [openTrades, coins]);

  // Total realized PnL now comes from DB (totalClosedPnl prop) — no more computing from recentTrades

  if (allTrades.length === 0 && openTrades.length === 0) {
    return (
      <div className="h-24 flex items-center justify-center">
        <span className="text-xs text-white/20 font-mono">Нет сделок</span>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 overflow-x-auto overflow-y-auto">
        <table className="w-full text-xs min-w-[480px]">
          <thead className="sticky top-0 bg-[#0d0d14] z-10">
            <tr className="text-white/25 border-b border-white/[0.06]">
              <th className="text-left font-medium py-2.5 px-3 md:px-4">Символ</th>
              <th className="text-left font-medium py-2.5 px-2">Напр.</th>
              <th className="text-right font-medium py-2.5 px-2 hidden md:table-cell">Вход</th>
              <th className="text-right font-medium py-2.5 px-2 hidden lg:table-cell">Выход</th>
              <th className="text-right font-medium py-2.5 px-2 hidden lg:table-cell">Плечо</th>
              <th className="text-right font-medium py-2.5 px-2">PnL</th>
              <th className="text-center font-medium py-2.5 px-2">Открыта</th>
              <th className="text-center font-medium py-2.5 px-3">Статус</th>
            </tr>
          </thead>
          <tbody>
          {allTrades.map((trade) => {
            const isLong = trade.direction === 'long';
            const isOpen = trade.status === 'open';

            // Calculate live PnL for open trades
            let displayPnl = trade.pnl;
            if (isOpen) {
              const livePrice = coins.find(c => c.symbol === trade.symbol)?.price;
              if (livePrice && livePrice > 0) {
                const priceChange = isLong
                  ? (livePrice - trade.entry_price) / trade.entry_price
                  : (trade.entry_price - livePrice) / trade.entry_price;
                displayPnl = trade.amount * priceChange * trade.leverage;
              }
            }

            return (
              <tr
                key={trade.id}
                className="border-b border-white/[0.03] hover:bg-white/[0.04] transition-colors cursor-pointer"
                onClick={() => onSelectTrade(trade)}
              >
                <td className="py-2.5 px-3 md:px-4 font-mono text-white/80 font-semibold">
                  {trade.symbol.replace('USDT', '')}
                </td>
                <td className="py-2.5 px-2">
                  <span className={cn('font-mono font-bold text-[11px]', isLong ? 'text-green-400' : 'text-red-400')}>
                    {isLong ? 'LONG' : 'SHORT'}
                  </span>
                </td>
                <td className="py-2.5 px-2 text-right font-mono text-white/50">
                  {typeof trade.entry_price === 'number'
                    ? trade.entry_price < 1 ? trade.entry_price.toPrecision(4) : trade.entry_price.toFixed(2)
                    : '—'}
                </td>
                <td className="py-2.5 px-2 text-right font-mono text-white/50">
                  {trade.exit_price != null && typeof trade.exit_price === 'number'
                    ? trade.exit_price < 1 ? trade.exit_price.toPrecision(4) : trade.exit_price.toFixed(2)
                    : '—'}
                </td>
                <td className="py-2.5 px-2 text-right font-mono text-white/40">{trade.leverage ?? '—'}x</td>
                <td className={cn('py-2.5 px-2 text-right font-mono font-bold', displayPnl == null ? 'text-white/25' : displayPnl >= 0 ? 'text-green-400' : 'text-red-400')}>
                  {displayPnl != null && typeof displayPnl === 'number'
                    ? `${displayPnl >= 0 ? '+' : ''}$${displayPnl.toFixed(2)}`
                    : '—'}
                </td>
                <td className="py-2.5 px-2 text-center font-mono text-white/20 text-[10px]">
                  {new Date(trade.opened_at).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </td>
                <td className="py-2.5 px-3 text-center">
                  <span className={cn('text-[10px] font-mono font-medium px-2 py-0.5 rounded-md', isOpen
                    ? 'bg-yellow-500/10 text-yellow-400/80 border border-yellow-500/20'
                    : 'bg-white/5 text-white/40 border border-white/10'
                  )}>
                    {isOpen ? 'ОТКР' : 'ЗАКР'}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
      {/* Summary footer */}
      <div className="shrink-0 border-t border-white/[0.06] bg-[#0d0d14] px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-2 md:gap-3 min-w-0">
          {openTrades.length > 0 && (
            <span className="text-[10px] text-white/25 font-mono">
              Открыто: {openTrades.length}
            </span>
          )}
          <span className={cn('text-[10px] font-mono font-medium', totalOpenPnl >= 0 ? 'text-green-400/60' : 'text-red-400/60')}>
            Нереализ.: {totalOpenPnl >= 0 ? '+' : ''}${totalOpenPnl.toFixed(2)}
          </span>
        </div>
        <span className={cn('text-[10px] font-mono font-semibold', (totalClosedPnl ?? 0) >= 0 ? 'text-green-400' : 'text-red-400')}>
          Реализ.: {(totalClosedPnl ?? 0) >= 0 ? '+' : ''}${(totalClosedPnl ?? 0).toFixed(2)}{closedTradeCount !== undefined ? ` (${closedTradeCount})` : ''}
        </span>
      </div>
    </div>
  );
}

// ============================================================
// Activity Log
// ============================================================

function ActivityLog() {
  const { activityLog } = useTerminalStore();
  if (activityLog.length === 0) return null;

  return (
    <div className="border-t border-white/[0.06] p-3 sm:p-4">
      <div className="text-[10px] uppercase tracking-widest text-white/25 font-medium mb-2.5 flex items-center gap-2">
        <div className={cn('w-1.5 h-1.5 rounded-full', activityLog[0]?.type === 'trade' ? 'bg-emerald-400 shadow-sm shadow-emerald-400/30' : activityLog[0]?.type === 'error' ? 'bg-red-400' : 'bg-white/20')} />
        Лог активности
      </div>
      <div className="max-h-32 overflow-y-auto space-y-1 pr-1 custom-scrollbar">
        {activityLog.map((entry, i) => (
          <div key={i} className="flex gap-2 text-xs font-mono">
            <span className="text-white/20 shrink-0">{entry.time}</span>
            <span className={
              entry.type === 'trade' ? 'text-emerald-400/60' :
              entry.type === 'error' ? 'text-red-400/60' :
              'text-white/25'
            }>
              {entry.message}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// Price formatter
// ============================================================

function fmtP(price: number): string {
  if (price >= 10000) return price.toFixed(1);
  if (price >= 100) return price.toFixed(2);
  if (price >= 1) return price.toFixed(3);
  if (price >= 0.01) return price.toFixed(5);
  return price.toFixed(7);
}

// ============================================================
// Draggable Trade Info Panel
// ============================================================

function DraggableTradePanel({ focusedTradeId, symbol, onClose }: { focusedTradeId: string | null; symbol: string; onClose?: () => void }) {
  const { openTrades, recentTrades, coins } = useTerminalStore();
  const panelRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; startLeft: number; startTop: number } | null>(null);
  const containerRef = useRef<HTMLElement | null>(null);
  const prevFocusedId = useRef(focusedTradeId);

  const [pos, setPos] = useState({ x: 8, y: 36 });
  const [isDragging, setIsDragging] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  // Reset dismissed state when a new trade is focused
  useEffect(() => {
    if (focusedTradeId && focusedTradeId !== prevFocusedId.current) {
      prevFocusedId.current = focusedTradeId;
      setDismissed(false);
    }
  }, [focusedTradeId]);

  // Get container ref
  useEffect(() => {
    containerRef.current = document.getElementById('chart-area');
  }, []);

  // Find the active trade — all hooks above early return
  const allTrades = useMemo(() => [...openTrades, ...recentTrades], [openTrades, recentTrades]);
  const trade = focusedTradeId ? allTrades.find(t => t.id === focusedTradeId) : null;
  const symbolTrades = openTrades.filter(t => t.symbol === symbol && t.status === 'open');
  const activeTrade = trade ?? (symbolTrades.length > 0 ? symbolTrades[0] : null);

  // Drag handlers (before early return)
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    dragRef.current = { startX: e.clientX, startY: e.clientY, startLeft: pos.x, startTop: pos.y };
  }, [pos]);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragRef.current || !containerRef.current) return;
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;

      const container = containerRef.current;
      const rect = container.getBoundingClientRect();
      const panelW = panelRef.current?.offsetWidth ?? 208;
      const panelH = panelRef.current?.offsetHeight ?? 200;

      const maxX = rect.width - panelW - 4;
      const maxY = rect.height - panelH - 4;
      const newX = Math.max(4, Math.min(maxX, dragRef.current.startLeft - dx));
      const newY = Math.max(4, Math.min(maxY, dragRef.current.startTop + dy));

      setPos({ x: newX, y: newY });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      dragRef.current = null;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  // Early return after all hooks
  if (!activeTrade || dismissed) return null;

  const isLong = activeTrade.direction === 'long';
  const isOpen = activeTrade.status === 'open';

  const coinData = coins.find(c => c.symbol === activeTrade.symbol);
  const livePrice = coinData?.price ?? (activeTrade.exit_price ?? activeTrade.entry_price ?? 0);

  let livePnl = 0;
  if (isOpen && livePrice > 0) {
    const priceChange = isLong
      ? (livePrice - activeTrade.entry_price) / activeTrade.entry_price
      : (activeTrade.entry_price - livePrice) / activeTrade.entry_price;
    livePnl = activeTrade.amount * priceChange * activeTrade.leverage;
  } else if (activeTrade.pnl != null) {
    livePnl = activeTrade.pnl;
  }

  const openTime = new Date(activeTrade.opened_at).getTime();
  const endTime = activeTrade.closed_at ? new Date(activeTrade.closed_at).getTime() : Date.now();
  const diffMin = Math.floor((endTime - openTime) / 60000);
  const hours = Math.floor(diffMin / 60);
  const mins = diffMin % 60;
  const durationStr = hours > 0 ? `${hours}ч ${mins}м` : `${mins}м`;

  let distTP = 0, distSL = 0;
  if (isOpen) {
    distTP = isLong
      ? ((activeTrade.take_profit ?? livePrice) - livePrice) / livePrice * 100
      : (livePrice - (activeTrade.take_profit ?? livePrice)) / livePrice * 100;
    distSL = isLong
      ? (livePrice - (activeTrade.stop_loss ?? livePrice)) / livePrice * 100
      : ((activeTrade.stop_loss ?? livePrice) - livePrice) / livePrice * 100;
  }

  return (
    <div
      ref={panelRef}
      className="absolute z-20 w-44 sm:w-52 bg-[#0d0d14]/95 backdrop-blur-md border border-white/10 rounded-lg overflow-hidden"
      style={{
        top: pos.y,
        right: pos.x,
        cursor: isDragging ? 'grabbing' : 'default',
        userSelect: isDragging ? 'none' : 'auto',
      }}
    >
      {/* Draggable header */}
      <div
        className="flex items-center justify-between px-3 py-2 border-b border-white/5 cursor-grab active:cursor-grabbing"
        onMouseDown={handleMouseDown}
      >
        <div className="flex items-center gap-2">
          <span className={cn('text-xs font-bold', isLong ? 'text-green-400' : 'text-red-400')}>
            {isLong ? '▲ LONG' : '▼ SHORT'}
          </span>
          <span className="text-xs font-semibold text-white">
            {activeTrade.symbol.replace('USDT', '')}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={cn('text-[10px] font-mono font-medium px-1.5 py-0.5 rounded-md', isOpen
            ? 'bg-yellow-500/10 text-yellow-400/80 border border-yellow-500/20'
            : 'bg-white/5 text-white/40 border border-white/10'
          )}>
            {isOpen ? 'ОТКР' : 'ЗАКР'}
          </span>
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => { setDismissed(true); onClose?.(); }}
              className="p-0.5 text-white/25 hover:text-white/50 transition-colors rounded"
            >
              <X className="w-3.5 h-3.5" />
            </button>
        </div>
        </div>

      {/* Content */}
      <div className="px-3 py-2 space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-white/25">PnL</span>
          <span className={cn('text-xs font-mono font-bold', livePnl >= 0 ? 'text-green-400' : 'text-red-400')}>
            {livePnl >= 0 ? '+' : ''}{livePnl.toFixed(2)}$
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-white/25">Текущая цена</span>
          <span className="text-[10px] font-mono text-white/50">${fmtP(livePrice)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-white/25">Вход</span>
          <span className="text-[10px] font-mono text-white/50">${fmtP(activeTrade.entry_price)}</span>
        </div>
        {isOpen && activeTrade.take_profit != null && (
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-green-400/50">TP ({distTP >= 0 ? '+' : ''}{distTP.toFixed(1)}%)</span>
            <span className="text-[10px] font-mono text-green-400/70">${fmtP(activeTrade.take_profit)}</span>
          </div>
        )}
        {isOpen && activeTrade.stop_loss != null && (
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-red-400/50">SL ({distSL <= 0 ? '' : '+'}{distSL.toFixed(1)}%)</span>
            <span className="text-[10px] font-mono text-red-400/70">${fmtP(activeTrade.stop_loss)}</span>
          </div>
        )}
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-white/25">Плечо / Объём</span>
          <span className="text-[10px] font-mono text-white/40">{activeTrade.leverage}x / ${activeTrade.amount.toFixed(1)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-white/25">Длительность</span>
          <span className="text-[10px] font-mono text-white/40">{durationStr}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-white/25">Открыта</span>
          <span className="text-[10px] font-mono text-white/20">{new Date(activeTrade.opened_at).toLocaleString('ru-RU', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' } as Intl.DateTimeFormatOptions)}</span>
        </div>
      </div>
    </div>
  );
}