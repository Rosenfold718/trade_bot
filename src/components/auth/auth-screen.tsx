'use client';

import { useState } from 'react';
import { useSession, signIn } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2, LogIn, UserPlus, Eye, EyeOff, Shield, TrendingUp, Zap } from 'lucide-react';

interface AuthScreenProps {
  onAuthSuccess: () => void;
}

export default function AuthScreen({ onAuthSuccess }: AuthScreenProps) {
  const { data: session, status } = useSession();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [registerSuccess, setRegisterSuccess] = useState(false);
  const [registeredUserId, setRegisteredUserId] = useState('');

  // If already logged in, notify parent
  if (session?.user) {
    onAuthSuccess();
    return null;
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
        setError('Неверный логин или пароль');
      } else if (result?.ok) {
        onAuthSuccess();
      }
    } catch (err) {
      setError('Ошибка входа. Попробуйте снова.');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
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

      setRegisteredUserId(data.userId);
      setRegisterSuccess(true);
    } catch {
      setError('Ошибка регистрации. Попробуйте снова.');
    } finally {
      setLoading(false);
    }
  };

  const handleRegisteredLogin = async () => {
    setError('');
    setLoading(true);
    try {
      const result = await signIn('credentials', {
        username,
        password,
        redirect: false,
      });
      if (result?.ok) {
        onAuthSuccess();
      } else {
        setError('Автоматический вход не удался. Войдите вручную.');
        setMode('login');
      }
    } catch {
      setMode('login');
    } finally {
      setLoading(false);
    }
  };

  if (registerSuccess) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center p-4">
        <Card className="w-full max-w-md bg-[#12121e]/90 backdrop-blur-xl border-white/10 rounded-2xl">
          <CardContent className="p-8 text-center space-y-6">
            <div className="w-16 h-16 mx-auto rounded-full bg-green-500/10 flex items-center justify-center">
              <Shield className="w-8 h-8 text-green-400" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white mb-2">Аккаунт создан!</h2>
              <p className="text-sm text-white/50">
                Добро пожаловать, <span className="text-white/80 font-medium">{username}</span>.
                Теперь необходимо оплатить подписку для доступа к торговому терминалу.
              </p>
            </div>
            <Button
              onClick={handleRegisteredLogin}
              disabled={loading}
              className="w-full h-11 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-xl transition-all"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Продолжить к оплате'}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        {/* Logo / Branding */}
        <div className="text-center space-y-3 mb-8">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br from-emerald-500/20 to-emerald-600/5 border border-emerald-500/20 flex items-center justify-center">
            <TrendingUp className="w-7 h-7 text-emerald-400" />
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Trade Terminal</h1>
          <p className="text-sm text-white/40">Мультистратегический торговый терминал с ИИ-анализом</p>
        </div>

        {/* Auth Card */}
        <Card className="bg-[#12121e]/90 backdrop-blur-xl border-white/10 rounded-2xl shadow-2xl shadow-black/40">
          <CardContent className="p-6 space-y-5">
            {/* Tabs */}
            <div className="flex bg-white/5 rounded-xl p-1">
              <button
                onClick={() => { setMode('login'); setError(''); }}
                className={`flex-1 py-2.5 text-sm font-medium rounded-lg transition-all duration-200 ${
                  mode === 'login'
                    ? 'bg-white/10 text-white shadow-sm'
                    : 'text-white/40 hover:text-white/60'
                }`}
              >
                <LogIn className="w-4 h-4 inline mr-1.5 -mt-0.5" />
                Вход
              </button>
              <button
                onClick={() => { setMode('register'); setError(''); }}
                className={`flex-1 py-2.5 text-sm font-medium rounded-lg transition-all duration-200 ${
                  mode === 'register'
                    ? 'bg-white/10 text-white shadow-sm'
                    : 'text-white/40 hover:text-white/60'
                }`}
              >
                <UserPlus className="w-4 h-4 inline mr-1.5 -mt-0.5" />
                Регистрация
              </button>
            </div>

            {/* Error */}
            {error && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-sm text-red-400">
                {error}
              </div>
            )}

            {/* Form */}
            <form onSubmit={mode === 'login' ? handleLogin : handleRegister} className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-medium text-white/50 uppercase tracking-wider">Логин</label>
                <Input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Введите логин"
                  className="h-11 bg-white/5 border-white/10 text-white placeholder:text-white/25 rounded-xl focus:ring-emerald-500/30 focus:border-emerald-500/40"
                  required
                  autoComplete="username"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-white/50 uppercase tracking-wider">Пароль</label>
                <div className="relative">
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Введите пароль"
                    className="h-11 bg-white/5 border-white/10 text-white placeholder:text-white/25 rounded-xl pr-11 focus:ring-emerald-500/30 focus:border-emerald-500/40"
                    required
                    minLength={6}
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

              <Button
                type="submit"
                disabled={loading || !username || !password}
                className="w-full h-11 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl transition-all duration-200 disabled:opacity-40"
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : mode === 'login' ? (
                  <>Войти</>
                ) : (
                  <>Создать аккаунт</>
                )}
              </Button>
            </form>

            {mode === 'register' && (
              <p className="text-xs text-white/30 text-center leading-relaxed">
                После регистрации потребуется оплата подписки для доступа к терминалу
              </p>
            )}
          </CardContent>
        </Card>

        {/* Features */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { icon: Zap, label: '3 стратегии', desc: 'Авто-торговля' },
            { icon: TrendingUp, label: 'AI анализ', desc: 'Binance API' },
            { icon: Shield, label: 'Защита', desc: 'TP/SL/Trailing' },
          ].map(({ icon: Icon, label, desc }) => (
            <div key={label} className="text-center p-3 rounded-xl bg-white/[0.02] border border-white/5">
              <Icon className="w-4 h-4 mx-auto text-emerald-400/60 mb-1.5" />
              <div className="text-[10px] font-medium text-white/60">{label}</div>
              <div className="text-[9px] text-white/25">{desc}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}