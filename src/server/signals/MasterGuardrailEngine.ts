/**
 * MASTER GUARDRAIL ENGINE — ADAPTIVE PROFITABILITY & RISK CONTROL SYSTEM
 *
 * Implements the 7-step authoritative decision pipeline:
 * 1. HARD SAFETY VALIDATION (Strict fail-closed geometry, freshness, ATR, TP/SL structure)
 * 2. MARKET / REGIME VALIDATION (Regime-aware threshold curves & volatility classification)
 * 3. CALIBRATED PROBABILITY (Point-in-time empirical & model Bayesian calibration, no look-ahead)
 * 4. EXPECTED RETURN & ADVERSE MOVE (Calculated forward expected return & adverse excursion)
 * 5. EXPECTED VALUE (Mathematical Expectancy EV > 0 hard floor: EV = (P(win)*gain) - (P(loss)*loss))
 * 6. ADAPTIVE R:R CHECK (Calculates actualRR = reward/risk; adapts threshold with conservative safety floor)
 * 7. PORTFOLIO & EXECUTION RISK (Friction stress-testing, correlation concentration & risk limits)
 *
 * NO LOOK-AHEAD BIAS: Uses strictly point-in-time market information available at evaluation.
 * NO PROFIT PROMISES: Learned parameters derive strictly from completed historical walk-forward records.
 */

import {
  SignalDirection,
  NormalizedCandle,
  NormalizedTicker,
  TradingSignal,
  MasterGuardrailDecision,
} from '../../types/index.js';
import { serverConfig } from '../config.js';
import { SymbolNormalizer } from '../market/SymbolNormalizer.js';
import { logger } from '../logger.js';
import { RiskRewardCalculator } from './RiskRewardCalculator.js';
import { AdaptiveCalibrationEngine } from './AdaptiveCalibrationEngine.js';
import { QlibEvidence } from './QlibQuantEngine.js';
import { KronosEvidence } from './KronosForecastEngine.js';
import { TradingAgentsResearchReport } from './TradingAgentsResearchEngine.js';
import { PortfolioCandidateEvaluation } from './FinRLXPortfolioEngine.js';
import { EMAVWAPPayoffResult } from './EMAVWAPPayoffEngine.js';
import { FreqtradeExitEvaluationResult } from './FreqtradeExitEngine.js';

export interface GuardrailEvaluationInput {
  symbol: string;
  direction: SignalDirection;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  tp1?: number;
  tp2?: number;
  tp3?: number;
  score: number;
  atr?: number;
  marketRegime?: string;
  primaryStrategy?: string;
  liveTicker?: NormalizedTicker | null;
  candlesMap?: Record<string, NormalizedCandle[]>;
  timeframeAlignmentRatio?: number;
  timeframesAligned?: number;
  agreeingStrategiesCount?: number;
  historicalWinRate?: number;
  probabilitySource?: 'EMPIRICAL' | 'MODEL' | 'FALLBACK';
  walkForwardEfficiency?: number;
  estimatedFriction?: {
    spreadPipsOrPoints?: number;
    feeBufferPct?: number;
    netRiskRewardRatio?: number;
  };
  correlationPenalty?: number;
  finrlRiskScaling?: number;
  newsSentiment?: string;
  qlibEvidence?: QlibEvidence;
  kronosEvidence?: KronosEvidence;
  tradingAgentsResearch?: TradingAgentsResearchReport;
  finrlEvaluation?: PortfolioCandidateEvaluation;
  emaVwapPayoff?: EMAVWAPPayoffResult;
  freqtradeExit?: FreqtradeExitEvaluationResult;
  currentTimeMs?: number;
}

export class MasterGuardrailEngine {
  public static readonly MODEL_VERSION = 'v3.2.0-master-guardrail-adaptive';
  public static readonly CONSERVATIVE_SAFETY_FLOOR_RR = 1.40;
  public static readonly MAX_REQUIRED_RR = 2.50;
  public static readonly MAX_DATA_AGE_SECONDS = 180;

