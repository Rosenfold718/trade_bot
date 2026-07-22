import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/prisma-auth';
import { initAuthTables } from '@/lib/init-auth-tables';
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

    const existing = await db.user.findUnique({ where: { username } });
    if (existing) {
      return NextResponse.json({ error: 'Пользователь с таким логином уже существует' }, { status: 409 });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const user = await db.user.create({
      data: {
        username,
        password: hashedPassword,
        subscription: {
          create: {
            isActive: false,
            expiresAt: new Date(),
          },
        },
      },
    });

    return NextResponse.json({
      success: true,
      userId: user.id,
      username: user.username,
    });
  } catch (err: any) {
    console.error('[register] Error:', err);

    // Handle specific Prisma errors
    if (err?.code === 'P2002') {
      return NextResponse.json({ error: 'Пользователь с таким логином уже существует' }, { status: 409 });
    }

    return NextResponse.json({
      error: 'Ошибка регистрации. Попробуйте позже.',
    detail: process.env.NODE_ENV === 'development' ? err.message : undefined,
    }, { status: 500 });
  }
}