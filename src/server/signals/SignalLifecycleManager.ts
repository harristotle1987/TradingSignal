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

import { NormalizedTicker, NormalizedCandle, ExecutionEvidenceState, HistoricalEntryPolicy } from '../../types/index.js';
import { getDynamicPrecision } from '../../utils/formatters.js';
import { marketDataManager } from '../market/MarketDataManager.js';
import { ScannerPersistence, PersistedSentSignal } from './ScannerPersistence.js';
import { StrategyPerformanceTracker } from './StrategyPerformanceTracker.js';
import { serverConfig, TP1_ALLOCATION, TP2_ALLOCATION, TP3_ALLOCATION, HISTORICAL_ENTRY_POLICY } from '../config.js';
import { SignalLogger, SignalLogStatus } from './SignalLogger.js';
import { SignalOutcomeLogger, SignalOutcomeRecord } from './SignalOutcomeLogger.js';
import { Gate29ExecutableEntryValidation } from './Gate29ExecutableEntryValidation.js';
import { MarketRegime } from './StrategyEngine.js';
import { logger } from '../logger.js';

export function normalizeSymbol(symbol: string): string {
  if (!symbol) return '';
  return symbol.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

export function validatePrice(price: unknown, symbol: string): boolean {
  if (
    price === null ||
    price === undefined ||
    typeof price !== 'number' ||
    Number.isNaN(price) ||
    !Number.isFinite(price) ||
    price <= 0
  ) {
    logger.warn(`[TP/SL Monitor] Invalid price update rejected for symbol=${symbol}: ${price}`);
    return false;
  }
  return true;
}

export type SignalLifecycleState =
  | 'GENERATED'
  | 'ACTIVE'
  | 'TP_HIT'
  | 'TP1_HIT'
  | 'TP2_HIT'
  | 'TP3_HIT'
  | 'SL_HIT'
  | 'STOPPED_OUT'
  | 'COMPLETED'
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

export interface PriceEvaluationResult {
  symbol: string;
  previousStatus: PersistedSentSignal['status'];
  newStatus: PersistedSentSignal['status'];
  tp1Status: 'PENDING' | 'HIT';
  tp2Status: 'PENDING' | 'HIT';
  tp3Status: 'PENDING' | 'HIT';
  slStatus: 'ACTIVE' | 'HIT' | 'ACTIVE_FOR_ENTRY_ONLY';
  entryHitTimestamp?: string;
  displayPrice?: number;
  bid?: number;
  ask?: number;
  executionSide?: 'ASK' | 'BID';
  executionPrice?: number;
  spread?: number;
  entryTriggerTimestamp?: string;
  executionEvidence?: ExecutionEvidenceState;
  historicalEntryPolicy?: HistoricalEntryPolicy;
  tp1HitAt?: string;
  tp2HitAt?: string;
  tp3HitAt?: string;
  stopLossHitAt?: string;
  tp1HitPrice?: number;
  tp2HitPrice?: number;
  tp3HitPrice?: number;
  stopLossHitPrice?: number;
  transitions: ProgressiveTransitionStep[];
}

export class SignalLifecycleManager {
  private static isEvaluating = false;

  /**
   * Evaluates a single verified market price update for a signal against its entry, SL, TP1, TP2, and TP3 targets.
   * Handles multi-target gaps in a single price update, exact hit timestamps (ISO 8601 UTC), actual hit prices,
   * idempotency (never overwrites confirmed hits or hit prices), and diagnostic logging.
   */
  public static evaluateSignalPriceUpdate(
    sig: PersistedSentSignal,
    price: number,
    timestampMs: number = Date.now(),
    updateSymbol?: string,
    quoteDetails?: { bid?: number | null; ask?: number | null; high?: number | null; low?: number | null; isHistoricalCandle?: boolean; source?: string }
  ): PriceEvaluationResult {
    const symbol = sig.symbol;

    // Dynamically guarantee 3-tier target structure for legacy signals
    if (sig.tp1 === undefined || sig.tp2 === undefined || sig.tp3 === undefined) {
      const entry = sig.entryPrice;
      const finalTp = sig.takeProfit;
      const diff = finalTp - entry;
      const dec = getDynamicPrecision(finalTp, symbol);

      sig.tp1 = sig.tp1 ?? Number((entry + diff * 0.33).toFixed(dec));
      sig.tp2 = sig.tp2 ?? Number((entry + diff * 0.66).toFixed(dec));
      sig.tp3 = sig.tp3 ?? finalTp;

      sig.tp1Status = sig.tp1Status || 'PENDING';
      sig.tp2Status = sig.tp2Status || 'PENDING';
      sig.tp3Status = sig.tp3Status || 'PENDING';
      sig.slStatus = sig.slStatus || 'ACTIVE';
    }

    if (updateSymbol && normalizeSymbol(updateSymbol) !== normalizeSymbol(symbol)) {
      logger.warn(`[TP/SL Monitor] Mismatched symbol rejected for signal=${symbol} vs updateSymbol=${updateSymbol}`);
      return {
        symbol,
        previousStatus: sig.status,
        newStatus: sig.status,
        tp1Status: sig.tp1Status || (sig.status === 'TP1_HIT' || sig.status === 'TP2_HIT' || sig.status === 'TP3_HIT' || sig.status === 'COMPLETED' ? 'HIT' : 'PENDING'),
        tp2Status: sig.tp2Status || (sig.status === 'TP2_HIT' || sig.status === 'TP3_HIT' || sig.status === 'COMPLETED' ? 'HIT' : 'PENDING'),
        tp3Status: sig.tp3Status || (sig.status === 'TP3_HIT' || sig.status === 'COMPLETED' ? 'HIT' : 'PENDING'),
        slStatus: sig.slStatus || (sig.status === 'SL_HIT' || sig.status === 'STOPPED_OUT' ? 'HIT' : 'ACTIVE'),
        tp1HitAt: sig.tp1HitAt,
        tp2HitAt: sig.tp2HitAt,
        tp3HitAt: sig.tp3HitAt,
        stopLossHitAt: sig.stopLossHitAt,
        tp1HitPrice: sig.tp1HitPrice,
        tp2HitPrice: sig.tp2HitPrice,
        tp3HitPrice: sig.tp3HitPrice,
        stopLossHitPrice: sig.stopLossHitPrice,
        transitions: [],
      };
    }

    if (!validatePrice(price, symbol)) {
      return {
        symbol,
        previousStatus: sig.status,
        newStatus: sig.status,
        tp1Status: sig.tp1Status || (sig.status === 'TP1_HIT' || sig.status === 'TP2_HIT' || sig.status === 'TP3_HIT' || sig.status === 'COMPLETED' ? 'HIT' : 'PENDING'),
        tp2Status: sig.tp2Status || (sig.status === 'TP2_HIT' || sig.status === 'TP3_HIT' || sig.status === 'COMPLETED' ? 'HIT' : 'PENDING'),
        tp3Status: sig.tp3Status || (sig.status === 'TP3_HIT' || sig.status === 'COMPLETED' ? 'HIT' : 'PENDING'),
        slStatus: sig.slStatus || (sig.status === 'SL_HIT' || sig.status === 'STOPPED_OUT' ? 'HIT' : 'ACTIVE'),
        tp1HitAt: sig.tp1HitAt,
        tp2HitAt: sig.tp2HitAt,
        tp3HitAt: sig.tp3HitAt,
        stopLossHitAt: sig.stopLossHitAt,
        tp1HitPrice: sig.tp1HitPrice,
        tp2HitPrice: sig.tp2HitPrice,
        tp3HitPrice: sig.tp3HitPrice,
        stopLossHitPrice: sig.stopLossHitPrice,
        transitions: [],
      };
    }

    const transitions: ProgressiveTransitionStep[] = [];
    const hitAtIso = new Date(timestampMs).toISOString();
    const EPSILON = 1e-8;

    let currentStatus = sig.status;
    let entryHitTimestamp = sig.entryHitTimestamp ?? undefined;

    const statusStr = currentStatus as string;
    const isUnconfirmedEntry = currentStatus === 'WAITING_ENTRY' && !entryHitTimestamp;
    let tp1Status: 'PENDING' | 'HIT' = isUnconfirmedEntry ? 'PENDING' : (sig.tp1Status || (statusStr === 'TP1_HIT' || statusStr === 'TP2_HIT' || statusStr === 'TP3_HIT' || statusStr === 'COMPLETED' ? 'HIT' : 'PENDING'));
    let tp2Status: 'PENDING' | 'HIT' = isUnconfirmedEntry ? 'PENDING' : (sig.tp2Status || (statusStr === 'TP2_HIT' || statusStr === 'TP3_HIT' || statusStr === 'COMPLETED' ? 'HIT' : 'PENDING'));
    let tp3Status: 'PENDING' | 'HIT' = isUnconfirmedEntry ? 'PENDING' : (sig.tp3Status || (statusStr === 'TP3_HIT' || statusStr === 'COMPLETED' ? 'HIT' : 'PENDING'));
    let slStatus: 'ACTIVE' | 'HIT' | 'ACTIVE_FOR_ENTRY_ONLY' = isUnconfirmedEntry ? 'ACTIVE_FOR_ENTRY_ONLY' : (sig.slStatus === 'ACTIVE_FOR_ENTRY_ONLY' ? 'ACTIVE' : (sig.slStatus || (statusStr === 'SL_HIT' || statusStr === 'STOPPED_OUT' ? 'HIT' : 'ACTIVE')));

    let tp1HitAt = sig.tp1HitAt;
    let tp2HitAt = sig.tp2HitAt;
    let tp3HitAt = sig.tp3HitAt;
    let stopLossHitAt = sig.stopLossHitAt;

    let tp1HitPrice = sig.tp1HitPrice;
    let tp2HitPrice = sig.tp2HitPrice;
    let tp3HitPrice = sig.tp3HitPrice;
    let stopLossHitPrice = sig.stopLossHitPrice;

    let displayPrice = sig.displayPrice;
    let bid = sig.bid;
    let ask = sig.ask;
    let executionSide = sig.executionSide;
    let executionPrice = sig.executionPrice;
    let spread = sig.spread;
    let entryTriggerTimestamp = sig.entryTriggerTimestamp;

    if (currentStatus === 'WAITING_ENTRY') {
      const validationRes = Gate29ExecutableEntryValidation.validateEntry(
        sig.direction,
        sig.entryPrice,
        {
          price,
          bid: quoteDetails?.bid,
          ask: quoteDetails?.ask,
          high: quoteDetails?.high,
          low: quoteDetails?.low,
          isHistoricalCandle: quoteDetails?.isHistoricalCandle,
          source: (quoteDetails?.source as any) || 'LIVE',
          timestamp: timestampMs,
          policy: sig.historicalEntryPolicy,
        },
        timestampMs
      );

      sig.executionEvidence = validationRes.executionEvidence;
      sig.historicalEntryPolicy = validationRes.policyUsed;

      if (validationRes.isEntryConfirmed) {
        currentStatus = 'ACTIVE';
        slStatus = 'ACTIVE';
        displayPrice = validationRes.displayPrice;
        bid = validationRes.bid;
        ask = validationRes.ask;
        executionSide = validationRes.executionSide;
        executionPrice = validationRes.executionPrice;
        spread = validationRes.spread;
        entryTriggerTimestamp = validationRes.entryTriggerTimestamp;
        entryHitTimestamp = entryHitTimestamp || entryTriggerTimestamp || hitAtIso;

        sig.displayPrice = displayPrice;
        sig.bid = bid;
        sig.ask = ask;
        sig.executionSide = executionSide;
        sig.executionPrice = executionPrice;
        sig.spread = spread;
        sig.entryTriggerTimestamp = entryTriggerTimestamp;

        logger.info(`[ENTRY_CONFIRMED] symbol=${symbol} direction=${sig.direction} execSide=${executionSide} execPrice=${executionPrice} entryPrice=${sig.entryPrice} spread=${spread} evidence=${validationRes.executionEvidence} previousStatus=WAITING_ENTRY newStatus=ACTIVE timestamp=${entryHitTimestamp}`);

        transitions.push({
          nextState: 'ACTIVE',
          eventTime: timestampMs,
          eventSource: 'LIVE_STREAM',
          timeframeUsed: 'tick',
          isRecovered: false,
        });
      } else {
        // If entry is not confirmed yet, do not evaluate TP/SL
        return {
          symbol,
          previousStatus: sig.status,
          newStatus: currentStatus,
          tp1Status,
          tp2Status,
          tp3Status,
          slStatus,
          entryHitTimestamp,
          displayPrice: validationRes.displayPrice,
          bid: validationRes.bid,
          ask: validationRes.ask,
          executionSide: validationRes.executionSide,
          executionPrice: validationRes.executionPrice,
          spread: validationRes.spread,
          executionEvidence: validationRes.executionEvidence,
          historicalEntryPolicy: validationRes.policyUsed,
          entryTriggerTimestamp: undefined,
          tp1HitAt,
          tp2HitAt,
          tp3HitAt,
          stopLossHitAt,
          tp1HitPrice,
          tp2HitPrice,
          tp3HitPrice,
          stopLossHitPrice,
          transitions: [],
        };
      }
    }

    // If signal is in terminal state, do not process further updates
    if (
      currentStatus === 'STOPPED_OUT' ||
      currentStatus === 'SL_HIT' ||
      currentStatus === 'COMPLETED' ||
      currentStatus === 'TP3_HIT' ||
      currentStatus === 'EXPIRED' ||
      currentStatus === 'SUPERSEDED' ||
      currentStatus === 'AMBIGUOUS' ||
      currentStatus === 'REJECTED'
    ) {
      return {
        symbol,
        previousStatus: sig.status,
        newStatus: sig.status,
        tp1Status: sig.tp1Status || 'HIT',
        tp2Status: sig.tp2Status || 'HIT',
        tp3Status: sig.tp3Status || 'HIT',
        slStatus: sig.slStatus || 'HIT',
        tp1HitAt: sig.tp1HitAt,
        tp2HitAt: sig.tp2HitAt,
        tp3HitAt: sig.tp3HitAt,
        stopLossHitAt: sig.stopLossHitAt,
        tp1HitPrice: sig.tp1HitPrice,
        tp2HitPrice: sig.tp2HitPrice,
        tp3HitPrice: sig.tp3HitPrice,
        stopLossHitPrice: sig.stopLossHitPrice,
        transitions: [],
      };
    }

    const isBuy = sig.direction === 'BUY';
    const sl = sig.stopLoss;
    const tp1 = sig.tp1 ?? sig.takeProfit;
    const tp2 = sig.tp2 ?? sig.takeProfit;
    const tp3 = sig.tp3 ?? sig.takeProfit;

    if (isBuy) {
      // 1. Check Stop Loss
      if (slStatus !== 'HIT' && price <= sl + EPSILON) {
        const prevStatus = currentStatus;
        currentStatus = 'STOPPED_OUT';
        slStatus = 'HIT';
        stopLossHitAt = stopLossHitAt || hitAtIso;
        stopLossHitPrice = stopLossHitPrice ?? price;

        logger.info(`[SL_HIT] symbol=${symbol} direction=BUY currentPrice=${price} target=STOP_LOSS targetPrice=${sl} hitPrice=${price} previousStatus=${prevStatus} newStatus=STOPPED_OUT timestamp=${hitAtIso}`);

        transitions.push({
          nextState: 'SL_HIT',
          eventTime: timestampMs,
          eventSource: 'LIVE_STREAM',
          timeframeUsed: 'tick',
          isRecovered: false,
        });
      } else if (slStatus !== 'HIT') {
        // 2. Check TPs sequentially / multi-target gaps
        if (tp1Status !== 'HIT' && price >= tp1 - EPSILON) {
          const prevStatus = currentStatus;
          tp1Status = 'HIT';
          tp1HitAt = tp1HitAt || hitAtIso;
          tp1HitPrice = tp1HitPrice ?? price;
          currentStatus = 'TP1_HIT';

          logger.info(`[TP_HIT] symbol=${symbol} direction=BUY currentPrice=${price} target=TP1 targetPrice=${tp1} hitPrice=${price} previousStatus=${prevStatus} newStatus=TP1_HIT timestamp=${hitAtIso}`);

          transitions.push({
            nextState: 'TP1_HIT',
            eventTime: timestampMs,
            eventSource: 'LIVE_STREAM',
            timeframeUsed: 'tick',
            isRecovered: false,
          });
        }

        if (tp2Status !== 'HIT' && price >= tp2 - EPSILON) {
          const prevStatus = currentStatus;
          tp2Status = 'HIT';
          tp2HitAt = tp2HitAt || hitAtIso;
          tp2HitPrice = tp2HitPrice ?? price;
          currentStatus = 'TP2_HIT';

          logger.info(`[TP_HIT] symbol=${symbol} direction=BUY currentPrice=${price} target=TP2 targetPrice=${tp2} hitPrice=${price} previousStatus=${prevStatus} newStatus=TP2_HIT timestamp=${hitAtIso}`);

          transitions.push({
            nextState: 'TP2_HIT',
            eventTime: timestampMs,
            eventSource: 'LIVE_STREAM',
            timeframeUsed: 'tick',
            isRecovered: false,
          });
        }

        if (tp3Status !== 'HIT' && price >= tp3 - EPSILON) {
          const prevStatus = currentStatus;
          tp3Status = 'HIT';
          tp3HitAt = tp3HitAt || hitAtIso;
          tp3HitPrice = tp3HitPrice ?? price;
          currentStatus = 'COMPLETED';

          logger.info(`[TP_HIT] symbol=${symbol} direction=BUY currentPrice=${price} target=TP3 targetPrice=${tp3} hitPrice=${price} previousStatus=${prevStatus} newStatus=COMPLETED timestamp=${hitAtIso}`);

          transitions.push({
            nextState: 'TP3_HIT',
            eventTime: timestampMs,
            eventSource: 'LIVE_STREAM',
            timeframeUsed: 'tick',
            isRecovered: false,
          });
        }
      }
    } else {
      // SELL
      // 1. Check Stop Loss
      if (slStatus !== 'HIT' && price >= sl - EPSILON) {
        const prevStatus = currentStatus;
        currentStatus = 'STOPPED_OUT';
        slStatus = 'HIT';
        stopLossHitAt = stopLossHitAt || hitAtIso;
        stopLossHitPrice = stopLossHitPrice ?? price;

        logger.info(`[SL_HIT] symbol=${symbol} direction=SELL currentPrice=${price} target=STOP_LOSS targetPrice=${sl} hitPrice=${price} previousStatus=${prevStatus} newStatus=STOPPED_OUT timestamp=${hitAtIso}`);

        transitions.push({
          nextState: 'SL_HIT',
          eventTime: timestampMs,
          eventSource: 'LIVE_STREAM',
          timeframeUsed: 'tick',
          isRecovered: false,
        });
      } else if (slStatus !== 'HIT') {
        // 2. Check TPs
        if (tp1Status !== 'HIT' && price <= tp1 + EPSILON) {
          const prevStatus = currentStatus;
          tp1Status = 'HIT';
          tp1HitAt = tp1HitAt || hitAtIso;
          tp1HitPrice = tp1HitPrice ?? price;
          currentStatus = 'TP1_HIT';

          logger.info(`[TP_HIT] symbol=${symbol} direction=SELL currentPrice=${price} target=TP1 targetPrice=${tp1} hitPrice=${price} previousStatus=${prevStatus} newStatus=TP1_HIT timestamp=${hitAtIso}`);

          transitions.push({
            nextState: 'TP1_HIT',
            eventTime: timestampMs,
            eventSource: 'LIVE_STREAM',
            timeframeUsed: 'tick',
            isRecovered: false,
          });
        }

        if (tp2Status !== 'HIT' && price <= tp2 + EPSILON) {
          const prevStatus = currentStatus;
          tp2Status = 'HIT';
          tp2HitAt = tp2HitAt || hitAtIso;
          tp2HitPrice = tp2HitPrice ?? price;
          currentStatus = 'TP2_HIT';

          logger.info(`[TP_HIT] symbol=${symbol} direction=SELL currentPrice=${price} target=TP2 targetPrice=${tp2} hitPrice=${price} previousStatus=${prevStatus} newStatus=TP2_HIT timestamp=${hitAtIso}`);

          transitions.push({
            nextState: 'TP2_HIT',
            eventTime: timestampMs,
            eventSource: 'LIVE_STREAM',
            timeframeUsed: 'tick',
            isRecovered: false,
          });
        }

        if (tp3Status !== 'HIT' && price <= tp3 + EPSILON) {
          const prevStatus = currentStatus;
          tp3Status = 'HIT';
          tp3HitAt = tp3HitAt || hitAtIso;
          tp3HitPrice = tp3HitPrice ?? price;
          currentStatus = 'COMPLETED';

          logger.info(`[TP_HIT] symbol=${symbol} direction=SELL currentPrice=${price} target=TP3 targetPrice=${tp3} hitPrice=${price} previousStatus=${prevStatus} newStatus=COMPLETED timestamp=${hitAtIso}`);

          transitions.push({
            nextState: 'TP3_HIT',
            eventTime: timestampMs,
            eventSource: 'LIVE_STREAM',
            timeframeUsed: 'tick',
            isRecovered: false,
          });
        }
      }
    }

    return {
      symbol,
      previousStatus: sig.status,
      newStatus: currentStatus,
      tp1Status,
      tp2Status,
      tp3Status,
      slStatus,
      entryHitTimestamp,
      displayPrice,
      bid,
      ask,
      executionSide,
      executionPrice,
      spread,
      entryTriggerTimestamp,
      executionEvidence: sig.executionEvidence,
      historicalEntryPolicy: sig.historicalEntryPolicy,
      tp1HitAt,
      tp2HitAt,
      tp3HitAt,
      stopLossHitAt,
      tp1HitPrice,
      tp2HitPrice,
      tp3HitPrice,
      stopLossHitPrice,
      transitions,
    };
  }

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

        // Fetch comprehensive historical candles from `sig.timestamp` up to `now` using the same provider
        const candles = await this.fetchHistoricalCandlesForSignal(sig.symbol, providerName, sig.timestamp);

        // Load existing outcomes from persistent log if any to preserve already confirmed milestones
        const existingOutcome = await SignalOutcomeLogger.getOutcome(sig.id);
        const timestamps: {
          entryHitTimestamp?: string | null;
          displayPrice?: number;
          bid?: number;
          ask?: number;
          executionSide?: 'ASK' | 'BID';
          executionPrice?: number;
          spread?: number;
          entryTriggerTimestamp?: string | null;
          tp1HitTimestamp?: number;
          tp2HitTimestamp?: number;
          tp3HitTimestamp?: number;
          slHitTimestamp?: number;
          expiredTimestamp?: number;
          tp1Status?: 'PENDING' | 'HIT';
          tp2Status?: 'PENDING' | 'HIT';
          tp3Status?: 'PENDING' | 'HIT';
          slStatus?: 'ACTIVE' | 'HIT' | 'ACTIVE_FOR_ENTRY_ONLY';
          tp1HitAt?: string;
          tp2HitAt?: string;
          tp3HitAt?: string;
          stopLossHitAt?: string;
          tp1HitPrice?: number;
          tp2HitPrice?: number;
          tp3HitPrice?: number;
          stopLossHitPrice?: number;
        } = {
          entryHitTimestamp: sig.entryHitTimestamp ?? existingOutcome?.entryHitTimestamp,
          tp1HitTimestamp: sig.tp1HitTimestamp ?? existingOutcome?.tp1HitTimestamp,
          tp2HitTimestamp: sig.tp2HitTimestamp ?? existingOutcome?.tp2HitTimestamp,
          tp3HitTimestamp: sig.tp3HitTimestamp ?? existingOutcome?.tp3HitTimestamp,
          slHitTimestamp: sig.slHitTimestamp ?? existingOutcome?.slHitTimestamp,
          expiredTimestamp: existingOutcome?.expiredTimestamp,
          tp1Status: sig.tp1Status ?? existingOutcome?.tp1Status,
          tp2Status: sig.tp2Status ?? existingOutcome?.tp2Status,
          tp3Status: sig.tp3Status ?? existingOutcome?.tp3Status,
          slStatus: sig.slStatus ?? existingOutcome?.slStatus,
          tp1HitAt: sig.tp1HitAt ?? existingOutcome?.tp1HitAt,
          tp2HitAt: sig.tp2HitAt ?? existingOutcome?.tp2HitAt,
          tp3HitAt: sig.tp3HitAt ?? existingOutcome?.tp3HitAt,
          stopLossHitAt: sig.stopLossHitAt ?? existingOutcome?.stopLossHitAt,
          tp1HitPrice: sig.tp1HitPrice ?? existingOutcome?.tp1HitPrice,
          tp2HitPrice: sig.tp2HitPrice ?? existingOutcome?.tp2HitPrice,
          tp3HitPrice: sig.tp3HitPrice ?? existingOutcome?.tp3HitPrice,
          stopLossHitPrice: sig.stopLossHitPrice ?? existingOutcome?.stopLossHitPrice,
        };

        // Chronological traversal of candle history
        const historicalResult = this.evaluateCandleHistory(sig, candles, timestamps);
        let currentState = historicalResult.finalState;
        const queuedTransitions = [...historicalResult.transitions];

        // If candle scan did not resolve a terminal state, evaluate latest real-time quote
        if (currentState !== 'SL_HIT' && currentState !== 'STOPPED_OUT' && currentState !== 'TP3_HIT' && currentState !== 'COMPLETED' && currentState !== 'AMBIGUOUS') {
          let liveTicker: NormalizedTicker | null = null;
          try {
            liveTicker = await marketDataManager.getPrice(sig.symbol, providerName, true);
          } catch (err) {
            logger.debug(`[SignalLifecycle] Live quote lookup failed for ${sig.symbol} from ${providerName}:`, { error: String(err) });
          }

          if (liveTicker && liveTicker.price > 0 && validatePrice(liveTicker.price, sig.symbol)) {
            const providerMismatch = (liveTicker.provider || '').toLowerCase() !== (providerName || '').toLowerCase();
            const isStale = (now - liveTicker.receivedAt > 15 * 60 * 1000) || (now - liveTicker.timestamp > 30 * 60 * 1000) || liveTicker.status !== 'OK';

            if (!providerMismatch && !isStale) {
              const liveResult = this.evaluateLiveTicker(sig, currentState, liveTicker, timestamps);
              currentState = liveResult.finalState;
              queuedTransitions.push(...liveResult.transitions);
            }
          }
        }

        // Check TTL Expiration - ONLY if not yet entry triggered or progressed
        const ageMs = now - sig.timestamp;
        const maxTtlMs = serverConfig.getConfig().signalExpirationMs;
        const hasQueuedProgress = queuedTransitions.length > 0;
        const isEntryTriggered = Boolean(timestamps.entryHitTimestamp);
        const isProgressedState = currentState === 'ACTIVE' || currentState === 'TP1_HIT' || currentState === 'TP2_HIT' || currentState === 'TP3_HIT' || currentState === 'SL_HIT' || currentState === 'STOPPED_OUT' || currentState === 'COMPLETED';

        if (ageMs >= maxTtlMs && !isEntryTriggered && !hasQueuedProgress && !isProgressedState) {
          logger.info(`[SignalLifecycle] Signal ${sig.id} (${sig.symbol}) reached TTL expiration (${(ageMs / 3600000).toFixed(1)}h) without entry trigger.`);
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

        // Execute all queued progressive transitions in strict chronological order
        if (queuedTransitions.length > 0) {
          for (const step of queuedTransitions) {
            logger.info(`[SignalLifecycle] Executing transition for ${sig.symbol} [${sig.direction}] -> ${step.nextState} (Source: ${step.eventSource}, Time: ${new Date(step.eventTime).toISOString()})`);
            await this.transitionSignalProgressive(sig, step, timestamps);

            if (step.isRecovered) {
              recoveredEventsCount++;
            }

            const stepStateStr = step.nextState as string;
            if (stepStateStr === 'TP1_HIT' || stepStateStr === 'TP2_HIT' || stepStateStr === 'TP3_HIT' || stepStateStr === 'COMPLETED') {
              tpHitCount++;
            } else if (stepStateStr === 'SL_HIT' || stepStateStr === 'STOPPED_OUT') {
              slHitCount++;
            } else if (stepStateStr === 'AMBIGUOUS') {
              ambiguousCount++;
            }
          }
        } else {
          // Persist updated quote metadata and execution evidence even if status remained unchanged
          if (timestamps.displayPrice !== undefined || (timestamps as any).executionEvidence !== undefined) {
            await ScannerPersistence.updateSignalStatus(sig.id, sig.status, {
              displayPrice: timestamps.displayPrice,
              bid: timestamps.bid,
              ask: timestamps.ask,
              executionSide: timestamps.executionSide,
              executionPrice: timestamps.executionPrice,
              spread: timestamps.spread,
              executionEvidence: (timestamps as any).executionEvidence || sig.executionEvidence,
              historicalEntryPolicy: (timestamps as any).historicalEntryPolicy || sig.historicalEntryPolicy,
            });
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
  public static evaluateCandleHistory(
    sig: PersistedSentSignal,
    candles: NormalizedCandle[],
    timestamps: {
      entryHitTimestamp?: string | null;
      displayPrice?: number;
      bid?: number;
      ask?: number;
      executionSide?: 'ASK' | 'BID';
      executionPrice?: number;
      spread?: number;
      entryTriggerTimestamp?: string | null;
      tp1HitTimestamp?: number;
      tp2HitTimestamp?: number;
      tp3HitTimestamp?: number;
      slHitTimestamp?: number;
      tp1Status?: 'PENDING' | 'HIT';
      tp2Status?: 'PENDING' | 'HIT';
      tp3Status?: 'PENDING' | 'HIT';
      slStatus?: 'ACTIVE' | 'HIT' | 'ACTIVE_FOR_ENTRY_ONLY';
      tp1HitAt?: string;
      tp2HitAt?: string;
      tp3HitAt?: string;
      stopLossHitAt?: string;
      tp1HitPrice?: number;
      tp2HitPrice?: number;
      tp3HitPrice?: number;
      stopLossHitPrice?: number;
    } = {}
  ): {
    finalState: PersistedSentSignal['status'];
    transitions: ProgressiveTransitionStep[];
    timestamps: typeof timestamps;
  } {
    let currentState: PersistedSentSignal['status'] = sig.status;
    const transitions: ProgressiveTransitionStep[] = [];

    if (sig.entryHitTimestamp && !timestamps.entryHitTimestamp) timestamps.entryHitTimestamp = sig.entryHitTimestamp;
    if (sig.tp1Status && !timestamps.tp1Status) timestamps.tp1Status = sig.tp1Status;
    if (sig.tp2Status && !timestamps.tp2Status) timestamps.tp2Status = sig.tp2Status;
    if (sig.tp3Status && !timestamps.tp3Status) timestamps.tp3Status = sig.tp3Status;
    if (sig.slStatus && !timestamps.slStatus) timestamps.slStatus = sig.slStatus;

    if (currentState !== 'WAITING_ENTRY' && currentState !== 'ACTIVE' && currentState !== 'TP1_HIT' && currentState !== 'TP2_HIT') {
      return { finalState: currentState, transitions: [], timestamps };
    }

    const isBuy = sig.direction === 'BUY';
    const entry = sig.entryPrice;
    const sl = sig.stopLoss;
    const tp1 = sig.tp1 ?? sig.takeProfit;
    const tp2 = sig.tp2 ?? sig.takeProfit;
    const tp3 = sig.tp3 ?? sig.takeProfit;

    for (const candle of candles) {
      if (currentState === 'SL_HIT' || currentState === 'TP3_HIT' || currentState === 'AMBIGUOUS' || currentState === 'EXPIRED') {
        break;
      }

      const high = candle.high;
      const low = candle.low;
      const open = candle.open;
      const time = candle.timestamp;
      const timeframe = candle.timeframe || '1m';

      // Check TTL Expiration
      const maxTtlMs = serverConfig.getConfig().signalExpirationMs;
      const ageMs = time - sig.timestamp;
      
      if (currentState === 'WAITING_ENTRY' && ageMs >= maxTtlMs) {
        currentState = 'EXPIRED';
        transitions.push({
          nextState: 'EXPIRED',
          eventTime: time,
          eventSource: 'HISTORICAL_BACKFILL',
          timeframeUsed: timeframe,
          isRecovered: true,
        });
        break;
      }

      if (currentState === 'WAITING_ENTRY') {
        const quotePrice = isBuy ? low : high;
        const validationRes = Gate29ExecutableEntryValidation.validateEntry(
          sig.direction,
          entry,
          {
            price: quotePrice,
            high,
            low,
            isHistoricalCandle: true,
            source: 'HISTORICAL',
            timestamp: time,
            policy: sig.historicalEntryPolicy,
          },
          time
        );

        sig.executionEvidence = validationRes.executionEvidence;
        sig.historicalEntryPolicy = validationRes.policyUsed;
        
        if (validationRes.isEntryConfirmed) {
          // Check if it also hit SL in the same candle (invalidating entry)
          const touchesSl = isBuy ? low <= sl : high >= sl;
          if (touchesSl) {
            // Ambiguous entry + SL
            currentState = 'AMBIGUOUS';
            transitions.push({
              nextState: 'AMBIGUOUS',
              eventTime: time,
              eventSource: 'HISTORICAL_BACKFILL',
              timeframeUsed: timeframe,
              isRecovered: true,
              ambiguousDetails: `Both Entry level (${entry}) and Stop Loss (${sl}) touched inside candle at ${time} before confirmation`,
            });
            break;
          } else {
            currentState = 'ACTIVE';
            timestamps.entryHitTimestamp = new Date(time).toISOString();
            timestamps.slStatus = 'ACTIVE';
            timestamps.displayPrice = validationRes.displayPrice;
            timestamps.bid = validationRes.bid;
            timestamps.ask = validationRes.ask;
            timestamps.executionSide = validationRes.executionSide;
            timestamps.executionPrice = validationRes.executionPrice;
            timestamps.spread = validationRes.spread;
            timestamps.entryTriggerTimestamp = validationRes.entryTriggerTimestamp;
            transitions.push({
              nextState: 'ACTIVE',
              eventTime: time,
              eventSource: 'HISTORICAL_BACKFILL',
              timeframeUsed: timeframe,
              isRecovered: true,
            });
          }
        } else {
          timestamps.tp1Status = 'PENDING';
          timestamps.tp2Status = 'PENDING';
          timestamps.tp3Status = 'PENDING';
          timestamps.slStatus = 'ACTIVE_FOR_ENTRY_ONLY';
          continue; // Wait until entry is hit before checking SL/TP
        }
      }

      if (isBuy) {
        while (currentState === 'ACTIVE' || currentState === 'TP1_HIT' || currentState === 'TP2_HIT') {
          const nextTp =
            currentState === 'ACTIVE' ? tp1 :
            currentState === 'TP1_HIT' ? tp2 :
            tp3;

          const touchesTp = high >= nextTp - 1e-8;
          const touchesSl = low <= sl + 1e-8;

          if (touchesTp && touchesSl) {
            if (open >= nextTp - 1e-8) {
              currentState = this.recordSingleBuyTpHit(currentState, nextTp, time, timeframe, transitions, timestamps);
            } else if (open <= sl + 1e-8) {
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
            currentState = this.recordSingleBuyTpHit(currentState, nextTp, time, timeframe, transitions, timestamps);
          } else {
            break;
          }
        }
      } else {
        // SELL
        while (currentState === 'ACTIVE' || currentState === 'TP1_HIT' || currentState === 'TP2_HIT') {
          const nextTp =
            currentState === 'ACTIVE' ? tp1 :
            currentState === 'TP1_HIT' ? tp2 :
            tp3;

          const touchesTp = low <= nextTp + 1e-8;
          const touchesSl = high >= sl - 1e-8;

          if (touchesTp && touchesSl) {
            if (open <= nextTp + 1e-8) {
              currentState = this.recordSingleSellTpHit(currentState, nextTp, time, timeframe, transitions, timestamps);
            } else if (open >= sl - 1e-8) {
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
            currentState = this.recordSingleSellTpHit(currentState, nextTp, time, timeframe, transitions, timestamps);
          } else {
            break;
          }
        }
      }
    }

    if (!timestamps.entryHitTimestamp) {
      timestamps.tp1Status = 'PENDING';
      timestamps.tp2Status = 'PENDING';
      timestamps.tp3Status = 'PENDING';
      timestamps.slStatus = 'ACTIVE_FOR_ENTRY_ONLY';
    }

    return { finalState: currentState, transitions, timestamps };
  }

  private static recordSingleBuyTpHit(
    currentState: PersistedSentSignal['status'],
    targetPrice: number,
    time: number,
    timeframe: string,
    transitions: ProgressiveTransitionStep[],
    timestamps: {
      tp1HitTimestamp?: number;
      tp2HitTimestamp?: number;
      tp3HitTimestamp?: number;
      tp1Status?: 'PENDING' | 'HIT';
      tp2Status?: 'PENDING' | 'HIT';
      tp3Status?: 'PENDING' | 'HIT';
      tp1HitAt?: string;
      tp2HitAt?: string;
      tp3HitAt?: string;
      tp1HitPrice?: number;
      tp2HitPrice?: number;
      tp3HitPrice?: number;
    }
  ): PersistedSentSignal['status'] {
    const isoTime = new Date(time).toISOString();
    if (currentState === 'ACTIVE') {
      timestamps.tp1Status = 'HIT';
      timestamps.tp1HitTimestamp = timestamps.tp1HitTimestamp || time;
      timestamps.tp1HitAt = timestamps.tp1HitAt || isoTime;
      timestamps.tp1HitPrice = timestamps.tp1HitPrice ?? targetPrice;
      transitions.push({
        nextState: 'TP1_HIT',
        eventTime: time,
        eventSource: 'HISTORICAL_BACKFILL',
        timeframeUsed: timeframe,
        isRecovered: true,
      });
      return 'TP1_HIT';
    } else if (currentState === 'TP1_HIT') {
      timestamps.tp2Status = 'HIT';
      timestamps.tp2HitTimestamp = timestamps.tp2HitTimestamp || time;
      timestamps.tp2HitAt = timestamps.tp2HitAt || isoTime;
      timestamps.tp2HitPrice = timestamps.tp2HitPrice ?? targetPrice;
      transitions.push({
        nextState: 'TP2_HIT',
        eventTime: time,
        eventSource: 'HISTORICAL_BACKFILL',
        timeframeUsed: timeframe,
        isRecovered: true,
      });
      return 'TP2_HIT';
    } else if (currentState === 'TP2_HIT') {
      timestamps.tp3Status = 'HIT';
      timestamps.tp3HitTimestamp = timestamps.tp3HitTimestamp || time;
      timestamps.tp3HitAt = timestamps.tp3HitAt || isoTime;
      timestamps.tp3HitPrice = timestamps.tp3HitPrice ?? targetPrice;
      transitions.push({
        nextState: 'TP3_HIT',
        eventTime: time,
        eventSource: 'HISTORICAL_BACKFILL',
        timeframeUsed: timeframe,
        isRecovered: true,
      });
      return 'COMPLETED';
    }
    return currentState;
  }

  private static recordSingleSellTpHit(
    currentState: PersistedSentSignal['status'],
    targetPrice: number,
    time: number,
    timeframe: string,
    transitions: ProgressiveTransitionStep[],
    timestamps: {
      tp1HitTimestamp?: number;
      tp2HitTimestamp?: number;
      tp3HitTimestamp?: number;
      tp1Status?: 'PENDING' | 'HIT';
      tp2Status?: 'PENDING' | 'HIT';
      tp3Status?: 'PENDING' | 'HIT';
      tp1HitAt?: string;
      tp2HitAt?: string;
      tp3HitAt?: string;
      tp1HitPrice?: number;
      tp2HitPrice?: number;
      tp3HitPrice?: number;
    }
  ): PersistedSentSignal['status'] {
    const isoTime = new Date(time).toISOString();
    if (currentState === 'ACTIVE') {
      timestamps.tp1Status = 'HIT';
      timestamps.tp1HitTimestamp = timestamps.tp1HitTimestamp || time;
      timestamps.tp1HitAt = timestamps.tp1HitAt || isoTime;
      timestamps.tp1HitPrice = timestamps.tp1HitPrice ?? targetPrice;
      transitions.push({
        nextState: 'TP1_HIT',
        eventTime: time,
        eventSource: 'HISTORICAL_BACKFILL',
        timeframeUsed: timeframe,
        isRecovered: true,
      });
      return 'TP1_HIT';
    } else if (currentState === 'TP1_HIT') {
      timestamps.tp2Status = 'HIT';
      timestamps.tp2HitTimestamp = timestamps.tp2HitTimestamp || time;
      timestamps.tp2HitAt = timestamps.tp2HitAt || isoTime;
      timestamps.tp2HitPrice = timestamps.tp2HitPrice ?? targetPrice;
      transitions.push({
        nextState: 'TP2_HIT',
        eventTime: time,
        eventSource: 'HISTORICAL_BACKFILL',
        timeframeUsed: timeframe,
        isRecovered: true,
      });
      return 'TP2_HIT';
    } else if (currentState === 'TP2_HIT') {
      timestamps.tp3Status = 'HIT';
      timestamps.tp3HitTimestamp = timestamps.tp3HitTimestamp || time;
      timestamps.tp3HitAt = timestamps.tp3HitAt || isoTime;
      timestamps.tp3HitPrice = timestamps.tp3HitPrice ?? targetPrice;
      transitions.push({
        nextState: 'TP3_HIT',
        eventTime: time,
        eventSource: 'HISTORICAL_BACKFILL',
        timeframeUsed: timeframe,
        isRecovered: true,
      });
      return 'COMPLETED';
    }
    return currentState;
  }

  /**
   * Evaluates latest real-time quote for non-terminal signals.
   */
  private static evaluateLiveTicker(
    sig: PersistedSentSignal,
    currentState: PersistedSentSignal['status'],
    ticker: NormalizedTicker,
    timestamps: {
      entryHitTimestamp?: string | null;
      displayPrice?: number;
      bid?: number;
      ask?: number;
      executionSide?: 'ASK' | 'BID';
      executionPrice?: number;
      spread?: number;
      entryTriggerTimestamp?: string | null;
      tp1HitTimestamp?: number;
      tp2HitTimestamp?: number;
      tp3HitTimestamp?: number;
      slHitTimestamp?: number;
      tp1Status?: 'PENDING' | 'HIT';
      tp2Status?: 'PENDING' | 'HIT';
      tp3Status?: 'PENDING' | 'HIT';
      slStatus?: 'ACTIVE' | 'HIT' | 'ACTIVE_FOR_ENTRY_ONLY';
      tp1HitAt?: string;
      tp2HitAt?: string;
      tp3HitAt?: string;
      stopLossHitAt?: string;
      tp1HitPrice?: number;
      tp2HitPrice?: number;
      tp3HitPrice?: number;
      stopLossHitPrice?: number;
    }
  ): {
    finalState: PersistedSentSignal['status'];
    transitions: ProgressiveTransitionStep[];
  } {
    const activeSigState: PersistedSentSignal = {
      ...sig,
      status: currentState,
      entryHitTimestamp: timestamps.entryHitTimestamp ?? sig.entryHitTimestamp,
      tp1Status: timestamps.tp1Status ?? sig.tp1Status,
      tp2Status: timestamps.tp2Status ?? sig.tp2Status,
      tp3Status: timestamps.tp3Status ?? sig.tp3Status,
      slStatus: timestamps.slStatus ?? sig.slStatus,
      tp1HitAt: timestamps.tp1HitAt ?? sig.tp1HitAt,
      tp2HitAt: timestamps.tp2HitAt ?? sig.tp2HitAt,
      tp3HitAt: timestamps.tp3HitAt ?? sig.tp3HitAt,
      stopLossHitAt: timestamps.stopLossHitAt ?? sig.stopLossHitAt,
      tp1HitPrice: timestamps.tp1HitPrice ?? sig.tp1HitPrice,
      tp2HitPrice: timestamps.tp2HitPrice ?? sig.tp2HitPrice,
      tp3HitPrice: timestamps.tp3HitPrice ?? sig.tp3HitPrice,
      stopLossHitPrice: timestamps.stopLossHitPrice ?? sig.stopLossHitPrice,
    };

    const result = this.evaluateSignalPriceUpdate(
      activeSigState,
      ticker.price,
      ticker.timestamp || Date.now(),
      ticker.symbol,
      { bid: ticker.bid, ask: ticker.ask }
    );

    if (result.entryHitTimestamp) {
      timestamps.entryHitTimestamp = result.entryHitTimestamp;
    }
    if (result.displayPrice !== undefined) timestamps.displayPrice = result.displayPrice;
    if (result.bid !== undefined) timestamps.bid = result.bid;
    if (result.ask !== undefined) timestamps.ask = result.ask;
    if (result.executionSide) timestamps.executionSide = result.executionSide;
    if (result.executionPrice !== undefined) timestamps.executionPrice = result.executionPrice;
    if (result.spread !== undefined) timestamps.spread = result.spread;
    if (result.entryTriggerTimestamp) timestamps.entryTriggerTimestamp = result.entryTriggerTimestamp;
    if (result.executionEvidence) (timestamps as any).executionEvidence = result.executionEvidence;
    if (result.historicalEntryPolicy) (timestamps as any).historicalEntryPolicy = result.historicalEntryPolicy;

    timestamps.tp1Status = result.tp1Status;
    timestamps.tp2Status = result.tp2Status;
    timestamps.tp3Status = result.tp3Status;
    timestamps.slStatus = result.slStatus;
    if (result.tp1HitAt) timestamps.tp1HitAt = result.tp1HitAt;
    if (result.tp2HitAt) timestamps.tp2HitAt = result.tp2HitAt;
    if (result.tp3HitAt) timestamps.tp3HitAt = result.tp3HitAt;
    if (result.stopLossHitAt) timestamps.stopLossHitAt = result.stopLossHitAt;
    if (result.tp1HitPrice !== undefined) timestamps.tp1HitPrice = result.tp1HitPrice;
    if (result.tp2HitPrice !== undefined) timestamps.tp2HitPrice = result.tp2HitPrice;
    if (result.tp3HitPrice !== undefined) timestamps.tp3HitPrice = result.tp3HitPrice;
    if (result.stopLossHitPrice !== undefined) timestamps.stopLossHitPrice = result.stopLossHitPrice;

    return { finalState: result.newStatus, transitions: result.transitions };
  }

  /**
   * Performs a single progressive state transition with full persistence, outcome logging,
   * idempotent notification dispatch, and performance intelligence metric recording.
   */
  private static async transitionSignalProgressive(
    sig: PersistedSentSignal,
    step: ProgressiveTransitionStep,
    timestamps: {
      entryHitTimestamp?: string | null;
      displayPrice?: number;
      bid?: number;
      ask?: number;
      executionSide?: 'ASK' | 'BID';
      executionPrice?: number;
      spread?: number;
      entryTriggerTimestamp?: string | null;
      tp1HitTimestamp?: number;
      tp2HitTimestamp?: number;
      tp3HitTimestamp?: number;
      slHitTimestamp?: number;
      expiredTimestamp?: number;
      tp1Status?: 'PENDING' | 'HIT';
      tp2Status?: 'PENDING' | 'HIT';
      tp3Status?: 'PENDING' | 'HIT';
      slStatus?: 'ACTIVE' | 'HIT' | 'ACTIVE_FOR_ENTRY_ONLY';
      tp1HitAt?: string;
      tp2HitAt?: string;
      tp3HitAt?: string;
      stopLossHitAt?: string;
      tp1HitPrice?: number;
      tp2HitPrice?: number;
      tp3HitPrice?: number;
      stopLossHitPrice?: number;
    }
  ): Promise<void> {
    const now = Date.now();
    const nextState = step.nextState;
    const nextStateStr = nextState as string;

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

      if (nextStateStr === 'ENTRY_CONFIRMED' || nextStateStr === 'ACTIVE') {
        type = 'SETUP_UPDATE';
        title = `${sig.symbol} [${sig.direction}] - ENTRY CONFIRMED${recoveryTag} 🎯`;
        message = step.isRecovered
          ? `Historically confirmed Entry level reached for ${sig.symbol} at ${sig.entryPrice} (Event Time: ${eventTimeStr} UTC, Source: Historical Backfill, Timeframe: ${step.timeframeUsed}).`
          : `Entry price level reached for ${sig.symbol} at ${sig.entryPrice}. Trade is now ACTIVE.`;
      } else if (nextStateStr === 'TP1_HIT') {
        type = 'SETUP_UPDATE';
        title = `${sig.symbol} [${sig.direction}] - TP1 HIT${recoveryTag} ✅`;
        const tpVal = sig.tp1 ?? sig.takeProfit;
        message = step.isRecovered
          ? `Historically confirmed Conservative Take-Profit level reached for ${sig.symbol} at ${tpVal} (Event Time: ${eventTimeStr} UTC, Source: Historical Backfill, Timeframe: ${step.timeframeUsed}).`
          : `Conservative Take-Profit level reached for ${sig.symbol} at ${tpVal}.`;
      } else if (nextStateStr === 'TP2_HIT') {
        type = 'SETUP_UPDATE';
        title = `${sig.symbol} [${sig.direction}] - TP2 HIT${recoveryTag} ✅`;
        const tpVal = sig.tp2 ?? sig.takeProfit;
        message = step.isRecovered
          ? `Historically confirmed Main Take-Profit target achieved for ${sig.symbol} at ${tpVal} (Event Time: ${eventTimeStr} UTC, Source: Historical Backfill, Timeframe: ${step.timeframeUsed}).`
          : `Main Take-Profit target achieved for ${sig.symbol} at ${tpVal}.`;
      } else if (nextStateStr === 'TP3_HIT' || nextStateStr === 'COMPLETED') {
        type = 'SETUP_UPDATE';
        title = `${sig.symbol} [${sig.direction}] - TP3 HIT 🏆 FULL TARGET${recoveryTag}`;
        const tpVal = sig.tp3 ?? sig.takeProfit;
        message = step.isRecovered
          ? `Historically confirmed Extended Take-Profit reached for ${sig.symbol} at ${tpVal} (Event Time: ${eventTimeStr} UTC, Source: Historical Backfill, Timeframe: ${step.timeframeUsed}).`
          : `Extended Take-Profit reached! ${sig.symbol} fully completed target at ${tpVal}.`;
      } else if (nextStateStr === 'SL_HIT' || nextStateStr === 'STOPPED_OUT') {
        type = 'SETUP_UPDATE';
        title = `${sig.symbol} [${sig.direction}] - STOP LOSS HIT${recoveryTag} ❌`;
        message = step.isRecovered
          ? `Historically confirmed Stop Loss triggered for ${sig.symbol} at ${sig.stopLoss} (Event Time: ${eventTimeStr} UTC, Source: Historical Backfill, Timeframe: ${step.timeframeUsed}).`
          : `Stop-loss triggered for ${sig.symbol} at ${sig.stopLoss}.`;
      } else if (nextStateStr === 'AMBIGUOUS') {
        type = 'SETUP_UPDATE';
        title = `${sig.symbol} [${sig.direction}] - OUTCOME AMBIGUOUS ⚠️`;
        message = `Both Target and Stop Loss were breached inside the same candle (${step.timeframeUsed} timeframe). Event recorded as AMBIGUOUS without guessing.`;
      } else if (nextStateStr === 'EXPIRED') {
        type = 'SETUP_UPDATE';
        title = `${sig.symbol} [${sig.direction}] - SETUP EXPIRED ⏳`;
        message = `Signal setup for ${sig.symbol} expired before entry price was reached.`;
      }

      if (title && message && sig.isTradeableSignal === true && sig.signalClassification === 'TRADEABLE') {
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
      entryHitTimestamp: timestamps.entryHitTimestamp,
      displayPrice: timestamps.displayPrice,
      bid: timestamps.bid,
      ask: timestamps.ask,
      executionSide: timestamps.executionSide,
      executionPrice: timestamps.executionPrice,
      spread: timestamps.spread,
      entryTriggerTimestamp: timestamps.entryTriggerTimestamp,
      tp1HitTimestamp: timestamps.tp1HitTimestamp,
      tp2HitTimestamp: timestamps.tp2HitTimestamp,
      tp3HitTimestamp: timestamps.tp3HitTimestamp,
      slHitTimestamp: timestamps.slHitTimestamp,
      tp1Status: timestamps.tp1Status,
      tp2Status: timestamps.tp2Status,
      tp3Status: timestamps.tp3Status,
      slStatus: timestamps.slStatus,
      tp1HitAt: timestamps.tp1HitAt,
      tp2HitAt: timestamps.tp2HitAt,
      tp3HitAt: timestamps.tp3HitAt,
      stopLossHitAt: timestamps.stopLossHitAt,
      tp1HitPrice: timestamps.tp1HitPrice,
      tp2HitPrice: timestamps.tp2HitPrice,
      tp3HitPrice: timestamps.tp3HitPrice,
      stopLossHitPrice: timestamps.stopLossHitPrice,
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
      nextStateStr === 'TP1_HIT' ? 'TP1 HIT' :
      nextStateStr === 'TP2_HIT' ? 'TP2 HIT' :
      (nextStateStr === 'TP3_HIT' || nextStateStr === 'COMPLETED') ? 'TP3 HIT' :
      (nextStateStr === 'SL_HIT' || nextStateStr === 'STOPPED_OUT') ? 'SL HIT' :
      nextStateStr === 'AMBIGUOUS' ? 'AMBIGUOUS' :
      nextStateStr === 'EXPIRED' ? 'EXPIRED' : 'ACTIVE';
    await SignalLogger.updateStatus(sig.id, logStatusMapping);

    // 4. Write separate Signal Outcome Log (Requirement 14 & 15)
    const entryConfirmed = !!(timestamps.entryHitTimestamp || sig.entryHitTimestamp);
    const finalOutcome = nextStateStr === 'ACTIVE' ? undefined : (nextStateStr as SignalOutcomeRecord['finalOutcome']);
    let derivedFinalOutcome = (nextStateStr === 'SL_HIT' || nextStateStr === 'STOPPED_OUT') ? 'SL_HIT' : (nextStateStr === 'COMPLETED' || nextStateStr === 'TP3_HIT') ? 'TP3_HIT' : (finalOutcome as any);
    if (!entryConfirmed) {
      if (nextStateStr === 'EXPIRED') {
        derivedFinalOutcome = 'EXPIRED';
      } else if (nextStateStr === 'AMBIGUOUS') {
        derivedFinalOutcome = 'AMBIGUOUS';
      } else {
        derivedFinalOutcome = undefined;
      }
    }

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
      entryHitTimestamp: timestamps.entryHitTimestamp,
      displayPrice: timestamps.displayPrice,
      bid: timestamps.bid,
      ask: timestamps.ask,
      executionSide: timestamps.executionSide,
      executionPrice: timestamps.executionPrice,
      spread: timestamps.spread,
      entryTriggerTimestamp: timestamps.entryTriggerTimestamp,
      tp1HitTimestamp: entryConfirmed ? timestamps.tp1HitTimestamp : undefined,
      tp2HitTimestamp: entryConfirmed ? timestamps.tp2HitTimestamp : undefined,
      tp3HitTimestamp: entryConfirmed ? timestamps.tp3HitTimestamp : undefined,
      slHitTimestamp: entryConfirmed ? timestamps.slHitTimestamp : undefined,
      tp1Status: entryConfirmed ? timestamps.tp1Status : 'PENDING',
      tp2Status: entryConfirmed ? timestamps.tp2Status : 'PENDING',
      tp3Status: entryConfirmed ? timestamps.tp3Status : 'PENDING',
      slStatus: entryConfirmed ? timestamps.slStatus : 'ACTIVE_FOR_ENTRY_ONLY',
      tp1HitAt: entryConfirmed ? timestamps.tp1HitAt : undefined,
      tp2HitAt: entryConfirmed ? timestamps.tp2HitAt : undefined,
      tp3HitAt: entryConfirmed ? timestamps.tp3HitAt : undefined,
      stopLossHitAt: entryConfirmed ? timestamps.stopLossHitAt : undefined,
      tp1HitPrice: entryConfirmed ? timestamps.tp1HitPrice : undefined,
      tp2HitPrice: entryConfirmed ? timestamps.tp2HitPrice : undefined,
      tp3HitPrice: entryConfirmed ? timestamps.tp3HitPrice : undefined,
      stopLossHitPrice: entryConfirmed ? timestamps.stopLossHitPrice : undefined,
      expiredTimestamp: nextStateStr === 'EXPIRED' ? (timestamps.expiredTimestamp || now) : undefined,
      expiresAt: sig.expiresAt || (sig.timestamp + serverConfig.getConfig().signalExpirationMs),
      finalOutcome: derivedFinalOutcome,
      status: nextState as any,
      timestamp: sig.timestamp,
      updatedAt: now,
      detectedAt: now,
      eventTime: step.eventTime,
      eventSource: step.eventSource,
      timeframeUsed: step.timeframeUsed,
      isRecovered: step.isRecovered,
      ambiguousDetails: step.ambiguousDetails,
      executionEvidence: sig.executionEvidence,
      historicalEntryPolicy: sig.historicalEntryPolicy,
    };
    await SignalOutcomeLogger.recordOutcome(outcomeRecord);

    // 5. If terminal state reached, push outcome into StrategyPerformanceTracker
    if (nextStateStr === 'TP3_HIT' || nextStateStr === 'COMPLETED' || nextStateStr === 'SL_HIT' || nextStateStr === 'STOPPED_OUT' || nextStateStr === 'EXPIRED') {
      const policy = sig.historicalEntryPolicy || HISTORICAL_ENTRY_POLICY;
      if ((sig.executionEvidence === 'HISTORICAL_CANDLE_TOUCH' || sig.executionEvidence === 'UNVERIFIABLE') && policy === 'CONSERVATIVE') {
        logger.info(`[Gate 47] Skipping StrategyPerformanceTracker.recordTradeOutcome for ${sig.symbol} (${sig.id}): executionEvidence=${sig.executionEvidence} under CONSERVATIVE policy.`);
      } else {
        let assetClass: 'CRYPTO' | 'FOREX' | 'STOCKS' = 'CRYPTO';
        if (sig.symbol.includes('USD') && (sig.symbol.length === 6 || sig.symbol.includes('EUR') || sig.symbol.includes('GBP'))) {
          assetClass = 'FOREX';
        } else if (!sig.symbol.includes('USDT') && !sig.symbol.includes('BTC') && sig.symbol.length <= 5) {
          assetClass = 'STOCKS';
        }

        const confScore = sig.score ?? 80;
        let realizedRR = 0;
        let isWin = false;
        let outcomeStatus: 'TP_HIT' | 'SL_HIT' | 'EXPIRED' | 'INVALIDATED' | 'NO_ENTRY / EXPIRED' = 'EXPIRED';
        let tradeEntered = false;

        if (entryConfirmed) {
          tradeEntered = true;
          const entry = Number(sig.entryPrice);
          const sl = Number(sig.stopLoss);
          const tp1 = Number(sig.tp1 ?? sig.takeProfit);
          const tp2 = Number(sig.tp2 ?? sig.takeProfit);
          const tp3 = Number(sig.tp3 ?? sig.takeProfit);
          const direction = sig.direction;

          const calculateR = (price: number): number => {
            const risk = direction === 'BUY' ? (entry - sl) : (sl - entry);
            if (Math.abs(risk) < 1e-8) return 0;
            const delta = direction === 'BUY' ? (price - entry) : (entry - price);
            return delta / risk;
          };

          const isPartialTp = (tp1 !== tp2) || (tp2 !== tp3);

          if (nextStateStr === 'TP3_HIT' || nextStateStr === 'COMPLETED') {
            outcomeStatus = 'TP_HIT';
            if (isPartialTp) {
              const w1 = TP1_ALLOCATION;
              const w2 = TP2_ALLOCATION;
              const w3 = TP3_ALLOCATION;
              const sumW = w1 + w2 + w3;
              const normW1 = sumW > 0 ? w1 / sumW : 1/3;
              const normW2 = sumW > 0 ? w2 / sumW : 1/3;
              const normW3 = sumW > 0 ? w3 / sumW : 1/3;

              realizedRR = (normW1 * calculateR(tp1)) + (normW2 * calculateR(tp2)) + (normW3 * calculateR(tp3));
            } else {
              realizedRR = calculateR(sig.takeProfit);
            }
            isWin = realizedRR > 0;
          } else if (nextStateStr === 'SL_HIT' || nextStateStr === 'STOPPED_OUT') {
            outcomeStatus = 'SL_HIT';
            if (isPartialTp) {
              const tp1Hit = timestamps.tp1Status === 'HIT' || sig.tp1Status === 'HIT';
              const tp2Hit = timestamps.tp2Status === 'HIT' || sig.tp2Status === 'HIT';

              const w1 = TP1_ALLOCATION;
              const w2 = TP2_ALLOCATION;
              const w3 = TP3_ALLOCATION;
              const sumW = w1 + w2 + w3;
              const normW1 = sumW > 0 ? w1 / sumW : 1/3;
              const normW2 = sumW > 0 ? w2 / sumW : 1/3;
              const normW3 = sumW > 0 ? w3 / sumW : 1/3;

              if (tp1Hit && tp2Hit) {
                realizedRR = (normW1 * calculateR(tp1)) + (normW2 * calculateR(tp2)) + (normW3 * -1.0);
              } else if (tp1Hit) {
                realizedRR = (normW1 * calculateR(tp1)) + ((normW2 + normW3) * -1.0);
              } else {
                realizedRR = -1.0;
              }
            } else {
              realizedRR = -1.0;
            }
            isWin = realizedRR > 0;
          } else if (nextStateStr === 'EXPIRED') {
            outcomeStatus = 'EXPIRED';
            if (isPartialTp) {
              const tp1Hit = timestamps.tp1Status === 'HIT' || sig.tp1Status === 'HIT';
              const tp2Hit = timestamps.tp2Status === 'HIT' || sig.tp2Status === 'HIT';

              const w1 = TP1_ALLOCATION;
              const w2 = TP2_ALLOCATION;
              const w3 = TP3_ALLOCATION;
              const sumW = w1 + w2 + w3;
              const normW1 = sumW > 0 ? w1 / sumW : 1/3;
              const normW2 = sumW > 0 ? w2 / sumW : 1/3;
              const normW3 = sumW > 0 ? w3 / sumW : 1/3;

              if (tp1Hit && tp2Hit) {
                realizedRR = (normW1 * calculateR(tp1)) + (normW2 * calculateR(tp2)) + (normW3 * 0.0);
              } else if (tp1Hit) {
                realizedRR = (normW1 * calculateR(tp1)) + ((normW2 + normW3) * 0.0);
              } else {
                realizedRR = 0.0;
              }
            } else {
              realizedRR = 0.0;
            }
            isWin = realizedRR > 0;
          }

          realizedRR = Number(realizedRR.toFixed(2));
        } else {
          realizedRR = 0;
          isWin = false;
          outcomeStatus = 'NO_ENTRY / EXPIRED';
          tradeEntered = false;
        }

        StrategyPerformanceTracker.recordTradeOutcome({
          signalId: sig.id,
          symbol: sig.symbol,
          assetClass,
          direction: sig.direction,
          strategyId: this.extractStrategyId(sig.strategy),
          strategyName: sig.strategy,
          marketRegime: (sig.marketRegime || 'UNKNOWN') as MarketRegime,
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
          tradeEntered,
          TRADE_ENTERED: tradeEntered,
          timestamp: sig.timestamp,
          resolvedAt: step.eventTime,
          durationMs: Math.max(0, step.eventTime - sig.timestamp),
        });
      }
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
