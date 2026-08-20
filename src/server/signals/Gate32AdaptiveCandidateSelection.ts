/**
 * GATE 32 — ADAPTIVE DEEP-CANDIDATE SELECTION ENGINE
 *
 * OBJECTIVE:
 * Dynamically select Stage-2 candidates for Stage-3 Deep MTF Analysis based on:
 * 1. API Budget Status (HEALTHY -> up to 10 candidates, MODERATE -> 7, CONSTRAINED -> 5).
 * 2. Composite Prioritization:
 *    - Preliminary Score (45% weight)
 *    - Market Regime (20% weight - Trending/Expansion vs Ranging/Chaos)
 *    - Relative Strength (20% weight - Sector/Universe percentile)
 *    - Volatility Suitability (15% weight - ATR efficiency vs noise)
 * 3. Tightly Clustered Score Expansion:
 *    - If candidate #6 (or candidates just beyond cutoff) are within a tight score cluster (e.g. delta <= 4.0 pts)
 *      of the cutoff candidate, EXPAND the candidate pool so high-quality setups are NOT missed simply
 *      because they ranked #6 in a cheap pre-screen.
 * 4. API Quota Safety Guardrails:
 *    - NEVER exceed the absolute configured API quota ceiling.
 *    - Preserve rate-limiting pacing during Stage-3 dispatch.
 */

import { NormalizedCandle, SignalDirection } from '../../types/index.js';
import { quotaManager } from '../market/QuotaManager.js';
import { serverConfig } from '../config.js';
import { logger } from '../logger.js';

export type ApiBudgetStatus = 'HEALTHY' | 'MODERATE' | 'CONSTRAINED';

export interface Stage2CandidateInput {
  asset: string;
  assetClass?: string;
  preliminaryScore: number;
  direction?: SignalDirection | 'LONG' | 'SHORT' | 'NEUTRAL' | string;
  marketRegimeScore?: number;        // 0-100 (e.g. 85 for strong trend expansion)
  relativeStrengthScore?: number;    // 0-100 (e.g. 80 for strong outperformance)
  volatilitySuitabilityScore?: number; // 0-100 (e.g. 75 for optimal ATR vs spread)
  htf1hCandles?: NormalizedCandle[];
}

export interface AdaptiveSelectionConfig {
  maxApiQuotaLimit?: number;             // Absolute maximum quota cap (e.g., 10 or 12)
  healthyQuotaLimit?: number;            // Default cap when budget is HEALTHY (default: 10)
  moderateQuotaLimit?: number;           // Default cap when budget is MODERATE (default: 7)
  constrainedQuotaLimit?: number;        // Default cap when budget is CONSTRAINED (default: 5)
  clusterScoreDeltaThreshold?: number;   // Max score delta to trigger cluster expansion (default: 4.0)
  clusterMaxBonusSlots?: number;         // Max extra candidate slots via cluster expansion (default: 3)
}

export interface CandidateCompositeScore {
  asset: string;
  assetClass: string;
  rawPreliminaryScore: number;
  marketRegimeScore: number;
  relativeStrengthScore: number;
  volatilitySuitabilityScore: number;
  compositeScore: number;
  rank: number;
  isExpandedSlot: boolean;
  inputRef: Stage2CandidateInput;
}

export interface AdaptiveSelectionResult {
  selectedCandidates: Stage2CandidateInput[];
  rankedCandidates: CandidateCompositeScore[];
  budgetStatus: ApiBudgetStatus;
  baseQuotaLimit: number;
  finalQuotaLimit: number;
  clusterExpansionTriggered: boolean;
  expandedCandidateCount: number;
  pacingMsPerCandidate: number;
  reasons: string[];
  explanation: string;
}

export class Gate32AdaptiveCandidateSelection {
  /**
   * Evaluates candidate factors and computes composite prioritization score (0-100).
   * Factor Weights:
   * - Preliminary Score: 45%
   * - Market Regime: 20%
   * - Relative Strength: 20%
   * - Volatility Suitability: 15%
   */
  public static calculateCompositeScore(candidate: Stage2CandidateInput): CandidateCompositeScore {
    const rawPrelim = Math.min(100, Math.max(0, candidate.preliminaryScore));

    // Calculate or fallback factor scores
    const regime = candidate.marketRegimeScore ?? this.estimateRegimeScore(candidate);
    const relStrength = candidate.relativeStrengthScore ?? this.estimateRelativeStrengthScore(candidate);
    const volSuitability = candidate.volatilitySuitabilityScore ?? this.estimateVolatilitySuitability(candidate);

    const weightedScore =
      rawPrelim * 0.45 +
      regime * 0.20 +
      relStrength * 0.20 +
      volSuitability * 0.15;

    const compositeScore = parseFloat(weightedScore.toFixed(2));

    return {
      asset: candidate.asset,
      assetClass: candidate.assetClass || 'UNKNOWN',
      rawPreliminaryScore: rawPrelim,
      marketRegimeScore: regime,
      relativeStrengthScore: relStrength,
      volatilitySuitabilityScore: volSuitability,
      compositeScore,
      rank: 0,
      isExpandedSlot: false,
      inputRef: candidate,
    };
  }

