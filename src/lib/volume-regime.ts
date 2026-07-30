// ============================================================
// Volume Regime Detection System
// ============================================================
// Detects abnormal volume activity, S/R level breakouts,
// and volume-flow direction to prevent counter-breakout trades.
//
// Core concept (from Bondar/practical tape reading):
//   When volume SPIKES at a key level, the market structure is changing.
//   Don't trade against the volume — it represents real money flow.
// ============================================================

import type { CandleData } from './types';

export type MarketRegime =
  | 'normal'
  | 'volatile'
  | 'breakout_up'
  | 'breakout_down';

export interface VolumeRegimeResult {
  regime: MarketRegime;
  volumeRatio: number;          // Current candle volume / rolling average (e.g. 3.5 = 3.5x)
  priceMomentum: number;        // ROC(1) in % (positive = up)
  volumeFlow: 'up' | 'down' | 'neutral';
  srBreakout: boolean;          // Price just broke through a key S/R level
  brokenLevel: number | null;   // The S/R level that was broken
  brokenType: 'support' | 'resistance' | null;
  confidence: number;           // 0–1
  reason: string;               // Human-readable (for logs)
}

export interface SRLevel {
  price: number;
  type: 'support' | 'resistance';
  strength: number;  // 0–1, how many touches confirmed it
  touches: number;
}

// ============================================================
// 1. Volume Spike Detection
// ============================================================

/**
 * Compare current candle volume to rolling average.
 * Returns ratio (1.0 = normal, 3.0 = 3x average).
 */
export function calcVolumeSpike(candles: CandleData[], lookback: number = 20): number {
  if (candles.length < lookback + 1) return 1;
  const recent = candles.slice(-(lookback + 1), -1);
  const avgVol = recent.reduce((s, c) => s + c.volume, 0) / recent.length;
  if (avgVol === 0) return 1;
  return candles[candles.length - 1].volume / avgVol;
}

// ============================================================
// 2. Volume Flow Direction
// ============================================================

/**
 * Determine the DIRECTION of volume flow over last N candles.
 * Compares buying volume (up candles) vs selling volume (down candles).
 * Returns 'up' if net flow is bullish, 'down' if bearish, 'neutral' if balanced.
 */
export function calcVolumeFlow(
  candles: CandleData[],
  lookback: number = 5,
): { direction: 'up' | 'down' | 'neutral'; strength: number } {
  if (candles.length < lookback + 1) return { direction: 'neutral', strength: 0 };

  const recent = candles.slice(-lookback);
  let buyVol = 0;
  let sellVol = 0;

  for (const c of recent) {
    const body = c.close - c.open;
    if (body > 0) {
      buyVol += c.volume;
    } else if (body < 0) {
      sellVol += c.volume;
    } else {
      // Doji — split 50/50
      buyVol += c.volume * 0.5;
      sellVol += c.volume * 0.5;
    }
  }

  const total = buyVol + sellVol;
  if (total === 0) return { direction: 'neutral', strength: 0 };

  const net = (buyVol - sellVol) / total; // -1 to +1

  if (net > 0.15) return { direction: 'up', strength: Math.min(net * 2.5, 1) };
  if (net < -0.15) return { direction: 'down', strength: Math.min(Math.abs(net) * 2.5, 1) };
  return { direction: 'neutral', strength: Math.abs(net) * 2 };
}

// ============================================================
// 3. Support / Resistance Level Detection
// ============================================================

/**
 * Detect key S/R levels from swing highs and lows.
 * Uses a pivot-based approach: a swing high is a bar where
 * both neighbors are lower, and vice versa for swing lows.
 *
 * Then clusters nearby levels (within 0.5% of each other) to find
 * the most significant zones.
 */
