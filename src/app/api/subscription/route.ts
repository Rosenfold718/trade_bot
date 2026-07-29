import { NextRequest, NextResponse } from 'next/server';
import { findSubscriptionByUserId, upsertSubscription, PLANS, CRYPTO_WALLET } from '@/lib/auth-db';
import { initAuthTables } from '@/lib/init-auth-tables';
import { getAuthUserId } from '@/lib/auth-helpers';
import { getAuthClient } from '@/lib/auth-db';
import { initDB, getSetting } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    await initAuthTables();
    const userId = await getAuthUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const subscription = await findSubscriptionByUserId(userId);

    const now = new Date();

    // Check if user is a demo account and if it has expired
    const db = getAuthClient();
    const userRes = await db.execute(
      `SELECT isDemo, demoExpiresAt FROM "User" WHERE id = ?`,
      [userId]
    );
    const userRow = userRes.rows[0];
    const isDemo = userRow?.isDemo === '1';
    const demoExpiresAt = userRow?.demoExpiresAt as string | null;

    if (isDemo && demoExpiresAt && new Date(demoExpiresAt) <= now) {
      return NextResponse.json({
        isActive: false,
        requiresPayment: true,
        daysRemaining: 0,
        isExpiredDemo: true,
        plans: PLANS,
        walletAddress: CRYPTO_WALLET.address,
      });
    }

    if (!subscription) {
      return NextResponse.json({
        isActive: false,
        requiresPayment: true,
        daysRemaining: 0,
        plans: PLANS,
        walletAddress: CRYPTO_WALLET.address,
      });
    }

    const isActive = subscription.isActive === 1 && new Date(subscription.expiresAt) > now;

    // Check pending payment
    const pendingRes = await db.execute(
      `SELECT id, months, planLabel, amountUSD, status, createdAt FROM "PaymentRequest"
       WHERE userId = ? AND status = 'pending'
       ORDER BY createdAt DESC LIMIT 1`,
      [userId]
    );
    const pendingRequest = pendingRes.rows[0] ? {
      id: pendingRes.rows[0].id as string,
      months: Number(pendingRes.rows[0].months),
      planLabel: pendingRes.rows[0].planLabel as string,
      amountUSD: Number(pendingRes.rows[0].amountUSD),
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
      plans: PLANS,
      walletAddress: CRYPTO_WALLET.address,
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
    const { action, months, txHash, paymentMethod } = body as { action: string; months?: number; txHash?: string; paymentMethod?: string };

    if (action === 'confirm-payment') {
      // Server-side check: offer must be accepted
      const offerAccepted = await getSetting(`offer_accepted_${userId}`);
      if (offerAccepted !== '1') {
        return NextResponse.json({ error: 'Необходимо принять пользовательское соглашение' }, { status: 400 });
      }

      const durationMonths = months && [1, 3, 6, 12].includes(months) ? months : 1;

      // Find the plan by months
      const plan = PLANS.find(p => p.months === durationMonths) ?? PLANS[0];

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

      // Create payment request with exact plan amount
      const requestId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      await db.execute(
        `INSERT INTO "PaymentRequest" (id, userId, months, planLabel, amountUSD, txHash, paymentMethod, status, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', CURRENT_TIMESTAMP)`,
        [requestId, userId, plan.months, plan.label, plan.priceUSD, txHash || null, paymentMethod || 'ton']
      );

      return NextResponse.json({
        success: true,
        pending: true,
        message: `Заявка отправлена. Тариф: ${plan.label}, сумма: $${plan.priceUSD}.`,
        plan: { months: plan.months, label: plan.label, amountUSD: plan.priceUSD },
      });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[subscription POST] Error:', message);
    return NextResponse.json({ error: 'Ошибка отправки заявки' }, { status: 500 });
  }
}
