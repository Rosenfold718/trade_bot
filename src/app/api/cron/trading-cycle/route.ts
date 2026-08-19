import { NextResponse } from 'next/server';
import { initAuthTables } from '@/lib/init-auth-tables';
import { initDB } from '@/lib/db';
import { runTradingCycle } from '@/lib/trading-bot-scheduler';

/**
 * Vercel Cron endpoint — called by external cron service (e.g. cron-job.org)
 * every 1-2 minutes to keep the trading bot running on serverless.
 * 
 * No auth required — this is a public endpoint that just runs the trading cycle.
 * The cycle itself only processes users with active subscriptions.
 */
export async function GET() {
  try {
    await initAuthTables();
    await initDB();
    const result = await runTradingCycle();
    return NextResponse.json({
      success: true,
      ...result,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[cron/trading-cycle] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST() {
  return GET();
}
