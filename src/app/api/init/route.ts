import { NextRequest, NextResponse } from 'next/server';
import { initDB, getTraderState, getIndicatorWeights, getOpenTrades, getRecentTrades } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    await initDB();

    const strategyId = request.nextUrl.searchParams.get('strategyId') || 'momentum';

    const [state, openTrades, recentTrades] = await Promise.all([
      getTraderState(strategyId),
      getOpenTrades(strategyId),
      getRecentTrades(20, strategyId),
    ]);

    const weights = await getIndicatorWeights();

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