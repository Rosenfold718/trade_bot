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
    const { message, requestFaster } = body as { message?: string; requestFaster?: boolean };

    if (!message || message.trim().length < 3) {
      return NextResponse.json({ error: 'Сообщение слишком короткое' }, { status: 400 });
    }

    if (message.length > 2000) {
      return NextResponse.json({ error: 'Сообщение слишком длинное (макс. 2000 символов)' }, { status: 400 });
    }

    // Init auth tables (idempotent)
    await initAuthTables();

    // Get user info — non-blocking
    let username = userId.slice(0, 8);
    let userEmail: string | undefined;
    try {
      const user = await findUserById(userId);
      if (user) {
        username = user.username;
        userEmail = user.email || undefined;
      }
    } catch (dbErr) {
      console.warn('[support] Could not fetch user:', dbErr);
    }

    // 1) Always save to DB first — this is the reliable path
    try {
      await createSupportTicket({
        userId,
        username,
        message: message.trim(),
        requestFaster: !!requestFaster,
      });
    } catch (dbErr) {
      console.error('[support] DB save failed:', dbErr);
      return NextResponse.json({ error: 'Ошибка сохранения обращения. Попробуйте позже.' }, { status: 500 });
    }

    // 2) Try to send email — best-effort, failure doesn't block success
    try {
      await sendSupportTicket({
        username,
        message: message.trim(),
        requestFaster: !!requestFaster,
        email: userEmail,
      });
    } catch (emailErr) {
      console.error('[support] Email failed (message saved to DB):', emailErr);
      // Still return success — message is saved in DB
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[support] Unexpected error:', err);
    return NextResponse.json({ error: 'Ошибка отправки. Попробуйте позже.' }, { status: 500 });
  }
}
