import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

export async function getAuthUserId(request?: Request): Promise<string | null> {
  try {
    // Try header first (for direct API calls with session token)
    const session = await getServerSession(authOptions);
    if (session?.user) {
      return (session.user as any).id;
    }
    return null;
  } catch {
    return null;
  }
}