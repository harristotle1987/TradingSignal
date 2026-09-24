/**
 * GATE 6 — PROGRESSIVE DEEP MULTI-TIMEFRAME (MTF) ANALYSIS
 *
 * CRITICAL ARCHITECTURAL CONSTRAINTS:
 * 1. Do NOT perform expensive multi-timeframe requests on all preliminary candidates.
 * 2. ONLY the top 3–5 candidates from Gate 5 receive the first deep MTF layer.
 * 3. Layer 1 (15m & 1h):
 *    - Evaluate: Trend alignment, EMA structure, Momentum, RSI, MACD, ADX, Market structure.
 *    - Early Termination Rule: If 15m and 1h materially disagree:
 *      -> REJECT candidate immediately
 *      -> STOP processing
 *      -> DO NOT request additional expensive data (5m, 4h).
 * 4. Layer 2 (5m & 4h):
 *    - Evaluate: ATR, Support/Resistance, Market structure confirmation.
 *    - Only candidates that survive Layer 2 proceed to Gate 7 Execution Validation.
 * 5. Every rejection records exact structural and mathematical failure reasons.
 */

import { NormalizedCandle, SignalDirection } from '../../types/index.js';
import { TechnicalIndicators, MACDResult } from './TechnicalIndicators.js';
import { marketDataManager } from '../market/MarketDataManager.js';
import { serverConfig } from '../config.js';
import { logger } from '../logger.js';

export interface Gate6Layer1Metrics {
  trendAlignment: {
    tf1hDirection: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    tf15mDirection: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    isAligned: boolean;
    score: number; // 0 - 100
  };
  emaStructure: {
    ema21_1h: number;
    ema50_1h: number;
    ema21_15m: number;
    ema50_15m: number;
    isAligned: boolean;
    score: number; // 0 - 100
  };
  momentum: {
    roc1h: number;
    roc15m: number;
    isAligned: boolean;
    score: number; // 0 - 100
  };
  rsi: {
    rsi1h: number;
    rsi15m: number;
    isHealthy: boolean;
    score: number; // 0 - 100
  };
  macd: {
    macd1h: MACDResult | null;
    macd15m: MACDResult | null;
    isAligned: boolean;
    score: number; // 0 - 100
  };
  adx: {
    adx1h: { adx: number; pdi: number; mdi: number } | null;
    adx15m: { adx: number; pdi: number; mdi: number } | null;
    isTrending: boolean;
    score: number; // 0 - 100
  };
  marketStructure: {
    bias1h: 'BULLISH' | 'BEARISH' | 'RANGE';
    bias15m: 'BULLISH' | 'BEARISH' | 'RANGE';
    isAligned: boolean;
    score: number; // 0 - 100
  };
}

export interface Gate6Layer1Result {
  passed: boolean;
  score: number; // 0 - 100
  metrics: Gate6Layer1Metrics;
  disagreements: string[];
  rejectionReason?: string;
}

export interface Gate6Layer2Metrics {
  atr: {
    atr5m: number;
    atr15m: number;
    atr1h: number;
    atr4h: number;
    volatilityState: 'EXPANDING' | 'NORMAL' | 'COMPRESSED' | 'DEAD' | 'ERRATIC';
    isHealthy: boolean;
    score: number; // 0 - 100
  };
  supportResistance: {
    nearestSupport: number;
    nearestResistance: number;
    clearancePct: number;
    isFavorable: boolean;
    score: number; // 0 - 100
  };
  marketStructureConfirmation: {
    bias5m: 'BULLISH' | 'BEARISH' | 'RANGE';
    bias4h: 'BULLISH' | 'BEARISH' | 'RANGE';
    isConfirmed: boolean;
    score: number; // 0 - 100
  };
}

export interface Gate6Layer2Result {
  passed: boolean;
  score: number; // 0 - 100
  metrics: Gate6Layer2Metrics;
  disagreements: string[];
  rejectionReason?: string;
}

export interface Gate6CandidateEvaluation {
  asset: string;
  direction: SignalDirection;
  passed: boolean;
  stoppedAtLayer: 1 | 2 | 'PASSED' | 'BEFORE_MTF';
  layer1?: Gate6Layer1Result;
  layer2?: Gate6Layer2Result;
  compositeMtfScore: number;
  candlesMap: Record<string, NormalizedCandle[]>;
  rejectionReason?: string;
  auditTrail: string[];
  scoreBeforeGate6: number;
  maximumPossibleScoreAfterRemainingAnalysis: number;
  scoreAfterGate6: number;
  finalScore: number;
  factors?: any;
}

export interface Gate6ProgressiveAnalysisResult {
  totalInputCandidates: number;
  analyzedCandidatesCount: number;
  survivedCandidatesCount: number;
  survivedCandidates: Gate6CandidateEvaluation[];
  rejectedCandidates: Gate6CandidateEvaluation[];
  summary: string;
  gate6ElapsedMs?: number;
  timeBudgetExceeded?: boolean;
  providerRequestsStoppedByBudget?: boolean;
  candidatesRejectedBeforeMTF?: number;
  candidatesRejectedByMTF?: number;
  candidatesRejectedByScore?: number;
  candidatesRejectedByRR?: number;
  candidatesRejectedByStructure?: number;
}

export class Gate6ProgressiveMTF {
  private static readonly MAX_EXPENSIVE_CANDIDATES = 5;

  private static extractFactors(cand: { preliminaryScore?: number }, l1?: Gate6Layer1Result | null, l2?: Gate6Layer2Result | null, compositeMtfScore?: number): any {
    return {
      trendAlignmentScore: l1?.metrics?.trendAlignment?.score,
      emaStructureScore: l1?.metrics?.emaStructure?.score,
      momentumScore: l1?.metrics?.momentum?.score,
      rsiScore: l1?.metrics?.rsi?.score,
      macdScore: l1?.metrics?.macd?.score,
      adxScore: l1?.metrics?.adx?.score,
      marketStructureScore: l1?.metrics?.marketStructure?.score,
      volatilityAtrScore: l2?.metrics?.atr?.score,
      supportResistanceScore: l2?.metrics?.supportResistance?.score,
      marketStructureConfirmationScore: l2?.metrics?.marketStructureConfirmation?.score,
      compositeMtfScore: compositeMtfScore ?? l1?.score,
      preliminaryScore: cand?.preliminaryScore,
      // Standard compatibility keys
      trendScore: l1?.metrics?.trendAlignment?.score,
      structureScore: l1?.metrics?.marketStructure?.score,
      volatilityScore: l2?.metrics?.atr?.score,
    };
  }

