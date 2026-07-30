/**
 * STRESS TEST — Simulates 100 concurrent users on the trading platform
 * 
 * Tests:
 * 1. Baseline diagnostics (Binance API, memory)
 * 2. Static page load (homepage HTML)
 * 3. Diagnostic endpoint (DB + Binance stress)
 * 4. Price API (Binance proxy — realistic user polling)
 * 5. Auth-protected endpoints (expect 401, measures server overhead)
 * 6. Mixed realistic sustained load (60 seconds)
 * 
 * Usage: node stress-test.mjs
 */

import autocannon from 'autocannon';

const BASE = process.env.STRESS_URL || 'http://localhost:3000';
const results = {};

function runTest(name, opts) {
  return new Promise((resolve, reject) => {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`  TEST: ${name}`);
    console.log(`${'='.repeat(60)}`);

    const instance = autocannon({
      ...opts,
      url: BASE,
      headers: {
        'Accept': 'application/json, text/html',
        'User-Agent': 'StressTest/1.0',
      },
    }, (err, result) => {
      if (err) {
        console.error(`  ❌ ERROR: ${err.message}`);
        results[name] = { error: err.message };
        reject(err);
        return;
      }
      results[name] = result;
      console.log(`  ✅ Completed`);
      console.log(`  Requests: ${result.requests.total} total, ${result.requests.average}ms avg`);
      console.log(`  Latency: p50=${result.latency.p50}ms, p95=${result.latency.p95}ms, p99=${result.latency.p99}ms`);
      console.log(`  Throughput: ${result.throughput.average} req/sec`);
      console.log(`  Errors: ${result.errors} total (${((result.errors / Math.max(result.requests.total, 1)) * 100).toFixed(1)}%)`);
      console.log(`  Timeouts: ${result.timeouts} total`);
      if (result.non2xx) {
        console.log(`  Non-2xx: ${result.non2xx}`);
      }
      resolve(result);
    });

    autocannon.track(instance, { renderProgressBar: true });
  });
}

// ============================================================
// TEST 1: Baseline — Single diagnostic request
// ============================================================
console.log('\n🔍 PHASE 1: BASELINE DIAGNOSTICS');

let baseline = {};
try {
  const baselineRes = await fetch(`${BASE}/api/debug/stress`);
  baseline = await baselineRes.json();
  results.baseline = baseline;
} catch (e) {
  console.log('  ⚠️  Diagnostic endpoint unavailable, skipping DB baselines');
}

console.log('\n── Single-request baselines ──');
console.log(`  DB 6 parallel reads:     ${baseline.db_6parallel_reads_ms ?? 'N/A (no Turso)'}ms`);
console.log(`  DB 4 sequential reads:   ${baseline.db_4sequential_reads_ms ?? 'N/A (no Turso)'}ms`);
console.log(`  DB single write:         ${baseline.db_write_ms ?? 'N/A (no Turso)'}ms`);
console.log(`  DB 10 concurrent writes: ${baseline.db_10concurrent_writes_ms ?? 'N/A (no Turso)'}ms`);
console.log(`  Binance single price:    ${baseline.binance_single_price_ms ?? 'N/A'}ms`);
console.log(`  Binance klines (100):    ${baseline.binance_klines_100_ms ?? 'N/A'}ms`);
console.log(`  Binance 10 concurrent:   ${baseline.binance_10concurrent_prices_ms ?? 'N/A'}ms`);
if (baseline.memory) {
  console.log(`  Memory RSS:              ${baseline.memory.rss_mb}MB`);
  console.log(`  Memory Heap:            ${baseline.memory.heapUsed_mb}MB / ${baseline.memory.heapTotal_mb}MB`);
}

await new Promise(r => setTimeout(r, 2000));

// ============================================================
// TEST 2: Static page load (homepage) — 100 connections
// ============================================================
console.log('\n\n⚡ PHASE 2: STATIC PAGE LOAD (100 concurrent)');
await runTest('Homepage 100cc/10s', {
  connections: 100,
  duration: 10,
  requests: [{ method: 'GET', path: '/' }],
});

await new Promise(r => setTimeout(r, 3000));

// ============================================================
// TEST 3: Diagnostic endpoint (DB+Binance stress) — 50 connections
// ============================================================
console.log('\n\n⚡ PHASE 3: DIAGNOSTIC ENDPOINT (50 concurrent — heavy DB+Binance)');
await runTest('Stress Diagnostic 50cc/15s', {
  connections: 50,
  duration: 15,
  requests: [{ method: 'GET', path: '/api/debug/stress' }],
});

