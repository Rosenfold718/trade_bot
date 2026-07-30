'use client';

import { useState } from 'react';
import { useTerminalStore } from '@/lib/store';
import { STRATEGIES, getStrategy } from '@/lib/strategies';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { RotateCcw, Loader2, Zap, Power, DollarSign, Pencil, Check, X } from 'lucide-react';
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
  const [resetAmount, setResetAmount] = useState('');
  const [editingDeposit, setEditingDeposit] = useState(false);
  const [editDepositValue, setEditDepositValue] = useState('');
  const [savingDeposit, setSavingDeposit] = useState(false);
  const {
    traderState, isLoading, setIsLoading,
    autoTrading, setAutoTrading,
    activeStrategy, strategyStates,
    setStrategyTraderState, setStrategyOpenTrades, setStrategyRecentTrades,
    setStrategyTotalClosedPnl, setStrategyClosedTradeCount,
    setTraderState, setOpenTrades, setRecentTrades,
    setTotalClosedPnl, setClosedTradeCount,
  } = useTerminalStore();

  const strategy = getStrategy(activeStrategy);

  const handleReset = async () => {
    const amount = parseFloat(resetAmount);
    if (!amount || amount < 10) return;

    setIsLoading(true);
    try {
      // 1. Reset on server (delete trades + set balance/initial_balance)
      await fetch('/api/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ strategyId: activeStrategy, balance: amount }),
      });

      // 2. Re-fetch state from server to guarantee sync
      const initRes = await fetch(`/api/init?strategyId=${activeStrategy}`);
      if (initRes.ok) {
        const initData = await initRes.json();
        if (initData.state) {
          setStrategyTraderState(activeStrategy, initData.state);
        }
        setStrategyOpenTrades(activeStrategy, initData.openTrades ?? []);
        setStrategyRecentTrades(activeStrategy, initData.recentTrades ?? []);
        setStrategyTotalClosedPnl(activeStrategy, initData.totalClosedPnl ?? 0);
        setStrategyClosedTradeCount(activeStrategy, initData.closedTradeCount ?? 0);
      }

      setResetAmount('');
    } catch (err) {
      console.error('Reset error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveDeposit = async () => {
    const val = parseFloat(editDepositValue);
    if (!val || val < 10) return;
    setSavingDeposit(true);
    try {
      const res = await fetch('/api/update-deposit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ strategyId: activeStrategy, initialBalance: val }),
      });
      if (res.ok) {
        const data = await res.json();
        // Re-fetch state from server to get the recalculated balance
        const initRes = await fetch(`/api/trader?strategyId=${activeStrategy}`);
        if (initRes.ok) {
          const initData = await initRes.json();
          if (initData.state) {
            setStrategyTraderState(activeStrategy, initData.state);
          }
        }
        setEditingDeposit(false);
      }
    } catch (err) {
      console.error('Deposit update error:', err);
    } finally {
      setSavingDeposit(false);
    }
  };

  const handleStartEditDeposit = () => {
    setEditDepositValue((traderState?.initial_balance ?? 100).toFixed(0));
    setEditingDeposit(true);
  };

  const handleToggleAutoTrading = () => {
    setAutoTrading(!autoTrading);
  };

  // Calculate per-strategy balances for overview
  const allBalances = STRATEGIES.map(s => {
    const ss = strategyStates[s.id];
    const balance = ss?.traderState?.balance ?? 0;
    const initial = ss?.traderState?.initial_balance ?? 100;
    const pnl = ss?.totalClosedPnl ?? 0;
    const openCount = ss?.openTrades?.length ?? 0;
    return { ...s, balance, initial, pnl, openCount };
  });

  const totalBalance = allBalances.reduce((sum, s) => sum + s.balance, 0);
  const totalOpen = allBalances.reduce((sum, s) => sum + s.openCount, 0);

  return (
    <div className="p-3 space-y-2 max-w-lg">
      {/* Active Strategy Info */}
      {strategy && (
        <Card className="bg-[#12121e]/80 backdrop-blur-xl border-white/[0.06] rounded-xl">
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
                <span className="text-white/25">Макс плечо:</span>
                <span className="text-white/50">{strategy.maxLeverage}x</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-white/25">Риск:</span>
                <span className="text-white/50">1:{strategy.riskRewardRatio}</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-white/25">Лимит:</span>
                <span className="text-white/50">{strategy.maxOpenTrades}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Auto Trading Toggle */}
      <Card className="bg-[#12121e]/80 backdrop-blur-xl border-white/[0.06] rounded-xl">
        <CardHeader className="p-3 pb-2">
          <CardTitle className="text-[10px] uppercase tracking-widest text-white/25 font-medium flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Power className="h-3 w-3" />
              Авто-трейдинг
            </div>
            <div className="flex items-center gap-2 text-[10px] font-mono text-white/20">
              <span>Всего: ${totalBalance.toFixed(0)}</span>
              <span>·</span>
              <span>{totalOpen} откр.</span>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3 pt-0 space-y-2">
          <Button
            onClick={handleToggleAutoTrading}
            className={cn(
              'w-full h-10 text-xs rounded-lg font-semibold transition-all duration-200',
              autoTrading
                ? 'bg-green-600 hover:bg-green-700 text-white shadow-sm shadow-green-600/20'
                : 'bg-white/[0.04] hover:bg-white/[0.08] text-white/50 border border-white/[0.08]',
            )}
          >
            <Power className={cn('h-3.5 w-3.5 mr-2', autoTrading ? 'animate-pulse' : '')} />
            {autoTrading ? '● LIVE' : 'Включить авто-трейдинг'}
          </Button>
          {autoTrading && (
            <div className="flex items-center justify-between">
              <p className="text-[10px] text-green-400/50 font-mono animate-pulse">
                3 стратегии активны...
              </p>
            </div>
          )}

          {/* Per-strategy mini balances with deposit info */}
          {autoTrading && (
            <div className="grid grid-cols-3 gap-1.5 pt-1">
              {allBalances.map(s => {
                const pct = s.initial > 0 ? ((s.balance - s.initial) / s.initial * 100) : 0;
                return (
                  <div key={s.id} className="text-center">
                    <div className={cn('text-[10px] font-mono font-bold', s.id === activeStrategy ? s.color : 'text-white/40')}>
                      {s.name.split(' ')[0]}
                    </div>
                    <div className="text-[10px] font-mono text-white/50">${s.balance.toFixed(0)}</div>
                    <div className={cn('text-[9px] font-mono', pct >= 0 ? 'text-green-400/50' : 'text-red-400/50')}>
                      {pct >= 0 ? '+' : ''}{pct.toFixed(1)}%
                    </div>
                    {s.openCount > 0 && (
                      <div className="text-[9px] font-mono text-yellow-400/50">{s.openCount} откр.</div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Actions */}
      <Card className="bg-[#12121e]/80 backdrop-blur-xl border-white/[0.06] rounded-xl">
        <CardHeader className="p-3 pb-2">
          <CardTitle className="text-[10px] uppercase tracking-widest text-white/25 font-medium flex items-center gap-1.5">
            <Zap className="h-3 w-3" /> Управление
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3 pt-0 space-y-3">
          {/* Deposit amount editor */}
          {traderState && (
            <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.04]">
              <div className="flex items-center gap-2">
                <DollarSign className="h-3.5 w-3.5 text-white/25" />
                <span className="text-[10px] text-white/30">Депозит:</span>
                {editingDeposit ? (
                  <div className="flex items-center gap-1.5">
                    <Input
                      type="number"
                      value={editDepositValue}
                      onChange={(e) => setEditDepositValue(e.target.value)}
                      className="h-7 w-24 bg-white/[0.06] border-white/[0.1] text-xs text-white px-2 rounded-md"
                      min="10"
                      autoFocus
                      onKeyDown={(e) => e.key === 'Enter' && handleSaveDeposit()}
                    />
                    <button
                      onClick={handleSaveDeposit}
                      disabled={savingDeposit || !editDepositValue || parseFloat(editDepositValue) < 10}
                      className="p-1 rounded hover:bg-green-500/20 text-green-400 disabled:opacity-30 transition-colors"
                    >
                      {savingDeposit ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                    </button>
                    <button
                      onClick={() => setEditingDeposit(false)}
                      className="p-1 rounded hover:bg-red-500/20 text-white/30 transition-colors"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-bold font-mono text-white">${(traderState.initial_balance ?? 100).toFixed(0)}</span>
                    <button
                      onClick={handleStartEditDeposit}
                      className="p-1 rounded hover:bg-white/[0.06] text-white/20 hover:text-white/40 transition-colors"
                      title="Редактировать депозит"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                disabled={isLoading}
                className="w-full h-10 text-xs rounded-lg border-red-500/30 text-red-400/60 hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/50"
              >
                <RotateCcw className="h-3 w-3 mr-1.5" />
                Перезапуск {strategy?.name ?? ''}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="bg-[#1a1a2e] border-white/[0.06]">
              <AlertDialogHeader>
                <AlertDialogTitle className="text-white">
                  Перезапустить {strategy?.name ?? ''}?
                </AlertDialogTitle>
                <AlertDialogDescription className="text-white/50 space-y-3">
                  <p>
                    Укажите сумму депозита для перезапуска стратегии. Все текущие сделки будут закрыты и удалены, история очищена.
                  </p>
                  <div className="flex items-center gap-2 pt-1">
                    <DollarSign className="h-4 w-4 text-white/30 shrink-0" />
                    <Input
                      type="number"
                      placeholder={`Текущий депозит: $${traderState?.initial_balance?.toFixed(0) ?? '100'}`}
                      value={resetAmount}
                      onChange={(e) => setResetAmount(e.target.value)}
                      className="h-10 bg-white/[0.06] border-white/[0.1] text-sm text-white placeholder:text-white/25 rounded-lg"
                      min="10"
                      step="100"
                    />
                  </div>
                  <p className="text-[10px] text-white/30">
                    Минимальная сумма: $10. Остальные стратегии не затронуты.
                  </p>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter className="gap-2">
                <AlertDialogCancel className="bg-white/[0.04] border-white/[0.08] text-white/60 hover:bg-white/[0.08]">
                  Отмена
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleReset}
                  disabled={!resetAmount || parseFloat(resetAmount) < 10 || isLoading}
                  className="bg-red-600 hover:bg-red-700 text-white disabled:opacity-40"
                >
                  {isLoading ? <Loader2 className="h-3 w-3 animate-spin mr-1.5" /> : null}
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
