import { NextResponse } from 'next/server';
import { resetTrader } from '@/lib/db';

export async function POST() {
  try {
    await resetTrader();
    return NextResponse.json({ success: true, message: 'Trader reset to initial state' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}