export function detectSRLevels(
  candles: CandleData[],
  pivotLookback: number = 3,
  clusterTolerancePct: number = 0.008,  // 0.8% — levels within this range are "the same"
  maxLevels: number = 6,
): SRLevel[] {
  if (candles.length < pivotLookback * 2 + 5) return [];

  // Step 1: Find swing highs and swing lows
  const swingHighs: number[] = [];
  const swingLows: number[] = [];

  for (let i = pivotLookback; i < candles.length - pivotLookback; i++) {
    let isHigh = true;
    let isLow = true;

    for (let j = 1; j <= pivotLookback; j++) {
      if (candles[i].high <= candles[i - j].high || candles[i].high <= candles[i + j].high) isHigh = false;
      if (candles[i].low >= candles[i - j].low || candles[i].low >= candles[i + j].low) isLow = false;
    }

    if (isHigh) swingHighs.push(candles[i].high);
    if (isLow) swingLows.push(candles[i].low);
  }

  // Step 2: Cluster nearby levels and count touches
  const levels: SRLevel[] = [];

  const clusterAndCount = (pivots: number[], type: 'support' | 'resistance') => {
    // Sort by price
    const sorted = [...pivots].sort((a, b) => a - b);
    const clusters: { price: number; count: number; touches: number }[] = [];

    for (const p of sorted) {
      let matched = false;
      for (const c of clusters) {
        if (Math.abs(p - c.price) / c.price <= clusterTolerancePct) {
          // Weighted average (more touches = more weight)
          c.price = (c.price * c.count + p) / (c.count + 1);
          c.count++;
          c.touches++;
          matched = true;
          break;
        }
      }
      if (!matched) {
        clusters.push({ price: p, count: 1, touches: 1 });
      }
    }

    // Also count how many times price touched (came within tolerance of) each cluster
    const price = candles[candles.length - 1].close;
    for (const c of clusters) {
      for (const candle of candles.slice(-60)) { // last 60 candles
        const touchedHigh = Math.abs(candle.high - c.price) / c.price <= clusterTolerancePct;
        const touchedLow = Math.abs(candle.low - c.price) / c.price <= clusterTolerancePct;
        if (touchedHigh || touchedLow) c.touches++;
      }
      // Cap touches for strength calc
      const strength = Math.min(c.touches / 8, 1);
      // Only include levels that were touched at least 2 times
      if (c.touches >= 2) {
        levels.push({ price: c.price, type, strength, touches: c.touches });
      }
    }
  };

  clusterAndCount(swingHighs, 'resistance');
  clusterAndCount(swingLows, 'support');

  // Sort by strength (most significant first), then by proximity to current price
  const currentPrice = candles[candles.length - 1].close;
  levels.sort((a, b) => {
    // Prefer levels closer to current price (within 5%)
    const distA = Math.abs(a.price - currentPrice) / currentPrice;
    const distB = Math.abs(b.price - currentPrice) / currentPrice;
    if (distA < 0.05 && distB >= 0.05) return -1;
    if (distB < 0.05 && distA >= 0.05) return 1;
    // Then by strength
    return b.strength - a.strength;
  });

  return levels.slice(0, maxLevels);
}

// ============================================================
// 4. Breakout Detection
// ============================================================

/**
 * Check if price just broke through a key S/R level with volume.
 * A "breakout" means:
 *   1. Previous candle was BELOW/ABOVE the level
 *   2. Current candle closed ABOVE/BELOW the level
 *   3. Volume is above average (confirmation)
 */
export function detectBreakout(
  candles: CandleData[],
  srLevels: SRLevel[],
  volumeRatio: number,
  minVolumeConfirm: number = 1.5,  // 1.5x average volume = minimum confirmation
): { breakout: boolean; type: 'up' | 'down'; level: SRLevel | null } {
  if (candles.length < 3) return { breakout: false, type: 'up', level: null };

  const prev = candles[candles.length - 2];
  const curr = candles[candles.length - 1];
  const prevClose = prev.close;
  const currClose = curr.close;
  const currHigh = curr.high;
  const currLow = curr.low;

  // Only check breakouts if volume confirms
  if (volumeRatio < minVolumeConfirm) return { breakout: false, type: 'up', level: null };

  // Check each S/R level
  for (const sr of srLevels) {
    const tolerance = sr.price * 0.002; // 0.2% tolerance

    // UPWARD breakout through resistance
    if (sr.type === 'resistance') {
      if (prevClose <= sr.price + tolerance && currClose > sr.price + tolerance) {
        return { breakout: true, type: 'up', level: sr };
      }
      // Also: wick broke above but close is above = stronger signal
      if (prev.high <= sr.price + tolerance && currHigh > sr.price + tolerance && currClose > sr.price) {
        return { breakout: true, type: 'up', level: sr };
      }
    }

    // DOWNWARD breakout through support
    if (sr.type === 'support') {
      if (prevClose >= sr.price - tolerance && currClose < sr.price - tolerance) {
        return { breakout: true, type: 'down', level: sr };
      }
      if (prev.low >= sr.price - tolerance && currLow < sr.price - tolerance && currClose < sr.price) {
        return { breakout: true, type: 'down', level: sr };
      }
    }
  }

  return { breakout: false, type: 'up', level: null };
}

