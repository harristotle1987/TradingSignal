/**
 * Backend Multi-Strategy Confluence & Agreement Engine
 *
 * Implements the upgraded institutional backend qualification pipeline:
 *
 * 1. Market Classification (Regime Detection):
 *    - UPTREND / DOWNTREND / RANGE / BREAKOUT / HIGH-VOLATILITY / LOW-VOLATILITY
 *
 * 2. Timeframe Hierarchy:
 *    - 4H / 1D = Major Direction
 *    - 1H = Setup (Primary structure, S/R levels, baseline ATR)
 *    - 15M = Confirmation (Zero-Lag MACD, RSI, Order Flow, Bollinger)
 *    - 5M = Entry (Entry precision, price action trigger, micro EMA alignment)
 *    - 30M / 2H / 1W = Auxiliary confirmation only when required.
 *
 * 3. Strategy Weighting per Regime:
 *    - TREND: Trend + Momentum + Pullback receive highest weight.
 *    - BREAKOUT: Breakout + Volume + Momentum + Volatility receive highest weight.
 *    - RANGE: Mean Reversion + Structure + Volatility receive highest weight.
 *
 * 4. 6 Existing Institutional Strategies:
 *    1. TREND FOLLOWING (Primary Direction & Trend-Pullback)
 *    2. MOMENTUM (Zero-Lag MACD + RSI Acceleration)
 *    3. INTRADAY BREAKOUT (Genuine S/R + Volume + Volatility Expansion)
 *    4. RSI + BOLLINGER MEAN REVERSION (Range-Only)
 *    5. ORDER FLOW IMBALANCE (Confirmation Only)
 *    6. VOLATILITY FILTER (Mandatory Gate)
 */

import { NormalizedCandle, SignalDirection } from '../../types/index.js';
import { TechnicalIndicators } from './TechnicalIndicators.js';
import { StrategyPerformanceTracker } from './StrategyPerformanceTracker.js';
import { logger } from '../logger.js';

export type MarketRegime =
  | 'TRENDING'
  | 'RANGING'
  | 'BREAKOUT'
  | 'HIGH_VOLATILITY'
  | 'LOW_VOLATILITY'
  | 'UPTREND'
  | 'DOWNTREND'
  | 'RANGE'
  | 'HIGH-VOLATILITY'
  | 'LOW-VOLATILITY';

export interface StrategyResult {
  id: string;
  name: string;
  direction: SignalDirection | 'NEUTRAL';
  score: number; // 0 - 100
  passed: boolean;
  weight: number;
  reasons: string[];
}

export interface MultiStrategyAgreement {
  dominantDirection: SignalDirection | null;
  agreeingStrategiesCount: number; // e.g. 5 out of 6
  totalStrategiesCount: number; // 6
  agreementScore: number; // 0 - 100
  hasStrongConfluence: boolean;
  marketRegime: MarketRegime;
  regimeDetails: string;
  strategyResults: StrategyResult[];
  timeframeConfluenceScore: number;
  evaluatedTimeframes: string[];
  reasons: string[];
  rejectionReason?: string;
}

export class StrategyEngine {
  static isTrending(regime: MarketRegime): boolean {
    return regime === 'TRENDING' || regime === 'UPTREND' || regime === 'DOWNTREND';
  }

  static isRanging(regime: MarketRegime): boolean {
    return regime === 'RANGING' || regime === 'RANGE';
  }

  static isBreakout(regime: MarketRegime): boolean {
    return regime === 'BREAKOUT';
  }

  static isHighVolatility(regime: MarketRegime): boolean {
    return regime === 'HIGH_VOLATILITY' || regime === 'HIGH-VOLATILITY';
  }

  static isLowVolatility(regime: MarketRegime): boolean {
    return regime === 'LOW_VOLATILITY' || regime === 'LOW-VOLATILITY';
  }

  /**
   * Classifies the market regime from multi-timeframe candle datasets:
   * TRENDING / RANGING / BREAKOUT / HIGH_VOLATILITY / LOW_VOLATILITY
   */
  static classifyMarketRegime(
    symbol: string,
    entryPrice: number,
    tfMap: Record<string, NormalizedCandle[]>
  ): { regime: MarketRegime; regimeDetails: string } {
    const s1h = tfMap['1h'] || [];
    const s15m = tfMap['15m'] || [];
    const s4h = tfMap['4h'] || [];
    const s1d = tfMap['1d'] || [];

    if (s1h.length < 20) {
      return { regime: 'RANGING', regimeDetails: 'Insufficient 1H history to determine regime' };
    }

    // 1. Volatility Metrics Check (1H & 15m)
    const vm1h = TechnicalIndicators.calculateVolatilityMetrics(s1h, 14);
    const vm15m = s15m.length >= 20 ? TechnicalIndicators.calculateVolatilityMetrics(s15m, 14) : vm1h;

    // A. Extreme Volatility (High or Low)
    if (vm1h.atrRatio >= 1.85 || vm1h.isErratic) {
      return {
        regime: 'HIGH_VOLATILITY',
        regimeDetails: `High-volatility regime: 1H ATR ratio (${vm1h.atrRatio}x) shows wide volatility expansion / momentum surge`,
      };
    }
    if (vm1h.atrRatio <= 0.55 || (vm1h.isSqueeze && vm15m.isSqueeze)) {
      return {
        regime: 'LOW_VOLATILITY',
        regimeDetails: `Low-volatility regime: 1H ATR ratio (${vm1h.atrRatio}x) compressed into tight volatility squeeze`,
      };
    }

    // 2. Breakout Evaluation
    const dc1h = TechnicalIndicators.calculateDonchianChannels(s1h, 20);
    if (dc1h) {
      const range1h = dc1h.upper - dc1h.lower;
      const isAtUpperEdge = entryPrice >= dc1h.upper - range1h * 0.05;
      const isAtLowerEdge = entryPrice <= dc1h.lower + range1h * 0.05;
      const last1hVol = s1h[s1h.length - 1]?.volume || 0;
      const avg1hVol = s1h.slice(-20).reduce((acc, c) => acc + (c.volume || 0), 0) / 20;
      const isVolExpanding = avg1hVol > 0 ? last1hVol >= avg1hVol * 1.15 : true;

      if ((isAtUpperEdge || isAtLowerEdge) && isVolExpanding && vm1h.atrRatio >= 1.05) {
        return {
          regime: 'BREAKOUT',
          regimeDetails: `Breakout regime: Price breaking 1H Donchian boundary with expanding volume (${(last1hVol / Math.max(1, avg1hVol)).toFixed(2)}x)`,
        };
      }
    }

    // 3. Trend vs Range Evaluation
    const ema9_1h = TechnicalIndicators.calculateEMA(s1h, 9);
    const ema21_1h = TechnicalIndicators.calculateEMA(s1h, 21);
    const ema50_1h = s1h.length >= 50 ? TechnicalIndicators.calculateEMA(s1h, 50) : [];

    const lastEma9_1h = ema9_1h[ema9_1h.length - 1];
    const lastEma21_1h = ema21_1h[ema21_1h.length - 1];
    const lastEma50_1h = ema50_1h.length > 0 ? ema50_1h[ema50_1h.length - 1] : lastEma21_1h;

    const slope9_1h = TechnicalIndicators.calculateEMASlope(ema9_1h, 3);
    const slope21_1h = TechnicalIndicators.calculateEMASlope(ema21_1h, 3);
    const struct1h = TechnicalIndicators.calculateMarketStructure(s1h, 15);

    // HTF (4H/1D) trend validation if available
    let htfBull = true;
    let htfBear = true;
    if (s4h.length >= 20) {
      const ema21_4h = TechnicalIndicators.calculateEMA(s4h, 21);
      if (ema21_4h.length > 0) {
        const last4h = ema21_4h[ema21_4h.length - 1];
        if (entryPrice < last4h) htfBull = false;
        if (entryPrice > last4h) htfBear = false;
      }
    }
    if (s1d.length >= 20) {
      const ema21_1d = TechnicalIndicators.calculateEMA(s1d, 21);
      if (ema21_1d.length > 0) {
        const last1d = ema21_1d[ema21_1d.length - 1];
        if (entryPrice < last1d) htfBull = false;
        if (entryPrice > last1d) htfBear = false;
      }
    }

    const isBullTrend =
      lastEma9_1h > lastEma21_1h &&
      lastEma21_1h >= lastEma50_1h &&
      slope21_1h > -0.01 &&
      (struct1h.structureBias === 'BULLISH' || htfBull);

    const isBearTrend =
      lastEma9_1h < lastEma21_1h &&
      lastEma21_1h <= lastEma50_1h &&
      slope21_1h < 0.01 &&
      (struct1h.structureBias === 'BEARISH' || htfBear);

    if (isBullTrend) {
      return {
        regime: 'TRENDING',
        regimeDetails: 'TRENDING (UPTREND): Bullish hierarchical EMA stack & higher high/low structure',
      };
    }
    if (isBearTrend) {
      return {
        regime: 'TRENDING',
        regimeDetails: 'TRENDING (DOWNTREND): Bearish hierarchical EMA stack & lower high/low structure',
      };
    }

    return {
      regime: 'RANGING',
      regimeDetails: 'RANGING: Price moving between horizontal support/resistance boundaries',
    };
  }

