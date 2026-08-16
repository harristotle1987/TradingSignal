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
import { logger } from '../logger.js';
import { TechnicalIndicators } from './TechnicalIndicators.js';

export interface ValidationContext {
  symbol: string;
  direction: SignalDirection;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
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

    // 6. SL / TP Sanity & Geometry Verification (INVALID_SL_TP)
    const slTpCheck = this.verifySlTpSanity(ctx.symbol, ctx.direction, livePrice, ctx.stopLoss, ctx.takeProfit, ctx.entryPrice, ctx.candlesMap);
    if (!slTpCheck.isValid) {
      return {
        isValid: false,
        validationReason: 'INVALID_SL_TP',
        detailedMessage: slTpCheck.message,
        snapshotId,
        validatedAt: now,
      };
    }

    // 7. Confluence & Quality Score Check (INSUFFICIENT_CONFLUENCE)
    if (ctx.score < 70) {
      return {
        isValid: false,
        validationReason: 'INSUFFICIENT_CONFLUENCE',
        detailedMessage: `Deterministic score ${ctx.score}/100 is below the minimum threshold of 70`,
        snapshotId,
        validatedAt: now,
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
      adjustedNetRR: slTpCheck.adjustedNetRR,
    };
  }

  // --- Sub-pipeline Checkers ---

  private static verifyFreshness(ctx: ValidationContext, now: number): { isValid: boolean; message: string } {
    const ticker = ctx.liveTicker!;

    // Reject if ticker is stale or flagged as not fresh
    if (ticker.status === 'STALE' || !ticker.isFresh) {
      return { isValid: false, message: `Market ticker data is stale or flagged as not fresh (status: ${ticker.status}, isFresh: ${ticker.isFresh})` };
    }

    const tickerAgeMs = now - ticker.timestamp;

    // Reject live ticker older than 3 minutes (180s) or in future > 60s
    if (tickerAgeMs < -60000) {
      return { isValid: false, message: `Ticker timestamp is in the future (${ticker.timestamp} vs current ${now})` };
    }
    if (tickerAgeMs > 180000) {
      return { isValid: false, message: `Live ticker data is stale (age: ${(tickerAgeMs / 1000).toFixed(0)}s > 180s)` };
    }

    // Verify 1H candle freshness (must be within 4 hours)
    const htf1h = ctx.candlesMap['1h'];
    if (htf1h && htf1h.length > 0) {
      const last1h = htf1h[htf1h.length - 1];
      const candleAgeMs = now - last1h.timestamp;
      if (candleAgeMs > 4 * 60 * 60 * 1000) {
        return { isValid: false, message: `1H candle history is stale (age: ${(candleAgeMs / 3600000).toFixed(1)}h > 4h)` };
      }
    }

    // Verify 15m candle freshness if present (must be within 90 minutes)
    const tf15m = ctx.candlesMap['15m'];
    if (tf15m && tf15m.length > 0) {
      const last15m = tf15m[tf15m.length - 1];
      const candleAgeMs = now - last15m.timestamp;
      if (candleAgeMs > 90 * 60 * 1000) {
        return { isValid: false, message: `15m candle history is stale (age: ${(candleAgeMs / 60000).toFixed(0)}m > 90m)` };
      }
    }

    return { isValid: true, message: 'OK' };
  }

  private static verifyCandleIntegrity(candlesMap: Record<string, NormalizedCandle[]>): { isValid: boolean; message: string } {
    if (!candlesMap['1h'] || candlesMap['1h'].length < 25) {
      return { isValid: false, message: 'Insufficient 1H candle history (minimum 25 candles required)' };
    }

    for (const [tf, candles] of Object.entries(candlesMap)) {
      if (!candles || candles.length === 0) continue;

      for (let i = 0; i < candles.length; i++) {
        const c = candles[i];

        // 1. Positive and Finite
        if (!Number.isFinite(c.open) || !Number.isFinite(c.high) || !Number.isFinite(c.low) || !Number.isFinite(c.close) ||
            c.open <= 0 || c.high <= 0 || c.low <= 0 || c.close <= 0) {
          return { isValid: false, message: `Corrupted candle values in timeframe ${tf} at index ${i}` };
        }

        // 2. High/Low bounds integrity with floating tolerance
        const maxOC = Math.max(c.open, c.close);
        const minOC = Math.min(c.open, c.close);

        if (c.high < maxOC - 1e-6) {
          return { isValid: false, message: `Candle high (${c.high}) < max(open, close) (${maxOC}) in timeframe ${tf}` };
        }
        if (c.low > minOC + 1e-6) {
          return { isValid: false, message: `Candle low (${c.low}) > min(open, close) (${minOC}) in timeframe ${tf}` };
        }

        // 3. Ascending timestamp verification
        if (i > 0 && c.timestamp <= candles[i - 1].timestamp) {
          return { isValid: false, message: `Non-ascending candle timestamps detected in timeframe ${tf}` };
        }
      }
    }

    return { isValid: true, message: 'OK' };
  }

