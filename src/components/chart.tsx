'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import type { CandleData, Trade } from '@/lib/types';

interface TradingChartProps {
  data: CandleData[];
  symbol: string;
  timeframe: { label: string; interval: string };
  openTrades?: Trade[];
  recentTrades?: Trade[];
}

function fmtPrice(price: number): string {
  if (price >= 10000) return price.toFixed(1);
  if (price >= 100) return price.toFixed(2);
  if (price >= 1) return price.toFixed(3);
  if (price >= 0.01) return price.toFixed(5);
  return price.toFixed(7);
}

export default function TradingChart({ data, symbol, timeframe, openTrades, recentTrades }: TradingChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);
  const candleSeriesRef = useRef<any>(null);
  const volumeSeriesRef = useRef<any>(null);
  const dataRef = useRef<CandleData[]>(data);
  // Track price lines so we can remove them on updates
  const priceLinesRef = useRef<any[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { dataRef.current = data; }, [data]);
  useEffect(() => { setMounted(true); }, []);

  const applyData = useCallback((
    cs: any, vs: any, candles: CandleData[], chart: any,
  ) => {
    if (!cs || !vs || candles.length === 0) return;
    cs.setData(candles.map(d => ({ time: d.time as import('lightweight-charts').Time, open: d.open, high: d.high, low: d.low, close: d.close })));
    vs.setData(candles.map(d => ({ time: d.time as import('lightweight-charts').Time, value: d.volume, color: d.close >= d.open ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)' })));
    chart?.timeScale()?.fitContent();
  }, []);

  // ============================================================
  // 1. Create chart on mount / symbol change
  // ============================================================
  useEffect(() => {
    if (!mounted || !chartContainerRef.current) return;
    const container = chartContainerRef.current;
    let cancelled = false;

    import('lightweight-charts').then(({ createChart, CandlestickSeries, HistogramSeries, ColorType }) => {
      if (cancelled || !container) return;
      const rect = container.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      if (chartRef.current) { chartRef.current.remove(); chartRef.current = null; }
      priceLinesRef.current = [];
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;

      const chart = createChart(container, {
        width: rect.width, height: rect.height,
        layout: { background: { type: ColorType.Solid, color: '#0d0d14' }, textColor: '#8a8a9a', fontFamily: 'Inter, sans-serif', fontSize: 11 },
        grid: { vertLines: { color: 'rgba(255,255,255,0.04)' }, horzLines: { color: 'rgba(255,255,255,0.04)' } },
        crosshair: { mode: 0, vertLine: { color: 'rgba(255,255,255,0.2)', width: 1, style: 2, labelBackgroundColor: '#1e1e2e' }, horzLine: { color: 'rgba(255,255,255,0.2)', width: 1, style: 2, labelBackgroundColor: '#1e1e2e' } },
        rightPriceScale: { borderColor: 'rgba(255,255,255,0.1)', scaleMargins: { top: 0.1, bottom: 0.25 } },
        timeScale: { borderColor: 'rgba(255,255,255,0.1)', timeVisible: true, secondsVisible: false },
        handleScroll: true, handleScale: true, autoSize: true,
      });

      const cs = chart.addSeries(CandlestickSeries, { upColor: '#22c55e', downColor: '#ef4444', borderUpColor: '#22c55e', borderDownColor: '#ef4444', wickUpColor: '#22c55e', wickDownColor: '#ef4444' });
      const vs = chart.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: 'volume' });
      chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

      chartRef.current = chart;
      candleSeriesRef.current = cs;
      volumeSeriesRef.current = vs;

      if (dataRef.current.length > 0) applyData(cs, vs, dataRef.current, chart);
    }).catch(err => console.error('[Chart] load error:', err));

    return () => {
      cancelled = true;
      priceLinesRef.current = [];
      if (chartRef.current) { chartRef.current.remove(); chartRef.current = null; }
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
  }, [mounted, symbol, applyData]);

  // Update candle data
  useEffect(() => {
    if (!candleSeriesRef.current || !volumeSeriesRef.current || data.length === 0) return;
    applyData(candleSeriesRef.current, volumeSeriesRef.current, data, chartRef.current);
  }, [data, applyData]);

  // ============================================================
  // 2. Dynamic price lines — re-runs when openTrades/recentTrades/symbol change
  // ============================================================
  useEffect(() => {
    const cs = candleSeriesRef.current;
    if (!cs) return;

    // Remove old lines
    for (const line of priceLinesRef.current) {
      try { cs.removePriceLine(line); } catch { /* ok */ }
    }
    priceLinesRef.current = [];

    // Helper to create and track a line
    const addLine = (price: number, color: string, lineStyle: number, title: string) => {
      try {
        const line = cs.createPriceLine({ price, color, lineWidth: 1, lineStyle, axisLabelVisible: true, title });
        priceLinesRef.current.push(line);
      } catch { /* ignore invalid price */ }
    };

    // Open trades for this symbol
    for (const trade of (openTrades ?? []).filter(t => t.symbol === symbol && t.status === 'open')) {
      if (trade.entry_price != null) addLine(trade.entry_price, '#ffffff', 2, `ENTRY $${fmtPrice(trade.entry_price)}`);
      if (trade.take_profit != null) addLine(trade.take_profit, '#22c55e', 0, `TP $${fmtPrice(trade.take_profit)}`);
      if (trade.stop_loss != null) addLine(trade.stop_loss, '#ef4444', 0, `SL $${fmtPrice(trade.stop_loss)}`);
    }

    // Closed trades for this symbol
    for (const trade of (recentTrades ?? []).filter(t => t.symbol === symbol && t.status === 'closed' && t.exit_price != null)) {
      if (trade.entry_price != null) addLine(trade.entry_price, 'rgba(255,255,255,0.25)', 2, `IN $${fmtPrice(trade.entry_price)}`);
      addLine(trade.exit_price!, '#eab308', 1, `EXIT $${fmtPrice(trade.exit_price!)}`);
    }
  }, [openTrades, recentTrades, symbol]);

  return (
    <div className="w-full h-full min-h-[300px] relative z-0">
      <div ref={chartContainerRef} className="w-full h-full" />
    </div>
  );
}
