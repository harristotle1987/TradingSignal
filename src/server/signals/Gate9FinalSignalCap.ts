/**
 * GATE 9 — FINAL SIGNAL CAP
 *
 * Enforces quality-adjusted signal selection with a strict maximum of 3 tradeable signals per scan.
 *
 * Threshold Architecture:
 * serverConfig
 *     ↓
 * thresholds.signalThreshold
 *     ↓
 * final tradeability threshold
 *
 * Rules:
 * - After all validation (Gate 7 Hard Gates PASS + Gate 8 score meets the configured final tradeability threshold):
 * - Allow a MAXIMUM of 3 tradeable signals per scan.
 * - If > 3 candidates pass:
 *     -> rank descending by final score
 *     -> select the strongest 3.
 * - If fewer than 3 pass (1 or 2):
 *     -> publish only those that pass.
 * - If none pass (0):
 *     -> publish ZERO signals.
 *
 * Strictly NEVER:
 * - Force a signal.
 * - Lower the threshold because no signal exists.
 * - Deep-scan additional assets merely to find a signal.
 * - Re-run rejected candidates during the same scan without an explicit retry policy.
 *
 * Acceptance criteria:
 * 0–3 signals per scan.
 */

import { TradingSignal } from '../../types/index.js';
import { logger } from '../logger.js';
import { serverConfig } from '../config.js';

export interface Gate9CappedCandidate<T = any> {
  signal: TradingSignal;
  finalScore: number;
  data?: T;
}

export interface Gate9CapSelectionResult<T = any> {
  totalPassedCandidates: number;
  maxCapAllowed: number;
  publishedSignalsCount: number;
  publishedSignals: TradingSignal[];
  publishedCandidates: Array<Gate9CappedCandidate<T>>;
  spilloverCandidates: Array<Gate9CappedCandidate<T>>;
  zeroSignalsReason?: string;
}

export class Gate9FinalSignalCap {
  public static readonly MAX_SIGNALS_PER_SCAN = 3;

  /**
   * Applies Gate 9 signal cap to candidates validated and scored at or above the configured final tradeability threshold.
   */
  public static applySignalCap<T = any>(
    qualifiedCandidates: Array<Gate9CappedCandidate<T>>
  ): Gate9CapSelectionResult<T> {
    const totalPassed = qualifiedCandidates.length;

    const minThreshold = serverConfig.getConfig().thresholds.signalThreshold;
    if (totalPassed === 0) {
      logger.info(`[Gate 9 Signal Cap] 0 candidates satisfied Gate 7 hard gates & Gate 8 score >= ${minThreshold}. Publishing 0 signals.`);
      return {
        totalPassedCandidates: 0,
        maxCapAllowed: this.MAX_SIGNALS_PER_SCAN,
        publishedSignalsCount: 0,
        publishedSignals: [],
        publishedCandidates: [],
        spilloverCandidates: [],
        zeroSignalsReason: `Zero candidates satisfied both Gate 7 hard gates and Gate 8 score hurdle (>=${minThreshold}). No signals forced.`,
      };
    }

    // Sort descending by finalScore, then by risk-to-reward as tiebreaker
    const sorted = [...qualifiedCandidates].sort((a, b) => {
      if (b.finalScore !== a.finalScore) {
        return b.finalScore - a.finalScore;
      }
      const rrA = a.signal.netRiskRewardRatio ?? a.signal.riskRewardRatio ?? 0;
      const rrB = b.signal.netRiskRewardRatio ?? b.signal.riskRewardRatio ?? 0;
      return rrB - rrA;
    });

    // Select up to MAX_SIGNALS_PER_SCAN (3)
    const publishedCandidates = sorted.slice(0, this.MAX_SIGNALS_PER_SCAN);
    const spilloverCandidates = sorted.slice(this.MAX_SIGNALS_PER_SCAN);

    // Assign rank tiers and flags
    publishedCandidates.forEach((cand, idx) => {
      cand.signal.isTradeableSignal = true;
      cand.signal.signalClassification = 'TRADEABLE';
      if (idx === 0) {
        cand.signal.isPrimary = true;
        cand.signal.isBestTrade = true;
        cand.signal.rankTier = 'BEST_TRADE';
      } else if (idx === 1) {
        cand.signal.isSecondBest = true;
        cand.signal.rankTier = 'SECOND_BEST';
      } else {
        cand.signal.isSuggestion = true;
        cand.signal.rankTier = 'SUGGESTION';
      }
    });

    const publishedSignals = publishedCandidates.map((c) => c.signal);

    logger.info(
      `[Gate 9 Signal Cap] Evaluated ${totalPassed} qualified candidates. ` +
      `Published: ${publishedSignals.length} (Cap: ${this.MAX_SIGNALS_PER_SCAN}). ` +
      `Selected: [${publishedSignals.map((s) => `${s.symbol} (${s.score ?? minThreshold}/100)`).join(', ')}]`
    );

    if (spilloverCandidates.length > 0) {
      logger.info(
        `[Gate 9 Signal Cap Spillover] ${spilloverCandidates.length} valid candidates exceeded 3-signal cap: ` +
        `[${spilloverCandidates.map((s) => `${s.signal.symbol} (${s.finalScore}/100)`).join(', ')}]`
      );
    }

    return {
      totalPassedCandidates: totalPassed,
      maxCapAllowed: this.MAX_SIGNALS_PER_SCAN,
      publishedSignalsCount: publishedSignals.length,
      publishedSignals,
      publishedCandidates,
      spilloverCandidates,
    };
  }
}
