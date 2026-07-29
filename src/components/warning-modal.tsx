'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Shield, TrendingUp, AlertTriangle, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface WarningModalProps {
  onComplete: () => void;
}

const PAGES = [
  {
    icon: Shield,
    title: 'Добро пожаловать в торговую систему',
    color: 'text-emerald-400',
    content: `
      <div class="space-y-3 text-sm text-white/70 leading-relaxed">
        <p><strong class="text-white">Как это работает:</strong></p>
        <ul class="space-y-2 ml-4 list-none">
          <li class="flex gap-2"><span class="text-emerald-400 shrink-0">•</span><span>Введите любую сумму депозита — система будет дублировать торговый профиль, соответствующий вашим реальным средствам</span></li>
          <li class="flex gap-2"><span class="text-emerald-400 shrink-0">•</span><span>3 стратегии анализируют рынок 24/7 по 14+ техническим индикаторам, корреляции с BTC и Spike Guard (7 уровней фильтрации)</span></li>
          <li class="flex gap-2"><span class="text-emerald-400 shrink-0">•</span><span>Повторяйте сделки системы на реальном аккаунте — она показывает направление, размер позиции, плечо и стоп-лосс</span></li>
          <li class="flex gap-2"><span class="text-emerald-400 shrink-0">•</span><span>Каждую стратегию можно перезапустить с новой суммой в любой момент через панель «Управление»</span></li>
        </ul>
      </div>
    `,
  },
  {
    icon: TrendingUp,
    title: 'Философия стабильной торговли',
    color: 'text-emerald-400',
    content: `
      <div class="space-y-3 text-sm text-white/70 leading-relaxed">
        <p><strong class="text-white">Цель: спокойная, ликвидная торговля</strong></p>
        <div class="grid grid-cols-1 gap-2 mt-3">
          <div class="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3">
            <p class="text-emerald-300 font-medium text-xs uppercase tracking-wider">Целевая доходность</p>
            <p class="text-white font-bold text-lg mt-1">1–2% в день к депозиту</p>
            <p class="text-white/40 text-xs mt-1">Стабильно и управляемо</p>
          </div>
          <div class="bg-white/[0.04] border border-white/[0.08] rounded-lg p-3">
            <p class="text-white/50 font-medium text-xs uppercase tracking-wider">Убытки</p>
            <p class="text-white font-bold text-lg mt-1">Естественная часть торговли</p>
            <p class="text-white/40 text-xs mt-1">Система риск-менеджмента настроена так, чтобы убыточные сделки не превышали плановые лимиты</p>
          </div>
        </div>
        <ul class="space-y-2 ml-4 list-none mt-3">
          <li class="flex gap-2"><span class="text-emerald-400 shrink-0">✓</span><span>Контроль максимального плеча и размера позиции</span></li>
          <li class="flex gap-2"><span class="text-emerald-400 shrink-0">✓</span><span>ATR-адаптивные стоп-лоссы с трейлингом</span></li>
          <li class="flex gap-2"><span class="text-emerald-400 shrink-0">✓</span><span>Дневной лимит убытков (5% от депозита)</span></li>
          <li class="flex gap-2"><span class="text-emerald-400 shrink-0">✓</span><span>Фильтрация по корреляции с BTC</span></li>
        </ul>
        <div class="mt-3 bg-blue-500/[0.06] border border-blue-500/15 rounded-lg p-3">
          <p class="text-blue-300 font-medium text-xs">⏱ Время удержания позиций</p>
          <p class="text-white/50 text-xs mt-1">Каждая позиция держится от <strong class="text-white/70">24 до 72 часов</strong>. Временная просадка по позиции — это нормальная часть работы стратегии и не означает, что система ошиблась. Дождитесь закрытия по стоп-лоссу или тейк-профиту.</p>
        </div>
        <p class="text-white/40 text-xs mt-2 italic">Торговля — это марафон, а не спринт. Стабильность важнее скорости.</p>
      </div>
    `,
  },
  {
    icon: AlertTriangle,
    title: 'Важное предупреждение о рисках',
    color: 'text-amber-400',
    content: `
      <div class="space-y-3 text-sm text-white/70 leading-relaxed">
        <p><strong class="text-white">Система НЕ даёт 100% гарантий</strong> направления рынка.</p>
        <div class="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 mt-3">
          <p class="text-amber-300 font-medium">Вероятность успешных сделок: ~70/30</p>
          <p class="text-white/50 mt-1">Это значительно превосходит любой хедж-фонд на рынке. Однако 30% сделок могут быть убыточными — это нормальная часть торговой стратегии.</p>
        </div>
        <ul class="space-y-2 ml-4 list-none mt-3">
          <li class="flex gap-2"><span class="text-amber-400 shrink-0">⚠</span><span>Криптовалютный рынок крайне волатилен и непредсказуем</span></li>
          <li class="flex gap-2"><span class="text-amber-400 shrink-0">⚠</span><span>Прошлая прибыль не гарантирует будущих результатов</span></li>
          <li class="flex gap-2"><span class="text-amber-400 shrink-0">⚠</span><span>Торгуйте только теми средствами, потерю которых вы можете себе позволить</span></li>
        </ul>
      </div>
    `,
  },
];

