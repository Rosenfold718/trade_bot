import { NextRequest, NextResponse } from 'next/server';
import { initDB, getTraderState, getIndicatorWeights, getOpenTrades, getRecentTrades, openTrade, closeTrade, updateStopLoss, updateBalance, repayDebt } from '@/lib/db';
import { fetchKlines, makeTradingDecision, fetchTopSymbols } from '@/lib/trading-engine';

export async function GET() {
  try {
    await initDB();
    const [state, weights, openTrades, recentTrades] = await Promise.all([
      getTraderState(),
      getIndicatorWeights(),
      getOpenTrades(),
      getRecentTrades(20),
    ]);
    return NextResponse.json({ state, weights, openTrades, recentTrades });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    await initDB();
    const body = await request.json();
    const { action, symbol, timeframe } = body as { action: string; symbol?: string; timeframe?: string };

    if (action === 'analyze') {
      if (!symbol) return NextResponse.json({ error: 'Symbol required' }, { status: 400 });

      const state = await getTraderState();
      const weightsArr = await getIndicatorWeights();
      const weights: Record<string, number> = {};
      for (const w of weightsArr) weights[w.indicator_name] = w.weight;

      const interval = timeframe || '1h';
      const limitMap: Record<string, number> = {
        '1m': 1000,
        '5m': 1000,
        '15m': 1000,
        '1h': 720,
        '4h': 500,
        '1d': 365,
      };
      const limit = limitMap[interval] || 720;

      const candles = await fetchKlines(symbol, interval, limit);
      if (candles.length < 50) {
        return NextResponse.json({ error: 'Not enough candle data' }, { status: 400 });
      }

      const openTrades = await getOpenTrades();
      const lastTrade = openTrades[0];
      let idleMinutes = 30;
      if (lastTrade) {
        idleMinutes = Math.floor((Date.now() - new Date(lastTrade.opened_at).getTime()) / 60000);
      }

      const decision = makeTradingDecision(symbol, candles, weights, idleMinutes);

      return NextResponse.json({
        decision,
        currentPrice: candles[candles.length - 1].close,
        balance: state.balance,
      });
    }

    if (action === 'open-trade') {
      const { symbol: sym, entryPrice, amount, leverage, direction, stopLoss, takeProfit } = body as {
        symbol: string; entryPrice: number; amount: number; leverage: number;
        direction: 'long' | 'short'; stopLoss: number; takeProfit: number;
      };

      if (amount <= 0) return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });

      const state = await getTraderState();
      if (state.balance < amount) {
        return NextResponse.json({ error: 'Insufficient balance' }, { status: 400 });
      }

      await openTrade(sym, entryPrice, amount, leverage, direction, stopLoss, takeProfit);
      await updateBalance(state.balance - amount);

      return NextResponse.json({ success: true, message: `Opened ${direction} on ${sym}` });
    }

    if (action === 'close-trade') {
      const { tradeId, exitPrice } = body as { tradeId: string; exitPrice: number };
      const openTrades = await getOpenTrades();
      const trade = openTrades.find(t => t.id === tradeId);
      if (!trade) return NextResponse.json({ error: 'Trade not found' }, { status: 404 });

      const priceChange = trade.direction === 'long'
        ? (exitPrice - trade.entry_price) / trade.entry_price
        : (trade.entry_price - exitPrice) / trade.entry_price;
      const pnl = trade.amount * priceChange * trade.leverage - trade.amount * 0.001;

      await closeTrade(tradeId, exitPrice, pnl);

      const state = await getTraderState();
      let newBalance = state.balance + trade.amount + pnl;

      // Repay 10% of profitable trades
      if (pnl > 0 && state.debt_to_repay > 0) {
        const repayAmount = pnl * 0.1;
        await repayDebt(repayAmount);
        newBalance -= Math.min(repayAmount, state.debt_to_repay);
      }

      await updateBalance(newBalance);

      return NextResponse.json({ success: true, pnl, newBalance });
    }

    if (action === 'update-sl') {
      const { tradeId, newStopLoss } = body as { tradeId: string; newStopLoss: number };
      await updateStopLoss(tradeId, newStopLoss);
      return NextResponse.json({ success: true });
    }

    if (action === 'monitor-trades') {
      const openTrades = await getOpenTrades();
      const closedTrades: Array<{ tradeId: string; symbol: string; direction: string; pnl: number; reason: string }> = [];

      for (const trade of openTrades) {
        try {
          // Fetch current price
          const url = `https://api.binance.com/api/v3/ticker/price?symbol=${trade.symbol}`;
          const res = await fetch(url);
          if (!res.ok) continue;
          const data = await res.json();
          const currentPrice = parseFloat(data.price);

          let shouldClose = false;
          let reason = '';
          let exitPrice = currentPrice;

          // Check TP
          if (trade.direction === 'long' && trade.take_profit && currentPrice >= trade.take_profit) {
            shouldClose = true;
            reason = 'TP hit';
          } else if (trade.direction === 'short' && trade.take_profit && currentPrice <= trade.take_profit) {
            shouldClose = true;
            reason = 'TP hit';
          }

          // Check SL
          if (trade.direction === 'long' && trade.stop_loss && currentPrice <= trade.stop_loss) {
            shouldClose = true;
            reason = 'SL hit';
          } else if (trade.direction === 'short' && trade.stop_loss && currentPrice >= trade.stop_loss) {
            shouldClose = true;
            reason = 'SL hit';
          }

          if (shouldClose) {
            const priceChange = trade.direction === 'long'
              ? (exitPrice - trade.entry_price) / trade.entry_price
              : (trade.entry_price - exitPrice) / trade.entry_price;
            const pnl = trade.amount * priceChange * trade.leverage - trade.amount * 0.001;

            await closeTrade(trade.id, exitPrice, pnl);

            const state = await getTraderState();
            let newBalance = state.balance + trade.amount + pnl;

            if (pnl > 0 && state.debt_to_repay > 0) {
              const repayAmount = pnl * 0.1;
              await repayDebt(repayAmount);
              newBalance -= Math.min(repayAmount, state.debt_to_repay);
            }

            await updateBalance(newBalance);

            closedTrades.push({
              tradeId: trade.id,
              symbol: trade.symbol,
              direction: trade.direction,
              pnl,
              reason,
            });
          }
        } catch {
          // Skip this trade if price fetch fails
          continue;
        }
      }

      // Return updated state
      const [updatedState, updatedTrades] = await Promise.all([
        getTraderState(),
        getOpenTrades(),
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
      const weightsArr = await getIndicatorWeights();
      const weights: Record<string, number> = {};
      for (const w of weightsArr) weights[w.indicator_name] = w.weight;

      const openTrades = await getOpenTrades();
      const state = await getTraderState();
      if (openTrades.length >= 3) {
        return NextResponse.json({ message: 'Max 3 open trades', openTrades });
      }

      // Skip symbols that already have open trades
      const openSymbols = new Set(openTrades.map(t => t.symbol));
      const availableSymbols = symbols.filter(s => !openSymbols.has(s));

      let bestDecision: { decision: ReturnType<typeof makeTradingDecision>; price: number; symbol: string } | null = null;
      let bestScore = 0;

      // Check up to 10 random symbols for signals
      const checkSymbols = availableSymbols.sort(() => Math.random() - 0.5).slice(0, 10);
      for (const sym of checkSymbols) {
        try {
          const limitMap: Record<string, number> = {
            '1m': 1000,
            '5m': 1000,
            '15m': 1000,
            '1h': 720,
            '4h': 500,
            '1d': 365,
          };
          const limit = limitMap[interval] || 720;

          const candles = await fetchKlines(sym, interval, limit);
          if (candles.length < 50) continue;
          const lastTrade = openTrades[0];
          let idleMinutes = 30;
          if (lastTrade) {
            idleMinutes = Math.floor((Date.now() - new Date(lastTrade.opened_at).getTime()) / 60000);
          }
          const decision = makeTradingDecision(sym, candles, weights, idleMinutes);
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

      await openTrade(sym, price, tradeAmount, decision.leverage, decision.direction as 'long' | 'short', decision.stopLoss, decision.takeProfit);
      await updateBalance(state.balance - tradeAmount);

      return NextResponse.json({
        success: true,
        message: `Auto-opened ${decision.direction} ${sym} @ ${price} with ${decision.leverage}x`,
        trade: { symbol: sym, direction: decision.direction, price, leverage: decision.leverage },
      });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}