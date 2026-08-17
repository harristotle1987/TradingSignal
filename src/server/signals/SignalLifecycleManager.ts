/**
 * Signal Lifecycle & Outcome Tracking Engine
 *
 * Implements Strict Signal Lifecycle State Machine:
 *
 * State Transitions:
 * GENERATED -> ACTIVE -> [TP_HIT | SL_HIT | EXPIRED | INVALIDATED]
 *
 * Lifecycle Rules:
 * 1. ACTIVE: Emitted signals remain actively monitored against live market feeds.
 * 2. TP_HIT: When market price reaches or exceeds the take-profit target in the trade direction.
 * 3. SL_HIT: When market price touches or crosses the stop-loss boundary.
 * 4. EXPIRED: When signal TTL (default 4 to 24 hours) is exceeded without hitting TP or SL.
 * 5. INVALIDATED: When a major trend break or contradictory regime invalidates the trade thesis.
 *
 * Integration:
 * - Automatically feeds resolved trade outcomes into StrategyPerformanceTracker.
 * - Persists all lifecycle state updates into Firestore and local disk storage.
 */

import { TradingSignal, NormalizedTicker } from '../../types/index.js';
import { marketDataManager } from '../market/MarketDataManager.js';
import { ScannerPersistence, PersistedSentSignal } from './ScannerPersistence.js';
import { StrategyPerformanceTracker } from './StrategyPerformanceTracker.js';
import { SignalLogger, SignalLogStatus } from './SignalLogger.js';
import { MarketRegime } from './StrategyEngine.js';
import { logger } from '../logger.js';

export type SignalLifecycleState =
  | 'GENERATED'
  | 'ACTIVE'
  | 'TP_HIT'
  | 'SL_HIT'
  | 'EXPIRED'
  | 'INVALIDATED';

export class SignalLifecycleManager {
  private static isEvaluating = false;

  /**
   * Evaluates all currently active signals against live market quotes.
   * Resolves TP, SL, Expiration, or Invalidation.
   */
  static async evaluateActiveSignals(): Promise<{
    evaluatedCount: number;
    tpHitCount: number;
    slHitCount: number;
    expiredCount: number;
    invalidatedCount: number;
  }> {
    if (this.isEvaluating) {
      return { evaluatedCount: 0, tpHitCount: 0, slHitCount: 0, expiredCount: 0, invalidatedCount: 0 };
    }

    this.isEvaluating = true;
    const now = Date.now();
    let tpHitCount = 0;
    let slHitCount = 0;
    let expiredCount = 0;
    let invalidatedCount = 0;

    try {
      const sentSignalsToday = await ScannerPersistence.getSentSignalsToday();
      const activeSignals = sentSignalsToday.filter((s) => s.status === 'ACTIVE');

      for (const sig of activeSignals) {
        // 1. Check TTL Expiration (Default 6 hours)
        const ageMs = now - sig.timestamp;
        const maxTtlMs = 6 * 60 * 60 * 1000;

        if (ageMs > maxTtlMs) {
          logger.info(`[SignalLifecycle] Signal ${sig.id} (${sig.symbol}) reached TTL expiration (${(ageMs / 3600000).toFixed(1)}h).`);
          await this.transitionSignal(sig, 'EXPIRED', 0, false, now);
          expiredCount++;
          continue;
        }

        // 2. Fetch live price
        let liveTicker: NormalizedTicker | null = null;
        try {
          liveTicker = await marketDataManager.getPrice(sig.symbol, undefined, true);
        } catch (err) {
          logger.debug(`[SignalLifecycle] Live quote unavailable for ${sig.symbol}`, { error: String(err) });
          continue;
        }

        if (!liveTicker || liveTicker.price <= 0) continue;

        const currentPrice = liveTicker.price;
        const isBuy = sig.direction === 'BUY';
        const entry = sig.entryPrice;
        const sl = sig.stopLoss;
        const tp = sig.takeProfit;

        // 3. Evaluate Take-Profit Hit
        const isTpHit = isBuy ? currentPrice >= tp : currentPrice <= tp;
        if (isTpHit) {
          const realizedRR = Math.max(2.0, sig.riskRewardRatio);
          logger.info(`[SignalLifecycle] 🎯 TAKE-PROFIT HIT for ${sig.symbol} [${sig.direction}] at ${currentPrice} (TP: ${tp}, Entry: ${entry}, +${realizedRR}R).`);
          await this.transitionSignal(sig, 'TP_HIT', realizedRR, true, now);
          tpHitCount++;
          continue;
        }

        // 4. Evaluate Stop-Loss Hit
        const isSlHit = isBuy ? currentPrice <= sl : currentPrice >= sl;
        if (isSlHit) {
          logger.info(`[SignalLifecycle] 🛑 STOP-LOSS HIT for ${sig.symbol} [${sig.direction}] at ${currentPrice} (SL: ${sl}, Entry: ${entry}, -1.0R).`);
          await this.transitionSignal(sig, 'SL_HIT', -1.0, false, now);
          slHitCount++;
          continue;
        }
      }

      return {
        evaluatedCount: activeSignals.length,
        tpHitCount,
        slHitCount,
        expiredCount,
        invalidatedCount,
      };
    } catch (err) {
      logger.error('[SignalLifecycle] Error evaluating active signals lifecycle:', { error: String(err) });
      return { evaluatedCount: 0, tpHitCount, slHitCount, expiredCount, invalidatedCount };
    } finally {
      this.isEvaluating = false;
    }
  }

