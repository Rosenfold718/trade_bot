import { NextRequest, NextResponse } from 'next/server';
import { resetTrader } from '@/lib/db';
import { getAuthUserId } from '@/lib/auth-helpers';

export async function POST(request: NextRequest) {
  try {
    const userId = await getAuthUserId();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const strategyId = (body.strategyId as string) || 'momentum';
    const customBalance = body.balance ? Number(body.balance) : undefined;

    if (customBalance !== undefined && (isNaN(customBalance) || customBalance < 10)) {
      return NextResponse.json({ error: 'Минимальная сумма депозита: $10' }, { status: 400 });
    }

    await resetTrader(userId, strategyId, customBalance);
    return NextResponse.json({ success: true, message: `Strategy ${strategyId} reset with balance $${customBalance ?? 100}` });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
