'use client';

import { useEffect, useRef, useState } from 'react';
import { useTerminalStore } from '@/lib/store';
import { Input } from '@/components/ui/input';
import { Search } from 'lucide-react';
import { TOP_50_SYMBOLS } from '@/lib/types';

export default function CoinList() {
  const { coins, selectedSymbol, setSelectedSymbol, updateCoinPrice } = useTerminalStore();
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [search, setSearch] = useState('');

  const filteredCoins = coins.filter(
    (c) =>
      c.symbol.toLowerCase().includes(search.toLowerCase()) ||
      c.symbol.replace('USDT', '').toLowerCase().includes(search.toLowerCase())
  );

  useEffect(() => {
    let active = true;

    function connect() {
      if (!active) return;
      if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
        return;
      }

      const streams = TOP_50_SYMBOLS.map(s => `${s.toLowerCase()}@miniTicker`).join('/');
      const ws = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streams}`);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[CoinList] Connected to Binance WS');
      };

      ws.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data);
          // Binance sends error response if any stream is invalid
          if (parsed.error) {
            console.error('[CoinList] Binance WS error:', parsed.error);
            ws.close();
            return;
          }
          if (parsed.data) {
            const d = parsed.data;
            updateCoinPrice({
              s: d.s,
              c: d.c,
              P: d.P ?? '0',
              v: d.v ?? '0',
              h: d.h ?? '0',
              l: d.l ?? '0',
              o: d.o ?? '0',
            });
          }
        } catch {
          // ignore parse errors
        }
      };

      ws.onclose = () => {
        if (!active) return;
        console.log('[CoinList] WS closed, reconnecting in 3s...');
        wsRef.current = null;
        reconnectTimerRef.current = setTimeout(connect, 3000);
      };

      ws.onerror = (err) => {
        console.error('[CoinList] WS error, closing');
        ws.close();
      };
    }

    connect();

    return () => {
      active = false;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
      }
    };
  }, [updateCoinPrice]);

  return (
    <div className="flex flex-col h-full bg-[#0d0d14] border-r border-white/[0.06]">
      <div className="p-2.5 border-b border-white/[0.06]">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-white/25" />
          <Input
            placeholder="Поиск..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-8 bg-white/[0.04] border-white/[0.06] text-xs text-white/90 placeholder:text-white/25 rounded-lg focus:ring-1 focus:ring-white/15"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto coin-list-scroll">
        <div className="p-1.5 space-y-px">
          {filteredCoins.map((coin) => {
            const isSelected = coin.symbol === selectedSymbol;
            const isPositive = coin.change24h >= 0;
            return (
              <button
                key={coin.symbol}
                onClick={() => setSelectedSymbol(coin.symbol)}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg transition-all duration-150
                  ${isSelected
                    ? 'bg-white/[0.08] border-l-2 border-l-emerald-400'
                    : 'hover:bg-white/[0.04] border-l-2 border-l-transparent'
                  }`}
              >
                <div className="flex flex-col items-start min-w-0">
                  <span className={`text-xs font-semibold truncate ${isSelected ? 'text-white' : 'text-white/70'}`}>
                    {coin.symbol.replace('USDT', '')}
                  </span>
                  <span className="text-[10px] text-white/20 font-mono">USDT</span>
                </div>
                <div className="flex flex-col items-end">
                  <span
                    className={`text-xs font-mono font-medium transition-colors duration-300
                      ${coin.flashDirection === 'up' ? 'text-green-400' : coin.flashDirection === 'down' ? 'text-red-400' : 'text-white/70'}`}
                  >
                    {coin.price < 1
                      ? coin.price.toPrecision(4)
                      : coin.price < 100
                        ? coin.price.toFixed(4)
                        : coin.price.toFixed(2)}
                  </span>
                  <span className={`text-[10px] font-mono ${isPositive ? 'text-green-400/60' : 'text-red-400/60'}`}>
                    {isPositive ? '+' : ''}
                    {coin.change24h.toFixed(2)}%
                  </span>
                </div>
              </button>
            );
          })}
          {filteredCoins.length === 0 && (
            <div className="py-8 text-center text-xs text-white/25">
              <div className="w-4 h-4 border-2 border-white/10 border-t-white/25 rounded-full animate-spin mx-auto mb-2" />
              Загрузка монет...
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
