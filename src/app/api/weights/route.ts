import { NextResponse } from 'next/server';
import { initDB, getIndicatorWeights } from '@/lib/db';

export async function GET() {
  try {
    await initDB();
    const weights = await getIndicatorWeights();
    return NextResponse.json(weights);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}