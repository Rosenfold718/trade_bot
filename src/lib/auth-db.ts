import { createClient, type Client } from '@libsql/client';
import bcrypt from 'bcryptjs';

// ============================================================
// Direct Turso connection for auth — NO Prisma adapter needed
// ============================================================

let _client: Client | null = null;

function getClient(): Client {
  if (_client) return _client;

  const url = process.env.TURSO_DATABASE_URL;
  const token = process.env.TURSO_AUTH_TOKEN || undefined;

  if (!url) {
    throw new Error(
      '[auth-db] Missing TURSO_DATABASE_URL'
    );
  }

  _client = createClient({ url, authToken: token });
  return _client;
}

export { getClient as getAuthClient };

// ============================================================
// Subscription Plans — time-based only
// ============================================================

export interface SubscriptionPlan {
  id: number;
  months: number;
  label: string;
  priceUSD: number;
  perMonth: string;
}

export const PLANS: SubscriptionPlan[] = [
  { id: 1, months: 1, label: '1 месяц', priceUSD: 49, perMonth: '$49/мес' },
  { id: 3, months: 3, label: '3 месяца', priceUSD: 129, perMonth: '$43/мес' },
  { id: 6, months: 6, label: '6 месяцев', priceUSD: 229, perMonth: '$38/мес' },
  { id: 12, months: 12, label: '12 месяцев', priceUSD: 399, perMonth: '$33/мес' },
];

export const CRYPTO_WALLET = {
  address: 'UQC2_CBuEhAmxr4fJBt-gGdP8u3Mc1-RNcinUPc6ydxz1cJO',
  network: 'TON',
};

// ============================================================
// User queries
// ============================================================

