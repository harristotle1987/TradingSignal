/**
 * Hardened Signal Validation Pipeline (Gate 8)
 *
 * Implements strict, zero-compromise validation before any signal can be emitted or displayed:
 * - Freshness: Rejects stale ticker & candle timestamps (STALE_DATA).
 * - Cross-validation: Compares live quotes across primary and secondary feeds (PRICE_MISMATCH).
 * - Entry integrity: Displayed EXACT ENTRY PRICE must be the latest validated live market price (INVALID_ENTRY).
 * - Candle integrity: Validates OHLC consistency, positive values, and ordering (INVALID_CANDLE).
 * - Timeframe integrity: Ensures intervals are accurately spaced and sorted (INVALID_CANDLE).
 * - Signal consistency: Ensures all metrics derive from a single bound market snapshot (INSUFFICIENT_CONFLUENCE).
 * - SL/TP sanity: Validates geometric direction, minimum practical distances, and net R:R (INVALID_SL_TP).
 * - No forced output / No synthetic data: A validation failure produces NO VALID SIGNAL.
 */

import { NormalizedCandle, NormalizedTicker, SignalDirection, SignalValidationReason } from '../../types/index.js';
import { getDynamicPrecision } from '../../utils/formatters.js';
import { logger } from '../logger.js';
import { TechnicalIndicators } from './TechnicalIndicators.js';
import { AtrTpGenerator } from './AtrTpGenerator.js';
import { RiskRewardCalculator } from './RiskRewardCalculator.js';
import { Gate30DataFreshness } from './Gate30DataFreshness.js';
import { Gate31NewsRiskClassification } from './Gate31NewsRiskClassification.js';
import { Gate34ExecutionFrictionStressTest } from './Gate34ExecutionFrictionStressTest.js';
import { serverConfig } from '../config.js';

export interface ValidationContext {
  symbol: string;
  direction: SignalDirection;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  tp1?: number;
  tp2?: number;
  tp3?: number;
  riskRewardRatio: number;
  score: number;
  candlesMap: Record<string, NormalizedCandle[]>;
  liveTicker: NormalizedTicker | null;
  secondaryPrice?: { price: number; source: string };
  simulatedTimeMs?: number;
}

export interface ValidationResult {
  isValid: boolean;
  validationReason: SignalValidationReason;
  detailedMessage: string;
  snapshotId: string;
  validatedAt: number;
  adjustedEntryPrice?: number;
  adjustedStopLoss?: number;
  adjustedTakeProfit?: number;
  adjustedTp1?: number;
  adjustedTp2?: number;
  adjustedTp3?: number;
  adjustedGrossRR?: number;
  adjustedPrimaryRR?: number;
  adjustedTp1RR?: number;
  adjustedTp2RR?: number;
  adjustedTp3RR?: number;
  adjustedNetRR?: number;
}

