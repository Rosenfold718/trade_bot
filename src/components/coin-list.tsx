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
          // ignore
        }
      };

      ws.onclose = () => {
        if (!active) return;
        console.log('[CoinList] WS closed, reconnecting in 3s...');
        wsRef.current = null;
        reconnectTimerRef.current = setTimeout(connect, 3000);
      };

      ws.onerror = () => {
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
    <div className="flex flex-col h-full bg-[#0d0d14] border-r border-white/5">
      <div className="p-3 border-b border-white/5">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-white/30" />
          <Input
            placeholder="Поиск монеты..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-8 bg-white/5 border-white/10 text-xs text-white/90 placeholder:text-white/30 rounded-md focus:ring-1 focus:ring-white/20"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto coin-list-scroll">
        <div className="p-1.5 space-y-0.5">
          {filteredCoins.map((coin) => {
            const isSelected = coin.symbol === selectedSymbol;
            const isPositive = coin.change24h >= 0;
            return (
              <button
                key={coin.symbol}
                onClick={() => setSelectedSymbol(coin.symbol)}
                className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg transition-all duration-150
                  ${isSelected
                    ? 'bg-white/10 border border-white/10'
                    : 'hover:bg-white/5 border border-transparent'
                  }`}
              >
                <div className="flex flex-col items-start min-w-0">
                  <span className="text-xs font-semibold text-white/90 truncate">
                    {coin.symbol.replace('USDT', '')}
                  </span>
                  <span className="text-[10px] text-white/35 font-mono">USDT</span>
                </div>
                <div className="flex flex-col items-end">
                  <span
                    className={`text-xs font-mono font-medium transition-colors duration-300
                      ${coin.flashDirection === 'up' ? 'text-green-400' : coin.flashDirection === 'down' ? 'text-red-400' : 'text-white/80'}`}
                  >
                    {coin.price < 1
                      ? coin.price.toPrecision(4)
                      : coin.price < 100
                        ? coin.price.toFixed(4)
                        : coin.price.toFixed(2)}
                  </span>
                  <span className={`text-[10px] font-mono ${isPositive ? 'text-green-400/70' : 'text-red-400/70'}`}>
                    {isPositive ? '+' : ''}
                    {coin.change24h.toFixed(2)}%
                  </span>
                </div>
              </button>
            );
          })}
          {filteredCoins.length === 0 && (
            <div className="py-8 text-center text-xs text-white/30">
              <div className="w-4 h-4 border-2 border-white/10 border-t-white/30 rounded-full animate-spin mx-auto mb-2" />
              Загрузка монет...
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
