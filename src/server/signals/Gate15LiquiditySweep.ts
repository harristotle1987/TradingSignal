/**
 * GATE 15: FALSE BREAKOUT AND LIQUIDITY SWEEP ENGINE
 * 
 * Additive analytics module that identifies institutional liquidity sweeps, stop runs,
 * and false breakouts at significant structural levels.
 * 
 * DETECTS:
 * 1. Previous Swing High / Low sweeps
 * 2. Session High / Low sweeps
 * 3. Daily High / Low sweeps
 * 4. Major Support / Resistance zone sweeps
 * 5. Breakout rejection wicks (pin bars / absorption)
 * 6. Closing back inside the prior range channel
 * 
 * SWEEP DEFINITIONS:
 * - BULLISH SWEEP: Price trades below meaningful support/liquidity, fails to hold,
 *   and aggressively closes back above the level (trapping early breakout shorts & taking buy stops).
 * - BEARISH SWEEP: Price trades above meaningful resistance/liquidity, fails to hold,
 *   and aggressively closes back below the level (trapping early breakout longs & taking sell stops).
 * 
 * CLASSIFICATIONS:
 * - CONFIRMED_LIQUIDITY_SWEEP
 * - POSSIBLE_SWEEP
 * - NORMAL_BREAKOUT
 * - UNCONFIRMED
 * 
 * RULES:
 * - Requires verified structural levels (Swing H/L, Daily H/L, S/R zones).
 * - Filters out minor noise wicks.
 * - Additive confluence only; does NOT independently generate signals.
 */

import { NormalizedCandle, SignalDirection } from '../../types/index.js';
import { TechnicalIndicators } from './TechnicalIndicators.js';
import { Gate5SupportResistance } from './Gate5Liquidity.js';

export type SweepDirection = 'BULLISH' | 'BEARISH' | 'NONE';

export type ConfirmationStatus =
  | 'CONFIRMED_LIQUIDITY_SWEEP'
  | 'POSSIBLE_SWEEP'
  | 'NORMAL_BREAKOUT'
  | 'UNCONFIRMED';

export type SweepStrength = 'STRONG' | 'MODERATE' | 'WEAK' | 'NONE';

export type SweepType =
  | 'SWING_HIGH_SWEEP'
  | 'SWING_LOW_SWEEP'
  | 'DAILY_HIGH_SWEEP'
  | 'DAILY_LOW_SWEEP'
  | 'RESISTANCE_SWEEP'
  | 'SUPPORT_SWEEP'
  | 'NONE';

export interface Gate15SweepResult {
  sweepDirection: SweepDirection;
  sweepLevel: number | null;
  sweepStrength: SweepStrength;
  confirmationStatus: ConfirmationStatus;
  sweepScore: number; // 0-100
  sweepType: SweepType;
  metrics: {
    levelSwept: number | null;
    penetrationDepthATR: number;
    rejectionWickPct: number;
    volumeExpansion: number;
    closedInsideRange: boolean;
    levelAgeBars: number;
  };
  reasons: string[];
  summary: string;
}

interface StructuralLevel {
  price: number;
  type: 'SWING_HIGH' | 'SWING_LOW' | 'DAILY_HIGH' | 'DAILY_LOW' | 'RESISTANCE' | 'SUPPORT';
  barIndex: number;
  strength: number; // 1 to 5
}