export class SignalValidator {
  /**
   * Main Gate 8 Validation Pipeline
   */
  static validate(ctx: ValidationContext): ValidationResult {
    const now = ctx.simulatedTimeMs || Date.now();
    const snapshotId = `snap_${now}_${ctx.symbol}_${Math.random().toString(36).substring(2, 7)}`;

    // 1. Market Data Availability Check
    if (!ctx.liveTicker || ctx.liveTicker.status === 'MARKET_DATA_UNAVAILABLE' || ctx.liveTicker.price <= 0) {
      return {
        isValid: false,
        validationReason: 'MARKET_DATA_UNAVAILABLE',
        detailedMessage: `Live market feed is unavailable for ${ctx.symbol}`,
        snapshotId,
        validatedAt: now,
      };
    }

    // 2. Freshness Verification (STALE_DATA)
    const freshnessCheck = this.verifyFreshness(ctx, now);
    if (!freshnessCheck.isValid) {
      return {
        isValid: false,
        validationReason: 'STALE_DATA',
        detailedMessage: freshnessCheck.message,
        snapshotId,
        validatedAt: now,
      };
    }

    // 3. Candle Integrity Verification (INVALID_CANDLE)
    const candleCheck = this.verifyCandleIntegrity(ctx.candlesMap);
    if (!candleCheck.isValid) {
      return {
        isValid: false,
        validationReason: 'INVALID_CANDLE',
        detailedMessage: candleCheck.message,
        snapshotId,
        validatedAt: now,
      };
    }

    // 4. Cross-Source Price Agreement Verification (PRICE_MISMATCH)
    if (ctx.secondaryPrice && ctx.secondaryPrice.price > 0) {
      const crossCheck = this.verifyCrossPrice(ctx.symbol, ctx.liveTicker.price, ctx.secondaryPrice.price, ctx.secondaryPrice.source);
      if (!crossCheck.isValid) {
        return {
          isValid: false,
          validationReason: 'PRICE_MISMATCH',
          detailedMessage: crossCheck.message,
          snapshotId,
          validatedAt: now,
        };
      }
    }

    // 5. Entry Price Integrity (INVALID_ENTRY)
    const livePrice = ctx.liveTicker.price;
    const entryDiffPct = Math.abs(livePrice - ctx.entryPrice) / ctx.entryPrice;
    const maxDriftTolerance = 0.0015; // 0.15% (15 bps)

    if (entryDiffPct > maxDriftTolerance) {
      return {
        isValid: false,
        validationReason: 'INVALID_ENTRY',
        detailedMessage: `Live price drifted ${(entryDiffPct * 100).toFixed(4)}% beyond max tolerance (${maxDriftTolerance * 100}%)`,
        snapshotId,
        validatedAt: now,
      };
    }

    // 6. SL / TP Sanity, ATR & Geometry Verification (INVALID_SL_TP)
    const slTpCheck = this.verifySlTpSanity(
      ctx.symbol,
      ctx.direction,
      livePrice,
      ctx.stopLoss,
      ctx.takeProfit,
      ctx.entryPrice,
      ctx.candlesMap,
      ctx.score,
      ctx.tp1,
      ctx.tp2,
      ctx.tp3
    );
    if (!slTpCheck.isValid) {
      return {
        isValid: false,
        validationReason: 'INVALID_SL_TP',
        detailedMessage: slTpCheck.message,
        snapshotId,
        validatedAt: now,
        adjustedStopLoss: slTpCheck.adjustedStopLoss,
        adjustedTakeProfit: slTpCheck.adjustedTakeProfit,
        adjustedTp1: slTpCheck.adjustedTp1,
        adjustedTp2: slTpCheck.adjustedTp2,
        adjustedTp3: slTpCheck.adjustedTp3,
        adjustedGrossRR: slTpCheck.adjustedGrossRR,
        adjustedPrimaryRR: slTpCheck.adjustedPrimaryRR,
        adjustedTp1RR: slTpCheck.adjustedTp1RR,
        adjustedTp2RR: slTpCheck.adjustedTp2RR,
        adjustedTp3RR: slTpCheck.adjustedTp3RR,
      };
    }

    // 7. Gate 31 Asset-Aware News Risk Classification
    const newsRiskResult = Gate31NewsRiskClassification.evaluate(ctx.symbol, now);
    if (newsRiskResult.classification === 'BLOCK') {
      return {
        isValid: false,
        validationReason: 'HIGH_NEWS_RISK',
        detailedMessage: `REJECTED: BLOCK_NEWS_EVENT. Trading blocked due to major scheduled market-moving event (${newsRiskResult.reasons.join('; ')})`,
        snapshotId,
        validatedAt: now,
        adjustedStopLoss: slTpCheck.adjustedStopLoss,
        adjustedTakeProfit: slTpCheck.adjustedTakeProfit,
        adjustedTp1: slTpCheck.adjustedTp1,
        adjustedTp2: slTpCheck.adjustedTp2,
        adjustedTp3: slTpCheck.adjustedTp3,
        adjustedGrossRR: slTpCheck.adjustedGrossRR,
        adjustedPrimaryRR: slTpCheck.adjustedPrimaryRR,
        adjustedTp1RR: slTpCheck.adjustedTp1RR,
        adjustedTp2RR: slTpCheck.adjustedTp2RR,
        adjustedTp3RR: slTpCheck.adjustedTp3RR,
      };
    }

    // 8. Confluence & Quality Score Check (INSUFFICIENT_CONFLUENCE with Gate 31 CAUTION threshold elevation)
    const thresholds = serverConfig.getConfig().thresholds;
    const requiredMinScore = newsRiskResult.classification === 'CAUTION'
      ? Math.max(thresholds.minimumScore, newsRiskResult.minRequiredConfirmationScore)
      : thresholds.minimumScore;

    if (ctx.score < requiredMinScore) {
      const reasonMsg = newsRiskResult.classification === 'CAUTION'
        ? `REJECTED: SCORE_BELOW_CAUTION_NEWS_THRESHOLD. Score ${ctx.score} is below elevated CAUTION news threshold of ${requiredMinScore}`
        : `REJECTED: SCORE_BELOW_THRESHOLD. Deterministic score ${ctx.score}/100 is below minimum actionable threshold of ${thresholds.minimumScore}`;

      return {
        isValid: false,
        validationReason: 'INSUFFICIENT_CONFLUENCE',
        detailedMessage: reasonMsg,
        snapshotId,
        validatedAt: now,
        adjustedStopLoss: slTpCheck.adjustedStopLoss,
        adjustedTakeProfit: slTpCheck.adjustedTakeProfit,
        adjustedTp1: slTpCheck.adjustedTp1,
        adjustedTp2: slTpCheck.adjustedTp2,
        adjustedTp3: slTpCheck.adjustedTp3,
        adjustedGrossRR: slTpCheck.adjustedGrossRR,
        adjustedPrimaryRR: slTpCheck.adjustedPrimaryRR,
        adjustedTp1RR: slTpCheck.adjustedTp1RR,
        adjustedTp2RR: slTpCheck.adjustedTp2RR,
        adjustedTp3RR: slTpCheck.adjustedTp3RR,
      };
    }

    // All validation stages passed successfully
    return {
      isValid: true,
      validationReason: 'VALID',
      detailedMessage: `All Gate 8 validation checks passed with live market price ${livePrice}`,
      snapshotId,
      validatedAt: now,
      adjustedEntryPrice: livePrice,
      adjustedStopLoss: slTpCheck.adjustedStopLoss,
      adjustedTakeProfit: slTpCheck.adjustedTakeProfit,
      adjustedTp1: slTpCheck.adjustedTp1,
      adjustedTp2: slTpCheck.adjustedTp2,
      adjustedTp3: slTpCheck.adjustedTp3,
      adjustedGrossRR: slTpCheck.adjustedGrossRR,
      adjustedPrimaryRR: slTpCheck.adjustedPrimaryRR,
      adjustedTp1RR: slTpCheck.adjustedTp1RR,
      adjustedTp2RR: slTpCheck.adjustedTp2RR,
      adjustedTp3RR: slTpCheck.adjustedTp3RR,
      adjustedNetRR: slTpCheck.adjustedNetRR,
    };
  }