await new Promise(r => setTimeout(r, 3000));

// ============================================================
// TEST 4: Price API (Binance proxy) — 100 connections
// ============================================================
console.log('\n\n⚡ PHASE 4: PRICE API — BINANCE PROXY (100 concurrent)');
await runTest('Price API 100cc/15s', {
  connections: 100,
  duration: 15,
  requests: [
    { method: 'GET', path: '/api/price?symbol=BTCUSDT' },
    { method: 'GET', path: '/api/price?symbol=ETHUSDT' },
    { method: 'GET', path: '/api/price?symbol=SOLUSDT' },
  ],
});

await new Promise(r => setTimeout(r, 3000));

// ============================================================
// TEST 5: Auth-protected endpoints (expect 401) — 100 connections
// ============================================================
console.log('\n\n⚡ PHASE 5: AUTH-PROTECTED ENDPOINTS (100 concurrent, expect 401)');
await runTest('Auth Endpoints 100cc/15s', {
  connections: 100,
  duration: 15,
  requests: [
    { method: 'GET', path: '/api/trader?strategyId=momentum' },
    { method: 'GET', path: '/api/trades?strategyId=momentum' },
    { method: 'GET', path: '/api/subscription' },
  ],
});

await new Promise(r => setTimeout(r, 3000));

// ============================================================
// TEST 6: Mixed realistic load — simulate real user behavior
// ============================================================
console.log('\n\n⚡ PHASE 6: REALISTIC MIXED LOAD (100 concurrent, 30s)');
await runTest('Realistic Mixed 100cc/30s', {
  connections: 100,
  duration: 30,
  requests: [
    { method: 'GET', path: '/', weight: 3 },
    { method: 'GET', path: '/api/price?symbol=BTCUSDT', weight: 10 },
    { method: 'GET', path: '/api/price?symbol=ETHUSDT', weight: 5 },
    { method: 'GET', path: '/api/trader?strategyId=momentum', weight: 5 },
    { method: 'GET', path: '/api/trades?strategyId=momentum', weight: 3 },
    { method: 'GET', path: '/api/trades?strategyId=scalper', weight: 2 },
    { method: 'GET', path: '/api/subscription', weight: 2 },
    { method: 'GET', path: '/api/klines?symbol=BTCUSDT', weight: 1 },
  ],
});

await new Promise(r => setTimeout(r, 5000));

// ============================================================
// FINAL: Post-stress diagnostic
// ============================================================
console.log('\n\n🔍 PHASE 7: POST-STRESS DIAGNOSTICS');
let postBaseline = {};
try {
  const postRes = await fetch(`${BASE}/api/debug/stress`);
  postBaseline = await postRes.json();
  results.postStress = postBaseline;
} catch (e) {
  console.log('  ⚠️  Diagnostic endpoint unavailable after stress');
}

console.log('\n── Post-stress baselines (compare with initial) ──');
console.log(`  DB 6 parallel reads:     ${postBaseline.db_6parallel_reads_ms ?? 'N/A'}ms (was ${baseline.db_6parallel_reads_ms ?? 'N/A'}ms)`);
console.log(`  DB 4 sequential reads:   ${postBaseline.db_4sequential_reads_ms ?? 'N/A'}ms (was ${baseline.db_4sequential_reads_ms ?? 'N/A'}ms)`);
console.log(`  DB 10 concurrent writes: ${postBaseline.db_10concurrent_writes_ms ?? 'N/A'}ms (was ${baseline.db_10concurrent_writes_ms ?? 'N/A'}ms)`);
if (postBaseline.memory && baseline.memory) {
  const memDelta = postBaseline.memory.rss_mb - baseline.memory.rss_mb;
  console.log(`  Memory RSS:              ${postBaseline.memory.rss_mb}MB (delta: ${memDelta > 0 ? '+' : ''}${memDelta}MB)`);
  console.log(`  Memory Heap:            ${postBaseline.memory.heapUsed_mb}MB / ${postBaseline.memory.heapTotal_mb}MB`);
}

// ============================================================
// SUMMARY REPORT
// ============================================================
console.log('\n\n' + '█'.repeat(60));
console.log('█' + ' '.repeat(58) + '█');
console.log('█' + '  STRESS TEST SUMMARY REPORT'.padEnd(58) + '█');
console.log('█' + ' '.repeat(58) + '█');
console.log('█'.repeat(60));

const testNames = Object.keys(results).filter(k => k !== 'baseline' && k !== 'postStress');