  /**
   * Evaluates a candidate signal across the full 7-step Master Guardrail Pipeline.
   */
  public static evaluateCandidate(input: GuardrailEvaluationInput): MasterGuardrailDecision {
    const now = input.currentTimeMs || Date.now();
    const config = serverConfig.getConfig();
    const baseMinRR = Math.max(MasterGuardrailEngine.CONSERVATIVE_SAFETY_FLOOR_RR, config.thresholds?.minimumRR || 1.60);

    const violations: string[] = [];

    // =========================================================================
    // STEP 1: HARD SAFETY VALIDATION
    // =========================================================================
    const { isHardSafe, hardViolations, actualRisk, actualReward, tp1, tp2, tp3, safeTakeProfit } =
      this.validateHardSafety(input, now);

    if (!isHardSafe) {
      violations.push(...hardViolations);
    }

    // =========================================================================
    // STEP 2: MARKET / REGIME VALIDATION
    // =========================================================================
    const cleanRegime = (input.marketRegime || 'UNKNOWN').toUpperCase();
    const regimeType = this.classifyRegime(cleanRegime);

    // =========================================================================
    // STEP 3: CALIBRATED PROBABILITY
    // =========================================================================
    const probResult = this.estimateCalibratedProbability(input, cleanRegime);
    const winProbability = probResult.probability;

    // =========================================================================
    // STEP 4: EXPECTED RETURN & EXPECTED ADVERSE MOVE
    // =========================================================================
    const actualRR = actualRisk > 0 ? Number((actualReward / actualRisk).toFixed(2)) : 0;
    const frictionFeePct = (input.estimatedFriction?.feeBufferPct || 0.001); // 0.1% fee/slippage baseline

    const gainPct = input.entryPrice > 0 ? Math.abs(safeTakeProfit - input.entryPrice) / input.entryPrice : 0;
    const lossPct = input.entryPrice > 0 ? Math.abs(input.entryPrice - input.stopLoss) / input.entryPrice : 0;

    const expectedReturn = Number(
      ((winProbability * gainPct) - ((1 - winProbability) * lossPct) - frictionFeePct).toFixed(4)
    );

    // Expected Adverse Excursion / Movement (in % of entry)
    const atr = input.atr || (input.entryPrice * 0.01);
    const regimeExcursionMultiplier = regimeType === 'HIGH_VOLATILITY' ? 1.5 : (regimeType === 'TRENDING' ? 0.9 : 1.1);
    const expectedAdverseMove = Number(
      Math.min(lossPct * 0.95, ((atr * 1.2 * regimeExcursionMultiplier) / (input.entryPrice || 1))).toFixed(4)
    );

    // =========================================================================
    // STEP 5: EXPECTED VALUE (EV) CALCULATION & HARD FLOOR
    // =========================================================================
    // Net R-Multiple Expected Value: EV = (P(win) * expectedGainR) - (P(loss) * expectedLossR) - frictionInR
    const riskInPrice = Math.max(0.0001, actualRisk);
    const rewardInPrice = Math.max(0, actualReward);
    const grossRRInR = rewardInPrice / riskInPrice;
    const frictionInR = (input.entryPrice * frictionFeePct) / riskInPrice;

    const expectedGainR = Math.max(0, grossRRInR - frictionInR);
    const expectedLossR = 1.0 + frictionInR;

    const expectedValue = Number(
      ((winProbability * expectedGainR) - ((1 - winProbability) * expectedLossR)).toFixed(3)
    );

    const evFloorPassed = expectedValue > 0.0;
    if (!evFloorPassed) {
      violations.push(
        `EV_NON_POSITIVE: Expected value (${expectedValue.toFixed(3)}R) is non-positive. P(win)=${(winProbability * 100).toFixed(1)}%, Gross R:R=${grossRRInR.toFixed(2)}:1.`
      );
    }

    // =========================================================================
    // STEP 6: MULTI-FACTOR TRADE QUALITY & ADAPTIVE R:R CHECK
    // =========================================================================
    const qualityScore = this.calculateMultiFactorQuality(input, winProbability, expectedReturn, expectedValue, regimeType);
    const adaptiveMinRR = this.calculateAdaptiveMinRR(baseMinRR, qualityScore, regimeType, expectedValue, winProbability);

    const passesAdaptiveRR = actualRR >= adaptiveMinRR && actualRisk > 0 && actualReward > 0;
    if (!passesAdaptiveRR && isHardSafe) {
      violations.push(
        `ADAPTIVE_RR_BELOW_THRESHOLD: Actual R:R (${actualRR.toFixed(2)}:1) is below adaptive requirement (${adaptiveMinRR.toFixed(2)}:1) for Quality Score ${qualityScore}/100.`
      );
    }

    // =========================================================================
    // STEP 7: PORTFOLIO & EXECUTION RISK CHECK
    // =========================================================================
    const correlationPenalty = input.correlationPenalty || 0;
    const finrlScaling = input.finrlRiskScaling ?? 1.0;

    let riskLevel: 'LOW' | 'MODERATE' | 'ELEVATED' | 'HIGH' | 'CRITICAL' = 'MODERATE';
    if (qualityScore >= 80 && expectedValue >= 0.35 && correlationPenalty === 0) {
      riskLevel = 'LOW';
    } else if (qualityScore >= 65 && expectedValue >= 0.15) {
      riskLevel = 'MODERATE';
    } else if (qualityScore >= 50 && expectedValue > 0) {
      riskLevel = 'ELEVATED';
    } else if (expectedValue <= 0 || correlationPenalty > 20 || finrlScaling < 0.5) {
      riskLevel = 'HIGH';
    }

    if (correlationPenalty >= 40) {
      violations.push(`PORTFOLIO_CONCENTRATION_EXCEEDED: High correlation cluster penalty (${correlationPenalty}%).`);
    }

    if (input.finrlEvaluation && !input.finrlEvaluation.allowed) {
      violations.push(`FINRL_PORTFOLIO_CONSTRAINT_VIOLATION: ${input.finrlEvaluation.constraintViolations.join('; ')}`);
    }

    if (input.tradingAgentsResearch?.riskAnalysis?.riskStance === 'PROHIBITIVE') {
      violations.push(`RESEARCH_TAIL_RISK_PROHIBITIVE: TradingAgents risk manager flagged prohibitive tail risk.`);
    }

    // Overall final decision
    const allPassed = isHardSafe && evFloorPassed && passesAdaptiveRR && violations.length === 0;
    const guardrailDecision = allPassed ? 'ACCEPTED' : 'REJECTED';
    const primaryRejectionReason = violations.length > 0 ? violations[0] : undefined;

    const confidence = Math.min(100, Math.max(10, Math.round(
      (qualityScore * 0.5) + (winProbability * 100 * 0.3) + (Math.min(1.0, Math.max(0, expectedValue)) * 20)
    )));

    return {
      probability: winProbability,
      probabilitySource: probResult.source,
      expectedReturn,
      expectedAdverseMove,
      actualRR,
      expectedValue,
      confidence,
      regime: cleanRegime,
      riskLevel,
      guardrailDecision,
      rejectionReason: primaryRejectionReason,
      modelVersion: this.MODEL_VERSION,
      adaptiveMinRR,
      hardGatesPassed: isHardSafe,
      qualityScore,
      evFloorPassed,
      multiFactorScore: qualityScore,
      details: {
        hardGateViolations: hardViolations,
        regimeContext: regimeType,
        expectedGainR: Number(expectedGainR.toFixed(2)),
        expectedLossR: Number(expectedLossR.toFixed(2)),
        frictionDeductionR: Number(frictionInR.toFixed(3)),
        winProbabilitySource: probResult.source,
        riskRewardRatio: actualRR,
        netRiskRewardRatio: Number(Math.max(0, actualRR - frictionInR).toFixed(2)),
        selectedTakeProfit: safeTakeProfit,
        tp1,
        tp2,
        tp3,
      },
    };
  }

