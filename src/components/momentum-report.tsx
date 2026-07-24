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

function fmtPrice(price: number): string {
  if (price >= 10000) return price.toFixed(1);
  if (price >= 100) return price.toFixed(2);
  if (price >= 1) return price.toFixed(3);
  if (price >= 0.01) return price.toFixed(5);
  return price.toFixed(7);
}

function fmtDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function pnlColor(val: number): string {
  return val >= 0 ? 'text-emerald-400' : 'text-red-400';
}

function pnlSign(val: number): string {
  return val >= 0 ? '+' : '';
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
          <span className="text-sm text-white/40 tracking-widest font-mono">ЗАГРУЗКА ОТЧЁТА</span>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="fixed inset-0 z-50 bg-[#0a0a0f]/95 backdrop-blur-xl flex items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-center px-6">
          <AlertTriangle className="w-8 h-8 text-red-400/60" />
          <span className="text-sm text-red-400 font-mono">{error || 'Нет данных'}</span>
          <button onClick={fetchReport} className="px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-xs text-white/60 hover:bg-white/10 transition-colors font-mono">
            Повторить
          </button>
          <button onClick={onClose} className="text-xs text-white/30 hover:text-white/50 transition-colors mt-2 font-mono">
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

  const tabs: Array<{ key: 'overview' | 'trades' | 'strategy'; label: string; sheet: string }> = [
    { key: 'overview', label: 'Обзор', sheet: 'Лист 1' },
    { key: 'trades', label: 'Сделки', sheet: 'Лист 2' },
    { key: 'strategy', label: 'Логика', sheet: 'Лист 3' },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-[#0a0a0f] overflow-y-auto font-mono">
      {/* Excel-style Header */}
      <div className="sticky top-0 z-10 bg-[#0a0a0f] border-b border-white/[0.08]">
        {/* Title bar */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-white/[0.06]">
          <div className="flex items-center gap-3">
            <BarChart3 className="w-4 h-4 text-amber-400" />
            <span className="text-sm font-bold text-white/90">{strategy.name}</span>
            <span className="text-[10px] text-white/30">— analytics.xlsx</span>
          </div>
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-md bg-white/5 border border-white/[0.08] text-[10px] text-white/50 hover:bg-white/10 transition-colors tracking-wider"
          >
            ✕ ЗАКРЫТЬ
          </button>
        </div>
        {/* Tab bar — Excel sheet tabs */}
        <div className="flex items-center px-4 sm:px-6">
          <div className="flex items-center gap-0 border-b-2 border-amber-500/40 overflow-x-auto no-scrollbar">
            {tabs.map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={cn(
                  'px-4 py-2 text-[11px] tracking-wider transition-colors whitespace-nowrap',
                  activeTab === tab.key
                    ? 'bg-[#12121e] text-amber-400 border border-white/[0.06] border-b-0 -mb-px rounded-t-md font-bold'
                    : 'text-white/30 hover:text-white/50 hover:bg-white/[0.02]',
                )}
              >
                <span className="opacity-40 mr-1">{tab.sheet}</span> {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 pb-24">
        {/* ====================== OVERVIEW TAB ====================== */}
        {activeTab === 'overview' && (
          <div className="space-y-0">
            {/* P&L Statement Header */}
            <SheetTitle title={`ОТЧЁТ О ПРИБЫЛЯХ И УБЫТКАХ — ${strategy.name.toUpperCase()}`} subtitle={`Период: все время | Дата: ${new Date().toLocaleDateString('ru-RU')}`} />

            {/* Account Summary Table */}
            <SheetSection title="БАЛАНСОВЫЙ ОТЧЁТ">
              <ExcelTable>
                <ExcelRow label="Начальный баланс" value={`$${accountState.startingBalance.toFixed(2)}`} align="right" />
                <ExcelRow label="Текущий баланс" value={`$${accountState.currentBalance.toFixed(2)}`} align="right" className={pnlColor(accountState.totalReturn)} bold />
                <ExcelRow label="Заемные средства" value={`$${accountState.borrowedFunds.toFixed(2)}`} align="right" />
                <ExcelRow label="Долг к возврату" value={`$${accountState.debtToRepay.toFixed(2)}`} align="right" className={accountState.debtToRepay > 0 ? 'text-red-400' : 'text-white/50'} />
                <ExcelRow label="Общий капитал" value={`$${accountState.totalEquity.toFixed(2)}`} align="right" bold />
                <ExcelDivider />
                <ExcelRow label="Итого прибыль/убыток $" value={`${pnlSign(accountState.totalReturn)}$${accountState.totalReturn.toFixed(2)}`} align="right" className={pnlColor(accountState.totalReturn)} bold />
                <ExcelRow label="Итого прибыль/убыток %" value={`${pnlSign(accountState.totalReturnPct)}${accountState.totalReturnPct.toFixed(2)}%`} align="right" className={pnlColor(accountState.totalReturnPct)} bold />
              </ExcelTable>
            </SheetSection>

            {/* Performance Metrics Table */}
            <SheetSection title="ПОКАЗАТЕЛИ ПРОИЗВОДИТЕЛЬНОСТИ">
              <ExcelTable>
                <ExcelRow label="Всего сделок" value={`${p.totalTrades}`} align="right" />
                <ExcelRow label="Прибыльных (W)" value={`${p.wins}`} align="right" className="text-emerald-400" />
                <ExcelRow label="Убыточных (L)" value={`${p.losses}`} align="right" className="text-red-400" />
                <ExcelRow label="Винрейт" value={`${p.winRate.toFixed(1)}%`} align="right" className={p.winRate >= 50 ? 'text-emerald-400' : p.winRate >= 40 ? 'text-amber-400' : 'text-red-400'} bold />
                <ExcelDivider />
                <ExcelRow label="Профит-фактор" value={p.profitFactor !== null ? p.profitFactor.toFixed(2) : '∞'} align="right" bold />
                <ExcelRow label="Ср. прибыль" value={`+$${p.avgWin.toFixed(2)}`} align="right" className="text-emerald-400" />
                <ExcelRow label="Ср. убыток" value={`-$${p.avgLoss.toFixed(2)}`} align="right" className="text-red-400" />
                <ExcelRow label="Макс. прибыль" value={`+$${p.largestWin.toFixed(2)}`} align="right" className="text-emerald-400" />
                <ExcelRow label="Макс. убыток" value={`-$${p.largestLoss.toFixed(2)}`} align="right" className="text-red-400" />
                <ExcelRow label="Ср. R:R" value={p.avgRiskReward > 0 ? `1:${p.avgRiskReward.toFixed(1)}` : '—'} align="right" className="text-amber-400" />
                <ExcelRow label="Макс. просадка" value={`${p.maxDrawdown.toFixed(1)}%`} align="right" className={p.maxDrawdown > 15 ? 'text-red-400' : p.maxDrawdown > 8 ? 'text-amber-400' : 'text-emerald-400'} />
                <ExcelDivider />
                <ExcelRow label="Всего выиграно $" value={`+$${p.totalWinsAmount.toFixed(2)}`} align="right" className="text-emerald-400" />
                <ExcelRow label="Всего потеряно $" value={`-$${p.totalLossesAmount.toFixed(2)}`} align="right" className="text-red-400" />
                <ExcelRow label="Чистый PnL $" value={`${pnlSign(p.totalPnl)}$${p.totalPnl.toFixed(2)}`} align="right" className={pnlColor(p.totalPnl)} bold />
              </ExcelTable>
            </SheetSection>

            {/* Direction Breakdown */}
            <SheetSection title="АНАЛИЗ ПО НАПРАВЛЕНИЯМ">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="border-b border-white/[0.08] text-white/30 text-[10px]">
                    <th className="text-left py-2 px-3 tracking-wider font-medium">НАПРАВЛЕНИЕ</th>
                    <th className="text-right py-2 px-3 tracking-wider font-medium">СДЕЛОК</th>
                    <th className="text-right py-2 px-3 tracking-wider font-medium">ВИНРЕЙТ</th>
                    <th className="text-left py-2 px-3 tracking-wider font-medium w-32">ГРАФИК</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-white/[0.03] bg-white/[0.01]">
                    <td className="py-2.5 px-3 text-emerald-400 font-bold">▲ LONG</td>
                    <td className="py-2.5 px-3 text-right text-white/60">{p.longTrades}</td>
                    <td className="py-2.5 px-3 text-right text-emerald-400 font-bold">{p.longWinRate.toFixed(1)}%</td>
                    <td className="py-2.5 px-3"><Progress value={p.longWinRate} className="h-1.5 bg-white/5 [&>div]:bg-emerald-400" /></td>
                  </tr>
                  <tr className="border-b border-white/[0.03]">
                    <td className="py-2.5 px-3 text-red-400 font-bold">▼ SHORT</td>
                    <td className="py-2.5 px-3 text-right text-white/60">{p.shortTrades}</td>
                    <td className="py-2.5 px-3 text-right text-red-400 font-bold">{p.shortWinRate.toFixed(1)}%</td>
                    <td className="py-2.5 px-3"><Progress value={p.shortWinRate} className="h-1.5 bg-white/5 [&>div]:bg-red-400" /></td>
                  </tr>
                  {p.openTradesCount > 0 && (
                    <tr className="border-b border-white/[0.03] bg-white/[0.01]">
                      <td className="py-2.5 px-3 text-amber-400 font-bold">● ОТКРЫТЫЕ</td>
                      <td className="py-2.5 px-3 text-right text-white/60">{p.openTradesCount}</td>
                      <td className="py-2.5 px-3 text-right text-white/40">—</td>
                      <td className={cn('py-2.5 px-3 text-right text-[11px] font-bold', pnlColor(p.currentUnrealizedPnl))}>
                        {pnlSign(p.currentUnrealizedPnl)}${p.currentUnrealizedPnl.toFixed(2)}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </SheetSection>

            {/* Balance Equity Curve */}
            {balanceHistory.length > 2 && (
              <SheetSection title="ДИНАМИКА БАЛАНСА">
                <div className="overflow-x-auto">
                  <EquityCurve data={balanceHistory} />
                </div>
              </SheetSection>
            )}

            {/* Symbol Performance Spreadsheet */}
            {topSymbols.length > 0 && (
              <SheetSection title="РЕЗУЛЬТАТИВНОСТЬ ПО МОНЕТАМ">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="border-b border-white/[0.08] text-white/30 text-[10px]">
                      <th className="text-left py-2 px-3 tracking-wider font-medium">МОНЕТА</th>
                      <th className="text-right py-2 px-3 tracking-wider font-medium">СДЕЛОК</th>
                      <th className="text-right py-2 px-3 tracking-wider font-medium">W</th>
                      <th className="text-right py-2 px-3 tracking-wider font-medium">ВИНРЕЙТ</th>
                      <th className="text-right py-2 px-3 tracking-wider font-medium">PnL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topSymbols.map(([symbol, stats], i) => (
                      <tr key={symbol} className={cn('border-b border-white/[0.03]', i % 2 === 0 ? 'bg-white/[0.008]' : '')}>
                        <td className="py-2 px-3 text-white/80 font-bold">{symbol.replace('USDT', '')}</td>
                        <td className="py-2 px-3 text-right text-white/50">{stats.count}</td>
                        <td className="py-2 px-3 text-right text-emerald-400/70">{stats.wins}</td>
                        <td className="py-2 px-3 text-right text-white/50">{stats.count > 0 ? (stats.wins / stats.count * 100).toFixed(0) : 0}%</td>
                        <td className={cn('py-2 px-3 text-right font-bold', pnlColor(stats.pnl))}>
                          {pnlSign(stats.pnl)}${stats.pnl.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </SheetSection>
            )}

            {/* Potential Assessment */}
            <SheetSection title="ОЦЕНКА ПОТЕНЦИАЛА">
              <div className="space-y-1">
                {potentialAssessment.map((text, i) => (
                  <div key={i} className={cn('flex gap-3 py-1.5 px-3', i % 2 === 0 ? 'bg-white/[0.008]' : '')}>
                    <span className="text-white/15 shrink-0 w-5">{(i + 1).toString().padStart(2, '0')}</span>
                    <span className="text-[11px] text-white/55 leading-relaxed">{text}</span>
                  </div>
                ))}
              </div>
            </SheetSection>

            {/* Open Trades Quick View */}
            {openTrades.length > 0 && (
              <SheetSection title={`АКТИВНЫЕ ПОЗИЦИИ (${openTrades.length})`}>
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="border-b border-white/[0.08] text-white/30 text-[10px]">
                      <th className="text-left py-2 px-3 tracking-wider font-medium">МОНЕТА</th>
                      <th className="text-center py-2 px-2 tracking-wider font-medium">НАПР.</th>
                      <th className="text-right py-2 px-3 tracking-wider font-medium">ВХОД</th>
                      <th className="text-right py-2 px-3 tracking-wider font-medium">ТЕК.ЦЕНА</th>
                      <th className="text-right py-2 px-3 tracking-wider font-medium">ПЛЕЧО</th>
                      <th className="text-right py-2 px-3 tracking-wider font-medium">PnL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {openTrades.map(trade => {
                      const pnl = calcOpenPnl(trade);
                      const isLong = trade.direction === 'long';
                      return (
                        <tr key={trade.id} className={cn('border-b border-white/[0.03]', isLong ? 'bg-emerald-500/[0.015]' : 'bg-red-500/[0.015]')}>
                          <td className="py-2 px-3 text-white/80 font-bold">{trade.symbol.replace('USDT', '')}</td>
                          <td className="py-2 px-2 text-center">
                            <span className={cn('text-[9px] font-bold', isLong ? 'text-emerald-400' : 'text-red-400')}>
                              {isLong ? '▲L' : '▼S'}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-right text-white/50">${fmtPrice(trade.entry_price)}</td>
                          <td className="py-2 px-3 text-right text-white/50">${fmtPrice(trade.currentPrice)}</td>
                          <td className="py-2 px-3 text-right text-white/40">{trade.leverage}x</td>
                          <td className={cn('py-2 px-3 text-right font-bold', pnlColor(pnl))}>
                            {pnlSign(pnl)}${pnl.toFixed(2)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </SheetSection>
            )}
          </div>
        )}

        {/* ====================== TRADES TAB ====================== */}
        {activeTab === 'trades' && (
          <div className="space-y-0">
            <SheetTitle title="ЖУРНАЛ СДЕЛОК" subtitle={`${openTrades.length} открытых · ${closedTrades.length} закрытых`} />

            {/* Open Trades */}
            {openTrades.length > 0 && (
              <SheetSection title={`ОТКРЫТЫЕ ПОЗИЦИИ (${openTrades.length})`}>
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="border-b border-white/[0.08] text-white/30 text-[10px]">
                      <th className="text-left py-2 px-3 tracking-wider font-medium">МОНЕТА</th>
                      <th className="text-center py-2 px-2 tracking-wider font-medium">НАПР.</th>
                      <th className="text-right py-2 px-2 tracking-wider font-medium">ВХОД</th>
                      <th className="text-right py-2 px-2 tracking-wider font-medium">ТЕК.ЦЕНА</th>
                      <th className="text-right py-2 px-2 tracking-wider font-medium">ОБЪЁМ</th>
                      <th className="text-right py-2 px-2 tracking-wider font-medium">ПЛЕЧО</th>
                      <th className="text-right py-2 px-2 tracking-wider font-medium">SL</th>
                      <th className="text-right py-2 px-2 tracking-wider font-medium">TP</th>
                      <th className="text-right py-2 px-2 tracking-wider font-medium">PnL</th>
                      <th className="text-left py-2 px-2 tracking-wider font-medium">ОТКРЫТА</th>
                      <th className="w-6"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {openTrades.map((trade, i) => {
                      const isLong = trade.direction === 'long';
                      const pnl = calcOpenPnl(trade);
                      const isExpanded = expandedTrade === trade.id;
                      return (
                        <tr key={trade.id} className={cn('border-b border-white/[0.03] hover:bg-white/[0.02] cursor-pointer transition-colors', i % 2 === 0 ? 'bg-white/[0.008]' : '')}>
                          <td className="py-2 px-3 text-white/80 font-bold">{trade.symbol.replace('USDT', '')}</td>
                          <td className="py-2 px-2 text-center">
                            <span className={cn('text-[9px] font-bold', isLong ? 'text-emerald-400' : 'text-red-400')}>
                              {isLong ? '▲L' : '▼S'}
                            </span>
                          </td>
                          <td className="py-2 px-2 text-right text-white/50">${fmtPrice(trade.entry_price)}</td>
                          <td className="py-2 px-2 text-right text-white/50">${fmtPrice(trade.currentPrice)}</td>
                          <td className="py-2 px-2 text-right text-white/40">${trade.amount.toFixed(2)}</td>
                          <td className="py-2 px-2 text-right text-white/40">{trade.leverage}x</td>
                          <td className="py-2 px-2 text-right text-red-400/60">{trade.stop_loss ? `$${fmtPrice(trade.stop_loss)}` : '—'}</td>
                          <td className="py-2 px-2 text-right text-emerald-400/60">{trade.take_profit ? `$${fmtPrice(trade.take_profit)}` : '—'}</td>
                          <td className={cn('py-2 px-2 text-right font-bold', pnlColor(pnl))}>
                            {pnlSign(pnl)}${pnl.toFixed(2)}
                          </td>
                          <td className="py-2 px-2 text-left text-white/30 text-[10px]">{fmtDate(trade.opened_at)}</td>
                          <td className="py-2 px-1 text-center">
                            <button onClick={() => setExpandedTrade(isExpanded ? null : trade.id)} className="text-white/20 hover:text-white/40 transition-colors">
                              {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {/* Expanded detail rows */}
                {openTrades.filter(t => t.id === expandedTrade).map(trade => (
                  <OpenTradeDetailRow key={`detail-${trade.id}`} trade={trade} />
                ))}
              </SheetSection>
            )}

            {/* Closed Trades */}
            <SheetSection title={`ЗАКРЫТЫЕ СДЕЛКИ (${closedTrades.length})`}>
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="border-b border-white/[0.08] text-white/30 text-[10px]">
                    <th className="text-left py-2 px-3 tracking-wider font-medium">МОНЕТА</th>
                    <th className="text-center py-2 px-2 tracking-wider font-medium">НАПР.</th>
                    <th className="text-right py-2 px-2 tracking-wider font-medium">ВХОД</th>
                    <th className="text-right py-2 px-2 tracking-wider font-medium">ВЫХОД</th>
                    <th className="text-right py-2 px-2 tracking-wider font-medium">ОБЪЁМ</th>
                    <th className="text-right py-2 px-2 tracking-wider font-medium">ПЛЕЧО</th>
                    <th className="text-right py-2 px-2 tracking-wider font-medium">PnL</th>
                    <th className="text-left py-2 px-2 tracking-wider font-medium">ОТКРЫТА</th>
                    <th className="text-left py-2 px-2 tracking-wider font-medium">ЗАКРЫТА</th>
                    <th className="w-6"></th>
                  </tr>
                </thead>
                <tbody>
                  {closedTrades.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="py-8 text-center text-white/20">Закрытых сделок пока нет</td>
                    </tr>
                  ) : (
                    closedTrades.map((trade, i) => {
                      const isLong = trade.direction === 'long';
                      const pnl = trade.pnl ?? 0;
                      const isExpanded = expandedTrade === trade.id;
                      return (
                        <tr key={trade.id} className={cn('border-b border-white/[0.03] hover:bg-white/[0.02] cursor-pointer transition-colors', i % 2 === 0 ? 'bg-white/[0.008]' : '')}>
                          <td className="py-2 px-3 text-white/80 font-bold">{trade.symbol.replace('USDT', '')}</td>
                          <td className="py-2 px-2 text-center">
                            <span className={cn('text-[9px] font-bold', isLong ? 'text-emerald-400' : 'text-red-400')}>
                              {isLong ? '▲L' : '▼S'}
                            </span>
                          </td>
                          <td className="py-2 px-2 text-right text-white/50">${fmtPrice(trade.entry_price)}</td>
                          <td className="py-2 px-2 text-right text-white/50">{trade.exit_price != null ? `$${fmtPrice(trade.exit_price)}` : '—'}</td>
                          <td className="py-2 px-2 text-right text-white/40">${trade.amount.toFixed(2)}</td>
                          <td className="py-2 px-2 text-right text-white/40">{trade.leverage}x</td>
                          <td className={cn('py-2 px-2 text-right font-bold', pnlColor(pnl))}>
                            {pnlSign(pnl)}${pnl.toFixed(2)}
                          </td>
                          <td className="py-2 px-2 text-left text-white/30 text-[10px]">{fmtDate(trade.opened_at)}</td>
                          <td className="py-2 px-2 text-left text-white/30 text-[10px]">{trade.closed_at ? fmtDate(trade.closed_at) : '—'}</td>
                          <td className="py-2 px-1 text-center">
                            <button onClick={() => setExpandedTrade(isExpanded ? null : trade.id)} className="text-white/20 hover:text-white/40 transition-colors">
                              {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
              {/* Expanded detail rows */}
              {closedTrades.filter(t => t.id === expandedTrade).map(trade => (
                <ClosedTradeDetailRow key={`detail-${trade.id}`} trade={trade} />
              ))}
            </SheetSection>
          </div>
        )}

        {/* ====================== STRATEGY TAB ====================== */}
        {activeTab === 'strategy' && (
          <div className="space-y-0">
            <SheetTitle title={`ЛОГИКА СТРАТЕГИИ: ${strategy.name.toUpperCase()}`} subtitle={strategy.philosophy} />

            {/* Entry Rules */}
            <SheetSection title="ПРАВИЛА ВХОДА" accent="emerald">
              <div className="space-y-0">
                {strategy.entryRules.map((rule, i) => (
                  <ExcelRow key={i} label={`#${(i + 1).toString().padStart(2, '0')}`} value={rule} align="left" className={cn('text-[11px] text-white/55 leading-relaxed', i % 2 === 0 ? 'bg-emerald-500/[0.015]' : '')} />
                ))}
              </div>
            </SheetSection>

            {/* Exit Rules */}
            <SheetSection title="ПРАВИЛА ВЫХОДА" accent="red">
              <div className="space-y-0">
                {strategy.exitRules.map((rule, i) => (
                  <ExcelRow key={i} label={`#${(i + 1).toString().padStart(2, '0')}`} value={rule} align="left" className={cn('text-[11px] text-white/55 leading-relaxed', i % 2 === 0 ? 'bg-red-500/[0.015]' : '')} />
                ))}
              </div>
            </SheetSection>

            {/* Risk Management */}
            <SheetSection title="УПРАВЛЕНИЕ РИСКАМИ" accent="amber">
              <div className="space-y-0">
                {strategy.riskManagement.map((rule, i) => (
                  <ExcelRow key={i} label={`#${(i + 1).toString().padStart(2, '0')}`} value={rule} align="left" className={cn('text-[11px] text-white/55 leading-relaxed', i % 2 === 0 ? 'bg-amber-500/[0.015]' : '')} />
                ))}
              </div>
            </SheetSection>

            {/* Indicator Weights */}
            <SheetSection title="ВЕСА ИНДИКАТОРОВ">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="border-b border-white/[0.08] text-white/30 text-[10px]">
                    <th className="text-left py-2 px-3 tracking-wider font-medium">ИНДИКАТОР</th>
                    <th className="text-right py-2 px-3 tracking-wider font-medium">ВЕС</th>
                    <th className="text-right py-2 px-3 tracking-wider font-medium">ВИНРЕЙТ</th>
                  </tr>
                </thead>
                <tbody>
                  {data.indicatorWeights.map((w, i) => (
                    <tr key={w.id} className={cn('border-b border-white/[0.03]', i % 2 === 0 ? 'bg-white/[0.008]' : '')}>
                      <td className="py-2 px-3 text-white/70">{w.indicator_name}</td>
                      <td className="py-2 px-3 text-right text-white/80 font-bold">{w.weight.toFixed(1)}x</td>
                      <td className={cn('py-2 px-3 text-right', w.calculated_winrate !== null ? (w.calculated_winrate >= 50 ? 'text-emerald-400' : 'text-red-400') : 'text-white/30')}>
                        {w.calculated_winrate !== null ? `${w.calculated_winrate.toFixed(0)}%` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </SheetSection>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// Excel-style Reusable Components
// ============================================================

function SheetTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="py-4 border-b border-white/[0.06]">
      <h2 className="text-xs font-bold text-white/80 tracking-wider">{title}</h2>
      {subtitle && <p className="text-[10px] text-white/30 mt-1 tracking-wide">{subtitle}</p>}
    </div>
  );
}

function SheetSection({ title, accent, children }: { title: string; accent?: 'emerald' | 'red' | 'amber'; children: React.ReactNode }) {
  const accentColor = accent === 'emerald' ? 'text-emerald-400' : accent === 'red' ? 'text-red-400' : accent === 'amber' ? 'text-amber-400' : 'text-white/50';
  return (
    <div className="border-t border-white/[0.06]">
      <div className="flex items-center gap-2 py-2.5 px-3 bg-white/[0.01]">
        <div className="w-1 h-3 rounded-full bg-white/10" />
        <span className={cn('text-[10px] font-bold tracking-wider', accentColor)}>{title}</span>
      </div>
      {children}
    </div>
  );
}

function ExcelTable({ children }: { children: React.ReactNode }) {
  return (
    <table className="w-full text-[11px]">
      <tbody>
        {children}
      </tbody>
    </table>
  );
}

function ExcelRow({ label, value, align = 'right', className, bold }: {
  label: string; value: string; align?: 'left' | 'right'; className?: string; bold?: boolean;
}) {
  return (
    <tr className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors">
      <td className="py-2 px-3 text-left text-white/40">{label}</td>
      <td className={cn('py-2 px-3', align === 'right' ? 'text-right' : 'text-left', className, bold && 'font-bold')}>
        {value}
      </td>
    </tr>
  );
}

function ExcelDivider() {
  return (
    <tr>
      <td colSpan={2} className="py-1 px-3 border-b border-white/[0.08] bg-white/[0.02]" />
    </tr>
  );
}

// ============================================================
// Equity Curve
// ============================================================

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
  );
}

// ============================================================
// Trade Detail Expansion Rows
// ============================================================

function OpenTradeDetailRow({ trade }: { trade: OpenTradeDetail }) {
  return (
    <tr className="bg-white/[0.01]">
      <td colSpan={11} className="py-3 px-3 border-b border-white/[0.06]">
        <div className="space-y-2">
          <div className="p-3 rounded-md bg-amber-500/[0.02] border border-amber-500/[0.06]">
            <div className="text-[9px] text-amber-400/60 tracking-wider mb-1.5 font-bold">ЛОГИКА ОТКРЫТИЯ</div>
            <p className="text-[10px] text-white/45 leading-relaxed">{trade.decisionNarrative}</p>
          </div>
          {trade.potential && (
            <div className="p-3 rounded-md bg-white/[0.015] border border-white/[0.04]">
              <div className="text-[9px] text-white/30 tracking-wider mb-1.5 font-bold">ПОТЕНЦИАЛ ПОЗИЦИИ</div>
              <p className="text-[10px] text-white/40 leading-relaxed">{trade.potential}</p>
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}

function ClosedTradeDetailRow({ trade }: { trade: ClosedTradeDetail }) {
  const pnl = trade.pnl ?? 0;
  return (
    <tr className="bg-white/[0.01]">
      <td colSpan={10} className="py-3 px-3 border-b border-white/[0.06]">
        <div className="space-y-2">
          <div className="p-3 rounded-md bg-amber-500/[0.02] border border-amber-500/[0.06]">
            <div className="text-[9px] text-amber-400/60 tracking-wider mb-1.5 font-bold">ЛОГИКА ОТКРЫТИЯ</div>
            <p className="text-[10px] text-white/45 leading-relaxed">{trade.decisionNarrative}</p>
          </div>
          <div className={cn('p-3 rounded-md border',
            pnl >= 0 ? 'bg-emerald-500/[0.02] border-emerald-500/[0.06]' : 'bg-red-500/[0.02] border-red-500/[0.06]'
          )}>
            <div className={cn('text-[9px] tracking-wider mb-1.5 font-bold', pnl >= 0 ? 'text-emerald-400/60' : 'text-red-400/60')}>
              РЕЗУЛЬТАТ И ПРИЧИНА ЗАКРЫТИЯ
            </div>
            <p className="text-[10px] text-white/45 leading-relaxed">{trade.closeNarrative}</p>
          </div>
        </div>
      </td>
    </tr>
  );
}
