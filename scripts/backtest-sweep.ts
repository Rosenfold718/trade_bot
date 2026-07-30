// ============================================================
// Параметрический бэктест: перебор комбинаций параметров
// Фаза 1: широкая развертка (5 аккаунтов/конфиг, 200 свечей)
// Фаза 2: точная настройка топ-5 (20 аккаунтов, 500 свечей)
// ============================================================

const BINANCE = 'https://api.binance.com/api/v3';

interface Candle {
  time: number;
  open: number; high: number; low: number; close: number; volume: number;
}

interface Config {
  label: string;
  signalThreshold: number;  // min score to enter
  minIndicators: number;    // min indicator agreement (out of ~9)
  slAtrMult: number;        // SL = this × ATR
  rrRatio: number;          // TP = SL × this (1:N)
  timeExitHours: number;    // max hold time
  maxOpenTrades: number;
  maxDailyTrades: number;
  cooldownHours: number;
  leverage: number;
  entryHardATR: number;     // hard reject if price > this × ATR from EMA
  entrySoftATR: number;     // soft penalty zone
}

interface SimTrade {
  symbol: string;
  direction: 'long' | 'short';
  entryPrice: number;
  amount: number;
  leverage: number;
  stopLoss: number;
  takeProfit: number;
  openTime: number;
  closeTime?: number;
  closePrice?: number;
  pnl?: number;
  reason?: string;
}

interface RunResult {
  label: string;
  accounts: Array<{
    pnl: number; pnlPct: number; totalTrades: number; wins: number; losses: number;
    winRate: number; maxDD: number; pf: number;
  }>;
  avgPnl: number;
  avgPnlPct: number;
  profitablePct: number;
  avgWR: number;
  avgPF: number;
  avgDD: number;
  avgTrades: number;
  rank: number;
}

// ── Technical indicators ──
function calcEMA(data: number[], period: number): number[] {
  const ema: number[] = [];
  if (data.length < period) return ema;
  const k = 2 / (period + 1);
  let val = data.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = 0; i < period; i++) ema.push(NaN);
  ema[period - 1] = val;
  for (let i = period; i < data.length; i++) {
    val = data[i] * k + val * (1 - k);
    ema.push(val);
  }
  return ema;
}

function calcATR(candles: Candle[], period = 14): number[] {
  const atr: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    if (i === 0) { atr.push(candles[0].high - candles[0].low); continue; }
    const tr = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close),
    );
    if (i < period) {
      const avg = atr.slice(0, i).reduce((s, v) => s + (isNaN(v) ? 0 : v), 0) / (i + 1);
      atr.push(avg);
    } else {
      atr.push((atr[i - 1] * (period - 1) + tr) / period);
    }
  }
  return atr;
}

function calcRSI(closes: number[], period = 14): number[] {
  const rsi: number[] = new Array(closes.length).fill(50);
  if (closes.length <= period) return rsi;
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) avgGain += d; else avgLoss -= d;
  }
  avgGain /= period; avgLoss /= period;
  rsi[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (d > 0 ? d : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (d < 0 ? -d : 0)) / period;
    rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return rsi;
}

