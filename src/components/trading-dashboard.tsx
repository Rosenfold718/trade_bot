'use client';

import { useTerminalStore } from '@/lib/store';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Wallet, TrendingUp, TrendingDown, CreditCard, Activity } from 'lucide-react';
import type { Trade } from '@/lib/types';

function formatPrice(price: number): string {
  if (price >= 1000) return `$${price.toFixed(2)}`;
  if (price >= 1) return `$${price.toFixed(4)}`;
  return `$${price.toPrecision(4)}`;
}

function StatCard({
  label,
  value,
  icon: Icon,
  color,
  subValue,
}: {
  label: string;
  value: string;
  icon: React.ElementType;
  color: string;
  subValue?: string;
}) {
  return (
    <Card className="bg-[#12121e]/80 backdrop-blur-xl border-white/5 rounded-xl shadow-lg shadow-black/20">
      <CardContent className="p-3.5">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] uppercase tracking-wider text-white/40 font-medium">{label}</span>
          <Icon className={`h-3.5 w-3.5 ${color}`} />
        </div>
        <div className="text-lg font-bold text-white/95 font-mono">{value}</div>
        {subValue && <div className="text-[10px] text-white/40 mt-0.5 font-mono">{subValue}</div>}
      </CardContent>
    </Card>
  );
}

