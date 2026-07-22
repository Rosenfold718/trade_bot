import { PrismaClient } from '@prisma/client';
import { PrismaLibSql } from '@prisma/adapter-libsql';
import { createClient } from '@libsql/client';

const TURSO_URL = process.env.TURSO_DATABASE_URL;
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN;

if (!TURSO_URL || !TURSO_AUTH_TOKEN) {
  console.warn('[prisma-auth] TURSO_DATABASE_URL or TURSO_AUTH_TOKEN not set. Auth will not work.');
}

const libsql = createClient({
  url: TURSO_URL || 'file:./dev-null.db',
  authToken: TURSO_AUTH_TOKEN || '',
});

const adapter = new PrismaLibSql(libsql);

export const db = new PrismaClient({ adapter });
