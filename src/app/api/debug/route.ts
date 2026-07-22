import { NextResponse } from 'next/server';

export async function GET() {
  const info: Record<string, string> = {};

  info['TURSO_DATABASE_URL'] = process.env.TURSO_DATABASE_URL
    ? `${process.env.TURSO_DATABASE_URL.slice(0, 30)}...`
    : '❌ MISSING';

  info['TURSO_AUTH_TOKEN'] = process.env.TURSO_AUTH_TOKEN
    ? `***${process.env.TURSO_AUTH_TOKEN.slice(-4)}...`
    : '❌ MISSING';

  info['DATABASE_URL'] = process.env.DATABASE_URL
    ? `${process.env.DATABASE_URL.slice(0, 30)}...`
    : '❌ MISSING';

  info['NEXTAUTH_SECRET'] = process.env.NEXTAUTH_SECRET ? '✅ SET' : '❌ MISSING';
  info['NEXTAUTH_URL'] = process.env.NEXTAUTH_URL || '❌ MISSING';
  info['ADMIN_SETUP_KEY'] = process.env.ADMIN_SETUP_KEY ? '✅ SET' : '❌ MISSING';

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Debug</title></head>
<body style="font-family:monospace;padding:40px;background:#111;color:#eee">
<h2>Environment Variables</h2>
${Object.entries(info).map(([k, v]) => `<p><b>${k}</b>: ${v}</p>`).join('')}
</body></html>`;

  return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
