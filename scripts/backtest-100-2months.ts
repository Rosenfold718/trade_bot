// ============================================================
// Бэктест: 100 аккаунтов × 2 месяца
// Реальные свечи Binance, все 3 стратегии (Momentum, Pattern Pro, Position Alpha)
// Результаты сохраняются в БД под user_id = 'backtest_100'
// ============================================================

import { createClient } from '@libsql/client';
import { makeStrategyDecision, fetchKlines, fetchTopSymbols } from '../src/lib/trading-engine';
import type { CandleData } from '../src/lib/types';

const BINANCE = 'https://api.binance.com/api/v3';
const BACKTEST_USER_ID = 'backtest_100';

interface SimTrade {
  id: string;
  symbol: string;
  strategyId: string;
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

interface AccountResult {
  id: number;
  strategyId: string;
  startBalance: number;
  endBalance: number;
  pnl: number;
  pnlPct: number;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  maxDrawdownPct: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  trades: SimTrade[];
}

// Fetch candles for backtest (Binance allows max 1500 per request)
async function fetchCandlesBacktest(symbol: string, interval: string, startTime: number, endTime: number): Promise<CandleData[]> {
  const allCandles: CandleData[] = [];
  let currentStart = startTime;

  while (currentStart < endTime) {
    const url = `${BINANCE}/klines?symbol=${symbol}&interval=${interval}&startTime=${currentStart}&endTime=${endTime}&limit=1500`;
    const res = await fetch(url);
    if (!res.ok) break;
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) break;

    for (const k of data) {
      allCandles.push({
        time: Math.floor(Number(k[0]) / 1000),
        open: parseFloat(String(k[1])),
        high: parseFloat(String(k[2])),
        low: parseFloat(String(k[3])),
        close: parseFloat(String(k[4])),
        volume: parseFloat(String(k[5])),
      });
    }

    currentStart = Number(data[data.length - 1][6]) + 1; // closeTime + 1ms
    if (data.length < 1500) break;
  }

  return allCandles;
}

// Position sizing
function calcAmount(balance: number, freeBalance: number, tradeSizePct: number): number {
  const maxByBalance = freeBalance * Math.min(tradeSizePct, 0.5);
  let amount: number;
  if (freeBalance < 200) amount = Math.max(1.5, Math.min(freeBalance * 0.08, 8));
  else if (freeBalance < 1000) amount = Math.max(5, Math.min(freeBalance * 0.05, 50));
  else if (freeBalance < 5000) amount = Math.max(20, Math.min(freeBalance * 0.03, 150));
  else amount = Math.max(50, Math.min(freeBalance * 0.02, 500));
  amount = Math.min(amount, maxByBalance);
  return Math.round(amount * 100) / 100;
}

const STRATEGIES = [
  { id: 'momentum', interval: '1h', candleLimit: 1440, maxOpen: 5, cooldownCandles: 3, maxDaily: 5, maxHoldHours: 8, tradeSizePct: 0.10 },
  { id: 'scalper', interval: '15m', candleLimit: 500, maxOpen: 5, cooldownCandles: 3, maxDaily: 8, maxHoldHours: 8, tradeSizePct: 0.08 },
  { id: 'position-alpha', interval: '4h', candleLimit: 500, maxOpen: 3, cooldownCandles: 2, maxDaily: 2, maxHoldHours: 168, tradeSizePct: 0.06 },
];

