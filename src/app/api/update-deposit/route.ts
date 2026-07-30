import { NextRequest, NextResponse } from 'next/server';
import { tursoDb } from '@/lib/db';
import { getAuthUserId } from '@/lib/auth-helpers';

export async function POST(request: NextRequest) {
  try {
    const userId = await getAuthUserId();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const strategyId = (body.strategyId as string) || 'momentum';
    const initialBalance = Number(body.initialBalance);

    if (isNaN(initialBalance) || initialBalance < 10) {
      return NextResponse.json({ error: 'Минимальная сумма депозита: $10' }, { status: 400 });
    }

    const id = `${userId}-${strategyId}`;

    // Update initial_balance in DB
    await tursoDb.execute(
      "UPDATE trader_state SET initial_balance = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
      [initialBalance, id, userId]
    );

    // Recalculate balance: new_initial_balance + closed_pnl - open_amount
    // This ensures balance is consistent with the new deposit
    const tradesRes = await tursoDb.execute(
      `SELECT COALESCE(SUM(pnl), 0) as pnl_sum, 
       (SELECT COALESCE(SUM(amount), 0) FROM trades WHERE user_id = ? AND strategy_id = ? AND status = 'open') as open_sum
       FROM trades WHERE user_id = ? AND strategy_id = ? AND status = 'closed' AND pnl IS NOT NULL`,
      [userId, strategyId, userId, strategyId]
    );
    const row = tradesRes.rows[0];
    const closedPnl = Number(row?.pnl_sum ?? 0);
    const openAmount = Number(row?.open_sum ?? 0);
    const newBalance = Math.max(0, initialBalance + closedPnl - openAmount);

    await tursoDb.execute(
      "UPDATE trader_state SET balance = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
      [newBalance, id, userId]
    );

    console.log(`[update-deposit] User ${userId} strategy ${strategyId}: initial_balance → $${initialBalance}, balance recalculated → $${newBalance.toFixed(2)} (pnl=$${closedPnl.toFixed(2)}, open=$${openAmount.toFixed(2)})`);

    return NextResponse.json({ success: true, initialBalance, balance: newBalance });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[update-deposit] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