  /**
   * Evaluates Layer 1 (15m & 1h) technical confluence.
   * Tests: Trend Alignment, EMA Structure, Momentum, RSI, MACD, ADX, Market Structure.
   */
  public static evaluateLayer1(
    direction: SignalDirection,
    candles1h: NormalizedCandle[],
    candles15m: NormalizedCandle[]
  ): Gate6Layer1Result {
    const disagreements: string[] = [];
    const isBuy = direction === 'BUY';

    // 1. Sort ascending
    const sorted1h = [...candles1h].sort((a, b) => a.timestamp - b.timestamp);
    const sorted15m = [...candles15m].sort((a, b) => a.timestamp - b.timestamp);

    if (sorted1h.length < 20 || sorted15m.length < 20) {
      return {
        passed: false,
        score: 0,
        metrics: {} as any,
        disagreements: ['Insufficient candle history on 1h or 15m timeframe.'],
        rejectionReason: 'Insufficient candle data on 1h (min 20) or 15m (min 20).',
      };
    }

    const last1h = sorted1h[sorted1h.length - 1];
    const last15m = sorted15m[sorted15m.length - 1];

    // --- A. Trend Alignment (EMAs 9, 21, 50) ---
    const ema9_1h = TechnicalIndicators.calculateEMA(sorted1h, 9);
    const ema21_1h = TechnicalIndicators.calculateEMA(sorted1h, 21);
    const ema50_1h = TechnicalIndicators.calculateEMA(sorted1h, Math.min(50, sorted1h.length - 1));

    const ema9_15m = TechnicalIndicators.calculateEMA(sorted15m, 9);
    const ema21_15m = TechnicalIndicators.calculateEMA(sorted15m, 21);
    const ema50_15m = TechnicalIndicators.calculateEMA(sorted15m, Math.min(50, sorted15m.length - 1));

    const valE9_1h = ema9_1h[ema9_1h.length - 1] || last1h.close;
    const valE21_1h = ema21_1h[ema21_1h.length - 1] || last1h.close;
    const valE50_1h = ema50_1h[ema50_1h.length - 1] || last1h.close;

    const valE9_15m = ema9_15m[ema9_15m.length - 1] || last15m.close;
    const valE21_15m = ema21_15m[ema21_15m.length - 1] || last15m.close;
    const valE50_15m = ema50_15m[ema50_15m.length - 1] || last15m.close;

    const tf1hDirection: 'BULLISH' | 'BEARISH' | 'NEUTRAL' =
      valE9_1h > valE21_1h && valE21_1h >= valE50_1h ? 'BULLISH' :
      valE9_1h < valE21_1h && valE21_1h <= valE50_1h ? 'BEARISH' : 'NEUTRAL';

    const tf15mDirection: 'BULLISH' | 'BEARISH' | 'NEUTRAL' =
      valE9_15m > valE21_15m && valE21_15m >= valE50_15m ? 'BULLISH' :
      valE9_15m < valE21_15m && valE21_15m <= valE50_15m ? 'BEARISH' : 'NEUTRAL';

    let trendScore = 50;
    if (isBuy) {
      if (tf1hDirection === 'BULLISH' && tf15mDirection === 'BULLISH') trendScore = 100;
      else if (tf1hDirection === 'BULLISH' && tf15mDirection === 'NEUTRAL') trendScore = 80;
      else if (tf1hDirection === 'NEUTRAL' && tf15mDirection === 'BULLISH') trendScore = 75;
      else if (tf1hDirection === 'BULLISH' && tf15mDirection === 'BEARISH') {
        // One MTF disagreement (15m pullback against 1h bullish trend): soft penalty, continue!
        trendScore = 60;
        disagreements.push('15m pullback against 1h bullish trend (one MTF disagreement, soft penalty applied).');
      } else if (tf1hDirection === 'NEUTRAL' && tf15mDirection === 'NEUTRAL') {
        trendScore = 55;
      } else if (tf1hDirection === 'NEUTRAL' && tf15mDirection === 'BEARISH') {
        trendScore = 50;
        disagreements.push('15m bearish trend with neutral 1h (soft penalty applied).');
      } else if (tf1hDirection === 'BEARISH' && tf15mDirection === 'BULLISH') {
        // One MTF disagreement (15m bullish bounce against 1h bear trend): soft penalty, continue!
        trendScore = 45;
        disagreements.push('1h bearish trend with 15m bullish bounce (one MTF disagreement, soft penalty applied).');
      } else {
        // Severe HTF trend contradiction: both 1h and 15m trends oppose BUY
        trendScore = 15;
        disagreements.push('Severe HTF trend contradiction: both 1h and 15m trends oppose BUY.');
      }
    } else {
      if (tf1hDirection === 'BEARISH' && tf15mDirection === 'BEARISH') trendScore = 100;
      else if (tf1hDirection === 'BEARISH' && tf15mDirection === 'NEUTRAL') trendScore = 80;
      else if (tf1hDirection === 'NEUTRAL' && tf15mDirection === 'BEARISH') trendScore = 75;
      else if (tf1hDirection === 'BEARISH' && tf15mDirection === 'BULLISH') {
        // One MTF disagreement (15m pullback against 1h bearish trend): soft penalty, continue!
        trendScore = 60;
        disagreements.push('15m pullback against 1h bearish trend (one MTF disagreement, soft penalty applied).');
      } else if (tf1hDirection === 'NEUTRAL' && tf15mDirection === 'NEUTRAL') {
        trendScore = 55;
      } else if (tf1hDirection === 'NEUTRAL' && tf15mDirection === 'BULLISH') {
        trendScore = 50;
        disagreements.push('15m bullish trend with neutral 1h (soft penalty applied).');
      } else if (tf1hDirection === 'BULLISH' && tf15mDirection === 'BEARISH') {
        // One MTF disagreement: soft penalty, continue!
        trendScore = 45;
        disagreements.push('1h bullish trend with 15m bearish pullback (one MTF disagreement, soft penalty applied).');
      } else {
        // Severe HTF trend contradiction: both 1h and 15m trends oppose SELL
        trendScore = 15;
        disagreements.push('Severe HTF trend contradiction: both 1h and 15m trends oppose SELL.');
      }
    }

    // --- B. EMA Structure (Price vs EMA21 / EMA50) ---
    // EMA disagreement: soft penalty, continues!
    let emaStructureScore = 50;
    const price1hAboveEma21 = last1h.close >= valE21_1h;
    const price15mAboveEma21 = last15m.close >= valE21_15m;

    if (isBuy) {
      if (price1hAboveEma21 && price15mAboveEma21) emaStructureScore = 95;
      else if (price1hAboveEma21 && !price15mAboveEma21) {
        emaStructureScore = 70; // Normal pullback setup into dynamic EMA
      } else if (!price1hAboveEma21 && price15mAboveEma21) {
        emaStructureScore = 60; // LTF recovery above EMA21
      } else {
        emaStructureScore = 40; // Price below EMA21 on both: soft penalty, continue
        disagreements.push('EMA Structure: Price is below EMA21 on 1h and 15m (soft penalty applied).');
      }
    } else {
      if (!price1hAboveEma21 && !price15mAboveEma21) emaStructureScore = 95;
      else if (!price1hAboveEma21 && price15mAboveEma21) {
        emaStructureScore = 70; // Normal pullback rally into dynamic EMA
      } else if (price1hAboveEma21 && !price15mAboveEma21) {
        emaStructureScore = 60; // LTF rejection below EMA21
      } else {
        emaStructureScore = 40; // Price above EMA21 on both: soft penalty, continue
        disagreements.push('EMA Structure: Price is above EMA21 on 1h and 15m (soft penalty applied).');
      }
    }

    // --- C. Momentum (ROC / Rate of Change over 10 bars) ---
    // Momentum disagreement / weak momentum: soft penalty, continues!
    const lookback = 10;
    const prev1h = sorted1h[Math.max(0, sorted1h.length - 1 - lookback)];
    const prev15m = sorted15m[Math.max(0, sorted15m.length - 1 - lookback)];

    const roc1h = prev1h && prev1h.close > 0 ? ((last1h.close - prev1h.close) / prev1h.close) * 100 : 0;
    const roc15m = prev15m && prev15m.close > 0 ? ((last15m.close - prev15m.close) / prev15m.close) * 100 : 0;

    let momScore = 50;
    if (isBuy) {
      if (roc1h > 0 && roc15m > 0) momScore = 90;
      else if (roc1h > 0 && roc15m >= -0.2) momScore = 70;
      else if (roc1h > 0 && roc15m < -0.2) {
        momScore = 55; // Minor LTF deceleration: soft penalty, continue
        disagreements.push(`Momentum: Minor LTF velocity deceleration (15m ROC ${roc15m.toFixed(2)}%, soft penalty applied).`);
      } else {
        momScore = 40; // Weak momentum: soft penalty, continue
        disagreements.push(`Momentum: Weak velocity on 1h (${roc1h.toFixed(2)}%) and 15m (${roc15m.toFixed(2)}%) (soft penalty applied).`);
      }
    } else {
      if (roc1h < 0 && roc15m < 0) momScore = 90;
      else if (roc1h < 0 && roc15m <= 0.2) momScore = 70;
      else if (roc1h < 0 && roc15m > 0.2) {
        momScore = 55; // Minor LTF deceleration: soft penalty, continue
        disagreements.push(`Momentum: Minor LTF velocity deceleration (15m ROC ${roc15m.toFixed(2)}%, soft penalty applied).`);
      } else {
        momScore = 40; // Weak momentum: soft penalty, continue
        disagreements.push(`Momentum: Weak velocity on 1h (${roc1h.toFixed(2)}%) and 15m (${roc15m.toFixed(2)}%) (soft penalty applied).`);
      }
    }

    // --- D. RSI ---
    // Neutral RSI: healthy baseline score; mild overextension: soft penalty, continues!
    const rsi1hSeries = TechnicalIndicators.calculateRSI(sorted1h, 14);
    const rsi15mSeries = TechnicalIndicators.calculateRSI(sorted15m, 14);
    const rsi1h = rsi1hSeries[rsi1hSeries.length - 1] ?? 50;
    const rsi15m = rsi15mSeries[rsi15mSeries.length - 1] ?? 50;

    let rsiScore = 65;
    let rsiHealthy = true;
    if (isBuy) {
      if (rsi1h >= 45 && rsi1h <= 72 && rsi15m >= 40 && rsi15m <= 75) {
        rsiScore = 90;
      } else if (rsi1h < 35 && rsi15m < 30) {
        rsiScore = 40; // Oversold: soft penalty, continue
        disagreements.push(`RSI oversold: 1h RSI=${rsi1h.toFixed(1)}, 15m RSI=${rsi15m.toFixed(1)} (soft penalty applied).`);
      } else if (rsi15m > 80) {
        rsiScore = 45; // Overextended: soft penalty, continue
        disagreements.push(`RSI 15m overextended: RSI=${rsi15m.toFixed(1)} (soft penalty applied).`);
      } else {
        // Neutral RSI (e.g. 40-55): healthy continuation score
        rsiScore = 70;
      }
    } else {
      if (rsi1h <= 55 && rsi1h >= 28 && rsi15m <= 60 && rsi15m >= 25) {
        rsiScore = 90;
      } else if (rsi1h > 65 && rsi15m > 70) {
        rsiScore = 40; // Overbought: soft penalty, continue
        disagreements.push(`RSI overbought: 1h RSI=${rsi1h.toFixed(1)}, 15m RSI=${rsi15m.toFixed(1)} (soft penalty applied).`);
      } else if (rsi15m < 20) {
        rsiScore = 45; // Overextended: soft penalty, continue
        disagreements.push(`RSI 15m overextended: RSI=${rsi15m.toFixed(1)} (soft penalty applied).`);
      } else {
        // Neutral RSI: healthy continuation score
        rsiScore = 70;
      }
    }

    // --- E. MACD ---
    // MACD disagreement: soft penalty, continues!
    const macd1h = TechnicalIndicators.calculateMACD(sorted1h);
    const macd15m = TechnicalIndicators.calculateMACD(sorted15m);
    let macdScore = 50;
    let macdAligned = true;

    if (macd1h && macd15m) {
      const macd1hBullish = macd1h.histogram >= 0 || macd1h.macdLine > macd1h.signalLine;
      const macd15mBullish = macd15m.histogram >= 0 || macd15m.macdLine > macd15m.signalLine;

      if (isBuy) {
        if (macd1hBullish && macd15mBullish) macdScore = 95;
        else if (macd1hBullish && !macd15mBullish) {
          macdScore = 65; // MACD disagreement (15m lag during pullback): soft penalty, continue
          disagreements.push('MACD: 15m histogram negative during pullback (MACD disagreement, soft penalty applied).');
        } else if (!macd1hBullish && macd15mBullish) {
          macdScore = 60; // LTF momentum emerging
          disagreements.push('MACD: 1h flat/lagging while 15m positive (soft penalty applied).');
        } else {
          macdScore = 40; // Both negative: soft penalty, continue
          macdAligned = false;
          disagreements.push('MACD: Both 1h and 15m histograms negative (soft penalty applied).');
        }
      } else {
        if (!macd1hBullish && !macd15mBullish) macdScore = 95;
        else if (!macd1hBullish && macd15mBullish) {
          macdScore = 65; // MACD disagreement (15m bounce during rally): soft penalty, continue
          disagreements.push('MACD: 15m histogram positive during pullback (MACD disagreement, soft penalty applied).');
        } else if (macd1hBullish && !macd15mBullish) {
          macdScore = 60; // LTF momentum emerging
          disagreements.push('MACD: 1h flat/lagging while 15m negative (soft penalty applied).');
        } else {
          macdScore = 40; // Both positive: soft penalty, continue
          macdAligned = false;
          disagreements.push('MACD: Both 1h and 15m histograms positive (soft penalty applied).');
        }
      }
    }

    // --- F. ADX & Directional Movement ---
    // ADX non-trending: baseline continuation score; opposing DM: soft penalty, continues!
    const adx1h = TechnicalIndicators.calculateADX(sorted1h, 14);
    const adx15m = TechnicalIndicators.calculateADX(sorted15m, 14);
    let adxScore = 65;
    let isTrending = true;

    if (adx1h && adx15m) {
      if (isBuy) {
        if (adx1h.pdi > adx1h.mdi && adx15m.pdi > adx15m.mdi) {
          adxScore = adx1h.adx >= 20 ? 95 : 80;
        } else if (adx1h.mdi > adx1h.pdi && adx1h.adx >= 25 && adx15m.mdi > adx15m.pdi) {
          adxScore = 40; // Opposing directional movement: soft penalty, continue
          isTrending = false;
          disagreements.push(`ADX: Bearish directional movement (-DI > +DI) on 1h (ADX ${adx1h.adx.toFixed(1)}) and 15m (soft penalty applied).`);
        } else {
          // Normal / consolidating ADX: healthy baseline
          adxScore = 65;
        }
      } else {
        if (adx1h.mdi > adx1h.pdi && adx15m.mdi > adx15m.pdi) {
          adxScore = adx1h.adx >= 20 ? 95 : 80;
        } else if (adx1h.pdi > adx1h.mdi && adx1h.adx >= 25 && adx15m.pdi > adx15m.mdi) {
          adxScore = 40; // Opposing directional movement: soft penalty, continue
          isTrending = false;
          disagreements.push(`ADX: Bullish directional movement (+DI > -DI) on 1h (ADX ${adx1h.adx.toFixed(1)}) and 15m (soft penalty applied).`);
        } else {
          // Normal / consolidating ADX: healthy baseline
          adxScore = 65;
        }
      }
    }

    // --- G. Market Structure (Higher Highs / Higher Lows) ---
    const ms1h = TechnicalIndicators.calculateMarketStructure(sorted1h);
    const ms15m = TechnicalIndicators.calculateMarketStructure(sorted15m);
    let msScore = 50;
    let msAligned = true;

    if (isBuy) {
      if (ms1h.structureBias === 'BULLISH' && ms15m.structureBias === 'BULLISH') msScore = 95;
      else if (ms1h.structureBias === 'BULLISH' && ms15m.structureBias === 'RANGE') msScore = 80;
      else if (ms1h.structureBias === 'BULLISH' && ms15m.structureBias === 'BEARISH') {
        // Minor 15m pullback within 1h bullish structure: soft penalty, continue
        msScore = 60;
        disagreements.push('Market Structure: 15m minor swing pullback within 1h bullish structure (soft penalty applied).');
      } else if (ms1h.structureBias === 'BEARISH' && ms15m.structureBias === 'BEARISH') {
        // Severe HTF structural contradiction: both 1h and 15m confirmed bearish
        msScore = 15;
        msAligned = false;
        disagreements.push('Market Structure: Lower highs and lower lows confirmed on both 1h and 15m (opposing BUY).');
      } else {
        msScore = 65;
      }
    } else {
      if (ms1h.structureBias === 'BEARISH' && ms15m.structureBias === 'BEARISH') msScore = 95;
      else if (ms1h.structureBias === 'BEARISH' && ms15m.structureBias === 'RANGE') msScore = 80;
      else if (ms1h.structureBias === 'BEARISH' && ms15m.structureBias === 'BULLISH') {
        // Minor 15m bounce within 1h bearish structure: soft penalty, continue
        msScore = 60;
        disagreements.push('Market Structure: 15m minor swing bounce within 1h bearish structure (soft penalty applied).');
      } else if (ms1h.structureBias === 'BULLISH' && ms15m.structureBias === 'BULLISH') {
        // Severe HTF structural contradiction: both 1h and 15m confirmed bullish
        msScore = 15;
        msAligned = false;
        disagreements.push('Market Structure: Higher highs and higher lows confirmed on both 1h and 15m (opposing SELL).');
      } else {
        msScore = 65;
      }
    }

    // --- Composite Layer 1 Score & Early Termination Decision ---
    const compositeLayer1Score = Math.round(
      trendScore * 0.25 +
      emaStructureScore * 0.15 +
      momScore * 0.15 +
      rsiScore * 0.10 +
      macdScore * 0.15 +
      adxScore * 0.10 +
      msScore * 0.10
    );

    // GATE 5: Secondary confluence factors (RSI, MACD, EMA, ADX, Momentum)
    // act as soft penalties on compositeLayer1Score/ranking, NEVER hard rejections.
    // Severe HTF structural contradiction remains HARD.
    const isHtfTrendConflict = trendScore <= 15;
    const isStructuralInvalidation = (msScore <= 15 && !msAligned);

    const hasHardContradiction = isHtfTrendConflict || isStructuralInvalidation;
    // Floor of 35 allows secondary indicator disagreements to adjust score and ranking without premature vetoes
    const passed = !hasHardContradiction && compositeLayer1Score >= 35;

    const metrics: Gate6Layer1Metrics = {
      trendAlignment: { tf1hDirection, tf15mDirection, isAligned: trendScore >= 60, score: trendScore },
      emaStructure: { ema21_1h: valE21_1h, ema50_1h: valE50_1h, ema21_15m: valE21_15m, ema50_15m: valE50_15m, isAligned: emaStructureScore >= 50, score: emaStructureScore },
      momentum: { roc1h, roc15m, isAligned: momScore >= 50, score: momScore },
      rsi: { rsi1h, rsi15m, isHealthy: rsiHealthy, score: rsiScore },
      macd: { macd1h, macd15m, isAligned: macdAligned, score: macdScore },
      adx: { adx1h, adx15m, isTrending, score: adxScore },
      marketStructure: { bias1h: ms1h.structureBias, bias15m: ms15m.structureBias, isAligned: msAligned, score: msScore },
    };

    return {
      passed,
      score: compositeLayer1Score,
      metrics,
      disagreements,
      rejectionReason: passed ? undefined : `Layer 1 MTF Disagreement: ${disagreements.join('; ')}`,
    };
  }

