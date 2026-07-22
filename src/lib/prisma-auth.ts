import { PrismaClient } from '@prisma/client';
import { PrismaLibSql } from '@prisma/adapter-libsql';
import { createClient } from '@libsql/client';

let _db: PrismaClient | null = null;

export function getAuthDb(): PrismaClient {
  if (_db) return _db;

  const url = process.env.TURSO_DATABASE_URL;
  const token = process.env.TURSO_AUTH_TOKEN;

  // Log for debugging
  console.log('[prisma-auth] TURSO_DATABASE_URL:', url ? `${url.slice(0, 20)}...` : 'MISSING');
  console.log('[prisma-auth] TURSO_AUTH_TOKEN:', token ? '***SET***' : 'MISSING');

  if (!url || !token) {
    throw new Error(`[prisma-auth] Missing env vars. TURSO_DATABASE_URL=${url ? 'set' : 'MISSING'}, TURSO_AUTH_TOKEN=${token ? 'set' : 'MISSING'}`);
  }

  const libsql = createClient({ url, authToken: token });
  const adapter = new PrismaLibSql(libsql);

  // Explicitly set datasourceUrl so Prisma doesn't read undefined DATABASE_URL
  _db = new PrismaClient({
    adapter,
    datasources: {
      db: { url },
    },
  });

  return _db;
}

export const db = new Proxy({} as PrismaClient, {
  get(_, prop) {
    return (getAuthDb() as any)[prop];
  },
});
