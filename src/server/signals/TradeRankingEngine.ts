/**
 * Opportunity-Ranking & Trade Selection Engine (Final)
 *
 * Evaluates all validated trade opportunities across Crypto, Forex, and Stocks.
 * Ranks qualified candidates and assigns rank tiers based on ranking order:
 * Rank 1: BEST_TRADE (Top Opportunity)
 * Rank 2: SECOND_BEST
 * Rank 3+: SUGGESTIONS
 */

import { TradingSignal, RankTier, NormalizedCandle } from '../../types/index.js';
import { ScoringResult, ScoringEngine } from './ScoringEngine.js';
import { ValidationResult } from './SignalValidator.js';
import { Gate27RegimeThresholds } from './Gate27RegimeThresholds.js';
import { serverConfig } from '../config.js';
import { logger } from '../logger.js';

export interface ValidatedCandidate {
  signal: TradingSignal;
  scoring: ScoringResult;
  validation: ValidationResult;
  aiConfidence?: number;
  timeframesAligned: number;
  candles?: NormalizedCandle[];
}

export interface RankingResult {
  bestTrade?: TradingSignal;
  secondBest?: TradingSignal;
  suggestions: TradingSignal[];
  topTrades: TradingSignal[];
  allRanked: TradingSignal[];
  rejectedCandidates: Array<{ symbol: string; reason: string }>;
}

export class TradeRankingEngine {
  public static readonly CORRELATION_CLUSTERS: Record<string, string[]> = {
    CRYPTO_MAJORS: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT', 'PIUSDT'],
    FOREX_USD_EUROPE: ['EURUSD', 'GBPUSD', 'USDCHF', 'EURGBP'],
    FOREX_COMMODITY: ['AUDUSD', 'USDCAD', 'USDJPY', 'NZDUSD'],
    US_TECH_EQUITIES: ['AAPL', 'NVDA', 'MSFT', 'TSLA', 'AMZN', 'GOOGL', 'META'],
  };

  /**
   * Calculates the centralized final required score for tradeability.
   * finalRequiredScore = Math.max(thresholds.signalThreshold, regimeAdaptiveThreshold)
   * Gate 27 can make the system MORE selective, but NEVER less selective than signalThreshold.
   */
  public static calculateFinalRequiredScore(params: {
    symbol: string;
    actualScore: number;
    regime?: string;
    strategy?: string;
    assetClass?: string;
    signalThreshold?: number;
  }): {
    isExecutable: boolean;
    finalRequiredScore: number;
    regimeAdaptiveThreshold: number;
    signalThreshold: number;
    actualScore: number;
    passed: boolean;
    marginAboveFinalThreshold: number;
    rejectionReason?: string;
  } {
    const thresholds = serverConfig.getConfig().thresholds;
    const globalSignalFloor = params.signalThreshold ?? thresholds.signalThreshold;

    const adaptiveRes = Gate27RegimeThresholds.resolveThreshold({
      symbol: params.symbol,
      actualScore: params.actualScore,
      regime: params.regime,
      strategy: params.strategy,
      assetClass: params.assetClass,
    });

    if (!adaptiveRes.isExecutable) {
      return {
        isExecutable: false,
        finalRequiredScore: 999,
        regimeAdaptiveThreshold: 999,
        signalThreshold: globalSignalFloor,
        actualScore: params.actualScore,
        passed: false,
        marginAboveFinalThreshold: params.actualScore - 999,
        rejectionReason: `REJECTED: REGIME_UNTRADEABLE. Market regime '${params.regime || 'UNKNOWN'}' is classified as UNKNOWN / NO SIGNAL under Gate 27 policy.`,
      };
    }

    const regimeAdaptiveThreshold = adaptiveRes.resolvedThreshold;
    const finalRequiredScore = Math.max(globalSignalFloor, regimeAdaptiveThreshold);
    const passed = params.actualScore >= finalRequiredScore;
    const marginAboveFinalThreshold = Math.round((params.actualScore - finalRequiredScore) * 10) / 10;

    let rejectionReason: string | undefined;
    if (!passed) {
      if (params.actualScore < globalSignalFloor && globalSignalFloor >= regimeAdaptiveThreshold) {
        rejectionReason = `REJECTED: SCORE_BELOW_GLOBAL_THRESHOLD. Quality score (${params.actualScore}/100) below global signal floor (${globalSignalFloor}) (regime adaptive threshold: ${regimeAdaptiveThreshold}).`;
      } else {
        rejectionReason = `REJECTED: SCORE_BELOW_REGIME_THRESHOLD. Quality score (${params.actualScore}/100) below final required score (${finalRequiredScore}) for regime '${adaptiveRes.normalizedRegime}' & strategy '${params.strategy}' (margin: ${marginAboveFinalThreshold >= 0 ? '+' : ''}${marginAboveFinalThreshold}).`;
      }
    }

    return {
      isExecutable: true,
      finalRequiredScore,
      regimeAdaptiveThreshold,
      signalThreshold: globalSignalFloor,
      actualScore: params.actualScore,
      passed,
      marginAboveFinalThreshold,
      rejectionReason,
    };
  }

