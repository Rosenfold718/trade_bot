import { NextRequest, NextResponse } from 'next/server';
import { initDB, tursoDb, getTraderState, getTotalClosedPnl } from '@/lib/db';
import { getAuthUserId } from '@/lib/auth-helpers';
import { getSetting, setSetting } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const userId = await getAuthUserId();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    await initDB();

    // Get last login timestamp from system_settings
    const lastLoginStr = await getSetting(`last_login_${userId}`);
    const lastLogin = lastLoginStr ? new Date(lastLoginStr) : null;

    // If no last login (first time with this feature), use 24h baseline
    let baseline: string;
    if (lastLogin) {
      baseline = lastLoginStr;
    } else {
      const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      baseline = dayAgo;
    }

    // Fetch closed trades since baseline across all strategies
    const closedResult = await tursoDb.execute(
      `SELECT * FROM trades 
       WHERE user_id = ? AND status = 'closed' AND closed_at > ? 
       ORDER BY closed_at DESC`,
      [userId, baseline]
    );
    const closedTrades = closedResult.rows.map(row => ({
      id: row.id as string,
      symbol: row.symbol as string,
      strategy_id: (row.strategy_id as string) ?? 'momentum',
      entry_price: Number(row.entry_price),
      exit_price: Number(row.exit_price),
      amount: Number(row.amount),
      leverage: Number(row.leverage),
      direction: row.direction as string,
      pnl: Number(row.pnl),
      opened_at: row.opened_at as string,
      closed_at: row.closed_at as string,
    }));

    // Fetch currently open trades
    const openResult = await tursoDb.execute(
      `SELECT * FROM trades 
       WHERE user_id = ? AND status = 'open'
       ORDER BY strategy_id, opened_at DESC`,
      [userId]
    );
    const openTrades = openResult.rows.map(row => ({
      id: row.id as string,
      symbol: row.symbol as string,
      strategy_id: (row.strategy_id as string) ?? 'momentum',
      entry_price: Number(row.entry_price),
      amount: Number(row.amount),
      leverage: Number(row.leverage),
      direction: row.direction as string,
      opened_at: row.opened_at as string,
    }));

    // Group by strategy
    const STRATEGY_IDS = ['momentum', 'scalper', 'position-alpha'];
    const strategies: Array<{
      strategyId: string;
      balance: number;          // available balance (cash not locked in trades)
      initial_balance: number; // starting deposit
      totalLocked: number;     // sum of amounts in open trades
      closedPnlTotal: number;  // sum of PnL from all closed trades
      openTradeCount: number;
    }> = [];

    for (const sid of STRATEGY_IDS) {
      try {
        const state = await getTraderState(userId, sid);
        const strategyOpen = openTrades.filter(t => t.strategy_id === sid);
        const totalLocked = strategyOpen.reduce((s, t) => s + t.amount, 0);
        const closedPnl = await getTotalClosedPnl(userId, sid);
        strategies.push({
          strategyId: sid,
          balance: state.balance,
          initial_balance: Number(state.initial_balance ?? 100),
          totalLocked,
          closedPnlTotal: closedPnl,
          openTradeCount: strategyOpen.length,
        });
      } catch {
        // Strategy not initialized
      }
    }

    // Total available balance (not net equity!)
    const totalBalance = strategies.reduce((s, st) => s + st.balance, 0);
    const totalLocked = strategies.reduce((s, st) => s + st.totalLocked, 0);
    const totalClosedPnl = closedTrades.reduce((s, t) => s + t.pnl, 0);

    // Determine if there are meaningful changes
    const hasChanges = closedTrades.length > 0 || openTrades.length > 0 || strategies.length > 0;

    // Only update last_login if there ARE changes
    const now = new Date().toISOString();
    if (hasChanges || !lastLogin) {
      await setSetting(`last_login_${userId}`, now, userId);
    }

    // Format time ago
    const referenceDate = lastLogin ? new Date(lastLoginStr) : new Date(baseline);
    const diffMs = Date.now() - referenceDate.getTime();
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    let timeAgo: string;
    if (diffHours < 1) {
      timeAgo = 'менее часа';
    } else if (diffHours < 24) {
      timeAgo = `${diffHours} ч.`;
    } else {
      timeAgo = `${diffDays} д.`;
    }

    const displayLoginTime = lastLogin
      ? referenceDate.toLocaleString('ru-RU')
      : new Date(baseline).toLocaleString('ru-RU');

    return NextResponse.json({
      hasChanges,
      lastLogin: lastLoginStr,
      lastLoginTime: displayLoginTime,
      timeAgo,
      closedTrades,
      openTrades,
      strategies,
      totalBalance,
      totalLocked,
      totalClosedPnl,
    });
  } catch (err) {
    console.error('[activity-since] Error:', err);
    return NextResponse.json({ hasChanges: false, error: 'Failed to fetch activity' }, { status: 500 });
  }
}
