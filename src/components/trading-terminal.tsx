'use client';

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { useTerminalStore } from '@/lib/store';
import { STRATEGIES, getStrategy } from '@/lib/strategies';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from '@/components/ui/sheet';
import CoinList from '@/components/coin-list';
import TradingDashboard from '@/components/trading-dashboard';
import ControlPanel from '@/components/control-panel';
import OrderBook from '@/components/order-book';
import { DEFAULT_INDICATORS, type IndicatorConfig } from '@/components/chart';
import type { CandleData, TraderState, Trade, IndicatorWeight } from '@/lib/types';
import { List, BarChart3, LineChart, Settings, X } from 'lucide-react';

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
  } = useTerminalStore();

  const strategy = getStrategy(activeStrategy);
  const isMobile = useIsMobile();
  const [mobileTab, setMobileTab] = useState<'chart' | 'trades' | 'dashboard' | 'control'>('chart');
  const [coinSheetOpen, setCoinSheetOpen] = useState(false);

  const [candles, setCandles] = useState<CandleData[]>([]);
  const [chartLoading, setChartLoading] = useState(false);
  const [timeframe, setTimeframe] = useState<Timeframe>(TIMEFRAMES[3]);
  const [focusedTradeId, setFocusedTradeId] = useState<string | null>(null);

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
  const lastCandleHourRef = useRef(0); // Tracks last 1H candle boundary for SL/TP checks
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
  }, [setWeights, setStrategyTraderState, setStrategyOpenTrades, setStrategyRecentTrades]);

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
      } catch { /* silent */ }
    }, 15000);
    return () => clearInterval(interval);
  }, [setTraderState, setOpenTrades, setRecentTrades, activeStrategy]);

  // Auto-trading loop — runs for ALL strategies in parallel
  useEffect(() => {
    if (!autoTrading) return;
    let cancelled = false;

    const runCycle = async () => {
      if (cancelled) return;
      try {
        const { runAutoTradeCycle } = await import('@/lib/client-trader');

        // Run cycle for all strategies in parallel
        const results = await Promise.all(
          STRATEGIES.map(async (s) => {
            const ss = strategyStates[s.id];
            const sOpenTrades = ss?.openTrades ?? [];
            const sTraderState = ss?.traderState;
            const balance = sTraderState?.balance ?? 100;
            const sRecentTrades = ss?.recentTrades ?? [];
            const recentPnl24h = sRecentTrades
              .filter((t: { closed_at: string | null; pnl: number | null }) => t.closed_at && new Date(t.closed_at).getTime() > Date.now() - 86400000)
              .reduce((sum: number, t: { pnl: number | null }) => sum + (t.pnl || 0), 0);

            try {
              const result = await runAutoTradeCycle(sOpenTrades, s.id, timeframe.interval, balance, lastCandleHourRef.current, recentPnl24h);
              // Update candle hour ref if a new candle was detected
              if (result.newCandleHour > lastCandleHourRef.current) {
                lastCandleHourRef.current = result.newCandleHour;
              }
              return { strategyId: s.id, result };
            } catch (err) {
              return { strategyId: s.id, result: { message: `Error: ${err instanceof Error ? err.message : 'unknown'}`, action: 'idle' as const, closedTrades: [], trailingUpdates: [] } };
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

          // Open new trades (secure + runner pair)
          if (r.newTrades && r.newTrades.length > 0) {
            for (const nt of r.newTrades) {
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
                  addLog(`[${getStrategy(strategyId)?.name ?? strategyId}] ${nt.label === 'secure' ? '🔒 Secure' : '🚀 Runner'} ${nt.direction.toUpperCase()} ${nt.symbol.replace('USDT', '')} @ $${nt.price.toFixed(2)} | ${nt.leverage}x | $${nt.amount.toFixed(2)}`, 'trade');
                } else {
                  addLog(`[${getStrategy(strategyId)?.name ?? strategyId}] Ошибка ${nt.label}: ${openData.error || 'unknown'}`, 'error');
                }
              } catch (err) {
                addLog(`[${getStrategy(strategyId)?.name ?? strategyId}] Ошибка сети: ${err instanceof Error ? err.message : 'unknown'}`, 'error');
              }
            }
          }

          // Refresh this strategy's state
          try {
            const res = await fetch(`/api/trader?strategyId=${strategyId}`);
            const data = await res.json();
            if (data.state) setStrategyTraderState(strategyId, data.state as TraderState);
            if (data.openTrades) setStrategyOpenTrades(strategyId, data.openTrades as Trade[]);
            if (data.recentTrades) setStrategyRecentTrades(strategyId, data.recentTrades as Trade[]);
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
  }, [autoTrading, timeframe.interval, setTraderState, setOpenTrades, setRecentTrades, addLog, strategyStates, setStrategyTraderState, setStrategyOpenTrades, setStrategyRecentTrades]);

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
      {/* ===== HEADER ===== */}
      <header className="h-10 flex items-center justify-between px-3 md:px-4 border-b border-white/5 bg-[#0d0d14]/90 backdrop-blur-sm shrink-0 z-20">
        <div className="flex items-center gap-2 md:gap-3 min-w-0">
          {/* Mobile: Coin list trigger */}
          {isMobile && (
            <Sheet open={coinSheetOpen} onOpenChange={setCoinSheetOpen}>
              <SheetTrigger asChild>
                <button className="shrink-0 p-1.5 rounded-md hover:bg-white/10 active:bg-white/15 transition-colors">
                  <List className="w-4 h-4 text-white/60" />
                </button>
              </SheetTrigger>
              <SheetContent side="left" className="w-72 p-0 bg-[#0d0d14] border-white/10">
                <SheetTitle className="sr-only">Список монет</SheetTitle>
                <CoinList />
              </SheetContent>
            </Sheet>
          )}
          <div className="flex items-center gap-2">
            <div className={cn('w-2 h-2 rounded-full shrink-0', autoTrading ? 'bg-green-400 animate-pulse' : 'bg-green-400/40')} />
            <span className="text-xs md:text-sm font-bold text-white/90 tracking-tight">ТРЕЙД-БОТ</span>
            {autoTrading && (
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-400 border border-green-500/25 animate-pulse hidden sm:inline-block">
                АВТО LIVE
              </span>
            )}
          </div>
          <div className="h-4 w-px bg-white/10 shrink-0" />
          <span className="text-xs text-white/40 font-mono truncate">
            {selectedSymbol.replace('USDT', '')}
            <span className="text-white/25">/USDT</span>
          </span>
        </div>
        <div className="flex items-center gap-2 md:gap-4 shrink-0">
          {traderState && (
            <div className="flex items-center gap-2 md:gap-4 text-xs font-mono">
              <div className="flex items-center gap-1">
                <span className="text-white/35 hidden sm:inline">Баланс</span>
                <span className={cn('font-bold text-[11px] md:text-xs', strategy?.color ?? 'text-white/90')}>${traderState.balance.toFixed(2)}</span>
              </div>
              {traderState.debt_to_repay > 0 && (
                <div className="hidden sm:flex items-center gap-1">
                  <span className="text-white/35">Долг</span>
                  <span className="text-red-400">${traderState.debt_to_repay.toFixed(2)}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </header>

      {/* ===== STRATEGY SELECTOR ===== */}
      <div className="shrink-0 px-2 md:px-3 py-1.5 border-b border-white/5 bg-[#0d0d14]/80">
        <div className="flex gap-1.5 md:gap-2 overflow-x-auto no-scrollbar">
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
                  'min-w-[140px] md:min-w-0 md:flex-1 rounded-lg border px-2.5 md:px-3 py-1.5 text-left transition-all duration-200 shrink-0',
                  isActive
                    ? `${s.borderColor} ${s.bgColor}`
                    : 'border-white/5 bg-white/[0.02] hover:bg-white/5',
                )}
              >
                <div className="flex items-center justify-between">
                  <div className={cn('text-[11px] md:text-xs font-semibold', isActive ? s.color : 'text-zinc-400')}>{s.name}</div>
                  {openCount > 0 && (
                    <span className="text-[9px] font-mono text-yellow-400/70 bg-yellow-500/10 px-1.5 py-0.5 rounded-full">
                      {openCount} откр.
                    </span>
                  )}
                </div>
                <div className={cn('text-[10px] mt-0.5 truncate', isActive ? 'text-zinc-400' : 'text-zinc-600')}>
                  {s.description.split('.')[0]}
                </div>
                <div className={cn('text-[10px] mt-0.5 font-mono', isActive ? 'text-zinc-300' : 'text-zinc-600')}>
                  ${balance.toFixed(2)}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ===== MOBILE LAYOUT ===== */}
      {isMobile && (
        <>
          <div className="flex-1 min-h-0 overflow-hidden relative">
            {/* Chart Tab */}
            {mobileTab === 'chart' && (
              <div className="absolute inset-0 flex flex-col">
                <div className="flex-1 relative min-h-0 overflow-hidden" id="chart-area">
                  {chartLoading && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#0d0d14]/60 backdrop-blur-sm">
                      <div className="flex items-center gap-2 text-xs text-white/50">
                        <div className="w-3 h-3 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
                        Загрузка графика...
                      </div>
                    </div>
                  )}
                  {/* Compact mobile top bar */}
                  <div className="absolute top-2 left-2 right-2 z-10 flex items-center gap-1 flex-wrap">
                    {TIMEFRAMES.map((tf) => (
                      <button
                        key={tf.interval}
                        onClick={() => setTimeframe(tf)}
                        className={cn(
                          'px-2 py-0.5 rounded text-[10px] font-mono font-medium transition-all border shrink-0',
                          timeframe.interval === tf.interval
                            ? 'bg-white/10 text-white/90 border-white/15'
                            : 'bg-[#1a1a2e]/70 text-white/40 border-white/5',
                        )}
                      >
                        {tf.label}
                      </button>
                    ))}
                    {strategy && (
                      <div className={cn('px-1.5 py-0.5 rounded text-[9px] font-mono font-bold border shrink-0 ml-auto', strategy.bgColor, strategy.borderColor, strategy.color)}>
                        {strategy.name}
                      </div>
                    )}
                  </div>
                  <TradingChart data={candles} symbol={selectedSymbol} timeframe={timeframe} openTrades={openTrades} recentTrades={recentTrades} indicators={indicators} />
                </div>
              </div>
            )}
            {/* Trades Tab */}
            {mobileTab === 'trades' && (
              <div className="absolute inset-0 overflow-auto bg-[#0d0d14]">
                <MobileTradesList openTrades={openTrades} recentTrades={recentTrades} coins={coins} onSelectTrade={(trade) => {
                  setSelectedSymbol(trade.symbol);
                  setFocusedTradeId(trade.id);
                  setMobileTab('chart');
                }} />
              </div>
            )}
            {/* Dashboard Tab */}
            {mobileTab === 'dashboard' && (
              <div className="absolute inset-0 overflow-y-auto bg-[#0a0a0f]">
                <TradingDashboard />
                <ActivityLog />
              </div>
            )}
            {/* Control Tab */}
            {mobileTab === 'control' && (
              <div className="absolute inset-0 overflow-y-auto bg-[#0a0a0f]">
                <ControlPanel />
              </div>
            )}
          </div>

          {/* Bottom Tab Bar */}
          <nav className="shrink-0 h-12 bg-[#0d0d14] border-t border-white/10 flex items-center justify-around px-2 z-20">
            {([
              { key: 'chart' as const, icon: BarChart3, label: 'График' },
              { key: 'trades' as const, icon: LineChart, label: 'Сделки' },
              { key: 'dashboard' as const, icon: BarChart3, label: 'Аналитика' },
              { key: 'control' as const, icon: Settings, label: 'Управление' },
            ]).map(({ key, icon: Icon, label }) => (
              <button
                key={key}
                onClick={() => setMobileTab(key)}
                className={cn(
                  'flex flex-col items-center justify-center gap-0.5 py-1 px-3 rounded-lg transition-colors min-w-[60px]',
                  mobileTab === key ? 'text-white' : 'text-white/35 hover:text-white/50',
                )}
              >
                <Icon className="w-4 h-4" />
                <span className="text-[9px] font-medium">{label}</span>
                {mobileTab === key && <div className="w-1 h-1 rounded-full bg-green-400" />}
              </button>
            ))}
          </nav>
        </>
      )}

      {/* ===== DESKTOP/TABLET LAYOUT ===== */}
      {!isMobile && (
        <div className="flex-1 flex overflow-hidden">
          {/* Left Panel — Coin List */}
          <aside className="w-52 shrink-0 overflow-hidden">
            <CoinList />
          </aside>

          {/* Center — Chart + Order Book + Trades Table */}
          <main className="flex-1 flex flex-col overflow-hidden">
            {/* Chart + Order Book Row */}
            <div className="flex-1 flex min-h-0">
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
                <div className="absolute top-3 left-3 z-10 flex items-center gap-1 flex-wrap max-w-[calc(100%-2rem)]">
                  <div className="px-2.5 py-1 rounded-md bg-[#1a1a2e]/90 backdrop-blur-sm border border-white/5 mr-1 shrink-0">
                    <span className="text-sm font-semibold text-white/90">{selectedSymbol.replace('USDT', '')}</span>
                    <span className="text-xs text-white/40 ml-1.5">/USDT</span>
                  </div>
                  {TIMEFRAMES.map((tf) => (
                    <button
                      key={tf.interval}
                      onClick={() => setTimeframe(tf)}
                      className={cn(
                        'px-2 py-1 rounded-md text-[11px] font-mono font-medium transition-all duration-150 border shrink-0',
                        timeframe.interval === tf.interval
                          ? 'bg-white/10 text-white/90 border-white/15'
                          : 'bg-[#1a1a2e]/70 text-white/40 border-white/5 hover:bg-white/5 hover:text-white/60',
                      )}
                    >
                      {tf.label}
                    </button>
                  ))}
                  {/* Separator */}
                  <div className="w-px h-4 bg-white/10 mx-0.5 shrink-0" />
                  {/* Strategy name badge */}
                  {strategy && (
                    <div className={cn('px-1.5 py-1 rounded-md text-[9px] font-mono font-bold border shrink-0', strategy.bgColor, strategy.borderColor, strategy.color)}>
                      {strategy.name}
                    </div>
                  )}
                  {/* Indicator toggles — only show indicators defined in the strategy */}
                  {Object.entries(indicators).filter(([, cfg]) => {
                    if (!strategy) return true;
                    return strategy.chartIndicators[cfg.id] !== undefined;
                  }).map(([key, ind]) => (
                    <button
                      key={ind.id}
                      onClick={() => toggleIndicator(ind.id)}
                      className={cn(
                        'px-1.5 py-1 rounded-md text-[9px] font-mono font-medium border transition-all duration-150 shrink-0',
                        ind.visible
                          ? 'border-white/20 bg-white/10 text-white/80'
                          : 'border-white/5 bg-white/[0.02] text-white/25 hover:text-white/40',
                      )}
                    >
                      <span className="inline-block w-1.5 h-1.5 rounded-full mr-1 align-middle" style={{ backgroundColor: ind.visible ? ind.color : 'rgba(255,255,255,0.15)' }} />
                      {ind.label}
                    </button>
                  ))}
                </div>

                <TradingChart data={candles} symbol={selectedSymbol} timeframe={timeframe} openTrades={openTrades} recentTrades={recentTrades} indicators={indicators} />

                {/* Draggable inline trade info panel */}
                <DraggableTradePanel focusedTradeId={focusedTradeId} symbol={selectedSymbol} />
              </div>

              {/* Order Book — hidden on smaller tablets */}
              <div className="w-64 shrink-0 border-l border-white/5 hidden xl:block">
                <OrderBook key={selectedSymbol} />
              </div>
            </div>

            {/* Bottom Trades Table */}
            <div className="h-44 border-t border-white/5 bg-[#0d0d14] shrink-0 overflow-auto">
              <TradesTable openTrades={openTrades} recentTrades={recentTrades} coins={coins} onSelectTrade={(trade) => {
                setSelectedSymbol(trade.symbol);
                setFocusedTradeId(trade.id);
              }} />
            </div>
          </main>

          {/* Right Panel — Dashboard + Activity + Controls */}
          <aside className="w-72 shrink-0 overflow-y-auto border-l border-white/5">
            <TradingDashboard />
            <ActivityLog />
            <div className="border-t border-white/5">
              <ControlPanel />
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Mobile Trade Cards
// ============================================================

function MobileTradesList({ openTrades, recentTrades, coins, onSelectTrade }: {
  openTrades: Trade[]; recentTrades: Trade[]; coins: Array<{ symbol: string; price: number }>;
  onSelectTrade: (trade: Trade) => void;
}) {
  const allTrades = useMemo(
    () => [...openTrades, ...recentTrades.filter(t => t.status === 'closed')].slice(0, 50),
    [openTrades, recentTrades],
  );

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

  const totalRealizedPnl = useMemo(() => {
    return recentTrades
      .filter(t => t.status === 'closed' && t.pnl !== null)
      .reduce((sum, t) => sum + (t.pnl ?? 0), 0);
  }, [recentTrades]);

  if (allTrades.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <span className="text-sm text-white/25">Нет сделок</span>
      </div>
    );
  }

  return (
    <div className="p-3 space-y-2">
      {/* Summary */
      <div className="flex items-center justify-between px-1 py-2">
        <div className="flex items-center gap-3">
          {openTrades.length > 0 && (
            <span className="text-xs text-white/40 font-mono">Открыто: {openTrades.length}</span>
          )}
          <span className={cn('text-xs font-mono', totalOpenPnl >= 0 ? 'text-green-400/70' : 'text-red-400/70')}>
            Нереализ.: {totalOpenPnl >= 0 ? '+' : ''}${totalOpenPnl.toFixed(2)}
          </span>
        </div>
        <span className={cn('text-xs font-mono font-semibold', totalRealizedPnl >= 0 ? 'text-green-400' : 'text-red-400')}>
          Реализ.: {totalRealizedPnl >= 0 ? '+' : ''}${totalRealizedPnl.toFixed(2)}
        </span>
      </div>

      {/* Trade Cards */
      {allTrades.map((trade) => {
        const isLong = trade.direction === 'long';
        const isOpen = trade.status === 'open';
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
          <button
            key={trade.id}
            onClick={() => onSelectTrade(trade)}
            className="w-full text-left rounded-xl border border-white/5 bg-white/[0.02] p-3 active:bg-white/5 transition-colors"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className={cn('text-xs font-bold', isLong ? 'text-green-400' : 'text-red-400')}>
                  {isLong ? '▲ LONG' : '▼ SHORT'}
                </span>
                <span className="text-sm font-semibold text-white/90">
                  {trade.symbol.replace('USDT', '')}
                </span>
                <span className={cn('text-[9px] font-mono px-1.5 py-0.5 rounded', isOpen
                  ? 'bg-yellow-500/10 text-yellow-400/80 border border-yellow-500/20'
                  : 'bg-white/5 text-white/40 border border-white/10'
                )}>
                  {isOpen ? 'ОТКР' : 'ЗАКР'}
                </span>
              </div>
              <span className={cn('text-sm font-mono font-bold',
                displayPnl == null ? 'text-white/30' : displayPnl >= 0 ? 'text-green-400' : 'text-red-400'
              )}>
                {displayPnl != null && typeof displayPnl === 'number'
                  ? `${displayPnl >= 0 ? '+' : ''}$${displayPnl.toFixed(2)}`
                  : '—'}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-[10px] font-mono">
              <div>
                <span className="text-white/30">Вход </span>
                <span className="text-white/60">
                  {typeof trade.entry_price === 'number'
                    ? trade.entry_price < 1 ? trade.entry_price.toPrecision(4) : trade.entry_price.toFixed(2)
                    : '—'}
                </span>
              </div>
              <div>
                <span className="text-white/30">Плечо </span>
                <span className="text-white/60">{trade.leverage ?? '—'}x</span>
              </div>
              <div>
                <span className="text-white/30">Объём </span>
                <span className="text-white/60">${typeof trade.amount === 'number' ? trade.amount.toFixed(1) : '—'}</span>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ============================================================
// TradesTable with live PnL and total PnL row
// ============================================================

function TradesTable({ openTrades, recentTrades, coins, onSelectTrade }: {
  openTrades: Trade[]; recentTrades: Trade[]; coins: Array<{ symbol: string; price: number }>;
  onSelectTrade: (trade: Trade) => void;
}) {
  const allTrades = useMemo(
    () => [...openTrades, ...recentTrades.filter(t => t.status === 'closed')].slice(0, 30),
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

  // Calculate total realized PnL from recent (closed) trades
  const totalRealizedPnl = useMemo(() => {
    return recentTrades
      .filter(t => t.status === 'closed' && t.pnl !== null)
      .reduce((sum, t) => sum + (t.pnl ?? 0), 0);
  }, [recentTrades]);

  if (allTrades.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <span className="text-xs text-white/25">Нет сделок</span>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 overflow-auto">
        <table className="w-full text-[11px]">
          <thead className="sticky top-0 bg-[#0d0d14] z-10">
            <tr className="text-white/35 border-b border-white/5">
              <th className="text-left font-medium py-2 px-3">Символ</th>
              <th className="text-left font-medium py-2 px-2">Напр.</th>
              <th className="text-right font-medium py-2 px-2">Вход</th>
              <th className="text-right font-medium py-2 px-2">Выход</th>
              <th className="text-right font-medium py-2 px-2">Плечо</th>
              <th className="text-right font-medium py-2 px-2">Объем</th>
              <th className="text-right font-medium py-2 px-2">PnL</th>
              <th className="text-center font-medium py-2 px-2">Статус</th>
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
                <td className="py-1.5 px-3 font-mono text-white/80 font-medium">
                  {trade.symbol.replace('USDT', '')}
                </td>
                <td className="py-1.5 px-2">
                  <span className={cn('font-mono font-bold', isLong ? 'text-green-400' : 'text-red-400')}>
                    {isLong ? 'LONG' : 'SHORT'}
                  </span>
                </td>
                <td className="py-1.5 px-2 text-right font-mono text-white/60">
                  {typeof trade.entry_price === 'number'
                    ? trade.entry_price < 1 ? trade.entry_price.toPrecision(4) : trade.entry_price.toFixed(2)
                    : '—'}
                </td>
                <td className="py-1.5 px-2 text-right font-mono text-white/60">
                  {trade.exit_price != null && typeof trade.exit_price === 'number'
                    ? trade.exit_price < 1 ? trade.exit_price.toPrecision(4) : trade.exit_price.toFixed(2)
                    : '—'}
                </td>
                <td className="py-1.5 px-2 text-right font-mono text-white/50">{trade.leverage ?? '—'}x</td>
                <td className="py-1.5 px-2 text-right font-mono text-white/60">${typeof trade.amount === 'number' ? trade.amount.toFixed(2) : '—'}</td>
                <td className={cn('py-1.5 px-2 text-right font-mono font-bold', displayPnl == null ? 'text-white/30' : displayPnl >= 0 ? 'text-green-400' : 'text-red-400')}>
                  {displayPnl != null && typeof displayPnl === 'number'
                    ? `${displayPnl >= 0 ? '+' : ''}$${displayPnl.toFixed(2)}`
                    : '—'}
                </td>
                <td className="py-1.5 px-2 text-center">
                  <span className={cn('text-[9px] font-mono px-1.5 py-0.5 rounded', isOpen
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
      <div className="shrink-0 border-t border-white/10 bg-[#0d0d14] px-3 py-1.5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {openTrades.length > 0 && (
            <span className="text-[10px] text-white/40 font-mono">
              Открыто: {openTrades.length}
            </span>
          )}
          <span className={cn('text-[10px] font-mono', totalOpenPnl >= 0 ? 'text-green-400/70' : 'text-red-400/70')}>
            Нереализ.: {totalOpenPnl >= 0 ? '+' : ''}${totalOpenPnl.toFixed(2)}
          </span>
        </div>
        <span className={cn('text-[10px] font-mono font-semibold', totalRealizedPnl >= 0 ? 'text-green-400' : 'text-red-400')}>
          Реализ.: {totalRealizedPnl >= 0 ? '+' : ''}${totalRealizedPnl.toFixed(2)}
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
    <div className="border-t border-white/5 p-3">
      <div className="text-xs uppercase tracking-wider text-white/40 font-medium mb-2 flex items-center gap-1.5">
        <div className={cn('w-1.5 h-1.5 rounded-full', activityLog[0]?.type === 'trade' ? 'bg-green-400' : activityLog[0]?.type === 'error' ? 'bg-red-400' : 'bg-white/30')} />
        Лог активности
      </div>
      <div className="max-h-40 overflow-y-auto space-y-0.5 pr-1 custom-scrollbar">
        {activityLog.map((entry, i) => (
          <div key={i} className="flex gap-2 text-[10px] font-mono">
            <span className="text-white/20 shrink-0">{entry.time}</span>
            <span className={
              entry.type === 'trade' ? 'text-green-400/80' :
              entry.type === 'error' ? 'text-red-400/80' :
              'text-white/40'
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

function DraggableTradePanel({ focusedTradeId, symbol }: { focusedTradeId: string | null; symbol: string }) {
  const { openTrades, recentTrades, coins } = useTerminalStore();
  const panelRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; startLeft: number; startTop: number } | null>(null);
  const containerRef = useRef<HTMLElement | null>(null);

  const [pos, setPos] = useState({ x: 8, y: 36 });
  const [isDragging, setIsDragging] = useState(false);

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
  if (!activeTrade) return null;

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
      className="absolute z-20 w-52 bg-[#0d0d14]/95 backdrop-blur-md border border-white/10 rounded-lg overflow-hidden"
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
          <span className="text-xs font-semibold text-white/90">
            {activeTrade.symbol.replace('USDT', '')}
          </span>
        </div>
        <span className={cn('text-[9px] font-mono px-1.5 py-0.5 rounded', isOpen
          ? 'bg-yellow-500/10 text-yellow-400/80 border border-yellow-500/20'
          : 'bg-white/5 text-white/40 border border-white/10'
        )}>
          {isOpen ? 'ОТКР' : 'ЗАКР'}
        </span>
      </div>

      {/* Content */}
      <div className="px-3 py-2 space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-white/40">PnL</span>
          <span className={cn('text-xs font-mono font-bold', livePnl >= 0 ? 'text-green-400' : 'text-red-400')}>
            {livePnl >= 0 ? '+' : ''}{livePnl.toFixed(2)}$
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-white/40">Текущая цена</span>
          <span className="text-[10px] font-mono text-white/70">${fmtP(livePrice)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-white/40">Вход</span>
          <span className="text-[10px] font-mono text-white/60">${fmtP(activeTrade.entry_price)}</span>
        </div>
        {isOpen && activeTrade.take_profit != null && (
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-green-400/60">TP ({distTP >= 0 ? '+' : ''}{distTP.toFixed(1)}%)</span>
            <span className="text-[10px] font-mono text-green-400/80">${fmtP(activeTrade.take_profit)}</span>
          </div>
        )}
        {isOpen && activeTrade.stop_loss != null && (
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-red-400/60">SL ({distSL <= 0 ? '' : '+'}{distSL.toFixed(1)}%)</span>
            <span className="text-[10px] font-mono text-red-400/80">${fmtP(activeTrade.stop_loss)}</span>
          </div>
        )}
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-white/40">Плечо / Объём</span>
          <span className="text-[10px] font-mono text-white/50">{activeTrade.leverage}x / ${activeTrade.amount.toFixed(1)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-white/40">Длительность</span>
          <span className="text-[10px] font-mono text-white/50">{durationStr}</span>
        </div>
      </div>
    </div>
  );
}