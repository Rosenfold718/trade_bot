'use client';

import { useMemo } from 'react';
import { useTerminalStore } from '@/lib/store';
import { getStrategy } from '@/lib/strategies';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Wallet, TrendingUp, TrendingDown, CreditCard, Activity, Gauge, ArrowUpCircle, ArrowDownCircle, MinusCircle } from 'lucide-react';
import type { Trade, IndicatorSignal } from '@/lib/types';

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
          <Icon className={cn('h-3.5 w-3.5', color)} />
        </div>
        <div className="text-lg font-bold text-white/95 font-mono">{value}</div>
        {subValue && <div className="text-[10px] text-white/40 mt-0.5 font-mono">{subValue}</div>}
      </CardContent>
    </Card>
  );
}

// ============================================================
// Signal Gauge Component (-10 to +10)
// ============================================================

function SignalGauge({ score }: { score: number }) {
  const clamped = Math.max(-10, Math.min(10, score));
  const percentage = ((clamped + 10) / 20) * 100;

  const color = clamped > 2
    ? 'from-green-500 to-green-400'
    : clamped < -2
      ? 'from-red-500 to-red-400'
      : 'from-yellow-500 to-yellow-400';

  const label = clamped > 2 ? 'РЫНОК ВВЕРХ' : clamped < -2 ? 'РЫНОК ВНИЗ' : 'НЕЙТРАЛЬНО';
  const labelColor = clamped > 2 ? 'text-green-400' : clamped < -2 ? 'text-red-400' : 'text-yellow-400';

  const needleAngle = -90 + (clamped / 10) * 90;

  return (
    <div className="space-y-2">
      <div className="relative h-20 flex items-end justify-center overflow-hidden">
        <svg viewBox="0 0 200 110" className="w-full h-full">
          <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="10" strokeLinecap="round" />
          <path d="M 20 100 A 80 80 0 0 1 100 20" fill="none" stroke="rgba(239,68,68,0.2)" strokeWidth="10" strokeLinecap="round" />
          <path d="M 100 20 A 80 80 0 0 1 180 100" fill="none" stroke="rgba(34,197,94,0.2)" strokeWidth="10" strokeLinecap="round" />
          {Math.abs(clamped) > 0.5 && (
            <path
              d="M 20 100 A 80 80 0 0 1 180 100"
              fill="none"
              stroke="url(#gaugeGradient)"
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={`${Math.abs(percentage) * 2.51} 251`}
              strokeDashoffset={clamped > 0 ? 0 : 251 - percentage * 2.51}
              className="transition-all duration-700 ease-out"
            />
          )}
          <defs>
            <linearGradient id="gaugeGradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#ef4444" />
              <stop offset="50%" stopColor="#eab308" />
              <stop offset="100%" stopColor="#22c55e" />
            </linearGradient>
          </defs>
          <line x1="100" y1="18" x2="100" y2="28" stroke="rgba(255,255,255,0.2)" strokeWidth="1" />
          <g transform={`rotate(${needleAngle}, 100, 100)`}>
            <line x1="100" y1="100" x2="100" y2="35" stroke="white" strokeWidth="2" strokeLinecap="round" className="transition-transform duration-700 ease-out" />
            <circle cx="100" cy="100" r="4" fill="white" />
          </g>
          <text x="15" y="112" fill="rgba(239,68,68,0.6)" fontSize="8" fontFamily="monospace">-10</text>
          <text x="92" y="15" fill="rgba(255,255,255,0.3)" fontSize="8" fontFamily="monospace">0</text>
          <text x="178" y="112" fill="rgba(34,197,94,0.6)" fontSize="8" fontFamily="monospace">+10</text>
        </svg>
      </div>
      <div className="text-center">
        <div className="text-2xl font-bold font-mono text-white/95">{clamped > 0 ? '+' : ''}{clamped.toFixed(1)}</div>
        <span className={cn('text-[10px] font-mono font-bold tracking-wider', labelColor)}>{label}</span>
      </div>
    </div>
  );
}

// ============================================================
// Indicator Row Component
// ============================================================

function IndicatorRow({ indicator }: { indicator: IndicatorSignal }) {
  const barWidth = indicator.strength * 100;

  return (
    <div className="flex items-center gap-2 py-1">
      <div className="w-20 shrink-0">
        <span className="text-[10px] text-white/50 font-mono">{indicator.name}</span>
      </div>
      <div className="flex-1 flex items-center gap-1.5">
        <div className="w-4 shrink-0 flex justify-center">
          {indicator.signal > 0 ? (
            <ArrowUpCircle className="w-3.5 h-3.5 text-green-400" />
          ) : indicator.signal < 0 ? (
            <ArrowDownCircle className="w-3.5 h-3.5 text-red-400" />
          ) : (
            <MinusCircle className="w-3.5 h-3.5 text-white/20" />
          )}
        </div>
        <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden relative">
          {indicator.signal !== 0 && (
            <div
              className={cn(
                'absolute top-0 h-full rounded-full transition-all duration-500',
                indicator.signal > 0
                  ? 'bg-gradient-to-r from-green-500/60 to-green-400'
                  : 'bg-gradient-to-l from-red-500/60 to-red-400 right-0',
              )}
              style={{
                width: `${barWidth}%`,
                left: indicator.signal < 0 ? 'auto' : 0,
                right: indicator.signal < 0 ? 0 : 'auto',
              }}
            />
          )}
        </div>
        <span className="text-[9px] font-mono text-white/30 w-7 text-right shrink-0">
          {(indicator.strength * 100).toFixed(0)}%
        </span>
      </div>
    </div>
  );
}

