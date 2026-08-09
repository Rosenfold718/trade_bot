'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2, TrendingDown, ArrowUpCircle, ArrowDownCircle, Clock, Activity, ChevronDown, ChevronUp, Wallet, BarChart3 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface OpenTrade {
  id: string;
  symbol: string;
  strategy_id: string;
  entry_price: number;
  amount: number;
  leverage: number;
  direction: string;
  opened_at: string;
}

interface StrategyData {
  strategyId: string;
  balance: number;
  initial_balance: number;
  totalLocked: number;
  closedPnlTotal: number;
  openTradeCount: number;
}

interface ActivityData {
  hasChanges: boolean;
  lastLogin: string | null;
  lastLoginTime: string;
  timeAgo: string;
  closedTrades: Array<{
    id: string;
    symbol: string;
    strategy_id: string;
    direction: string;
    pnl: number;
    opened_at: string;
    closed_at: string;
  }>;
  openTrades: OpenTrade[];
  strategies: StrategyData[];
  totalBalance: number;
  totalLocked: number;
  totalClosedPnl: number;
}

interface ActivityNotificationProps {
  onComplete: () => void;
}

const STRATEGY_NAMES: Record<string, string> = {
  'momentum': 'Трендовая торговля',
  'scalper': 'Паттерны',
  'position-alpha': 'Инвестиции',
};

const STRATEGY_COLORS: Record<string, string> = {
  'momentum': 'text-emerald-400',
  'scalper': 'text-amber-400',
  'position-alpha': 'text-blue-400',
};

const STRATEGY_BG: Record<string, string> = {
  'momentum': 'bg-emerald-500/10 border-emerald-500/20',
  'scalper': 'bg-amber-500/10 border-amber-500/20',
  'position-alpha': 'bg-blue-500/10 border-blue-500/20',
};

function formatPnl(pnl: number): string {
  const sign = pnl >= 0 ? '+' : '';
  return `${sign}$${pnl.toFixed(2)}`;
}

function formatCoin(symbol: string): string {
  return symbol.replace('USDT', '');
}

// Fetch live prices from Binance (client-side — browser can reach it)
// Uses our server cache first, then falls back to direct Binance API
async function fetchLivePrices(symbols: string[]): Promise<Record<string, number>> {
  const prices: Record<string, number> = {};
  if (symbols.length === 0) return prices;
  const unique = [...new Set(symbols)];
  
  // Try server cache first (faster, deduplicated)
  try {
    for (let i = 0; i < unique.length; i += 20) {
      const batch = unique.slice(i, i + 20);
      const res = await fetch(`/api/prices?symbols=${batch.join(',')}`);
      if (res.ok) {
        const data = await res.json();
        if (data.prices) {
          for (const [sym, price] of Object.entries(data.prices)) {
            if (typeof price === 'number' && price > 0) prices[sym] = price;
          }
        }
        // Also get any that errored — we'll try direct Binance for those
        if (data.errors && Array.isArray(data.errors)) {
          const missing = data.errors.filter((e: string) => !prices[e]);
          if (missing.length > 0) await fetchPricesDirect(missing, prices);
        }
      }
    }
  } catch { 
    // Server cache failed entirely — fall back to direct
    await fetchPricesDirect(unique, prices);
  }
  
  return prices;
}

