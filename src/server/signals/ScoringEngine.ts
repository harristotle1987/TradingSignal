import { NormalizedCandle, SignalDirection } from '../../types/index.js';
import { TechnicalIndicators } from './TechnicalIndicators.js';
import { StrategyEngine, MarketRegime } from './StrategyEngine.js';
import { StrategyPerformanceTracker } from './StrategyPerformanceTracker.js';
import { logger } from '../logger.js';

export interface ScoringFactors {
  higherTfTrendScore: number;     // 0 - 20 (4H / 1D major direction)
  marketStructureScore: number;   // 0 - 15 (Swing structure, HH/HL, 1H EMA stack)
  momentumScore: number;          // 0 - 15 (Zero-Lag MACD + RSI acceleration)
  volumeOrderFlowScore: number;   // 0 - 15 (Delta pressure, volume surge, wick absorption)
  supportResistanceScore: number; // 0 - 10 (S/R proximity, clean breakout clearance)
  volatilityAtrScore: number;     // 0 - 10 (ATR ratio, executable bounds)
  entryQualityScore: number;      // 0 - 10 (5m/15m trigger, dynamic EMA pullback)
  newsSentimentScore: number;     // 0 - 5  (Macro news sentiment alignment)
  totalScore: number;             // 0 - 100

  // Compatibility properties
  trendScore?: number;
  structureScore?: number;
  volatilityScore?: number;
  volumeScore?: number;
  strategyAgreementScore?: number;
  riskRewardScore?: number;
  freshnessAgreementScore?: number;
}

export type QualityTier = 'BEST_TRADE' | 'HIGH_QUALITY' | 'REJECT';

export interface ScoringResult {
  isValid: boolean;
  score: number; // 0 - 100
  qualityTier: QualityTier;
  direction: SignalDirection;
  marketRegime: MarketRegime;
  regimeDetails: string;
  rejectionReason?: string;
  confluenceReasons: string[];
  stopLoss: number;
  takeProfit: number;
  riskRewardRatio: number;
  estimatedWinRate: number;
  expectancy: number;
  targetDistance?: number;
  stopDistance?: number;
  pipPointUnit?: 'PIPS' | 'POINTS';
  timeframesAligned: number;
  totalTimeframesEvaluated: number;
  agreeingStrategiesCount: number;
  totalStrategiesCount: number;
  isTopTradeCandidate: boolean;
  estimatedFriction: {
    spreadPipsOrPoints: number;
    feeBufferPct: number;
    netRiskRewardRatio: number;
  };
  hypotheticalRisk: {
    suggestedRiskAmount: number;
    suggestedPositionSize: number;
  };
  passedStrategies?: string[];
  failedStrategies?: string[];
  primaryStrategy?: string;
  factors: ScoringFactors;
  technicalMetrics?: {
    htfEma9: number;
    htfEma21: number;
    htfRsi: number;
    ltfEma9: number;
    ltfEma21: number;
    ltfRsi: number;
    ltfMacdHistogram: number;
    atr: number;
  };
}

interface AssetExecutionProfile {
  assetClass: 'CRYPTO' | 'FOREX' | 'STOCK' | 'INDEX';
  precision: number;
  pipMultiplier: number;
  pipPointUnit: 'PIPS' | 'POINTS';
  estimatedSpreadUnits: number;
  estimatedFeeBufferPct: number;
  minPracticalTargetDistance: number;
  minPracticalStopDistance: number;
}

export class ScoringEngine {
  /**
   * Estimates win rate based on technical quality score, R:R ratio, and strategy agreement.
   * Must strictly be > 30% for actionable trades.
   */
  static estimateWinRate(score: number, rr: number, agreeingStrategies = 4): number {
    const baseWinRate = 25;
    const scoreFactor = (score / 100) * 30; // ~22.5 to 30
    const rrFactor = Math.min(rr * 3, 15);
    const strategyBonus = (agreeingStrategies / 6) * 15; // 10 to 15
    const calculated = Math.min(92, baseWinRate + scoreFactor + rrFactor + strategyBonus);
    return Number(calculated.toFixed(1));
  }

  /**
   * Calculates mathematical historical expectancy:
   * Expectancy = (WinRate% * RiskRewardRatio) - (LossRate% * 1.0)
   * Must be strictly positive (> 0) to avoid negative-sum trades.
   */
  static calculateExpectancy(winRatePct: number, rr: number): number {
    const winProb = winRatePct / 100;
    const lossProb = 1 - winProb;
    const expectancy = winProb * rr - lossProb * 1.0;
    return Number(expectancy.toFixed(3));
  }

