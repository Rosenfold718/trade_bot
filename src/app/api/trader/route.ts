import { NextRequest, NextResponse } from 'next/server';
import { initDB, getTraderState, getIndicatorWeights, getOpenTrades, getRecentTrades, getTotalClosedPnl, getClosedTradeCount, openTrade, closeTrade, updateStopLoss, updateTakeProfit, updateBalance, initUserTradingData, getClosedTrades, partialCloseTrade } from '@/lib/db';
import { fetchKlines, makeStrategyDecision, fetchTopSymbols } from '@/lib/trading-engine';
import { getAuthUserId } from '@/lib/auth-helpers';
import { getStrategy } from '@/lib/strategies';

export async function GET(request: NextRequest) {
  try {
    const userId = await getAuthUserId();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    await initDB();
    const strategyId = request.nextUrl.searchParams.get('strategyId') || 'momentum';

    // Ensure user has trading data for this strategy
    try {
      await getTraderState(userId, strategyId);
    } catch {
      await initUserTradingData(userId);
    }

    const [state, weights, openTrades, recentTrades, totalClosedPnl, closedTradeCount] = await Promise.all([
      getTraderState(userId, strategyId),
      getIndicatorWeights(userId),
      getOpenTrades(userId, strategyId),
      getRecentTrades(userId, 50, strategyId),
      getTotalClosedPnl(userId, strategyId),
      getClosedTradeCount(userId, strategyId),
    ]);

    // ── Balance self-heal: recalculate from trade history to fix any drift ──
    // Formula: balance = initial_balance + realizedPnl - lockedInOpenTrades
    // Uses state.initial_balance (from update-deposit) instead of hardcoded $100
    try {
      const allClosed = await getClosedTrades(userId, strategyId);
      const closedPnlSum = allClosed.reduce((s, t) => s + (t.pnl ?? 0), 0);
      const openAmountSum = openTrades.reduce((s, t) => s + (t.remaining_amount ?? t.amount), 0);
      const initialDeposit = state.initial_balance ?? 100;
      const correctBalance = Math.max(0, initialDeposit + closedPnlSum - openAmountSum);
      if (Math.abs(state.balance - correctBalance) > 0.01) {
        console.log(`[trader GET] Balance self-heal: ${state.balance.toFixed(2)} → ${correctBalance.toFixed(2)} (initial=$${initialDeposit} + pnl=${closedPnlSum.toFixed(2)} - open=${openAmountSum.toFixed(2)})`);
        await updateBalance(userId, correctBalance, strategyId);
        state.balance = correctBalance;
      }
    } catch { /* non-critical */ }

    return NextResponse.json({ state, weights, openTrades, recentTrades, totalClosedPnl, closedTradeCount });
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

    // Ensure user has trading data for this strategy
    try { await getTraderState(userId, strategyId); } catch { await initUserTradingData(userId); }

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

      // Validate trade parameters
      const maxAllowedLeverage = 3;
      if (leverage > maxAllowedLeverage) {
        return NextResponse.json({ error: `Максимальное плечо: ${maxAllowedLeverage}x` }, { status: 400 });
      }

      // Dynamic max trade amount: scales with user's balance (no fixed cap)
      // The client-side position sizing already calculates proper amounts,
      // so the backend just validates it doesn't exceed a reasonable % of balance.
      const state = await getTraderState(userId, strategyId);
      const dynamicMaxAmount = Math.max(8, state.balance * 0.10); // min $8, max 10% of balance
      if (amount > dynamicMaxAmount) {
        return NextResponse.json({ error: `Максимальная сумма сделки: $${dynamicMaxAmount.toFixed(0)} (10% от баланса $${state.balance.toFixed(0)})` }, { status: 400 });
      }
      if (stopLoss <= 0 || takeProfit <= 0) {
        return NextResponse.json({ error: 'SL и TP должны быть больше 0' }, { status: 400 });
      }
      // Check SL/TP distances are reasonable
      const slDist = Math.abs(entryPrice - stopLoss) / entryPrice;
      const tpDist = Math.abs(takeProfit - entryPrice) / entryPrice;
      if (slDist > 0.08) {
        return NextResponse.json({ error: 'Stop-loss слишком далёкий (макс. 8%)' }, { status: 400 });
      }
      if (tpDist > 0.20) {
        return NextResponse.json({ error: 'Take-profit слишком далёкий (макс. 20%)' }, { status: 400 });
      }

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
      const pnl = trade.amount * priceChange * trade.leverage - trade.amount * 0.001 - (trade.amount / trade.leverage) * 0.001;

      await closeTrade(tradeId, exitPrice, pnl);

      const state = await getTraderState(userId, strategyId);
      const newBalance = Math.max(0, state.balance + trade.amount + pnl);

      await updateBalance(userId, newBalance, strategyId);

      return NextResponse.json({ success: true, pnl, newBalance });
    }

    if (action === 'partial-close-trade') {
      const { tradeId, closeAmount, pnl, newRemainingAmount, newPartialState, newStopLoss } = rest as {
        tradeId: string; closeAmount: number; pnl: number; newRemainingAmount: number;
        newPartialState: string; newStopLoss?: number;
      };

      // 1. Update trade in DB (remaining_amount + partial_state + optional SL)
      await partialCloseTrade(tradeId, newRemainingAmount, newPartialState, newStopLoss);

      // 2. Credit the partial PnL + closed amount back to balance
      const state = await getTraderState(userId, strategyId);
      const newBalance = state.balance + closeAmount + pnl;
      await updateBalance(userId, newBalance, strategyId);

      return NextResponse.json({ success: true, pnl, closedAmount, newBalance });
    }

    if (action === 'update-sl') {
      const { tradeId, newStopLoss } = rest as { tradeId: string; newStopLoss: number };
      await updateStopLoss(tradeId, newStopLoss);
      return NextResponse.json({ success: true });
    }

    if (action === 'update-tp') {
      const { tradeId, newTakeProfit } = rest as { tradeId: string; newTakeProfit: number };
      await updateTakeProfit(tradeId, newTakeProfit);
      return NextResponse.json({ success: true });
    }

    if (action === 'monitor-trades') {
      const strategy = getStrategy(strategyId);
      const monitorInterval = strategy?.monitorInterval ?? '1h';
      const maxHoldMinutes = strategy?.maxHoldMinutes ?? 720;

      const openTrades = await getOpenTrades(userId, strategyId);
      const closedTrades: Array<{ tradeId: string; symbol: string; direction: string; pnl: number; reason: string }> = [];

      for (const trade of openTrades) {
        try {
          // ── AUTO-REPAIR: Fix inverted SL/TP for existing trades ──
          let needsRepair = false;
          if (trade.stop_loss && trade.take_profit && trade.entry_price) {
            const isLong = trade.direction === 'long';
            const slBad = isLong ? trade.stop_loss >= trade.entry_price : trade.stop_loss <= trade.entry_price;
            const tpBad = isLong ? trade.take_profit <= trade.entry_price : trade.take_profit >= trade.entry_price;
            if (slBad || tpBad) {
              console.warn(`[monitor-trades] Auto-repairing inverted SL/TP for ${trade.id}: dir=${trade.direction} entry=${trade.entry_price} SL=${trade.stop_loss} TP=${trade.take_profit}`);
              if (slBad) {
                const fixedSL = isLong ? Math.round(trade.entry_price * 0.98 * 1e8) / 1e8 : Math.round(trade.entry_price * 1.02 * 1e8) / 1e8;
                await updateStopLoss(trade.id, fixedSL);
                trade.stop_loss = fixedSL;
              }
              if (tpBad) {
                const fixedTP = isLong ? Math.round(trade.entry_price * 1.05 * 1e8) / 1e8 : Math.round(trade.entry_price * 0.95 * 1e8) / 1e8;
                await updateTakeProfit(trade.id, fixedTP);
                trade.take_profit = fixedTP;
              }
              needsRepair = true;
            }
            // Also cap excessive distances (>10%)
            if (trade.take_profit) {
              const tpDist = Math.abs(trade.take_profit - trade.entry_price) / trade.entry_price;
              if (tpDist > 0.10) {
                const cappedTP = isLong
                  ? Math.round((trade.entry_price * 1.10) * 1e8) / 1e8
                  : Math.round((trade.entry_price * 0.90) * 1e8) / 1e8;
                console.warn(`[monitor-trades] Capping excessive TP for ${trade.id}: ${trade.take_profit} -> ${cappedTP}`);
                await updateTakeProfit(trade.id, cappedTP);
                trade.take_profit = cappedTP;
                needsRepair = true;
              }
            }
            if (trade.stop_loss) {
              const slDist = Math.abs(trade.stop_loss - trade.entry_price) / trade.entry_price;
              if (slDist > 0.05) {
                const cappedSL = isLong
                  ? Math.round((trade.entry_price * 0.95) * 1e8) / 1e8
                  : Math.round((trade.entry_price * 1.05) * 1e8) / 1e8;
                console.warn(`[monitor-trades] Capping excessive SL for ${trade.id}: ${trade.stop_loss} -> ${cappedSL}`);
                await updateStopLoss(trade.id, cappedSL);
                trade.stop_loss = cappedSL;
                needsRepair = true;
              }
            }
          }
          if (needsRepair) continue; // skip TP/SL check this cycle, repaired next cycle

          // Use strategy-specific monitor interval for candle close
          const klineUrl = `https://api.binance.com/api/v3/klines?symbol=${trade.symbol}&interval=${monitorInterval}&limit=2`;
          const klineRes = await fetch(klineUrl);
          if (!klineRes.ok) continue;
          const klineData = await klineRes.json();
          if (!Array.isArray(klineData) || klineData.length < 1) continue;
          const completedCandle = klineData.length >= 2 ? klineData[0] : klineData[klineData.length - 1];
          const candleClose = parseFloat(String(completedCandle[4]));

          let shouldClose = false;
          let reason = '';

          // TIME-BASED EXIT: close losing trades after maxHoldMinutes
          const openMs = Date.now() - new Date(trade.opened_at).getTime();
          const openMinutes = openMs / 60000;
          if (openMinutes > maxHoldMinutes) {
            const unrealizedPnl = trade.direction === 'long'
              ? (candleClose - trade.entry_price) / trade.entry_price
              : (trade.entry_price - candleClose) / trade.entry_price;
            if (unrealizedPnl < 0) {
              shouldClose = true;
              const hours = Math.round(openMinutes / 60);
              reason = `Тайм-эксит (${hours}ч)`;
            }
          }

          if (trade.direction === 'long' && trade.take_profit && candleClose >= trade.take_profit) {
            shouldClose = true; reason = 'TP hit';
          } else if (trade.direction === 'short' && trade.take_profit && candleClose <= trade.take_profit) {
            shouldClose = true; reason = 'TP hit';
          }

          if (trade.direction === 'long' && trade.stop_loss && candleClose <= trade.stop_loss) {
            shouldClose = true; reason = 'SL hit';
          } else if (trade.direction === 'short' && trade.stop_loss && candleClose >= trade.stop_loss) {
            shouldClose = true; reason = 'SL hit';
          }

          if (shouldClose) {
            const priceChange = trade.direction === 'long'
              ? (candleClose - trade.entry_price) / trade.entry_price
              : (trade.entry_price - candleClose) / trade.entry_price;
            const pnl = trade.amount * priceChange * trade.leverage - trade.amount * 0.001 - (trade.amount / trade.leverage) * 0.001;

            await closeTrade(trade.id, candleClose, pnl);

            const state = await getTraderState(userId, strategyId);
            let newBalance = state.balance + trade.amount + pnl;

            if (pnl > 0 && state.debt_to_repay > 0) {
              const repayAmount = Math.min(pnl * 0.1, state.debt_to_repay);
              // Repay debt: update trader_state directly
              const { tursoDb } = await import('@/lib/db');
              await tursoDb.execute(
                `UPDATE trader_state SET debt_to_repay = MAX(0, debt_to_repay - ?), balance = balance - ? WHERE user_id = ? AND strategy_id = ?`,
                [repayAmount, repayAmount, userId, strategyId]
              );
              newBalance -= repayAmount;
            }

            if (newBalance < 0) newBalance = 0;

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
      // Dynamic position sizing based on balance (same logic as client-trader)
      const bal = state.balance;
      let tradeAmount: number;
      if (bal < 200) {
        tradeAmount = Math.max(1.5, Math.min(bal * 0.08, 8));
      } else if (bal < 1000) {
        tradeAmount = Math.max(5, Math.min(bal * 0.05, 50));
      } else if (bal < 5000) {
        tradeAmount = Math.max(20, Math.min(bal * 0.03, 150));
      } else {
        tradeAmount = Math.max(50, Math.min(bal * 0.02, 500));
      }
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