// ============================================================
// Бэктест: 20 аккаунтов × 1 неделя
// Симуляция по реальным свечам Binance (1H, Momentum стратегия)
// ============================================================

const BINANCE = 'https://api.binance.com/api/v3';

interface Candle {
  time: number;
  open: number; high: number; low: number; close: number; volume: number;
}

interface SimTrade {
  id: string;
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

// ── Fetch candles ──
async function fetchCandles(symbol: string, interval = '1h', limit = 200): Promise<Candle[]> {
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

// ── EMA calc ──
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

// ── ATR calc ──
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

// ── RSI calc ──
function calcRSI(closes: number[], period = 14): number[] {
  const rsi: number[] = new Array(closes.length).fill(50);
  if (closes.length <= period) return rsi;
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) avgGain += d; else avgLoss -= d;
  }
  avgGain /= period;
  avgLoss /= period;
  rsi[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (d > 0 ? d : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (d < 0 ? -d : 0)) / period;
    rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return rsi;
}

// ── Simplified strategy decision for backtest ──
function makeDecision(candles: Candle[], idx: number): { direction: 'long' | 'short' | 'none'; score: number } {
  if (idx < 100) return { direction: 'none', score: 0 };

  const closes = candles.map(c => c.close);
  const ema7 = calcEMA(closes, 7);
  const ema25 = calcEMA(closes, 25);
  const ema99 = calcEMA(closes, 99);
  const atr = calcATR(candles);
  const rsi = calcRSI(closes);

  const price = closes[idx];
  const e7 = ema7[idx], e25 = ema25[idx], e99 = ema99[idx];
  const atrVal = atr[idx];
  const rsiVal = rsi[idx];

  if (isNaN(e7) || isNaN(e25) || isNaN(e99) || !atrVal) return { direction: 'none', score: 0 };

  let longScore = 0, shortScore = 0;
  let longCount = 0, shortCount = 0;

  // EMA alignment (3 indicators)
  if (price > e7) { longScore += 0.12; longCount++; } else { shortScore += 0.12; shortCount++; }
  if (e7 > e25) { longScore += 0.10; longCount++; } else { shortScore += 0.10; shortCount++; }
  if (e25 > e99) { longScore += 0.10; longCount++; } else { shortScore += 0.10; shortCount++; }

  // Price momentum (last 3 candles)
  if (idx >= 3) {
    const mom = (closes[idx] - closes[idx - 3]) / closes[idx - 3];
    if (mom > 0.005) { longScore += 0.08; longCount++; }
    else if (mom < -0.005) { shortScore += 0.08; shortCount++; }
  }

  // RSI
  if (rsiVal < 35) { longScore += 0.15; longCount++; } // oversold → long
  else if (rsiVal > 65) { shortScore += 0.15; shortCount++; } // overbought → short

  // Bollinger Band (simplified: price vs EMA25 ± 2*ATR)
  const bbUpper = e25 + 2 * atrVal;
  const bbLower = e25 - 2 * atrVal;
  if (price < bbLower) { longScore += 0.12; longCount++; } // below lower → long
  else if (price > bbUpper) { shortScore += 0.12; shortCount++; } // above upper → short

  // Volume: current vs 20-candle avg
  const volSlice = candles.slice(Math.max(0, idx - 19), idx + 1);
  const avgVol = volSlice.reduce((s, c) => s + c.volume, 0) / volSlice.length;
  const volRatio = avgVol > 0 ? candles[idx].volume / avgVol : 1;
  if (volRatio > 1.3) {
    // High volume confirms direction
    const bullish = candles[idx].close > candles[idx].open;
    if (bullish) { longScore += 0.08; longCount++; }
    else { shortScore += 0.08; shortCount++; }
  }

  // ADX (simplified — directional movement strength)
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
      if (dx > 25) { // ADX > 25 — trend is strong
        if (plusDI > minusDI) { longScore += 0.10; longCount++; }
        else { shortScore += 0.10; shortCount++; }
      }
    }
  }

  // MACD-like: EMA12 vs EMA26
  const ema12 = calcEMA(closes, 12);
  const ema26 = calcEMA(closes, 26);
  const macdLine = ema12[idx] - ema26[idx];
  const macdPrev = ema12[idx - 1] - ema26[idx - 1];
  if (!isNaN(macdLine) && !isNaN(macdPrev)) {
    if (macdLine > 0 && macdLine > macdPrev) { longScore += 0.10; longCount++; }
    else if (macdLine < 0 && macdLine < macdPrev) { shortScore += 0.10; shortCount++; }
  }

  const isLong = longScore > shortScore;
  const score = Math.abs(longScore - shortScore);
  const indicatorAgreement = isLong ? longCount : shortCount;

  // Thresholds: need strong signal with indicator agreement
  if (score < 0.35 || indicatorAgreement < 5) return { direction: 'none', score };

  return { direction: isLong ? 'long' : 'short', score: isLong ? longScore : -shortScore };
}

