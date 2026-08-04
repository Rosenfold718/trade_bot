import type { CandleData, TradingDecision, Trade } from './types';
import { TOP_50_SYMBOLS } from './types';
import { makeStrategyDecision } from './trading-engine';
import { type StrategyConfig, getStrategy } from './strategies';
import { fetchSettings, getEffectiveStrategy, getSys } from './settings-cache';

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
  const res = await fetch(`/api/price?symbol=${symbol}`);
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

export async function findBestSignal(
  openTradeSymbols: Set<string>,
  strategyId: string = 'momentum',
  interval: string = '1h',
  limit: number = 1440,
  strategyOverride?: StrategyConfig,
  sysSettings?: Record<string, string>,
): Promise<{ decision: TradingDecision; price: number; symbol: string } | null> {
  const strategy = strategyOverride ?? getStrategy(strategyId);
  if (!strategy) return null;

  const effectiveInterval = interval;
  const effectiveLimit = limit;

  const symbols = TOP_50_SYMBOLS;
  const available = symbols.filter(s => !openTradeSymbols.has(s));

  // System setting: how many symbols to scan (or per-strategy override)
  const scanLimit = strategyId === 'scalper' ? 30 : 20;
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



      if (Math.abs(decision.score) > bestScore) {
        bestScore = Math.abs(decision.score);
        best = { decision, price: candles[candles.length - 1].close, symbol: sym };
      }
    } catch { continue; }
  }

  console.log(`[findBestSignal][${strategyId}] Interval:${effectiveInterval} Checked ${checkSymbols.length}, none=${noneCount}, mtf_rejected=${mtfRejected}, best=${best?.symbol ?? 'null'} score=${bestScore.toFixed(2)}`);

  return best;
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
  closedTrades: Array<{ tradeId: string; symbol: string; direction: string; pnl: number; reason: string; exitPrice: number }>;
  trailingUpdates: Array<{ tradeId: string; newStopLoss: number; reason: string }>;
  tpRepairs: Array<{ tradeId: string; newTakeProfit: number; reason: string }>;
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
  const currentSlot = getCurrentCandleSlot(monitorInterval);

  // System settings for auto-repair caps (defaults: SL 5%, TP 10%)
  const slCapPct = sysSettings ? Number(getSys(sysSettings, 'system.maxSLCapDistance', 5)) / 100 : 0.05;
  const tpCapPct = sysSettings ? Number(getSys(sysSettings, 'system.maxTPCapDistance', 10)) / 100 : 0.10;

  // System settings for trailing stop toggles
  const trailing1x = sysSettings ? getSys(sysSettings, 'system.trailing1x', true) : true;
  const trailing2x = sysSettings ? getSys(sysSettings, 'system.trailing2x', true) : true;
  const trailing3x = sysSettings ? getSys(sysSettings, 'system.trailing3x', true) : true;

  if (currentSlot <= lastCandleSlot) {
    return { closedTrades: [], trailingUpdates: [], tpRepairs: [] };
  }

  for (const trade of openTrades) {
    try {
      const { completed, current } = await fetchCandlesForMonitor(trade.symbol, monitorInterval);
      let shouldClose = false;
      let reason = '';
      let exitPrice = 0;

      // The "check price" is the CLOSE of the current in-progress candle
      // — this is the best approximation of the real-time price at
      // the moment of the check (the candle hasn't closed yet).
      const livePrice = current.close;

      // ── AUTO-REPAIR: Fix inverted or excessive SL/TP ──
      let repairedTP = false;
      let repairedSL = false;
      if (trade.stop_loss && trade.take_profit && trade.entry_price) {
        const isLong = trade.direction === 'long';
        const slBad = isLong ? trade.stop_loss >= trade.entry_price : trade.stop_loss <= trade.entry_price;
        const tpBad = isLong ? trade.take_profit <= trade.entry_price : trade.take_profit >= trade.entry_price;
        if (slBad || tpBad) {
          // SL/TP inverted — silently repair (causes no user-visible issues)
          if (slBad) {
            const fixedSL = isLong ? trade.entry_price * (1 - slCapPct) : trade.entry_price * (1 + slCapPct);
            trailingUpdates.push({ tradeId: trade.id, newStopLoss: fixedSL, reason: 'Auto-repair: inverted SL' });
            repairedSL = true;
          }
          if (tpBad) {
            const fixedTP = isLong ? trade.entry_price * (1 + tpCapPct) : trade.entry_price * (1 - tpCapPct);
            tpRepairs.push({ tradeId: trade.id, newTakeProfit: fixedTP, reason: 'Auto-repair: inverted TP' });
          }
        }
        // Cap excessive distances (using system settings)
        if (!repairedSL && trade.stop_loss) {
          const slDist = Math.abs(trade.stop_loss - trade.entry_price) / trade.entry_price;
          if (slDist > slCapPct) {
            const cappedSL = isLong ? trade.entry_price * (1 - slCapPct) : trade.entry_price * (1 + slCapPct);
            trailingUpdates.push({ tradeId: trade.id, newStopLoss: cappedSL, reason: `Auto-repair: excessive SL capped at ${slCapPct * 100}%` });
          }
        }
        if (!repairedTP && trade.take_profit) {
          const tpDist = Math.abs(trade.take_profit - trade.entry_price) / trade.entry_price;
          if (tpDist > tpCapPct) {
            const cappedTP = isLong ? trade.entry_price * (1 + tpCapPct) : trade.entry_price * (1 - tpCapPct);
            tpRepairs.push({ tradeId: trade.id, newTakeProfit: cappedTP, reason: `Auto-repair: excessive TP capped at ${tpCapPct * 100}%` });
          }
        }
      }

      // TIME-BASED EXIT: close losing trades after maxHoldMinutes
      const openMs = Date.now() - new Date(trade.opened_at).getTime();
      const openMinutes = openMs / 60000;
      if (openMinutes > maxHoldMinutes) {
        const unrealizedPnl = trade.direction === 'long'
          ? (livePrice - trade.entry_price) / trade.entry_price
          : (trade.entry_price - livePrice) / trade.entry_price;
        if (unrealizedPnl < 0) {
          shouldClose = true;
          const hours = Math.round(openMinutes / 60);
          reason = `Тайм-эксит (${hours}ч)`;
          exitPrice = livePrice;
        }
      }

      // ── TP/SL CHECK using candle HIGH/LOW ──
      // Previously only the CLOSE of the last completed candle was checked.
      // This missed any wick that pierced the TP/SL during the candle.
      // Now we check BOTH the completed and current candle's HIGH/LOW.
      // For LONG: TP triggers if HIGH >= TP, SL triggers if LOW <= SL
      // For SHORT: TP triggers if LOW <= TP, SL triggers if HIGH >= SL
      // We also check the current candle's CLOSE as a fallback.

      if (!shouldClose) {
        const isLong = trade.direction === 'long';

        // Check TP on COMPLETED candle (HIGH/LOW + CLOSE)
        if (isLong && trade.take_profit) {
          if (completed.high >= trade.take_profit) {
            shouldClose = true; reason = 'TP hit'; exitPrice = trade.take_profit;
          } else if (completed.close >= trade.take_profit) {
            shouldClose = true; reason = 'TP hit'; exitPrice = trade.take_profit;
          }
        } else if (!isLong && trade.take_profit) {
          if (completed.low <= trade.take_profit) {
            shouldClose = true; reason = 'TP hit'; exitPrice = trade.take_profit;
          } else if (completed.close <= trade.take_profit) {
            shouldClose = true; reason = 'TP hit'; exitPrice = trade.take_profit;
          }
        }

        // Check TP on CURRENT (in-progress) candle
        if (!shouldClose) {
          if (isLong && trade.take_profit) {
            if (current.high >= trade.take_profit) {
              shouldClose = true; reason = 'TP hit (live)'; exitPrice = trade.take_profit;
            }
          } else if (!isLong && trade.take_profit) {
            if (current.low <= trade.take_profit) {
              shouldClose = true; reason = 'TP hit (live)'; exitPrice = trade.take_profit;
            }
          }
        }

        // Check SL on COMPLETED candle (HIGH/LOW + CLOSE)
        if (!shouldClose && isLong && trade.stop_loss) {
          if (completed.low <= trade.stop_loss) {
            shouldClose = true; reason = 'SL hit'; exitPrice = trade.stop_loss;
          } else if (completed.close <= trade.stop_loss) {
            shouldClose = true; reason = 'SL hit'; exitPrice = trade.stop_loss;
          }
        } else if (!shouldClose && !isLong && trade.stop_loss) {
          if (completed.high >= trade.stop_loss) {
            shouldClose = true; reason = 'SL hit'; exitPrice = trade.stop_loss;
          } else if (completed.close >= trade.stop_loss) {
            shouldClose = true; reason = 'SL hit'; exitPrice = trade.stop_loss;
          }
        }

        // Check SL on CURRENT (in-progress) candle
        if (!shouldClose) {
          if (isLong && trade.stop_loss) {
            if (current.low <= trade.stop_loss) {
              shouldClose = true; reason = 'SL hit (live)'; exitPrice = trade.stop_loss;
            }
          } else if (!isLong && trade.stop_loss) {
            if (current.high >= trade.stop_loss) {
              shouldClose = true; reason = 'SL hit (live)'; exitPrice = trade.stop_loss;
            }
          }
        }
      }

      // Trailing stop: 3 levels (each togglable via system settings)
      if (!shouldClose && trade.stop_loss && trade.entry_price) {
        const initialSlDistance = Math.abs(trade.entry_price - trade.stop_loss);
        const isLong = trade.direction === 'long';
        const favorableMove = isLong ? livePrice - trade.entry_price : trade.entry_price - livePrice;

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

      if (shouldClose) {
        // Use the specific exitPrice if set (TP/SL hit = exact level),
        // otherwise use the live price as best approximation.
        const effectiveExitPrice = exitPrice > 0 ? exitPrice : livePrice;
        const priceChange = trade.direction === 'long'
          ? (effectiveExitPrice - trade.entry_price) / trade.entry_price
          : (trade.entry_price - effectiveExitPrice) / trade.entry_price;
        const effectiveAmount = trade.remaining_amount ?? trade.amount;
        const pnl = effectiveAmount * priceChange * trade.leverage - effectiveAmount * 0.001 - (effectiveAmount / trade.leverage) * 0.001;
        closedTrades.push({ tradeId: trade.id, symbol: trade.symbol, direction: trade.direction, pnl, reason, exitPrice: effectiveExitPrice });
      }
    } catch { continue; }
  }

  return { closedTrades, trailingUpdates, tpRepairs };
}