  /**
   * Evaluates all 6 backend strategies with dynamic regime-weighted confluence.
   */
  static evaluate(
    symbol: string,
    entryPrice: number,
    candlesMap: Record<string, NormalizedCandle[]>
  ): MultiStrategyAgreement {
    const cleanSym = symbol.trim().toUpperCase();

    const tfMap: Record<string, NormalizedCandle[]> = {};
    const availableTfs: string[] = [];

    for (const [tf, candles] of Object.entries(candlesMap)) {
      if (candles && candles.length >= 10) {
        tfMap[tf] = [...candles].sort((a, b) => a.timestamp - b.timestamp);
        availableTfs.push(tf);
      }
    }

    // Require primary baseline timeframes (15m and 1h) to proceed
    if (!tfMap['15m'] || tfMap['15m'].length < 20 || !tfMap['1h'] || tfMap['1h'].length < 20) {
      return this.createRejection('Insufficient candle depth in primary baseline timeframes (15m/1h required)');
    }

    // 2. Classify the Market Regime
    const { regime, regimeDetails } = this.classifyMarketRegime(cleanSym, entryPrice, tfMap);

    // 3. Evaluate the 6 Backend Strategies enforcing regime appropriateness
    const s1 = this.evalTrendFollowing(cleanSym, entryPrice, tfMap, regime);
    const s2 = this.evalMomentumZeroLag(cleanSym, entryPrice, tfMap, regime);
    const s3 = this.evalIntradayBreakout(cleanSym, entryPrice, tfMap, regime);
    const s4 = this.evalBollingerMeanReversion(cleanSym, entryPrice, tfMap, s1, regime);
    const s5 = this.evalOrderFlowImbalance(cleanSym, entryPrice, tfMap, s1.direction, regime);
    const s6 = this.evalVolatilityProtection(cleanSym, entryPrice, tfMap, regime);

    // 4. Apply Strategy Weighting According to Regime
    this.applyRegimeWeights(regime, [s1, s2, s3, s4, s5, s6]);

    const strategyResults: StrategyResult[] = [s1, s2, s3, s4, s5, s6];

    // Mandatory Volatility Gate check: Strategy 6 MUST pass with clean volatility conditions
    if (!s6.passed || s6.score < 50) {
      return this.createRejection(`Volatility gate rejected setup: ${s6.reasons.join('; ')}`, regime, regimeDetails);
    }

    // 5. Directional Determination according to Regime
    let dominantDirection: SignalDirection | null = null;
    if (StrategyEngine.isTrending(regime)) {
      if (s1.passed && s1.direction !== 'NEUTRAL') dominantDirection = s1.direction;
      else if (s2.passed && s2.direction !== 'NEUTRAL') dominantDirection = s2.direction;
      else if (s3.passed && s3.direction !== 'NEUTRAL') dominantDirection = s3.direction;
    } else if (StrategyEngine.isBreakout(regime) && s3.passed && s3.direction !== 'NEUTRAL') {
      dominantDirection = s3.direction;
    } else if (StrategyEngine.isRanging(regime) && s4.passed && s4.direction !== 'NEUTRAL') {
      dominantDirection = s4.direction;
    } else if (s1.passed && s1.direction !== 'NEUTRAL') {
      dominantDirection = s1.direction;
    } else if (s2.passed && s2.direction !== 'NEUTRAL') {
      dominantDirection = s2.direction;
    } else if (s3.passed && s3.direction !== 'NEUTRAL') {
      dominantDirection = s3.direction;
    }

    if (!dominantDirection) {
      return this.createRejection(
        'No directional trend or validated breakout established by primary strategies',
        regime,
        regimeDetails
      );
    }

    // 6. Evaluate Strategy Agreement and Confluence
    let agreeingStrategiesCount = 0;
    let weightedScoreSum = 0;
    let totalWeight = 0;

    for (const s of strategyResults) {
      totalWeight += s.weight;
      if (s.direction === dominantDirection && s.passed) {
        agreeingStrategiesCount++;
        weightedScoreSum += s.score * s.weight;
      } else if (s.id === 'strat_6' && s.passed) {
        agreeingStrategiesCount++;
        weightedScoreSum += s.score * s.weight;
      }
    }

    // Multi-Timeframe Alignment
    const tfScores = this.evaluateMultiTimeframeAlignment(dominantDirection, entryPrice, tfMap);

    const rawWeightedScore = totalWeight > 0 ? weightedScoreSum / totalWeight : 0;
    const agreementRatio = agreeingStrategiesCount / 6;
    const agreementScore = Math.round(
      agreementRatio * 40 +
        (tfScores.alignedCount / Math.max(1, tfScores.totalEvaluated)) * 30 +
        (rawWeightedScore / 100) * 30
    );

    // Require at least 4 out of 6 strategies agreeing, minimum 70 agreement score, and at least 3 aligned timeframes
    const hasStrongConfluence = agreeingStrategiesCount >= 4 && agreementScore >= 70 && tfScores.alignedCount >= 3;

    if (!hasStrongConfluence) {
      return this.createRejection(
        `Insufficient strategy confluence: ${agreeingStrategiesCount}/6 strategies agreed with ${tfScores.alignedCount}/${tfScores.totalEvaluated} timeframes (Agreement Score: ${agreementScore}/100, min 70 required)`,
        regime,
        regimeDetails
      );
    }

    const reasons: string[] = [];
    reasons.push(`Market Regime: ${regime} — ${regimeDetails}`);
    reasons.push(`Strategy Confluence: ${agreeingStrategiesCount}/6 backend strategies aligned for ${dominantDirection}`);
    reasons.push(
      `Timeframe Hierarchy: ${tfScores.alignedCount}/${tfScores.totalEvaluated} evaluated timeframes (${availableTfs.join(
        ', '
      )}) confirm direction`
    );

    for (const s of strategyResults) {
      if ((s.direction === dominantDirection || s.id === 'strat_6') && s.passed && s.reasons.length > 0) {
        reasons.push(s.reasons[0]);
      }
    }

    return {
      dominantDirection,
      agreeingStrategiesCount,
      totalStrategiesCount: 6,
      agreementScore: Math.min(100, agreementScore),
      hasStrongConfluence: true,
      marketRegime: regime,
      regimeDetails,
      strategyResults,
      timeframeConfluenceScore: tfScores.confluenceScore,
      evaluatedTimeframes: availableTfs,
      reasons,
    };
  }

