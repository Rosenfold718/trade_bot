import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/prisma-auth';
import bcrypt from 'bcryptjs';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { username, password } = body as { username: string; password: string };

    if (!username || !password) {
      return NextResponse.json({ error: 'Логин и пароль обязательны' }, { status: 400 });
    }

    if (username.length < 3 || username.length > 30) {
      return NextResponse.json({ error: 'Логин должен быть от 3 до 30 символов' }, { status: 400 });
    }

    if (password.length < 6) {
      return NextResponse.json({ error: 'Пароль должен быть не менее 6 символов' }, { status: 400 });
    }

    // Check if username already exists
    const existing = await db.user.findUnique({ where: { username } });
    if (existing) {
      return NextResponse.json({ error: 'Пользователь с таким логином уже существует' }, { status: 409 });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Create user with inactive subscription
    const user = await db.user.create({
      data: {
        username,
        password: hashedPassword,
        subscription: {
          create: {
            isActive: false,
            expiresAt: new Date(), // expired immediately
          },
        },
      },
    });

    // Initialize user's trading state in Turso (via init API call will be made from client)
    return NextResponse.json({
      success: true,
      userId: user.id,
      username: user.username,
      requiresPayment: true,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[register] Error:', message);
    return NextResponse.json({ error: 'Ошибка регистрации' }, { status: 500 });
  }
}