'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2, TrendingUp, TrendingDown, ArrowUpCircle, ArrowDownCircle, Clock, Activity, ChevronDown, ChevronUp, Wallet, BarChart3 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface OpenTradeWithPnl {
  id: string;
  symbol: string;
  strategy_id: string;
  entry_price: number;
  amount: number;
  leverage: number;
  direction: string;
  opened_at: string;
  currentPrice: number;
  unrealizedPnl: number;
}

interface StrategyData {
  strategyId: string;
  balance: number;
  initial_balance: number;
  unrealizedPnl: number;
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
    entry_price: number;
    exit_price: number;
    amount: number;
    leverage: number;
    direction: string;
    pnl: number;
    opened_at: string;
    closed_at: string;
  }>;
  openTrades: OpenTradeWithPnl[];
  strategies: StrategyData[];
  totalBalance: number;
  totalUnrealized: number;
  totalClosedPnl: number;
}

interface ActivityNotificationProps {
  onComplete: () => void;
}

const STRATEGY_NAMES: Record<string, string> = {
  'momentum': 'Импульс Pro',
  'scalper': 'Scalp Hunter',
  'position-alpha': 'Position Alpha',
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

const STRATEGY_BAR: Record<string, string> = {
  'momentum': 'bg-emerald-400',
  'scalper': 'bg-amber-400',
  'position-alpha': 'bg-blue-400',
};

function formatTime(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch {
    return dateStr;
  }
}

function formatPnl(pnl: number): string {
  const sign = pnl >= 0 ? '+' : '';
  return `${sign}$${pnl.toFixed(2)}`;
}

function formatCoin(symbol: string): string {
  return symbol.replace('USDT', '');
}

export default function ActivityNotification({ onComplete }: ActivityNotificationProps) {
  const [data, setData] = useState<ActivityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAllClosed, setShowAllClosed] = useState(false);
  const [showAllOpen, setShowAllOpen] = useState(false);

  useEffect(() => {
    fetch('/api/activity-since')
      .then(r => r.json())
      .then(d => {
        setData(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const handleDismiss = () => {
    onComplete();
  };

  // When loading is done and no changes, skip automatically
  useEffect(() => {
    if (!loading && data && !data.hasChanges) {
      onComplete();
    }
  }, [loading, data, onComplete]);

  const isFirstTime = data?.lastLogin === null;

  if (loading || !data) {
    return (
      <div className="fixed inset-0 z-[300] bg-[#0a0a0f]/95 backdrop-blur-sm flex items-center justify-center">
        <Loader2 className="h-8 w-8 text-emerald-400 animate-spin" />
      </div>
    );
  }

  if (!data.hasChanges) {
    return null;
  }

  // Aggregate stats
  const winningClosed = data.closedTrades.filter(t => t.pnl > 0).length;
  const losingClosed = data.closedTrades.filter(t => t.pnl <= 0).length;
  const winningOpen = data.openTrades.filter(t => t.unrealizedPnl > 0).length;
  const losingOpen = data.openTrades.filter(t => t.unrealizedPnl <= 0).length;
  const visibleClosed = showAllClosed ? data.closedTrades : data.closedTrades.slice(0, 5);
  const visibleOpen = showAllOpen ? data.openTrades : data.openTrades.slice(0, 8);

  // Sort open trades by absolute unrealized PnL (biggest movers first)
  const sortedOpen = [...visibleOpen].sort((a, b) => Math.abs(b.unrealizedPnl) - Math.abs(a.unrealizedPnl));

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

            {/* Summary: Portfolio overview */}
            <div className="grid grid-cols-3 gap-2 mb-3 shrink-0">
              <div className="bg-white/[0.03] rounded-lg p-2.5 text-center">
                <div className="text-[10px] text-white/30 uppercase tracking-wider mb-0.5">Баланс</div>
                <div className="text-sm font-bold text-white font-mono">${data.totalBalance.toFixed(0)}</div>
                <div className="text-[9px] text-white/20 font-mono">
                  {data.totalUnrealized >= 0 ? '+' : ''}{data.totalUnrealized.toFixed(2)} нереал.
                </div>
              </div>
              <div className="bg-white/[0.03] rounded-lg p-2.5 text-center">
                <div className="text-[10px] text-white/30 uppercase tracking-wider mb-0.5">PnL закрыт.</div>
                <div className={cn('text-sm font-bold font-mono', data.totalClosedPnl >= 0 ? 'text-green-400' : 'text-red-400')}>
                  {formatPnl(data.totalClosedPnl)}
                </div>
                <div className="text-[9px] text-white/20 font-mono">
                  {winningClosed}✓ {losingClosed}✗
                </div>
              </div>
              <div className="bg-white/[0.03] rounded-lg p-2.5 text-center">
                <div className="text-[10px] text-white/30 uppercase tracking-wider mb-0.5">Нереализ.</div>
                <div className={cn('text-sm font-bold font-mono', data.totalUnrealized >= 0 ? 'text-green-400' : 'text-red-400')}>
                  {formatPnl(data.totalUnrealized)}
                </div>
                <div className="text-[9px] text-white/20 font-mono">
                  {winningOpen}↑ {losingOpen}↓
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
                    Результат по стратегиям
                  </div>
                  <div className="space-y-1.5">
                    {data.strategies.map(st => {
                      const totalPnl = st.closedPnlTotal + st.unrealizedPnl;
                      const depositPct = st.initial_balance > 0
                        ? ((totalPnl) / st.initial_balance * 100)
                        : 0;
                      return (
                        <div key={st.strategyId} className={cn('rounded-lg border px-3 py-2.5', STRATEGY_BG[st.strategyId])}>
                          <div className="flex items-center justify-between mb-1.5">
                            <span className={cn('text-[11px] font-mono font-bold', STRATEGY_COLORS[st.strategyId])}>
                              {STRATEGY_NAMES[st.strategyId] || st.strategyId}
                            </span>
                            <span className={cn('text-[11px] font-mono font-bold', totalPnl >= 0 ? 'text-green-400' : 'text-red-400')}>
                              {formatPnl(totalPnl)}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 text-[10px] font-mono">
                            <span className="text-white/30">
                              Депозит: <span className="text-white/50">${st.initial_balance.toFixed(0)}</span>
                            </span>
                            <span className="text-white/30">
                              Баланс: <span className="text-white/50">${st.balance.toFixed(0)}</span>
                            </span>
                            <span className={cn('font-bold', depositPct >= 0 ? 'text-green-400' : 'text-red-400')}>
                              {depositPct >= 0 ? '+' : ''}{depositPct.toFixed(1)}%
                            </span>
                          </div>
                          <div className="flex items-center gap-3 text-[9px] font-mono text-white/20 mt-1">
                            <span>Реал. PnL: <span className={st.closedPnlTotal >= 0 ? 'text-green-400/60' : 'text-red-400/60'}>{formatPnl(st.closedPnlTotal)}</span></span>
                            <span>Нереал.: <span className={st.unrealizedPnl >= 0 ? 'text-green-400/60' : 'text-red-400/60'}>{formatPnl(st.unrealizedPnl)}</span></span>
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
                    {sortedOpen.map(t => (
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

              {/* Closed trades (only if there are any) */}
              {visibleClosed.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-white/25 font-medium mb-2 flex items-center gap-1.5">
                    <TrendingDown className="w-3 h-3" />
                    Закрытые за период ({data.closedTrades.length})
                  </div>
                  <div className="space-y-1.5">
                    {visibleClosed.map(t => (
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
                          <span className="text-[9px] text-white/15 font-mono hidden sm:inline">
                            {formatTime(t.closed_at)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                  {data.closedTrades.length > 5 && (
                    <button
                      onClick={() => setShowAllClosed(!showAllClosed)}
                      className="flex items-center gap-1 text-[10px] text-white/30 hover:text-white/50 mx-auto mt-2 transition-colors"
                    >
                      {showAllClosed ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                      {showAllClosed ? 'Свернуть' : `Ещё ${data.closedTrades.length - 5}`}
                    </button>
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
