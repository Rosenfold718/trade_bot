import { NextRequest, NextResponse } from 'next/server';
import { initDB, addCredit } from '@/lib/db';
import { getAuthUserId } from '@/lib/auth-helpers';

export async function POST(request: NextRequest) {
  try {
    const userId = await getAuthUserId();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    await initDB();
    const body = await request.json();
    const { amount, strategyId } = body as { amount: number; strategyId?: string };

    if (!amount || amount <= 0) {
      return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });
    }

    await addCredit(userId, amount, strategyId || 'momentum');
    return NextResponse.json({ success: true, message: `$${amount} credit added` });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}