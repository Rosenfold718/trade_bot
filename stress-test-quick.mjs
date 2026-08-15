/**
 * QUICK STRESS TEST — Simulates 100 concurrent users
 * Shorter version for CI/sandbox environments
 */
import autocannon from 'autocannon';
import { writeFileSync } from 'fs';

const BASE = process.env.STRESS_URL || 'http://localhost:3000';
const results = {};

function runTest(name, opts) {
  return new Promise((resolve, reject) => {
    const instance = autocannon({
      ...opts, url: BASE,
      headers: { 'Accept': 'application/json, text/html', 'User-Agent': 'StressTest/1.0' },
    }, (err, result) => {
      if (err) { results[name] = { error: err.message }; reject(err); return; }
      results[name] = result;
      resolve(result);
    });
    autocannon.track(instance, { renderProgressBar: true });
  });
}

// Phase 1: Baseline
console.log('\n=== PHASE 1: BASELINE ===');
let baseline = {};
try {
  const r = await fetch(`${BASE}/api/debug/stress`);
  baseline = await r.json();
  results.baseline = baseline;
  console.log('Binance price:', baseline.binance_single_price_ms, 'ms');
  console.log('Binance klines:', baseline.binance_klines_100_ms, 'ms');
  console.log('Binance 10cc:', baseline.binance_10concurrent_prices_ms, 'ms');
  console.log('Memory RSS:', baseline.memory?.rss_mb, 'MB');
} catch (e) { console.log('Baseline skipped:', e.message); }

// Phase 2: Homepage 100cc/5s
console.log('\n=== PHASE 2: HOMEPAGE 100cc/5s ===');
await runTest('Homepage', { connections: 100, duration: 5, requests: [{ method: 'GET', path: '/' }] });

// Phase 3: Price API 100cc/5s
console.log('\n=== PHASE 3: PRICE API 100cc/5s ===');
await runTest('Price API', {
  connections: 100, duration: 5,
  requests: [
    { method: 'GET', path: '/api/price?symbol=BTCUSDT' },
    { method: 'GET', path: '/api/price?symbol=ETHUSDT' },
  ],
});

// Phase 4: Auth endpoints 100cc/5s
console.log('\n=== PHASE 4: AUTH ENDPOINTS 100cc/5s ===');
await runTest('Auth Endpoints', {
  connections: 100, duration: 5,
  requests: [
    { method: 'GET', path: '/api/trader?strategyId=momentum' },
    { method: 'GET', path: '/api/trades?strategyId=momentum' },
    { method: 'GET', path: '/api/subscription' },
  ],
});

// Phase 5: Mixed realistic 100cc/10s
console.log('\n=== PHASE 5: MIXED REALISTIC 100cc/10s ===');
await runTest('Mixed Load', {
  connections: 100, duration: 10,
  requests: [
    { method: 'GET', path: '/', weight: 3 },
    { method: 'GET', path: '/api/price?symbol=BTCUSDT', weight: 10 },
    { method: 'GET', path: '/api/price?symbol=ETHUSDT', weight: 5 },
    { method: 'GET', path: '/api/trader?strategyId=momentum', weight: 5 },
    { method: 'GET', path: '/api/trades?strategyId=momentum', weight: 3 },
    { method: 'GET', path: '/api/subscription', weight: 2 },
    { method: 'GET', path: '/api/klines?symbol=BTCUSDT', weight: 1 },
  ],
});

// Post-stress check
console.log('\n=== POST-STRESS CHECK ===');
try {
  const r = await fetch(`${BASE}/api/debug/stress`);
  const post = await r.json();
  results.postStress = post;
  const memDelta = baseline.memory && post.memory ? post.memory.rss_mb - baseline.memory.rss_mb : 0;
  console.log('Post-stress Memory RSS:', post.memory?.rss_mb, 'MB (delta:', (memDelta > 0 ? '+' : '') + memDelta + 'MB)');
} catch (e) { console.log('Post-stress check skipped:', e.message); }

// Summary
console.log('\n' + '='.repeat(60));
console.log('  SUMMARY REPORT');
console.log('='.repeat(60));
const testNames = Object.keys(results).filter(k => k !== 'baseline' && k !== 'postStress');
for (const name of testNames) {
  const r = results[name];
  if (r.error) { console.log(`❌ ${name}: ${r.error}`); continue; }
  const errPct = ((r.errors / Math.max(r.requests.total, 1)) * 100).toFixed(1);
  const icon = parseFloat(errPct) > 5 ? '❌' : parseFloat(errPct) > 1 ? '🟡' : '✅';
  console.log(`${icon} ${name}`);
  console.log(`   Reqs: ${r.requests.total} | Avg: ${r.requests.average}ms | p50: ${r.latency.p50}ms | p95: ${r.latency.p95}ms | p99: ${r.latency.p99}ms`);
  console.log(`   Throughput: ${r.throughput.average} req/s | Errors: ${errPct}% | Timeouts: ${r.timeouts}`);
}

// Recommendations
console.log('\n--- РЕКОМЕНДАЦИИ ---');
const issues = [];
const warns = [];
for (const name of testNames) {
  const r = results[name];
  if (r.error) continue;
  const ep = (r.errors / Math.max(r.requests.total, 1)) * 100;
  if (ep > 5) issues.push(`${name}: ${ep.toFixed(1)}% errors`);
  else if (ep > 1) warns.push(`${name}: ${ep.toFixed(1)}% errors`);
  if (r.latency.p95 > 5000) warns.push(`${name}: p95=${r.latency.p95}ms`);
  if (r.latency.p99 > 10000) issues.push(`${name}: p99=${r.latency.p99}ms`);
}
if (baseline.binance_10concurrent_prices_ms > 2000)
  issues.push(`Binance 10cc: ${baseline.binance_10concurrent_prices_ms}ms — bottleneck for auto-trade`);
if (results.postStress?.memory && baseline.memory) {
  const d = results.postStress.memory.rss_mb - baseline.memory.rss_mb;
  if (d > 100) issues.push(`Memory leak: +${d}MB`);
  else if (d > 30) warns.push(`Memory growth: +${d}MB`);
}
if (!issues.length && !warns.length) console.log('✅ System is ready for 100 users!');
if (issues.length) { console.log('🔴 CRITICAL:'); issues.forEach((i, n) => console.log(`  ${n + 1}. ${i}`)); }
if (warns.length) { console.log('🟡 WARNINGS:'); warns.forEach((w, n) => console.log(`  ${n + 1}. ${w}`)); }

writeFileSync('/home/z/my-project/stress-test-results.json', JSON.stringify(results, null, 2));
console.log('\nResults saved to stress-test-results.json');
