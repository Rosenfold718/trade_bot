import type { CandleData, TradingDecision, Trade } from './types';
import { TOP_50_SYMBOLS } from './types';
import { makeStrategyDecision } from './trading-engine';
import { type StrategyConfig, getStrategy } from './strategies';
import { fetchSettings, getEffectiveStrategy, getSys } from './settings-cache';
import { refreshBTCCorrelation, checkBTCCorrelationAlignment, getBTCRegime } from './btc-correlation';
import { classifyRegime, getBTCVolumeRegime, combinedVolumeFilter, volumeRegimeFilter, type VolumeRegimeResult } from './volume-regime';

// ============================================================
// Client-side Binance data fetching (CORS works from browser)
// ============================================================

export async function fetchCandlesClient(symbol: string, interval: string = '1h', limit: number = 1440): Promise<CandleData[]> {
  const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
  if (!res.ok) throw new Error(`Failed to fetch klines for ${symbol}`);
  const raw = await res.json();
  if (!Array.isArray(raw) || raw.length === 0) return [];
  return raw.map((k: (string | number)[]) => ({
    time: Math.floor(Number(k[0]) / 1000),
    open: parseFloat(String(k[1])),
    high: parseFloat(String(k[2])),
    low: parseFloat(String(k[3])),
    close: parseFloat(String(k[4])),
    volume: parseFloat(String(k[5])),
  }));
}