export default function TradingDashboard() {
  const { traderState, openTrades, recentTrades, weights, currentAnalysis } =
    useTerminalStore();

  if (!traderState) {
    return (
      <div className="p-4 space-y-3">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-20 bg-white/5 rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  const totalPnl = recentTrades
    .filter((t) => t.status === 'closed' && t.pnl !== null)
    .reduce((sum, t) => sum + (t.pnl ?? 0), 0);

  return (
    <div className="p-3 space-y-3">
      {/* Balance Stats */}
      <div className="grid grid-cols-2 gap-2">
        <StatCard
          label="Баланс"
          value={`$${traderState.balance.toFixed(2)}`}
          icon={Wallet}
          color="text-blue-400"
          subValue={traderState.borrowed_funds > 0 ? `Кредит: $${traderState.borrowed_funds.toFixed(2)}` : undefined}
        />
        <StatCard
          label="PnL"
          value={`${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)}`}
          icon={totalPnl >= 0 ? TrendingUp : TrendingDown}
          color={totalPnl >= 0 ? 'text-green-400' : 'text-red-400'}
        />
        <StatCard
          label="Открытых"
          value={`${openTrades.length}`}
          icon={Activity}
          color="text-yellow-400"
        />
        <StatCard
          label="Долг"
          value={`$${traderState.debt_to_repay.toFixed(2)}`}
          icon={CreditCard}
          color={traderState.debt_to_repay > 0 ? 'text-red-400' : 'text-green-400'}
        />
      </div>

      {/* Open Trades */}
      {openTrades.length > 0 && (
        <Card className="bg-[#12121e]/80 backdrop-blur-xl border-white/5 rounded-xl">
          <CardHeader className="p-3 pb-2">
            <CardTitle className="text-xs uppercase tracking-wider text-white/50 font-medium">Открытые сделки</CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0 space-y-2">
            {openTrades.map((trade) => (
              <TradeCard key={trade.id} trade={trade} type="open" />
            ))}
          </CardContent>
        </Card>
      )}

      {/* Analysis */}
      {currentAnalysis && currentAnalysis.direction !== 'none' && (
        <Card className="bg-[#12121e]/80 backdrop-blur-xl border-white/5 rounded-xl">
          <CardHeader className="p-3 pb-2">
            <CardTitle className="text-xs uppercase tracking-wider text-white/50 font-medium">
              Анализ {currentAnalysis.symbol}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0">
            <div className="flex items-center gap-2 mb-2">
              <Badge
                variant="outline"
                className={
                  currentAnalysis.direction === 'long'
                    ? 'border-green-500/50 text-green-400 bg-green-500/10 text-[10px]'
                    : 'border-red-500/50 text-red-400 bg-red-500/10 text-[10px]'
                }
              >
                {currentAnalysis.direction.toUpperCase()} {currentAnalysis.leverage}x
              </Badge>
              <span className="text-[10px] text-white/40 font-mono">
                Score: {currentAnalysis.score.toFixed(2)}
              </span>
            </div>
            <div className="grid grid-cols-6 gap-1">
              {currentAnalysis.indicators.map((ind) => (
                <div key={ind.name} className="text-center">
                  <div
                    className={`text-[9px] font-mono font-bold ${
                      ind.signal > 0 ? 'text-green-400' : ind.signal < 0 ? 'text-red-400' : 'text-white/30'
                    }`}
                  >
                    {ind.signal > 0 ? '↑' : ind.signal < 0 ? '↓' : '—'}
                  </div>
                  <div className="text-[8px] text-white/30">{ind.name}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Weights */}
      <Card className="bg-[#12121e]/80 backdrop-blur-xl border-white/5 rounded-xl">
        <CardHeader className="p-3 pb-2">
          <CardTitle className="text-xs uppercase tracking-wider text-white/50 font-medium">Веса индикаторов</CardTitle>
        </CardHeader>
        <CardContent className="p-3 pt-0">
          <div className="space-y-1.5">
            {weights.map((w) => (
              <div key={w.id} className="flex items-center justify-between">
                <span className="text-[10px] text-white/60 font-mono">{w.indicator_name}</span>
                <div className="flex items-center gap-2">
                  <div className="w-16 h-1.5 bg-white/5 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        w.weight >= 1.5 ? 'bg-green-400' : w.weight >= 1 ? 'bg-blue-400' : 'bg-red-400'
                      }`}
                      style={{ width: `${Math.min(w.weight / 2.5 * 100, 100)}%` }}
                    />
                  </div>
                  <span className="text-[10px] font-mono text-white/60 w-8 text-right">{w.weight.toFixed(2)}</span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Recent Trades */}
      {recentTrades.length > 0 && (
        <Card className="bg-[#12121e]/80 backdrop-blur-xl border-white/5 rounded-xl">
          <CardHeader className="p-3 pb-2">
            <CardTitle className="text-xs uppercase tracking-wider text-white/50 font-medium">Последние сделки</CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0 space-y-1.5 max-h-48 overflow-y-auto">
            {recentTrades.slice(0, 10).map((trade) => (
              <TradeCard key={trade.id} trade={trade} type="closed" />
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function TradeCard({ trade, type }: { trade: Trade; type: 'open' | 'closed' }) {
  const isLong = trade.direction === 'long';
  const pnlColor = trade.pnl !== null ? (trade.pnl >= 0 ? 'text-green-400' : 'text-red-400') : '';

  return (
    <div className="flex items-center justify-between p-2 bg-white/[0.03] rounded-lg">
      <div className="flex items-center gap-2">
        <Badge
          variant="outline"
          className={`text-[9px] px-1.5 py-0 ${isLong ? 'border-green-500/30 text-green-400' : 'border-red-500/30 text-red-400'}`}
        >
          {trade.direction.toUpperCase()}
        </Badge>
        <div>
          <div className="text-[10px] font-semibold text-white/80">{trade.symbol.replace('USDT', '')}</div>
          <div className="text-[9px] text-white/35 font-mono">
            {trade.leverage}x · ${trade.amount.toFixed(2)}
          </div>
        </div>
      </div>
      <div className="text-right">
        {type === 'closed' && trade.pnl !== null && (
          <div className={`text-[10px] font-mono font-bold ${pnlColor}`}>
            {trade.pnl >= 0 ? '+' : ''}${trade.pnl.toFixed(2)}
          </div>
        )}
        <div className="text-[9px] text-white/35 font-mono">{formatPrice(trade.entry_price)}</div>
      </div>
    </div>
  );
}