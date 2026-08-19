import { NextRequest, NextResponse } from 'next/server';
import { findUserByUsername } from '@/lib/auth-db';
import { initAuthTables } from '@/lib/init-auth-tables';
import bcrypt from 'bcryptjs';

/**
 * POST /api/auth/test-login
 * Diagnostic endpoint (admin only) — tests login credentials.
 */
export async function POST(request: NextRequest) {
  // Admin-only access via query param or header
  const key = request.nextUrl.searchParams.get('key')
    || request.headers.get('x-admin-key');
  if (key !== process.env.ADMIN_SETUP_KEY) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const steps: { step: string; ok: boolean; detail: string }[] = [];

  try {
    // Step 1: Check env vars
    const tursoUrl = process.env.TURSO_DATABASE_URL;
    const nextauthSecret = process.env.NEXTAUTH_SECRET;

    steps.push({
      step: 'env_vars',
      ok: !!(tursoUrl && nextauthSecret),
      detail: `TURSO_DATABASE_URL: ${tursoUrl ? 'SET' : 'MISSING'} | NEXTAUTH_SECRET: ${nextauthSecret ? 'SET' : 'MISSING'}`,
    });

    if (!tursoUrl) {
      return NextResponse.json({ success: false, steps, error: 'TURSO_DATABASE_URL not set' }, { status: 500 });
    }

    // Step 2: Init tables
    try {
      await initAuthTables();
      steps.push({ step: 'init_tables', ok: true, detail: 'Tables initialized OK' });
    } catch (err: any) {
      steps.push({ step: 'init_tables', ok: false, detail: err.message });
      return NextResponse.json({ success: false, steps, error: 'Failed to init tables: ' + err.message }, { status: 500 });
    }

    // Step 3: Parse body
    const body = await request.json();
    const { username, password } = body as { username: string; password: string };

    if (!username || !password) {
      steps.push({ step: 'input', ok: false, detail: 'Missing username or password' });
      return NextResponse.json({ success: false, steps, error: 'Username and password required' }, { status: 400 });
    }
    steps.push({ step: 'input', ok: true, detail: `username="${username}"` });

    // Step 4: Find user
    let user;
    try {
      user = await findUserByUsername(username);
      steps.push({
        step: 'find_user',
        ok: !!user,
        detail: user
          ? `Found: id=${user.id}, role=${user.role}`
          : 'User not found in database',
      });
    } catch (err: any) {
      steps.push({ step: 'find_user', ok: false, detail: err.message });
      return NextResponse.json({ success: false, steps, error: 'DB query failed: ' + err.message }, { status: 500 });
    }

    if (!user) {
      return NextResponse.json({ success: false, steps, error: 'User not found' });
    }

    // Step 5: Verify password
    try {
      const isValid = await bcrypt.compare(password, user.password);
      steps.push({
        step: 'password_check',
        ok: isValid,
        detail: isValid ? 'Password matches!' : 'Password does NOT match.',
      });

      if (!isValid) {
        return NextResponse.json({ success: false, steps, error: 'Invalid password' });
      }
    } catch (err: any) {
      steps.push({ step: 'password_check', ok: false, detail: err.message });
      return NextResponse.json({ success: false, steps, error: 'Password check failed: ' + err.message }, { status: 500 });
    }

    // Step 6: Check subscription
    try {
      const { findSubscriptionByUserId } = await import('@/lib/auth-db');
      const sub = await findSubscriptionByUserId(user.id);
      steps.push({
        step: 'subscription',
        ok: sub?.isActive === 1 || sub?.isActive === true,
        detail: sub
          ? `active=${sub.isActive}, expires=${sub.expiresAt}`
          : 'No subscription found',
      });
    } catch (err: any) {
      steps.push({ step: 'subscription', ok: false, detail: err.message });
    }

    return NextResponse.json({
      success: true,
      steps,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        email: user.email,
      },
    });

  } catch (err: any) {
    steps.push({ step: 'unhandled', ok: false, detail: err.message || String(err) });
    return NextResponse.json({ success: false, steps, error: 'Unhandled error: ' + (err.message || String(err)) }, { status: 500 });
  }
}
