'use client';

import { useState } from 'react';
import { useTerminalStore } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CreditCard, RotateCcw, Play, Loader2, Zap } from 'lucide-react';
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
  const { traderState, setTraderState, backtestLoading, setBacktestLoading, isLoading, setIsLoading, autoTrading, setAutoTrading, setOpenTrades, setRecentTrades, setWeights, setBacktestResults } = useTerminalStore();

  const handleCredit = async () => {
    const amount = parseFloat(creditAmount);
    if (!amount || amount <= 0) return;

    setIsLoading(true);
    try {
      const res = await fetch('/api/credit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount }),
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
      await fetch('/api/reset', { method: 'POST' });
      setTraderState({ id: 'main', balance: 100, borrowed_funds: 0, debt_to_repay: 0, is_active: true });
      setOpenTrades([]);
      setRecentTrades([]);
      setBacktestResults([]);
      setWeights([
        { id: 'rsi', indicator_name: 'RSI', weight: 1, calculated_winrate: null },
        { id: 'macd', indicator_name: 'MACD', weight: 1, calculated_winrate: null },
        { id: 'ema50', indicator_name: 'EMA_50', weight: 1, calculated_winrate: null },
        { id: 'ema200', indicator_name: 'EMA_200', weight: 1, calculated_winrate: null },
        { id: 'bollinger', indicator_name: 'Bollinger', weight: 1, calculated_winrate: null },
        { id: 'volume', indicator_name: 'Volume', weight: 1, calculated_winrate: null },
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
      const res = await fetch('/api/backtest', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        // Refresh weights
        const wRes = await fetch('/api/weights');
        const wData = await wRes.json();
        if (Array.isArray(wData)) setWeights(wData);

        // Refresh backtest results
        const bRes = await fetch('/api/backtest');
        const bData = await bRes.json();
        if (Array.isArray(bData)) setBacktestResults(bData);
      }
    } catch (err) {
      console.error('Backtest error:', err);
    } finally {
      setBacktestLoading(false);
    }
  };

  const handleAutoTrade = async () => {
    if (autoTrading) {
      setAutoTrading(false);
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch('/api/trader', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'auto-trade' }),
      });
      const data = await res.json();

      if (data.success) {
        // Refresh state
        const initRes = await fetch('/api/init');
        const initData = await initRes.json();
        if (initData.state) setTraderState(initData.state);
        if (initData.openTrades) setOpenTrades(initData.openTrades);
        if (initData.recentTrades) setRecentTrades(initData.recentTrades);
      }
    } catch (err) {
      console.error('Auto-trade error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="p-3 space-y-2">
      {/* Credit */}
      <Card className="bg-[#12121e]/80 backdrop-blur-xl border-white/5 rounded-xl">
        <CardHeader className="p-3 pb-2">
          <CardTitle className="text-xs uppercase tracking-wider text-white/50 font-medium flex items-center gap-1.5">
            <CreditCard className="h-3 w-3" /> Кредит
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
            onClick={handleAutoTrade}
            disabled={isLoading}
            className={`w-full h-8 text-xs rounded-md font-medium ${
              autoTrading
                ? 'bg-red-600 hover:bg-red-700 text-white'
                : 'bg-blue-600 hover:bg-blue-700 text-white'
            }`}
          >
            {isLoading ? (
              <Loader2 className="h-3 w-3 animate-spin mr-1.5" />
            ) : (
              <Zap className="h-3 w-3 mr-1.5" />
            )}
            {isLoading ? 'Анализ...' : autoTrading ? 'Стоп Авто' : 'Авто-сделка'}
          </Button>

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
                <AlertDialogTitle className="text-white">Перезапустить трейдера?</AlertDialogTitle>
                <AlertDialogDescription className="text-white/60">
                  Все данные будут удалены. Баланс: $100, кредит: $0, все сделки очищены, веса сброшены.
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