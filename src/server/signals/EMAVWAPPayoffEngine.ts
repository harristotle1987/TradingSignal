/**
 * EMA / VWAP PAYOFF ENGINE
 *
 * Adapted from freqtrade-ema-vwap (https://github.com/xenoxavier/freqtrade-ema-vwap).
 * Uses multi-EMA trend stacks (EMA 9, 21, 50, 200) combined with VWAP distance, VWAP slope,
 * and entry location to estimate whether the expected expansion move is large enough
 * to justify the trade payoff ($> 1.8\text{R}$ expected value).
 *
 * STRICT BOUNDARY:
 * - Does NOT generate signals independently.
 * - Serves strictly as a quantitative evidence and payoff quality provider.
 */

import { NormalizedCandle, SignalDirection } from '../../types/index.js';
import { TechnicalIndicators } from './TechnicalIndicators.js';
import { logger } from '../logger.js';

export interface EMAVWAPPayoffInput {
  symbol: string;
  direction: SignalDirection;
  candles: NormalizedCandle[];
  currentPrice?: number;
  atr?: number;
  timeframe?: string;
}

export interface EMAVWAPPayoffResult {
  symbol: string;
  direction: SignalDirection;
  expectedMove: number;              // Estimated price distance of expected expansion
  expectedMovePct: number;           // Estimated move as % of current price
  confidence: number;                // 0 - 100 confidence
  trendState:
    | 'STRONG_BULLISH_TREND'
    | 'BULLISH_PULLBACK'
    | 'STRONG_BEARISH_TREND'
    | 'BEARISH_PULLBACK'
    | 'COMPRESSED_RANGE'
    | 'CHOPPY_NO_TREND';
  payoffQuality: 'EXCELLENT' | 'STRONG' | 'MODERATE' | 'WEAK' | 'UNFAVORABLE';
  payoffRatio: number;               // Expected move / Estimated risk distance
  vwapAlignment: 'STRONG_ALIGNED' | 'MODERATE_ALIGNED' | 'NEUTRAL' | 'STRETCHED_COUNTER' | 'SEVERELY_STRETCHED';
  details: {
    ema9: number;
    ema21: number;
    ema50: number;
    ema200: number;
    vwap: number;
    vwapDistancePct: number;
    vwapSlope: number;
    atr: number;
    suggestedExpansionTarget: number;
  };
}

