'use client';

import { useState, useEffect } from 'react';
import { signOut } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, CreditCard, ExternalLink, CheckCircle, Clock, LogOut, Shield } from 'lucide-react';

const PAYMENT_URL = 'https://www.sberbank.com/sms/pbpn?requisiteNumber=79198788008';

interface PaymentModalProps {
  onClose: () => void;
}

export default function PaymentModal({ onClose }: PaymentModalProps) {
  const { data: session } = useSession();
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [checkingPayment, setCheckingPayment] = useState(false);

  // Payment confirmation uses server-side session auth

  // Start countdown to prevent spam
  useEffect(() => {
    if (!confirmed) return;
    const timer = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 0) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [confirmed]);

  const handleConfirmPayment = async () => {
    setError('');
    setVerifying(true);

    try {
      const res = await fetch('/api/subscription', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'confirm-payment' }),
      });
      const data = await res.json();

      if (data.success) {
        setConfirmed(true);
        setCountdown(3);
        // Auto-close after 3 seconds
        setTimeout(() => {
          onClose();
        }, 3000);
      } else {
        setError(data.error || 'Ошибка активации');
      }
    } catch {
      setError('Ошибка связи с сервером');
    } finally {
      setVerifying(false);
    }
  };

  const handleLogout = async () => {
    await signOut({ redirect: false });
  };

  // Success state
  if (confirmed && countdown <= 0) {
    return null;
  }

  if (confirmed) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#0a0a0f]/95 backdrop-blur-xl">
        <Card className="w-full max-w-md mx-4 bg-[#12121e]/95 border-green-500/30 rounded-2xl shadow-2xl shadow-green-500/5">
          <CardContent className="p-8 text-center space-y-5">
            <div className="w-20 h-20 mx-auto rounded-full bg-green-500/10 flex items-center justify-center animate-pulse">
              <CheckCircle className="w-10 h-10 text-green-400" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white mb-2">Подписка активирована!</h2>
              <p className="text-sm text-white/50">Перенаправляем в терминал через {countdown} сек...</p>
            </div>
            <Button
              onClick={onClose}
              className="w-full h-11 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-xl"
            >
              Войти в терминал
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[#0a0a0f]/95 backdrop-blur-xl"
      // Prevent closing via click outside
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
    >
      {/* Overlay - prevents interaction with anything behind */}
      <div className="absolute inset-0" />

      {/* Modal content */}
      <Card className="relative z-10 w-full max-w-md mx-4 bg-[#12121e]/95 border-white/10 rounded-2xl shadow-2xl shadow-black/60">
        <CardHeader className="p-6 pb-2 text-center">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mb-4">
            <CreditCard className="w-7 h-7 text-amber-400" />
          </div>
          <CardTitle className="text-lg font-bold text-white">Оплата подписки</CardTitle>
          <p className="text-sm text-white/40 mt-1">
            Для доступа к торговому терминалу необходима активная подписка
          </p>
        </CardHeader>
        <CardContent className="p-6 pt-2 space-y-5">
          {/* Price & duration info */}
          <div className="bg-white/5 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-white/60">Период подписки</span>
              <span className="text-sm font-medium text-white">30 дней</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-white/60">Включает</span>
              <span className="text-sm font-medium text-white">3 стратегии</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-white/60">Доступ</span>
              <span className="text-sm font-medium text-emerald-400">Полный</span>
            </div>
          </div>

          {/* Payment instructions */}
          <div className="space-y-3">
            <p className="text-xs text-white/50 text-center">Переведите оплату по реквизитам:</p>
            <a
              href={PAYMENT_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full h-11 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white font-semibold rounded-xl transition-all duration-200 text-sm"
            >
              <ExternalLink className="w-4 h-4" />
              Открыть Сбербанк Оплата
            </a>
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-sm text-red-400">
              {error}
            </div>
          )}

          {/* Confirm payment button */}
          <Button
            onClick={handleConfirmPayment}
            disabled={verifying || checkingPayment}
            className="w-full h-11 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl transition-all duration-200 disabled:opacity-50"
          >
            {verifying ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                Активация...
              </>
            ) : (
              <>
                <CheckCircle className="w-4 h-4 mr-2" />
                Я оплатил — Активировать подписку
              </>
            )}
          </Button>

          {/* Warning about blocking */}
          <p className="text-[10px] text-white/25 text-center leading-relaxed">
            <Shield className="w-3 h-3 inline -mt-0.5 mr-1" />
            Окно оплаты не закроется до активации подписки. После оплаты нажмите кнопку выше.
          </p>

          {/* Logout option */}
          <div className="pt-2 border-t border-white/5">
            <button
              onClick={handleLogout}
              className="w-full flex items-center justify-center gap-2 text-xs text-white/30 hover:text-white/60 transition-colors py-2"
            >
              <LogOut className="w-3.5 h-3.5" />
              Выйти из аккаунта
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}