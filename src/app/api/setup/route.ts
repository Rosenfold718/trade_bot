import { NextResponse } from 'next/server';
import { findUserByUsername, createUser, getAllUsers } from '@/lib/auth-db';
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
      const existing = await findUserByUsername('admin');
      if (existing) {
        lines.push('ℹ️ Админ уже существует, пропускаю');
      } else {
        const hashedPassword = await bcrypt.hash('Admin123', 12);
        const farFuture = new Date();
        farFuture.setFullYear(farFuture.getFullYear() + 10);
        const userId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

        await createUser(
          userId,
          'admin',
          hashedPassword,
          {
            isActive: true,
            expiresAt: farFuture.toISOString(),
            lastPaymentAt: new Date().toISOString(),
          }
        );
        lines.push('✅ Админ создан: login=<b>admin</b> password=<b>Admin123</b>');
      }
    } catch (err: any) {
      lines.push(`❌ Ошибка создания админа: ${err.message}`);
      hasError = true;
    }

    // 3. Show all users
    try {
      const users = await getAllUsers();
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
