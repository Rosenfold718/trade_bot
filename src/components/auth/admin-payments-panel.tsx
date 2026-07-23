'use client';

import { useState, useEffect, useCallback } from 'react';
import { Loader2, Check, X, CreditCard, XCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

const ADMIN_KEY = 'trade-bot-admin-2024';

interface PaymentRequest {
  id: string;
  userId: string;
  username: string;
  months: number;
  status: string;
  createdAt: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function AdminPaymentsPanel({ open, onClose }: Props) {
  const [requests, setRequests] = useState<PaymentRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

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

  useEffect(() => {
    if (open) {
      let cancelled = false;
      const load = async () => { if (!cancelled) await fetchRequests(); };
      load();
      return () => { cancelled = true; };
    }
  }, [open, fetchRequests]);

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
      }
    } catch {}
    setActionLoading(null);
  };

  if (!open) return null;

  const pendingCount = requests.filter(r => r.status === 'pending').length;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="relative w-full max-w-2xl mx-4 bg-[#12121e] border border-white/10 rounded-2xl shadow-2xl max-h-[75vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-3">
            <CreditCard className="w-5 h-5 text-amber-400" />
            <h2 className="text-sm font-bold text-white">Заявки на оплату</h2>
            {pendingCount > 0 && (
              <span className="px-2 py-0.5 bg-amber-500/20 text-amber-400 text-[10px] font-bold rounded-full">
                {pendingCount} новых
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={fetchRequests} className="p-1.5 text-white/30 hover:text-white/60 transition-colors rounded-lg hover:bg-white/5">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button onClick={onClose} className="p-1.5 text-white/30 hover:text-white/60 transition-colors rounded-lg hover:bg-white/5">
              <XCircle className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {loading && requests.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-5 h-5 text-white/30 animate-spin" />
            </div>
          ) : requests.length === 0 ? (
            <p className="text-sm text-white/30 text-center py-12">Нет заявок</p>
          ) : (
            requests.map(req => (
              <div key={req.id} className={`flex items-center justify-between p-3 rounded-xl border ${
                req.status === 'pending' ? 'bg-amber-500/5 border-amber-500/20' :
                req.status === 'approved' ? 'bg-emerald-500/5 border-emerald-500/20' :
                'bg-red-500/5 border-red-500/20'
              }`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-white truncate">{req.username}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-white/50">{req.months} мес.</span>
                  </div>
                  <span className="text-[10px] text-white/30">{new Date(req.createdAt).toLocaleString('ru-RU')}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-3">
                  {req.status === 'pending' ? (
                    <>
                      <button
                        onClick={() => handleAction(req.id, 'approve')}
                        disabled={actionLoading === req.id}
                        className="p-1.5 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 rounded-lg transition-colors disabled:opacity-50"
                        title="Одобрить"
                      >
                        {actionLoading === req.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                      </button>
                      <button
                        onClick={() => handleAction(req.id, 'reject')}
                        disabled={actionLoading === req.id}
                        className="p-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg transition-colors disabled:opacity-50"
                        title="Отклонить"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </>
                  ) : (
                    <span className={`text-[10px] font-medium px-2 py-1 rounded-lg ${
                      req.status === 'approved' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                    }`}>
                      {req.status === 'approved' ? 'Одобрено' : 'Отклонено'}
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