  /**
   * Helper: Estimate regime score from 1H candles if not explicitly supplied
   */
  private static estimateRegimeScore(candidate: Stage2CandidateInput): number {
    if (!candidate.htf1hCandles || candidate.htf1hCandles.length < 10) {
      return candidate.preliminaryScore; // Fallback to preliminary score
    }

    const candles = candidate.htf1hCandles;
    const recent = candles.slice(-10);
    const firstClose = recent[0].close;
    const lastClose = recent[recent.length - 1].close;

    if (firstClose <= 0) return 50;

    const returnPct = Math.abs((lastClose - firstClose) / firstClose) * 100;
    // Clean trend expansion gets 70-95
    if (returnPct > 1.5) return 85;
    if (returnPct > 0.8) return 70;
    if (returnPct > 0.3) return 55;
    return 40; // Choppy/flat
  }

  /**
   * Helper: Estimate relative strength score from 1H candles if not explicitly supplied
   */
  private static estimateRelativeStrengthScore(candidate: Stage2CandidateInput): number {
    if (!candidate.htf1hCandles || candidate.htf1hCandles.length < 10) {
      return candidate.preliminaryScore;
    }

    const candles = candidate.htf1hCandles;
    let upCount = 0;
    for (const c of candles.slice(-10)) {
      if (c.close > c.open) upCount++;
    }

    const ratio = upCount / 10;
    const dirUpper = (candidate.direction || '').toString().toUpperCase();
    if (dirUpper === 'LONG' || dirUpper === 'BUY') {
      return Math.round(ratio * 100);
    } else if (dirUpper === 'SHORT' || dirUpper === 'SELL') {
      return Math.round((1 - ratio) * 100);
    }
    return 50;
  }

  /**
   * Helper: Estimate volatility suitability score
   */
  private static estimateVolatilitySuitability(candidate: Stage2CandidateInput): number {
    if (!candidate.htf1hCandles || candidate.htf1hCandles.length < 10) {
      return candidate.preliminaryScore;
    }

    const candles = candidate.htf1hCandles;
    const ranges = candles.slice(-10).map((c) => (c.high - c.low) / c.close);
    const avgRange = ranges.reduce((a, b) => a + b, 0) / ranges.length;

    // Optimal volatility range: 0.1% to 2.5% per candle
    if (avgRange >= 0.001 && avgRange <= 0.025) {
      return 80;
    } else if (avgRange < 0.001) {
      return 40; // Too dead/squeeze
    }
    return 50; // Extreme noise
  }

