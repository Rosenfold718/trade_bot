import { NextResponse } from 'next/server';
import { initDB, getRecentTrades } from '@/lib/db';

export async function GET() {
  try {
    await initDB();
    const trades = await getRecentTrades(50);
    return NextResponse.json(trades);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}