/**
 * GATE 15 — ADAPTIVE CALIBRATION ENGINE
 *
 * Uses accumulated live production outcomes to tune ranking weights and secondary penalties.
 *
 * CRITICAL SAFETY DIRECTIVE:
 * - "No automatic lowering of safety gates based on a small sample."
 * - Minimum R:R (1.8R) is a HARD IMMUTABLE FLOOR and will NEVER be lowered.
 * - Minimum signal score threshold (70/100) is an IMMUTABLE FLOOR.
 * - Structural SL and live spread/drift validation are IMMUTABLE SAFETY CHECKS.
 * - Minimum sample size threshold: at least 20 live completed production trades
 *   are strictly required before adaptive weight calibration takes effect.
 */

import { HistoricalOutcomeFeedbackEngine, OutcomeFeedbackReport } from './HistoricalOutcomeFeedbackEngine.js';
import { logger } from '../logger.js';
import { serverConfig } from '../config.js';

export interface CalibratedModifiers {
  strategyRankingModifiers: Record<string, number>; // Bonus / penalty for ranking
  rrRankingBonusMultiplier: number;
  regimeModifiers: Record<string, number>;
}

export interface CalibrationStatusReport {
  isCalibrationActive: boolean;
  sampleSize: number;
  minimumRequiredSample: number;
  statusMessage: string;
  hardSafetyFloors: {
    minimumGrossRR: number;
    minimumNetRR: number;
    minimumSignalScore: number;
    isSafetyLocked: boolean;
  };
  calibratedModifiers: CalibratedModifiers;
}

export class AdaptiveCalibrationEngine {
  public static readonly MINIMUM_LIVE_SAMPLE = 20;

  // Canonical baseline modifiers when sample is small or uncalibrated
  private static readonly DEFAULT_MODIFIERS: CalibratedModifiers = {
    strategyRankingModifiers: {
      'Trend-Momentum-Confluence': 1.0,
      'Multi-Confluence': 0.5,
      'Mean-Reversion': 0.0,
      'Breakout-Volume-Expansion': 0.5,
    },
    rrRankingBonusMultiplier: 1.0,
    regimeModifiers: {
      'TRENDING_BULLISH': 1.0,
      'TRENDING_BEARISH': 1.0,
      'RANGING': 0.0,
      'BREAKOUT': 0.5,
    },
  };

  /**
   * Evaluates accumulated live outcomes and returns adaptive calibration parameters.
   * Strictly enforces safety guardrails: no changes to hard safety gates!
   */
  public static async evaluateCalibration(): Promise<CalibrationStatusReport> {
    const report: OutcomeFeedbackReport = await HistoricalOutcomeFeedbackEngine.analyzeLiveOutcomeFeedback();
    const thresholds = serverConfig.getConfig().thresholds;

    // Hard safety floors - IMMUTABLE
    const hardSafetyFloors = {
      minimumGrossRR: 1.8,
      minimumNetRR: thresholds.minimumNetRR ?? 1.1,
      minimumSignalScore: thresholds.signalThreshold ?? 70,
      isSafetyLocked: true,
    };

    if (report.completedLiveCount < this.MINIMUM_LIVE_SAMPLE) {
      const msg = `Insufficient live production sample (N=${report.completedLiveCount} < ${this.MINIMUM_LIVE_SAMPLE}). Retaining canonical baseline weights. Safety gates strictly locked.`;
      logger.info(`[Gate 15 Adaptive Calibration] ${msg}`);
      return {
        isCalibrationActive: false,
        sampleSize: report.completedLiveCount,
        minimumRequiredSample: this.MINIMUM_LIVE_SAMPLE,
        statusMessage: msg,
        hardSafetyFloors,
        calibratedModifiers: { ...this.DEFAULT_MODIFIERS },
      };
    }

    // When sample size is >= MINIMUM_LIVE_SAMPLE, compute empirical calibration adjustments
    const calibratedStrategyModifiers: Record<string, number> = { ...this.DEFAULT_MODIFIERS.strategyRankingModifiers };
    for (const strat of report.strategyCorrelations) {
      if (strat.sampleSize >= 5) {
        if (strat.winRate >= 65) {
          calibratedStrategyModifiers[strat.factorName] = 2.0; // Proven high performer in production
        } else if (strat.winRate >= 55) {
          calibratedStrategyModifiers[strat.factorName] = 1.0;
        } else if (strat.winRate < 45) {
          calibratedStrategyModifiers[strat.factorName] = -1.5; // Underperforming strategy in current regime
        }
      }
    }

    const highRrCorr = report.rrCorrelations.find((c) => c.factorName === 'R:R >= 2.5R');
    const rrMultiplier = (highRrCorr && highRrCorr.sampleSize >= 5 && highRrCorr.winRate >= 55) ? 1.5 : 1.0;

    const statusMessage = `Adaptive calibration active on ${report.completedLiveCount} verified live production trades. Tuned secondary ranking factors based on empirical win rates. Safety gates remain strictly enforced.`;
    logger.info(`[Gate 15 Adaptive Calibration] ${statusMessage}`);

    return {
      isCalibrationActive: true,
      sampleSize: report.completedLiveCount,
      minimumRequiredSample: this.MINIMUM_LIVE_SAMPLE,
      statusMessage,
      hardSafetyFloors,
      calibratedModifiers: {
        strategyRankingModifiers: calibratedStrategyModifiers,
        rrRankingBonusMultiplier: rrMultiplier,
        regimeModifiers: { ...this.DEFAULT_MODIFIERS.regimeModifiers },
      },
    };
  }
}
