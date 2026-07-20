'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import { useTerminalStore } from '@/lib/store';
import CoinList from '@/components/coin-list';
import TradingDashboard from '@/components/trading-dashboard';
import ControlPanel from '@/components/control-panel';
import OrderBook from '@/components/order-book';
import TradeDetailModal from '@/components/trade-detail-modal';
import type { CandleData, TraderState, Trade, IndicatorWeight, BacktestResult } from '@/lib/types';

// Dynamic import with ssr: false — lightweight-charts requires browser DOM APIs
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
  } = useTerminalStore();

  const [candles, setCandles] = useState<CandleData[]>([]);
  const [chartLoading, setChartLoading] = useState(false);
  const [timeframe, setTimeframe] = useState<Timeframe>(TIMEFRAMES[3]); // default 1H
  const [selectedTrade, setSelectedTrade] = useState<Trade | null>(null);
  const initDone = useRef(false);

  // Initialize app data
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

  useEffect(() => {
    initData();
  }, [initData]);

  // Fetch klines directly from Binance client-side (Vercel serverless blocks api.binance.com)
  const fetchCandles = useCallback(async (symbol: string, tf: Timeframe) => {
    setChartLoading(true);
    try {
      const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${tf.interval}&limit=${tf.limit}`);
      const raw = await res.json();
      if (Array.isArray(raw) && raw.length > 0) {
        const candles: CandleData[] = raw.map((k: (string | number)[]) => ({
          time: Math.floor(Number(k[0]) / 1000),
          open: parseFloat(String(k[1])),
          high: parseFloat(String(k[2])),
          low: parseFloat(String(k[3])),
          close: parseFloat(String(k[4])),
          volume: parseFloat(String(k[5])),
        }));
        setCandles(candles);
      }
    } catch (err) {
      console.error('Klines error:', err);
    } finally {
      setChartLoading(false);
    }
  }, []);

  // Re-fetch when symbol or timeframe changes
  useEffect(() => {
    setCandles([]);
    fetchCandles(selectedSymbol, timeframe);
  }, [selectedSymbol, timeframe, fetchCandles]);

  // Auto-refresh trades periodically
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch('/api/trader');
        const data = await res.json();
        if (data.state) setTraderState(data.state as TraderState);
        if (data.openTrades) setOpenTrades(data.openTrades as Trade[]);
        if (data.recentTrades) setRecentTrades(data.recentTrades as Trade[]);
      } catch {
        // silent
      }
    }, 15000);
    return () => clearInterval(interval);
  }, [setTraderState, setOpenTrades, setRecentTrades]);

  // Auto-trading loop: 30s cycle
  useEffect(() => {
    if (!autoTrading) return;

    let cancelled = false;
    const runCycle = async () => {
      try {
        // Step 1: Monitor open trades (check TP/SL)
        const monitorRes = await fetch('/api/trader', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'monitor-trades' }),
        });
        const monitorData = await monitorRes.json();

        if (cancelled) return;

        // Refresh state after monitoring
        const refreshRes = await fetch('/api/trader');
        const refreshData = await refreshRes.json();
        if (cancelled) return;
        if (refreshData.state) setTraderState(refreshData.state as TraderState);
        if (refreshData.openTrades) setOpenTrades(refreshData.openTrades as Trade[]);
        if (refreshData.recentTrades) setRecentTrades(refreshData.recentTrades as Trade[]);

        // Step 2: If no open trades (or < 3), find new signals
        const currentOpenTrades = refreshData.openTrades || [];
        if (currentOpenTrades.length < 3) {
          const autoRes = await fetch('/api/trader', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'auto-trade', timeframe: timeframe.interval }),
          });
          const autoData = await autoRes.json();
          if (cancelled) return;

          // Refresh again after auto-trade
          if (autoData.success) {
            const finalRes = await fetch('/api/trader');
            const finalData = await finalRes.json();
            if (cancelled) return;
            if (finalData.state) setTraderState(finalData.state as TraderState);
            if (finalData.openTrades) setOpenTrades(finalData.openTrades as Trade[]);
            if (finalData.recentTrades) setRecentTrades(finalData.recentTrades as Trade[]);
          }
        }
      } catch (err) {
        console.error('Auto-trading cycle error:', err);
      }
    };

    // Run immediately, then every 30 seconds
    runCycle();
    const interval = setInterval(runCycle, 30000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [autoTrading, timeframe.interval, setTraderState, setOpenTrades, setRecentTrades]);

  // Analyze on symbol change
  useEffect(() => {
    if (candles.length < 50) return;
    const analyze = async () => {
      try {
        const res = await fetch('/api/trader', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'analyze', symbol: selectedSymbol }),
        });
        const data = await res.json();
        if (data.decision) {
          setCurrentAnalysis(data.decision);
        }
      } catch {
        // silent
      }
    };
    const timeout = setTimeout(analyze, 500);
    return () => clearTimeout(timeout);
  }, [selectedSymbol, candles.length, setCurrentAnalysis]);

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
        {/* Left Panel — Coin List */}
        <aside className="w-52 shrink-0 overflow-hidden">
          <CoinList />
        </aside>

        {/* Center — Chart + Order Book + Trades Table */}
        <main className="flex-1 flex flex-col overflow-hidden">
          {/* Chart + Order Book Row */}
          <div className="flex-1 flex min-h-0">
            {/* Chart Area */}
            <div className="flex-1 relative min-h-0">
            {chartLoading && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#0d0d14]/60 backdrop-blur-sm">
                <div className="flex items-center gap-2 text-xs text-white/50">
                  <div className="w-3 h-3 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
                  Загрузка графика...
                </div>
              </div>
            )}
            {/* Timeframe Selector */}
            <div className="absolute top-3 left-3 z-10 flex items-center gap-1">
              <div className="px-2.5 py-1 rounded-md bg-[#1a1a2e]/90 backdrop-blur-sm border border-white/5 mr-1">
                <span className="text-sm font-semibold text-white/90">{selectedSymbol.replace('USDT', '')}</span>
                <span className="text-xs text-white/40 ml-1.5">/USDT</span>
              </div>
              {TIMEFRAMES.map((tf) => (
                <button
                  key={tf.interval}
                  onClick={() => setTimeframe(tf)}
                  className={`px-2 py-1 rounded-md text-[11px] font-mono font-medium transition-all duration-150 border
                    ${timeframe.interval === tf.interval
                      ? 'bg-white/10 text-white/90 border-white/15'
                      : 'bg-[#1a1a2e]/70 text-white/40 border-white/5 hover:bg-white/5 hover:text-white/60'
                    }`}
                >
                  {tf.label}
                </button>
              ))}
            </div>
            <TradingChart data={candles} symbol={selectedSymbol} timeframe={timeframe} openTrades={openTrades} />
            </div>

            {/* Order Book */}
            <div className="w-64 shrink-0 border-l border-white/5">
              <OrderBook key={selectedSymbol} />
            </div>
          </div>

          {/* Bottom Trades Table */}
          <div className="h-44 border-t border-white/5 bg-[#0d0d14] shrink-0 overflow-auto">
            <TradesTable openTrades={openTrades} recentTrades={recentTrades} onSelectTrade={setSelectedTrade} />
          </div>
        </main>

        {/* Trade Detail Modal */}
        <TradeDetailModal trade={selectedTrade} onClose={() => setSelectedTrade(null)} />

        {/* Right Panel — Dashboard + Controls */}
        <aside className="w-72 shrink-0 overflow-y-auto border-l border-white/5">
          <TradingDashboard />
          <div className="border-t border-white/5">
            <ControlPanel />
          </div>
        </aside>
      </div>
    </div>
  );
}

function TradesTable({ openTrades, recentTrades, onSelectTrade }: { openTrades: Trade[]; recentTrades: Trade[]; onSelectTrade: (trade: Trade) => void }) {
  const allTrades = [...openTrades, ...recentTrades.filter(t => t.status === 'closed')].slice(0, 30);
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
            const pnl = trade.pnl;
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
                  pnl == null ? 'text-white/30' : pnl >= 0 ? 'text-green-400' : 'text-red-400'
                }`}>
                  {pnl != null && typeof pnl === 'number' ? `${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}` : '—'}
                </td>
                <td className="py-1.5 px-2 text-center">
                  <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${
                    trade.status === 'open'
                      ? 'bg-yellow-500/10 text-yellow-400/80 border border-yellow-500/20'
                      : 'bg-white/5 text-white/40 border border-white/10'
                  }`}>
                    {trade.status === 'open' ? 'OPEN' : 'CLOSED'}
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