// ── Strategy decision (parametric) ──
function makeDecision(
  candles: Candle[], idx: number, cfg: Config
): { direction: 'long' | 'short' | 'none'; score: number } {
  if (idx < 100) return { direction: 'none', score: 0 };

  const closes = candles.map(c => c.close);
  const ema7 = calcEMA(closes, 7);
  const ema25 = calcEMA(closes, 25);
  const ema99 = calcEMA(closes, 99);
  const ema20 = calcEMA(closes, 20);
  const atr = calcATR(candles);
  const rsi = calcRSI(closes);

  const price = closes[idx];
  const e7 = ema7[idx], e25 = ema25[idx], e99 = ema99[idx], e20 = ema20[idx];
  const atrVal = atr[idx], rsiVal = rsi[idx];

  if (isNaN(e7) || isNaN(e25) || isNaN(e99) || !atrVal) return { direction: 'none', score: 0 };

  let longScore = 0, shortScore = 0;
  let longCount = 0, shortCount = 0;

  // 1. EMA alignment (3 indicators)
  if (price > e7) { longScore += 0.12; longCount++; } else { shortScore += 0.12; shortCount++; }
  if (e7 > e25) { longScore += 0.10; longCount++; } else { shortScore += 0.10; shortCount++; }
  if (e25 > e99) { longScore += 0.10; longCount++; } else { shortScore += 0.10; shortCount++; }

  // 2. Price momentum (3 candles)
  if (idx >= 3) {
    const mom = (closes[idx] - closes[idx - 3]) / closes[idx - 3];
    if (mom > 0.005) { longScore += 0.08; longCount++; }
    else if (mom < -0.005) { shortScore += 0.08; shortCount++; }
  }

  // 3. RSI
  if (rsiVal < 35) { longScore += 0.15; longCount++; }
  else if (rsiVal > 65) { shortScore += 0.15; shortCount++; }

  // 4. Bollinger Band
  const bbUpper = e25 + 2 * atrVal;
  const bbLower = e25 - 2 * atrVal;
  if (price < bbLower) { longScore += 0.12; longCount++; }
  else if (price > bbUpper) { shortScore += 0.12; shortCount++; }

  // 5. Volume
  const volSlice = candles.slice(Math.max(0, idx - 19), idx + 1);
  const avgVol = volSlice.reduce((s, c) => s + c.volume, 0) / volSlice.length;
  const volRatio = avgVol > 0 ? candles[idx].volume / avgVol : 1;
  if (volRatio > 1.3) {
    if (candles[idx].close > candles[idx].open) { longScore += 0.08; longCount++; }
    else { shortScore += 0.08; shortCount++; }
  }

  // 6. ADX (simplified)
  if (idx >= 28) {
    let plusDM = 0, minusDM = 0, trSum = 0;
    for (let i = idx - 13; i <= idx; i++) {
      const upMove = candles[i].high - candles[i - 1].high;
      const downMove = candles[i - 1].low - candles[i].low;
      plusDM += (upMove > downMove && upMove > 0) ? upMove : 0;
      minusDM += (downMove > upMove && downMove > 0) ? downMove : 0;
      trSum += Math.max(candles[i].high - candles[i].low, Math.abs(candles[i].high - candles[i - 1].close), Math.abs(candles[i].low - candles[i - 1].close));
    }
    if (trSum > 0) {
      const plusDI = (plusDM / trSum) * 100;
      const minusDI = (minusDM / trSum) * 100;
      const dx = Math.abs(plusDI - minusDI) / (plusDI + minusDI + 0.001) * 100;
      if (dx > 25) {
        if (plusDI > minusDI) { longScore += 0.10; longCount++; }
        else { shortScore += 0.10; shortCount++; }
      }
    }
  }

  // 7. MACD (EMA12 vs EMA26)
  const ema12 = calcEMA(closes, 12);
  const ema26 = calcEMA(closes, 26);
  const macdLine = ema12[idx] - ema26[idx];
  const macdPrev = ema12[idx - 1] - ema26[idx - 1];
  if (!isNaN(macdLine) && !isNaN(macdPrev)) {
    if (macdLine > 0 && macdLine > macdPrev) { longScore += 0.10; longCount++; }
    else if (macdLine < 0 && macdLine < macdPrev) { shortScore += 0.10; shortCount++; }
  }

  // 8. Trend strength: ADX-based directional confidence
  if (idx >= 50) {
    const ema50 = calcEMA(closes, 50);
    const e50 = ema50[idx];
    if (!isNaN(e50)) {
      const distFromEma50 = (price - e50) / atrVal;
      if (Math.abs(distFromEma50) > 2.0) {
        if (distFromEma50 > 0) { longScore += 0.05; longCount++; }
        else { shortScore += 0.05; shortCount++; }
      }
    }
  }

  const isLong = longScore > shortScore;
  const score = Math.abs(longScore - shortScore);
  const indicatorAgreement = isLong ? longCount : shortCount;

  // Apply configured thresholds
  if (score < cfg.signalThreshold || indicatorAgreement < cfg.minIndicators) {
    return { direction: 'none', score };
  }

  // RSI exhaustion filter
  if (isLong && rsiVal > 78) return { direction: 'none', score };
  if (!isLong && rsiVal < 22) return { direction: 'none', score };

  return { direction: isLong ? 'long' : 'short', score: isLong ? longScore : -shortScore };
}