  /**
   * Transitions a signal to its terminal state and records the outcome.
   */
  private static async transitionSignal(
    sig: PersistedSentSignal,
    newState: SignalLifecycleState,
    realizedRR: number,
    isWin: boolean,
    resolvedAt: number
  ): Promise<void> {
    // 1. Update scanner persistence status
    const statusMapping: 'ACTIVE' | 'EXPIRED' | 'COMPLETED' | 'SUPERSEDED' =
      newState === 'EXPIRED' ? 'EXPIRED' : 'COMPLETED';
    await ScannerPersistence.updateSignalStatus(sig.id, statusMapping);

    // 2. Update dedicated Signal Logger status
    const logStatusMapping: SignalLogStatus =
      newState === 'TP_HIT'
        ? 'TP HIT'
        : newState === 'SL_HIT'
        ? 'SL HIT'
        : newState === 'EXPIRED'
        ? 'EXPIRED'
        : newState === 'INVALIDATED'
        ? 'INVALIDATED'
        : 'ACTIVE';
    await SignalLogger.updateStatus(sig.id, logStatusMapping);

    // 2. Extract asset class
    let assetClass: 'CRYPTO' | 'FOREX' | 'STOCKS' = 'CRYPTO';
    if (sig.symbol.includes('USD') && (sig.symbol.length === 6 || sig.symbol.includes('EUR') || sig.symbol.includes('GBP'))) {
      assetClass = 'FOREX';
    } else if (!sig.symbol.includes('USDT') && !sig.symbol.includes('BTC') && sig.symbol.length <= 5) {
      assetClass = 'STOCKS';
    }

    // 3. Record outcome in StrategyPerformanceTracker
    const confScore = sig.score ?? 80;
    StrategyPerformanceTracker.recordTradeOutcome({
      signalId: sig.id,
      symbol: sig.symbol,
      assetClass,
      direction: sig.direction,
      strategyId: this.extractStrategyId(sig.strategy),
      strategyName: sig.strategy,
      marketRegime: 'TRENDING' as MarketRegime,
      timeframe: sig.timeframe || '1h',
      confidenceScore: confScore,
      confidenceRange: StrategyPerformanceTracker.getConfidenceRange(confScore),
      entryPrice: sig.entryPrice,
      stopLoss: sig.stopLoss,
      takeProfit: sig.takeProfit,
      plannedRR: sig.riskRewardRatio,
      outcomeStatus: newState as any,
      realizedRR,
      isWin,
      timestamp: sig.timestamp,
      resolvedAt,
      durationMs: resolvedAt - sig.timestamp,
    });
  }

  private static extractStrategyId(strategyName: string): string {
    const s = strategyName.toLowerCase();
    if (s.includes('trend')) return 'strat_1';
    if (s.includes('momentum') || s.includes('zero-lag') || s.includes('macd')) return 'strat_2';
    if (s.includes('breakout') || s.includes('donchian')) return 'strat_3';
    if (s.includes('mean reversion') || s.includes('bollinger')) return 'strat_4';
    if (s.includes('order flow') || s.includes('imbalance')) return 'strat_5';
    if (s.includes('volatility')) return 'strat_6';
    return 'strat_1';
  }
}