// ── Entry quality check (same logic as client-trader) ──
function assessEntry(candles: Candle[], idx: number, direction: 'long' | 'short'): { pass: boolean; multiplier: number; reason: string } {
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

  // Hard reject
  if (extension > 3.0) return { pass: false, multiplier: 0, reason: `${extension.toFixed(1)}×ATR` };
  if (consecutive >= 4 && extension > 1.5) return { pass: false, multiplier: 0, reason: `${consecutive} подряд` };
  if (direction === 'long' && rsiVal > 78) return { pass: false, multiplier: 0, reason: `RSI ${rsiVal.toFixed(0)}` };
  if (direction === 'short' && rsiVal < 22) return { pass: false, multiplier: 0, reason: `RSI ${rsiVal.toFixed(0)}` };

  let mult = 1.0;
  if (extension > 2.0) mult *= 0.5;
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
  if (isNaN(e50)) return true; // allow if not enough data
  const bullish = price > e50;
  return (direction === 'long' && bullish) || (direction === 'short' && !bullish);
}

// ── Position sizing (same as client-trader) ──
function calcAmount(balance: number, freeBalance: number): number {
  let amount: number;
  if (freeBalance < 200) amount = Math.max(1.5, Math.min(freeBalance * 0.08, 8));
  else if (freeBalance < 1000) amount = Math.max(5, Math.min(freeBalance * 0.05, 50));
  else if (freeBalance < 5000) amount = Math.max(20, Math.min(freeBalance * 0.03, 150));
  else amount = Math.max(50, Math.min(freeBalance * 0.02, 500));
  amount = Math.min(amount, freeBalance * 0.06); // tradeSizePercent
  amount = Math.min(amount, freeBalance * 0.5);
  return Math.round(amount * 100) / 100;
}

// ── Single account simulation ──
interface AccountResult {
  id: number;
  startBalance: number;
  endBalance: number;
  pnl: number;
  pnlPct: number;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  maxDrawdown: number;
  maxDrawdownPct: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  trades: SimTrade[];
}