  /**
   * Applies Strategy Weighting according to Market Regime:
   * - TREND (UPTREND/DOWNTREND): Trend + Momentum + Pullback receive highest weight.
   * - BREAKOUT: Breakout + Volume + Momentum + Volatility receive highest weight.
   * - HIGH-VOLATILITY: Volatility Gate + Breakout + Momentum receive highest weight.
   * - RANGE: Mean Reversion + Structure + Volatility receive highest weight.
   * - LOW-VOLATILITY: Mean Reversion + Structure + Breakout Anticipation receive highest weight.
   *
   * Also applies Bayesian regularized empirical performance feedback without overfitting.
   */
  private static applyRegimeWeights(regime: MarketRegime, strategies: StrategyResult[]): void {
    const sMap = new Map(strategies.map((s) => [s.id, s]));

    if (regime === 'UPTREND' || regime === 'DOWNTREND') {
      // TREND: Trend (strat_1) + Momentum (strat_2) + Pullback highest weight
      if (sMap.has('strat_1')) sMap.get('strat_1')!.weight = 2.0; // Trend + Pullback (Highest)
      if (sMap.has('strat_2')) sMap.get('strat_2')!.weight = 1.6; // Momentum (Highest)
      if (sMap.has('strat_5')) sMap.get('strat_5')!.weight = 1.3; // Order flow
      if (sMap.has('strat_6')) sMap.get('strat_6')!.weight = 1.0; // Volatility gate
      if (sMap.has('strat_3')) sMap.get('strat_3')!.weight = 0.8; // Breakout
      if (sMap.has('strat_4')) sMap.get('strat_4')!.weight = 0.3; // Mean reversion (lowest in trend)
    } else if (regime === 'BREAKOUT') {
      // BREAKOUT: Breakout (strat_3) + Volume/Order Flow (strat_5) + Momentum (strat_2) + Volatility (strat_6)
      if (sMap.has('strat_3')) sMap.get('strat_3')!.weight = 2.0; // Breakout (Highest)
      if (sMap.has('strat_5')) sMap.get('strat_5')!.weight = 1.8; // Volume & Order Flow (Highest)
      if (sMap.has('strat_2')) sMap.get('strat_2')!.weight = 1.6; // Momentum (Highest)
      if (sMap.has('strat_6')) sMap.get('strat_6')!.weight = 1.4; // Volatility (Highest)
      if (sMap.has('strat_1')) sMap.get('strat_1')!.weight = 1.1; // Trend
      if (sMap.has('strat_4')) sMap.get('strat_4')!.weight = 0.2; // Mean Reversion (suppressed during breakout)
    } else if (regime === 'HIGH-VOLATILITY') {
      // HIGH-VOLATILITY: Volatility Gate (strat_6) + Momentum (strat_2) + Breakout (strat_3)
      if (sMap.has('strat_6')) sMap.get('strat_6')!.weight = 2.0; // Strict Volatility Gate (Highest)
      if (sMap.has('strat_2')) sMap.get('strat_2')!.weight = 1.6; // Momentum
      if (sMap.has('strat_3')) sMap.get('strat_3')!.weight = 1.5; // Breakout
      if (sMap.has('strat_1')) sMap.get('strat_1')!.weight = 1.3; // Trend
      if (sMap.has('strat_5')) sMap.get('strat_5')!.weight = 1.3; // Order flow
      if (sMap.has('strat_4')) sMap.get('strat_4')!.weight = 0.3; // Mean reversion
    } else if (regime === 'LOW-VOLATILITY') {
      // LOW-VOLATILITY: Mean Reversion (strat_4) + Structure (strat_1) + Squeeze Breakout Anticipation (strat_3)
      if (sMap.has('strat_4')) sMap.get('strat_4')!.weight = 1.9; // Mean Reversion (Highest)
      if (sMap.has('strat_1')) sMap.get('strat_1')!.weight = 1.5; // Market Structure & S/R (Highest)
      if (sMap.has('strat_6')) sMap.get('strat_6')!.weight = 1.5; // Volatility (Highest)
      if (sMap.has('strat_3')) sMap.get('strat_3')!.weight = 1.4; // Breakout Anticipation
      if (sMap.has('strat_5')) sMap.get('strat_5')!.weight = 1.0; // Order flow
      if (sMap.has('strat_2')) sMap.get('strat_2')!.weight = 0.9; // Momentum
    } else {
      // RANGE: Mean Reversion (strat_4) + Structure (strat_1) + Volatility (strat_6)
      if (sMap.has('strat_4')) sMap.get('strat_4')!.weight = 2.0; // Mean Reversion (Highest)
      if (sMap.has('strat_1')) sMap.get('strat_1')!.weight = 1.5; // Market Structure & S/R (Highest)
      if (sMap.has('strat_6')) sMap.get('strat_6')!.weight = 1.4; // Volatility (Highest)
      if (sMap.has('strat_5')) sMap.get('strat_5')!.weight = 1.2; // Order flow absorption
      if (sMap.has('strat_2')) sMap.get('strat_2')!.weight = 0.8; // Momentum
      if (sMap.has('strat_3')) sMap.get('strat_3')!.weight = 0.3; // Breakout (suppressed in range)
    }

    // Apply empirical performance multiplier (regularized [0.75, 1.25])
    for (const s of strategies) {
      const perfMultiplier = StrategyPerformanceTracker.getDynamicStrategyWeightMultiplier(s.id, regime);
      s.weight = Number((s.weight * perfMultiplier).toFixed(2));
    }
  }