  /**
   * Evaluates Layer 2 (5m & 4h) technical confluence.
   * Tests: Multi-TF ATR / Volatility, Support & Resistance Clearances, 5m Micro-Structure & 4h Macro Confirmation.
   */
  public static evaluateLayer2(
    direction: SignalDirection,
    currentPrice: number,
    candles5m: NormalizedCandle[],
    candles15m: NormalizedCandle[],
    candles1h: NormalizedCandle[],
    candles4h: NormalizedCandle[]
  ): Gate6Layer2Result {
    const disagreements: string[] = [];
    const isBuy = direction === 'BUY';

    const sorted5m = [...candles5m].sort((a, b) => a.timestamp - b.timestamp);
    const sorted15m = [...candles15m].sort((a, b) => a.timestamp - b.timestamp);
    const sorted1h = [...candles1h].sort((a, b) => a.timestamp - b.timestamp);
    const sorted4h = [...candles4h].sort((a, b) => a.timestamp - b.timestamp);

    if (sorted5m.length < 15 || sorted4h.length < 10) {
      return {
        passed: false,
        score: 0,
        metrics: {} as any,
        disagreements: ['Insufficient candle history on 5m or 4h timeframe.'],
        rejectionReason: 'Insufficient candle data on 5m (min 15) or 4h (min 10).',
      };
    }

    // --- A. ATR Analysis ---
    const atr5m = TechnicalIndicators.calculateATR(sorted5m, 14);
    const atr15m = TechnicalIndicators.calculateATR(sorted15m, 14);
    const atr1h = TechnicalIndicators.calculateATR(sorted1h, 14);
    const atr4h = TechnicalIndicators.calculateATR(sorted4h, 14);

    let volatilityState: 'EXPANDING' | 'NORMAL' | 'COMPRESSED' | 'DEAD' | 'ERRATIC' = 'NORMAL';
    let atrScore = 80;
    let atrHealthy = true;

    if (atr1h <= 0 || currentPrice <= 0) {
      volatilityState = 'DEAD';
      atrHealthy = false;
      atrScore = 0;
      disagreements.push('ATR is non-positive or zero.');
    } else {
      const atrPct = (atr1h / currentPrice) * 100;
      if (atrPct < 0.005) {
        // Genuinely collapsed/dead ATR: hard stop
        volatilityState = 'DEAD';
        atrHealthy = false;
        atrScore = 20;
        disagreements.push(`Volatility is dead: 1h ATR is only ${atrPct.toFixed(4)}% of price.`);
      } else if (atrPct < 0.02) {
        // Compressed volatility: caution soft penalty, continues!
        volatilityState = 'COMPRESSED';
        atrHealthy = true;
        atrScore = 55;
        disagreements.push(`Volatility compressed: 1h ATR is ${atrPct.toFixed(4)}% of price (soft penalty applied).`);
      } else if (atrPct > 20.0) {
        // Extreme erratic flash spike: hard safety block
        volatilityState = 'ERRATIC';
        atrHealthy = false;
        atrScore = 20;
        disagreements.push(`Volatility is extreme: 1h ATR is ${atrPct.toFixed(2)}% of price.`);
      } else if (atrPct > 12.0) {
        // Elevated volatility: caution soft penalty, continues!
        volatilityState = 'NORMAL';
        atrHealthy = true;
        atrScore = 60;
        disagreements.push(`Elevated volatility: 1h ATR is ${atrPct.toFixed(2)}% of price (soft penalty applied).`);
      } else if (atr15m > atr1h * 0.4) {
        volatilityState = 'EXPANDING';
        atrScore = 95;
      } else {
        volatilityState = 'NORMAL';
        atrScore = 85;
      }
    }

    // --- B. Support & Resistance Clearance ---
    // Extract genuine fractal swing pivots across 4h and 1h rather than raw individual bar extremes
    const extractSwingPivots = (candles: NormalizedCandle[]) => {
      const pivotsHigh: number[] = [];
      const pivotsLow: number[] = [];
      for (let i = 2; i < candles.length - 2; i++) {
        const c = candles[i];
        if (
          c.high >= candles[i - 1].high &&
          c.high >= candles[i - 2].high &&
          c.high >= candles[i + 1].high &&
          c.high >= candles[i + 2].high
        ) {
          pivotsHigh.push(c.high);
        }
        if (
          c.low <= candles[i - 1].low &&
          c.low <= candles[i - 2].low &&
          c.low <= candles[i + 1].low &&
          c.low <= candles[i + 2].low
        ) {
          pivotsLow.push(c.low);
        }
      }
      return { pivotsHigh, pivotsLow };
    };

    const slice4h = sorted4h.slice(-20);
    const slice1h = sorted1h.slice(-30);
    const pivots4h = extractSwingPivots(slice4h);
    const pivots1h = extractSwingPivots(slice1h);
    const swingHighs = [...pivots4h.pivotsHigh, ...pivots1h.pivotsHigh];
    const swingLows = [...pivots4h.pivotsLow, ...pivots1h.pivotsLow];

    // Exclude immediate intra-bar noise around current price using a dynamic buffer
    const minBuffer = Math.max(currentPrice * 0.0005, atr1h * 0.15);
    const resistanceLevels = swingHighs.filter(h => h > currentPrice + minBuffer).sort((a, b) => a - b);
    const supportLevels = swingLows.filter(l => l < currentPrice - minBuffer).sort((a, b) => b - a);

    const nearestResistance = resistanceLevels.length > 0 ? resistanceLevels[0] : currentPrice * 1.05;
    const nearestSupport = supportLevels.length > 0 ? supportLevels[0] : currentPrice * 0.95;

    // --- C. Market Structure Confirmation (5m & 4h) ---
    // Normal S/R proximity: soft penalty, continues!
    const ms5m = TechnicalIndicators.calculateMarketStructure(sorted5m);
    const ms4h = TechnicalIndicators.calculateMarketStructure(sorted4h);

    let srScore = 80;
    let srFavorable = true;
    let clearancePct = 0;

    if (isBuy) {
      clearancePct = ((nearestResistance - currentPrice) / currentPrice) * 100;
      if (clearancePct < 0.2 && currentPrice > 0) {
        // Normal S/R proximity: apply soft score penalty, continue!
        srScore = ms4h.structureBias === 'BEARISH' ? 50 : 65;
        srFavorable = true;
        disagreements.push(`Normal S/R proximity: Entry is ${clearancePct.toFixed(2)}% below resistance (${nearestResistance.toFixed(4)}) (soft penalty applied).`);
      } else if (clearancePct > 1.0) {
        srScore = 95;
      } else {
        srScore = 80;
      }
    } else {
      clearancePct = ((currentPrice - nearestSupport) / currentPrice) * 100;
      if (clearancePct < 0.2 && currentPrice > 0) {
        // Normal S/R proximity: apply soft score penalty, continue!
        srScore = ms4h.structureBias === 'BULLISH' ? 50 : 65;
        srFavorable = true;
        disagreements.push(`Normal S/R proximity: Entry is ${clearancePct.toFixed(2)}% above support (${nearestSupport.toFixed(4)}) (soft penalty applied).`);
      } else if (clearancePct > 1.0) {
        srScore = 95;
      } else {
        srScore = 80;
      }
    }

    let msConfScore = 50;
    let msConfirmed = true;

    if (isBuy) {
      if (ms4h.structureBias === 'BULLISH' && (ms5m.structureBias === 'BULLISH' || ms5m.higherLowsCount >= 1)) {
        msConfScore = 95;
      } else if (ms4h.structureBias === 'RANGE' && ms5m.structureBias === 'BULLISH') {
        msConfScore = 80;
      } else if (ms4h.structureBias === 'BEARISH' && ms5m.structureBias === 'BEARISH') {
        // Severe HTF structural contradiction
        msConfScore = 15;
        msConfirmed = false;
        disagreements.push('Macro 4h and micro 5m structure both confirm Bearish regime (opposing BUY).');
      } else {
        msConfScore = 65;
      }
    } else {
      if (ms4h.structureBias === 'BEARISH' && (ms5m.structureBias === 'BEARISH' || ms5m.lowerHighsCount >= 1)) {
        msConfScore = 95;
      } else if (ms4h.structureBias === 'RANGE' && ms5m.structureBias === 'BEARISH') {
        msConfScore = 80;
      } else if (ms4h.structureBias === 'BULLISH' && ms5m.structureBias === 'BULLISH') {
        // Severe HTF structural contradiction
        msConfScore = 15;
        msConfirmed = false;
        disagreements.push('Macro 4h and micro 5m structure both confirm Bullish regime (opposing SELL).');
      } else {
        msConfScore = 65;
      }
    }

    const compositeLayer2Score = Math.round(
      atrScore * 0.35 +
      srScore * 0.35 +
      msConfScore * 0.30
    );

    // GATE 5: Only dead ATR or severe macro structural invalidation trigger hard block.
    // Proximity to S/R and minor timeframe fluctuations act as soft scoring penalties.
    const isMacroStructInvalidated = !msConfirmed && msConfScore <= 15;
    const passed = atrHealthy && !isMacroStructInvalidated && compositeLayer2Score >= 35;

    const metrics: Gate6Layer2Metrics = {
      atr: { atr5m, atr15m, atr1h, atr4h, volatilityState, isHealthy: atrHealthy, score: atrScore },
      supportResistance: { nearestSupport, nearestResistance, clearancePct, isFavorable: srFavorable, score: srScore },
      marketStructureConfirmation: { bias5m: ms5m.structureBias, bias4h: ms4h.structureBias, isConfirmed: msConfirmed, score: msConfScore },
    };

    return {
      passed,
      score: compositeLayer2Score,
      metrics,
      disagreements,
      rejectionReason: passed ? undefined : `Layer 2 MTF Validation Failed: ${disagreements.join('; ')}`,
    };
  }