async function simulateAccount(
  accountId: number,
  strategyConfig: typeof STRATEGIES[0],
  startBalance: number,
  allCandles: Map<string, CandleData[]>,
  symbols: string[],
  seed: number,
  startTime: number,
  endTime: number,
): Promise<AccountResult> {
  const trades: SimTrade[] = [];
  let balance = startBalance;
  let maxBalance = balance;
  let maxDrawdownPct = 0;
  let totalPnl = 0;
  let wins = 0, losses = 0;
  let winSum = 0, lossSum = 0;

  // Seeded random
  let rng = seed;
  const rand = () => { rng = (rng * 1664525 + 1013904223) & 0xFFFFFFFF; return (rng >>> 0) / 0xFFFFFFFF; };

  const intervalSeconds = strategyConfig.interval === '15m' ? 900 : strategyConfig.interval === '4h' ? 14400 : 3600;
  const cooldowns = new Map<string, number>();
  let dailyTrades = 0;
  let lastDay = -1;
  const warmupCandles = strategyConfig.id === 'position-alpha' ? 250 : 120;

  for (let t = startTime + warmupCandles * intervalSeconds; t <= endTime; t += intervalSeconds) {
    const currentDay = Math.floor(t / 86400);
    if (currentDay !== lastDay) { dailyTrades = 0; lastDay = currentDay; }
    if (dailyTrades >= strategyConfig.maxDaily) continue;

    // Check open trades for TP/SL
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

      if (trade.direction === 'long') {
        if (c.low <= trade.stopLoss) { shouldClose = true; reason = 'SL'; exitPrice = trade.stopLoss; }
        else if (c.high >= trade.takeProfit) { shouldClose = true; reason = 'TP'; exitPrice = trade.takeProfit; }
      } else {
        if (c.high >= trade.stopLoss) { shouldClose = true; reason = 'SL'; exitPrice = trade.stopLoss; }
        else if (c.low <= trade.takeProfit) { shouldClose = true; reason = 'TP'; exitPrice = trade.takeProfit; }
      }

      const holdHours = (t - trade.openTime) / 3600;
      if (!shouldClose && holdHours > strategyConfig.maxHoldHours) {
        shouldClose = true;
        reason = 'Тайм';
        exitPrice = c.close;
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
        if (reason === 'SL' || reason === 'Тайм') {
          cooldowns.set(trade.symbol, t + strategyConfig.cooldownCandles * intervalSeconds);
        }
      }
    }

    const openTrades = trades.filter(tr => !tr.closeTime);
    if (openTrades.length >= strategyConfig.maxOpen) continue;
    if (balance < 5) continue;

    // Shuffle symbols with account-specific seed
    const shuffled = [...symbols].sort(() => rand() - 0.5);
    const toScan = shuffled.slice(0, 20);
    const openSymbols = new Set(openTrades.map(tr => tr.symbol));

    let bestSymbol = '';
    let bestScore = 0;
    let bestDir: 'long' | 'short' | null = null;
    let bestLev = 1;
    let bestSL = 0;
    let bestTP = 0;

    for (const sym of toScan) {
      if (openSymbols.has(sym)) continue;
      const cd = cooldowns.get(sym);
      if (cd && t < cd) continue;

      const symCandles = allCandles.get(sym);
      if (!symCandles) continue;
      const idx = symCandles.findIndex(c => c.time >= t);
      if (idx < warmupCandles) continue;

      const trimmedCandles = symCandles.slice(0, idx + 1);
      try {
        const decision = makeStrategyDecision(strategyConfig.id, sym, trimmedCandles);
        if (decision.direction === 'none') continue;

        const absScore = Math.abs(decision.score);
        if (absScore > bestScore) {
          bestScore = absScore;
          bestSymbol = sym;
          bestDir = decision.direction;
          bestLev = decision.leverage;
          bestSL = decision.stopLoss;
          bestTP = decision.takeProfit;
        }
      } catch {
        continue;
      }
    }

    if (!bestDir || !bestSymbol || bestSL === 0 || bestTP === 0) continue;

    const symCandles = allCandles.get(bestSymbol)!;
    const idx = symCandles.findIndex(c => c.time >= t);
    const price = symCandles[idx].close;

    const freeBalance = Math.max(0, balance - openTrades.reduce((s, tr) => s + tr.amount, 0));
    const amount = calcAmount(balance, freeBalance, strategyConfig.tradeSizePct);
    if (amount < 1) continue;

    trades.push({
      id: `bt_${accountId}_t${trades.length}`,
      symbol: bestSymbol,
      strategyId: strategyConfig.id,
      direction: bestDir,
      entryPrice: price,
      amount,
      leverage: bestLev,
      stopLoss: bestSL,
      takeProfit: bestTP,
      openTime: t,
    });
    balance -= amount;
    dailyTrades++;
  }

  // Close remaining open trades
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

  // Max drawdown
  let peak = startBalance;
  let running = startBalance;
  for (const tr of trades) {
    if (!tr.closeTime) continue;
    running += tr.amount + (tr.pnl ?? 0);
    if (running > peak) peak = running;
    const ddPct = peak > 0 ? ((peak - running) / peak) * 100 : 0;
    if (ddPct > maxDrawdownPct) maxDrawdownPct = ddPct;
  }

  return {
    id: accountId,
    strategyId: strategyConfig.id,
    startBalance,
    endBalance: Math.round(balance * 100) / 100,
    pnl: Math.round((balance - startBalance) * 100) / 100,
    pnlPct: Math.round(((balance - startBalance) / startBalance) * 10000) / 100,
    totalTrades: trades.length,
    wins, losses,
    winRate: trades.length > 0 ? Math.round((wins / trades.length) * 1000) / 10 : 0,
    maxDrawdownPct: Math.round(maxDrawdownPct * 10) / 10,
    avgWin: wins > 0 ? Math.round((winSum / wins) * 100) / 100 : 0,
    avgLoss: losses > 0 ? Math.round((lossSum / losses) * 100) / 100 : 0,
    profitFactor: lossSum > 0 ? Math.round((winSum / lossSum) * 100) / 100 : wins > 0 ? 99.99 : 0,
    trades,
  };
}

