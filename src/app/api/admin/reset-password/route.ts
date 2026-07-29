import { NextRequest, NextResponse } from 'next/server';
import { resetUserPassword, findUserById } from '@/lib/auth-db';
import { initAuthTables } from '@/lib/init-auth-tables';

const ADMIN_SETUP_KEY = process.env.ADMIN_SETUP_KEY || 'trade-bot-admin-2024';

function checkAuth(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization');
  return authHeader === `Bearer ${ADMIN_SETUP_KEY}`;
}

// POST /api/admin/reset-password — reset a user's password
export async function POST(request: NextRequest) {
  try {
    await initAuthTables();
    if (!checkAuth(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { userId } = body as { userId: string };

    if (!userId) {
      return NextResponse.json({ error: 'userId required' }, { status: 400 });
    }

    const user = await findUserById(userId);
    if (!user) {
      return NextResponse.json({ error: 'Пользователь не найден' }, { status: 404 });
    }

    const newPassword = await resetUserPassword(userId);
    return NextResponse.json({
      success: true,
      newPassword,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[admin/reset-password POST] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
