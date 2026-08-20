/**
 * GATE 30 — ASSET-AWARE DATA FRESHNESS POLICY ENGINE
 *
 * OBJECTIVE:
 * Provide unified, asset-aware data freshness validation across quotes and candle history.
 * Fast execution quotes enforce strict freshness limits (e.g. 15s - 30s for executable signals)
 * based on asset class, provider, timeframe, market session, and execution requirements.
 *
 * RULES & CAPABILITIES:
 * 1. Asset-Aware Quote Freshness:
 *    - CRYPTO (24/7): 15s max age for EXECUTABLE_SIGNAL, 60s for WATCHING.
 *    - FOREX (24/5): 20s max age for EXECUTABLE_SIGNAL during market session.
 *    - STOCKS/INDEX/COMMODITIES: 30s max age for EXECUTABLE_SIGNAL during open market session.
 *    - NEVER use arbitrary 24-hour quote freshness for executable signals.
 * 2. Reject Future Timestamps:
 *    - Flags any quote or candle timestamp > current clock (+5000ms skew allowance).
 * 3. Reject Impossible Timestamp Gaps & Backwards Jumps:
 *    - Detects non-chronological order, negative time steps, or gaps > 10x expected timeframe interval.
 * 4. Detect Missing Candle Intervals:
 *    - Identifies missing candle bars in time series (`c[i].timestamp - c[i-1].timestamp > 1.5 * interval`).
 * 5. Detect Duplicate Candles:
 *    - Flags duplicate timestamps in candle series (`c[i].timestamp === c[i-1].timestamp`).
 * 6. Detect Incomplete Current Candle:
 *    - Identifies if the latest bar is the currently forming unclosed candle.
 * 7. Expose Metrics:
 *    - `quoteAgeMs`
 *    - `candleAgeMs`
 *    - `dataQuality` ('EXCELLENT' | 'GOOD' | 'DEGRADED' | 'UNUSABLE')
 *    - `coverageStatus` ('COMPLETE' | 'MISSING_INTERVALS' | 'STALE' | 'FUTURE_TIMESTAMP' | 'DUPLICATES_DETECTED' | 'IMPOSSIBLE_GAP')
 */

import { SymbolNormalizer } from '../market/SymbolNormalizer.js';
import { logger } from '../logger.js';

export type AssetClassCategory = 'CRYPTO' | 'FOREX' | 'STOCKS' | 'STOCK' | 'COMMODITIES' | 'INDEX' | 'UNKNOWN';

export type ExecutionRequirement = 'EXECUTABLE_SIGNAL' | 'CANDIDATE' | 'WATCHING' | 'HISTORICAL_ANALYTICS';

export type DataQuality = 'EXCELLENT' | 'GOOD' | 'DEGRADED' | 'UNUSABLE';

export type CoverageStatus =
  | 'COMPLETE'
  | 'MISSING_INTERVALS'
  | 'STALE'
  | 'FUTURE_TIMESTAMP'
  | 'DUPLICATES_DETECTED'
  | 'IMPOSSIBLE_GAP'
  | 'INCOMPLETE_CANDLE_ONLY';

export interface FreshnessQuoteInput {
  price: number;
  timestamp: number;
  bid?: number | null;
  ask?: number | null;
  provider?: string;
}

export interface FreshnessCandleInput {
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  timestamp: number;
  provider?: string;
}

export interface FreshnessPolicyInput {
  symbol: string;
  assetClass?: AssetClassCategory;
  provider?: string;
  timeframe?: string; // '1m', '5m', '15m', '1h', '4h', '1d'
  executionRequirement?: ExecutionRequirement;
  quote?: FreshnessQuoteInput | null;
  candles?: FreshnessCandleInput[] | null;
  nowMs?: number;
  sessionState?: 'OPEN' | 'CLOSED' | 'PRE_MARKET' | 'POST_MARKET';
}

