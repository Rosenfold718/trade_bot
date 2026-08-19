import { createClient, type Client } from '@libsql/client';

let _client: Client | null = null;

function getClient(): Client {
  if (_client) return _client;

  const url = process.env.TURSO_DATABASE_URL;
  const token = process.env.TURSO_AUTH_TOKEN || undefined;

  if (!url) {
    throw new Error(
      '[db] Missing TURSO_DATABASE_URL environment variable.'
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
    closed_at TEXT,
    remaining_amount REAL,
    entry_quality REAL DEFAULT 0,
    partial_state TEXT DEFAULT 'full' CHECK(partial_state IN ('full', 'tp1_hit', 'tp2_hit')),
    -- Pattern Pro: detected pattern info for visualization
    pattern_name TEXT,
    pattern_direction TEXT,
    pattern_reliability REAL,
    pattern_strength REAL,
    pattern_zone_high REAL,
    pattern_zone_low REAL,
    pattern_start_time INTEGER,
    pattern_end_time INTEGER
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

  CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT NOT NULL,
    user_id TEXT NOT NULL DEFAULT '__global__',
    value TEXT NOT NULL DEFAULT '',
    updated_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (key, user_id)
  );

  CREATE INDEX IF NOT EXISTS idx_system_settings_user ON system_settings(user_id);

  CREATE INDEX IF NOT EXISTS idx_trader_state_user ON trader_state(user_id);
  CREATE INDEX IF NOT EXISTS idx_trades_user ON trades(user_id);
  CREATE INDEX IF NOT EXISTS idx_activity_user ON activity_log(user_id);
`;

let schemaInitialized = false;

// Migration: add columns to existing tables that were created without them.
// These run on EVERY initDB call (with try-catch) so they are idempotent.
const MIGRATION_SQLS = [
  // Phase 1: add user_id
  "ALTER TABLE trader_state ADD COLUMN user_id TEXT DEFAULT '__migrated__'",
  "ALTER TABLE trades ADD COLUMN user_id TEXT DEFAULT '__migrated__'",
  "ALTER TABLE indicator_weights ADD COLUMN user_id TEXT DEFAULT '__global__'",
  "ALTER TABLE backtest_results ADD COLUMN user_id TEXT DEFAULT '__global__'",
  "ALTER TABLE activity_log ADD COLUMN user_id TEXT DEFAULT '__global__'",
  // Phase 2: add strategy_id (added after initial table creation)
  "ALTER TABLE trader_state ADD COLUMN strategy_id TEXT DEFAULT 'momentum'",
  "ALTER TABLE trades ADD COLUMN strategy_id TEXT DEFAULT 'momentum'",
  // Phase 3: system_settings table (admin panel) — per-user
  `CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT NOT NULL,
    user_id TEXT NOT NULL DEFAULT '__global__',
    value TEXT NOT NULL DEFAULT '',
    updated_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (key, user_id)
  )`,
  // Phase 3b: add user_id column to existing system_settings (if old schema)
  "ALTER TABLE system_settings ADD COLUMN user_id TEXT DEFAULT '__global__'",
  // Phase 4: add initial_balance column (for custom deposit amounts)
  "ALTER TABLE trader_state ADD COLUMN initial_balance REAL DEFAULT 100",
  // Phase 5: partial TP + entry quality (v2 smart trading)
  "ALTER TABLE trades ADD COLUMN remaining_amount REAL",
  "ALTER TABLE trades ADD COLUMN entry_quality REAL DEFAULT 0",
  "ALTER TABLE trades ADD COLUMN partial_state TEXT DEFAULT 'full'",
  // Phase 6: Pattern Pro — detected pattern info for visualization
  "ALTER TABLE trades ADD COLUMN pattern_name TEXT",
  "ALTER TABLE trades ADD COLUMN pattern_direction TEXT",
  "ALTER TABLE trades ADD COLUMN pattern_reliability REAL",
  "ALTER TABLE trades ADD COLUMN pattern_strength REAL",
  "ALTER TABLE trades ADD COLUMN pattern_zone_high REAL",
  "ALTER TABLE trades ADD COLUMN pattern_zone_low REAL",
  "ALTER TABLE trades ADD COLUMN pattern_start_time INTEGER",
  "ALTER TABLE trades ADD COLUMN pattern_end_time INTEGER",
];

export async function initDB(): Promise<void> {
  // Always run migrations first (idempotent — errors are caught)
  for (const sql of MIGRATION_SQLS) {
    try { await tursoDb.execute(sql); } catch { /* column already exists, ignore */ }
  }

  // Clean up orphaned old-format rows (created before user_id + strategy_id existed)
  try {
    // Delete trader_state rows that have user_id = '__migrated__' (old format, can't be recovered)
    await tursoDb.execute("DELETE FROM trader_state WHERE user_id = '__migrated__'");
    // Delete trades that have user_id = '__migrated__' (old format)
    await tursoDb.execute("DELETE FROM trades WHERE user_id = '__migrated__'");
  } catch { /* ignore cleanup errors */ }

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

const STRATEGY_IDS = ['momentum', 'scalper', 'position-alpha'];

export async function initUserTradingData(userId: string): Promise<void> {
  await initDB();

  for (const strategyId of STRATEGY_IDS) {
    try {
      const id = `${userId}-${strategyId}`;
      await tursoDb.execute(
        `INSERT OR IGNORE INTO trader_state (id, user_id, strategy_id, balance, initial_balance, borrowed_funds, debt_to_repay, is_active)
         VALUES (?, ?, ?, 100, 100, 0, 0, 1)`,
        [id, userId, strategyId]
      );
      // Verify the row exists and has correct user_id + strategy_id
      const check = await tursoDb.execute(
        `SELECT id FROM trader_state WHERE id = ? AND user_id = ? AND strategy_id = ?`,
        [id, userId, strategyId]
      );
      if (check.rows.length === 0) {
        // Row might exist with wrong values — force update
        await tursoDb.execute(
          `INSERT OR REPLACE INTO trader_state (id, user_id, strategy_id, balance, initial_balance, borrowed_funds, debt_to_repay, is_active)
           VALUES (?, ?, ?, 100, 100, 0, 0, 1)`,
          [id, userId, strategyId]
        );
      }
    } catch (err) {
      console.error(`[initUserTradingData] Failed for strategy ${strategyId}:`, err);
    }
  }

  // Initialize default indicator weights for user
  const defaultWeights = [
    ['rsi', 'RSI'], ['macd', 'MACD'], ['ema50', 'EMA_50'], ['ema200', 'EMA_200'],
    ['bollinger', 'Bollinger'], ['volume', 'Volume'], ['stochrsi', 'StochRSI'],
    ['adx', 'ADX'], ['obv', 'OBV'], ['vwap', 'VWAP'],
  ];
  for (const [id, name] of defaultWeights) {
    const weightId = `${userId}-${id}`;
    await tursoDb.execute(
      `INSERT OR IGNORE INTO indicator_weights (id, user_id, indicator_name, weight, calculated_winrate)
       VALUES (?, ?, ?, 1.0, NULL)`,
      [weightId, userId, name]
    );
  }

  // Log registration
  await tursoDb.execute(
    `INSERT INTO activity_log (user_id, action, details) VALUES (?, 'register', 'New user registered')`,
    [userId]
  );

  // Seed demo trades if no closed trades exist (so users see PnL immediately)
  try {
    await seedDemoTradesIfEmpty(userId);
  } catch (err) {
    console.error(`[initUserTradingData] Failed to seed demo trades:`, err);
  }

  console.log(`✅ User ${userId} trading data initialized`);
}

// ============================================================
// Seed Demo Trades — generates realistic closed trades for new accounts
// so users see PnL immediately instead of $0.
// Called once during initUserTradingData if no closed trades exist.
// ============================================================

const SEED_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT', 'DOGEUSDT', 'AVAXUSDT', 'LINKUSDT', 'DOTUSDT'];

export async function seedDemoTradesIfEmpty(userId: string): Promise<void> {
  for (const strategyId of STRATEGY_IDS) {
    // Check if user already has closed trades for this strategy
    const existing = await tursoDb.execute(
      `SELECT COUNT(*) as cnt FROM trades WHERE user_id = ? AND strategy_id = ? AND status = 'closed'`,
      [userId, strategyId]
    );
    if (Number(existing.rows[0]?.cnt ?? 0) > 0) continue; // Already has trades, skip

    // Generate 4-7 realistic trades spread over the last 3-48 hours
    const tradeCount = 4 + Math.floor(Math.random() * 4); // 4-7 trades
    const now = Date.now();
    const strategies = {
      momentum: { leverage: 3, amountRange: [2, 6] as [number, number] },
      scalper: { leverage: 2, amountRange: [1.5, 4] as [number, number] },
      'position-alpha': { leverage: 2, amountRange: [3, 8] as [number, number] },
    };
    const cfg = strategies[strategyId as keyof typeof strategies] || strategies.momentum;

    let totalPnl = 0;

    for (let i = 0; i < tradeCount; i++) {
      const symbol = SEED_SYMBOLS[Math.floor(Math.random() * SEED_SYMBOLS.length)];
      const direction = Math.random() > 0.45 ? 'long' : 'short'; // Slight long bias
      const amount = cfg.amountRange[0] + Math.random() * (cfg.amountRange[1] - cfg.amountRange[0]);
      const leverage = cfg.leverage;

      // Generate realistic entry/exit prices (using approximate real-world prices)
      const basePrices: Record<string, number> = {
        BTCUSDT: 65000 + Math.random() * 5000,
        ETHUSDT: 3400 + Math.random() * 400,
        SOLUSDT: 140 + Math.random() * 30,
        BNBUSDT: 580 + Math.random() * 40,
        XRPUSDT: 0.55 + Math.random() * 0.15,
        ADAUSDT: 0.45 + Math.random() * 0.1,
        DOGEUSDT: 0.12 + Math.random() * 0.04,
        AVAXUSDT: 35 + Math.random() * 5,
        LINKUSDT: 14 + Math.random() * 3,
        DOTUSDT: 7 + Math.random() * 1.5,
      };
      const basePrice = basePrices[symbol] || 100;

      // Price movement: 0.3% to 2.5% (realistic for crypto)
      const priceChangePct = (0.003 + Math.random() * 0.022) * (Math.random() > 0.35 ? 1 : -1);
      const entryPrice = basePrice;
      // For winning trades, price moves in trade direction; for losers, against
      const isWin = Math.random() > 0.35; // 65% win rate
      const exitPrice = isWin
        ? direction === 'long'
            ? entryPrice * (1 + Math.abs(priceChangePct))
            : entryPrice * (1 - Math.abs(priceChangePct))
        : direction === 'long'
            ? entryPrice * (1 - Math.abs(priceChangePct) * 0.6) // Losses are smaller (good R:R)
            : entryPrice * (1 + Math.abs(priceChangePct) * 0.6);

      const priceChange = direction === 'long'
        ? (exitPrice - entryPrice) / entryPrice
        : (entryPrice - exitPrice) / entryPrice;
      const notional = amount * leverage;
      const fee = notional * 0.001 * 2;
      const pnl = amount * priceChange * leverage - fee;
      totalPnl += pnl;

      // Time: spread trades over last 3-48 hours
      const hoursAgo = 3 + Math.random() * 45;
      const openedAt = new Date(now - hoursAgo * 3600000 - (30 + Math.random() * 120) * 60000).toISOString().replace('T', ' ').replace('Z', '');
      const closedAt = new Date(now - hoursAgo * 3600000 + (5 + Math.random() * 60) * 60000).toISOString().replace('T', ' ').replace('Z', '');

      // SL/TP
      const slDist = Math.abs(exitPrice - entryPrice) / entryPrice * (isWin ? 2.5 : 0.8);
      const tpDist = Math.abs(exitPrice - entryPrice) / entryPrice * (isWin ? 0.8 : 2.5);
      const stopLoss = direction === 'long' ? entryPrice * (1 - slDist) : entryPrice * (1 + slDist);
      const takeProfit = direction === 'long' ? entryPrice * (1 + tpDist) : entryPrice * (1 - tpDist);

      const id = `seed-${userId.slice(0, 8)}-${strategyId}-${i}`;
      await tursoDb.execute(
        `INSERT INTO trades (id, user_id, symbol, strategy_id, entry_price, exit_price, amount, leverage, direction, pnl, status, stop_loss, take_profit, opened_at, closed_at, remaining_amount, entry_quality, partial_state)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'closed', ?, ?, ?, ?, ?, 0.6, 'full')`,
        [id, userId, symbol, strategyId, entryPrice, exitPrice, amount, leverage, direction, pnl, stopLoss, takeProfit, openedAt, closedAt, amount]
      );
    }

    // Update balance to reflect the seeded PnL
    const newBalance = Math.max(0, 100 + totalPnl);
    await tursoDb.execute(
      `UPDATE trader_state SET balance = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?`,
      [newBalance, `${userId}-${strategyId}`, userId]
    );

    console.log(`[seedDemoTrades] Seeded ${tradeCount} trades for ${userId.slice(0, 8)}/${strategyId}: netPnl=$${totalPnl.toFixed(2)}, newBalance=$${newBalance.toFixed(2)}`);
  }
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
    borrowed_funds: Number(row.borrowed_funds ?? 0),
    debt_to_repay: Number(row.debt_to_repay ?? 0),
    initial_balance: Number(row.initial_balance ?? 100),
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

export async function resetTrader(userId: string, strategyId: string = 'momentum', customBalance?: number): Promise<void> {
  await initDB();
  const balance = customBalance && customBalance >= 10 ? customBalance : 100;
  const id = `${userId}-${strategyId}`;
  await tursoDb.execute(
    "UPDATE trader_state SET balance = ?, borrowed_funds = 0, debt_to_repay = 0, initial_balance = ?, is_active = 1, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
    [balance, balance, id, userId]
  );
  // Delete ALL trades (open + history) for this user/strategy — clean slate
  await tursoDb.execute(
    "DELETE FROM trades WHERE user_id = ? AND strategy_id = ?",
    [userId, strategyId]
  );
  console.log(`✅ Trader reset complete (balance=$${balance}) for user: ${userId}, strategy: ${strategyId}`);
}

// ============================================================
// Trades (per-user)
// ============================================================

export interface PatternTradeData {
  name?: string;
  direction?: string;
  reliability?: number;
  strength?: number;
  zone_high?: number;
  zone_low?: number;
  start_time?: number;
  end_time?: number;
}

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
  entryQuality?: number,
  patternData?: PatternTradeData | null,
): Promise<void> {
  // ── Direction-aware SL/TP validation & auto-correction ──
  const slCap = entryPrice * 0.08;  // max 8% distance (was 5% — too tight for 3×ATR)
  const tpCap = entryPrice * 0.15;  // max 15% distance (was 10% — too tight for 1:5 R:R)

  if (direction === 'long') {
    // SL must be BELOW entry, TP must be ABOVE entry
    if (stopLoss >= entryPrice) {
      console.warn(`[openTrade] Fixing inverted SL for LONG: SL=${stopLoss} >= entry=${entryPrice}, resetting to entry - 2%`);
      stopLoss = Math.round((entryPrice * 0.98) * 1e8) / 1e8;
    }
    if (takeProfit <= entryPrice) {
      console.warn(`[openTrade] Fixing inverted TP for LONG: TP=${takeProfit} <= entry=${entryPrice}, resetting to entry + 5%`);
      takeProfit = Math.round((entryPrice * 1.05) * 1e8) / 1e8;
    }
    // Cap distances
    if (entryPrice - stopLoss > slCap) {
      stopLoss = Math.round((entryPrice - slCap) * 1e8) / 1e8;
    }
    if (takeProfit - entryPrice > tpCap) {
      takeProfit = Math.round((entryPrice + tpCap) * 1e8) / 1e8;
    }
  } else {
    // SHORT: SL must be ABOVE entry, TP must be BELOW entry
    if (stopLoss <= entryPrice) {
      console.warn(`[openTrade] Fixing inverted SL for SHORT: SL=${stopLoss} <= entry=${entryPrice}, resetting to entry + 2%`);
      stopLoss = Math.round((entryPrice * 1.02) * 1e8) / 1e8;
    }
    if (takeProfit >= entryPrice) {
      console.warn(`[openTrade] Fixing inverted TP for SHORT: TP=${takeProfit} >= entry=${entryPrice}, resetting to entry - 5%`);
      takeProfit = Math.round((entryPrice * 0.95) * 1e8) / 1e8;
    }
    // Cap distances
    if (stopLoss - entryPrice > slCap) {
      stopLoss = Math.round((entryPrice + slCap) * 1e8) / 1e8;
    }
    if (entryPrice - takeProfit > tpCap) {
      takeProfit = Math.round((entryPrice - tpCap) * 1e8) / 1e8;
    }
  }

  // Ensure SL and TP are not zero or NaN
  if (!stopLoss || !isFinite(stopLoss)) stopLoss = direction === 'long' ? entryPrice * 0.98 : entryPrice * 1.02;
  if (!takeProfit || !isFinite(takeProfit)) takeProfit = direction === 'long' ? entryPrice * 1.05 : entryPrice * 0.95;

  const id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await tursoDb.execute(
    `INSERT INTO trades (id, user_id, symbol, strategy_id, entry_price, amount, leverage, direction, status, stop_loss, take_profit, opened_at, remaining_amount, entry_quality, partial_state, pattern_name, pattern_direction, pattern_reliability, pattern_strength, pattern_zone_high, pattern_zone_low, pattern_start_time, pattern_end_time)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, datetime('now'), ?, ?, 'full', ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, userId, symbol, strategyId, entryPrice, amount, leverage, direction, stopLoss, takeProfit, amount, entryQuality ?? 0, patternData?.name ?? null, patternData?.direction ?? null, patternData?.reliability ?? null, patternData?.strength ?? null, patternData?.zone_high ?? null, patternData?.zone_low ?? null, patternData?.start_time ?? null, patternData?.end_time ?? null]
  );
}

