import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const symbol = request.nextUrl.searchParams.get('symbol');
    if (!symbol) {
      return NextResponse.json({ error: 'Symbol required' }, { status: 400 });
    }

    const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`);
    if (!res.ok) {
      return NextResponse.json({ error: 'Failed to fetch price' }, { status: 502 });
    }
    const data = await res.json();
    return NextResponse.json({ price: parseFloat(data.price), symbol });
  } catch (err) {
    console.error('[price] Error:', err);
    return NextResponse.json({ error: 'Failed to fetch price' }, { status: 500 });
  }
}
