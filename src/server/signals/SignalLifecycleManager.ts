/**
 * Signal Lifecycle & Outcome Tracking Engine
 *
 * Implements Strict Signal Lifecycle State Machine:
 *
 * State Transitions:
 * GENERATED -> ACTIVE -> [TP1_HIT -> TP2_HIT -> TP3_HIT]
 * OR
 * ACTIVE/TP1_HIT/TP2_HIT -> [SL_HIT | EXPIRED]
 */

import { TradingSignal, NormalizedTicker } from '../../types/index.js';
import { marketDataManager } from '../market/MarketDataManager.js';
import { ScannerPersistence, PersistedSentSignal } from './ScannerPersistence.js';
import { StrategyPerformanceTracker } from './StrategyPerformanceTracker.js';
import { SignalLogger, SignalLogStatus } from './SignalLogger.js';
import { SignalOutcomeLogger, SignalOutcomeRecord } from './SignalOutcomeLogger.js';
import { MarketRegime } from './StrategyEngine.js';
import { logger } from '../logger.js';

export type SignalLifecycleState =
  | 'GENERATED'
  | 'ACTIVE'
  | 'TP_HIT'
  | 'TP1_HIT'
  | 'TP2_HIT'
  | 'TP3_HIT'
  | 'SL_HIT'
  | 'EXPIRED'
  | 'INVALIDATED';

export class SignalLifecycleManager {
  private static isEvaluating = false;

