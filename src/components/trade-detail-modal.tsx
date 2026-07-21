'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import type { Trade, CandleData } from '@/lib/types';
import { X } from 'lucide-react';

interface TradeDetailModalProps {
  trade: Trade | null;
  onClose: () => void;
}

/** Adaptive price formatting */
function fmtPrice(price: number): string {
  if (price >= 10000) return price.toFixed(1);
  if (price >= 100) return price.toFixed(2);
  if (price >= 1) return price.toFixed(3);
  if (price >= 0.01) return price.toFixed(5);
  return price.toFixed(7);
}

function fmtMoney(price: number): string {
  return price >= 0 ? `+$${price.toFixed(2)}` : `-$${Math.abs(price).toFixed(2)}`;
}

function formatDuration(openedAt: string, closedAt: string | null): string {
  const start = new Date(openedAt).getTime();
  const end = closedAt ? new Date(closedAt).getTime() : Date.now();
  const diffMs = end - start;
  const hours = Math.floor(diffMs / 3600000);
  const mins = Math.floor((diffMs % 3600000) / 60000);
  if (hours > 24) {
    const days = Math.floor(hours / 24);
    const remH = hours % 24;
    return `${days}д ${remH}ч`;
  }
  if (hours > 0) return `${hours}ч ${mins}м`;
  return `${mins}м`;
}

