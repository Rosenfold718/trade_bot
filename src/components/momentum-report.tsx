'use client';

import { useState, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import {
  TrendingUp, TrendingDown, BarChart3, Target, Shield, Zap,
  ArrowUpRight, ArrowDownRight, Clock, DollarSign, Activity,
  AlertTriangle, CheckCircle2, XCircle, ChevronDown, ChevronUp,
  Loader2, BarChart2, PieChart, LineChart as LineChartIcon, Percent,
} from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

// ============================================================
// Types
// ============================================================

interface StrategyDescription {
  id: string;
  name: string;
  philosophy: string;
  entryRules: string[];
  exitRules: string[];
  riskManagement: string[];
}

interface AccountState {
  currentBalance: number;
  borrowedFunds: number;
  debtToRepay: number;
  totalEquity: number;
  startingBalance: number;
  totalReturn: number;
  totalReturnPct: number;
}

interface Performance {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnl: number;
  totalWinsAmount: number;
  totalLossesAmount: number;
  profitFactor: number | null;
  avgWin: number;
  avgLoss: number;
  largestWin: number;
  largestLoss: number;
  avgRiskReward: number;
  maxDrawdown: number;
  longTrades: number;
  shortTrades: number;
  longWinRate: number;
  shortWinRate: number;
  openTradesCount: number;
  currentUnrealizedPnl: number;
}

interface OpenTradeDetail {
  id: string;
  symbol: string;
  entry_price: number;
  amount: number;
  leverage: number;
  direction: 'long' | 'short';
  stop_loss: number | null;
  take_profit: number | null;
  opened_at: string;
  currentPrice: number;
  potential: string;
  decisionNarrative: string;
}

interface ClosedTradeDetail {
  id: string;
  symbol: string;
  entry_price: number;
  exit_price: number | null;
  amount: number;
  leverage: number;
  direction: 'long' | 'short';
  pnl: number | null;
  opened_at: string;
  closed_at: string | null;
  stop_loss: number | null;
  take_profit: number | null;
  decisionNarrative: string;
  closeNarrative: string;
}

interface BalancePoint {
  time: string;
  balance: number;
}

interface ReportData {
  strategy: StrategyDescription;
  accountState: AccountState;
  performance: Performance;
  symbolPerformance: Record<string, { count: number; wins: number; pnl: number }>;
  balanceHistory: BalancePoint[];
  openTrades: OpenTradeDetail[];
  closedTrades: ClosedTradeDetail[];
  potentialAssessment: string[];
  indicatorWeights: Array<{ id: string; indicator_name: string; weight: number; calculated_winrate: number | null }>;
}

// ============================================================
// Helpers
// ============================================================

function calcOpenPnl(trade: OpenTradeDetail): number {
  return trade.direction === 'long'
    ? (trade.currentPrice - trade.entry_price) / trade.entry_price * trade.amount * trade.leverage
    : (trade.entry_price - trade.currentPrice) / trade.entry_price * trade.amount * trade.leverage;
}

// ============================================================
// Main Component
// ============================================================

export default function MomentumReport({ onClose, strategyId = 'momentum' }: { onClose: () => void; strategyId?: string }) {
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'trades' | 'strategy'>('overview');
  const [expandedTrade, setExpandedTrade] = useState<string | null>(null);

  const fetchReport = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/strategy-report?strategyId=${strategyId}`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to load report');
      }
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchReport(); }, [fetchReport]);

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 bg-[#0a0a0f]/95 backdrop-blur-xl flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 text-amber-400/60 animate-spin" />
          <span className="text-sm text-white/40 tracking-widest">ЗАГРУЗКА ОТЧЁТА</span>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="fixed inset-0 z-50 bg-[#0a0a0f]/95 backdrop-blur-xl flex items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-center px-6">
          <AlertTriangle className="w-8 h-8 text-red-400/60" />
          <span className="text-sm text-red-400">{error || 'Нет данных'}</span>
          <button onClick={fetchReport} className="px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-xs text-white/60 hover:bg-white/10 transition-colors">
            Повторить
          </button>
          <button onClick={onClose} className="text-xs text-white/30 hover:text-white/50 transition-colors mt-2">
            Закрыть
          </button>
        </div>
      </div>
    );
  }

  const { strategy, accountState, performance, symbolPerformance, balanceHistory, openTrades, closedTrades, potentialAssessment } = data;
  const p = performance;

  const topSymbols = Object.entries(symbolPerformance)
    .sort(([, a], [, b]) => b.pnl - a.pnl);

  return (
    <div className="fixed inset-0 z-50 bg-[#0a0a0f] overflow-y-auto">
      <TooltipProvider>
        {/* Header */}
        <div className="sticky top-0 z-10 bg-[#0a0a0f]/90 backdrop-blur-xl border-b border-white/[0.06]">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/25 flex items-center justify-center">
                  <BarChart3 className="w-5 h-5 text-amber-400" />
                </div>
                <div>
                  <h1 className="text-lg font-bold text-white/95 tracking-tight">{strategy.name}</h1>
                  <p className="text-[11px] text-white/35 tracking-wider">АНАЛИТИЧЕСКИЙ ОТЧЁТ ПО СТРАТЕГИИ</p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/[0.06] text-xs text-white/50 hover:bg-white/10 hover:text-white/70 transition-all duration-200"
              >
                Назад к терминалу
              </button>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 mt-4">
              {(['overview', 'trades', 'strategy'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={cn(
                    'px-4 py-2 rounded-lg text-xs font-medium transition-all duration-200 tracking-wide',
                    activeTab === tab
                      ? 'bg-amber-500/10 text-amber-400 border border-amber-500/25'
                      : 'text-white/40 hover:text-white/60 hover:bg-white/5 border border-transparent',
                  )}
                >
                  {tab === 'overview' ? 'Обзор' : tab === 'trades' ? 'Сделки' : 'Логика стратегии'}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6 pb-24">
          {/* ====================== OVERVIEW TAB ====================== */}
          {activeTab === 'overview' && (
            <>
              {/* Key Metrics Row */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <MetricCard
                  label="БАЛАНС"
                  value={`$${accountState.currentBalance.toFixed(2)}`}
                  subtext={`Старт: $${accountState.startingBalance}`}
                  icon={<DollarSign className="w-4 h-4" />}
                  accent={accountState.totalReturnPct >= 0 ? 'text-emerald-400' : 'text-red-400'}
                />
                <MetricCard
                  label="ПРИБЫЛЬ"
                  value={`${accountState.totalReturnPct >= 0 ? '+' : ''}${accountState.totalReturnPct.toFixed(1)}%`}
                  subtext={`${accountState.totalReturn >= 0 ? '+' : ''}$${accountState.totalReturn.toFixed(2)}`}
                  icon={accountState.totalReturnPct >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                  accent={accountState.totalReturnPct >= 0 ? 'text-emerald-400' : 'text-red-400'}
                />
                <MetricCard
                  label="ВИНРЕЙТ"
                  value={`${p.winRate.toFixed(1)}%`}
                  subtext={`${p.wins}W / ${p.losses}L из ${p.totalTrades}`}
                  icon={<Target className="w-4 h-4" />}
                  accent={p.winRate >= 50 ? 'text-emerald-400' : p.winRate >= 40 ? 'text-amber-400' : 'text-red-400'}
                />
                <MetricCard
                  label="ПРОФИТ-ФАКТОР"
                  value={p.profitFactor !== null ? p.profitFactor.toFixed(2) : '∞'}
                  subtext={p.profitFactor !== null && p.profitFactor >= 1.5 ? 'Стабильно прибыльная' : p.profitFactor !== null && p.profitFactor >= 1.0 ? 'Маржинальная' : p.profitFactor === null ? 'Без убытков' : 'Убыточная'}
                  icon={<BarChart2 className="w-4 h-4" />}
                  accent={p.profitFactor !== null && p.profitFactor >= 1.5 ? 'text-emerald-400' : p.profitFactor !== null && p.profitFactor >= 1.0 ? 'text-amber-400' : p.profitFactor === null ? 'text-emerald-400' : 'text-red-400'}
                />
              </div>

              {/* Detailed Metrics */}
              <Card className="bg-[#0d0d14] border-white/[0.06]">
                <CardHeader className="pb-3">
                  <CardTitle className="text-xs font-semibold text-white/60 tracking-widest">ДЕТАЛЬНЫЕ МЕТРИКИ</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
                    <MiniMetric label="Ср. прибыль" value={`+$${p.avgWin.toFixed(2)}`} color="text-emerald-400" />
                    <MiniMetric label="Ср. убыток" value={`-$${p.avgLoss.toFixed(2)}`} color="text-red-400" />
                    <MiniMetric label="Макс. прибыль" value={`+$${p.largestWin.toFixed(2)}`} color="text-emerald-400" />
                    <MiniMetric label="Макс. убыток" value={`$${p.largestLoss.toFixed(2)}`} color="text-red-400" />
                    <MiniMetric label="Ср. R:R" value={p.avgRiskReward > 0 ? `1:${p.avgRiskReward.toFixed(1)}` : '—'} color="text-amber-400" />
                    <MiniMetric label="Макс. просадка" value={`${p.maxDrawdown.toFixed(1)}%`} color={p.maxDrawdown > 15 ? 'text-red-400' : p.maxDrawdown > 8 ? 'text-amber-400' : 'text-emerald-400'} />
                  </div>

                  <Separator className="bg-white/[0.04]" />

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-white/40 tracking-wide flex items-center gap-1.5">
                          <TrendingUp className="w-3 h-3 text-emerald-400" /> LONG
                        </span>
                        <span className="text-[11px] text-white/50 font-mono">{p.longTrades} сделок · {p.longWinRate.toFixed(0)}% win</span>
                      </div>
                      <Progress value={p.longWinRate} className="h-1.5 bg-white/5 [&>div]:bg-emerald-400" />
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-white/40 tracking-wide flex items-center gap-1.5">
                          <TrendingDown className="w-3 h-3 text-red-400" /> SHORT
                        </span>
                        <span className="text-[11px] text-white/50 font-mono">{p.shortTrades} сделок · {p.shortWinRate.toFixed(0)}% win</span>
                      </div>
                      <Progress value={p.shortWinRate} className="h-1.5 bg-white/5 [&>div]:bg-red-400" />
                    </div>
                  </div>

                  {p.openTradesCount > 0 && (
                    <>
                      <Separator className="bg-white/[0.04]" />
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-white/40 tracking-wide flex items-center gap-1.5">
                          <Activity className="w-3 h-3 text-amber-400" /> ОТКРЫТЫЕ СДЕЛКИ
                        </span>
                        <span className={cn('text-xs font-mono font-bold', p.currentUnrealizedPnl >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                          {p.currentUnrealizedPnl >= 0 ? '+' : ''}${p.currentUnrealizedPnl.toFixed(2)} нереализ.
                        </span>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>

              {/* Balance Equity Curve */}
              {balanceHistory.length > 2 && (
                <Card className="bg-[#0d0d14] border-white/[0.06]">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-xs font-semibold text-white/60 tracking-widest flex items-center gap-2">
                      <LineChartIcon className="w-3.5 h-3.5" />
                      ДИНАМИКА БАЛАНСА
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <EquityCurve data={balanceHistory} />
                  </CardContent>
                </Card>
              )}

              {/* Symbol Performance */}
              {topSymbols.length > 0 && (
                <Card className="bg-[#0d0d14] border-white/[0.06]">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-xs font-semibold text-white/60 tracking-widest flex items-center gap-2">
                      <PieChart className="w-3.5 h-3.5" />
                      РЕЗУЛЬТАТИВНОСТЬ ПО МОНЕТАМ
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2 max-h-72 overflow-y-auto custom-scrollbar">
                      {topSymbols.map(([symbol, stats]) => (
                        <div key={symbol} className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-white/[0.02] transition-colors">
                          <div className="flex items-center gap-3">
                            <span className="text-xs font-semibold text-white/80 w-20 truncate">{symbol.replace('USDT', '')}</span>
                            <span className="text-[10px] text-white/30 font-mono">{stats.count} сделок</span>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-[10px] text-white/30 font-mono">{stats.wins}/{stats.count} W</span>
                            <span className={cn('text-xs font-mono font-bold', stats.pnl >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                              {stats.pnl >= 0 ? '+' : ''}${stats.pnl.toFixed(2)}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Potential Assessment */}
              <Card className="bg-[#0d0d14] border-white/[0.06]">
                <CardHeader className="pb-3">
                  <CardTitle className="text-xs font-semibold text-white/60 tracking-widest flex items-center gap-2">
                    <Zap className="w-3.5 h-3.5 text-amber-400" />
                    ОЦЕНКА ПОТЕНЦИАЛА
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {potentialAssessment.map((text, i) => (
                    <div key={i} className="flex gap-3 items-start">
                      <div className="w-1.5 h-1.5 rounded-full bg-amber-400/50 mt-1.5 shrink-0" />
                      <p className="text-[12px] text-white/60 leading-relaxed">{text}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>

              {/* Open Trades Quick View */}
              {openTrades.length > 0 && (
                <Card className="bg-[#0d0d14] border-white/[0.06]">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-xs font-semibold text-white/60 tracking-widest flex items-center gap-2">
                      <Activity className="w-3.5 h-3.5 text-amber-400" />
                      АКТИВНЫЕ ПОЗИЦИИ
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {openTrades.map(trade => {
                      const pnl = calcOpenPnl(trade);
                      return (
                        <div key={trade.id} className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.04] hover:border-white/[0.08] transition-colors">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className={cn('text-[9px] font-mono font-bold px-1.5 py-0.5',
                                trade.direction === 'long' ? 'border-emerald-500/30 text-emerald-400 bg-emerald-500/5' : 'border-red-500/30 text-red-400 bg-red-500/5'
                              )}>
                                {trade.direction === 'long' ? '▲ LONG' : '▼ SHORT'}
                              </Badge>
                              <span className="text-sm font-semibold text-white/90">{trade.symbol.replace('USDT', '')}</span>
                              <span className="text-[10px] text-white/30 font-mono">{trade.leverage}x</span>
                            </div>
                            <span className={cn('text-sm font-mono font-bold', pnl >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                              {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}$
                            </span>
                          </div>
                          <p className="text-[11px] text-white/35 leading-relaxed">{trade.potential}</p>
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>
              )}
            </>
          )}

          {/* ====================== TRADES TAB ====================== */}
          {activeTab === 'trades' && (
            <>
              {openTrades.length > 0 && (
                <Card className="bg-[#0d0d14] border-white/[0.06]">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-xs font-semibold text-amber-400 tracking-widest">ОТКРЫТЫЕ СДЕЛКИ ({openTrades.length})</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {openTrades.map(trade => (
                      <OpenTradeCard
                        key={trade.id}
                        trade={trade}
                        expanded={expandedTrade === trade.id}
                        onToggle={() => setExpandedTrade(expandedTrade === trade.id ? null : trade.id)}
                      />
                    ))}
                  </CardContent>
                </Card>
              )}

              <Card className="bg-[#0d0d14] border-white/[0.06]">
                <CardHeader className="pb-3">
                  <CardTitle className="text-xs font-semibold text-white/60 tracking-widest">ИСТОРИЯ СДЕЛОК ({closedTrades.length})</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {closedTrades.length === 0 ? (
                    <div className="text-center py-8">
                      <p className="text-xs text-white/25">Закрытых сделок пока нет</p>
                    </div>
                  ) : (
                    closedTrades.map(trade => (
                      <ClosedTradeCard
                        key={trade.id}
                        trade={trade}
                        expanded={expandedTrade === trade.id}
                        onToggle={() => setExpandedTrade(expandedTrade === trade.id ? null : trade.id)}
                      />
                    ))
                  )}
                </CardContent>
              </Card>
            </>
          )}

          {/* ====================== STRATEGY TAB ====================== */}
          {activeTab === 'strategy' && (
            <>
              <Card className="bg-[#0d0d14] border-white/[0.06]">
                <CardHeader className="pb-3">
                  <CardTitle className="text-xs font-semibold text-white/60 tracking-widest">ФИЛОСОФИЯ СТРАТЕГИИ</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-[13px] text-white/60 leading-relaxed">{strategy.philosophy}</p>
                </CardContent>
              </Card>

              <Card className="bg-[#0d0d14] border-white/[0.06]">
                <CardHeader className="pb-3">
                  <CardTitle className="text-xs font-semibold text-emerald-400 tracking-widest flex items-center gap-2">
                    <ArrowUpRight className="w-3.5 h-3.5" />
                    ПРАВИЛА ВХОДА
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2.5">
                  {strategy.entryRules.map((rule, i) => (
                    <div key={i} className="flex items-start gap-2.5">
                      <div className="w-5 h-5 rounded-md bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0 mt-0.5">
                        <span className="text-[9px] font-mono font-bold text-emerald-400">{i + 1}</span>
                      </div>
                      <p className="text-[12px] text-white/60 leading-relaxed">{rule}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card className="bg-[#0d0d14] border-white/[0.06]">
                <CardHeader className="pb-3">
                  <CardTitle className="text-xs font-semibold text-red-400 tracking-widest flex items-center gap-2">
                    <ArrowDownRight className="w-3.5 h-3.5" />
                    ПРАВИЛА ВЫХОДА
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2.5">
                  {strategy.exitRules.map((rule, i) => (
                    <div key={i} className="flex items-start gap-2.5">
                      <div className="w-5 h-5 rounded-md bg-red-500/10 border border-red-500/20 flex items-center justify-center shrink-0 mt-0.5">
                        <span className="text-[9px] font-mono font-bold text-red-400">{i + 1}</span>
                      </div>
                      <p className="text-[12px] text-white/60 leading-relaxed">{rule}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card className="bg-[#0d0d14] border-white/[0.06]">
                <CardHeader className="pb-3">
                  <CardTitle className="text-xs font-semibold text-amber-400 tracking-widest flex items-center gap-2">
                    <Shield className="w-3.5 h-3.5" />
                    УПРАВЛЕНИЕ РИСКАМИ
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2.5">
                  {strategy.riskManagement.map((rule, i) => (
                    <div key={i} className="flex items-start gap-2.5">
                      <div className="w-5 h-5 rounded-md bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0 mt-0.5">
                        <Shield className="w-2.5 h-2.5 text-amber-400" />
                      </div>
                      <p className="text-[12px] text-white/60 leading-relaxed">{rule}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card className="bg-[#0d0d14] border-white/[0.06]">
                <CardHeader className="pb-3">
                  <CardTitle className="text-xs font-semibold text-white/60 tracking-widest flex items-center gap-2">
                    <Percent className="w-3.5 h-3.5" />
                    ВЕСА ИНДИКАТОРОВ
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                    {data.indicatorWeights.map(w => (
                      <div key={w.id} className="p-2 rounded-lg bg-white/[0.02] border border-white/[0.04] text-center">
                        <div className="text-[10px] text-white/35 font-mono">{w.indicator_name}</div>
                        <div className="text-sm font-bold text-white/80 mt-0.5">{w.weight.toFixed(1)}x</div>
                        {w.calculated_winrate !== null && (
                          <div className={cn('text-[9px] font-mono mt-0.5', w.calculated_winrate >= 50 ? 'text-emerald-400/60' : 'text-red-400/60')}>
                            WR: {w.calculated_winrate.toFixed(0)}%
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </TooltipProvider>
    </div>
  );
}

// ============================================================
// Sub-Components
// ============================================================

function MetricCard({ label, value, subtext, icon, accent }: {
  label: string; value: string; subtext: string; icon: React.ReactNode; accent: string;
}) {
  return (
    <div className="p-4 rounded-xl bg-[#0d0d14] border border-white/[0.06]">
      <div className="flex items-center gap-2 mb-2">
        <div className={accent}>{icon}</div>
        <span className="text-[10px] text-white/30 tracking-widest font-medium">{label}</span>
      </div>
      <div className={cn('text-xl font-bold font-mono tracking-tight', accent)}>{value}</div>
      <div className="text-[10px] text-white/30 mt-1 font-mono">{subtext}</div>
    </div>
  );
}

function MiniMetric({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div>
      <div className="text-[10px] text-white/30 tracking-wide mb-1">{label}</div>
      <div className={cn('text-sm font-bold font-mono', color)}>{value}</div>
    </div>
  );
}

function EquityCurve({ data }: { data: BalancePoint[] }) {
  if (data.length < 2) return null;

  const minBal = Math.min(...data.map(d => d.balance));
  const maxBal = Math.max(...data.map(d => d.balance));
  const range = maxBal - minBal || 1;
  const width = 600;
  const height = 160;
  const padding = 10;

  const points = data.map((d, i) => {
    const x = padding + (i / (data.length - 1)) * (width - 2 * padding);
    const y = height - padding - ((d.balance - minBal) / range) * (height - 2 * padding);
    return { x, y, ...d };
  });

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const fillD = `${pathD} L ${points[points.length - 1].x.toFixed(1)} ${height - padding} L ${padding} ${height - padding} Z`;

  const isProfit = data[data.length - 1].balance >= data[0].balance;
  const strokeColor = isProfit ? '#34d399' : '#f87171';
  const fillColor = isProfit ? 'rgba(52, 211, 153, 0.06)' : 'rgba(248, 113, 113, 0.06)';

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto min-w-[400px]" preserveAspectRatio="none">
        {[0.25, 0.5, 0.75].map(pct => {
          const y = height - padding - pct * (height - 2 * padding);
          const val = minBal + pct * range;
          return (
            <g key={pct}>
              <line x1={padding} y1={y} x2={width - padding} y2={y} stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
              <text x={width - padding + 4} y={y + 3} fill="rgba(255,255,255,0.2)" fontSize="8" fontFamily="monospace">
                ${val.toFixed(1)}
              </text>
            </g>
          );
        })}
        <path d={fillD} fill={fillColor} />
        <path d={pathD} fill="none" stroke={strokeColor} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        {points.length > 0 && (
          <circle cx={points[points.length - 1].x} cy={points[points.length - 1].y} r="3" fill={strokeColor} />
        )}
        <circle cx={points[0].x} cy={points[0].y} r="2.5" fill="rgba(255,255,255,0.3)" />
      </svg>
    </div>
  );
}

// ============================================================
// Open Trade Card (separate component to avoid IIFE in JSX)
// ============================================================

function OpenTradeCard({ trade, expanded, onToggle }: {
  trade: OpenTradeDetail;
  expanded: boolean;
  onToggle: () => void;
}) {
  const isLong = trade.direction === 'long';
  const pnl = calcOpenPnl(trade);
  const entryTime = new Date(trade.opened_at).toLocaleString('ru-RU', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  return (
    <div className="rounded-xl border bg-white/[0.015] border-white/[0.04] hover:border-white/[0.08] transition-all duration-200">
      <button onClick={onToggle} className="w-full p-3 text-left">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Badge variant="outline" className={cn('text-[9px] font-mono font-bold px-1.5 py-0.5 shrink-0',
              isLong ? 'border-emerald-500/30 text-emerald-400 bg-emerald-500/5' : 'border-red-500/30 text-red-400 bg-red-500/5'
            )}>
              {isLong ? '▲ LONG' : '▼ SHORT'}
            </Badge>
            <span className="text-sm font-semibold text-white/90">{trade.symbol.replace('USDT', '')}</span>
            <span className="text-[10px] text-white/25 font-mono">{trade.leverage}x</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <span className={cn('text-sm font-mono font-bold', pnl >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}$
              </span>
              <div className="text-[10px] text-white/25 font-mono">${trade.entry_price.toFixed(4)}</div>
            </div>
            {expanded ? <ChevronUp className="w-4 h-4 text-white/20" /> : <ChevronDown className="w-4 h-4 text-white/20" />}
          </div>
        </div>
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-3 border-t border-white/[0.04] pt-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <DetailItem label="Вход" value={`$${trade.entry_price.toFixed(4)}`} />
            <DetailItem label="Текущая" value={`$${trade.currentPrice.toFixed(4)}`} />
            <DetailItem label="Объём" value={`$${trade.amount.toFixed(2)}`} />
            <DetailItem label="Плечо" value={`${trade.leverage}x → $${(trade.amount * trade.leverage).toFixed(2)}`} />
            {trade.stop_loss && <DetailItem label="Стоп-лосс" value={`$${trade.stop_loss.toFixed(4)}`} />}
            {trade.take_profit && <DetailItem label="Тейк-профит" value={`$${trade.take_profit.toFixed(4)}`} />}
            <DetailItem label="Время входа" value={entryTime} icon={<Clock className="w-3 h-3" />} />
          </div>

          <div className="p-3 rounded-lg bg-amber-500/[0.03] border border-amber-500/[0.08]">
            <div className="flex items-center gap-1.5 mb-1.5">
              <Target className="w-3 h-3 text-amber-400/60" />
              <span className="text-[10px] text-amber-400/60 font-medium tracking-wider">ЛОГИКА ОТКРЫТИЯ</span>
            </div>
            <p className="text-[11px] text-white/50 leading-relaxed">{trade.decisionNarrative}</p>
          </div>

          <div className="p-3 rounded-lg bg-white/[0.02] border border-white/[0.04]">
            <div className="flex items-center gap-1.5 mb-1.5">
              <Zap className="w-3 h-3 text-amber-400/60" />
              <span className="text-[10px] text-amber-400/60 font-medium tracking-wider">ПОТЕНЦИАЛ ПОЗИЦИИ</span>
            </div>
            <p className="text-[11px] text-white/50 leading-relaxed">{trade.potential}</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Closed Trade Card
// ============================================================

function ClosedTradeCard({ trade, expanded, onToggle }: {
  trade: ClosedTradeDetail;
  expanded: boolean;
  onToggle: () => void;
}) {
  const isLong = trade.direction === 'long';
  const pnl = trade.pnl ?? 0;
  const pnlPct = trade.amount > 0 ? (pnl / trade.amount * 100) : 0;

  const entryTime = new Date(trade.opened_at).toLocaleString('ru-RU', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  return (
    <div className="rounded-xl border bg-white/[0.015] border-white/[0.04] hover:border-white/[0.08] transition-all duration-200">
      <button onClick={onToggle} className="w-full p-3 text-left">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Badge variant="outline" className={cn('text-[9px] font-mono font-bold px-1.5 py-0.5 shrink-0',
              isLong ? 'border-emerald-500/30 text-emerald-400 bg-emerald-500/5' : 'border-red-500/30 text-red-400 bg-red-500/5'
            )}>
              {isLong ? '▲ LONG' : '▼ SHORT'}
            </Badge>
            <span className="text-sm font-semibold text-white/90">{trade.symbol.replace('USDT', '')}</span>
            <span className="text-[10px] text-white/25 font-mono">{trade.leverage}x</span>
            {pnl >= 0
              ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400/60" />
              : <XCircle className="w-3.5 h-3.5 text-red-400/60" />}
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <span className={cn('text-sm font-mono font-bold', pnl >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}$
              </span>
              <div className="text-[10px] text-white/25 font-mono">${trade.entry_price.toFixed(4)}</div>
            </div>
            {expanded ? <ChevronUp className="w-4 h-4 text-white/20" /> : <ChevronDown className="w-4 h-4 text-white/20" />}
          </div>
        </div>
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-3 border-t border-white/[0.04] pt-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <DetailItem label="Вход" value={`$${trade.entry_price.toFixed(4)}`} />
            {trade.exit_price && <DetailItem label="Выход" value={`$${trade.exit_price.toFixed(4)}`} />}
            <DetailItem label="Объём" value={`$${trade.amount.toFixed(2)}`} />
            <DetailItem label="Плечо" value={`${trade.leverage}x → $${(trade.amount * trade.leverage).toFixed(2)}`} />
            {trade.stop_loss && <DetailItem label="Стоп-лосс" value={`$${trade.stop_loss.toFixed(4)}`} />}
            {trade.take_profit && <DetailItem label="Тейк-профит" value={`$${trade.take_profit.toFixed(4)}`} />}
            <DetailItem label="PnL %" value={`${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(1)}%`} />
            <DetailItem label="Время входа" value={entryTime} icon={<Clock className="w-3 h-3" />} />
          </div>

          <div className="p-3 rounded-lg bg-amber-500/[0.03] border border-amber-500/[0.08]">
            <div className="flex items-center gap-1.5 mb-1.5">
              <Target className="w-3 h-3 text-amber-400/60" />
              <span className="text-[10px] text-amber-400/60 font-medium tracking-wider">ЛОГИКА ОТКРЫТИЯ</span>
            </div>
            <p className="text-[11px] text-white/50 leading-relaxed">{trade.decisionNarrative}</p>
          </div>

          <div className={cn('p-3 rounded-lg border',
            pnl >= 0 ? 'bg-emerald-500/[0.03] border-emerald-500/[0.08]' : 'bg-red-500/[0.03] border-red-500/[0.08]'
          )}>
            <div className="flex items-center gap-1.5 mb-1.5">
              {pnl >= 0
                ? <CheckCircle2 className="w-3 h-3 text-emerald-400/60" />
                : <XCircle className="w-3 h-3 text-red-400/60" />}
              <span className={cn('text-[10px] font-medium tracking-wider',
                pnl >= 0 ? 'text-emerald-400/60' : 'text-red-400/60'
              )}>
                РЕЗУЛЬТАТ И ПРИЧИНА ЗАКРЫТИЯ
              </span>
            </div>
            <p className="text-[11px] text-white/50 leading-relaxed">{trade.closeNarrative}</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Detail Item
// ============================================================

function DetailItem({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div>
      <div className="text-[9px] text-white/25 tracking-wider uppercase mb-0.5 flex items-center gap-1">
        {icon}{label}
      </div>
      <div className="text-[11px] text-white/60 font-mono">{value}</div>
    </div>
  );
}
