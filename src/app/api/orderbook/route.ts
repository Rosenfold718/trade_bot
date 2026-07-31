import { NextRequest, NextResponse } from 'next/server';

const CACHE_TTL = 2000; // 2s cache
const cache = new Map<string, { data: any; ts: number }>();

export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get('symbol');
  if (!symbol) return NextResponse.json({ error: 'Symbol required' }, { status: 400 });

  const now = Date.now();
  const cached = cache.get(symbol);
  if (cached && now - cached.ts < CACHE_TTL) {
    return NextResponse.json(cached.data);
  }

  try {
    const res = await fetch(`https://api.binance.com/api/v3/depth?symbol=${symbol}&limit=20`);
    if (!res.ok) throw new Error(`Binance API error: ${res.status}`);
    const data = await res.json();
    cache.set(symbol, { data, ts: now });
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch order book';
    console.error('[orderbook] Error:', message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