async function simulateAccount(
  accountId: number,
  startBalance: number,
  allCandles: Map<string, Candle[]>,
  symbols: string[],
  seed: number,
): Promise<AccountResult> {
  const trades: SimTrade[] = [];
  let balance = startBalance;
  let maxBalance = balance;
  let maxDrawdown = 0;
  let maxDrawdownPct = 0;
  let totalPnl = 0;
  let wins = 0, losses = 0;
  let winSum = 0, lossSum = 0;
  const leverage = 3;
  const rr = 3; // risk:reward 1:3

  // Simple seeded random
  let rng = seed;
  const rand = () => { rng = (rng * 1664525 + 1013904223) & 0xFFFFFFFF; return (rng >>> 0) / 0xFFFFFFFF; };

  // Find the time range across all symbols (align to 1h grid)
  const firstCandle = [...allCandles.values()][0];
  if (!firstCandle || firstCandle.length < 120) {
    return { id: accountId, startBalance, endBalance: balance, pnl: 0, pnlPct: 0, totalTrades: 0, wins: 0, losses: 0, winRate: 0, maxDrawdown: 0, maxDrawdownPct: 0, avgWin: 0, avgLoss: 0, profitFactor: 0, trades: [] };
  }

  const startTime = firstCandle[0].time;
  const endTime = firstCandle[firstCandle.length - 1].time;
  const oneHour = 3600;

  // Cooldown map: symbol → timestamp when cooldown expires
  const cooldowns = new Map<string, number>();
  const maxOpenTrades = 5;
  const cooldownCandles = 4; // 4 hours
  let dailyTrades = 0;
  let lastDay = -1;

  // Step through each hour
  for (let t = startTime + 120 * oneHour; t <= endTime; t += oneHour) {
    const currentDay = Math.floor(t / 86400);
    if (currentDay !== lastDay) { dailyTrades = 0; lastDay = currentDay; }
    if (dailyTrades >= 6) continue; // daily limit

    // Check open trades for TP/SL hits
    for (const trade of [...trades]) {
      if (trade.closeTime) continue;
      const symCandles = allCandles.get(trade.symbol);
      if (!symCandles) continue;
      const candleIdx = symCandles.findIndex(c => c.time >= t);
      if (candleIdx < 1) continue;
      const c = symCandles[candleIdx];

      let shouldClose = false;
      let reason = '';
      let exitPrice = c.close;

      // Check TP/SL on high/low
      if (trade.direction === 'long') {
        if (c.low <= trade.stopLoss) { shouldClose = true; reason = 'SL'; exitPrice = trade.stopLoss; }
        else if (c.high >= trade.takeProfit) { shouldClose = true; reason = 'TP'; exitPrice = trade.takeProfit; }
      } else {
        if (c.high >= trade.stopLoss) { shouldClose = true; reason = 'SL'; exitPrice = trade.stopLoss; }
        else if (c.low <= trade.takeProfit) { shouldClose = true; reason = 'TP'; exitPrice = trade.takeProfit; }
      }

      // Time exit: 12 hours
      const holdHours = (t - trade.openTime) / oneHour;
      if (!shouldClose && holdHours > 12) {
        const priceChange = trade.direction === 'long'
          ? (c.close - trade.entryPrice) / trade.entryPrice
          : (trade.entryPrice - c.close) / trade.entryPrice;
        if (priceChange < 0) { shouldClose = true; reason = 'Тайм'; exitPrice = c.close; }
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
        totalPnl += trade.pnl;
        balance += trade.amount + trade.pnl;
        if (trade.pnl >= 0) { wins++; winSum += trade.pnl; } else { losses++; lossSum += Math.abs(trade.pnl); }
        // Cooldown on SL/time exit
        if (reason === 'SL' || reason === 'Тайм') {
          cooldowns.set(trade.symbol, t + cooldownCandles * oneHour);
        }
      }
    }

    // Check if we can open new trades
    const openTrades = trades.filter(t => !t.closeTime);
    if (openTrades.length >= maxOpenTrades) continue;
    if (balance < 10) continue;

    // Shuffle symbols with account-specific seed
    const shuffled = [...symbols].sort(() => rand() - 0.5);
    const toScan = shuffled.slice(0, 20);
    const openSymbols = new Set(openTrades.map(t => t.symbol));

    let bestSymbol = '';
    let bestScore = 0;
    let bestDir: 'long' | 'short' | null = null;
    let bestEntryReason = '';

    for (const sym of toScan) {
      if (openSymbols.has(sym)) continue;
      const cd = cooldowns.get(sym);
      if (cd && t < cd) continue;

      const symCandles = allCandles.get(sym);
      if (!symCandles) continue;
      const idx = symCandles.findIndex(c => c.time >= t);
      if (idx < 100) continue;

      // Trim to current point for decision making
      const trimmedCandles = symCandles.slice(0, idx + 1);
      const decision = makeDecision(trimmedCandles, trimmedCandles.length - 1);
      if (decision.direction === 'none') continue;

      // Entry quality
      const eq = assessEntry(trimmedCandles, trimmedCandles.length - 1, decision.direction);
      if (!eq.pass) continue;
      decision.score *= eq.multiplier;
      bestEntryReason = eq.reason;

      // MTF filter (use daily-like: every 24 candles)
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
    const atr = calcATR(symCandles);
    const atrVal = atr[idx];
    if (!atrVal) continue;

    const freeBalance = Math.max(0, balance - openTrades.reduce((s, tr) => s + tr.amount, 0));
    const amount = calcAmount(balance, freeBalance);
    if (amount < 1) continue;

    const slDist = atrVal * 2.5;
    const tpDist = slDist * rr;
    const stopLoss = bestDir === 'long' ? price - slDist : price + slDist;
    const takeProfit = bestDir === 'long' ? price + tpDist : price - tpDist;

    trades.push({
      id: `t${trades.length}`,
      symbol: bestSymbol,
      direction: bestDir,
      entryPrice: price,
      amount,
      leverage,
      stopLoss,
      takeProfit,
      openTime: t,
    });
    balance -= amount;
    dailyTrades++;
  }

  // Close remaining open trades at last price
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
    trade.reason = 'конец';
    totalPnl += trade.pnl;
    balance += trade.amount + trade.pnl;
    if (trade.pnl >= 0) { wins++; winSum += trade.pnl; } else { losses++; lossSum += Math.abs(trade.pnl); }
  }

  const endBalance = balance;
  const pnl = endBalance - startBalance;

  // Max drawdown
  let peak = startBalance;
  let running = startBalance;
  for (const t of trades) {
    if (!t.closeTime) continue;
    running += t.amount + (t.pnl ?? 0);
    if (running > peak) peak = running;
    const dd = peak - running;
    if (dd > maxDrawdown) maxDrawdown = dd;
    const ddPct = peak > 0 ? (dd / peak) * 100 : 0;
    if (ddPct > maxDrawdownPct) maxDrawdownPct = ddPct;
  }

  return {
    id: accountId,
    startBalance,
    endBalance: Math.round(endBalance * 100) / 100,
    pnl: Math.round(pnl * 100) / 100,
    pnlPct: Math.round((pnl / startBalance) * 10000) / 100,
    totalTrades: trades.length,
    wins,
    losses,
    winRate: trades.length > 0 ? Math.round((wins / trades.length) * 1000) / 10 : 0,
    maxDrawdown: Math.round(maxDrawdown * 100) / 100,
    maxDrawdownPct: Math.round(maxDrawdownPct * 10) / 10,
    avgWin: wins > 0 ? Math.round((winSum / wins) * 100) / 100 : 0,
    avgLoss: losses > 0 ? Math.round((lossSum / losses) * 100) / 100 : 0,
    profitFactor: lossSum > 0 ? Math.round((winSum / lossSum) * 100) / 100 : wins > 0 ? 99.99 : 0,
    trades,
  };
}

