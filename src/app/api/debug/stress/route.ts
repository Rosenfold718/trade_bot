import { NextResponse } from 'next/server';

// Public diagnostic endpoint for stress testing — no auth required
// This simulates the actual DB load of a single user request cycle

export async function GET() {
  const results: Record<string, any> = { timestamp: new Date().toISOString() };

  // 1. Test Turso DB read latency (single query)
  try {
    const { createClient } = await import('@libsql/client');
    const client = createClient({
      url: process.env.TURSO_DATABASE_URL!,
      authToken: process.env.TURSO_AUTH_TOKEN!,
    });

    // Simulate a typical user request: 6 parallel reads (like /api/trader GET)
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

    // Simulate sequential reads (like /api/trades GET)
    const start2 = performance.now();
    for (let i = 0; i < 4; i++) {
      await client.execute(`SELECT ${i} as n`);
    }
    results.db_4sequential_reads_ms = Math.round(performance.now() - start2);

    // Test write latency
    const start3 = performance.now();
    await client.execute("INSERT INTO activity_log (user_id, action, details, created_at) VALUES ('stress-test', 'ping', 'load-test', datetime('now'))");
    results.db_write_ms = Math.round(performance.now() - start3);

    // Test concurrent writes (simulate 10 users writing simultaneously)
    const start4 = performance.now();
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        client.execute(
          `INSERT INTO activity_log (user_id, action, details, created_at) VALUES ('stress-${i}', 'concurrent-write', 'load-test', datetime('now'))`
        )
      )
    );
    results.db_10concurrent_writes_ms = Math.round(performance.now() - start4);

    // Count total rows to verify writes
    const countRes = await client.execute("SELECT COUNT(*) as cnt FROM activity_log WHERE action LIKE 'stress%'");
    results.stress_test_rows = Number(countRes.rows[0]?.cnt ?? 0);

    // Cleanup old stress test rows (keep last 1000)
    try {
      await client.execute(
        `DELETE FROM activity_log WHERE action LIKE 'stress%' AND rowid NOT IN (SELECT rowid FROM activity_log WHERE action LIKE 'stress%' ORDER BY rowid DESC LIMIT 1000)`
      );
    } catch { /* ignore */ }

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

  // 3. Test Binance klines (heavier request)
  try {
    const start = performance.now();
    const res = await fetch('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=100');
    const data = await res.json();
    results.binance_klines_100_ms = Math.round(performance.now() - start);
    results.binance_klines_count = Array.isArray(data) ? data.length : 0;
  } catch (err: any) {
    results.binance_klines_status = `error: ${err.message}`;
  }

  // 4. Test 10 concurrent Binance requests (simulate auto-trade scanning)
  try {
    const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT',
      'ADAUSDT', 'DOGEUSDT', 'AVAXUSDT', 'DOTUSDT', 'LINKUSDT'];
    const start = performance.now();
    await Promise.all(
      symbols.map(s => fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${s}`).then(r => r.json()))
    );
    results.binance_10concurrent_prices_ms = Math.round(performance.now() - start);
  } catch (err: any) {
    results.binance_concurrent_status = `error: ${err.message}`;
  }

  // 5. Memory & process info
  try {
    const mem = process.memoryUsage();
    results.memory = {
      rss_mb: Math.round(mem.rss / 1024 / 1024),
      heapUsed_mb: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotal_mb: Math.round(mem.heapTotal / 1024 / 1024),
      external_mb: Math.round(mem.external / 1024 / 1024),
    };
  } catch { /* ignore */ }

  return NextResponse.json(results);
}
