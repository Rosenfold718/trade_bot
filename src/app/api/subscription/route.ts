import { NextRequest, NextResponse } from 'next/server';
import { findSubscriptionByUserId, upsertSubscription } from '@/lib/auth-db';
import { initAuthTables } from '@/lib/init-auth-tables';
import { getAuthUserId } from '@/lib/auth-helpers';
import { getAuthClient } from '@/lib/auth-db';

export async function GET(request: NextRequest) {
  try {
    await initAuthTables();
    const userId = await getAuthUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const subscription = await findSubscriptionByUserId(userId);

    if (!subscription) {
      return NextResponse.json({ isActive: false, requiresPayment: true, daysRemaining: 0 });
    }

    const now = new Date();
    const isActive = subscription.isActive === 1 && new Date(subscription.expiresAt) > now;

    // Also check if user has a pending payment request
    const db = getAuthClient();
    const pendingRes = await db.execute(
      `SELECT id, months, status, createdAt FROM "PaymentRequest"
       WHERE userId = ? AND status = 'pending'
       ORDER BY createdAt DESC LIMIT 1`,
      [userId]
    );
    const pendingRequest = pendingRes.rows[0] ? {
      id: pendingRes.rows[0].id as string,
      months: Number(pendingRes.rows[0].months),
      status: pendingRes.rows[0].status as string,
      createdAt: pendingRes.rows[0].createdAt as string,
    } : null;

    return NextResponse.json({
      isActive,
      requiresPayment: !isActive,
      expiresAt: subscription.expiresAt,
      daysRemaining: isActive
        ? Math.max(0, Math.ceil((new Date(subscription.expiresAt).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
        : 0,
      pendingRequest,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[subscription GET] Error:', message);
    return NextResponse.json({ error: 'Ошибка проверки подписки' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    await initAuthTables();
    const userId = await getAuthUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { action, months } = body as { action: string; months?: number };

    if (action === 'confirm-payment') {
      const durationMonths = months && [1, 3, 6, 12].includes(months) ? months : 1;

      const db = getAuthClient();

      // Check if there's already a pending request
      const existing = await db.execute(
        `SELECT id FROM "PaymentRequest" WHERE userId = ? AND status = 'pending' LIMIT 1`,
        [userId]
      );
      if (existing.rows.length > 0) {
        return NextResponse.json({
          success: true,
          pending: true,
          message: 'Заявка уже отправлена, ожидайте подтверждения',
        });
      }

      // Create a pending payment request (NOT activating subscription)
      const requestId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      await db.execute(
        `INSERT INTO "PaymentRequest" (id, userId, months, status, createdAt)
         VALUES (?, ?, ?, 'pending', CURRENT_TIMESTAMP)`,
        [requestId, userId, durationMonths]
      );

      return NextResponse.json({
        success: true,
        pending: true,
        message: 'Заявка на оплату отправлена. Ожидайте подтверждения администратором.',
      });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[subscription POST] Error:', message);
    return NextResponse.json({ error: 'Ошибка отправки заявки' }, { status: 500 });
  }
}
