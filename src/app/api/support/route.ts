import { NextRequest, NextResponse } from 'next/server';
import { getAuthUserId } from '@/lib/auth-helpers';
import { initDB } from '@/lib/db';
import { sendSupportTicket } from '@/lib/email';

export async function POST(request: NextRequest) {
  try {
    const userId = await getAuthUserId();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const { message, requestFaster } = body as { message?: string; requestFaster?: boolean };

    if (!message || message.trim().length < 3) {
      return NextResponse.json({ error: 'Сообщение слишком короткое' }, { status: 400 });
    }

    if (message.length > 2000) {
      return NextResponse.json({ error: 'Сообщение слишком длинное (макс. 2000 символов)' }, { status: 400 });
    }

    await initDB();

    // Get user info for the email
    const { tursoDb } = await import('@/lib/db');
    const userRes = await tursoDb.execute({ sql: 'SELECT username, email FROM users WHERE id = ?', args: [userId] });
    const user = userRes.rows[0];
    const username = (user?.username as string) || userId.slice(0, 8);
    const email = user?.email as string | undefined;

    // Send email
    await sendSupportTicket({
      username,
      message: message.trim(),
      requestFaster: !!requestFaster,
      email,
    });

    return NextResponse.json({ success: true, message: 'Обращение отправлено' });
  } catch (err) {
    console.error('[support] Error:', err);
    return NextResponse.json({ error: 'Ошибка отправки обращения' }, { status: 500 });
  }
}