export async function fetchCurrentPrice(symbol: string): Promise<number> {
  const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`);
  if (!res.ok) throw new Error(`Failed to fetch price for ${symbol}`);
  const data = await res.json();
  return parseFloat(data.price);
}

export async function fetchTopSymbolsClient(): Promise<string[]> {
  const res = await fetch('https://api.binance.com/api/v3/ticker/24hr');
  if (!res.ok) return [];
  const data = await res.json();
  return data
    .filter((t: { symbol: string; quoteVolume: string }) => t.symbol.endsWith('USDT') && Number(t.quoteVolume) > 0)
    .sort((a: { quoteVolume: string }, b: { quoteVolume: string }) => Number(b.quoteVolume) - Number(a.quoteVolume))
    .slice(0, 50)
    .map((t: { symbol: string }) => t.symbol);
}

// ============================================================
// Client-side analysis
// ============================================================

export async function analyzeSymbol(
  symbol: string,
  interval: string,
  limit: number,
  strategyId: string = 'momentum',
  strategyOverride?: StrategyConfig,
): Promise<TradingDecision | null> {
  const candles = await fetchCandlesClient(symbol, interval, limit);
  if (candles.length < 50) return null;
  const decision = makeStrategyDecision(strategyId, symbol, candles, 30, strategyOverride);
  return decision;
}

// ============================================================
// Client-side auto-trade: find best signal
// ============================================================

export interface SignalDiagnostics {
  checked: number;
  none: number;
  mtfRejected: number;
  volFiltered: number;
  btcFiltered: number;
  cooldowns: number;
  entryRejected: number; // перегретые точки входа
  bestSymbol: string | null;
  bestScore: number;
  dailyLimitHit: boolean;
  dailyTradeCount: number;
}

// ── Entry Quality: reject overextended entries, prefer pullbacks ──
function assessEntryQuality(
  candles: CandleData[],
  direction: 'long' | 'short',
  strategyId: string,
): { pass: boolean; scoreMultiplier: number; reason: string } {
  const len = candles.length;
  if (len < 50) return { pass: true, scoreMultiplier: 1.0, reason: '' };

  const price = candles[len - 1].close;
  const closes = candles.map(c => c.close);

  // ── 1. Calculate EMA20 and ATR(14) ──
  const ema20 = calcEMA50(closes, 20);
  if (isNaN(ema20)) return { pass: true, scoreMultiplier: 1.0, reason: '' };

  // ATR(14)
  let atrSum = 0;
  const atrPeriod = Math.min(14, len - 1);
  for (let i = len - 1 - atrPeriod; i < len; i++) {
    if (i < 1) continue;
    const tr = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close),
    );
    atrSum += tr;
  }
  const atr = atrSum / atrPeriod;
  if (atr <= 0) return { pass: true, scoreMultiplier: 1.0, reason: '' };

  // ── 2. Distance from EMA in ATR units ──
  const emaDist = (price - ema20) / atr; // positive = above EMA, negative = below
  const isLong = direction === 'long';
  const extension = isLong ? emaDist : -emaDist; // how far price is in the trade direction

  // ── 3. Consecutive directional candles (last 3) ──
  let consecutive = 0;
  for (let i = len - 1; i >= Math.max(0, len - 5); i--) {
    const bullish = candles[i].close > candles[i].open;
    if ((isLong && bullish) || (!isLong && !bullish)) {
      consecutive++;
    } else {
      break;
    }
  }

  // ── 4. RSI(14) ──
  let rsi = 50; // default neutral
  const rsiPeriod = 14;
  if (len > rsiPeriod + 1) {
    let gains = 0, losses = 0;
    for (let i = len - rsiPeriod; i < len; i++) {
      const change = closes[i] - closes[i - 1];
      if (change > 0) gains += change; else losses -= change;
    }
    const avgGain = gains / rsiPeriod;
    const avgLoss = losses / rsiPeriod;
    if (avgLoss > 0) {
      const rs = avgGain / avgLoss;
      rsi = 100 - 100 / (1 + rs);
    } else if (avgGain > 0) {
      rsi = 100;
    }
  }

  // ── 5. Last 3 candles range (momentum spike) ──
  const last3Range = len >= 3
    ? Math.abs(closes[len - 1] - closes[len - 4]) / atr
    : 0;

  // ── DECISION ──
  // Strategy-specific thresholds (scalper is more lenient with entry quality)
  const isScalper = strategyId === 'scalper';
  const hardLimit = isScalper ? 3.5 : 3.0;   // ATR units — hard reject
  const softLimit = isScalper ? 2.5 : 2.0;   // ATR units — heavy penalty
  const pullbackZone = 1.0;                    // ATR units — ideal entry zone

  // HARD REJECT: price is way too far from EMA (chasing the move)
  if (extension > hardLimit) {
    return {
      pass: false,
      scoreMultiplier: 0,
      reason: `перегрет: ${extension.toFixed(1)}×ATR от EMA20`,
    };
  }

  // HARD REJECT: 4+ consecutive candles in trade direction (exhaustion likely)
  if (consecutive >= 4 && extension > 1.5) {
    return {
      pass: false,
      scoreMultiplier: 0,
      reason: `${consecutive} свечей подряд + ${extension.toFixed(1)}×ATR`,
    };
  }

  // HARD REJECT: RSI exhaustion
  if (isLong && rsi > 78) {
    return { pass: false, scoreMultiplier: 0, reason: `RSI ${rsi.toFixed(0)} (перекупленность)` };
  }
  if (!isLong && rsi < 22) {
    return { pass: false, scoreMultiplier: 0, reason: `RSI ${rsi.toFixed(0)} (перепроданность)` };
  }

  // Calculate score multiplier
  let multiplier = 1.0;
  let reasons: string[] = [];

  // PENALTY: somewhat extended (2-3 ATR from EMA)
  if (extension > softLimit) {
    multiplier *= 0.5;
    reasons.push(`${extension.toFixed(1)}×ATR от EMA`);
  } else if (extension > pullbackZone) {
    multiplier *= 0.75;
    reasons.push(`${extension.toFixed(1)}×ATR от EMA`);
  }

  // PENALTY: 3 consecutive candles
  if (consecutive >= 3 && extension > 1.0) {
    multiplier *= 0.7;
    reasons.push(`${consecutive} свечей подряд`);
  }

  // PENALTY: large recent range (momentum spike)
  if (last3Range > 3.0) {
    multiplier *= 0.6;
    reasons.push(`резкий рывок ${last3Range.toFixed(1)}×ATR`);
  } else if (last3Range > 2.0) {
    multiplier *= 0.8;
    reasons.push(`рывок ${last3Range.toFixed(1)}×ATR`);
  }

  // BONUS: pullback entry — price near or slightly below/above EMA in trade direction
  if (extension < pullbackZone && extension > -0.5) {
    multiplier *= 1.15;
    reasons.push('откат к EMA20');
  }

  // BONUS: RSI shows room (40-60 is ideal for entry)
  if (isLong && rsi >= 40 && rsi <= 60) {
    multiplier *= 1.05;
  } else if (!isLong && rsi >= 40 && rsi <= 60) {
    multiplier *= 1.05;
  }

  return {
    pass: multiplier >= 0.3,
    scoreMultiplier: multiplier,
    reason: reasons.length > 0 ? reasons.join(', ') : '',
  };
}

export async function findBestSignal(
  openTradeSymbols: Set<string>,
  strategyId: string = 'momentum',
  interval: string = '1h',
  limit: number = 1440,
  strategyOverride?: StrategyConfig,
  sysSettings?: Record<string, string>,
  cooldownSymbols?: Map<string, number>,  // symbol → timestamp when cooldown expires
): Promise<{ decision: TradingDecision; price: number; symbol: string } | null> {
  const strategy = strategyOverride ?? getStrategy(strategyId);
  if (!strategy) return null;

  const effectiveInterval = interval;
  const effectiveLimit = limit;

  const symbols = TOP_50_SYMBOLS;
  const now = Date.now();
  const cooldownCount = [...(cooldownSymbols?.values() ?? [])].filter(t => t > now).length;
  const available = symbols.filter(s => {
    if (openTradeSymbols.has(s)) return false;
    // ── COOLDOWN FILTER: skip symbols recently stopped out ──
    if (cooldownSymbols) {
      const cooldownUntil = cooldownSymbols.get(s);
      if (cooldownUntil && now < cooldownUntil) return false;
    }
    return true;
  });

  // System setting: how many symbols to scan (or per-strategy override)
  const scanLimit = strategyId === 'scalper' ? 30 : 20;

  // ── DAILY TRADE LIMIT ──
  let todayTrades = 0;
  if (strategy.maxDailyTrades > 0 && typeof window !== 'undefined') {
    const storageKey = `dailyTrades_${strategyId}_${new Date().toISOString().slice(0, 10)}`;
    todayTrades = parseInt(sessionStorage.getItem(storageKey) || '0', 10);
    if (todayTrades >= strategy.maxDailyTrades) {
      console.log(`[findBestSignal][${strategyId}] Daily limit reached: ${todayTrades}/${strategy.maxDailyTrades}`);
      return null;
    }
  }
  // Sort by volume rank (top symbols first), then shuffle within tiers
  const topSymbols = available.slice(0, 10); // Top 10 by volume - highest priority
  const midSymbols = available.slice(10, 25); // Next 15
  const restSymbols = available.slice(25);    // Rest
  const shuffle = (arr: string[]) => arr.sort(() => Math.random() - 0.5);
  const checkSymbols = [...shuffle(topSymbols), ...shuffle(midSymbols), ...shuffle(restSymbols)].slice(0, scanLimit);

  if (strategy.timeFilterEnabled) {
    const mskHour = new Date().toLocaleTimeString('en-US', { timeZone: 'Europe/Moscow', hour: 'numeric', hour12: false }).padStart(2, '0');
    const hour = parseInt(mskHour, 10);
    if (hour < strategy.timeFilterStart || hour > strategy.timeFilterEnd) {
      console.log(`[findBestSignal][${strategyId}] Skipped: outside trading hours (${hour}h, allowed ${strategy.timeFilterStart}-${strategy.timeFilterEnd})`);
      return null;
    }
  }

  let best: { decision: TradingDecision; price: number; symbol: string } | null = null;
  let bestScore = 0;
  let noneCount = 0;
  let mtfRejected = 0;
  let btcFiltered = 0;
  let entryRejected = 0;

  // ── BTC Regime Pre-check ──
  // Refresh BTC correlation data (cached, only fetches if stale)
  let btcAlignmentChecked = false;
  try {
    await refreshBTCCorrelation();
    const btcRegime = getBTCRegime();
    btcAlignmentChecked = btcRegime.direction !== 'neutral';
    if (btcAlignmentChecked) {
      console.log(`[findBestSignal][${strategyId}] BTC regime: ${btcRegime.direction} (strength=${btcRegime.strength.toFixed(2)}, change=${btcRegime.priceChangePct.toFixed(2)}%)`);
    }
  } catch (err) {
    console.warn('[findBestSignal] BTC correlation refresh failed:', err);
  }

  // ── BTC Volume Regime (breakout detection) ──
  let btcVolRegime: VolumeRegimeResult | null = null;
  try {
    btcVolRegime = await getBTCVolumeRegime();
    if (btcVolRegime.regime !== 'normal') {
      console.log(`[findBestSignal][${strategyId}] ⚠️ BTC Volume Regime: ${btcVolRegime.regime} (vol×${btcVolRegime.volumeRatio.toFixed(1)}, ${btcVolRegime.reason})`);
    }
  } catch {
    /* non-critical */
  }

  let volumeFiltered = 0;

  // System setting: volume boost multiplier (default 1.2)
  const volBoost = sysSettings
    ? Number(getSys(sysSettings, 'system.volumeBoost', 1.2))
    : 1.2;
  const volBoostMultiplier = 1.0 + (volBoost - 1.0); // e.g. 1.2 → boost by 20%
  const volBoostThreshold = 1.0 + (volBoost - 1.0); // same as multiplier for comparison

  for (const sym of checkSymbols) {
    try {
      const candles = await fetchCandlesClient(sym, effectiveInterval, effectiveLimit);
      if (candles.length < 50) continue;
      const decision = makeStrategyDecision(strategyId, sym, candles, 0, strategyOverride);
      if (decision.direction === 'none') { noneCount++; continue; }

      const avgVol = candles.slice(-20).reduce((s, c) => s + c.volume, 0) / Math.min(20, candles.length);
      const currentVol = candles[candles.length - 1].volume;
      if (avgVol > 0 && currentVol > avgVol * volBoostThreshold) {
        decision.score *= volBoostMultiplier;
      }

      if (strategy.mtfEnabled) {
        try {
          const mtfInterval = effectiveInterval === '1m' || effectiveInterval === '5m' ? '1h'
            : effectiveInterval === '15m' ? '4h'
            : '1d';
          const mtfCandles = await fetchCandlesClient(sym, mtfInterval, 200);
          if (mtfCandles.length >= 50) {
            const ema50 = calcEMA50(mtfCandles.map(c => c.close), 50);
            const mtfPrice = mtfCandles[mtfCandles.length - 1].close;
            if (!isNaN(ema50)) {
              const h4Bullish = mtfPrice > ema50;
              if (decision.direction === 'long' && !h4Bullish) { mtfRejected++; continue; }
              if (decision.direction === 'short' && h4Bullish) { mtfRejected++; continue; }
            }
          }
        } catch { /* MTF fetch failed — allow trade without MTF filter */ }
      }

      // ── COOLDOWN CHECK (redundant safety, also filtered above) ──
      if (cooldownSymbols) {
        const cooldownUntil = cooldownSymbols.get(sym);
        if (cooldownUntil && now < cooldownUntil) {
          console.log(`[findBestSignal][${strategyId}] Cooldown active for ${sym} (expires in ${Math.round((cooldownUntil - now) / 60000)}min)`);
          continue;
        }
      }

      // ── VOLUME REGIME FILTER (S/R breakout + volume spike detection) ──
      // This prevents counter-breakout trades — e.g. don't SHORT when
      // the market is having a volume-driven pump through resistance.
      try {
        const localRegime = classifyRegime(candles);
        if (localRegime.regime !== 'normal') {
          const tradeDir = decision.direction as 'long' | 'short';
          const volFilter = btcVolRegime
            ? combinedVolumeFilter(localRegime, btcVolRegime, tradeDir)
            : volumeRegimeFilter(localRegime, tradeDir);

          if (volFilter.blocked) {
            volumeFiltered++;
            console.log(`[findBestSignal] Volume filter: BLOCK ${sym} ${decision.direction} — ${volFilter.reason}`);
            continue;
          }

          // Apply multipliers even if not blocked
          if (volFilter.scoreMultiplier !== 1.0) {
            decision.score *= volFilter.scoreMultiplier;
          }

          // Store position size multiplier on the decision for later use
          if (volFilter.positionSizeMultiplier !== 1.0) {
            (decision as any)._volPositionMult = volFilter.positionSizeMultiplier;
            (decision as any)._volReason = volFilter.reason;
          }
        }
      } catch {
        /* volume regime failed — allow trade without filter */
      }

      // ── ENTRY QUALITY FILTER ──
      // Reject overextended entries (chasing highs/lows), prefer pullbacks to EMA.
      // This prevents buying the top or selling the bottom of a move.
      try {
        const entryQ = assessEntryQuality(candles, decision.direction as 'long' | 'short', strategyId);
        if (!entryQ.pass) {
          entryRejected++;
          console.log(`[findBestSignal] Вход отклонён: ${sym} ${decision.direction} — ${entryQ.reason}`);
          continue;
        }
        if (entryQ.scoreMultiplier !== 1.0) {
          decision.score *= entryQ.scoreMultiplier;
          if (entryQ.reason) {
            (decision as any)._entryReason = entryQ.reason;
          }
        }
      } catch {
        /* entry quality failed — allow trade without filter */
      }

      // ── BTC Correlation Filter ──
      if (btcAlignmentChecked) {
        const btcCheck = checkBTCCorrelationAlignment(sym, decision.direction as 'long' | 'short');
        if (btcCheck.aligned === 'conflicting' && btcCheck.boost < 0.85) {
          btcFiltered++;
          console.log(`[findBestSignal] BTC filter: SKIP ${sym} ${decision.direction} — ${btcCheck.reason}`);
          continue;
        }
        if (btcCheck.boost !== 1.0) {
          decision.score *= btcCheck.boost;
        }
      }

      if (Math.abs(decision.score) > bestScore) {
        bestScore = Math.abs(decision.score);
        best = { decision, price: candles[candles.length - 1].close, symbol: sym };
      }
    } catch { continue; }
  }

  const diag: SignalDiagnostics = {
    checked: checkSymbols.length,
    none: noneCount,
    mtfRejected,
    volFiltered: volumeFiltered,
    btcFiltered,
    cooldowns: cooldownCount,
    entryRejected,
    bestSymbol: best?.symbol ?? null,
    bestScore: bestScore,
    dailyLimitHit: false,
    dailyTradeCount: todayTrades,
  };

  console.log(`[findBestSignal][${strategyId}] ${diag.checked} проверено, нет сигнала=${diag.none}, MTF=${diag.mtfRejected}, объём=${diag.volFiltered}, вход=${diag.entryRejected}, BTC=${diag.btcFiltered}, лучший=${diag.bestSymbol ?? '—'} (${diag.bestScore.toFixed(2)})`);

  return best ? { ...best, _diag: diag as any } : null;
}

function calcEMA50(data: number[], period: number): number {
  if (data.length < period) return NaN;
  const k = 2 / (period + 1);
  let ema = data.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < data.length; i++) { ema = data[i] * k + ema * (1 - k); }
  return ema;
}

// ============================================================
// Client-side TP/SL monitoring
// Uses LAST COMPLETED candle close — aligned with strategy's monitor interval
// ============================================================

export interface MonitorResult {
  closedTrades: Array<{ tradeId: string; symbol: string; direction: string; pnl: number; reason: string; exitPrice: number }>; // full closes
  trailingUpdates: Array<{ tradeId: string; newStopLoss: number; reason: string }>;
  tpRepairs: Array<{ tradeId: string; newTakeProfit: number; reason: string }>;
  // v2: partial TP closes (TP1, TP2) — trade stays open with reduced amount
  partialCloses: Array<{
    tradeId: string; symbol: string;
    closedAmount: number; pnl: number; reason: string; exitPrice: number;
    newRemainingAmount: number; newPartialState: string;
    newStopLoss?: number;
  }>;
}

interface CandleOHLC {
  close: number;
  high: number;
  low: number;
  time: number;
}

/**
 * Fetch the last 2 candles from Binance:
 *   [0] = last COMPLETED candle (closed and confirmed)
 *   [1] = current IN-PROGRESS candle (still forming)
 * We check BOTH for TP/SL hits — the current candle is crucial
 * because a wick may have pierced the level even though the candle
 * hasn't closed yet. Using only the completed candle's close caused
 * the "TP not triggering" bug: candles visibly broke through the TP
 * on the chart but the monitor only checked the close of the PREVIOUS
 * completed candle, missing all in-progress price action.
 */
async function fetchCandlesForMonitor(symbol: string, interval: string = '1h'): Promise<{ completed: CandleOHLC; current: CandleOHLC }> {
  const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=2`);
  if (!res.ok) throw new Error(`Failed to fetch klines for ${symbol}`);
  const data = await res.json();
  if (!Array.isArray(data) || data.length < 1) throw new Error('No kline data');

  const parseCandle = (k: (string | number)[]) => ({
    time: Math.floor(Number(k[0]) / 1000),
    open: parseFloat(String(k[1])),
    high: parseFloat(String(k[2])),
    low: parseFloat(String(k[3])),
    close: parseFloat(String(k[4])),
  });

  const completed = parseCandle(data[0]);
  // If only 1 candle returned, use it for both (edge case)
  const current = data.length >= 2 ? parseCandle(data[1]) : completed;
  return { completed, current };
}

