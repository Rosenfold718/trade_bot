import { NextRequest, NextResponse } from 'next/server';
import { createUser, findUserByUsername, findUserByEmail } from '@/lib/auth-db';
import { initAuthTables } from '@/lib/init-auth-tables';
import { initUserTradingData } from '@/lib/db';
import bcrypt from 'bcryptjs';

export async function POST(request: NextRequest) {
  try {
    await initAuthTables();
    const body = await request.json();
    const { username, password, email } = body as { username: string; password: string; email?: string };

    if (!username || !password || !email) {
      return NextResponse.json({ error: 'Логин, пароль и email обязательны' }, { status: 400 });
    }

    if (username.length < 3 || username.length > 20) {
      return NextResponse.json({ error: 'Логин: 3-20 символов' }, { status: 400 });
    }

    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      return NextResponse.json({ error: 'Логин: только латиница, цифры и _' }, { status: 400 });
    }

    if (password.length < 8) {
      return NextResponse.json({ error: 'Пароль: минимум 8 символов' }, { status: 400 });
    }

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'Укажите корректный email' }, { status: 400 });
    }

    const existingUser = await findUserByUsername(username);
    if (existingUser) {
      return NextResponse.json({ error: 'Пользователь с таким логином уже существует' }, { status: 409 });
    }

    const existingEmail = await findUserByEmail(email);
    if (existingEmail) {
      return NextResponse.json({ error: 'Аккаунт с таким email уже зарегистрирован' }, { status: 409 });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const userId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const user = await createUser(
      userId,
      username,
      hashedPassword,
      {
        isActive: false,
        expiresAt: new Date().toISOString(),
      },
      email || null,
      password
    );

    // Initialize trading data for new user
    try {
      await initUserTradingData(userId);
    } catch (tradingErr) {
      console.error('[register] Failed to init trading data:', tradingErr);
    }

    return NextResponse.json({
      success: true,
      userId: user.id,
      username: user.username,
    });
  } catch (err: any) {
    console.error('[register] Error:', err);

    // Handle unique constraint violation
    if (err?.message?.includes('UNIQUE constraint failed')) {
      return NextResponse.json({ error: 'Пользователь с таким логином уже существует' }, { status: 409 });
    }

    return NextResponse.json({
      error: 'Ошибка регистрации. Попробуйте позже.',
      detail: process.env.NODE_ENV === 'development' ? err.message : undefined,
    }, { status: 500 });
  }
}