// ============================================================
// Recommended Action Badge
// ============================================================

function RecommendedAction({ score }: { score: number }) {
  const absScore = Math.abs(score);
  const confidence = Math.min(100, (absScore / 10) * 100);

  let action: string;
  let color: string;
  let bgColor: string;
  let borderColor: string;

  if (score > 3) {
    action = 'ПОКУПКА';
    color = 'text-green-400';
    bgColor = 'bg-green-500/10';
    borderColor = 'border-green-500/30';
  } else if (score < -3) {
    action = 'ПРОДАЖА';
    color = 'text-red-400';
    bgColor = 'bg-red-500/10';
    borderColor = 'border-red-500/30';
  } else {
    action = 'ОЖИДАНИЕ';
    color = 'text-yellow-400';
    bgColor = 'bg-yellow-500/10';
    borderColor = 'border-yellow-500/30';
  }

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Gauge className={cn('w-3.5 h-3.5', color)} />
        <span className={cn('text-sm font-bold font-mono', color)}>{action}</span>
      </div>
      <Badge variant="outline" className={cn('text-[10px] font-mono px-2 py-0.5', color, bgColor, borderColor)}>
        {confidence.toFixed(0)}% уверенность
      </Badge>
    </div>
  );
}

export default function TradingDashboard() {
  const { traderState, openTrades, recentTrades, weights, currentAnalysis, activeStrategy } =
    useTerminalStore();

  const strategy = getStrategy(activeStrategy);

  const overallScore = useMemo(() => {
    if (!currentAnalysis || !currentAnalysis.indicators.length) return 0;
    let score = 0;
    for (const ind of currentAnalysis.indicators) {
      score += ind.signal * ind.strength;
    }
    const maxPossible = currentAnalysis.indicators.length;
    return maxPossible > 0 ? (score / maxPossible) * 10 : 0;
  }, [currentAnalysis]);

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
    <div className="p-2.5 sm:p-3 space-y-3 max-w-lg">
      {/* Strategy badge */}
      {strategy && (
        <div className={cn('flex items-center gap-2 px-3 py-1.5 rounded-lg border', strategy.bgColor, strategy.borderColor)}>
          <div className={cn('w-1.5 h-1.5 rounded-full', strategy.color.replace('text-', 'bg-'))} />
          <span className={cn('text-[10px] font-bold font-mono', strategy.color)}>{strategy.name}</span>
          <span className="text-[9px] text-white/30 ml-auto font-mono">{strategy.maxLeverage}x · 1:{strategy.riskRewardRatio}</span>
        </div>
      )}

      {/* Balance Stats */}
      <div className="grid grid-cols-2 gap-2">
        <StatCard
          label="Баланс"
          value={`$${traderState.balance.toFixed(2)}`}
          icon={Wallet}
          color={strategy?.color ?? 'text-white/70'}
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

      {/* Detailed Analysis Panel */}
      {currentAnalysis && currentAnalysis.indicators.length > 0 && (
        <Card className="bg-[#12121e]/80 backdrop-blur-xl border-white/5 rounded-xl">
          <CardHeader className="p-3 pb-2">
            <CardTitle className="text-xs uppercase tracking-wider text-white/50 font-medium">
              Анализ {currentAnalysis.symbol}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0 space-y-3">
            <SignalGauge score={overallScore} />
            <RecommendedAction score={overallScore} />
            <div className="flex items-center gap-2">
              {currentAnalysis.direction !== 'none' && (
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
              )}
              <span className="text-[10px] text-white/30 font-mono">
                Сырой балл: {currentAnalysis.score.toFixed(2)}
              </span>
            </div>
            <div className="h-px bg-white/5" />
            <div className="space-y-0.5">
              <div className="text-[9px] uppercase tracking-wider text-white/30 font-medium mb-1.5">Индикаторы</div>
              {currentAnalysis.indicators.map((ind) => (
                <IndicatorRow key={ind.name} indicator={ind} />
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
                      className={cn(
                        'h-full rounded-full transition-all duration-500',
                        w.weight >= 1.5 ? 'bg-green-400' : w.weight >= 1 ? 'bg-amber-400' : 'bg-red-400',
                      )}
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
    </div>
  );
}