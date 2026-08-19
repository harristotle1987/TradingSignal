/**
 * GATE 14: PULLBACK QUALITY ENGINE
 * 
 * Additive analytics module that determines whether a pullback within an established
 * trend is healthy and orderly (high probability continuation) or represents a possible
 * structural breakdown / trend reversal.
 * 
 * EVALUATES:
 * 1. Preceding impulse strength & magnitude
 * 2. Pullback depth (Fibonacci Retracement: 23.6%, 38.2%, 50%, 61.8%, 78.6%, >100%)
 * 3. Pullback duration (bars count & velocity)
 * 4. Volume behavior (volume contraction on retracement vs expansion on impulse)
 * 5. EMA dynamic interaction (EMA20, EMA50 confluence)
 * 6. VWAP interaction (anchored value positioning)
 * 7. Support / Resistance reaction (rejection wicks, absorption)
 * 8. RSI momentum reset (e.g., cooling from >70 down to 40-55 in bull trend)
 * 9. Market structure preservation (higher lows in bull trend; lower highs in bear trend)
 * 10. Candle size and volatility symmetry (compact pullback candles vs wide impulse bars)
 * 
 * CLASSIFICATIONS:
 * - HIGH_QUALITY_PULLBACK
 * - ACCEPTABLE_PULLBACK
 * - DEEP_PULLBACK
 * - STRUCTURAL_BREAK
 * - POSSIBLE_REVERSAL
 */

import { NormalizedCandle, SignalDirection } from '../../types/index.js';
import { TechnicalIndicators } from './TechnicalIndicators.js';

export type PullbackQuality =
  | 'HIGH_QUALITY_PULLBACK'
  | 'ACCEPTABLE_PULLBACK'
  | 'DEEP_PULLBACK'
  | 'STRUCTURAL_BREAK'
  | 'POSSIBLE_REVERSAL';

export type ReversalRisk = 'LOW' | 'MODERATE' | 'HIGH' | 'EXTREME';

export interface Gate14PullbackResult {
  pullbackQuality: PullbackQuality;
  pullbackScore: number; // 0-100
  pullbackDepth: number; // Percentage retracement (e.g. 50.0 for 50%)
  structurePreserved: boolean;
  reversalRisk: ReversalRisk;
  trendDirection: 'BULLISH' | 'BEARISH' | 'NONE';
  metrics: {
    impulseMagnitudePct: number;
    pullbackBars: number;
    impulseBars: number;
    volumeRatioPullbackToImpulse: number;
    emaInteraction: 'BOUNCING_EMA20' | 'BOUNCING_EMA50' | 'BELOW_EMA50' | 'ABOVE_EMA50' | 'NEUTRAL';
    vwapStatus: 'SUPPORTING' | 'OPPOSING' | 'NEUTRAL';
    rsiResetValue: number;
    candleSizeRatio: number;
  };
  reasons: string[];
  summary: string;
}

