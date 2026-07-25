import { NextRequest, NextResponse } from 'next/server';
import { initDB, getTraderState, getIndicatorWeights, getOpenTrades, getRecentTrades, getTotalClosedPnl, getClosedTradeCount, initUserTradingData, updateBalance, getClosedTrades } from '@/lib/db';
import { getAuthUserId } from '@/lib/auth-helpers';

/**
 * Recalculate balance from trade history.
 * Expected balance = 100 (initial) + sum(all closed pnl) - sum(open trade amounts)
 * This fixes drift caused by race conditions or failed close-trade API calls.
 */
async function recalcBalance(userId: string, strategyId: string): Promise<{ corrected: boolean; oldBalance: number; newBalance: number; closedPnlSum: number; openAmountSum: number }> {
  const state = await getTraderState(userId, strategyId);
  const closedTrades = await getClosedTrades(userId, strategyId);
  const openTrades = await getOpenTrades(userId, strategyId);

  // Sum all realized PnL from closed trades
  const closedPnlSum = closedTrades.reduce((sum, t) => sum + (t.pnl ?? 0), 0);

  // Sum amounts locked in open trades
  const openAmountSum = openTrades.reduce((sum, t) => sum + t.amount, 0);

  // Correct available balance = initial + all PnL - locked amounts
  const correctBalance = Math.max(0, 100 + closedPnlSum - openAmountSum);

  const corrected = Math.abs(state.balance - correctBalance) > 0.01;

  if (corrected) {
    console.log(`[recalcBalance][${strategyId}] Fixing balance: ${state.balance.toFixed(2)} → ${correctBalance.toFixed(2)} (closedPnl=${closedPnlSum.toFixed(2)}, openLocked=${openAmountSum.toFixed(2)})`);
    await updateBalance(userId, correctBalance, strategyId);
  }

  return { corrected, oldBalance: state.balance, newBalance: correctBalance, closedPnlSum, openAmountSum };
}

export async function GET(request: NextRequest) {
  try {
    const userId = await getAuthUserId();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    await initDB();

    const strategyId = request.nextUrl.searchParams.get('strategyId') || 'momentum';

    // Ensure user has trading data initialized
    try {
      await getTraderState(userId, strategyId);
    } catch {
      // State doesn't exist yet, initialize it
      await initUserTradingData(userId);
    }

    // Parallel fetch all data
    const [state, openTrades, recentTrades, totalClosedPnl, closedTradeCount, weights] = await Promise.all([
      getTraderState(userId, strategyId),
      getOpenTrades(userId, strategyId),
      getRecentTrades(userId, 50, strategyId),
      getTotalClosedPnl(userId, strategyId),
      getClosedTradeCount(userId, strategyId),
      getIndicatorWeights(userId),
    ]);

    // Recalculate balance to fix any drift
    const recalc = await recalcBalance(userId, strategyId);

    // Return corrected state if balance was fixed
    const finalState = recalc.corrected
      ? { ...state, balance: recalc.newBalance }
      : state;

    return NextResponse.json({
      state: finalState,
      weights,
      openTrades,
      recentTrades,
      totalClosedPnl,
      closedTradeCount,
      balanceCorrected: recalc.corrected,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[init] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = await getAuthUserId();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    await initUserTradingData(userId);
    return NextResponse.json({ success: true, message: 'User trading data initialized' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[init POST] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
