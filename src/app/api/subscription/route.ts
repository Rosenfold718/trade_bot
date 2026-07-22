import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/prisma-auth';
import { getAuthUserId } from '@/lib/auth-helpers';

const SUBSCRIPTION_DURATION_DAYS = 30;

export async function GET(request: NextRequest) {
  try {
    const userId = await getAuthUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const subscription = await db.subscription.findUnique({
      where: { userId },
    });

    if (!subscription) {
      return NextResponse.json({ isActive: false, requiresPayment: true, daysRemaining: 0 });
    }

    const now = new Date();
    const isActive = subscription.isActive && new Date(subscription.expiresAt) > now;

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
    const userId = await getAuthUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { action } = body as { action: string };

    if (action === 'confirm-payment') {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + SUBSCRIPTION_DURATION_DAYS * 24 * 60 * 60 * 1000);

      const subscription = await db.subscription.upsert({
        where: { userId },
        create: {
          userId,
          isActive: true,
          startsAt: now,
          expiresAt,
          lastPaymentAt: now,
        },
        update: {
          isActive: true,
          startsAt: now,
          expiresAt,
          lastPaymentAt: now,
        },
      });

      return NextResponse.json({
        success: true,
        isActive: true,
        expiresAt: subscription.expiresAt,
        daysRemaining: SUBSCRIPTION_DURATION_DAYS,
      });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[subscription POST] Error:', message);
    return NextResponse.json({ error: 'Ошибка активации подписки' }, { status: 500 });
  }
}
