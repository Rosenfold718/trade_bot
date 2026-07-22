import { NextRequest, NextResponse } from 'next/server';
import { findSubscriptionByUserId, upsertSubscription } from '@/lib/auth-db';
import { initAuthTables } from '@/lib/init-auth-tables';
import { getAuthUserId } from '@/lib/auth-helpers';

const DEFAULT_DURATION_MONTHS = 1;

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

    return NextResponse.json({
      isActive,
      requiresPayment: !isActive,
      expiresAt: subscription.expiresAt,
      daysRemaining: isActive
        ? Math.max(0, Math.ceil((new Date(subscription.expiresAt).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
        : 0,
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
      const durationMonths = months && [1, 3, 6, 12].includes(months) ? months : DEFAULT_DURATION_MONTHS;
      const durationDays = durationMonths * 30;
      const now = new Date();
      const expiresAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

      const subscription = await upsertSubscription(userId, {
        isActive: true,
        startsAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        lastPaymentAt: now.toISOString(),
      });

      return NextResponse.json({
        success: true,
        isActive: true,
        expiresAt: subscription.expiresAt,
        daysRemaining: durationDays,
        months: durationMonths,
      });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[subscription POST] Error:', message);
    return NextResponse.json({ error: 'Ошибка активации подписки' }, { status: 500 });
  }
}
