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
   * Evaluates, ranks, and filters validated candidates based on the centralized scoring policy.
   */
  static rankOpportunities(candidates: ValidatedCandidate[]): RankingResult {
    const rejectedCandidates: Array<{ symbol: string; reason: string }> = [];
    const thresholds = serverConfig.getConfig().thresholds;

    // 1. Calculate Composite Score
    const scoredCandidates = candidates.map((cand) => ({
      ...cand,
      compositeScore: this.computeCompositeScore(cand),
    }));

    // 2. Classify and Filter
    const validCandidates: Array<ValidatedCandidate & { compositeScore: number; rankTier: RankTier }> = [];
    
    for (const cand of scoredCandidates) {
      const score = Math.round(cand.compositeScore);
      
      // GATE 65: Resolve centralized final tradeability evaluation
      const tradeability = this.calculateFinalRequiredScore({
        symbol: cand.signal.symbol,
        actualScore: score,
        regime: cand.signal.marketRegime || cand.scoring.marketRegime,
        strategy: cand.signal.strategy,
        assetClass: cand.signal.assetClass,
        signalThreshold: thresholds.signalThreshold,
      });

      if (!tradeability.isExecutable || !tradeability.passed) {
        rejectedCandidates.push({
          symbol: cand.signal.symbol,
          reason: tradeability.rejectionReason || `REJECTED: SCORE_BELOW_FINAL_THRESHOLD. Score ${score} < ${tradeability.finalRequiredScore}.`,
        });
        continue;
      }
      
      validCandidates.push({ ...cand, compositeScore: score, rankTier: 'SUGGESTION' });
    }

    // Sort by composite score descending (highest first)
    validCandidates.sort((a, b) => b.compositeScore - a.compositeScore);
    
    // Assign rank tiers based on rank order (Rank 1: BEST_TRADE, Rank 2: SECOND_BEST, Rank 3+: SUGGESTION)
    validCandidates.forEach((cand, idx) => {
      if (idx === 0) {
        cand.rankTier = 'BEST_TRADE';
        cand.signal.rankTier = 'BEST_TRADE';
        cand.signal.isBestTrade = true;
        cand.signal.isSecondBest = false;
        cand.signal.isTopTrade = true;
      } else if (idx === 1) {
        cand.rankTier = 'SECOND_BEST';
        cand.signal.rankTier = 'SECOND_BEST';
        cand.signal.isBestTrade = false;
        cand.signal.isSecondBest = true;
        cand.signal.isTopTrade = true;
      } else {
        cand.rankTier = 'SUGGESTION';
        cand.signal.rankTier = 'SUGGESTION';
        cand.signal.isBestTrade = false;
        cand.signal.isSecondBest = false;
        cand.signal.isTopTrade = false;
      }
    });

    // 3. Organization Logic (assigning top trades/suggestions)
    return this.organizeRankedCandidates(validCandidates, rejectedCandidates);
  }

  private static organizeRankedCandidates(
    validCandidates: Array<ValidatedCandidate & { compositeScore: number; rankTier: RankTier }>,
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

  private static computeCompositeScore(candidate: ValidatedCandidate): number {
    const { scoring, aiConfidence, signal } = candidate;
    const baseScore = scoring.factors?.totalScore || scoring.score;
    const aiAdjustment = (typeof aiConfidence === 'number' && !isNaN(aiConfidence))
      ? ((aiConfidence - 70) / 30) * 3
      : 0;
    const rsScore = signal.relativeStrengthScore ?? 50;
    const rsAdjustment = ((rsScore - 50) / 50) * 2; // Subtle ±2 confidence modifier based on universe leadership
    const corrPenalty = signal.correlationPenalty ?? 0;
    return Math.min(100, Math.max(0, baseScore + aiAdjustment + rsAdjustment - corrPenalty));
  }

  public static getAssetCluster(symbol: string): string | null {
    for (const [clusterName, symbols] of Object.entries(this.CORRELATION_CLUSTERS)) {
      if (symbols.includes(symbol)) return clusterName;
    }
    return null;
  }
}
