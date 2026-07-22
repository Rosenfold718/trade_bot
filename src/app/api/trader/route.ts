import { NextRequest, NextResponse } from 'next/server';
import { initDB, getTraderState, getIndicatorWeights, getOpenTrades, getRecentTrades, openTrade, closeTrade, updateStopLoss, updateBalance, repayDebt } from '@/lib/db';
import { fetchKlines, makeStrategyDecision, fetchTopSymbols } from '@/lib/trading-engine';
import { getAuthUserId } from '@/lib/auth-helpers';

export async function GET(request: NextRequest) {
  try {
    const userId = await getAuthUserId();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    await initDB();
    const strategyId = request.nextUrl.searchParams.get('strategyId') || 'momentum';
    const [state, weights, openTrades, recentTrades] = await Promise.all([
      getTraderState(userId, strategyId),
      getIndicatorWeights(userId),
      getOpenTrades(userId, strategyId),
      getRecentTrades(userId, 20, strategyId),
    ]);
    return NextResponse.json({ state, weights, openTrades, recentTrades });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[trader GET] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = await getAuthUserId();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    await initDB();
    const body = await request.json();
    const { action, strategyId: rawStrategyId, timeframe, ...rest } = body as {
      action: string; strategyId?: string; symbol?: string; timeframe?: string;
    };
    const strategyId = rawStrategyId || 'momentum';

    if (action === 'analyze') {
      const sym = rest.symbol as string | undefined;
      if (!sym) return NextResponse.json({ error: 'Symbol required' }, { status: 400 });

      const state = await getTraderState(userId, strategyId);
      const weightsArr = await getIndicatorWeights(userId);
      const weights: Record<string, number> = {};
      for (const w of weightsArr) weights[w.indicator_name] = w.weight;

      const interval = timeframe || '1h';
      const limitMap: Record<string, number> = {
        '1m': 1000, '5m': 1000, '15m': 1000, '1h': 1440, '4h': 500, '1d': 365,
      };
      const limit = limitMap[interval] || 1440;

      const candles = await fetchKlines(sym, interval, limit);
      if (candles.length < 50) {
        return NextResponse.json({ error: 'Not enough candle data' }, { status: 400 });
      }

      const openTrades = await getOpenTrades(userId, strategyId);
      const lastTrade = openTrades[0];
      let idleMinutes = 0;
      if (lastTrade) {
        idleMinutes = Math.floor((Date.now() - new Date(lastTrade.opened_at).getTime()) / 60000);
      }

      const decision = makeStrategyDecision(strategyId, sym, candles, idleMinutes);

      return NextResponse.json({
        decision,
        currentPrice: candles[candles.length - 1].close,
        balance: state.balance,
      });
    }

    if (action === 'open-trade') {
      const { symbol: sym, entryPrice, amount, leverage, direction, stopLoss, takeProfit } = rest as {
        symbol: string; entryPrice: number; amount: number; leverage: number;
        direction: 'long' | 'short'; stopLoss: number; takeProfit: number;
      };

      if (amount <= 0) return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });

      const state = await getTraderState(userId, strategyId);
      if (state.balance < amount) {
        return NextResponse.json({ error: 'Insufficient balance' }, { status: 400 });
      }

      await openTrade(userId, sym, entryPrice, amount, leverage, direction, stopLoss, takeProfit, strategyId);
      await updateBalance(userId, state.balance - amount, strategyId);

      return NextResponse.json({ success: true, message: `Opened ${direction} on ${sym}` });
    }

    if (action === 'close-trade') {
      const { tradeId, exitPrice } = rest as { tradeId: string; exitPrice: number };
      const openTrades = await getOpenTrades(userId, strategyId);
      const trade = openTrades.find(t => t.id === tradeId);
      if (!trade) return NextResponse.json({ error: 'Trade not found' }, { status: 404 });

      const priceChange = trade.direction === 'long'
        ? (exitPrice - trade.entry_price) / trade.entry_price
        : (trade.entry_price - exitPrice) / trade.entry_price;
      const pnl = trade.amount * priceChange * trade.leverage - trade.amount * 0.001;

      await closeTrade(tradeId, exitPrice, pnl);

      const state = await getTraderState(userId, strategyId);
      let newBalance = state.balance + trade.amount + pnl;

      if (pnl > 0 && state.debt_to_repay > 0) {
        const repayAmount = pnl * 0.1;
        await repayDebt(userId, repayAmount, strategyId);
        newBalance -= Math.min(repayAmount, state.debt_to_repay);
      }

      await updateBalance(userId, newBalance, strategyId);

      return NextResponse.json({ success: true, pnl, newBalance });
    }

    if (action === 'update-sl') {
      const { tradeId, newStopLoss } = rest as { tradeId: string; newStopLoss: number };
      await updateStopLoss(tradeId, newStopLoss);
      return NextResponse.json({ success: true });
    }

    if (action === 'monitor-trades') {
      const openTrades = await getOpenTrades(userId, strategyId);
      const closedTrades: Array<{ tradeId: string; symbol: string; direction: string; pnl: number; reason: string }> = [];

      for (const trade of openTrades) {
        try {
          const url = `https://api.binance.com/api/v3/ticker/price?symbol=${trade.symbol}`;
          const res = await fetch(url);
          if (!res.ok) continue;
          const data = await res.json();
          const currentPrice = parseFloat(data.price);

          let shouldClose = false;
          let reason = '';
          let exitPrice = currentPrice;

          if (trade.direction === 'long' && trade.take_profit && currentPrice >= trade.take_profit) {
            shouldClose = true; reason = 'TP hit';
          } else if (trade.direction === 'short' && trade.take_profit && currentPrice <= trade.take_profit) {
            shouldClose = true; reason = 'TP hit';
          }

          if (trade.direction === 'long' && trade.stop_loss && currentPrice <= trade.stop_loss) {
            shouldClose = true; reason = 'SL hit';
          } else if (trade.direction === 'short' && trade.stop_loss && currentPrice >= trade.stop_loss) {
            shouldClose = true; reason = 'SL hit';
          }

          if (shouldClose) {
            const priceChange = trade.direction === 'long'
              ? (exitPrice - trade.entry_price) / trade.entry_price
              : (trade.entry_price - exitPrice) / trade.entry_price;
            const pnl = trade.amount * priceChange * trade.leverage - trade.amount * 0.001;

            await closeTrade(trade.id, exitPrice, pnl);

            const state = await getTraderState(userId, strategyId);
            let newBalance = state.balance + trade.amount + pnl;

            if (pnl > 0 && state.debt_to_repay > 0) {
              const repayAmount = pnl * 0.1;
              await repayDebt(userId, repayAmount, strategyId);
              newBalance -= Math.min(repayAmount, state.debt_to_repay);
            }

            await updateBalance(userId, newBalance, strategyId);

            closedTrades.push({ tradeId: trade.id, symbol: trade.symbol, direction: trade.direction, pnl, reason });
          }
        } catch {
          continue;
        }
      }

      const [updatedState, updatedTrades] = await Promise.all([
        getTraderState(userId, strategyId),
        getOpenTrades(userId, strategyId),
      ]);

      return NextResponse.json({
        success: true,
        closedTrades,
        openTrades: updatedTrades,
        state: updatedState,
      });
    }

    if (action === 'auto-trade') {
      const interval = timeframe || '1h';
      const symbols = await fetchTopSymbols();

      const openTrades = await getOpenTrades(userId, strategyId);
      const state = await getTraderState(userId, strategyId);
      if (openTrades.length >= 10) {
        return NextResponse.json({ message: 'Max open trades reached', openTrades });
      }

      const openSymbols = new Set(openTrades.map(t => t.symbol));
      const availableSymbols = symbols.filter(s => !openSymbols.has(s));

      let bestDecision: { decision: ReturnType<typeof makeStrategyDecision>; price: number; symbol: string } | null = null;
      let bestScore = 0;

      const checkSymbols = availableSymbols.sort(() => Math.random() - 0.5).slice(0, 10);
      for (const sym of checkSymbols) {
        try {
          const limitMap: Record<string, number> = {
            '1m': 1000, '5m': 1000, '15m': 1000, '1h': 1440, '4h': 500, '1d': 365,
          };
          const limit = limitMap[interval] || 1440;

          const candles = await fetchKlines(sym, interval, limit);
          if (candles.length < 50) continue;
          const lastTrade = openTrades[0];
          let idleMinutes = 0;
          if (lastTrade) {
            idleMinutes = Math.floor((Date.now() - new Date(lastTrade.opened_at).getTime()) / 60000);
          }
          const decision = makeStrategyDecision(strategyId, sym, candles, idleMinutes);
          if (decision.direction !== 'none' && Math.abs(decision.score) > bestScore) {
            bestScore = Math.abs(decision.score);
            bestDecision = { decision, price: candles[candles.length - 1].close, symbol: sym };
          }
        } catch {
          continue;
        }
      }

      if (!bestDecision || bestDecision.decision.direction === 'none') {
        return NextResponse.json({ message: 'No strong signals found', openTrades });
      }

      const { decision, price, symbol: sym } = bestDecision;
      const tradeAmount = Math.min(state.balance * 0.15, state.balance);
      if (tradeAmount < 1) {
        return NextResponse.json({ message: 'Insufficient balance for trade' });
      }

      await openTrade(userId, sym, price, tradeAmount, decision.leverage, decision.direction as 'long' | 'short', decision.stopLoss, decision.takeProfit, strategyId);
      await updateBalance(userId, state.balance - tradeAmount, strategyId);

      return NextResponse.json({
        success: true,
        message: `Auto-opened ${decision.direction} ${sym} @ ${price} with ${decision.leverage}x`,
        trade: { symbol: sym, direction: decision.direction, price, leverage: decision.leverage },
      });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[trader POST] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}