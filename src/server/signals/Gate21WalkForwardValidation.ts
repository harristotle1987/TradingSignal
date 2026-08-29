/**
 * Gate 21: Walk-Forward Validation Engine
 *
 * Prevents strategy overfitting by evaluating chronological performance across
 * isolated Training (In-Sample) and Out-Of-Sample (OOS) testing windows.
 *
 * Never allows future data to influence past decisions (lookahead protection).
 *
 * Tracks for both IS and OOS:
 * - winRate
 * - averageR
 * - expectancy
 * - profitFactor
 * - maxDrawdown
 * - numTrades
 * - losingStreak
 * - regimePerformance
 *
 * Computes Walk-Forward Efficiency (WFE):
 *   WFE = (Expectancy_OOS / Expectancy_IS) * 100%
 *
 * Flags OVERFIT_RISK when OOS performance deteriorates significantly relative to IS.
 *
 * READ-ONLY Policy: Purely analytical/validation engine. Does NOT automatically
 * alter live trading parameters.
 */

import { DetailedTradeRecord, Gate19RegimePerformanceMatrix } from './Gate19RegimePerformanceMatrix.js';
import { logger } from '../logger.js';

export type WalkForwardStatus =
  | 'ROBUST_STABLE'
  | 'ACCEPTABLE_DEGRADATION'
  | 'MODERATE_OVERFIT_RISK'
  | 'HIGH_OVERFIT_RISK'
  | 'INSUFFICIENT_DATA';

export interface WindowMetrics {
  numTrades: number;
  wins: number;
  losses: number;
  winRate: number; // Percentage
  averageR: number;
  expectancy: number;
  profitFactor: number;
  maxDrawdown: number;
  maxLosingStreak: number;
  regimeBreakdown: Record<string, { trades: number; winRate: number; expectancy: number }>;
}

export interface WalkForwardResult {
  strategy: string;
  inSampleMetrics: WindowMetrics;
  outOfSampleMetrics: WindowMetrics;
  walkForwardEfficiency: number | null; // Percentage (e.g. 85.2%)
  overfitRiskDetected: boolean;
  status: WalkForwardStatus;
  summary: string;
  reasons: string[];
}

export interface WalkForwardConfig {
  inSampleRatio: number; // default 0.70 (70% oldest data for training)
  minTotalTrades: number; // default 20
  minInSampleTrades: number; // default 14
  minOutOfSampleTrades: number; // default 6
  maxAcceptableDegradationPct: number; // default 30% drop
}

export const DEFAULT_WF_CONFIG: WalkForwardConfig = {
  inSampleRatio: 0.70,
  minTotalTrades: 20,
  minInSampleTrades: 14,
  minOutOfSampleTrades: 6,
  maxAcceptableDegradationPct: 30,
};

export class Gate21WalkForwardValidation {
  private static config: WalkForwardConfig = { ...DEFAULT_WF_CONFIG };

