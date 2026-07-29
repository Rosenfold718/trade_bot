import { NextRequest, NextResponse } from 'next/server';
import { getSetting, setSetting } from '@/lib/db';
import { initDB } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const userId = request.nextUrl.searchParams.get('userId');
    if (!userId) return NextResponse.json({ dismissed: false });

    await initDB();
    const value = await getSetting(`warning_dismissed_${userId}`);
    return NextResponse.json({ dismissed: value === '1' });
  } catch {
    return NextResponse.json({ dismissed: false });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const userId = body.userId as string;
    if (!userId) return NextResponse.json({ error: 'Missing userId' }, { status: 400 });

    await initDB();
    await setSetting(`warning_dismissed_${userId}`, '1', userId);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
  }
}
