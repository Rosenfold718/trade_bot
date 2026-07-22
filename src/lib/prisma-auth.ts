import { PrismaClient } from '@prisma/client';
import { PrismaLibSql } from '@prisma/adapter-libsql';
import { createClient } from '@libsql/client';

let _db: PrismaClient | null = null;

export function getAuthDb(): PrismaClient {
  if (_db) return _db;

  const url = process.env.TURSO_DATABASE_URL;
  const token = process.env.TURSO_AUTH_TOKEN;

  if (!url || !token) {
    throw new Error('[prisma-auth] Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN');
  }

  const libsql = createClient({ url, authToken: token });
  const adapter = new PrismaLibSql(libsql);
  _db = new PrismaClient({ adapter });
  return _db;
}

// Backward-compatible alias
export const db = new Proxy({} as PrismaClient, {
  get(_, prop) {
    // Use direct property access (not Reflect.get) so Prisma getters get correct `this`
    return (getAuthDb() as any)[prop];
  },
});
