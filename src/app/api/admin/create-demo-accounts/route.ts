import { NextRequest, NextResponse } from 'next/server';
import { getAuthClient } from '@/lib/auth-db';
import { initUserTradingData } from '@/lib/db';
import { initAuthTables } from '@/lib/init-auth-tables';
import bcrypt from 'bcryptjs';

const ADMIN_SETUP_KEY = process.env.ADMIN_SETUP_KEY || 'trade-bot-admin-2024';

function checkAuth(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization');
  return authHeader === `Bearer ${ADMIN_SETUP_KEY}`;
}

// POST /api/admin/create-demo-accounts — create 10 demo accounts with subscriptions and trading data
export async function POST(request: NextRequest) {
  try {
    await initAuthTables();
    if (!checkAuth(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const db = getAuthClient();
    const createdAccounts: Array<{
      userId: string;
      email: string;
      name: string;
      password: string;
      subscription: { plan: string; status: string; expiresAt: string };
    }> = [];

    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    for (let i = 0; i < 10; i++) {
      const email = `demo${i + 1}@tradepro.bot`;
      const plainPassword = `Demo${2024 + i + 1}!`;
      const name = `Демо ${i + 1}`;
      const userId = `demo-pro-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}`;

      const hashedPassword = await bcrypt.hash(plainPassword, 10);

      // Create user
      try {
        await db.execute(
          `INSERT INTO "User" (id, username, password, email, telegram, role, isDemo, demoExpiresAt, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, NULL, 'demo', '1', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          [userId, email, hashedPassword, email, expiresAt]
        );
      } catch (err: any) {
        // If user already exists (email unique constraint), skip
        if (err?.message?.includes('UNIQUE constraint') || err?.message?.includes('unique')) {
          console.log(`[create-demo-accounts] User ${email} already exists, skipping`);
          continue;
        }
        throw err;
      }

      // Create subscription
      const subId = `sub-${userId}`;
      await db.execute(
        `INSERT OR IGNORE INTO "Subscription" (id, userId, isActive, startsAt, expiresAt, lastPaymentAt)
         VALUES (?, ?, 1, CURRENT_TIMESTAMP, ?, NULL)`,
        [subId, userId, expiresAt]
      );

      // Initialize trading data (trader_state for all 3 strategies)
      try {
        await initUserTradingData(userId);
      } catch (err) {
        console.error(`[create-demo-accounts] Failed to init trading data for ${email}:`, err);
      }

      createdAccounts.push({
        userId,
        email,
        name,
        password: plainPassword,
        subscription: { plan: 'pro', status: 'active', expiresAt },
      });
    }

    return NextResponse.json({
      success: true,
      count: createdAccounts.length,
      accounts: createdAccounts,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[admin/create-demo-accounts POST] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
