import { NextRequest, NextResponse } from 'next/server';
import { initDB, getOpenTrades, getRecentTrades } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    await initDB();
    const { searchParams } = new URL(request.url);
    const strategyId = (searchParams.get('strategyId') as string) || 'momentum';
    const [openTrades, recentTrades] = await Promise.all([
      getOpenTrades(strategyId),
      getRecentTrades(20, strategyId),
    ]);
    return NextResponse.json({ openTrades, recentTrades });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}