// ============================================================
// Точная настройка вокруг S0.6(MI6/SL2/RR4) — победитель
// 30 аккаунтов × 500 свечей × ~20 вариаций
// ============================================================

const BINANCE = 'https://api.binance.com/api/v3';

interface Candle {
  time: number;
  open: number; high: number; low: number; close: number; volume: number;
}

interface Config {
  label: string;
  signalThreshold: number;
  minIndicators: number;
  slAtrMult: number;
  rrRatio: number;
  timeExitHours: number;
  maxOpenTrades: number;
  maxDailyTrades: number;
  cooldownHours: number;
  leverage: number;
  entryHardATR: number;
  entrySoftATR: number;
}

interface SimTrade {
  symbol: string;
  direction: 'long' | 'short';
  entryPrice: number; amount: number; leverage: number;
  stopLoss: number; takeProfit: number;
  openTime: number; closeTime?: number; closePrice?: number;
  pnl?: number; reason?: string;
}

function calcEMA(data: number[], period: number): number[] {
  const ema: number[] = [];
  if (data.length < period) return ema;
  const k = 2 / (period + 1);
  let val = data.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = 0; i < period; i++) ema.push(NaN);
  ema[period - 1] = val;
  for (let i = period; i < data.length; i++) { val = data[i] * k + val * (1 - k); ema.push(val); }
  return ema;
}

function calcATR(candles: Candle[], period = 14): number[] {
  const atr: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    if (i === 0) { atr.push(candles[0].high - candles[0].low); continue; }
    const tr = Math.max(candles[i].high - candles[i].low, Math.abs(candles[i].high - candles[i - 1].close), Math.abs(candles[i].low - candles[i - 1].close));
    if (i < period) { atr.push(atr.slice(0, i).reduce((s, v) => s + (isNaN(v) ? 0 : v), 0) / (i + 1)); }
    else { atr.push((atr[i - 1] * (period - 1) + tr) / period); }
  }
  return atr;
}

function calcRSI(closes: number[], period = 14): number[] {
  const rsi: number[] = new Array(closes.length).fill(50);
  if (closes.length <= period) return rsi;
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) { const d = closes[i] - closes[i - 1]; if (d > 0) avgGain += d; else avgLoss -= d; }
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

function makeDecision(candles: Candle[], idx: number, cfg: Config): { direction: 'long' | 'short' | 'none'; score: number } {
  if (idx < 100) return { direction: 'none', score: 0 };
  const closes = candles.map(c => c.close);
  const ema7 = calcEMA(closes, 7), ema25 = calcEMA(closes, 25), ema99 = calcEMA(closes, 99);
  const atr = calcATR(candles), rsi = calcRSI(closes);
  const price = closes[idx];
  const e7 = ema7[idx], e25 = ema25[idx], e99 = ema99[idx];
  const atrVal = atr[idx], rsiVal = rsi[idx];
  if (isNaN(e7) || isNaN(e25) || isNaN(e99) || !atrVal) return { direction: 'none', score: 0 };

  let longScore = 0, shortScore = 0, longCount = 0, shortCount = 0;
  if (price > e7) { longScore += 0.12; longCount++; } else { shortScore += 0.12; shortCount++; }
  if (e7 > e25) { longScore += 0.10; longCount++; } else { shortScore += 0.10; shortCount++; }
  if (e25 > e99) { longScore += 0.10; longCount++; } else { shortScore += 0.10; shortCount++; }
  if (idx >= 3) {
    const mom = (closes[idx] - closes[idx - 3]) / closes[idx - 3];
    if (mom > 0.005) { longScore += 0.08; longCount++; }
    else if (mom < -0.005) { shortScore += 0.08; shortCount++; }
  }
  if (rsiVal < 35) { longScore += 0.15; longCount++; }
  else if (rsiVal > 65) { shortScore += 0.15; shortCount++; }
  const bbUpper = e25 + 2 * atrVal, bbLower = e25 - 2 * atrVal;
  if (price < bbLower) { longScore += 0.12; longCount++; }
  else if (price > bbUpper) { shortScore += 0.12; shortCount++; }
  const volSlice = candles.slice(Math.max(0, idx - 19), idx + 1);
  const avgVol = volSlice.reduce((s, c) => s + c.volume, 0) / volSlice.length;
  if (avgVol > 0 && candles[idx].volume / avgVol > 1.3) {
    if (candles[idx].close > candles[idx].open) { longScore += 0.08; longCount++; }
    else { shortScore += 0.08; shortCount++; }
  }
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
      const plusDI = (plusDM / trSum) * 100, minusDI = (minusDM / trSum) * 100;
      const dx = Math.abs(plusDI - minusDI) / (plusDI + minusDI + 0.001) * 100;
      if (dx > 25) { if (plusDI > minusDI) { longScore += 0.10; longCount++; } else { shortScore += 0.10; shortCount++; } }
    }
  }
  const ema12 = calcEMA(closes, 12), ema26 = calcEMA(closes, 26);
  const macdLine = ema12[idx] - ema26[idx], macdPrev = ema12[idx - 1] - ema26[idx - 1];
  if (!isNaN(macdLine) && !isNaN(macdPrev)) {
    if (macdLine > 0 && macdLine > macdPrev) { longScore += 0.10; longCount++; }
    else if (macdLine < 0 && macdLine < macdPrev) { shortScore += 0.10; shortCount++; }
  }
  const isLong = longScore > shortScore;
  const score = Math.abs(longScore - shortScore);
  const indicatorAgreement = isLong ? longCount : shortCount;
  if (score < cfg.signalThreshold || indicatorAgreement < cfg.minIndicators) return { direction: 'none', score };
  if (isLong && rsiVal > 78) return { direction: 'none', score };
  if (!isLong && rsiVal < 22) return { direction: 'none', score };
  return { direction: isLong ? 'long' : 'short', score: isLong ? longScore : -shortScore };
}

