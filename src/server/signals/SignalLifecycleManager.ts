/**
 * Signal Lifecycle & Outcome Tracking Engine
 *
 * Implements Strict Signal Lifecycle State Machine & Historical Outcome Backfill:
 *
 * State Transitions:
 * GENERATED -> ACTIVE -> [TP1_HIT -> TP2_HIT -> TP3_HIT]
 * OR
 * ACTIVE/TP1_HIT/TP2_HIT -> [SL_HIT | EXPIRED | AMBIGUOUS]
 *
 * HISTORICAL OUTCOME BACKFILL GUARANTEES:
 * 1. Evaluates all ACTIVE/progressive signals starting from their creation timestamp (`sig.timestamp`) through now.
 * 2. Uses the same authoritative market-data provider designated for that asset.
 * 3. Sorts historical candle data chronologically ascending.
 * 4. Determines TP1, TP2, TP3 or SL reached before monitoring process started.
 * 5. Monotonic progression: Never resets confirmed TP milestones if price moves away later.
 * 6. Handles intra-candle conflicts: If both TP and SL are touched in the same candle and order cannot be reliably resolved, marks outcome as AMBIGUOUS without guessing.
 * 7. Strictly idempotent: Running repeatedly produces zero duplicate notifications or corrupted outcome logs.
 * 8. Clear Recovered/Historical notifications sent at most once per confirmed milestone.
 * 9. Stores detectedAt, eventTime, eventSource, timeframeUsed, isRecovered, and ambiguousDetails.
 */

import { NormalizedTicker, NormalizedCandle } from '../../types/index.js';
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
  | 'INVALIDATED'
  | 'AMBIGUOUS';

export interface SignalEvaluationSummary {
  evaluatedCount: number;
  tpHitCount: number;
  slHitCount: number;
  expiredCount: number;
  invalidatedCount: number;
  ambiguousCount: number;
  recoveredEventsCount: number;
}

export interface ProgressiveTransitionStep {
  nextState: 'ACTIVE' | 'TP1_HIT' | 'TP2_HIT' | 'TP3_HIT' | 'SL_HIT' | 'EXPIRED' | 'AMBIGUOUS';
  eventTime: number;
  eventSource: 'HISTORICAL_BACKFILL' | 'LIVE_STREAM' | 'TICK_EVALUATION';
  timeframeUsed: string;
  isRecovered: boolean;
  ambiguousDetails?: string;
}

export class SignalLifecycleManager {
  private static isEvaluating = false;

