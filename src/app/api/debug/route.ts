import { NextResponse } from 'next/server';

export async function GET() {
  const info: Record<string, string> = {};

  info['TURSO_DATABASE_URL'] = process.env.TURSO_DATABASE_URL
    ? `${process.env.TURSO_DATABASE_URL.slice(0, 30)}...`
    : '❌ MISSING';

  info['TURSO_AUTH_TOKEN'] = process.env.TURSO_AUTH_TOKEN
    ? `***${process.env.TURSO_AUTH_TOKEN.slice(-4)}...`
    : '❌ MISSING';

  info['NEXTAUTH_SECRET'] = process.env.NEXTAUTH_SECRET ? '✅ SET' : '❌ MISSING';
  info['NEXTAUTH_URL'] = process.env.NEXTAUTH_URL || '❌ MISSING';
  info['ADMIN_SETUP_KEY'] = process.env.ADMIN_SETUP_KEY ? '✅ SET' : '❌ MISSING';

  // Test actual Turso connection
  let dbStatus = 'not tested';
  try {
    const { createClient } = await import('@libsql/client');
    const client = createClient({
      url: process.env.TURSO_DATABASE_URL!,
      authToken: process.env.TURSO_AUTH_TOKEN!,
    });
    const result = await client.execute('SELECT 1 as ok');
    dbStatus = `✅ CONNECTED (query returned ${result.rows[0]?.ok})`;
  } catch (err: any) {
    dbStatus = `❌ FAILED: ${err.message}`;
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
    tablesStatus = result.rows.length > 0 ? '✅ User table EXISTS' : '⚠️ User table NOT FOUND — run /api/setup?key=trade-bot-admin-2024';
  } catch (err: any) {
    tablesStatus = `❌ ${err.message}`;
  }

  info['AUTH_TABLES'] = tablesStatus;

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Debug</title></head>
<body style="font-family:monospace;padding:40px;background:#111;color:#eee">
<h2>Environment Variables & DB Check</h2>
${Object.entries(info).map(([k, v]) => `<p><b>${k}</b>: ${v}</p>`).join('')}
</body></html>`;

  return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
