import { NextRequest, NextResponse } from 'next/server';
import { upsertUser, getAllUsers, findUserByUsername } from '@/lib/auth-db';
import { initAuthTables } from '@/lib/init-auth-tables';
import bcrypt from 'bcryptjs';

// Secret admin setup key — change this in production!
const ADMIN_SETUP_KEY = process.env.ADMIN_SETUP_KEY || 'trade-bot-admin-2024';

/**
 * POST /api/admin/setup
 * Creates or resets the admin account with a perpetual subscription.
 * Requires the admin setup key in the Authorization header.
 *
 * Body: { username: string, password: string }
 */
export async function POST(request: NextRequest) {
  try {
    await initAuthTables();
    const authHeader = request.headers.get('authorization');
    if (!authHeader || authHeader !== `Bearer ${ADMIN_SETUP_KEY}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { username, password } = body as { username: string; password: string };

    if (!username || !password) {
      return NextResponse.json({ error: 'Username and password required' }, { status: 400 });
    }

    if (password.length < 6) {
      return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 });
    }

    return await doSetup(username, password);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[admin/setup] Error:', message);
    return NextResponse.json({ error: 'Setup failed' }, { status: 500 });
  }
}

/**
 * GET /api/admin/setup?key=...&username=...&password=...
 * Browser-friendly admin reset. Opens in browser to reset password.
 *
 * Query params:
 *   key      — admin setup key
 *   username — admin username
 *   password — new password
 *   reset    — "1" to force password reset (even if user exists)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');

    // If action=reset, do password reset via query params
    if (action === 'reset') {
      const key = searchParams.get('key');
      const username = searchParams.get('username');
      const password = searchParams.get('password');

      if (!key || key !== ADMIN_SETUP_KEY) {
        return NextResponse.json({ error: 'Invalid setup key' }, { status: 401 });
      }

      if (!username || !password) {
        return NextResponse.json({ error: 'username and password query params required' }, { status: 400 });
      }

      if (password.length < 6) {
        return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 });
      }

      const result = await doSetup(username, password);

      // Return HTML for browser display
      const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Admin Reset</title></head>
<body style="font-family:system-ui;padding:40px;background:#111;color:#eee">
<h2>✅ Пароль админа сброшен</h2>
<p>Юзер: <b>${username}</b></p>
<p>Пароль: <b>${password}</b></p>
<p>Теперь можно войти на главной странице.</p>
<script>setTimeout(() => window.location.href = '/', 3000)</script>
</body></html>`;

      return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }

    // Default: list users (requires Bearer auth header)
    await initAuthTables();
    const authHeader = request.headers.get('authorization');
    if (!authHeader || authHeader !== `Bearer ${ADMIN_SETUP_KEY}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const users = await getAllUsers();
    return NextResponse.json({ users });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function doSetup(username: string, password: string) {
  await initAuthTables();

  const hashedPassword = await bcrypt.hash(password, 12);

  // Perpetual subscription — expires in 10 years
  const farFuture = new Date();
  farFuture.setFullYear(farFuture.getFullYear() + 10);

  const user = await upsertUser(
    '', // auto-generate id for new users
    username,
    hashedPassword,
    {
      isActive: true,
      expiresAt: farFuture.toISOString(),
      lastPaymentAt: new Date().toISOString(),
    },
    password
  );

  return NextResponse.json({
    success: true,
    message: `Admin '${username}' ready — perpetual subscription (10 years)`,
    userId: user.id,
  });
}