export class Gate14PullbackQuality {
  /**
   * Analyzes pullback health, depth, volume, momentum reset, and structural integrity.
   */
  public static analyze(
    candles: NormalizedCandle[],
    proposedDirection?: SignalDirection,
    lookback = 30
  ): Gate14PullbackResult {
    // 1. Data sanity check
    if (!candles || candles.length < 20) {
      return this.createNeutralResult(['Insufficient candle history for pullback analysis (minimum 20 required)']);
    }

    const sorted = [...candles].sort((a, b) => a.timestamp - b.timestamp);
    const len = sorted.length;
    const currentCandle = sorted[len - 1];

    // Determine target trend direction
    const direction: SignalDirection = proposedDirection || (currentCandle.close >= sorted[0].close ? 'BUY' : 'SELL');

    // 2. Identify Major Impulse Wave and Subsequent Pullback Wave
    // Lookback window for structural impulse analysis
    const windowCandles = sorted.slice(-Math.min(lookback, len));
    const winLen = windowCandles.length;

    // Technical Series
    const ema20Series = TechnicalIndicators.calculateEMA(sorted, 20);
    const ema50Series = TechnicalIndicators.calculateEMA(sorted, 50);
    const rsiSeries = TechnicalIndicators.calculateRSI(sorted, 14);
    const vwapSeries = TechnicalIndicators.calculateVWAP(sorted);

    const currentEma20 = ema20Series.length > 0 ? ema20Series[ema20Series.length - 1] : currentCandle.close;
    const currentEma50 = ema50Series.length > 0 ? ema50Series[ema50Series.length - 1] : currentCandle.close;
    const currentRsi = rsiSeries.length > 0 ? rsiSeries[rsiSeries.length - 1] : 50;
    const currentVwap = vwapSeries.length > 0 ? vwapSeries[vwapSeries.length - 1] : currentCandle.close;

    if (direction === 'BUY') {
      return this.analyzeBullishPullback(
        windowCandles,
        currentCandle,
        currentEma20,
        currentEma50,
        currentRsi,
        currentVwap
      );
    } else {
      return this.analyzeBearishPullback(
        windowCandles,
        currentCandle,
        currentEma20,
        currentEma50,
        currentRsi,
        currentVwap
      );
    }
  }

