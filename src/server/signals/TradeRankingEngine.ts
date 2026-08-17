/**
 * Opportunity-Ranking & Trade Selection Engine (Gate 9)
 *
 * Evaluates all validated trade opportunities across Crypto, Forex, and Stocks.
 * Enforces:
 * 1. Quality scoring tiers:
 *    - 85+ = BEST TRADE
 *    - 75–84 = HIGH QUALITY
 *    - Below 75 = REJECT
 * 2. Minimum actionable score = 75.
 * 3. Historical win-rate > 30% AND positive mathematical expectancy (> 0).
 * 4. Setup quality dominance (large R:R alone cannot rank a poor setup highly).
 * 5. Correlation Risk Filter: Prevents highly correlated trades from occupying multiple TOP TRADE positions.
 * 6. Scarcity principle: Returns fewer (or 0) if genuine setups do not meet strict criteria.
 * 7. Snapshot preservation: Uses only the validated snapshot's entry, SL, TP, and timestamps.
 * 8. Never manufactures a trade: If nothing qualifies, returns empty set so caller outputs NO QUALIFIED TRADE.
 */

import { TradingSignal } from '../../types/index.js';
import { ScoringResult, ScoringEngine } from './ScoringEngine.js';
import { ValidationResult } from './SignalValidator.js';
import { logger } from '../logger.js';

export interface ValidatedCandidate {
  signal: TradingSignal;
  scoring: ScoringResult;
  validation: ValidationResult;
  aiConfidence: number;
  timeframesAligned: number;
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
  // Correlated risk clusters to prevent duplicate market exposure across all returned signals
  private static readonly CORRELATION_CLUSTERS: Record<string, string[]> = {
    CRYPTO_MAJORS: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT', 'PIUSDT'],
    FOREX_USD_EUROPE: ['EURUSD', 'GBPUSD', 'USDCHF', 'EURGBP'],
    FOREX_COMMODITY: ['AUDUSD', 'USDCAD', 'USDJPY', 'NZDUSD'],
    US_TECH_EQUITIES: ['AAPL', 'NVDA', 'MSFT', 'TSLA', 'AMZN', 'GOOGL', 'META'],
  };

