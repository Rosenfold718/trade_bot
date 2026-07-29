import { TOP_50_SYMBOLS } from './types';
import type { CandleData } from './types';

// ============================================================
// BTC Correlation Analyzer
// Determines which coins move with BTC (correlated) vs independently.
// Used as a pre-filter before opening trades: if BTC is trending,
// prefer same-direction trades on correlated coins.
// ============================================================

interface CorrelationData {
  symbol: string;
  correlation: number;       // Pearson r (-1 to +1)
  correlated: boolean;        // |r| > 0.5
  label: string;              // 'Коррелирует' | 'Независим'
}

interface BTCRegime {
  direction: 'up' | 'down' | 'neutral';
  strength: number;           // 0 to 1 (how strong the trend is)
  priceChangePct: number;     // % change over the lookback
  ema50AboveEma200: boolean;  // structural trend
}

// Cache
let _cache: {
  correlations: Map<string, CorrelationData>;
  btcRegime: BTCRegime;
  updatedAt: number;
  fetching: boolean;
} = {
  correlations: new Map(),
  btcRegime: { direction: 'neutral', strength: 0, priceChangePct: 0, ema50AboveEma200: false },
  updatedAt: 0,
  fetching: false,
};

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const LOOKBACK_CANDLES = 200; // 200 hourly candles ≈ 8 days
const CORRELATION_THRESHOLD = 0.5; // |r| > 0.5 = correlated

// ============================================================
// Pearson correlation on percentage returns
// ============================================================
function calcReturns(candles: CandleData[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    if (candles[i - 1].close > 0) {
      returns.push((candles[i].close - candles[i - 1].close) / candles[i - 1].close);
    }
  }
  return returns;
}

function pearsonCorrelation(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 10) return 0;

  const ax = x.slice(0, n);
  const ay = y.slice(0, n);
  const mx = ax.reduce((s, v) => s + v, 0) / n;
  const my = ay.reduce((s, v) => s + v, 0) / n;

  let sumXY = 0, sumX2 = 0, sumY2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = ax[i] - mx;
    const dy = ay[i] - my;
    sumXY += dx * dy;
    sumX2 += dx * dx;
    sumY2 += dy * dy;
  }

  const denom = Math.sqrt(sumX2 * sumY2);
  return denom === 0 ? 0 : sumXY / denom;
}

// ============================================================
// Fetch klines from Binance (client-side, CORS-friendly)
// ============================================================
async function fetchKlines(symbol: string, limit: number = LOOKBACK_CANDLES): Promise<CandleData[]> {
  try {
    const res = await fetch(
      `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1h&limit=${limit}`
    );
    if (!res.ok) return [];
    const raw = await res.json();
    if (!Array.isArray(raw) || raw.length < 10) return [];
    return raw.map((k: (string | number)[]) => ({
      time: Math.floor(Number(k[0]) / 1000),
      open: parseFloat(String(k[1])),
      high: parseFloat(String(k[2])),
      low: parseFloat(String(k[3])),
      close: parseFloat(String(k[4])),
      volume: parseFloat(String(k[5])),
    }));
  } catch {
    return [];
  }
}