// Get a "candle slot" number based on the interval for throttling checks
function getCurrentCandleSlot(interval: string): number {
  const now = Date.now();
  const msMap: Record<string, number> = { '1m': 60000, '5m': 300000, '15m': 900000, '1h': 3600000, '4h': 14400000, '1d': 86400000 };
  const ms = msMap[interval] ?? 3600000;
  return Math.floor(now / ms);
}

export async function monitorTradesClient(
  openTrades: Trade[],
  lastCandleSlot: number,
  monitorInterval: string = '1h',
  maxHoldMinutes: number = 720,
  sysSettings?: Record<string, string>,
): Promise<MonitorResult> {
  const closedTrades: MonitorResult['closedTrades'] = [];
  const trailingUpdates: MonitorResult['trailingUpdates'] = [];
  const tpRepairs: MonitorResult['tpRepairs'] = [];
  const partialCloses: MonitorResult['partialCloses'] = [];
  const currentSlot = getCurrentCandleSlot(monitorInterval);

  // System settings for auto-repair caps (defaults: SL 8%, TP 15%)
  const slCapPct = sysSettings ? Number(getSys(sysSettings, 'system.maxSLCapDistance', 8)) / 100 : 0.08;
  const tpCapPct = sysSettings ? Number(getSys(sysSettings, 'system.maxTPCapDistance', 15)) / 100 : 0.15;

  // System settings for trailing stop toggles
  const trailing1x = sysSettings ? getSys(sysSettings, 'system.trailing1x', true) : true;
  const trailing2x = sysSettings ? getSys(sysSettings, 'system.trailing2x', true) : true;
  const trailing3x = sysSettings ? getSys(sysSettings, 'system.trailing3x', true) : true;

  // v2: Partial TP enabled (default: on)
  const partialTPEnabled = sysSettings ? getSys(sysSettings, 'system.partialTP', true) : true;
  // v2: Smart Abort enabled (default: on)
  const smartAbortEnabled = sysSettings ? getSys(sysSettings, 'system.smartAbort', true) : true;

  if (currentSlot <= lastCandleSlot) {
    return { closedTrades, trailingUpdates, tpRepairs, partialCloses };
  }

  for (const trade of openTrades) {
    try {
      const { completed, current } = await fetchCandlesForMonitor(trade.symbol, monitorInterval);
      let shouldClose = false;
      let reason = '';
      let exitPrice = 0;

      const livePrice = current.close;
      const isLong = trade.direction === 'long';
      const effectiveAmount = trade.remaining_amount ?? trade.amount;

      // ── AUTO-REPAIR: Fix inverted or excessive SL/TP ──
      let repairedTP = false;
      let repairedSL = false;
      if (trade.stop_loss && trade.take_profit && trade.entry_price) {
        const slBad = isLong ? trade.stop_loss >= trade.entry_price : trade.stop_loss <= trade.entry_price;
        const tpBad = isLong ? trade.take_profit <= trade.entry_price : trade.take_profit >= trade.entry_price;
        if (slBad || tpBad) {
          console.warn(`[monitorClient] Auto-repairing inverted SL/TP for ${trade.id}`);
          if (slBad) {
            const fixedSL = isLong ? trade.entry_price * (1 - slCapPct) : trade.entry_price * (1 + slCapPct);
            trailingUpdates.push({ tradeId: trade.id, newStopLoss: fixedSL, reason: 'Auto-repair: inverted SL' });
            repairedSL = true;
          }
          if (tpBad) {
            const fixedTP = isLong ? trade.entry_price * (1 + tpCapPct) : trade.entry_price * (1 - tpCapPct);
            tpRepairs.push({ tradeId: trade.id, newTakeProfit: fixedTP, reason: 'Auto-repair: inverted TP' });
            repairedTP = true;
          }
        }
        if (!repairedSL && trade.stop_loss) {
          const slDist = Math.abs(trade.stop_loss - trade.entry_price) / trade.entry_price;
          if (slDist > slCapPct) {
            const cappedSL = isLong ? trade.entry_price * (1 - slCapPct) : trade.entry_price * (1 + slCapPct);
            trailingUpdates.push({ tradeId: trade.id, newStopLoss: cappedSL, reason: `Auto-repair: excessive SL` });
          }
        }
        if (!repairedTP && trade.take_profit) {
          const tpDist = Math.abs(trade.take_profit - trade.entry_price) / trade.entry_price;
          if (tpDist > tpCapPct) {
            const cappedTP = isLong ? trade.entry_price * (1 + tpCapPct) : trade.entry_price * (1 - tpCapPct);
            tpRepairs.push({ tradeId: trade.id, newTakeProfit: cappedTP, reason: `Auto-repair: excessive TP` });
          }
        }
      }

      // The SL distance (proxy for 1R, ~ATR × mult)
      const initialSlDistance = trade.stop_loss && trade.entry_price
        ? Math.abs(trade.entry_price - trade.stop_loss) : 0;
      const favorableMove = isLong ? livePrice - trade.entry_price : trade.entry_price - livePrice;
      const partialState = trade.partial_state ?? 'full';

      // ════════════════════════════════════════════════════════════
      // v2: PARTIAL TP — TP1 (1R, close 50%) and TP2 (1.5R, close 50% of remaining)
      // Only if trade hasn't been partially closed yet (or at the next level)
      // ════════════════════════════════════════════════════════════
      let skipMainTP = false; // Don't also full-close by main TP if partial TP fired
      if (partialTPEnabled && initialSlDistance > 0 && trade.entry_price) {
        const tp1Price = isLong ? trade.entry_price + initialSlDistance : trade.entry_price - initialSlDistance;
        const tp2Price = isLong ? trade.entry_price + initialSlDistance * 1.5 : trade.entry_price - initialSlDistance * 1.5;
        // Check on both completed and current candle high/low
        const priceReachedTP1 = isLong
          ? (completed.high >= tp1Price || current.high >= tp1Price)
          : (completed.low <= tp1Price || current.low <= tp1Price);
        const priceReachedTP2 = isLong
          ? (completed.high >= tp2Price || current.high >= tp2Price)
          : (completed.low <= tp2Price || current.low <= tp2Price);

        // TP1: close 50% of remaining, move SL to breakeven
        if (partialState === 'full' && priceReachedTP1) {
          const closeAmt = effectiveAmount * 0.5;
          const newRemaining = effectiveAmount - closeAmt;
          const priceChange = isLong ? (tp1Price - trade.entry_price) / trade.entry_price : (trade.entry_price - tp1Price) / trade.entry_price;
          const pnl = closeAmt * priceChange * trade.leverage - closeAmt * 0.001 - (closeAmt / trade.leverage) * 0.001;
          const beSL = isLong ? trade.entry_price * 1.001 : trade.entry_price * 0.999;
          partialCloses.push({
            tradeId: trade.id, symbol: trade.symbol,
            closedAmount: closeAmt, pnl, reason: 'TP1 (1R)', exitPrice: tp1Price,
            newRemainingAmount: newRemaining, newPartialState: 'tp1_hit', newStopLoss: beSL,
          });
          skipMainTP = true; // Don't also full-close by main TP
          // DO NOT continue — still check SL, time exit, and trailing below
        }

        // TP2: close 50% of remaining (= 25% of original), trailing for the rest
        if (partialState === 'tp1_hit' && priceReachedTP2) {
          const closeAmt = effectiveAmount * 0.5;
          const newRemaining = effectiveAmount - closeAmt;
          const priceChange = isLong ? (tp2Price - trade.entry_price) / trade.entry_price : (trade.entry_price - tp2Price) / trade.entry_price;
          const pnl = closeAmt * priceChange * trade.leverage - closeAmt * 0.001 - (closeAmt / trade.leverage) * 0.001;
          partialCloses.push({
            tradeId: trade.id, symbol: trade.symbol,
            closedAmount: closeAmt, pnl, reason: 'TP2 (1.5R)', exitPrice: tp2Price,
            newRemainingAmount: newRemaining, newPartialState: 'tp2_hit',
          });
          skipMainTP = true;
          // DO NOT continue — still check SL, time exit, and trailing below
        }
      }

      // ════════════════════════════════════════════════════════════
      // v3: SMART ABORT — much more relaxed
      // Only for 1h+ TF strategies (NOT for 15m Pattern Pro — patterns need time)
      // 6h: deep underwater (< -1.5R) → cut loss
      // Only for trades that haven't hit TP1 yet (partialState === 'full')
      // ════════════════════════════════════════════════════════════
      const openMs = Date.now() - new Date(trade.opened_at).getTime();
      const openMinutes = openMs / 60000;

      // Determine if this strategy's TF is short-term (15m or less) — skip Smart Abort
      const isShortTermTF = monitorInterval === '15m' || monitorInterval === '5m' || monitorInterval === '1m';

      if (smartAbortEnabled && !isShortTermTF && partialState === 'full' && initialSlDistance > 0) {
        // 6h check: deep underwater (unfavorable move > 1.5× SL distance)
        if (openMinutes >= 360 && favorableMove < -initialSlDistance * 1.5) {
          shouldClose = true;
          reason = `SmartAbort 6ч (${(favorableMove / initialSlDistance).toFixed(1)}R)`;
          exitPrice = livePrice;
        }
      }

      // Fallback: 8h time exit for losing trades (only if no partial TP hit and no smart abort)
      if (!shouldClose && openMinutes > maxHoldMinutes && favorableMove < 0) {
        shouldClose = true;
        const hours = Math.round(openMinutes / 60);
        reason = `Тайм-эксит (${hours}ч)`;
        exitPrice = livePrice;
      }

      // ════════════════════════════════════════════════════════════
      // MAIN TP/SL CHECK using candle HIGH/LOW
      // ════════════════════════════════════════════════════════════
      if (!shouldClose) {
        // Check main TP — skip if partial TP already fired for this trade
        if (!skipMainTP) {
          if (isLong && trade.take_profit) {
            if (completed.high >= trade.take_profit || current.high >= trade.take_profit
              || completed.close >= trade.take_profit) {
              shouldClose = true; reason = 'TP hit'; exitPrice = trade.take_profit;
            }
          } else if (!isLong && trade.take_profit) {
            if (completed.low <= trade.take_profit || current.low <= trade.take_profit
              || completed.close <= trade.take_profit) {
              shouldClose = true; reason = 'TP hit'; exitPrice = trade.take_profit;
            }
          }
        }

        // Check SL — ALWAYS runs, even if partial TP fired (protect against reversal)
        if (!shouldClose && isLong && trade.stop_loss) {
          if (completed.low <= trade.stop_loss || current.low <= trade.stop_loss
            || completed.close <= trade.stop_loss) {
            shouldClose = true; reason = 'SL hit'; exitPrice = trade.stop_loss;
          }
        } else if (!shouldClose && !isLong && trade.stop_loss) {
          if (completed.high >= trade.stop_loss || current.high >= trade.stop_loss
            || completed.close >= trade.stop_loss) {
            shouldClose = true; reason = 'SL hit'; exitPrice = trade.stop_loss;
          }
        }
      }

      // ════════════════════════════════════════════════════════════
      // TRAILING STOP: 3 levels
      // ════════════════════════════════════════════════════════════
      if (!shouldClose && trade.stop_loss && trade.entry_price && initialSlDistance > 0) {
        if (trailing3x && favorableMove >= initialSlDistance * 3) {
          const trailedSL = isLong ? trade.entry_price + initialSlDistance * 2 : trade.entry_price - initialSlDistance * 2;
          if ((isLong && trailedSL > (trade.stop_loss ?? 0)) || (!isLong && trailedSL < (trade.stop_loss ?? Infinity))) {
            trailingUpdates.push({ tradeId: trade.id, newStopLoss: trailedSL, reason: 'Trailing lock 2× profit' });
          }
        } else if (trailing2x && favorableMove >= initialSlDistance * 2) {
          const trailedSL = isLong ? trade.entry_price + initialSlDistance : trade.entry_price - initialSlDistance;
          if ((isLong && trailedSL > (trade.stop_loss ?? 0)) || (!isLong && trailedSL < (trade.stop_loss ?? Infinity))) {
            trailingUpdates.push({ tradeId: trade.id, newStopLoss: trailedSL, reason: 'Trailing lock profit' });
          }
        } else if (trailing1x && favorableMove >= initialSlDistance) {
          const breakevenSL = isLong ? trade.entry_price * 1.001 : trade.entry_price * 0.999;
          if ((isLong && breakevenSL > (trade.stop_loss ?? 0)) || (!isLong && breakevenSL < (trade.stop_loss ?? Infinity))) {
            trailingUpdates.push({ tradeId: trade.id, newStopLoss: breakevenSL, reason: 'Trailing to breakeven' });
          }
        }
      }

      // ════════════════════════════════════════════════════════════
      // CLOSE: calculate PnL using remaining_amount (not original amount)
      // ════════════════════════════════════════════════════════════
      if (shouldClose) {
        const effectiveExitPrice = exitPrice > 0 ? exitPrice : livePrice;
        const priceChange = isLong
          ? (effectiveExitPrice - trade.entry_price) / trade.entry_price
          : (trade.entry_price - effectiveExitPrice) / trade.entry_price;
        const pnl = effectiveAmount * priceChange * trade.leverage - effectiveAmount * 0.001 - (effectiveAmount / trade.leverage) * 0.001;
        closedTrades.push({ tradeId: trade.id, symbol: trade.symbol, direction: trade.direction, pnl, reason, exitPrice: effectiveExitPrice });
      }
    } catch { continue; }
  }

  return { closedTrades, trailingUpdates, tpRepairs, partialCloses };
}

