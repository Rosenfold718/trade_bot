'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSession, signOut } from 'next-auth/react';
import dynamic from 'next/dynamic';
import AuthScreen from '@/components/auth/auth-screen';
import PaymentModal from '@/components/auth/payment-modal';
import { Loader2, LogOut, Clock, Shield } from 'lucide-react';

const TradingTerminal = dynamic(() => import('@/components/trading-terminal'), {
  ssr: false,
  loading: () => (
    <div className="h-screen w-screen flex items-center justify-center bg-[#0a0a0f]">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="h-8 w-8 text-emerald-400 animate-spin" />
        <span className="text-sm text-white/40">Загрузка терминала...</span>
      </div>
    </div>
  ),
});

type AppView = 'auth' | 'payment' | 'terminal';

export default function Home() {
  const { data: session, status } = useSession();
  const [view, setView] = useState<AppView>('auth');
  const [subscriptionChecked, setSubscriptionChecked] = useState(false);
  const [subscriptionDays, setSubscriptionDays] = useState(0);
  const [checkingSub, setCheckingSub] = useState(false);

  const userId = (session?.user as any)?.id;

  // Check subscription status when session changes
  const checkSubscription = useCallback(async () => {
    if (!userId) return;
    setCheckingSub(true);
    try {
      const res = await fetch('/api/subscription', {
        headers: { 'x-user-id': userId },
      });
      if (res.ok) {
        const data = await res.json();
        setSubscriptionDays(data.daysRemaining ?? 0);
        if (data.isActive) {
          setView('terminal');
        } else {
          setView('payment');
        }
      } else {
        setView('payment');
      }
    } catch {
      setView('payment');
    } finally {
      setSubscriptionChecked(true);
      setCheckingSub(false);
    }
  }, [userId]);

  useEffect(() => {
    if (status === 'authenticated' && userId) {
      // Initialize user's trading data if needed, then check subscription
      fetch('/api/init', { method: 'POST' }).catch(() => {});
      checkSubscription();
    } else if (status === 'unauthenticated') {
      setView('auth');
      setSubscriptionChecked(false);
    }
  }, [status, userId, checkSubscription]);

  const handleAuthSuccess = useCallback(() => {
    // Session will trigger the useEffect above to check subscription
  }, []);

  const handlePaymentSuccess = useCallback(() => {
    checkSubscription();
  }, [checkSubscription]);

  const handleLogout = useCallback(async () => {
    await signOut({ redirect: false });
    setView('auth');
    setSubscriptionChecked(false);
  }, []);

  // Loading state while session is being fetched
  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 text-emerald-400 animate-spin" />
          <span className="text-sm text-white/40">Загрузка...</span>
        </div>
      </div>
    );
  }

  // Not authenticated → show auth screen
  if (view === 'auth' || status === 'unauthenticated') {
    return <AuthScreen onAuthSuccess={handleAuthSuccess} />;
  }

  // Subscription check in progress after login
  if (status === 'authenticated' && !subscriptionChecked && checkingSub) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 text-emerald-400 animate-spin" />
          <span className="text-sm text-white/40">Проверка подписки...</span>
        </div>
      </div>
    );
  }

  // Payment required
  if (view === 'payment') {
    return <PaymentModal onClose={handlePaymentSuccess} />;
  }

  // Authenticated + subscription active → show terminal
  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-[#0a0a0f]">
      {/* Subscription info bar */}
      <SubscriptionBar
        daysRemaining={subscriptionDays}
        username={(session?.user as any)?.username}
        onLogout={handleLogout}
      />
      <div className="flex-1 min-h-0 overflow-hidden">
        <TradingTerminal />
      </div>
    </div>
  );
}

// ============================================================
// Subscription info bar at the very top
// ============================================================

function SubscriptionBar({ daysRemaining, username, onLogout }: {
  daysRemaining: number;
  username?: string;
  onLogout: () => void;
}) {
  const isLow = daysRemaining <= 7;
  const isExpired = daysRemaining <= 0;

  return (
    <div className={`h-7 flex items-center justify-between px-3 text-[10px] font-mono shrink-0 z-30 ${
      isExpired ? 'bg-red-500/15 border-b border-red-500/20' :
      isLow ? 'bg-amber-500/10 border-b border-amber-500/15' :
      'bg-emerald-500/5 border-b border-emerald-500/10'
    }`}>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <Shield className={`w-3 h-3 ${isExpired ? 'text-red-400' : isLow ? 'text-amber-400' : 'text-emerald-400/60'}`} />
          <span className={isExpired ? 'text-red-400 font-medium' : isLow ? 'text-amber-400' : 'text-white/40'}>
            {username}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <Clock className={`w-3 h-3 ${isExpired ? 'text-red-400' : isLow ? 'text-amber-400' : 'text-emerald-400/60'}`} />
          <span className={isExpired ? 'text-red-400 font-medium' : isLow ? 'text-amber-400' : 'text-white/40'}>
            {isExpired ? 'Подписка истекла' : `${daysRemaining} дн. осталось`}
          </span>
        </div>
      </div>
      <button
        onClick={onLogout}
        className="flex items-center gap-1 text-white/30 hover:text-white/60 transition-colors"
      >
        <LogOut className="w-3 h-3" />
        Выйти
      </button>
    </div>
  );
}