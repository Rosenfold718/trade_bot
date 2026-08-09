import { NextRequest, NextResponse } from 'next/server';
import { getAllUsers, deleteUserById, findUserById } from '@/lib/auth-db';
import { initAuthTables } from '@/lib/init-auth-tables';
import { initDB, tursoDb, getTraderState } from '@/lib/db';
import { STRATEGIES } from '@/lib/strategies';

const ADMIN_SETUP_KEY = process.env.ADMIN_SETUP_KEY || 'trade-bot-admin-2024';

function checkAuth(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization');
  return authHeader === `Bearer ${ADMIN_SETUP_KEY}`;
}

// GET /api/admin/users — list all users (with trading summary)
// GET /api/admin/users?id=xxx — get single user details + payment history + trading state
export async function GET(request: NextRequest) {
  try {
    await initAuthTables();
    await initDB();
    if (!checkAuth(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('id');

    // Single user detail
    if (userId) {
      const { getAuthClient } = await import('@/lib/auth-db');
      const db = getAuthClient();

      // User info
      const userRes = await db.execute(
        `SELECT u.id, u.username, u.password, u.email, u.telegram, u.role, u.isDemo, u.demoExpiresAt, u.createdAt, u.updatedAt,
                s.id as sub_id, s.isActive as sub_isActive, s.startsAt as sub_startsAt,
                s.expiresAt as sub_expiresAt, s.lastPaymentAt as sub_lastPaymentAt
         FROM "User" u
         LEFT JOIN "Subscription" s ON s.userId = u.id
         WHERE u.id = ?`,
        [userId]
      );

      if (userRes.rows.length === 0) {
        return NextResponse.json({ error: 'Пользователь не найден' }, { status: 404 });
      }

      const row = userRes.rows[0];
      const user = {
        id: row.id as string,
        username: row.username as string,
        password: row.password as string,
        email: (row.email as string) || null,
        telegram: (row.telegram as string) || null,
        role: (row.role as string) || 'user',
        isDemo: (row.isDemo as string) || null,
        demoExpiresAt: (row.demoExpiresAt as string) || null,
        createdAt: row.createdAt as string,
        updatedAt: row.updatedAt as string,
        subscription: row.sub_id ? {
          id: row.sub_id as string,
          isActive: Number(row.sub_isActive),
          startsAt: row.sub_startsAt as string,
          expiresAt: row.sub_expiresAt as string,
          lastPaymentAt: (row.sub_lastPaymentAt as string) || null,
        } : null,
      };

      // Payment history for this user
      const phRes = await db.execute(
        `SELECT * FROM "PaymentHistory" WHERE userId = ? ORDER BY createdAt DESC LIMIT 20`,
        [userId]
      );
      const paymentHistory = phRes.rows.map(r => ({
        id: r.id as string,
        planLabel: r.planLabel as string,
        amountUSD: Number(r.amountUSD),
        txHash: (r.txHash as string) || null,
        status: r.status as string,
        createdAt: r.createdAt as string,
        confirmedAt: (r.confirmedAt as string) || null,
        confirmedBy: (r.confirmedBy as string) || null,
      }));

      // Pending payment requests
      const prRes = await db.execute(
        `SELECT * FROM "PaymentRequest" WHERE userId = ? AND status = 'pending' ORDER BY createdAt DESC LIMIT 10`,
        [userId]
      );
      const pendingRequests = prRes.rows.map(r => ({
        id: r.id as string,
        months: Number(r.months),
        planLabel: r.planLabel as string,
        amountUSD: Number(r.amountUSD),
        txHash: (r.txHash as string) || null,
        createdAt: r.createdAt as string,
      }));

      // Trading state per strategy
      const tradingStates: Array<{
        strategyId: string;
        strategyName: string;
        balance: number;
        initialBalance: number;
        openTrades: number;
        closedTrades: number;
        totalPnl: number;
        initialized: boolean;
      }> = [];

      for (const strategy of STRATEGIES) {
        try {
          const state = await getTraderState(userId, strategy.id);
          // Count open and closed trades
          const tradesRes = await tursoDb.execute(
            `SELECT status, COUNT(*) as cnt, COALESCE(SUM(pnl), 0) as total_pnl FROM trades WHERE user_id = ? AND strategy_id = ? GROUP BY status`,
            [userId, strategy.id]
          );
          let openCount = 0, closedCount = 0, totalPnl = 0;
          for (const tr of tradesRes.rows) {
            if (tr.status === 'open') openCount = Number(tr.cnt);
            if (tr.status === 'closed') {
              closedCount = Number(tr.cnt);
              totalPnl = Number(tr.total_pnl);
            }
          }
          tradingStates.push({
            strategyId: strategy.id,
            strategyName: strategy.name,
            balance: state.balance,
            initialBalance: state.initial_balance,
            openTrades: openCount,
            closedTrades: closedCount,
            totalPnl,
            initialized: true,
          });
        } catch {
          tradingStates.push({
            strategyId: strategy.id,
            strategyName: strategy.name,
            balance: 0, initialBalance: 0,
            openTrades: 0, closedTrades: 0, totalPnl: 0,
            initialized: false,
          });
        }
      }

      return NextResponse.json({ user, paymentHistory, pendingRequests, tradingStates });
    }

    // All users list — with trading summary
    const users = await getAllUsers();

    // Enrich users with trading summary
    const enrichedUsers = await Promise.all(users.map(async (u) => {
      let totalBalance = 0;
      let totalOpen = 0;
      let totalPnl = 0;
      let initialized = false;
      for (const s of STRATEGIES) {
        try {
          const st = await getTraderState(u.id, s.id);
          totalBalance += st.balance;
          initialized = true;
        } catch { /* not initialized */ }
      }
      try {
        const openRes = await tursoDb.execute(
          `SELECT COUNT(*) as cnt FROM trades WHERE user_id = ? AND status = 'open'`,
          [u.id]
        );
        totalOpen = Number(openRes.rows[0]?.cnt ?? 0);
      } catch { /* ignore */ }
      try {
        const pnlRes = await tursoDb.execute(
          `SELECT COALESCE(SUM(pnl), 0) as total FROM trades WHERE user_id = ? AND status = 'closed'`,
          [u.id]
        );
        totalPnl = Number(pnlRes.rows[0]?.total ?? 0);
      } catch { /* ignore */ }
      return { ...u, tradingSummary: { totalBalance, totalOpen, totalPnl, initialized } };
    }));

    return NextResponse.json({ users: enrichedUsers });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[admin/users GET] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/admin/users — initialize trading for a user
export async function POST(request: NextRequest) {
  try {
    await initAuthTables();
    await initDB();
    if (!checkAuth(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { userId, action } = await request.json();
    if (!userId) {
      return NextResponse.json({ error: 'userId required' }, { status: 400 });
    }

    if (action === 'init-trading') {
      // Initialize trading state for all strategies for this user
      const results: Array<{ strategyId: string; success: boolean; error?: string }> = [];
      for (const strategy of STRATEGIES) {
        try {
          const id = `${userId}-${strategy.id}`;
          // Check if already exists
          const existing = await tursoDb.execute(
            'SELECT id FROM trader_state WHERE id = ? AND user_id = ?',
            [id, userId]
          );
          if (existing.rows.length > 0) {
            results.push({ strategyId: strategy.id, success: true });
            continue;
          }
          // Create new trader state
          await tursoDb.execute(
            `INSERT INTO trader_state (id, user_id, strategy_id, balance, borrowed_funds, debt_to_repay, initial_balance, is_active)
             VALUES (?, ?, ?, 100, 0, 0, 100, 1)`,
            [id, userId, strategy.id]
          );
          results.push({ strategyId: strategy.id, success: true });
        } catch (err) {
          results.push({ strategyId: strategy.id, success: false, error: String(err) });
        }
      }
      return NextResponse.json({ success: true, results });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[admin/users POST] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE /api/admin/users?id=xxx — delete user
export async function DELETE(request: NextRequest) {
  try {
    await initAuthTables();
    if (!checkAuth(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('id');
    if (!userId) {
      return NextResponse.json({ error: 'userId required' }, { status: 400 });
    }

    // Prevent deleting admin
    const user = await findUserById(userId);
    if (user?.username === 'admin') {
      return NextResponse.json({ error: 'Нельзя удалить аккаунт администратора' }, { status: 403 });
    }

    const deleted = await deleteUserById(userId);
    if (deleted) {
      return NextResponse.json({ success: true, message: 'Аккаунт удалён' });
    } else {
      return NextResponse.json({ error: 'Пользователь не найден' }, { status: 404 });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[admin/users DELETE] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
