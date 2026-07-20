import { NextRequest, NextResponse } from 'next/server';
import { initDB, addCredit } from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    await initDB();
    const body = await request.json();
    const { amount } = body as { amount: number };

    if (!amount || amount <= 0) {
      return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });
    }

    await addCredit(amount);
    return NextResponse.json({ success: true, message: `$${amount} credit added` });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}