// ── Entry quality (parametric) ──
function assessEntry(
  candles: Candle[], idx: number, direction: 'long' | 'short', cfg: Config
): { pass: boolean; multiplier: number; reason: string } {
  const closes = candles.map(c => c.close);
  const ema20 = calcEMA(closes, 20);
  const atr = calcATR(candles);
  const rsi = calcRSI(closes);

  const e20 = ema20[idx], atrVal = atr[idx], rsiVal = rsi[idx];
  if (isNaN(e20) || !atrVal) return { pass: true, multiplier: 1.0, reason: '' };

  const price = closes[idx];
  const emaDist = (price - e20) / atrVal;
  const extension = direction === 'long' ? emaDist : -emaDist;

  // Consecutive candles
  let consecutive = 0;
  for (let i = idx; i >= Math.max(0, idx - 4); i--) {
    const bull = candles[i].close > candles[i].open;
    if ((direction === 'long' && bull) || (direction === 'short' && !bull)) consecutive++;
    else break;
  }

  // Hard rejects
  if (extension > cfg.entryHardATR) return { pass: false, multiplier: 0, reason: `${extension.toFixed(1)}×ATR` };
  if (consecutive >= 4 && extension > 1.5) return { pass: false, multiplier: 0, reason: `${consecutive} подряд` };
  if (direction === 'long' && rsiVal > 78) return { pass: false, multiplier: 0, reason: `RSI ${rsiVal.toFixed(0)}` };
  if (direction === 'short' && rsiVal < 22) return { pass: false, multiplier: 0, reason: `RSI ${rsiVal.toFixed(0)}` };

  let mult = 1.0;
  if (extension > cfg.entrySoftATR) mult *= 0.5;
  else if (extension > 1.0) mult *= 0.75;
  if (consecutive >= 3 && extension > 1.0) mult *= 0.7;

  // Bonus for pullback
  if (extension < 1.0 && extension > -0.5) mult *= 1.15;

  return { pass: mult >= 0.3, multiplier: mult, reason: extension < 1.0 ? 'откат' : `${extension.toFixed(1)}×ATR` };
}

// ── MTF filter ──
function mtfFilter(candles: Candle[], direction: 'long' | 'short'): boolean {
  const closes = candles.map(c => c.close);
  const ema50 = calcEMA(closes, 50);
  const price = closes[closes.length - 1];
  const e50 = ema50[ema50.length - 1];
  if (isNaN(e50)) return true;
  return (direction === 'long' && price > e50) || (direction === 'short' && price <= e50);
}

// ── Position sizing ──
function calcAmount(balance: number, freeBalance: number): number {
  let amount: number;
  if (freeBalance < 200) amount = Math.max(1.5, Math.min(freeBalance * 0.08, 8));
  else if (freeBalance < 1000) amount = Math.max(5, Math.min(freeBalance * 0.05, 50));
  else if (freeBalance < 5000) amount = Math.max(20, Math.min(freeBalance * 0.03, 150));
  else amount = Math.max(50, Math.min(freeBalance * 0.02, 500));
  amount = Math.min(amount, freeBalance * 0.06);
  amount = Math.min(amount, freeBalance * 0.5);
  return Math.round(amount * 100) / 100;
}

