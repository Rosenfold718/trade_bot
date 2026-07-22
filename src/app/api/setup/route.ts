import { NextResponse } from 'next/server';
import { db } from '@/lib/prisma-auth';
import { initAuthTables } from '@/lib/init-auth-tables';
import bcrypt from 'bcryptjs';

const SETUP_KEY = process.env.ADMIN_SETUP_KEY || 'trade-bot-admin-2024';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const key = searchParams.get('key') || '';

  if (key !== SETUP_KEY) {
    return NextResponse.json({ error: 'Неверный ключ. Используй /api/setup?key=trade-bot-admin-2024' }, { status: 403 });
  }

  const results: string[] = [];

  // 1. Create auth tables
  try {
    await initAuthTables();
    results.push('✅ Таблицы авторизации созданы');
  } catch (err: any) {
    results.push(`❌ Ошибка создания таблиц: ${err.message}`);
    return NextResponse.json({ results, status: 'error' }, { status: 500 });
  }

  // 2. Check if admin exists
  try {
    const existing = await db.user.findUnique({ where: { username: 'admin' } });
    if (existing) {
      results.push('ℹ️ Админ уже существует, пропускаю');
    } else {
      // 3. Create admin
      const hashedPassword = await bcrypt.hash('Admin123', 12);
      const farFuture = new Date();
      farFuture.setFullYear(farFuture.getFullYear() + 10);

      await db.user.create({
        data: {
          username: 'admin',
          password: hashedPassword,
          subscription: {
            create: {
              isActive: true,
              startsAt: new Date(),
              expiresAt: farFuture,
              lastPaymentAt: new Date(),
            },
          },
        },
      });
      results.push('✅ Админ создан: admin / Admin123');
    }
  } catch (err: any) {
    results.push(`❌ Ошибка создания админа: ${err.message}`);
  }

  // 4. Show all users
  try {
    const users = await db.user.findMany({
      select: { username: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    results.push(`📊 Пользователей в базе: ${users.length}`);
    for (const u of users) {
      results.push(`   - ${u.username} (создан: ${u.createdAt?.toISOString().slice(0, 10)})`);
    }
  } catch (err: any) {
    results.push(`❌ Ошибка чтения пользователей: ${err.message}`);
  }

  return NextResponse.json({ results, status: 'ok' });
}
