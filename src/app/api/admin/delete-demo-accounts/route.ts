import { NextRequest, NextResponse } from 'next/server';
import { getAuthClient } from '@/lib/auth-db';
import { initAuthTables } from '@/lib/init-auth-tables';
import { initDB, tursoDb } from '@/lib/db';

const ADMIN_SETUP_KEY = process.env.ADMIN_SETUP_KEY || 'trade-bot-admin-2024';

function checkAuth(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization');
  return authHeader === `Bearer ${ADMIN_SETUP_KEY}`;
}

// POST /api/admin/delete-demo-accounts — delete all demo accounts
export async function POST(request: NextRequest) {
  try {
    await initAuthTables();
    await initDB();
    if (!checkAuth(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const db = getAuthClient();

    // Find all demo users (by email pattern)
    const usersRes = await db.execute(
      `SELECT id FROM "User" WHERE email LIKE 'demo%'`
    );

    let deletedCount = 0;

    for (const row of usersRes.rows) {
      const userId = row.id as string;

      try {
        // Delete trades from Turso
        await tursoDb.execute(`DELETE FROM trades WHERE user_id = ?`, [userId]);

        // Delete trader_state from Turso
        await tursoDb.execute(`DELETE FROM trader_state WHERE user_id = ?`, [userId]);

        // Delete Subscription
        await db.execute(`DELETE FROM "Subscription" WHERE userId = ?`, [userId]);

        // Delete PaymentRequest
        await db.execute(`DELETE FROM "PaymentRequest" WHERE userId = ?`, [userId]);

        // Delete Sessions
        await db.execute(`DELETE FROM "Session" WHERE userId = ?`, [userId]);

        // Delete Accounts
        await db.execute(`DELETE FROM "Account" WHERE userId = ?`, [userId]);

        // Delete User
        await db.execute(`DELETE FROM "User" WHERE id = ?`, [userId]);

        deletedCount++;
      } catch (err) {
        console.error(`[delete-demo-accounts] Failed for user ${userId}:`, err);
      }
    }

    return NextResponse.json({ success: true, deletedCount });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[admin/delete-demo-accounts POST] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