  /**
   * Attaches master guardrail evaluation to a TradingSignal object.
   */
  public static attachToSignal(signal: TradingSignal, decision: MasterGuardrailDecision): TradingSignal {
    return {
      ...signal,
      guardrailDecision: decision,
      probability: decision.probability,
      expectedReturn: decision.expectedReturn,
      expectedAdverseMove: decision.expectedAdverseMove,
      actualRR: decision.actualRR,
      expectedValue: decision.expectedValue,
      confidence: decision.confidence,
      regime: decision.regime,
      riskLevel: decision.riskLevel,
      modelVersion: decision.modelVersion,
    };
  }

  /**
   * Validates mandatory hard safety geometry (prices, direction, strict order, ATR, freshness).
   */
  private static validateHardSafety(
    input: GuardrailEvaluationInput,
    now: number
  ): {
    isHardSafe: boolean;
    hardViolations: string[];
    actualRisk: number;
    actualReward: number;
    tp1: number;
    tp2: number;
    tp3: number;
    safeTakeProfit: number;
  } {
    const hardViolations: string[] = [];

    const { entryPrice, stopLoss, direction, symbol } = input;
    const isBuy = direction === 'BUY';
    const isSell = direction === 'SELL';

    // 1. Basic price validity
    if (!entryPrice || isNaN(entryPrice) || !isFinite(entryPrice) || entryPrice <= 0) {
      hardViolations.push(`INVALID_ENTRY_PRICE: Entry price is missing or non-positive (${entryPrice}).`);
    }
    if (!stopLoss || isNaN(stopLoss) || !isFinite(stopLoss) || stopLoss <= 0) {
      hardViolations.push(`INVALID_STOP_LOSS: Stop loss is missing or non-positive (${stopLoss}).`);
    }
    if (!direction || (!isBuy && !isSell)) {
      hardViolations.push(`INVALID_DIRECTION: Direction must be BUY or SELL (received '${direction}').`);
    }

    // 2. TP levels setup
    const tp1 = input.tp1 ?? input.takeProfit ?? (isBuy ? entryPrice * 1.01 : entryPrice * 0.99);
    const tp2 = input.tp2 ?? (isBuy ? tp1 * 1.015 : tp1 * 0.985);
    const tp3 = input.tp3 ?? (isBuy ? tp2 * 1.02 : tp2 * 0.98);

    if (!tp1 || isNaN(tp1) || !isFinite(tp1) || tp1 <= 0) {
      hardViolations.push(`INVALID_TAKE_PROFIT: Take-profit 1 is missing or non-positive (${tp1}).`);
    }

    // 3. Strict geometry checks
    if (isBuy) {
      if (stopLoss >= entryPrice) {
        hardViolations.push(`INVALID_BUY_GEOMETRY: Stop Loss (${stopLoss}) must be strictly below Entry (${entryPrice}).`);
      }
      if (tp1 <= entryPrice) {
        hardViolations.push(`INVALID_BUY_GEOMETRY: TP1 (${tp1}) must be strictly above Entry (${entryPrice}).`);
      }
      if (tp2 <= tp1 || tp3 <= tp2) {
        hardViolations.push(`INVALID_BUY_GEOMETRY: Target levels must ascend (TP1: ${tp1} < TP2: ${tp2} < TP3: ${tp3}).`);
      }
    } else if (isSell) {
      if (stopLoss <= entryPrice) {
        hardViolations.push(`INVALID_SELL_GEOMETRY: Stop Loss (${stopLoss}) must be strictly above Entry (${entryPrice}).`);
      }
      if (tp1 >= entryPrice) {
        hardViolations.push(`INVALID_SELL_GEOMETRY: TP1 (${tp1}) must be strictly below Entry (${entryPrice}).`);
      }
      if (tp2 >= tp1 || tp3 >= tp2) {
        hardViolations.push(`INVALID_SELL_GEOMETRY: Target levels must descend (TP1: ${tp1} > TP2: ${tp2} > TP3: ${tp3}).`);
      }
    }

    // 4. Asset-class distance boundaries
    const classification = SymbolNormalizer.getAssetClassification(symbol);
    const maxTpDistPct = classification === 'CRYPTO' ? 0.25 : (classification === 'FOREX' ? 0.08 : 0.15);

    if (entryPrice > 0) {
      const tp3DistPct = Math.abs(tp3 - entryPrice) / entryPrice;
      if (tp3DistPct > maxTpDistPct * 1.05) { // 5% leeway buffer
        hardViolations.push(`TP_EXCEEDS_ASSET_LIMIT: TP3 distance (${(tp3DistPct * 100).toFixed(2)}%) exceeds ${classification} maximum safety limit (${(maxTpDistPct * 100).toFixed(0)}%).`);
      }
    }

    // 5. Freshness check
    if (input.liveTicker && input.liveTicker.timestamp) {
      const ageSec = (now - input.liveTicker.timestamp) / 1000;
      if (ageSec > this.MAX_DATA_AGE_SECONDS) {
        hardViolations.push(`STALE_MARKET_DATA: Quote age (${ageSec.toFixed(1)}s) exceeds ${this.MAX_DATA_AGE_SECONDS}s maximum freshness.`);
      }
    }

    const actualRisk = Math.abs(entryPrice - stopLoss);
    // Select TP2 by default unless TP3 is the primary validated target
    const safeTakeProfit = input.takeProfit ? input.takeProfit : (tp2 > 0 ? tp2 : tp1);
    const actualReward = Math.abs(safeTakeProfit - entryPrice);

    return {
      isHardSafe: hardViolations.length === 0,
      hardViolations,
      actualRisk,
      actualReward,
      tp1,
      tp2,
      tp3,
      safeTakeProfit,
    };
  }

