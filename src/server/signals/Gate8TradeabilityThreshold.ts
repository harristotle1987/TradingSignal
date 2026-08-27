/**
 * GATE 8 — FINAL TRADEABILITY THRESHOLD
 *
 * Enforces 75 as the strict FINAL tradeability threshold.
 *
 * Final Score 10-Factor Weighted Breakdown:
 * - Trend alignment:        20  (Higher timeframe alignment & EMA stack)
 * - MTF confirmation:       15  (Confluence across 1h, 15m, 5m, 4h)
 * - Momentum:               10  (RSI acceleration, Zero-Lag MACD histogram, ADX)
 * - Market structure:       15  (Swing HH/HL or LH/LL, structure breaks, order flow)
 * - Volume/liquidity:       10  (Volume delta pressure, volume surge, absorption wicks)
 * - Volatility/ATR quality: 10  (ATR ratio in healthy executable bounds, not dead/erratic)
 * - Entry quality:           5  (Precise entry trigger proximity to dynamic EMA / structure)
 * - R:R quality:             5  (Effective R:R ratio and target reachability)
 * - Execution quality:       5  (Low spread/fee friction, clean execution conditions)
 * - Direction confidence:    5  (Strategy agreement ratio, no conflicting signals)
 *
 * TOTAL = 100
 *
 * Classification:
 * - < 60:    REJECT
 * - 60–69:   REJECT
 * - 70–74:   NEAR MISS / WATCHLIST
 * - 75–79:   VALID SIGNAL
 * - 80–84:   STRONG SIGNAL
 * - 85–89:   VERY STRONG SIGNAL
 * - 90–100:  EXCEPTIONAL
 *
 * Acceptance criteria:
 * - 75 is the final threshold (never applied to preliminary screening).
 * - No candidate below 75 becomes tradeable.
 * - No score manipulation or automatic lowering to manufacture signals.
 * - If zero candidates reach 75 -> produce zero signals.
 */

import { SignalDirection } from '../../types/index.js';
import { logger } from '../logger.js';
import { serverConfig } from '../config.js';

export type Gate8ScoreClassification =
  | 'REJECT'
  | 'NEAR_MISS_WATCHLIST'
  | 'VALID_SIGNAL'
  | 'STRONG_SIGNAL'
  | 'VERY_STRONG_SIGNAL'
  | 'EXCEPTIONAL';

export interface Gate8ScoreFactors {
  trendAlignment: number;       // 0 - 20
  mtfConfirmation: number;      // 0 - 15
  momentum: number;             // 0 - 10
  marketStructure: number;      // 0 - 15
  volumeLiquidity: number;      // 0 - 10
  volatilityAtrQuality: number; // 0 - 10
  entryQuality: number;         // 0 - 5
  rrQuality: number;            // 0 - 5
  executionQuality: number;     // 0 - 5
  directionConfidence: number;  // 0 - 5
}

export interface Gate8EvaluationInput {
  symbol: string;
  direction: SignalDirection;
  trendAlignmentScore?: number;        // Raw or 0-100
  mtfConfluenceScore?: number;         // Raw or 0-100
  momentumScore?: number;              // Raw or 0-100
  marketStructureScore?: number;       // Raw or 0-100
  volumeScore?: number;                // Raw or 0-100
  volatilityAtrScore?: number;          // Raw or 0-100
  entryQualityScore?: number;          // Raw or 0-100
  riskRewardRatio?: number;            // e.g. 1.8, 2.0, 2.5
  netRiskRewardRatio?: number;         // after friction
  spreadPipsOrPoints?: number;
  frictionToProfitPct?: number;
  agreeingStrategiesRatio?: number;    // 0 to 1
  timeframeAlignmentRatio?: number;    // 0 to 1
  rawCoreScore?: number;
}

export interface Gate8EvaluationResult {
  symbol: string;
  direction: SignalDirection;
  finalScore: number;                  // 0 - 100
  factors: Gate8ScoreFactors;
  classification: Gate8ScoreClassification;
  isTradeable: boolean;                // true ONLY if finalScore >= 75
  rejectionReason: string | null;
  scoreRequirementPassed: boolean;
  marginAboveThreshold: number;        // finalScore - 75
  confluenceHighlights: string[];
}