  /**
   * Evaluates, ranks, and filters validated candidates.
   * GATE 83: TradeRankingEngine does NOT decide basic tradeability or rescue failed setups.
   * It receives already-valid core candidates and ranks them across multi-dimensional criteria.
   */
  static rankOpportunities(candidates: ValidatedCandidate[]): RankingResult {
    const rejectedCandidates: Array<{ symbol: string; reason: string }> = [];
    const thresholds = serverConfig.getConfig().thresholds;

    // 1. Calculate Core and Ranking Score (GATE 82 / GATE 83)
    const scoredCandidates = candidates.map((cand) => {
      const coreScore = cand.scoring.coreScore ?? cand.scoring.score;
      return {
        ...cand,
        coreScore,
        rankingScore: this.computeRankingScore(cand, coreScore),
      };
    });

    // 2. Classify and Filter based strictly on core tradeability
    // Ranking may NEVER convert an invalid or below-threshold core candidate into TRADEABLE.
    const validCandidates: Array<ValidatedCandidate & { coreScore: number; rankingScore: number; rankTier: RankTier }> = [];
        
    for (const cand of scoredCandidates) {
      // Validate core validity from upstream scoring and validation
      if (cand.scoring.isValid === false) {
        rejectedCandidates.push({
          symbol: cand.signal.symbol,
          reason: cand.signal.rejectionReason || 'REJECTED: SCORING_INVALID. Candidate failed core scoring validity checks.',
        });
        continue;
      }

      if (cand.validation && cand.validation.isValid === false) {
        rejectedCandidates.push({
          symbol: cand.signal.symbol,
          reason: cand.validation.detailedMessage || 'REJECTED: VALIDATION_INVALID. Candidate failed live tick/spread validation.',
        });
        continue;
      }

      // Resolve centralized final tradeability evaluation using strictly the CORE SCORE
      const tradeability = this.calculateFinalRequiredScore({
        symbol: cand.signal.symbol,
        actualScore: cand.coreScore,
        regime: cand.signal.marketRegime || cand.scoring.marketRegime,
        strategy: cand.signal.strategy,
        assetClass: cand.signal.assetClass,
        signalThreshold: thresholds.signalThreshold,
      });

      if (!tradeability.isExecutable || !tradeability.passed) {
        rejectedCandidates.push({
          symbol: cand.signal.symbol,
          reason: tradeability.rejectionReason || `REJECTED: SCORE_BELOW_FINAL_THRESHOLD. Core Score ${cand.coreScore} < ${tradeability.finalRequiredScore}.`,
        });
        continue;
      }
      
      // Attach the ranking score and core score to the signal
      cand.signal.rankingScore = cand.rankingScore;
      cand.signal.coreScore = cand.coreScore;
      cand.signal.score = cand.coreScore; // Keep score matching coreScore for deterministic purity

      validCandidates.push({ ...cand, rankTier: 'SUGGESTION' });
    }

    // Sort by rankingScore descending (highest first)
    validCandidates.sort((a, b) => b.rankingScore - a.rankingScore);
        
    // Assign rank tiers and quality tiers based on rank order and score quality (Gate 12 & Gate 13)
    // Quality Tiers:
    // 🔥 BEST: Top ranked candidate with high confluence
    // 🟢 HIGH QUALITY: Score >= 80 or rank 2
    // 🟡 VALID: Score >= signalThreshold
    // 👀 WATCHING: Candidate in watching range (never published as tradeable)
    validCandidates.forEach((cand, idx) => {
      const scoreVal = cand.coreScore;
      if (idx === 0) {
        cand.rankTier = 'BEST_TRADE';
        cand.signal.rankTier = 'BEST_TRADE';
        cand.signal.qualityTier = 'BEST';
        cand.signal.qualityTierLabel = '🔥 BEST';
        cand.signal.isBestTrade = true;
        cand.signal.isSecondBest = false;
        cand.signal.isTopTrade = true;
      } else if (idx === 1) {
        cand.rankTier = 'SECOND_BEST';
        cand.signal.rankTier = 'SECOND_BEST';
        cand.signal.qualityTier = 'HIGH_QUALITY';
        cand.signal.qualityTierLabel = '🟢 HIGH QUALITY';
        cand.signal.isBestTrade = false;
        cand.signal.isSecondBest = true;
        cand.signal.isTopTrade = true;
      } else {
        const isHighQuality = scoreVal >= 80;
        cand.rankTier = 'SUGGESTION';
        cand.signal.rankTier = 'SUGGESTION';
        cand.signal.qualityTier = isHighQuality ? 'HIGH_QUALITY' : 'VALID';
        cand.signal.qualityTierLabel = isHighQuality ? '🟢 HIGH QUALITY' : '🟡 VALID';
        cand.signal.isBestTrade = false;
        cand.signal.isSecondBest = false;
        cand.signal.isTopTrade = false;
      }
    });

    // 3. Organization Logic (assigning top trades/suggestions)
    return this.organizeRankedCandidates(validCandidates, rejectedCandidates);
  }

