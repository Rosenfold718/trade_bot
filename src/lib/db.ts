import { createClient, type Client } from '@libsql/client';

const TURSO_URL = process.env.TURSO_DATABASE_URL || 'libsql://trade-rosenfold718.aws-ap-northeast-1.turso.io';
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN || 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJleHAiOjE4MTU5ODM4MTQsImlhdCI6MTc4NDQ0NzgxNCwiaWQiOiIwMTlmNzk2MC02ZjAxLTdjMGItYjMwOS1kZTAxYzA3MDYzYTAiLCJraWQiOiJxYXJ0VlRNdGJpazJHbTUxUkZkWURUVkg5TXMwQnZObkx3THBiRkFuRFZBIiwicmlkIjoiNzE5MzdkMjUtNmYyYi00MzZmLTgyMDctOGRhZjQ3YzhmNDE5In0.fhSQ5C5OpQmXizpNPZc9DFRNICHBNNmmT5DySujkpXW1xsupvhpsy-yTU84dmNz62Rd1Ur4gsL_itAVebTArDA';

export const db: Client = createClient({
  url: TURSO_URL,
  authToken: TURSO_AUTH_TOKEN,
});

// ============================================================
// Schema Initialization
// ============================================================

const SCHEMA_SQL = `
  DROP TABLE IF EXISTS backtest_results;
  DROP TABLE IF EXISTS indicator_weights;
  DROP TABLE IF EXISTS trades;
  DROP TABLE IF EXISTS trader_state;

  CREATE TABLE trader_state (
    id TEXT PRIMARY KEY,
    balance REAL NOT NULL DEFAULT 100,
    borrowed_funds REAL NOT NULL DEFAULT 0,
    debt_to_repay REAL NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE trades (
    id TEXT PRIMARY KEY,
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

  CREATE TABLE indicator_weights (
    id TEXT PRIMARY KEY,
    indicator_name TEXT NOT NULL UNIQUE,
    weight REAL NOT NULL DEFAULT 1.0,
    calculated_winrate REAL
  );

  CREATE TABLE backtest_results (
    id TEXT PRIMARY KEY,
    strategy_name TEXT NOT NULL,
    symbol TEXT NOT NULL,
    total_trades INTEGER NOT NULL,
    winrate REAL NOT NULL,
    profit_factor REAL NOT NULL,
    timestamp TEXT NOT NULL DEFAULT (datetime('now'))
  );

  INSERT OR IGNORE INTO trader_state (id, balance, borrowed_funds, debt_to_repay, is_active)
  VALUES ('momentum', 100, 0, 0, 1);
  INSERT OR IGNORE INTO trader_state (id, balance, borrowed_funds, debt_to_repay, is_active)
  VALUES ('mean-reversion', 100, 0, 0, 1);
  INSERT OR IGNORE INTO trader_state (id, balance, borrowed_funds, debt_to_repay, is_active)
  VALUES ('trend-pullback', 100, 0, 0, 1);

  INSERT OR IGNORE INTO indicator_weights (id, indicator_name, weight, calculated_winrate) VALUES
    ('rsi', 'RSI', 1.0, NULL),
    ('macd', 'MACD', 1.0, NULL),
    ('ema50', 'EMA_50', 1.0, NULL),
    ('ema200', 'EMA_200', 1.0, NULL),
    ('bollinger', 'Bollinger', 1.0, NULL),
    ('volume', 'Volume', 1.0, NULL),
    ('stochrsi', 'StochRSI', 1.0, NULL),
    ('adx', 'ADX', 1.0, NULL),
    ('obv', 'OBV', 1.0, NULL),
    ('vwap', 'VWAP', 1.0, NULL);
`;

let schemaInitialized = false;

export async function initDB(): Promise<void> {
  if (schemaInitialized) return;
  try {
    await db.batch(SCHEMA_SQL.split(';').filter(s => s.trim().length > 0).map(s => s.trim() + ';'));
    schemaInitialized = true;
    console.log('✅ Database schema initialized');
  } catch (err) {
    console.error('❌ Failed to initialize DB schema:', err);
    schemaInitialized = false;
    throw err;
  }
}

// ============================================================
// Trader State
// ============================================================

export async function getTraderState(strategyId: string = 'momentum') {
  const result = await db.execute('SELECT * FROM trader_state WHERE id = ?', [strategyId]);
  const row = result.rows[0];
  if (!row) throw new Error(`Trader state not found for strategy: ${strategyId}`);
  return {
    id: row.id as string,
    strategy_id: strategyId,
    balance: Number(row.balance),
    borrowed_funds: Number(row.borrowed_funds),
    debt_to_repay: Number(row.debt_to_repay),
    is_active: Boolean(row.is_active),
  };
}

