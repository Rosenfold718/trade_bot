import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/auth/last-error
 * Returns last auth error (admin only).
 */
export async function GET(request: NextRequest) {
  const key = request.nextUrl.searchParams.get('key');
  if (key !== process.env.ADMIN_SETUP_KEY) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const lastError = (globalThis as any).__authLastError || null;

  return NextResponse.json({
    lastError,
    timestamp: new Date().toISOString(),
  });
}
