import { NextResponse } from 'next/server';
import { initDB, getTraderState, getIndicatorWeights, getOpenTrades, getRecentTrades } from '@/lib/db';

export async function GET() {
  try {
    await initDB();

    // Fetch state for all strategies
    const strategies = ['momentum', 'mean-reversion', 'trend-pullback'];
    const strategyStates: Record<string, Awaited<ReturnType<typeof getTraderState>>> = {};
    for (const sid of strategies) {
      strategyStates[sid] = await getTraderState(sid);
    }

    const [weights, openTrades, recentTrades] = await Promise.all([
      getIndicatorWeights(),
      getOpenTrades('momentum'),
      getRecentTrades(20, 'momentum'),
    ]);

    return NextResponse.json({
      traderState: strategyStates['momentum'],
      strategyStates,
      weights,
      openTrades,
      recentTrades,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}