export async function updateBalance(newBalance: number, strategyId: string = 'momentum'): Promise<void> {
  await db.execute('UPDATE trader_state SET balance = ?, updated_at = datetime(\'now\') WHERE id = ?', [newBalance, strategyId]);
}

export async function addCredit(amount: number, strategyId: string = 'momentum'): Promise<void> {
  await db.execute(
    'UPDATE trader_state SET borrowed_funds = borrowed_funds + ?, balance = balance + ?, updated_at = datetime(\'now\') WHERE id = ?',
    [amount, amount, strategyId]
  );
}

export async function repayDebt(amount: number, strategyId: string = 'momentum'): Promise<void> {
  const state = await getTraderState(strategyId);
  const actualRepay = Math.min(amount, state.debt_to_repay);
  await db.execute(
    'UPDATE trader_state SET debt_to_repay = debt_to_repay - ?, balance = balance - ?, updated_at = datetime(\'now\') WHERE id = ?',
    [actualRepay, actualRepay, strategyId]
  );
}

export async function resetTrader(strategyId: string = 'momentum'): Promise<void> {
  await initDB();
  console.log(`✅ Trader reset complete for strategy: ${strategyId}`);
}

// ============================================================
// Trades
// ============================================================

export async function openTrade(
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
  await db.execute(
    `INSERT INTO trades (id, symbol, strategy_id, entry_price, amount, leverage, direction, status, stop_loss, take_profit, opened_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, datetime('now'))`,
    [id, symbol, strategyId, entryPrice, amount, leverage, direction, stopLoss, takeProfit]
  );
}

export async function getOpenTrades(strategyId?: string): Promise<Array<{
  id: string; symbol: string; strategy_id: string; entry_price: number; exit_price: number | null; amount: number;
  leverage: number; direction: string; pnl: number | null; status: string;
  opened_at: string; closed_at: string | null;
  stop_loss: number | null; take_profit: number | null;
}>> {
  const sql = strategyId
    ? 'SELECT * FROM trades WHERE status = ? AND strategy_id = ?'
    : 'SELECT * FROM trades WHERE status = ?';
  const params = strategyId ? ['open', strategyId] : ['open'];
  const result = await db.execute(sql, params);
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
  await db.execute(
    `UPDATE trades SET exit_price = ?, pnl = ?, status = 'closed', closed_at = datetime('now') WHERE id = ?`,
    [exitPrice, pnl, tradeId]
  );
}

export async function updateStopLoss(tradeId: string, newStopLoss: number): Promise<void> {
  await db.execute(
    `UPDATE trades SET stop_loss = ? WHERE id = ? AND status = 'open'`,
    [newStopLoss, tradeId]
  );
}

export async function getRecentTrades(limit: number = 20, strategyId?: string) {
  const sql = strategyId
    ? 'SELECT * FROM trades WHERE strategy_id = ? ORDER BY opened_at DESC LIMIT ?'
    : 'SELECT * FROM trades ORDER BY opened_at DESC LIMIT ?';
  const params = strategyId ? [strategyId, limit] : [limit];
  const result = await db.execute(sql, params);
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
// Indicator Weights
// ============================================================

export async function getIndicatorWeights(): Promise<Array<{ id: string; indicator_name: string; weight: number; calculated_winrate: number | null }>> {
  const result = await db.execute('SELECT * FROM indicator_weights');
  return result.rows.map(row => ({
    id: row.id as string,
    indicator_name: row.indicator_name as string,
    weight: Number(row.weight),
    calculated_winrate: row.calculated_winrate !== null ? Number(row.calculated_winrate) : null,
  }));
}

export async function updateIndicatorWeight(indicatorId: string, newWeight: number, winrate: number | null): Promise<void> {
  await db.execute(
    'UPDATE indicator_weights SET weight = ?, calculated_winrate = ? WHERE id = ?',
    [newWeight, winrate, indicatorId]
  );
}

export async function resetIndicatorWeights(): Promise<void> {
  await db.execute('UPDATE indicator_weights SET weight = 1.0, calculated_winrate = NULL');
}

// ============================================================
// Backtest Results
// ============================================================

export async function saveBacktestResult(
  strategyName: string,
  symbol: string,
  totalTrades: number,
  winrate: number,
  profitFactor: number,
): Promise<void> {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await db.execute(
    `INSERT INTO backtest_results (id, strategy_name, symbol, total_trades, winrate, profit_factor, timestamp)
     VALUES (?, ?, ?, ?, ?, datetime('now'))`,
    [id, strategyName, symbol, totalTrades, winrate, profitFactor]
  );
}

export async function getBacktestResults(): Promise<Array<{
  id: string; strategy_name: string; symbol: string; total_trades: number;
  winrate: number; profit_factor: number; timestamp: string;
}>> {
  const result = await db.execute('SELECT * FROM backtest_results ORDER BY timestamp DESC LIMIT 20');
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