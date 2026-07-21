'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import type { CandleData, Trade } from '@/lib/types';

export interface IndicatorConfig {
  id: string;
  label: string;
  color: string;
  lineWidth: number;
  visible: boolean;
}

export const DEFAULT_INDICATORS: Record<string, IndicatorConfig> = {
  sma7:  { id: 'sma7',  label: 'SMA 7',  color: '#f59e0b', lineWidth: 1, visible: true },
  sma25: { id: 'sma25', label: 'SMA 25', color: '#3b82f6', lineWidth: 1, visible: true },
  sma99: { id: 'sma99', label: 'SMA 99', color: '#a855f7', lineWidth: 1, visible: false },
  ema12: { id: 'ema12', label: 'EMA 12', color: '#06b6d4', lineWidth: 1, visible: true },
  ema26: { id: 'ema26', label: 'EMA 26', color: '#ec4899', lineWidth: 1, visible: false },
  bb:    { id: 'bb',    label: 'BB 20',   color: 'rgba(148,163,184,0.5)', lineWidth: 1, visible: true },
};

interface TradingChartProps {
  data: CandleData[];
  symbol: string;
  timeframe: { label: string; interval: string };
  openTrades?: Trade[];
  recentTrades?: Trade[];
  indicators: Record<string, IndicatorConfig>;
}

// ============================================================
// Helpers
// ============================================================

export function fmtPrice(price: number): string {
  if (price >= 10000) return price.toFixed(1);
  if (price >= 100) return price.toFixed(2);
  if (price >= 1) return price.toFixed(3);
  if (price >= 0.01) return price.toFixed(5);
  return price.toFixed(7);
}

/** Returns lightweight-charts price format config based on price magnitude */
function getPriceFormat(candles: CandleData[]): { type: 'custom'; formatter: (price: number) => string } | undefined {
  if (candles.length === 0) return undefined;
  const lastClose = candles[candles.length - 1].close;
  const decimals = lastClose >= 10000 ? 1 : lastClose >= 100 ? 2 : lastClose >= 1 ? 4 : lastClose >= 0.01 ? 5 : 7;
  return {
    type: 'custom' as const,
    formatter: (price: number) => price.toFixed(decimals),
  };
}

// ============================================================
// Technical Indicators — pure math, no external deps
// ============================================================

function calcSMA(candles: CandleData[], period: number): Array<{ time: number; value: number }> {
  const result: Array<{ time: number; value: number }> = [];
  for (let i = period - 1; i < candles.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += candles[j].close;
    result.push({ time: candles[i].time, value: sum / period });
  }
  return result;
}

function calcEMA(candles: CandleData[], period: number): Array<{ time: number; value: number }> {
  if (candles.length < period) return [];
  const k = 2 / (period + 1);
  const result: Array<{ time: number; value: number }> = [];
  let ema = candles.slice(0, period).reduce((s, c) => s + c.close, 0) / period;
  result.push({ time: candles[period - 1].time, value: ema });
  for (let i = period; i < candles.length; i++) {
    ema = candles[i].close * k + ema * (1 - k);
    result.push({ time: candles[i].time, value: ema });
  }
  return result;
}

function calcBollingerBands(
  candles: CandleData[], period: number, mult: number,
): { middle: Array<{ time: number; value: number }>; upper: Array<{ time: number; value: number }>; lower: Array<{ time: number; value: number }> } {
  const middle = calcSMA(candles, period);
  const upper: Array<{ time: number; value: number }> = [];
  const lower: Array<{ time: number; value: number }> = [];

  for (let i = 0; i < middle.length; i++) {
    const candleIdx = i + period - 1;
    let sumSq = 0;
    for (let j = candleIdx - period + 1; j <= candleIdx; j++) {
      sumSq += (candles[j].close - middle[i].value) ** 2;
    }
    const std = Math.sqrt(sumSq / period);
    upper.push({ time: middle[i].time, value: middle[i].value + mult * std });
    lower.push({ time: middle[i].time, value: middle[i].value - mult * std });
  }
  return { middle, upper, lower };
}