// ============================================================
// Determine BTC regime (trend direction + strength)
// ============================================================
function analyzeBTCRegime(candles: CandleData[]): BTCRegime {
  if (candles.length < 20) {
    return { direction: 'neutral', strength: 0, priceChangePct: 0, ema50AboveEma200: false };
  }

  const closes = candles.map(c => c.close);
  const n = closes.length;

  // EMA50
  const ema50Period = Math.min(50, Math.floor(n / 2));
  let ema50 = closes.slice(0, ema50Period).reduce((s, v) => s + v, 0) / ema50Period;
  const k50 = 2 / (ema50Period + 1);
  for (let i = ema50Period; i < n; i++) {
    ema50 = closes[i] * k50 + ema50 * (1 - k50);
  }

  // EMA200 — proper calculation with 200 candles
  const ema200Period = Math.min(200, Math.floor(n / 2));
  let ema200 = closes.slice(0, ema200Period).reduce((s, v) => s + v, 0) / ema200Period;
  const k200 = 2 / (ema200Period + 1);
  for (let i = ema200Period; i < n; i++) {
    ema200 = closes[i] * k200 + ema200 * (1 - k200);
  }

  const ema50AboveEma200 = ema50 > ema200;
  const currentPrice = closes[n - 1];
  const priceChangePct = ((currentPrice - closes[0]) / closes[0]) * 100;

  // RSI-like momentum (simplified)
  const recentCandles = closes.slice(-10);
  const changes = [];
  for (let i = 1; i < recentCandles.length; i++) {
    changes.push(recentCandles[i] - recentCandles[i - 1]);
  }
  const avgGain = changes.filter(c => c > 0).reduce((s, c) => s + c, 0) / Math.max(1, changes.filter(c => c > 0).length);
  const avgLoss = Math.abs(changes.filter(c => c < 0).reduce((s, c) => s + c, 0)) / Math.max(1, changes.filter(c => c < 0).length);
  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  const momentumStrength = Math.min(1, rs / 3); // 0-1 scale

  // Determine direction
  let direction: 'up' | 'down' | 'neutral' = 'neutral';
  let strength = 0;

  if (priceChangePct > 0.5 || (ema50AboveEma200 && momentumStrength > 0.4)) {
    direction = 'up';
    strength = Math.min(1, Math.max(
      priceChangePct / 3, // 3% = strong
      momentumStrength
    ));
  } else if (priceChangePct < -0.5 || (!ema50AboveEma200 && momentumStrength < 0.3)) {
    direction = 'down';
    strength = Math.min(1, Math.max(
      Math.abs(priceChangePct) / 3,
      1 - momentumStrength
    ));
  }

  return { direction, strength, priceChangePct, ema50AboveEma200 };
}

// ============================================================
// Main function: refresh correlation data
// ============================================================
export async function refreshBTCCorrelation(): Promise<{
  correlations: Map<string, CorrelationData>;
  btcRegime: BTCRegime;
}> {
  // Return cache if fresh
  if (_cache.updatedAt > 0 && Date.now() - _cache.updatedAt < CACHE_TTL_MS && _cache.correlations.size > 0) {
    return { correlations: _cache.correlations, btcRegime: _cache.btcRegime };
  }

  // Prevent concurrent fetches
  if (_cache.fetching) {
    return { correlations: _cache.correlations, btcRegime: _cache.btcRegime };
  }

  _cache.fetching = true;

  try {
    // Fetch BTC candles
    const btcCandles = await fetchKlines('BTCUSDT', LOOKBACK_CANDLES + 10);
    if (btcCandles.length < 20) {
      _cache.fetching = false;
      return { correlations: _cache.correlations, btcRegime: _cache.btcRegime };
    }

    const btcReturns = calcReturns(btcCandles);
    const regime = analyzeBTCRegime(btcCandles);

    // Fetch correlation for each coin (skip BTC itself, stables, wrapped tokens)
    const skipSymbols = new Set(['BTCUSDT', 'WBTCUSDT', 'STETHUSDT', 'WUSDT', 'USDCUSDT']);
    const newCorrelations = new Map<string, CorrelationData>();

    // Batch fetch — 5 coins at a time to avoid rate limits
    const coinsToAnalyze = TOP_50_SYMBOLS.filter(s => !skipSymbols.has(s));
    const batchSize = 5;

    for (let i = 0; i < coinsToAnalyze.length; i += batchSize) {
      const batch = coinsToAnalyze.slice(i, i + batchSize);
      const promises = batch.map(async (sym) => {
        const coinCandles = await fetchKlines(sym, LOOKBACK_CANDLES + 10);
        if (coinCandles.length < 20) {
          return { symbol: sym, correlation: 0, correlated: false, label: 'Нет данных' };
        }
        const coinReturns = calcReturns(coinCandles);
        const r = pearsonCorrelation(btcReturns, coinReturns);
        return {
          symbol: sym,
          correlation: r,
          correlated: Math.abs(r) > CORRELATION_THRESHOLD,
          label: Math.abs(r) > CORRELATION_THRESHOLD
            ? (r > 0 ? 'Следует за BTC' : 'Обратная корреляция')
            : 'Независим от BTC',
        };
      });

      const results = await Promise.all(promises);
      for (const result of results) {
        newCorrelations.set(result.symbol, result);
      }
    }

    _cache.correlations = newCorrelations;
    _cache.btcRegime = regime;
    _cache.updatedAt = Date.now();

    console.log(
      `[BTC Correlation] Refreshed ${newCorrelations.size} coins | BTC: ${regime.direction} (${regime.priceChangePct.toFixed(2)}%) strength=${regime.strength.toFixed(2)}`
    );

  } catch (err) {
    console.error('[BTC Correlation] Error:', err);
  } finally {
    _cache.fetching = false;
  }

  return { correlations: _cache.correlations, btcRegime: _cache.btcRegime };
}