async function saveToDB(result: AccountResult, db: any) {
  const userId = BACKTEST_USER_ID;

  // Create trader_state entry
  await db.execute({
    sql: `INSERT OR REPLACE INTO trader_state (id, user_id, strategy_id, balance, borrowed_funds, debt_to_repay, is_active, initial_balance, updated_at)
           VALUES (?, ?, ?, ?, 0, 0, 0, ?, datetime('now'))`,
    args: [`bt_state_${result.id}`, userId, result.strategyId, result.endBalance, result.startBalance],
  });

  // Insert trades
  for (const trade of result.trades) {
    const openDate = new Date(trade.openTime * 1000).toISOString();
    const closeDate = trade.closeTime ? new Date(trade.closeTime * 1000).toISOString() : null;
    await db.execute({
      sql: `INSERT OR REPLACE INTO trades (id, user_id, symbol, strategy_id, entry_price, exit_price, amount, leverage, direction, pnl, status, stop_loss, take_profit, opened_at, closed_at, remaining_amount, entry_quality, partial_state)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 'full')`,
      args: [
        trade.id, userId, trade.symbol, trade.strategyId,
        trade.entryPrice, trade.closePrice ?? null, trade.amount, trade.leverage, trade.direction,
        trade.pnl ?? null, trade.closeTime ? 'closed' : 'open',
        trade.stopLoss, trade.takeProfit, openDate, closeDate, null,
      ],
    });
  }
}

