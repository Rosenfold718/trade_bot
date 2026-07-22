import { NextRequest, NextResponse } from 'next/server';
import { initDB, getOpenTrades, getRecentTrades } from '@/lib/db';
import { getAuthUserId } from '@/lib/auth-helpers';

export async function GET(request: NextRequest) {
  try {
    const userId = await getAuthUserId();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    await initDB();
    const { searchParams } = new URL(request.url);
    const strategyId = (searchParams.get('strategyId') as string) || 'momentum';
    const [openTrades, recentTrades] = await Promise.all([
      getOpenTrades(userId, strategyId),
      getRecentTrades(userId, 20, strategyId),
    ]);
    return NextResponse.json({ openTrades, recentTrades });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}