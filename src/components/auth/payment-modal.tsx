'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Loader2, CheckCircle, LogOut, Shield, Zap, Star, Crown, Gem,
  Clock, Copy, ExternalLink, Wallet, Send, Check,
} from 'lucide-react';

const WALLET_ADDRESS = 'UQC2_CBuEhAmxr4fJBt-gGdP8u3Mc1-RNcinUPc6ydxz1cJO';

interface Plan {
  id: number;
  months: number;
  label: string;
  priceUSD: number;
  perMonth: string;
  icon: React.ReactNode;
  popular?: boolean;
}

const PLANS: Plan[] = [
  { id: 1, months: 1, label: '1 месяц', priceUSD: 49, perMonth: '$49/мес', icon: <Zap className="w-5 h-5" /> },
  { id: 3, months: 3, label: '3 месяца', priceUSD: 129, perMonth: '$43/мес', icon: <Star className="w-5 h-5" />, popular: true },
  { id: 6, months: 6, label: '6 месяцев', priceUSD: 229, perMonth: '$38/мес', icon: <Crown className="w-5 h-5" /> },
  { id: 12, months: 12, label: '12 месяцев', priceUSD: 399, perMonth: '$33/мес', icon: <Gem className="w-5 h-5" /> },
];

interface PaymentModalProps {
  onClose: () => void;
}