// ============================================================
// Full auto-trade cycle — reads all settings from DB
// ============================================================

export type NewTradeInfo = {
  symbol: string; direction: string; price: number; leverage: number;
  stopLoss: number; takeProfit: number; amount: number; strategyId: string;
  label: 'main';
  pattern?: {
    name?: string; direction?: string; reliability?: number; strength?: number;
    zone_high?: number; zone_low?: number; start_time?: number; end_time?: number;
  } | null;
};

export async function runAutoTradeCycle(
  openTrades: Trade[],
  strategyId: string,
  _interval: string,
  balance: number,
  lastCandleSlot: number = 0,
  recentPnl24h: number = 0,
  sysSettings?: Record<string, string>,
  globalLockedSymbols?: Set<string>,
  cooldownSymbols?: Map<string, number>,  // symbol → timestamp when cooldown expires
  recentTradesForDrawdown?: Trade[],  // last N closed trades for drawdown check
): Promise<{
    action: 'monitor' | 'new-trade' | 'idle';
    closedTrades: MonitorResult['closedTrades'];
    trailingUpdates: MonitorResult['trailingUpdates'];
    tpRepairs: MonitorResult['tpRepairs'];
    newTrades?: NewTradeInfo[];
    message: string;
    scannedCount: number;
    bestScore: number;
    newCandleHour: number;
    diagnostics?: SignalDiagnostics;
  }> {
  // ── Load settings once per cycle if not provided ──
  const settings = sysSettings ?? await fetchSettings();
  const strategy = getEffectiveStrategy(settings, strategyId);

  // ── ENABLED CHECK: skip disabled strategies ──
  if ('enabled' in strategy && !strategy.enabled) {
    return { action: 'idle', closedTrades: [], trailingUpdates: [], tpRepairs: [], partialCloses: [], message: 'Стратегия отключена', scannedCount: 0, bestScore: 0, newCandleHour: 0 };
  }

  const maxTrades = strategy.maxOpenTrades;
  const tradeSizePct = strategy.tradeSizePercent;
  const currentSlot = getCurrentCandleSlot(strategy.monitorInterval);

  // Use strategy-specific interval and candle limit (from DB overrides)
  const strategyInterval = strategy.defaultInterval;
  const strategyLimit = strategy.candleLimit;
  const monitorInterval = strategy.monitorInterval;
  const maxHoldMinutes = strategy.maxHoldMinutes;

  // System setting: daily loss limit (default 5%)
  const dailyLossLimitPct = Number(getSys(settings, 'system.dailyLossLimit', 5)) / 100;
  const dailyLossLimit = balance * dailyLossLimitPct;
  if (recentPnl24h < -dailyLossLimit) {
    return {
      action: 'idle', closedTrades: [], trailingUpdates: [], tpRepairs: [],
      message: `Дневной лимит: -$${Math.abs(recentPnl24h).toFixed(2)} (>${dailyLossLimitPct * 100}%). Пауза до завтра.`,
      scannedCount: 0, bestScore: 0, newCandleHour: currentSlot, partialCloses: [],
    };
  }

  // ── DRAWDOWN CIRCUIT BREAKER ──
  // If the last N trades lost more than X% of balance — pause opening new trades
  if ('drawdownPausePct' in strategy && 'drawdownLookback' in strategy && recentTradesForDrawdown && recentTradesForDrawdown.length > 0) {
    const lookback = Math.min(recentTradesForDrawdown.length, (strategy as any).drawdownLookback || 5);
    const recentClosed = recentTradesForDrawdown.slice(0, lookback);
    const drawdownPnl = recentClosed.reduce((sum, t) => sum + (t.pnl ?? 0), 0);
    const drawdownPct = balance > 0 ? (drawdownPnl / balance) * 100 : 0;
    const maxDrawdownPct = (strategy as any).drawdownPausePct || 10;

    if (drawdownPnl < 0 && Math.abs(drawdownPct) >= maxDrawdownPct) {
      return {
        action: 'idle', closedTrades: [], trailingUpdates: [], tpRepairs: [],
        message: `🔴 Просадка ${Math.abs(drawdownPct).toFixed(1)}% за ${lookback} сделок (лимит ${maxDrawdownPct}%). Пауза.`,
        scannedCount: 0, bestScore: 0, newCandleHour: currentSlot, partialCloses: [],
      };
    }
  }

  // Step 1: Monitor open trades (pass system settings for caps + trailing)
  const { closedTrades, trailingUpdates, tpRepairs, partialCloses } = await monitorTradesClient(openTrades, lastCandleSlot, monitorInterval, maxHoldMinutes, settings);
  const updatedOpenTrades = openTrades.filter(t => !closedTrades.some(c => c.tradeId === t.id));

  // ── v2: Handle PARTIAL CLOSES (TP1, TP2) ──
  // These return PnL and reduce the trade's remaining amount.
  // The caller (frontend) must process these to update balance + DB.
  const partialParts: string[] = [];
  if (partialCloses.length > 0) {
    for (const pc of partialCloses) {
      partialParts.push(`${pc.symbol.replace('USDT', '')} ${pc.reason} +$${pc.pnl.toFixed(2)}`);
    }
  }
  // Use updatedOpenTrades for max trade count (partial closes still count as open trades)
  const effectiveOpenTrades = updatedOpenTrades;

  // ── UPDATE COOLDOWNS from closed trades ──
  // For each SL hit, add the symbol to cooldown
  const intervalMsMap: Record<string, number> = { '1m': 60000, '5m': 300000, '15m': 900000, '1h': 3600000, '4h': 14400000, '1d': 86400000 };
  const candleMs = intervalMsMap[strategyInterval] || 3600000;
  const cooldownCandles = ('cooldownCandles' in strategy) ? (strategy as any).cooldownCandles : 4;

  for (const ct of closedTrades) {
    if (ct.reason.includes('SL') || ct.reason.includes('Тайм')) {
      if (cooldownSymbols) {
        const cooldownMs = candleMs * cooldownCandles;
        cooldownSymbols.set(ct.symbol, Date.now() + cooldownMs);
        console.log(`[runAutoTradeCycle][${strategyId}] Cooldown set for ${ct.symbol}: ${cooldownCandles} candles (${Math.round(cooldownMs / 60000)}min)`);
      }
    }
  }

  // Collect monitoring messages
  const monitorParts: string[] = [];
  if (closedTrades.length > 0) monitorParts.push(`Закрыто ${closedTrades.length}: ${closedTrades.map(c => `${c.symbol.replace('USDT', '')} (${c.reason})`).join(', ')}`);
  if (partialParts.length > 0) monitorParts.push(`Частичный TP: ${partialParts.join(', ')}`);
  if (trailingUpdates.length > 0) monitorParts.push(`Trailing SL: ${trailingUpdates.length}`);
  if (tpRepairs.length > 0) monitorParts.push(`TP ремонт: ${tpRepairs.length}`);

  // Each signal opens exactly ONE trade — no secure/runner split.
  if (effectiveOpenTrades.length + 1 > maxTrades) {
    const msg = monitorParts.length > 0
      ? monitorParts.join(' | ') + ` | Лимит: ${effectiveOpenTrades.length}/${maxTrades}`
      : `Лимит: ${effectiveOpenTrades.length}/${maxTrades}, жду...`;
    return { action: 'monitor', closedTrades, trailingUpdates, tpRepairs, partialCloses, message: msg, scannedCount: 0, bestScore: 0, newCandleHour: currentSlot };
  }

  // ── FREE BALANCE (not total) ──
  const lockedInOpen = effectiveOpenTrades.reduce((sum, t) => sum + (t.remaining_amount ?? t.amount), 0);
  const freeBalance = Math.max(0, balance - lockedInOpen);

  if (freeBalance < 1) {
    const msg = monitorParts.length > 0
      ? monitorParts.join(' | ') + ` | Свободный баланс <$1 (всего $${balance.toFixed(1)}, заморожено $${lockedInOpen.toFixed(1)})`
      : `Свободный баланс <$1 (всего $${balance.toFixed(1)}, заморожено $${lockedInOpen.toFixed(1)})`;
    return { action: 'monitor', closedTrades, trailingUpdates, tpRepairs, partialCloses, message: msg, scannedCount: 0, bestScore: 0, newCandleHour: currentSlot };
  }

  // ── DAILY TRADE LIMIT (check before scanning) ──
  let todayTradesCount = 0;
  if (strategy.maxDailyTrades > 0 && typeof window !== 'undefined') {
    const storageKey = `dailyTrades_${strategyId}_${new Date().toISOString().slice(0, 10)}`;
    todayTradesCount = parseInt(sessionStorage.getItem(storageKey) || '0', 10);
    if (todayTradesCount >= strategy.maxDailyTrades) {
      return {
        action: 'idle', closedTrades, trailingUpdates, tpRepairs, partialCloses: [],
        message: `Дневной лимит сделок: ${todayTradesCount}/${strategy.maxDailyTrades}. До завтра.`,
        scannedCount: 0, bestScore: 0, newCandleHour: currentSlot,
        diagnostics: { checked: 0, none: 0, mtfRejected: 0, volFiltered: 0, btcFiltered: 0, cooldowns: 0, entryRejected: 0, bestSymbol: null, bestScore: 0, dailyLimitHit: true, dailyTradeCount: todayTradesCount },
      };
    }
  }

  // ── SCAN FREQUENCY: only scan for new signals every N hours (CORE+TRAIL) ──
  // Monitoring (SL/TP/trailing) still runs every cycle — only NEW trade search is throttled.
  // IMPORTANT: Skip throttle for short-TF strategies (≤1h) — patterns on 15m/5m
  // form and disappear within a single candle, so scanning every 2h misses them entirely.
  const shortTfMs: Record<string, number> = { '1m': 60000, '5m': 300000, '15m': 900000, '1h': 3600000, '4h': 14400000 };
  const isShortTF = (shortTfMs[strategyInterval] ?? Infinity) <= 14400000; // 4h and below
  const scanFreqHours = isShortTF ? 1 : Number(getSys(settings, 'system.scanFreqHours', 2));
  const currentUtcHour = new Date().getUTCHours();
  if (scanFreqHours > 1 && currentUtcHour % scanFreqHours !== 0) {
    const remainHours = scanFreqHours - (currentUtcHour % scanFreqHours);
    const msg = monitorParts.length > 0
      ? monitorParts.join(' | ') + ` | Скан через ${remainHours}ч`
      : `Скан через ${remainHours}ч (каждые ${scanFreqHours}ч)...`;
    return { action: 'idle', closedTrades, trailingUpdates, tpRepairs, partialCloses: [], message: msg, scannedCount: 0, bestScore: 0, newCandleHour: currentSlot };
  }

  const openSymbols = new Set(effectiveOpenTrades.map(t => t.symbol));
  if (globalLockedSymbols) {
    for (const sym of globalLockedSymbols) openSymbols.add(sym);
  }

  const best = await findBestSignal(openSymbols, strategyId, strategyInterval, strategyLimit, strategy, settings, cooldownSymbols);
  const diag = (best as any)?._diag as SignalDiagnostics | undefined;

  if (!best || best.decision.direction === 'none') {
    // Build human-readable diagnostic summary
    const d = diag ?? { checked: 0, none: 0, mtfRejected: 0, volFiltered: 0, btcFiltered: 0, cooldowns: 0, entryRejected: 0, bestSymbol: null, bestScore: 0, dailyLimitHit: false, dailyTradeCount: todayTradesCount };
    const filters: string[] = [];
    if (d.none > 0) filters.push(`нет сигнала: ${d.none}`);
    if (d.mtfRejected > 0) filters.push(`старший ТФ: ${d.mtfRejected}`);
    if (d.volFiltered > 0) filters.push(`объёмный фильтр: ${d.volFiltered}`);
    if (d.entryRejected > 0) filters.push(`плохой вход: ${d.entryRejected}`);
    if (d.btcFiltered > 0) filters.push(`BTC фильтр: ${d.btcFiltered}`);
    if (d.cooldowns > 0) filters.push(`кулдаун: ${d.cooldowns}`);
    const diagMsg = `проверено ${d.checked} — ${filters.length > 0 ? filters.join(', ') : 'слабые сигналы'}`;
    const msg = monitorParts.length > 0
      ? monitorParts.join(' | ') + ' | ' + diagMsg
      : diagMsg;
    return { action: 'idle', closedTrades, trailingUpdates, tpRepairs, partialCloses: [], message: msg, scannedCount: d.checked, bestScore: 0, newCandleHour: currentSlot, diagnostics: d };
  }

  // ============================================================
  // Trade sizing — based on FREE balance (not total)
  // ============================================================
  const isLong = best.decision.direction === 'long';

  const maxTPDistancePct = Number(getSys(settings, 'system.maxTPDistance', 15)) / 100;
  const maxTPDistance = best.price * maxTPDistancePct;

  const takeProfit = isLong
    ? Math.min(best.decision.takeProfit, best.price + maxTPDistance)
    : Math.max(best.decision.takeProfit, best.price - maxTPDistance);

  // Position sizing based on FREE balance (not total)
  let amount: number;
  if (freeBalance < 200) {
    amount = Math.max(1.5, Math.min(freeBalance * 0.08, 8));
  } else if (freeBalance < 1000) {
    amount = Math.max(5, Math.min(freeBalance * 0.05, 50));
  } else if (freeBalance < 5000) {
    amount = Math.max(20, Math.min(freeBalance * 0.03, 150));
  } else {
    amount = Math.max(50, Math.min(freeBalance * 0.02, 500));
  }
  // Cap with strategy's tradeSizePercent as absolute max (safety)
  const strategyMax = freeBalance * tradeSizePct;
  amount = Math.min(amount, strategyMax);

  // Don't exceed free balance
  amount = Math.min(amount, freeBalance * 0.5); // never risk more than 50% of free on one trade

  // ── VOLUME REGIME POSITION SIZE ADJUSTMENT ──
  // If volume regime says volatile/reduced, scale down the trade
  const volPositionMult = (best.decision as any)._volPositionMult;
  let volReason = (best.decision as any)._volReason || '';
  if (volPositionMult && volPositionMult < 1.0) {
    amount *= volPositionMult;
    volReason = ` | ${volReason}`;
  } else if (volPositionMult && volPositionMult > 1.0) {
    amount = Math.min(amount * volPositionMult, freeBalance * 0.5); // still cap at 50% of free
    volReason = ` | ${volReason}`;
  }

  // ── DAILY TRADE COUNTER increment ──
  if ('maxDailyTrades' in strategy && (strategy as any).maxDailyTrades > 0 && typeof window !== 'undefined') {
    const storageKey = `dailyTrades_${strategyId}_${new Date().toISOString().slice(0, 10)}`;
    const todayTrades = parseInt(sessionStorage.getItem(storageKey) || '0', 10);
    sessionStorage.setItem(storageKey, String(todayTrades + 1));
  }

  const patternData = best.decision.pattern ? {
    name: best.decision.pattern.name,
    direction: best.decision.pattern.direction,
    reliability: best.decision.pattern.reliability,
    strength: best.decision.pattern.strength,
    zone_high: best.decision.pattern.zone_high,
    zone_low: best.decision.pattern.zone_low,
    start_time: best.decision.pattern.start_time,
    end_time: best.decision.pattern.end_time,
  } : null;

  const newTrades: NewTradeInfo[] = [
    { symbol: best.symbol, direction: best.decision.direction, price: best.price, leverage: best.decision.leverage, stopLoss: best.decision.stopLoss, takeProfit, amount, strategyId, label: 'main', pattern: patternData },
  ];

  const coinName = best.symbol.replace('USDT', '');
  const entryReason = (best.decision as any)._entryReason ? ` | вход: ${(best.decision as any)._entryReason}` : '';
  const signalMsg = `СИГНАЛ: ${best.decision.direction.toUpperCase()} ${coinName} @ $${best.price.toFixed(2)} | ${best.decision.leverage}x | $${amount.toFixed(2)} (свободно $${freeBalance.toFixed(1)}) | TP ${strategy.riskRewardRatio}R${volReason}${entryReason}`;
  return {
    action: 'new-trade', closedTrades, trailingUpdates, tpRepairs, partialCloses, newTrades,
    message: monitorParts.length > 0 ? monitorParts.join(' | ') + ' | ' + signalMsg : signalMsg,
    scannedCount: 30, bestScore: Math.abs(best.decision.score), newCandleHour: currentSlot,
  };
}