async function main() {
  console.log('━'.repeat(70));
  console.log('  БЭКТЕСТ: 100 аккаунтов × 2 месяца (все 3 стратегии)');
  console.log('━'.repeat(70));

  // Time range: 2 months ago to now
  const endTime = Math.floor(Date.now() / 1000);
  const startTime = endTime - 60 * 86400; // 60 days

  // Connect to DB
  const dbUrl = process.env.TURSO_DATABASE_URL;
  const dbToken = process.env.TURSO_AUTH_TOKEN;
  if (!dbUrl || !dbToken) {
    console.error('Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN');
    process.exit(1);
  }
  const db = createClient({ url: dbUrl, authToken: dbToken });

  // Clean old backtest data
  console.log('Очистка старых данных бэктеста...');
  await db.execute({ sql: `DELETE FROM trades WHERE user_id = ?`, args: [BACKTEST_USER_ID] });
  await db.execute({ sql: `DELETE FROM trader_state WHERE user_id = ?`, args: [BACKTEST_USER_ID] });
  console.log('  Очищено.');

  // Fetch top symbols
  console.log('Загрузка топ-50 монет...');
  const symbols = await fetchTopSymbols();
  console.log(`  ${symbols.length} монет`);

  // Fetch candles for all symbols and all intervals
  const allCandles = new Map<string, CandleData[]>();
  const intervals = new Set(STRATEGIES.map(s => s.interval));

  for (const interval of intervals) {
    console.log(`\nЗагрузка свечей (${interval}, 60 дней)...`);
    let loaded = 0;
    const batch = async (syms: string[]) => {
      await Promise.all(syms.map(async (sym) => {
        try {
          const key = `${sym}_${interval}`;
          const c = await fetchCandlesBacktest(sym, interval, startTime * 1000, endTime * 1000);
          if (c.length > 100) {
            allCandles.set(key, c);
          }
          loaded++;
          if (loaded % 10 === 0) process.stdout.write(`  \r${loaded}/${syms.length} монет (${interval})...`);
        } catch { /* skip */ }
      }));
    };
    await batch(symbols);
    console.log(`\r  ${allCandles.size} загружено (${interval})        `);
  }

  // Find date range from 1h candles
  const sampleCandles = allCandles.get(`${symbols[0]}_1h`);
  const startDate = sampleCandles ? new Date(sampleCandles[0].time * 1000) : new Date(startTime * 1000);
  const endDate = new Date(endTime * 1000);
  console.log(`\nПериод: ${startDate.toLocaleDateString('ru')} — ${endDate.toLocaleDateString('ru')}`);

  // Run 100 accounts: ~34 per strategy
  const results: AccountResult[] = [];
  const accountsPerStrategy = 34;

  for (let si = 0; si < STRATEGIES.length; si++) {
    const strat = STRATEGIES[si];
    const interval = strat.interval;
    const stratCandles = new Map<string, CandleData[]>();
    for (const sym of symbols) {
      const c = allCandles.get(`${sym}_${interval}`);
      if (c) stratCandles.set(sym, c);
    }

    console.log(`\n🚀 ${strat.id} (${strat.interval}): ${accountsPerStrategy} аккаунтов...`);
    for (let i = 0; i < accountsPerStrategy; i++) {
      const accId = si * accountsPerStrategy + i + 1;
      process.stdout.write(`  Аккаунт ${String(accId).padStart(3)}/100...`);
      const result = await simulateAccount(
        accId, strat, 100, stratCandles, symbols, 42 + accId * 7919, startTime, endTime
      );
      results.push(result);
      const emoji = result.pnl >= 0 ? '✅' : '❌';
      console.log(` \r  Аккаунт ${String(accId).padStart(3)}/100: ${result.totalTrades} сделок | ${result.winRate}% WR | PnL: ${result.pnl >= 0 ? '+' : ''}${result.pnlPct}% ${emoji}`);
    }
  }

  // Save best account to DB (top 1 by PnL)
  const bestResult = [...results].sort((a, b) => b.pnlPct - a.pnlPct)[0];
  console.log(`\n💾 Сохранение лучшего результата (аккаунт #${bestResult.id}, ${bestResult.strategyId}) в БД...`);
  await saveToDB(bestResult, db);
  console.log(`  Сохранено: ${bestResult.totalTrades} сделок, PnL: ${bestResult.pnl >= 0 ? '+' : ''}${bestResult.pnlPct}%`);

  // Also save median account
  const sorted = [...results].sort((a, b) => a.pnlPct - b.pnlPct);
  const medianResult = sorted[Math.floor(sorted.length / 2)];
  console.log(`💾 Сохранение медианного результата (аккаунт #${medianResult.id}, ${medianResult.strategyId})...`);
  // Save median under a different user_id
  const medianUserId = 'backtest_100_median';
  await db.execute({ sql: `DELETE FROM trades WHERE user_id = ?`, args: [medianUserId] });
  await db.execute({ sql: `DELETE FROM trader_state WHERE user_id = ?`, args: [medianUserId] });
  await db.execute({
    sql: `INSERT OR REPLACE INTO trader_state (id, user_id, strategy_id, balance, borrowed_funds, debt_to_repay, is_active, initial_balance, updated_at)
           VALUES (?, ?, ?, ?, 0, 0, 0, ?, datetime('now'))`,
    args: [`bt_state_median`, medianUserId, medianResult.strategyId, medianResult.endBalance, medianResult.startBalance],
  });
  for (const trade of medianResult.trades) {
    const openDate = new Date(trade.openTime * 1000).toISOString();
    const closeDate = trade.closeTime ? new Date(trade.closeTime * 1000).toISOString() : null;
    await db.execute({
      sql: `INSERT OR REPLACE INTO trades (id, user_id, symbol, strategy_id, entry_price, exit_price, amount, leverage, direction, pnl, status, stop_loss, take_profit, opened_at, closed_at, remaining_amount, entry_quality, partial_state)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 'full')`,
      args: [
        `med_${trade.id}`, medianUserId, trade.symbol, trade.strategyId,
        trade.entryPrice, trade.closePrice ?? null, trade.amount, trade.leverage, trade.direction,
        trade.pnl ?? null, trade.closeTime ? 'closed' : 'open',
        trade.stopLoss, trade.takeProfit, openDate, closeDate, null,
      ],
    });
  }
  console.log(`  Сохранено: ${medianResult.totalTrades} сделок, PnL: ${medianResult.pnl >= 0 ? '+' : ''}${medianResult.pnlPct}%`);

  // Summary
  console.log('\n' + '━'.repeat(70));
  console.log('  СВОДНАЯ СТАТИСТИКА (100 аккаунтов × 2 месяца)');
  console.log('━'.repeat(70));

  const profitable = results.filter(r => r.pnl > 0).length;
  const totalTrades = results.reduce((s, r) => s + r.totalTrades, 0);
  const avgPnlPct = results.reduce((s, r) => s + r.pnlPct, 0) / results.length;
  const avgWinRate = results.reduce((s, r) => s + r.winRate, 0) / results.length;
  const avgDD = results.reduce((s, r) => s + r.maxDrawdownPct, 0) / results.length;
  const totalWins = results.reduce((s, r) => s + r.wins, 0);
  const totalLosses = results.reduce((s, r) => s + r.losses, 0);
  const globalWR = totalTrades > 0 ? ((totalWins / totalTrades) * 100).toFixed(1) : '0';

  // Per-strategy stats
  for (const strat of STRATEGIES) {
    const sr = results.filter(r => r.strategyId === strat.id);
    const sp = sr.filter(r => r.pnl > 0).length;
    const avgP = sr.reduce((s, r) => s + r.pnlPct, 0) / sr.length;
    const avgW = sr.reduce((s, r) => s + r.winRate, 0) / sr.length;
    console.log(`\n  📊 ${strat.id.toUpperCase()} (${strat.interval}):`);
    console.log(`     Прибыльных: ${sp}/${sr.length} | Средний PnL: ${avgP >= 0 ? '+' : ''}${avgP.toFixed(1)}% | Средний WR: ${avgW.toFixed(1)}%`);
  }

  console.log(`\n  ── ОБЩЕЕ ──`);
  console.log(`  Прибыльных аккаунтов: ${profitable}/100 (${profitable}%)`);
  console.log(`  Средний PnL: ${avgPnlPct >= 0 ? '+' : ''}${avgPnlPct.toFixed(1)}%`);
  console.log(`  Лучший: +${Math.max(...results.map(r => r.pnlPct)).toFixed(1)}%`);
  console.log(`  Худший: ${Math.min(...results.map(r => r.pnlPct)).toFixed(1)}%`);
  console.log(`  Всего сделок: ${totalTrades} (${totalWins}W / ${totalLosses}L)`);
  console.log(`  Глобальный винрейт: ${globalWR}%`);
  console.log(`  Средняя просадка: ${avgDD.toFixed(1)}%`);

  // PnL distribution
  console.log('\n  Распределение по PnL%:');
  const buckets = [-100, -50, -25, -10, 0, 10, 25, 50, 100, 500];
  for (let i = 0; i < buckets.length - 1; i++) {
    const count = results.filter(r => r.pnlPct >= buckets[i] && r.pnlPct < buckets[i + 1]).length;
    if (count > 0) {
      console.log(`    ${String(buckets[i]).padStart(4)}% to ${String(buckets[i + 1]).padStart(4)}%: ${'█'.repeat(count)} (${count})`);
    }
  }

  console.log('\n✅ Бэктест завершён. Данные сохранены в БД.');
  console.log(`   Лучший аккаунт → user_id: ${BACKTEST_USER_ID}`);
  console.log(`   Медианный аккаунт → user_id: ${medianUserId}`);
}

main().catch(console.error);
