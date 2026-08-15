import { NextRequest, NextResponse } from 'next/server';
import { getAuthClient } from '@/lib/auth-db';
import { initAuthTables } from '@/lib/init-auth-tables';

const ADMIN_SETUP_KEY = process.env.ADMIN_SETUP_KEY || 'trade-bot-admin-2024';

function checkAuth(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization');
  return authHeader === `Bearer ${ADMIN_SETUP_KEY}`;
}

// POST /api/admin/extend-subscription — extend a user's subscription by N days
export async function POST(request: NextRequest) {
  try {
    await initAuthTables();
    if (!checkAuth(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { userId, days = 30 } = body as { userId: string; days?: number };

    if (!userId) {
      return NextResponse.json({ error: 'userId required' }, { status: 400 });
    }

    const db = getAuthClient();

    // Check if subscription exists
    const existing = await db.execute(
      `SELECT * FROM "Subscription" WHERE userId = ?`,
      [userId]
    );

    if (existing.rows.length > 0) {
      const sub = existing.rows[0];
      const currentExpires = new Date(sub.expiresAt as string).getTime();
      const now = Date.now();

      // If subscription is active (not expired), extend from current expiresAt
      // If expired, extend from now
      const baseTime = currentExpires > now ? currentExpires : now;
      const newExpires = new Date(baseTime + days * 24 * 60 * 60 * 1000).toISOString();

      await db.execute(
        `UPDATE "Subscription" SET isActive = 1, expiresAt = ? WHERE userId = ?`,
        [newExpires, userId]
      );
    } else {
      // No subscription exists — create new one
      const subId = `sub-${userId}`;
      const newExpires = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

      await db.execute(
        `INSERT INTO "Subscription" (id, userId, isActive, startsAt, expiresAt, lastPaymentAt)
         VALUES (?, ?, 1, CURRENT_TIMESTAMP, ?, NULL)`,
        [subId, userId, newExpires]
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[admin/extend-subscription POST] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
