import { NextRequest, NextResponse } from 'next/server';
import { initDB, getTraderState, getOpenTrades, getRecentTrades, getIndicatorWeights } from '@/lib/db';
import { getAuthUserId } from '@/lib/auth-helpers';
import { makeStrategyDecision, fetchKlines } from '@/lib/trading-engine';
import type { Trade } from '@/lib/types';
import { getStrategy } from '@/lib/strategies';

// Per-strategy descriptions for reports
const STRATEGY_DESCRIPTIONS: Record<string, {
  philosophy: string;
  entryRules: string[];
  exitRules: string[];
  riskManagement: string[];
}> = {
  momentum: {
    philosophy: 'Следование за сильным трендом на основе мультивременframe-анализа и консенсуса 10 технических индикаторов.',
    entryRules: [
      'ADX > 25 — требуется сильный тренд, флэт торговля запрещена',
      '≥6 из 10 индикаторов должны согласованно указывать одно направление',
      'Score ≥ 0.35 — порог конfluence для входа',
      'RSI < 78 для Long и RSI > 22 для Short — фильтр истощения тренда',
      'Мульти-таймфрейм подтверждение (MTF enabled)',
    ],
    exitRules: [
      'Стоп-лосс: 2.5× ATR — широкий стоп для 1H таймфрейма',
      'Тейк-профит: 1:3 Risk/Reward — трипликация риска',
      'Trailing stop: 3 уровня (безубыток → lock profit → lock 2× profit)',
      'Тайм-эксит через 12 часов при отрицательном PnL',
    ],
    riskManagement: [
      'Макс. плечо: 3x — консервативный подход',
      'Размер позиции: 6% от баланса',
      'Макс. открытых сделок: 5',
      'Дневной лимит убытков: 5% от баланса',
      'Комиссия: 0.1% за сделку',
    ],
  },
  scalper: {
    philosophy: 'Скальпинг: множество быстрых сделок на микро-движениях. Использует 5-минутные свечи, StochRSI(5,5), BB squeeze, volume spikes.',
    entryRules: [
      'StochRSI(5,5) < 0.15 для Long, > 0.85 для Short — быстрая перекупленность/перепроданность',
      '≥3 из 6 индикаторов должны согласованно указывать одно направление',
      'Score ≥ 0.15 — низкий порог для частых входов',
      'Volume spike > 1.8× от среднего — подтверждение движения',
      'RSI(7) < 25 / > 75 — агрессивные пороги для быстрого реагирования',
    ],
    exitRules: [
      'Стоп-лосс: 0.8× ATR — узкий стоп для быстрых сделок',
      'Тейк-профит: 1:1.5 Risk/Reward — быстрая фиксация прибыли',
      'Trailing stop: безубыток при движении 1× SL',
      'Тайм-эксит через 1 час при отрицательном PnL',
    ],
    riskManagement: [
      'Макс. плечо: 2x — ограничение риска на быстрых сделках',
      'Размер позиции: 3% от баланса',
      'Макс. открытых сделок: 5',
      'Таймфрейм: 5 минут',
      'Комиссия: 0.1% за сделку',
    ],
  },
  'position-alpha': {
    philosophy: 'Позиционная торговля: редкие входы на сильных разворотах тренда. Использует 4-часовые свечи, EMA50/200 crossover как главный сигнал.',
    entryRules: [
      'EMA50/200 crossover (Golden/Death cross) — основной сигнал',
      '≥3 из 5 дополнительных индикаторов подтверждают направление',
      'Score ≥ 0.40 — высокий порог, только сильные сигналы',
      'ADX > 30 — требуется очень сильный тренд',
      'MACD подтверждает направление EMA crossover',
    ],
    exitRules: [
      'Стоп-лосс: 4× ATR — очень широкий стоп для удержания дней/недель',
      'Тейк-профит: 1:5 Risk/Reward — амбициозная цель',
      'Trailing stop: 3 уровня с широкими шагами',
      'Тайм-эксит через 7 дней при отрицательном PnL',
    ],
    riskManagement: [
      'Макс. плечо: 2x — консервативное плечо для долгосрочных позиций',
      'Размер позиции: 4% от баланса',
      'Макс. открытых сделок: 2',
      'Таймфрейм: 4 часа',
      'Комиссия: 0.1% за сделку',
    ],
  },
};