// ── Main ──
async function main() {
  console.log('━'.repeat(60));
  console.log('  БЭКТЕСТ: 20 аккаунтов × 1 неделя (1H, Momentum)');
  console.log('━'.repeat(60));
  console.log('');

  console.log('Загрузка топ-50 монет...');
  const symbols = await fetchTop50();
  console.log(`  ${symbols.length} монет загружено`);

  console.log('Загрузка свечей (1H, ~200 шт/монету)...');
  const allCandles = new Map<string, Candle[]>();
  let loaded = 0;
  const fetchBatch = async (syms: string[]) => {
    await Promise.all(syms.map(async (sym) => {
      try {
        const c = await fetchCandles(sym, '1h', 200);
        if (c.length > 100) allCandles.set(sym, c);
        loaded++;
        if (loaded % 10 === 0) process.stdout.write(`  \r${loaded}/${syms.length} монет...`);
      } catch { /* skip */ }
    }));
  };
  await fetchBatch(symbols);
  console.log(`\r  Загружено ${allCandles.size} монет со свечами      `);

  // Find actual date range
  const sampleCandles = [...allCandles.values()][0];
  const startDate = new Date(sampleCandles[0].time * 1000);
  const endDate = new Date(sampleCandles[sampleCandles.length - 1].time * 1000);
  const days = Math.round((endDate.getTime() - startDate.getTime()) / 86400000);
  console.log(`  Период: ${startDate.toLocaleDateString('ru')} — ${endDate.toLocaleDateString('ru')} (${days} дней)`);
  console.log('');

  console.log('Запуск 20 аккаунтов...');
  const results: AccountResult[] = [];
  for (let i = 0; i < 20; i++) {
    const startBalance = 1000;
    process.stdout.write(`  Аккаунт ${String(i + 1).padStart(2)}...`);
    const result = await simulateAccount(i + 1, startBalance, allCandles, symbols, 42 + i * 7919);
    results.push(result);
    const emoji = result.pnl >= 0 ? '✅' : '❌';
    console.log(` \r  Аккаунт ${String(i + 1).padStart(2)}: ${result.totalTrades} сделок | ${result.winRate}% винрейт | PnL: ${result.pnl >= 0 ? '+' : ''}$${result.pnl.toFixed(2)} (${result.pnlPct}%) ${emoji}`);
  }

  console.log('');
  console.log('━'.repeat(60));
  console.log('  СВОДНАЯ СТАТИСТИКА');
  console.log('━'.repeat(60));

  const profitable = results.filter(r => r.pnl > 0).length;
  const totalTrades = results.reduce((s, r) => s + r.totalTrades, 0);
  const avgPnl = results.reduce((s, r) => s + r.pnl, 0) / results.length;
  const avgPnlPct = results.reduce((s, r) => s + r.pnlPct, 0) / results.length;
  const avgWinRate = results.reduce((s, r) => s + r.winRate, 0) / results.length;
  const avgDD = results.reduce((s, r) => s + r.maxDrawdownPct, 0) / results.length;
  const avgPF = results.reduce((s, r) => s + r.profitFactor, 0) / results.length;
  const bestPnl = Math.max(...results.map(r => r.pnl));
  const worstPnl = Math.min(...results.map(r => r.pnl));
  const bestWR = Math.max(...results.map(r => r.winRate));
  const worstWR = Math.min(...results.map(r => r.winRate));
  const totalWins = results.reduce((s, r) => s + r.wins, 0);
  const totalLosses = results.reduce((s, r) => s + r.losses, 0);
  const globalWR = totalTrades > 0 ? ((totalWins / totalTrades) * 100).toFixed(1) : '0';

  console.log(`
  Прибыльных:     ${profitable}/20 (${profitable * 5}%)
  Средний PnL:     ${avgPnl >= 0 ? '+' : ''}$${avgPnl.toFixed(2)} (${avgPnlPct}%)`);
  console.log(`  Лучший:         +$${bestPnl.toFixed(2)}
  Худший:         $${worstPnl.toFixed(2)}`);
  console.log(`
  Всего сделок:   ${totalTrades} (${totalWins}W / ${totalLosses}L)
  Глобальный винрейт: ${globalWR}%
  Средний винрейт:  ${avgWinRate.toFixed(1)}% (лучший ${bestWR}%, худший ${worstWR}%)`);
  console.log(`
  Средняя просадка: ${avgDD.toFixed(1)}%
  Средний профит-фактор: ${avgPF.toFixed(2)}`);
  console.log(`  Среднее кол-во сделок/аккаунт: ${(totalTrades / 20).toFixed(1)}`);

  // Distribution
  console.log('\n  Распределение по PnL:');
  const buckets = [-100, -50, -25, -10, 0, 10, 25, 50, 100, 500];
  for (let i = 0; i < buckets.length - 1; i++) {
    const count = results.filter(r => r.pnl >= buckets[i] && r.pnl < buckets[i + 1]).length;
    if (count > 0) {
      const bar = '█'.repeat(count);
      console.log(`    $${String(buckets[i]).padStart(4)} to $${String(buckets[i + 1]).padStart(3)}: ${bar} (${count})`);
    }
  }

  console.log('');
}

main().catch(console.error);