export interface AuthUser {
  id: string;
  username: string;
  password: string;
  plainPassword: string | null;
  email: string | null;
  telegram: string | null;
  role: string;
  isDemo: string | null;
  demoExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuthSubscription {
  id: string;
  userId: string;
  isActive: number;
  startsAt: string;
  expiresAt: string;
  lastPaymentAt: string | null;
}

function mapRowToUser(row: Record<string, unknown>): AuthUser {
  return {
    id: row.id as string,
    username: row.username as string,
    password: row.password as string,
    plainPassword: (row.plainPassword as string) || null,
    email: (row.email as string) || null,
    telegram: (row.telegram as string) || null,
    role: (row.role as string) || 'user',
    isDemo: (row.isDemo as string) || null,
    demoExpiresAt: (row.demoExpiresAt as string) || null,
    createdAt: row.createdAt as string,
    updatedAt: row.updatedAt as string,
  };
}

export async function findUserByUsername(username: string): Promise<AuthUser | null> {
  const result = await getClient().execute(
    `SELECT * FROM "User" WHERE username = ?`,
    [username]
  );
  const row = result.rows[0];
  if (!row) return null;
  return mapRowToUser(row);
}

export async function findUserByEmail(email: string): Promise<AuthUser | null> {
  const result = await getClient().execute(
    `SELECT * FROM "User" WHERE email = ?`,
    [email]
  );
  const row = result.rows[0];
  if (!row) return null;
  return mapRowToUser(row);
}

export async function findUserById(id: string): Promise<AuthUser | null> {
  const result = await getClient().execute(
    `SELECT * FROM "User" WHERE id = ?`,
    [id]
  );
  const row = result.rows[0];
  if (!row) return null;
  return mapRowToUser(row);
}

export async function createUser(
  id: string,
  username: string,
  hashedPassword: string,
  subscriptionData?: { isActive: boolean; expiresAt: string; lastPaymentAt?: string },
  email?: string | null,
  plainPassword?: string | null
): Promise<AuthUser> {
  await getClient().execute(
    `INSERT INTO "User" (id, username, password, plainPassword, email, telegram, role, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, NULL, 'user', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [id, username, hashedPassword, plainPassword || null, email || null]
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
  subscriptionData?: { isActive: boolean; expiresAt: string; lastPaymentAt?: string },
  plainPassword?: string | null
): Promise<AuthUser> {
  const existing = await findUserByUsername(username);
  if (existing) {
    await getClient().execute(
      `UPDATE "User" SET password = ?, plainPassword = COALESCE(?, plainPassword), updatedAt = CURRENT_TIMESTAMP WHERE id = ?`,
      [hashedPassword, plainPassword || null, existing.id]
    );
  } else {
    const newId = id || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await getClient().execute(
      `INSERT INTO "User" (id, username, password, plainPassword, email, telegram, role, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, NULL, NULL, 'user', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [newId, username, hashedPassword, plainPassword || null]
    );
  }

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
    `SELECT u.id, u.username, u.password, u.plainPassword, u.email, u.telegram, u.role, u.isDemo, u.demoExpiresAt, u.createdAt,
            s.id as sub_id, s.userId as sub_userId, s.isActive as sub_isActive,
            s.startsAt as sub_startsAt, s.expiresAt as sub_expiresAt, s.lastPaymentAt as sub_lastPaymentAt
     FROM "User" u
     LEFT JOIN "Subscription" s ON s.userId = u.id
     ORDER BY u.createdAt DESC`
  );
  return result.rows.map(row => ({
    id: row.id as string,
    username: row.username as string,
    password: row.password as string,
    plainPassword: (row.plainPassword as string) || null,
    email: (row.email as string) || null,
    telegram: (row.telegram as string) || null,
    role: (row.role as string) || 'user',
    isDemo: (row.isDemo as string) || null,
    demoExpiresAt: (row.demoExpiresAt as string) || null,
    createdAt: row.createdAt as string,
    updatedAt: '',
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
// Delete user (admin)
// ============================================================

export async function deleteUserById(userId: string): Promise<boolean> {
  const client = getClient();
  await client.execute(`DELETE FROM "PaymentRequest" WHERE userId = ?`, [userId]);
  await client.execute(`DELETE FROM "Subscription" WHERE userId = ?`, [userId]);
  await client.execute(`DELETE FROM "Session" WHERE userId = ?`, [userId]);
  await client.execute(`DELETE FROM "Account" WHERE userId = ?`, [userId]);
  const result = await client.execute(`DELETE FROM "User" WHERE id = ?`, [userId]);
  return result.rowsAffected > 0;
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

// ============================================================
// Support tickets
// ============================================================

export async function createSupportTicket(data: {
  userId: string;
  username: string;
  message: string;
  requestFaster: boolean;
}): Promise<string> {
  const id = `ticket-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await getClient().execute(
    `INSERT INTO "SupportTicket" (id, userId, username, message, requestFaster, emailSent, createdAt)
     VALUES (?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP)`,
    [id, data.userId, data.username, data.message, data.requestFaster ? 1 : 0]
  );
  return id;
}

// ============================================================
// Demo accounts
// ============================================================

export async function createDemoAccount(): Promise<{ username: string; plainPassword: string; expiresAt: string }> {
  const randomSuffix = Math.random().toString(36).slice(2, 8);
  const username = `demo_${randomSuffix}`;
  const plainPassword = Math.random().toString(36).slice(2, 10).toUpperCase();
  const hashedPassword = await bcrypt.hash(plainPassword, 10);

  const userId = `demo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();

  await getClient().execute(
    `INSERT INTO "User" (id, username, password, plainPassword, email, telegram, role, isDemo, demoExpiresAt, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, NULL, NULL, 'demo', '1', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [userId, username, hashedPassword, plainPassword, expiresAt]
  );

  // Create subscription active for 2 hours
  const subId = `sub-${userId}`;
  await getClient().execute(
    `INSERT OR IGNORE INTO "Subscription" (id, userId, isActive, startsAt, expiresAt, lastPaymentAt)
     VALUES (?, ?, 1, CURRENT_TIMESTAMP, ?, NULL)`,
    [subId, userId, expiresAt]
  );

  return { username, plainPassword, expiresAt };
}

export async function resetDemoAccount(userId: string): Promise<boolean> {
  const client = getClient();
  const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();

  const result = await client.execute(
    `UPDATE "User" SET demoExpiresAt = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ? AND isDemo = '1'`,
    [expiresAt, userId]
  );

  if (result.rowsAffected > 0) {
    // Also update subscription to be active for 2 hours
    await client.execute(
      `INSERT INTO "Subscription" (id, userId, isActive, startsAt, expiresAt, lastPaymentAt)
       VALUES (?, ?, 1, CURRENT_TIMESTAMP, ?, NULL)
       ON CONFLICT(userId) DO UPDATE SET isActive = 1, startsAt = CURRENT_TIMESTAMP, expiresAt = ?`,
      [`sub-${userId}`, userId, expiresAt, expiresAt]
    );
    return true;
  }
  return false;
}

export async function getDemoAccounts(): Promise<Array<AuthUser & { subscription: AuthSubscription | null }>> {
  const result = await getClient().execute(
    `SELECT u.id, u.username, u.password, u.plainPassword, u.email, u.telegram, u.role, u.isDemo, u.demoExpiresAt, u.createdAt,
            s.id as sub_id, s.userId as sub_userId, s.isActive as sub_isActive,
            s.startsAt as sub_startsAt, s.expiresAt as sub_expiresAt, s.lastPaymentAt as sub_lastPaymentAt
     FROM "User" u
     LEFT JOIN "Subscription" s ON s.userId = u.id
     WHERE u.isDemo = '1'
     ORDER BY u.createdAt DESC`
  );
  return result.rows.map(row => ({
    id: row.id as string,
    username: row.username as string,
    password: row.password as string,
    plainPassword: (row.plainPassword as string) || null,
    email: (row.email as string) || null,
    telegram: (row.telegram as string) || null,
    role: (row.role as string) || 'demo',
    isDemo: (row.isDemo as string) || null,
    demoExpiresAt: (row.demoExpiresAt as string) || null,
    createdAt: row.createdAt as string,
    updatedAt: '',
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

export async function resetUserPassword(userId: string): Promise<string> {
  const newPassword = Math.random().toString(36).slice(2, 12).toUpperCase();
  const hashedPassword = await bcrypt.hash(newPassword, 10);

  await getClient().execute(
    `UPDATE "User" SET password = ?, plainPassword = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?`,
    [hashedPassword, newPassword, userId]
  );

  return newPassword;
}

/** Ensure a user has a plainPassword stored. If missing, auto-reset and return new password. */
export async function ensurePlainPassword(userId: string): Promise<string> {
  const row = await getClient().execute(
    `SELECT plainPassword FROM "User" WHERE id = ?`,
    [userId]
  );
  if (row.rows.length > 0 && row.rows[0].plainPassword) {
    return row.rows[0].plainPassword as string;
  }
  // No plain password — reset it
  const newPlain = Math.random().toString(36).slice(2, 12).toUpperCase();
  const hashed = await bcrypt.hash(newPlain, 10);
  await getClient().execute(
    `UPDATE "User" SET password = ?, plainPassword = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?`,
    [hashed, newPlain, userId]
  );
  return newPlain;
}
