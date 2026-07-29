import { NextRequest, NextResponse } from 'next/server';
import { initDB, tursoDb, getTraderState, getClosedTrades, getTotalClosedPnl } from '@/lib/db';
import { getAuthUserId } from '@/lib/auth-helpers';
import { getSetting, setSetting } from '@/lib/db';

async function fetchPrices(symbols: string[]): Promise<Record<string, number>> {
  const prices: Record<string, number> = {};
  if (symbols.length === 0) return prices;
  try {
    const unique = [...new Set(symbols)];
    // Batch: fetch all prices at once
    const res = await fetch('https://api.binance.com/api/v3/ticker/price');
    if (!res.ok) return prices;
    const data = await res.json();
    if (!Array.isArray(data)) return prices;
    for (const item of data) {
      const sym = item.symbol as string;
      if (unique.includes(sym)) {
        prices[sym] = parseFloat(item.price);
      }
    }
  } catch {
    // Fallback: fetch individually for important symbols
    for (const sym of symbols.slice(0, 10)) {
      try {
        const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${sym}`);
        if (res.ok) {
          const data = await res.json();
          prices[sym] = parseFloat(data.price);
        }
      } catch { /* skip */ }
    }
  }
  return prices;
}

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

    // Fetch live prices for open trades
    const symbols = openTrades.map(t => t.symbol);
    const prices = await fetchPrices(symbols);

    // Calculate unrealized PnL for each open trade
    const openWithPnl = openTrades.map(t => {
      const currentPrice = prices[t.symbol] ?? t.entry_price;
      const priceDiff = t.direction === 'long'
        ? (currentPrice - t.entry_price) / t.entry_price
        : (t.entry_price - currentPrice) / t.entry_price;
      const unrealizedPnl = t.amount * priceDiff * t.leverage;
      return { ...t, currentPrice, unrealizedPnl };
    });

    // Group by strategy for per-strategy unrealized PnL
    const STRATEGY_IDS = ['momentum', 'scalper', 'position-alpha'];
    const strategies: Array<{
      strategyId: string;
      balance: number;
      initial_balance: number;
      unrealizedPnl: number;
      closedPnlTotal: number;
      openTradeCount: number;
    }> = [];

    for (const sid of STRATEGY_IDS) {
      try {
        const state = await getTraderState(userId, sid);
        const strategyOpen = openWithPnl.filter(t => t.strategy_id === sid);
        const strategyUnrealized = strategyOpen.reduce((s, t) => s + t.unrealizedPnl, 0);
        const closedPnl = await getTotalClosedPnl(userId, sid);
        strategies.push({
          strategyId: sid,
          balance: state.balance,
          initial_balance: Number(state.initial_balance ?? 100),
          unrealizedPnl: strategyUnrealized,
          closedPnlTotal: closedPnl,
          openTradeCount: strategyOpen.length,
        });
      } catch {
        // Strategy not initialized
      }
    }

    const totalBalance = strategies.reduce((s, st) => s + st.balance, 0);
    const totalUnrealized = openWithPnl.reduce((s, t) => s + t.unrealizedPnl, 0);
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
      openTrades: openWithPnl,
      strategies,
      totalBalance,
      totalUnrealized,
      totalClosedPnl,
    });
  } catch (err) {
    console.error('[activity-since] Error:', err);
    return NextResponse.json({ hasChanges: false, error: 'Failed to fetch activity' }, { status: 500 });
  }
}
