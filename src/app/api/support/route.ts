import { NextRequest, NextResponse } from 'next/server';
import { getAuthUserId } from '@/lib/auth-helpers';
import { findUserById } from '@/lib/auth-db';
import { sendSupportTicket } from '@/lib/email';

export async function POST(request: NextRequest) {
  try {
    const userId = await getAuthUserId(request);
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const { message, requestFaster } = body as { message?: string; requestFaster?: boolean };

    if (!message || message.trim().length < 3) {
      return NextResponse.json({ error: 'Сообщение слишком короткое' }, { status: 400 });
    }

    if (message.length > 2000) {
      return NextResponse.json({ error: 'Сообщение слишком длинное (макс. 2000 символов)' }, { status: 400 });
    }

    // Get user info from auth DB
    const user = await findUserById(userId);
    const username = user?.username || userId.slice(0, 8);

    // Send email
    await sendSupportTicket({
      username,
      message: message.trim(),
      requestFaster: !!requestFaster,
      email: user?.email || undefined,
    });

    return NextResponse.json({ success: true, message: 'Обращение отправлено' });
  } catch (err) {
    console.error('[support] Error:', err);
    return NextResponse.json({ error: 'Ошибка отправки обращения' }, { status: 500 });
  }
}