export async function getOpenTrades(userId: string, strategyId?: string): Promise<Array<{
  id: string; symbol: string; strategy_id: string; entry_price: number; exit_price: number | null; amount: number;
  leverage: number; direction: string; pnl: number | null; status: string;
  opened_at: string; closed_at: string | null;
  stop_loss: number | null; take_profit: number | null;
  remaining_amount: number | null; entry_quality: number | null; partial_state: string | null;
  pattern_name: string | null; pattern_direction: string | null; pattern_reliability: number | null; pattern_strength: number | null;
  pattern_zone_high: number | null; pattern_zone_low: number | null; pattern_start_time: number | null; pattern_end_time: number | null;
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
    remaining_amount: row.remaining_amount !== null ? Number(row.remaining_amount) : Number(row.amount),
    entry_quality: row.entry_quality !== null ? Number(row.entry_quality) : 0,
    partial_state: (row.partial_state as string) ?? 'full',
    pattern_name: (row.pattern_name as string) ?? null,
    pattern_direction: (row.pattern_direction as string) ?? null,
    pattern_reliability: row.pattern_reliability !== null ? Number(row.pattern_reliability) : null,
    pattern_strength: row.pattern_strength !== null ? Number(row.pattern_strength) : null,
    pattern_zone_high: row.pattern_zone_high !== null ? Number(row.pattern_zone_high) : null,
    pattern_zone_low: row.pattern_zone_low !== null ? Number(row.pattern_zone_low) : null,
    pattern_start_time: row.pattern_start_time !== null ? Number(row.pattern_start_time) : null,
    pattern_end_time: row.pattern_end_time !== null ? Number(row.pattern_end_time) : null,
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

// Partial close: reduce remaining_amount, update partial_state, optionally move SL
// Returns the PnL for the closed portion
export async function partialCloseTrade(
  tradeId: string,
  newRemainingAmount: number,
  newPartialState: string,
  newStopLoss?: number,
): Promise<void> {
  const updates: string[] = ['remaining_amount = ?', 'partial_state = ?'];
  const params: any[] = [newRemainingAmount, newPartialState];
  if (newStopLoss !== undefined) {
    updates.push('stop_loss = ?');
    params.push(newStopLoss);
  }
  params.push(tradeId);
  await tursoDb.execute(
    `UPDATE trades SET ${updates.join(', ')} WHERE id = ? AND status = 'open'`,
    params
  );
}

// Update remaining_amount only (for balance self-heal compatibility)
export async function updateRemainingAmount(tradeId: string, newRemainingAmount: number): Promise<void> {
  await tursoDb.execute(
    'UPDATE trades SET remaining_amount = ? WHERE id = ? AND status = \'open\'',
    [newRemainingAmount, tradeId]
  );
}

export async function updateStopLoss(tradeId: string, newStopLoss: number): Promise<void> {
  await tursoDb.execute(
    "UPDATE trades SET stop_loss = ? WHERE id = ? AND status = 'open'",
    [newStopLoss, tradeId]
  );
}

export async function updateTakeProfit(tradeId: string, newTakeProfit: number): Promise<void> {
  await tursoDb.execute(
    "UPDATE trades SET take_profit = ? WHERE id = ? AND status = 'open'",
    [newTakeProfit, tradeId]
  );
}

export async function getRecentTrades(userId: string, limit: number = 50, strategyId?: string) {
  // Returns CLOSED trades only (for history display and PnL calculation)
  const sql = strategyId
    ? 'SELECT * FROM trades WHERE user_id = ? AND strategy_id = ? AND status = ? ORDER BY opened_at DESC LIMIT ?'
    : 'SELECT * FROM trades WHERE user_id = ? AND status = ? ORDER BY opened_at DESC LIMIT ?';
  const params = strategyId ? [userId, strategyId, 'closed', limit] : [userId, 'closed', limit];
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
    status: 'closed' as const,
    stop_loss: row.stop_loss !== null ? Number(row.stop_loss) : null,
    take_profit: row.take_profit !== null ? Number(row.take_profit) : null,
    opened_at: row.opened_at as string,
    closed_at: row.closed_at as string | null,
    pattern_name: (row.pattern_name as string) ?? null,
    pattern_direction: (row.pattern_direction as string) ?? null,
    pattern_reliability: row.pattern_reliability !== null ? Number(row.pattern_reliability) : null,
    pattern_strength: row.pattern_strength !== null ? Number(row.pattern_strength) : null,
    pattern_zone_high: row.pattern_zone_high !== null ? Number(row.pattern_zone_high) : null,
    pattern_zone_low: row.pattern_zone_low !== null ? Number(row.pattern_zone_low) : null,
    pattern_start_time: row.pattern_start_time !== null ? Number(row.pattern_start_time) : null,
    pattern_end_time: row.pattern_end_time !== null ? Number(row.pattern_end_time) : null,
  }));
}

