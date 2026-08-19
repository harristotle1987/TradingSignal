/**
 * GATE 13: BREAKOUT QUALITY ENGINE
 * 
 * Additive analytics module that evaluates the validity and structural strength of market breakouts.
 * Distinguishes genuine high-conviction breakouts from weak breakouts and liquidity traps / false breakouts.
 * 
 * EVALUATES:
 * 1. Consolidation duration & range stability
 * 2. Range compression (coiling ratio)
 * 3. ATR compression prior to breakout
 * 4. Breakout candle displacement & closing strength
 * 5. Relative volume expansion
 * 6. Distance to next major opposing support/resistance
 * 7. Retest dynamics (confirmed, pending, failed, none)
 * 8. Breakout direction (Bullish vs Bearish)
 * 9. Liquidity sweep vs clean structural break
 * 10. False-breakout characteristics (wick traps, immediate rejection back into range)
 * 
 * CLASSIFICATIONS:
 * - STRONG_BREAKOUT
 * - MODERATE_BREAKOUT
 * - WEAK_BREAKOUT
 * - FALSE_BREAKOUT
 * - UNCONFIRMED_BREAKOUT
 * 
 * RULES:
 * - Additive analytics only; does NOT replace existing strategies or force trade generation.
 * - Penalizes breakouts occurring directly into major opposing S/R zones.
 * - Prevents maximum confidence when structural confirmation is absent.
 */

import { NormalizedCandle, SignalDirection } from '../../types/index.js';
import { TechnicalIndicators } from './TechnicalIndicators.js';
import { Gate5SupportResistance } from './Gate5Liquidity.js';

export type BreakoutQuality =
  | 'STRONG_BREAKOUT'
  | 'MODERATE_BREAKOUT'
  | 'WEAK_BREAKOUT'
  | 'FALSE_BREAKOUT'
  | 'UNCONFIRMED_BREAKOUT';

export type BreakoutType =
  | 'RANGE_BREAKOUT'
  | 'SWING_BREAKOUT'
  | 'VOLATILITY_EXPANSION'
  | 'FALSE_EXPANSION'
  | 'NONE';

export type RetestStatus =
  | 'CONFIRMED_RETEST'
  | 'PENDING_RETEST'
  | 'FAILED_RETEST'
  | 'NO_RETEST';

export type VolumeConfirmation =
  | 'STRONG_VOLUME'
  | 'MODERATE_VOLUME'
  | 'WEAK_VOLUME'
  | 'DIVERGENT_VOLUME';

export interface Gate13BreakoutResult {
  breakoutQuality: BreakoutQuality;
  breakoutScore: number; // 0-100
  breakoutType: BreakoutType;
  retestStatus: RetestStatus;
  volumeConfirmation: VolumeConfirmation;
  breakoutDirection: 'BULLISH' | 'BEARISH' | 'NONE';
  metrics: {
    consolidationBars: number;
    rangeCompressionRatio: number;
    atrCompressionRatio: number;
    breakoutCandleBodyPct: number;
    relativeVolume: number;
    distanceToOpposingSrATR: number;
    isLiquiditySweep: boolean;
    isWickTrap: boolean;
  };
  reasons: string[];
  summary: string;
}

