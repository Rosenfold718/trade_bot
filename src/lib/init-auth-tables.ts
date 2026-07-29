import { createClient } from '@libsql/client';

let _done = false;

export async function initAuthTables(): Promise<void> {
  if (_done) return;

  const url = process.env.TURSO_DATABASE_URL;
  const token = process.env.TURSO_AUTH_TOKEN;

  if (!url || !token) {
    throw new Error(
      '[initAuthTables] Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN environment variables.'
    );
  }

  const client = createClient({ url, authToken: token });

  const statements = `
    CREATE TABLE IF NOT EXISTS "User" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "username" TEXT NOT NULL,
      "password" TEXT NOT NULL,
      "email" TEXT,
      "telegram" TEXT,
      "role" TEXT NOT NULL DEFAULT 'user',
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS "User_username_key" ON "User"("username");

    CREATE TABLE IF NOT EXISTS "Account" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "type" TEXT NOT NULL,
      "provider" TEXT NOT NULL,
      "providerAccountId" TEXT NOT NULL,
      "refresh_token" TEXT,
      "access_token" TEXT,
      "expires_at" INTEGER,
      "token_type" TEXT,
      "scope" TEXT,
      "id_token" TEXT,
      "session_state" TEXT,
      CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
    );
    CREATE UNIQUE INDEX IF NOT EXISTS "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

    CREATE TABLE IF NOT EXISTS "Session" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "sessionToken" TEXT NOT NULL,
      "userId" TEXT NOT NULL,
      "expires" DATETIME NOT NULL,
      CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
    );
    CREATE UNIQUE INDEX IF NOT EXISTS "Session_sessionToken_key" ON "Session"("sessionToken");

    CREATE TABLE IF NOT EXISTS "VerificationToken" (
      "identifier" TEXT NOT NULL,
      "token" TEXT NOT NULL,
      "expires" DATETIME NOT NULL,
      CONSTRAINT "VerificationToken_identifier_token_key" UNIQUE ("identifier", "token")
    );

    CREATE TABLE IF NOT EXISTS "Subscription" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "isActive" BOOLEAN NOT NULL DEFAULT 0,
      "startsAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "expiresAt" DATETIME NOT NULL,
      "lastPaymentAt" DATETIME,
      CONSTRAINT "Subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
    );
    CREATE UNIQUE INDEX IF NOT EXISTS "Subscription_userId_key" ON "Subscription"("userId");

    CREATE TABLE IF NOT EXISTS "PaymentRequest" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "months" INTEGER NOT NULL DEFAULT 1,
      "planLabel" TEXT NOT NULL DEFAULT '1 месяц',
      "amountUSD" REAL NOT NULL DEFAULT 0,
      "txHash" TEXT,
      "status" TEXT NOT NULL DEFAULT 'pending',
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "reviewedAt" DATETIME,
      "reviewedBy" TEXT
    );
    CREATE INDEX IF NOT EXISTS "PaymentRequest_status_idx" ON "PaymentRequest"("status");

    CREATE TABLE IF NOT EXISTS "PaymentHistory" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "planLabel" TEXT NOT NULL,
      "amountUSD" REAL NOT NULL,
      "txHash" TEXT,
      "status" TEXT NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "confirmedAt" DATETIME,
      "confirmedBy" TEXT
    );

    CREATE TABLE IF NOT EXISTS "AuditLog" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "actorId" TEXT NOT NULL,
      "actorName" TEXT NOT NULL,
      "action" TEXT NOT NULL,
      "targetId" TEXT,
      "targetName" TEXT,
      "details" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS "SupportTicket" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "username" TEXT NOT NULL,
      "message" TEXT NOT NULL,
      "requestFaster" BOOLEAN NOT NULL DEFAULT 0,
      "emailSent" BOOLEAN NOT NULL DEFAULT 0,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS "SupportTicket_createdAt_idx" ON "SupportTicket"("createdAt");
  `.split(';').filter(s => s.trim().length > 0).map(s => s.trim() + ';');

  for (const stmt of statements) {
    await client.execute(stmt);
  }

  // Migrate: add missing columns to existing tables
  const migrations = [
    { table: 'User', col: 'email', def: 'ALTER TABLE "User" ADD COLUMN "email" TEXT' },
    { table: 'User', col: 'telegram', def: 'ALTER TABLE "User" ADD COLUMN "telegram" TEXT' },
    { table: 'User', col: 'role', def: 'ALTER TABLE "User" ADD COLUMN "role" TEXT NOT NULL DEFAULT \'user\'' },
    { table: 'PaymentRequest', col: 'planLabel', def: 'ALTER TABLE "PaymentRequest" ADD COLUMN "planLabel" TEXT NOT NULL DEFAULT \'1 месяц\'' },
    { table: 'PaymentRequest', col: 'amountUSD', def: 'ALTER TABLE "PaymentRequest" ADD COLUMN "amountUSD" REAL NOT NULL DEFAULT 0' },
    { table: 'PaymentRequest', col: 'txHash', def: 'ALTER TABLE "PaymentRequest" ADD COLUMN "txHash" TEXT' },
    { table: 'PaymentRequest', col: 'paymentMethod', def: 'ALTER TABLE "PaymentRequest" ADD COLUMN "paymentMethod" TEXT DEFAULT \'ton\'' },
  ];

  for (const m of migrations) {
    try {
      await client.execute(`SELECT ${m.col} FROM "${m.table}" LIMIT 0`);
    } catch {
      try { await client.execute(m.def); } catch { /* ignore */ }
    }
  }

  _done = true;
  console.log('Auth tables initialized in Turso');
}
