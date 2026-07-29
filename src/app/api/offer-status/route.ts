import { NextRequest, NextResponse } from 'next/server';
import { initDB, tursoDb, getSetting, setSetting } from '@/lib/db';
import { getAuthUserId } from '@/lib/auth-helpers';

export async function GET(request: NextRequest) {
  try {
    const userId = await getAuthUserId();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    await initDB();

    const accepted = await getSetting(`offer_accepted_${userId}`);
    return NextResponse.json({ accepted: accepted === '1' });
  } catch (err) {
    return NextResponse.json({ accepted: false }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = await getAuthUserId();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    await initDB();

    await setSetting(`offer_accepted_${userId}`, '1', userId);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
  }
}