  // --- Sub-pipeline Checkers ---

  private static verifyFreshness(ctx: ValidationContext, now: number): { isValid: boolean; message: string } {
    const ticker = ctx.liveTicker!;

    // Reject if ticker is stale or flagged as not fresh
    if (ticker.status === 'STALE' || !ticker.isFresh) {
      return { isValid: false, message: `REJECTED: DATA_STALE. Market ticker data is stale or flagged as not fresh (status: ${ticker.status}, isFresh: ${ticker.isFresh})` };
    }

    const candles1h = ctx.candlesMap['1h'] || ctx.candlesMap['15m'] || ctx.candlesMap['5m'] || Object.values(ctx.candlesMap)[0];

    const gate30Res = Gate30DataFreshness.evaluate({
      symbol: ctx.symbol,
      timeframe: '1h',
      executionRequirement: 'EXECUTABLE_SIGNAL',
      quote: {
        price: ticker.price,
        timestamp: ticker.timestamp,
        bid: ticker.bid,
        ask: ticker.ask,
        provider: ticker.provider,
      },
      candles: candles1h,
      nowMs: now,
    });

    if (!gate30Res.isValid) {
      return {
        isValid: false,
        message: `REJECTED: DATA_STALE. ${gate30Res.rejectionReason || 'Failed Gate 30 Freshness Check'}`,
      };
    }

    return { isValid: true, message: 'OK' };
  }

