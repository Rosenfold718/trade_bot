// ============================================================
// Client-side settings cache
// Fetches from /api/settings and provides helpers for:
//   - getEffectiveStrategy(strategyId) — merges DB overrides with static config
//   - getSys(key, default) — reads system-wide settings
// ============================================================

import { getStrategy, type StrategyConfig } from './strategies';

let _cache: Record<string, string> | null = null;
let _fetchPromise: Promise<Record<string, string>> | null = null;
let _lastFetch = 0;
const CACHE_TTL = 30_000; // 30 seconds

// ── Fetch & cache ──

export async function fetchSettings(): Promise<Record<string, string>> {
  if (_cache && Date.now() - _lastFetch < CACHE_TTL) return _cache;
  if (_fetchPromise) return _fetchPromise;

  _fetchPromise = (async () => {
    try {
      const res = await fetch('/api/settings');
      const data = await res.json();
      _cache = data.settings ?? {};
      _lastFetch = Date.now();
      return _cache;
    } catch {
      return _cache ?? {};
    }
  })();

  const result = await _fetchPromise;
  _fetchPromise = null;
  return result;
}

/** Force refresh on next fetch (e.g. after admin save) */
export function invalidateSettingsCache(): void {
  _cache = null;
  _lastFetch = 0;
}

// ── System setting helper ──

export function getSys(
  settings: Record<string, string>,
  key: string,
  defaultVal: number | boolean | string,
): number | boolean | string {
  const raw = settings[key];
  if (raw === undefined || raw === null) return defaultVal;

  if (typeof defaultVal === 'number') {
    const n = parseFloat(raw);
    return isNaN(n) ? defaultVal : n;
  }
  if (typeof defaultVal === 'boolean') {
    return raw === 'true';
  }
  return raw;
}

// ── Strategy override helper ──

/**
 * Build an effective StrategyConfig by merging DB overrides
 * on top of the static config from strategies.ts.
 *
 * DB keys are stored as "strategy.{strategyId}.{field}" — e.g.:
 *   strategy.momentum.maxOpenTrades  → "15"
 *   strategy.scalper.scoreThreshold  → "0.05"
 *   strategy.position-alpha.defaultInterval → "1h"
 */
export function getEffectiveStrategy(
  settings: Record<string, string>,
  strategyId: string,
): StrategyConfig {
  const base = getStrategy(strategyId);
  if (!base) return getStrategy('momentum')!;

  const prefix = `strategy.${strategyId}.`;

  // Helper to read a number override
  const num = (field: string, fallback: number): number => {
    const raw = settings[prefix + field];
    if (raw === undefined) return fallback;
    const n = parseFloat(raw);
    return isNaN(n) ? fallback : n;
  };

  // Helper to read a boolean override
  const bool = (field: string, fallback: boolean): boolean => {
    const raw = settings[prefix + field];
    if (raw === undefined) return fallback;
    return raw === 'true';
  };

  // Helper to read a string override
  const str = (field: string, fallback: string): string => {
    const raw = settings[prefix + field];
    return raw !== undefined ? raw : fallback;
  };

  // adxMin can be null (meaning "no filter")
  const adxMinRaw = settings[prefix + 'adxMin'];
  const adxMin: number | null = adxMinRaw !== undefined ? parseFloat(adxMinRaw) : base.adxMin;

  return {
    ...base,
    maxLeverage: num('maxLeverage', base.maxLeverage),
    riskRewardRatio: num('riskRewardRatio', base.riskRewardRatio),
    tradeSizePercent: num('tradeSizePercent', base.tradeSizePercent),
    maxOpenTrades: num('maxOpenTrades', base.maxOpenTrades),
    scoreThreshold: num('scoreThreshold', base.scoreThreshold),
    adxMin: isNaN(adxMin ?? 0) ? base.adxMin : adxMin,
    mtfEnabled: bool('mtfEnabled', base.mtfEnabled),
    timeFilterEnabled: bool('timeFilterEnabled', base.timeFilterEnabled),
    timeFilterStart: num('timeFilterStart', base.timeFilterStart),
    timeFilterEnd: num('timeFilterEnd', base.timeFilterEnd),
    defaultInterval: str('defaultInterval', base.defaultInterval),
    candleLimit: num('candleLimit', base.candleLimit),
    monitorInterval: str('monitorInterval', base.monitorInterval),
    maxHoldMinutes: num('maxHoldMinutes', base.maxHoldMinutes),
    // New risk management fields
    enabled: bool('enabled', base.enabled),
    cycleIntervalMs: num('cycleIntervalMs', base.cycleIntervalMs),
    cooldownCandles: num('cooldownCandles', base.cooldownCandles),
    entryStalenessMaxPct: num('entryStalenessMaxPct', base.entryStalenessMaxPct),
    drawdownPausePct: num('drawdownPausePct', base.drawdownPausePct),
    drawdownLookback: num('drawdownLookback', base.drawdownLookback),
    maxDailyTrades: num('maxDailyTrades', base.maxDailyTrades),
  };
}
