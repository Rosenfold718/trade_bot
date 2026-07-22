import { NextRequest, NextResponse } from 'next/server';
import {
  initDB, getTraderState, getIndicatorWeights,
  updateIndicatorWeight, saveBacktestResult, getBacktestResults,
} from '@/lib/db';
import { fetchKlines, runBacktest, optimizeWeights, fetchTopSymbols } from '@/lib/trading-engine';
import { getAuthUserId } from '@/lib/auth-helpers';

export async function GET() {
  try {
    const userId = await getAuthUserId();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    await initDB();
    const results = await getBacktestResults(userId);
    return NextResponse.json(results);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = await getAuthUserId();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    await initDB();
    const body = await request.json();
    const strategyId = (body.strategyId as string) || 'momentum';

    const state = await getTraderState(userId, strategyId);
    const weightsArr = await getIndicatorWeights(userId);
    const weights: Record<string, number> = {};
    for (const w of weightsArr) weights[w.indicator_name] = w.weight;

    const symbols = await fetchTopSymbols();
    const summaries: Array<Awaited<ReturnType<typeof runBacktest>>> = [];

    const backtestSymbols = symbols.slice(0, 20);
    for (const symbol of backtestSymbols) {
      try {
        const candles = await fetchKlines(symbol, '1h', 1440);
        if (candles.length < 200) continue;
        const summary = runBacktest(symbol, candles, weights, state.balance);
        summaries.push(summary);
        await saveBacktestResult(
          userId,
          strategyId,
          symbol,
          summary.total_trades,
          summary.winrate,
          summary.profit_factor,
        );
      } catch {
        continue;
      }
    }

    const newWeights = optimizeWeights(weights, summaries);

    for (const [name, weight] of Object.entries(newWeights)) {
      const id = name.toLowerCase().replace('_', '');
      const agg = summaries.reduce(
        (acc, s) => {
          const perf = s.indicator_performance[name];
          if (!perf) return acc;
          acc.wins += perf.wins;
          acc.trades += perf.wins + perf.losses;
          return acc;
        },
        { wins: 0, trades: 0 },
      );
      const winrate = agg.trades > 0 ? (agg.wins / agg.trades) * 100 : null;
      await updateIndicatorWeight(userId, id, weight, winrate);
    }

    const totalTrades = summaries.reduce((s, sum) => s + sum.total_trades, 0);
    const avgWinrate = summaries.length > 0
      ? summaries.reduce((s, sum) => s + sum.winrate, 0) / summaries.length
      : 0;

    return NextResponse.json({
      success: true,
      symbolsTested: backtestSymbols.length,
      totalTrades,
      avgWinrate: Math.round(avgWinrate * 100) / 100,
      newWeights,
      summaries: summaries.slice(0, 10).map(s => ({
        symbol: s.symbol,
        trades: s.total_trades,
        winrate: Math.round(s.winrate * 100) / 100,
        profitFactor: Math.round(s.profit_factor * 100) / 100,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}