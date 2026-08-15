import { NextRequest, NextResponse } from 'next/server';
import { getCachedPrice, getCacheStats } from '@/lib/price-cache';

// Batch price endpoint — fetch multiple prices in one request
// Reduces 5 HTTP requests to 1 when a user loads the dashboard
export async function GET(request: NextRequest) {
  try {
    const symbolsParam = request.nextUrl.searchParams.get('symbols');
    const showStats = request.nextUrl.searchParams.get('stats');

    // Debug: show cache stats
    if (showStats === '1') {
      return NextResponse.json(getCacheStats());
    }

    if (!symbolsParam) {
      return NextResponse.json({ error: 'symbols parameter required (comma-separated, e.g. BTCUSDT,ETHUSDT)' }, { status: 400 });
    }

    const symbols = symbolsParam.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    if (symbols.length === 0 || symbols.length > 20) {
      return NextResponse.json({ error: 'Provide 1-20 symbols' }, { status: 400 });
    }

    const results: Record<string, number> = {};
    const errors: string[] = [];

    // Fetch all prices in parallel (cache will deduplicate Binance calls)
    await Promise.all(
      symbols.map(async (sym) => {
        try {
          results[sym] = await getCachedPrice(sym);
        } catch {
          errors.push(sym);
        }
      })
    );

    return NextResponse.json({
      prices: results,
      errors: errors.length > 0 ? errors : undefined,
      cached: true,
    });
  } catch (err) {
    return NextResponse.json({ error: 'Failed to fetch prices' }, { status: 502 });
  }
}