// ── Fetch data ──
async function fetchCandles(symbol: string, interval = '1h', limit = 500): Promise<Candle[]> {
  const res = await fetch(`${BINANCE}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
  if (!res.ok) return [];
  const raw = await res.json();
  return raw.map((k: any) => ({
    time: Math.floor(Number(k[0]) / 1000),
    open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5],
  }));
}

async function fetchTop50(): Promise<string[]> {
  const res = await fetch(`${BINANCE}/ticker/24hr`);
  const data = await res.json();
  return data
    .filter((t: any) => t.symbol.endsWith('USDT') && Number(t.quoteVolume) > 0)
    .sort((a: any, b: any) => Number(b.quoteVolume) - Number(a.quoteVolume))
    .slice(0, 50)
    .map((t: any) => t.symbol);
}

// ── Single account simulation ──
async function simulateAccount(
  startBalance: number,
  allCandles: Map<string, Candle[]>,
  symbols: string[],
  seed: number,
  cfg: Config,
): Promise<{ pnl: number; pnlPct: number; totalTrades: number; wins: number; losses: number; winRate: number; maxDD: number; pf: number }> {
  const trades: SimTrade[] = [];
  let balance = startBalance;
  let peak = balance;
  let maxDD = 0;
  let wins = 0, losses = 0, winSum = 0, lossSum = 0;

  let rng = seed;
  const rand = () => { rng = (rng * 1664525 + 1013904223) & 0xFFFFFFFF; return (rng >>> 0) / 0xFFFFFFFF; };

  const firstCandle = [...allCandles.values()][0];
  if (!firstCandle || firstCandle.length < 130) {
    return { pnl: 0, pnlPct: 0, totalTrades: 0, wins: 0, losses: 0, winRate: 0, maxDD: 0, pf: 0 };
  }

  const startTime = firstCandle[0].time;
  const endTime = firstCandle[firstCandle.length - 1].time;
  const oneHour = 3600;
  const cooldowns = new Map<string, number>();
  let dailyTrades = 0, lastDay = -1;

  for (let t = startTime + 130 * oneHour; t <= endTime; t += oneHour) {
    const currentDay = Math.floor(t / 86400);
    if (currentDay !== lastDay) { dailyTrades = 0; lastDay = currentDay; }
    if (dailyTrades >= cfg.maxDailyTrades) continue;

    // Monitor open trades
    for (const trade of [...trades]) {
      if (trade.closeTime) continue;
      const symCandles = allCandles.get(trade.symbol);
      if (!symCandles) continue;
      const candleIdx = symCandles.findIndex(c => c.time >= t);
      if (candleIdx < 1) continue;
      const c = symCandles[candleIdx];

      let shouldClose = false, reason = '', exitPrice = c.close;

      if (trade.direction === 'long') {
        if (c.low <= trade.stopLoss) { shouldClose = true; reason = 'SL'; exitPrice = trade.stopLoss; }
        else if (c.high >= trade.takeProfit) { shouldClose = true; reason = 'TP'; exitPrice = trade.takeProfit; }
      } else {
        if (c.high >= trade.stopLoss) { shouldClose = true; reason = 'SL'; exitPrice = trade.stopLoss; }
        else if (c.low <= trade.takeProfit) { shouldClose = true; reason = 'TP'; exitPrice = trade.takeProfit; }
      }

      // Time exit
      const holdHours = (t - trade.openTime) / oneHour;
      if (!shouldClose && holdHours > cfg.timeExitHours) {
        const priceChange = trade.direction === 'long'
          ? (c.close - trade.entryPrice) / trade.entryPrice
          : (trade.entryPrice - c.close) / trade.entryPrice;
        if (priceChange < 0) { shouldClose = true; reason = 'TIME'; exitPrice = c.close; }
      }

      if (shouldClose) {
        trade.closeTime = t;
        trade.closePrice = exitPrice;
        const priceChange = trade.direction === 'long'
          ? (exitPrice - trade.entryPrice) / trade.entryPrice
          : (trade.entryPrice - exitPrice) / trade.entryPrice;
        const fees = trade.amount * 0.001 + (trade.amount / trade.leverage) * 0.001;
        trade.pnl = trade.amount * priceChange * trade.leverage - fees;
        trade.reason = reason;
        balance += trade.amount + trade.pnl;
        if (balance > peak) peak = balance;
        const dd = peak - balance;
        if (dd > maxDD) maxDD = dd;
        if (trade.pnl >= 0) { wins++; winSum += trade.pnl; } else { losses++; lossSum += Math.abs(trade.pnl); }
        if (reason === 'SL' || reason === 'TIME') {
          cooldowns.set(trade.symbol, t + cfg.cooldownHours * oneHour);
        }
      }
    }

    // Open new trades
    const openTrades = trades.filter(t => !t.closeTime);
    if (openTrades.length >= cfg.maxOpenTrades) continue;
    if (balance < 10) continue;

    const shuffled = [...symbols].sort(() => rand() - 0.5);
    const toScan = shuffled.slice(0, 20);
    const openSymbols = new Set(openTrades.map(t => t.symbol));

    let bestSymbol = '', bestScore = 0, bestDir: 'long' | 'short' | null = null;

    for (const sym of toScan) {
      if (openSymbols.has(sym)) continue;
      const cd = cooldowns.get(sym);
      if (cd && t < cd) continue;

      const symCandles = allCandles.get(sym);
      if (!symCandles) continue;
      const idx = symCandles.findIndex(c => c.time >= t);
      if (idx < 100) continue;

      const trimmedCandles = symCandles.slice(0, idx + 1);
      const decision = makeDecision(trimmedCandles, trimmedCandles.length - 1, cfg);
      if (decision.direction === 'none') continue;

      // Entry quality
      const eq = assessEntry(trimmedCandles, trimmedCandles.length - 1, decision.direction, cfg);
      if (!eq.pass) continue;
      decision.score *= eq.multiplier;

      // MTF filter
      if (trimmedCandles.length >= 50) {
        const mtfCandles = trimmedCandles.filter((_, i) => i % 24 === 0 || i === trimmedCandles.length - 1);
        if (!mtfFilter(mtfCandles, decision.direction)) continue;
      }

      const absScore = Math.abs(decision.score);
      if (absScore > bestScore) {
        bestScore = absScore;
        bestSymbol = sym;
        bestDir = decision.direction;
      }
    }

    if (!bestDir || !bestSymbol) continue;

    const symCandles = allCandles.get(bestSymbol)!;
    const idx = symCandles.findIndex(c => c.time >= t);
    const price = symCandles[idx].close;
    const atrArr = calcATR(symCandles);
    const atrVal = atrArr[idx];
    if (!atrVal) continue;

    const freeBalance = Math.max(0, balance - openTrades.reduce((s, tr) => s + tr.amount, 0));
    const amount = calcAmount(balance, freeBalance);
    if (amount < 1) continue;

    const slDist = atrVal * cfg.slAtrMult;
    const tpDist = slDist * cfg.rrRatio;
    const stopLoss = bestDir === 'long' ? price - slDist : price + slDist;
    const takeProfit = bestDir === 'long' ? price + tpDist : price - tpDist;

    trades.push({
      symbol: bestSymbol, direction: bestDir, entryPrice: price,
      amount, leverage: cfg.leverage, stopLoss, takeProfit, openTime: t,
    });
    balance -= amount;
    dailyTrades++;
  }

  // Close remaining
  for (const trade of trades) {
    if (trade.closeTime) continue;
    const symCandles = allCandles.get(trade.symbol);
    if (!symCandles) continue;
    const lastPrice = symCandles[symCandles.length - 1].close;
    const priceChange = trade.direction === 'long'
      ? (lastPrice - trade.entryPrice) / trade.entryPrice
      : (trade.entryPrice - lastPrice) / trade.entryPrice;
    const fees = trade.amount * 0.001 + (trade.amount / trade.leverage) * 0.001;
    trade.pnl = trade.amount * priceChange * trade.leverage - fees;
    trade.closeTime = endTime;
    trade.closePrice = lastPrice;
    trade.reason = 'END';
    balance += trade.amount + trade.pnl;
    if (balance > peak) peak = balance;
    const dd = peak - balance;
    if (dd > maxDD) maxDD = dd;
    if (trade.pnl >= 0) { wins++; winSum += trade.pnl; } else { losses++; lossSum += Math.abs(trade.pnl); }
  }

  const pnl = balance - startBalance;
  const totalTrades = trades.length;
  return {
    pnl: Math.round(pnl * 100) / 100,
    pnlPct: Math.round((pnl / startBalance) * 10000) / 100,
    totalTrades,
    wins,
    losses,
    winRate: totalTrades > 0 ? Math.round((wins / totalTrades) * 1000) / 10 : 0,
    maxDD: Math.round((maxDD / startBalance) * 1000) / 10,
    pf: lossSum > 0 ? Math.round((winSum / lossSum) * 100) / 100 : wins > 0 ? 99.99 : 0,
  };
}

// ── Generate config combinations ──
function generateConfigs(): Config[] {
  const configs: Config[] = [];

  // BASELINE: currently applied config
  configs.push({
    label: 'BASELINE(S0.5/MI6/SL2/RR4/12h)',
    signalThreshold: 0.50, minIndicators: 6, slAtrMult: 2.0, rrRatio: 4,
    timeExitHours: 12, maxOpenTrades: 5, maxDailyTrades: 6, cooldownHours: 4,
    leverage: 3, entryHardATR: 3.0, entrySoftATR: 2.0,
  });

  // ── SWEEP 1: RR Ratio (3, 4, 5, 6) ──
  for (const rr of [3, 5, 6]) {
    configs.push({
      label: `RR${rr}(S0.5/MI6/SL2)`,
      signalThreshold: 0.50, minIndicators: 6, slAtrMult: 2.0, rrRatio: rr,
      timeExitHours: 12, maxOpenTrades: 5, maxDailyTrades: 6, cooldownHours: 4,
      leverage: 3, entryHardATR: 3.0, entrySoftATR: 2.0,
    });
  }

  // ── SWEEP 2: SL Multiplier (1.5, 2.5, 3.0) ──
  for (const sl of [1.5, 2.5, 3.0]) {
    configs.push({
      label: `SL${sl}(S0.5/MI6/RR4)`,
      signalThreshold: 0.50, minIndicators: 6, slAtrMult: sl, rrRatio: 4,
      timeExitHours: 12, maxOpenTrades: 5, maxDailyTrades: 6, cooldownHours: 4,
      leverage: 3, entryHardATR: 3.0, entrySoftATR: 2.0,
    });
  }

  // ── SWEEP 3: Signal threshold (0.40, 0.55, 0.60) ──
  for (const s of [0.40, 0.55, 0.60]) {
    configs.push({
      label: `S${s}(MI6/SL2/RR4)`,
      signalThreshold: s, minIndicators: 6, slAtrMult: 2.0, rrRatio: 4,
      timeExitHours: 12, maxOpenTrades: 5, maxDailyTrades: 6, cooldownHours: 4,
      leverage: 3, entryHardATR: 3.0, entrySoftATR: 2.0,
    });
  }

  // ── SWEEP 4: Min indicators (5, 7) ──
  for (const mi of [5, 7]) {
    configs.push({
      label: `MI${mi}(S0.5/SL2/RR4)`,
      signalThreshold: 0.50, minIndicators: mi, slAtrMult: 2.0, rrRatio: 4,
      timeExitHours: 12, maxOpenTrades: 5, maxDailyTrades: 6, cooldownHours: 4,
      leverage: 3, entryHardATR: 3.0, entrySoftATR: 2.0,
    });
  }

  // ── SWEEP 5: Time exit (8h, 16h, 24h) ──
  for (const te of [8, 16, 24]) {
    configs.push({
      label: `TE${te}h(S0.5/MI6/SL2/RR4)`,
      signalThreshold: 0.50, minIndicators: 6, slAtrMult: 2.0, rrRatio: 4,
      timeExitHours: te, maxOpenTrades: 5, maxDailyTrades: 6, cooldownHours: 4,
      leverage: 3, entryHardATR: 3.0, entrySoftATR: 2.0,
    });
  }

  // ── SWEEP 6: Max daily trades (3, 4, 8) ──
  for (const md of [3, 4, 8]) {
    configs.push({
      label: `MD${md}(S0.5/MI6/SL2/RR4)`,
      signalThreshold: 0.50, minIndicators: 6, slAtrMult: 2.0, rrRatio: 4,
      timeExitHours: 12, maxOpenTrades: 5, maxDailyTrades: md, cooldownHours: 4,
      leverage: 3, entryHardATR: 3.0, entrySoftATR: 2.0,
    });
  }

  // ── SWEEP 7: Leverage (1, 2) ──
  for (const lev of [1, 2]) {
    configs.push({
      label: `LEV${lev}(S0.5/MI6/SL2/RR4)`,
      signalThreshold: 0.50, minIndicators: 6, slAtrMult: 2.0, rrRatio: 4,
      timeExitHours: 12, maxOpenTrades: 5, maxDailyTrades: 6, cooldownHours: 4,
      leverage: lev, entryHardATR: 3.0, entrySoftATR: 2.0,
    });
  }

  // ── SWEEP 8: Entry strictness ──
  configs.push({
    label: `ENTRY_HARD(S0.5/MI6/SL2/RR4)`,
    signalThreshold: 0.50, minIndicators: 6, slAtrMult: 2.0, rrRatio: 4,
    timeExitHours: 12, maxOpenTrades: 5, maxDailyTrades: 6, cooldownHours: 4,
    leverage: 3, entryHardATR: 2.5, entrySoftATR: 1.5,
  });
  configs.push({
    label: `ENTRY_LOOSE(S0.5/MI6/SL2/RR4)`,
    signalThreshold: 0.50, minIndicators: 6, slAtrMult: 2.0, rrRatio: 4,
    timeExitHours: 12, maxOpenTrades: 5, maxDailyTrades: 6, cooldownHours: 4,
    leverage: 3, entryHardATR: 4.0, entrySoftATR: 3.0,
  });

  // ── COMBOS: best individual params combined ──
  // Conservative: high threshold, low trades, tight entry
  configs.push({
    label: `CONSERVATIVE(S0.6/MI7/SL2/RR5/MD3)`,
    signalThreshold: 0.60, minIndicators: 7, slAtrMult: 2.0, rrRatio: 5,
    timeExitHours: 12, maxOpenTrades: 3, maxDailyTrades: 3, cooldownHours: 6,
    leverage: 2, entryHardATR: 2.5, entrySoftATR: 1.5,
  });

  // Aggressive: lower threshold, more trades
  configs.push({
    label: `AGGRESSIVE(S0.4/MI5/SL1.5/RR3/MD8)`,
    signalThreshold: 0.40, minIndicators: 5, slAtrMult: 1.5, rrRatio: 3,
    timeExitHours: 8, maxOpenTrades: 5, maxDailyTrades: 8, cooldownHours: 2,
    leverage: 3, entryHardATR: 3.5, entrySoftATR: 2.5,
  });

  // Wide SL + High RR
  configs.push({
    label: `WIDE_SL(S0.5/MI6/SL3/RR5/16h)`,
    signalThreshold: 0.50, minIndicators: 6, slAtrMult: 3.0, rrRatio: 5,
    timeExitHours: 16, maxOpenTrades: 3, maxDailyTrades: 4, cooldownHours: 4,
    leverage: 2, entryHardATR: 3.0, entrySoftATR: 2.0,
  });

  // No-leverage conservative
  configs.push({
    label: `NO_LEV(S0.5/MI6/SL2/RR4/LEV1)`,
    signalThreshold: 0.50, minIndicators: 6, slAtrMult: 2.0, rrRatio: 4,
    timeExitHours: 12, maxOpenTrades: 5, maxDailyTrades: 6, cooldownHours: 4,
    leverage: 1, entryHardATR: 3.0, entrySoftATR: 2.0,
  });

  // High RR tight SL
  configs.push({
    label: `HI_RR(S0.55/MI6/SL1.5/RR6/TE16h)`,
    signalThreshold: 0.55, minIndicators: 6, slAtrMult: 1.5, rrRatio: 6,
    timeExitHours: 16, maxOpenTrades: 3, maxDailyTrades: 4, cooldownHours: 6,
    leverage: 2, entryHardATR: 3.0, entrySoftATR: 2.0,
  });

  // Fewer trades, higher quality
  configs.push({
    label: `SNIPER(S0.55/MI7/SL2/RR4/MD3/TE16h)`,
    signalThreshold: 0.55, minIndicators: 7, slAtrMult: 2.0, rrRatio: 4,
    timeExitHours: 16, maxOpenTrades: 3, maxDailyTrades: 3, cooldownHours: 6,
    leverage: 2, entryHardATR: 2.5, entrySoftATR: 1.5,
  });

  // Shorter time exit (cut losers faster)
  configs.push({
    label: `QUICK_CUT(S0.5/MI6/SL2/RR4/TE8h)`,
    signalThreshold: 0.50, minIndicators: 6, slAtrMult: 2.0, rrRatio: 4,
    timeExitHours: 8, maxOpenTrades: 5, maxDailyTrades: 6, cooldownHours: 4,
    leverage: 3, entryHardATR: 3.0, entrySoftATR: 2.0,
  });

  return configs;
}

// ── Main ──
async function main() {
  const phase = process.argv[2] || 'sweep'; // 'sweep' or 'fine'
  const accountsPerConfig = phase === 'sweep' ? 8 : 20;
  const candleLimit = phase === 'sweep' ? 300 : 500;

  console.log('━'.repeat(70));
  console.log(`  ПАРАМЕТРИЧЕСКИЙ БЭКТЕСТ — ${phase === 'sweep' ? 'РАЗВЁРТКА' : 'ТОЧНАЯ НАСТРОЙКА'}`);
  console.log(`  ${accountsPerConfig} аккаунтов/конфиг | ${candleLimit} свечей | $1000/аккаунт`);
  console.log('━'.repeat(70));
  console.log('');

  console.log('Загрузка топ-50 монет...');
  const symbols = await fetchTop50();
  console.log(`  ${symbols.length} монет`);

  console.log(`Загрузка свечей (1H, ${candleLimit} шт/монету)...`);
  const allCandles = new Map<string, Candle[]>();
  let loaded = 0;
  await Promise.all(symbols.map(async (sym) => {
    try {
      const c = await fetchCandles(sym, '1h', candleLimit);
      if (c.length > 100) allCandles.set(sym, c);
      loaded++;
      if (loaded % 10 === 0) process.stdout.write(`  \r${loaded}/${symbols.length} монет...`);
    } catch { /* skip */ }
  }));
  console.log(`\r  Загружено ${allCandles.size} монет со свечами      `);

  const sampleCandles = [...allCandles.values()][0];
  const startDate = new Date(sampleCandles[0].time * 1000);
  const endDate = new Date(sampleCandles[sampleCandles.length - 1].time * 1000);
  const days = Math.round((endDate.getTime() - startDate.getTime()) / 86400000);
  console.log(`  Период: ${startDate.toLocaleDateString('ru')} — ${endDate.toLocaleDateString('ru')} (${days} дней)`);
  console.log('');

  // If fine-tune mode, read top configs from args
  let configs: Config[];
  if (phase === 'fine' && process.argv[3]) {
    // Parse specific config indices from args
    // Format: node backtest-sweep.ts fine 0,3,7,12,15
    const indices = process.argv[3].split(',').map(Number);
    const allConfigs = generateConfigs();
    configs = indices.map(i => allConfigs[i]).filter(Boolean);
    console.log(`  Точная настройка ${configs.length} конфигов: ${configs.map(c => c.label).join(', ')}`);
  } else {
    configs = generateConfigs();
  }

  console.log(`\nЗапуск ${configs.length} конфигов × ${accountsPerConfig} аккаунтов...\n`);

  const results: RunResult[] = [];

  for (let ci = 0; ci < configs.length; ci++) {
    const cfg = configs[ci];
    const accounts: RunResult['accounts'] = [];

    process.stdout.write(`[${String(ci + 1).padStart(2)}/${configs.length}] ${cfg.label.padEnd(45)} `);

    for (let i = 0; i < accountsPerConfig; i++) {
      const result = await simulateAccount(1000, allCandles, symbols, 42 + i * 7919, cfg);
      accounts.push(result);
    }

    const avgPnl = accounts.reduce((s, a) => s + a.pnl, 0) / accounts.length;
    const avgPnlPct = accounts.reduce((s, a) => s + a.pnlPct, 0) / accounts.length;
    const profitable = accounts.filter(a => a.pnl > 0).length;
    const avgWR = accounts.reduce((s, a) => s + a.winRate, 0) / accounts.length;
    const avgPF = accounts.reduce((s, a) => s + a.pf, 0) / accounts.length;
    const avgDD = accounts.reduce((s, a) => s + a.maxDD, 0) / accounts.length;
    const avgTrades = accounts.reduce((s, a) => s + a.totalTrades, 0) / accounts.length;

    results.push({
      label: cfg.label, accounts, avgPnl, avgPnlPct,
      profitablePct: Math.round((profitable / accounts.length) * 100),
      avgWR, avgPF, avgDD, avgTrades, rank: 0,
    });

    const emoji = avgPnl >= 0 ? '✅' : '❌';
    console.log(`\r[${String(ci + 1).padStart(2)}/${configs.length}] ${cfg.label.padEnd(45)} PnL:${avgPnl >= 0 ? '+' : ''}$${avgPnl.toFixed(1).padStart(6)} | WR:${avgWR.toFixed(0).padStart(3)}% | PF:${avgPF.toFixed(2).padStart(5)} | DD:${avgDD.toFixed(1).padStart(4)}% | ${profitable}/${accountsPerConfig} ${emoji}`);
  }

  // ── RANKING ──
  console.log('\n' + '━'.repeat(70));
  console.log('  РАНЖИРОВАНИЕ (по composite score: PnL + WR + PF - DD)');
  console.log('━'.repeat(70) + '\n');

  // Composite: avgPnlPct * 2 + profitablePct - avgDD * 1.5 + avgPF * 5
  results.sort((a, b) => {
    const scoreA = a.avgPnlPct * 2 + a.profitablePct - a.avgDD * 1.5 + a.avgPF * 5;
    const scoreB = b.avgPnlPct * 2 + b.profitablePct - b.avgDD * 1.5 + b.avgPF * 5;
    return scoreB - scoreA;
  });

  results.forEach((r, i) => {
    r.rank = i + 1;
    const composite = r.avgPnlPct * 2 + r.profitablePct - r.avgDD * 1.5 + r.avgPF * 5;
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '  ';
    console.log(
      `${medal} #${String(i + 1).padStart(2)} ${r.label.padEnd(45)} `
      + `PnL:${r.avgPnl >= 0 ? '+' : ''}$${r.avgPnl.toFixed(1).padStart(6)} `
      + `(${r.avgPnlPct >= 0 ? '+' : ''}${r.avgPnlPct.toFixed(1)}%) `
      + `WR:${r.avgWR.toFixed(0).padStart(3)}% `
      + `PF:${r.avgPF.toFixed(2)} `
      + `DD:${r.avgDD.toFixed(1)}% `
      + `Торги:${r.avgTrades.toFixed(0)} `
      + `Вный:${r.profitablePct}% `
      + `Score:${composite.toFixed(1)}`
    );
  });

  // Top 5 indices for fine-tune
  console.log('\n' + '━'.repeat(70));
  console.log('  ТОП-5 для точной настройки (20 аккаунтов, 500 свечей):');
  console.log('  Запустите: bun run scripts/backtest-sweep.ts fine <indices>');
  const topIndices = results.slice(0, 5).map(r => {
    const originalIdx = configs.findIndex(c => c.label === r.label);
    return originalIdx;
  });
  console.log(`  Индексы: ${topIndices.join(',')}`);
  console.log('━'.repeat(70));
}

main().catch(console.error);
