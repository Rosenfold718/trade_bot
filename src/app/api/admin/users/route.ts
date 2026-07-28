import { NextRequest, NextResponse } from 'next/server';
import { getAllUsers, deleteUserById, findUserById } from '@/lib/auth-db';
import { initAuthTables } from '@/lib/init-auth-tables';

const ADMIN_SETUP_KEY = process.env.ADMIN_SETUP_KEY || 'trade-bot-admin-2024';

function checkAuth(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization');
  return authHeader === `Bearer ${ADMIN_SETUP_KEY}`;
}

// GET /api/admin/users — list all users
// GET /api/admin/users?id=xxx — get single user details + payment history
export async function GET(request: NextRequest) {
  try {
    await initAuthTables();
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
        `SELECT u.id, u.username, u.email, u.telegram, u.role, u.createdAt, u.updatedAt,
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
        email: (row.email as string) || null,
        telegram: (row.telegram as string) || null,
        role: (row.role as string) || 'user',
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

      return NextResponse.json({ user, paymentHistory, pendingRequests });
    }

    // All users list
    const users = await getAllUsers();
    return NextResponse.json({ users });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[admin/users GET] Error:', message);
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
