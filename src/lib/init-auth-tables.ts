import { createClient } from '@libsql/client';

const TURSO_URL = process.env.TURSO_DATABASE_URL!;
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN!;

let _client: ReturnType<typeof createClient> | null = null;
let _done = false;

function getClient() {
  if (!_client) {
    _client = createClient({ url: TURSO_URL, authToken: TURSO_AUTH_TOKEN });
  }
  return _client;
}

export async function initAuthTables(): Promise<void> {
  if (_done) return;
  const client = getClient();

  const statements = `
    CREATE TABLE IF NOT EXISTS "User" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "username" TEXT NOT NULL,
      "password" TEXT NOT NULL,
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
  `.split(';').filter(s => s.trim().length > 0).map(s => s.trim() + ';');

  for (const stmt of statements) {
    await client.execute(stmt);
  }

  _done = true;
  console.log('✅ Auth tables initialized in Turso');
}
