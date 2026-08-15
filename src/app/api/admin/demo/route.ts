import { NextRequest, NextResponse } from 'next/server';
import { createDemoAccount, resetDemoAccount, getDemoAccounts, deleteUserById, ensurePlainPassword } from '@/lib/auth-db';
import { initAuthTables } from '@/lib/init-auth-tables';

const ADMIN_SETUP_KEY = process.env.ADMIN_SETUP_KEY || 'trade-bot-admin-2024';

function checkAuth(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization');
  return authHeader === `Bearer ${ADMIN_SETUP_KEY}`;
}

// GET /api/admin/demo — list all demo accounts
export async function GET(request: NextRequest) {
  try {
    await initAuthTables();
    if (!checkAuth(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const accounts = await getDemoAccounts();
    // Ensure every demo account has plainPassword
    await Promise.all(accounts.map(a => ensurePlainPassword(a.id)));
    const accountsWithPwd = await getDemoAccounts();
    return NextResponse.json({ accounts: accountsWithPwd });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[admin/demo GET] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/admin/demo — create demo account
// POST /api/admin/demo?action=reset&id=xxx — reset demo account
export async function POST(request: NextRequest) {
  try {
    await initAuthTables();
    if (!checkAuth(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');
    const id = searchParams.get('id');

    // Reset demo account
    if (action === 'reset' && id) {
      const success = await resetDemoAccount(id);
      if (success) {
        return NextResponse.json({ success: true, message: 'Демо аккаунт продлён на 2 часа' });
      } else {
        return NextResponse.json({ error: 'Демо аккаунт не найден' }, { status: 404 });
      }
    }

    // Create new demo account
    const demo = await createDemoAccount();
    return NextResponse.json({
      success: true,
      username: demo.username,
      password: demo.plainPassword,
      expiresAt: demo.expiresAt,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[admin/demo POST] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE /api/admin/demo?id=xxx — delete demo account
export async function DELETE(request: NextRequest) {
  try {
    await initAuthTables();
    if (!checkAuth(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'id required' }, { status: 400 });
    }

    const deleted = await deleteUserById(id);
    if (deleted) {
      return NextResponse.json({ success: true, message: 'Демо аккаунт удалён' });
    } else {
      return NextResponse.json({ error: 'Демо аккаунт не найден' }, { status: 404 });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[admin/demo DELETE] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