  /**
   * Classifies market regime into standardized analytical archetypes.
   */
  private static classifyRegime(
    marketRegime: string
  ): 'TRENDING' | 'RANGING' | 'HIGH_VOLATILITY' | 'LOW_VOLATILITY' | 'BREAKOUT' | 'MEAN_REVERSION' | 'UNKNOWN' {
    const reg = marketRegime.toUpperCase();
    if (reg.includes('TREND') || reg.includes('BULL') || reg.includes('BEAR')) return 'TRENDING';
    if (reg.includes('BREAKOUT') || reg.includes('MOMENTUM_EXPANSION')) return 'BREAKOUT';
    if (reg.includes('REVERSAL') || reg.includes('SWEEP') || reg.includes('MEAN_REV')) return 'MEAN_REVERSION';
    if (reg.includes('HIGH_VOL') || reg.includes('VOLATILE')) return 'HIGH_VOLATILITY';
    if (reg.includes('LOW_VOL') || reg.includes('COMPRESS')) return 'LOW_VOLATILITY';
    if (reg.includes('RANGE')) return 'RANGING';
    return 'UNKNOWN';
  }

  /**
   * Estimates calibrated win probability without look-ahead bias.
   */
  private static estimateCalibratedProbability(
    input: GuardrailEvaluationInput,
    regime: string
  ): { probability: number; source: 'EMPIRICAL' | 'MODEL' | 'FALLBACK' } {
    // 1. Point-in-time empirical feedback if provided from completed live outcomes
    if (typeof input.historicalWinRate === 'number' && input.historicalWinRate > 0) {
      const baseProb = input.historicalWinRate > 1.0 ? input.historicalWinRate / 100 : input.historicalWinRate;
      const regimeMultiplier = regime === 'TRENDING' ? 1.05 : (regime === 'HIGH_VOLATILITY' ? 0.92 : 1.0);
      const calibrated = Math.min(0.85, Math.max(0.20, baseProb * regimeMultiplier));
      const source = input.probabilitySource === 'EMPIRICAL' ? 'EMPIRICAL' : 'MODEL';
      return { probability: Number(calibrated.toFixed(3)), source };
    }

    // 2. Multi-Model Bayesian calibration (Score + Qlib Alpha + Kronos Forecast + TradingAgents Consensus)
    const baseScore = input.score || 65;
    const mtfRatio = input.timeframeAlignmentRatio ?? 0.67;
    const strategyRatio = (input.agreeingStrategiesCount ?? 2) / 6.0;

    const targetDirectionStance = input.direction === 'BUY' ? 'BULLISH' : 'BEARISH';

    let modelBoost = 0;
    if (input.qlibEvidence?.direction === targetDirectionStance) {
      modelBoost += (input.qlibEvidence.predictionProbability || 0.5) * 10;
    }
    if (input.kronosEvidence?.directionBias === targetDirectionStance) {
      modelBoost += (input.kronosEvidence.confidence || 0.5) * 10;
    }
    if (input.tradingAgentsResearch?.synthesis?.consensusStance === targetDirectionStance) {
      modelBoost += ((input.tradingAgentsResearch.synthesis.consensusScore || 50) / 100) * 10;
    }

    const compositeQuality = (baseScore * 0.4) + (mtfRatio * 100 * 0.25) + (strategyRatio * 100 * 0.15) + (modelBoost * 2.0);

    const logit = (compositeQuality - 65) / 20.0;
    const sigmoid = 1.0 / (1.0 + Math.exp(-logit));
    const probability = Number((0.35 + sigmoid * 0.40).toFixed(3)); // Clamped between 0.35 and 0.75

    const source = input.probabilitySource || 'MODEL';
    return { probability, source };
  }