  /**
   * Evaluates Bullish Trend Pullbacks.
   * Impulse: Swing Low -> Swing High
   * Pullback: Swing High -> Current Price / Pullback Trough
   */
  private static analyzeBullishPullback(
    candles: NormalizedCandle[],
    currentCandle: NormalizedCandle,
    ema20: number,
    ema50: number,
    currentRsi: number,
    vwap: number
  ): Gate14PullbackResult {
    const len = candles.length;
    let swingLowIdx = 0;
    let swingLowVal = Infinity;

    // Find the primary structural impulse origin in the earlier portion (first 70% of window)
    const impulseSearchLimit = Math.floor(len * 0.65);
    for (let i = 0; i < impulseSearchLimit; i++) {
      if (candles[i].low < swingLowVal) {
        swingLowVal = candles[i].low;
        swingLowIdx = i;
      }
    }

    // Find peak high following that swing low
    let swingHighIdx = swingLowIdx;
    let swingHighVal = -Infinity;
    for (let i = swingLowIdx + 1; i < len - 1; i++) {
      if (candles[i].high > swingHighVal) {
        swingHighVal = candles[i].high;
        swingHighIdx = i;
      }
    }

    // Fallback if no clean impulse peak separated from current candle
    if (swingHighVal <= swingLowVal || swingHighIdx <= swingLowIdx) {
      swingLowVal = candles[0].low;
      swingLowIdx = 0;
      swingHighVal = Math.max(...candles.map((c) => c.high));
      swingHighIdx = candles.findIndex((c) => c.high === swingHighVal);
    }

    const impulseMove = swingHighVal - swingLowVal;
    const impulseBars = Math.max(1, swingHighIdx - swingLowIdx);
    const impulseMagnitudePct = (impulseMove / swingLowVal) * 100;

    // Pullback segment: from swingHighIdx to current candle
    const pullbackCandles = candles.slice(swingHighIdx);
    const pullbackBars = Math.max(1, pullbackCandles.length);

    // Deepest point reached in pullback
    const pullbackLowest = Math.min(...pullbackCandles.map((c) => c.low));
    const currentPrice = currentCandle.close;

    // Retracement calculation (Fibonacci depth)
    const pullbackDistance = swingHighVal - pullbackLowest;
    const pullbackDepth = impulseMove > 0 ? (pullbackDistance / impulseMove) * 100 : 0;

    // 1. Structure Preservation: has price breached the origin of the impulse?
    const structurePreserved = pullbackLowest > swingLowVal;

    // 2. Volume Behavior
    const impulseCandles = candles.slice(swingLowIdx, swingHighIdx + 1);
    const avgImpulseVol = impulseCandles.reduce((s, c) => s + c.volume, 0) / Math.max(1, impulseCandles.length);
    const avgPullbackVol = pullbackCandles.reduce((s, c) => s + c.volume, 0) / Math.max(1, pullbackCandles.length);
    const volumeRatio = avgImpulseVol > 0 ? avgPullbackVol / avgImpulseVol : 1.0;

    // 3. Candle Size Ratio (Pullback candle ranges vs Impulse candle ranges)
    const avgImpulseRange = impulseCandles.reduce((s, c) => s + (c.high - c.low), 0) / Math.max(1, impulseCandles.length);
    const avgPullbackRange = pullbackCandles.reduce((s, c) => s + (c.high - c.low), 0) / Math.max(1, pullbackCandles.length);
    const candleSizeRatio = avgImpulseRange > 0 ? avgPullbackRange / avgImpulseRange : 1.0;

    // 4. EMA & VWAP Interactions
    let emaInteraction: 'BOUNCING_EMA20' | 'BOUNCING_EMA50' | 'BELOW_EMA50' | 'ABOVE_EMA50' | 'NEUTRAL' = 'NEUTRAL';
    if (currentPrice >= ema20 && pullbackLowest <= ema20 * 1.003) {
      emaInteraction = 'BOUNCING_EMA20';
    } else if (currentPrice >= ema50 && pullbackLowest <= ema50 * 1.005) {
      emaInteraction = 'BOUNCING_EMA50';
    } else if (currentPrice < ema50) {
      emaInteraction = 'BELOW_EMA50';
    } else {
      emaInteraction = 'ABOVE_EMA50';
    }

    const vwapStatus: 'SUPPORTING' | 'OPPOSING' | 'NEUTRAL' = currentPrice >= vwap ? 'SUPPORTING' : 'OPPOSING';

    // 5. Synthesis & Classification
    const reasons: string[] = [];
    let pullbackScore = 60;
    let pullbackQuality: PullbackQuality = 'ACCEPTABLE_PULLBACK';
    let reversalRisk: ReversalRisk = 'MODERATE';

    // A. Structural Breakdown check
    if (!structurePreserved || pullbackDepth >= 100) {
      pullbackQuality = 'STRUCTURAL_BREAK';
      reversalRisk = 'EXTREME';
      pullbackScore = Math.max(5, Math.round(25 - (pullbackDepth - 100)));
      reasons.push(`Structural Break: Price retraced ${pullbackDepth.toFixed(1)}%, violating the major swing low (${swingLowVal.toFixed(2)}).`);
    } else if (pullbackDepth >= 78.6 || (volumeRatio > 1.4 && candleSizeRatio > 1.2)) {
      // B. Deep / Heavy Selling Reversal Threat
      if (volumeRatio > 1.4 && currentPrice < ema50) {
        pullbackQuality = 'POSSIBLE_REVERSAL';
        reversalRisk = 'HIGH';
        pullbackScore = 30;
        reasons.push(`Possible Trend Reversal: Aggressive counter-trend selling volume (${volumeRatio.toFixed(2)}x impulse) breaking below EMA50.`);
      } else {
        pullbackQuality = 'DEEP_PULLBACK';
        reversalRisk = 'MODERATE';
        pullbackScore = 48;
        reasons.push(`Deep Retracement (${pullbackDepth.toFixed(1)}% Fib): Approaching swing origin with elevated volatility.`);
      }
    } else {
      // C. Healthy Retracement Analysis (30% to 65% Retracement)
      let baseScore = 65;

      // Depth bonus (Ideal 38.2% - 61.8% Golden Zone)
      if (pullbackDepth >= 35 && pullbackDepth <= 62) {
        baseScore += 12;
        reasons.push(`Ideal Fibonacci Retracement depth (${pullbackDepth.toFixed(1)}% in golden 38.2%-61.8% zone).`);
      } else if (pullbackDepth < 35) {
        baseScore += 6;
        reasons.push(`Shallow, highly eager pullback (${pullbackDepth.toFixed(1)}% depth).`);
      }

      // Volume Contraction Bonus (Institutions not dumping)
      if (volumeRatio <= 0.75) {
        baseScore += 10;
        reasons.push(`Healthy volume dry-up on pullback (${volumeRatio.toFixed(2)}x of impulse volume).`);
      } else if (volumeRatio > 1.2) {
        baseScore -= 8;
        reasons.push(`Elevated pullback volume (${volumeRatio.toFixed(2)}x of impulse).`);
      }

      // EMA Confluence
      if (emaInteraction === 'BOUNCING_EMA20' || emaInteraction === 'BOUNCING_EMA50') {
        baseScore += 8;
        reasons.push(`Dynamic support confluence: Holding key moving average (${emaInteraction}).`);
      }

      // RSI Reset (Cooling off into healthy 40-55 zone)
      if (currentRsi >= 40 && currentRsi <= 55) {
        baseScore += 8;
        reasons.push(`Clean RSI momentum reset to neutral reload zone (${currentRsi.toFixed(1)} pts).`);
      } else if (currentRsi < 35) {
        baseScore -= 5;
      }

      // Compact candle sizes (No panic dumping)
      if (candleSizeRatio <= 0.8) {
        baseScore += 5;
        reasons.push('Compact, orderly pullback candle ranges with no erratic volatility.');
      }

      pullbackScore = Math.min(98, Math.max(20, baseScore));

      if (pullbackScore >= 80 && volumeRatio <= 0.9 && structurePreserved) {
        pullbackQuality = 'HIGH_QUALITY_PULLBACK';
        reversalRisk = 'LOW';
      } else {
        pullbackQuality = 'ACCEPTABLE_PULLBACK';
        reversalRisk = 'LOW';
      }
    }

    const summary = `${pullbackQuality} [BULLISH] (Depth: ${pullbackDepth.toFixed(1)}%, Score: ${pullbackScore}, Risk: ${reversalRisk})`;

    return {
      pullbackQuality,
      pullbackScore,
      pullbackDepth: Number(pullbackDepth.toFixed(1)),
      structurePreserved,
      reversalRisk,
      trendDirection: 'BULLISH',
      metrics: {
        impulseMagnitudePct: Number(impulseMagnitudePct.toFixed(2)),
        pullbackBars,
        impulseBars,
        volumeRatioPullbackToImpulse: Number(volumeRatio.toFixed(2)),
        emaInteraction,
        vwapStatus,
        rsiResetValue: Number(currentRsi.toFixed(1)),
        candleSizeRatio: Number(candleSizeRatio.toFixed(2)),
      },
      reasons,
      summary,
    };
  }