  /**
   * Evaluates, ranks, and filters validated candidates into BEST TRADE, SECOND BEST, and SUGGESTIONS.
   * Ranks ONLY fully validated real setups meeting the strict >= 75 score hurdle.
   */
  static rankOpportunities(candidates: ValidatedCandidate[]): RankingResult {
    const rejectedCandidates: Array<{ symbol: string; reason: string }> = [];

    logger.info(`[Gate 9 Ranking] Evaluating ${candidates.length} validated candidates across selected universe...`);

    if (!candidates || candidates.length === 0) {
      return {
        suggestions: [],
        topTrades: [],
        allRanked: [],
        rejectedCandidates: [],
      };
    }

    // 1. Calculate Composite Ranking Score for each candidate
    const scoredCandidates = candidates.map((cand) => {
      const compositeScore = this.computeCompositeScore(cand);
      return {
        ...cand,
        compositeScore,
      };
    });

    // 2. Filter out any candidate below minimum actionable quality score (75), minimum win-rate (>30%), or non-positive expectancy
    const validCandidates: Array<ValidatedCandidate & { compositeScore: number }> = [];
    for (const cand of scoredCandidates) {
      const winRate = cand.signal.estimatedWinRate ?? cand.scoring.estimatedWinRate ?? 0;
      const rr = cand.signal.riskRewardRatio ?? cand.scoring.riskRewardRatio ?? 0;
      const score = Math.round(cand.compositeScore);

      // Minimum actionable score hurdle is strictly 75
      if (score < 75 || cand.scoring.score < 75) {
        rejectedCandidates.push({
          symbol: cand.signal.symbol,
          reason: `Quality score (${score}/100) below minimum actionable threshold of 75 (85+ = BEST TRADE, 75-84 = HIGH QUALITY)`,
        });
        continue;
      }

      // Minimum historical win rate > 30%
      if (winRate <= 30) {
        rejectedCandidates.push({
          symbol: cand.signal.symbol,
          reason: `Estimated win-rate (${winRate}%) is at or below strict minimum 30% hurdle`,
        });
        continue;
      }

      // Minimum R:R ratio >= 2.0:1
      if (rr < 2.0) {
        rejectedCandidates.push({
          symbol: cand.signal.symbol,
          reason: `Risk/Reward ratio (${rr}:1) is below strict 2.0:1 minimum requirement`,
        });
        continue;
      }

      // Positive mathematical historical expectancy requirement
      const expectancy = ScoringEngine.calculateExpectancy(winRate, rr);
      if (expectancy <= 0) {
        rejectedCandidates.push({
          symbol: cand.signal.symbol,
          reason: `Historical expectancy (${expectancy}R) is non-positive. Trade discarded.`,
        });
        continue;
      }

      validCandidates.push(cand);
    }

    // 3. Sort validated candidates descending by composite score (highest quality first)
    validCandidates.sort((a, b) => b.compositeScore - a.compositeScore);

    if (validCandidates.length === 0) {
      logger.info(`[Gate 9 Ranking] No candidates passed quality threshold (score >= 75, win-rate > 30%, R:R >= 2.0:1, positive expectancy). Returning empty result.`);
      return {
        suggestions: [],
        topTrades: [],
        allRanked: [],
        rejectedCandidates,
      };
    }

    let bestTrade: TradingSignal | undefined = undefined;
    let secondBest: TradingSignal | undefined = undefined;
    const suggestions: TradingSignal[] = [];
    const occupiedClusters = new Set<string>();

    const remainingPool: Array<ValidatedCandidate & { compositeScore: number }> = [...validCandidates];

    // Step A: Assign BEST TRADE (score >= 85 preferred, otherwise top high-quality candidate >= 75)
    const topCandidate = remainingPool[0];
    const topSymbol = topCandidate.signal.symbol.toUpperCase();
    const topCluster = this.getAssetCluster(topSymbol);
    const sig1 = topCandidate.signal;

    const isBestTradeScore = topCandidate.compositeScore >= 85;
    sig1.rankTier = 'BEST_TRADE';
    sig1.isBestTrade = true;
    sig1.isTopTrade = true;
    sig1.isPrimary = true;
    sig1.score = Math.round(topCandidate.compositeScore);
    sig1.strategy = isBestTradeScore
      ? '[BEST TRADE] Primary High-Confluence Setup (Score 85+)'
      : '[HIGH QUALITY] Primary Setup (Score 75-84)';
    bestTrade = sig1;

    if (topCluster) {
      occupiedClusters.add(`${topCluster}_${sig1.direction}`);
    }
    logger.info(`[Gate 9 Ranking] BEST TRADE #1 assigned: ${topSymbol} (${sig1.direction} @ ${sig1.entryPrice}, Score: ${sig1.score}, WinRate: ${sig1.estimatedWinRate}%, R:R: ${sig1.riskRewardRatio}:1, Expectancy: +${topCandidate.scoring.expectancy}R)`);
    remainingPool.shift(); // Remove top candidate from remaining pool

    // Step B: Assign SECOND BEST (next highest candidate, strictly non-correlated asset/exposure)
    let secondBestIndex = -1;

    for (let i = 0; i < remainingPool.length; i++) {
      const cand = remainingPool[i];
      const sym = cand.signal.symbol.toUpperCase();
      const cluster = this.getAssetCluster(sym);
      const hasConflict = cluster && occupiedClusters.has(`${cluster}_${cand.signal.direction}`);

      if (!hasConflict) {
        secondBestIndex = i;
        break;
      }
    }

    if (secondBestIndex !== -1) {
      const cand2 = remainingPool[secondBestIndex];
      const sym2 = cand2.signal.symbol.toUpperCase();
      const cluster2 = this.getAssetCluster(sym2);

      const sig2 = cand2.signal;
      sig2.rankTier = 'SECOND_BEST';
      sig2.isSecondBest = true;
      sig2.isBestTrade = false;
      sig2.isTopTrade = true;
      sig2.isPrimary = false;
      sig2.isSuggestion = false;
      sig2.score = Math.round(cand2.compositeScore);
      sig2.strategy = sig2.score >= 85
        ? '[BEST TRADE] Secondary High-Confluence Setup (Score 85+)'
        : '[HIGH QUALITY] Secondary Setup (Score 75-84)';

      secondBest = sig2;
      if (cluster2) {
        occupiedClusters.add(`${cluster2}_${sig2.direction}`);
      }
      logger.info(`[Gate 9 Ranking] BEST TRADE #2 (Second Best) assigned: ${sym2} (${sig2.direction} @ ${sig2.entryPrice}, Score: ${sig2.score}, WinRate: ${sig2.estimatedWinRate}%, R:R: ${sig2.riskRewardRatio}:1)`);

      remainingPool.splice(secondBestIndex, 1);
    } else if (remainingPool.length > 0) {
      logger.info(`[Gate 9 Ranking] All remaining candidates conflict with occupied cluster (${[...occupiedClusters].join(', ')}). No SECOND BEST assigned to avoid duplicate market exposure.`);
    }

    // Step C: Assign up to 3 SUGGESTIONS from remaining pool (strictly non-correlated)
    for (const cand of remainingPool) {
      const sym = cand.signal.symbol.toUpperCase();
      const cluster = this.getAssetCluster(sym);
      const hasConflict = cluster && occupiedClusters.has(`${cluster}_${cand.signal.direction}`);

      if (hasConflict) {
        rejectedCandidates.push({
          symbol: cand.signal.symbol,
          reason: `Correlated exposure filter: ${cluster} (${cand.signal.direction}) exposure already fulfilled by higher-ranked candidate. Keeping strongest setup only.`,
        });
        continue;
      }

      if (suggestions.length < 3) {
        const sig = cand.signal;
        sig.rankTier = 'SUGGESTION';
        sig.isSuggestion = true;
        sig.isTopTrade = false;
        sig.isBestTrade = false;
        sig.isSecondBest = false;
        sig.isPrimary = false;
        sig.score = Math.round(cand.compositeScore);
        sig.strategy = '[HIGH QUALITY SUGGESTION] Validated Secondary Setup';

        suggestions.push(sig);
        if (cluster) {
          occupiedClusters.add(`${cluster}_${sig.direction}`);
        }
        logger.info(`[Gate 9 Ranking] SUGGESTION assigned: ${sig.symbol} (${sig.direction} @ ${sig.entryPrice}, Score: ${sig.score})`);
      } else {
        rejectedCandidates.push({
          symbol: cand.signal.symbol,
          reason: 'Maximum signals capacity (5 total: 2 Best Trades + 3 Suggestions) reached for this scan cycle.',
        });
      }
    }

    const topTrades = [bestTrade, secondBest].filter((s): s is TradingSignal => Boolean(s));
    const allRanked = [bestTrade, secondBest, ...suggestions].filter((s): s is TradingSignal => Boolean(s));

    logger.info(`================================================================`);
    logger.info(`[GATE 9 SUMMARY] BEST TRADE: ${bestTrade?.symbol || 'NONE'} | SECOND BEST: ${secondBest?.symbol || 'NONE'} | Suggestions: ${suggestions.length}`);
    logger.info(`================================================================`);

    return {
      bestTrade,
      secondBest,
      suggestions,
      topTrades,
      allRanked,
      rejectedCandidates,
    };
  }

  /**
   * Calculates deterministic composite score using the validated 0–100 rubric:
   * Higher-TF trend: 20
   * Market structure: 15
   * Momentum: 15
   * Volume / order flow: 15
   * Support / resistance: 10
   * Volatility / ATR: 10
   * Entry quality: 10
   * News / sentiment: 5
   */
  private static computeCompositeScore(candidate: ValidatedCandidate): number {
    const { scoring, aiConfidence } = candidate;
    const f = scoring.factors;

    // Direct score from the 0-100 rubric in ScoringEngine
    const baseScore = f.totalScore || scoring.score;

    // AI confirmation adjustment (+/- 3 points max, normalized to maintain strict 0-100 ceiling)
    const aiAdjustment = ((aiConfidence - 70) / 30) * 3;

    const finalScore = Math.min(100, Math.max(0, baseScore + aiAdjustment));
    return Number(finalScore.toFixed(1));
  }

  /**
   * Resolves the risk correlation cluster for a symbol.
   */
  private static getAssetCluster(symbol: string): string | null {
    for (const [clusterName, symbols] of Object.entries(this.CORRELATION_CLUSTERS)) {
      if (symbols.includes(symbol)) {
        return clusterName;
      }
    }
    return null;
  }
}
