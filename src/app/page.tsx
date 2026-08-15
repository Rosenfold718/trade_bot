'use client';

import { useState, useEffect, useCallback, Component, type ReactNode } from 'react';
import { useSession, signOut } from 'next-auth/react';
import dynamic from 'next/dynamic';
import AuthScreen from '@/components/auth/auth-screen';
import PaymentModal from '@/components/auth/payment-modal';
import WarningModal from '@/components/warning-modal';
import ActivityNotification from '@/components/activity-notification';
import { Loader2, LogOut, Clock, Shield, BookOpen } from 'lucide-react';
import AdminPaymentsPanel from '@/components/auth/admin-payments-panel';
import ManualDialog from '@/components/manual-dialog';

const TradingTerminal = dynamic(() => import('@/components/trading-terminal'), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full flex items-center justify-center bg-[#0a0a0f]">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="h-8 w-8 text-emerald-400 animate-spin" />
        <span className="text-sm text-white/40">Загрузка терминала...</span>
      </div>
    </div>
  ),
});

type AppView = 'auth' | 'payment' | 'warning' | 'activity' | 'terminal';

// ── Global Error Boundary ──
class TerminalErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; errorMsg: string | null; errorStack: string | null }> {
  state = { hasError: false, errorMsg: null, errorStack: null };
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(e: any, info: any) {
    console.error('[TerminalErrorBoundary]', e, info?.componentStack);
    this.setState({ errorMsg: e?.message ?? String(e), errorStack: info?.componentStack ?? null });
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 bg-[#0a0a0f] p-6">
          <div className="w-12 h-12 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
            <span className="text-2xl">⚠️</span>
          </div>
          <div className="text-center">
            <p className="text-sm font-semibold text-white/80">Ошибка загрузки терминала</p>
            <p className="text-xs text-white/30 mt-1 max-w-xs">Произошла ошибка. Попробуйте перезагрузить страницу.</p>
            {this.state.errorMsg && <p className="text-[10px] text-red-400/50 font-mono mt-1 max-w-sm break-all">{this.state.errorMsg}</p>}
            {this.state.errorStack && <details className="mt-2 w-full max-w-sm"><summary className="text-[9px] text-white/20 cursor-pointer hover:text-white/30">Stack trace</summary><pre className="text-[8px] text-red-400/30 font-mono mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-all">{this.state.errorStack}</pre></details>}
          </div>
          <button
            onClick={() => { window.location.reload(); }}
            className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors"
          >
            Перезагрузить
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const ADMIN_SETUP_KEY = 'trade-bot-admin-2024';

export default function Home() {
  const { data: session, status, update: updateSession } = useSession();
  const [view, setView] = useState<AppView>('auth');
  const [subDays, setSubDays] = useState(0);
  const [checkingSub, setCheckingSub] = useState(false);
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [pendingLabel, setPendingLabel] = useState<string | null>(null);

  const userId = (session?.user as any)?.id;
  const username = (session?.user as any)?.username;
  const isAdmin = username === 'admin';

  // Check subscription when user logs in
  const checkSubscription = useCallback(async () => {
    if (!userId) return;
    setCheckingSub(true);
    try {
      const res = await fetch('/api/subscription');
      if (res.ok) {
        const data = await res.json();
        setSubDays(data.daysRemaining ?? 0);
        setPendingLabel(data.pendingRequest?.planLabel || null);
        if (data.isActive) {
          // Active subscription — show warning first
          setView('warning');
        } else {
          setView('payment');
        }
      } else {
        setView('payment');
      }
    } catch {
      setView('payment');
    } finally {
      setCheckingSub(false);
    }
  }, [userId]);

  // React to session changes
  useEffect(() => {
    if (status === 'authenticated' && userId) {
      fetch('/api/init', { method: 'POST' }).catch(() => {});
      checkSubscription();
    } else if (status === 'unauthenticated') {
      setView('auth');
    }
  }, [status, userId, checkSubscription]);

  const handlePaymentSuccess = useCallback(() => {
    updateSession(); // force session refresh
    checkSubscription();
  }, [updateSession, checkSubscription]);

  const handleWarningComplete = useCallback(() => {
    setView('activity');
  }, []);

  const handleActivityComplete = useCallback(() => {
    setView('terminal');
  }, []);

  const handleLogout = useCallback(async () => {
    await signOut({ redirect: false });
    setView('auth');
  }, []);

  // ── Loading ──
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

  // ── Not logged in ──
  if (view === 'auth' || !session?.user) {
    return <AuthScreen />;
  }

  // ── Checking subscription ──
  if (checkingSub) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 text-emerald-400 animate-spin" />
          <span className="text-sm text-white/40">Проверка подписки...</span>
        </div>
      </div>
    );
  }

  // ── Payment required ──
  if (view === 'payment') {
    return <PaymentModal onClose={handlePaymentSuccess} />;
  }

  // ── Warning modal ──
  if (view === 'warning') {
    return <WarningModal onComplete={handleWarningComplete} />;
  }

  // ── Activity notification ──
  if (view === 'activity') {
    return <ActivityNotification onComplete={handleActivityComplete} />;
  }

  // ── Terminal ──
  return (
    <div className="h-[calc(100dvh-28px)] w-full flex flex-col bg-[#0a0a0f]">
      <SubscriptionBar daysRemaining={subDays} username={username} pendingLabel={pendingLabel} onLogout={handleLogout} onAdminPayments={isAdmin ? () => setShowAdminPanel(p => !p) : undefined} onManual={() => setShowManual(true)} />
      <AdminPaymentsPanel open={showAdminPanel} onClose={() => setShowAdminPanel(false)} />
      <ManualDialog open={showManual} onClose={() => setShowManual(false)} />
      <div className="flex-1 min-h-0 overflow-hidden">
        <TerminalErrorBoundary>
          <TradingTerminal />
        </TerminalErrorBoundary>
      </div>
    </div>
  );
}

function SubscriptionBar({ daysRemaining, username, pendingLabel, onLogout, onAdminPayments, onManual }: {
  daysRemaining: number; username?: string; pendingLabel?: string | null; onLogout: () => void; onAdminPayments?: () => void; onManual?: () => void;
}) {
  const isLow = daysRemaining <= 7 && daysRemaining > 0;
  const isExpired = daysRemaining <= 0;
  return (
    <div className={`h-7 flex items-center justify-between px-3 sm:px-4 text-[10px] font-mono shrink-0 z-30 safe-top ${
      isExpired ? 'bg-red-500/15 border-b border-red-500/20' :
      isLow ? 'bg-amber-500/10 border-b border-amber-500/15' :
      'bg-emerald-500/5 border-b border-emerald-500/10'
    }`}>
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        {onAdminPayments && (
          <span className="flex items-center gap-1 text-amber-400/80 font-semibold shrink-0">
            админ
          </span>
        )}
        {onAdminPayments && onManual && (
          <button onClick={onManual} className="flex items-center gap-1 text-emerald-400/50 hover:text-emerald-400 transition-colors shrink-0">
            <BookOpen className="w-3 h-3" />
            <span className="hidden sm:inline">Справка</span>
          </button>
        )}
        <div className="flex items-center gap-1.5 min-w-0">
          <Shield className={`w-3 h-3 shrink-0 ${isExpired ? 'text-red-400' : isLow ? 'text-amber-400' : 'text-emerald-400/50'}`} />
          <span className={`${isExpired ? 'text-red-400 font-medium' : isLow ? 'text-amber-400' : 'text-white/25'} truncate max-w-[80px] sm:max-w-none`}>
            {username}
          </span>
        </div>
        {pendingLabel && (
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 font-medium shrink-0">
            {pendingLabel}
          </span>
        )}
        <div className="flex items-center gap-1.5 shrink-0">
          <Clock className={`w-3 h-3 ${isExpired ? 'text-red-400' : isLow ? 'text-amber-400' : 'text-emerald-400/50'}`} />
          <span className={`${isExpired ? 'text-red-400 font-medium' : isLow ? 'text-amber-400' : 'text-white/25'} hidden sm:inline`}>
            {isExpired ? 'Истекла' : `${daysRemaining}д`}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button onClick={onLogout} className="flex items-center gap-1 text-white/20 hover:text-white/50 transition-colors">
          <LogOut className="w-3 h-3" />
          <span className="hidden sm:inline">Выйти</span>
        </button>
      </div>
    </div>
  );
}
