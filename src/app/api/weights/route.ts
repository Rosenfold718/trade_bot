import { NextRequest, NextResponse } from 'next/server';
import { initDB, getIndicatorWeights } from '@/lib/db';
import { getAuthUserId } from '@/lib/auth-helpers';

export async function GET() {
  try {
    const userId = await getAuthUserId();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    await initDB();
    const weights = await getIndicatorWeights(userId);
    return NextResponse.json(weights);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}