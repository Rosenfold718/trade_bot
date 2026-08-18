import { NextResponse } from 'next/server';
import { runTradingCycle } from '@/lib/trading-bot-scheduler';

/**
 * GET /api/cron/trading-cycle
 * Triggered by Vercel Cron every minute.
 * Runs one trading cycle for all active subscribed users.
 */
export async function GET(request: Request) {
  // Verify this is called by Vercel Cron (or allow manually for testing)
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.ADMIN_SETUP_KEY || 'trade-bot-admin-2024';

  // Vercel Cron sends a special header
  const isVercelCron = request.headers.get('authorization') === `Bearer ${cronSecret}`
    || request.headers.get('x-vercel-cron') === 'true';

  if (!isVercelCron && process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await runTradingCycle();
    return NextResponse.json({
      ok: true,
      timestamp: new Date().toISOString(),
      ...result,
    });
  } catch (err: any) {
    console.error('[cron/trading-cycle] Error:', err);
    return NextResponse.json({
      ok: false,
      error: err.message,
      timestamp: new Date().toISOString(),
    }, { status: 500 });
  }
}

// Also accept POST for manual triggering
export async function POST(request: Request) {
  return GET(request);
}