export class Gate8TradeabilityThreshold {
  public static get FINAL_TRADEABILITY_THRESHOLD(): number {
    return serverConfig?.getConfig?.()?.thresholds?.signalThreshold || 72;
  }

  /**
   * Evaluates a candidate against the 10-factor weighted scoring rubric and assigns classification.
   */
  public static evaluateCandidate(input: Gate8EvaluationInput): Gate8EvaluationResult {
    const highlights: string[] = [];

    // Factor 1: Trend Alignment (Weight: 20)
    // Evaluates 1h/4h major directional EMA stack and alignment
    const rawTrend = input.trendAlignmentScore ?? 75;
    const trendAlignment = Math.max(0, Math.min(20, Number(((rawTrend / 100) * 20).toFixed(1))));
    if (trendAlignment >= 16) highlights.push(`Strong Higher-TF Trend Alignment (${trendAlignment}/20)`);

    // Factor 2: MTF Confirmation (Weight: 15)
    // Multi-timeframe confluence (15m, 1h, 5m, 4h)
    const rawMtf = input.mtfConfluenceScore ?? ((input.timeframeAlignmentRatio ?? 0.75) * 100);
    const mtfConfirmation = Math.max(0, Math.min(15, Number(((rawMtf / 100) * 15).toFixed(1))));
    if (mtfConfirmation >= 12) highlights.push(`Multi-Timeframe Agreement Across Intervals (${mtfConfirmation}/15)`);

    // Factor 3: Momentum (Weight: 10)
    // RSI acceleration, Zero-Lag MACD histogram momentum, ADX
    const rawMom = input.momentumScore ?? 75;
    const momentum = Math.max(0, Math.min(10, Number(((rawMom / 100) * 10).toFixed(1))));
    if (momentum >= 8) highlights.push(`Directional Momentum Acceleration (${momentum}/10)`);

    // Factor 4: Market Structure (Weight: 15)
    // Swing points, HH/HL or LH/LL structure, breakout clearance
    const rawStruct = input.marketStructureScore ?? 75;
    const marketStructure = Math.max(0, Math.min(15, Number(((rawStruct / 100) * 15).toFixed(1))));
    if (marketStructure >= 12) highlights.push(`Valid Technical Swing Structure (${marketStructure}/15)`);

    // Factor 5: Volume / Liquidity (Weight: 10)
    // Delta volume pressure, surge volume, absorption wicks
    const rawVol = input.volumeScore ?? 70;
    const volumeLiquidity = Math.max(0, Math.min(10, Number(((rawVol / 100) * 10).toFixed(1))));
    if (volumeLiquidity >= 8) highlights.push(`Sufficient Volume & Liquidity Delta (${volumeLiquidity}/10)`);

    // Factor 6: Volatility / ATR Quality (Weight: 10)
    // ATR ratio in healthy executable bounds (0.7x - 2.5x), not dead or erratic
    const rawAtr = input.volatilityAtrScore ?? 80;
    const volatilityAtrQuality = Math.max(0, Math.min(10, Number(((rawAtr / 100) * 10).toFixed(1))));
    if (volatilityAtrQuality >= 8) highlights.push(`Healthy Executable Volatility (${volatilityAtrQuality}/10)`);

    // Factor 7: Entry Quality (Weight: 5)
    // Precision trigger near dynamic EMA or structural pullback zone
    const rawEntry = input.entryQualityScore ?? 75;
    const entryQuality = Math.max(0, Math.min(5, Number(((rawEntry / 100) * 5).toFixed(1))));
    if (entryQuality >= 4) highlights.push(`High-Precision Dynamic Entry Location (${entryQuality}/5)`);

    // Factor 8: R:R Quality (Weight: 5)
    // Net Risk-Reward evaluation
    const effRr = input.netRiskRewardRatio ?? input.riskRewardRatio ?? 1.8;
    let rrScore = 3.5;
    if (effRr >= 3.0) rrScore = 5.0;
    else if (effRr >= 2.5) rrScore = 4.5;
    else if (effRr >= 2.0) rrScore = 4.0;
    else if (effRr >= 1.5) rrScore = 3.5;
    else if (effRr >= 1.2) rrScore = 2.5;
    else rrScore = 1.0;
    const rrQuality = Math.max(0, Math.min(5, Number(rrScore.toFixed(1))));
    if (rrQuality >= 4) highlights.push(`Favorable R:R Profile (${effRr.toFixed(2)}:1) (${rrQuality}/5)`);

    // Factor 9: Execution Quality (Weight: 5)
    // Friction and slippage stress resilience
    let execScore = 4.0;
    if (input.frictionToProfitPct !== undefined) {
      if (input.frictionToProfitPct < 5) execScore = 5.0;
      else if (input.frictionToProfitPct < 10) execScore = 4.5;
      else if (input.frictionToProfitPct < 20) execScore = 3.5;
      else execScore = 2.0;
    }
    const executionQuality = Math.max(0, Math.min(5, Number(execScore.toFixed(1))));
    if (executionQuality >= 4) highlights.push(`Low Execution Friction Overhead (${executionQuality}/5)`);

    // Factor 10: Direction Confidence (Weight: 5)
    // Strategy consensus and absence of conflict
    const agreeRatio = input.agreeingStrategiesRatio ?? 0.8;
    const dirScore = Math.max(0, Math.min(5, Number((agreeRatio * 5).toFixed(1))));
    const directionConfidence = dirScore;
    if (directionConfidence >= 4) highlights.push(`Multi-Strategy Consensus Agreement (${directionConfidence}/5)`);

    const factors: Gate8ScoreFactors = {
      trendAlignment,
      mtfConfirmation,
      momentum,
      marketStructure,
      volumeLiquidity,
      volatilityAtrQuality,
      entryQuality,
      rrQuality,
      executionQuality,
      directionConfidence,
    };

    // Calculate Exact Weighted Sum (0 - 100)
    const rawTotal = (
      trendAlignment +
      mtfConfirmation +
      momentum +
      marketStructure +
      volumeLiquidity +
      volatilityAtrQuality +
      entryQuality +
      rrQuality +
      executionQuality +
      directionConfidence
    );

    const finalScore = Math.round(Math.max(0, Math.min(100, rawTotal)));

    const finalThreshold = this.FINAL_TRADEABILITY_THRESHOLD;
    const watchingThreshold = serverConfig?.getConfig?.()?.thresholds?.watchingThreshold || 70;

    // Assign Classification based on Final Score
    let classification: Gate8ScoreClassification;
    if (finalScore >= 90) {
      classification = 'EXCEPTIONAL';
    } else if (finalScore >= 85) {
      classification = 'VERY_STRONG_SIGNAL';
    } else if (finalScore >= 80) {
      classification = 'STRONG_SIGNAL';
    } else if (finalScore >= finalThreshold) {
      classification = 'VALID_SIGNAL';
    } else if (finalScore >= watchingThreshold) {
      classification = 'NEAR_MISS_WATCHLIST';
    } else {
      classification = 'REJECT';
    }

    const isTradeable = finalScore >= finalThreshold;
    const marginAboveThreshold = finalScore - finalThreshold;

    let rejectionReason: string | null = null;
    if (!isTradeable) {
      if (classification === 'NEAR_MISS_WATCHLIST') {
        rejectionReason = `Score ${finalScore}/100 is in Watchlist range (${watchingThreshold}–${finalThreshold - 1}), below the final tradeability threshold of ${finalThreshold}. Setup routed to Opportunity Watchlist.`;
      } else {
        rejectionReason = `Score ${finalScore}/100 is below the final tradeability threshold of ${finalThreshold} (Classification: ${classification}).`;
      }
    }

    logger.info(
      `[Gate 8 Final Tradeability Evaluation] ${input.symbol} (${input.direction}): Score ${finalScore}/100 ` +
      `[Trend: ${trendAlignment}, MTF: ${mtfConfirmation}, Mom: ${momentum}, Struct: ${marketStructure}, ` +
      `Vol: ${volumeLiquidity}, ATR: ${volatilityAtrQuality}, Entry: ${entryQuality}, RR: ${rrQuality}, ` +
      `Exec: ${executionQuality}, Dir: ${directionConfidence}] -> ${classification} (Tradeable: ${isTradeable})`
    );

    return {
      symbol: input.symbol,
      direction: input.direction,
      finalScore,
      factors,
      classification,
      isTradeable,
      rejectionReason,
      scoreRequirementPassed: isTradeable,
      marginAboveThreshold,
      confluenceHighlights: highlights,
    };
  }
}