function assessEntry(candles: Candle[], idx: number, direction: 'long' | 'short', cfg: Config): { pass: boolean; multiplier: number } {
  const closes = candles.map(c => c.close);
  const ema20 = calcEMA(closes, 20), atr = calcATR(candles), rsi = calcRSI(closes);
  const e20 = ema20[idx], atrVal = atr[idx], rsiVal = rsi[idx];
  if (isNaN(e20) || !atrVal) return { pass: true, multiplier: 1.0 };
  const extension = direction === 'long' ? (closes[idx] - e20) / atrVal : -(closes[idx] - e20) / atrVal;
  let consecutive = 0;
  for (let i = idx; i >= Math.max(0, idx - 4); i--) {
    const bull = candles[i].close > candles[i].open;
    if ((direction === 'long' && bull) || (direction === 'short' && !bull)) consecutive++; else break;
  }
  if (extension > cfg.entryHardATR) return { pass: false, multiplier: 0 };
  if (consecutive >= 4 && extension > 1.5) return { pass: false, multiplier: 0 };
  if (direction === 'long' && rsiVal > 78) return { pass: false, multiplier: 0 };
  if (direction === 'short' && rsiVal < 22) return { pass: false, multiplier: 0 };
  let mult = 1.0;
  if (extension > cfg.entrySoftATR) mult *= 0.5;
  else if (extension > 1.0) mult *= 0.75;
  if (consecutive >= 3 && extension > 1.0) mult *= 0.7;
  if (extension < 1.0 && extension > -0.5) mult *= 1.15;
  return { pass: mult >= 0.3, multiplier: mult };
}

function mtfFilter(candles: Candle[], direction: 'long' | 'short'): boolean {
  const closes = candles.map(c => c.close);
  const ema50 = calcEMA(closes, 50);
 const price = closes[closes.length - 1];
  const e50 = ema50[ema50.length - 1];
  if (isNaN(e50)) return true;
  return (direction === 'long' && price > e50) || (direction === 'short' && price <= e50);
}

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