export default function WarningModal({ onComplete }: WarningModalProps) {
  const { data: session } = useSession();
  const [page, setPage] = useState(0);
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const [isDismissing, setIsDismissing] = useState(false);
  const [loading, setLoading] = useState(true);

  const userId = (session?.user as any)?.id;
  const totalPages = PAGES.length;
  const currentPage = PAGES[page];
  const Icon = currentPage.icon;

  // Check if warning was already dismissed
  useEffect(() => {
    if (!userId) return;
    fetch(`/api/warning-dismissed?userId=${userId}`)
      .then(r => r.json())
      .then(data => {
        if (data.dismissed) {
          onComplete();
        } else {
          setLoading(false);
        }
      })
      .catch(() => setLoading(false));
  }, [userId, onComplete]);

  const handleDismiss = async () => {
    if (!userId) return;
    setIsDismissing(true);
    try {
      if (dontShowAgain) {
        await fetch('/api/warning-dismissed', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId }),
        });
      }
    } catch {
      // Even if save fails, let user proceed
    }
    onComplete();
  };

  if (loading) {
    return (
      <div className="fixed inset-0 z-[300] bg-[#0a0a0f] flex items-center justify-center">
        <Loader2 className="h-8 w-8 text-emerald-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[300] bg-[#0a0a0f]/95 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Page indicator */}
        <div className="flex items-center justify-center gap-1.5 mb-4">
          {PAGES.map((_, i) => (
            <div
              key={i}
              className={cn(
                'h-1 rounded-full transition-all duration-300',
                i === page ? 'w-8 bg-emerald-400' : 'w-4 bg-white/10',
              )}
            />
          ))}
        </div>

        <Card className="bg-[#12121e]/95 backdrop-blur-xl border-white/[0.06] rounded-2xl shadow-2xl">
          <CardContent className="p-6">
            {/* Header */}
            <div className="flex items-center gap-3 mb-4">
              <div className={cn(
                'w-10 h-10 rounded-xl flex items-center justify-center',
                page === 2 ? 'bg-amber-500/10 border border-amber-500/20' : 'bg-emerald-500/10 border border-emerald-500/20',
              )}>
                <Icon className={cn('h-5 w-5', currentPage.color)} />
              </div>
              <div>
                <h2 className="text-base font-bold text-white">{currentPage.title}</h2>
                <p className="text-[10px] text-white/30 font-mono">{page + 1} / {totalPages}</p>
              </div>
            </div>

            {/* Content */}
            <div
              className="min-h-[280px] mb-5 overflow-y-auto max-h-[50vh]"
              dangerouslySetInnerHTML={{ __html: currentPage.content }}
            />

            {/* Navigation */}
            <div className="flex items-center gap-2 mb-4">
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                className="h-9 w-9 p-0 rounded-lg border border-white/[0.12] bg-white/[0.04] text-white/50 hover:bg-white/[0.08] hover:text-white/70 disabled:opacity-20 disabled:cursor-not-allowed flex items-center justify-center transition-all"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <div className="flex-1 flex gap-1.5">
                {PAGES.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setPage(i)}
                    className={cn(
                      'flex-1 h-1 rounded-full transition-all duration-300',
                      i === page ? 'bg-emerald-400' : i < page ? 'bg-emerald-400/30' : 'bg-white/10 hover:bg-white/15',
                    )}
                  />
                ))}
              </div>
              <button
                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={page === totalPages - 1}
                className="h-9 w-9 p-0 rounded-lg border border-white/[0.12] bg-white/[0.04] text-white/50 hover:bg-white/[0.08] hover:text-white/70 disabled:opacity-20 disabled:cursor-not-allowed flex items-center justify-center transition-all"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            {/* Footer */}
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 shrink-0">
                <Checkbox
                  id="dontShowAgain"
                  checked={dontShowAgain}
                  onCheckedChange={(checked) => setDontShowAgain(checked === true)}
                  className="border-white/20 data-[state=checked]:bg-emerald-600 data-[state=checked]:border-emerald-600"
                />
                <label htmlFor="dontShowAgain" className="text-[11px] text-white/40 cursor-pointer select-none">
                  Не показывать снова
                </label>
              </div>
              <Button
                onClick={handleDismiss}
                disabled={isDismissing}
                className="flex-1 h-10 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold rounded-lg transition-all"
              >
                {isDismissing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : page < totalPages - 1 ? (
                  'Далее'
                ) : (
                  'Начать торговлю'
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
