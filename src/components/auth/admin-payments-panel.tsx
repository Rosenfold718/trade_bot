'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Loader2, Check, X, CreditCard, XCircle, RefreshCw, Trash2,
  Users, DollarSign, Clock, ExternalLink, ChevronLeft, Mail, UserIcon, Shield, Calendar,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

const ADMIN_KEY = 'trade-bot-admin-2024';

interface PaymentRequest {
  id: string;
  userId: string;
  username?: string;
  months: number;
  planLabel: string;
  amountUSD: number;
  txHash: string | null;
  status: string;
  createdAt: string;
}

interface UserInfo {
  id: string;
  username: string;
  role: string;
  createdAt: string;
  subscription: {
    isActive: number;
    expiresAt: string;
  } | null;
}

interface UserDetail {
  id: string;
  username: string;
  email: string | null;
  telegram: string | null;
  role: string;
  createdAt: string;
  updatedAt: string;
  subscription: {
    id: string;
    isActive: number;
    startsAt: string;
    expiresAt: string;
    lastPaymentAt: string | null;
  } | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function AdminPaymentsPanel({ open, onClose }: Props) {
  const [activeTab, setActiveTab] = useState<'payments' | 'users'>('payments');
  const [requests, setRequests] = useState<PaymentRequest[]>([]);
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [usersLoading, setUsersLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // User detail state
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [userDetail, setUserDetail] = useState<UserDetail | null>(null);
  const [userPayments, setUserPayments] = useState<Array<{
    id: string;
    planLabel: string;
    amountUSD: number;
    txHash: string | null;
    status: string;
    createdAt: string;
    confirmedAt: string | null;
    confirmedBy: string | null;
  }>>([]);
  const [userPending, setUserPending] = useState<Array<{
    id: string;
    planLabel: string;
    amountUSD: number;
    txHash: string | null;
    createdAt: string;
  }>>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/payments', {
        headers: { Authorization: `Bearer ${ADMIN_KEY}` },
      });
      if (res.ok) {
        const data = await res.json();
        setRequests(data.requests || []);
      }
    } catch {}
    setLoading(false);
  }, []);

  const fetchUsers = useCallback(async () => {
    setUsersLoading(true);
    try {
      const res = await fetch('/api/admin/users', {
        headers: { Authorization: `Bearer ${ADMIN_KEY}` },
      });
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users || []);
      }
    } catch {}
    setUsersLoading(false);
  }, []);

  const fetchUserDetail = useCallback(async (userId: string) => {
    setDetailLoading(true);
    setSelectedUserId(userId);
    setUserDetail(null);
    setUserPayments([]);
    setUserPending([]);
    try {
      const res = await fetch(`/api/admin/users?id=${userId}`, {
        headers: { Authorization: `Bearer ${ADMIN_KEY}` },
      });
      if (res.ok) {
        const data = await res.json();
        setUserDetail(data.user);
        setUserPayments(data.paymentHistory || []);
        setUserPending(data.pendingRequests || []);
      }
    } catch {}
    setDetailLoading(false);
  }, []);

  const closeDetail = useCallback(() => {
    setSelectedUserId(null);
    setUserDetail(null);
    setUserPayments([]);
    setUserPending([]);
  }, []);

  useEffect(() => {
    if (open) {
      let cancelled = false;
      const load = async () => {
        if (!cancelled) {
          await fetchRequests();
          await fetchUsers();
        }
      };
      load();
      return () => { cancelled = true; };
    }
  }, [open, fetchRequests, fetchUsers]);

  // Refresh detail if open
  useEffect(() => {
    if (selectedUserId) {
      fetchUserDetail(selectedUserId);
    }
  }, [selectedUserId, fetchUserDetail]);

  const handleAction = async (requestId: string, action: 'approve' | 'reject') => {
    setActionLoading(requestId);
    try {
      const res = await fetch('/api/admin/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ADMIN_KEY}` },
        body: JSON.stringify({ requestId, action }),
      });
      if (res.ok) {
        setRequests(prev => prev.map(r => r.id === requestId ? { ...r, status: action === 'approve' ? 'approved' : 'rejected' } : r));
        // Refresh detail if viewing a user
        if (selectedUserId) fetchUserDetail(selectedUserId);
      }
    } catch {}
    setActionLoading(null);
  };

  const handleDeleteUser = async (userId: string) => {
    if (deleteConfirm !== userId) {
      setDeleteConfirm(userId);
      return;
    }
    setActionLoading(`delete-${userId}`);
    try {
      const res = await fetch(`/api/admin/users?id=${userId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${ADMIN_KEY}` },
      });
      if (res.ok) {
        setUsers(prev => prev.filter(u => u.id !== userId));
        setDeleteConfirm(null);
        if (selectedUserId === userId) closeDetail();
      }
    } catch {}
    setActionLoading(null);
  };

  if (!open) return null;

  const pendingCount = requests.filter(r => r.status === 'pending').length;

  // ── User Detail View ──
  if (selectedUserId && detailLoading) {
    return (
      <div className="fixed inset-0 z-50 flex items-start justify-center pt-10 sm:pt-16 bg-black/60 backdrop-blur-sm" onClick={onClose}>
        <div className="relative w-full max-w-3xl mx-4 bg-[#12121e] border border-white/10 rounded-2xl shadow-2xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
          <div className="flex items-center gap-3 p-4 border-b border-white/10 shrink-0">
            <button onClick={closeDetail} className="p-1.5 text-white/30 hover:text-white/60 transition-colors rounded-lg hover:bg-white/5">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <CreditCard className="w-5 h-5 text-amber-400" />
            <h2 className="text-sm font-bold text-white">Загрузка...</h2>
          </div>
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="w-5 h-5 text-white/30 animate-spin" />
          </div>
        </div>
      </div>
    );
  }

  if (selectedUserId && userDetail) {
    const u = userDetail;
    const subActive = u.subscription?.isActive === 1 && new Date(u.subscription?.expiresAt || '') > new Date();
    const daysLeft = u.subscription && subActive
      ? Math.max(0, Math.ceil((new Date(u.subscription.expiresAt).getTime() - Date.now()) / 86400000))
      : 0;
    const totalPaid = userPayments.filter(p => p.status === 'approved').reduce((s, p) => s + p.amountUSD, 0);

    return (
      <div className="fixed inset-0 z-50 flex items-start justify-center pt-10 sm:pt-16 bg-black/60 backdrop-blur-sm" onClick={onClose}>
        <div className="relative w-full max-w-3xl mx-4 bg-[#12121e] border border-white/10 rounded-2xl shadow-2xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
          {/* Header */}
          <div className="flex items-center gap-3 p-4 border-b border-white/10 shrink-0">
            <button onClick={closeDetail} className="p-1.5 text-white/30 hover:text-white/60 transition-colors rounded-lg hover:bg-white/5">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <UserIcon className="w-5 h-5 text-emerald-400" />
            <h2 className="text-sm font-bold text-white">{u.username}</h2>
            <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${
              u.role === 'admin' ? 'bg-amber-500/20 text-amber-400' : 'bg-white/[0.06] text-white/30'
            }`}>{u.role === 'admin' ? 'Admin' : 'User'}</span>
            <div className="ml-auto">
              <button onClick={onClose} className="p-1.5 text-white/30 hover:text-white/60 transition-colors rounded-lg hover:bg-white/5">
                <XCircle className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* Profile Info */}
            <div className="grid grid-cols-2 gap-3">
              <InfoCard icon={<UserIcon className="w-3.5 h-3.5" />} label="Логин" value={u.username} />
              <InfoCard icon={<Calendar className="w-3.5 h-3.5" />} label="Регистрация" value={new Date(u.createdAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })} />
              <InfoCard icon={<Mail className="w-3.5 h-3.5" />} label="Email" value={u.email || '—'} />
              <InfoCard icon={<Shield className="w-3.5 h-3.5" />} label="Роль" value={u.role === 'admin' ? 'Администратор' : 'Пользователь'} />
            </div>

            {/* Subscription */}
            <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-2 text-xs font-medium text-white/60">
                <CreditCard className="w-3.5 h-3.5 text-emerald-400" />
                Подписка
              </div>
              {u.subscription ? (
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-white/40">Статус</span>
                    <span className={`text-xs font-medium ${subActive ? 'text-emerald-400' : 'text-red-400'}`}>
                      {subActive ? 'Активна' : 'Неактивна'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-white/40">Осталось</span>
                    <span className={`text-xs font-medium ${subActive ? 'text-white/70' : 'text-red-400'}`}>
                      {subActive ? `${daysLeft} дн.` : 'Истекла'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-white/40">Начало</span>
                    <span className="text-xs text-white/50">{new Date(u.subscription.startsAt).toLocaleDateString('ru-RU')}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-white/40">Истекает</span>
                    <span className="text-xs text-white/50">{new Date(u.subscription.expiresAt).toLocaleDateString('ru-RU')}</span>
                  </div>
                  {u.subscription.lastPaymentAt && (
                    <div className="flex items-center justify-between col-span-2">
                      <span className="text-xs text-white/40">Последний платёж</span>
                      <span className="text-xs text-white/50">{new Date(u.subscription.lastPaymentAt).toLocaleString('ru-RU')}</span>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-xs text-white/30">Нет подписки</p>
              )}
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-emerald-500/5 border border-emerald-500/15 rounded-xl p-3 text-center">
                <div className="text-lg font-bold text-emerald-400">${totalPaid}</div>
                <div className="text-[10px] text-white/30 mt-0.5">Всего оплачено</div>
              </div>
              <div className="bg-amber-500/5 border border-amber-500/15 rounded-xl p-3 text-center">
                <div className="text-lg font-bold text-amber-400">{userPayments.filter(p => p.status === 'approved').length}</div>
                <div className="text-[10px] text-white/30 mt-0.5">Успешных оплат</div>
              </div>
              <div className="bg-red-500/5 border border-red-500/15 rounded-xl p-3 text-center">
                <div className="text-lg font-bold text-red-400">{userPending.length}</div>
                <div className="text-[10px] text-white/30 mt-0.5">Ожидают проверки</div>
              </div>
            </div>

            {/* Payment History */}
            {userPayments.length > 0 && (
              <div className="space-y-2">
                <span className="text-[10px] text-white/25 uppercase tracking-wider font-medium">История оплат</span>
                <div className="space-y-1.5">
                  {userPayments.map(p => (
                    <div key={p.id} className={`flex items-center justify-between p-2.5 rounded-lg border text-xs ${
                      p.status === 'approved'
                        ? 'bg-emerald-500/5 border-emerald-500/15'
                        : 'bg-red-500/5 border-red-500/15'
                    }`}>
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`font-mono ${p.status === 'approved' ? 'text-emerald-400' : 'text-red-400'}`}>
                          ${p.amountUSD}
                        </span>
                        <span className="text-white/40">{p.planLabel}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-white/25 flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {new Date(p.createdAt).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}
                        </span>
                        {p.txHash && (
                          <a href={`https://tonviewer.com/transaction/${p.txHash}`} target="_blank" rel="noopener noreferrer"
                            className="text-emerald-400/40 hover:text-emerald-400 transition-colors">
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Pending Requests */}
            {userPending.length > 0 && (
              <div className="space-y-2">
                <span className="text-[10px] text-amber-400/50 uppercase tracking-wider font-medium">Ожидающие заявки</span>
                <div className="space-y-1.5">
                  {userPending.map(p => (
                    <div key={p.id} className="flex items-center justify-between p-2.5 rounded-lg border bg-amber-500/5 border-amber-500/15 text-xs">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-amber-400">${p.amountUSD}</span>
                        <span className="text-white/40">{p.planLabel}</span>
                        {p.txHash && (
                          <a href={`https://tonviewer.com/transaction/${p.txHash}`} target="_blank" rel="noopener noreferrer"
                            className="text-emerald-400/40 hover:text-emerald-400 transition-colors flex items-center gap-0.5">
                            <ExternalLink className="w-3 h-3" />Tx
                          </a>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleAction(p.id, 'approve')}
                          disabled={actionLoading === p.id}
                          className="p-1 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 rounded transition-colors disabled:opacity-50"
                        >
                          {actionLoading === p.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                        </button>
                        <button
                          onClick={() => handleAction(p.id, 'reject')}
                          disabled={actionLoading === p.id}
                          className="p-1 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded transition-colors disabled:opacity-50"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Delete button */}
            {u.role !== 'admin' && (
              <div className="pt-2 border-t border-white/5">
                {deleteConfirm === u.id ? (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-red-400/70">Удалить аккаунт {u.username}?</span>
                    <div className="flex items-center gap-1">
                      <button onClick={() => handleDeleteUser(u.id)} disabled={actionLoading === `delete-${u.id}`}
                        className="px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg text-xs font-medium transition-colors disabled:opacity-50">
                        {actionLoading === `delete-${u.id}` ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Удалить'}
                      </button>
                      <button onClick={() => setDeleteConfirm(null)}
                        className="px-3 py-1.5 bg-white/[0.06] hover:bg-white/10 text-white/40 rounded-lg text-xs font-medium transition-colors">
                        Отмена
                      </button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => setDeleteConfirm(u.id)}
                    className="flex items-center gap-2 text-xs text-red-400/40 hover:text-red-400 transition-colors">
                    <Trash2 className="w-3.5 h-3.5" />
                    Удалить аккаунт
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Main Panel ──
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-10 sm:pt-16 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="relative w-full max-w-3xl mx-4 bg-[#12121e] border border-white/10 rounded-2xl shadow-2xl max-h-[80vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-3">
            <CreditCard className="w-5 h-5 text-amber-400" />
            <h2 className="text-sm font-bold text-white">Админ-панель</h2>
          </div>
          <button onClick={onClose} className="p-1.5 text-white/30 hover:text-white/60 transition-colors rounded-lg hover:bg-white/5">
            <XCircle className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex px-4 pt-3 gap-2 shrink-0">
          <button
            onClick={() => setActiveTab('payments')}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
              activeTab === 'payments' ? 'bg-white/[0.08] text-white' : 'text-white/35 hover:text-white/50'
            }`}
          >
            <DollarSign className="w-3.5 h-3.5" />
            Платежи
            {pendingCount > 0 && (
              <span className="px-1.5 py-0.5 bg-amber-500/20 text-amber-400 text-[9px] font-bold rounded-full">{pendingCount}</span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('users')}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
              activeTab === 'users' ? 'bg-white/[0.08] text-white' : 'text-white/35 hover:text-white/50'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            Пользователи ({users.length})
          </button>
        </div>

        {/* Payments Tab */}
        {activeTab === 'payments' && (
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            <div className="flex items-center justify-between px-1 mb-2">
              <span className="text-[10px] text-white/25 uppercase tracking-wider font-medium">Заявки на оплату</span>
              <button onClick={fetchRequests} className="p-1.5 text-white/30 hover:text-white/60 transition-colors rounded-lg hover:bg-white/5">
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {loading && requests.length === 0 ? (
              <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 text-white/30 animate-spin" /></div>
            ) : requests.length === 0 ? (
              <p className="text-sm text-white/30 text-center py-12">Нет заявок</p>
            ) : (
              requests.map(req => (
                <div key={req.id} className={`p-3 rounded-xl border ${
                  req.status === 'pending' ? 'bg-amber-500/5 border-amber-500/20' :
                  req.status === 'approved' ? 'bg-emerald-500/5 border-emerald-500/20' :
                  'bg-red-500/5 border-red-500/20'
                }`}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm font-medium text-white truncate">{req.username || 'Unknown'}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-white/50">{req.planLabel}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-3">
                      {req.status === 'pending' ? (
                        <>
                          <button onClick={() => handleAction(req.id, 'approve')} disabled={actionLoading === req.id}
                            className="p-1.5 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 rounded-lg transition-colors disabled:opacity-50">
                            {actionLoading === req.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                          </button>
                          <button onClick={() => handleAction(req.id, 'reject')} disabled={actionLoading === req.id}
                            className="p-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg transition-colors disabled:opacity-50">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </>
                      ) : (
                        <span className={`text-[10px] font-medium px-2 py-1 rounded-lg ${
                          req.status === 'approved' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                        }`}>{req.status === 'approved' ? 'Одобрено' : 'Отклонено'}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-[10px] text-white/30">
                    <span className="font-mono text-amber-400/70">${req.amountUSD}</span>
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {new Date(req.createdAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </span>
                    {req.txHash && (
                      <a href={`https://tonviewer.com/transaction/${req.txHash}`} target="_blank" rel="noopener noreferrer"
                        className="text-emerald-400/50 hover:text-emerald-400 transition-colors flex items-center gap-0.5">
                        <ExternalLink className="w-3 h-3" />Tx
                      </a>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Users Tab */}
        {activeTab === 'users' && (
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            <div className="flex items-center justify-between px-1 mb-2">
              <span className="text-[10px] text-white/25 uppercase tracking-wider font-medium">Зарегистрированные пользователи</span>
              <button onClick={fetchUsers} className="p-1.5 text-white/30 hover:text-white/60 transition-colors rounded-lg hover:bg-white/5">
                <RefreshCw className={`w-3.5 h-3.5 ${usersLoading ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {usersLoading && users.length === 0 ? (
              <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 text-white/30 animate-spin" /></div>
            ) : users.length === 0 ? (
              <p className="text-sm text-white/30 text-center py-12">Нет пользователей</p>
            ) : (
              users.map(user => (
                <button
                  key={user.id}
                  onClick={() => fetchUserDetail(user.id)}
                  className="w-full p-3 rounded-xl border bg-white/[0.02] border-white/[0.06] hover:bg-white/[0.04] hover:border-white/10 transition-all text-left"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-medium text-white truncate">{user.username}</span>
                        <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${
                          user.role === 'admin' ? 'bg-amber-500/20 text-amber-400' : 'bg-white/[0.06] text-white/30'
                        }`}>
                          {user.role === 'admin' ? 'Admin' : 'User'}
                        </span>
                        {user.subscription?.isActive === 1 && new Date(user.subscription.expiresAt) > new Date() && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-medium">Active</span>
                        )}
                      </div>
                      <span className="text-[10px] text-white/30 flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {new Date(user.createdAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })}
                      </span>
                    </div>
                    <ChevronLeft className="w-3.5 h-3.5 text-white/20 rotate-180 shrink-0" />
                  </div>
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Small info card ──
function InfoCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="bg-white/[0.03] border border-white/[0.06] rounded-lg p-2.5">
      <div className="flex items-center gap-1.5 text-white/25 mb-1">
        {icon}
        <span className="text-[9px] uppercase tracking-wider">{label}</span>
      </div>
      <div className="text-xs text-white/70 truncate">{value}</div>
    </div>
  );
}