  // =========================================================================
  // Strategy 1: TREND FOLLOWING (Primary Strategy + Trend-Pullback Condition)
  // Uses: EMA stack (9/21/50), EMA slope, HTF direction, and market structure.
  // Includes TREND-PULLBACK condition: HTF trend -> pullback to EMA/structure zone -> momentum resumption -> LTF entry confirmation.
  // =========================================================================
  private static evalTrendFollowing(
    symbol: string,
    entryPrice: number,
    tfMap: Record<string, NormalizedCandle[]>,
    regime?: MarketRegime
  ): StrategyResult {
    if (regime && (StrategyEngine.isRanging(regime) || StrategyEngine.isLowVolatility(regime))) {
      return {
        id: 'strat_1',
        name: 'Trend Following (EMA Stack Rider & Trend-Pullback)',
        direction: 'NEUTRAL',
        score: 0,
        passed: false,
        weight: 1.5,
        reasons: [`Strategy 1 (Trend Following) inactive in ${regime} market regime`],
      };
    }

    const s5m = tfMap['5m'];
    const s15m = tfMap['15m'];
    const s1h = tfMap['1h'];
    const s4h = tfMap['4h'];
    const s1d = tfMap['1d'];

    // 15m EMAs
    const ema9_15m = TechnicalIndicators.calculateEMA(s15m, 9);
    const ema21_15m = TechnicalIndicators.calculateEMA(s15m, 21);
    const ema50_15m = s15m.length >= 50 ? TechnicalIndicators.calculateEMA(s15m, 50) : [];

    // 1H EMAs
    const ema9_1h = TechnicalIndicators.calculateEMA(s1h, 9);
    const ema21_1h = TechnicalIndicators.calculateEMA(s1h, 21);
    const ema50_1h = s1h.length >= 50 ? TechnicalIndicators.calculateEMA(s1h, 50) : [];

    if (ema9_15m.length === 0 || ema21_15m.length === 0 || ema9_1h.length === 0 || ema21_1h.length === 0) {
      return {
        id: 'strat_1',
        name: 'Trend Following (EMA Stack Rider & Trend-Pullback)',
        direction: 'NEUTRAL',
        score: 0,
        passed: false,
        weight: 1.5,
        reasons: ['Insufficient data for EMA calculation'],
      };
    }

    const lastEma9_15m = ema9_15m[ema9_15m.length - 1];
    const lastEma21_15m = ema21_15m[ema21_15m.length - 1];
    const lastEma50_15m = ema50_15m.length > 0 ? ema50_15m[ema50_15m.length - 1] : lastEma21_15m;

    const lastEma9_1h = ema9_1h[ema9_1h.length - 1];
    const lastEma21_1h = ema21_1h[ema21_1h.length - 1];
    const lastEma50_1h = ema50_1h.length > 0 ? ema50_1h[ema50_1h.length - 1] : lastEma21_1h;

    // 1. EMA Slopes (lookback 3 periods)
    const slope9_1h = TechnicalIndicators.calculateEMASlope(ema9_1h, 3);
    const slope21_1h = TechnicalIndicators.calculateEMASlope(ema21_1h, 3);
    const slope9_15m = TechnicalIndicators.calculateEMASlope(ema9_15m, 3);

    // 2. Market Structure Analysis (1H and 15m)
    const structure1h = TechnicalIndicators.calculateMarketStructure(s1h, 15);
    const structure15m = TechnicalIndicators.calculateMarketStructure(s15m, 15);

    // 3. Higher Timeframe (4H / 1D) Directional Alignment
    let htfBullishBias = true;
    let htfBearishBias = true;
    if (s4h && s4h.length >= 20) {
      const ema21_4h = TechnicalIndicators.calculateEMA(s4h, 21);
      if (ema21_4h.length > 0) {
        const last4hEma = ema21_4h[ema21_4h.length - 1];
        if (entryPrice < last4hEma) htfBullishBias = false;
        if (entryPrice > last4hEma) htfBearishBias = false;
      }
    }
    if (s1d && s1d.length >= 20) {
      const ema21_1d = TechnicalIndicators.calculateEMA(s1d, 21);
      if (ema21_1d.length > 0) {
        const last1dEma = ema21_1d[ema21_1d.length - 1];
        if (entryPrice < last1dEma) htfBullishBias = false;
        if (entryPrice > last1dEma) htfBearishBias = false;
      }
    }

    // 4. EMA Stacks Alignment
    const isBullStack1h = lastEma9_1h >= lastEma21_1h && lastEma21_1h >= lastEma50_1h && slope21_1h >= -0.02;
    const isBearStack1h = lastEma9_1h <= lastEma21_1h && lastEma21_1h <= lastEma50_1h && slope21_1h <= 0.02;

    const isBullStack15m = lastEma9_15m >= lastEma21_15m && lastEma21_15m >= lastEma50_15m;
    const isBearStack15m = lastEma9_15m <= lastEma21_15m && lastEma21_15m <= lastEma50_15m;

    // 5. TREND-PULLBACK Condition Evaluation:
    const recentCandles15m = s15m.slice(-4);
    const lastCandle15m = s15m[s15m.length - 1];
    const prevCandle15m = s15m[s15m.length - 2];

    const touchedBullZone = recentCandles15m.some(
      (c) => c.low <= lastEma9_15m || (c.low <= lastEma21_1h && c.close >= lastEma50_1h)
    );
    const bullishResumption = lastCandle15m.close >= lastEma9_15m && lastCandle15m.close > prevCandle15m.close;

    const touchedBearZone = recentCandles15m.some(
      (c) => c.high >= lastEma9_15m || (c.high >= lastEma21_1h && c.close <= lastEma50_1h)
    );
    const bearishResumption = lastCandle15m.close <= lastEma9_15m && lastCandle15m.close < prevCandle15m.close;

    // Lower Timeframe (5m) Confirmation
    let ltf5mConfirmBuy = true;
    let ltf5mConfirmSell = true;
    if (s5m && s5m.length >= 10) {
      const ema9_5m = TechnicalIndicators.calculateEMA(s5m, 9);
      if (ema9_5m.length > 0) {
        const last5mEma = ema9_5m[ema9_5m.length - 1];
        ltf5mConfirmBuy = entryPrice >= last5mEma;
        ltf5mConfirmSell = entryPrice <= last5mEma;
      }
    }

    let direction: SignalDirection | 'NEUTRAL' = 'NEUTRAL';
    let score = 50;
    const reasons: string[] = [];

    // Case A: Valid TREND-PULLBACK Setup
    if (isBullStack1h && touchedBullZone && bullishResumption && ltf5mConfirmBuy && htfBullishBias) {
      direction = 'BUY';
      score = 92;
      if (structure1h.structureBias === 'BULLISH') score += 5;
      if (slope9_1h > 0.05) score += 3;
      reasons.push(
        `Trend-Pullback Confirmed: Price pulled back into 1H EMA structure zone and resumed bullish trajectory with 15m/5m confirmation`
      );
    } else if (isBearStack1h && touchedBearZone && bearishResumption && ltf5mConfirmSell && htfBearishBias) {
      direction = 'SELL';
      score = 92;
      if (structure1h.structureBias === 'BEARISH') score += 5;
      if (slope9_1h < -0.05) score += 3;
      reasons.push(
        `Trend-Pullback Confirmed: Price pulled back into 1H EMA structure zone and resumed bearish trajectory with 15m/5m confirmation`
      );
    }
    // Case B: Active Strong Trend Expansion
    else if (isBullStack1h && isBullStack15m && entryPrice >= lastEma9_15m && slope9_1h > 0.02 && htfBullishBias) {
      direction = 'BUY';
      score = 88;
      if (structure1h.structureBias === 'BULLISH') score += 5;
      if (slope21_1h > 0.03) score += 4;
      reasons.push(
        `Trend Following: Hierarchical EMA 9 > 21 > 50 stack expansion with positive slope across 15m, 1H and higher timeframes`
      );
    } else if (isBearStack1h && isBearStack15m && entryPrice <= lastEma9_15m && slope9_1h < -0.02 && htfBearishBias) {
      direction = 'SELL';
      score = 88;
      if (structure1h.structureBias === 'BEARISH') score += 5;
      if (slope21_1h < -0.03) score += 4;
      reasons.push(
        `Trend Following: Hierarchical EMA 9 < 21 < 50 stack expansion with negative slope across 15m, 1H and higher timeframes`
      );
    }
    // Case C: Moderate 1H Trend Continuation
    else if (lastEma9_1h > lastEma21_1h && entryPrice > lastEma21_1h && slope21_1h >= 0) {
      direction = 'BUY';
      score = 72;
      reasons.push(`Moderate trend alignment: Price holding above upward-sloping 1H EMA21`);
    } else if (lastEma9_1h < lastEma21_1h && entryPrice < lastEma21_1h && slope21_1h <= 0) {
      direction = 'SELL';
      score = 72;
      reasons.push(`Moderate trend alignment: Price holding below downward-sloping 1H EMA21`);
    }

    return {
      id: 'strat_1',
      name: 'Trend Following (EMA Stack Rider & Trend-Pullback)',
      direction,
      score: Math.min(100, score),
      passed: direction !== 'NEUTRAL' && score >= 70,
      weight: 1.5,
      reasons,
    };
  }