  private static organizeRankedCandidates(
    validCandidates: Array<ValidatedCandidate & { coreScore: number; rankingScore: number; rankTier: RankTier }>,
    rejectedCandidates: Array<{ symbol: string; reason: string }>
  ): RankingResult {
    const topTrades = validCandidates.slice(0, 2).map((c) => c.signal);
    const suggestions = validCandidates.slice(2, 5).map((c) => c.signal);
        
    return {
      bestTrade: topTrades[0],
      secondBest: topTrades[1],
      suggestions,
      topTrades,
      allRanked: [...topTrades, ...suggestions],
      rejectedCandidates,
    };
  }

  /**
   * GATE 83: Multi-dimensional ranking score calculation
   * Ranks candidates using:
   * 1. Relative Strength
   * 2. Strategy Quality
   * 3. AI Assessment
   * 4. Correlation Preference
   * 5. Liquidity Quality
   * 6. Divergence
   * 7. Breakout / Pullback Quality
   * 8. Historical Probability
   * 9. Cached Walk-Forward Results
   * 10. Cached Monte Carlo Results
   * 11. Execution Quality
   */
  private static computeRankingScore(candidate: ValidatedCandidate, coreScore: number): number {
    const { signal, scoring, validation, aiConfidence } = candidate;
    let modifier = 0;

    // 1. Relative Strength (universe leadership)
    const rsScore = signal.relativeStrengthScore ?? 50;
    modifier += ((rsScore - 50) / 50) * 3; // -3 to +3 modifier

    // 2. Strategy Quality (compatibility, match, agreement)
    if (signal.regimeStrategyMatch === 'OPTIMAL') modifier += 2;
    else if (signal.regimeStrategyMatch === 'COMPATIBLE') modifier += 1;
    else if (signal.regimeStrategyMatch === 'SUBOPTIMAL') modifier -= 2;
    else if (signal.regimeStrategyMatch === 'INCOMPATIBLE') modifier -= 4;

    const stratCompat = signal.strategyCompatibilityScore;
    if (typeof stratCompat === 'number') {
      modifier += ((stratCompat - 75) / 25) * 1.5;
    }

    const agreeRatio = (scoring.agreeingStrategiesCount && scoring.totalStrategiesCount)
      ? scoring.agreeingStrategiesCount / scoring.totalStrategiesCount
      : undefined;
    if (agreeRatio !== undefined && agreeRatio >= 0.6) {
      modifier += (agreeRatio - 0.5) * 2;
    }

    // 3. AI Assessment & Confidence
    if (typeof aiConfidence === 'number' && !isNaN(aiConfidence)) {
      modifier += ((aiConfidence - 70) / 30) * 3; // -3 to +3 modifier
    }
    if (signal.isAiValidated === false) {
      modifier -= 5; // Soft penalty for non-recommended AI candidate under GATE 80 policy
    }

    // 4. Correlation Preference (portfolio clustering penalty)
    const corrPenalty = signal.correlationPenalty ?? 0;
    modifier -= corrPenalty;

    // 5. Liquidity Quality (volume order flow & support/resistance clarity)
    const volScore = scoring.factors?.volumeOrderFlowScore ?? 10;
    const srScore = scoring.factors?.supportResistanceScore ?? 10;
    modifier += ((volScore + srScore - 20) / 20) * 2;

    // 6. Divergence (momentum divergence confirmation)
    const hasConfirmedDivergence = signal.confluenceReasons?.some(r => r.toLowerCase().includes('divergence')) ||
      (scoring.factors && 'divergenceScore' in scoring.factors && ((scoring.factors as any).divergenceScore ?? 0) > 0);
    if (hasConfirmedDivergence) {
      modifier += 1.5;
    }

    // 7. Breakout / Pullback Quality (retest confirmation & clean entry trigger)
    const entryScore = scoring.factors?.entryQualityScore ?? 10;
    const hasQualityRetest = signal.confluenceReasons?.some(r => r.toLowerCase().includes('retest') || r.toLowerCase().includes('pullback'));
    modifier += ((entryScore - 10) / 10) * 2;
    if (hasQualityRetest) modifier += 1;

    // 8. Historical Probability & Calibration (Gate 86)
    if (signal.isEmpiricallyCalibrated && typeof signal.empiricalProbability === 'number') {
      modifier += ((signal.empiricalProbability - 60) / 20) * 2;
    } else if (typeof signal.modelEstimatedWinRate === 'number') {
      modifier += ((signal.modelEstimatedWinRate - 60) / 20) * 1;
    } else if (typeof scoring.estimatedWinRate === 'number') {
      modifier += ((scoring.estimatedWinRate - 60) / 20) * 1;
    }

    // 9. Cached Walk-Forward Results
    if (signal.walkForwardEfficiency !== null && signal.walkForwardEfficiency !== undefined) {
      if (signal.walkForwardEfficiency >= 70 && !signal.overfitRiskDetected) {
        modifier += 2;
      } else if (signal.overfitRiskDetected || signal.walkForwardStatus === 'HIGH_OVERFIT_RISK') {
        modifier -= 3;
      }
    }

    // 10. Cached Monte Carlo Results
    if (signal.monteCarloSimulationStatus === 'ROBUST_STABLE') {
      modifier += 1.5;
    } else if (signal.monteCarloSimulationStatus === 'HIGH_RUIN_RISK' || signal.monteCarloSimulationStatus === 'ELEVATED_DRAWDOWN_RISK') {
      modifier -= 3;
    }

    // 11. Execution Quality & Progressive R:R (Gate 9)
    // Keep 1.8R hard minimum; progressively reward 2.0R, 2.5R, 3R+ setups
    const effRR = scoring.estimatedFriction?.netRiskRewardRatio ?? signal.netRiskRewardRatio ?? signal.riskRewardRatio;
    if (typeof effRR === 'number') {
      if (effRR >= 3.0) modifier += 3.0;
      else if (effRR >= 2.5) modifier += 2.0;
      else if (effRR >= 2.0) modifier += 1.0;
      else if (effRR < 1.8) modifier -= 2.0;
    }

    // 12. Mathematical Expectancy Optimization (Gate 10)
    // Make positive expectancy a quality/ranking factor; negative expectancy is rejected upstream
    const expectancyVal = scoring.expectancy ?? signal.expectancy ?? 0;
    if (expectancyVal >= 1.0) modifier += 2.5;
    else if (expectancyVal >= 0.5) modifier += 1.5;
    else if (expectancyVal > 0.1) modifier += 0.8;

    const spreadPoints = scoring.estimatedFriction?.spreadPipsOrPoints;
    if (typeof spreadPoints === 'number' && spreadPoints > 3.0) {
      modifier -= 1;
    }

    // Composite ranking score
    return Math.min(100, Math.max(0, Math.round((coreScore + modifier) * 10) / 10));
  }

  public static getAssetCluster(symbol: string): string | null {
    for (const [clusterName, symbols] of Object.entries(this.CORRELATION_CLUSTERS)) {
      if (symbols.includes(symbol)) return clusterName;
    }
    return null;
  }
}