// Reconstruct decision narrative for a trade by re-analyzing candles at open time
function generateDecisionNarrative(trade: Trade): string {
  const dir = trade.direction === 'long' ? 'LONG' : 'SHORT';
  const sym = trade.symbol.replace('USDT', '');

  const parts: string[] = [];

  // 1. Direction rationale
  if (trade.direction === 'long') {
    parts.push(`Сигнал на покупку (${dir}) по ${sym}`);
  } else {
    parts.push(`Сигнал на продажу (${dir}) по ${sym}`);
  }

  // 2. Leverage explanation
  if (trade.leverage >= 3) {
    parts.push(`Максимальное плечо ${trade.leverage}x — высокий уровень уверенности индикаторов (score конfluence ≥6/10)`);
  } else if (trade.leverage === 2) {
    parts.push(`Плечо ${trade.leverage}x — умеренная уверенность сигнала`);
  } else {
    parts.push(`Плечо ${trade.leverage}x — консервативный вход, сигнал на границе порога`);
  }

  // 3. SL/TP analysis
  if (trade.stop_loss && trade.take_profit) {
    const slDist = Math.abs(trade.entry_price - trade.stop_loss) / trade.entry_price * 100;
    const tpDist = Math.abs(trade.take_profit - trade.entry_price) / trade.entry_price * 100;
    const rr = tpDist / slDist;

    parts.push(`Стоп-лосс: $${trade.stop_loss.toFixed(4)} (${slDist.toFixed(2)}% от входа)`);
    parts.push(`Тейк-профит: $${trade.take_profit.toFixed(4)} (${tpDist.toFixed(2)}% от входа)`);
    parts.push(`Risk/Reward: 1:${rr.toFixed(1)} — ${rr >= 2.5 ? 'превосходное' : rr >= 2 ? 'хорошее' : rr >= 1.5 ? 'приемлемое' : 'узкое'} соотношение`);
  }

  // 4. Position sizing
  parts.push(`Объём позиции: $${trade.amount.toFixed(2)} (${(trade.amount * trade.leverage).toFixed(2)}$ с плечом)`);

  return parts.join('. ') + '.';
}

// Generate close reason narrative
function generateCloseNarrative(trade: Trade): string {
  if (trade.status !== 'closed' || !trade.exit_price || trade.pnl === null) return '';

  const sym = trade.symbol.replace('USDT', '');
  const pnlSign = trade.pnl >= 0 ? '+' : '';
  const pnlPct = (trade.pnl / trade.amount * 100).toFixed(1);
  const parts: string[] = [];

  // Determine close reason
  if (trade.take_profit && trade.exit_price >= trade.take_profit && trade.direction === 'long') {
    parts.push(`Тейк-профит достигнут — цена ${sym} достигла $${trade.exit_price.toFixed(4)}`);
  } else if (trade.stop_loss && trade.exit_price <= trade.stop_loss && trade.direction === 'long') {
    parts.push(`Стоп-лосс сработал — цена ${sym} упала до $${trade.exit_price.toFixed(4)}`);
  } else if (trade.take_profit && trade.exit_price <= trade.take_profit && trade.direction === 'short') {
    parts.push(`Тейк-профит достигнут — цена ${sym} упала до $${trade.exit_price.toFixed(4)}`);
  } else if (trade.stop_loss && trade.exit_price >= trade.stop_loss && trade.direction === 'short') {
    parts.push(`Стоп-лосс сработал — цена ${sym} поднялась до $${trade.exit_price.toFixed(4)}`);
  } else {
    parts.push(`Сделка закрыта по рыночной цене $${trade.exit_price.toFixed(4)}`);
  }

  // PnL commentary
  if (trade.pnl > 0) {
    parts.push(`Результат: ${pnlSign}$${trade.pnl.toFixed(2)} (+${pnlPct}% от маржи). Стратегия сработала корректно.`);
  } else {
    parts.push(`Результат: ${pnlSign}$${trade.pnl.toFixed(2)} (${pnlPct}% от маржи). Стоп-лосс ограничил убыток.`);
  }

  // Duration
  if (trade.closed_at) {
    const durationMs = new Date(trade.closed_at).getTime() - new Date(trade.opened_at).getTime();
    const hours = Math.floor(durationMs / 3600000);
    const minutes = Math.floor((durationMs % 3600000) / 60000);
    parts.push(`Длительность: ${hours > 0 ? `${hours}ч ` : ''}${minutes}м`);
  }

  return parts.join('. ') + '.';
}