  /**
   * Main progressive orchestration pipeline for Gate 6.
   * Progressively evaluates the 8–12 deep candidate pool:
   * 1. Layer 1 (15m & 1h) early-halts failing candidates after only 1 cheap request.
   * 2. Layer 2 (5m & 4h) runs ONLY on Layer-1 survivors.
   * 3. Yields TOP 3–5 fully validated candidates for Stage 3 execution & hard gates.
   */
  public static async analyzeCandidates(
    candidates: Array<{
      asset: string;
      direction: SignalDirection;
      htf1h: NormalizedCandle[];
      preliminaryScore: number;
    }>,
    targetSurvivors = Gate6ProgressiveMTF.MAX_EXPENSIVE_CANDIDATES,
    globalScanStartMs?: number,
    globalScanDeadlineMs?: number
  ): Promise<Gate6ProgressiveAnalysisResult> {
    const startMs = globalScanStartMs ?? Date.now();
    const deadlineMs = globalScanDeadlineMs ?? (startMs + 24000);
    const gate6StartMs = Date.now();

    let timeBudgetExceeded = false;
    let providerRequestsStoppedByBudget = false;

    const survived: Gate6CandidateEvaluation[] = [];
    const rejected: Gate6CandidateEvaluation[] = [];
    let layer2EvaluationsCount = 0;
    const maxLayer2Allowed = targetSurvivors; // Max 5 expensive multi-timeframe candle fetches

    logger.info(
      `[Gate 6 Progressive MTF] Progressively evaluating pool of ${candidates.length} deep candidates with bounded parallelism (Targeting TOP 3–5 fully validated setups)...`
    );

    let analyzedCount = 0;

    // STEP 0: PRE-MTF SCORE AUDIT
    const targetScoreThreshold = serverConfig.getConfig().thresholds.signalThreshold;
    if (typeof targetScoreThreshold !== 'number' || isNaN(targetScoreThreshold)) {
      throw new Error(`[Gate6ProgressiveMTF] Authoritative signalThreshold is missing or invalid in serverConfig`);
    }

    // Filter candidates entering Gate 6: determine whether candidates with a deterministic score
    // already below required threshold can mathematically reach required threshold after remaining MTF analysis.
    const mtfEligibleCandidates: typeof candidates = [];

    for (const cand of candidates) {
      const scoreBeforeGate6 = cand.preliminaryScore;
      const maximumPossibleScoreAfterRemainingAnalysis = Math.min(100, scoreBeforeGate6 + 40);
      const scoreAfterGate6 = scoreBeforeGate6;
      const finalScore = scoreBeforeGate6;

      if (maximumPossibleScoreAfterRemainingAnalysis < targetScoreThreshold) {
        // Candidate cannot mathematically reach threshold -> Reject BEFORE expensive MTF requests!
        analyzedCount++;
        const auditTrail = [
          `[Gate 6 Pre-Audit] REJECTED BEFORE MTF. Preliminary score (${scoreBeforeGate6}/100) yields maximum possible score of ${maximumPossibleScoreAfterRemainingAnalysis}/100 (< required threshold ${targetScoreThreshold}). Omitting 15m/5m/4h market data requests.`,
        ];

        logger.info(
          `[Gate 6 Early Audit Halt] ${cand.asset} rejected before MTF: preliminary score (${scoreBeforeGate6}/100) max reachable score (${maximumPossibleScoreAfterRemainingAnalysis}) < ${targetScoreThreshold}.`
        );

        rejected.push({
          asset: cand.asset,
          direction: cand.direction,
          passed: false,
          stoppedAtLayer: 'BEFORE_MTF',
          compositeMtfScore: scoreBeforeGate6,
          candlesMap: { '1h': cand.htf1h },
          rejectionReason: `FINAL_SCORE_UNREACHABLE: Score before Gate 6 (${scoreBeforeGate6}/100) yields maximum possible score of ${maximumPossibleScoreAfterRemainingAnalysis}/100, which cannot reach actionable threshold ${targetScoreThreshold}. Halting MTF requests.`,
          auditTrail,
          scoreBeforeGate6,
          maximumPossibleScoreAfterRemainingAnalysis,
          scoreAfterGate6,
          finalScore,
          factors: Gate6ProgressiveMTF.extractFactors(cand, null, null, scoreBeforeGate6),
        });
      } else {
        mtfEligibleCandidates.push(cand);
      }
    }

    // Bounded parallelism for Layer 1 execution
    const CONCURRENCY_LIMIT = 6;

    for (let i = 0; i < mtfEligibleCandidates.length; i += CONCURRENCY_LIMIT) {
      const remainingMs = deadlineMs - Date.now();
      const currentElapsedMs = Date.now() - startMs;

      // Rule 2: Gate 6 must stop starting expensive work when remainingMs <= 1500ms OR currentElapsedMs >= 22500ms
      if (remainingMs <= 1500 || currentElapsedMs >= 22500) {
        timeBudgetExceeded = true;
        providerRequestsStoppedByBudget = true;
        logger.warn(
          `[Gate 6 Time Budget Exceeded] Global scan elapsed (${currentElapsedMs}ms) reached threshold (22500ms / remaining ${remainingMs}ms). Halting further Gate 6 Layer 1 candidate processing.`
        );
        break;
      }

      if (survived.length >= targetSurvivors || layer2EvaluationsCount >= maxLayer2Allowed) {
        break;
      }

      const batch = mtfEligibleCandidates.slice(i, i + CONCURRENCY_LIMIT);

      // STEP 1: LAYER 1 (15m + 1h) - Execute 15m fetches in parallel for the batch (1h candles already available)
      const layer1Results = await Promise.all(
        batch.map(async (cand) => {
          const asset = cand.asset;
          const direction = cand.direction;
          const sorted1h = [...cand.htf1h].sort((a, b) => a.timestamp - b.timestamp);
          const auditTrail: string[] = [];
          const scoreBeforeGate6 = cand.preliminaryScore;
          const preMaxPossible = Math.min(100, scoreBeforeGate6 + 25);

          auditTrail.push(`[Gate 6] Starting Layer 1 (15m & 1h) analysis for ${asset} (${direction}). Score before Gate 6: ${scoreBeforeGate6}`);

          // Fetch ONLY 15m candles first (Layer 1)
          let candles15m: NormalizedCandle[] = [];
          try {
            const fetched15m = await marketDataManager.getCandles(asset, undefined, '15m', 50, false);
            if (fetched15m && fetched15m.length >= 15) {
              candles15m = fetched15m.sort((a, b) => a.timestamp - b.timestamp);
            }
          } catch (err: any) {
            logger.warn(`[Gate 6 MTF] Failed to fetch 15m candles for ${asset}: ${err?.message || err}`);
          }

          if (candles15m.length < 15) {
            const evalFail: Gate6CandidateEvaluation = {
              asset,
              direction,
              passed: false,
              stoppedAtLayer: 1,
              layer1: {
                passed: false,
                score: 0,
                metrics: {} as any,
                disagreements: ['15m candles unavailable from market data provider.'],
                rejectionReason: '15m candles unavailable.',
              },
              compositeMtfScore: 0,
              candlesMap: { '1h': sorted1h },
              rejectionReason: '15m market candles unavailable; early halted.',
              auditTrail,
              scoreBeforeGate6,
              maximumPossibleScoreAfterRemainingAnalysis: preMaxPossible,
              scoreAfterGate6: 0,
              finalScore: 0,
              factors: Gate6ProgressiveMTF.extractFactors(cand, null, null, 0),
            };
            return { cand, candles15m: [], l1Result: null, evalFail };
          }

          // Evaluate Layer 1
          const l1Result = Gate6ProgressiveMTF.evaluateLayer1(direction, sorted1h, candles15m);

          if (!l1Result.passed) {
            auditTrail.push(`[Gate 6 Layer 1 REJECTED] ${l1Result.rejectionReason}. Early halted; 5m/4h skipped.`);
            logger.info(`[Gate 6 Layer 1 Halt] ${asset} rejected: ${l1Result.rejectionReason}`);

            const evalL1Fail: Gate6CandidateEvaluation = {
              asset,
              direction,
              passed: false,
              stoppedAtLayer: 1,
              layer1: l1Result,
              compositeMtfScore: l1Result.score,
              candlesMap: { '1h': sorted1h, '15m': candles15m },
              rejectionReason: l1Result.rejectionReason,
              auditTrail,
              scoreBeforeGate6,
              maximumPossibleScoreAfterRemainingAnalysis: Math.min(100, Math.round(l1Result.score * 0.6 + 40) + 15),
              scoreAfterGate6: l1Result.score,
              finalScore: l1Result.score,
              factors: Gate6ProgressiveMTF.extractFactors(cand, l1Result, null, l1Result.score),
            };
            return { cand, candles15m, l1Result, evalFail: evalL1Fail };
          }

          // POST-LAYER 1 SCORE AUDIT (Before Layer 2 5m & 4h expensive requests)
          const maxCompositeMtf = Math.round(l1Result.score * 0.6 + 100 * 0.4);
          const maximumPossibleScoreAfterRemainingAnalysis = Math.min(100, maxCompositeMtf + 25);

          if (maximumPossibleScoreAfterRemainingAnalysis < targetScoreThreshold) {
            auditTrail.push(`[Gate 6 Post-L1 Audit REJECTED] Post-Layer 1 score (${l1Result.score}/100) yields maximum possible score of ${maximumPossibleScoreAfterRemainingAnalysis}/100 (< required threshold ${targetScoreThreshold}). Halting Layer 2 (5m & 4h) requests.`);
            logger.info(`[Gate 6 Post-L1 Early Halt] ${asset} rejected before Layer 2: post-L1 max possible score (${maximumPossibleScoreAfterRemainingAnalysis}) < ${targetScoreThreshold}.`);

            const evalPostL1Fail: Gate6CandidateEvaluation = {
              asset,
              direction,
              passed: false,
              stoppedAtLayer: 1,
              layer1: l1Result,
              compositeMtfScore: l1Result.score,
              candlesMap: { '1h': sorted1h, '15m': candles15m },
              rejectionReason: `FINAL_SCORE_UNREACHABLE: Post-Layer 1 score (${l1Result.score}/100) yields maximum possible score of ${maximumPossibleScoreAfterRemainingAnalysis}/100, which cannot reach actionable threshold ${targetScoreThreshold}. Halting Layer 2 (5m & 4h) requests.`,
              auditTrail,
              scoreBeforeGate6,
              maximumPossibleScoreAfterRemainingAnalysis,
              scoreAfterGate6: l1Result.score,
              finalScore: l1Result.score,
              factors: Gate6ProgressiveMTF.extractFactors(cand, l1Result, null, l1Result.score),
            };
            return { cand, candles15m, l1Result, evalFail: evalPostL1Fail };
          }

          auditTrail.push(`[Gate 6 Layer 1 PASSED] Score: ${l1Result.score}/100 (Max reachable: ${maximumPossibleScoreAfterRemainingAnalysis}). Requesting Layer 2 (5m & 4h)...`);
          return { cand, candles15m, sorted1h, l1Result, auditTrail, evalFail: null };
        })
      );

      // Process Layer 1 outcomes
      const layer1SurvivorsInBatch: Array<{
        cand: typeof mtfEligibleCandidates[0];
        candles15m: NormalizedCandle[];
        sorted1h: NormalizedCandle[];
        l1Result: NonNullable<(typeof layer1Results)[0]['l1Result']>;
        auditTrail: string[];
      }> = [];

      for (const res of layer1Results) {
        analyzedCount++;
        if (res.evalFail) {
          // CRITICAL: Immediately stop further analysis for candidates failing Layer 1!
          rejected.push(res.evalFail);
        } else if (res.l1Result && res.sorted1h) {
          layer1SurvivorsInBatch.push({
            cand: res.cand,
            candles15m: res.candles15m,
            sorted1h: res.sorted1h,
            l1Result: res.l1Result,
            auditTrail: res.auditTrail!,
          });
        }
      }

      // STEP 2: LAYER 2 (5m + 4h) - Execute ONLY for Layer-1 survivors with parallel fetching
      const remainingSlots = Math.max(0, targetSurvivors - survived.length);
      const survivorsToProcess = layer1SurvivorsInBatch.slice(0, remainingSlots);

      if (survivorsToProcess.length > 0) {
        const remainingMs = deadlineMs - Date.now();
        const currentElapsedMs = Date.now() - startMs;

        // Stop starting expensive work if deadline is near
        if (remainingMs <= 1500 || currentElapsedMs >= 22500) {
          timeBudgetExceeded = true;
          providerRequestsStoppedByBudget = true;
          logger.warn(
            `[Gate 6 Time Budget Exceeded] Global scan elapsed (${currentElapsedMs}ms) reached threshold (22500ms / remaining ${remainingMs}ms). Halting further Gate 6 Layer 2 candidate processing.`
          );
        } else {
          const l2Evaluations = await Promise.all(
            survivorsToProcess.map(async (survivor) => {
              const { cand, candles15m, sorted1h, l1Result, auditTrail } = survivor;
              const asset = cand.asset;
              const direction = cand.direction;
              const scoreBeforeGate6 = cand.preliminaryScore;

              let candles5m: NormalizedCandle[] = [];
              let candles4h: NormalizedCandle[] = [];

              try {
                const [fetched5m, fetched4h] = await Promise.all([
                  marketDataManager.getCandles(asset, undefined, '5m', 50, false).catch(() => []),
                  marketDataManager.getCandles(asset, undefined, '4h', 40, false).catch(() => []),
                ]);
                if (fetched5m && fetched5m.length >= 10) candles5m = fetched5m.sort((a, b) => a.timestamp - b.timestamp);
                if (fetched4h && fetched4h.length >= 10) candles4h = fetched4h.sort((a, b) => a.timestamp - b.timestamp);
              } catch (err: any) {
                logger.warn(`[Gate 6 MTF] Error fetching Layer 2 candles for ${asset}: ${err?.message || err}`);
              }

              const lastPrice = sorted1h[sorted1h.length - 1]?.close || 0;
              const l2Result = Gate6ProgressiveMTF.evaluateLayer2(direction, lastPrice, candles5m, candles15m, sorted1h, candles4h);

              const candlesMap: Record<string, NormalizedCandle[]> = {
                '1h': sorted1h,
                '15m': candles15m,
              };
              if (candles5m.length > 0) candlesMap['5m'] = candles5m;
              if (candles4h.length > 0) candlesMap['4h'] = candles4h;

              const compositeScore = Math.round(l1Result.score * 0.6 + l2Result.score * 0.4);
              const maximumPossibleScoreAfterRemainingAnalysis = Math.min(100, Math.max(scoreBeforeGate6 + 25, compositeScore + 15));
              const scoreAfterGate6 = compositeScore;
              const finalScore = compositeScore;

              if (!l2Result.passed) {
                auditTrail.push(`[Gate 6 Layer 2 REJECTED] ${l2Result.rejectionReason}.`);
                logger.info(`[Gate 6 Layer 2 Halt] ${asset} rejected: ${l2Result.rejectionReason}`);

                const evalL2Fail: Gate6CandidateEvaluation = {
                  asset,
                  direction,
                  passed: false,
                  stoppedAtLayer: 2,
                  layer1: l1Result,
                  layer2: l2Result,
                  compositeMtfScore: compositeScore,
                  candlesMap,
                  rejectionReason: l2Result.rejectionReason,
                  auditTrail,
                  scoreBeforeGate6,
                  maximumPossibleScoreAfterRemainingAnalysis,
                  scoreAfterGate6,
                  finalScore,
                  factors: Gate6ProgressiveMTF.extractFactors(cand, l1Result, l2Result, compositeScore),
                };
                return { isSuccess: false, evalData: evalL2Fail };
              }

              auditTrail.push(`[Gate 6 Layer 2 PASSED] Composite MTF Score: ${compositeScore}/100. Candidate survived to Gate 7.`);
              logger.info(`[Gate 6 MTF Confluence Passed] ${asset} (${direction}) -> Composite MTF Score: ${compositeScore}/100`);

              const evalSuccess: Gate6CandidateEvaluation = {
                asset,
                direction,
                passed: true,
                stoppedAtLayer: 'PASSED',
                layer1: l1Result,
                layer2: l2Result,
                compositeMtfScore: compositeScore,
                candlesMap,
                auditTrail,
                scoreBeforeGate6,
                maximumPossibleScoreAfterRemainingAnalysis,
                scoreAfterGate6,
                finalScore,
                factors: Gate6ProgressiveMTF.extractFactors(cand, l1Result, l2Result, compositeScore),
              };
              return { isSuccess: true, evalData: evalSuccess };
            })
          );

          for (const res of l2Evaluations) {
            layer2EvaluationsCount++;
            if (res.isSuccess) {
              survived.push(res.evalData);
            } else {
              rejected.push(res.evalData);
            }
          }
        }
      }
    }

    const gate6ElapsedMs = Date.now() - gate6StartMs;

    // Calculate mandated rejection telemetry category counters
    let candidatesRejectedBeforeMTF = 0;
    let candidatesRejectedByMTF = 0;
    let candidatesRejectedByScore = 0;
    let candidatesRejectedByRR = 0;
    let candidatesRejectedByStructure = 0;

    const authThreshold = serverConfig.getConfig().thresholds.signalThreshold;
    for (const rej of rejected) {
      const reasonLower = (rej.rejectionReason || '').toLowerCase();
      const isBefore = rej.stoppedAtLayer === 'BEFORE_MTF' || reasonLower.includes('final_score_unreachable') || reasonLower.includes('halting mtf requests');
      const isMTF = !isBefore && (reasonLower.includes('layer 1') || reasonLower.includes('layer 2') || reasonLower.includes('mtf'));
      const isScore = rej.finalScore < authThreshold || rej.compositeMtfScore < authThreshold || rej.maximumPossibleScoreAfterRemainingAnalysis < authThreshold || reasonLower.includes('score');
      const isRR = reasonLower.includes('rr') || reasonLower.includes('risk/reward');
      const isStruct = reasonLower.includes('structure') || reasonLower.includes('support') || reasonLower.includes('resistance');

      if (isBefore) candidatesRejectedBeforeMTF++;
      if (isMTF) candidatesRejectedByMTF++;
      if (isScore) candidatesRejectedByScore++;
      if (isRR) candidatesRejectedByRR++;
      if (isStruct) candidatesRejectedByStructure++;
    }

    return {
      totalInputCandidates: candidates.length,
      analyzedCandidatesCount: analyzedCount,
      survivedCandidatesCount: survived.length,
      survivedCandidates: survived,
      rejectedCandidates: rejected,
      summary: `Gate 6 Progressive MTF evaluated ${analyzedCount}/${candidates.length} candidates. Survived: ${survived.length}, Rejected: ${rejected.length} (Before MTF: ${candidatesRejectedBeforeMTF}). Elapsed: ${gate6ElapsedMs}ms.`,
      gate6ElapsedMs,
      timeBudgetExceeded,
      providerRequestsStoppedByBudget,
      candidatesRejectedBeforeMTF,
      candidatesRejectedByMTF,
      candidatesRejectedByScore,
      candidatesRejectedByRR,
      candidatesRejectedByStructure,
    };
  }
}
