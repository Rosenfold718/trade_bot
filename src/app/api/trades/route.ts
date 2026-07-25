import { NextRequest, NextResponse } from 'next/server';
import { initDB, getOpenTrades, getRecentTrades, getTotalClosedPnl, getClosedTradeCount } from '@/lib/db';
import { getAuthUserId } from '@/lib/auth-helpers';

export async function GET(request: NextRequest) {
  try {
    const userId = await getAuthUserId();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    await initDB();
    const { searchParams } = new URL(request.url);
    const strategyId = (searchParams.get('strategyId') as string) || 'momentum';
    const [openTrades, recentTrades, totalClosedPnl, closedTradeCount] = await Promise.all([
      getOpenTrades(userId, strategyId),
      getRecentTrades(userId, 50, strategyId),
      getTotalClosedPnl(userId, strategyId),
      getClosedTradeCount(userId, strategyId),
    ]);
    return NextResponse.json({ openTrades, recentTrades, totalClosedPnl, closedTradeCount });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}