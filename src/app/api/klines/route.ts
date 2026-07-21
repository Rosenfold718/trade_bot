import { NextRequest, NextResponse } from 'next/server';
import { fetchKlines } from '@/lib/trading-engine';

export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get('symbol');
  if (!symbol) {
    return NextResponse.json({ error: 'Symbol is required' }, { status: 400 });
  }
  try {
    const klines = await fetchKlines(symbol, '1h', 1440);
    return NextResponse.json(klines);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch klines';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}