  public static configure(newConfig: Partial<WalkForwardConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * Helper to calculate window metrics for a chronological subset of trades
   */
  public static calculateWindowMetrics(trades: DetailedTradeRecord[]): WindowMetrics {
    const numTrades = trades.length;
    if (numTrades === 0) {
      return {
        numTrades: 0,
        wins: 0,
        losses: 0,
        winRate: 0,
        averageR: 0,
        expectancy: 0,
        profitFactor: 0.0,
        maxDrawdown: 0,
        maxLosingStreak: 0,
        regimeBreakdown: {},
      };
    }

    const wins = trades.filter((t) => t.result === 'TP_HIT' || t.result === 'WIN' || t.rMultiple > 0);
    const losses = trades.filter((t) => t.result === 'SL_HIT' || t.result === 'LOSS' || t.rMultiple < 0);

    const winRate = Number(((wins.length / numTrades) * 100).toFixed(1));
    const totalR = trades.reduce((sum, t) => sum + t.rMultiple, 0);
    const averageR = Number((totalR / numTrades).toFixed(3));

    const totalWinR = wins.reduce((sum, t) => sum + t.rMultiple, 0);
    const totalLossR = Math.abs(losses.reduce((sum, t) => sum + t.rMultiple, 0));
    const profitFactor = totalLossR > 0
      ? Number((totalWinR / totalLossR).toFixed(2))
      : (totalWinR > 0 ? Number(totalWinR.toFixed(2)) : 0.0);

    const winProb = winRate / 100;
    const lossProb = 1 - winProb;
    const avgWin = wins.length > 0 ? totalWinR / wins.length : 0.0;
    const avgLoss = losses.length > 0 ? totalLossR / losses.length : 0.0;
    const expectancy = Number((winProb * avgWin - lossProb * avgLoss).toFixed(3));

    // Calculate Max Drawdown in R
    let peakR = 0;
    let runningR = 0;
    let maxDd = 0;
    for (const t of trades) {
      runningR += t.rMultiple;
      if (runningR > peakR) peakR = runningR;
      const currentDd = peakR - runningR;
      if (currentDd > maxDd) maxDd = currentDd;
    }

    // Calculate Max Losing Streak
    let maxLosingStreak = 0;
    let currentLosingStreak = 0;
    for (const t of trades) {
      if (t.result === 'SL_HIT' || t.result === 'LOSS' || t.rMultiple < 0) {
        currentLosingStreak++;
        if (currentLosingStreak > maxLosingStreak) maxLosingStreak = currentLosingStreak;
      } else {
        currentLosingStreak = 0;
      }
    }

    // Regime Breakdown
    const regimeGroups: Record<string, DetailedTradeRecord[]> = {};
    for (const t of trades) {
      const reg = Gate19RegimePerformanceMatrix.normalizeRegime(t.marketRegime);
      if (!regimeGroups[reg]) regimeGroups[reg] = [];
      regimeGroups[reg].push(t);
    }

    const regimeBreakdown: Record<string, { trades: number; winRate: number; expectancy: number }> = {};
    for (const [reg, regTrades] of Object.entries(regimeGroups)) {
      const regWins = regTrades.filter((t) => t.result === 'TP_HIT' || t.result === 'WIN' || t.rMultiple > 0).length;
      const regWinRate = Number(((regWins / regTrades.length) * 100).toFixed(1));
      const regTotalR = regTrades.reduce((sum, t) => sum + t.rMultiple, 0);
      regimeBreakdown[reg] = {
        trades: regTrades.length,
        winRate: regWinRate,
        expectancy: Number((regTotalR / regTrades.length).toFixed(3)),
      };
    }

    return {
      numTrades,
      wins: wins.length,
      losses: losses.length,
      winRate,
      averageR,
      expectancy,
      profitFactor,
      maxDrawdown: Number(maxDd.toFixed(2)),
      maxLosingStreak,
      regimeBreakdown,
    };
  }

  /**
   * Performs walk-forward validation on historical trade records for a strategy
   */
  public static validateStrategy(
    strategyName: string,
    tradeHistory?: DetailedTradeRecord[]
  ): WalkForwardResult {
    const normStrategy = Gate19RegimePerformanceMatrix.normalizeStrategy(strategyName);

    let allTrades: DetailedTradeRecord[] = tradeHistory || [];
    if (!tradeHistory) {
      try {
        const matrixData = (Gate19RegimePerformanceMatrix as any).trades || [];
        allTrades = matrixData;
      } catch {
        allTrades = [];
      }
    }

    // Filter trades for this specific strategy and sort strictly chronologically (oldest -> newest)
    const strategyTrades = allTrades
      .filter((t) => Gate19RegimePerformanceMatrix.normalizeStrategy(t.strategy) === normStrategy)
      .sort((a, b) => a.timestamp - b.timestamp);

    const reasons: string[] = [];

    if (strategyTrades.length < this.config.minTotalTrades) {
      reasons.push(
        `Insufficient total trades for walk-forward validation (N=${strategyTrades.length} < ${this.config.minTotalTrades}).`
      );
      return {
        strategy: normStrategy,
        inSampleMetrics: this.calculateWindowMetrics([]),
        outOfSampleMetrics: this.calculateWindowMetrics([]),
        walkForwardEfficiency: null,
        overfitRiskDetected: false,
        status: 'INSUFFICIENT_DATA',
        summary: `Strategy ${normStrategy}: Insufficient historical data (N=${strategyTrades.length}) for Walk-Forward validation.`,
        reasons,
      };
    }

    // Partition chronologically into In-Sample (Training) and Out-Of-Sample (Testing)
    const splitIndex = Math.floor(strategyTrades.length * this.config.inSampleRatio);
    const inSampleTrades = strategyTrades.slice(0, splitIndex);
    const outOfSampleTrades = strategyTrades.slice(splitIndex);

    const isMetrics = this.calculateWindowMetrics(inSampleTrades);
    const oosMetrics = this.calculateWindowMetrics(outOfSampleTrades);

    // Calculate Walk-Forward Efficiency (WFE)
    let wfe: number | null = null;
    if (isMetrics.expectancy > 0) {
      wfe = Number(((oosMetrics.expectancy / isMetrics.expectancy) * 100).toFixed(1));
    } else if (isMetrics.winRate > 0) {
      wfe = Number(((oosMetrics.winRate / isMetrics.winRate) * 100).toFixed(1));
    }

    // Overfit risk checks
    let overfitRiskDetected = false;

    // Condition 1: WFE drops below 50%
    if (wfe !== null && wfe < 50) {
      overfitRiskDetected = true;
      reasons.push(`Walk-Forward Efficiency (${wfe}%) is below 50% threshold.`);
    }

    // Condition 2: OOS Expectancy negative while IS Expectancy positive
    if (isMetrics.expectancy > 0 && oosMetrics.expectancy < 0) {
      overfitRiskDetected = true;
      reasons.push(`Out-of-sample expectancy degraded to negative (${oosMetrics.expectancy} R vs IS ${isMetrics.expectancy} R).`);
    }

    // Condition 3: Win Rate drops by > 30% relative
    if (isMetrics.winRate > 0) {
      const dropPct = ((isMetrics.winRate - oosMetrics.winRate) / isMetrics.winRate) * 100;
      if (dropPct > this.config.maxAcceptableDegradationPct) {
        overfitRiskDetected = true;
        reasons.push(`Win rate degraded by ${dropPct.toFixed(1)}% out-of-sample (${isMetrics.winRate}% -> ${oosMetrics.winRate}%).`);
      }
    }

    // Determine status
    let status: WalkForwardStatus = 'ROBUST_STABLE';
    if (overfitRiskDetected) {
      status = wfe !== null && wfe < 40 ? 'HIGH_OVERFIT_RISK' : 'MODERATE_OVERFIT_RISK';
    } else if (wfe !== null && wfe >= 80) {
      status = 'ROBUST_STABLE';
    } else {
      status = 'ACCEPTABLE_DEGRADATION';
    }

    if (!overfitRiskDetected) {
      reasons.push(
        `Strategy ${normStrategy} demonstrated robust performance stability out-of-sample (WFE: ${wfe !== null ? wfe + '%' : 'N/A'}, IS WinRate: ${isMetrics.winRate}%, OOS WinRate: ${oosMetrics.winRate}%).`
      );
    }

    return {
      strategy: normStrategy,
      inSampleMetrics: isMetrics,
      outOfSampleMetrics: oosMetrics,
      walkForwardEfficiency: wfe,
      overfitRiskDetected,
      status,
      summary: `Strategy ${normStrategy}: ${status} (WFE=${wfe !== null ? wfe + '%' : 'N/A'}, IS N=${isMetrics.numTrades}, OOS N=${oosMetrics.numTrades}, OverfitRisk=${overfitRiskDetected}).`,
      reasons,
    };
  }
}
