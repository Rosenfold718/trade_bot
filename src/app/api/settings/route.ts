import { NextRequest, NextResponse } from 'next/server';
import { getAllSettings, setSetting, deleteSetting } from '@/lib/db';
import { getAuthUserId } from '@/lib/auth-helpers';

export async function GET() {
  try {
    const userId = await getAuthUserId();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    // Return user-specific settings (per-user)
    const settings = await getAllSettings(userId);
    return NextResponse.json({ settings });
  } catch (err) {
    console.error('[settings GET]', err);
    return NextResponse.json({ error: 'Failed to load settings' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const userId = await getAuthUserId();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { updates, deletes } = body as {
      updates?: Record<string, string>;
      deletes?: string[];
    };

    if (updates) {
      for (const [key, value] of Object.entries(updates)) {
        await setSetting(key, value, userId);
      }
    }

    if (deletes) {
      for (const key of deletes) {
        await deleteSetting(key, userId);
      }
    }

    // Return updated user-specific settings
    const settings = await getAllSettings(userId);
    return NextResponse.json({ settings });
  } catch (err) {
    console.error('[settings PUT]', err);
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 });
  }
}
