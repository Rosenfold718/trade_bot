import { NextResponse } from 'next/server';
import { initDB, getTraderState, getIndicatorWeights, getOpenTrades, getRecentTrades } from '@/lib/db';

export async function GET() {
  try {
    await initDB();
    const [state, weights, openTrades, recentTrades] = await Promise.all([
      getTraderState(),
      getIndicatorWeights(),
      getOpenTrades(),
      getRecentTrades(20),
    ]);

    return NextResponse.json({
      state,
      weights,
      openTrades,
      recentTrades,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}