// Analyze live open trade potential
function analyzeOpenTradePotential(trade: Trade, currentPrice: number): string {
  const sym = trade.symbol.replace('USDT', '');
  const parts: string[] = [];

  const isLong = trade.direction === 'long';
  const unrealizedPnl = isLong
    ? (currentPrice - trade.entry_price) / trade.entry_price * trade.amount * trade.leverage
    : (trade.entry_price - currentPrice) / trade.entry_price * trade.amount * trade.leverage;

  parts.push(`Текущая цена ${sym}: $${currentPrice.toFixed(4)}`);
  parts.push(`Нереализованный PnL: ${unrealizedPnl >= 0 ? '+' : ''}$${unrealizedPnl.toFixed(2)}`);

  // Distance to TP
  if (trade.take_profit) {
    const tpDist = isLong
      ? (trade.take_profit - currentPrice) / currentPrice * 100
      : (currentPrice - trade.take_profit) / currentPrice * 100;
    parts.push(`До тейк-профита: ${tpDist.toFixed(2)}%`);
    const potentialProfit = Math.abs(trade.take_profit - trade.entry_price) / trade.entry_price * trade.amount * trade.leverage;
    parts.push(`Потенциальная прибыль при достижении TP: +$${potentialProfit.toFixed(2)}`);
  }

  // Distance to SL
  if (trade.stop_loss) {
    const slDist = isLong
      ? (currentPrice - trade.stop_loss) / currentPrice * 100
      : (trade.stop_loss - currentPrice) / currentPrice * 100;
    parts.push(`До стоп-лосса: ${slDist.toFixed(2)}%`);
    const potentialLoss = Math.abs(trade.stop_loss - trade.entry_price) / trade.entry_price * trade.amount * trade.leverage;
    parts.push(`Потенциальный убыток при срабатывании SL: -$${potentialLoss.toFixed(2)}`);
  }

  // Risk/Reward assessment
  if (trade.stop_loss && trade.take_profit) {
    const toTP = isLong ? (trade.take_profit - currentPrice) / currentPrice : (currentPrice - trade.take_profit) / currentPrice;
    const toSL = isLong ? (currentPrice - trade.stop_loss) / currentPrice : (trade.stop_loss - currentPrice) / currentPrice;
    if (toTP > 0 && toSL > 0) {
      const currentRR = toTP / toSL;
      parts.push(`Текущий R:R от текущей цены: 1:${currentRR.toFixed(1)}`);
    }
  }

  return parts.join('. ') + '.';
}