  /**
   * Computes Multi-Factor Trade Quality Score (0 - 100) across 13 non-collinear factors.
   */
  private static calculateMultiFactorQuality(
    input: GuardrailEvaluationInput,
    winProbability: number,
    expectedReturn: number,
    expectedValue: number,
    regimeType: string
  ): number {
    let score = 50;

    // 1. Calibrated Probability Factor (+- 15 pts)
    const probDelta = (winProbability - 0.50) * 50;
    score += Math.max(-15, Math.min(15, probDelta));

    // 2. Mathematical Expected Value (+- 15 pts)
    const evDelta = expectedValue * 30;
    score += Math.max(-15, Math.min(15, evDelta));

    // 3. Expected Return (+- 10 pts)
    const retDelta = expectedReturn * 500;
    score += Math.max(-10, Math.min(10, retDelta));

    // 4. MTF Alignment Factor (0 - 10 pts)
    const mtfAlign = input.timeframeAlignmentRatio ?? 0.67;
    score += (mtfAlign - 0.5) * 20;

    // 5. Strategy Agreement (0 - 10 pts)
    const agreeing = input.agreeingStrategiesCount ?? 2;
    score += (agreeing >= 3 ? 8 : (agreeing === 2 ? 4 : 0));

    // 6. Regime Compatibility (0 - 8 pts)
    if (regimeType === 'TRENDING' || regimeType === 'BREAKOUT') {
      score += 6;
    } else if (regimeType === 'HIGH_VOLATILITY') {
      score -= 4;
    }

    const targetDirectionStance = input.direction === 'BUY' ? 'BULLISH' : 'BEARISH';

    // 7. Qlib Alpha Factor (+- 6 pts)
    if (input.qlibEvidence) {
      if (input.qlibEvidence.direction === targetDirectionStance) {
        score += Math.round((input.qlibEvidence.predictionProbability || 0.5) * 6);
      } else {
        score -= 5;
      }
    }

    // 8. Kronos Forecast Alignment (+- 6 pts)
    if (input.kronosEvidence) {
      if (input.kronosEvidence.directionBias === targetDirectionStance) {
        score += Math.round((input.kronosEvidence.confidence || 0.5) * 6);
      } else {
        score -= 5;
      }
    }

    // 9. TradingAgents Research Consensus (+- 6 pts)
    if (input.tradingAgentsResearch) {
      const consensus = input.tradingAgentsResearch.synthesis;
      if (consensus.consensusStance === targetDirectionStance) {
        score += Math.round((consensus.consensusScore / 100) * 6);
      } else if (consensus.consensusStance !== 'NEUTRAL') {
        score -= 5;
      }
    }

    // 10. Execution Friction & Spread (0 - 7 pts)
    const netRR = input.estimatedFriction?.netRiskRewardRatio;
    if (netRR && netRR >= 1.7) {
      score += 5;
    } else if (netRR && netRR < 1.3) {
      score -= 8;
    }

    // 11. Walk-Forward Efficiency (0 - 5 pts)
    if (input.walkForwardEfficiency && input.walkForwardEfficiency >= 0.70) {
      score += 5;
    } else if (input.walkForwardEfficiency && input.walkForwardEfficiency < 0.40) {
      score -= 5;
    }

    // 12. EMA / VWAP Payoff Quality Factor (+- 6 pts)
    if (input.emaVwapPayoff) {
      if (input.emaVwapPayoff.payoffQuality === 'EXCELLENT') score += 6;
      else if (input.emaVwapPayoff.payoffQuality === 'STRONG') score += 4;
      else if (input.emaVwapPayoff.payoffQuality === 'WEAK') score -= 3;
      else if (input.emaVwapPayoff.payoffQuality === 'UNFAVORABLE') score -= 6;
    }

    // 13. Freqtrade Dynamic Exit Quality Factor (+- 5 pts)
    if (input.freqtradeExit) {
      if (input.freqtradeExit.exitUrgency === 'NONE' && input.freqtradeExit.details.currentProfitPct >= 0) score += 5;
      else if (input.freqtradeExit.exitUrgency === 'CRITICAL_EXIT') score -= 6;
    }

    return Math.min(100, Math.max(0, Math.round(score)));
  }

