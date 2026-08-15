import { NextRequest, NextResponse } from 'next/server';
import { getAuthUserId } from '@/lib/auth-helpers';
import { findUserById } from '@/lib/auth-db';
import { initAuthTables } from '@/lib/init-auth-tables';
import bcrypt from 'bcryptjs';

// POST /api/change-password — change user's own password
export async function POST(request: NextRequest) {
  try {
    await initAuthTables();
    const userId = await getAuthUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { currentPassword, newPassword } = body as { currentPassword: string; newPassword: string };

    if (!currentPassword || !newPassword) {
      return NextResponse.json({ error: 'currentPassword and newPassword required' }, { status: 400 });
    }

    if (newPassword.length < 4) {
      return NextResponse.json({ error: 'Новый пароль слишком короткий' }, { status: 400 });
    }

    const user = await findUserById(userId);
    if (!user) {
      return NextResponse.json({ error: 'Пользователь не найден' }, { status: 404 });
    }

    // Verify current password (bcrypt hash)
    const isPasswordValid = await bcrypt.compare(currentPassword, user.password);
    if (!isPasswordValid) {
      return NextResponse.json({ error: 'Неверный текущий пароль' }, { status: 403 });
    }

    // Hash and update new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    const { getAuthClient } = await import('@/lib/auth-db');
    const db = getAuthClient();
    await db.execute(
      `UPDATE "User" SET password = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?`,
      [hashedPassword, userId]
    );

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[change-password POST] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