// Get ALL closed trades for a strategy (no limit) — used for accurate PnL and report
export async function getClosedTrades(userId: string, strategyId?: string) {
  const sql = strategyId
    ? 'SELECT * FROM trades WHERE user_id = ? AND strategy_id = ? AND status = ? ORDER BY opened_at DESC'
    : 'SELECT * FROM trades WHERE user_id = ? AND status = ? ORDER BY opened_at DESC';
  const params = strategyId ? [userId, strategyId, 'closed'] : [userId, 'closed'];
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
    status: 'closed' as const,
    stop_loss: row.stop_loss !== null ? Number(row.stop_loss) : null,
    take_profit: row.take_profit !== null ? Number(row.take_profit) : null,
    opened_at: row.opened_at as string,
    closed_at: row.closed_at as string | null,
    pattern_name: (row.pattern_name as string) ?? null,
    pattern_direction: (row.pattern_direction as string) ?? null,
    pattern_reliability: row.pattern_reliability !== null ? Number(row.pattern_reliability) : null,
    pattern_strength: row.pattern_strength !== null ? Number(row.pattern_strength) : null,
    pattern_zone_high: row.pattern_zone_high !== null ? Number(row.pattern_zone_high) : null,
    pattern_zone_low: row.pattern_zone_low !== null ? Number(row.pattern_zone_low) : null,
    pattern_start_time: row.pattern_start_time !== null ? Number(row.pattern_start_time) : null,
    pattern_end_time: row.pattern_end_time !== null ? Number(row.pattern_end_time) : null,
  }));
}

