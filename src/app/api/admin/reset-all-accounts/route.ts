import { NextRequest, NextResponse } from 'next/server';
import { getAuthClient } from '@/lib/auth-db';
import { initAuthTables } from '@/lib/init-auth-tables';
import { initDB, tursoDb, initUserTradingData } from '@/lib/db';

const ADMIN_SETUP_KEY = process.env.ADMIN_SETUP_KEY || 'trade-bot-admin-2024';

function checkAuth(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization');
  return authHeader === `Bearer ${ADMIN_SETUP_KEY}`;
}

// POST /api/admin/reset-all-accounts — reset all non-admin users' trading data
export async function POST(request: NextRequest) {
  try {
    await initAuthTables();
    await initDB();
    if (!checkAuth(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const db = getAuthClient();

    // Get all non-admin users
    const usersRes = await db.execute(
      `SELECT id, username, role FROM "User" WHERE role != 'admin' OR role IS NULL`
    );

    let resetCount = 0;
    const errors: string[] = [];

    for (const row of usersRes.rows) {
      const userId = row.id as string;
      const username = row.username as string;

      try {
        // Delete all trades for this user
        await tursoDb.execute(`DELETE FROM trades WHERE user_id = ?`, [userId]);

        // Delete all trader_state for this user
        await tursoDb.execute(`DELETE FROM trader_state WHERE user_id = ?`, [userId]);

        // Re-init trading data (creates trader_state with $100 balance)
        await initUserTradingData(userId);

        // Set balance to $1000 for each strategy
        await tursoDb.execute(
          `UPDATE trader_state SET balance = 1000 WHERE user_id = ?`,
          [userId]
        );

        resetCount++;
      } catch (err) {
        errors.push(`${username}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return NextResponse.json({
      success: true,
      resetCount,
      ...(errors.length > 0 ? { errors } : {}),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[admin/reset-all-accounts POST] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
