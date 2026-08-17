import { NextResponse } from 'next/server';

/**
 * GET /api/auth/last-error
 * Returns the last authentication error from the authorize function.
 * This helps diagnose 401 issues in production.
 */
export async function GET() {
  const lastError = (globalThis as any).__authLastError || null;

  const envInfo = {
    TURSO_DATABASE_URL: process.env.TURSO_DATABASE_URL
      ? `${process.env.TURSO_DATABASE_URL.slice(0, 50)}...`
      : 'MISSING',
    TURSO_AUTH_TOKEN: process.env.TURSO_AUTH_TOKEN ? 'SET' : 'MISSING',
    NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET ? 'SET' : 'MISSING',
    NEXTAUTH_URL: process.env.NEXTAUTH_URL || 'MISSING',
  };

  return NextResponse.json({
    lastError,
    env: envInfo,
    timestamp: new Date().toISOString(),
  });
}