export class EMAVWAPPayoffEngine {
  /**
   * Evaluates the EMA/VWAP trend stack, VWAP distance & slope, and expected move payoff quality.
   */
  public static evaluate(input: EMAVWAPPayoffInput): EMAVWAPPayoffResult {
    const { symbol, direction, candles, timeframe = '1h' } = input;
    const isBuy = direction === 'BUY';

    if (!candles || candles.length < 20) {
      const fallbackPrice = input.currentPrice || 100;
      return {
        symbol,
        direction,
        expectedMove: fallbackPrice * 0.015,
        expectedMovePct: 1.5,
        confidence: 50,
        trendState: 'CHOPPY_NO_TREND',
        payoffQuality: 'MODERATE',
        payoffRatio: 1.5,
        vwapAlignment: 'NEUTRAL',
        details: {
          ema9: fallbackPrice,
          ema21: fallbackPrice,
          ema50: fallbackPrice,
          ema200: fallbackPrice,
          vwap: fallbackPrice,
          vwapDistancePct: 0,
          vwapSlope: 0,
          atr: fallbackPrice * 0.01,
          suggestedExpansionTarget: isBuy ? fallbackPrice * 1.02 : fallbackPrice * 0.98,
        },
      };
    }

    // Sort ascending chronologically
    const sorted = [...candles].sort((a, b) => a.timestamp - b.timestamp);
    const last = sorted[sorted.length - 1];
    const currentPrice = input.currentPrice || last.close;

    // 1. Calculate EMAs (9, 21, 50, 200)
    const ema9Series = TechnicalIndicators.calculateEMA(sorted, 9);
    const ema21Series = TechnicalIndicators.calculateEMA(sorted, 21);
    const ema50Series = TechnicalIndicators.calculateEMA(sorted, 50);
    const ema200Series = TechnicalIndicators.calculateEMA(sorted, Math.min(200, Math.floor(sorted.length * 0.8)));

    const ema9 = ema9Series.length > 0 ? ema9Series[ema9Series.length - 1] : currentPrice;
    const ema21 = ema21Series.length > 0 ? ema21Series[ema21Series.length - 1] : currentPrice;
    const ema50 = ema50Series.length > 0 ? ema50Series[ema50Series.length - 1] : currentPrice;
    const ema200 = ema200Series.length > 0 ? ema200Series[ema200Series.length - 1] : currentPrice;

    // 2. Calculate VWAP & VWAP Slope
    const vwapSeries = TechnicalIndicators.calculateVWAP(sorted);
    const vwap = vwapSeries.length > 0 ? vwapSeries[vwapSeries.length - 1] : currentPrice;

    // Calculate VWAP slope over last 5 bars
    let vwapSlope = 0;
    if (vwapSeries.length >= 5) {
      const vwapPrev = vwapSeries[vwapSeries.length - 5];
      vwapSlope = vwapPrev > 0 ? (vwap - vwapPrev) / vwapPrev : 0;
    }

    // VWAP Distance (% relative to current price)
    const vwapDistancePct = vwap > 0 ? ((currentPrice - vwap) / vwap) * 100 : 0;

    // 3. Calculate Volatility (ATR)
    const atrVal = TechnicalIndicators.calculateATR(sorted, 14);
    const atr = input.atr || (atrVal > 0 ? atrVal : currentPrice * 0.01);

    // 4. Classify Trend State
    let trendState: EMAVWAPPayoffResult['trendState'] = 'CHOPPY_NO_TREND';

    const isBullishStack = ema9 > ema21 && ema21 > ema50;
    const isBearishStack = ema9 < ema21 && ema21 < ema50;
    const isAboveEma200 = currentPrice > ema200;
    const isBelowEma200 = currentPrice < ema200;

    if (isBullishStack && isAboveEma200) {
      if (currentPrice >= ema9) {
        trendState = 'STRONG_BULLISH_TREND';
      } else {
        trendState = 'BULLISH_PULLBACK';
      }
    } else if (isBearishStack && isBelowEma200) {
      if (currentPrice <= ema9) {
        trendState = 'STRONG_BEARISH_TREND';
      } else {
        trendState = 'BEARISH_PULLBACK';
      }
    } else if (Math.abs(ema9 - ema50) / currentPrice < 0.005) {
      trendState = 'COMPRESSED_RANGE';
    } else {
      trendState = 'CHOPPY_NO_TREND';
    }

    // 5. Evaluate VWAP Alignment & Reversion Risk
    let vwapAlignment: EMAVWAPPayoffResult['vwapAlignment'] = 'NEUTRAL';
    const vwapDistAbsAtr = atr > 0 ? Math.abs(currentPrice - vwap) / atr : 0;

    if (isBuy) {
      if (vwapSlope > 0.001 && currentPrice >= vwap && vwapDistAbsAtr <= 2.0) {
        vwapAlignment = 'STRONG_ALIGNED';
      } else if (currentPrice >= vwap && vwapDistAbsAtr <= 3.0) {
        vwapAlignment = 'MODERATE_ALIGNED';
      } else if (currentPrice < vwap && vwapDistAbsAtr <= 1.5) {
        vwapAlignment = 'NEUTRAL'; // Healthy pullback near VWAP
      } else if (vwapDistAbsAtr > 3.5) {
        vwapAlignment = 'SEVERELY_STRETCHED'; // Danger of mean reversion drop
      } else if (currentPrice < vwap && vwapSlope < -0.002) {
        vwapAlignment = 'STRETCHED_COUNTER';
      }
    } else { // SELL
      if (vwapSlope < -0.001 && currentPrice <= vwap && vwapDistAbsAtr <= 2.0) {
        vwapAlignment = 'STRONG_ALIGNED';
      } else if (currentPrice <= vwap && vwapDistAbsAtr <= 3.0) {
        vwapAlignment = 'MODERATE_ALIGNED';
      } else if (currentPrice > vwap && vwapDistAbsAtr <= 1.5) {
        vwapAlignment = 'NEUTRAL'; // Healthy pullback near VWAP
      } else if (vwapDistAbsAtr > 3.5) {
        vwapAlignment = 'SEVERELY_STRETCHED';
      } else if (currentPrice > vwap && vwapSlope > 0.002) {
        vwapAlignment = 'STRETCHED_COUNTER';
      }
    }

    // 6. Estimate Expected Move & Payoff Ratio
    // Base expected expansion is 2.2x ATR adjusted by trend state and VWAP alignment
    let expansionAtrMultiplier = 2.2;

    if (trendState === 'STRONG_BULLISH_TREND' || trendState === 'STRONG_BEARISH_TREND') {
      expansionAtrMultiplier += 0.6;
    } else if (trendState === 'BULLISH_PULLBACK' || trendState === 'BEARISH_PULLBACK') {
      expansionAtrMultiplier += 0.4;
    } else if (trendState === 'COMPRESSED_RANGE') {
      expansionAtrMultiplier += 0.8; // High breakout expansion potential
    } else {
      expansionAtrMultiplier -= 0.5;
    }

    if (vwapAlignment === 'STRONG_ALIGNED') expansionAtrMultiplier += 0.4;
    else if (vwapAlignment === 'SEVERELY_STRETCHED') expansionAtrMultiplier -= 0.8;

    const expectedMove = atr * Math.max(1.2, expansionAtrMultiplier);
    const expectedMovePct = currentPrice > 0 ? Number(((expectedMove / currentPrice) * 100).toFixed(2)) : 1.5;

    const estimatedRisk = Math.max(atr * 1.1, currentPrice * 0.005);
    const payoffRatio = Number((expectedMove / estimatedRisk).toFixed(2));

    // 7. Payoff Quality Classification & Confidence Score
    let payoffQuality: EMAVWAPPayoffResult['payoffQuality'] = 'MODERATE';
    let baseConfidence = 60;

    if (payoffRatio >= 2.4 && (vwapAlignment === 'STRONG_ALIGNED' || vwapAlignment === 'MODERATE_ALIGNED')) {
      payoffQuality = 'EXCELLENT';
      baseConfidence = 88;
    } else if (payoffRatio >= 1.9) {
      payoffQuality = 'STRONG';
      baseConfidence = 78;
    } else if (payoffRatio >= 1.5) {
      payoffQuality = 'MODERATE';
      baseConfidence = 65;
    } else if (payoffRatio >= 1.2) {
      payoffQuality = 'WEAK';
      baseConfidence = 52;
    } else {
      payoffQuality = 'UNFAVORABLE';
      baseConfidence = 38;
    }

    const isCounterTrend =
      (isBuy && (trendState === 'STRONG_BEARISH_TREND' || trendState === 'BEARISH_PULLBACK')) ||
      (!isBuy && (trendState === 'STRONG_BULLISH_TREND' || trendState === 'BULLISH_PULLBACK'));

    if (isCounterTrend) {
      if (trendState === 'STRONG_BEARISH_TREND' || trendState === 'STRONG_BULLISH_TREND') {
        payoffQuality = 'UNFAVORABLE';
        baseConfidence = Math.min(baseConfidence, 35);
      } else {
        payoffQuality = 'WEAK';
        baseConfidence = Math.min(baseConfidence, 48);
      }
    }

    if (vwapAlignment === 'SEVERELY_STRETCHED') {
      baseConfidence = Math.max(30, baseConfidence - 20);
      if (payoffQuality === 'EXCELLENT') payoffQuality = 'MODERATE';
    }

    const confidence = Math.min(100, Math.max(10, Math.round(baseConfidence)));
    const suggestedExpansionTarget = isBuy ? currentPrice + expectedMove : currentPrice - expectedMove;

    return {
      symbol,
      direction,
      expectedMove: Number(expectedMove.toFixed(6)),
      expectedMovePct,
      confidence,
      trendState,
      payoffQuality,
      payoffRatio,
      vwapAlignment,
      details: {
        ema9: Number(ema9.toFixed(6)),
        ema21: Number(ema21.toFixed(6)),
        ema50: Number(ema50.toFixed(6)),
        ema200: Number(ema200.toFixed(6)),
        vwap: Number(vwap.toFixed(6)),
        vwapDistancePct: Number(vwapDistancePct.toFixed(2)),
        vwapSlope: Number(vwapSlope.toFixed(5)),
        atr: Number(atr.toFixed(6)),
        suggestedExpansionTarget: Number(suggestedExpansionTarget.toFixed(6)),
      },
    };
  }
}