  /**
   * Calculates hypothetical risk sizing based on a default balance and risk percentage.
   */
  static calculateHypotheticalRisk(
    entry: number,
    stopLoss: number,
    minStopDistance: number
  ): { suggestedRiskAmount: number; suggestedPositionSize: number } {
    const hypotheticalBalance = 1000;
    const riskPercent = 0.01; // 1%
    const riskAmount = hypotheticalBalance * riskPercent;
    const riskDistance = Math.max(Math.abs(entry - stopLoss), minStopDistance);
    const positionSize = riskAmount / riskDistance;
    return {
      suggestedRiskAmount: Number(riskAmount.toFixed(2)),
      suggestedPositionSize: Number(positionSize.toFixed(4)),
    };
  }

  /**
   * Evaluates all scoring components deterministically based on real, validated market data.
   * Uses the upgraded 0–100 Quality Score:
   * - Higher-TF trend: 20
   * - Market structure: 15
   * - Momentum: 15
   * - Volume / order flow: 15
   * - Support / resistance: 10
   * - Volatility / ATR: 10
   * - Entry quality: 10
   * - News / sentiment: 5
   *
   * Thresholds:
   * - 85+ = BEST TRADE
   * - 75–84 = HIGH QUALITY
   * - Below 75 = REJECT
   */
  static calculateScore(
    symbol: string,
    entryPrice: number,
    candlesMap: Record<string, NormalizedCandle[]>,
    newsSentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL',
    crossCheckAgreementPct: number
  ): ScoringResult {
    const cleanSymbol = symbol.trim().toUpperCase();

    // 1. Gather available timeframe candles
    const tf15m = candlesMap['15m'] || [];
    const tf1h = candlesMap['1h'] || [];

    // Require 15m and 1h candles as primary baseline
    if (tf15m.length < 20 || tf1h.length < 20) {
      return this.createRejection('Insufficient candle data in primary baseline (15m/1h required with min 20 candles)');
    }

    // 2. Evaluate Strategy Agreement and Market Classification
    const strategyEval = StrategyEngine.evaluate(cleanSymbol, entryPrice, candlesMap);
    if (!strategyEval.hasStrongConfluence || !strategyEval.dominantDirection) {
      return this.createRejection(
        strategyEval.rejectionReason || 'Failed strategy confluence agreement',
        strategyEval.marketRegime,
        strategyEval.regimeDetails
      );
    }

    const direction: SignalDirection = strategyEval.dominantDirection;
    const confluenceReasons: string[] = [...strategyEval.reasons];
    const marketRegime = strategyEval.marketRegime;
    const regimeDetails = strategyEval.regimeDetails;

    // Sort ascending for indicator calculations
    const s15m = [...tf15m].sort((a, b) => a.timestamp - b.timestamp);
    const s1h = [...tf1h].sort((a, b) => a.timestamp - b.timestamp);
    const s4h = (candlesMap['4h'] && candlesMap['4h'].length >= 10) ? [...candlesMap['4h']].sort((a, b) => a.timestamp - b.timestamp) : [];
    const s1d = (candlesMap['1d'] && candlesMap['1d'].length >= 10) ? [...candlesMap['1d']].sort((a, b) => a.timestamp - b.timestamp) : [];
    const s5m = (candlesMap['5m'] && candlesMap['5m'].length >= 10) ? [...candlesMap['5m']].sort((a, b) => a.timestamp - b.timestamp) : [];
    const s30m = (candlesMap['30m'] && candlesMap['30m'].length >= 10) ? [...candlesMap['30m']].sort((a, b) => a.timestamp - b.timestamp) : [];

    // Calculate core technical indicators
    const ema9_15m = TechnicalIndicators.calculateEMA(s15m, 9);
    const ema21_15m = TechnicalIndicators.calculateEMA(s15m, 21);
    const rsi_15m = TechnicalIndicators.calculateRSI(s15m, 14);
    const macd_15m = TechnicalIndicators.calculateMACD(s15m, 12, 26, 9);
    const zlMacd_15m = TechnicalIndicators.calculateZeroLagMACD(s15m, 12, 26, 9);
    const atr_15m = TechnicalIndicators.calculateATR(s15m, 14);

    const ema9_1h = TechnicalIndicators.calculateEMA(s1h, 9);
    const ema21_1h = TechnicalIndicators.calculateEMA(s1h, 21);
    const ema50_1h = s1h.length >= 50 ? TechnicalIndicators.calculateEMA(s1h, 50) : [];
    const rsi_1h = TechnicalIndicators.calculateRSI(s1h, 14);
    const atr_1h = TechnicalIndicators.calculateATR(s1h, 14);

    if (
      ema9_15m.length === 0 ||
      ema21_15m.length === 0 ||
      rsi_15m.length === 0 ||
      !macd_15m ||
      ema9_1h.length === 0 ||
      ema21_1h.length === 0 ||
      rsi_1h.length === 0 ||
      atr_15m <= 0 ||
      atr_1h <= 0
    ) {
      return this.createRejection('Failed to compute authoritative baseline technical indicators (insufficient candle depth)', marketRegime, regimeDetails);
    }

    const lastEma9_15m = ema9_15m[ema9_15m.length - 1];
    const lastEma21_15m = ema21_15m[ema21_15m.length - 1];
    const lastRsi_15m = rsi_15m[rsi_15m.length - 1];

    const lastEma9_1h = ema9_1h[ema9_1h.length - 1];
    const lastEma21_1h = ema21_1h[ema21_1h.length - 1];
    const lastEma50_1h = ema50_1h.length > 0 ? ema50_1h[ema50_1h.length - 1] : lastEma21_1h;
    const lastRsi_1h = rsi_1h[rsi_1h.length - 1];

    // =========================================================================
    // 1. Higher-TF Trend Score (Max 20 Points)
    // 4H / 1D Major Direction Alignment with trade direction
    // =========================================================================
    let higherTfTrendScore = 0;
    let timeframesAligned = 0;
    const totalTfsEvaluated = 6;

    // Check 15m
    if ((direction === 'BUY' && entryPrice >= lastEma21_15m) || (direction === 'SELL' && entryPrice <= lastEma21_15m)) {
      timeframesAligned++;
    }
    // Check 1H
    if ((direction === 'BUY' && entryPrice >= lastEma21_1h) || (direction === 'SELL' && entryPrice <= lastEma21_1h)) {
      timeframesAligned++;
    }

    // 4H evaluation (Major Direction)
    let is4hAligned = false;
    if (s4h.length >= 10) {
      const ema21_4h = TechnicalIndicators.calculateEMA(s4h, Math.min(s4h.length - 1, 21));
      const ema9_4h = TechnicalIndicators.calculateEMA(s4h, Math.min(s4h.length - 1, 9));
      if (ema21_4h.length > 0 && ema9_4h.length > 0) {
        const last4hEma21 = ema21_4h[ema21_4h.length - 1];
        const last4hEma9 = ema9_4h[ema9_4h.length - 1];
        if (direction === 'BUY' && entryPrice >= last4hEma21 && last4hEma9 >= last4hEma21) {
          is4hAligned = true;
          timeframesAligned++;
        } else if (direction === 'SELL' && entryPrice <= last4hEma21 && last4hEma9 <= last4hEma21) {
          is4hAligned = true;
          timeframesAligned++;
        }
      }
    }

    // 1D evaluation (Macro Direction)
    let is1dAligned = false;
    if (s1d.length >= 10) {
      const ema21_1d = TechnicalIndicators.calculateEMA(s1d, Math.min(s1d.length - 1, 21));
      if (ema21_1d.length > 0) {
        const last1dEma21 = ema21_1d[ema21_1d.length - 1];
        if (direction === 'BUY' && entryPrice >= last1dEma21) {
          is1dAligned = true;
          timeframesAligned++;
        } else if (direction === 'SELL' && entryPrice <= last1dEma21) {
          is1dAligned = true;
          timeframesAligned++;
        }
      }
    }

    // 30m auxiliary check
    if (s30m.length >= 10) {
      const ema21_30m = TechnicalIndicators.calculateEMA(s30m, Math.min(s30m.length - 1, 21));
      if (ema21_30m.length > 0) {
        const last30mEma = ema21_30m[ema21_30m.length - 1];
        if ((direction === 'BUY' && entryPrice >= last30mEma) || (direction === 'SELL' && entryPrice <= last30mEma)) {
          timeframesAligned++;
        }
      }
    }

    // 5m entry check
    if (s5m.length >= 10) {
      const ema9_5m = TechnicalIndicators.calculateEMA(s5m, Math.min(s5m.length - 1, 9));
      if (ema9_5m.length > 0) {
        const last5mEma = ema9_5m[ema9_5m.length - 1];
        if ((direction === 'BUY' && entryPrice >= last5mEma) || (direction === 'SELL' && entryPrice <= last5mEma)) {
          timeframesAligned++;
        }
      }
    }

    if (is4hAligned && is1dAligned) {
      higherTfTrendScore = 20;
    } else if (is4hAligned || is1dAligned) {
      higherTfTrendScore = 17;
    } else if (timeframesAligned >= 3) {
      higherTfTrendScore = 14;
    } else {
      higherTfTrendScore = 8;
    }

    if (timeframesAligned < 3) {
      return this.createRejection(
        `Insufficient timeframe confirmation: only ${timeframesAligned}/${totalTfsEvaluated} aligned (minimum 3 required)`,
        marketRegime,
        regimeDetails
      );
    }

    // =========================================================================
    // 2. Market Structure Score (Max 15 Points)
    // 1H & 15M Swing structure (HH/HL vs LH/LL) & Hierarchical EMA stack
    // =========================================================================
    let marketStructureScore = 0;
    const struct1h = TechnicalIndicators.calculateMarketStructure(s1h, 15);
    const struct15m = TechnicalIndicators.calculateMarketStructure(s15m, 15);

    const isEmaStack1h = (direction === 'BUY' && lastEma9_1h >= lastEma21_1h && lastEma21_1h >= lastEma50_1h) ||
                         (direction === 'SELL' && lastEma9_1h <= lastEma21_1h && lastEma21_1h <= lastEma50_1h);
    const isEmaStack15m = (direction === 'BUY' && lastEma9_15m >= lastEma21_15m) ||
                          (direction === 'SELL' && lastEma9_15m <= lastEma21_15m);

    const isStructBull = struct1h.structureBias === 'BULLISH' || struct15m.structureBias === 'BULLISH';
    const isStructBear = struct1h.structureBias === 'BEARISH' || struct15m.structureBias === 'BEARISH';

    if (direction === 'BUY') {
      if (isStructBull && isEmaStack1h) marketStructureScore = 15;
      else if (isStructBull || isEmaStack1h) marketStructureScore = 12;
      else if (isEmaStack15m) marketStructureScore = 9;
      else marketStructureScore = 5;
    } else {
      if (isStructBear && isEmaStack1h) marketStructureScore = 15;
      else if (isStructBear || isEmaStack1h) marketStructureScore = 12;
      else if (isEmaStack15m) marketStructureScore = 9;
      else marketStructureScore = 5;
    }

    // =========================================================================
    // 3. Momentum Score (Max 15 Points)
    // Zero-Lag MACD + RSI acceleration
    // =========================================================================
    let momentumScore = 0;
    const isZlMacdBull = (zlMacd_15m && zlMacd_15m.histogram >= 0 && zlMacd_15m.macdLine >= zlMacd_15m.signalLine) || (macd_15m && macd_15m.histogram >= 0);
    const isZlMacdBear = (zlMacd_15m && zlMacd_15m.histogram <= 0 && zlMacd_15m.macdLine <= zlMacd_15m.signalLine) || (macd_15m && macd_15m.histogram <= 0);

    if (direction === 'BUY') {
      if (isZlMacdBull) momentumScore += 6;
      if (lastRsi_15m >= 45 && lastRsi_15m <= 68) momentumScore += 5;
      else if (lastRsi_15m > 38 && lastRsi_15m < 75) momentumScore += 3;
      if (lastRsi_1h >= 40 && lastRsi_1h <= 68) momentumScore += 4;
    } else {
      if (isZlMacdBear) momentumScore += 6;
      if (lastRsi_15m <= 55 && lastRsi_15m >= 32) momentumScore += 5;
      else if (lastRsi_15m < 62 && lastRsi_15m > 25) momentumScore += 3;
      if (lastRsi_1h <= 60 && lastRsi_1h >= 32) momentumScore += 4;
    }

    // =========================================================================
    // 4. Volume / Order Flow Score (Max 15 Points)
    // Delta pressure, volume surge, wick absorption
    // =========================================================================
    let volumeOrderFlowScore = 0;
    const of15m = TechnicalIndicators.calculateOrderFlowMetrics(s15m, 14);
    const wicks15m = TechnicalIndicators.calculateWickRejection(s15m, 3);
    const lastVol15m = s15m[s15m.length - 1].volume || 0;
    const avgVol15m = s15m.slice(-20).reduce((acc, c) => acc + (c.volume || 0), 0) / 20;

    if (direction === 'BUY') {
      if (of15m.buyingPressurePct >= 58 || of15m.deltaBias === 'BULLISH') volumeOrderFlowScore += 6;
      else if (of15m.buyingPressurePct >= 50) volumeOrderFlowScore += 3;

      if (avgVol15m > 0 && lastVol15m >= avgVol15m * 1.05) volumeOrderFlowScore += 5;
      else if (avgVol15m > 0 && lastVol15m >= avgVol15m * 0.9) volumeOrderFlowScore += 3;

      if (wicks15m.hasBullishWickAbsorption || wicks15m.lowerWickRejectionPct >= 30) volumeOrderFlowScore += 4;
    } else {
      if (of15m.sellingPressurePct >= 58 || of15m.deltaBias === 'BEARISH') volumeOrderFlowScore += 6;
      else if (of15m.sellingPressurePct >= 50) volumeOrderFlowScore += 3;

      if (avgVol15m > 0 && lastVol15m >= avgVol15m * 1.05) volumeOrderFlowScore += 5;
      else if (avgVol15m > 0 && lastVol15m >= avgVol15m * 0.9) volumeOrderFlowScore += 3;

      if (wicks15m.hasBearishWickAbsorption || wicks15m.upperWickRejectionPct >= 30) volumeOrderFlowScore += 4;
    }

    // =========================================================================
    // 5. Support / Resistance Score (Max 10 Points)
    // Proximity to key 1H/15m structural pivot, rejection bounce, or clear breakout runway
    // =========================================================================
    let supportResistanceScore = 0;
    const lows15m = s15m.slice(-14).map((c) => c.low);
    const highs15m = s15m.slice(-14).map((c) => c.high);
    const support15m = Math.min(...lows15m);
    const resistance15m = Math.max(...highs15m);

    const lows1h = s1h.slice(-14).map((c) => c.low);
    const highs1h = s1h.slice(-14).map((c) => c.high);
    const majorSupport1h = lows1h.length > 0 ? Math.min(...lows1h) : support15m;
    const majorResistance1h = highs1h.length > 0 ? Math.max(...highs1h) : resistance15m;

    let isNearKeyLevel = false;
    if (direction === 'BUY') {
      const distanceToSupport = Math.abs(entryPrice - support15m);
      isNearKeyLevel = distanceToSupport <= 1.25 * atr_15m;
      const roomToResistance = majorResistance1h - entryPrice;
      const hasCleanRunway = roomToResistance >= 1.5 * atr_15m;

      if (isNearKeyLevel) supportResistanceScore += 6;
      else supportResistanceScore += 4;

      if (hasCleanRunway) supportResistanceScore += 4;
      else supportResistanceScore += 2;
    } else {
      const distanceToResistance = Math.abs(resistance15m - entryPrice);
      isNearKeyLevel = distanceToResistance <= 1.25 * atr_15m;
      const roomToSupport = entryPrice - majorSupport1h;
      const hasCleanRunway = roomToSupport >= 1.5 * atr_15m;

      if (isNearKeyLevel) supportResistanceScore += 6;
      else supportResistanceScore += 4;

      if (hasCleanRunway) supportResistanceScore += 4;
      else supportResistanceScore += 2;
    }

    // =========================================================================
    // 6. Volatility / ATR Score (Max 10 Points)
    // Executable bounds, non-dead, non-erratic volatility expansion
    // =========================================================================
    let volatilityAtrScore = 0;
    const vm1h = TechnicalIndicators.calculateVolatilityMetrics(s1h, 14);

    if (vm1h.isDeadMarket || vm1h.isErratic || vm1h.atrRatio < 0.45 || vm1h.atrRatio > 2.8) {
      return this.createRejection(
        `Volatility filter rejected: ATR ratio (${vm1h.atrRatio}x) outside executable safety bounds`,
        marketRegime,
        regimeDetails
      );
    }

    if (vm1h.isValidExpansion || (vm1h.atrRatio >= 1.05 && vm1h.atrRatio <= 2.5)) {
      volatilityAtrScore = 10;
    } else if (vm1h.isHealthyVolatility) {
      volatilityAtrScore = 8;
    } else {
      volatilityAtrScore = 6;
    }

    // =========================================================================
    // 7. Entry Quality Score (Max 10 Points)
    // 5m/15m precision, pullback to dynamic EMA9/21, clean trigger
    // =========================================================================
    let entryQualityScore = 0;
    const distToEma9_15m = Math.abs(entryPrice - lastEma9_15m);
    const isAtDynamicZone = distToEma9_15m <= 0.8 * atr_15m;

    if (isAtDynamicZone) entryQualityScore += 5;
    else entryQualityScore += 3;

    // Check 5m trigger candle if available
    if (s5m.length >= 2) {
      const last5m = s5m[s5m.length - 1];
      const is5mTrigger = direction === 'BUY' ? last5m.close > last5m.open : last5m.close < last5m.open;
      if (is5mTrigger) entryQualityScore += 3;
      else entryQualityScore += 1;
    } else {
      entryQualityScore += 2;
    }

    // Cross-check feed alignment
    if (crossCheckAgreementPct >= 99.8) entryQualityScore += 2;
    else if (crossCheckAgreementPct >= 99.5) entryQualityScore += 1;

    // =========================================================================
    // 8. News / Sentiment Score (Max 5 Points)
    // Macro sentiment alignment
    // =========================================================================
    let newsSentimentScore = 3; // Neutral baseline
    if (direction === 'BUY' && newsSentiment === 'BULLISH') newsSentimentScore = 5;
    else if (direction === 'SELL' && newsSentiment === 'BEARISH') newsSentimentScore = 5;
    else if (direction === 'BUY' && newsSentiment === 'BEARISH') newsSentimentScore = 1;
    else if (direction === 'SELL' && newsSentiment === 'BULLISH') newsSentimentScore = 1;

    // =========================================================================
    // TOTAL 0–100 QUALITY SCORE CALCULATION
    // =========================================================================
    const rawTotalScore = Math.min(
      100,
      higherTfTrendScore +
        marketStructureScore +
        momentumScore +
        volumeOrderFlowScore +
        supportResistanceScore +
        volatilityAtrScore +
        entryQualityScore +
        newsSentimentScore
    );

    // Apply empirical confidence calibration factor (backend performance weighting)
    const primaryStratId = strategyEval.strategyResults?.find(s => s.passed)?.id;
    const calibrationFactor = StrategyPerformanceTracker.getConfidenceCalibrationFactor(
      rawTotalScore,
      primaryStratId,
      cleanSymbol
    );
    const totalScore = Math.min(100, Math.max(0, Math.round(rawTotalScore * calibrationFactor)));

    // =========================================================================
    // SL / TP Geometry & Risk/Reward Hurdle
    // =========================================================================
    const profile = this.getAssetExecutionProfile(cleanSymbol, entryPrice, atr_15m);
    const precision = profile.precision;
    const minSafeStopDist = Math.max(profile.minPracticalStopDistance, atr_15m * 0.85);

    let stopLoss = 0;
    let takeProfit = 0;

    if (direction === 'BUY') {
      const structuralSl = support15m - atr_15m * 0.4;
      const proposedSl = Math.min(structuralSl, entryPrice - minSafeStopDist);
      stopLoss = Number(proposedSl.toFixed(precision));

      const actualRisk = entryPrice - stopLoss;
      const targetDist2_5 = actualRisk * 2.5;
      const targetDist2_0 = actualRisk * 2.0;

      let proposedTp: number;
      if (majorResistance1h >= entryPrice + targetDist2_5) {
        proposedTp = majorResistance1h - atr_15m * 0.15;
      } else if (majorResistance1h >= entryPrice + targetDist2_0) {
        proposedTp = majorResistance1h - atr_15m * 0.15;
      } else {
        const rrMultiplier = totalScore >= 85 ? 2.5 : 2.0;
        proposedTp = entryPrice + Math.max(profile.minPracticalTargetDistance, actualRisk * rrMultiplier);
      }
      takeProfit = Number(proposedTp.toFixed(precision));
    } else {
      const structuralSl = resistance15m + atr_15m * 0.4;
      const proposedSl = Math.max(structuralSl, entryPrice + minSafeStopDist);
      stopLoss = Number(proposedSl.toFixed(precision));

      const actualRisk = stopLoss - entryPrice;
      const targetDist2_5 = actualRisk * 2.5;
      const targetDist2_0 = actualRisk * 2.0;

      let proposedTp: number;
      if (majorSupport1h <= entryPrice - targetDist2_5) {
        proposedTp = majorSupport1h + atr_15m * 0.15;
      } else if (majorSupport1h <= entryPrice - targetDist2_0) {
        proposedTp = majorSupport1h + atr_15m * 0.15;
      } else {
        const rrMultiplier = totalScore >= 85 ? 2.5 : 2.0;
        proposedTp = entryPrice - Math.max(profile.minPracticalTargetDistance, actualRisk * rrMultiplier);
      }
      takeProfit = Number(proposedTp.toFixed(precision));
    }

    const calculatedRisk = Math.abs(entryPrice - stopLoss);
    const calculatedReward = Math.abs(takeProfit - entryPrice);
    const rawRR = calculatedRisk > 0 ? Number((calculatedReward / calculatedRisk).toFixed(2)) : 0;

    // Minimum R:R ratio is 2.0:1 (1:2)
    if (rawRR < 2.0) {
      return this.createRejection(
        `Risk/Reward ratio (${rawRR}:1) is below strict 2.0:1 requirement`,
        marketRegime,
        regimeDetails
      );
    }

    // Historical Win Rate & Positive Expectancy Calculation
    const estimatedWinRate = this.estimateWinRate(totalScore, rawRR, strategyEval.agreeingStrategiesCount);
    if (estimatedWinRate <= 30) {
      return this.createRejection(
        `Estimated win rate (${estimatedWinRate}%) is at or below 30% threshold`,
        marketRegime,
        regimeDetails
      );
    }

    const expectancy = this.calculateExpectancy(estimatedWinRate, rawRR);
    if (expectancy <= 0) {
      return this.createRejection(
        `Negative mathematical expectancy (${expectancy}R per trade). Setup discarded.`,
        marketRegime,
        regimeDetails
      );
    }

    // Minimum Actionable Score = 75
    // 85+ = BEST TRADE
    // 75–84 = HIGH QUALITY
    // Below 75 = REJECT
    let qualityTier: QualityTier = 'REJECT';
    if (totalScore >= 85) qualityTier = 'BEST_TRADE';
    else if (totalScore >= 75) qualityTier = 'HIGH_QUALITY';

    if (totalScore < 75) {
      return this.createRejection(
        `Deterministic quality score ${totalScore}/100 is below minimum actionable threshold of 75 (85+ = BEST TRADE, 75-84 = HIGH QUALITY)`,
        marketRegime,
        regimeDetails
      );
    }

    // Friction Hurdle
    const spreadUnits = profile.estimatedSpreadUnits;
    const feePct = profile.estimatedFeeBufferPct;
    const netReward = calculatedReward - (spreadUnits / profile.pipMultiplier) - (entryPrice * feePct * 2);
    const netRisk = calculatedRisk + (spreadUnits / profile.pipMultiplier) + (entryPrice * feePct * 2);
    const netRR = netRisk > 0 ? Number((netReward / netRisk).toFixed(2)) : rawRR;

    const targetDistance = Number((calculatedReward * profile.pipMultiplier).toFixed(1));
    const stopDistance = Number((calculatedRisk * profile.pipMultiplier).toFixed(1));

    const hypotheticalRisk = this.calculateHypotheticalRisk(entryPrice, stopLoss, profile.minPracticalStopDistance);

    const factors: ScoringFactors = {
      higherTfTrendScore,
      marketStructureScore,
      momentumScore,
      volumeOrderFlowScore,
      supportResistanceScore,
      volatilityAtrScore,
      entryQualityScore,
      newsSentimentScore,
      totalScore,
      // Legacy compatibility
      trendScore: higherTfTrendScore,
      structureScore: marketStructureScore,
      volatilityScore: volatilityAtrScore,
      volumeScore: volumeOrderFlowScore,
      strategyAgreementScore: Math.round((strategyEval.agreeingStrategiesCount / 6) * 20),
      riskRewardScore: rawRR >= 2.5 ? 10 : 8,
      freshnessAgreementScore: newsSentimentScore * 2,
    };

    return {
      isValid: true,
      score: totalScore,
      qualityTier,
      direction,
      marketRegime,
      regimeDetails,
      confluenceReasons,
      stopLoss,
      takeProfit,
      riskRewardRatio: rawRR,
      estimatedWinRate,
      expectancy,
      targetDistance,
      stopDistance,
      pipPointUnit: profile.pipPointUnit,
      timeframesAligned,
      totalTimeframesEvaluated: totalTfsEvaluated,
      agreeingStrategiesCount: strategyEval.agreeingStrategiesCount,
      totalStrategiesCount: 6,
      isTopTradeCandidate: totalScore >= 85 && timeframesAligned >= 4,
      estimatedFriction: {
        spreadPipsOrPoints: spreadUnits,
        feeBufferPct: feePct,
        netRiskRewardRatio: netRR,
      },
      hypotheticalRisk,
      passedStrategies: strategyEval.strategyResults?.filter(s => s.passed).map(s => s.name) || [],
      failedStrategies: strategyEval.strategyResults?.filter(s => !s.passed).map(s => s.name) || [],
      primaryStrategy: strategyEval.strategyResults?.find(s => s.passed)?.name || 'Multi-Timeframe Trend Confluence',
      factors,
      technicalMetrics: {
        htfEma9: lastEma9_1h,
        htfEma21: lastEma21_1h,
        htfRsi: lastRsi_1h,
        ltfEma9: lastEma9_15m,
        ltfEma21: lastEma21_15m,
        ltfRsi: lastRsi_15m,
        ltfMacdHistogram: macd_15m.histogram,
        atr: atr_15m,
      },
    };
  }

