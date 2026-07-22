import { NextResponse } from 'next/server';
import { getAuthDb } from '@/lib/prisma-auth';
import { initAuthTables } from '@/lib/init-auth-tables';
import bcrypt from 'bcryptjs';

const SETUP_KEY = process.env.ADMIN_SETUP_KEY || 'trade-bot-admin-2024';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const key = searchParams.get('key') || '';

  if (key !== SETUP_KEY) {
    return new NextResponse(`❌ Неверный ключ. Используй /api/setup?key=trade-bot-admin-2024`, { status: 403 });
  }

  const lines: string[] = [];
  let hasError = false;

  // 1. Create auth tables
  try {
    await initAuthTables();
    lines.push('✅ Таблицы авторизации созданы');
  } catch (err: any) {
    lines.push(`❌ Ошибка создания таблиц: ${err.message}`);
    hasError = true;
  }

  if (!hasError) {
    // 2. Check if admin exists
    try {
      const db = getAuthDb();
      const existing = await db.user.findUnique({ where: { username: 'admin' } });
      if (existing) {
        lines.push('ℹ️ Админ уже существует, пропускаю');
      } else {
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
        lines.push('✅ Админ создан: login=<b>admin</b> password=<b>Admin123</b>');
      }
    } catch (err: any) {
      lines.push(`❌ Ошибка создания админа: ${err.message}`);
      hasError = true;
    }

    // 3. Show all users
    try {
      const db = getAuthDb();
      const users = await db.user.findMany({
        select: { username: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      });
      lines.push(`📊 Пользователей в базе: ${users.length}`);
      for (const u of users) {
        lines.push(`   → ${u.username}`);
      }
    } catch (err: any) {
      lines.push(`❌ Ошибка чтения: ${err.message}`);
    }
  }

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Setup</title></head>
<body style="font-family:monospace;padding:40px;background:#111;color:#eee">
<h2>Trade Bot Setup</h2>
${lines.map(l => `<p>${l}</p>`).join('')}
<p style="margin-top:30px;color:#888">Теперь можно зайти на главную страницу и войти как admin / Admin123</p>
</body></html>`;

  return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
