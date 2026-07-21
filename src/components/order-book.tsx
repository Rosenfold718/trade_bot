'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useTerminalStore } from '@/lib/store';
import type { OrderBookLevel, OrderBookData } from '@/lib/types';

function formatPrice(price: number, basePrice: number): string {
  if (basePrice >= 10000) return price.toFixed(1);
  if (basePrice >= 100) return price.toFixed(2);
  if (basePrice >= 1) return price.toFixed(4);
  if (basePrice >= 0.01) return price.toFixed(5);
  return price.toFixed(7);
}

function formatQty(qty: number): string {
  if (qty >= 10000) return (qty / 1000).toFixed(1) + 'K';
  if (qty >= 1000) return (qty / 1000).toFixed(2) + 'K';
  if (qty >= 1) return qty.toFixed(2);
  if (qty >= 0.01) return qty.toFixed(4);
  return qty.toFixed(6);
}

function formatTotal(total: number): string {
  if (total >= 1000000) return (total / 1000000).toFixed(2) + 'M';
  if (total >= 1000) return (total / 1000).toFixed(1) + 'K';
  if (total >= 1) return total.toFixed(1);
  return total.toFixed(4);
}

interface FlashMap {
  [priceKey: string]: 'up' | 'down' | null;
}

export default function OrderBook() {
  const { selectedSymbol } = useTerminalStore();
  const [orderBook, setOrderBook] = useState<OrderBookData | null>(null);
  const [flashes, setFlashes] = useState<FlashMap>({});
  const prevDataRef = useRef<Map<string, number>>(new Map());
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Keep asks/bids pinned to the center
  const asksContainerRef = useRef<HTMLDivElement>(null);
  const bidsContainerRef = useRef<HTMLDivElement>(null);

  const processDepth = useCallback((raw: {
    lastUpdateId: number;
    bids: [string, string][];
    asks: [string, string][];
  }) => {
    const newFlashes: FlashMap = {};

    // Process asks (ascending price)
    const asks: OrderBookLevel[] = raw.asks.map(([p, q]) => {
      const price = parseFloat(p);
      const quantity = parseFloat(q);
      const prevQty = prevDataRef.current.get('a' + p);
      if (prevQty !== undefined && prevQty !== quantity) {
        newFlashes['a' + p] = quantity > prevQty ? 'up' : 'down';
      }
      prevDataRef.current.set('a' + p, quantity);
      return { price, quantity, total: 0 };
    });

    // Process bids (descending price)
    const bids: OrderBookLevel[] = raw.bids.map(([p, q]) => {
      const price = parseFloat(p);
      const quantity = parseFloat(q);
      const prevQty = prevDataRef.current.get('b' + p);
      if (prevQty !== undefined && prevQty !== quantity) {
        newFlashes['b' + p] = quantity > prevQty ? 'up' : 'down';
      }
      prevDataRef.current.set('b' + p, quantity);
      return { price, quantity, total: 0 };
    });

    // Compute cumulative totals for asks (from best ask downward)
    let askTotal = 0;
    for (let i = 0; i < asks.length; i++) {
      askTotal += asks[i].quantity;
      asks[i].total = askTotal;
    }

    // Compute cumulative totals for bids (from best bid downward)
    let bidTotal = 0;
    for (let i = 0; i < bids.length; i++) {
      bidTotal += bids[i].quantity;
      bids[i].total = bidTotal;
    }

    const bestAsk = asks.length > 0 ? asks[0].price : 0;
    const bestBid = bids.length > 0 ? bids[0].price : 0;
    const spread = bestAsk - bestBid;
    const midPrice = (bestAsk + bestBid) / 2;
    const spreadPercent = midPrice > 0 ? (spread / midPrice) * 100 : 0;

    setOrderBook({ asks, bids, spread, spreadPercent, midPrice });
    setFlashes(newFlashes);

    // Clear flashes after 200ms
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => setFlashes({}), 200);
  }, []);

  useEffect(() => {
    let active = true;

    function connect() {
      if (!active) return;
      if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
        return;
      }

      const streamName = `${selectedSymbol.toLowerCase()}@depth20@100ms`;
      const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${streamName}`);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log(`[OrderBook] Connected: ${selectedSymbol}`);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.bids && data.asks) {
            processDepth(data);
          }
        } catch {
          // ignore
        }
      };

      ws.onclose = () => {
        if (!active) return;
        wsRef.current = null;
        reconnectRef.current = setTimeout(connect, 3000);
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    // Clear previous data when symbol changes
    prevDataRef.current.clear();
    connect();

    return () => {
      active = false;
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [selectedSymbol, processDepth]);

  // Scroll asks to bottom, bids to top (pin to spread)
  useEffect(() => {
    if (asksContainerRef.current) {
      asksContainerRef.current.scrollTop = asksContainerRef.current.scrollHeight;
    }
    if (bidsContainerRef.current) {
      bidsContainerRef.current.scrollTop = 0;
    }
  }, [orderBook]);

  const maxAskTotal = useMemo(() => {
    if (!orderBook || orderBook.asks.length === 0) return 1;
    return Math.max(...orderBook.asks.map(a => a.total), 1);
  }, [orderBook]);

  const maxBidTotal = useMemo(() => {
    if (!orderBook || orderBook.bids.length === 0) return 1;
    return Math.max(...orderBook.bids.map(b => b.total), 1);
  }, [orderBook]);

  const basePrice = orderBook ? orderBook.midPrice : 100;

  // Render asks in reverse (highest at top, closest to spread at bottom)
  const reversedAsks = useMemo(() => {
    if (!orderBook) return [];
    return [...orderBook.asks].reverse();
  }, [orderBook]);

  return (
    <div className="flex flex-col h-full bg-[#0d0d14] select-none" ref={containerRef}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/5 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold text-white/70 uppercase tracking-wider">Стакан</span>
          <div className="flex items-center gap-1">
            <div className="w-1.5 h-1.5 rounded-full bg-green-400/80 animate-pulse" />
            <span className="text-[9px] text-white/30 font-mono">LIVE</span>
          </div>
        </div>
        {orderBook && (
          <div className="flex items-center gap-2.5 text-[10px] font-mono">
            <div className="flex items-center gap-1">
              <span className="text-white/30">Спред</span>
              <span className="text-yellow-400/80 font-medium">{orderBook.spreadPercent.toFixed(3)}%</span>
            </div>
          </div>
        )}
      </div>

      {/* Column Headers */}
      <div className="grid grid-cols-3 px-3 py-1.5 border-b border-white/[0.03] shrink-0">
        <span className="text-[9px] text-white/25 font-mono uppercase tracking-wider">Цена (USDT)</span>
        <span className="text-[9px] text-white/25 font-mono uppercase tracking-wider text-right">Объём</span>
        <span className="text-[9px] text-white/25 font-mono uppercase tracking-wider text-right">Всего</span>
      </div>

      {/* Order Book Body */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {!orderBook ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="flex flex-col items-center gap-2">
              <div className="w-4 h-4 border-2 border-white/10 border-t-white/30 rounded-full animate-spin" />
              <span className="text-[10px] text-white/25">Загрузка стакана...</span>
            </div>
          </div>
        ) : (
          <>
            {/* Asks — scrollable, pinned to bottom */}
            <div
              ref={asksContainerRef}
              className="flex-1 overflow-hidden min-h-0"
              style={{ minHeight: 0 }}
            >
              <div className="flex flex-col justify-end h-full">
                {reversedAsks.map((level, i) => {
                  const pct = (level.total / maxAskTotal) * 100;
                  const flash = flashes['a' + level.price];
                  return (
                    <div
                      key={`ask-${i}`}
                      className={`grid grid-cols-3 px-3 py-[2px] relative text-[10px] font-mono transition-colors duration-100 ${
                        flash === 'up' ? 'bg-red-500/10' : flash === 'down' ? 'bg-red-500/15' : ''
                      }`}
                    >
                      {/* Volume bar background */}
                      <div
                        className="absolute right-0 top-0 bottom-0 bg-red-500/[0.07]"
                        style={{ width: `${pct}%` }}
                      />
                      {/* Price */}
                      <span className="relative text-red-400/90">{formatPrice(level.price, basePrice)}</span>
                      {/* Quantity */}
                      <span className="relative text-right text-white/50">{formatQty(level.quantity)}</span>
                      {/* Total */}
                      <span className="relative text-right text-white/30">{formatTotal(level.total)}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Spread / Mid Price Row */}
            <div className="flex items-center justify-center px-3 py-1.5 border-y border-white/[0.06] bg-white/[0.02] shrink-0 gap-3">
              <span className="text-xs font-mono font-bold text-white/90">
                {formatPrice(orderBook.midPrice, basePrice)}
              </span>
              <span className="text-[9px] font-mono text-yellow-400/60">
                {formatPrice(orderBook.spread, basePrice)}
              </span>
            </div>

            {/* Bids — scrollable, pinned to top */}
            <div
              ref={bidsContainerRef}
              className="flex-1 overflow-hidden min-h-0"
              style={{ minHeight: 0 }}
            >
              <div className="flex flex-col h-full">
                {orderBook.bids.map((level, i) => {
                  const pct = (level.total / maxBidTotal) * 100;
                  const flash = flashes['b' + level.price];
                  return (
                    <div
                      key={`bid-${i}`}
                      className={`grid grid-cols-3 px-3 py-[2px] relative text-[10px] font-mono transition-colors duration-100 ${
                        flash === 'up' ? 'bg-green-500/10' : flash === 'down' ? 'bg-green-500/15' : ''
                      }`}
                    >
                      {/* Volume bar background */}
                      <div
                        className="absolute right-0 top-0 bottom-0 bg-green-500/[0.07]"
                        style={{ width: `${pct}%` }}
                      />
                      {/* Price */}
                      <span className="relative text-green-400/90">{formatPrice(level.price, basePrice)}</span>
                      {/* Quantity */}
                      <span className="relative text-right text-white/50">{formatQty(level.quantity)}</span>
                      {/* Total */}
                      <span className="relative text-right text-white/30">{formatTotal(level.total)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Footer — aggregate stats */}
      {orderBook && (
        <div className="px-3 py-1.5 border-t border-white/[0.04] shrink-0 grid grid-cols-2 gap-2">
          <div>
            <div className="text-[8px] text-red-400/50 uppercase tracking-wider mb-0.5">Продажа</div>
            <div className="text-[10px] font-mono text-white/60">
              Σ {formatTotal(orderBook.asks.reduce((s, a) => s + a.quantity, 0))}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[8px] text-green-400/50 uppercase tracking-wider mb-0.5">Покупка</div>
            <div className="text-[10px] font-mono text-white/60">
              Σ {formatTotal(orderBook.bids.reduce((s, b) => s + b.quantity, 0))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}