  // =========================================================================
  // Strategy 2: MOMENTUM (Primary Confirmation)
  // Uses: Zero-Lag MACD + RSI momentum, price acceleration, multi-TF agreement.
  // =========================================================================
  private static evalMomentumZeroLag(
    symbol: string,
    entryPrice: number,
    tfMap: Record<string, NormalizedCandle[]>,
    regime?: MarketRegime
  ): StrategyResult {
    if (regime && (StrategyEngine.isRanging(regime) || StrategyEngine.isLowVolatility(regime))) {
      return {
        id: 'strat_2',
        name: 'Momentum (Zero-Lag MACD + RSI)',
        direction: 'NEUTRAL',
        score: 0,
        passed: false,
        weight: 1.35,
        reasons: [`Strategy 2 (Momentum) inactive in ${regime} market regime`],
      };
    }

    const s15m = tfMap['15m'];
    const s1h = tfMap['1h'];

    const zlMacd15m = TechnicalIndicators.calculateZeroLagMACD(s15m, 12, 26, 9);
    const zlMacd1h = TechnicalIndicators.calculateZeroLagMACD(s1h, 12, 26, 9);
    const rsi15m = TechnicalIndicators.calculateRSI(s15m, 14);
    const rsi1h = TechnicalIndicators.calculateRSI(s1h, 14);

    if (!zlMacd15m || !zlMacd1h || rsi15m.length === 0 || rsi1h.length === 0) {
      return {
        id: 'strat_2',
        name: 'Momentum (Zero-Lag MACD + RSI)',
        direction: 'NEUTRAL',
        score: 0,
        passed: false,
        weight: 1.35,
        reasons: ['Failed to compute Zero-Lag MACD or RSI'],
      };
    }

    const lastRsi15m = rsi15m[rsi15m.length - 1];
    const prevRsi15m = rsi15m[Math.max(0, rsi15m.length - 3)];
    const lastRsi1h = rsi1h[rsi1h.length - 1];
    const prevRsi1h = rsi1h[Math.max(0, rsi1h.length - 2)];

    const isRsiAcceleratingBull = lastRsi15m > prevRsi15m && lastRsi1h >= prevRsi1h;
    const isRsiAcceleratingBear = lastRsi15m < prevRsi15m && lastRsi1h <= prevRsi1h;

    const isBullZlMacd = zlMacd15m.histogram >= -0.0001 && zlMacd15m.macdLine >= zlMacd15m.signalLine;
    const isBullRsi = lastRsi15m >= 45 && lastRsi15m <= 68 && lastRsi1h >= 45;

    const isBearZlMacd = zlMacd15m.histogram <= 0.0001 && zlMacd15m.macdLine <= zlMacd15m.signalLine;
    const isBearRsi = lastRsi15m <= 55 && lastRsi15m >= 32 && lastRsi1h <= 55;

    let direction: SignalDirection | 'NEUTRAL' = 'NEUTRAL';
    let score = 50;
    const reasons: string[] = [];

    if (isBullZlMacd && isBullRsi && zlMacd1h.macdLine >= zlMacd1h.signalLine) {
      direction = 'BUY';
      score = 88;
      if (isRsiAcceleratingBull) score += 6;
      if (zlMacd1h.histogram >= 0) score += 5;
      reasons.push(
        `Momentum Confirmation: Multi-timeframe Zero-Lag MACD & RSI (${lastRsi15m.toFixed(
          1
        )}) accelerating positively across 15m and 1H`
      );
    } else if (isBearZlMacd && isBearRsi && zlMacd1h.macdLine <= zlMacd1h.signalLine) {
      direction = 'SELL';
      score = 88;
      if (isRsiAcceleratingBear) score += 6;
      if (zlMacd1h.histogram <= 0) score += 5;
      reasons.push(
        `Momentum Confirmation: Multi-timeframe Zero-Lag MACD & RSI (${lastRsi15m.toFixed(
          1
        )}) accelerating negatively across 15m and 1H`
      );
    } else if (zlMacd1h.macdLine > zlMacd1h.signalLine && lastRsi1h >= 50) {
      direction = 'BUY';
      score = 72;
      reasons.push('1H Zero-Lag MACD confirms underlying upward momentum');
    } else if (zlMacd1h.macdLine < zlMacd1h.signalLine && lastRsi1h <= 50) {
      direction = 'SELL';
      score = 72;
      reasons.push('1H Zero-Lag MACD confirms underlying downward momentum');
    }

    return {
      id: 'strat_2',
      name: 'Momentum (Zero-Lag MACD + RSI)',
      direction,
      score: Math.min(100, score),
      passed: direction !== 'NEUTRAL' && score >= 70,
      weight: 1.35,
      reasons,
    };
  }