  /**
   * Evaluates all currently active signals against historical candle progression from `sig.timestamp`
   * and current live market quotes.
   */
  static async evaluateActiveSignals(): Promise<SignalEvaluationSummary> {
    if (this.isEvaluating) {
      return {
        evaluatedCount: 0,
        tpHitCount: 0,
        slHitCount: 0,
        expiredCount: 0,
        invalidatedCount: 0,
        ambiguousCount: 0,
        recoveredEventsCount: 0,
      };
    }

    this.isEvaluating = true;
    const now = Date.now();
    let tpHitCount = 0;
    let slHitCount = 0;
    let expiredCount = 0;
    let invalidatedCount = 0;
    let ambiguousCount = 0;
    let recoveredEventsCount = 0;

    try {
      // Fetch all active or progressive non-terminal signals (ACTIVE, TP1_HIT, TP2_HIT)
      const activeSignals = await ScannerPersistence.getActiveSignals();
      logger.info(`[SignalLifecycle] Beginning outcome evaluation for ${activeSignals.length} active/progressive signals.`);

      for (const sig of activeSignals) {
        const providerName = sig.dataSource || 'twelvedata';

        // 2. Fetch comprehensive historical candles from `sig.timestamp` up to `now` using the same provider
        const candles = await this.fetchHistoricalCandlesForSignal(sig.symbol, providerName, sig.timestamp);

        // 3. Load existing outcomes from persistent log if any to preserve already confirmed milestones
        const existingOutcome = await SignalOutcomeLogger.getOutcome(sig.id);
        const timestamps = {
          entryHitTimestamp: sig.entryHitTimestamp ?? existingOutcome?.entryHitTimestamp,
          tp1HitTimestamp: sig.tp1HitTimestamp ?? existingOutcome?.tp1HitTimestamp,
          tp2HitTimestamp: sig.tp2HitTimestamp ?? existingOutcome?.tp2HitTimestamp,
          tp3HitTimestamp: sig.tp3HitTimestamp ?? existingOutcome?.tp3HitTimestamp,
          slHitTimestamp: sig.slHitTimestamp ?? existingOutcome?.slHitTimestamp,
          expiredTimestamp: existingOutcome?.expiredTimestamp,
        };

        // 4. Chronological traversal of candle history
        const historicalResult = this.evaluateCandleHistory(sig, candles, timestamps);
        let currentState = historicalResult.finalState;
        const queuedTransitions = [...historicalResult.transitions];

        // 5. If candle scan did not resolve a terminal state, evaluate latest real-time quote
        if (currentState !== 'SL_HIT' && currentState !== 'TP3_HIT' && currentState !== 'AMBIGUOUS') {
          let liveTicker: NormalizedTicker | null = null;
          try {
            liveTicker = await marketDataManager.getPrice(sig.symbol, providerName, true);
          } catch (err) {
            logger.debug(`[SignalLifecycle] Live quote lookup failed for ${sig.symbol} from ${providerName}:`, { error: String(err) });
          }

          if (liveTicker && liveTicker.price > 0) {
            const providerMismatch = liveTicker.provider.toLowerCase() !== providerName.toLowerCase();
            const isStale = (now - liveTicker.receivedAt > 15 * 60 * 1000) || (now - liveTicker.timestamp > 30 * 60 * 1000) || liveTicker.status !== 'OK';

            if (!providerMismatch && !isStale) {
              const liveResult = this.evaluateLiveTicker(sig, currentState, liveTicker, timestamps);
              currentState = liveResult.finalState;
              queuedTransitions.push(...liveResult.transitions);
            }
          }
        }

        // 1. Check TTL Expiration (Default 24 hours) - ONLY if not yet entry triggered
        const ageMs = now - sig.timestamp;
        const maxTtlMs = 24 * 60 * 60 * 1000;

        if (ageMs > maxTtlMs && !timestamps.entryHitTimestamp) {
          logger.info(`[SignalLifecycle] Signal ${sig.id} (${sig.symbol}) reached TTL expiration (${(ageMs / 3600000).toFixed(1)}h).`);
          await this.transitionSignalProgressive(sig, {
            nextState: 'EXPIRED',
            eventTime: now,
            eventSource: 'TICK_EVALUATION',
            timeframeUsed: '1h',
            isRecovered: false,
          }, {
            ...timestamps,
            expiredTimestamp: now,
          });
          expiredCount++;
          continue;
        }

        // 6. Execute all queued progressive transitions in strict chronological order
        if (queuedTransitions.length > 0) {
          for (const step of queuedTransitions) {
            logger.info(`[SignalLifecycle] Executing transition for ${sig.symbol} [${sig.direction}] -> ${step.nextState} (Source: ${step.eventSource}, Time: ${new Date(step.eventTime).toISOString()})`);
            await this.transitionSignalProgressive(sig, step, timestamps);

            if (step.isRecovered) {
              recoveredEventsCount++;
            }

            if (step.nextState === 'TP1_HIT' || step.nextState === 'TP2_HIT' || step.nextState === 'TP3_HIT') {
              tpHitCount++;
            } else if (step.nextState === 'SL_HIT') {
              slHitCount++;
            } else if (step.nextState === 'AMBIGUOUS') {
              ambiguousCount++;
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
        ambiguousCount,
        recoveredEventsCount,
      };
    } catch (err) {
      logger.error('[SignalLifecycle] Error evaluating active signals lifecycle:', { error: String(err) });
      return {
        evaluatedCount: 0,
        tpHitCount,
        slHitCount,
        expiredCount,
        invalidatedCount,
        ambiguousCount,
        recoveredEventsCount,
      };
    } finally {
      this.isEvaluating = false;
    }
  }

  /**
   * Explicit method to backfill historical outcomes across all active signals.
   */
  static async backfillHistoricalOutcomesForActiveSignals(): Promise<SignalEvaluationSummary> {
    logger.info('[SignalLifecycle] Triggering explicit Historical Outcome Backfill across active signals...');
    return await this.evaluateActiveSignals();
  }

  /**
   * Retrieves comprehensive historical candles for an asset from `sinceTimestamp` through `now`.
   * Tries `1m` first (up to 1000 bars). If `sinceTimestamp` precedes the 1m window, fetches `5m` or `15m`
   * candles to ensure complete historical coverage.
   */
  private static async fetchHistoricalCandlesForSignal(
    symbol: string,
    provider: string,
    sinceTimestamp: number
  ): Promise<NormalizedCandle[]> {
    const candlesMap = new Map<number, NormalizedCandle>();

    try {
      // 1. Fetch 1m granular candles
      const m1Candles = await marketDataManager.getCandles(symbol, provider, '1m', 1000);
      if (Array.isArray(m1Candles)) {
        for (const c of m1Candles) {
          if (c && c.timestamp >= sinceTimestamp) {
            candlesMap.set(c.timestamp, c);
          }
        }
      }

      // Check if we need older data to cover from sinceTimestamp
      const earliestM1 = m1Candles && m1Candles.length > 0
        ? Math.min(...m1Candles.map((c) => c.timestamp))
        : Date.now();

      if (sinceTimestamp < earliestM1) {
        // 2. Fetch 5m candles for broader coverage if signal is older
        try {
          const m5Candles = await marketDataManager.getCandles(symbol, provider, '5m', 1000);
          if (Array.isArray(m5Candles)) {
            for (const c of m5Candles) {
              if (c && c.timestamp >= sinceTimestamp && c.timestamp < earliestM1) {
                candlesMap.set(c.timestamp, c);
              }
            }
          }
        } catch (err) {
          logger.debug(`[SignalLifecycle] 5m candle fetch deferred for ${symbol}:`, { error: String(err) });
        }
      }
    } catch (err) {
      logger.warn(`[SignalLifecycle] Candle history fetch failed for ${symbol} from ${provider}:`, { error: String(err) });
    }

    return Array.from(candlesMap.values()).sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Chronologically evaluates historical candles for TP1, TP2, TP3, SL, or AMBIGUOUS events.
   */
  private static evaluateCandleHistory(
    sig: PersistedSentSignal,
    candles: NormalizedCandle[],
    timestamps: {
      tp1HitTimestamp?: number;
      tp2HitTimestamp?: number;
      tp3HitTimestamp?: number;
      slHitTimestamp?: number;
    }
  ): {
    finalState: PersistedSentSignal['status'];
    transitions: ProgressiveTransitionStep[];
  } {
    let currentState: PersistedSentSignal['status'] = sig.status;
    const transitions: ProgressiveTransitionStep[] = [];

    if (currentState !== 'ACTIVE' && currentState !== 'TP1_HIT' && currentState !== 'TP2_HIT') {
      return { finalState: currentState, transitions: [] };
    }

    const isBuy = sig.direction === 'BUY';
    const entry = sig.entryPrice;
    const sl = sig.stopLoss;
    const tp1 = sig.tp1 ?? sig.takeProfit;
    const tp2 = sig.tp2 ?? sig.takeProfit;
    const tp3 = sig.tp3 ?? sig.takeProfit;

    for (const candle of candles) {
      if (currentState === 'SL_HIT' || currentState === 'TP3_HIT' || currentState === 'AMBIGUOUS') {
        break;
      }

      const high = candle.high;
      const low = candle.low;
      const open = candle.open;
      const time = candle.timestamp;
      const timeframe = candle.timeframe || '1m';

      // 1. Entry Detection
      if (!timestamps.entryHitTimestamp) {
        if ((low <= entry && high >= entry)) {
          timestamps.entryHitTimestamp = time;
          transitions.push({
            nextState: 'ACTIVE',
            eventTime: time,
            eventSource: 'HISTORICAL_BACKFILL',
            timeframeUsed: timeframe,
            isRecovered: true,
          });
        }
      }

      if (isBuy) {
        // Next target price needed for BUY
        const nextTp =
          currentState === 'ACTIVE' ? tp1 :
          currentState === 'TP1_HIT' ? tp2 :
          tp3;

        const touchesTp = high >= nextTp;
        const touchesSl = low <= sl;

        // Intra-candle conflict check
        if (touchesTp && touchesSl) {
          // Check if open establishes order without ambiguity
          if (open >= nextTp) {
            // Opened above TP, TP was reached before SL
            currentState = this.recordBuyTpHit(currentState, high, tp1, tp2, tp3, time, timeframe, transitions, timestamps);
          } else if (open <= sl) {
            // Opened below SL, SL was reached first
            currentState = 'SL_HIT';
            timestamps.slHitTimestamp = timestamps.slHitTimestamp || time;
            transitions.push({
              nextState: 'SL_HIT',
              eventTime: time,
              eventSource: 'HISTORICAL_BACKFILL',
              timeframeUsed: timeframe,
              isRecovered: true,
            });
            break;
          } else {
            // Both breached within the candle, order cannot be determined reliably
            currentState = 'AMBIGUOUS';
            transitions.push({
              nextState: 'AMBIGUOUS',
              eventTime: time,
              eventSource: 'HISTORICAL_BACKFILL',
              timeframeUsed: timeframe,
              isRecovered: true,
              ambiguousDetails: `Both TP level (${nextTp}) and Stop Loss (${sl}) touched inside candle at ${time} (${timeframe} bar: open=${open}, high=${high}, low=${low}, close=${candle.close})`,
            });
            break;
          }
        } else if (touchesSl) {
          // Stop Loss hit
          currentState = 'SL_HIT';
          timestamps.slHitTimestamp = timestamps.slHitTimestamp || time;
          transitions.push({
            nextState: 'SL_HIT',
            eventTime: time,
            eventSource: 'HISTORICAL_BACKFILL',
            timeframeUsed: timeframe,
            isRecovered: true,
          });
          break;
        } else if (touchesTp) {
          // Take Profit hit
          currentState = this.recordBuyTpHit(currentState, high, tp1, tp2, tp3, time, timeframe, transitions, timestamps);
        }
      } else {
        // SELL
        const nextTp =
          currentState === 'ACTIVE' ? tp1 :
          currentState === 'TP1_HIT' ? tp2 :
          tp3;

        const touchesTp = low <= nextTp;
        const touchesSl = high >= sl;

        // Intra-candle conflict check
        if (touchesTp && touchesSl) {
          if (open <= nextTp) {
            // Opened below TP, TP reached first
            currentState = this.recordSellTpHit(currentState, low, tp1, tp2, tp3, time, timeframe, transitions, timestamps);
          } else if (open >= sl) {
            // Opened above SL, SL reached first
            currentState = 'SL_HIT';
            timestamps.slHitTimestamp = timestamps.slHitTimestamp || time;
            transitions.push({
              nextState: 'SL_HIT',
              eventTime: time,
              eventSource: 'HISTORICAL_BACKFILL',
              timeframeUsed: timeframe,
              isRecovered: true,
            });
            break;
          } else {
            // Both breached within the candle, order cannot be determined reliably
            currentState = 'AMBIGUOUS';
            transitions.push({
              nextState: 'AMBIGUOUS',
              eventTime: time,
              eventSource: 'HISTORICAL_BACKFILL',
              timeframeUsed: timeframe,
              isRecovered: true,
              ambiguousDetails: `Both TP level (${nextTp}) and Stop Loss (${sl}) touched inside candle at ${time} (${timeframe} bar: open=${open}, high=${high}, low=${low}, close=${candle.close})`,
            });
            break;
          }
        } else if (touchesSl) {
          // Stop Loss hit
          currentState = 'SL_HIT';
          timestamps.slHitTimestamp = timestamps.slHitTimestamp || time;
          transitions.push({
            nextState: 'SL_HIT',
            eventTime: time,
            eventSource: 'HISTORICAL_BACKFILL',
            timeframeUsed: timeframe,
            isRecovered: true,
          });
          break;
        } else if (touchesTp) {
          // Take Profit hit
          currentState = this.recordSellTpHit(currentState, low, tp1, tp2, tp3, time, timeframe, transitions, timestamps);
        }
      }
    }

    return { finalState: currentState, transitions };
  }

  private static recordBuyTpHit(
    currentState: PersistedSentSignal['status'],
    high: number,
    tp1: number,
    tp2: number,
    tp3: number,
    time: number,
    timeframe: string,
    transitions: ProgressiveTransitionStep[],
    timestamps: { tp1HitTimestamp?: number; tp2HitTimestamp?: number; tp3HitTimestamp?: number }
  ): PersistedSentSignal['status'] {
    let state = currentState;

    if (state === 'ACTIVE' && high >= tp1) {
      state = 'TP1_HIT';
      timestamps.tp1HitTimestamp = timestamps.tp1HitTimestamp || time;
      transitions.push({
        nextState: 'TP1_HIT',
        eventTime: time,
        eventSource: 'HISTORICAL_BACKFILL',
        timeframeUsed: timeframe,
        isRecovered: true,
      });
    }

    if (state === 'TP1_HIT' && high >= tp2) {
      state = 'TP2_HIT';
      timestamps.tp2HitTimestamp = timestamps.tp2HitTimestamp || time;
      transitions.push({
        nextState: 'TP2_HIT',
        eventTime: time,
        eventSource: 'HISTORICAL_BACKFILL',
        timeframeUsed: timeframe,
        isRecovered: true,
      });
    }

    if (state === 'TP2_HIT' && high >= tp3) {
      state = 'TP3_HIT';
      timestamps.tp3HitTimestamp = timestamps.tp3HitTimestamp || time;
      transitions.push({
        nextState: 'TP3_HIT',
        eventTime: time,
        eventSource: 'HISTORICAL_BACKFILL',
        timeframeUsed: timeframe,
        isRecovered: true,
      });
    }

    return state;
  }

  private static recordSellTpHit(
    currentState: PersistedSentSignal['status'],
    low: number,
    tp1: number,
    tp2: number,
    tp3: number,
    time: number,
    timeframe: string,
    transitions: ProgressiveTransitionStep[],
    timestamps: { tp1HitTimestamp?: number; tp2HitTimestamp?: number; tp3HitTimestamp?: number }
  ): PersistedSentSignal['status'] {
    let state = currentState;

    if (state === 'ACTIVE' && low <= tp1) {
      state = 'TP1_HIT';
      timestamps.tp1HitTimestamp = timestamps.tp1HitTimestamp || time;
      transitions.push({
        nextState: 'TP1_HIT',
        eventTime: time,
        eventSource: 'HISTORICAL_BACKFILL',
        timeframeUsed: timeframe,
        isRecovered: true,
      });
    }

    if (state === 'TP1_HIT' && low <= tp2) {
      state = 'TP2_HIT';
      timestamps.tp2HitTimestamp = timestamps.tp2HitTimestamp || time;
      transitions.push({
        nextState: 'TP2_HIT',
        eventTime: time,
        eventSource: 'HISTORICAL_BACKFILL',
        timeframeUsed: timeframe,
        isRecovered: true,
      });
    }

    if (state === 'TP2_HIT' && low <= tp3) {
      state = 'TP3_HIT';
      timestamps.tp3HitTimestamp = timestamps.tp3HitTimestamp || time;
      transitions.push({
        nextState: 'TP3_HIT',
        eventTime: time,
        eventSource: 'HISTORICAL_BACKFILL',
        timeframeUsed: timeframe,
        isRecovered: true,
      });
    }

    return state;
  }

  /**
   * Evaluates latest real-time quote for non-terminal signals.
   */
  private static evaluateLiveTicker(
    sig: PersistedSentSignal,
    currentState: PersistedSentSignal['status'],
    ticker: NormalizedTicker,
    timestamps: {
      tp1HitTimestamp?: number;
      tp2HitTimestamp?: number;
      tp3HitTimestamp?: number;
      slHitTimestamp?: number;
    }
  ): {
    finalState: PersistedSentSignal['status'];
    transitions: ProgressiveTransitionStep[];
  } {
    let state = currentState;
    const transitions: ProgressiveTransitionStep[] = [];
    const price = ticker.price;
    const time = ticker.timestamp || Date.now();
    const isBuy = sig.direction === 'BUY';
    const sl = sig.stopLoss;
    const tp1 = sig.tp1 ?? sig.takeProfit;
    const tp2 = sig.tp2 ?? sig.takeProfit;
    const tp3 = sig.tp3 ?? sig.takeProfit;

    if (isBuy) {
      if (price <= sl) {
        state = 'SL_HIT';
        timestamps.slHitTimestamp = timestamps.slHitTimestamp || time;
        transitions.push({
          nextState: 'SL_HIT',
          eventTime: time,
          eventSource: 'LIVE_STREAM',
          timeframeUsed: 'tick',
          isRecovered: false,
        });
      } else {
        if (state === 'ACTIVE' && price >= tp1) {
          state = 'TP1_HIT';
          timestamps.tp1HitTimestamp = timestamps.tp1HitTimestamp || time;
          transitions.push({
            nextState: 'TP1_HIT',
            eventTime: time,
            eventSource: 'LIVE_STREAM',
            timeframeUsed: 'tick',
            isRecovered: false,
          });
        }
        if (state === 'TP1_HIT' && price >= tp2) {
          state = 'TP2_HIT';
          timestamps.tp2HitTimestamp = timestamps.tp2HitTimestamp || time;
          transitions.push({
            nextState: 'TP2_HIT',
            eventTime: time,
            eventSource: 'LIVE_STREAM',
            timeframeUsed: 'tick',
            isRecovered: false,
          });
        }
        if (state === 'TP2_HIT' && price >= tp3) {
          state = 'TP3_HIT';
          timestamps.tp3HitTimestamp = timestamps.tp3HitTimestamp || time;
          transitions.push({
            nextState: 'TP3_HIT',
            eventTime: time,
            eventSource: 'LIVE_STREAM',
            timeframeUsed: 'tick',
            isRecovered: false,
          });
        }
      }
    } else {
      if (price >= sl) {
        state = 'SL_HIT';
        timestamps.slHitTimestamp = timestamps.slHitTimestamp || time;
        transitions.push({
          nextState: 'SL_HIT',
          eventTime: time,
          eventSource: 'LIVE_STREAM',
          timeframeUsed: 'tick',
          isRecovered: false,
        });
      } else {
        if (state === 'ACTIVE' && price <= tp1) {
          state = 'TP1_HIT';
          timestamps.tp1HitTimestamp = timestamps.tp1HitTimestamp || time;
          transitions.push({
            nextState: 'TP1_HIT',
            eventTime: time,
            eventSource: 'LIVE_STREAM',
            timeframeUsed: 'tick',
            isRecovered: false,
          });
        }
        if (state === 'TP1_HIT' && price <= tp2) {
          state = 'TP2_HIT';
          timestamps.tp2HitTimestamp = timestamps.tp2HitTimestamp || time;
          transitions.push({
            nextState: 'TP2_HIT',
            eventTime: time,
            eventSource: 'LIVE_STREAM',
            timeframeUsed: 'tick',
            isRecovered: false,
          });
        }
        if (state === 'TP2_HIT' && price <= tp3) {
          state = 'TP3_HIT';
          timestamps.tp3HitTimestamp = timestamps.tp3HitTimestamp || time;
          transitions.push({
            nextState: 'TP3_HIT',
            eventTime: time,
            eventSource: 'LIVE_STREAM',
            timeframeUsed: 'tick',
            isRecovered: false,
          });
        }
      }
    }

    return { finalState: state, transitions };
  }

  /**
   * Performs a single progressive state transition with full persistence, outcome logging,
   * idempotent notification dispatch, and performance intelligence metric recording.
   */
  private static async transitionSignalProgressive(
    sig: PersistedSentSignal,
    step: ProgressiveTransitionStep,
    timestamps: {
      tp1HitTimestamp?: number;
      tp2HitTimestamp?: number;
      tp3HitTimestamp?: number;
      slHitTimestamp?: number;
      expiredTimestamp?: number;
    }
  ): Promise<void> {
    const now = Date.now();
    const nextState = step.nextState;

    // Track notified states to guarantee strict idempotency (Requirement 12)
    const currentNotified = new Set<string>(sig.notifiedStates || []);
    const settings = ScannerPersistence.getSettings();

    // 1. Send notification ONLY ONCE per milestone (Requirement 12 & 13)
    if (settings.notificationsEnabled && !currentNotified.has(nextState)) {
      let type: 'BEST_TRADE' | 'HIGH_QUALITY' | 'NO_TRADE' | 'SETUP_UPDATE' = 'SETUP_UPDATE';
      let title = '';
      let message = '';
      const eventTimeStr = new Date(step.eventTime).toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
      const recoveryTag = step.isRecovered ? ' (Recovered / Historical)' : '';

      if (nextState === 'TP1_HIT') {
        type = 'SETUP_UPDATE';
        title = `${sig.symbol} [${sig.direction}] - TP1 HIT${recoveryTag} ✅`;
        const tpVal = sig.tp1 ?? sig.takeProfit;
        message = step.isRecovered
          ? `Historically confirmed Conservative Take-Profit level reached for ${sig.symbol} at ${tpVal} (Event Time: ${eventTimeStr} UTC, Source: Historical Backfill, Timeframe: ${step.timeframeUsed}).`
          : `Conservative Take-Profit level reached for ${sig.symbol} at ${tpVal}.`;
      } else if (nextState === 'TP2_HIT') {
        type = 'HIGH_QUALITY';
        title = `${sig.symbol} [${sig.direction}] - TP2 HIT${recoveryTag} ✅`;
        const tpVal = sig.tp2 ?? sig.takeProfit;
        message = step.isRecovered
          ? `Historically confirmed Main Take-Profit target achieved for ${sig.symbol} at ${tpVal} (Event Time: ${eventTimeStr} UTC, Source: Historical Backfill, Timeframe: ${step.timeframeUsed}).`
          : `Main Take-Profit target achieved for ${sig.symbol} at ${tpVal}.`;
      } else if (nextState === 'TP3_HIT') {
        type = 'BEST_TRADE';
        title = `${sig.symbol} [${sig.direction}] - TP3 HIT 🏆 FULL TARGET${recoveryTag}`;
        const tpVal = sig.tp3 ?? sig.takeProfit;
        message = step.isRecovered
          ? `Historically confirmed Extended Take-Profit reached for ${sig.symbol} at ${tpVal} (Event Time: ${eventTimeStr} UTC, Source: Historical Backfill, Timeframe: ${step.timeframeUsed}).`
          : `Extended Take-Profit reached! ${sig.symbol} fully completed target at ${tpVal}.`;
      } else if (nextState === 'SL_HIT') {
        type = 'NO_TRADE';
        title = `${sig.symbol} [${sig.direction}] - STOP LOSS HIT${recoveryTag} ❌`;
        message = step.isRecovered
          ? `Historically confirmed Stop Loss triggered for ${sig.symbol} at ${sig.stopLoss} (Event Time: ${eventTimeStr} UTC, Source: Historical Backfill, Timeframe: ${step.timeframeUsed}).`
          : `Stop-loss triggered for ${sig.symbol} at ${sig.stopLoss}.`;
      } else if (nextState === 'AMBIGUOUS') {
        type = 'SETUP_UPDATE';
        title = `${sig.symbol} [${sig.direction}] - OUTCOME AMBIGUOUS ⚠️`;
        message = `Both Target and Stop Loss were breached inside the same candle (${step.timeframeUsed} timeframe). Event recorded as AMBIGUOUS without guessing.`;
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

        currentNotified.add(nextState);
        sig.notifiedStates = Array.from(currentNotified);
      }
    }

    // 2. Update scanner persistence status & rich historical metadata (single call)
    await ScannerPersistence.updateSignalStatus(sig.id, nextState, {
      tp1HitTimestamp: timestamps.tp1HitTimestamp,
      tp2HitTimestamp: timestamps.tp2HitTimestamp,
      tp3HitTimestamp: timestamps.tp3HitTimestamp,
      slHitTimestamp: timestamps.slHitTimestamp,
      detectedAt: now,
      eventTime: step.eventTime,
      eventSource: step.eventSource,
      timeframeUsed: step.timeframeUsed,
      isRecovered: step.isRecovered,
      ambiguousDetails: step.ambiguousDetails,
      notifiedStates: Array.from(currentNotified),
    });

    // 3. Update dedicated Signal Logger status
    const logStatusMapping: SignalLogStatus =
      nextState === 'TP1_HIT' ? 'TP1 HIT' :
      nextState === 'TP2_HIT' ? 'TP2 HIT' :
      nextState === 'TP3_HIT' ? 'TP3 HIT' :
      nextState === 'SL_HIT' ? 'SL HIT' :
      nextState === 'AMBIGUOUS' ? 'AMBIGUOUS' :
      nextState === 'EXPIRED' ? 'EXPIRED' : 'ACTIVE';
    await SignalLogger.updateStatus(sig.id, logStatusMapping);

    // 4. Write separate Signal Outcome Log (Requirement 14 & 15)
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
      detectedAt: now,
      eventTime: step.eventTime,
      eventSource: step.eventSource,
      timeframeUsed: step.timeframeUsed,
      isRecovered: step.isRecovered,
      ambiguousDetails: step.ambiguousDetails,
    };
    await SignalOutcomeLogger.recordOutcome(outcomeRecord);

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
        resolvedAt: step.eventTime,
        durationMs: Math.max(0, step.eventTime - sig.timestamp),
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