// ============================================================
// 5. Main Regime Classification
// ============================================================

/**
 * Classify the current market regime based on volume, price action,
 * and S/R levels. This is the main entry point.
 *
 * Thresholds:
 *   - VOL_SPIKE = 2.5x: abnormal volume, market is doing something unusual
 *   - VOL_EXTREME = 4.0x: extreme volume, likely news/catalyst event
 *   - MOMENTUM_THRESHOLD = 1.5%: price moved significantly in one candle
 *
 * Regime logic:
 *   1. If volume extreme (4x+) AND directional momentum → BREAKOUT
 *   2. If volume spike (2.5x+) AND S/R breakout with volume → BREAKOUT  
 *   3. If volume spike (2.5x+) but no clear direction → VOLATILE
 *   4. Otherwise → NORMAL
 */
export function classifyRegime(candles: CandleData[]): VolumeRegimeResult {
  const defaultResult: VolumeRegimeResult = {
    regime: 'normal',
    volumeRatio: 1,
    priceMomentum: 0,
    volumeFlow: 'neutral',
    srBreakout: false,
    brokenLevel: null,
    brokenType: null,
    confidence: 0,
    reason: 'Нормальные условия',
  };

  if (candles.length < 30) return defaultResult;

  // ── Calculate core metrics ──
  const volumeRatio = calcVolumeSpike(candles, 20);
  const { direction: volFlow, strength: volFlowStrength } = calcVolumeFlow(candles, 5);

  // Price momentum (ROC of last candle)
  const prevClose = candles[candles.length - 2].close;
  const currClose = candles[candles.length - 1].close;
  const priceMomentum = ((currClose - prevClose) / prevClose) * 100;

  // Detect S/R levels
  const srLevels = detectSRLevels(candles);

  // Detect breakout
  const { breakout, type: breakoutType, level: breakoutLevel } = detectBreakout(candles, srLevels, volumeRatio);

  // ── Thresholds ──
  const VOL_EXTREME = 4.0;
  const VOL_SPIKE = 2.5;
  const MOMENTUM_STRONG = 2.0;  // 2% move in one candle
  const MOMENTUM_MODERATE = 1.0;

  // ── Classification ──

  // Case 1: EXTREME VOLUME + STRONG DIRECTIONAL MOVE = BREAKOUT
  if (volumeRatio >= VOL_EXTREME && Math.abs(priceMomentum) >= MOMENTUM_STRONG) {
    const isUp = priceMomentum > 0;
    const flowAgrees = (isUp && volFlow === 'up') || (!isUp && volFlow === 'down');
    const confidence = flowAgrees
      ? Math.min(0.6 + volumeRatio * 0.08 + Math.abs(priceMomentum) * 0.1, 1)
      : Math.min(0.3 + volumeRatio * 0.05, 0.7);

    return {
      regime: isUp ? 'breakout_up' : 'breakout_down',
      volumeRatio,
      priceMomentum,
      volumeFlow: volFlow,
      srBreakout: true,
      brokenLevel: null,
      brokenType: null,
      confidence,
      reason: `Экстремальный объём (×${volumeRatio.toFixed(1)}) + ${isUp ? 'памп' : 'дамп'} ${Math.abs(priceMomentum).toFixed(2)}%${flowAgrees ? ', объём подтверждает' : ', объём не подтверждает'}`,
    };
  }

  // Case 2: S/R BREAKOUT with volume confirmation
  if (breakout && volumeRatio >= VOL_SPIKE) {
    const isUp = breakoutType === 'up';
    const confidence = Math.min(0.5 + breakoutLevel!.strength * 0.3 + (volumeRatio - VOL_SPIKE) * 0.1, 1);

    return {
      regime: isUp ? 'breakout_up' : 'breakout_down',
      volumeRatio,
      priceMomentum,
      volumeFlow: volFlow,
      srBreakout: true,
      brokenLevel: breakoutLevel!.price,
      brokenType: isUp ? 'resistance' : 'support',
      confidence,
      reason: `Пробой ${isUp ? 'сопротивления' : 'поддержки'} $${breakoutLevel!.price.toFixed(2)} (объём ×${volumeRatio.toFixed(1)}, ${breakoutLevel!.touches} касаний)`,
    };
  }

  // Case 3: HIGH VOLUME + moderate momentum but no S/R break = VOLATILE
  if (volumeRatio >= VOL_SPIKE && Math.abs(priceMomentum) >= MOMENTUM_MODERATE) {
    const isUp = priceMomentum > 0;
    const confidence = Math.min(0.3 + (volumeRatio - VOL_SPIKE) * 0.15 + volFlowStrength * 0.2, 0.8);

    return {
      regime: 'volatile',
      volumeRatio,
      priceMomentum,
      volumeFlow: volFlow,
      srBreakout: false,
      brokenLevel: null,
      brokenType: null,
      confidence,
      reason: `Повышенная волатильность (объём ×${volumeRatio.toFixed(1)}, движение ${Math.abs(priceMomentum).toFixed(2)}% ${isUp ? 'вверх' : 'вниз'})`,
    };
  }

  // Case 4: Normal conditions
  return {
    regime: 'normal',
    volumeRatio,
    priceMomentum,
    volumeFlow: volFlow,
    srBreakout: false,
    brokenLevel: null,
    brokenType: null,
    confidence: 0,
    reason: 'Нормальные условия',
  };
}

