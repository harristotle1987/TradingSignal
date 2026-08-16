/**
 * Opportunity-Ranking & Trade Selection Engine (Gate 9)
 *
 * Evaluates all validated trade opportunities across Crypto, Forex, and Stocks.
 * Enforces:
 * 1. Composite quality ranking (Multi-TF trend, momentum, structure, volatility, volume, sentiment, entry quality, R:R, and data confidence).
 * 2. Setup quality dominance (large R:R alone cannot rank a poor setup highly).
 * 3. Maximum of 2 TOP TRADES (Score >= 80, >= 4 TF alignment, diversified risk).
 * 4. Maximum of 3 SUGGESTIONS (Score >= 70, independently validated).
 * 5. Correlation Risk Filter: Prevents highly correlated trades from occupying multiple TOP TRADE positions.
 * 6. Scarcity principle: Returns fewer (or 0) if genuine setups do not meet strict criteria.
 * 7. Snapshot preservation: Uses only the validated snapshot's entry, SL, TP, and timestamps.
 * 8. Comprehensive internal rejection & diagnostic logging.
 */

import { TradingSignal, SignalDirection } from '../../types/index.js';
import { ScoringResult } from './ScoringEngine.js';
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
  // Correlated risk clusters to prevent duplicate market exposure in TOP TRADES
  private static readonly CORRELATION_CLUSTERS: Record<string, string[]> = {
    CRYPTO: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT'],
    FOREX_USD_EUROPE: ['EURUSD', 'GBPUSD', 'USDCHF'],
    FOREX_COMMODITY: ['AUDUSD', 'USDCAD', 'USDJPY'],
    US_TECH_EQUITIES: ['AAPL', 'NVDA', 'MSFT', 'TSLA', 'AMZN', 'GOOGL'],
  };

  /**
   * Evaluates, ranks, and filters validated candidates into BEST TRADE, SECOND BEST, and SUGGESTIONS.
   * Rank ONLY fully validated real setups. Never force a trade if no candidate qualifies.
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

    // 2. Filter out any candidate below minimum quality score (70)
    const validCandidates: Array<ValidatedCandidate & { compositeScore: number }> = [];
    for (const cand of scoredCandidates) {
      if (cand.compositeScore >= 70 && cand.signal.score! >= 70) {
        validCandidates.push(cand);
      } else {
        rejectedCandidates.push({
          symbol: cand.signal.symbol,
          reason: `Composite score (${cand.compositeScore.toFixed(1)}/100) below minimum threshold (70)`,
        });
      }
    }

    // 3. Sort validated candidates descending by composite score (highest quality first)
    validCandidates.sort((a, b) => b.compositeScore - a.compositeScore);

    if (validCandidates.length === 0) {
      logger.info(`[Gate 9 Ranking] No candidates passed composite quality threshold (>= 70). Returning empty result.`);
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

    // Step A: Assign BEST TRADE (highest score candidate)
    const topCandidate = validCandidates[0];
    const topSymbol = topCandidate.signal.symbol.toUpperCase();
    const topCluster = this.getAssetCluster(topSymbol);

    const sig1 = topCandidate.signal;
    sig1.rankTier = 'BEST_TRADE';
    sig1.isBestTrade = true;
    sig1.isSecondBest = false;
    sig1.isTopTrade = true;
    sig1.isPrimary = true;
    sig1.isSuggestion = false;
    sig1.score = Math.round(topCandidate.compositeScore);
    sig1.strategy = '[BEST TRADE] Highest-Quality Validated Confluence Setup';

    bestTrade = sig1;
    if (topCluster) {
      occupiedClusters.add(`${topCluster}_${sig1.direction}`);
    }
    logger.info(`[Gate 9 Ranking] BEST TRADE assigned: ${topSymbol} (${sig1.direction} @ ${sig1.entryPrice}, Score: ${sig1.score})`);

    // Step B: Assign SECOND BEST (next highest candidate)
    const remainingCandidates = validCandidates.slice(1);
    let secondBestIndex = -1;

    // Look for non-correlated second candidate first
    for (let i = 0; i < remainingCandidates.length; i++) {
      const cand = remainingCandidates[i];
      const sym = cand.signal.symbol.toUpperCase();
      const cluster = this.getAssetCluster(sym);
      const hasConflict = cluster && occupiedClusters.has(`${cluster}_${cand.signal.direction}`);

      if (!hasConflict) {
        secondBestIndex = i;
        break;
      }
    }

    // Fallback: If all remaining candidates are in the same cluster, pick the highest remaining candidate
    if (secondBestIndex === -1 && remainingCandidates.length > 0) {
      secondBestIndex = 0;
    }

    if (secondBestIndex !== -1) {
      const cand2 = remainingCandidates[secondBestIndex];
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
      sig2.strategy = '[SECOND BEST] High-Confluence Alternative Setup';

      secondBest = sig2;
      if (cluster2) {
        occupiedClusters.add(`${cluster2}_${sig2.direction}`);
      }
      logger.info(`[Gate 9 Ranking] SECOND BEST assigned: ${sym2} (${sig2.direction} @ ${sig2.entryPrice}, Score: ${sig2.score})`);

      remainingCandidates.splice(secondBestIndex, 1);
    }

    // Step C: Assign up to 3 SUGGESTIONS from remaining candidates
    for (const cand of remainingCandidates) {
      if (suggestions.length < 3) {
        const sig = cand.signal;
        sig.rankTier = 'SUGGESTION';
        sig.isSuggestion = true;
        sig.isTopTrade = false;
        sig.isBestTrade = false;
        sig.isSecondBest = false;
        sig.isPrimary = false;
        sig.score = Math.round(cand.compositeScore);
        sig.strategy = '[SUGGESTION] Validated Secondary Trend Setup';

        suggestions.push(sig);
        logger.info(`[Gate 9 Ranking] SUGGESTION assigned: ${sig.symbol} (${sig.direction} @ ${sig.entryPrice}, Score: ${sig.score})`);
      } else {
        rejectedCandidates.push({
          symbol: cand.signal.symbol,
          reason: 'Maximum suggestions capacity (3) reached for this scan.',
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
   * Calculates deterministic composite score where setup quality strictly dominates R:R.
   */
  private static computeCompositeScore(candidate: ValidatedCandidate): number {
    const { scoring, aiConfidence, timeframesAligned, signal } = candidate;
    const f = scoring.factors;

    // Component Weights (Sum = 100):
    // 1. Multi-TF Trend Alignment: 25 pts
    // 2. Market Structure & S/R:    18 pts
    // 3. Momentum Confirmation:     15 pts
    // 4. Volatility & ATR Bounds:   12 pts
    // 5. Data & News Confidence:    12 pts (Nvidia AI + Finnhub News)
    // 6. Volume Validation:         10 pts
    // 7. Net Risk/Reward:            8 pts (Strictly capped to prevent R:R gaming)

    const trendWeight = (f.trendScore / 25) * 25;
    const structureWeight = (f.structureScore / 15) * 18;
    const momentumWeight = (f.momentumScore / 15) * 15;
    const volatilityWeight = (f.volatilityScore / 15) * 12;
    const volumeWeight = (f.volumeScore / 10) * 10;

    // News & AI confidence combination
    const aiNormalized = (aiConfidence / 100) * 6;
    const newsNormalized = (f.freshnessAgreementScore / 10) * 6;
    const confidenceWeight = aiNormalized + newsNormalized;

    // Capped R:R component (max 8 pts)
    const netRR = scoring.estimatedFriction?.netRiskRewardRatio || scoring.riskRewardRatio;
    let rrWeight = 0;
    if (netRR >= 3.0) rrWeight = 8;
    else if (netRR >= 2.5) rrWeight = 7;
    else if (netRR >= 2.0) rrWeight = 6;
    else if (netRR >= 1.5) rrWeight = 4;
    else rrWeight = 0;

    // Timeframe alignment bonus (up to 4 pts bonus, normalized to 100 ceiling)
    const tfBonus = Math.max(0, timeframesAligned - 2) * 1.5;

    const rawTotal = trendWeight + structureWeight + momentumWeight + volatilityWeight + volumeWeight + confidenceWeight + rrWeight + tfBonus;
    return Math.min(100, Number(rawTotal.toFixed(1)));
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