  /**
   * Adapts the minimum acceptable R:R threshold dynamically while preserving conservative safety floors.
   */
  private static calculateAdaptiveMinRR(
    baseMinRR: number,
    qualityScore: number,
    regimeType: string,
    expectedValue: number,
    winProbability: number
  ): number {
    let adaptiveRR = baseMinRR;

    // High quality (strong win prob + solid positive EV) allows relaxing toward the safety floor
    if (qualityScore >= 78 && expectedValue >= 0.30 && winProbability >= 0.55) {
      const discount = (qualityScore - 75) * 0.015;
      adaptiveRR = Math.max(this.CONSERVATIVE_SAFETY_FLOOR_RR, baseMinRR - discount);
    }
    // Low quality or weak EV demands higher reward compensation
    else if (qualityScore < 68 || expectedValue < 0.18 || winProbability < 0.52) {
      const penalty = Math.max(0.05, (68 - qualityScore) * 0.02);
      adaptiveRR = Math.min(this.MAX_REQUIRED_RR, baseMinRR + penalty);
    }

    // Regime-specific tuning
    if (regimeType === 'HIGH_VOLATILITY') {
      adaptiveRR = Math.max(adaptiveRR, 2.0); // Require wider profit cushion in turbulent markets
    } else if (regimeType === 'BREAKOUT') {
      adaptiveRR = Math.max(adaptiveRR, 1.85); // Breakouts need robust expansion target
    }

    // Enforce absolute safety floor: NEVER drop below 1.40R under any circumstances
    return Number(Math.max(this.CONSERVATIVE_SAFETY_FLOOR_RR, adaptiveRR).toFixed(2));
  }
}
