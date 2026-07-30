import { NextRequest, NextResponse } from 'next/server';
import { getCachedPrice } from '@/lib/price-cache';

export async function GET(request: NextRequest) {
  try {
    const symbol = request.nextUrl.searchParams.get('symbol');
    if (!symbol) {
      return NextResponse.json({ error: 'Symbol required' }, { status: 400 });
    }

    const price = await getCachedPrice(symbol);
    return NextResponse.json({ price, symbol: symbol.toUpperCase() });
  } catch (err) {
    console.error('[price] Error:', err);
    return NextResponse.json({ error: 'Failed to fetch price' }, { status: 502 });
  }
}