export interface FreshnessPolicyResult {
  isValid: boolean;
  quoteAgeMs: number | null;
  candleAgeMs: number | null;
  maxAllowedQuoteAgeMs: number;
  maxAllowedCandleAgeMs: number;
  dataQuality: DataQuality;
  coverageStatus: CoverageStatus;
  isFutureTimestamp: boolean;
  hasImpossibleGaps: boolean;
  hasMissingIntervals: boolean;
  hasDuplicates: boolean;
  isIncompleteCandle: boolean;
  rejectionReason?: string;
  explanation: string;
  details: {
    expectedCandleIntervalMs: number;
    duplicateTimestampsCount: number;
    missingIntervalsCount: number;
    impossibleGapsCount: number;
    marketSession: string;
    assetClass: AssetClassCategory;
    executionRequirement: ExecutionRequirement;
  };
}

export class Gate30DataFreshness {
  private static readonly MAX_ALLOWED_CLOCK_SKEW_MS = 5000; // 5 seconds max clock drift

  /**
   * Helper to convert timeframe string into exact duration in milliseconds
   */
  public static getFrameIntervalMs(timeframe: string): number {
    const tf = timeframe.toLowerCase().trim();
    if (tf === '1m' || tf === '1min') return 60 * 1000;
    if (tf === '5m' || tf === '5min') return 5 * 60 * 1000;
    if (tf === '15m' || tf === '15min') return 15 * 60 * 1000;
    if (tf === '30m' || tf === '30min') return 30 * 60 * 1000;
    if (tf === '1h' || tf === '1hour') return 60 * 60 * 1000;
    if (tf === '4h' || tf === '4hour') return 4 * 60 * 60 * 1000;
    if (tf === '1d' || tf === '1day' || tf === 'd') return 24 * 60 * 60 * 1000;
    if (tf === '1w' || tf === '1week') return 7 * 24 * 60 * 60 * 1000;
    return 60 * 60 * 1000; // Default 1h
  }

  /**
   * Calculates asset-aware max allowed quote age based on execution requirements, provider, and session
   */
  public static getMaxAllowedQuoteAgeMs(
    assetClass: AssetClassCategory,
    executionReq: ExecutionRequirement = 'EXECUTABLE_SIGNAL',
    sessionState: string = 'OPEN',
    provider: string = 'UNKNOWN'
  ): number {
    const normAsset = assetClass.toUpperCase() as AssetClassCategory;
    const normReq = executionReq.toUpperCase() as ExecutionRequirement;
    const provUpper = provider.toUpperCase();

    if (provUpper.includes('SIMULAT') || provUpper.includes('MOCK') || provUpper.includes('TEST')) {
      return 300000; // 5 minutes for simulation environments
    }

    if (normReq === 'HISTORICAL_ANALYTICS') {
      return 86400000; // 24 hours allowed ONLY for pure historical offline analytics
    }

    if (normReq === 'WATCHING') {
      if (normAsset === 'CRYPTO') return 60000;   // 60s
      if (normAsset === 'FOREX') return 90000;    // 90s
      return 120000;                              // 120s
    }

    if (normReq === 'CANDIDATE') {
      if (normAsset === 'CRYPTO') return 30000;   // 30s
      if (normAsset === 'FOREX') return 45000;    // 45s
      return 60000;                               // 60s
    }

    // EXECUTABLE_SIGNAL: Strict fast execution freshness
    if (normAsset === 'CRYPTO') {
      return 15000; // 15 seconds max quote age for executable crypto signal
    }
    if (normAsset === 'FOREX') {
      if (sessionState === 'CLOSED') return 300000;
      return 20000; // 20 seconds max quote age for executable forex signal
    }
    if (normAsset === 'STOCKS' || normAsset === 'STOCK' || normAsset === 'INDEX' || normAsset === 'COMMODITIES') {
      if (sessionState === 'CLOSED') return 300000;
      return 30000; // 30 seconds max quote age for executable stock/index signal
    }

    return 30000; // 30s default
  }

  /**
   * Calculates asset & timeframe aware max allowed candle age
   */
  public static getMaxAllowedCandleAgeMs(
    timeframe: string,
    executionReq: ExecutionRequirement = 'EXECUTABLE_SIGNAL'
  ): number {
    const intervalMs = this.getFrameIntervalMs(timeframe);
    let multiplier = 3;
    if (executionReq === 'HISTORICAL_ANALYTICS') multiplier = 10;
    return Math.max(intervalMs * multiplier, 300000); // At least 5 mins
  }