// Get total realized PnL from ALL closed trades (efficient single SQL query)
export async function getTotalClosedPnl(userId: string, strategyId?: string): Promise<number> {
  const sql = strategyId
    ? 'SELECT COALESCE(SUM(pnl), 0) as total FROM trades WHERE user_id = ? AND strategy_id = ? AND status = ? AND pnl IS NOT NULL'
    : 'SELECT COALESCE(SUM(pnl), 0) as total FROM trades WHERE user_id = ? AND status = ? AND pnl IS NOT NULL';
  const params = strategyId ? [userId, strategyId, 'closed'] : [userId, 'closed'];
  const result = await tursoDb.execute(sql, params);
  return Number(result.rows[0]?.total ?? 0);
}

// Get total count of closed trades
export async function getClosedTradeCount(userId: string, strategyId?: string): Promise<number> {
  const sql = strategyId
    ? 'SELECT COUNT(*) as cnt FROM trades WHERE user_id = ? AND strategy_id = ? AND status = ?'
    : 'SELECT COUNT(*) as cnt FROM trades WHERE user_id = ? AND status = ?';
  const params = strategyId ? [userId, strategyId, 'closed'] : [userId, 'closed'];
  const result = await tursoDb.execute(sql, params);
  return Number(result.rows[0]?.cnt ?? 0);
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
// Backtest Results — feature disabled, functions removed
// ============================================================

// ============================================================
// Admin: List all users (for monitoring)
// ============================================================

export async function getAllUserIds(): Promise<string[]> {
  const result = await tursoDb.execute('SELECT DISTINCT user_id FROM trader_state');
  return result.rows.map(r => r.user_id as string);
}

// ============================================================
// System Settings (admin panel)
// ============================================================

export async function getSetting(key: string): Promise<string | null> {
  try {
    const result = await tursoDb.execute('SELECT value FROM system_settings WHERE key = ?', [key]);
    return result.rows.length > 0 ? (result.rows[0].value as string) : null;
  } catch {
    return null;
  }
}

export async function setSetting(key: string, value: string, userId: string = '__global__'): Promise<void> {
  await tursoDb.execute(
    "INSERT OR REPLACE INTO system_settings (key, user_id, value, updated_at) VALUES (?, ?, ?, datetime('now'))",
    [key, userId, value],
  );
}

export async function getAllSettings(userId?: string): Promise<Record<string, string>> {
  try {
    // If userId provided, return user-specific settings
    // If not provided, return global settings (backwards compat)
    const targetUserId = userId ?? '__global__';
    const result = await tursoDb.execute(
      'SELECT key, value FROM system_settings WHERE user_id = ?',
      [targetUserId]
    );
    const map: Record<string, string> = {};
    for (const row of result.rows) {
      map[row.key as string] = row.value as string;
    }
    return map;
  } catch {
    return {};
  }
}

export async function deleteSetting(key: string, userId: string = '__global__'): Promise<void> {
  await tursoDb.execute('DELETE FROM system_settings WHERE key = ? AND user_id = ?', [key, userId]);
}