import { NextRequest, NextResponse } from 'next/server';
import { getAuthUserId } from '@/lib/auth-helpers';
import { findUserById, createSupportTicket } from '@/lib/auth-db';
import { initAuthTables } from '@/lib/init-auth-tables';
import { sendSupportTicket } from '@/lib/email';

export async function POST(request: NextRequest) {
  try {
    const userId = await getAuthUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Не авторизован. Войдите в аккаунт заново.' }, { status: 401 });
    }

    const body = await request.json();
    const { email, message, requestFaster } = body as { email?: string; message?: string; requestFaster?: boolean };

    // Validate email — mandatory
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return NextResponse.json({ error: 'Укажите корректный email для ответа' }, { status: 400 });
    }

    if (!message || message.trim().length < 3) {
      return NextResponse.json({ error: 'Сообщение слишком короткое' }, { status: 400 });
    }

    if (message.length > 2000) {
      return NextResponse.json({ error: 'Сообщение слишком длинное (макс. 2000 символов)' }, { status: 400 });
    }

    // Init auth tables (idempotent)
    await initAuthTables();

    // Get username
    let username = userId.slice(0, 8);
    try {
      const user = await findUserById(userId);
      if (user) username = user.username;
    } catch {
      // use fallback
    }

    const userEmail = email.trim();

    // 1) Save to DB — always
    try {
      await createSupportTicket({
        userId,
        username,
        message: message.trim(),
        requestFaster: !!requestFaster,
      });
    } catch (dbErr) {
      console.error('[support] DB save failed:', dbErr);
      return NextResponse.json({ error: 'Ошибка сохранения. Попробуйте позже.' }, { status: 500 });
    }

    // 2) Send email — best-effort
    try {
      await sendSupportTicket({
        username,
        userEmail,
        message: message.trim(),
        requestFaster: !!requestFaster,
      });
    } catch (emailErr) {
      console.error('[support] Email failed (saved to DB):', emailErr);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[support] Unexpected error:', err);
    return NextResponse.json({ error: 'Ошибка отправки. Попробуйте позже.' }, { status: 500 });
  }
}
