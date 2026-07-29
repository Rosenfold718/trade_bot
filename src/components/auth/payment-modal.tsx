'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Loader2, CheckCircle, LogOut, Shield, Zap, Star, Crown, Gem,
  Clock, Copy, ExternalLink, Wallet, Send, Check,
  HelpCircle, MessageSquare, ChevronDown, ChevronUp, AlertTriangle,
  HeadphonesIcon, X,
} from 'lucide-react';


const WALLET_ADDRESS = 'UQC2_CBuEhAmxr4fJBt-gGdP8u3Mc1-RNcinUPc6ydxz1cJO';
const BINANCE_ID = '220296531';
const BINANCE_WITHDRAW_URL = `https://www.binance.com/ru/my/wallet/account/main/withdrawal/crypto/USDT`;

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

type PaymentMethod = 'ton' | 'binance';

interface PaymentModalProps {
  onClose: () => void;
}

export default function PaymentModal({ onClose }: PaymentModalProps) {
  const { data: session } = useSession();
  const username = session?.user?.name || '';
  const [selectedPlan, setSelectedPlan] = useState<number>(3);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('ton');
  const [txHash, setTxHash] = useState('');
  const [walletCopied, setWalletCopied] = useState(false);
  const [binanceIdCopied, setBinanceIdCopied] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [approved, setApproved] = useState(false);
  const [countdown, setCountdown] = useState(0);

  // Support modal state
  const [supportOpen, setSupportOpen] = useState(false);
  const [supportEmail, setSupportEmail] = useState('');
  const [supportMessage, setSupportMessage] = useState('');
  const [supportSending, setSupportSending] = useState(false);
  const [supportSuccess, setSupportSuccess] = useState(false);
  const [supportError, setSupportError] = useState('');

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

  const copyToClipboard = async (text: string, setCopied: (v: boolean) => void) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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
          paymentMethod,
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

  const handleSendSupport = async () => {
    setSupportError('');
    setSupportSending(true);
    try {
      if (!supportEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(supportEmail.trim())) {
        setSupportError('Укажите корректный email для ответа');
        setSupportSending(false);
        return;
      }
      const res = await fetch('/api/support', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: supportEmail.trim(),
          message: supportMessage.trim(),
          requestFaster: submitted,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setSupportSuccess(true);
        setTimeout(() => {
          setSupportOpen(false);
          setSupportSuccess(false);
          setSupportMessage('');
          setSupportEmail('');
        }, 2000);
      } else {
        setSupportError(data.error || 'Ошибка отправки');
      }
    } catch {
      setSupportError('Ошибка связи с сервером');
    } finally {
      setSupportSending(false);
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
          <CardContent className="p-8 text-center space-y-5">
            <div className="w-16 h-16 mx-auto rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
              <Clock className="w-8 h-8 text-amber-400 animate-pulse" />
            </div>
            <div className="space-y-2">
              <h2 className="text-xl font-bold text-white">Заявка отправлена</h2>
              <p className="text-sm text-white/50">
                Тариф: <span className="text-white font-medium">{activePlan.label}</span> — <span className="text-white font-medium">${activePlan.priceUSD}</span>
              </p>
            </div>

            {/* 15-minute notice */}
            <div className="bg-blue-500/[0.06] border border-blue-500/15 rounded-xl px-4 py-3 text-left">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
                <div className="text-xs text-blue-400/80 space-y-1">
                  <p className="font-medium">Доступ открывается в течение 15 минут</p>
                  <p className="text-blue-400/50">Администратор проверит оплату и активирует подписку. Страница обновляется автоматически.</p>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 text-amber-400 animate-spin" />
              <span className="text-xs text-white/30">Проверка статуса...</span>
            </div>

            {/* Support button when pending */}
            <button
              onClick={() => setSupportOpen(true)}
              className="w-full flex items-center justify-center gap-2 h-10 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] hover:border-white/15 text-white/50 hover:text-white/70 rounded-xl transition-all duration-200 text-xs"
            >
              <HeadphonesIcon className="w-3.5 h-3.5" />
              Нужна помощь? Написать в техподдержку
            </button>

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
    <>
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
          </div>

          {/* Payment method selector */}
          <div className="space-y-3">
            <p className="text-xs text-white/40 font-medium">Способ оплаты:</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setPaymentMethod('ton')}
                className={`flex items-center gap-3 p-3 rounded-xl border transition-all duration-200 ${
                  paymentMethod === 'ton'
                    ? 'bg-emerald-500/10 border-emerald-500/40'
                    : 'bg-white/[0.03] border-white/10 hover:bg-white/[0.06]'
                }`}
              >
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${paymentMethod === 'ton' ? 'bg-emerald-500/20' : 'bg-white/[0.05]'}`}>
                  <Wallet className={`w-4 h-4 ${paymentMethod === 'ton' ? 'text-emerald-400' : 'text-white/30'}`} />
                </div>
                <div className="text-left">
                  <div className={`text-xs font-semibold ${paymentMethod === 'ton' ? 'text-white' : 'text-white/50'}`}>TON / USDT</div>
                  <div className={`text-[10px] ${paymentMethod === 'ton' ? 'text-emerald-400/60' : 'text-white/25'}`}>Tonkeeper кошелёк</div>
                </div>
              </button>
              <button
                onClick={() => setPaymentMethod('binance')}
                className={`flex items-center gap-3 p-3 rounded-xl border transition-all duration-200 ${
                  paymentMethod === 'binance'
                    ? 'bg-yellow-500/10 border-yellow-500/40'
                    : 'bg-white/[0.03] border-white/10 hover:bg-white/[0.06]'
                }`}
              >
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${paymentMethod === 'binance' ? 'bg-yellow-500/20' : 'bg-white/[0.05]'}`}>
                  <svg viewBox="0 0 24 24" className={`w-4 h-4 ${paymentMethod === 'binance' ? 'text-yellow-400' : 'text-white/30'}`} fill="currentColor">
                    <path d="M12 0L14.59 2.59L9.17 8L7 5.83L12 0ZM0 5.83L2.59 8.42L7 4L4.83 1.83L0 5.83ZM7 8L12 13L17 8L14.83 5.83L12 8.66L9.17 5.83L7 8Z"/>
                  </svg>
                </div>
                <div className="text-left">
                  <div className={`text-xs font-semibold ${paymentMethod === 'binance' ? 'text-white' : 'text-white/50'}`}>Binance P2P</div>
                  <div className={`text-[10px] ${paymentMethod === 'binance' ? 'text-yellow-400/60' : 'text-white/25'}`}>Перевод по ID</div>
                </div>
              </button>
            </div>
          </div>

          {/* TON payment instructions */}
          {paymentMethod === 'ton' && (
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
                  onClick={() => copyToClipboard(WALLET_ADDRESS, setWalletCopied)}
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
          )}

          {/* Binance payment instructions */}
          {paymentMethod === 'binance' && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded-full bg-yellow-500/20 flex items-center justify-center text-[10px] font-bold text-yellow-400">1</div>
                <p className="text-xs text-white/50 font-medium">
                  Перейдите по ссылке ниже и отправьте <span className="text-white/80">${activePlan.priceUSD}</span> USDT по Binance ID:
                </p>
              </div>

              {/* Binance ID */}
              <div className="bg-white/[0.04] rounded-xl p-3 flex items-center gap-3">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <span className="text-[10px] text-yellow-400/60 shrink-0">Binance ID:</span>
                  <code className="text-sm text-white font-mono font-bold tracking-wider">{BINANCE_ID}</code>
                </div>
                <button
                  onClick={() => copyToClipboard(BINANCE_ID, setBinanceIdCopied)}
                  className={`shrink-0 p-2 rounded-lg transition-all duration-200 ${
                    binanceIdCopied
                      ? 'bg-yellow-500/20 text-yellow-400'
                      : 'bg-white/[0.06] text-white/40 hover:text-white/60 hover:bg-white/[0.1]'
                  }`}
                >
                  {binanceIdCopied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
              {binanceIdCopied && (
                <p className="text-[10px] text-yellow-400/70 text-center">ID скопирован</p>
              )}

              {/* Step-by-step instructions */}
              <div className="bg-white/[0.03] rounded-xl p-4 space-y-3">
                <p className="text-xs text-white/40 font-medium">Как оплатить:</p>
                <div className="space-y-2 text-xs text-white/50 leading-relaxed">
                  <div className="flex gap-2">
                    <span className="w-5 h-5 rounded-full bg-yellow-500/10 flex items-center justify-center text-[10px] font-bold text-yellow-400 shrink-0">1</span>
                    <span>Нажмите кнопку ниже — откроется Binance (нужен аккаунт)</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="w-5 h-5 rounded-full bg-yellow-500/10 flex items-center justify-center text-[10px] font-bold text-yellow-400 shrink-0">2</span>
                    <span>Выберите <span className="text-white/70 font-medium">USDT</span>, затем вкладку <span className="text-white/70 font-medium">Binance ID</span></span>
                  </div>
                  <div className="flex gap-2">
                    <span className="w-5 h-5 rounded-full bg-yellow-500/10 flex items-center justify-center text-[10px] font-bold text-yellow-400 shrink-0">3</span>
                    <span>Вставьте ID <span className="text-yellow-400 font-mono font-medium">{BINANCE_ID}</span> и укажите сумму <span className="text-white/70 font-medium">${activePlan.priceUSD}</span></span>
                  </div>
                  <div className="flex gap-2">
                    <span className="w-5 h-5 rounded-full bg-yellow-500/10 flex items-center justify-center text-[10px] font-bold text-yellow-400 shrink-0">4</span>
                    <span>Подтвердите перевод и нажмите «Я оплатил» ниже</span>
                  </div>
                </div>
              </div>

              <a
                href={BINANCE_WITHDRAW_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 w-full h-10 bg-yellow-600 hover:bg-yellow-700 text-white font-semibold rounded-xl transition-all duration-200 text-xs"
              >
                <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor">
                  <path d="M12 0L14.59 2.59L9.17 8L7 5.83L12 0ZM0 5.83L2.59 8.42L7 4L4.83 1.83L0 5.83ZM7 8L12 13L17 8L14.83 5.83L12 8.66L9.17 5.83L7 8Z"/>
                </svg>
                Открыть Binance — Вывод USDT
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          )}

          {/* Step 2: tx hash (optional) */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded-full bg-amber-500/20 flex items-center justify-center text-[10px] font-bold text-amber-400">2</div>
              <p className="text-xs text-white/50 font-medium">Хеш / номер транзакции (необязательно, для ускорения проверки):</p>
            </div>
            <Input
              type="text"
              value={txHash}
              onChange={(e) => setTxHash(e.target.value)}
              placeholder={paymentMethod === 'binance' ? 'Вставьте номер транзакции Binance...' : 'Вставьте хеш транзакции TON...'}
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

          {/* 15-minute notice */}
          <div className="bg-blue-500/[0.06] border border-blue-500/15 rounded-xl px-4 py-3">
            <div className="flex items-start gap-2">
              <Clock className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
              <p className="text-xs text-blue-400/70 leading-relaxed">
                После подтверждения оплаты доступ открывается <span className="text-blue-400 font-medium">в течение 15 минут</span>. Страница обновляется автоматически.
              </p>
            </div>
          </div>

          <p className="text-[10px] text-white/25 text-center leading-relaxed">
            <Shield className="w-3 h-3 inline -mt-0.5 mr-1" />
            {paymentMethod === 'binance'
              ? 'Перевод между аккаунтами Binance мгновенный и без комиссии. После отправки заявки администратор подтвердит оплату.'
              : 'После отправки заявки администратор подтвердит оплату. Доступ будет открыт после подтверждения.'}
          </p>

          {/* Bottom actions row */}
          <div className="pt-2 border-t border-white/5 space-y-2">
            <button
              onClick={() => setSupportOpen(true)}
              className="w-full flex items-center justify-center gap-2 h-10 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] hover:border-white/15 text-white/50 hover:text-white/70 rounded-xl transition-all duration-200 text-xs"
            >
              <HeadphonesIcon className="w-3.5 h-3.5" />
              Техподдержка
              <ExternalLink className="w-3 h-3" />
            </button>
            <button onClick={handleLogout} className="w-full flex items-center justify-center gap-2 text-xs text-white/30 hover:text-white/60 transition-colors py-2">
              <LogOut className="w-3.5 h-3.5" />
              Выйти из аккаунта
            </button>
          </div>
        </CardContent>
      </Card>
    </div>

    {/* Support Modal — custom overlay inside payment modal to avoid z-index conflict */}
    {supportOpen && (
      <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setSupportOpen(false)}>
        <Card className="w-full max-w-md mx-4 bg-[#12121e] border-white/10 rounded-2xl shadow-2xl shadow-black/60" onClick={(e) => e.stopPropagation()}>
          <CardHeader className="p-5 pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-white text-base flex items-center gap-2">
                <HeadphonesIcon className="w-5 h-5 text-blue-400" />
                Техподдержка
              </CardTitle>
              <button
                onClick={() => setSupportOpen(false)}
                className="p-1.5 rounded-lg hover:bg-white/[0.06] text-white/30 hover:text-white/60 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-white/40 text-xs mt-1">
              Опишите проблему — мы получим письмо и ответим как можно скорее
            </p>
          </CardHeader>
          <CardContent className="p-5 pt-0">
            {supportSuccess ? (
              <div className="py-8 text-center">
                <div className="w-12 h-12 mx-auto rounded-full bg-emerald-500/10 flex items-center justify-center mb-3">
                  <CheckCircle className="w-6 h-6 text-emerald-400" />
                </div>
                <p className="text-sm text-emerald-400 font-medium">Обращение отправлено!</p>
                <p className="text-xs text-white/30 mt-1">Мы ответим в ближайшее время</p>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Username */}
                <div>
                  <label className="text-[10px] text-white/30 uppercase tracking-wider mb-1 block">Ваш логин</label>
                  <div className="h-10 bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 flex items-center text-xs text-white/60 font-mono">
                    {username || '—'}
                  </div>
                </div>

                {/* Email */}
                <div>
                  <label className="text-[10px] text-white/30 uppercase tracking-wider mb-1 flex items-center gap-1">
                    Email для ответа <span className="text-red-400">*</span>
                  </label>
                  <Input
                    type="email"
                    value={supportEmail}
                    onChange={(e) => setSupportEmail(e.target.value)}
                    placeholder="your@email.com"
                    className="h-10 bg-white/[0.04] border-white/[0.08] text-white placeholder:text-white/15 rounded-lg text-xs focus:ring-blue-500/25 focus:border-blue-500/30"
                  />
                </div>

                {/* Message */}
                <div>
                  <label className="text-[10px] text-white/30 uppercase tracking-wider mb-1 block">Сообщение</label>
                  <Textarea
                    value={supportMessage}
                    onChange={(e) => setSupportMessage(e.target.value)}
                    placeholder="Опишите ваш вопрос или проблему..."
                    rows={4}
                    maxLength={2000}
                    className="bg-white/[0.04] border-white/[0.08] text-white placeholder:text-white/15 rounded-lg text-xs resize-none focus:ring-blue-500/25 focus:border-blue-500/30"
                  />
                  <div className="text-right mt-1">
                    <span className="text-[10px] text-white/20">{supportMessage.length}/2000</span>
                  </div>
                </div>

                {supportError && (
                  <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 text-xs text-red-400">{supportError}</div>
                )}

                <Button
                  onClick={handleSendSupport}
                  disabled={supportSending || supportMessage.trim().length < 3 || !supportEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(supportEmail.trim())}
                  className="w-full h-10 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-all duration-200 disabled:opacity-50"
                >
                  {supportSending ? (
                    <><Loader2 className="w-4 h-4 animate-spin mr-2" />Отправка...</>
                  ) : (
                    <><Send className="w-4 h-4 mr-2" />Отправить в техподдержку</>
                  )}
                </Button>

                {submitted && (
                  <button
                    onClick={() => {
                      setSupportMessage(`Прошу активировать мой аккаунт быстрее. Логин: ${username}. Тариф: ${activePlan.label} (${activePlan.priceUSD}$). Оплатил через ${paymentMethod === 'binance' ? 'Binance ID' : 'TON'}.`);
                  if (!supportEmail.trim()) setSupportEmail('');
                    }}
                    className="w-full text-center text-[10px] text-amber-400/60 hover:text-amber-400 transition-colors py-1"
                  >
                    ⚡ Быстрая активация (заполнить автоматически)
                  </button>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    )}
    </>
  );
}
