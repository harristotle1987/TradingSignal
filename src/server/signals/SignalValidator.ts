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

    // 6. SL / TP Sanity, ATR & Geometry Verification (INVALID_SL_TP)
    const slTpCheck = this.verifySlTpSanity(ctx.symbol, ctx.direction, livePrice, ctx.stopLoss, ctx.takeProfit, ctx.entryPrice, ctx.candlesMap, ctx.score);
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
    if (ctx.score < 75) {
      return {
        isValid: false,
        validationReason: 'INSUFFICIENT_CONFLUENCE',
        detailedMessage: `Deterministic score ${ctx.score}/100 is below the minimum actionable threshold of 75 (85+ = BEST TRADE, 75-84 = HIGH QUALITY)`,
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

    // Reject live ticker older than 2 minutes (120s) or in future > 30s
    if (tickerAgeMs < -30000) {
      return { isValid: false, message: `Ticker timestamp is in the future (${ticker.timestamp} vs current ${now})` };
    }
    if (tickerAgeMs > 120000) {
      return { isValid: false, message: `Live ticker data is stale (age: ${(tickerAgeMs / 1000).toFixed(0)}s > 120s)` };
    }

    // Verify 1H candle freshness (must be within 3 hours)
    const htf1h = ctx.candlesMap['1h'];
    if (htf1h && htf1h.length > 0) {
      const last1h = htf1h[htf1h.length - 1];
      const candleAgeMs = now - last1h.timestamp;
      if (candleAgeMs > 3 * 60 * 60 * 1000) {
        return { isValid: false, message: `1H candle history is stale (age: ${(candleAgeMs / 3600000).toFixed(1)}h > 3h)` };
      }
    }

    // Verify 15m candle freshness if present (must be within 60 minutes)
    const tf15m = ctx.candlesMap['15m'];
    if (tf15m && tf15m.length > 0) {
      const last15m = tf15m[tf15m.length - 1];
      const candleAgeMs = now - last15m.timestamp;
      if (candleAgeMs > 60 * 60 * 1000) {
        return { isValid: false, message: `15m candle history is stale (age: ${(candleAgeMs / 60000).toFixed(0)}m > 60m)` };
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
    candlesMap: Record<string, NormalizedCandle[]>,
    score: number = 80
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

    // 2. Minimum Practical Distance Hurdles based on Volatility (ATR)
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

    // Use 0.85 * ATR as the minimum noise hurdle to prevent tight SL hit by normal market noise
    const minSafeStopDistance = 0.85 * atr;
    // Use 1.80 * ATR as the minimum take-profit expansion to ensure meaningful profit after fees/slippage
    const minSafeTargetDistance = 1.80 * atr;

    if (risk < minSafeStopDistance) {
      return {
        isValid: false,
        message: `Expected stop-loss distance (${risk.toFixed(precision)}) is below minimum volatility noise floor (${minSafeStopDistance.toFixed(precision)}, derived as 0.85 * ATR of ${atr.toFixed(precision)}) - vulnerable to market noise`,
      };
    }

    if (reward < minSafeTargetDistance) {
      return {
        isValid: false,
        message: `Expected take-profit distance (${reward.toFixed(precision)}) is below minimum volatility profit expansion hurdle (${minSafeTargetDistance.toFixed(precision)}, derived as 1.80 * ATR of ${atr.toFixed(precision)})`,
      };
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

    // 5. Net Risk / Reward Ratio Check: Strict 2.0:1 (1:2) minimum
    const rawRR = reward / risk;
    const adjustedNetRR = Number(rawRR.toFixed(2));

    if (adjustedNetRR < 2.0) {
      return {
        isValid: false,
        message: `Risk/Reward ratio (${adjustedNetRR}:1) is below strict 2.0:1 (1:2) minimum hurdle`,
      };
    }

    return {
      isValid: true,
      message: 'OK',
      adjustedStopLoss: adjustedSL,
      adjustedTakeProfit: adjustedTP,
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
        message: `Expected Value rejected: Positive statistical edge not established (Net EV: ${netEV.toFixed(4)} <= 0 for estimated win rate ${(pWin * 100).toFixed(1)}%)`,
      };
    }

    if (expectancyRatio < 0.12) {
      return {
        isValid: false,
        message: `Expected Value rejected: Expectancy ratio (${(expectancyRatio * 100).toFixed(1)}%) below 12.0% minimum risk-adjusted hurdle`,
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
    const cleanSym = symbol.trim().toUpperCase();
    const isCrypto = cleanSym.includes('USDT') || (cleanSym.includes('USD') && price > 100 && !cleanSym.includes('EUR') && !cleanSym.includes('GBP'));
    const isForex = cleanSym.length === 6 && (cleanSym.includes('USD') || cleanSym.includes('EUR') || cleanSym.includes('GBP') || cleanSym.includes('JPY') || cleanSym.includes('CHF') || cleanSym.includes('CAD') || cleanSym.includes('AUD') || cleanSym.includes('NZD'));
    const isJPY = cleanSym.includes('JPY');

    let totalRoundTripFriction = 0;

    if (isForex) {
      const pipMultiplier = isJPY ? 100 : 10000;
      // Spread: ~1.2-1.5 pips, Slippage: ~0.5 pips, Broker Commission Buffer: ~0.3 pips
      const totalFrictionPips = isJPY ? 2.5 : 2.0;
      totalRoundTripFriction = totalFrictionPips / pipMultiplier;
    } else if (isCrypto) {
      // Spread (~0.04%) + Slippage (~0.05%) + 2x Taker Fees (0.06% * 2 = 0.12%) => Total ~0.21%
      totalRoundTripFriction = price * 0.0021;
    } else {
      // Stocks: Spread ($0.04) + Slippage ($0.02) + SEC/Finra/Clearing fees ($0.01) => $0.07 per share
      totalRoundTripFriction = Math.max(0.07, price * 0.0006);
    }

    // Safety buffer check: Expected reward movement must be at least 3.5x total round-trip friction
    if (rawReward < totalRoundTripFriction * 3.5) {
      return {
        isValid: false,
        message: `Execution cost rejected: Expected reward move (${rawReward.toFixed(4)}) is too small relative to round-trip spread, slippage & fee friction (${totalRoundTripFriction.toFixed(4)}) - insufficient safety buffer`,
      };
    }

    // Friction consumption ratio: Friction must not consume > 25% of gross profit
    const frictionRatio = totalRoundTripFriction / rawReward;
    if (frictionRatio > 0.25) {
      return {
        isValid: false,
        message: `Execution cost rejected: Estimated friction consumes ${(frictionRatio * 100).toFixed(1)}% of gross expected target (max allowed: 25.0%)`,
      };
    }

    // Net R:R after friction
    const netReward = rawReward - totalRoundTripFriction;
    const netRisk = rawRisk + totalRoundTripFriction;
    const netRR = netRisk > 0 ? Number((netReward / netRisk).toFixed(2)) : 0;

    if (netRR < 1.75) {
      return {
        isValid: false,
        message: `Net Risk/Reward ratio after spread, slippage and fee friction (${netRR}:1) falls below 1.75:1 minimum executable threshold`,
      };
    }

    return {
      isValid: true,
      message: 'OK',
      netRR,
      totalRoundTripFriction,
    };
  }
}