/** Inner chart component — must be client-only (lightweight-charts) */
function TradeChart({ trade }: { trade: Trade }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);
  const candleSeriesRef = useRef<any>(null);
  const volumeSeriesRef = useRef<any>(null);
  const priceLinesRef = useRef<any[]>([]);
  const dataRef = useRef<CandleData[]>([]);
  const [loading, setLoading] = useState(true);

  const applyData = useCallback((candleSeries: any, volumeSeries: any, candles: CandleData[], chart: any) => {
    if (!candleSeries || !volumeSeries || candles.length === 0) return;
    const candleData = candles.map((d) => ({
      time: d.time as import('lightweight-charts').Time,
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
    }));
    const volumeData = candles.map((d) => ({
      time: d.time as import('lightweight-charts').Time,
      value: d.volume,
      color: d.close >= d.open ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)',
    }));
    candleSeries.setData(candleData);
    volumeSeries.setData(volumeData);
    chart?.timeScale()?.fitContent();
  }, []);

  // Fetch candle data from Binance
  useEffect(() => {
    let cancelled = false;
    const fetchData = async () => {
      try {
        const res = await fetch(
          `https://api.binance.com/api/v3/klines?symbol=${trade.symbol}&interval=1h&limit=1440`,
        );
        const raw = await res.json();
        if (cancelled || !Array.isArray(raw)) return;
        const candles: CandleData[] = raw.map((k: (string | number)[]) => ({
          time: Math.floor(Number(k[0]) / 1000),
          open: parseFloat(String(k[1])),
          high: parseFloat(String(k[2])),
          low: parseFloat(String(k[3])),
          close: parseFloat(String(k[4])),
          volume: parseFloat(String(k[5])),
        }));
        dataRef.current = candles;
        // If chart already exists, apply immediately
        if (candleSeriesRef.current && volumeSeriesRef.current && chartRef.current) {
          applyData(candleSeriesRef.current, volumeSeriesRef.current, candles, chartRef.current);
        }
      } catch (err) {
        console.error('[TradeChart] Failed to fetch candles:', err);
      }
    };
    fetchData();
    return () => { cancelled = true; };
  }, [trade.symbol, applyData]);

  // Create chart
  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    let cancelled = false;

    import('lightweight-charts').then(({ createChart, CandlestickSeries, HistogramSeries, ColorType }) => {
      if (cancelled || !container) return;
      const rect = container.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;

      const chart = createChart(container, {
        width: rect.width,
        height: rect.height,
        layout: {
          background: { type: ColorType.Solid, color: '#0a0a0f' },
          textColor: '#8a8a9a',
          fontFamily: 'Inter, sans-serif',
          fontSize: 11,
        },
        grid: {
          vertLines: { color: 'rgba(255,255,255,0.04)' },
          horzLines: { color: 'rgba(255,255,255,0.04)' },
        },
        crosshair: {
          mode: 0,
          vertLine: { color: 'rgba(255,255,255,0.2)', width: 1, style: 2, labelBackgroundColor: '#1e1e2e' },
          horzLine: { color: 'rgba(255,255,255,0.2)', width: 1, style: 2, labelBackgroundColor: '#1e1e2e' },
        },
        rightPriceScale: {
          borderColor: 'rgba(255,255,255,0.1)',
          scaleMargins: { top: 0.1, bottom: 0.25 },
        },
        timeScale: {
          borderColor: 'rgba(255,255,255,0.1)',
          timeVisible: true,
          secondsVisible: false,
        },
        handleScroll: true,
        handleScale: true,
        autoSize: true,
      });

      const candleSeries = chart.addSeries(CandlestickSeries, {
        upColor: '#22c55e',
        downColor: '#ef4444',
        borderUpColor: '#22c55e',
        borderDownColor: '#ef4444',
        wickUpColor: '#22c55e',
        wickDownColor: '#ef4444',
      });

      const volumeSeries = chart.addSeries(HistogramSeries, {
        priceFormat: { type: 'volume' },
        priceScaleId: 'volume',
      });
      chart.priceScale('volume').applyOptions({
        scaleMargins: { top: 0.8, bottom: 0 },
      });

      chartRef.current = chart;
      candleSeriesRef.current = candleSeries;
      volumeSeriesRef.current = volumeSeries;

      // Add price lines for the trade
      // Entry — white dashed
      if (trade.entry_price != null) {
        const line = candleSeries.createPriceLine({
          price: trade.entry_price,
          color: '#ffffff',
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
          title: `ENTRY $${fmtPrice(trade.entry_price)}`,
        });
        priceLinesRef.current.push(line);
      }
      // TP — green solid
      if (trade.take_profit != null) {
        const line = candleSeries.createPriceLine({
          price: trade.take_profit,
          color: '#22c55e',
          lineWidth: 1,
          lineStyle: 0,
          axisLabelVisible: true,
          title: `TP $${fmtPrice(trade.take_profit)}`,
        });
        priceLinesRef.current.push(line);
      }
      // SL — red solid
      if (trade.stop_loss != null) {
        const line = candleSeries.createPriceLine({
          price: trade.stop_loss,
          color: '#ef4444',
          lineWidth: 1,
          lineStyle: 0,
          axisLabelVisible: true,
          title: `SL $${fmtPrice(trade.stop_loss)}`,
        });
        priceLinesRef.current.push(line);
      }
      // Exit — yellow dotted (closed trades only)
      if (trade.status === 'closed' && trade.exit_price != null) {
        const line = candleSeries.createPriceLine({
          price: trade.exit_price,
          color: '#eab308',
          lineWidth: 1,
          lineStyle: 1, // dotted
          axisLabelVisible: true,
          title: `EXIT $${fmtPrice(trade.exit_price)}`,
        });
        priceLinesRef.current.push(line);
      }

      // Apply data if already fetched
      if (dataRef.current.length > 0) {
        applyData(candleSeries, volumeSeries, dataRef.current, chart);
      }
      setLoading(false);
    }).catch((err) => {
      console.error('[TradeChart] Failed to load lightweight-charts:', err);
      setLoading(false);
    });

    return () => {
      cancelled = true;
      if (candleSeriesRef.current) {
        for (const line of priceLinesRef.current) {
          try { candleSeriesRef.current.removePriceLine(line); } catch { /* ok */ }
        }
      }
      priceLinesRef.current = [];
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
  }, [trade.id, trade.entry_price, trade.take_profit, trade.stop_loss, trade.exit_price, trade.status, applyData]);

  return (
    <div className="w-full h-full min-h-[300px] relative">
      {loading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#0a0a0f]">
          <div className="flex items-center gap-2 text-xs text-white/40">
            <div className="w-3 h-3 border-2 border-white/15 border-t-white/50 rounded-full animate-spin" />
            Загрузка...
          </div>
        </div>
      )}
      <div ref={containerRef} className="w-full h-full" />
    </div>
  );
}