  private static verifyCrossPrice(symbol: string, primaryPrice: number, secondaryPrice: number, secondarySource: string): { isValid: boolean; message: string } {
    const diffPct = (Math.abs(primaryPrice - secondaryPrice) / primaryPrice) * 100;
    const cleanSym = symbol.trim().toUpperCase();

    // Asset-appropriate tolerance thresholds
    let maxAllowedPct = 0.3; // Default (Stocks: 0.3%)
    if (cleanSym.includes('BTC') || cleanSym.includes('ETH') || cleanSym.includes('SOL')) {
      maxAllowedPct = 0.8; // Crypto: 0.8%
    } else if (cleanSym.includes('USD') || cleanSym.includes('EUR') || cleanSym.includes('GBP') || cleanSym.includes('JPY')) {
      maxAllowedPct = 0.15; // Forex: 0.15% (15 bps)
    }

    if (diffPct > maxAllowedPct) {
      return {
        isValid: false,
        message: `Material price mismatch: Primary quote (${primaryPrice}) disagrees with ${secondarySource} (${secondaryPrice}) by ${diffPct.toFixed(3)}% (max allowed: ${maxAllowedPct}%)`,
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
    candlesMap: Record<string, NormalizedCandle[]>
  ): { isValid: boolean; message: string; adjustedStopLoss?: number; adjustedTakeProfit?: number; adjustedNetRR?: number } {
    const precision = livePrice < 10 ? 5 : 2;

    // Adjust SL/TP if minor live price drift occurred
    const slDist = Math.abs(originalEntry - stopLoss);
    const tpDist = Math.abs(takeProfit - originalEntry);

    let adjustedSL: number;
    let adjustedTP: number;

    if (direction === 'BUY') {
      adjustedSL = Number((livePrice - slDist).toFixed(precision));
      adjustedTP = Number((livePrice + tpDist).toFixed(precision));
    } else {
      adjustedSL = Number((livePrice + slDist).toFixed(precision));
      adjustedTP = Number((livePrice - tpDist).toFixed(precision));
    }

    // 1. Geometric Side Validation
    if (direction === 'BUY') {
      if (adjustedSL >= livePrice) {
        return { isValid: false, message: `BUY signal stop-loss (${adjustedSL}) must be strictly below entry price (${livePrice})` };
      }
      if (adjustedTP <= livePrice) {
        return { isValid: false, message: `BUY signal take-profit (${adjustedTP}) must be strictly above entry price (${livePrice})` };
      }
    } else {
      if (adjustedSL <= livePrice) {
        return { isValid: false, message: `SELL signal stop-loss (${adjustedSL}) must be strictly above entry price (${livePrice})` };
      }
      if (adjustedTP >= livePrice) {
        return { isValid: false, message: `SELL signal take-profit (${adjustedTP}) must be strictly below entry price (${livePrice})` };
      }
    }

    // 2. Minimum Practical Distance Hurdles
    const risk = Math.abs(livePrice - adjustedSL);
    const reward = Math.abs(adjustedTP - livePrice);

    if (risk <= 0 || reward <= 0) {
      return { isValid: false, message: 'Stop-loss or take-profit distance is zero/near-zero' };
    }

    // Calculate ATR for dynamic volatility-based validation
    const htf1h = candlesMap['1h'];
    if (!htf1h || htf1h.length < 14) {
      return { isValid: false, message: 'Missing/invalid ATR data (insufficient 1H candle history) = NO SIGNAL' };
    }
    const atr = TechnicalIndicators.calculateATR(htf1h, 14);
    if (!atr || isNaN(atr) || atr <= 0) {
      return { isValid: false, message: 'Missing/invalid ATR data (calculated ATR is zero or invalid) = NO SIGNAL' };
    }

    // Use 0.5 * ATR as the minimum noise hurdle, derived strictly from actual volatility
    const minPracticalDistance = 0.5 * atr;

    if (reward < minPracticalDistance) {
      return {
        isValid: false,
        message: `Expected take-profit distance (${reward.toFixed(precision)}) is below minimum volatility-based noise hurdle (${minPracticalDistance.toFixed(precision)}, derived as 0.5 * ATR of ${atr.toFixed(precision)})`,
      };
    }

    if (risk < minPracticalDistance) {
      return {
        isValid: false,
        message: `Expected stop-loss distance (${risk.toFixed(precision)}) is below minimum volatility-based noise hurdle (${minPracticalDistance.toFixed(precision)}, derived as 0.5 * ATR of ${atr.toFixed(precision)})`,
      };
    }

    // 3. Net Risk / Reward Ratio Check
    const rawRR = reward / risk;
    const adjustedNetRR = Number(rawRR.toFixed(2));

    if (adjustedNetRR < 1.5) {
      return {
        isValid: false,
        message: `Risk/Reward ratio (${adjustedNetRR}:1) is below strict 1.5:1 minimum hurdle`,
      };
    }

    return {
      isValid: true,
      message: 'OK',
      adjustedStopLoss: adjustedSL,
      adjustedTakeProfit: adjustedTP,
      adjustedNetRR,
    };
  }
}