export async function GET(request: NextRequest) {
  try {
    const userId = await getAuthUserId();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    await initDB();
    const strategyId = request.nextUrl.searchParams.get('strategyId') || 'momentum';

    // Get all trades (not just recent 20) — use large limit
    const [state, openTrades, allTrades, weights] = await Promise.all([
      getTraderState(userId, strategyId),
      getOpenTrades(userId, strategyId),
      getRecentTrades(userId, 500, strategyId), // get as many as possible
      getIndicatorWeights(userId),
    ]);

    // Separate closed vs open
    const closedTrades = allTrades.filter(t => t.status === 'closed');
    const closedWithPnl = closedTrades.filter(t => t.pnl !== null);

    // Performance metrics
    const wins = closedWithPnl.filter(t => t.pnl! > 0);
    const losses = closedWithPnl.filter(t => t.pnl! <= 0);
    const totalPnl = closedWithPnl.reduce((s, t) => s + (t.pnl ?? 0), 0);
    const totalWins = wins.reduce((s, t) => s + (t.pnl ?? 0), 0);
    const totalLosses = Math.abs(losses.reduce((s, t) => s + (t.pnl ?? 0), 0));
    const winRate = closedWithPnl.length > 0 ? (wins.length / closedWithPnl.length) * 100 : 0;
    const profitFactor = totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0;
    const avgWin = wins.length > 0 ? totalWins / wins.length : 0;
    const avgLoss = losses.length > 0 ? totalLosses / losses.length : 0;
    const largestWin = wins.length > 0 ? Math.max(...wins.map(t => t.pnl!)) : 0;
    const largestLoss = losses.length > 0 ? Math.min(...losses.map(t => t.pnl!)) : 0;
    const avgRR = avgLoss > 0 ? avgWin / avgLoss : 0;

    // Max drawdown calculation
    let peak = 100; // starting balance
    let maxDrawdown = 0;
    let runningBalance = 100;
    const balanceHistory: Array<{ time: string; balance: number }> = [{ time: 'start', balance: 100 }];

    // Sort closed trades by time
    const sortedClosed = [...closedWithPnl].sort((a, b) =>
      new Date(a.closed_at || a.opened_at).getTime() - new Date(b.closed_at || b.opened_at).getTime()
    );

    for (const trade of sortedClosed) {
      runningBalance += (trade.pnl ?? 0);
      if (runningBalance > peak) peak = runningBalance;
      const dd = (peak - runningBalance) / peak * 100;
      if (dd > maxDrawdown) maxDrawdown = dd;
      balanceHistory.push({ time: trade.closed_at || trade.opened_at, balance: runningBalance });
    }

    // Direction stats
    const longTrades = closedWithPnl.filter(t => t.direction === 'long');
    const shortTrades = closedWithPnl.filter(t => t.direction === 'short');
    const longWinRate = longTrades.length > 0 ? (longTrades.filter(t => t.pnl! > 0).length / longTrades.length) * 100 : 0;
    const shortWinRate = shortTrades.length > 0 ? (shortTrades.filter(t => t.pnl! > 0).length / shortTrades.length) * 100 : 0;

    // Symbol stats
    const symbolStats: Record<string, { count: number; wins: number; pnl: number }> = {};
    for (const t of closedWithPnl) {
      if (!symbolStats[t.symbol]) symbolStats[t.symbol] = { count: 0, wins: 0, pnl: 0 };
      symbolStats[t.symbol].count++;
      if (t.pnl! > 0) symbolStats[t.symbol].wins++;
      symbolStats[t.symbol].pnl += t.pnl!;
    }

    // Fetch current prices for open trades
    const openTradeDetails: Array<Trade & { currentPrice: number; potential: string; decisionNarrative: string }> = [];
    for (const trade of openTrades) {
      let currentPrice = trade.entry_price; // fallback
      try {
        const klineUrl = `https://api.binance.com/api/v3/klines?symbol=${trade.symbol}&interval=1h&limit=1`;
        const res = await fetch(klineUrl);
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data) && data.length > 0) {
            currentPrice = parseFloat(String(data[0][4]));
          }
        }
      } catch { /* use fallback */ }

      openTradeDetails.push({
        ...trade,
        currentPrice,
        potential: analyzeOpenTradePotential(trade, currentPrice),
        decisionNarrative: generateDecisionNarrative(trade),
      });
    }

    // Generate narratives for closed trades
    const closedTradeDetails = closedWithPnl.map(t => ({
      ...t,
      decisionNarrative: generateDecisionNarrative(t),
      closeNarrative: generateCloseNarrative(t),
    }));

    // Strategy description — per-strategy from STRATEGY_DESCRIPTIONS
    const strategyDesc = STRATEGY_DESCRIPTIONS[strategyId] ?? STRATEGY_DESCRIPTIONS['momentum'];
    const strategyDef = getStrategy(strategyId);
    const strategyDescription = {
      id: strategyId,
      name: strategyDef?.name ?? 'Unknown',
      philosophy: strategyDesc.philosophy,
      entryRules: strategyDesc.entryRules,
      exitRules: strategyDesc.exitRules,
      riskManagement: strategyDesc.riskManagement,
    };

    // Potential assessment
    const potentialAssessment: string[] = [];
    if (closedWithPnl.length === 0) {
      potentialAssessment.push('Стратегия ещё не совершила ни одной закрытой сделки. Данных для оценки потенциала недостаточно.');
    } else {
      if (winRate > 50 && profitFactor > 1.5) {
        potentialAssessment.push('Стратегия показывает положительную динамику: винрейт выше 50% и профит-фактор > 1.5. При сохранении текущих параметров ожидается стабильный рост капитала.');
      } else if (winRate > 40 && profitFactor > 1.0) {
        potentialAssessment.push('Стратегия маржинально прибыльна. Рекомендуется увеличить порог входа (score threshold) для повышения качества сигналов.');
      } else if (profitFactor < 1.0) {
        potentialAssessment.push('Стратегия убыточна на текущем периоде. Возможные причины: высокая волатильность рынка, ложные пробои, недостаточная фильтрация сигналов.');
      }

      if (avgRR >= 2.5) {
        potentialAssessment.push(`Средний R:R 1:${avgRR.toFixed(1)} — отличное соотношение. Стратегия позволяет ошибаться чаще, чем быть правой, и всё равно оставаться в плюсе.`);
      } else if (avgRR >= 1.5) {
        potentialAssessment.push(`Средний R:R 1:${avgRR.toFixed(1)} — хорошее соотношение. Есть запас прочности при сериях убытков.`);
      } else {
        potentialAssessment.push(`Средний R:R 1:${avgRR.toFixed(1)} — низкое соотношение. Рекомендуется расширить тейк-профит или сузить стоп-лосс.`);
      }

      if (maxDrawdown > 20) {
        potentialAssessment.push(`Макс. просадка ${maxDrawdown.toFixed(1)}% — критически высокая. Необходимо снизить размер позиции или увеличить пороги входа.`);
      } else if (maxDrawdown > 10) {
        potentialAssessment.push(`Макс. просадка ${maxDrawdown.toFixed(1)}% — умеренная. Допустимый уровень для агрессивной торговли.`);
      } else {
        potentialAssessment.push(`Макс. просадка ${maxDrawdown.toFixed(1)}% — низкая. Отличный контроль рисков.`);
      }
    }

    // Calculate true equity: balance + open trade amounts + unrealized PnL + borrowed - debt
    const openTradeAmounts = openTrades.reduce((s, t) => s + t.amount, 0);
    const unrealizedPnl = openTradeDetails.reduce((s, t) => {
      const isLong = t.direction === 'long';
      const priceChange = isLong
        ? (t.currentPrice - t.entry_price) / t.entry_price
        : (t.entry_price - t.currentPrice) / t.entry_price;
      return s + (t.amount * priceChange * t.leverage - t.amount * 0.001);
    }, 0);
    const totalEquity = state.balance + openTradeAmounts + unrealizedPnl + state.borrowed_funds - state.debt_to_repay;
    const startingBalance = 100;
    const totalReturn = totalEquity - startingBalance;
    const totalReturnPct = startingBalance > 0 ? (totalReturn / startingBalance) * 100 : 0;

    return NextResponse.json({
      strategy: strategyDescription,
      accountState: {
        currentBalance: state.balance,
        borrowedFunds: state.borrowed_funds,
        debtToRepay: state.debt_to_repay,
        openTradeAmounts,
        unrealizedPnl,
        totalEquity,
        startingBalance,
        totalReturn,
        totalReturnPct,
      },
      performance: {
        totalTrades: closedWithPnl.length,
        wins: wins.length,
        losses: losses.length,
        winRate,
        totalPnl,
        totalWinsAmount: totalWins,
        totalLossesAmount: totalLosses,
        profitFactor: profitFactor === Infinity ? null : profitFactor,
        avgWin,
        avgLoss,
        largestWin,
        largestLoss,
        avgRiskReward: avgRR,
        maxDrawdown,
        longTrades: longTrades.length,
        shortTrades: shortTrades.length,
        longWinRate,
        shortWinRate,
        openTradesCount: openTrades.length,
        currentUnrealizedPnl: unrealizedPnl,
      },
      symbolPerformance: symbolStats,
      balanceHistory,
      openTrades: openTradeDetails,
      closedTrades: closedTradeDetails.sort((a, b) =>
        new Date(b.opened_at).getTime() - new Date(a.opened_at).getTime()
      ),
      potentialAssessment,
      indicatorWeights: weights,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[strategy-report] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