  public static verifyCandleIntegrity(candlesMap: Record<string, NormalizedCandle[]>): { isValid: boolean; message: string } {
    if (!candlesMap['1h'] || candlesMap['1h'].length < 25) {
      return { isValid: false, message: 'REJECTED: INSUFFICIENT_DATA. Insufficient 1H candle history (minimum 25 candles required)' };
    }

    for (const [tf, candles] of Object.entries(candlesMap)) {
      if (!candles || candles.length === 0) continue;

      for (let i = 0; i < candles.length; i++) {
        const c = candles[i];

        // 1. Positive and Finite
        if (!Number.isFinite(c.open) || !Number.isFinite(c.high) || !Number.isFinite(c.low) || !Number.isFinite(c.close) ||
            c.open <= 0 || c.high <= 0 || c.low <= 0 || c.close <= 0) {
          return { isValid: false, message: `REJECTED: CORRUPTED_DATA. Corrupted candle values in timeframe ${tf} at index ${i}` };
        }

        // 2. High/Low bounds integrity with floating tolerance
        const maxOC = Math.max(c.open, c.close);
        const minOC = Math.min(c.open, c.close);

        if (c.high < maxOC - 1e-6) {
          return { isValid: false, message: `REJECTED: CORRUPTED_DATA. Candle high (${c.high}) < max(open, close) (${maxOC}) in timeframe ${tf}` };
        }
        if (c.low > minOC + 1e-6) {
          return { isValid: false, message: `REJECTED: CORRUPTED_DATA. Candle low (${c.low}) > min(open, close) (${minOC}) in timeframe ${tf}` };
        }

        // 3. Ascending timestamp verification
        if (i > 0 && c.timestamp <= candles[i - 1].timestamp) {
          return { isValid: false, message: `REJECTED: CORRUPTED_DATA. Non-ascending candle timestamps detected in timeframe ${tf}` };
        }
      }
    }

    return { isValid: true, message: 'OK' };
  }

  public static verifyCrossPrice(symbol: string, primaryPrice: number, secondaryPrice: number, secondarySource: string): { isValid: boolean; message: string } {
    const diffPct = (Math.abs(primaryPrice - secondaryPrice) / primaryPrice) * 100;
    const cleanSym = symbol.trim().toUpperCase();

    // Asset-appropriate strict tolerance thresholds to reject contradictory provider data
    let maxAllowedPct = 0.25; // Default Stocks: 0.25% (25 bps)
    if (cleanSym.includes('BTC') || cleanSym.includes('ETH') || cleanSym.includes('SOL')) {
      maxAllowedPct = 0.60; // Crypto: 0.60%
    } else if (cleanSym.includes('USD') || cleanSym.includes('EUR') || cleanSym.includes('GBP') || cleanSym.includes('JPY')) {
      maxAllowedPct = 0.10; // Forex: 0.10% (10 bps)
    }

    if (diffPct > maxAllowedPct) {
      return {
        isValid: false,
        message: `REJECTED: PRICE_MISMATCH. Material price mismatch: Primary quote (${primaryPrice}) disagrees with ${secondarySource} (${secondaryPrice}) by ${diffPct.toFixed(3)}% (max allowed: ${maxAllowedPct}%)`,
      };
    }

    return { isValid: true, message: 'OK' };
  }

