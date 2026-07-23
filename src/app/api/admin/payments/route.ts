import { NextRequest, NextResponse } from 'next/server';
import { upsertSubscription, getAllUsers } from '@/lib/auth-db';
import { initAuthTables } from '@/lib/init-auth-tables';
import { getAuthClient } from '@/lib/auth-db';

const ADMIN_SETUP_KEY = process.env.ADMIN_SETUP_KEY || 'trade-bot-admin-2024';

function checkAuth(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization');
  return authHeader === `Bearer ${ADMIN_SETUP_KEY}`;
}

// GET /api/admin/payments — list pending + recent
export async function GET(request: NextRequest) {
  try {
    await initAuthTables();
    if (!checkAuth(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const db = getAuthClient();

    const result = await db.execute(
      `SELECT pr.id, pr.userId, pr.months, pr.status, pr.createdAt, pr.reviewedAt, pr.reviewedBy,
              u.username
       FROM "PaymentRequest" pr
       LEFT JOIN "User" u ON u.id = pr.userId
       ORDER BY
         CASE WHEN pr.status = 'pending' THEN 0 ELSE 1 END,
         pr.createdAt DESC
       LIMIT 50`
    );

    const requests = result.rows.map(row => ({
      id: row.id as string,
      userId: row.userId as string,
      username: row.username as string,
      months: Number(row.months),
      status: row.status as string,
      createdAt: row.createdAt as string,
      reviewedAt: row.reviewedAt as string | null,
      reviewedBy: row.reviewedBy as string | null,
    }));

    return NextResponse.json({ requests });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[admin/payments GET] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/admin/payments — approve or reject
export async function POST(request: NextRequest) {
  try {
    await initAuthTables();
    if (!checkAuth(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { requestId, action, reviewerName } = body as { requestId: string; action: 'approve' | 'reject'; reviewerName?: string };

    if (!requestId || !action) {
      return NextResponse.json({ error: 'requestId and action required' }, { status: 400 });
    }

    const db = getAuthClient();

    // Get the payment request
    const pr = await db.execute(
      `SELECT * FROM "PaymentRequest" WHERE id = ? AND status = 'pending'`,
      [requestId]
    );
    if (pr.rows.length === 0) {
      return NextResponse.json({ error: 'Заявка не найдена или уже обработана' }, { status: 404 });
    }

    const row = pr.rows[0];
    const userId = row.userId as string;
    const months = Number(row.months);
    const newStatus = action === 'approve' ? 'approved' : 'rejected';

    // Update payment request status
    await db.execute(
      `UPDATE "PaymentRequest" SET status = ?, reviewedAt = CURRENT_TIMESTAMP, reviewedBy = ? WHERE id = ?`,
      [newStatus, reviewerName || 'admin', requestId]
    );

    // If approved, activate subscription
    if (action === 'approve') {
      const durationDays = months * 30;
      const now = new Date();
      const expiresAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

      await upsertSubscription(userId, {
        isActive: true,
        startsAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        lastPaymentAt: now.toISOString(),
      });
    }

    return NextResponse.json({
      success: true,
      message: action === 'approve' ? 'Подписка активирована' : 'Заявка отклонена',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[admin/payments POST] Error:', message);
    return NextResponse.json({ error: 'Ошибка обработки заявки' }, { status: 500 });
  }
}
