import { NextRequest, NextResponse } from 'next/server';
import { resetTrader } from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const strategyId = (body.strategyId as string) || 'momentum';
    await resetTrader(strategyId);
    return NextResponse.json({ success: true, message: `Trader reset to initial state for strategy: ${strategyId}` });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}