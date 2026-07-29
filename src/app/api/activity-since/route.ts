import { NextRequest, NextResponse } from 'next/server';
import { initDB, tursoDb, getTraderState } from '@/lib/db';
import { getAuthUserId } from '@/lib/auth-helpers';
import { getSetting, setSetting } from '@/lib/db';

interface ActivityEvent {
  type: 'trade_closed' | 'trade_opened' | 'balance_change';
  strategyId: string;
  symbol: string;
  direction?: string;
  pnl?: number;
  amount?: number;
  leverage?: number;
  entry_price?: number;
  balance?: number;
  timestamp: string;
}

export async function GET(request: NextRequest) {
  try {
    const userId = await getAuthUserId();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    await initDB();

    // Get last login timestamp from system_settings
    const lastLoginStr = await getSetting(`last_login_${userId}`);
    const lastLogin = lastLoginStr ? new Date(lastLoginStr) : null;

    // Update last login to now
    const now = new Date().toISOString();
    await setSetting(`last_login_${userId}`, now, userId);

    // If no last login (first time), return empty — nothing to report
    if (!lastLogin) {
      return NextResponse.json({
        hasChanges: false,
        lastLogin: null,
        closedTrades: [],
        openTrades: [],
        balances: [],
        events: [],
      });
    }

    // Fetch closed trades since last login across all strategies
    const closedResult = await tursoDb.execute(
      `SELECT * FROM trades 
       WHERE user_id = ? AND status = 'closed' AND closed_at > ? 
       ORDER BY closed_at DESC`,
      [userId, lastLoginStr]
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

    // Fetch currently open trades (opened since or before last login — all open trades matter)
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
    const hasChanges = closedTrades.length > 0 || openTrades.length > 0;

    // Format time ago
    const lastLoginDate = new Date(lastLoginStr);
    const diffMs = Date.now() - lastLoginDate.getTime();
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

    return NextResponse.json({
      hasChanges,
      lastLogin: lastLoginStr,
      lastLoginTime: lastLoginDate.toLocaleString('ru-RU'),
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