export default function TradeDetailModal({ trade, onClose }: TradeDetailModalProps) {
  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  if (!trade) return null;

  const isLong = trade.direction === 'long';
  const pnl = trade.pnl;
  const isClosed = trade.status === 'closed';

  const infoRows = [
    { label: 'Символ', value: trade.symbol.replace('USDT', '') + '/USDT' },
    { label: 'Направление', value: isLong ? 'LONG' : 'SHORT', color: isLong ? 'text-green-400' : 'text-red-400' },
    { label: 'Вход', value: `$${fmtPrice(trade.entry_price)}` },
    { label: 'Тейк-профит', value: trade.take_profit != null ? `$${fmtPrice(trade.take_profit)}` : '—' },
    { label: 'Стоп-лосс', value: trade.stop_loss != null ? `$${fmtPrice(trade.stop_loss)}` : '—' },
    ...(isClosed && trade.exit_price != null ? [{ label: 'Выход', value: `$${fmtPrice(trade.exit_price)}` }] : []),
    { label: 'PnL', value: pnl != null ? fmtMoney(pnl) : '—', color: pnl == null ? 'text-white/30' : pnl >= 0 ? 'text-green-400' : 'text-red-400' },
    { label: 'Плечо', value: `${trade.leverage}x` },
    { label: 'Объем', value: `$${trade.amount.toFixed(2)}` },
    { label: 'Длительность', value: formatDuration(trade.opened_at, trade.closed_at) },
    { label: 'Открыта', value: new Date(trade.opened_at).toLocaleString('ru-RU') },
    ...(isClosed && trade.closed_at ? [{ label: 'Закрыта', value: new Date(trade.closed_at).toLocaleString('ru-RU') }] : []),
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal */}
      <div className="relative z-10 w-[95vw] max-w-5xl h-[85vh] bg-[#0a0a0f] border border-white/10 rounded-xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/5 bg-[#0d0d14] shrink-0">
          <div className="flex items-center gap-3">
            <span className={`text-sm font-bold ${isLong ? 'text-green-400' : 'text-red-400'}`}>
              {isLong ? '▲ LONG' : '▼ SHORT'}
            </span>
            <span className="text-sm font-semibold text-white/90">
              {trade.symbol.replace('USDT', '')}
              <span className="text-white/40 ml-1">/USDT</span>
            </span>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border ${
              isClosed
                ? 'bg-white/5 text-white/40 border-white/10'
                : 'bg-yellow-500/10 text-yellow-400/80 border-yellow-500/20'
            }">
              {isClosed ? 'ЗАКР' : 'ОТКР'}
            </span>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/5 transition-colors text-white/50 hover:text-white/90"
            aria-label="Закрыть"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 flex min-h-0">
          {/* Chart */}
          <div className="flex-1 min-w-0">
            <TradeChart trade={trade} />
          </div>

          {/* Info Panel */}
          <div className="w-64 shrink-0 border-l border-white/5 bg-[#0d0d14] p-4 overflow-y-auto">
            <h3 className="text-[10px] uppercase tracking-widest text-white/30 font-semibold mb-3">
              Детали сделки
            </h3>
            <div className="space-y-2.5">
              {infoRows.map((row) => (
                <div key={row.label} className="flex items-center justify-between">
                  <span className="text-[11px] text-white/40">{row.label}</span>
                  <span className={`text-[11px] font-mono font-medium ${row.color ?? 'text-white/80'}`}>
                    {row.value}
                  </span>
                </div>
              ))}
            </div>

            {/* PnL highlight for closed trades */}
            {isClosed && pnl != null && (
              <div className={`mt-5 p-3 rounded-lg border ${
                pnl >= 0
                  ? 'bg-green-500/5 border-green-500/20'
                  : 'bg-red-500/5 border-red-500/20'
              }`}>
                <div className="text-[10px] uppercase tracking-widest text-white/30 mb-1">Итого PnL</div>
                <div className={`text-lg font-bold font-mono ${pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {fmtMoney(pnl)}
                </div>
                <div className="text-[10px] text-white/30 mt-1">
                  {pnl >= 0 ? '+' : ''}{((pnl / trade.amount) * 100).toFixed(1)}% от объёма
                </div>
              </div>
            )}

            {/* Position lines legend */}
            <div className="mt-5">
              <h3 className="text-[10px] uppercase tracking-widest text-white/30 font-semibold mb-2">
                Легенда
              </h3>
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <div className="w-4 h-0 border-t border-dashed border-white/60" />
                  <span className="text-[10px] text-white/50">Вход (Entry)</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-0 border-t border-green-500" />
                  <span className="text-[10px] text-white/50">Тейк-профит (TP)</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-0 border-t border-red-500" />
                  <span className="text-[10px] text-white/50">Стоп-лосс (SL)</span>
                </div>
                {isClosed && (
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-0 border-t border-dotted border-yellow-500" />
                    <span className="text-[10px] text-white/50">Выход (Exit)</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}