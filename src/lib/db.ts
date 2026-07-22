import { createClient, type Client } from '@libsql/client';

let _client: Client | null = null;

function getClient(): Client {
  if (_client) return _client;

  const url = process.env.TURSO_DATABASE_URL;
  const token = process.env.TURSO_AUTH_TOKEN;

  if (!url || !token) {
    throw new Error(
      '[db] Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN environment variables.'
    );
  }

  _client = createClient({ url, authToken: token });
  return _client;
}

// Export getClient for direct use (Proxy breaks private class fields in @libsql/client)
export { getClient as getTursoClient };
export const tursoDb = { execute: (...args: any[]) => getClient().execute(...args) as any, batch: (...args: any[]) => getClient().batch(...args) as any };

// ============================================================
// Schema Initialization (per-user)
// ============================================================

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS trader_state (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    strategy_id TEXT NOT NULL DEFAULT 'momentum',
    balance REAL NOT NULL DEFAULT 100,
    borrowed_funds REAL NOT NULL DEFAULT 0,
    debt_to_repay REAL NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS trades (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    strategy_id TEXT NOT NULL DEFAULT 'momentum',
    entry_price REAL NOT NULL,
    exit_price REAL,
    amount REAL NOT NULL,
    leverage INTEGER NOT NULL,
    direction TEXT NOT NULL CHECK(direction IN ('long', 'short')),
    pnl REAL,
    status TEXT NOT NULL CHECK(status IN ('open', 'closed')) DEFAULT 'open',
    stop_loss REAL,
    take_profit REAL,
    opened_at TEXT NOT NULL DEFAULT (datetime('now')),
    closed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS indicator_weights (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL DEFAULT '__global__',
    indicator_name TEXT NOT NULL,
    weight REAL NOT NULL DEFAULT 1.0,
    calculated_winrate REAL,
    UNIQUE(user_id, indicator_name)
  );

  CREATE TABLE IF NOT EXISTS backtest_results (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL DEFAULT '__global__',
    strategy_name TEXT NOT NULL,
    symbol TEXT NOT NULL,
    total_trades INTEGER NOT NULL,
    winrate REAL NOT NULL,
    profit_factor REAL NOT NULL,
    timestamp TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    action TEXT NOT NULL,
    details TEXT,
    ip TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_trader_state_user ON trader_state(user_id);
  CREATE INDEX IF NOT EXISTS idx_trades_user ON trades(user_id);
  CREATE INDEX IF NOT EXISTS idx_activity_user ON activity_log(user_id);
`;

let schemaInitialized = false;

// Migration: add user_id to existing tables that were created without it.
// These run on EVERY initDB call (with try-catch) so they are idempotent.
const MIGRATION_SQLS = [
  "ALTER TABLE trader_state ADD COLUMN user_id TEXT DEFAULT '__migrated__'",
  "ALTER TABLE trades ADD COLUMN user_id TEXT DEFAULT '__migrated__'",
  "ALTER TABLE indicator_weights ADD COLUMN user_id TEXT DEFAULT '__global__'",
  "ALTER TABLE backtest_results ADD COLUMN user_id TEXT DEFAULT '__global__'",
  "ALTER TABLE activity_log ADD COLUMN user_id TEXT DEFAULT '__global__'",
];

export async function initDB(): Promise<void> {
  // Always run migrations first (idempotent — errors are caught)
  for (const sql of MIGRATION_SQLS) {
    try { await tursoDb.execute(sql); } catch { /* column already exists, ignore */ }
  }
  if (schemaInitialized) return;
  try {
    await tursoDb.batch(SCHEMA_SQL.split(';').filter(s => s.trim().length > 0).map(s => s.trim() + ';'));
    schemaInitialized = true;
    console.log('✅ Database schema initialized (per-user)');
  } catch (err) {
    console.error('❌ Failed to initialize DB schema:', err);
    schemaInitialized = false;
    throw err;
  }
}

// ============================================================
// User Initialization — called after registration
// ============================================================

const STRATEGY_IDS = ['momentum', 'mean-reversion', 'trend-pullback'];

export async function initUserTradingData(userId: string): Promise<void> {
  await initDB();

  for (const strategyId of STRATEGY_IDS) {
    const id = `${userId}-${strategyId}`;
    await tursoDb.execute(
      `INSERT OR IGNORE INTO trader_state (id, user_id, strategy_id, balance, borrowed_funds, debt_to_repay, is_active)
       VALUES (?, ?, ?, 100, 0, 0, 1)`,
      [id, userId, strategyId]
    );
  }

  // Initialize default indicator weights for user
  const defaultWeights = [
    ['rsi', 'RSI'], ['macd', 'MACD'], ['ema50', 'EMA_50'], ['ema200', 'EMA_200'],
    ['bollinger', 'Bollinger'], ['volume', 'Volume'], ['stochrsi', 'StochRSI'],
    ['adx', 'ADX'], ['obv', 'OBV'], ['vwap', 'VWAP'],
  ];
  for (const [id, name] of defaultWeights) {
    await tursoDb.execute(
      `INSERT OR IGNORE INTO indicator_weights (id, user_id, indicator_name, weight, calculated_winrate)
       VALUES (?, ?, ?, 1.0, NULL)`,
      [id, userId, name]
    );
  }

  // Log registration
  await tursoDb.execute(
    `INSERT INTO activity_log (user_id, action, details) VALUES (?, 'register', 'New user registered')`,
    [userId]
  );

  console.log(`✅ User ${userId} trading data initialized`);
}

// ============================================================
// Activity Logging
// ============================================================

export async function logActivity(userId: string, action: string, details?: string, ip?: string): Promise<void> {
  try {
    await tursoDb.execute(
      `INSERT INTO activity_log (user_id, action, details, ip) VALUES (?, ?, ?, ?)`,
      [userId, action, details, ip]
    );
  } catch (err) {
    console.error('Failed to log activity:', err);
  }
}

// ============================================================
// Trader State (per-user)
// ============================================================

export async function getTraderState(userId: string, strategyId: string = 'momentum') {
  const id = `${userId}-${strategyId}`;
  const result = await tursoDb.execute(
    'SELECT * FROM trader_state WHERE id = ? AND user_id = ?',
    [id, userId]
  );
  const row = result.rows[0];
  if (!row) throw new Error(`Trader state not found for user: ${userId}, strategy: ${strategyId}`);
  return {
    id: row.id as string,
    strategy_id: strategyId,
    balance: Number(row.balance),
    borrowed_funds: Number(row.borrowed_funds),
    debt_to_repay: Number(row.debt_to_repay),
    is_active: Boolean(row.is_active),
  };
}

export async function updateBalance(userId: string, newBalance: number, strategyId: string = 'momentum'): Promise<void> {
  const id = `${userId}-${strategyId}`;
  await tursoDb.execute(
    "UPDATE trader_state SET balance = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
    [newBalance, id, userId]
  );
}

export async function addCredit(userId: string, amount: number, strategyId: string = 'momentum'): Promise<void> {
  const id = `${userId}-${strategyId}`;
  await tursoDb.execute(
    "UPDATE trader_state SET borrowed_funds = borrowed_funds + ?, balance = balance + ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
    [amount, amount, id, userId]
  );
}

export async function repayDebt(userId: string, amount: number, strategyId: string = 'momentum'): Promise<void> {
  const state = await getTraderState(userId, strategyId);
  const actualRepay = Math.min(amount, state.debt_to_repay);
  const id = `${userId}-${strategyId}`;
  await tursoDb.execute(
    "UPDATE trader_state SET debt_to_repay = debt_to_repay - ?, balance = balance - ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
    [actualRepay, actualRepay, id, userId]
  );
}

export async function resetTrader(userId: string, strategyId: string = 'momentum'): Promise<void> {
  await initDB();
  const id = `${userId}-${strategyId}`;
  await tursoDb.execute(
    "UPDATE trader_state SET balance = 100, borrowed_funds = 0, debt_to_repay = 0, is_active = 1, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
    [id, userId]
  );
  // Close all open trades for this user/strategy
  await tursoDb.execute(
    "UPDATE trades SET status = 'closed', closed_at = datetime('now') WHERE user_id = ? AND strategy_id = ? AND status = 'open'",
    [userId, strategyId]
  );
  console.log(`✅ Trader reset complete for user: ${userId}, strategy: ${strategyId}`);
}

// ============================================================
// Trades (per-user)
// ============================================================

export async function openTrade(
  userId: string,
  symbol: string,
  entryPrice: number,
  amount: number,
  leverage: number,
  direction: 'long' | 'short',
  stopLoss: number,
  takeProfit: number,
  strategyId: string = 'momentum',
): Promise<void> {
  const id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await tursoDb.execute(
    `INSERT INTO trades (id, user_id, symbol, strategy_id, entry_price, amount, leverage, direction, status, stop_loss, take_profit, opened_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, datetime('now'))`,
    [id, userId, symbol, strategyId, entryPrice, amount, leverage, direction, stopLoss, takeProfit]
  );
}

export async function getOpenTrades(userId: string, strategyId?: string): Promise<Array<{
  id: string; symbol: string; strategy_id: string; entry_price: number; exit_price: number | null; amount: number;
  leverage: number; direction: string; pnl: number | null; status: string;
  opened_at: string; closed_at: string | null;
  stop_loss: number | null; take_profit: number | null;
}>> {
  const sql = strategyId
    ? 'SELECT * FROM trades WHERE status = ? AND user_id = ? AND strategy_id = ?'
    : 'SELECT * FROM trades WHERE status = ? AND user_id = ?';
  const params = strategyId ? ['open', userId, strategyId] : ['open', userId];
  const result = await tursoDb.execute(sql, params);
  return result.rows.map(row => ({
    id: row.id as string,
    symbol: row.symbol as string,
    strategy_id: (row.strategy_id as string) ?? 'momentum',
    entry_price: Number(row.entry_price),
    exit_price: null,
    amount: Number(row.amount),
    leverage: Number(row.leverage),
    direction: row.direction as string,
    pnl: null,
    status: 'open',
    opened_at: row.opened_at as string,
    closed_at: null,
    stop_loss: row.stop_loss !== null ? Number(row.stop_loss) : null,
    take_profit: row.take_profit !== null ? Number(row.take_profit) : null,
  }));
}

export async function closeTrade(
  tradeId: string,
  exitPrice: number,
  pnl: number,
): Promise<void> {
  await tursoDb.execute(
    "UPDATE trades SET exit_price = ?, pnl = ?, status = 'closed', closed_at = datetime('now') WHERE id = ?",
    [exitPrice, pnl, tradeId]
  );
}

export async function updateStopLoss(tradeId: string, newStopLoss: number): Promise<void> {
  await tursoDb.execute(
    "UPDATE trades SET stop_loss = ? WHERE id = ? AND status = 'open'",
    [newStopLoss, tradeId]
  );
}

export async function getRecentTrades(userId: string, limit: number = 20, strategyId?: string) {
  const sql = strategyId
    ? 'SELECT * FROM trades WHERE user_id = ? AND strategy_id = ? ORDER BY opened_at DESC LIMIT ?'
    : 'SELECT * FROM trades WHERE user_id = ? ORDER BY opened_at DESC LIMIT ?';
  const params = strategyId ? [userId, strategyId, limit] : [userId, limit];
  const result = await tursoDb.execute(sql, params);
  return result.rows.map(row => ({
    id: row.id as string,
    symbol: row.symbol as string,
    strategy_id: (row.strategy_id as string) ?? 'momentum',
    entry_price: Number(row.entry_price),
    exit_price: row.exit_price !== null ? Number(row.exit_price) : null,
    amount: Number(row.amount),
    leverage: Number(row.leverage),
    direction: row.direction as 'long' | 'short',
    pnl: row.pnl !== null ? Number(row.pnl) : null,
    status: row.status as 'open' | 'closed',
    stop_loss: row.stop_loss !== null ? Number(row.stop_loss) : null,
    take_profit: row.take_profit !== null ? Number(row.take_profit) : null,
    opened_at: row.opened_at as string,
    closed_at: row.closed_at as string | null,
  }));
}

// ============================================================
// Indicator Weights (per-user)
// ============================================================

export async function getIndicatorWeights(userId: string): Promise<Array<{ id: string; indicator_name: string; weight: number; calculated_winrate: number | null }>> {
  const result = await tursoDb.execute(
    'SELECT * FROM indicator_weights WHERE user_id = ?',
    [userId]
  );
  return result.rows.map(row => ({
    id: row.id as string,
    indicator_name: row.indicator_name as string,
    weight: Number(row.weight),
    calculated_winrate: row.calculated_winrate !== null ? Number(row.calculated_winrate) : null,
  }));
}

export async function updateIndicatorWeight(userId: string, indicatorId: string, newWeight: number, winrate: number | null): Promise<void> {
  await tursoDb.execute(
    'UPDATE indicator_weights SET weight = ?, calculated_winrate = ? WHERE id = ? AND user_id = ?',
    [newWeight, winrate, indicatorId, userId]
  );
}

export async function resetIndicatorWeights(userId: string): Promise<void> {
  await tursoDb.execute(
    'UPDATE indicator_weights SET weight = 1.0, calculated_winrate = NULL WHERE user_id = ?',
    [userId]
  );
}

// ============================================================
// Backtest Results (per-user)
// ============================================================

export async function saveBacktestResult(
  userId: string,
  strategyName: string,
  symbol: string,
  totalTrades: number,
  winrate: number,
  profitFactor: number,
): Promise<void> {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await tursoDb.execute(
    `INSERT INTO backtest_results (id, user_id, strategy_name, symbol, total_trades, winrate, profit_factor, timestamp)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
    [id, userId, strategyName, symbol, totalTrades, winrate, profitFactor]
  );
}

export async function getBacktestResults(userId: string): Promise<Array<{
  id: string; strategy_name: string; symbol: string; total_trades: number;
  winrate: number; profit_factor: number; timestamp: string;
}>> {
  const result = await tursoDb.execute(
    'SELECT * FROM backtest_results WHERE user_id = ? ORDER BY timestamp DESC LIMIT 20',
    [userId]
  );
  return result.rows.map(row => ({
    id: row.id as string,
    strategy_name: row.strategy_name as string,
    symbol: row.symbol as string,
    total_trades: Number(row.total_trades),
    winrate: Number(row.winrate),
    profit_factor: Number(row.profit_factor),
    timestamp: row.timestamp as string,
  }));
}

// ============================================================
// Admin: List all users (for monitoring)
// ============================================================

export async function getAllUserIds(): Promise<string[]> {
  const result = await tursoDb.execute('SELECT DISTINCT user_id FROM trader_state');
  return result.rows.map(r => r.user_id as string);
}