async function fetchCandles(symbol: string, interval = '1h', limit = 500): Promise<Candle[]> {
  const res = await fetch(`${BINANCE}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
  if (!res.ok) return [];
  const raw = await res.json();
  return raw.map((k: any) => ({ time: Math.floor(Number(k[0]) / 1000), open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] }));
}

async function fetchTop50(): Promise<string[]> {
  const res = await fetch(`${BINANCE}/ticker/24hr`);
  const data = await res.json();
  return data.filter((t: any) => t.symbol.endsWith('USDT') && Number(t.quoteVolume) > 0).sort((a: any, b: any) => Number(b.quoteVolume) - Number(a.quoteVolume)).slice(0, 50).map((t: any) => t.symbol);
}

async function simulateAccount(
  startBalance: number, allCandles: Map<string, Candle[]>, symbols: string[], seed: number, cfg: Config,
): Promise<{ pnl: number; pnlPct: number; totalTrades: number; wins: number; losses: number; winRate: number; maxDD: number; pf: number }> {
  const trades: SimTrade[] = [];
  let balance = startBalance, peak = balance, maxDD = 0;
  let wins = 0, losses = 0, winSum = 0, lossSum = 0;
  let rng = seed;
  const rand = () => { rng = (rng * 1664525 + 1013904223) & 0xFFFFFFFF; return (rng >>> 0) / 0xFFFFFFFF; };
  const firstCandle = [...allCandles.values()][0];
  if (!firstCandle || firstCandle.length < 130) return { pnl: 0, pnlPct: 0, totalTrades: 0, wins: 0, losses: 0, winRate: 0, maxDD: 0, pf: 0 };
  const startTime = firstCandle[0].time, endTime = firstCandle[firstCandle.length - 1].time;
  const oneHour = 3600;
  const cooldowns = new Map<string, number>();
  let dailyTrades = 0, lastDay = -1;

  for (let t = startTime + 130 * oneHour; t <= endTime; t += oneHour) {
    const currentDay = Math.floor(t / 86400);
    if (currentDay !== lastDay) { dailyTrades = 0; lastDay = currentDay; }
    if (dailyTrades >= cfg.maxDailyTrades) continue;
    for (const trade of [...trades]) {
      if (trade.closeTime) continue;
      const symCandles = allCandles.get(trade.symbol); if (!symCandles) continue;
      const candleIdx = symCandles.findIndex(c => c.time >= t); if (candleIdx < 1) continue;
      const c = symCandles[candleIdx];
      let shouldClose = false, reason = '', exitPrice = c.close;
      if (trade.direction === 'long') {
        if (c.low <= trade.stopLoss) { shouldClose = true; reason = 'SL'; exitPrice = trade.stopLoss; }
        else if (c.high >= trade.takeProfit) { shouldClose = true; reason = 'TP'; exitPrice = trade.takeProfit; }
      } else {
        if (c.high >= trade.stopLoss) { shouldClose = true; reason = 'SL'; exitPrice = trade.stopLoss; }
        else if (c.low <= trade.takeProfit) { shouldClose = true; reason = 'TP'; exitPrice = trade.takeProfit; }
      }
      const holdHours = (t - trade.openTime) / oneHour;
      if (!shouldClose && holdHours > cfg.timeExitHours) {
        const pc = trade.direction === 'long' ? (c.close - trade.entryPrice) / trade.entryPrice : (trade.entryPrice - c.close) / trade.entryPrice;
        if (pc < 0) { shouldClose = true; reason = 'TIME'; exitPrice = c.close; }
      }
      if (shouldClose) {
        trade.closeTime = t; trade.closePrice = exitPrice;
        const pc = trade.direction === 'long' ? (exitPrice - trade.entryPrice) / trade.entryPrice : (trade.entryPrice - exitPrice) / trade.entryPrice;
        const fees = trade.amount * 0.001 + (trade.amount / trade.leverage) * 0.001;
        trade.pnl = trade.amount * pc * trade.leverage - fees; trade.reason = reason;
        balance += trade.amount + trade.pnl;
        if (balance > peak) peak = balance;
        const dd = peak - balance; if (dd > maxDD) maxDD = dd;
        if (trade.pnl >= 0) { wins++; winSum += trade.pnl; } else { losses++; lossSum += Math.abs(trade.pnl); }
        if (reason === 'SL' || reason === 'TIME') cooldowns.set(trade.symbol, t + cfg.cooldownHours * oneHour);
      }
    }
    const openTrades = trades.filter(t => !t.closeTime);
    if (openTrades.length >= cfg.maxOpenTrades || balance < 10) continue;
    const shuffled = [...symbols].sort(() => rand() - 0.5).slice(0, 20);
    const openSymbols = new Set(openTrades.map(t => t.symbol));
    let bestSymbol = '', bestScore = 0, bestDir: 'long' | 'short' | null = null;
    for (const sym of shuffled) {
      if (openSymbols.has(sym)) continue;
      const cd = cooldowns.get(sym); if (cd && t < cd) continue;
      const symCandles = allCandles.get(sym); if (!symCandles) continue;
      const idx = symCandles.findIndex(c => c.time >= t); if (idx < 100) continue;
      const trimmed = symCandles.slice(0, idx + 1);
      const decision = makeDecision(trimmed, trimmed.length - 1, cfg);
      if (decision.direction === 'none') continue;
      const eq = assessEntry(trimmed, trimmed.length - 1, decision.direction, cfg);
      if (!eq.pass) continue;
      decision.score *= eq.multiplier;
      if (trimmed.length >= 50) {
        const mtfCandles = trimmed.filter((_, i) => i % 24 === 0 || i === trimmed.length - 1);
        if (!mtfFilter(mtfCandles, decision.direction)) continue;
      }
      if (Math.abs(decision.score) > bestScore) { bestScore = Math.abs(decision.score); bestSymbol = sym; bestDir = decision.direction; }
    }
    if (!bestDir || !bestSymbol) continue;
    const symCandles = allCandles.get(bestSymbol)!;
    const idx = symCandles.findIndex(c => c.time >= t);
    const price = symCandles[idx].close;
    const atrArr = calcATR(symCandles); const atrVal = atrArr[idx]; if (!atrVal) continue;
    const freeBalance = Math.max(0, balance - openTrades.reduce((s, tr) => s + tr.amount, 0));
    const amount = calcAmount(balance, freeBalance); if (amount < 1) continue;
    const slDist = atrVal * cfg.slAtrMult;
    const tpDist = slDist * cfg.rrRatio;
    const stopLoss = bestDir === 'long' ? price - slDist : price + slDist;
    const takeProfit = bestDir === 'long' ? price + tpDist : price - tpDist;
    trades.push({ symbol: bestSymbol, direction: bestDir, entryPrice: price, amount, leverage: cfg.leverage, stopLoss, takeProfit, openTime: t });
    balance -= amount; dailyTrades++;
  }
  for (const trade of trades) {
    if (trade.closeTime) continue;
    const symCandles = allCandles.get(trade.symbol); if (!symCandles) continue;
    const lastPrice = symCandles[symCandles.length - 1].close;
    const pc = trade.direction === 'long' ? (lastPrice - trade.entryPrice) / trade.entryPrice : (trade.entryPrice - lastPrice) / trade.entryPrice;
    const fees = trade.amount * 0.001 + (trade.amount / trade.leverage) * 0.001;
    trade.pnl = trade.amount * pc * trade.leverage - fees;
    trade.closeTime = endTime; trade.closePrice = lastPrice; trade.reason = 'END';
    balance += trade.amount + trade.pnl;
    if (balance > peak) peak = balance;
    const dd = peak - balance; if (dd > maxDD) maxDD = dd;
    if (trade.pnl >= 0) { wins++; winSum += trade.pnl; } else { losses++; lossSum += Math.abs(trade.pnl); }
  }
  const pnl = balance - startBalance;
  return {
    pnl: Math.round(pnl * 100) / 100, pnlPct: Math.round((pnl / startBalance) * 10000) / 100,
    totalTrades: trades.length, wins, losses,
    winRate: trades.length > 0 ? Math.round((wins / trades.length) * 1000) / 10 : 0,
    maxDD: Math.round((maxDD / startBalance) * 1000) / 10,
    pf: lossSum > 0 ? Math.round((winSum / lossSum) * 100) / 100 : wins > 0 ? 99.99 : 0,
  };
}

// ── Generate fine-grained configs around S0.6 ──
function generateConfigs(): Config[] {
  const configs: Config[] = [];

  // BASE: the proven winner
  const base = { signalThreshold: 0.60, minIndicators: 6, slAtrMult: 2.0, rrRatio: 4, timeExitHours: 12, maxOpenTrades: 5, maxDailyTrades: 6, cooldownHours: 4, leverage: 3, entryHardATR: 3.0, entrySoftATR: 2.0 };
  configs.push({ label: 'WINNER_S0.6', ...base });

  // ── Fine-grained threshold sweep ──
  for (const s of [0.55, 0.58, 0.62, 0.65, 0.70]) {
    configs.push({ label: `S${s}`, ...base, signalThreshold: s });
  }

  // ── Combine S0.6 with best params from sweep ──
  // S0.6 + RR5
  configs.push({ label: 'S0.6_RR5', ...base, rrRatio: 5 });
  // S0.6 + SL1.5 (was #2 in sweep)
  configs.push({ label: 'S0.6_SL1.5', ...base, slAtrMult: 1.5 });
  // S0.6 + MD4 (better than MD6)
  configs.push({ label: 'S0.6_MD4', ...base, maxDailyTrades: 4 });
  // S0.6 + TE16h
  configs.push({ label: 'S0.6_TE16h', ...base, timeExitHours: 16 });
  // S0.6 + LEV2
  configs.push({ label: 'S0.6_LEV2', ...base, leverage: 2 });

  // ── S0.6 + RR5 + MD4 (combine best) ──
  configs.push({ label: 'S0.6_RR5_MD4', ...base, rrRatio: 5, maxDailyTrades: 4 });
  // ── S0.6 + SL1.5 + RR5 ──
  configs.push({ label: 'S0.6_SL1.5_RR5', ...base, slAtrMult: 1.5, rrRatio: 5 });
  // ── S0.6 + TE16h + MD4 ──
  configs.push({ label: 'S0.6_TE16h_MD4', ...base, timeExitHours: 16, maxDailyTrades: 4 });

  // ── ULTRA CONSERVATIVE: S0.65 + MI6 + SL2 + RR5 + MD3 + LEV2 ──
  configs.push({ label: 'ULTRA_CONS', ...base, signalThreshold: 0.65, rrRatio: 5, maxDailyTrades: 3, leverage: 2, maxOpenTrades: 3 });

  // ── SWEET SPOT hypothesis: S0.58 + SL2 + RR4 + MD4 + TE14h ──
  configs.push({ label: 'SWEET_S0.58', ...base, signalThreshold: 0.58, maxDailyTrades: 4, timeExitHours: 14 });

  // ── High quality, fewer trades: S0.6 + MI7 + MD3 ──
  configs.push({ label: 'S0.6_MI7_MD3', ...base, minIndicators: 7, maxDailyTrades: 3, maxOpenTrades: 3 });

  // ── Best combo from sweep: S0.6 + SL1.5 + MD4 + TE14h ──
  configs.push({ label: 'BEST_COMBO', ...base, slAtrMult: 1.5, maxDailyTrades: 4, timeExitHours: 14 });

  return configs;
}

async function main() {
  const nAccounts = 30;
  console.log('━'.repeat(70));
  console.log(`  ТОЧНАЯ НАСТРОЙКА: 30 аккаунтов × 500 свечей × ~20 конфигов`);
  console.log('━'.repeat(70));

  console.log('Загрузка топ-50 монет...');
  const symbols = await fetchTop50();
  console.log(`  ${symbols.length} монет`);

  console.log('Загрузка свечей (1H, 500)...');
  const allCandles = new Map<string, Candle[]>();
  let loaded = 0;
  await Promise.all(symbols.map(async (sym) => {
    try { const c = await fetchCandles(sym, '1h', 500); if (c.length > 100) allCandles.set(sym, c); loaded++; if (loaded % 10 === 0) process.stdout.write(`\r  ${loaded}/${symbols.length}...`); } catch {}
  }));
  console.log(`\r  ${allCandles.size} монет загружено    `);

  const sample = [...allCandles.values()][0];
 const days = Math.round((sample[sample.length - 1].time - sample[0].time) / 86400);
  console.log(`  Период: ${days} дней (${new Date(sample[0].time * 1000).toLocaleDateString('ru')} — ${new Date(sample[sample.length - 1].time * 1000).toLocaleDateString('ru')})\n`);

  const configs = generateConfigs();
  console.log(`Запуск ${configs.length} конфигов × ${nAccounts} аккаунтов...\n`);

  const results: Array<{ label: string; avgPnl: number; avgPnlPct: number; profitablePct: number; avgWR: number; avgPF: number; avgDD: number; avgTrades: number; minPnl: number; maxPnl: number; medianPnl: number }> = [];

  for (let ci = 0; ci < configs.length; ci++) {
    const cfg = configs[ci];
    const pnls: number[] = [];
    let sumPnl = 0, sumPct = 0, sumWR = 0, sumPF = 0, sumDD = 0, sumTrades = 0, profitable = 0;

    process.stdout.write(`[${String(ci + 1).padStart(2)}/${configs.length}] ${cfg.label.padEnd(20)} `);

    for (let i = 0; i < nAccounts; i++) {
      const r = await simulateAccount(1000, allCandles, symbols, 42 + i * 7919, cfg);
      pnls.push(r.pnl);
      sumPnl += r.pnl; sumPct += r.pnlPct; sumWR += r.winRate; sumPF += r.pf; sumDD += r.maxDD; sumTrades += r.totalTrades;
      if (r.pnl > 0) profitable++;
    }

    pnls.sort((a, b) => a - b);
    results.push({
      label: cfg.label,
      avgPnl: sumPnl / nAccounts, avgPnlPct: sumPct / nAccounts,
      profitablePct: Math.round((profitable / nAccounts) * 100),
      avgWR: sumWR / nAccounts, avgPF: sumPF / nAccounts,
      avgDD: sumDD / nAccounts, avgTrades: sumTrades / nAccounts,
      minPnl: pnls[0], maxPnl: pnls[pnls.length - 1],
      medianPnl: pnls[Math.floor(pnls.length / 2)],
    });

    const r = results[results.length - 1];
    const emoji = r.avgPnl >= 0 ? '✅' : '❌';
    console.log(`\r[${String(ci + 1).padStart(2)}/${configs.length}] ${cfg.label.padEnd(20)} PnL:${r.avgPnl >= 0 ? '+' : ''}$${r.avgPnl.toFixed(1).padStart(7)} | ${r.profitablePct}%выб | WR:${r.avgWR.toFixed(0).padStart(3)}% | PF:${r.avgPF.toFixed(2)} | DD:${r.avgDD.toFixed(1)}% | Мед:${r.medianPnl >= 0 ? '+' : ''}$${r.medianPnl.toFixed(1)} | [${r.minPnl >= 0 ? '+' : ''}$${r.minPnl.toFixed(0)}...${r.maxPnl >= 0 ? '+' : ''}$${r.maxPnl.toFixed(0)}] ${emoji}`);
  }

  console.log('\n' + '━'.repeat(70));
  console.log('  РАНЖИРОВАНИЕ (composite: PnL*2 + profitable% - DD*1.5 + PF*5)');
  console.log('━'.repeat(70) + '\n');

  results.sort((a, b) => {
    const scoreA = a.avgPnlPct * 2 + a.profitablePct - a.avgDD * 1.5 + a.avgPF * 5;
    const scoreB = b.avgPnlPct * 2 + b.profitablePct - b.avgDD * 1.5 + b.avgPF * 5;
    return scoreB - scoreA;
  });

  results.forEach((r, i) => {
    const score = r.avgPnlPct * 2 + r.profitablePct - r.avgDD * 1.5 + r.avgPF * 5;
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '  ';
    console.log(`${medal} #${String(i + 1).padStart(2)} ${r.label.padEnd(20)} PnL:${r.avgPnl >= 0 ? '+' : ''}$${r.avgPnl.toFixed(1).padStart(7)} (${r.avgPnlPct >= 0 ? '+' : ''}${r.avgPnlPct.toFixed(1)}%) | ${r.profitablePct}%выб | WR:${r.avgWR.toFixed(0)}% | PF:${r.avgPF.toFixed(2)} | DD:${r.avgDD.toFixed(1)}% | Med:${r.medianPnl >= 0 ? '+' : ''}$${r.medianPnl.toFixed(1)} | Score:${score.toFixed(1)}`);
  });

  console.log('\n' + '━'.repeat(70));
  console.log('  ЛУЧШИЙ КОНФИГ → применить к production');
  console.log('━'.repeat(70));
  const best = results[0];
  console.log(`  ${best.label}: S=${best.label} PnL +$${best.avgPnl.toFixed(1)} (${best.avgPnlPct}%), ${best.profitablePct}% прибыльных, PF ${best.avgPF.toFixed(2)}`);
}

main().catch(console.error);