  /**
   * Evaluates all currently active signals against live market quotes and candle history.
   * Resolves progressive TP levels (TP1, TP2, TP3), SL, or Expiration.
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
      // Fetch all active or progressive signals (e.g., ACTIVE, TP1_HIT, TP2_HIT)
      const activeSignals = await ScannerPersistence.getActiveSignals();

      for (const sig of activeSignals) {
        // 1. Check TTL Expiration (Default 24 hours)
        const ageMs = now - sig.timestamp;
        const maxTtlMs = 24 * 60 * 60 * 1000;

        if (ageMs > maxTtlMs) {
          logger.info(`[SignalLifecycle] Signal ${sig.id} (${sig.symbol}) reached TTL expiration (${(ageMs / 3600000).toFixed(1)}h).`);
          
          // Progressive Sequence to EXPIRED
          await this.transitionSignalProgressive(sig, 'EXPIRED', {
            expiredTimestamp: now
          });
          expiredCount++;
          continue;
        }

        // 2. Fetch live price with same provider (dataSource)
        const providerName = sig.dataSource;
        let liveTicker: NormalizedTicker | null = null;
        try {
          liveTicker = await marketDataManager.getPrice(sig.symbol, providerName, true);
        } catch (err) {
          logger.debug(`[SignalLifecycle] Live quote unavailable for ${sig.symbol} from ${providerName}`, { error: String(err) });
          continue;
        }

        if (!liveTicker || liveTicker.price <= 0) {
          logger.warn(`[SignalLifecycle] Empty or invalid price returned for ${sig.symbol} from ${providerName}`);
          continue;
        }

        // Provider mismatch and stale-price protection (stale if > 15m received age or > 30m provider age)
        const providerMismatch = liveTicker.provider.toLowerCase() !== providerName.toLowerCase();
        if (providerMismatch) {
          logger.warn(`[SignalLifecycle] Provider mismatch for ${sig.symbol}. Expected: ${providerName}, got: ${liveTicker.provider}. Skipping.`);
          continue;
        }

        const isStale = (now - liveTicker.receivedAt > 15 * 60 * 1000) || (now - liveTicker.timestamp > 30 * 60 * 1000) || liveTicker.status !== 'OK';
        if (isStale) {
          logger.warn(`[SignalLifecycle] Stale price detected for ${sig.symbol} from ${providerName}. Skipping scan.`);
          continue;
        }

        // 3. Fetch fine-grained candles to analyze high/low progression chronologically since signal creation
        let candles: any[] = [];
        try {
          // Fetch 1m candles for precise entry progression tracking
          candles = await marketDataManager.getCandles(sig.symbol, providerName, '1m', 1000);
        } catch (err) {
          logger.warn(`[SignalLifecycle] Failed to fetch 1m candles for ${sig.symbol} from ${providerName}. Falling back to tick/live price assessment.`, { error: String(err) });
        }

        // 4. Chronological Scan & Outcome Progression Tracking
        let currentState: 'ACTIVE' | 'TP1_HIT' | 'TP2_HIT' | 'TP3_HIT' | 'SL_HIT' = sig.status as any;
        if (currentState !== 'ACTIVE' && currentState !== 'TP1_HIT' && currentState !== 'TP2_HIT') {
          // If already in a terminal state, don't re-evaluate
          continue;
        }
        
        // Load existing outcomes from persistent log if any
        const existingOutcome = await SignalOutcomeLogger.getOutcome(sig.id);
        let tp1HitTimestamp = existingOutcome?.tp1HitTimestamp;
        let tp2HitTimestamp = existingOutcome?.tp2HitTimestamp;
        let tp3HitTimestamp = existingOutcome?.tp3HitTimestamp;
        let slHitTimestamp = existingOutcome?.slHitTimestamp;

        const isBuy = sig.direction === 'BUY';
        const sl = sig.stopLoss;
        const tp1 = sig.tp1 ?? sig.takeProfit;
        const tp2 = sig.tp2 ?? sig.takeProfit;
        const tp3 = sig.tp3 ?? sig.takeProfit;

        if (Array.isArray(candles) && candles.length > 0) {
          const sortedCandles = [...candles]
            .filter((c) => c.timestamp >= sig.timestamp)
            .sort((a, b) => a.timestamp - b.timestamp);

          for (const candle of sortedCandles) {
            if ((currentState as string) === 'SL_HIT' || (currentState as string) === 'TP3_HIT') {
              break; // Terminal state reached
            }

            const high = candle.high;
            const low = candle.low;
            const time = candle.timestamp;

            if (isBuy) {
              // BUY: Evaluate SL first (conservative)
              if (low <= sl) {
                currentState = 'SL_HIT';
                slHitTimestamp = time;
                break;
              }
              // Progressively evaluate TP levels
              if (currentState === 'ACTIVE') {
                if (high >= tp1) {
                  currentState = 'TP1_HIT';
                  tp1HitTimestamp = time;
                }
              }
              if (currentState === 'TP1_HIT') {
                if (high >= tp2) {
                  currentState = 'TP2_HIT';
                  tp2HitTimestamp = time;
                }
              }
              if (currentState === 'TP2_HIT') {
                if (high >= tp3) {
                  currentState = 'TP3_HIT';
                  tp3HitTimestamp = time;
                }
              }
            } else {
              // SELL: Evaluate SL first (conservative)
              if (high >= sl) {
                currentState = 'SL_HIT';
                slHitTimestamp = time;
                break;
              }
              // Progressively evaluate TP levels
              if (currentState === 'ACTIVE') {
                if (low <= tp1) {
                  currentState = 'TP1_HIT';
                  tp1HitTimestamp = time;
                }
              }
              if (currentState === 'TP1_HIT') {
                if (low <= tp2) {
                  currentState = 'TP2_HIT';
                  tp2HitTimestamp = time;
                }
              }
              if (currentState === 'TP2_HIT') {
                if (low <= tp3) {
                  currentState = 'TP3_HIT';
                  tp3HitTimestamp = time;
                }
              }
            }
          }
        }

        // 5. If candle scan did not resolve terminal status, test latest real-time quote
        if (currentState !== 'SL_HIT' && currentState !== 'TP3_HIT') {
          const currentPrice = liveTicker.price;
          const time = Date.now();

          if (isBuy) {
            if (currentPrice <= sl) {
              currentState = 'SL_HIT';
              slHitTimestamp = time;
            } else {
              if (currentState === 'ACTIVE' && currentPrice >= tp1) {
                currentState = 'TP1_HIT';
                tp1HitTimestamp = time;
              }
              if (currentState === 'TP1_HIT' && currentPrice >= tp2) {
                currentState = 'TP2_HIT';
                tp2HitTimestamp = time;
              }
              if (currentState === 'TP2_HIT' && currentPrice >= tp3) {
                currentState = 'TP3_HIT';
                tp3HitTimestamp = time;
              }
            }
          } else {
            if (currentPrice >= sl) {
              currentState = 'SL_HIT';
              slHitTimestamp = time;
            } else {
              if (currentState === 'ACTIVE' && currentPrice <= tp1) {
                currentState = 'TP1_HIT';
                tp1HitTimestamp = time;
              }
              if (currentState === 'TP1_HIT' && currentPrice <= tp2) {
                currentState = 'TP2_HIT';
                tp2HitTimestamp = time;
              }
              if (currentState === 'TP2_HIT' && currentPrice <= tp3) {
                currentState = 'TP3_HIT';
                tp3HitTimestamp = time;
              }
            }
          }
        }

        // 6. Transition state progressively if a new target was achieved
        if (currentState !== sig.status) {
          const statesSequence: Array<'ACTIVE' | 'TP1_HIT' | 'TP2_HIT' | 'TP3_HIT' | 'SL_HIT' | 'EXPIRED'> = [];
          if (sig.status === 'ACTIVE') {
            if (currentState === 'TP1_HIT' || currentState === 'TP2_HIT' || currentState === 'TP3_HIT') {
              statesSequence.push('TP1_HIT');
            }
            if (currentState === 'TP2_HIT' || currentState === 'TP3_HIT') {
              statesSequence.push('TP2_HIT');
            }
            if (currentState === 'TP3_HIT') {
              statesSequence.push('TP3_HIT');
            }
            if (currentState === 'SL_HIT') {
              statesSequence.push('SL_HIT');
            }
          } else if (sig.status === 'TP1_HIT') {
            if (currentState === 'TP2_HIT' || currentState === 'TP3_HIT') {
              statesSequence.push('TP2_HIT');
            }
            if (currentState === 'TP3_HIT') {
              statesSequence.push('TP3_HIT');
            }
            if (currentState === 'SL_HIT') {
              statesSequence.push('SL_HIT');
            }
          } else if (sig.status === 'TP2_HIT') {
            if (currentState === 'TP3_HIT') {
              statesSequence.push('TP3_HIT');
            }
            if (currentState === 'SL_HIT') {
              statesSequence.push('SL_HIT');
            }
          }

          let currentStatusRef = sig.status;
          for (const nextState of statesSequence) {
            logger.info(`[SignalLifecycle] Transitioning signal ${sig.id} (${sig.symbol}) from ${currentStatusRef} to ${nextState}`);
            await this.transitionSignalProgressive(sig, nextState, {
              tp1HitTimestamp,
              tp2HitTimestamp,
              tp3HitTimestamp,
              slHitTimestamp,
            });
            // Update reference
            currentStatusRef = nextState;

            if (nextState === 'TP1_HIT' || nextState === 'TP2_HIT' || nextState === 'TP3_HIT') {
              tpHitCount++;
            } else if (nextState === 'SL_HIT') {
              slHitCount++;
            }
          }
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
   * Performs a single step progressive transition, saves it, logs it, sends notifications, and updates metrics.
   */
  private static async transitionSignalProgressive(
    sig: PersistedSentSignal,
    nextState: 'ACTIVE' | 'TP1_HIT' | 'TP2_HIT' | 'TP3_HIT' | 'SL_HIT' | 'EXPIRED',
    timestamps: {
      tp1HitTimestamp?: number;
      tp2HitTimestamp?: number;
      tp3HitTimestamp?: number;
      slHitTimestamp?: number;
      expiredTimestamp?: number;
    }
  ): Promise<void> {
    const now = Date.now();

    // 1. Update scanner persistence status
    await ScannerPersistence.updateSignalStatus(sig.id, nextState);

    // 2. Update dedicated Signal Logger status
    const logStatusMapping: SignalLogStatus =
      nextState === 'TP1_HIT' ? 'TP1 HIT' :
      nextState === 'TP2_HIT' ? 'TP2 HIT' :
      nextState === 'TP3_HIT' ? 'TP3 HIT' :
      nextState === 'SL_HIT' ? 'SL HIT' :
      nextState === 'EXPIRED' ? 'EXPIRED' : 'ACTIVE';
    await SignalLogger.updateStatus(sig.id, logStatusMapping);

    // 3. Write separate Signal Outcome Log
    const finalOutcome = nextState === 'ACTIVE' ? undefined : nextState;
    const outcomeRecord: SignalOutcomeRecord = {
      id: sig.id,
      symbol: sig.symbol,
      direction: sig.direction,
      provider: sig.dataSource,
      entryPrice: sig.entryPrice,
      stopLoss: sig.stopLoss,
      takeProfit: sig.takeProfit,
      tp1: sig.tp1 ?? sig.takeProfit,
      tp2: sig.tp2 ?? sig.takeProfit,
      tp3: sig.tp3 ?? sig.takeProfit,
      tp1HitTimestamp: timestamps.tp1HitTimestamp,
      tp2HitTimestamp: timestamps.tp2HitTimestamp,
      tp3HitTimestamp: timestamps.tp3HitTimestamp,
      slHitTimestamp: timestamps.slHitTimestamp,
      expiredTimestamp: nextState === 'EXPIRED' ? (timestamps.expiredTimestamp || now) : undefined,
      finalOutcome,
      status: nextState,
      timestamp: sig.timestamp,
      updatedAt: now,
    };
    await SignalOutcomeLogger.recordOutcome(outcomeRecord);

    // 4. Send notification if configured
    const settings = ScannerPersistence.getSettings();
    if (settings.notificationsEnabled) {
      let type: 'BEST_TRADE' | 'HIGH_QUALITY' | 'NO_TRADE' | 'SETUP_UPDATE' = 'SETUP_UPDATE';
      let title = '';
      let message = '';

      if (nextState === 'TP1_HIT') {
        type = 'SETUP_UPDATE';
        title = `${sig.symbol} [${sig.direction}] - TP1 HIT ✅`;
        message = `Conservative Take-Profit level reached for ${sig.symbol} at ${sig.tp1 ?? sig.takeProfit}.`;
      } else if (nextState === 'TP2_HIT') {
        type = 'HIGH_QUALITY';
        title = `${sig.symbol} [${sig.direction}] - TP2 HIT ✅`;
        message = `Main Take-Profit target achieved for ${sig.symbol} at ${sig.tp2 ?? sig.takeProfit}.`;
      } else if (nextState === 'TP3_HIT') {
        type = 'BEST_TRADE';
        title = `${sig.symbol} [${sig.direction}] - TP3 HIT 🏆 FULL TARGET`;
        message = `Extended Take-Profit reached! ${sig.symbol} fully completed target at ${sig.tp3 ?? sig.takeProfit}.`;
      } else if (nextState === 'SL_HIT') {
        type = 'NO_TRADE';
        title = `${sig.symbol} [${sig.direction}] - STOP LOSS HIT ❌`;
        message = `Stop-loss triggered for ${sig.symbol} at ${sig.stopLoss}.`;
      }

      if (title && message) {
        await ScannerPersistence.recordNotification({
          type,
          symbol: sig.symbol,
          title,
          message,
          score: sig.score,
          rankTier: sig.rankTier,
        });
      }
    }

    // 5. If terminal state reached (TP3_HIT, SL_HIT, EXPIRED), push outcome into StrategyPerformanceTracker
    if (nextState === 'TP3_HIT' || nextState === 'SL_HIT' || nextState === 'EXPIRED') {
      let assetClass: 'CRYPTO' | 'FOREX' | 'STOCKS' = 'CRYPTO';
      if (sig.symbol.includes('USD') && (sig.symbol.length === 6 || sig.symbol.includes('EUR') || sig.symbol.includes('GBP'))) {
        assetClass = 'FOREX';
      } else if (!sig.symbol.includes('USDT') && !sig.symbol.includes('BTC') && sig.symbol.length <= 5) {
        assetClass = 'STOCKS';
      }

      const confScore = sig.score ?? 80;
      let realizedRR = 0;
      let isWin = false;
      let outcomeStatus: 'TP_HIT' | 'SL_HIT' | 'EXPIRED' | 'INVALIDATED' = 'EXPIRED';

      if (nextState === 'TP3_HIT') {
        realizedRR = Math.max(2.0, sig.riskRewardRatio);
        isWin = true;
        outcomeStatus = 'TP_HIT';
      } else if (nextState === 'SL_HIT') {
        realizedRR = -1.0;
        isWin = false;
        outcomeStatus = 'SL_HIT';
      } else if (nextState === 'EXPIRED') {
        realizedRR = 0;
        isWin = false;
        outcomeStatus = 'EXPIRED';
      }

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
        outcomeStatus,
        realizedRR,
        isWin,
        timestamp: sig.timestamp,
        resolvedAt: now,
        durationMs: now - sig.timestamp,
      });
    }
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
