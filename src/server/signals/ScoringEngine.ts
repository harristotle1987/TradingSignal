import { NormalizedCandle, SignalDirection } from '../../types/index.js';
import { getDynamicPrecision } from '../../utils/formatters.js';
import { TechnicalIndicators } from './TechnicalIndicators.js';
import { StrategyEngine, MarketRegime } from './StrategyEngine.js';
import { StrategyPerformanceTracker } from './StrategyPerformanceTracker.js';
import { Gate28ConfirmationDiversity } from './Gate28ConfirmationDiversity.js';
import { Gate34ExecutionFrictionStressTest, FrictionStressTestResult } from './Gate34ExecutionFrictionStressTest.js';
import { logger } from '../logger.js';
import { serverConfig } from '../config.js';
import { ASSET_CLASS_GUARDRAILS, GuardrailRange, AtrTpGenerator } from './AtrTpGenerator.js';
import { RiskRewardCalculator, logRrRejectionDiagnostic } from './RiskRewardCalculator.js';

export interface TpCalculationDiagnostics {
  rawTp1BeforeClamp: number;
  rawTp2BeforeClamp: number;
  rawTp3BeforeClamp: number;
  guardrailTp2MinPct: number;
  guardrailTp2MaxPct: number;
  structuralAnchorUsedForTp2: boolean;
}