  private static getAssetExecutionProfile(symbol: string, price: number, atr: number): AssetExecutionProfile {
    const isCrypto = symbol.includes('USDT') || symbol.includes('USD') && price > 100 && !symbol.includes('EUR') && !symbol.includes('GBP');
    const isForex = symbol.length === 6 && (symbol.includes('USD') || symbol.includes('EUR') || symbol.includes('GBP') || symbol.includes('JPY') || symbol.includes('CHF') || symbol.includes('CAD') || symbol.includes('AUD') || symbol.includes('NZD'));
    const isJPY = symbol.includes('JPY');

    if (isForex) {
      const precision = isJPY ? 3 : 5;
      const pipMultiplier = isJPY ? 100 : 10000;
      return {
        assetClass: 'FOREX',
        precision,
        pipMultiplier,
        pipPointUnit: 'PIPS',
        estimatedSpreadUnits: isJPY ? 1.5 : 1.2,
        estimatedFeeBufferPct: 0.00005,
        minPracticalTargetDistance: (15 / pipMultiplier),
        minPracticalStopDistance: (8 / pipMultiplier),
      };
    }

    if (isCrypto) {
      let precision = 2;
      if (price < 0.001) precision = 7;
      else if (price < 0.1) precision = 5;
      else if (price < 5) precision = 4;
      else if (price < 100) precision = 3;

      return {
        assetClass: 'CRYPTO',
        precision,
        pipMultiplier: 1,
        pipPointUnit: 'POINTS',
        estimatedSpreadUnits: price * 0.0004,
        estimatedFeeBufferPct: 0.0006,
        minPracticalTargetDistance: atr * 1.5,
        minPracticalStopDistance: atr * 0.8,
      };
    }

    // Stocks
    return {
      assetClass: 'STOCK',
      precision: 2,
      pipMultiplier: 1,
      pipPointUnit: 'POINTS',
      estimatedSpreadUnits: 0.03,
      estimatedFeeBufferPct: 0.0002,
      minPracticalTargetDistance: Math.max(0.5, atr * 1.5),
      minPracticalStopDistance: Math.max(0.3, atr * 0.8),
    };
  }

