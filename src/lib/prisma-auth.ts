import { PrismaClient } from '@prisma/client';
import { PrismaLibSql } from '@prisma/adapter-libsql';
import { createClient } from '@libsql/client';
import { initAuthTables } from '@/lib/init-auth-tables';

let _db: PrismaClient | null = null;

function getDb(): PrismaClient {
  if (_db) return _db;

  const url = process.env.TURSO_DATABASE_URL;
  const token = process.env.TURSO_AUTH_TOKEN;

  if (!url || !token) {
    throw new Error(
      '[prisma-auth] Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN environment variables.'
    );
  }

  const libsql = createClient({ url, authToken: token });
  const adapter = new PrismaLibSql(libsql);
  _db = new PrismaClient({ adapter });
  return _db;
}

// Lazy proxy — real connection created only on first query
export const db = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    const client = getDb();
    const value = Reflect.get(client, prop, receiver);
    if (typeof value === 'function') {
      return value.bind(client);
    }
    return value;
  },
});