  // =========================================================================
  // Strategy 3: INTRADAY BREAKOUT (Strengthened)
  // Requires genuine S/R breakout + volume expansion + volatility expansion + higher-TF agreement.
  // Rejects obvious false breakouts.
  // =========================================================================
  private static evalIntradayBreakout(
    symbol: string,
    entryPrice: number,
    tfMap: Record<string, NormalizedCandle[]>,
    regime?: MarketRegime
  ): StrategyResult {
    if (regime && StrategyEngine.isRanging(regime)) {
      return {
        id: 'strat_3',
        name: 'Intraday Breakout (H1/H4 + volume)',
        direction: 'NEUTRAL',
        score: 0,
        passed: false,
        weight: 1.2,
        reasons: [`Strategy 3 (Intraday Breakout) inactive in ${regime} market regime`],
      };
    }

    const s1h = tfMap['1h'];
    const s15m = tfMap['15m'];

    const channels1h = TechnicalIndicators.calculateDonchianChannels(s1h, 20);
    const channels15m = TechnicalIndicators.calculateDonchianChannels(s15m, 20);

    if (!channels1h || !channels15m) {
      return {
        id: 'strat_3',
        name: 'Intraday Breakout (H1/H4 + volume)',
        direction: 'NEUTRAL',
        score: 0,
        passed: false,
        weight: 1.2,
        reasons: ['Donchian channels unavailable'],
      };
    }

    const last1hVol = s1h[s1h.length - 1].volume || 0;
    const avg1hVol = s1h.slice(-20).reduce((a, c) => a + (c.volume || 0), 0) / 20;
    const hasVolumeExpansion = avg1hVol > 0 ? last1hVol >= avg1hVol * 1.15 : true;

    const vm1h = TechnicalIndicators.calculateVolatilityMetrics(s1h, 14);
    const hasVolatilityExpansion = vm1h.isValidExpansion || vm1h.atrRatio >= 1.05;

    const ema9_1h = TechnicalIndicators.calculateEMA(s1h, 9);
    const ema21_1h = TechnicalIndicators.calculateEMA(s1h, 21);
    const isHtfBullish =
      ema9_1h.length > 0 && ema21_1h.length > 0 && ema9_1h[ema9_1h.length - 1] >= ema21_1h[ema21_1h.length - 1];
    const isHtfBearish =
      ema9_1h.length > 0 && ema21_1h.length > 0 && ema9_1h[ema9_1h.length - 1] <= ema21_1h[ema21_1h.length - 1];

    const wick15m = TechnicalIndicators.calculateWickRejection(s15m, 2);
    const isFalseBullBreakout = wick15m.upperWickRejectionPct >= 45;
    const isFalseBearBreakdown = wick15m.lowerWickRejectionPct >= 45;

    const range1h = channels1h.upper - channels1h.lower;
    const upperBoundary = channels1h.upper - range1h * 0.08;
    const lowerBoundary = channels1h.lower + range1h * 0.08;

    let direction: SignalDirection | 'NEUTRAL' = 'NEUTRAL';
    let score = 50;
    let passed = false;
    const reasons: string[] = [];

    if (entryPrice >= upperBoundary && isHtfBullish) {
      if (isFalseBullBreakout) {
        return {
          id: 'strat_3',
          name: 'Intraday Breakout (H1/H4 + volume)',
          direction: 'NEUTRAL',
          score: 25,
          passed: false,
          weight: 1.2,
          reasons: ['False breakout rejected: Severe upper wick rejection detected at resistance boundary'],
        };
      }

      direction = 'BUY';
      score = 82;
      if (entryPrice >= channels1h.upper) score += 8;
      if (hasVolumeExpansion) score += 6;
      if (hasVolatilityExpansion) score += 4;
      passed = score >= 70;
      reasons.push(
        `Genuine Breakout: Price (${entryPrice}) breaking 1H resistance with volume and HTF trend expansion`
      );
    } else if (entryPrice <= lowerBoundary && isHtfBearish) {
      if (isFalseBearBreakdown) {
        return {
          id: 'strat_3',
          name: 'Intraday Breakout (H1/H4 + volume)',
          direction: 'NEUTRAL',
          score: 25,
          passed: false,
          weight: 1.2,
          reasons: ['False breakdown rejected: Severe lower wick absorption detected at support boundary'],
        };
      }

      direction = 'SELL';
      score = 82;
      if (entryPrice <= channels1h.lower) score += 8;
      if (hasVolumeExpansion) score += 6;
      if (hasVolatilityExpansion) score += 4;
      passed = score >= 70;
      reasons.push(
        `Genuine Breakdown: Price (${entryPrice}) breaking 1H support with volume and HTF trend expansion`
      );
    } else {
      if (entryPrice > channels1h.middle && isHtfBullish) {
        direction = 'BUY';
        score = 65;
        passed = true;
        reasons.push('Price holding within upper channel hemisphere with trend support');
      } else if (entryPrice < channels1h.middle && isHtfBearish) {
        direction = 'SELL';
        score = 65;
        passed = true;
        reasons.push('Price holding within lower channel hemisphere with trend support');
      }
    }

    return {
      id: 'strat_3',
      name: 'Intraday Breakout (H1/H4 + volume)',
      direction,
      score: Math.min(100, score),
      passed,
      weight: 1.2,
      reasons,
    };
  }

