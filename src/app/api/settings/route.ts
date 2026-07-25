import { NextRequest, NextResponse } from 'next/server';
import { getAllSettings, setSetting, deleteSetting } from '@/lib/db';

export async function GET() {
  try {
    const settings = await getAllSettings();
    return NextResponse.json({ settings });
  } catch (err) {
    console.error('[settings GET]', err);
    return NextResponse.json({ error: 'Failed to load settings' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const { updates, deletes } = body as {
      updates?: Record<string, string>;
      deletes?: string[];
    };

    if (updates) {
      for (const [key, value] of Object.entries(updates)) {
        await setSetting(key, value);
      }
    }

    if (deletes) {
      for (const key of deletes) {
        await deleteSetting(key);
      }
    }

    // Return updated settings
    const settings = await getAllSettings();
    return NextResponse.json({ settings });
  } catch (err) {
    console.error('[settings PUT]', err);
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 });
  }
}