export interface ScoringFactors {
  higherTfTrendScore: number;     // 0 - 20 (4H / 1D major direction)
  marketStructureScore: number;   // 0 - 15 (Swing structure, HH/HL, 1H EMA stack)
  momentumScore: number;          // 0 - 15 (Zero-Lag MACD + RSI acceleration)
  volumeOrderFlowScore: number;   // 0 - 15 (Delta pressure, volume surge, wick absorption)
  supportResistanceScore: number; // 0 - 10 (S/R proximity, clean breakout clearance)
  volatilityAtrScore: number;     // 0 - 10 (ATR ratio, executable bounds)
  entryQualityScore: number;      // 0 - 10 (5m/15m trigger, dynamic EMA pullback)
  newsSentimentScore: number;     // 0 - 5  (Macro news sentiment alignment)
  coreScore?: number;             // 0 - 100
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

export type QualityTier = 'BEST_TRADE' | 'HIGH_QUALITY' | 'VALID' | 'REJECT';

export interface ScoringResult {
  isValid: boolean;
  score: number; // 0 - 100 (Core Score)
  coreScore?: number; // 0 - 100 (GATE 82 Core Score)
  qualityTier: QualityTier;
  direction: SignalDirection;
  marketRegime: MarketRegime;
  regimeDetails: string;
  rejectionReason?: string;
  confluenceReasons: string[];
  stopLoss: number;
  takeProfit: number;
  tp1?: number;
  tp2?: number;
  tp3?: number;
  tpDiagnostics?: TpCalculationDiagnostics;
  riskRewardRatio: number;
  grossRR?: number;
  primaryRR?: number;
  tp1RR?: number;
  tp2RR?: number;
  tp3RR?: number;
  entryPrice?: number;
  estimatedWinRate: number;
  expectancy: number;
  targetDistance?: number;
  stopDistance?: number;
  pipPointUnit?: 'PIPS' | 'POINTS';
  alignedCount: number;
  totalEvaluated: number;
  timeframeAlignmentRatio: number;
  strategyAgreementRatio?: number;
  timeframesAligned: number;
  totalTimeframesEvaluated: number;
  agreeingStrategiesCount: number;
  totalStrategiesCount: number;
  isTopTradeCandidate: boolean;
  estimatedFriction: {
    spreadPipsOrPoints: number;
    feeBufferPct: number;
    netRiskRewardRatio: number;
    grossRiskRewardRatio?: number;
    normalNetRiskRewardRatio?: number;
    adverseNetRiskRewardRatio?: number;
    frictionToProfitPct?: number;
    isExecutionPassed?: boolean;
    stressTestDetails?: FrictionStressTestResult;
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
   * Thresholds (Centralized Configuration):
   * - score >= signalThreshold → ACTIONABLE SIGNAL
   * - score >= qualifiedCandidateThreshold → QUALIFIED CANDIDATE
   * - score >= watchingThreshold → WATCHING
   */
  static calculateScore(
    symbol: string,
    entryPrice: number,
    candlesMap: Record<string, NormalizedCandle[]>,
    newsSentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL',
    crossCheckAgreementPct: number
  ): ScoringResult {
    const cleanSymbol = symbol.trim().toUpperCase();
    const thresholds = serverConfig.getConfig().thresholds;

    // 1. Gather available timeframe candles
    const tf15m = candlesMap['15m'] || [];
    const tf1h = candlesMap['1h'] || [];

    // Require 15m and 1h candles as primary baseline
    if (tf15m.length < 20 || tf1h.length < 20) {
      return this.createRejection('REJECTED: INSUFFICIENT_DATA. Insufficient candle data in primary baseline (15m/1h required with min 20 candles)');
    }

    // 2. Evaluate Strategy Agreement and Market Classification
    const strategyEval = StrategyEngine.evaluate(cleanSymbol, entryPrice, candlesMap);
    if (!strategyEval.hasStrongConfluence || !strategyEval.dominantDirection) {
      const rej = this.createRejection(
        strategyEval.rejectionReason || 'REJECTED: INSUFFICIENT_STRATEGY_AGREEMENT. Failed strategy confluence agreement',
        strategyEval.marketRegime,
        strategyEval.regimeDetails
      );
      rej.strategyAgreementRatio = strategyEval.agreementRatio;
      rej.agreeingStrategiesCount = strategyEval.agreeingStrategiesCount;
      rej.totalStrategiesCount = strategyEval.totalStrategiesCount || 6;
      return rej;
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
      return this.createRejection('REJECTED: INSUFFICIENT_DATA. Failed to compute authoritative baseline technical indicators (insufficient candle depth)', marketRegime, regimeDetails);
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
    let totalTfsEvaluated = 0;

    // Check 15m
    if (s15m.length >= 10) {
      totalTfsEvaluated++;
      if ((direction === 'BUY' && entryPrice >= lastEma21_15m) || (direction === 'SELL' && entryPrice <= lastEma21_15m)) {
        timeframesAligned++;
      }
    }
    // Check 1H
    if (s1h.length >= 10) {
      totalTfsEvaluated++;
      if ((direction === 'BUY' && entryPrice >= lastEma21_1h) || (direction === 'SELL' && entryPrice <= lastEma21_1h)) {
        timeframesAligned++;
      }
    }

    // 4H evaluation (Major Direction)
    let is4hAligned = false;
    if (s4h.length >= 10) {
      totalTfsEvaluated++;
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
      totalTfsEvaluated++;
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
      totalTfsEvaluated++;
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
      totalTfsEvaluated++;
      const ema9_5m = TechnicalIndicators.calculateEMA(s5m, Math.min(s5m.length - 1, 9));
      if (ema9_5m.length > 0) {
        const last5mEma = ema9_5m[ema9_5m.length - 1];
        if ((direction === 'BUY' && entryPrice >= last5mEma) || (direction === 'SELL' && entryPrice <= last5mEma)) {
          timeframesAligned++;
        }
      }
    }

    totalTfsEvaluated = Math.max(1, totalTfsEvaluated);
    const timeframeAlignmentRatio = totalTfsEvaluated > 0 ? timeframesAligned / totalTfsEvaluated : 0;

    if (is4hAligned && is1dAligned) {
      higherTfTrendScore = 20;
    } else if (is4hAligned || is1dAligned) {
      higherTfTrendScore = 18;
    } else if (timeframeAlignmentRatio >= 0.8) {
      higherTfTrendScore = 16;
    } else if (timeframesAligned >= 2) {
      higherTfTrendScore = 12;
    } else {
      higherTfTrendScore = 8;
    }

    if (timeframeAlignmentRatio < thresholds.minimumTimeframeAlignment) {
      return this.createRejection(
        `REJECTED: INSUFFICIENT_TIMEFRAME_ALIGNMENT. Insufficient timeframe confirmation: ${(timeframeAlignmentRatio * 100).toFixed(0)}% aligned (${timeframesAligned}/${totalTfsEvaluated}, minimum ${thresholds.minimumTimeframeAlignment * 100}% required)`,
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
        `REJECTED: INSUFFICIENT_ATR. Volatility filter rejected: ATR ratio (${vm1h.atrRatio}x) outside executable safety bounds`,
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
    // TOTAL 0–100 CORE QUALITY SCORE CALCULATION (GATE 82)
    // Core score strictly represents ONLY deterministic core trade-validity factors.
    // Secondary analytics (empirical calibration factors, AI bonus, relative strength)
    // MUST NOT increase or modify coreScore to rescue a failed setup.
    // =========================================================================
    const coreScore = Math.min(
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
    const totalScore = coreScore;

    const factors: ScoringFactors = {
      higherTfTrendScore,
      marketStructureScore,
      momentumScore,
      volumeOrderFlowScore,
      supportResistanceScore,
      volatilityAtrScore,
      entryQualityScore,
      newsSentimentScore,
      coreScore: totalScore,
      totalScore,
      // Legacy compatibility
      trendScore: higherTfTrendScore,
      structureScore: marketStructureScore,
      volatilityScore: volatilityAtrScore,
      volumeScore: volumeOrderFlowScore,
      strategyAgreementScore: Math.round((strategyEval.agreeingStrategiesCount / 6) * 20),
      riskRewardScore: 8,
      freshnessAgreementScore: newsSentimentScore * 2,
    };

    // =========================================================================
    // GATE 28 / GATE 81: Independent Confirmation Diversity Evaluation (Secondary Evidence)
    // Evaluates confirmation diversity across independent indicator categories
    // =========================================================================
    const diversityResult = Gate28ConfirmationDiversity.evaluate(confluenceReasons, {
      htfEma9: lastEma9_1h,
      htfEma21: lastEma21_1h,
      htfRsi: lastRsi_1h,
      ltfEma9: lastEma9_15m,
      ltfEma21: lastEma21_15m,
      ltfRsi: lastRsi_15m,
      macd: macd_15m,
      atr: atr_15m,
    });

    if (diversityResult.explanation) {
      confluenceReasons.push(diversityResult.explanation);
    }

    // =========================================================================
    // SL / TP Geometry & Risk/Reward Hurdle
    // =========================================================================
    if (direction !== 'BUY' && direction !== 'SELL') {
      throw new Error(`Invalid direction value: ${direction}`);
    }

    const profile = this.getAssetExecutionProfile(cleanSymbol, entryPrice, Math.max(atr_15m, atr_1h));
    const precision = profile.precision;

    let stopLoss = 0;
    let takeProfit = 0;
    let tp1 = 0;
    let tp2 = 0;
    let tp3 = 0;

    // 1. Structural anchor & 2. Minimum-safe floor (must respect the 0.85 * ATR noise floor of both 15m and 1h)
    const effectiveAtrForNoiseFloor = atr_1h > 0 ? Math.max(atr_15m, atr_1h) : atr_15m;
    const minSafeDistance = Math.max(profile.minPracticalStopDistance, effectiveAtrForNoiseFloor * 0.85);
    let rawStopDistance = 0;
    if (direction === 'BUY') {
      const structuralSlPrice = support15m - atr_15m * 0.4;
      rawStopDistance = Math.max(entryPrice - structuralSlPrice, minSafeDistance);
    } else {
      const structuralSlPrice = resistance15m + atr_15m * 0.4;
      rawStopDistance = Math.max(structuralSlPrice - entryPrice, minSafeDistance);
    }

    // 3. Maximum stop cap (never compressed below minSafeDistance)
    const normalizedAsset = profile.assetClass === 'STOCK' ? 'STOCKS' : profile.assetClass.toUpperCase();
    const guardrails = ASSET_CLASS_GUARDRAILS[normalizedAsset] || ASSET_CLASS_GUARDRAILS.DEFAULT;
    const maxStopDistance = Math.max(minSafeDistance, entryPrice * (guardrails.tp3.maxPct / 100));
    const finalStopDistance = Math.min(rawStopDistance, maxStopDistance);

    // 4. Round final SL
    stopLoss = direction === 'BUY'
      ? Number((entryPrice - finalStopDistance).toFixed(precision))
      : Number((entryPrice + finalStopDistance).toFixed(precision));

    const primaryStrategyName = strategyEval.strategyResults?.find(s => s.passed)?.name || 'Multi-Timeframe Trend Confluence';

    // Use a blended ATR basis for take-profit sizing rather than the
    // 15-minute ATR alone. The 15m ATR is naturally small and was
    // confirmed (via live scan data) to cause TP2 to hit its guardrail
    // floor almost universally, while SL is driven by genuine
    // structural swing points and is not similarly constrained. A
    // blend keeps TP responsive to short-term volatility while
    // anchoring it to a timeframe more comparable to where SL's
    // structural distance actually comes from.
    const tpAtrBasis = atr_1h > 0 ? (atr_15m * 0.5 + atr_1h * 0.5) : atr_15m;

    const tpSetup = ScoringEngine.calculateThreeTakeProfits(
      direction,
      entryPrice,
      stopLoss,
      tpAtrBasis,
      support15m,
      resistance15m,
      majorSupport1h,
      majorResistance1h,
      primaryStrategyName,
      profile.minPracticalTargetDistance,
      precision,
      profile.assetClass
    );

    tp1 = tpSetup.tp1;
    tp2 = tpSetup.tp2;
    tp3 = tpSetup.tp3;
    takeProfit = tp2;

    const isBuyDirection = direction === 'BUY';

    const rrResult = RiskRewardCalculator.calculate(entryPrice, stopLoss, tp1, tp2, tp3, direction, thresholds.minimumRR);
    if (!rrResult.isValid) {
      logRrRejectionDiagnostic({
        symbol: cleanSymbol,
        direction,
        entryPrice,
        stopLoss,
        tp1,
        tp2,
        tp3,
        structural15m: isBuyDirection ? resistance15m : support15m,
        structural1h: isBuyDirection ? majorResistance1h : majorSupport1h,
        assetClass: profile.assetClass,
        rejectionReason: rrResult.reason,
      });
      return this.createRejection(
        `REJECTED: ${rrResult.reason?.includes('GROSS_RR') ? 'GROSS_RR_BELOW_THRESHOLD' : 'INVALID_RR_GEOMETRY'}. ${rrResult.reason || 'Invalid Risk/Reward geometry'}`,
        marketRegime,
        regimeDetails,
        totalScore,
        direction,
        stopLoss,
        takeProfit,
        tp1,
        tp2,
        tp3,
        rrResult.grossRR,
        entryPrice,
        rrResult.primaryRR,
        rrResult.tp1RR,
        rrResult.tp2RR,
        rrResult.tp3RR,
        factors,
        tpSetup.diagnostics
      );
    }
    const rawRR = rrResult.grossRR;
    takeProfit = rrResult.selectedTarget === 'TP3' ? tp3 : tp2;
    const calculatedRisk = rrResult.riskDistance;
    const calculatedReward = rrResult.rewardDistance;

    // GATE 45 Step 1 & 2: Calculate Gross R:R & Reject if gross R:R < minimum acceptable GROSS R:R
    if (rawRR < thresholds.minimumRR) {
      logRrRejectionDiagnostic({
        symbol: cleanSymbol,
        direction,
        entryPrice,
        stopLoss,
        tp1,
        tp2,
        tp3,
        structural15m: isBuyDirection ? resistance15m : support15m,
        structural1h: isBuyDirection ? majorResistance1h : majorSupport1h,
        assetClass: profile.assetClass,
        rejectionReason: `GROSS_RR_BELOW_THRESHOLD. Gross Risk/Reward ratio (${rawRR.toFixed(2)}:1) is below minimum acceptable GROSS R:R (${thresholds.minimumRR}:1)`,
      });
      return this.createRejection(
        `REJECTED: GROSS_RR_BELOW_THRESHOLD. Gross Risk/Reward ratio (${rawRR.toFixed(2)}:1) is below minimum acceptable GROSS R:R (${thresholds.minimumRR}:1)`,
        marketRegime,
        regimeDetails,
        totalScore,
        direction,
        stopLoss,
        takeProfit,
        tp1,
        tp2,
        tp3,
        rawRR,
        entryPrice,
        rrResult.primaryRR,
        rrResult.tp1RR,
        rrResult.tp2RR,
        rrResult.tp3RR,
        factors,
        tpSetup.diagnostics
      );
    }

    // Gate 91: 4 High-Quality Optimized Pathways
    const hasStrongTrend = higherTfTrendScore >= 12;
    const hasValidEntry = entryQualityScore >= 5;
    const hasGoodRR = rawRR >= thresholds.minimumRR;
    const isStrongTrendPath = hasStrongTrend && hasValidEntry && hasGoodRR;

    const isBreakout = (marketRegime as string) === 'BREAKOUT' || primaryStrategyName.toUpperCase().includes('BREAKOUT');
    const hasValidStructure = marketStructureScore >= 9;
    const isGoodBreakoutPath = isBreakout && hasValidStructure && hasGoodRR;

    const isReversal = (marketRegime as string) === 'RANGE_REVERSAL' || (marketRegime as string) === 'RANGE' || primaryStrategyName.toUpperCase().includes('REVERSAL') || primaryStrategyName.toUpperCase().includes('DIVERGENCE') || primaryStrategyName.toUpperCase().includes('SWEEP');
    const hasAcceptableRisk = rawRR >= thresholds.minimumRR;
    const isGoodReversalPath = isReversal && hasValidStructure && hasAcceptableRisk;

    const hasGoodMomentum = momentumScore >= 9;
    const isGoodMomentumPath = hasGoodMomentum && hasValidEntry && hasAcceptableRisk;

    const isOptimizedPath = isStrongTrendPath || isGoodBreakoutPath || isGoodReversalPath || isGoodMomentumPath;
    const effectiveMinWinProb = isOptimizedPath ? 35 : thresholds.minimumWinProbability;

    // Historical Win Rate & Positive Expectancy Calculation
    const estimatedWinRate = this.estimateWinRate(totalScore, rawRR, strategyEval.agreeingStrategiesCount);
    if (estimatedWinRate <= effectiveMinWinProb) {
      return this.createRejection(
        `REJECTED: WIN_RATE_BELOW_THRESHOLD. Estimated win rate (${estimatedWinRate}%) is at or below ${effectiveMinWinProb}% threshold`,
        marketRegime,
        regimeDetails,
        totalScore,
        direction,
        stopLoss,
        takeProfit,
        tp1,
        tp2,
        tp3,
        rawRR,
        entryPrice,
        rrResult.primaryRR,
        rrResult.tp1RR,
        rrResult.tp2RR,
        rrResult.tp3RR,
        factors,
        tpSetup.diagnostics
      );
    }

    const expectancy = this.calculateExpectancy(estimatedWinRate, rawRR);
    if (expectancy <= 0) {
      return this.createRejection(
        `REJECTED: NEGATIVE_EXPECTANCY. Negative mathematical expectancy (${expectancy}R per trade). Setup discarded.`,
        marketRegime,
        regimeDetails,
        totalScore,
        direction,
        stopLoss,
        takeProfit,
        tp1,
        tp2,
        tp3,
        rawRR,
        entryPrice,
        rrResult.primaryRR,
        rrResult.tp1RR,
        rrResult.tp2RR,
        rrResult.tp3RR,
        factors,
        tpSetup.diagnostics
      );
    }

    // Score Classification using Centralized Configuration:
    // score >= signalThreshold → ACTIONABLE SIGNAL (HIGH_QUALITY)
    // score >= qualifiedCandidateThreshold → QUALIFIED CANDIDATE (VALID)
    // score >= watchingThreshold → WATCHING (VALID)
    // Below watchingThreshold → REJECT
    let qualityTier: QualityTier = 'REJECT';
    if (totalScore >= thresholds.signalThreshold) qualityTier = 'HIGH_QUALITY';
    else if (totalScore >= thresholds.qualifiedCandidateThreshold) qualityTier = 'VALID';
    else if (totalScore >= thresholds.watchingThreshold) qualityTier = 'VALID';

    if (totalScore < thresholds.minimumScore) {
      return this.createRejection(
        `REJECTED: SCORE_BELOW_THRESHOLD. Deterministic quality score ${totalScore}/100 is below minimum actionable threshold of ${thresholds.minimumScore}`,
        marketRegime,
        regimeDetails,
        totalScore,
        direction,
        stopLoss,
        takeProfit,
        tp1,
        tp2,
        tp3,
        rawRR,
        entryPrice,
        rrResult.primaryRR,
        rrResult.tp1RR,
        rrResult.tp2RR,
        rrResult.tp3RR,
        factors,
        tpSetup.diagnostics
      );
    }

    // GATE 45 Step 3, 4, 5, 6: Friction Hurdle & Gate 34 Execution Friction Stress Test
    const spreadUnits = profile.estimatedSpreadUnits;
    const feePct = profile.estimatedFeeBufferPct;

    const stressTest = Gate34ExecutionFrictionStressTest.evaluate(
      symbol,
      entryPrice,
      stopLoss,
      takeProfit,
      tp1,
      tp2,
      tp3
    );

    // GATE 45 Step 4: Reject if normal net R:R < minimumNetRR
    if (stressTest.normal.netRR < thresholds.minimumNetRR) {
      return this.createRejection(
        `REJECTED: NET_RR_BELOW_THRESHOLD. Normal Net Risk/Reward ratio (${stressTest.normal.netRR.toFixed(2)}:1) is below minimum acceptable NET R:R (${thresholds.minimumNetRR}:1) (Gross R:R: ${rawRR.toFixed(2)}:1)`,
        marketRegime,
        regimeDetails,
        totalScore,
        direction,
        stopLoss,
        takeProfit,
        tp1,
        tp2,
        tp3,
        rawRR,
        entryPrice,
        rrResult.primaryRR,
        rrResult.tp1RR,
        rrResult.tp2RR,
        rrResult.tp3RR,
        factors,
        tpSetup.diagnostics
      );
    }

    // GATE 45 Step 5 & 6: Adverse Net R:R as risk-quality modifier unless hard gate enabled
    if (thresholds.enforceAdverseNetRRHardGate && stressTest.adverse.netRR < (thresholds.minimumAdverseNetRR ?? 1.0)) {
      return this.createRejection(
        `REJECTED: ADVERSE_NET_RR_BELOW_THRESHOLD. Adverse Net Risk/Reward ratio (${stressTest.adverse.netRR.toFixed(2)}:1) is below required stress floor (${(thresholds.minimumAdverseNetRR ?? 1.0)}:1)`,
        marketRegime,
        regimeDetails,
        totalScore,
        direction,
        stopLoss,
        takeProfit,
        tp1,
        tp2,
        tp3,
        rawRR,
        entryPrice,
        rrResult.primaryRR,
        rrResult.tp1RR,
        rrResult.tp2RR,
        rrResult.tp3RR,
        factors,
        tpSetup.diagnostics
      );
    }

    // Safety buffer / execution cost checks from Gate 34
    if (!stressTest.isPassed && stressTest.rejectionReason && stressTest.rejectionReason !== 'ADVERSE_NET_RR_BELOW_THRESHOLD') {
      return this.createRejection(
        stressTest.reasons[0] || `REJECTED: ${stressTest.rejectionReason}. Execution friction stress test failed.`,
        marketRegime,
        regimeDetails,
        totalScore,
        direction,
        stopLoss,
        takeProfit,
        tp1,
        tp2,
        tp3,
        rawRR,
        entryPrice,
        rrResult.primaryRR,
        rrResult.tp1RR,
        rrResult.tp2RR,
        rrResult.tp3RR,
        factors,
        tpSetup.diagnostics
      );
    }

    const netRR = stressTest.normal.netRR;

    const targetDistance = Number((calculatedReward * profile.pipMultiplier).toFixed(1));
    const stopDistance = Number((calculatedRisk * profile.pipMultiplier).toFixed(1));

    const hypotheticalRisk = this.calculateHypotheticalRisk(entryPrice, stopLoss, profile.minPracticalStopDistance);

    // Update dynamic factor fields
    factors.riskRewardScore = rawRR >= 2.5 ? 10 : 8;

    return {
      isValid: true,
      score: totalScore,
      coreScore: totalScore,
      qualityTier,
      direction,
      marketRegime,
      regimeDetails,
      confluenceReasons,
      stopLoss,
      takeProfit,
      tp1,
      tp2,
      tp3,
      tpDiagnostics: tpSetup.diagnostics,
      riskRewardRatio: rawRR,
      grossRR: rawRR,
      primaryRR: rrResult.primaryRR,
      tp1RR: rrResult.tp1RR,
      tp2RR: rrResult.tp2RR,
      tp3RR: rrResult.tp3RR,
      entryPrice,
      estimatedWinRate,
      expectancy,
      targetDistance,
      stopDistance,
      pipPointUnit: profile.pipPointUnit,
      alignedCount: timeframesAligned,
      totalEvaluated: totalTfsEvaluated,
      timeframeAlignmentRatio,
      timeframesAligned,
      totalTimeframesEvaluated: totalTfsEvaluated,
      agreeingStrategiesCount: strategyEval.agreeingStrategiesCount,
      totalStrategiesCount: 6,
      strategyAgreementRatio: strategyEval.agreementRatio,
      isTopTradeCandidate: totalScore >= thresholds.signalThreshold && timeframeAlignmentRatio >= (thresholds.minimumTimeframeAlignment || 0.50),
      estimatedFriction: {
        spreadPipsOrPoints: spreadUnits,
        feeBufferPct: feePct,
        netRiskRewardRatio: netRR,
        grossRiskRewardRatio: stressTest.grossRR,
        normalNetRiskRewardRatio: stressTest.normal.netRR,
        adverseNetRiskRewardRatio: stressTest.adverse.netRR,
        frictionToProfitPct: parseFloat((stressTest.normal.frictionRatio * 100).toFixed(1)),
        isExecutionPassed: stressTest.isPassed,
        stressTestDetails: stressTest,
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

  public static calculateThreeTakeProfits(
    direction: SignalDirection,
    entryPrice: number,
    stopLoss: number,
    atr_15m: number,
    support15m: number,
    resistance15m: number,
    majorSupport1h: number,
    majorResistance1h: number,
    primaryStrategyName: string,
    minPracticalTargetDistance: number,
    precision: number,
    assetClass: string
  ): { tp1: number; tp2: number; tp3: number; diagnostics?: TpCalculationDiagnostics } {
    if (direction !== 'BUY' && direction !== 'SELL') {
      throw new Error(`Invalid direction value: ${direction}`);
    }

    const thresholds = serverConfig.getConfig().thresholds;
    
    // Ensure we have a non-zero ATR and minPracticalTargetDistance
    const cleanAtr = atr_15m > 0 ? atr_15m : entryPrice * 0.01;
    const cleanMinDistance = minPracticalTargetDistance > 0 ? minPracticalTargetDistance : cleanAtr * 1.5;

    // Minimum represented unit at this precision
    const minPrecisionStep = Math.pow(10, -precision);
    
    // Spacing step between levels - must be at least 10 units of precision to prevent rounding collisions
    const minStep = Math.max(cleanAtr * 0.4, 10 * minPrecisionStep, cleanMinDistance * 0.25);

    // Strategy multipliers: conservative (TP1), main (TP2), extended (TP3)
    let tp1Mult = 1.2;
    let tp2Mult = 2.2;
    let tp3Mult = 3.5;

    if (primaryStrategyName.includes('Trend')) {
      tp1Mult = 1.3; tp2Mult = 2.2; tp3Mult = 3.6;
    } else if (primaryStrategyName.includes('Breakout')) {
      tp1Mult = 1.5; tp2Mult = 2.5; tp3Mult = 4.2;
    } else if (primaryStrategyName.includes('Reversion') || primaryStrategyName.includes('Bollinger')) {
      tp1Mult = 1.0; tp2Mult = 2.0; tp3Mult = 2.8;
    } else if (primaryStrategyName.includes('Momentum')) {
      tp1Mult = 1.25; tp2Mult = 2.15; tp3Mult = 3.4;
    } else if (primaryStrategyName.includes('Imbalance') || primaryStrategyName.includes('Order Flow')) {
      tp1Mult = 1.15; tp2Mult = 2.05; tp3Mult = 3.1;
    } else if (primaryStrategyName.includes('Volatility')) {
      tp1Mult = 1.2; tp2Mult = 2.1; tp3Mult = 3.2;
    }

    let tp1 = 0;
    let tp2 = 0;
    let tp3 = 0;

    const isBuy = direction === 'BUY';

    const minimumRR = serverConfig.getConfig().thresholds.minimumRR;
    const riskDistance = Math.abs(entryPrice - stopLoss);
    const requiredRRDistance = riskDistance * minimumRR;
    const requiredRRTarget = isBuy ? entryPrice + requiredRRDistance : entryPrice - requiredRRDistance;

    if (isBuy) {
      // TP1: conservative
      let baseTp1 = entryPrice + (cleanAtr * tp1Mult);
      if (resistance15m > entryPrice) {
        baseTp1 = 0.5 * baseTp1 + 0.5 * resistance15m;
      }
      tp1 = Math.max(baseTp1, entryPrice + cleanMinDistance * 0.5);

      // TP2: primary
      let baseTp2 = entryPrice + (cleanAtr * tp2Mult);
      if (majorResistance1h > entryPrice) {
        if (majorResistance1h >= requiredRRTarget) {
          baseTp2 = 0.3 * baseTp2 + 0.7 * (majorResistance1h - cleanAtr * 0.15);
        } else {
          // Nearest 1h structural anchor is closer than required minimum R:R.
          // Do not force baseTp2 down to near anchor if pure ATR target is higher.
          baseTp2 = Math.max(baseTp2, majorResistance1h - cleanAtr * 0.15);
        }
      }
      tp2 = Math.max(baseTp2, tp1 + minStep);

      // TP3: extended
      let baseTp3 = entryPrice + (cleanAtr * tp3Mult);
      if (majorResistance1h > entryPrice) {
        baseTp3 = Math.max(baseTp3, majorResistance1h + cleanAtr * tp3Mult * 0.4);
      }
      tp3 = Math.max(baseTp3, tp2 + minStep);
    } else {
      // TP1: conservative
      let baseTp1 = entryPrice - (cleanAtr * tp1Mult);
      if (support15m < entryPrice) {
        baseTp1 = 0.5 * baseTp1 + 0.5 * support15m;
      }
      tp1 = Math.min(baseTp1, entryPrice - cleanMinDistance * 0.5);

      // TP2: primary
      let baseTp2 = entryPrice - (cleanAtr * tp2Mult);
      if (majorSupport1h < entryPrice) {
        if (majorSupport1h <= requiredRRTarget) {
          baseTp2 = 0.3 * baseTp2 + 0.7 * (majorSupport1h + cleanAtr * 0.15);
        } else {
          baseTp2 = Math.min(baseTp2, majorSupport1h + cleanAtr * 0.15);
        }
      }
      tp2 = Math.min(baseTp2, tp1 - minStep);

      // TP3: extended
      let baseTp3 = entryPrice - (cleanAtr * tp3Mult);
      if (majorSupport1h < entryPrice) {
        baseTp3 = Math.min(baseTp3, majorSupport1h - cleanAtr * tp3Mult * 0.4);
      }
      tp3 = Math.min(baseTp3, tp2 - minStep);
    }

    // NEW — percentage guardrail clamp
    const normalizedAsset = assetClass === 'STOCK' ? 'STOCKS' : assetClass.toUpperCase();
    const baseGuardrails = ASSET_CLASS_GUARDRAILS[normalizedAsset] || ASSET_CLASS_GUARDRAILS.DEFAULT;

    let tp1Clamped = AtrTpGenerator.applyGuardrail(tp1, baseGuardrails.tp1, entryPrice, isBuy);
    let tp2Clamped = AtrTpGenerator.applyGuardrail(tp2, baseGuardrails.tp2, entryPrice, isBuy);
    let tp3Clamped = AtrTpGenerator.applyGuardrail(tp3, baseGuardrails.tp3, entryPrice, isBuy);

    tp1 = tp1Clamped;
    tp2 = tp2Clamped;
    tp3 = tp3Clamped;

    // Ordering/distinctness enforcement
    if (isBuy) {
      if (tp1 < entryPrice + minPrecisionStep) {
        tp1 = entryPrice + minPrecisionStep;
      }
      if (tp2 < tp1 + minStep) {
        tp2 = tp1 + minStep;
      }
      if (tp3 < tp2 + minStep) {
        tp3 = tp2 + minStep;
      }
    } else {
      if (tp1 > entryPrice - minPrecisionStep) {
        tp1 = entryPrice - minPrecisionStep;
      }
      if (tp2 > tp1 - minStep) {
        tp2 = tp1 - minStep;
      }
      if (tp3 > tp2 - minStep) {
        tp3 = tp2 - minStep;
      }
    }

    return {
      tp1: Number(tp1.toFixed(precision)),
      tp2: Number(tp2.toFixed(precision)),
      tp3: Number(tp3.toFixed(precision)),
      // Diagnostics only — not used for any trading decision. Lets us
      // confirm from real scan data whether the guardrail floor is
      // still binding as often after Fix 1, and whether the
      // structural anchor (majorResistance1h/majorSupport1h) or the
      // pure-ATR component is driving the raw value.
      diagnostics: {
        rawTp1BeforeClamp: Number(tp1Clamped.toFixed(precision)),
        rawTp2BeforeClamp: Number(tp2Clamped.toFixed(precision)),
        rawTp3BeforeClamp: Number(tp3Clamped.toFixed(precision)),
        guardrailTp2MinPct: baseGuardrails.tp2.minPct,
        guardrailTp2MaxPct: baseGuardrails.tp2.maxPct,
        structuralAnchorUsedForTp2: isBuy ? (majorResistance1h > entryPrice) : (majorSupport1h < entryPrice),
      }
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
      const precision = getDynamicPrecision(price, symbol);

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
      precision: getDynamicPrecision(price, symbol),
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
    regimeDetails = 'Unqualified',
    score = 0,
    direction: SignalDirection = 'BUY',
    stopLoss = 0,
    takeProfit = 0,
    tp1 = 0,
    tp2 = 0,
    tp3 = 0,
    riskRewardRatio = 0,
    entryPrice = 0,
    primaryRR = 0,
    tp1RR = 0,
    tp2RR = 0,
    tp3RR = 0,
    factors?: ScoringFactors,
    tpDiagnostics?: TpCalculationDiagnostics
  ): ScoringResult {
    return {
      isValid: false,
      score,
      coreScore: score,
      qualityTier: 'REJECT',
      direction,
      marketRegime,
      regimeDetails,
      rejectionReason,
      confluenceReasons: [],
      stopLoss,
      takeProfit,
      tp1,
      tp2,
      tp3,
      tpDiagnostics,
      riskRewardRatio,
      grossRR: riskRewardRatio,
      primaryRR: primaryRR || riskRewardRatio,
      tp1RR,
      tp2RR,
      tp3RR,
      entryPrice,
      estimatedWinRate: 0,
      expectancy: 0,
      alignedCount: 0,
      totalEvaluated: 6,
      timeframeAlignmentRatio: 0,
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
      factors: factors || {
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

  /**
   * Centralized score classification based on serverConfig thresholds:
   * score >= signalThreshold → ACTIONABLE SIGNAL
   * score >= qualifiedCandidateThreshold → QUALIFIED CANDIDATE
   * score >= watchingThreshold → WATCHING
   */
  static classifyScore(score: number, customThresholds?: { signalThreshold: number; qualifiedCandidateThreshold: number; watchingThreshold: number }) {
    const thresholds = customThresholds || serverConfig.getConfig().thresholds;
    if (score >= 90) {
      return {
        tier: 'EXCEPTIONAL' as const,
        label: `Exceptional (90-100)`,
        isActionable: true,
        isQualifiedCandidate: true,
        isWatching: true,
      };
    }
    if (score >= 80) {
      return {
        tier: 'VERY_STRONG' as const,
        label: `Very Strong setup (80-89)`,
        isActionable: true,
        isQualifiedCandidate: true,
        isWatching: true,
      };
    }
    if (score >= 75) {
      return {
        tier: 'STRONG' as const,
        label: `Strong setup (75-79)`,
        isActionable: true,
        isQualifiedCandidate: true,
        isWatching: true,
      };
    }
    if (score >= thresholds.signalThreshold) {
      return {
        tier: 'MODERATE_VALID' as const,
        label: `Valid / Moderate setup (${thresholds.signalThreshold}-74)`,
        isActionable: true,
        isQualifiedCandidate: true,
        isWatching: true,
      };
    }
    if (score >= thresholds.watchingThreshold) {
      return {
        tier: 'WATCHING' as const,
        label: `WATCHING (${thresholds.watchingThreshold}-${thresholds.signalThreshold - 1})`,
        isActionable: false,
        isQualifiedCandidate: false,
        isWatching: true,
      };
    }
    return {
      tier: 'REJECT' as const,
      label: `REJECT (< ${thresholds.watchingThreshold})`,
      isActionable: false,
      isQualifiedCandidate: false,
      isWatching: false,
    };
  }
}

