import { NextRequest, NextResponse } from 'next/server';
import { upsertUser, getAllUsers } from '@/lib/auth-db';
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
      }
    );

    return NextResponse.json({
      success: true,
      message: `Admin '${username}' ready — perpetual subscription (10 years)`,
      userId: user.id,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[admin/setup] Error:', message);
    return NextResponse.json({ error: 'Setup failed' }, { status: 500 });
  }
}

/**
 * GET /api/admin/setup
 * Lists all users with subscription info (admin only).
 */
export async function GET(request: NextRequest) {
  try {
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