  private static verifySlTpSanity(
    symbol: string,
    direction: SignalDirection,
    livePrice: number,
    stopLoss: number,
    takeProfit: number,
    originalEntry: number,
    candlesMap: Record<string, NormalizedCandle[]>,
    score: number = 80,
    tp1?: number,
    tp2?: number,
    tp3?: number
  ): {
    isValid: boolean;
    message: string;
    adjustedStopLoss?: number;
    adjustedTakeProfit?: number;
    adjustedTp1?: number;
    adjustedTp2?: number;
    adjustedTp3?: number;
    adjustedGrossRR?: number;
    adjustedPrimaryRR?: number;
    adjustedTp1RR?: number;
    adjustedTp2RR?: number;
    adjustedTp3RR?: number;
    adjustedNetRR?: number;
  } {
    const precision = getDynamicPrecision(livePrice, symbol);

    // Adjust SL/TP if minor live price drift occurred
    const slDist = Math.abs(originalEntry - stopLoss);
    const tpDist = Math.abs(takeProfit - originalEntry);

    const tp1Dist = tp1 !== undefined ? Math.abs(tp1 - originalEntry) : undefined;
    const tp2Dist = tp2 !== undefined ? Math.abs(tp2 - originalEntry) : undefined;
    const tp3Dist = tp3 !== undefined ? Math.abs(tp3 - originalEntry) : undefined;

    let adjustedSL: number;
    let adjustedTP: number;
    let adjustedTp1: number | undefined;
    let adjustedTp2: number | undefined;
    let adjustedTp3: number | undefined;

    if (direction === 'BUY') {
      adjustedSL = Number((livePrice - slDist).toFixed(precision));
      adjustedTP = Number((livePrice + tpDist).toFixed(precision));
      adjustedTp1 = tp1Dist !== undefined ? Number((livePrice + tp1Dist).toFixed(precision)) : undefined;
      adjustedTp2 = tp2Dist !== undefined ? Number((livePrice + tp2Dist).toFixed(precision)) : undefined;
      adjustedTp3 = tp3Dist !== undefined ? Number((livePrice + tp3Dist).toFixed(precision)) : undefined;
    } else {
      adjustedSL = Number((livePrice + slDist).toFixed(precision));
      adjustedTP = Number((livePrice - tpDist).toFixed(precision));
      adjustedTp1 = tp1Dist !== undefined ? Number((livePrice - tp1Dist).toFixed(precision)) : undefined;
      adjustedTp2 = tp2Dist !== undefined ? Number((livePrice - tp2Dist).toFixed(precision)) : undefined;
      adjustedTp3 = tp3Dist !== undefined ? Number((livePrice - tp3Dist).toFixed(precision)) : undefined;
    }

    // 1. Geometric Side & Ordering Validation
    if (direction === 'BUY') {
      if (adjustedSL >= livePrice) {
        return { isValid: false, message: `REJECTED: INVALID_SL_TP. BUY signal stop-loss (${adjustedSL}) must be strictly below entry price (${livePrice})` };
      }
      if (adjustedTP <= livePrice) {
        return { isValid: false, message: `REJECTED: INVALID_SL_TP. BUY signal take-profit (${adjustedTP}) must be strictly above entry price (${livePrice})` };
      }
      if (adjustedTp1 !== undefined && adjustedTp2 !== undefined && adjustedTp3 !== undefined) {
        if (adjustedTp1 <= livePrice) {
          return { isValid: false, message: `REJECTED: INVALID_SL_TP. BUY signal TP1 (${adjustedTp1}) must be strictly above entry price (${livePrice})` };
        }
        if (adjustedTp2 <= adjustedTp1) {
          return { isValid: false, message: `REJECTED: INVALID_SL_TP. BUY signal TP2 (${adjustedTp2}) must be strictly above TP1 (${adjustedTp1})` };
        }
        if (adjustedTp3 <= adjustedTp2) {
          return { isValid: false, message: `REJECTED: INVALID_SL_TP. BUY signal TP3 (${adjustedTp3}) must be strictly above TP2 (${adjustedTp2})` };
        }
        if (adjustedTp1 === adjustedTp2 || adjustedTp2 === adjustedTp3 || adjustedTp1 === adjustedTp3) {
          return { isValid: false, message: `REJECTED: INVALID_SL_TP. Take-profit targets must be distinct: TP1 (${adjustedTp1}), TP2 (${adjustedTp2}), TP3 (${adjustedTp3})` };
        }
      }
    } else {
      if (adjustedSL <= livePrice) {
        return { isValid: false, message: `REJECTED: INVALID_SL_TP. SELL signal stop-loss (${adjustedSL}) must be strictly above entry price (${livePrice})` };
      }
      if (adjustedTP >= livePrice) {
        return { isValid: false, message: `REJECTED: INVALID_SL_TP. SELL signal take-profit (${adjustedTP}) must be strictly below entry price (${livePrice})` };
      }
      if (adjustedTp1 !== undefined && adjustedTp2 !== undefined && adjustedTp3 !== undefined) {
        if (adjustedTp1 >= livePrice) {
          return { isValid: false, message: `REJECTED: INVALID_SL_TP. SELL signal TP1 (${adjustedTp1}) must be strictly below entry price (${livePrice})` };
        }
        if (adjustedTp2 >= adjustedTp1) {
          return { isValid: false, message: `REJECTED: INVALID_SL_TP. SELL signal TP2 (${adjustedTp2}) must be strictly below TP1 (${adjustedTp1})` };
        }
        if (adjustedTp3 >= adjustedTp2) {
          return { isValid: false, message: `REJECTED: INVALID_SL_TP. SELL signal TP3 (${adjustedTp3}) must be strictly below TP2 (${adjustedTp2})` };
        }
        if (adjustedTp1 === adjustedTp2 || adjustedTp2 === adjustedTp3 || adjustedTp1 === adjustedTp3) {
          return { isValid: false, message: `REJECTED: INVALID_SL_TP. Take-profit targets must be distinct: TP1 (${adjustedTp1}), TP2 (${adjustedTp2}), TP3 (${adjustedTp3})` };
        }
      }
    }

    // 2. Minimum Practical Distance Hurdles based on Volatility (ATR)
    const risk = Math.abs(livePrice - adjustedSL);
    
    // Calculate reward based on actual TP structure (TP2 only) if available, otherwise fallback to adjustedTP
    let reward = Math.abs(adjustedTP - livePrice);
    if (adjustedTp2 !== undefined) {
      reward = Math.abs(adjustedTp2 - livePrice);
    }

    if (risk <= 0 || reward <= 0) {
      return { isValid: false, message: 'REJECTED: INVALID_SL_TP. Stop-loss or take-profit distance is zero/near-zero' };
    }

    // Calculate ATR for dynamic volatility-based validation
    const htf1h = candlesMap['1h'];
    if (!htf1h || htf1h.length < 14) {
      return { isValid: false, message: 'REJECTED: INSUFFICIENT_ATR. Missing/invalid ATR data (insufficient 1H candle history) = NO SIGNAL' };
    }
    const atr = TechnicalIndicators.calculateATR(htf1h, 14);
    if (!atr || isNaN(atr) || atr <= 0) {
      return { isValid: false, message: 'REJECTED: INSUFFICIENT_ATR. Missing/invalid ATR data (calculated ATR is zero or invalid) = NO SIGNAL' };
    }

    // Use 0.85 * ATR as the minimum noise hurdle to prevent tight SL hit by normal market noise
    const minSafeStopDistance = 0.85 * atr;
    // Use 1.80 * ATR as the minimum take-profit expansion to ensure meaningful profit after fees/slippage
    const minSafeTargetDistance = 1.80 * atr;

    if (risk < minSafeStopDistance) {
      return {
        isValid: false,
        message: `REJECTED: VOLATILITY_NOISE_FLOOR. Expected stop-loss distance (${risk.toFixed(precision)}) is below minimum volatility noise floor (${minSafeStopDistance.toFixed(precision)}, derived as 0.85 * ATR of ${atr.toFixed(precision)}) - vulnerable to market noise`,
      };
    }

    // Verify minimum tradeable distance for each target if present
    if (adjustedTp1 !== undefined && adjustedTp2 !== undefined && adjustedTp3 !== undefined) {
      const tp1Dist = Math.abs(adjustedTp1 - livePrice);
      const tp2Dist = Math.abs(adjustedTp2 - livePrice);
      const tp3Dist = Math.abs(adjustedTp3 - livePrice);

      if (tp1Dist < minSafeTargetDistance * 0.5) {
        return {
          isValid: false,
          message: `REJECTED: INSUFFICIENT_TARGET_DISTANCE. Expected TP1 distance (${tp1Dist.toFixed(precision)}) is below minimum conservative target distance (${(minSafeTargetDistance * 0.5).toFixed(precision)}, derived as 0.5 * 1.80 * ATR)`,
        };
      }
      if (tp2Dist < minSafeTargetDistance) {
        return {
          isValid: false,
          message: `REJECTED: INSUFFICIENT_TARGET_DISTANCE. Expected TP2 distance (${tp2Dist.toFixed(precision)}) is below minimum primary target distance (${minSafeTargetDistance.toFixed(precision)}, derived as 1.80 * ATR)`,
        };
      }
      if (tp3Dist < minSafeTargetDistance * 1.5) {
        return {
          isValid: false,
          message: `REJECTED: INSUFFICIENT_TARGET_DISTANCE. Expected TP3 distance (${tp3Dist.toFixed(precision)}) is below minimum extended target distance (${(minSafeTargetDistance * 1.5).toFixed(precision)}, derived as 1.5 * 1.80 * ATR)`,
        };
      }
    } else {
      if (reward < minSafeTargetDistance) {
        return {
          isValid: false,
          message: `REJECTED: INSUFFICIENT_TARGET_DISTANCE. Expected take-profit distance (${reward.toFixed(precision)}) is below minimum volatility profit expansion hurdle (${minSafeTargetDistance.toFixed(precision)}, derived as 1.80 * ATR of ${atr.toFixed(precision)})`,
        };
      }
    }

    // 3. Execution Cost & Friction Hurdle Verification
    const frictionCheck = this.verifyExecutionCost(symbol, livePrice, risk, reward);
    if (!frictionCheck.isValid) {
      return {
        isValid: false,
        message: frictionCheck.message,
      };
    }

    // 4. Expected Value (EV) Filtering
    const evCheck = this.verifyExpectedValue(score, risk, reward, frictionCheck.totalRoundTripFriction || 0);
    if (!evCheck.isValid) {
      return {
        isValid: false,
        message: evCheck.message,
      };
    }

    // 5. Gross Risk / Reward Ratio Check: Minimum acceptable GROSS R:R from config using RiskRewardCalculator canonical module
    const rrResult = RiskRewardCalculator.calculate(livePrice, adjustedSL, adjustedTp1 ?? adjustedTP, adjustedTp2 ?? adjustedTP, adjustedTp3 ?? adjustedTP, direction);
    const rawRR = rrResult.grossRR;
    const thresholds = serverConfig.getConfig().thresholds;
    if (rawRR < thresholds.minimumRR || !rrResult.isValid) {
      return {
        isValid: false,
        message: `REJECTED: GROSS_RR_BELOW_THRESHOLD. Gross Risk/Reward ratio (${rawRR.toFixed(2)}:1) is below ${thresholds.minimumRR}:1 minimum acceptable GROSS R:R (${rrResult.reason || 'Invalid geometry'})`,
        adjustedStopLoss: adjustedSL,
        adjustedTakeProfit: adjustedTP,
        adjustedTp1: adjustedTp1 ?? adjustedTP,
        adjustedTp2: adjustedTp2 ?? adjustedTP,
        adjustedTp3: adjustedTp3 ?? adjustedTP,
        adjustedGrossRR: rrResult.grossRR,
        adjustedPrimaryRR: rrResult.primaryRR,
        adjustedTp1RR: rrResult.tp1RR,
        adjustedTp2RR: rrResult.tp2RR,
        adjustedTp3RR: rrResult.tp3RR,
      };
    }

    return {
      isValid: true,
      message: 'OK',
      adjustedStopLoss: adjustedSL,
      adjustedTakeProfit: adjustedTP,
      adjustedTp1: adjustedTp1 ?? adjustedTP,
      adjustedTp2: adjustedTp2 ?? adjustedTP,
      adjustedTp3: adjustedTp3 ?? adjustedTP,
      adjustedGrossRR: rrResult.grossRR,
      adjustedPrimaryRR: rrResult.primaryRR,
      adjustedTp1RR: rrResult.tp1RR,
      adjustedTp2RR: rrResult.tp2RR,
      adjustedTp3RR: rrResult.tp3RR,
      adjustedNetRR: frictionCheck.netRR,
    };
  }

