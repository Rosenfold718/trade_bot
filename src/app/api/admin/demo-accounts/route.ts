import { NextRequest, NextResponse } from 'next/server';
import { tursoDb } from '@/lib/db';
import { getDemoAccounts } from '@/lib/auth-db';
import { initAuthTables } from '@/lib/init-auth-tables';

const ADMIN_SETUP_KEY = process.env.ADMIN_SETUP_KEY || 'trade-bot-admin-2024';

function checkAuth(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization');
  return authHeader === `Bearer ${ADMIN_SETUP_KEY}`;
}

// GET /api/admin/demo-accounts — all demo accounts with trading stats
export async function GET(request: NextRequest) {
  try {
    await initAuthTables();
    if (!checkAuth(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const accounts = await getDemoAccounts();

    const result: Array<{
    userId: string;
    username: string;
    email: string | null;
    role: string;
    isDemo: string | null;
    demoExpiresAt: string | null;
    createdAt: string;
    subscription: { isActive: boolean; expiresAt: string } | null;
    totalPnl: number;
    totalTrades: number;
    winRate: number;
    currentBalance: number;
    activeStrategies: number;
  }> = [];

    for (const account of accounts) {
      const userId = account.id;

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

      // Win count
      const winResult = await tursoDb.execute(
        `SELECT COUNT(*) as cnt FROM trades WHERE user_id = ? AND status = 'closed' AND pnl IS NOT NULL AND pnl > 0`,
        [userId]
      );
      const wins = Number(winResult.rows[0]?.cnt ?? 0);
      const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;

      // Current balance (sum across all strategies)
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

      result.push({
        userId: account.id,
        username: account.username,
        email: account.email,
        role: account.role,
        isDemo: account.isDemo,
        demoExpiresAt: account.demoExpiresAt,
        createdAt: account.createdAt,
        subscription: account.subscription
          ? {
              isActive: Boolean(account.subscription.isActive),
              expiresAt: account.subscription.expiresAt,
            }
          : null,
        totalPnl,
        totalTrades,
        winRate: Math.round(winRate * 100) / 100,
        currentBalance,
        activeStrategies,
      });
    }

    return NextResponse.json({ accounts: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[admin/demo-accounts GET] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
