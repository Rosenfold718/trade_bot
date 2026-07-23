import { createClient, type Client } from '@libsql/client';

// ============================================================
// Direct Turso connection for auth — NO Prisma adapter needed
// ============================================================

let _client: Client | null = null;

function getClient(): Client {
  if (_client) return _client;

  const url = process.env.TURSO_DATABASE_URL;
  const token = process.env.TURSO_AUTH_TOKEN;

  if (!url || !token) {
    throw new Error(
      '[auth-db] Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN'
    );
  }

  _client = createClient({ url, authToken: token });
  return _client;
}

// Export getClient for direct use (Proxy breaks private class fields in @libsql/client)
export { getClient as getAuthClient };

// ============================================================
// User queries
// ============================================================

export interface AuthUser {
  id: string;
  username: string;
  password: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuthSubscription {
  id: string;
  userId: string;
  isActive: number; // SQLite boolean = 0/1
  startsAt: string;
  expiresAt: string;
  lastPaymentAt: string | null;
}

export async function findUserByUsername(username: string): Promise<AuthUser | null> {
  const result = await getClient().execute(
    `SELECT * FROM "User" WHERE username = ?`,
    [username]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id as string,
    username: row.username as string,
    password: row.password as string,
    createdAt: row.createdAt as string,
    updatedAt: row.updatedAt as string,
  };
}

export async function findUserById(id: string): Promise<AuthUser | null> {
  const result = await getClient().execute(
    `SELECT * FROM "User" WHERE id = ?`,
    [id]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id as string,
    username: row.username as string,
    password: row.password as string,
    createdAt: row.createdAt as string,
    updatedAt: row.updatedAt as string,
  };
}

export async function createUser(
  id: string,
  username: string,
  hashedPassword: string,
  subscriptionData?: { isActive: boolean; expiresAt: string; lastPaymentAt?: string }
): Promise<AuthUser> {
  await getClient().execute(
    `INSERT INTO "User" (id, username, password, createdAt, updatedAt) VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [id, username, hashedPassword]
  );

  if (subscriptionData) {
    const subId = `sub-${id}`;
    await getClient().execute(
      `INSERT OR IGNORE INTO "Subscription" (id, userId, isActive, startsAt, expiresAt, lastPaymentAt) VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?, ?)`,
      [subId, id, subscriptionData.isActive ? 1 : 0, subscriptionData.expiresAt, subscriptionData.lastPaymentAt || null]
    );
  }

  const user = await findUserByUsername(username);
  if (!user) throw new Error('Failed to create user');
  return user;
}

export async function upsertUser(
  id: string,
  username: string,
  hashedPassword: string,
  subscriptionData?: { isActive: boolean; expiresAt: string; lastPaymentAt?: string }
): Promise<AuthUser> {
  // Try to find existing user
  const existing = await findUserByUsername(username);
  if (existing) {
    // Update password
    await getClient().execute(
      `UPDATE "User" SET password = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?`,
      [hashedPassword, existing.id]
    );
  } else {
    // Create new
    const newId = id || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await getClient().execute(
      `INSERT INTO "User" (id, username, password, createdAt, updatedAt) VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [newId, username, hashedPassword]
    );
  }

  // Handle subscription
  if (subscriptionData) {
    const userRow = await findUserByUsername(username);
    if (userRow) {
      await getClient().execute(
        `INSERT INTO "Subscription" (id, userId, isActive, startsAt, expiresAt, lastPaymentAt)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?, ?)
         ON CONFLICT(userId) DO UPDATE SET
           isActive = excluded.isActive,
           startsAt = excluded.startsAt,
           expiresAt = excluded.expiresAt,
           lastPaymentAt = excluded.lastPaymentAt`,
        [
          `sub-${userRow.id}`,
          userRow.id,
          subscriptionData.isActive ? 1 : 0,
          subscriptionData.expiresAt,
          subscriptionData.lastPaymentAt || null,
        ]
      );
    }
  }

  const user = await findUserByUsername(username);
  if (!user) throw new Error('Failed to upsert user');
  return user;
}

export async function getAllUsers(): Promise<Array<AuthUser & { subscription: AuthSubscription | null }>> {
  const result = await getClient().execute(
    `SELECT u.id, u.username, u.createdAt,
            s.id as sub_id, s.userId as sub_userId, s.isActive as sub_isActive,
            s.startsAt as sub_startsAt, s.expiresAt as sub_expiresAt, s.lastPaymentAt as sub_lastPaymentAt
     FROM "User" u
     LEFT JOIN "Subscription" s ON s.userId = u.id
     ORDER BY u.createdAt DESC`
  );
  return result.rows.map(row => ({
    id: row.id as string,
    username: row.username as string,
    createdAt: row.createdAt as string,
    updatedAt: '',
    password: '',
    subscription: row.sub_id ? {
      id: row.sub_id as string,
      userId: row.sub_userId as string,
      isActive: Number(row.sub_isActive),
      startsAt: row.sub_startsAt as string,
      expiresAt: row.sub_expiresAt as string,
      lastPaymentAt: row.sub_lastPaymentAt as string | null,
    } : null,
  }));
}

// ============================================================
// Subscription queries
// ============================================================

export async function findSubscriptionByUserId(userId: string): Promise<AuthSubscription | null> {
  const result = await getClient().execute(
    `SELECT * FROM "Subscription" WHERE userId = ?`,
    [userId]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id as string,
    userId: row.userId as string,
    isActive: Number(row.isActive),
    startsAt: row.startsAt as string,
    expiresAt: row.expiresAt as string,
    lastPaymentAt: row.lastPaymentAt as string | null,
  };
}

export async function upsertSubscription(
  userId: string,
  data: { isActive: boolean; startsAt: string; expiresAt: string; lastPaymentAt?: string }
): Promise<AuthSubscription> {
  await getClient().execute(
    `INSERT INTO "Subscription" (id, userId, isActive, startsAt, expiresAt, lastPaymentAt)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(userId) DO UPDATE SET
       isActive = excluded.isActive,
       startsAt = excluded.startsAt,
       expiresAt = excluded.expiresAt,
       lastPaymentAt = excluded.lastPaymentAt`,
    [
      `sub-${userId}`,
      userId,
      data.isActive ? 1 : 0,
      data.startsAt,
      data.expiresAt,
      data.lastPaymentAt || null,
    ]
  );
  const sub = await findSubscriptionByUserId(userId);
  if (!sub) throw new Error('Failed to upsert subscription');
  return sub;
}