// Direct Binance API fallback for individual symbols
async function fetchPricesDirect(symbols: string[], prices: Record<string, number>): Promise<void> {
  await Promise.all(symbols.map(async (sym) => {
    if (prices[sym]) return; // already have price
    try {
      const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${sym}`);
      if (res.ok) {
        const data = await res.json();
        const price = parseFloat(data.price);
        if (price > 0) prices[sym] = price;
      }
    } catch { /* skip */ }
  }));
}

// Calculate unrealized PnL for a single trade
function calcUnrealizedPnl(trade: OpenTrade, currentPrice: number): number {
  const priceDiff = trade.direction === 'long'
    ? (currentPrice - trade.entry_price) / trade.entry_price
    : (trade.entry_price - currentPrice) / trade.entry_price;
  return trade.amount * priceDiff * trade.leverage;
}

export default function ActivityNotification({ onComplete }: ActivityNotificationProps) {
  const { data: session } = useSession();
  const userId = (session?.user as any)?.id;
  const [data, setData] = useState<ActivityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [pricesFetched, setPricesFetched] = useState(false);
  const [showAllOpen, setShowAllOpen] = useState(false);

  // Step 1: fetch activity data from our API
  useEffect(() => {
    fetch('/api/activity-since')
      .then(r => r.json())
      .then(d => {
        setData(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  // Step 2: fetch live prices once we have open trades
  useEffect(() => {
    if (!data?.openTrades?.length) return;
    const symbols = data.openTrades.map(t => t.symbol);
    fetchLivePrices(symbols).then(p => {
      setPrices(p);
      setPricesFetched(true);
    });
  }, [data?.openTrades]);

  // Prices are loaded if: no open trades (nothing to fetch) or fetch completed
  const pricesReady = !data?.openTrades?.length || pricesFetched;

  // Mark session as seen: update last_login via warning-dismissed endpoint
  const markSessionSeen = () => {
    if (!userId) return;
    fetch('/api/warning-dismissed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    }).catch(() => { /* non-critical */ });
  };

  const handleDismiss = () => {
    markSessionSeen();
    onComplete();
  };

  // Auto-skip if no changes
  useEffect(() => {
    if (!loading && data && !data.hasChanges) {
      markSessionSeen();
      onComplete();
    }
  }, [loading, data, onComplete]);

  const isFirstTime = data?.lastLogin === null;

  // Calculate derived values — only after prices are loaded
  const openWithPnl = (pricesReady ? data?.openTrades : []).map(t => {
    const currentPrice = prices[t.symbol] ?? t.entry_price;
    const unrealizedPnl = calcUnrealizedPnl(t, currentPrice);
    return { ...t, currentPrice, unrealizedPnl };
  }) ?? [];

  // Per-strategy unrealized PnL
  const strategyUnrealized: Record<string, number> = {};
  for (const t of openWithPnl) {
    strategyUnrealized[t.strategy_id] = (strategyUnrealized[t.strategy_id] ?? 0) + t.unrealizedPnl;
  }

  // Totals
  const totalUnrealized = openWithPnl.reduce((s, t) => s + t.unrealizedPnl, 0);

  if (loading || !data || !pricesReady) {
    return (
      <div className="fixed inset-0 z-[300] bg-[#0a0a0f]/95 backdrop-blur-sm flex items-center justify-center">
        <Loader2 className="h-8 w-8 text-emerald-400 animate-spin" />
      </div>
    );
  }

  if (!data.hasChanges) return null;

  const winningClosed = data.closedTrades.filter(t => t.pnl > 0).length;
  const losingClosed = data.closedTrades.filter(t => t.pnl <= 0).length;
  const sortedOpen = [...openWithPnl].sort((a, b) => Math.abs(b.unrealizedPnl) - Math.abs(a.unrealizedPnl));
  const visibleOpen = showAllOpen ? sortedOpen : sortedOpen.slice(0, 8);

  return (
    <div className="fixed inset-0 z-[300] bg-[#0a0a0f]/95 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-lg max-h-[85vh] flex flex-col">
        <Card className="bg-[#12121e]/95 backdrop-blur-xl border-white/[0.06] rounded-2xl shadow-2xl flex-1 min-h-0 flex flex-col">
          <CardContent className="p-5 flex-1 min-h-0 flex flex-col overflow-hidden">
            {/* Header */}
            <div className="flex items-center gap-3 mb-4 shrink-0">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                <Activity className="h-5 w-5 text-emerald-400" />
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-base font-bold text-white">
                  {isFirstTime ? 'Текущее состояние аккаунта' : 'Что произошло за ваше отсутствие'}
                </h2>
                <div className="flex items-center gap-2 text-[10px] text-white/30 font-mono">
                  <Clock className="w-3 h-3" />
                  <span>{isFirstTime ? `Активность за 24 ч.` : `${data.lastLoginTime} (${data.timeAgo} назад)`}</span>
                </div>
              </div>
            </div>

            {/* Summary cards */}
            <div className="grid grid-cols-3 gap-2 mb-3 shrink-0">
              <div className="bg-white/[0.03] rounded-lg p-2.5 text-center">
                <div className="text-[10px] text-white/30 uppercase tracking-wider mb-0.5">Чистая стоимость</div>
                <div className="text-sm font-bold text-white font-mono">
                  ${(data.totalBalance + data.totalLocked).toFixed(0)}
                </div>
                <div className="text-[9px] text-white/20 font-mono">
                  ${data.totalLocked.toFixed(0)} в сделках
                </div>
              </div>
              <div className="bg-white/[0.03] rounded-lg p-2.5 text-center">
                <div className="text-[10px] text-white/30 uppercase tracking-wider mb-0.5">PnL закрытых</div>
                <div className={cn('text-sm font-bold font-mono', data.totalClosedPnl >= 0 ? 'text-green-400' : 'text-red-400')}>
                  {formatPnl(data.totalClosedPnl)}
                </div>
                <div className="text-[9px] text-white/20 font-mono">
                  {winningClosed}✓ {losingClosed}✗
                </div>
              </div>
              <div className="bg-white/[0.03] rounded-lg p-2.5 text-center">
                <div className="text-[10px] text-white/30 uppercase tracking-wider mb-0.5">Нереализ. PnL</div>
                <div className={cn('text-sm font-bold font-mono', totalUnrealized >= 0 ? 'text-green-400' : 'text-red-400')}>
                  {formatPnl(totalUnrealized)}
                </div>
                <div className="text-[9px] text-white/20 font-mono">
                  {data.openTrades.length} сделок
                </div>
              </div>
            </div>

            {/* Scrollable content */}
            <div className="flex-1 min-h-0 overflow-y-auto space-y-3 pr-1 custom-scroll">
              {/* Per-strategy breakdown */}
              {data.strategies.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-white/25 font-medium mb-2 flex items-center gap-1.5">
                    <BarChart3 className="w-3 h-3" />
                    По стратегиям
                  </div>
                  <div className="space-y-1.5">
                    {data.strategies.map(st => {
                      const netValue = st.balance + st.totalLocked; // available + locked in trades
                      const unrealized = strategyUnrealized[st.strategyId] ?? 0;
                      const totalEquity = netValue + unrealized;
                      // Return% based on actual equity vs initial deposit (all-time accurate)
                      const returnPct = st.initial_balance > 0
                        ? ((totalEquity - st.initial_balance) / st.initial_balance) * 100
                        : 0;

                      return (
                        <div key={st.strategyId} className={cn('rounded-lg border px-3 py-2.5', STRATEGY_BG[st.strategyId])}>
                          <div className="flex items-center justify-between mb-1.5">
                            <span className={cn('text-[11px] font-mono font-bold', STRATEGY_COLORS[st.strategyId])}>
                              {STRATEGY_NAMES[st.strategyId] || st.strategyId}
                            </span>
                            <div className="flex items-center gap-2">
                              <span className="text-[11px] font-mono text-white/50">
                                ${netValue.toFixed(0)}
                              </span>
                              <span className={cn('text-[11px] font-mono font-bold', returnPct >= 0 ? 'text-green-400' : 'text-red-400')}>
                                {returnPct >= 0 ? '+' : ''}{returnPct.toFixed(1)}%
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center gap-3 text-[10px] font-mono">
                            <span className="text-white/30">
                              Депозит: <span className="text-white/50">${st.initial_balance.toFixed(0)}</span>
                            </span>
                            <span className="text-white/30">
                              Свободн.: <span className="text-white/50">${st.balance.toFixed(0)}</span>
                            </span>
                            <span className="text-white/30">
                              В сделках: <span className="text-white/50">${st.totalLocked.toFixed(0)}</span>
                            </span>
                          </div>
                          <div className="flex items-center gap-3 text-[9px] font-mono text-white/20 mt-1">
                            <span>Реал.: <span className={st.closedPnlTotal >= 0 ? 'text-green-400/60' : 'text-red-400/60'}>{formatPnl(st.closedPnlTotal)}</span></span>
                            <span>Нереал.: <span className={unrealized >= 0 ? 'text-green-400/60' : 'text-red-400/60'}>{formatPnl(unrealized)}</span></span>
                            <span>{st.openTradeCount} откр.</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Open trades with unrealized PnL */}
              {sortedOpen.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-white/25 font-medium mb-2 flex items-center gap-1.5">
                    <Wallet className="w-3 h-3" />
                    Открытые сделки ({data.openTrades.length})
                  </div>
                  <div className="space-y-1.5">
                    {visibleOpen.map(t => (
                      <div key={t.id} className="bg-white/[0.03] rounded-lg px-3 py-2 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          {t.direction === 'long' ? (
                            <ArrowUpCircle className="w-3.5 h-3.5 text-green-400 shrink-0" />
                          ) : (
                            <ArrowDownCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                          )}
                          <div className="min-w-0">
                            <span className="text-[11px] text-white font-mono">{formatCoin(t.symbol)}</span>
                            <span className="text-[9px] text-white/20 ml-1">{(STRATEGY_NAMES[t.strategy_id] || t.strategy_id).split(' ')[0]}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <span className="text-[10px] text-white/30 font-mono">{t.leverage}x</span>
                          <span className={cn(
                            'text-[11px] font-mono font-bold min-w-[60px] text-right',
                            t.unrealizedPnl >= 0 ? 'text-green-400' : 'text-red-400'
                          )}>
                            {formatPnl(t.unrealizedPnl)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                  {data.openTrades.length > 8 && (
                    <button
                      onClick={() => setShowAllOpen(!showAllOpen)}
                      className="flex items-center gap-1 text-[10px] text-white/30 hover:text-white/50 mx-auto mt-2 transition-colors"
                    >
                      {showAllOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                      {showAllOpen ? 'Свернуть' : `Ещё ${data.openTrades.length - 8}`}
                    </button>
                  )}
                </div>
              )}

              {/* Closed trades (only if any) */}
              {data.closedTrades.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-white/25 font-medium mb-2 flex items-center gap-1.5">
                    <TrendingDown className="w-3 h-3" />
                    Закрытые за период ({data.closedTrades.length})
                  </div>
                  <div className="space-y-1.5">
                    {data.closedTrades.slice(0, 5).map(t => (
                      <div key={t.id} className="bg-white/[0.03] rounded-lg px-3 py-2 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          {t.direction === 'long' ? (
                            <ArrowUpCircle className="w-3.5 h-3.5 text-green-400 shrink-0" />
                          ) : (
                            <ArrowDownCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                          )}
                          <div className="min-w-0">
                            <span className="text-[11px] text-white font-mono">{formatCoin(t.symbol)}</span>
                            <span className="text-[9px] text-white/20 ml-1">{(STRATEGY_NAMES[t.strategy_id] || t.strategy_id).split(' ')[0]}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <span className={cn('text-[11px] font-mono font-bold', t.pnl >= 0 ? 'text-green-400' : 'text-red-400')}>
                            {formatPnl(t.pnl)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                  {data.closedTrades.length > 5 && (
                    <p className="text-[9px] text-white/20 text-center mt-1">
                      и ещё {data.closedTrades.length - 5} сделок
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="pt-4 mt-3 border-t border-white/[0.04] shrink-0">
              <Button
                onClick={handleDismiss}
                className="w-full h-10 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold rounded-lg transition-all"
              >
                Понятно
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
