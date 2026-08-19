import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/debug/stress — DB & Binance stress test (admin only)
 */
export async function GET(request: NextRequest) {
  const key = request.nextUrl.searchParams.get('key');
  if (key !== process.env.ADMIN_SETUP_KEY) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const results: Record<string, any> = { timestamp: new Date().toISOString() };

  // 1. Test Turso DB read latency
  try {
    const { createClient } = await import('@libsql/client');
    const client = createClient({
      url: process.env.TURSO_DATABASE_URL!,
      authToken: process.env.TURSO_AUTH_TOKEN!,
    });

    const start = performance.now();
    await Promise.all([
      client.execute('SELECT 1 as ok'),
      client.execute('SELECT 1 as ok2'),
      client.execute('SELECT 1 as ok3'),
      client.execute('SELECT 1 as ok4'),
      client.execute('SELECT 1 as ok5'),
      client.execute('SELECT 1 as ok6'),
    ]);
    results.db_6parallel_reads_ms = Math.round(performance.now() - start);

    const start2 = performance.now();
    for (let i = 0; i < 4; i++) {
      await client.execute(`SELECT ${i} as n`);
    }
    results.db_4sequential_reads_ms = Math.round(performance.now() - start2);

    const start3 = performance.now();
    await client.execute("INSERT INTO activity_log (user_id, action, details, created_at) VALUES ('stress-test', 'ping', 'load-test', datetime('now'))");
    results.db_write_ms = Math.round(performance.now() - start3);

    results.db_status = 'ok';
  } catch (err: any) {
    results.db_status = `error: ${err.message}`;
  }

  // 2. Test Binance API latency
  try {
    const start = performance.now();
    const res = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT');
    const data = await res.json();
    results.binance_single_price_ms = Math.round(performance.now() - start);
    results.binance_btc_price = data.price;
  } catch (err: any) {
    results.binance_status = `error: ${err.message}`;
  }

  // 3. Memory info
  try {
    const mem = process.memoryUsage();
    results.memory = {
      rss_mb: Math.round(mem.rss / 1024 / 1024),
      heapUsed_mb: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotal_mb: Math.round(mem.heapTotal / 1024 / 1024),
    };
  } catch { /* ignore */ }

  return NextResponse.json(results);
}
