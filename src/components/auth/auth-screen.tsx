'use client';

import { useState } from 'react';
import { useSession, signIn } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2, LogIn, UserPlus, Eye, EyeOff, Shield, TrendingUp, Zap, AlertTriangle, Check } from 'lucide-react';

export default function AuthScreen() {
  const { data: session, status } = useSession();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [registerSuccess, setRegisterSuccess] = useState(false);

  // Session appeared — parent will handle the transition
  if (session?.user) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
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
      // If result?.ok === true, useSession will pick up the new session automatically
    } catch (err) {
      setError('Ошибка соединения с сервером');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // Client-side validation
    if (username.length < 3) {
      setError('Логин должен быть не менее 3 символов');
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
        body: JSON.stringify({ username, password }),
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
      <div className="min-h-[100dvh] bg-[#0a0a0f] flex items-center justify-center p-4 sm:p-6 safe-top safe-bottom">
      <Card className="w-full max-w-[420px] bg-[#12121e]/90 backdrop-blur-xl border-green-500/20 rounded-2xl">
        <CardContent className="p-6 sm:p-8 text-center space-y-5 sm:space-y-6">
          <div className="w-14 h-14 sm:w-16 sm:h-16 mx-auto rounded-full bg-green-500/10 flex items-center justify-center">
            <Check className="w-7 h-7 sm:w-8 sm:h-8 text-green-400" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white mb-2">Аккаунт создан!</h2>
            <p className="text-sm text-white/50">
              <span className="text-white/80 font-medium">{username}</span> —
              теперь необходимо оплатить подписку.
            </p>
          </div>
          <Button
            onClick={handleAutoLogin}
            disabled={loading}
            className="w-full h-11 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-xl"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Продолжить к оплате'}
          </Button>
          {error && (
            <p className="text-xs text-red-400">{error}</p>
          )}
        </CardContent>
      </Card>
    </div>
    );
  }

  // ── Login / Register Form ──
  const passwordRules = [
    { label: 'Мин. 8 символов', ok: password.length >= 8 },
    { label: 'Заглавная буква', ok: /[A-Z]/.test(password) },
    { label: 'Строчная буква', ok: /[a-z]/.test(password) },
    { label: 'Цифра', ok: /[0-9]/.test(password) },
    { label: 'Пароли совпадают', ok: password.length > 0 && password === confirmPassword },
  ];

  return (
    <div className="min-h-[100dvh] bg-[#0a0a0f] flex items-center justify-center p-4 sm:p-6 safe-top safe-bottom">
      <div className="w-full max-w-[420px] space-y-5 sm:space-y-6 my-auto">
        {/* Logo */}
        <div className="text-center space-y-3 sm:mb-4">
          <div className="w-14 h-14 sm:w-16 sm:h-16 mx-auto rounded-2xl bg-gradient-to-br from-emerald-500/20 to-emerald-600/5 border border-emerald-500/20 flex items-center justify-center">
            <TrendingUp className="w-7 h-7 sm:w-8 sm:h-8 text-emerald-400" />
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">Trade Terminal</h1>
          <p className="text-xs sm:text-sm text-white/40">Мультистратегический торговый терминал</p>
        </div>

        <Card className="bg-[#12121e]/90 backdrop-blur-xl border-white/10 rounded-2xl shadow-2xl shadow-black/40">
          <CardContent className="p-4 sm:p-6 space-y-4 sm:space-y-5">
            {/* Tabs */}
            <div className="flex bg-white/5 rounded-xl p-1">
              <button
                onClick={() => { setMode('login'); setError(''); }}
                className={`flex-1 py-2.5 sm:py-3 text-sm font-medium rounded-lg transition-all min-h-[44px] ${
                  mode === 'login' ? 'bg-white/10 text-white shadow-sm' : 'text-white/40 hover:text-white/60'
                }`}
              >
                <LogIn className="w-4 h-4 inline mr-1.5 -mt-0.5" />
                Вход
              </button>
              <button
                onClick={() => { setMode('register'); setError(''); }}
                className={`flex-1 py-2.5 sm:py-3 text-sm font-medium rounded-lg transition-all min-h-[44px] ${
                  mode === 'register' ? 'bg-white/10 text-white shadow-sm' : 'text-white/40 hover:text-white/60'
                }`}
              >
                <UserPlus className="w-4 h-4 inline mr-1.5 -mt-0.5" />
                Регистрация
              </button>
            </div>

            {/* Error */}
            {error && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-sm text-red-400 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                {error}
              </div>
            )}

            <form onSubmit={mode === 'login' ? handleLogin : handleRegister} className="space-y-4">
              {/* Username */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-white/50 uppercase tracking-wider">Логин</label>
                <Input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 20))}
                  placeholder="Только латиница, цифры, _"
                  className="h-12 bg-white/5 border-white/10 text-white placeholder:text-white/25 rounded-xl focus:ring-emerald-500/30 focus:border-emerald-500/40 text-base"
                  required
                  autoComplete="username"
                />
                {mode === 'register' && (
                  <p className="text-[10px] text-white/25">3-20 символов. Пример: trader_pro</p>
                )}
              </div>

              {/* Password */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-white/50 uppercase tracking-wider">
                  Пароль
                </label>
                <div className="relative">
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={mode === 'register' ? 'Мин. 8 символов, Aa1...' : 'Введите пароль'}
                    className="h-12 bg-white/5 border-white/10 text-white placeholder:text-white/25 rounded-xl pr-11 focus:ring-emerald-500/30 focus:border-emerald-500/40 text-base"
                    required
                    minLength={mode === 'register' ? 8 : 6}
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Confirm password (register only) */}
              {mode === 'register' && (
                <div className="space-y-2">
                  <label className="text-xs font-medium text-white/50 uppercase tracking-wider">
                    Подтвердите пароль
                  </label>
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Повторите пароль"
                    className="h-12 bg-white/5 border-white/10 text-white placeholder:text-white/25 rounded-xl focus:ring-emerald-500/30 focus:border-emerald-500/40 text-base"
                    required
                    minLength={8}
                    autoComplete="new-password"
                  />
                </div>
              )}

              {/* Password strength (register only) */}
              {mode === 'register' && password.length > 0 && (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1 rounded-full bg-white/5 overflow-hidden">
                      <div
                        className={
                          `h-full rounded-full transition-all duration-300 ${
                            passwordRules.filter(r => r.ok).length >= 5 ? 'bg-green-500 w-full' :
                            passwordRules.filter(r => r.ok).length >= 3 ? 'bg-amber-500 w-3/5' :
                            'bg-red-500 w-1/5'
                          }`
                        }
                      />
                    </div>
                    <span className="text-[10px] text-white/30 font-mono">
                      {passwordRules.filter(r => r.ok).length}/5
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                    {passwordRules.map(({ label, ok }) => (
                      <div key={label} className="flex items-center gap-1.5">
                        <div className={`w-1.5 h-1.5 rounded-full ${ok ? 'bg-green-400' : 'bg-white/10'}`} />
                        <span className={`text-[10px] ${ok ? 'text-green-400/70' : 'text-white/25'}`}>{label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <Button
                type="submit"
                disabled={loading || !username || !password || (mode === 'register' && (!confirmPassword || password !== confirmPassword))}
                className="w-full h-12 bg-emerald-600 hover:bg-green-700 text-white font-semibold rounded-xl transition-all disabled:opacity-40 text-base"
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : mode === 'login' ? 'Войти' : 'Создать аккаунт'}
              </Button>
            </form>

            {mode === 'register' && (
              <p className="text-xs text-white/25 text-center leading-relaxed">
                После регистрации потребуется оплата подписки
              </p>
            )}
          </CardContent>
        </Card>

        {/* Features — responsive grid */}
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          {[
            { icon: Zap, label: '3 стратегии', desc: 'Авто-торговля' },
            { icon: TrendingUp, label: 'Тех. анализ', desc: 'Binance API' },
            { icon: Shield, label: 'Защита', desc: 'TP/SL/Trailing' },
          ].map(({ icon: Icon, label, desc }) => (
            <div key={label} className="text-center p-2.5 sm:p-3 rounded-xl bg-white/[0.02] border border-white/5">
              <Icon className="w-4 h-4 sm:w-5 sm:h-5 mx-auto text-emerald-400/60 mb-1.5" />
              <div className="text-[10px] sm:text-xs font-medium text-white/60">{label}</div>
              <div className="text-[9px] sm:text-[10px] text-white/25">{desc}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
