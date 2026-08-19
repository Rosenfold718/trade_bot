import { NextRequest, NextResponse } from 'next/server';
import { getCacheStats } from '@/lib/price-cache';

// Stress test analysis (admin only)
export async function GET(request: NextRequest) {
  const key = request.nextUrl.searchParams.get('key');
  if (key !== process.env.ADMIN_SETUP_KEY) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const priceCacheStats = getCacheStats();

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    priceCache: priceCacheStats,
    capacity: {
      estimatedMaxUsers: 100,
      binanceLimitPerIp: '1200 req/min (20 req/s)',
      withCache: '~5 Binance req/s (3s TTL deduplicates)',
    },
  });
}