// ============================================================
// Get correlation for a specific symbol (from cache)
// ============================================================
export function getBTCCorrelation(symbol: string): CorrelationData | null {
  return _cache.correlations.get(symbol) ?? null;
}

// ============================================================
// Get current BTC regime (from cache)
// ============================================================
export function getBTCRegime(): BTCRegime {
  return _cache.btcRegime;
}

// ============================================================
// Check if a trade direction is aligned with BTC regime
// Returns: 'aligned' | 'conflicting' | 'neutral'
// ============================================================
export function checkBTCCorrelationAlignment(
  symbol: string,
  direction: 'long' | 'short'
): { aligned: 'aligned' | 'conflicting' | 'neutral'; reason: string; boost: number } {
  const regime = _cache.btcRegime;
  const corr = _cache.correlations.get(symbol);

  // If no data or BTC is neutral, no filter
  if (regime.direction === 'neutral' || regime.strength < 0.2) {
    return { aligned: 'neutral', reason: 'BTC нейтрален', boost: 1.0 };
  }

  // If coin is independent of BTC, no filter
  if (!corr || !corr.correlated) {
    return { aligned: 'neutral', reason: `${symbol.replace('USDT', '')} независим от BTC`, boost: 1.0 };
  }

  const btcUp = regime.direction === 'up';
  const tradeLong = direction === 'long';
  const positiveCorr = corr.correlation > 0;

  // BTC up + positive correlation + long = aligned
  // BTC up + negative correlation + short = aligned
  // BTC down + positive correlation + short = aligned
  // BTC down + negative correlation + long = aligned
  const isAligned = (btcUp && tradeLong && positiveCorr) ||
                    (btcUp && !tradeLong && !positiveCorr) ||
                    (!btcUp && !tradeLong && positiveCorr) ||
                    (!btcUp && tradeLong && !positiveCorr);

  if (isAligned) {
    const boost = 1.0 + regime.strength * 0.2; // up to 20% score boost
    return { aligned: 'aligned', reason: `BTC ${btcUp ? '↑' : '↓'}, ${symbol.replace('USDT', '')} следует (${corr.correlation > 0 ? '+' : ''}${corr.correlation.toFixed(2)})`, boost };
  } else {
    return { aligned: 'conflicting', reason: `BTC ${btcUp ? '↑' : '↓'}, но сделка ${tradeLong ? 'LONG' : 'SHORT'} — конфликт`, boost: 0.7 }; // 30% score penalty
  }
}

// ============================================================
// Get all correlations for display
// ============================================================
export function getAllCorrelations(): CorrelationData[] {
  return Array.from(_cache.correlations.values());
}

// ============================================================
// Get formatted BTC regime summary for display
// ============================================================
export function getBTCRegimeSummary(): {
  direction: string;
  strength: string;
  changePct: string;
  emaAlignment: string;
  correlated: number;
  independent: number;
} {
  const regime = _cache.btcRegime;
  let correlated = 0, independent = 0;
  for (const c of _cache.correlations.values()) {
    if (c.correlated) correlated++;
    else independent++;
  }

  return {
    direction: regime.direction === 'up' ? '↑ Рост' : regime.direction === 'down' ? '↓ Падение' : '— Нейтрально',
    strength: `${(regime.strength * 100).toFixed(0)}%`,
    changePct: `${regime.priceChangePct >= 0 ? '+' : ''}${regime.priceChangePct.toFixed(2)}%`,
    emaAlignment: regime.ema50AboveEma200 ? 'EMA50 > EMA200 (бычий)' : 'EMA50 < EMA200 (медвежий)',
    correlated,
    independent,
  };
}