  // =========================================================================
  // Strategy 4: RSI + BOLLINGER MEAN REVERSION (RANGE-ONLY)
  // Strictly RANGE-ONLY. Counter-trend mean reversion against strong 1H/4H trend is rejected.
  // =========================================================================
  private static evalBollingerMeanReversion(
    symbol: string,
    entryPrice: number,
    tfMap: Record<string, NormalizedCandle[]>,
    trendStrat: StrategyResult,
    regime: MarketRegime
  ): StrategyResult {
    const s15m = tfMap['15m'];
    const s1h = tfMap['1h'];

    const bb15m = TechnicalIndicators.calculateBollingerBands(s15m, 20, 2);
    const bb1h = TechnicalIndicators.calculateBollingerBands(s1h, 20, 2);
    const rsi15m = TechnicalIndicators.calculateRSI(s15m, 14);

    if (!bb15m || !bb1h || rsi15m.length === 0) {
      return {
        id: 'strat_4',
        name: 'RSI + Bollinger Mean Reversion',
        direction: 'NEUTRAL',
        score: 0,
        passed: false,
        weight: 1.1,
        reasons: ['Bollinger Bands unavailable'],
      };
    }

    const lastRsi = rsi15m[rsi15m.length - 1];

    const ema9_1h = TechnicalIndicators.calculateEMA(s1h, 9);
    const ema21_1h = TechnicalIndicators.calculateEMA(s1h, 21);

    const isStrongUptrend =
      (regime === 'UPTREND' || trendStrat.direction === 'BUY') &&
      trendStrat.passed &&
      trendStrat.score >= 80 &&
      ema9_1h.length > 0 &&
      ema21_1h.length > 0 &&
      ema9_1h[ema9_1h.length - 1] > ema21_1h[ema21_1h.length - 1];

    const isStrongDowntrend =
      (regime === 'DOWNTREND' || trendStrat.direction === 'SELL') &&
      trendStrat.passed &&
      trendStrat.score >= 80 &&
      ema9_1h.length > 0 &&
      ema21_1h.length > 0 &&
      ema9_1h[ema9_1h.length - 1] < ema21_1h[ema21_1h.length - 1];

    let direction: SignalDirection | 'NEUTRAL' = 'NEUTRAL';
    let score = 50;
    let passed = false;
    const reasons: string[] = [];

    // Rule A: REJECT counter-trend mean reversion against strong trend
    if (isStrongUptrend && entryPrice >= bb15m.upper) {
      return {
        id: 'strat_4',
        name: 'RSI + Bollinger Mean Reversion',
        direction: 'NEUTRAL',
        score: 20,
        passed: false,
        weight: 1.1,
        reasons: ['Counter-trend mean reversion strictly rejected against strong 1H/4H uptrend'],
      };
    }

    if (isStrongDowntrend && entryPrice <= bb15m.lower) {
      return {
        id: 'strat_4',
        name: 'RSI + Bollinger Mean Reversion',
        direction: 'NEUTRAL',
        score: 20,
        passed: false,
        weight: 1.1,
        reasons: ['Counter-trend mean reversion strictly rejected against strong 1H/4H downtrend'],
      };
    }

    // Rule B: Trend-Aligned Pullback to Midline in Uptrend
    if (isStrongUptrend && entryPrice <= bb15m.middle && lastRsi >= 40 && lastRsi <= 55) {
      direction = 'BUY';
      score = 86;
      passed = true;
      reasons.push(
        `Bollinger Trend Pullback: Price holding 20-SMA midline in active uptrend with healthy RSI reset (${lastRsi.toFixed(
          1
        )})`
      );
    }
    // Rule C: Trend-Aligned Pullback to Midline in Downtrend
    else if (isStrongDowntrend && entryPrice >= bb15m.middle && lastRsi <= 60 && lastRsi >= 45) {
      direction = 'SELL';
      score = 86;
      passed = true;
      reasons.push(
        `Bollinger Trend Pullback: Price holding 20-SMA midline in active downtrend with healthy RSI reset (${lastRsi.toFixed(
          1
        )})`
      );
    }
    // Rule D: RANGE-ONLY Mean Reversion
    else if (!isStrongUptrend && !isStrongDowntrend) {
      if (entryPrice <= bb15m.lower && lastRsi <= 35) {
        direction = 'BUY';
        score = 84;
        passed = true;
        reasons.push(
          `Range Mean Reversion: Lower Bollinger Band bounce with oversold RSI (${lastRsi.toFixed(
            1
          )}) in defined trading range`
        );
      } else if (entryPrice >= bb15m.upper && lastRsi >= 65) {
        direction = 'SELL';
        score = 84;
        passed = true;
        reasons.push(
          `Range Mean Reversion: Upper Bollinger Band rejection with overbought RSI (${lastRsi.toFixed(
            1
          )}) in defined trading range`
        );
      } else if (entryPrice > bb15m.middle) {
        direction = 'BUY';
        score = 65;
        passed = true;
        reasons.push('Range structure: Price situated in upper half of Bollinger channel');
      } else {
        direction = 'SELL';
        score = 65;
        passed = true;
        reasons.push('Range structure: Price situated in lower half of Bollinger channel');
      }
    }

    return {
      id: 'strat_4',
      name: 'RSI + Bollinger Mean Reversion',
      direction,
      score: Math.min(100, score),
      passed,
      weight: 1.1,
      reasons,
    };
  }

