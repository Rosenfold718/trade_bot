import { NextRequest, NextResponse } from 'next/server';
import { getAllUsers, deleteUserById, findUserById } from '@/lib/auth-db';
import { initAuthTables } from '@/lib/init-auth-tables';

const ADMIN_SETUP_KEY = process.env.ADMIN_SETUP_KEY || 'trade-bot-admin-2024';

function checkAuth(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization');
  return authHeader === `Bearer ${ADMIN_SETUP_KEY}`;
}

// GET /api/admin/users — list all users
export async function GET(request: NextRequest) {
  try {
    await initAuthTables();
    if (!checkAuth(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

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
