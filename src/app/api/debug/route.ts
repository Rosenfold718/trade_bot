import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/debug — Environment & DB diagnostic (admin only)
 */
export async function GET(request: NextRequest) {
  const key = request.nextUrl.searchParams.get('key');
  if (key !== process.env.ADMIN_SETUP_KEY) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const info: Record<string, string> = {};

  info['TURSO_DATABASE_URL'] = process.env.TURSO_DATABASE_URL
    ? `${process.env.TURSO_DATABASE_URL.slice(0, 30)}...`
    : 'MISSING';

  info['TURSO_AUTH_TOKEN'] = process.env.TURSO_AUTH_TOKEN ? 'SET' : 'MISSING';
  info['NEXTAUTH_SECRET'] = process.env.NEXTAUTH_SECRET ? 'SET' : 'MISSING';
  info['NEXTAUTH_URL'] = process.env.NEXTAUTH_URL || 'NOT SET (auto-detect)';
  info['ADMIN_SETUP_KEY'] = process.env.ADMIN_SETUP_KEY ? 'SET' : 'MISSING';

  // Test actual Turso connection
  let dbStatus = 'not tested';
  try {
    const { createClient } = await import('@libsql/client');
    const client = createClient({
      url: process.env.TURSO_DATABASE_URL!,
      authToken: process.env.TURSO_AUTH_TOKEN!,
    });
    const result = await client.execute('SELECT 1 as ok');
    dbStatus = `CONNECTED (query returned ${result.rows[0]?.ok})`;
  } catch (err: any) {
    dbStatus = `FAILED: ${err.message}`;
  }

  info['TURSO_CONNECTION'] = dbStatus;

  // Check if auth tables exist
  let tablesStatus = 'not tested';
  try {
    const { createClient } = await import('@libsql/client');
    const client = createClient({
      url: process.env.TURSO_DATABASE_URL!,
      authToken: process.env.TURSO_AUTH_TOKEN!,
    });
    const result = await client.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='User'");
    tablesStatus = result.rows.length > 0 ? 'User table EXISTS' : 'User table NOT FOUND';
  } catch (err: any) {
    tablesStatus = err.message;
  }

  info['AUTH_TABLES'] = tablesStatus;

  return NextResponse.json(info);
}
