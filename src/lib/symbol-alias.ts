/**
 * Symbol alias system for renamed/delisted Binance trading pairs.
 * 
 * Binance occasionally renames tokens (e.g., MATIC → POL).
 * Old symbols may still return a price but have empty orderbooks and no WS depth streams.
 * 
 * Usage:
 *   resolveSymbol('MATICUSDT')  → 'POLUSDT'     (for Binance API/WS calls)
 *   resolveSymbol('BTCUSDT')    → 'BTCUSDT'      (unchanged)
 */

// Map of OLD symbol → CURRENT valid Binance symbol
const SYMBOL_ALIASES: Record<string, string> = {
  'MATICUSDT': 'POLUSDT',
};

// Reverse map: CURRENT → OLD (for display, price matching to old trades)
const REVERSE_ALIASES: Record<string, string> = {};
for (const [old, cur] of Object.entries(SYMBOL_ALIASES)) {
  REVERSE_ALIASES[cur] = old;
}

/**
 * Resolve a symbol to its current valid Binance equivalent.
 * Use before any Binance API call, WS stream, or orderbook query.
 */
export function resolveSymbol(symbol: string): string {
  const upper = symbol.toUpperCase();
  return SYMBOL_ALIASES[upper] ?? upper;
}

/**
 * Get the display name for a symbol (prefers the original/old name).
 * E.g., displaySymbol('POLUSDT') → 'MATICUSDT' (if trades use MATIC)
 */
export function displaySymbol(symbol: string): string {
  const upper = symbol.toUpperCase();
  return REVERSE_ALIASES[upper] ?? upper;
}

/**
 * Check if a symbol has an alias (is a renamed symbol).
 */
export function hasAlias(symbol: string): boolean {
  return symbol.toUpperCase() in SYMBOL_ALIASES;
}

/**
 * Build a lookup set: for each current symbol, include its aliases.
 * E.g., getSymbolAliases('POLUSDT') → Set{'POLUSDT', 'MATICUSDT'}
 */
export function getSymbolAliases(symbol: string): Set<string> {
  const upper = symbol.toUpperCase();
  const aliases = new Set<string>([upper]);
  // If this is a current symbol, add the old name
  if (REVERSE_ALIASES[upper]) {
    aliases.add(REVERSE_ALIASES[upper]!);
  }
  // If this is an old symbol, add the new name
  if (SYMBOL_ALIASES[upper]) {
    aliases.add(SYMBOL_ALIASES[upper]!);
  }
  return aliases;
}

/**
 * Find the best matching coin price from the coins array.
 * Checks both the exact symbol and any aliases.
 */
export function findCoinPrice(
  coins: Array<{ symbol: string; price: number }>,
  targetSymbol: string
): number | undefined {
  const aliases = getSymbolAliases(targetSymbol);
  for (const coin of coins) {
    if (aliases.has(coin.symbol.toUpperCase()) && coin.price > 0) {
      return coin.price;
    }
  }
  return undefined;
}
