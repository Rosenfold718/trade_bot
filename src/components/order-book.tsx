'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useTerminalStore } from '@/lib/store';
import type { OrderBookLevel, OrderBookData } from '@/lib/types';
import { resolveSymbol, hasAlias } from '@/lib/symbol-alias';
import { RefreshCw, WifiOff, AlertTriangle } from 'lucide-react';

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

type ConnectionMode = 'ws' | 'rest' | 'error' | 'empty';

export default function OrderBook() {
  const { selectedSymbol } = useTerminalStore();
  const [orderBook, setOrderBook] = useState<OrderBookData | null>(null);
  const [flashes, setFlashes] = useState<FlashMap>({});
  const [mode, setMode] = useState<ConnectionMode>('ws');
  const prevDataRef = useRef<Map<string, number>>(new Map());
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dataTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const failCountRef = useRef(0);

  // Keep asks/bids pinned to the center
  const asksContainerRef = useRef<HTMLDivElement>(null);
  const bidsContainerRef = useRef<HTMLDivElement>(null);

  // Resolve symbol: use alias if available (e.g., MATICUSDT → POLUSDT for orderbook)
  const effectiveSymbol = resolveSymbol(selectedSymbol);
  const isAliased = hasAlias(selectedSymbol);

  const processDepth = useCallback((raw: {
    lastUpdateId?: number;
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
    setMode('ws');

    // Clear flashes after 200ms
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => setFlashes({}), 200);

    // Clear data-received timeout on first real data
    if (dataTimeoutRef.current && (asks.length > 0 || bids.length > 0)) {
      clearTimeout(dataTimeoutRef.current);
      dataTimeoutRef.current = null;
    }
  }, []);

  // ── Cleanup helper (must be declared before startRestPolling) ──
  const stopAll = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
      wsRef.current = null;
    }
    if (reconnectRef.current) { clearTimeout(reconnectRef.current); reconnectRef.current = null; }
    if (wsTimeoutRef.current) { clearTimeout(wsTimeoutRef.current); wsTimeoutRef.current = null; }
    if (dataTimeoutRef.current) { clearTimeout(dataTimeoutRef.current); dataTimeoutRef.current = null; }
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  const [errorDetail, setErrorDetail] = useState<string>('');

  // ── REST polling fallback ──
  const startRestPolling = useCallback(() => {
    stopAll();
    setMode('rest');
    failCountRef.current = 0;
    setErrorDetail('');

    const poll = async () => {
      try {
        // Use resolved symbol for the API call
        let data: any = null;
        try {
          const res = await fetch(`/api/orderbook?symbol=${effectiveSymbol}`);
          if (res.ok) {
            data = await res.json();
          } else {
            setErrorDetail(`API ${res.status}`);
          }
        } catch (apiErr) {
          setErrorDetail(apiErr instanceof Error ? apiErr.message : 'API error');
        }

        // Fallback: direct Binance REST (CORS works from browsers)
        if (!data?.bids?.length || !data?.asks?.length) {
          try {
            const binanceRes = await fetch(`https://api.binance.com/api/v3/depth?symbol=${effectiveSymbol}&limit=20`);
            if (binanceRes.ok) {
              data = await binanceRes.json();
            } else {
              setErrorDetail(`Binance ${binanceRes.status}`);
            }
          } catch (binanceErr) {
            setErrorDetail(binanceErr instanceof Error ? binanceErr.message : 'Binance error');
          }
        }

        if (data?.bids?.length > 0 && data?.asks?.length > 0) {
          processDepth(data);
          failCountRef.current = 0;
          setErrorDetail('');
          return;
        }

        // Empty orderbook (e.g., delisted/renamed symbol with no liquidity)
        if (data?.bids !== undefined && data?.asks !== undefined) {
          failCountRef.current++;
          if (failCountRef.current >= 3) {
            setMode('empty');
            setOrderBook(null);
            if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
          }
          return;
        }
        failCountRef.current++;
      } catch {
        failCountRef.current++;
      }
      // After 5 consecutive failures, show error state
      if (failCountRef.current >= 5) {
        setMode('error');
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      }
    };

    poll(); // immediate first fetch
    pollRef.current = setInterval(poll, 2000);
  }, [effectiveSymbol, processDepth, stopAll]);

  useEffect(() => {
    // Reset state on symbol change
    setOrderBook(null);
    setMode('ws');
    setErrorDetail('');
    prevDataRef.current.clear();

    let active = true;
    let wsConnected = false;
    let dataReceived = false;

    function connectWS() {
      if (!active) return;
      if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
        return;
      }

      // Use resolved symbol for WS stream
      const streamName = `${effectiveSymbol.toLowerCase()}@depth20@100ms`;
      let ws: WebSocket;
      try {
        ws = new WebSocket(`wss://stream.binance.com:9443/ws/${streamName}`);
      } catch {
        // WebSocket constructor can throw in restricted environments
        if (active) startRestPolling();
        return;
      }
      wsRef.current = ws;

      ws.onopen = () => {
        if (!active) return;
        wsConnected = true;
        if (wsTimeoutRef.current) { clearTimeout(wsTimeoutRef.current); wsTimeoutRef.current = null; }
        console.log(`[OrderBook] WS Connected: ${effectiveSymbol}${isAliased ? ` (alias for ${selectedSymbol})` : ''}`);

        // Data-received timeout: if no depth data arrives within 5s of connection,
        // the symbol likely has no orderbook (delisted/renamed). Fall back to REST
        // which will detect the empty orderbook and show appropriate UI.
        dataTimeoutRef.current = setTimeout(() => {
          if (active && !dataReceived) {
            console.log(`[OrderBook] No data received for ${effectiveSymbol} in 5s, falling back to REST`);
            if (wsRef.current) { wsRef.current.onclose = null; wsRef.current.close(); wsRef.current = null; }
            startRestPolling();
          }
        }, 5000);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.bids && data.asks) {
            if (data.bids.length > 0 || data.asks.length > 0) {
              dataReceived = true;
            }
            processDepth(data);
          }
        } catch {
          // ignore parse errors
        }
      };

      ws.onclose = () => {
        if (!active) return;
        wsRef.current = null;
        // If WS never received data, fall back to REST
        if (!dataReceived) {
          startRestPolling();
          return;
        }
        // If WS was working, try to reconnect
        reconnectRef.current = setTimeout(connectWS, 3000);
      };

      ws.onerror = () => {
        ws.close();
      };

      // Timeout: if WS doesn't connect in 4s, fall back to REST
      wsTimeoutRef.current = setTimeout(() => {
        if (!wsConnected && active) {
          console.log('[OrderBook] WS timeout, falling back to REST');
          if (wsRef.current) { wsRef.current.onclose = null; wsRef.current.close(); wsRef.current = null; }
          startRestPolling();
        }
      }, 4000);
    }

    connectWS();

    return () => {
      active = false;
      stopAll();
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    };
  }, [effectiveSymbol, selectedSymbol, isAliased, processDepth, startRestPolling, stopAll]);

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
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.06] shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-white/50 uppercase tracking-wider">Стакан</span>
          <div className="flex items-center gap-1">
            <div className={
              mode === 'error' || mode === 'empty'
                ? 'w-1.5 h-1.5 rounded-full bg-red-400'
                : mode === 'rest'
                  ? 'w-1.5 h-1.5 rounded-full bg-yellow-400/80'
                  : 'w-1.5 h-1.5 rounded-full bg-green-400/80 animate-pulse'
            } />
            <span className="text-[9px] text-white/20 font-mono">
              {mode === 'rest' ? 'POLL' : mode === 'error' ? 'OFF' : mode === 'empty' ? 'EMPTY' : 'LIVE'}
            </span>
          </div>
          {isAliased && (
            <span className="text-[9px] text-amber-400/50 font-mono">{effectiveSymbol.replace('USDT','')}</span>
          )}
        </div>
        {orderBook ? (
          <div className="flex items-center gap-2.5 text-[10px] font-mono">
            <div className="flex items-center gap-1">
              <span className="text-white/20">Спред</span>
              <span className="text-yellow-400/60 font-medium">{orderBook.spreadPercent.toFixed(3)}%</span>
            </div>
          </div>
        ) : mode === 'error' || mode === 'empty' ? (
          <button
            onClick={startRestPolling}
            className="text-white/30 hover:text-white/60 transition-colors"
            title="Retry"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        ) : null}
      </div>

      {/* Column Headers */}
      <div className="grid grid-cols-3 px-3 py-1.5 border-b border-white/[0.03] shrink-0">
        <span className="text-[10px] text-white/20 font-mono uppercase tracking-wider">Цена (USDT)</span>
        <span className="text-[10px] text-white/20 font-mono uppercase tracking-wider text-right">Объём</span>
        <span className="text-[10px] text-white/20 font-mono uppercase tracking-wider text-right">Всего</span>
      </div>

      {/* Order Book Body */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {mode === 'error' ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="flex flex-col items-center gap-2">
              <WifiOff className="w-5 h-5 text-white/15" />
              <span className="text-[10px] text-white/25">Нет подключения</span>
              {errorDetail && <span className="text-[9px] text-red-400/40 font-mono">{errorDetail}</span>}
              {!selectedSymbol && <span className="text-[9px] text-yellow-400/40">Символ не выбран</span>}
              <button
                onClick={startRestPolling}
                className="text-[10px] text-yellow-400/60 hover:text-yellow-400/90 transition-colors flex items-center gap-1"
              >
                <RefreshCw className="w-3 h-3" />
                Повторить
              </button>
            </div>
          </div>
        ) : mode === 'empty' ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="flex flex-col items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-400/30" />
              <span className="text-[10px] text-white/25">Стакан пуст</span>
              {isAliased && (
                <span className="text-[9px] text-amber-400/40 font-mono text-center px-4">
                  {selectedSymbol.replace('USDT','')} перенесён на {effectiveSymbol.replace('USDT','')}
                </span>
              )}
              <button
                onClick={startRestPolling}
                className="text-[10px] text-yellow-400/60 hover:text-yellow-400/90 transition-colors flex items-center gap-1"
              >
                <RefreshCw className="w-3 h-3" />
                Обновить
              </button>
            </div>
          </div>
        ) : !orderBook ? (
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
                      className={`grid grid-cols-3 px-3 py-[2px] relative text-xs font-mono transition-colors duration-100 ${
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
              <span className="text-sm font-mono font-bold text-white">
                {formatPrice(orderBook.midPrice, basePrice)}
              </span>
              <span className="text-[10px] font-mono text-yellow-400/50">
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
                      className={`grid grid-cols-3 px-3 py-[2px] relative text-xs font-mono transition-colors duration-100 ${
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
            <div className="text-[9px] text-red-400/40 uppercase tracking-wider mb-0.5">Продажа</div>
            <div className="text-[10px] font-mono text-white/50">
              Σ {formatTotal(orderBook.asks.reduce((s, a) => s + a.quantity, 0))}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[9px] text-green-400/40 uppercase tracking-wider mb-0.5">Покупка</div>
            <div className="text-[10px] font-mono text-white/50">
              Σ {formatTotal(orderBook.bids.reduce((s, b) => s + b.quantity, 0))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