  /**
   * Main Gate 32 Entry Point:
   * Adaptively filters and selects top candidates based on API health, composite ranking, and tight cluster expansion.
   */
  public static selectCandidates(
    candidates: Stage2CandidateInput[],
    configOverride?: AdaptiveSelectionConfig,
    providerId: string = 'twelvedata'
  ): AdaptiveSelectionResult {
    const reasons: string[] = [];

    if (!candidates || candidates.length === 0) {
      return {
        selectedCandidates: [],
        rankedCandidates: [],
        budgetStatus: 'HEALTHY',
        baseQuotaLimit: 10,
        finalQuotaLimit: 10,
        clusterExpansionTriggered: false,
        expandedCandidateCount: 0,
        pacingMsPerCandidate: 100,
        reasons: ['No Stage-2 candidates provided.'],
        explanation: 'Adaptive candidate selection skipped: 0 candidates input.',
      };
    }

    // 1. Resolve API Quota Ceiling & Configuration
    const cfgServerCap = serverConfig.getConfig().thresholds.candidateThreshold || 10;
    const maxApiQuotaLimit = configOverride?.maxApiQuotaLimit ?? Math.max(10, cfgServerCap);
    const healthyCap = configOverride?.healthyQuotaLimit ?? Math.min(10, maxApiQuotaLimit);
    const moderateCap = configOverride?.moderateQuotaLimit ?? Math.min(7, maxApiQuotaLimit);
    const constrainedCap = configOverride?.constrainedQuotaLimit ?? Math.min(5, maxApiQuotaLimit);

    const deltaThreshold = configOverride?.clusterScoreDeltaThreshold ?? 4.0;
    const clusterMaxBonus = configOverride?.clusterMaxBonusSlots ?? 3;

    // 2. Assess API Budget Status via QuotaManager
    const budgetStatus: ApiBudgetStatus = quotaManager.getBudgetStatus
      ? quotaManager.getBudgetStatus(providerId)
      : 'HEALTHY';

    let baseQuotaLimit = healthyCap;
    if (budgetStatus === 'MODERATE') {
      baseQuotaLimit = moderateCap;
      reasons.push(`API Budget Status is MODERATE: Base candidate cap set to ${baseQuotaLimit}.`);
    } else if (budgetStatus === 'CONSTRAINED') {
      baseQuotaLimit = constrainedCap;
      reasons.push(`API Budget Status is CONSTRAINED: Base candidate cap reduced to ${baseQuotaLimit} to protect quota.`);
    } else {
      reasons.push(`API Budget Status is HEALTHY: Base candidate cap set to ${baseQuotaLimit}.`);
    }

    // 3. Calculate Composite Scores and Rank Candidates
    const scoredList: CandidateCompositeScore[] = candidates.map((cand) =>
      this.calculateCompositeScore(cand)
    );

    // Sort descending by composite score
    scoredList.sort((a, b) => b.compositeScore - a.compositeScore);

    // Assign rank positions (1-indexed)
    scoredList.forEach((item, idx) => {
      item.rank = idx + 1;
    });

    // 4. Determine Initial Selection Window
    let initialCount = Math.min(baseQuotaLimit, scoredList.length);
    let finalQuotaLimit = initialCount;
    let clusterExpansionTriggered = false;
    let expandedCandidateCount = 0;

    // 5. Tightly Clustered Score Expansion Check
    // If there are more candidates beyond the initial cutoff position
    if (scoredList.length > initialCount) {
      const cutoffCandidate = scoredList[initialCount - 1]; // e.g. candidate #5 at index 4
      const nextCandidate = scoredList[initialCount];       // e.g. candidate #6 at index 5

      const scoreDelta = cutoffCandidate.compositeScore - nextCandidate.compositeScore;

      if (scoreDelta <= deltaThreshold) {
        // Candidate #6 is tightly clustered with candidate #5!
        // Expand candidate pool to avoid missing a high-quality setup due to a cheap pre-screen ranking gap.
        clusterExpansionTriggered = true;

        let bonusAdded = 0;
        let currIdx = initialCount;

        while (
          currIdx < scoredList.length &&
          bonusAdded < clusterMaxBonus &&
          finalQuotaLimit < maxApiQuotaLimit
        ) {
          const cand = scoredList[currIdx];
          const prevCand = scoredList[currIdx - 1];
          const prevDelta = prevCand.compositeScore - cand.compositeScore;

          // Add if within tight cluster threshold of cutoff or preceding clustered candidate
          if (prevDelta <= deltaThreshold || (cutoffCandidate.compositeScore - cand.compositeScore) <= (deltaThreshold * 1.5)) {
            cand.isExpandedSlot = true;
            bonusAdded++;
            finalQuotaLimit++;
            expandedCandidateCount++;
            currIdx++;
          } else {
            break;
          }
        }

        reasons.push(
          `Cluster Expansion Triggered: Candidate #${initialCount + 1} (${nextCandidate.asset}, score ${nextCandidate.compositeScore}) was tightly clustered (delta ${scoreDelta.toFixed(1)} <= ${deltaThreshold}pt) with #${initialCount} (${cutoffCandidate.asset}, score ${cutoffCandidate.compositeScore}). Expanded pool by +${expandedCandidateCount} candidates (Total limit: ${finalQuotaLimit}).`
        );
      } else {
        reasons.push(
          `No Cluster Expansion: Score gap between #${initialCount} (${cutoffCandidate.asset}: ${cutoffCandidate.compositeScore}pt) and #${initialCount + 1} (${nextCandidate.asset}: ${nextCandidate.compositeScore}pt) was ${scoreDelta.toFixed(1)}pt (> ${deltaThreshold}pt threshold).`
        );
      }
    }

    // Enforce hard ceiling guardrail
    if (finalQuotaLimit > maxApiQuotaLimit) {
      finalQuotaLimit = maxApiQuotaLimit;
      reasons.push(`Hard API Quota Ceiling enforced: Clamped candidate selection limit to ${maxApiQuotaLimit}.`);
    }

    const selectedScored = scoredList.slice(0, finalQuotaLimit);
    const selectedCandidates = selectedScored.map((s) => s.inputRef);

    // Calculate recommended rate-limiting pacing delay per candidate during Stage 3 execution
    const pacingMsPerCandidate = budgetStatus === 'CONSTRAINED' ? 350 : budgetStatus === 'MODERATE' ? 200 : 100;

    const explanation = `Gate 32 Adaptive Selection: Selected ${selectedCandidates.length}/${candidates.length} candidates (Budget: ${budgetStatus}, BaseLimit: ${baseQuotaLimit}, FinalLimit: ${finalQuotaLimit}, ClusterExpanded: ${clusterExpansionTriggered} [+${expandedCandidateCount}]).`;

    logger.info(`[Gate 32 Adaptive Candidates] ${explanation}`);

    return {
      selectedCandidates,
      rankedCandidates: scoredList,
      budgetStatus,
      baseQuotaLimit,
      finalQuotaLimit,
      clusterExpansionTriggered,
      expandedCandidateCount,
      pacingMsPerCandidate,
      reasons,
      explanation,
    };
  }
}