  /**
   * Evaluates Bearish Trend Pullbacks (Rallies into Resistance).
   * Impulse: Swing High -> Swing Low
   * Pullback (Rally): Swing Low -> Current Price / Pullback Peak
   */
  private static analyzeBearishPullback(
    candles: NormalizedCandle[],
    currentCandle: NormalizedCandle,
    ema20: number,
    ema50: number,
    currentRsi: number,
    vwap: number
  ): Gate14PullbackResult {
    const len = candles.length;
    let swingHighIdx = 0;
    let swingHighVal = -Infinity;

    // Find the primary structural impulse origin
    const impulseSearchLimit = Math.floor(len * 0.65);
    for (let i = 0; i < impulseSearchLimit; i++) {
      if (candles[i].high > swingHighVal) {
        swingHighVal = candles[i].high;
        swingHighIdx = i;
      }
    }

    // Find trough low following that swing high
    let swingLowIdx = swingHighIdx;
    let swingLowVal = Infinity;
    for (let i = swingHighIdx + 1; i < len - 1; i++) {
      if (candles[i].low < swingLowVal) {
        swingLowVal = candles[i].low;
        swingLowIdx = i;
      }
    }

    if (swingHighVal <= swingLowVal || swingLowIdx <= swingHighIdx) {
      swingHighVal = candles[0].high;
      swingHighIdx = 0;
      swingLowVal = Math.min(...candles.map((c) => c.low));
      swingLowIdx = candles.findIndex((c) => c.low === swingLowVal);
    }

    const impulseMove = swingHighVal - swingLowVal;
    const impulseBars = Math.max(1, swingLowIdx - swingHighIdx);
    const impulseMagnitudePct = (impulseMove / swingHighVal) * 100;

    // Rally / Pullback segment: from swingLowIdx to current candle
    const pullbackCandles = candles.slice(swingLowIdx);
    const pullbackBars = Math.max(1, pullbackCandles.length);

    // Highest point reached in rally
    const pullbackHighest = Math.max(...pullbackCandles.map((c) => c.high));
    const currentPrice = currentCandle.close;

    // Retracement calculation
    const pullbackDistance = pullbackHighest - swingLowVal;
    const pullbackDepth = impulseMove > 0 ? (pullbackDistance / impulseMove) * 100 : 0;

    // 1. Structure Preservation: has price breached the swing high origin of the dump?
    const structurePreserved = pullbackHighest < swingHighVal;

    // 2. Volume Behavior
    const impulseCandles = candles.slice(swingHighIdx, swingLowIdx + 1);
    const avgImpulseVol = impulseCandles.reduce((s, c) => s + c.volume, 0) / Math.max(1, impulseCandles.length);
    const avgPullbackVol = pullbackCandles.reduce((s, c) => s + c.volume, 0) / Math.max(1, pullbackCandles.length);
    const volumeRatio = avgImpulseVol > 0 ? avgPullbackVol / avgImpulseVol : 1.0;

    // 3. Candle Size Ratio
    const avgImpulseRange = impulseCandles.reduce((s, c) => s + (c.high - c.low), 0) / Math.max(1, impulseCandles.length);
    const avgPullbackRange = pullbackCandles.reduce((s, c) => s + (c.high - c.low), 0) / Math.max(1, pullbackCandles.length);
    const candleSizeRatio = avgImpulseRange > 0 ? avgPullbackRange / avgImpulseRange : 1.0;

    // 4. EMA & VWAP Interactions
    let emaInteraction: 'BOUNCING_EMA20' | 'BOUNCING_EMA50' | 'BELOW_EMA50' | 'ABOVE_EMA50' | 'NEUTRAL' = 'NEUTRAL';
    if (currentPrice <= ema20 && pullbackHighest >= ema20 * 0.997) {
      emaInteraction = 'BOUNCING_EMA20';
    } else if (currentPrice <= ema50 && pullbackHighest >= ema50 * 0.995) {
      emaInteraction = 'BOUNCING_EMA50';
    } else if (currentPrice > ema50) {
      emaInteraction = 'ABOVE_EMA50';
    } else {
      emaInteraction = 'BELOW_EMA50';
    }

    const vwapStatus: 'SUPPORTING' | 'OPPOSING' | 'NEUTRAL' = currentPrice <= vwap ? 'SUPPORTING' : 'OPPOSING';

    // 5. Synthesis & Classification
    const reasons: string[] = [];
    let pullbackScore = 60;
    let pullbackQuality: PullbackQuality = 'ACCEPTABLE_PULLBACK';
    let reversalRisk: ReversalRisk = 'MODERATE';

    // A. Structural Breakdown check (Breached swing high origin)
    if (!structurePreserved || pullbackDepth >= 100) {
      pullbackQuality = 'STRUCTURAL_BREAK';
      reversalRisk = 'EXTREME';
      pullbackScore = Math.max(5, Math.round(25 - (pullbackDepth - 100)));
      reasons.push(`Structural Break: Bearish rally retraced ${pullbackDepth.toFixed(1)}%, violating the major swing high (${swingHighVal.toFixed(2)}).`);
    } else if (pullbackDepth >= 78.6 || (volumeRatio > 1.4 && candleSizeRatio > 1.2)) {
      if (volumeRatio > 1.4 && currentPrice > ema50) {
        pullbackQuality = 'POSSIBLE_REVERSAL';
        reversalRisk = 'HIGH';
        pullbackScore = 30;
        reasons.push(`Possible Trend Reversal: Aggressive counter-trend buying volume (${volumeRatio.toFixed(2)}x impulse) reclaiming EMA50.`);
      } else {
        pullbackQuality = 'DEEP_PULLBACK';
        reversalRisk = 'MODERATE';
        pullbackScore = 48;
        reasons.push(`Deep Bearish Rally (${pullbackDepth.toFixed(1)}% Fib): Retesting near top of breakdown leg.`);
      }
    } else {
      // C. Healthy Bearish Retracement
      let baseScore = 65;

      if (pullbackDepth >= 35 && pullbackDepth <= 62) {
        baseScore += 12;
        reasons.push(`Ideal Bearish Fibonacci Retracement depth (${pullbackDepth.toFixed(1)}% in golden zone).`);
      } else if (pullbackDepth < 35) {
        baseScore += 6;
        reasons.push(`Shallow bearish counter-rally (${pullbackDepth.toFixed(1)}% depth).`);
      }

      if (volumeRatio <= 0.75) {
        baseScore += 10;
        reasons.push(`Healthy volume contraction on counter-trend rally (${volumeRatio.toFixed(2)}x of impulse volume).`);
      } else if (volumeRatio > 1.2) {
        baseScore -= 8;
        reasons.push(`Elevated buying volume on rally (${volumeRatio.toFixed(2)}x of impulse).`);
      }

      if (emaInteraction === 'BOUNCING_EMA20' || emaInteraction === 'BOUNCING_EMA50') {
        baseScore += 8;
        reasons.push(`Dynamic resistance confluence: Rejecting off key moving average (${emaInteraction}).`);
      }

      // RSI Reset (Cooling off into 45-60 reload zone in downtrend)
      if (currentRsi >= 45 && currentRsi <= 60) {
        baseScore += 8;
        reasons.push(`Clean RSI momentum reset to bearish reload zone (${currentRsi.toFixed(1)} pts).`);
      } else if (currentRsi > 65) {
        baseScore -= 5;
      }

      if (candleSizeRatio <= 0.8) {
        baseScore += 5;
        reasons.push('Compact counter-trend candle ranges with no buying impulse acceleration.');
      }

      pullbackScore = Math.min(98, Math.max(20, baseScore));

      if (pullbackScore >= 80 && volumeRatio <= 0.9 && structurePreserved) {
        pullbackQuality = 'HIGH_QUALITY_PULLBACK';
        reversalRisk = 'LOW';
      } else {
        pullbackQuality = 'ACCEPTABLE_PULLBACK';
        reversalRisk = 'LOW';
      }
    }

    const summary = `${pullbackQuality} [BEARISH] (Depth: ${pullbackDepth.toFixed(1)}%, Score: ${pullbackScore}, Risk: ${reversalRisk})`;

    return {
      pullbackQuality,
      pullbackScore,
      pullbackDepth: Number(pullbackDepth.toFixed(1)),
      structurePreserved,
      reversalRisk,
      trendDirection: 'BEARISH',
      metrics: {
        impulseMagnitudePct: Number(impulseMagnitudePct.toFixed(2)),
        pullbackBars,
        impulseBars,
        volumeRatioPullbackToImpulse: Number(volumeRatio.toFixed(2)),
        emaInteraction,
        vwapStatus,
        rsiResetValue: Number(currentRsi.toFixed(1)),
        candleSizeRatio: Number(candleSizeRatio.toFixed(2)),
      },
      reasons,
      summary,
    };
  }

  private static createNeutralResult(reasons: string[]): Gate14PullbackResult {
    return {
      pullbackQuality: 'ACCEPTABLE_PULLBACK',
      pullbackScore: 50,
      pullbackDepth: 50,
      structurePreserved: true,
      reversalRisk: 'LOW',
      trendDirection: 'NONE',
      metrics: {
        impulseMagnitudePct: 0,
        pullbackBars: 0,
        impulseBars: 0,
        volumeRatioPullbackToImpulse: 1,
        emaInteraction: 'NEUTRAL',
        vwapStatus: 'NEUTRAL',
        rsiResetValue: 50,
        candleSizeRatio: 1,
      },
      reasons,
      summary: 'No active pullback analysis available',
    };
  }
}
