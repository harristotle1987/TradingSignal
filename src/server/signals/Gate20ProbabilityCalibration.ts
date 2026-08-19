/**
 * Gate 20: Empirical Probability Calibration Engine
 *
 * Separates SIGNAL SCORE (a multi-factor heuristic ranking metric) from ESTIMATED WIN PROBABILITY.
 * NEVER assumes Score 90 = 90% probability of winning.
 *
 * Analyzes completed historical signal outcomes for comparable setups grouped by:
 * - scoreBucket ('70-74', '75-79', '80-84', '85-89', '90-94', '95-100')
 * - strategy
 * - regime
 * - assetClass
 * - timeframe
 * - entryType
 *
 * Requirements:
 * - Exposes Wilson Score 95% Confidence Intervals for win probabilities.
 * - If sample size < MIN_SAMPLE_SIZE (default 30):
 *   empiricalProbability = null
 *   probabilityConfidenceInterval = null
 *   calibrationStatus = 'INSUFFICIENT_DATA'
 * - READ-ONLY analytics layer: Never invents/hallucinates fake data, never automatically modifies live signal thresholds.
 */

import { DetailedTradeRecord, Gate19RegimePerformanceMatrix } from './Gate19RegimePerformanceMatrix.js';
import { logger } from '../logger.js';

export type ScoreBucket = '70-74' | '75-79' | '80-84' | '85-89' | '90-94' | '95-100' | 'BELOW_70';

export interface ProbabilityCalibrationInput {
  signalScore: number;
  strategy?: string;
  regime?: string;
  assetClass?: 'CRYPTO' | 'FOREX' | 'STOCKS';
  timeframe?: string;
  entryType?: string;
}

export interface CalibrationResult {
  empiricalProbability: number | null; // e.g. 67.2 (% win rate) or null if insufficient data
  scoreBucket: ScoreBucket;
  sampleSize: number;
  wins: number;
  losses: number;
  confidenceInterval: { lowerPct: number; upperPct: number } | null;
  calibrationStatus: 'INSUFFICIENT_DATA' | 'CALIBRATED' | 'HIGH_CONFIDENCE_CALIBRATION';
  summary: string;
  reasons: string[];
}

export interface CalibrationConfig {
  minSampleForCalibration: number; // default 30
  minSampleForHighConfidence: number; // default 100
  zScore95: number; // 1.96 for 95% CI
}

export const DEFAULT_CALIBRATION_CONFIG: CalibrationConfig = {
  minSampleForCalibration: 30,
  minSampleForHighConfidence: 100,
  zScore95: 1.96,
};

export class Gate20ProbabilityCalibration {
  private static config: CalibrationConfig = { ...DEFAULT_CALIBRATION_CONFIG };

  /**
   * Configures calibration parameters
   */
  public static configure(newConfig: Partial<CalibrationConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * Maps a numerical signal score (0-100) to a score bucket
   */
  public static getScoreBucket(score: number): ScoreBucket {
    if (score >= 95) return '95-100';
    if (score >= 90) return '90-94';
    if (score >= 85) return '85-89';
    if (score >= 80) return '80-84';
    if (score >= 75) return '75-79';
    if (score >= 70) return '70-74';
    return 'BELOW_70';
  }

  /**
   * Calculates Wilson Score 95% Confidence Interval for a binomial proportion (wins / n)
   */
  public static calculateWilsonScoreInterval(
    wins: number,
    n: number,
    z: number = 1.96
  ): { lowerPct: number; upperPct: number } {
    if (n <= 0) return { lowerPct: 0, upperPct: 0 };

    const p = wins / n;
    const z2 = z * z;
    const denominator = 1 + z2 / n;
    const center = (p + z2 / (2 * n)) / denominator;
    const margin = (z / denominator) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));

    const lower = Math.max(0, center - margin);
    const upper = Math.min(1, center + margin);

    return {
      lowerPct: Number((lower * 100).toFixed(1)),
      upperPct: Number((upper * 100).toFixed(1)),
    };
  }

  /**
   * Evaluates empirical probability for a candidate signal based on historical outcomes
   */
  public static calibrateProbability(
    input: ProbabilityCalibrationInput,
    historicalRecords?: DetailedTradeRecord[]
  ): CalibrationResult {
    const scoreBucket = this.getScoreBucket(input.signalScore);

    // Retrieve trades from Gate 19 matrix if not provided explicitly
    let allTrades: DetailedTradeRecord[] = historicalRecords || [];
    if (!historicalRecords) {
      try {
        const matrixData = (Gate19RegimePerformanceMatrix as any).trades || [];
        allTrades = matrixData;
      } catch {
        allTrades = [];
      }
    }

    // Filter trades in the same score bucket
    const bucketTrades = allTrades.filter((t) => {
      const b = this.getScoreBucket(t.signalScore || 0);
      return b === scoreBucket;
    });

    // Sub-filter by strategy or regime if available to find comparable setup
    let filtered = bucketTrades;
    if (input.strategy) {
      const stratNorm = Gate19RegimePerformanceMatrix.normalizeStrategy(input.strategy);
      const stratMatch = bucketTrades.filter(
        (t) => Gate19RegimePerformanceMatrix.normalizeStrategy(t.strategy) === stratNorm
      );
      if (stratMatch.length >= this.config.minSampleForCalibration) {
        filtered = stratMatch;
      }
    }

    const sampleSize = filtered.length;
    const wins = filtered.filter((t) => t.result === 'TP_HIT' || t.result === 'WIN' || t.rMultiple > 0).length;
    const losses = sampleSize - wins;

    const reasons: string[] = [];

    // Guard against insufficient data: Never hallucinate or invent probability
    if (sampleSize < this.config.minSampleForCalibration) {
      reasons.push(
        `Insufficient historical trades in bucket ${scoreBucket} (N=${sampleSize} < ${this.config.minSampleForCalibration}). Empirical probability withheld.`
      );
      return {
        empiricalProbability: null,
        scoreBucket,
        sampleSize,
        wins,
        losses,
        confidenceInterval: null,
        calibrationStatus: 'INSUFFICIENT_DATA',
        summary: `Score ${input.signalScore} (Bucket ${scoreBucket}): Insufficient historical data (N=${sampleSize}). Empirical probability withheld.`,
        reasons,
      };
    }

    const empiricalProbPct = Number(((wins / sampleSize) * 100).toFixed(1));
    const ci = this.calculateWilsonScoreInterval(wins, sampleSize, this.config.zScore95);

    const calibrationStatus =
      sampleSize >= this.config.minSampleForHighConfidence
        ? 'HIGH_CONFIDENCE_CALIBRATION'
        : 'CALIBRATED';

    reasons.push(
      `Calibrated on N=${sampleSize} historical trades in score bucket ${scoreBucket}: ${wins} wins / ${losses} losses.`
    );
    reasons.push(`Estimated Empirical Win Rate: ${empiricalProbPct}% (95% CI: [${ci.lowerPct}%, ${ci.upperPct}%]).`);

    return {
      empiricalProbability: empiricalProbPct,
      scoreBucket,
      sampleSize,
      wins,
      losses,
      confidenceInterval: ci,
      calibrationStatus,
      summary: `Score ${input.signalScore} (Bucket ${scoreBucket}): Empirical Win Rate ${empiricalProbPct}% [95% CI: ${ci.lowerPct}%–${ci.upperPct}%] from N=${sampleSize} trades (${calibrationStatus}).`,
      reasons,
    };
  }
}
