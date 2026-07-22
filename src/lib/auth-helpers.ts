import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { headers } from 'next/headers';

export async function getAuthUserId(request?: Request): Promise<string | null> {
  try {
    // In App Router Route Handlers, we need to pass request headers
    // so getServerSession can read the session cookie
    const reqHeaders = request?.headers || (await headers());
    const session = await getServerSession({
      ...authOptions,
      headers: reqHeaders,
    });
    if (session?.user) {
      return (session.user as any).id;
    }
    return null;
  } catch (err) {
    console.error('[getAuthUserId] Error:', err);
    return null;
  }
}