// ============================================================
// Chart Component — no UI controls, pure chart
// ============================================================

export default function TradingChart({ data, symbol, timeframe, openTrades, recentTrades, indicators }: TradingChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);
  const candleSeriesRef = useRef<any>(null);
  const volumeSeriesRef = useRef<any>(null);
  const dataRef = useRef<CandleData[]>(data);
  const priceLinesRef = useRef<any[]>([]);
  const indicatorSeriesRef = useRef<Map<string, any>>(new Map());
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

    import('lightweight-charts').then(({ createChart, CandlestickSeries, HistogramSeries, LineSeries, ColorType }) => {
      if (cancelled || !container) return;
      const rect = container.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      if (chartRef.current) { chartRef.current.remove(); chartRef.current = null; }
      priceLinesRef.current = [];
      indicatorSeriesRef.current.clear();
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;

      const priceFmt = getPriceFormat(dataRef.current);

      const chart = createChart(container, {
        width: rect.width, height: rect.height,
        layout: { background: { type: ColorType.Solid, color: '#0d0d14' }, textColor: '#8a8a9a', fontFamily: 'Inter, sans-serif', fontSize: 11 },
        grid: { vertLines: { color: 'rgba(255,255,255,0.04)' }, horzLines: { color: 'rgba(255,255,255,0.04)' } },
        crosshair: { mode: 0, vertLine: { color: 'rgba(255,255,255,0.2)', width: 1, style: 2, labelBackgroundColor: '#1e1e2e' }, horzLine: { color: 'rgba(255,255,255,0.2)', width: 1, style: 2, labelBackgroundColor: '#1e1e2e' } },
        rightPriceScale: {
          borderColor: 'rgba(255,255,255,0.1)',
          scaleMargins: { top: 0.1, bottom: 0.25 },
          ...(priceFmt ? { priceFormat: priceFmt } : {}),
        },
        timeScale: {
          borderColor: 'rgba(255,255,255,0.1)',
          timeVisible: true,
          secondsVisible: false,
          tickMarkFormatter: (time: import('lightweight-charts').Time, type: import('lightweight-charts').TickMarkType) => {
            if (typeof time !== 'number') return null;
            const d = new Date(time * 1000);
            const tz = 'Europe/Moscow';
            // Year
            if (type === 0) return d.toLocaleDateString('ru-RU', { timeZone: tz, year: 'numeric' });
            // Month
            if (type === 1) return d.toLocaleDateString('ru-RU', { timeZone: tz, month: 'short', year: '2-digit' });
            // DayOfMonth
            if (type === 2) return d.toLocaleDateString('ru-RU', { timeZone: tz, day: '2-digit', month: '2-digit' });
            // Time without seconds (HH:MM)
            return d.toLocaleTimeString('ru-RU', { timeZone: tz, hour: '2-digit', minute: '2-digit' });
          },
        },
        handleScroll: true, handleScale: true, autoSize: true,
      });

      const cs = chart.addSeries(CandlestickSeries, {
        upColor: '#22c55e', downColor: '#ef4444',
        borderUpColor: '#22c55e', borderDownColor: '#ef4444',
        wickUpColor: '#22c55e', wickDownColor: '#ef4444',
        ...(priceFmt ? { priceFormat: priceFmt } : {}),
      });
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
      indicatorSeriesRef.current.clear();
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
  // 2. Update price format when data changes (for precision)
  // ============================================================
  useEffect(() => {
    const chart = chartRef.current;
    const cs = candleSeriesRef.current;
    if (!chart || !cs || data.length === 0) return;
    const priceFmt = getPriceFormat(data);
    if (!priceFmt) return;
    chart.priceScale('right').applyOptions({ priceFormat: priceFmt });
    cs.applyOptions({ priceFormat: priceFmt });
  }, [data]);

  // ============================================================
  // 3. Dynamic price lines — re-runs when openTrades/recentTrades/symbol change
  // ============================================================
  useEffect(() => {
    const cs = candleSeriesRef.current;
    if (!cs) return;

    for (const line of priceLinesRef.current) {
      try { cs.removePriceLine(line); } catch { /* ok */ }
    }
    priceLinesRef.current = [];

    const addLine = (price: number, color: string, lineStyle: number, title: string) => {
      try {
        const line = cs.createPriceLine({ price, color, lineWidth: 1, lineStyle, axisLabelVisible: true, title });
        priceLinesRef.current.push(line);
      } catch { /* ignore invalid price */ }
    };

    for (const trade of (openTrades ?? []).filter(t => t.symbol === symbol && t.status === 'open')) {
      if (trade.entry_price != null) addLine(trade.entry_price, '#ffffff', 2, `ENTRY $${fmtPrice(trade.entry_price)}`);
      if (trade.take_profit != null) addLine(trade.take_profit, '#22c55e', 0, `TP $${fmtPrice(trade.take_profit)}`);
      if (trade.stop_loss != null) addLine(trade.stop_loss, '#ef4444', 0, `SL $${fmtPrice(trade.stop_loss)}`);
    }

    for (const trade of (recentTrades ?? []).filter(t => t.symbol === symbol && t.status === 'closed' && t.exit_price != null)) {
      if (trade.entry_price != null) addLine(trade.entry_price, 'rgba(255,255,255,0.25)', 2, `IN $${fmtPrice(trade.entry_price)}`);
      addLine(trade.exit_price!, '#eab308', 1, `EXIT $${fmtPrice(trade.exit_price!)}`);
    }
  }, [openTrades, recentTrades, symbol]);

  // ============================================================
  // 4. Technical indicators — re-runs when data or visibility changes
  // ============================================================
  useEffect(() => {
    const chart = chartRef.current;
    const cs = candleSeriesRef.current;
    if (!chart || !cs || data.length < 50) return;

    let cancelled = false;

    import('lightweight-charts').then(({ LineSeries }) => {
      if (cancelled) return;

      for (const [, series] of indicatorSeriesRef.current) {
        try { chart.removeSeries(series); } catch { /* ok */ }
      }
      indicatorSeriesRef.current.clear();

      const priceFmt = getPriceFormat(data);

      const addIndicatorLine = (
        id: string, values: Array<{ time: number; value: number }>,
        color: string, lineWidth: number, lineStyle?: number,
      ) => {
        if (values.length === 0) return;
        try {
          const series = chart.addSeries(LineSeries, {
            color,
            lineWidth,
            lineStyle: lineStyle ?? 0,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false,
            ...(priceFmt ? { priceFormat: priceFmt } : {}),
          });
          series.setData(values.map(d => ({ time: d.time as import('lightweight-charts').Time, value: d.value })));
          indicatorSeriesRef.current.set(id, series);
        } catch (err) {
          console.error(`[Chart] Failed to add indicator ${id}:`, err);
        }
      };

      if (indicators.sma7?.visible) addIndicatorLine('sma7', calcSMA(data, 7), indicators.sma7.color, indicators.sma7.lineWidth);
      if (indicators.sma25?.visible) addIndicatorLine('sma25', calcSMA(data, 25), indicators.sma25.color, indicators.sma25.lineWidth);
      if (indicators.sma99?.visible) addIndicatorLine('sma99', calcSMA(data, 99), indicators.sma99.color, indicators.sma99.lineWidth);
      if (indicators.ema12?.visible) addIndicatorLine('ema12', calcEMA(data, 12), indicators.ema12.color, indicators.ema12.lineWidth);
      if (indicators.ema26?.visible) addIndicatorLine('ema26', calcEMA(data, 26), indicators.ema26.color, indicators.ema26.lineWidth);
      if (indicators.bb?.visible) {
        const bb = calcBollingerBands(data, 20, 2);
        addIndicatorLine('bb-upper', bb.upper, indicators.bb.color, indicators.bb.lineWidth, 2);
        addIndicatorLine('bb-lower', bb.lower, indicators.bb.color, indicators.bb.lineWidth, 2);
      }
    });

    return () => { cancelled = true; };
  }, [data, indicators, symbol]);

  return (
    <div className="w-full h-full min-h-[300px]">
      <div ref={chartContainerRef} className="w-full h-full" />
    </div>
  );
}