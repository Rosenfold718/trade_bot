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

/** Adaptive price formatting: BTC ~1 decimal, PEPE ~7 decimals */
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
  const openTradesRef = useRef<Trade[]>(openTrades ?? []);
  const priceLinesRef = useRef<any[]>([]);
  const [mounted, setMounted] = useState(false);

  // Always keep refs up to date
  useEffect(() => {
    dataRef.current = data;
  }, [data]);
  useEffect(() => {
    openTradesRef.current = openTrades ?? [];
  }, [openTrades]);

  // Mark as mounted (client-side only)
  useEffect(() => {
    setMounted(true);
  }, []);

  const applyData = useCallback((
    candleSeries: any,
    volumeSeries: any,
    candles: CandleData[],
    chart: any,
  ) => {
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

  // Create / recreate chart when symbol changes or on first mount
  useEffect(() => {
    if (!mounted || !chartContainerRef.current) return;

    const container = chartContainerRef.current;
    let cancelled = false;

    // Use dynamic import to avoid SSR issues with lightweight-charts
    import('lightweight-charts').then(({ createChart, CandlestickSeries, HistogramSeries, ColorType }) => {
      if (cancelled || !container) return;

      const rect = container.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      // Clean up existing chart
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
          background: { type: ColorType.Solid, color: '#0d0d14' },
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
          vertLine: {
            color: 'rgba(255,255,255,0.2)',
            width: 1,
            style: 2,
            labelBackgroundColor: '#1e1e2e',
          },
          horzLine: {
            color: 'rgba(255,255,255,0.2)',
            width: 1,
            style: 2,
            labelBackgroundColor: '#1e1e2e',
          },
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

      // Create price lines for open trades matching this symbol
      const matchingTrades = (openTradesRef.current ?? []).filter(
        (t) => t.symbol === symbol && t.status === 'open',
      );
      for (const trade of matchingTrades) {
        // Entry line — white dashed
        if (trade.entry_price != null) {
          const entryLine = candleSeries.createPriceLine({
            price: trade.entry_price,
            color: '#ffffff',
            lineWidth: 1,
            lineStyle: 2, // dashed
            axisLabelVisible: true,
            title: `ENTRY $${fmtPrice(trade.entry_price)}`,
          });
          priceLinesRef.current.push(entryLine);
        }
        // TP line — green solid
        if (trade.take_profit != null) {
          const tpLine = candleSeries.createPriceLine({
            price: trade.take_profit,
            color: '#22c55e',
            lineWidth: 1,
            lineStyle: 0, // solid
            axisLabelVisible: true,
            title: `TP $${fmtPrice(trade.take_profit)}`,
          });
          priceLinesRef.current.push(tpLine);
        }
        // SL line — red solid
        if (trade.stop_loss != null) {
          const slLine = candleSeries.createPriceLine({
            price: trade.stop_loss,
            color: '#ef4444',
            lineWidth: 1,
            lineStyle: 0, // solid
            axisLabelVisible: true,
            title: `SL $${fmtPrice(trade.stop_loss)}`,
          });
          priceLinesRef.current.push(slLine);
        }
      }

      // Exit lines for recently closed trades on this symbol
      const closedTrades = (recentTrades ?? []).filter(
        (t) => t.symbol === symbol && t.status === 'closed' && t.exit_price != null,
      );
      for (const trade of closedTrades) {
        // Entry — grey dashed
        if (trade.entry_price != null) {
          const line = candleSeries.createPriceLine({
            price: trade.entry_price,
            color: 'rgba(255,255,255,0.25)',
            lineWidth: 1,
            lineStyle: 2,
            axisLabelVisible: true,
            title: `IN $${fmtPrice(trade.entry_price)}`,
          });
          priceLinesRef.current.push(line);
        }
        // Exit — yellow dotted
        const exitLine = candleSeries.createPriceLine({
          price: trade.exit_price!,
          color: '#eab308',
          lineWidth: 1,
          lineStyle: 1, // dotted
          axisLabelVisible: true,
          title: `EXIT $${fmtPrice(trade.exit_price!)}`,
        });
        priceLinesRef.current.push(exitLine);
      }

      // Immediately apply any data we already have
      if (dataRef.current.length > 0) {
        applyData(candleSeries, volumeSeries, dataRef.current, chart);
      }
    }).catch((err) => {
      console.error('[TradingChart] Failed to load lightweight-charts:', err);
    });

    return () => {
      cancelled = true;
      // Clean up price lines
      if (candleSeriesRef.current) {
        for (const line of priceLinesRef.current) {
          try { candleSeriesRef.current.removePriceLine(line); } catch { /* already removed */ }
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
  }, [mounted, symbol, applyData]);

  // Update data when it changes (for same-symbol data refreshes)
  useEffect(() => {
    if (!candleSeriesRef.current || !volumeSeriesRef.current || data.length === 0) return;
    applyData(candleSeriesRef.current, volumeSeriesRef.current, data, chartRef.current);
  }, [data, applyData]);

  return (
    <div className="w-full h-full min-h-[300px]">
      <div ref={chartContainerRef} className="w-full h-full" />
    </div>
  );
}
