import { NextRequest, NextResponse } from 'next/server';
import { initDB, getTraderState, getIndicatorWeights, getOpenTrades, getRecentTrades, initUserTradingData } from '@/lib/db';
import { getAuthUserId } from '@/lib/auth-helpers';

export async function GET(request: NextRequest) {
  try {
    const userId = await getAuthUserId();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    await initDB();

    const strategyId = request.nextUrl.searchParams.get('strategyId') || 'momentum';

    // Ensure user has trading data initialized
    try {
      await getTraderState(userId, strategyId);
    } catch {
      // State doesn't exist yet, initialize it
      await initUserTradingData(userId);
    }

    const [state, openTrades, recentTrades] = await Promise.all([
      getTraderState(userId, strategyId),
      getOpenTrades(userId, strategyId),
      getRecentTrades(userId, 20, strategyId),
    ]);

    const weights = await getIndicatorWeights(userId);

    return NextResponse.json({
      state,
      weights,
      openTrades,
      recentTrades,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[init] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = await getAuthUserId();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    await initUserTradingData(userId);
    return NextResponse.json({ success: true, message: 'User trading data initialized' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}