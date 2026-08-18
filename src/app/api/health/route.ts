import { NextResponse } from 'next/server';

/**
 * GET /api/health
 * Returns comprehensive health check including DB connectivity,
 * env vars, table existence, and user count.
 */
export async function GET() {
  const health: Record<string, any> = { timestamp: new Date().toISOString() };

  // 1. Environment variables
  health.env = {
    TURSO_DATABASE_URL: process.env.TURSO_DATABASE_URL
      ? `${process.env.TURSO_DATABASE_URL.slice(0, 50)}...`
      : 'MISSING',
    TURSO_AUTH_TOKEN: process.env.TURSO_AUTH_TOKEN ? 'SET' : 'MISSING',
    NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET ? 'SET' : 'MISSING',
    NEXTAUTH_URL: process.env.NEXTAUTH_URL || 'MISSING',
    NODE_ENV: process.env.NODE_ENV || 'not set',
  };

  // 2. Database connection test
  try {
    const { createClient } = await import('@libsql/client');
    const client = createClient({
      url: process.env.TURSO_DATABASE_URL!,
      authToken: process.env.TURSO_AUTH_TOKEN || undefined,
    });
    const result = await client.execute('SELECT 1 as ok');
    health.db = { status: 'ok', queryResult: result.rows[0]?.ok };

    // 3. Check tables
    const tables = await client.execute(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    );
    health.db.tables = tables.rows.map(r => r.name as string);

    // 4. Check User table has expected columns
    try {
      const cols = await client.execute('PRAGMA table_info("User")');
      health.db.userColumns = cols.rows.map(r => r.name as string);
      const requiredCols = ['id', 'username', 'password', 'role', 'plainPassword'];
      const missing = requiredCols.filter(c => !health.db.userColumns.includes(c));
      health.db.missingUserColumns = missing;
    } catch (e: any) {
      health.db.userColumns = 'error: ' + e.message;
    }

    // 5. Count users
    try {
      const users = await client.execute('SELECT role, COUNT(*) as cnt FROM "User" GROUP BY role');
      health.db.usersByRole = users.rows.map(r => ({ role: r.role, count: r.cnt }));
      health.db.totalUsers = users.rows.reduce((sum, r) => sum + Number(r.cnt), 0);
    } catch (e: any) {
      health.db.usersByRole = 'error: ' + e.message;
    }

    // 6. Check admin exists
    try {
      const admin = await client.execute("SELECT id, username, role FROM \"User\" WHERE role = 'admin' LIMIT 1");
      health.db.adminExists = admin.rows.length > 0;
      if (admin.rows.length > 0) {
        health.db.adminUser = { id: admin.rows[0].id, username: admin.rows[0].username };
      }
    } catch (e: any) {
      health.db.adminExists = 'error: ' + e.message;
    }

  } catch (err: any) {
    health.db = { status: 'FAILED', error: err.message };
  }

  // 7. Last auth error
  health.lastAuthError = (globalThis as any).__authLastError || null;

  // Overall status
  health.status = health.db?.status === 'ok' && health.db?.adminExists === true ? 'healthy' : 'unhealthy';

  return NextResponse.json(health, {
    status: health.status === 'healthy' ? 200 : 503,
  });
}