// ============================================================
// 6. Trade Filter — the main integration point
// ============================================================

/**
 * Should we BLOCK this trade based on volume regime?
 *
 * Returns { blocked: boolean, reason: string, positionSizeMultiplier: number }
 *
 * Blocking rules:
 *   1. BREAKOUT_UP + SHORT signal → BLOCK (don't short a breakout)
 *   2. BREAKOUT_DOWN + LONG signal → BLOCK (don't long a breakdown)
 *   3. VOLATILE regime → reduce position size to 50%
 *
 * Boosting rules:
 *   4. Volume spike CONFIRMS signal direction → boost score by 20%
 */
export function volumeRegimeFilter(
  regime: VolumeRegimeResult,
  tradeDirection: 'long' | 'short',
): {
  blocked: boolean;
  reason: string;
  positionSizeMultiplier: number;
  scoreMultiplier: number;
} {
  // RULE 1: Don't trade against a confirmed breakout
  if (regime.regime === 'breakout_up' && tradeDirection === 'short') {
    return {
      blocked: true,
      reason: `⛔ VOLUME BREAKOUT UP (объём ×${regime.volumeRatio.toFixed(1)}, +${regime.priceMomentum.toFixed(2)}%). Шорт запрещён.`,
      positionSizeMultiplier: 0,
      scoreMultiplier: 0,
    };
  }

  if (regime.regime === 'breakout_down' && tradeDirection === 'long') {
    return {
      blocked: true,
      reason: `⛔ VOLUME BREAKDOWN (объём ×${regime.volumeRatio.toFixed(1)}, ${regime.priceMomentum.toFixed(2)}%). Лонг запрещён.`,
      positionSizeMultiplier: 0,
      scoreMultiplier: 0,
    };
  }

  // RULE 2: Volatile regime → reduce position size
  if (regime.regime === 'volatile') {
    // If trading WITH the volume flow → less reduction
    const withFlow =
      (tradeDirection === 'long' && regime.volumeFlow === 'up') ||
      (tradeDirection === 'short' && regime.volumeFlow === 'down');

    if (withFlow) {
      return {
        blocked: false,
        reason: `⚡ Волатильность (объём ×${regime.volumeRatio.toFixed(1)}), но направление совпадает. Размер ×0.7`,
        positionSizeMultiplier: 0.7,
        scoreMultiplier: 0.9,
      };
    }

    // Trading against volume flow in volatile market → more cautious
    return {
      blocked: false,
      reason: `⚡ Волатильность (объём ×${regime.volumeRatio.toFixed(1)}), объём против позиции. Размер ×0.4`,
      positionSizeMultiplier: 0.4,
      scoreMultiplier: 0.7,
    };
  }

  // RULE 3: Normal regime but volume spike confirms direction → boost
  if (regime.regime === 'normal' && regime.volumeRatio >= 1.8) {
    const flowAgrees =
      (tradeDirection === 'long' && regime.volumeFlow === 'up') ||
      (tradeDirection === 'short' && regime.volumeFlow === 'down');

    if (flowAgrees) {
      return {
        blocked: false,
        reason: `📊 Объём подтверждает направление (×${regime.volumeRatio.toFixed(1)})`,
        positionSizeMultiplier: 1.15,
        scoreMultiplier: 1.1,
      };
    }

    // Volume is elevated but against our direction → slight reduction
    if (regime.volumeRatio >= 2.0) {
      return {
        blocked: false,
        reason: `⚠️ Повышенный объём против позиции (×${regime.volumeRatio.toFixed(1)})`,
        positionSizeMultiplier: 0.8,
        scoreMultiplier: 0.85,
      };
    }
  }

  // RULE 4: Normal — no filter
  return {
    blocked: false,
    reason: '',
    positionSizeMultiplier: 1.0,
    scoreMultiplier: 1.0,
  };
}

