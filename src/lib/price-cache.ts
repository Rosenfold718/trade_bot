/**
 * Server-side price cache to prevent Binance rate limiting
 * 
 * Problem: 100 users × 3 price polls each × every 2s = 150 req/s to Binance
 * Binance limit: 1200 req/min per IP = 20 req/s
 * 
 * Solution: In-memory cache with 3s TTL. Reduces 150 req/s → ~10 req/s
 */

interface CacheEntry {
  price: number;
  timestamp: number;
}

const CACHE_TTL_MS = 3000; // 3 seconds
const cache = new Map<string, CacheEntry>();

// Periodic cleanup to prevent memory leak
let lastCleanup = Date.now();
function cleanup() {
  const now = Date.now();
  if (now - lastCleanup < 60_000) return; // clean every 60s
  lastCleanup = now;
  const expired = now - CACHE_TTL_MS;
  for (const [key, entry] of cache) {
    if (entry.timestamp < expired) cache.delete(key);
  }
}

export async function getCachedPrice(symbol: string): Promise<number> {
  const upper = symbol.toUpperCase();
  
  // Check cache
  const cached = cache.get(upper);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.price;
  }
  
  // Fetch from Binance
  const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${upper}`);
  if (!res.ok) {
    // Return stale cache if available
    if (cached) return cached.price;
    throw new Error(`Binance error: ${res.status}`);
  }
  
  const data = await res.json();
  const price = parseFloat(data.price);
  
  // Update cache
  cache.set(upper, { price, timestamp: Date.now() });
  cleanup();
  
  return price;
}

export function getCacheStats() {
  return {
    entries: cache.size,
    ttlMs: CACHE_TTL_MS,
    keys: [...cache.keys()],
  };
}