export class Gate13BreakoutQuality {
  /**
   * Evaluates breakout quality across recent market candles.
   */
  public static analyze(
    candles: NormalizedCandle[],
    proposedDirection?: SignalDirection,
    consolidationLookback = 20
  ): Gate13BreakoutResult {
    // 1. Data sanity check
    if (!candles || candles.length < 25) {
      return this.createNeutralResult(['Insufficient candle history for breakout quality analysis (minimum 25 required)']);
    }

    const sortedCandles = [...candles].sort((a, b) => a.timestamp - b.timestamp);
    const len = sortedCandles.length;
    const lastCandle = sortedCandles[len - 1];
    const prevCandle = sortedCandles[len - 2];

    // 2. Identify consolidation window preceding the latest 1-3 candles
    const lookback = Math.min(consolidationLookback, Math.floor(len * 0.6));
    const rangeStartIdx = Math.max(0, len - 3 - lookback);
    const rangeEndIdx = len - 3;
    const consolidationCandles = sortedCandles.slice(rangeStartIdx, rangeEndIdx + 1);

    if (consolidationCandles.length < 5) {
      return this.createNeutralResult(['Insufficient consolidation bars identified for range measurement']);
    }

    // 3. Compute Consolidation Range Bounds
    let rangeHigh = -Infinity;
    let rangeLow = Infinity;
    let totalVol = 0;

    for (const c of consolidationCandles) {
      if (c.high > rangeHigh) rangeHigh = c.high;
      if (c.low < rangeLow) rangeLow = c.low;
      totalVol += c.volume;
    }

    const rangeSpan = rangeHigh - rangeLow;
    const avgConsolidationVol = totalVol / consolidationCandles.length;

    // 4. Volatility & ATR Compression
    const fullAtr = TechnicalIndicators.calculateATR(sortedCandles, 14);
    const baselineAtr = fullAtr > 0 ? fullAtr : (rangeSpan > 0 ? rangeSpan / 3 : lastCandle.close * 0.005);
    
    // Pre-breakout ATR compression (ATR of consolidation vs total)
    const consolidationAtr = TechnicalIndicators.calculateATR(consolidationCandles, Math.min(14, consolidationCandles.length - 1));
    const atrCompressionRatio = baselineAtr > 0 ? (consolidationAtr > 0 ? consolidationAtr / baselineAtr : 1.0) : 1.0;
    const rangeCompressionRatio = baselineAtr > 0 ? rangeSpan / (baselineAtr * consolidationCandles.length * 0.25) : 1.0;

    // 5. Breakout Candle Identification & Displacement
    // Test if breakout occurred on lastCandle or prevCandle
    let breakoutCandle = lastCandle;
    let subsequentCandle: NormalizedCandle | null = null;
    let isBullishBreakout = false;
    let isBearishBreakout = false;

    // Bullish break: closed above rangeHigh
    if (lastCandle.close > rangeHigh) {
      breakoutCandle = lastCandle;
      isBullishBreakout = true;
    } else if (prevCandle.close > rangeHigh) {
      breakoutCandle = prevCandle;
      subsequentCandle = lastCandle;
      isBullishBreakout = true;
    }

    // Bearish break: closed below rangeLow
    if (lastCandle.close < rangeLow) {
      breakoutCandle = lastCandle;
      isBearishBreakout = true;
    } else if (prevCandle.close < rangeLow) {
      breakoutCandle = prevCandle;
      subsequentCandle = lastCandle;
      isBearishBreakout = true;
    }

    // Check for Wick Traps / Probes without close
    const isWickTrapBullish = lastCandle.high > rangeHigh && lastCandle.close <= rangeHigh;
    const isWickTrapBearish = lastCandle.low < rangeLow && lastCandle.close >= rangeLow;
    const isWickTrap = isWickTrapBullish || isWickTrapBearish;

    // Direction alignment
    let breakoutDirection: 'BULLISH' | 'BEARISH' | 'NONE' = 'NONE';
    if (isBullishBreakout) breakoutDirection = 'BULLISH';
    else if (isBearishBreakout) breakoutDirection = 'BEARISH';
    else if (isWickTrapBullish) breakoutDirection = 'BULLISH';
    else if (isWickTrapBearish) breakoutDirection = 'BEARISH';

    // 6. Breakout Candle Displacement Metrics
    const candleTotalRange = Math.max(breakoutCandle.high - breakoutCandle.low, 0.00001);
    const candleBodySize = Math.abs(breakoutCandle.close - breakoutCandle.open);
    const breakoutCandleBodyPct = (candleBodySize / candleTotalRange) * 100;

    // 7. Relative Volume Assessment
    const relativeVolume = avgConsolidationVol > 0 ? breakoutCandle.volume / avgConsolidationVol : 1.0;
    let volumeConfirmation: VolumeConfirmation = 'WEAK_VOLUME';
    if (relativeVolume >= 1.6) volumeConfirmation = 'STRONG_VOLUME';
    else if (relativeVolume >= 1.15) volumeConfirmation = 'MODERATE_VOLUME';
    else if (relativeVolume < 0.75) volumeConfirmation = 'DIVERGENT_VOLUME';

    // 8. Liquidity Sweep Detection
    let isLiquiditySweep = false;
    if (isWickTrap) {
      isLiquiditySweep = true;
    } else if (subsequentCandle) {
      // If candle closed outside range, but next candle aggressively collapsed back inside range
      if (isBullishBreakout && subsequentCandle.close < rangeHigh) {
        isLiquiditySweep = true;
      } else if (isBearishBreakout && subsequentCandle.close > rangeLow) {
        isLiquiditySweep = true;
      }
    }

    // 9. Retest Behavior Evaluation
    let retestStatus: RetestStatus = 'NO_RETEST';
    if (isBullishBreakout) {
      if (subsequentCandle) {
        if (subsequentCandle.low <= rangeHigh * 1.002 && subsequentCandle.close > rangeHigh) {
          retestStatus = 'CONFIRMED_RETEST';
        } else if (subsequentCandle.close < rangeHigh) {
          retestStatus = 'FAILED_RETEST';
        } else {
          retestStatus = 'PENDING_RETEST';
        }
      } else {
        retestStatus = 'PENDING_RETEST';
      }
    } else if (isBearishBreakout) {
      if (subsequentCandle) {
        if (subsequentCandle.high >= rangeLow * 0.998 && subsequentCandle.close < rangeLow) {
          retestStatus = 'CONFIRMED_RETEST';
        } else if (subsequentCandle.close > rangeLow) {
          retestStatus = 'FAILED_RETEST';
        } else {
          retestStatus = 'PENDING_RETEST';
        }
      } else {
        retestStatus = 'PENDING_RETEST';
      }
    }

    // 10. Distance to Next Opposing S/R Zone
    let distanceToOpposingSrATR = 3.0; // Default healthy buffer
    try {
      const gate5Res = Gate5SupportResistance.analyze(
        breakoutDirection === 'BEARISH' ? 'SELL' : 'BUY',
        sortedCandles
      );
      if (breakoutDirection === 'BULLISH' && gate5Res.nearestResistance) {
        const dist = gate5Res.nearestResistance.bottom - lastCandle.close;
        distanceToOpposingSrATR = baselineAtr > 0 ? Math.max(0, dist / baselineAtr) : 3.0;
      } else if (breakoutDirection === 'BEARISH' && gate5Res.nearestSupport) {
        const dist = lastCandle.close - gate5Res.nearestSupport.top;
        distanceToOpposingSrATR = baselineAtr > 0 ? Math.max(0, dist / baselineAtr) : 3.0;
      }
    } catch {
      distanceToOpposingSrATR = 3.0;
    }

    // 11. Scoring and Classification Synthesis
    const reasons: string[] = [];
    let breakoutScore = 50;
    let breakoutQuality: BreakoutQuality = 'UNCONFIRMED_BREAKOUT';
    let breakoutType: BreakoutType = 'RANGE_BREAKOUT';

    // A. False Breakout / Trap Checks
    if (isLiquiditySweep || retestStatus === 'FAILED_RETEST' || (isWickTrap && relativeVolume > 1.2)) {
      breakoutQuality = 'FALSE_BREAKOUT';
      breakoutType = 'FALSE_EXPANSION';
      breakoutScore = Math.max(10, Math.round(30 - (relativeVolume > 1.5 ? 10 : 0)));
      reasons.push('False Breakout detected: Price wicked beyond structural boundary but failed to sustain body closure outside range.');
      if (retestStatus === 'FAILED_RETEST') {
        reasons.push('Failed Retest: Price immediately re-entered consolidation zone.');
      }
    } else if (!isBullishBreakout && !isBearishBreakout) {
      // No clear breakout
      breakoutQuality = 'UNCONFIRMED_BREAKOUT';
      breakoutType = 'NONE';
      breakoutScore = 50;
      reasons.push('Price remains within consolidation channel bounds; no active structural breakout.');
    } else {
      // B. Real Breakout Evaluation
      let baseScore = 60;

      // 1. Consolidation Duration bonus (more accumulation = stronger launch)
      if (consolidationCandles.length >= 15) {
        baseScore += 8;
        reasons.push(`Extended consolidation duration (${consolidationCandles.length} bars) provides strong structural base.`);
      } else if (consolidationCandles.length >= 8) {
        baseScore += 4;
      }

      // 2. Range & ATR Compression (Coiling)
      if (atrCompressionRatio < 0.85) {
        baseScore += 8;
        reasons.push(`High pre-breakout volatility compression (ATR ratio: ${atrCompressionRatio.toFixed(2)}x).`);
      }

      // 3. Breakout Candle Strength & Body Displacement
      if (breakoutCandleBodyPct >= 65) {
        baseScore += 10;
        reasons.push(`Strong candle displacement: body represents ${breakoutCandleBodyPct.toFixed(0)}% of candle range with conviction close.`);
      } else if (breakoutCandleBodyPct < 40) {
        baseScore -= 10;
        reasons.push(`Weak candle displacement: small body (${breakoutCandleBodyPct.toFixed(0)}%) with high wicks.`);
      }

      // 4. Volume Confirmation
      if (volumeConfirmation === 'STRONG_VOLUME') {
        baseScore += 12;
        reasons.push(`High relative volume expansion (${relativeVolume.toFixed(1)}x average) confirms institutional participation.`);
      } else if (volumeConfirmation === 'MODERATE_VOLUME') {
        baseScore += 6;
      } else if (volumeConfirmation === 'DIVERGENT_VOLUME') {
        baseScore -= 12;
        reasons.push(`Divergent low volume (${relativeVolume.toFixed(2)}x average) weakens breakout credibility.`);
      }

      // 5. Retest Confirmation
      if (retestStatus === 'CONFIRMED_RETEST') {
        baseScore += 8;
        reasons.push('Confirmed successful retest and rejection of broken structural level.');
      }

      // 6. Opposing S/R Distance & Penalties
      if (distanceToOpposingSrATR < 0.6) {
        baseScore -= 20;
        reasons.push(`CRITICAL PENALTY: Breakout directly into major opposing S/R zone (only ${distanceToOpposingSrATR.toFixed(2)} ATR headroom).`);
      } else if (distanceToOpposingSrATR >= 2.0) {
        baseScore += 5;
        reasons.push(`Clear runway: ${distanceToOpposingSrATR.toFixed(1)} ATR space to nearest major opposing barrier.`);
      }

      // Final score clamp
      breakoutScore = Math.min(98, Math.max(15, baseScore));

      // Quality Classification
      if (breakoutScore >= 80 && distanceToOpposingSrATR >= 1.0 && volumeConfirmation !== 'DIVERGENT_VOLUME') {
        breakoutQuality = 'STRONG_BREAKOUT';
        breakoutType = 'RANGE_BREAKOUT';
      } else if (breakoutScore >= 65) {
        breakoutQuality = 'MODERATE_BREAKOUT';
        breakoutType = 'RANGE_BREAKOUT';
      } else {
        breakoutQuality = 'WEAK_BREAKOUT';
        breakoutType = 'VOLATILITY_EXPANSION';
      }
    }

    const summary = `${breakoutQuality} [${breakoutDirection}] (Score: ${breakoutScore}, Retest: ${retestStatus}, Vol: ${volumeConfirmation})`;

    return {
      breakoutQuality,
      breakoutScore,
      breakoutType,
      retestStatus,
      volumeConfirmation,
      breakoutDirection,
      metrics: {
        consolidationBars: consolidationCandles.length,
        rangeCompressionRatio: Number(rangeCompressionRatio.toFixed(2)),
        atrCompressionRatio: Number(atrCompressionRatio.toFixed(2)),
        breakoutCandleBodyPct: Number(breakoutCandleBodyPct.toFixed(1)),
        relativeVolume: Number(relativeVolume.toFixed(2)),
        distanceToOpposingSrATR: Number(distanceToOpposingSrATR.toFixed(2)),
        isLiquiditySweep,
        isWickTrap,
      },
      reasons,
      summary,
    };
  }

  private static createNeutralResult(reasons: string[]): Gate13BreakoutResult {
    return {
      breakoutQuality: 'UNCONFIRMED_BREAKOUT',
      breakoutScore: 50,
      breakoutType: 'NONE',
      retestStatus: 'NO_RETEST',
      volumeConfirmation: 'WEAK_VOLUME',
      breakoutDirection: 'NONE',
      metrics: {
        consolidationBars: 0,
        rangeCompressionRatio: 1,
        atrCompressionRatio: 1,
        breakoutCandleBodyPct: 0,
        relativeVolume: 1,
        distanceToOpposingSrATR: 3,
        isLiquiditySweep: false,
        isWickTrap: false,
      },
      reasons,
      summary: 'No active breakout analysis available',
    };
  }
}
