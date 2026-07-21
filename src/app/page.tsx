'use client';

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { useTerminalStore } from '@/lib/store';
import CoinList from '@/components/coin-list';
import TradingDashboard from '@/components/trading-dashboard';
import ControlPanel from '@/components/control-panel';
import OrderBook from '@/components/order-book';
import { DEFAULT_INDICATORS, type IndicatorConfig } from '@/components/chart';
import type { CandleData, TraderState, Trade, IndicatorWeight } from '@/lib/types';

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
  { label: '1H', interval: '1h', limit: 720 },
] as const;

export type Timeframe = (typeof TIMEFRAMES)[number];

export default function Home() {
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
  } = useTerminalStore();

  const [candles, setCandles] = useState<CandleData[]>([]);
  const [chartLoading, setChartLoading] = useState(false);
  const [timeframe, setTimeframe] = useState<Timeframe>(TIMEFRAMES[3]);
  const [focusedTradeId, setFocusedTradeId] = useState<string | null>(null);

  // Indicator state — lifted from chart
  const [indicators, setIndicators] = useState<Record<string, IndicatorConfig>>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('chart-indicators');
        if (saved) return { ...DEFAULT_INDICATORS, ...JSON.parse(saved) };
      } catch { /* ignore */ }
    }
    return { ...DEFAULT_INDICATORS };
  });

  const toggleIndicator = useCallback((id: string) => {
    setIndicators(prev => ({ ...prev, [id]: { ...prev[id], visible: !prev[id].visible } }));
  }, []);

  useEffect(() => {
    try { localStorage.setItem('chart-indicators', JSON.stringify(indicators)); } catch { /* ignore */ }
  }, [indicators]);

  const initDone = useRef(false);
  const weightsRef = useRef(weights);
  const openTradesRef = useRef(openTrades);
  weightsRef.current = weights;
  openTradesRef.current = openTrades;

  const initData = useCallback(async () => {
    if (initDone.current) return;
    initDone.current = true;
    try {
      const res = await fetch('/api/init');
      const data = await res.json();
      if (data.state) setTraderState(data.state as TraderState);
      if (data.weights) setWeights(data.weights as IndicatorWeight[]);
      if (data.openTrades) setOpenTrades(data.openTrades as Trade[]);
      if (data.recentTrades) setRecentTrades(data.recentTrades as Trade[]);
    } catch (err) {
      console.error('Init error:', err);
      initDone.current = false;
    }
  }, [setTraderState, setWeights, setOpenTrades, setRecentTrades]);

  useEffect(() => { initData(); }, [initData]);

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

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch('/api/trader');
        const data = await res.json();
        if (data.state) setTraderState(data.state as TraderState);
        if (data.openTrades) setOpenTrades(data.openTrades as Trade[]);
        if (data.recentTrades) setRecentTrades(data.recentTrades as Trade[]);
      } catch { /* silent */ }
    }, 15000);
    return () => clearInterval(interval);
  }, [setTraderState, setOpenTrades, setRecentTrades]);

  // Auto-trading loop
  useEffect(() => {
    if (!autoTrading) return;
    let cancelled = false;

    const runCycle = async () => {
      if (cancelled) return;
      try {
        const wMap: Record<string, number> = {};
        for (const w of weightsRef.current) wMap[w.indicator_name] = w.weight;
        const balance = traderState?.balance ?? 100;
        const { runAutoTradeCycle } = await import('@/lib/client-trader');
        const result = await runAutoTradeCycle(openTradesRef.current, wMap, timeframe.interval, balance);
        if (cancelled) return;
        console.log('[AutoTrade]', result.message);
        addLog(result.message, result.action === 'new-trade' ? 'trade' : 'info');

        for (const ct of result.closedTrades) {
          const closeRes = await fetch('/api/trader', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'close-trade', tradeId: ct.tradeId, exitPrice: ct.exitPrice }),
          });
          const closeData = await closeRes.json();
          if (closeData.success) {
            addLog(`Закрыта ${ct.symbol}: ${ct.reason} | PnL: ${ct.pnl >= 0 ? '+' : ''}$${ct.pnl.toFixed(2)}`, ct.pnl >= 0 ? 'trade' : 'error');
          }
        }

        if (result.newTrade) {
          const nt = result.newTrade;
          const openRes = await fetch('/api/trader', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'open-trade',
              symbol: nt.symbol, entryPrice: nt.price, amount: nt.amount,
              leverage: nt.leverage, direction: nt.direction,
              stopLoss: nt.stopLoss, takeProfit: nt.takeProfit,
            }),
          });
          const openData = await openRes.json();
          if (openData.success) {
            addLog(`Открыта ${nt.direction.toUpperCase()} ${nt.symbol.replace('USDT', '')} @ $${nt.price.toFixed(2)} | ${nt.leverage}x | $${nt.amount.toFixed(2)}`, 'trade');
          } else {
            addLog(`Ошибка открытия: ${openData.error || 'unknown'}`, 'error');
          }
        }

        const res = await fetch('/api/trader');
        const data = await res.json();
        if (cancelled) return;
        if (data.state) setTraderState(data.state as TraderState);
        if (data.openTrades) setOpenTrades(data.openTrades as Trade[]);
        if (data.recentTrades) setRecentTrades(data.recentTrades as Trade[]);
      } catch (err) {
        console.error('[AutoTrade] Cycle error:', err);
        addLog(`Ошибка цикла: ${err instanceof Error ? err.message : 'unknown'}`, 'error');
      }
    };

    addLog('Авто-трейдинг запущен', 'trade');
    runCycle();
    const interval = setInterval(runCycle, 30000);
    return () => {
      cancelled = true;
      clearInterval(interval);
      addLog('Авто-трейдинг остановлен', 'info');
    };
  }, [autoTrading, timeframe.interval, setTraderState, setOpenTrades, setRecentTrades, addLog, traderState?.balance]);

  // Analyze on symbol change
  useEffect(() => {
    if (candles.length < 50) return;
    let cancelled = false;
    const analyze = async () => {
      try {
        const wMap: Record<string, number> = {};
        for (const w of weightsRef.current) wMap[w.indicator_name] = w.weight;
        const { analyzeSymbol } = await import('@/lib/client-trader');
        const decision = await analyzeSymbol(selectedSymbol, timeframe.interval, timeframe.limit, wMap);
        if (!cancelled && decision) setCurrentAnalysis(decision);
      } catch { /* silent */ }
    };
    const timeout = setTimeout(analyze, 300);
    return () => { cancelled = true; clearTimeout(timeout); };
  }, [selectedSymbol, candles.length, timeframe, setCurrentAnalysis]);

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-[#0a0a0f]">
      {/* Top Bar */}
      <header className="h-10 flex items-center justify-between px-4 border-b border-white/5 bg-[#0d0d14]/90 backdrop-blur-sm shrink-0 z-20">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${autoTrading ? 'bg-green-400 animate-pulse' : 'bg-green-400/40'}`} />
            <span className="text-sm font-bold text-white/90 tracking-tight">TRADE BOT</span>
            {autoTrading && (
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-400 border border-green-500/25 animate-pulse">
                AUTO LIVE
              </span>
            )}
          </div>
          <div className="h-4 w-px bg-white/10" />
          <span className="text-xs text-white/40 font-mono">
            {selectedSymbol.replace('USDT', '')}
            <span className="text-white/25">/USDT</span>
          </span>
        </div>
        <div className="flex items-center gap-4">
          {traderState && (
            <div className="flex items-center gap-4 text-xs font-mono">
              <div className="flex items-center gap-1.5">
                <span className="text-white/35">Баланс</span>
                <span className="text-white/90 font-bold">${traderState.balance.toFixed(2)}</span>
              </div>
              {traderState.debt_to_repay > 0 && (
                <div className="flex items-center gap-1.5">
                  <span className="text-white/35">Долг</span>
                  <span className="text-red-400">${traderState.debt_to_repay.toFixed(2)}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel */}
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
                    className={`px-2 py-1 rounded-md text-[11px] font-mono font-medium transition-all duration-150 border shrink-0
                      ${timeframe.interval === tf.interval
                        ? 'bg-white/10 text-white/90 border-white/15'
                        : 'bg-[#1a1a2e]/70 text-white/40 border-white/5 hover:bg-white/5 hover:text-white/60'
                      }`}
                  >
                    {tf.label}
                  </button>
                ))}
                {/* Separator */}
                <div className="w-px h-4 bg-white/10 mx-0.5 shrink-0" />
                {/* Indicator toggles */}
                {Object.values(indicators).map(ind => (
                  <button
                    key={ind.id}
                    onClick={() => toggleIndicator(ind.id)}
                    className={`px-1.5 py-1 rounded-md text-[9px] font-mono font-medium border transition-all duration-150 shrink-0 ${
                      ind.visible
                        ? 'border-white/20 bg-white/10 text-white/80'
                        : 'border-white/5 bg-white/[0.02] text-white/25 hover:text-white/40'
                    }`}
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

            {/* Order Book */}
            <div className="w-64 shrink-0 border-l border-white/5">
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

        {/* Right Panel */}
        <aside className="w-72 shrink-0 overflow-y-auto border-l border-white/5">
          <TradingDashboard />
          <ActivityLog />
          <div className="border-t border-white/5">
            <ControlPanel />
          </div>
        </aside>
      </div>
    </div>
  );
}

// ============================================================
// TradesTable with live PnL
// ============================================================

function TradesTable({ openTrades, recentTrades, coins, onSelectTrade }: {
  openTrades: Trade[]; recentTrades: Trade[]; coins: Array<{ symbol: string; price: number }>;
  onSelectTrade: (trade: Trade) => void;
}) {
  const allTrades = useMemo(
    () => [...openTrades, ...recentTrades.filter(t => t.status === 'closed')].slice(0, 30),
    [openTrades, recentTrades],
  );

  if (allTrades.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <span className="text-xs text-white/25">Нет сделок</span>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
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
                  <span className={`font-mono font-bold ${isLong ? 'text-green-400' : 'text-red-400'}`}>
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
                <td className={`py-1.5 px-2 text-right font-mono font-bold ${
                  displayPnl == null ? 'text-white/30' : displayPnl >= 0 ? 'text-green-400' : 'text-red-400'
                }`}>
                  {displayPnl != null && typeof displayPnl === 'number'
                    ? `${displayPnl >= 0 ? '+' : ''}$${displayPnl.toFixed(2)}`
                    : '—'}
                </td>
                <td className="py-1.5 px-2 text-center">
                  <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${
                    isOpen
                      ? 'bg-yellow-500/10 text-yellow-400/80 border border-yellow-500/20'
                      : 'bg-white/5 text-white/40 border border-white/10'
                  }`}>
                    {isOpen ? 'OPEN' : 'CLOSED'}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
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
        <div className={`w-1.5 h-1.5 rounded-full ${activityLog[0]?.type === 'trade' ? 'bg-green-400' : activityLog[0]?.type === 'error' ? 'bg-red-400' : 'bg-white/30'}`} />
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
          <span className={`text-xs font-bold ${isLong ? 'text-green-400' : 'text-red-400'}`}>
            {isLong ? '▲ LONG' : '▼ SHORT'}
          </span>
          <span className="text-xs font-semibold text-white/90">
            {activeTrade.symbol.replace('USDT', '')}
          </span>
        </div>
        <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${
          isOpen
            ? 'bg-yellow-500/10 text-yellow-400/80 border border-yellow-500/20'
            : 'bg-white/5 text-white/40 border border-white/10'
        }`}>
          {isOpen ? 'OPEN' : 'CLOSED'}
        </span>
      </div>

      {/* Content */}
      <div className="px-3 py-2 space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-white/40">PnL</span>
          <span className={`text-xs font-mono font-bold ${livePnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
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