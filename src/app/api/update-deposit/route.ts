import { NextRequest, NextResponse } from 'next/server';
import { initDB, tursoDb } from '@/lib/db';
import { getAuthUserId } from '@/lib/auth-helpers';

export async function POST(request: NextRequest) {
  try {
    const userId = await getAuthUserId();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const strategyId = (body.strategyId as string) || 'momentum';
    const initialBalance = body.initialBalance ? Number(body.initialBalance) : undefined;

    if (!initialBalance || isNaN(initialBalance) || initialBalance < 10) {
      return NextResponse.json({ error: 'Минимальная сумма депозита: $10' }, { status: 400 });
    }

    await initDB();
    const id = `${userId}-${strategyId}`;
    await tursoDb.execute(
      "UPDATE trader_state SET initial_balance = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
      [initialBalance, id, userId]
    );

    return NextResponse.json({ success: true, initialBalance });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[update-deposit] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
