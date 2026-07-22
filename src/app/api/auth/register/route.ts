import { NextRequest, NextResponse } from 'next/server';
import { createUser, findUserByUsername } from '@/lib/auth-db';
import { initAuthTables } from '@/lib/init-auth-tables';
import { initUserTradingData } from '@/lib/db';
import bcrypt from 'bcryptjs';

export async function POST(request: NextRequest) {
  try {
    await initAuthTables();
    const body = await request.json();
    const { username, password } = body as { username: string; password: string };

    if (!username || !password) {
      return NextResponse.json({ error: 'Логин и пароль обязательны' }, { status: 400 });
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

    const existing = await findUserByUsername(username);
    if (existing) {
      return NextResponse.json({ error: 'Пользователь с таким логином уже существует' }, { status: 409 });
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
      }
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