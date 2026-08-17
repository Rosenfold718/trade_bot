'use client';

import { useState } from 'react';
import { useSession, signIn } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2, LogIn, UserPlus, Eye, EyeOff, TrendingUp, AlertTriangle, Check, Mail } from 'lucide-react';

export default function AuthScreen() {
  const { data: session, status } = useSession();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [registerSuccess, setRegisterSuccess] = useState(false);

  // Session appeared — parent will handle the transition
  if (session?.user) {
    return (
      <div className="min-h-[100dvh] bg-[#0a0a0f] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-6 w-6 text-emerald-400 animate-spin" />
          <span className="text-sm text-white/40">Вход выполнен, загружаю терминал...</span>
        </div>
      </div>
    );
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      // First, try the diagnostic endpoint to get a specific error
      try {
        const diagRes = await fetch('/api/auth/test-login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password }),
        });
        const diagData = await diagRes.json();

        if (!diagData.success && diagData.error) {
          // Provide specific error message based on diagnostic
          if (diagData.error.includes('TURSO_DATABASE_URL not set') ||
              diagData.error.includes('DB query failed') ||
              diagData.error.includes('Failed to init tables')) {
            setError('Ошибка подключения к базе данных. Свяжитесь с администратором.');
            console.error('[Login] Diagnostic:', diagData);
            setLoading(false);
            return;
          }
          if (diagData.error === 'User not found') {
            setError('Пользователь не найден');
            setLoading(false);
            return;
          }
          if (diagData.error === 'Invalid password') {
            setError('Неверный пароль');
            setLoading(false);
            return;
          }
          // If diagnostic found a different error, still try normal login
          if (diagData.error && !diagData.steps?.some((s: any) => s.step === 'password_check' && s.ok === false)) {
            setError('Ошибка сервера: ' + diagData.error);
            setLoading(false);
            return;
          }
        }
      } catch {
        // Diagnostic endpoint not available — continue with normal login
      }

      const result = await signIn('credentials', {
        username,
        password,
        redirect: false,
      });

      if (result?.error) {
        // Check last auth error from server
        try {
          const errRes = await fetch('/api/auth/last-error');
          const errData = await errRes.json();
          if (errData.lastError) {
            const step = errData.lastError.step;
            if (step === 'initAuthTables' || step === 'findUserByUsername' || step === 'bcrypt_compare') {
              setError('Серверная ошибка авторизации. Код: ' + step);
              console.error('[Login] Server error details:', errData);
            } else {
              setError('Неверный логин или пароль');
            }
          } else {
            setError('Неверный логин или пароль');
          }
        } catch {
          setError('Неверный логин или пароль');
        }
      }
    } catch (err) {
      setError('Ошибка соединения с сервером');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (username.length < 3) {
      setError('Логин должен быть не менее 3 символов');
      return;
    }
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Укажите корректный email');
      return;
    }
    if (username.length > 20) {
      setError('Логин должен быть не более 20 символов');
      return;
    }
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      setError('Логин может содержать только латинские буквы, цифры и _');
      return;
    }
    if (password.length < 8) {
      setError('Пароль должен быть не менее 8 символов');
      return;
    }
    if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
      setError('Пароль должен содержать заглавную, строчную букву и цифру');
      return;
    }
    if (password !== confirmPassword) {
      setError('Пароли не совпадают');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, email: email.trim() }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Ошибка регистрации');
        return;
      }

      setRegisterSuccess(true);
    } catch {
      setError('Ошибка соединения с сервером');
    } finally {
      setLoading(false);
    }
  };

  const handleAutoLogin = async () => {
    setError('');
    setLoading(true);
    try {
      const result = await signIn('credentials', {
        username,
        password,
        redirect: false,
      });
      if (!result?.ok) {
        setError('Автовход не удался. Войдите вручную.');
        setMode('login');
        setRegisterSuccess(false);
      }
    } catch {
      setMode('login');
      setRegisterSuccess(false);
    } finally {
      setLoading(false);
    }
  };

  // ── Registration Success Screen ──
  if (registerSuccess) {
    return (
      <div className="min-h-[100dvh] bg-[#0a0a0f] flex items-center justify-center px-4 py-6 safe-top safe-bottom">
        <Card className="w-full max-w-[400px] bg-[#12121e]/90 backdrop-blur-xl border-emerald-500/20 rounded-2xl">
          <CardContent className="p-5 text-center space-y-4">
            <div className="w-12 h-12 mx-auto rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
              <Check className="w-6 h-6 text-emerald-400" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white mb-1">Аккаунт создан</h2>
              <p className="text-xs text-white/40 leading-relaxed">
                <span className="text-white/70 font-medium">{username}</span> —
                оплатите подписку для доступа к терминалу.
              </p>
            </div>
            <Button
              onClick={handleAutoLogin}
              disabled={loading}
              className="w-full h-11 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-xl transition-all text-sm"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Перейти к оплате'}
            </Button>
            {error && (
              <p className="text-xs text-red-400/80">{error}</p>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Login / Register Form ──
  const okCount = [
    password.length >= 8,
    /[A-Z]/.test(password),
    /[a-z]/.test(password),
    /[0-9]/.test(password),
    password.length > 0 && password === confirmPassword,
  ].filter(Boolean).length;

  return (
    <div className="min-h-[100dvh] bg-[#0a0a0f] flex flex-col items-center overflow-y-auto safe-top safe-bottom">
      <div className="w-full max-w-[400px] px-4 py-4 sm:py-8 my-auto">
        {/* Logo */}
        <div className="text-center mb-3 sm:mb-4">
          <div className="w-10 h-10 sm:w-12 sm:h-12 mx-auto rounded-xl bg-gradient-to-br from-emerald-500/15 to-emerald-600/5 border border-emerald-500/15 flex items-center justify-center">
            <TrendingUp className="w-5 h-5 sm:w-6 sm:h-6 text-emerald-400" />
          </div>
          <h1 className="text-base sm:text-xl font-bold text-white tracking-tight mt-2">Trade Terminal</h1>
          <p className="text-[10px] sm:text-xs text-white/25 mt-0.5">Мультистратегический терминал</p>
        </div>

        <Card className="bg-[#12121e]/90 backdrop-blur-xl border-white/[0.08] rounded-2xl">
          <CardContent className="p-3.5 sm:p-5 space-y-2.5 sm:space-y-3.5">
            {/* Tabs */}
            <div className="flex bg-white/[0.04] rounded-lg p-0.5 border border-white/[0.06]">
              <button
                onClick={() => { setMode('login'); setError(''); }}
                className={`flex-1 py-2 text-xs font-medium rounded-md transition-all duration-200 min-h-[40px] ${
                  mode === 'login'
                    ? 'bg-white/[0.08] text-white shadow-sm shadow-black/20'
                    : 'text-white/35 hover:text-white/50'
                }`}
              >
                <LogIn className="w-3.5 h-3.5 inline mr-1 -mt-0.5" />
                Вход
              </button>
              <button
                onClick={() => { setMode('register'); setError(''); }}
                className={`flex-1 py-2 text-xs font-medium rounded-md transition-all duration-200 min-h-[40px] ${
                  mode === 'register'
                    ? 'bg-white/[0.08] text-white shadow-sm shadow-black/20'
                    : 'text-white/35 hover:text-white/50'
                }`}
              >
                <UserPlus className="w-3.5 h-3.5 inline mr-1 -mt-0.5" />
                Регистрация
              </button>
            </div>

            {/* Error */}
            {error && (
              <div className="bg-red-500/[0.07] border border-red-500/15 rounded-lg px-3 py-2.5 text-xs text-red-400/90 flex items-start gap-2">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                {error}
              </div>
            )}

            <form onSubmit={mode === 'login' ? handleLogin : handleRegister} className="space-y-2.5">
              {/* Username */}
              <div>
                <Input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 20))}
                  placeholder="Логин"
                  className="h-9 bg-white/[0.04] border-white/[0.08] text-white placeholder:text-white/20 rounded-lg focus:ring-emerald-500/25 focus:border-emerald-500/30 text-sm"
                  required
                  autoComplete="username"
                />
              </div>

              {/* Email (register only) */}
              {mode === 'register' && (
                <div>
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Email"
                    required
                    className="h-9 bg-white/[0.04] border-white/[0.08] text-white placeholder:text-white/20 rounded-lg focus:ring-emerald-500/25 focus:border-emerald-500/30 text-sm"
                    autoComplete="email"
                  />
                </div>
              )}

              {/* Password */}
              <div className="relative">
                <Input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === 'register' ? 'Пароль (мин. 8 символов)' : 'Пароль'}
                  className="h-9 bg-white/[0.04] border-white/[0.08] text-white placeholder:text-white/20 rounded-lg pr-10 focus:ring-emerald-500/25 focus:border-emerald-500/30 text-sm"
                  required
                  minLength={mode === 'register' ? 8 : 6}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/25 hover:text-white/50 transition-colors p-0.5"
                >
                  {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>

              {/* Confirm password (register only) */}
              {mode === 'register' && (
                <div>
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Повторите пароль"
                    className="h-9 bg-white/[0.04] border-white/[0.08] text-white placeholder:text-white/20 rounded-lg focus:ring-emerald-500/25 focus:border-emerald-500/30 text-sm"
                    required
                    minLength={8}
                    autoComplete="new-password"
                  />
                </div>
              )}

              {/* Password strength (register only) - compact inline */}
              {mode === 'register' && password.length > 0 && (
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1 rounded-full bg-white/[0.04] overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        okCount >= 5 ? 'bg-emerald-500 w-full' :
                        okCount >= 3 ? 'bg-amber-500 w-3/5' :
                        'bg-red-500 w-1/5'
                      }`}
                    />
                  </div>
                  <span className="text-[9px] text-white/25 font-mono">{okCount}/5</span>
                </div>
              )}

              <Button
                type="submit"
                disabled={loading || !username || !password || (mode === 'register' && (!confirmPassword || password !== confirmPassword || !email.trim()))}
                className="w-full h-10 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white font-semibold rounded-lg transition-all duration-200 disabled:opacity-30 text-sm"
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : mode === 'login' ? 'Войти' : 'Создать аккаунт'}
              </Button>
            </form>

            {mode === 'register' && (
              <p className="text-[10px] text-white/20 text-center">
                После регистрации потребуется оплата подписки
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