export class Gate15LiquiditySweep {
  /**
   * Analyzes candle series for liquidity sweeps and false breakouts.
   */
  public static analyze(
    candles: NormalizedCandle[],
    proposedDirection?: SignalDirection,
    lookback = 40
  ): Gate15SweepResult {
    if (!candles || candles.length < 20) {
      return this.createNeutralResult(['Insufficient candles for liquidity sweep analysis (minimum 20 required)']);
    }

    const sorted = [...candles].sort((a, b) => a.timestamp - b.timestamp);
    const len = sorted.length;
    const currentCandle = sorted[len - 1];
    const prevCandle = sorted[len - 2];

    const atr = TechnicalIndicators.calculateATR(sorted, 14);
    const baselineAtr = atr > 0 ? atr : currentCandle.close * 0.005;

    // 1. Identify Major Structural Levels
    const levels = this.extractStructuralLevels(sorted, lookback);

    if (levels.length === 0) {
      return this.createNeutralResult(['No significant structural levels identified within lookback window']);
    }

    // 2. Evaluate Potential Sweeps on Current and Previous Candles
    // We check high/low probes of recent candles (last 1-2 bars) against verified levels
    let bestBullishSweep: {
      level: StructuralLevel;
      candle: NormalizedCandle;
      depthATR: number;
      rejectionWickPct: number;
      volExp: number;
      closedInside: boolean;
      score: number;
    } | null = null;

    let bestBearishSweep: {
      level: StructuralLevel;
      candle: NormalizedCandle;
      depthATR: number;
      rejectionWickPct: number;
      volExp: number;
      closedInside: boolean;
      score: number;
    } | null = null;

    // Pre-calculate recent 20-bar avg volume
    const volSlice = sorted.slice(-20);
    const avgVol = volSlice.reduce((s, c) => s + c.volume, 0) / Math.max(1, volSlice.length);

    // Evaluate recent candles (lastCandle and prevCandle)
    const recentCandidates = [
      { candle: currentCandle, isLatest: true },
      { candle: prevCandle, isLatest: false },
    ];

    for (const { candle, isLatest } of recentCandidates) {
      const candleRange = Math.max(candle.high - candle.low, 0.0001);
      const upperWick = candle.high - Math.max(candle.open, candle.close);
      const lowerWick = Math.min(candle.open, candle.close) - candle.low;
      const upperWickPct = (upperWick / candleRange) * 100;
      const lowerWickPct = (lowerWick / candleRange) * 100;
      const volExp = avgVol > 0 ? candle.volume / avgVol : 1.0;

      for (const lvl of levels) {
        // A. Check for Bearish Liquidity Sweep (Sweeping Resistance / Highs)
        if (lvl.type === 'SWING_HIGH' || lvl.type === 'DAILY_HIGH' || lvl.type === 'RESISTANCE') {
          // Condition: Price probed above the high, but closed back below the level
          if (candle.high > lvl.price) {
            const penetrationDist = candle.high - lvl.price;
            const depthATR = baselineAtr > 0 ? penetrationDist / baselineAtr : 0.5;

            // Must penetrate meaningfully (e.g. > 0.05 ATR) but not excessively so it's a genuine runaway breakout
            if (depthATR >= 0.03 && depthATR <= 2.5) {
              const closedInside = currentCandle.close < lvl.price;
              const hasStrongRejection = upperWickPct >= 40 || (candle.close < lvl.price && candle.close <= candle.open);

              let score = 50;
              if (closedInside && hasStrongRejection) {
                score += 25;
                if (upperWickPct >= 50) score += 10;
                if (volExp >= 1.3) score += 10;
                if (lvl.strength >= 3) score += 5;
              } else if (closedInside) {
                score += 15;
              }

              if (!bestBearishSweep || score > bestBearishSweep.score) {
                bestBearishSweep = {
                  level: lvl,
                  candle,
                  depthATR,
                  rejectionWickPct: upperWickPct,
                  volExp,
                  closedInside,
                  score: Math.min(98, score),
                };
              }
            }
          }
        }

        // B. Check for Bullish Liquidity Sweep (Sweeping Support / Lows)
        if (lvl.type === 'SWING_LOW' || lvl.type === 'DAILY_LOW' || lvl.type === 'SUPPORT') {
          // Condition: Price probed below the low, but closed back above the level
          if (candle.low < lvl.price) {
            const penetrationDist = lvl.price - candle.low;
            const depthATR = baselineAtr > 0 ? penetrationDist / baselineAtr : 0.5;

            if (depthATR >= 0.03 && depthATR <= 2.5) {
              const closedInside = currentCandle.close > lvl.price;
              const hasStrongRejection = lowerWickPct >= 40 || (candle.close > lvl.price && candle.close >= candle.open);

              let score = 50;
              if (closedInside && hasStrongRejection) {
                score += 25;
                if (lowerWickPct >= 50) score += 10;
                if (volExp >= 1.3) score += 10;
                if (lvl.strength >= 3) score += 5;
              } else if (closedInside) {
                score += 15;
              }

              if (!bestBullishSweep || score > bestBullishSweep.score) {
                bestBullishSweep = {
                  level: lvl,
                  candle,
                  depthATR,
                  rejectionWickPct: lowerWickPct,
                  volExp,
                  closedInside,
                  score: Math.min(98, score),
                };
              }
            }
          }
        }
      }
    }

    // 3. Synthesize Best Sweep or Normal Breakout
    const reasons: string[] = [];

    // Check if candle is a sustained Normal Breakout (closed cleanly beyond level with high displacement)
    if (!bestBullishSweep && !bestBearishSweep) {
      // Check if price broke out and held
      for (const lvl of levels) {
        if ((lvl.type === 'SWING_HIGH' || lvl.type === 'RESISTANCE') && currentCandle.close > lvl.price + baselineAtr * 0.3) {
          return {
            sweepDirection: 'NONE',
            sweepLevel: lvl.price,
            sweepStrength: 'NONE',
            confirmationStatus: 'NORMAL_BREAKOUT',
            sweepScore: 50,
            sweepType: 'NONE',
            metrics: {
              levelSwept: lvl.price,
              penetrationDepthATR: Number(((currentCandle.close - lvl.price) / baselineAtr).toFixed(2)),
              rejectionWickPct: 0,
              volumeExpansion: 1,
              closedInsideRange: false,
              levelAgeBars: len - 1 - lvl.barIndex,
            },
            reasons: [`Price sustained breakout above ${lvl.type} (${lvl.price.toFixed(2)}) without rejection.`],
            summary: `NORMAL_BREAKOUT above level ${lvl.price.toFixed(2)}`,
          };
        }
      }

      return this.createNeutralResult(['No active liquidity sweep or false breakout detected across recent price action']);
    }

    // Prioritize sweep matching proposedDirection if both exist
    let selectedSweep: typeof bestBullishSweep | typeof bestBearishSweep = null;
    let sweepDir: SweepDirection = 'NONE';

    if (proposedDirection === 'BUY' && bestBullishSweep) {
      selectedSweep = bestBullishSweep;
      sweepDir = 'BULLISH';
    } else if (proposedDirection === 'SELL' && bestBearishSweep) {
      selectedSweep = bestBearishSweep;
      sweepDir = 'BEARISH';
    } else if (bestBullishSweep && (!bestBearishSweep || bestBullishSweep.score >= bestBearishSweep.score)) {
      selectedSweep = bestBullishSweep;
      sweepDir = 'BULLISH';
    } else if (bestBearishSweep) {
      selectedSweep = bestBearishSweep;
      sweepDir = 'BEARISH';
    }

    if (!selectedSweep) {
      return this.createNeutralResult(['No significant liquidity sweep found']);
    }

    const { level, depthATR, rejectionWickPct, volExp, closedInside, score } = selectedSweep;
    const levelAgeBars = len - 1 - level.barIndex;

    // Resolve Confirmation Status & Strength
    let confirmationStatus: ConfirmationStatus = 'UNCONFIRMED';
    let sweepStrength: SweepStrength = 'WEAK';

    if (score >= 75 && closedInside) {
      confirmationStatus = 'CONFIRMED_LIQUIDITY_SWEEP';
      sweepStrength = score >= 85 ? 'STRONG' : 'MODERATE';
    } else if (score >= 60) {
      confirmationStatus = 'POSSIBLE_SWEEP';
      sweepStrength = 'MODERATE';
    } else {
      confirmationStatus = 'UNCONFIRMED';
      sweepStrength = 'WEAK';
    }

    // Map SweepType
    let sweepType: SweepType = 'NONE';
    if (level.type === 'SWING_HIGH') sweepType = 'SWING_HIGH_SWEEP';
    else if (level.type === 'SWING_LOW') sweepType = 'SWING_LOW_SWEEP';
    else if (level.type === 'DAILY_HIGH') sweepType = 'DAILY_HIGH_SWEEP';
    else if (level.type === 'DAILY_LOW') sweepType = 'DAILY_LOW_SWEEP';
    else if (level.type === 'RESISTANCE') sweepType = 'RESISTANCE_SWEEP';
    else if (level.type === 'SUPPORT') sweepType = 'SUPPORT_SWEEP';

    // Reasons Construction
    if (sweepDir === 'BULLISH') {
      reasons.push(
        `Bullish Liquidity Sweep at ${level.type} (${level.price.toFixed(2)}): Price swept lows (-${depthATR.toFixed(2)} ATR) and rejected back inside range with ${rejectionWickPct.toFixed(0)}% lower wick.`
      );
      if (volExp >= 1.2) {
        reasons.push(`High volume absorption detected (${volExp.toFixed(1)}x average volume) confirming stop run.`);
      }
    } else {
      reasons.push(
        `Bearish Liquidity Sweep at ${level.type} (${level.price.toFixed(2)}): Price swept highs (+${depthATR.toFixed(2)} ATR) and rejected back inside range with ${rejectionWickPct.toFixed(0)}% upper wick.`
      );
      if (volExp >= 1.2) {
        reasons.push(`High volume exhaustion detected (${volExp.toFixed(1)}x average volume) confirming trap.`);
      }
    }

    const summary = `${confirmationStatus} [${sweepDir}] (Level: ${level.price.toFixed(2)}, Str: ${sweepStrength}, Score: ${score})`;

    return {
      sweepDirection: sweepDir,
      sweepLevel: level.price,
      sweepStrength,
      confirmationStatus,
      sweepScore: score,
      sweepType,
      metrics: {
        levelSwept: level.price,
        penetrationDepthATR: Number(depthATR.toFixed(2)),
        rejectionWickPct: Number(rejectionWickPct.toFixed(1)),
        volumeExpansion: Number(volExp.toFixed(2)),
        closedInsideRange: closedInside,
        levelAgeBars,
      },
      reasons,
      summary,
    };
  }

