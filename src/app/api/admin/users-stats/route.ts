import { NextRequest, NextResponse } from 'next/server';
import { tursoDb } from '@/lib/db';
import { getAllUsers } from '@/lib/auth-db';
import { initAuthTables } from '@/lib/init-auth-tables';

const ADMIN_SETUP_KEY = process.env.ADMIN_SETUP_KEY || 'trade-bot-admin-2024';

function checkAuth(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization');
  return authHeader === `Bearer ${ADMIN_SETUP_KEY}`;
}

// GET /api/admin/users-stats — all users with trading PnL stats
export async function GET(request: NextRequest) {
  try {
    await initAuthTables();
    if (!checkAuth(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const users = await getAllUsers();

    const stats: Array<{
      userId: string;
      email: string;
      name: string;
      totalPnl: number;
      totalTrades: number;
      winRate: number;
      currentBalance: number;
      activeStrategies: number;
      createdAt: string;
    }> = [];

    for (const user of users) {
      const userId = user.id;

      // Total PnL from closed trades
      const pnlResult = await tursoDb.execute(
        `SELECT COALESCE(SUM(pnl), 0) as total FROM trades WHERE user_id = ? AND status = 'closed' AND pnl IS NOT NULL`,
        [userId]
      );
      const totalPnl = Number(pnlResult.rows[0]?.total ?? 0);

      // Total closed trades count
      const countResult = await tursoDb.execute(
        `SELECT COUNT(*) as cnt FROM trades WHERE user_id = ? AND status = 'closed'`,
        [userId]
      );
      const totalTrades = Number(countResult.rows[0]?.cnt ?? 0);

      // Win count (trades with pnl > 0)
      const winResult = await tursoDb.execute(
        `SELECT COUNT(*) as cnt FROM trades WHERE user_id = ? AND status = 'closed' AND pnl IS NOT NULL AND pnl > 0`,
        [userId]
      );
      const wins = Number(winResult.rows[0]?.cnt ?? 0);
      const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;

      // Current balance (sum across all strategies from trader_state)
      const balanceResult = await tursoDb.execute(
        `SELECT COALESCE(SUM(balance), 0) as total FROM trader_state WHERE user_id = ?`,
        [userId]
      );
      const currentBalance = Number(balanceResult.rows[0]?.total ?? 0);

      // Active strategies count
      const activeResult = await tursoDb.execute(
        `SELECT COUNT(*) as cnt FROM trader_state WHERE user_id = ? AND is_active = 1`,
        [userId]
      );
      const activeStrategies = Number(activeResult.rows[0]?.cnt ?? 0);

      stats.push({
        userId: user.id,
        email: user.email || user.username,
        name: user.username,
        totalPnl,
        totalTrades,
        winRate: Math.round(winRate * 100) / 100,
        currentBalance,
        activeStrategies,
        createdAt: user.createdAt,
      });
    }

    return NextResponse.json({ stats });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[admin/users-stats GET] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