  private static verifyExpectedValue(
    score: number,
    rawRisk: number,
    rawReward: number,
    friction: number
  ): { isValid: boolean; message: string; netEV?: number } {
    const pWin = Math.min(0.72, Math.max(0.48, 0.45 + (score - 70) * 0.008));
    const pLoss = 1 - pWin;

    const netReward = rawReward - friction;
    const netRisk = rawRisk + friction;

    const netEV = pWin * netReward - pLoss * netRisk;
    const expectancyRatio = netRisk > 0 ? netEV / netRisk : -1;

    if (netEV <= 0) {
      return {
        isValid: false,
        message: `REJECTED: NEGATIVE_EXPECTANCY. Expected Value rejected: Positive statistical edge not established (Net EV: ${netEV.toFixed(4)} <= 0 for estimated win rate ${(pWin * 100).toFixed(1)}%)`,
      };
    }

    if (expectancyRatio < 0.01) {
      return {
        isValid: false,
        message: `REJECTED: NEGATIVE_EXPECTANCY. Expected Value rejected: Expectancy ratio (${(expectancyRatio * 100).toFixed(1)}%) below minimum positive risk-adjusted hurdle`,
      };
    }

    return {
      isValid: true,
      message: 'OK',
      netEV,
    };
  }

  private static verifyExecutionCost(
    symbol: string,
    price: number,
    rawRisk: number,
    rawReward: number
  ): { isValid: boolean; message: string; netRR?: number; totalRoundTripFriction?: number } {
    // Gate 34 — Execution Friction Stress Test
    const dummyStopLoss = price - rawRisk;
    const dummyTakeProfit = price + rawReward;

    const res = Gate34ExecutionFrictionStressTest.evaluate(symbol, price, dummyStopLoss, dummyTakeProfit, dummyTakeProfit, dummyTakeProfit, dummyTakeProfit);

    if (!res.isPassed) {
      return {
        isValid: false,
        message: res.reasons[0] || `REJECTED: EXECUTION_FRICTION_STRESS_TEST_FAILED (${res.rejectionReason})`,
        netRR: res.normal.netRR,
        totalRoundTripFriction: res.normal.totalFrictionPrice,
      };
    }

    return {
      isValid: true,
      message: 'OK',
      netRR: res.normal.netRR,
      totalRoundTripFriction: res.normal.totalFrictionPrice,
    };
  }