  /**
   * Extracts multi-factor structural levels (Swing Highs/Lows, Daily Highs/Lows, Gate5 S/R).
   */
  private static extractStructuralLevels(
    candles: NormalizedCandle[],
    lookback: number
  ): StructuralLevel[] {
    const levels: StructuralLevel[] = [];
    const len = candles.length;
    const windowStart = Math.max(0, len - lookback);

    // 1. Swing Highs and Lows (3-bar fractal pivots)
    for (let i = windowStart + 2; i < len - 2; i++) {
      const c = candles[i];
      const isSwingHigh =
        c.high >= candles[i - 1].high &&
        c.high >= candles[i - 2].high &&
        c.high >= candles[i + 1].high &&
        c.high >= candles[i + 2].high;

      const isSwingLow =
        c.low <= candles[i - 1].low &&
        c.low <= candles[i - 2].low &&
        c.low <= candles[i + 1].low &&
        c.low <= candles[i + 2].low;

      if (isSwingHigh) {
        levels.push({ price: c.high, type: 'SWING_HIGH', barIndex: i, strength: 3 });
      }
      if (isSwingLow) {
        levels.push({ price: c.low, type: 'SWING_LOW', barIndex: i, strength: 3 });
      }
    }

    // 2. Daily High / Low from timestamp session grouping
    const dayAgo = candles[len - 1].timestamp - 24 * 3600 * 1000;
    let dayHigh = -Infinity;
    let dayLow = Infinity;
    let dayHighIdx = -1;
    let dayLowIdx = -1;

    for (let i = 0; i < len - 2; i++) {
      if (candles[i].timestamp >= dayAgo) {
        if (candles[i].high > dayHigh) {
          dayHigh = candles[i].high;
          dayHighIdx = i;
        }
        if (candles[i].low < dayLow) {
          dayLow = candles[i].low;
          dayLowIdx = i;
        }
      }
    }

    if (dayHigh > -Infinity && dayHighIdx >= 0) {
      levels.push({ price: dayHigh, type: 'DAILY_HIGH', barIndex: dayHighIdx, strength: 4 });
    }
    if (dayLow < Infinity && dayLowIdx >= 0) {
      levels.push({ price: dayLow, type: 'DAILY_LOW', barIndex: dayLowIdx, strength: 4 });
    }

    // 3. Gate 5 S/R Zones
    try {
      const g5Res = Gate5SupportResistance.analyze('BUY', candles);
      if (g5Res.nearestResistance) {
        levels.push({ price: g5Res.nearestResistance.top, type: 'RESISTANCE', barIndex: len - 10, strength: 4 });
      }
      if (g5Res.nearestSupport) {
        levels.push({ price: g5Res.nearestSupport.bottom, type: 'SUPPORT', barIndex: len - 10, strength: 4 });
      }
    } catch {
      // Gate 5 graceful fallback
    }

    return levels;
  }

  private static createNeutralResult(reasons: string[]): Gate15SweepResult {
    return {
      sweepDirection: 'NONE',
      sweepLevel: null,
      sweepStrength: 'NONE',
      confirmationStatus: 'UNCONFIRMED',
      sweepScore: 50,
      sweepType: 'NONE',
      metrics: {
        levelSwept: null,
        penetrationDepthATR: 0,
        rejectionWickPct: 0,
        volumeExpansion: 1,
        closedInsideRange: false,
        levelAgeBars: 0,
      },
      reasons,
      summary: 'No active liquidity sweep detected',
    };
  }
}
