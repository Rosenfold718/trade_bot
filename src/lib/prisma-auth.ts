import { PrismaClient } from '@prisma/client';
import { PrismaLibSQL } from '@prisma/adapter-libsql';
import { createClient } from '@libsql/client';
import { initAuthTables } from '@/lib/init-auth-tables';

let _db: PrismaClient | null = null;
let _initPromise: Promise<void> | null = null;

async function ensureInitialized() {
  if (_db) return;
  if (_initPromise) {
    await _initPromise;
    return;
  }
  _initPromise = (async () => {
    await initAuthTables();
    const libsql = createClient({
      url: process.env.TURSO_DATABASE_URL!,
      authToken: process.env.TURSO_AUTH_TOKEN!,
    });
    const adapter = new PrismaLibSQL(libsql);
    _db = new PrismaClient({ adapter });
  })();
  await _initPromise;
}

// Proxy so that callers can do `await db.user.findUnique(...)` transparently
export const db = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    return async (...args: any[]) => {
      await ensureInitialized();
      const fn = (_db as any)[prop];
      if (typeof fn === 'function') return fn.bind(_db)(...args);
      return fn;
    };
  },
});
