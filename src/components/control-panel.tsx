'use client';

import { useState } from 'react';
import { useTerminalStore } from '@/lib/store';
import { STRATEGIES, getStrategy } from '@/lib/strategies';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CreditCard, RotateCcw, Play, Loader2, Zap, Power } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

export default function ControlPanel() {
  const [creditAmount, setCreditAmount] = useState('');
  const {
    traderState, setTraderState, backtestLoading, setBacktestLoading, isLoading, setIsLoading,
    autoTrading, setAutoTrading, setOpenTrades, setRecentTrades, setWeights, setBacktestResults,
    activeStrategy, strategyStates,
  } = useTerminalStore();

  const strategy = getStrategy(activeStrategy);

  const handleCredit = async () => {
    const amount = parseFloat(creditAmount);
    if (!amount || amount <= 0) return;

    setIsLoading(true);
    try {
      const res = await fetch('/api/credit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, strategyId: activeStrategy }),
      });
      const data = await res.json();
      if (data.success && traderState) {
        setTraderState({
          ...traderState,
          balance: traderState.balance + amount,
          borrowed_funds: traderState.borrowed_funds + amount,
        });
        setCreditAmount('');
      }
    } catch (err) {
      console.error('Credit error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleReset = async () => {
    setIsLoading(true);
    try {
      // Reset all strategies
      await Promise.all(STRATEGIES.map(async (s) => {
        await fetch('/api/reset', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ strategyId: s.id }),
        });
      }));
      // Reset the active strategy's local state
      setTraderState({ id: activeStrategy, strategy_id: activeStrategy, balance: 100, borrowed_funds: 0, debt_to_repay: 0, is_active: true });
      setOpenTrades([]);
      setRecentTrades([]);
      setBacktestResults([]);
      setAutoTrading(false);
      setWeights([
        { id: 'rsi', indicator_name: 'RSI', weight: 1, calculated_winrate: null },
        { id: 'macd', indicator_name: 'MACD', weight: 1, calculated_winrate: null },
        { id: 'ema50', indicator_name: 'EMA_50', weight: 1, calculated_winrate: null },
        { id: 'ema200', indicator_name: 'EMA_200', weight: 1, calculated_winrate: null },
        { id: 'bollinger', indicator_name: 'Bollinger', weight: 1, calculated_winrate: null },
        { id: 'volume', indicator_name: 'Volume', weight: 1, calculated_winrate: null },
        { id: 'stochrsi', indicator_name: 'StochRSI', weight: 1, calculated_winrate: null },
        { id: 'adx', indicator_name: 'ADX', weight: 1, calculated_winrate: null },
        { id: 'obv', indicator_name: 'OBV', weight: 1, calculated_winrate: null },
        { id: 'vwap', indicator_name: 'VWAP', weight: 1, calculated_winrate: null },
      ]);
    } catch (err) {
      console.error('Reset error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleBacktest = async () => {
    setBacktestLoading(true);
    try {
      const res = await fetch('/api/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ strategyId: activeStrategy }),
      });
      const data = await res.json();
      if (data.success) {
        const wRes = await fetch(`/api/weights?strategyId=${activeStrategy}`);
        const wData = await wRes.json();
        if (Array.isArray(wData)) setWeights(wData);

        const bRes = await fetch(`/api/backtest?strategyId=${activeStrategy}`);
        const bData = await bRes.json();
        if (Array.isArray(bData)) setBacktestResults(bData);
      }
    } catch (err) {
      console.error('Backtest error:', err);
    } finally {
      setBacktestLoading(false);
    }
  };

  const handleToggleAutoTrading = () => {
    setAutoTrading(!autoTrading);
  };

  // Calculate per-strategy balances for overview
  const allBalances = STRATEGIES.map(s => {
    const ss = strategyStates[s.id];
    const balance = ss?.traderState?.balance ?? 0;
    const openCount = ss?.openTrades?.length ?? 0;
    return { ...s, balance, openCount };
  });

  const totalBalance = allBalances.reduce((sum, s) => sum + s.balance, 0);
  const totalOpen = allBalances.reduce((sum, s) => sum + s.openCount, 0);

  return (
    <div className="p-3 space-y-2">
      {/* Active Strategy Info */}
      {strategy && (
        <Card className="bg-[#12121e]/80 backdrop-blur-xl border-white/5 rounded-xl">
          <CardHeader className="p-3 pb-2">
            <CardTitle className={cn('text-xs uppercase tracking-wider font-medium', strategy.color)}>
              {strategy.name}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0 space-y-1.5">
            <p className="text-[10px] text-white/40 leading-relaxed">
              {strategy.description}
            </p>
            <div className="flex items-center gap-3 text-[10px] font-mono">
              <div className="flex items-center gap-1">
                <span className="text-white/30">Макс плечо:</span>
                <span className="text-white/70">{strategy.maxLeverage}x</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-white/30">Риск:</span>
                <span className="text-white/70">1:{strategy.riskRewardRatio}</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-white/30">Лимит:</span>
                <span className="text-white/70">{strategy.maxOpenTrades}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Auto Trading Toggle */}
      <Card className="bg-[#12121e]/80 backdrop-blur-xl border-white/5 rounded-xl">
        <CardHeader className="p-3 pb-2">
          <CardTitle className="text-xs uppercase tracking-wider text-white/50 font-medium flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Power className="h-3 w-3" />
              Авто-трейдинг
            </div>
            <div className="flex items-center gap-2 text-[10px] font-mono text-white/30">
              <span>Всего: ${totalBalance.toFixed(0)}</span>
              <span>·</span>
              <span>{totalOpen} open</span>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3 pt-0 space-y-2">
          <Button
            onClick={handleToggleAutoTrading}
            className={cn(
              'w-full h-9 text-xs rounded-lg font-semibold transition-all duration-300',
              autoTrading
                ? 'bg-green-600 hover:bg-green-700 text-white shadow-lg shadow-green-600/20'
                : 'bg-white/5 hover:bg-white/10 text-white/70 border border-white/10',
            )}
          >
            <Power className={cn('h-3.5 w-3.5 mr-2', autoTrading ? 'animate-pulse' : '')} />
            {autoTrading ? `● 3 СТРАТЕГИИ АКТИВНЫ` : 'Включить авто-трейдинг'}
          </Button>
          {autoTrading && (
            <div className="flex items-center justify-between">
              <p className="text-[10px] text-green-400/60 font-mono animate-pulse">
                Сканирует 3 стратегии каждые 30 сек...
              </p>
            </div>
          )}

          {/* Per-strategy mini balances */}
          {autoTrading && (
            <div className="grid grid-cols-3 gap-1.5 pt-1">
              {allBalances.map(s => (
                <div key={s.id} className="text-center">
                  <div className={cn('text-[9px] font-mono font-bold', s.id === activeStrategy ? s.color : 'text-white/40')}>
                    {s.name.split(' ')[0]}
                  </div>
                  <div className="text-[10px] font-mono text-white/60">${s.balance.toFixed(0)}</div>
                  {s.openCount > 0 && (
                    <div className="text-[8px] font-mono text-yellow-400/60">{s.openCount} open</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Credit */}
      <Card className="bg-[#12121e]/80 backdrop-blur-xl border-white/5 rounded-xl">
        <CardHeader className="p-3 pb-2">
          <CardTitle className="text-xs uppercase tracking-wider text-white/50 font-medium flex items-center gap-1.5">
            <CreditCard className="h-3 w-3" /> Кредит
            {strategy && <span className="text-[9px] font-mono ml-auto text-white/25">({strategy.name})</span>}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3 pt-0 space-y-2">
          <div className="flex gap-2">
            <Input
              type="number"
              placeholder="Сумма $"
              value={creditAmount}
              onChange={(e) => setCreditAmount(e.target.value)}
              className="h-8 bg-white/5 border-white/10 text-xs text-white/90 placeholder:text-white/30 rounded-md"
              min="0"
              step="10"
            />
            <Button
              size="sm"
              onClick={handleCredit}
              disabled={isLoading || !creditAmount}
              className="h-8 px-3 bg-green-600 hover:bg-green-700 text-white text-xs rounded-md"
            >
              {isLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Дать'}
            </Button>
          </div>
          {traderState && traderState.debt_to_repay > 0 && (
            <p className="text-[10px] text-red-400/70 font-mono">
              Долг: ${traderState.debt_to_repay.toFixed(2)} (10% от прибыли)
            </p>
          )}
        </CardContent>
      </Card>

      {/* Actions */}
      <Card className="bg-[#12121e]/80 backdrop-blur-xl border-white/5 rounded-xl">
        <CardHeader className="p-3 pb-2">
          <CardTitle className="text-xs uppercase tracking-wider text-white/50 font-medium flex items-center gap-1.5">
            <Zap className="h-3 w-3" /> Управление
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3 pt-0 space-y-2">
          <Button
            onClick={handleBacktest}
            disabled={backtestLoading}
            variant="outline"
            className="w-full h-8 text-xs rounded-md border-white/10 text-white/80 hover:bg-white/5 hover:text-white"
          >
            {backtestLoading ? (
              <Loader2 className="h-3 w-3 animate-spin mr-1.5" />
            ) : (
              <Play className="h-3 w-3 mr-1.5" />
            )}
            {backtestLoading ? 'Бэктест...' : 'Запустить Бэктест'}
          </Button>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                disabled={isLoading}
                className="w-full h-8 text-xs rounded-md border-red-500/30 text-red-400/70 hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/50"
              >
                <RotateCcw className="h-3 w-3 mr-1.5" />
                Перезапуск
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="bg-[#1a1a2e] border-white/10">
              <AlertDialogHeader>
                <AlertDialogTitle className="text-white">Перезапустить все стратегии?</AlertDialogTitle>
                <AlertDialogDescription className="text-white/60">
                  Все данные 3 стратегий будут сброшены. Баланс: $100 каждая, кредит: $0, все сделки очищены.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="bg-white/5 border-white/10 text-white/80 hover:bg-white/10">
                  Отмена
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleReset}
                  className="bg-red-600 hover:bg-red-700 text-white"
                >
                  Перезапустить
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>
    </div>
  );
}