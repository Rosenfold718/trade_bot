/**
 * Server-side price cache — prevents Binance rate limiting under load
 * 
 * Problem: 100 users × 3 prices × every 2s = 150 req/s → Binance limit is 20 req/s
 * 
 * Solution:
 *  1. In-memory cache with 3s TTL (deduplication across users)
 *  2. In-flight deduplication (thundering herd protection)
 *     If 100 requests for BTCUSDT arrive simultaneously, only ONE goes to Binance.
 *     The other 99 wait ~80ms and get the same result.
 */

interface CacheEntry {
  price: number;
  timestamp: number;
}

const CACHE_TTL_MS = 3000;
const cache = new Map<string, CacheEntry>();

// In-flight requests: prevents 100 concurrent requests from making 100 Binance calls
const inFlight = new Map<string, Promise<number>>();

export async function getCachedPrice(symbol: string): Promise<number> {
  const key = symbol.toUpperCase();

  // 1. Check cache — instant hit, no I/O
  const cached = cache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.price;
  }

  // 2. Check in-flight — another request is already fetching this price
  const pending = inFlight.get(key);
  if (pending) {
    return pending; // all 100 waiters get the same promise
  }

  // 3. We are the first — fetch from Binance
  const fetchPromise = (async () => {
    try {
      const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${key}`);
      if (!res.ok) {
        // Return stale cache if available, otherwise throw
        if (cached) return cached.price;
        throw new Error(`Binance ${res.status}`);
      }
      const data = await res.json();
      const price = parseFloat(data.price);
      cache.set(key, { price, timestamp: Date.now() });
      return price;
    } finally {
      inFlight.delete(key); // always clean up, even on error
    }
  })();

  inFlight.set(key, fetchPromise);
  return fetchPromise;
}

export function getCacheStats() {
  return {
    entries: cache.size,
    inFlight: inFlight.size,
    ttlMs: CACHE_TTL_MS,
    keys: [...cache.keys()],
  };
}