  /**
   * Evaluates data freshness and coverage for quotes & candle history according to Gate 30 rules.
   */
  public static evaluate(input: FreshnessPolicyInput): FreshnessPolicyResult {
    const nowMs = input.nowMs || Date.now();
    const cleanSymbol = SymbolNormalizer.normalizeAppSymbol(input.symbol) || input.symbol.trim().toUpperCase();
    const assetClass: AssetClassCategory = input.assetClass || (SymbolNormalizer.getAssetClassification(cleanSymbol) as AssetClassCategory);
    const provider = input.provider || input.quote?.provider || input.candles?.[0]?.provider || 'UNKNOWN';
    const timeframe = input.timeframe || '1h';
    const executionReq = input.executionRequirement || 'EXECUTABLE_SIGNAL';
    const sessionState = input.sessionState || 'OPEN';

    const maxAllowedQuoteAgeMs = this.getMaxAllowedQuoteAgeMs(assetClass, executionReq, sessionState, provider);
    const maxAllowedCandleAgeMs = this.getMaxAllowedCandleAgeMs(timeframe, executionReq);
    const expectedCandleIntervalMs = this.getFrameIntervalMs(timeframe);

    let quoteAgeMs: number | null = null;
    let candleAgeMs: number | null = null;
    let isFutureTimestamp = false;
    let hasImpossibleGaps = false;
    let hasMissingIntervals = false;
    let hasDuplicates = false;
    let isIncompleteCandle = false;

    let duplicateTimestampsCount = 0;
    let missingIntervalsCount = 0;
    let impossibleGapsCount = 0;

    const rejectionReasons: string[] = [];

    // 1. Evaluate Quote Freshness & Timestamp
    if (input.quote && input.quote.timestamp > 0) {
      quoteAgeMs = nowMs - input.quote.timestamp;

      // Future timestamp check on quote
      if (input.quote.timestamp > nowMs + this.MAX_ALLOWED_CLOCK_SKEW_MS) {
        isFutureTimestamp = true;
        rejectionReasons.push(`Future quote timestamp detected (${input.quote.timestamp} > clock ${nowMs} + ${this.MAX_ALLOWED_CLOCK_SKEW_MS}ms skew)`);
      }

      // Quote age limit check
      if (quoteAgeMs !== null && quoteAgeMs > maxAllowedQuoteAgeMs && !isFutureTimestamp) {
        const quoteSec = (quoteAgeMs / 1000).toFixed(1);
        const maxSec = (maxAllowedQuoteAgeMs / 1000).toFixed(1);
        rejectionReasons.push(`Quote stale for ${executionReq} on ${assetClass} (Age: ${quoteSec}s > ${maxSec}s max limit)`);
      }
    }

    // 2. Evaluate Candle Series Integrity, Timestamps, Duplicates & Gaps
    const candles = input.candles;
    if (candles && Array.isArray(candles) && candles.length > 0) {
      const lastCandle = candles[candles.length - 1];
      candleAgeMs = nowMs - lastCandle.timestamp;

      // Future timestamp check on latest candle
      if (lastCandle.timestamp > nowMs + this.MAX_ALLOWED_CLOCK_SKEW_MS) {
        isFutureTimestamp = true;
        rejectionReasons.push(`Future candle timestamp detected (${lastCandle.timestamp} > clock ${nowMs})`);
      }

      // Candle freshness check
      if (candleAgeMs !== null && candleAgeMs > maxAllowedCandleAgeMs && !isFutureTimestamp) {
        const candleMin = (candleAgeMs / 60000).toFixed(1);
        const maxMin = (maxAllowedCandleAgeMs / 60000).toFixed(1);
        rejectionReasons.push(`Candle series stale for timeframe ${timeframe} (Age: ${candleMin}m > ${maxMin}m max limit)`);
      }

      // Check for incomplete current forming candle
      if (nowMs - lastCandle.timestamp < expectedCandleIntervalMs) {
        isIncompleteCandle = true;
      }

      // Iterate through candle timestamps to detect duplicates, backwards jumps, impossible gaps, and missing intervals
      for (let i = 1; i < candles.length; i++) {
        const prevTime = candles[i - 1].timestamp;
        const currTime = candles[i].timestamp;
        const diffMs = currTime - prevTime;

        if (diffMs === 0) {
          hasDuplicates = true;
          duplicateTimestampsCount++;
        } else if (diffMs < 0) {
          // Out of order or backwards time jump
          hasImpossibleGaps = true;
          impossibleGapsCount++;
        } else if (diffMs > expectedCandleIntervalMs * 10) {
          // Massive unexpected gap (> 10 bars missing)
          hasImpossibleGaps = true;
          impossibleGapsCount++;
        } else if (diffMs > expectedCandleIntervalMs * 1.5) {
          // Missing intervals
          hasMissingIntervals = true;
          const missingBars = Math.round(diffMs / expectedCandleIntervalMs) - 1;
          missingIntervalsCount += Math.max(1, missingBars);
        }
      }

      if (hasDuplicates) {
        rejectionReasons.push(`Detected ${duplicateTimestampsCount} duplicate candle timestamps in series`);
      }
      if (hasImpossibleGaps) {
        rejectionReasons.push(`Detected ${impossibleGapsCount} impossible timestamp gaps or backwards time jumps in candle series`);
      }
    }

    // Determine Coverage Status
    let coverageStatus: CoverageStatus = 'COMPLETE';
    if (isFutureTimestamp) {
      coverageStatus = 'FUTURE_TIMESTAMP';
    } else if (hasDuplicates) {
      coverageStatus = 'DUPLICATES_DETECTED';
    } else if (hasImpossibleGaps) {
      coverageStatus = 'IMPOSSIBLE_GAP';
    } else if (
      (quoteAgeMs !== null && quoteAgeMs > maxAllowedQuoteAgeMs) ||
      (candleAgeMs !== null && candleAgeMs > maxAllowedCandleAgeMs)
    ) {
      coverageStatus = 'STALE';
    } else if (hasMissingIntervals) {
      coverageStatus = 'MISSING_INTERVALS';
    } else if (isIncompleteCandle && (!candles || candles.length === 1)) {
      coverageStatus = 'INCOMPLETE_CANDLE_ONLY';
    }

    // Determine Data Quality
    let dataQuality: DataQuality = 'EXCELLENT';
    if (isFutureTimestamp || hasDuplicates || hasImpossibleGaps || coverageStatus === 'STALE') {
      dataQuality = 'UNUSABLE';
    } else if (hasMissingIntervals || (quoteAgeMs !== null && quoteAgeMs > maxAllowedQuoteAgeMs * 0.7)) {
      dataQuality = 'DEGRADED';
    } else if (isIncompleteCandle || (quoteAgeMs !== null && quoteAgeMs > maxAllowedQuoteAgeMs * 0.4)) {
      dataQuality = 'GOOD';
    }

    const isValid = dataQuality !== 'UNUSABLE' && rejectionReasons.length === 0;

    const explanation = isValid
      ? `Data Freshness Valid: Quality ${dataQuality}, Coverage ${coverageStatus}, Quote Age ${quoteAgeMs !== null ? Math.round(quoteAgeMs) + 'ms' : 'N/A'}, Candle Age ${candleAgeMs !== null ? Math.round(candleAgeMs) + 'ms' : 'N/A'}.`
      : `Data Freshness Rejected: Quality ${dataQuality}, Coverage ${coverageStatus}. Reasons: ${rejectionReasons.join('; ')}`;

    const result: FreshnessPolicyResult = {
      isValid,
      quoteAgeMs,
      candleAgeMs,
      maxAllowedQuoteAgeMs,
      maxAllowedCandleAgeMs,
      dataQuality,
      coverageStatus,
      isFutureTimestamp,
      hasImpossibleGaps,
      hasMissingIntervals,
      hasDuplicates,
      isIncompleteCandle,
      rejectionReason: isValid ? undefined : rejectionReasons.join('; '),
      explanation,
      details: {
        expectedCandleIntervalMs,
        duplicateTimestampsCount,
        missingIntervalsCount,
        impossibleGapsCount,
        marketSession: sessionState,
        assetClass,
        executionRequirement: executionReq,
      },
    };

    logger.debug(`[Gate 30 Freshness] symbol=${cleanSymbol} isValid=${isValid} quality=${dataQuality} status=${coverageStatus}`);

    return result;
  }
}
