'use client';

import { useState, useEffect, useCallback, Component, type ReactNode } from 'react';
import { useSession, signOut } from 'next-auth/react';
import dynamic from 'next/dynamic';
import AuthScreen from '@/components/auth/auth-screen';
import PaymentModal from '@/components/auth/payment-modal';
import WarningModal from '@/components/warning-modal';
import ActivityNotification from '@/components/activity-notification';
import { Loader2, LogOut, Clock, Shield, BookOpen, KeyRound } from 'lucide-react';
import AdminPaymentsPanel from '@/components/auth/admin-payments-panel';
import ManualDialog from '@/components/manual-dialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';

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
  const [showProfileDialog, setShowProfileDialog] = useState(false);
  const [pwCurrent, setPwCurrent] = useState('');
  const [pwNew, setPwNew] = useState('');
  const [pwConfirm, setPwConfirm] = useState('');
  const [pwError, setPwError] = useState('');
  const [pwSuccess, setPwSuccess] = useState(false);
  const [pwLoading, setPwLoading] = useState(false);
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
      <SubscriptionBar daysRemaining={subDays} username={username} pendingLabel={pendingLabel} onLogout={handleLogout} onAdminPayments={isAdmin ? () => setShowAdminPanel(p => !p) : undefined} onManual={() => setShowManual(true)} onProfileClick={() => setShowProfileDialog(true)} />
      <AdminPaymentsPanel open={showAdminPanel} onClose={() => setShowAdminPanel(false)} />
      <ManualDialog open={showManual} onClose={() => setShowManual(false)} />
      {/* Profile / Password Change Dialog */}
      <Dialog open={showProfileDialog} onOpenChange={(open) => {
        if (!open) {
          setShowProfileDialog(false);
          setPwCurrent(''); setPwNew(''); setPwConfirm(''); setPwError(''); setPwSuccess(false);
        }
      }}>
        <DialogContent className="bg-[#0d0d14] border border-white/[0.08] sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="text-white/90">Аккаунт</DialogTitle>
            <DialogDescription className="text-white/40">Управление аккаунтом</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-3">
              <h3 className="text-xs font-semibold text-white/60 flex items-center gap-2">
                <KeyRound className="w-3.5 h-3.5" />
                Смена пароля
              </h3>
              <input
                type="password"
                placeholder="Текущий пароль"
                value={pwCurrent}
                onChange={(e) => { setPwCurrent(e.target.value); setPwError(''); }}
                className="w-full h-9 px-3 rounded-lg bg-white/[0.04] border border-white/[0.08] text-white/90 text-xs placeholder:text-white/25 focus:outline-none focus:border-white/20"
              />
              <input
                type="password"
                placeholder="Новый пароль"
                value={pwNew}
                onChange={(e) => { setPwNew(e.target.value); setPwError(''); }}
                className="w-full h-9 px-3 rounded-lg bg-white/[0.04] border border-white/[0.08] text-white/90 text-xs placeholder:text-white/25 focus:outline-none focus:border-white/20"
              />
              <input
                type="password"
                placeholder="Подтвердите новый пароль"
                value={pwConfirm}
                onChange={(e) => { setPwConfirm(e.target.value); setPwError(''); }}
                className="w-full h-9 px-3 rounded-lg bg-white/[0.04] border border-white/[0.08] text-white/90 text-xs placeholder:text-white/25 focus:outline-none focus:border-white/20"
              />
              {pwError && <p className="text-[11px] text-red-400">{pwError}</p>}
              {pwSuccess && <p className="text-[11px] text-emerald-400">Пароль успешно изменён</p>}
              <button
                onClick={async () => {
                  if (!pwCurrent || !pwNew || !pwConfirm) { setPwError('Заполните все поля'); return; }
                  if (pwNew !== pwConfirm) { setPwError('Пароли не совпадают'); return; }
                  setPwLoading(true); setPwError(''); setPwSuccess(false);
                  try {
                    const res = await fetch('/api/change-password', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ currentPassword: pwCurrent, newPassword: pwNew }),
                    });
                    const data = await res.json();
                    if (data.success) { setPwSuccess(true); setPwCurrent(''); setPwNew(''); setPwConfirm(''); }
                    else { setPwError(data.error || 'Ошибка'); }
                  } catch { setPwError('Ошибка сети'); }
                  finally { setPwLoading(false); }
                }}
                disabled={pwLoading}
                className="w-full h-9 rounded-lg bg-white/[0.06] border border-white/[0.10] text-white/70 text-xs font-medium hover:bg-white/[0.10] transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {pwLoading && <Loader2 className="w-3 h-3 animate-spin" />}
                Сменить пароль
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <div className="flex-1 min-h-0 overflow-hidden">
        <TerminalErrorBoundary>
          <TradingTerminal />
        </TerminalErrorBoundary>
      </div>
    </div>
  );
}

function SubscriptionBar({ daysRemaining, username, pendingLabel, onLogout, onAdminPayments, onManual, onProfileClick }: {
  daysRemaining: number; username?: string; pendingLabel?: string | null; onLogout: () => void; onAdminPayments?: () => void; onManual?: () => void; onProfileClick?: () => void;
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
          <button onClick={onAdminPayments} className="flex items-center gap-1 text-amber-400/80 font-semibold shrink-0 hover:text-amber-400 transition-colors">
            админ
          </button>
        )}
        {onAdminPayments && onManual && (
          <button onClick={onManual} className="flex items-center gap-1 text-emerald-400/50 hover:text-emerald-400 transition-colors shrink-0">
            <BookOpen className="w-3 h-3" />
            <span className="hidden sm:inline">Справка</span>
          </button>
        )}
        <button
          onClick={onProfileClick}
          className="flex items-center gap-1.5 min-w-0 group"
        >
          <Shield className={`w-3 h-3 shrink-0 ${isExpired ? 'text-red-400' : isLow ? 'text-amber-400' : 'text-emerald-400/50'}`} />
          <span className={`${isExpired ? 'text-red-400 font-medium' : isLow ? 'text-amber-400' : 'text-white/25'} truncate max-w-[80px] sm:max-w-none group-hover:text-white/40 transition-colors`}>
            {username}
          </span>
        </button>
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