  private static createRejection(
    rejectionReason: string,
    marketRegime: MarketRegime = 'RANGE',
    regimeDetails = 'Unqualified'
  ): ScoringResult {
    return {
      isValid: false,
      score: 0,
      qualityTier: 'REJECT',
      direction: 'BUY',
      marketRegime,
      regimeDetails,
      rejectionReason,
      confluenceReasons: [],
      stopLoss: 0,
      takeProfit: 0,
      riskRewardRatio: 0,
      estimatedWinRate: 0,
      expectancy: 0,
      timeframesAligned: 0,
      totalTimeframesEvaluated: 6,
      agreeingStrategiesCount: 0,
      totalStrategiesCount: 6,
      isTopTradeCandidate: false,
      estimatedFriction: {
        spreadPipsOrPoints: 0,
        feeBufferPct: 0,
        netRiskRewardRatio: 0,
      },
      hypotheticalRisk: {
        suggestedRiskAmount: 0,
        suggestedPositionSize: 0,
      },
      factors: {
        higherTfTrendScore: 0,
        marketStructureScore: 0,
        momentumScore: 0,
        volumeOrderFlowScore: 0,
        supportResistanceScore: 0,
        volatilityAtrScore: 0,
        entryQualityScore: 0,
        newsSentimentScore: 0,
        totalScore: 0,
      },
    };
  }
}