// ============================================================
// Full auto-trade cycle — reads all settings from DB
// ============================================================

export type NewTradeInfo = {
  symbol: string; direction: string; price: number; leverage: number;
  stopLoss: number; takeProfit: number; amount: number; strategyId: string;
  label: 'main';
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
  }> {
  // ── Load settings once per cycle if not provided ──
  const settings = sysSettings ?? await fetchSettings();
  const strategy = getEffectiveStrategy(settings, strategyId);

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
      scannedCount: 0, bestScore: 0, newCandleHour: currentSlot,
    };
  }

  // Step 1: Monitor open trades (pass system settings for caps + trailing)
  const { closedTrades, trailingUpdates, tpRepairs } = await monitorTradesClient(openTrades, lastCandleSlot, monitorInterval, maxHoldMinutes, settings);
  const updatedOpenTrades = openTrades.filter(t => !closedTrades.some(c => c.tradeId === t.id));

  // Collect monitoring messages
  const monitorParts: string[] = [];
  if (closedTrades.length > 0) monitorParts.push(`Закрыто ${closedTrades.length}: ${closedTrades.map(c => `${c.symbol.replace('USDT', '')} (${c.reason})`).join(', ')}`);
  if (trailingUpdates.length > 0) monitorParts.push(`Trailing SL: ${trailingUpdates.length}`);
  if (tpRepairs.length > 0) monitorParts.push(`TP ремонт: ${tpRepairs.length}`);

  // CRITICAL FIX: Always proceed to find signals, even if monitoring found changes.
  // Previously, monitoring results blocked signal finding — now both run.

  // Each signal opens exactly ONE trade — no secure/runner split.
  // Splitting caused multiple overlapping positions on the same symbol,
  // cluttering the chart and fragmenting capital into tiny sub-positions.
  // A single well-sized trade with a proper 1:R target is safer and clearer.
  if (updatedOpenTrades.length + 1 > maxTrades) {
    const msg = monitorParts.length > 0
      ? monitorParts.join(' | ') + ` | Лимит: ${updatedOpenTrades.length}/${maxTrades}`
      : `Лимит: ${updatedOpenTrades.length}/${maxTrades}, жду...`;
    return { action: 'monitor', closedTrades, trailingUpdates, tpRepairs, message: msg, scannedCount: 0, bestScore: 0, newCandleHour: currentSlot };
  }

  // ── FREE BALANCE: subtract amounts locked in open trades ──
  const lockedInOpen = updatedOpenTrades.reduce((sum, t) => sum + t.amount, 0);
  const freeBalance = Math.max(0, balance - lockedInOpen);

  if (freeBalance < 1) {
    const msg = monitorParts.length > 0
      ? monitorParts.join(' | ') + ' | Баланс исчерпан (<$1 free)'
      : 'Баланс исчерпан (<$1 free)';
    return { action: 'monitor', closedTrades, trailingUpdates, tpRepairs, message: msg, scannedCount: 0, bestScore: 0, newCandleHour: currentSlot };
  }

  const openSymbols = new Set(updatedOpenTrades.map(t => t.symbol));
  // Merge with globally locked symbols (opened by OTHER strategies this cycle)
  // This prevents 3 strategies from opening the same symbol simultaneously
  if (globalLockedSymbols) {
    for (const sym of globalLockedSymbols) openSymbols.add(sym);
  }

  const best = await findBestSignal(openSymbols, strategyId, strategyInterval, strategyLimit, strategy, settings);
  if (!best || best.decision.direction === 'none') {
    const msg = monitorParts.length > 0
      ? monitorParts.join(' | ') + ' | Сигналов не найдено'
      : 'Сигналов не найдено, сканирую...';
    return { action: 'idle', closedTrades, trailingUpdates, tpRepairs, message: msg, scannedCount: 30, bestScore: 0, newCandleHour: currentSlot };
  }

  // ============================================================
  // Trade sizing — SINGLE trade per signal (no secure/runner split)
  // System setting: max TP distance (default 15% — allows 1:3 R:R with 5% SL)
  // ============================================================
  const isLong = best.decision.direction === 'long';

  const maxTPDistancePct = Number(getSys(settings, 'system.maxTPDistance', 15)) / 100;
  const maxTPDistance = best.price * maxTPDistancePct;

  // Use the strategy's native takeProfit (already computed at strategy.riskRewardRatio)
  // and cap it to the system max TP distance for safety.
  const takeProfit = isLong
    ? Math.min(best.decision.takeProfit, best.price + maxTPDistance)
    : Math.max(best.decision.takeProfit, best.price - maxTPDistance);

  // Single trade with dynamic position sizing based on FREE balance.
  let amount: number;
  if (freeBalance < 100) {
    amount = Math.max(2, Math.min(freeBalance * 0.15, 15));
  } else if (freeBalance < 500) {
    amount = Math.max(10, Math.min(freeBalance * 0.10, 50));
  } else if (freeBalance < 2000) {
    amount = Math.max(30, Math.min(freeBalance * 0.08, 150));
  } else if (freeBalance < 10000) {
    amount = Math.max(50, Math.min(freeBalance * 0.06, 300));
  } else {
    amount = Math.max(100, Math.min(freeBalance * 0.04, 500));
  }
  // Cap with strategy's tradeSizePercent as absolute max (safety)
  const strategyMax = freeBalance * tradeSizePct;
  amount = Math.min(amount, strategyMax);

  const newTrades: NewTradeInfo[] = [
    { symbol: best.symbol, direction: best.decision.direction, price: best.price, leverage: best.decision.leverage, stopLoss: best.decision.stopLoss, takeProfit, amount, strategyId, label: 'main' },
  ];

  const coinName = best.symbol.replace('USDT', '');
  const signalMsg = `СИГНАЛ: ${best.decision.direction.toUpperCase()} ${coinName} @ $${best.price.toFixed(2)} | ${best.decision.leverage}x | $${amount.toFixed(2)} | TP ${strategy.riskRewardRatio}R`;
  return {
    action: 'new-trade', closedTrades, trailingUpdates, tpRepairs, newTrades,
    message: monitorParts.length > 0 ? monitorParts.join(' | ') + ' | ' + signalMsg : signalMsg,
    scannedCount: 30, bestScore: Math.abs(best.decision.score), newCandleHour: currentSlot,
  };
}
