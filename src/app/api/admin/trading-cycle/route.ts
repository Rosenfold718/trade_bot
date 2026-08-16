import { NextResponse } from 'next/server';
import { initAuthTables } from '@/lib/init-auth-tables';
import { initDB } from '@/lib/db';
import { startTradingBot, isBotRunning, runTradingCycle } from '@/lib/trading-bot-scheduler';

const ADMIN_SETUP_KEY = process.env.ADMIN_SETUP_KEY || 'trade-bot-admin-2024';

function checkAuth(request: Request): boolean {
  const authHeader = request.headers.get('authorization');
  return authHeader === `Bearer ${ADMIN_SETUP_KEY}`;
}

// ── GET /api/admin/trading-cycle — check status / start bot ──
export async function GET(request: Request) {
  try {
    await initAuthTables();
    await initDB();
    if (!checkAuth(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    startTradingBot();
    return NextResponse.json({ status: 'running', botScheduler: isBotRunning(), message: 'Trading bot is active' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ── POST /api/admin/trading-cycle — run a single trading cycle ──
export async function POST(request: Request) {
  try {
    await initAuthTables();
    await initDB();
    if (!checkAuth(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    // Also start the background scheduler
    startTradingBot();

    const result = await runTradingCycle();
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('❌ Cycle failed:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