// ============================================================
// 7. BTC Market-Wide Volume Regime
// ============================================================

// Cache BTC regime to avoid re-fetching on every symbol check
let _btcRegimeCache: { result: VolumeRegimeResult; ts: number; candles: CandleData[] } | null = null;
const BTC_REGIME_TTL_MS = 60_000; // 1 minute cache

/**
 * Get the market-wide volume regime from BTC.
 * BTC is the market driver — if BTC has a volume spike,
 * all alts will follow regardless of their own indicators.
 */
export async function getBTCVolumeRegime(): Promise<VolumeRegimeResult> {
  // Return cache if fresh
  if (_btcRegimeCache && Date.now() - _btcRegimeCache.ts < BTC_REGIME_TTL_MS) {
    return _btcRegimeCache.result;
  }

  try {
    const res = await fetch('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=100');
    if (!res.ok) throw new Error('BTC fetch failed');
    const data = await res.json();
    const candles: CandleData[] = data.map((k: (string | number)[]) => ({
      time: Math.floor(Number(k[0]) / 1000),
      open: parseFloat(String(k[1])),
      high: parseFloat(String(k[2])),
      low: parseFloat(String(k[3])),
      close: parseFloat(String(k[4])),
      volume: parseFloat(String(k[5])),
    }));

    const result = classifyRegime(candles);
    _btcRegimeCache = { result, ts: Date.now(), candles };
    return result;
  } catch (err) {
    // On failure, return neutral regime (don't block trades)
    console.warn('[VolumeRegime] BTC regime fetch failed:', err);
    return {
      regime: 'normal', volumeRatio: 1, priceMomentum: 0,
      volumeFlow: 'neutral', srBreakout: false, brokenLevel: null,
      brokenType: null, confidence: 0, reason: 'BTC data unavailable',
    };
  }
}

/**
 * Combined filter: check both local (symbol) and global (BTC) volume regimes.
 * BTC regime acts as an override — if BTC is breaking out, it takes priority.
 */
export function combinedVolumeFilter(
  localRegime: VolumeRegimeResult,
  btcRegime: VolumeRegimeResult,
  tradeDirection: 'long' | 'short',
): {
  blocked: boolean;
  reason: string;
  positionSizeMultiplier: number;
  scoreMultiplier: number;
} {
  // Check BTC regime first (market-wide)
  const btcFilter = volumeRegimeFilter(btcRegime, tradeDirection);

  // BTC breakout is the strongest signal — if BTC is breaking out, don't trade against it
  if (btcFilter.blocked && (btcRegime.regime === 'breakout_up' || btcRegime.regime === 'breakout_down')) {
    return {
      ...btcFilter,
      reason: `🟠 BTC: ${btcRegime.reason}`,
    };
  }

  // Check local regime
  const localFilter = volumeRegimeFilter(localRegime, tradeDirection);

  if (localFilter.blocked) {
    return localFilter;
  }

  // Combine multipliers (take the more conservative one)
  const posMult = Math.min(btcFilter.positionSizeMultiplier, localFilter.positionSizeMultiplier);
  const scoreMult = Math.min(btcFilter.scoreMultiplier, localFilter.scoreMultiplier);

  // Build reason string
  const reasons: string[] = [];
  if (btcFilter.reason) reasons.push(`BTC: ${btcFilter.reason}`);
  if (localFilter.reason) reasons.push(localFilter.reason);

  return {
    blocked: false,
    reason: reasons.join(' | '),
    positionSizeMultiplier: posMult,
    scoreMultiplier: scoreMult,
  };
}
