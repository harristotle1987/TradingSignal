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
  stoppedAtLayer: 1 | 2 | 'PASSED';
  layer1: Gate6Layer1Result;
  layer2?: Gate6Layer2Result;
  compositeMtfScore: number;
  candlesMap: Record<string, NormalizedCandle[]>;
  rejectionReason?: string;
  auditTrail: string[];
}

export interface Gate6ProgressiveAnalysisResult {
  totalInputCandidates: number;
  analyzedCandidatesCount: number;
  survivedCandidatesCount: number;
  survivedCandidates: Gate6CandidateEvaluation[];
  rejectedCandidates: Gate6CandidateEvaluation[];
  summary: string;
}

export class Gate6ProgressiveMTF {
  private static readonly MAX_EXPENSIVE_CANDIDATES = 5;

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
      else if (tf1hDirection === 'BULLISH' && tf15mDirection === 'NEUTRAL') trendScore = 75;
      else if (tf1hDirection === 'NEUTRAL' && tf15mDirection === 'BULLISH') trendScore = 70;
      else if (tf15mDirection === 'BEARISH' || tf1hDirection === 'BEARISH') {
        trendScore = 20;
        disagreements.push(`Trend conflict: 1h is ${tf1hDirection}, 15m is ${tf15mDirection} (opposing BUY).`);
      }
    } else {
      if (tf1hDirection === 'BEARISH' && tf15mDirection === 'BEARISH') trendScore = 100;
      else if (tf1hDirection === 'BEARISH' && tf15mDirection === 'NEUTRAL') trendScore = 75;
      else if (tf1hDirection === 'NEUTRAL' && tf15mDirection === 'BEARISH') trendScore = 70;
      else if (tf15mDirection === 'BULLISH' || tf1hDirection === 'BULLISH') {
        trendScore = 20;
        disagreements.push(`Trend conflict: 1h is ${tf1hDirection}, 15m is ${tf15mDirection} (opposing SELL).`);
      }
    }

    // --- B. EMA Structure (Price vs EMA21 / EMA50) ---
    let emaStructureScore = 50;
    const price1hAboveEma21 = last1h.close >= valE21_1h;
    const price15mAboveEma21 = last15m.close >= valE21_15m;

    if (isBuy) {
      if (price1hAboveEma21 && price15mAboveEma21) emaStructureScore = 95;
      else if (price1hAboveEma21 && !price15mAboveEma21) {
        emaStructureScore = 60; // Potential pullback setup
      } else if (!price1hAboveEma21 && !price15mAboveEma21) {
        emaStructureScore = 25;
        disagreements.push('EMA Structure: Price is below EMA21 on both 1h and 15m.');
      }
    } else {
      if (!price1hAboveEma21 && !price15mAboveEma21) emaStructureScore = 95;
      else if (!price1hAboveEma21 && price15mAboveEma21) {
        emaStructureScore = 60; // Potential pullback rally
      } else if (price1hAboveEma21 && price15mAboveEma21) {
        emaStructureScore = 25;
        disagreements.push('EMA Structure: Price is above EMA21 on both 1h and 15m.');
      }
    }

    // --- C. Momentum (ROC / Rate of Change over 10 bars) ---
    const lookback = 10;
    const prev1h = sorted1h[Math.max(0, sorted1h.length - 1 - lookback)];
    const prev15m = sorted15m[Math.max(0, sorted15m.length - 1 - lookback)];

    const roc1h = prev1h && prev1h.close > 0 ? ((last1h.close - prev1h.close) / prev1h.close) * 100 : 0;
    const roc15m = prev15m && prev15m.close > 0 ? ((last15m.close - prev15m.close) / prev15m.close) * 100 : 0;

    let momScore = 50;
    if (isBuy) {
      if (roc1h > 0 && roc15m > 0) momScore = 90;
      else if (roc1h > 0 && roc15m >= -0.2) momScore = 70;
      else if (roc1h < -0.5 && roc15m < -0.5) {
        momScore = 20;
        disagreements.push(`Momentum conflict: Negative velocity on both 1h (${roc1h.toFixed(2)}%) and 15m (${roc15m.toFixed(2)}%).`);
      }
    } else {
      if (roc1h < 0 && roc15m < 0) momScore = 90;
      else if (roc1h < 0 && roc15m <= 0.2) momScore = 70;
      else if (roc1h > 0.5 && roc15m > 0.5) {
        momScore = 20;
        disagreements.push(`Momentum conflict: Positive velocity on both 1h (${roc1h.toFixed(2)}%) and 15m (${roc15m.toFixed(2)}%).`);
      }
    }

    // --- D. RSI ---
    const rsi1hSeries = TechnicalIndicators.calculateRSI(sorted1h, 14);
    const rsi15mSeries = TechnicalIndicators.calculateRSI(sorted15m, 14);
    const rsi1h = rsi1hSeries[rsi1hSeries.length - 1] ?? 50;
    const rsi15m = rsi15mSeries[rsi15mSeries.length - 1] ?? 50;

    let rsiScore = 50;
    let rsiHealthy = true;
    if (isBuy) {
      if (rsi1h >= 45 && rsi1h <= 72 && rsi15m >= 40 && rsi15m <= 75) {
        rsiScore = 90;
      } else if (rsi1h < 35 && rsi15m < 30) {
        rsiScore = 25;
        rsiHealthy = false;
        disagreements.push(`RSI severely oversold/collapsing: 1h RSI=${rsi1h.toFixed(1)}, 15m RSI=${rsi15m.toFixed(1)}.`);
      } else if (rsi15m > 80) {
        rsiScore = 35;
        disagreements.push(`RSI 15m is overextended/topping: RSI=${rsi15m.toFixed(1)}.`);
      } else {
        rsiScore = 65;
      }
    } else {
      if (rsi1h <= 55 && rsi1h >= 28 && rsi15m <= 60 && rsi15m >= 25) {
        rsiScore = 90;
      } else if (rsi1h > 65 && rsi15m > 70) {
        rsiScore = 25;
        rsiHealthy = false;
        disagreements.push(`RSI severely overbought/surging: 1h RSI=${rsi1h.toFixed(1)}, 15m RSI=${rsi15m.toFixed(1)}.`);
      } else if (rsi15m < 20) {
        rsiScore = 35;
        disagreements.push(`RSI 15m is overextended/bottoming: RSI=${rsi15m.toFixed(1)}.`);
      } else {
        rsiScore = 65;
      }
    }

    // --- E. MACD ---
    const macd1h = TechnicalIndicators.calculateMACD(sorted1h);
    const macd15m = TechnicalIndicators.calculateMACD(sorted15m);
    let macdScore = 50;
    let macdAligned = true;

    if (macd1h && macd15m) {
      const macd1hBullish = macd1h.histogram >= 0 || macd1h.macdLine > macd1h.signalLine;
      const macd15mBullish = macd15m.histogram >= 0 || macd15m.macdLine > macd15m.signalLine;

      if (isBuy) {
        if (macd1hBullish && macd15mBullish) macdScore = 95;
        else if (macd1hBullish && !macd15mBullish) macdScore = 60;
        else if (!macd1hBullish && !macd15mBullish) {
          macdScore = 20;
          macdAligned = false;
          disagreements.push('MACD: Both 1h and 15m MACD histograms are negative, contradicting BUY.');
        }
      } else {
        if (!macd1hBullish && !macd15mBullish) macdScore = 95;
        else if (!macd1hBullish && macd15mBullish) macdScore = 60;
        else if (macd1hBullish && macd15mBullish) {
          macdScore = 20;
          macdAligned = false;
          disagreements.push('MACD: Both 1h and 15m MACD histograms are positive, contradicting SELL.');
        }
      }
    }

    // --- F. ADX & Directional Movement ---
    const adx1h = TechnicalIndicators.calculateADX(sorted1h, 14);
    const adx15m = TechnicalIndicators.calculateADX(sorted15m, 14);
    let adxScore = 50;
    let isTrending = true;

    if (adx1h && adx15m) {
      if (isBuy) {
        if (adx1h.pdi > adx1h.mdi && adx15m.pdi > adx15m.mdi) {
          adxScore = adx1h.adx >= 20 ? 95 : 80;
        } else if (adx1h.mdi > adx1h.pdi && adx1h.adx >= 25 && adx15m.mdi > adx15m.pdi) {
          adxScore = 20;
          isTrending = false;
          disagreements.push(`ADX: Strong bearish directional movement (-DI > +DI) on 1h (ADX ${adx1h.adx.toFixed(1)}) and 15m.`);
        } else {
          adxScore = 60;
        }
      } else {
        if (adx1h.mdi > adx1h.pdi && adx15m.mdi > adx15m.pdi) {
          adxScore = adx1h.adx >= 20 ? 95 : 80;
        } else if (adx1h.pdi > adx1h.mdi && adx1h.adx >= 25 && adx15m.pdi > adx15m.mdi) {
          adxScore = 20;
          isTrending = false;
          disagreements.push(`ADX: Strong bullish directional movement (+DI > -DI) on 1h (ADX ${adx1h.adx.toFixed(1)}) and 15m.`);
        } else {
          adxScore = 60;
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
      else if (ms1h.structureBias === 'BULLISH' && ms15m.structureBias === 'RANGE') msScore = 75;
      else if (ms1h.structureBias === 'BEARISH' && ms15m.structureBias === 'BEARISH') {
        msScore = 15;
        msAligned = false;
        disagreements.push('Market Structure: Lower highs and lower lows confirmed on both 1h and 15m (opposing BUY).');
      } else if (ms15m.structureBias === 'BEARISH' && ms15m.lowerLowsCount >= 2) {
        msScore = 30;
        disagreements.push('Market Structure: 15m has broken market structure with multiple lower lows.');
      } else {
        msScore = 60;
      }
    } else {
      if (ms1h.structureBias === 'BEARISH' && ms15m.structureBias === 'BEARISH') msScore = 95;
      else if (ms1h.structureBias === 'BEARISH' && ms15m.structureBias === 'RANGE') msScore = 75;
      else if (ms1h.structureBias === 'BULLISH' && ms15m.structureBias === 'BULLISH') {
        msScore = 15;
        msAligned = false;
        disagreements.push('Market Structure: Higher highs and higher lows confirmed on both 1h and 15m (opposing SELL).');
      } else if (ms15m.structureBias === 'BULLISH' && ms15m.higherHighsCount >= 2) {
        msScore = 30;
        disagreements.push('Market Structure: 15m has broken market structure with multiple higher highs.');
      } else {
        msScore = 60;
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

    const hasHardContradiction =
      disagreements.length >= 2 ||
      trendScore <= 20 ||
      (msScore <= 20 && !msAligned) ||
      (macdScore <= 20 && !macdAligned);

    const passed = !hasHardContradiction && compositeLayer1Score >= 50;

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
      if (atrPct < 0.02) {
        volatilityState = 'DEAD';
        atrHealthy = false;
        atrScore = 25;
        disagreements.push(`Volatility is dead: 1h ATR is only ${atrPct.toFixed(4)}% of price.`);
      } else if (atrPct > 12.0) {
        volatilityState = 'ERRATIC';
        atrHealthy = false;
        atrScore = 30;
        disagreements.push(`Volatility is erratic: 1h ATR is ${atrPct.toFixed(2)}% of price.`);
      } else if (atr15m > atr1h * 0.4) {
        volatilityState = 'EXPANDING';
        atrScore = 95;
      } else {
        volatilityState = 'NORMAL';
        atrScore = 85;
      }
    }

    // --- B. Support & Resistance Clearance ---
    // Compute key swing levels across 4h and 1h
    const slice4h = sorted4h.slice(-20);
    const slice1h = sorted1h.slice(-30);
    const swingHighs = [...slice4h.map(c => c.high), ...slice1h.map(c => c.high)];
    const swingLows = [...slice4h.map(c => c.low), ...slice1h.map(c => c.low)];

    const resistanceLevels = swingHighs.filter(h => h > currentPrice).sort((a, b) => a - b);
    const supportLevels = swingLows.filter(l => l < currentPrice).sort((a, b) => b - a);

    const nearestResistance = resistanceLevels.length > 0 ? resistanceLevels[0] : currentPrice * 1.05;
    const nearestSupport = supportLevels.length > 0 ? supportLevels[0] : currentPrice * 0.95;

    let srScore = 80;
    let srFavorable = true;
    let clearancePct = 0;

    if (isBuy) {
      clearancePct = ((nearestResistance - currentPrice) / currentPrice) * 100;
      if (clearancePct < 0.15 && currentPrice > 0) {
        srScore = 30;
        srFavorable = false;
        disagreements.push(`Resistance ceiling: Entry is only ${clearancePct.toFixed(2)}% below major resistance (${nearestResistance.toFixed(4)}).`);
      } else if (clearancePct > 1.0) {
        srScore = 95;
      }
    } else {
      clearancePct = ((currentPrice - nearestSupport) / currentPrice) * 100;
      if (clearancePct < 0.15 && currentPrice > 0) {
        srScore = 30;
        srFavorable = false;
        disagreements.push(`Support floor: Entry is only ${clearancePct.toFixed(2)}% above major support (${nearestSupport.toFixed(4)}).`);
      } else if (clearancePct > 1.0) {
        srScore = 95;
      }
    }

    // --- C. Market Structure Confirmation (5m & 4h) ---
    const ms5m = TechnicalIndicators.calculateMarketStructure(sorted5m);
    const ms4h = TechnicalIndicators.calculateMarketStructure(sorted4h);

    let msConfScore = 50;
    let msConfirmed = true;

    if (isBuy) {
      if (ms4h.structureBias === 'BULLISH' && (ms5m.structureBias === 'BULLISH' || ms5m.higherLowsCount >= 1)) {
        msConfScore = 95;
      } else if (ms4h.structureBias === 'RANGE' && ms5m.structureBias === 'BULLISH') {
        msConfScore = 80;
      } else if (ms4h.structureBias === 'BEARISH' && ms5m.structureBias === 'BEARISH') {
        msConfScore = 20;
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
        msConfScore = 20;
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

    const passed = atrHealthy && srFavorable && msConfirmed && compositeLayer2Score >= 50;

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

    // Bounded parallelism for Layer 1 execution
    const CONCURRENCY_LIMIT = 4;

    for (let i = 0; i < candidates.length; i += CONCURRENCY_LIMIT) {
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

      const batch = candidates.slice(i, i + CONCURRENCY_LIMIT);

      // STEP 1: LAYER 1 (15m + 1h) - Execute 15m fetches in parallel for the batch (1h candles already available)
      const layer1Results = await Promise.all(
        batch.map(async (cand) => {
          const asset = cand.asset;
          const direction = cand.direction;
          const sorted1h = [...cand.htf1h].sort((a, b) => a.timestamp - b.timestamp);
          const auditTrail: string[] = [];

          auditTrail.push(`[Gate 6] Starting Layer 1 (15m & 1h) analysis for ${asset} (${direction}).`);

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
            };
            return { cand, candles15m, l1Result, evalFail: evalL1Fail };
          }

          auditTrail.push(`[Gate 6 Layer 1 PASSED] Score: ${l1Result.score}/100. Requesting Layer 2 (5m & 4h)...`);
          return { cand, candles15m, sorted1h, l1Result, auditTrail, evalFail: null };
        })
      );

      // Process Layer 1 outcomes
      const layer1SurvivorsInBatch: Array<{
        cand: typeof candidates[0];
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

      // STEP 2: LAYER 2 (5m + 4h) - Execute ONLY for Layer-1 survivors
      for (const survivor of layer1SurvivorsInBatch) {
        if (survived.length >= targetSurvivors || layer2EvaluationsCount >= maxLayer2Allowed) {
          break;
        }

        const remainingMs = deadlineMs - Date.now();
        const currentElapsedMs = Date.now() - startMs;

        // Rule 2: Gate 6 must stop starting expensive work when remainingMs <= 1500ms OR currentElapsedMs >= 22500ms
        if (remainingMs <= 1500 || currentElapsedMs >= 22500) {
          timeBudgetExceeded = true;
          providerRequestsStoppedByBudget = true;
          logger.warn(
            `[Gate 6 Time Budget Exceeded] Global scan elapsed (${currentElapsedMs}ms) reached threshold (22500ms / remaining ${remainingMs}ms). Halting further Gate 6 Layer 2 candidate processing.`
          );
          break;
        }

        const { cand, candles15m, sorted1h, l1Result, auditTrail } = survivor;
        const asset = cand.asset;
        const direction = cand.direction;

        layer2EvaluationsCount++;

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
          };
          rejected.push(evalL2Fail);
          continue;
        }

        auditTrail.push(`[Gate 6 Layer 2 PASSED] Score: ${l2Result.score}/100. Candidate survived to Gate 7.`);
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
        };
        survived.push(evalSuccess);
      }
    }

    const gate6ElapsedMs = Date.now() - gate6StartMs;

    return {
      totalInputCandidates: candidates.length,
      analyzedCandidatesCount: analyzedCount,
      survivedCandidatesCount: survived.length,
      survivedCandidates: survived,
      rejectedCandidates: rejected,
      summary: `Gate 6 analyzed ${analyzedCount}/${candidates.length} deep candidates. ${survived.length} passed both Layer 1 & Layer 2 (Target TOP 3–5).`,
      gate6ElapsedMs,
      timeBudgetExceeded,
      providerRequestsStoppedByBudget,
    };
  }
}
