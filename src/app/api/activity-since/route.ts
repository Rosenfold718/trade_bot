import { NextRequest, NextResponse } from 'next/server';
import { initDB, tursoDb, getTraderState } from '@/lib/db';
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
    // so returning users see recent activity even on first login after deploy
    let baseline: string;
    if (lastLogin) {
      baseline = lastLoginStr;
    } else {
      // First time — look back 24 hours
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
      stop_loss: row.stop_loss !== null ? Number(row.stop_loss) : null,
      take_profit: row.take_profit !== null ? Number(row.take_profit) : null,
      opened_at: row.opened_at as string,
      closed_at: row.closed_at as string,
    }));

    // Fetch currently open trades (all open trades matter)
    const openResult = await tursoDb.execute(
      `SELECT * FROM trades 
       WHERE user_id = ? AND status = 'open'
       ORDER BY opened_at DESC`,
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
      stop_loss: row.stop_loss !== null ? Number(row.stop_loss) : null,
      take_profit: row.take_profit !== null ? Number(row.take_profit) : null,
      opened_at: row.opened_at as string,
    }));

    // Fetch per-strategy balances
    const STRATEGY_IDS = ['momentum', 'scalper', 'position-alpha'];
    const balances: Array<{ strategyId: string; balance: number; initial_balance: number }> = [];
    let totalBalance = 0;
    for (const sid of STRATEGY_IDS) {
      try {
        const state = await getTraderState(userId, sid);
        balances.push({ strategyId: sid, balance: state.balance, initial_balance: Number(state.initial_balance ?? 100) });
        totalBalance += state.balance;
      } catch {
        // Strategy not initialized yet
      }
    }

    // Determine if there are meaningful changes
    const hasChanges = closedTrades.length > 0 || openTrades.length > 0 || balances.length > 0;

    // Only update last_login if there ARE changes (or if first time — set baseline)
    // This prevents rapid page refreshes from resetting the timer
    const now = new Date().toISOString();
    if (hasChanges || !lastLogin) {
      await setSetting(`last_login_${userId}`, now, userId);
    }

    // Format time ago — use baseline, not the actual last login for first-timers
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

    // First-time display string
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
      balances,
      totalBalance,
    });
  } catch (err) {
    console.error('[activity-since] Error:', err);
    return NextResponse.json({ hasChanges: false, error: 'Failed to fetch activity' }, { status: 500 });
  }
}