  // =========================================================================
  // Strategy 5: ORDER FLOW IMBALANCE (Confirmation Only)
  // Uses: volume acceleration, wick rejection, and buying/selling pressure.
  // =========================================================================
  private static evalOrderFlowImbalance(
    symbol: string,
    entryPrice: number,
    tfMap: Record<string, NormalizedCandle[]>,
    contextDirection: SignalDirection | 'NEUTRAL',
    regime?: MarketRegime
  ): StrategyResult {
    const s15m = tfMap['15m'];
    const of15m = TechnicalIndicators.calculateOrderFlowMetrics(s15m, 14);
    const wicks15m = TechnicalIndicators.calculateWickRejection(s15m, 3);

    let direction: SignalDirection | 'NEUTRAL' = 'NEUTRAL';
    let score = 50;
    let passed = false;
    const reasons: string[] = [];

    const isBullishFlow =
      of15m.deltaBias === 'BULLISH' || of15m.buyingPressurePct >= 54 || wicks15m.hasBullishWickAbsorption;
    const isBearishFlow =
      of15m.deltaBias === 'BEARISH' || of15m.sellingPressurePct >= 54 || wicks15m.hasBearishWickAbsorption;

    if (contextDirection === 'BUY' && isBullishFlow) {
      direction = 'BUY';
      score = 85;
      if (of15m.buyingPressurePct >= 60) score += 6;
      if (wicks15m.hasBullishWickAbsorption) score += 5;
      if (of15m.volumeSurge) score += 4;
      passed = true;
      reasons.push(
        `Order Flow Confirmation: Dominant buying pressure (${of15m.buyingPressurePct}%) and lower wick absorption confirming setup`
      );
    } else if (contextDirection === 'SELL' && isBearishFlow) {
      direction = 'SELL';
      score = 85;
      if (of15m.sellingPressurePct >= 60) score += 6;
      if (wicks15m.hasBearishWickAbsorption) score += 5;
      if (of15m.volumeSurge) score += 4;
      passed = true;
      reasons.push(
        `Order Flow Confirmation: Dominant selling pressure (${of15m.sellingPressurePct}%) and upper wick absorption confirming setup`
      );
    } else if (isBullishFlow && !isBearishFlow) {
      direction = 'BUY';
      score = 70;
      passed = true;
      reasons.push(`Order Flow Delta: Positive buying absorption bias (${of15m.buyingPressurePct}%)`);
    } else if (isBearishFlow && !isBullishFlow) {
      direction = 'SELL';
      score = 70;
      passed = true;
      reasons.push(`Order Flow Delta: Negative selling absorption bias (${of15m.sellingPressurePct}%)`);
    } else {
      direction = 'NEUTRAL';
      score = 50;
      passed = false;
      reasons.push('Order flow delta is balanced without directional imbalance');
    }

    return {
      id: 'strat_5',
      name: 'Order Flow Imbalance',
      direction,
      score: Math.min(100, score),
      passed,
      weight: 1.15,
      reasons,
    };
  }

  // =========================================================================
  // Strategy 6: VOLATILITY FILTER (Mandatory Gate)
  // Rejects dead/flat markets (< 0.45 ATR ratio) and abnormal unstable conditions (> 2.80 ATR ratio).
  // Allows and rewards valid high-volatility trend expansion (1.10x - 2.50x).
  // =========================================================================
  private static evalVolatilityProtection(
    symbol: string,
    entryPrice: number,
    tfMap: Record<string, NormalizedCandle[]>,
    regime?: MarketRegime
  ): StrategyResult {
    const s15m = tfMap['15m'];
    const s1h = tfMap['1h'];

    const vm15m = TechnicalIndicators.calculateVolatilityMetrics(s15m, 14);
    const vm1h = TechnicalIndicators.calculateVolatilityMetrics(s1h, 14);

    const reasons: string[] = [];
    let score = 85;
    let passed = true;

    if (vm1h.isErratic || vm15m.isErratic || vm1h.atrRatio > 2.8) {
      passed = false;
      score = 15;
      reasons.push('Abnormal erratic volatility spike / flash breakdown detected: high risk of erratic slippage');
    } else if (vm1h.isDeadMarket || vm15m.isDeadMarket || vm1h.atrRatio < 0.45) {
      passed = false;
      score = 20;
      reasons.push('Dead/flat market conditions: ATR compression below minimum executable threshold');
    } else if (vm1h.isValidExpansion || (vm1h.atrRatio >= 1.10 && vm1h.atrRatio <= 2.50)) {
      score = 95;
      passed = true;
      reasons.push(
        `Valid High-Volatility Trend Expansion: Strong executable ATR expansion (${vm1h.atrRatio}x baseline) supporting trend follow-through`
      );
    } else if (vm15m.isSqueeze && vm1h.isSqueeze) {
      score = 75;
      passed = true;
      reasons.push('Volatility squeeze detected: Potential explosive breakout buildup');
    } else {
      score = 88;
      passed = true;
      reasons.push(`Optimal volatility structure confirmed (ATR ratio: ${vm1h.atrRatio}x within healthy executable bounds)`);
    }

    return {
      id: 'strat_6',
      name: 'Volatility Filter & Breakdown Protection',
      direction: 'NEUTRAL',
      score,
      passed,
      weight: 1.0,
      reasons,
    };
  }

  // =========================================================================
  // Multi-Timeframe Alignment Evaluator (Hierarchy: 4H/1D -> 1H -> 15M -> 5M)
  // =========================================================================
  private static evaluateMultiTimeframeAlignment(
    direction: SignalDirection,
    entryPrice: number,
    tfMap: Record<string, NormalizedCandle[]>
  ): { alignedCount: number; totalEvaluated: number; confluenceScore: number } {
    const evaluatedTfs = ['4h', '1d', '1h', '15m', '5m', '30m'];
    let alignedCount = 0;
    let totalEvaluated = 0;

    for (const tf of evaluatedTfs) {
      const candles = tfMap[tf];
      if (!candles || candles.length < 10) continue;

      totalEvaluated++;
      const ema21 = TechnicalIndicators.calculateEMA(candles, Math.min(candles.length - 1, 21));
      if (ema21.length === 0) continue;

      const lastEma21 = ema21[ema21.length - 1];
      const isAligned = direction === 'BUY' ? entryPrice >= lastEma21 : entryPrice <= lastEma21;

      if (isAligned) {
        alignedCount++;
      }
    }

    const confluenceScore = totalEvaluated > 0 ? Math.round((alignedCount / totalEvaluated) * 100) : 0;

    return {
      alignedCount,
      totalEvaluated: Math.max(1, totalEvaluated),
      confluenceScore,
    };
  }

  private static createRejection(
    rejectionReason: string,
    marketRegime: MarketRegime = 'RANGE',
    regimeDetails = 'Unqualified'
  ): MultiStrategyAgreement {
    return {
      dominantDirection: null,
      agreeingStrategiesCount: 0,
      totalStrategiesCount: 6,
      agreementScore: 0,
      hasStrongConfluence: false,
      marketRegime,
      regimeDetails,
      strategyResults: [],
      timeframeConfluenceScore: 0,
      evaluatedTimeframes: [],
      reasons: [],
      rejectionReason,
    };
  }
}
