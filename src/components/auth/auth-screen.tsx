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
      const result = await signIn('credentials', {
        username,
        password,
        redirect: false,
      });

      if (result?.error) {
        const msg = result.error === 'CredentialsSignin'
          ? 'Неверный логин или пароль'
          : 'Ошибка входа';
        setError(msg);
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
    <div className="min-h-[100dvh] bg-[#0a0a0f] flex items-center justify-center overflow-y-auto safe-top safe-bottom">
      <div className="w-full max-w-[400px] px-4 py-6 sm:py-10">
        {/* Logo */}
        <div className="text-center mb-4 sm:mb-5">
          <div className="w-12 h-12 mx-auto rounded-xl bg-gradient-to-br from-emerald-500/15 to-emerald-600/5 border border-emerald-500/15 flex items-center justify-center">
            <TrendingUp className="w-6 h-6 text-emerald-400" />
          </div>
          <h1 className="text-lg sm:text-xl font-bold text-white tracking-tight mt-2.5">Trade Terminal</h1>
          <p className="text-[11px] sm:text-xs text-white/25 mt-0.5">Мультистратегический терминал</p>
        </div>

        <Card className="bg-[#12121e]/90 backdrop-blur-xl border-white/[0.08] rounded-2xl">
          <CardContent className="p-4 sm:p-5 space-y-3.5">
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

            <form onSubmit={mode === 'login' ? handleLogin : handleRegister} className="space-y-3">
              {/* Username */}
              <div>
                <Input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 20))}
                  placeholder="Логин"
                  className="h-10 bg-white/[0.04] border-white/[0.08] text-white placeholder:text-white/20 rounded-lg focus:ring-emerald-500/25 focus:border-emerald-500/30 text-[15px]"
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
                    className="h-10 bg-white/[0.04] border-white/[0.08] text-white placeholder:text-white/20 rounded-lg focus:ring-emerald-500/25 focus:border-emerald-500/30 text-[15px]"
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
                  className="h-10 bg-white/[0.04] border-white/[0.08] text-white placeholder:text-white/20 rounded-lg pr-10 focus:ring-emerald-500/25 focus:border-emerald-500/30 text-[15px]"
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
                    className="h-10 bg-white/[0.04] border-white/[0.08] text-white placeholder:text-white/20 rounded-lg focus:ring-emerald-500/25 focus:border-emerald-500/30 text-[15px]"
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
