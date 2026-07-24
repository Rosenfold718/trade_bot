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
  sr:     { id: 'sr',     label: 'S/R уровни', color: '#eab308', lineWidth: 1, visible: true },
  swings: { id: 'swings', label: 'Экстремумы', color: '#06b6d4', lineWidth: 1, visible: true },
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
// Swing Point Detection & S/R Level Clustering
// ============================================================

function detectSwingPoints(
  candles: CandleData[], lookback: number = 5,
): Array<{ time: number; price: number; type: 'high' | 'low' }> {
  const swings: Array<{ time: number; price: number; type: 'high' | 'low' }> = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (candles[j].high >= candles[i].high) isHigh = false;
      if (candles[j].low <= candles[i].low) isLow = false;
      if (!isHigh && !isLow) break;
    }
    if (isHigh) swings.push({ time: candles[i].time, price: candles[i].high, type: 'high' });
    if (isLow) swings.push({ time: candles[i].time, price: candles[i].low, type: 'low' });
  }
  return swings;
}

function clusterSRLevels(
  swings: Array<{ time: number; price: number; type: 'high' | 'low' }>,
  thresholdPct: number = 0.5,
): Array<{ price: number; strength: number; type: 'support' | 'resistance'; touches: number }> {
  const cluster = (prices: number[]) => {
    const sorted = [...prices].sort((a, b) => a - b);
    const clusters: Array<{ price: number; touches: number; sum: number }> = [];
    for (const p of sorted) {
      let found = false;
      for (const c of clusters) {
        if (c.price > 0 && Math.abs(p - c.price) / c.price * 100 < thresholdPct) {
          c.sum += p;
          c.touches++;
          c.price = c.sum / c.touches;
          found = true;
          break;
        }
      }
      if (!found) clusters.push({ price: p, touches: 1, sum: p });
    }
    return clusters;
  };

  const result: Array<{ price: number; strength: number; type: 'support' | 'resistance'; touches: number }> = [];
  for (const c of cluster(swings.filter(s => s.type === 'high').map(s => s.price))) {
    if (c.touches >= 2) result.push({ price: c.price, strength: Math.min(c.touches / 5, 1), type: 'resistance', touches: c.touches });
  }
  for (const c of cluster(swings.filter(s => s.type === 'low').map(s => s.price))) {
    if (c.touches >= 2) result.push({ price: c.price, strength: Math.min(c.touches / 5, 1), type: 'support', touches: c.touches });
  }
  return result.sort((a, b) => b.touches - a.touches);
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
  const srLinesRef = useRef<any[]>([]);
  const indicatorSeriesRef = useRef<Map<string, any>>(new Map());
  // TP line drag state
  const tpLinesMap = useRef<Map<string, { line: any; price: number; tradeId: string }>>(new Map());
  const overlayRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{ active: boolean; tradeId: string; startY: number; startPrice: number; lastPrice: number }>({ active: false, tradeId: '', startY: 0, startPrice: 0, lastPrice: 0 });
  const [mounted, setMounted] = useState(false);
  const [chartReady, setChartReady] = useState(false);

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
      srLinesRef.current = [];
      indicatorSeriesRef.current.clear();
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;

      const priceFmt = getPriceFormat(dataRef.current);

      const chart = createChart(container, {
        width: rect.width, height: rect.height,
        layout: { background: { type: ColorType.Solid, color: '#0d0d14' }, textColor: '#8a8a9a', fontFamily: 'Inter, sans-serif', fontSize: 11 },
        grid: { vertLines: { color: 'rgba(255,255,255,0.04)' }, horzLines: { color: 'rgba(255,255,255,0.04)' } },
        crosshair: { mode: 0, vertLine: { color: 'rgba(255,255,255,0.2)', width: 1, style: 2, labelBackgroundColor: '#1e1e2e' }, horzLine: { color: 'rgba(255,255,255,0.2)', width: 1, style: 2, labelBackgroundColor: '#1e1e2e' } },
        localization: {
          locale: 'ru-RU',
          timeFormatter: (time: import('lightweight-charts').Time) => {
            if (typeof time !== 'number') return String(time);
            const d = new Date(time * 1000);
            return d.toLocaleString('ru-RU', {
              timeZone: 'Europe/Moscow',
              day: '2-digit', month: '2-digit', year: '2-digit',
              hour: '2-digit', minute: '2-digit',
            });
          },
        },
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
      setChartReady(true);

      if (dataRef.current.length > 0) applyData(cs, vs, dataRef.current, chart);
    }).catch(err => console.error('[Chart] load error:', err));

    return () => {
      cancelled = true;
      setChartReady(false);
      priceLinesRef.current = [];
      srLinesRef.current = [];
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
    tpLinesMap.current.clear();

    const addLine = (price: number, color: string, lineStyle: number, lineWidth: number, title: string, draggable?: boolean) => {
      try {
        const line = cs.createPriceLine({ price, color, lineWidth, lineStyle, axisLabelVisible: true, title, draggable: draggable ?? false });
        priceLinesRef.current.push(line);
        return line;
      } catch { /* ignore invalid price */ }
      return null;
    };

    for (const trade of (openTrades ?? []).filter(t => t.symbol === symbol && t.status === 'open')) {
      if (trade.entry_price != null) addLine(trade.entry_price, '#ffffff', 2, 1, `ENTRY $${fmtPrice(trade.entry_price)}`);
      // TP line — draggable, tracked in map
      if (trade.take_profit != null) {
        const tpLine = addLine(trade.take_profit, '#22c55e', 0, 2, `↕ TP $${fmtPrice(trade.take_profit)}`);
        if (tpLine) tpLinesMap.current.set(trade.id, { line: tpLine, price: trade.take_profit, tradeId: trade.id });
      }
      if (trade.stop_loss != null) addLine(trade.stop_loss, '#ef4444', 0, 1, `SL $${fmtPrice(trade.stop_loss)}`);
    }

    for (const trade of (recentTrades ?? []).filter(t => t.symbol === symbol && t.status === 'closed' && t.exit_price != null)) {
      if (trade.entry_price != null) addLine(trade.entry_price, 'rgba(255,255,255,0.25)', 2, 1, `IN $${fmtPrice(trade.entry_price)}`);
      addLine(trade.exit_price!, '#eab308', 1, 1, `EXIT $${fmtPrice(trade.exit_price!)}`);
    }
  }, [openTrades, recentTrades, symbol]);

  // ============================================================
  // 4. Technical indicators + Swing Trendlines + S/R Levels
  // ============================================================
  useEffect(() => {
    const chart = chartRef.current;
    const cs = candleSeriesRef.current;
    if (!chart || !cs || data.length < 50) return;

    let cancelled = false;

    import('lightweight-charts').then(({ LineSeries }) => {
      if (cancelled) return;

      // --- Remove all previous indicator & swing series ---
      for (const [, series] of indicatorSeriesRef.current) {
        try { chart.removeSeries(series); } catch { /* ok */ }
      }
      indicatorSeriesRef.current.clear();

      // --- Remove S/R price lines ---
      for (const line of srLinesRef.current) {
        try { cs.removePriceLine(line); } catch { /* ok */ }
      }
      srLinesRef.current = [];

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

      // --- Standard indicators ---
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

      // --- Swing Trendlines ---
      const swings = detectSwingPoints(data, 5);

      if (indicators.swings?.visible) {
        const highs = swings.filter(s => s.type === 'high');
        const lows = swings.filter(s => s.type === 'low');

        if (highs.length >= 2) {
          try {
            const series = chart.addSeries(LineSeries, {
              color: '#ef4444',
              lineWidth: 1,
              lineStyle: 0,
              priceLineVisible: false,
              lastValueVisible: false,
              crosshairMarkerVisible: false,
              ...(priceFmt ? { priceFormat: priceFmt } : {}),
            });
            series.setData(highs.map(s => ({ time: s.time as import('lightweight-charts').Time, value: s.price })));
            indicatorSeriesRef.current.set('swing-highs', series);
          } catch { /* ok */ }
        }
        if (lows.length >= 2) {
          try {
            const series = chart.addSeries(LineSeries, {
              color: '#22c55e',
              lineWidth: 1,
              lineStyle: 0,
              priceLineVisible: false,
              lastValueVisible: false,
              crosshairMarkerVisible: false,
              ...(priceFmt ? { priceFormat: priceFmt } : {}),
            });
            series.setData(lows.map(s => ({ time: s.time as import('lightweight-charts').Time, value: s.price })));
            indicatorSeriesRef.current.set('swing-lows', series);
          } catch { /* ok */ }
        }
      }

      // --- S/R horizontal levels ---
      if (indicators.sr?.visible) {
        const levels = clusterSRLevels(swings, 0.5);
        const supportLevels = levels.filter(l => l.type === 'support').slice(0, 5);
        const resistanceLevels = levels.filter(l => l.type === 'resistance').slice(0, 5);

        for (const lvl of [...supportLevels, ...resistanceLevels]) {
          try {
            const isSupport = lvl.type === 'support';
            const line = cs.createPriceLine({
              price: lvl.price,
              color: isSupport ? 'rgba(34,197,94,0.4)' : 'rgba(239,68,68,0.4)',
              lineWidth: 1,
              lineStyle: 0,
              axisLabelVisible: false,
              title: '',
            });
            srLinesRef.current.push(line);
          } catch { /* ok */ }
        }
      }
    });

    return () => { cancelled = true; };
  }, [data, indicators, symbol, chartReady]);

  // ============================================================
  // 5. Draggable TP lines — overlay grab zones above chart canvas
  //    The chart library intercepts all canvas mouse events for scroll/zoom,
  //    so we place invisible HTML grab zones on top of the chart at each TP
  //    line's Y coordinate. Only these zones capture mouse events;
  //    everything else passes through to the chart as normal.
  // ============================================================
  useEffect(() => {
    const overlay = overlayRef.current;
    const chart = chartRef.current;
    if (!overlay || !chart) return;

    const GRAB_ZONE_H = 18; // pixels tall grab zone per TP line

    const positionGrabZones = () => {
      // Remove old grab zones
      overlay.innerHTML = '';

      for (const [, info] of tpLinesMap.current) {
        try {
          const coordY = chart.priceToCoordinate(info.price);
          if (coordY === null || coordY < 0) continue;

          const el = document.createElement('div');
          el.style.cssText = `position:absolute;top:${coordY - GRAB_ZONE_H / 2}px;left:0;right:56px;height:${GRAB_ZONE_H}px;cursor:ns-resize;z-index:20;`;
          el.title = 'Перетащите для изменения TP';

          el.addEventListener('mousedown', (e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            dragState.current = {
              active: true,
              tradeId: info.tradeId,
              startY: e.clientY,
              startPrice: info.price,
              lastPrice: info.price,
            };
          });

          overlay.appendChild(el);
        } catch { /* ignore */ }
      }
    };

    // Position initially
    positionGrabZones();

    // Reposition when chart visible range changes (scroll / zoom)
    let cleanupRange: (() => void) | null = null;
    try {
      const ts = chart.timeScale();
      if (ts && typeof ts.subscribeVisibleLogicalRangeChange === 'function') {
        ts.subscribeVisibleLogicalRangeChange(() => positionGrabZones());
        cleanupRange = () => { try { (ts as any).unsubscribeVisibleLogicalRangeChange(() => positionGrabZones()); } catch { /* */ } };
      }
    } catch { /* older API */ }

    const handleMove = (e: MouseEvent) => {
 const d = dragState.current;
      if (!d.active) return;
      try {
        const rect = overlay.getBoundingClientRect();
        const mouseY = e.clientY - rect.top;
        const newPrice = chart.coordinateToPrice(mouseY);
        if (newPrice !== null && newPrice > 0) {
          d.lastPrice = newPrice;
          // Update the TP line position visually
          const info = tpLinesMap.current.get(d.tradeId);
          if (info) {
            info.line.applyOptions({ price: newPrice, title: `↕ TP $${fmtPrice(newPrice)}` });
            info.price = newPrice;
          }
        }
      } catch { /* ignore */ }
    };

    const handleUp = async () => {
      const d = dragState.current;
      if (!d.active) return;
      d.active = false;

      // Re-position grab zones to new location
      positionGrabZones();

      // Save new TP price via API if moved >0.1%
      if (d.lastPrice > 0 && d.startPrice > 0 && Math.abs(d.lastPrice - d.startPrice) / d.startPrice > 0.001) {
        try {
          await fetch('/api/trader', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'update-tp', tradeId: d.tradeId, newTakeProfit: d.lastPrice }),
          });
          console.log(`[Chart] TP updated for ${d.tradeId}: $${fmtPrice(d.lastPrice)}`);
        } catch (err) {
          console.error('[Chart] Failed to update TP:', err);
        }
      }
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);

    return () => {
      overlay.innerHTML = '';
      cleanupRange?.();
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [chartReady, symbol, openTrades]); // Re-attach when chart rebuilds or trades change

  return (
    <div className="w-full h-full min-h-[300px] relative">
      <div ref={chartContainerRef} className="w-full h-full" />
      <div ref={overlayRef} className="absolute inset-0 pointer-events-none z-10" />
    </div>
  );
}