for (const name of testNames) {
  const r = results[name];
  if (r.error) {
    console.log(`\n  ❌ ${name}: ${r.error}`);
    continue;
  }
  const errorPct = ((r.errors / Math.max(r.requests.total, 1)) * 100).toFixed(1);
  const status = parseFloat(errorPct) > 5 ? 'FAIL' : parseFloat(errorPct) > 1 ? 'WARN' : 'OK';
  const icon = parseFloat(errorPct) > 5 ? '❌' : parseFloat(errorPct) > 1 ? '🟡' : '✅';
  console.log(`\n  ${icon} ${status} | ${name}`);
  console.log(`       Requests: ${r.requests.total} | Avg: ${r.requests.average}ms | p95: ${r.latency.p95}ms | p99: ${r.latency.p99}ms`);
  console.log(`       Throughput: ${r.throughput.average} req/s | Errors: ${r.errors} (${errorPct}%) | Timeouts: ${r.timeouts}`);
}

console.log('\n' + '─'.repeat(60));
console.log('  РЕКОМЕНДАЦИИ ДЛЯ 100 ПОЛЬЗОВАТЕЛЕЙ:');
console.log('─'.repeat(60));

const issues = [];
const warnings = [];

if (baseline.db_6parallel_reads_ms > 500) {
  issues.push(`DB слишком медленный: 6 параллельных reads = ${baseline.db_6parallel_reads_ms}ms (норма < 500ms). Турso remote latency может быть проблемой при 100 юзерах.`);
}
if (postBaseline.db_10concurrent_writes_ms && baseline.db_10concurrent_writes_ms) {
  const writeDegrade = postBaseline.db_10concurrent_writes_ms / baseline.db_10concurrent_writes_ms;
  if (writeDegrade > 3) {
    issues.push(`DB writes деградировали в ${writeDegrade.toFixed(1)}x после нагрузки. Нужна оптимизация.`);
  }
}

if (baseline.binance_single_price_ms > 300) {
  warnings.push(`Binance latency высокий: ${baseline.binance_single_price_ms}ms. Прокси добавляет задержку.`);
}
if (baseline.binance_10concurrent_prices_ms > 2000) {
  issues.push(`10 concurrent Binance запросов: ${baseline.binance_10concurrent_prices_ms}ms. Это узкое место при автоторговле.`);
}

for (const name of testNames) {
  const r = results[name];
  if (r.error) continue;
  const errorPct = (r.errors / Math.max(r.requests.total, 1)) * 100;
  if (errorPct > 5) {
    issues.push(`${name}: ${errorPct.toFixed(1)}% ошибок — критично для продакшна.`);
  } else if (errorPct > 1) {
    warnings.push(`${name}: ${errorPct.toFixed(1)}% ошибок — приемлемо, но стоит мониторить.`);
  }
}

for (const name of testNames) {
  const r = results[name];
  if (r.error) continue;
  if (r.latency.p95 > 5000) {
    warnings.push(`${name}: p95 latency = ${r.latency.p95}ms — медленно для UX.`);
  }
  if (r.latency.p99 > 10000) {
    issues.push(`${name}: p99 latency = ${r.latency.p99}ms — критически медленно.`);
  }
}

if (postBaseline.memory && baseline.memory) {
  const memDelta = postBaseline.memory.rss_mb - baseline.memory.rss_mb;
  if (memDelta > 100) {
    issues.push(`Memory leak подозрение: +${memDelta}MB RSS после теста.`);
  } else if (memDelta > 30) {
    warnings.push(`Memory growth: +${memDelta}MB RSS. Мониторьте.`);
  }
}

if (issues.length === 0 && warnings.length === 0) {
  console.log('\n  ✅ Система готова к 100 пользователям! Все метрики в норме.');
} else {
  if (issues.length > 0) {
    console.log('\n  🔴 КРИТИЧЕСКИЕ ПРОБЛЕМЫ:');
    issues.forEach((i, idx) => console.log(`     ${idx + 1}. ${i}`));
  }
  if (warnings.length > 0) {
    console.log('\n  🟡 ПРЕДУПРЕЖДЕНИЯ:');
    warnings.forEach((w, idx) => console.log(`     ${idx + 1}. ${w}`));
  }
}

console.log('\n' + '█'.repeat(60) + '\n');

import { writeFileSync } from 'fs';
writeFileSync('/home/z/my-project/stress-test-results.json', JSON.stringify(results, null, 2));
console.log('  📊 Полные результаты сохранены: stress-test-results.json');