export default function PaymentModal({ onClose }: PaymentModalProps) {
  const { data: session } = useSession();
  const [selectedPlan, setSelectedPlan] = useState<number>(3);
  const [txHash, setTxHash] = useState('');
  const [walletCopied, setWalletCopied] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [approved, setApproved] = useState(false);
  const [countdown, setCountdown] = useState(0);

  const activePlan = PLANS.find(p => p.id === selectedPlan) ?? PLANS[1];

  // Poll subscription status after submission
  const pollStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/subscription');
      if (res.ok) {
        const data = await res.json();
        if (data.isActive) {
          setApproved(true);
          setCountdown(3);
          setTimeout(() => onClose(), 3000);
          return true;
        }
      }
    } catch {}
    return false;
  }, [onClose]);

  useEffect(() => {
    if (!submitted || approved) return;
    pollStatus();
    const interval = setInterval(async () => {
      const isActive = await pollStatus();
      if (isActive) clearInterval(interval);
    }, 5000);
    return () => clearInterval(interval);
  }, [submitted, approved, pollStatus]);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setInterval(() => {
      setCountdown(prev => { if (prev <= 0) { clearInterval(timer); return 0; } return prev - 1; });
    }, 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  const copyWallet = async () => {
    try {
      await navigator.clipboard.writeText(WALLET_ADDRESS);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = WALLET_ADDRESS;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    setWalletCopied(true);
    setTimeout(() => setWalletCopied(false), 2000);
  };

  const handleSubmitPayment = async () => {
    setError('');
    setVerifying(true);
    try {
      const res = await fetch('/api/subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'confirm-payment',
          months: activePlan.months,
          txHash: txHash.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setSubmitted(true);
      } else {
        setError(data.error || 'Ошибка отправки заявки');
      }
    } catch {
      setError('Ошибка связи с сервером');
    } finally {
      setVerifying(false);
    }
  };

  const handleLogout = async () => { await signOut({ redirect: false }); };

  // ── Approved ──
  if (approved && countdown <= 0) return null;
  if (approved) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#0a0a0f]/95 backdrop-blur-xl">
        <Card className="w-full max-w-md mx-4 bg-[#12121e]/95 border-green-500/30 rounded-2xl shadow-2xl shadow-green-500/5">
          <CardContent className="p-8 text-center space-y-5">
            <div className="w-20 h-20 mx-auto rounded-full bg-green-500/10 flex items-center justify-center animate-pulse">
              <CheckCircle className="w-10 h-10 text-green-400" />
            </div>
            <h2 className="text-xl font-bold text-white">Оплата подтверждена!</h2>
            <p className="text-sm text-white/50">Перенаправляем в терминал через {countdown} сек...</p>
            <Button onClick={onClose} className="w-full h-11 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-xl">
              Войти в терминал
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Pending ──
  if (submitted) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#0a0a0f]/95 backdrop-blur-xl">
        <Card className="w-full max-w-md mx-4 bg-[#12121e]/95 border-amber-500/30 rounded-2xl shadow-2xl shadow-black/60">
          <CardContent className="p-8 text-center space-y-6">
            <div className="w-16 h-16 mx-auto rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
              <Clock className="w-8 h-8 text-amber-400 animate-pulse" />
            </div>
            <div className="space-y-2">
              <h2 className="text-xl font-bold text-white">Заявка отправлена</h2>
              <p className="text-sm text-white/50">
                Тариф: <span className="text-white font-medium">{activePlan.label}</span> — <span className="text-white font-medium">${activePlan.priceUSD}</span>
              </p>
              <p className="text-sm text-white/40">
                Ожидайте подтверждения оплаты администратором.
                Страница обновляется автоматически.
              </p>
            </div>
            <div className="flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 text-amber-400 animate-spin" />
              <span className="text-xs text-white/30">Проверка статуса...</span>
            </div>
            <button onClick={handleLogout} className="w-full flex items-center justify-center gap-2 text-xs text-white/30 hover:text-white/60 transition-colors py-2">
              <LogOut className="w-3.5 h-3.5" />
              Выйти из аккаунта
            </button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Main payment screen ──
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[#0a0a0f]/95 backdrop-blur-xl"
      onClick={(e) => { if (e.target === e.currentTarget) { e.preventDefault(); e.stopPropagation(); } }}
    >
      <div className="absolute inset-0" />
      <Card className="relative z-10 w-full max-w-2xl mx-4 bg-[#12121e]/95 border-white/10 rounded-2xl shadow-2xl shadow-black/60 max-h-[92vh] overflow-y-auto">
        <CardHeader className="p-6 pb-2 text-center">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mb-4">
            <Wallet className="w-7 h-7 text-amber-400" />
          </div>
          <CardTitle className="text-lg font-bold text-white">Выберите тариф</CardTitle>
          <p className="text-sm text-white/40 mt-1">Для доступа к торговому терминалу необходима активная подписка</p>
        </CardHeader>
        <CardContent className="p-6 pt-2 space-y-5">
          {/* Plans — 2x2 grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {PLANS.map((plan) => {
              const isSelected = selectedPlan === plan.id;
              return (
                <button
                  key={plan.id}
                  onClick={() => setSelectedPlan(plan.id)}
                  className={`relative flex flex-col items-center gap-2 p-4 rounded-xl border transition-all duration-200 cursor-pointer ${
                    isSelected
                      ? 'bg-emerald-500/10 border-emerald-500/40 shadow-lg shadow-emerald-500/5'
                      : 'bg-white/[0.03] border-white/10 hover:bg-white/[0.06] hover:border-white/20'
                  }`}
                >
                  {plan.popular && (
                    <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 px-2.5 py-0.5 bg-emerald-500 text-[10px] font-bold text-white rounded-full">
                      Популярный
                    </span>
                  )}
                  <div className={isSelected ? 'text-emerald-400' : 'text-white/40'}>{plan.icon}</div>
                  <span className={`text-sm font-semibold ${isSelected ? 'text-white' : 'text-white/70'}`}>{plan.label}</span>
                  <span className={`text-xl font-bold ${isSelected ? 'text-emerald-400' : 'text-white/50'}`}>
                    ${plan.priceUSD}
                  </span>
                  <span className={`text-[10px] ${isSelected ? 'text-emerald-400/60' : 'text-white/25'}`}>
                    {plan.perMonth}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Selected plan summary */}
          <div className="bg-white/[0.04] rounded-xl p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-white/50">Выбран тариф</span>
              <span className="text-sm font-medium text-white">{activePlan.label}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-white/50">Сумма к оплате</span>
              <span className="text-lg font-bold text-emerald-400">${activePlan.priceUSD}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-white/50">Включает</span>
              <span className="text-sm font-medium text-white">Все 3 стратегии, полный доступ</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-white/50">Сеть</span>
              <span className="text-sm font-medium text-white/70">TON Blockchain</span>
            </div>
          </div>

          {/* Step 1: Wallet address */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded-full bg-emerald-500/20 flex items-center justify-center text-[10px] font-bold text-emerald-400">1</div>
              <p className="text-xs text-white/50 font-medium">
                Отправьте <span className="text-white/80">${activePlan.priceUSD}</span> эквивалент в TON/USDT на адрес:
              </p>
            </div>
            <div className="bg-white/[0.04] rounded-xl p-3 flex items-center gap-2">
              <code className="flex-1 text-xs text-white/70 break-all font-mono leading-relaxed">
                {WALLET_ADDRESS}
              </code>
              <button
                onClick={copyWallet}
                className={`shrink-0 p-2 rounded-lg transition-all duration-200 ${
                  walletCopied
                    ? 'bg-emerald-500/20 text-emerald-400'
                    : 'bg-white/[0.06] text-white/40 hover:text-white/60 hover:bg-white/[0.1]'
                }`}
              >
                {walletCopied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
            {walletCopied && (
              <p className="text-[10px] text-emerald-400/70 text-center">Адрес скопирован</p>
            )}
            <a
              href={`https://app.tonkeeper.com/transfer/${WALLET_ADDRESS}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full h-9 bg-white/[0.06] hover:bg-white/[0.1] text-white/50 hover:text-white/70 rounded-lg transition-all duration-200 text-xs"
            >
              <Wallet className="w-3.5 h-3.5" />
              Открыть в Tonkeeper для перевода
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>

          {/* Step 2: tx hash (optional) */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded-full bg-amber-500/20 flex items-center justify-center text-[10px] font-bold text-amber-400">2</div>
              <p className="text-xs text-white/50 font-medium">Хеш транзакции (необязательно, для ускорения проверки):</p>
            </div>
            <Input
              type="text"
              value={txHash}
              onChange={(e) => setTxHash(e.target.value)}
              placeholder="Вставьте хеш транзакции..."
              className="h-10 bg-white/[0.04] border-white/[0.08] text-white placeholder:text-white/15 rounded-xl text-xs font-mono focus:ring-amber-500/25 focus:border-amber-500/30"
            />
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-sm text-red-400">{error}</div>
          )}

          {/* Step 3: Submit */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded-full bg-emerald-500/20 flex items-center justify-center text-[10px] font-bold text-emerald-400">3</div>
              <p className="text-xs text-white/50 font-medium">Нажмите после отправки оплаты:</p>
            </div>
            <Button
              onClick={handleSubmitPayment}
              disabled={verifying}
              className="w-full h-11 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl transition-all duration-200 disabled:opacity-50"
            >
              {verifying ? (
                <><Loader2 className="w-4 h-4 animate-spin mr-2" />Отправка...</>
              ) : (
                <><Send className="w-4 h-4 mr-2" />Я оплатил — <span className="text-white/60">${activePlan.priceUSD}</span> ({activePlan.label})</>
              )}
            </Button>
          </div>

          <p className="text-[10px] text-white/25 text-center leading-relaxed">
            <Shield className="w-3 h-3 inline -mt-0.5 mr-1" />
            После отправки заявки администратор подтвердит оплату. Доступ будет открыт после подтверждения.
          </p>

          <div className="pt-2 border-t border-white/5">
            <button onClick={handleLogout} className="w-full flex items-center justify-center gap-2 text-xs text-white/30 hover:text-white/60 transition-colors py-2">
              <LogOut className="w-3.5 h-3.5" />
              Выйти из аккаунта
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