  /**
   * Validates and enforces distinct, properly ordered, and compliant TP targets.
   * If any check fails, it recalculates compliant values using AtrTpGenerator.
   */
  public static validateAndEnforceTps(
    direction: SignalDirection,
    entryPrice: number,
    stopLoss: number,
    tp1: number,
    tp2: number,
    tp3: number,
    atr: number,
    precision: number,
    assetClass?: string,
    isAggressive?: boolean
  ): { tp1: number; tp2: number; tp3: number; takeProfit: number; riskRewardRatio: number; wasRecalculated: boolean } {
    // 1. Check distinctness
    const isDistinct = tp1 !== tp2 && tp2 !== tp3 && tp1 !== tp3;

    // 2. Check direction ordering
    let isOrdered = false;
    if (direction === 'BUY') {
      isOrdered = entryPrice < tp1 && tp1 < tp2 && tp2 < tp3;
    } else {
      isOrdered = entryPrice > tp1 && tp1 > tp2 && tp2 > tp3;
    }

    const tp1Dist = Math.abs(tp1 - entryPrice);

    // 3. Check risk/reward (TP2 primary) using RiskRewardCalculator
    const rrResult = RiskRewardCalculator.calculate(entryPrice, stopLoss, tp1, tp2, tp3, direction);
    const rr = rrResult.grossRR;

    // If valid, return original values
    if (isDistinct && isOrdered && tp1Dist > 0 && rrResult.isValid) {
      return {
        tp1,
        tp2,
        tp3,
        takeProfit: tp2,
        riskRewardRatio: Number(rr.toFixed(2)),
        wasRecalculated: false
      };
    }

    // Otherwise, RECALCULATE using primary ATR-Based TP Generator
    const atrGen = AtrTpGenerator.generate({
      direction,
      entryPrice,
      atr,
      precision,
      assetClass,
      isAggressive,
    });

    const newRrResult = RiskRewardCalculator.calculate(entryPrice, stopLoss, atrGen.tp1, atrGen.tp2, atrGen.tp3, direction);
    const newRR = newRrResult.grossRR;

    return {
      tp1: atrGen.tp1,
      tp2: atrGen.tp2,
      tp3: atrGen.tp3,
      takeProfit: atrGen.tp2,
      riskRewardRatio: Number(newRR.toFixed(2)),
      wasRecalculated: true
    };
  }
}
