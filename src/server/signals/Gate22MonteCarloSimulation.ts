/**
 * Gate 22: Monte Carlo Trade-Sequence Analysis Engine
 *
 * Tests system performance robustness across randomized sequences of actual completed trade results.
 *
 * Requirements:
 * - Uses ONLY actual completed trade results (R-multiples).
 * - NEVER generates synthetic winning trades.
 * - Simulates randomized orderings (bootstrap resampling) over N iterations (default 1,000).
 *
 * Estimates:
 * - expected drawdown (median max drawdown in R)
 * - worst probable drawdown (95th and 99th percentile max drawdown in R)
 * - losing streak distribution (median, 95th percentile)
 * - equity curve distribution (5th, 50th, 95th percentile final equity)
 * - probability of severe drawdown (drawdown >= severeDrawdownThresholdR)
 * - risk of ruin indicators (drawdown >= ruinThresholdR)
 *
 * Invariant: System robustness analysis only. NOT a predictor of the next trade.
 * Requires minimum sample size before reporting conclusions.
 * Clearly labels all outputs as statistical simulations, not guarantees.
 */

import { DetailedTradeRecord, Gate19RegimePerformanceMatrix } from './Gate19RegimePerformanceMatrix.js';
import { logger } from '../logger.js';

export const MONTE_CARLO_DISCLAIMER =
  'STATISTICAL SIMULATION NOTICE: Monte Carlo trade-sequence analysis evaluates system sequence risk by resampling historical R-multiples. Results are statistical estimations of drawdown distribution, not guarantees or predictors of individual future trade outcomes.';

export type MonteCarloStatus =
  | 'INSUFFICIENT_DATA'
  | 'ROBUST_STABLE'
  | 'ELEVATED_DRAWDOWN_RISK'
  | 'HIGH_RUIN_RISK';

export interface MonteCarloConfig {
  iterations: number; // default 1000
  severeDrawdownThresholdR: number; // default 10.0 R
  ruinThresholdR: number; // default 20.0 R
  minTradeCount: number; // default 15
}

export const DEFAULT_MC_CONFIG: MonteCarloConfig = {
  iterations: 1000,
  severeDrawdownThresholdR: 10.0,
  ruinThresholdR: 20.0,
  minTradeCount: 15,
};

export interface MonteCarloResult {
  simulationsCount: number;
  sampleTradeCount: number;
  medianMaxDrawdownR: number | null;
  percentile95MaxDrawdownR: number | null;
  percentile99MaxDrawdownR: number | null;
  medianMaxLosingStreak: number | null;
  percentile95LosingStreak: number | null;
  medianFinalEquityR: number | null;
  percentile5FinalEquityR: number | null;
  percentile95FinalEquityR: number | null;
  probabilityOfSevereDrawdownPct: number | null;
  riskOfRuinPct: number | null;
  simulationStatus: MonteCarloStatus;
  disclaimer: string;
  summary: string;
  reasons: string[];
}

export class Gate22MonteCarloSimulation {
  private static config: MonteCarloConfig = { ...DEFAULT_MC_CONFIG };

  public static configure(newConfig: Partial<MonteCarloConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * Helper to compute percentile of a sorted numerical array
   */
  private static getPercentile(sortedValues: number[], percentile: number): number {
    if (sortedValues.length === 0) return 0;
    const index = Math.floor((percentile / 100) * sortedValues.length);
    const clampedIndex = Math.max(0, Math.min(sortedValues.length - 1, index));
    return sortedValues[clampedIndex];
  }

  /**
   * Runs Monte Carlo sequence permutations on historical completed R-multiples
   */
  public static runSimulation(
    strategyOrFilter?: string,
    tradeHistory?: DetailedTradeRecord[]
  ): MonteCarloResult {
    let allTrades: DetailedTradeRecord[] = tradeHistory || [];
    if (!tradeHistory) {
      try {
        const matrixData = (Gate19RegimePerformanceMatrix as any).trades || [];
        allTrades = matrixData;
      } catch {
        allTrades = [];
      }
    }

    let filteredTrades = allTrades;
    if (strategyOrFilter) {
      const normStrat = Gate19RegimePerformanceMatrix.normalizeStrategy(strategyOrFilter);
      filteredTrades = allTrades.filter(
        (t) => Gate19RegimePerformanceMatrix.normalizeStrategy(t.strategy) === normStrat
      );
    }

    // Extract raw actual historical R-multiples — NO synthetic trades
    const rMultiples = filteredTrades.map((t) => t.rMultiple);
    const sampleTradeCount = rMultiples.length;
    const reasons: string[] = [];

    // Guard against insufficient data
    if (sampleTradeCount < this.config.minTradeCount) {
      reasons.push(
        `Insufficient completed trades for Monte Carlo simulation (N=${sampleTradeCount} < ${this.config.minTradeCount}).`
      );
      return {
        simulationsCount: 0,
        sampleTradeCount,
        medianMaxDrawdownR: null,
        percentile95MaxDrawdownR: null,
        percentile99MaxDrawdownR: null,
        medianMaxLosingStreak: null,
        percentile95LosingStreak: null,
        medianFinalEquityR: null,
        percentile5FinalEquityR: null,
        percentile95FinalEquityR: null,
        probabilityOfSevereDrawdownPct: null,
        riskOfRuinPct: null,
        simulationStatus: 'INSUFFICIENT_DATA',
        disclaimer: MONTE_CARLO_DISCLAIMER,
        summary: `Monte Carlo Analysis: Insufficient completed trade data (N=${sampleTradeCount} < ${this.config.minTradeCount}).`,
        reasons,
      };
    }

    const maxDrawdowns: number[] = [];
    const maxLosingStreaks: number[] = [];
    const finalEquities: number[] = [];

    let severeDrawdownCount = 0;
    let ruinCount = 0;

    // Run N randomized bootstrap permutations
    for (let sim = 0; sim < this.config.iterations; sim++) {
      // Bootstrap sample with replacement from historical R-multiples
      const simulatedSequence: number[] = [];
      for (let i = 0; i < sampleTradeCount; i++) {
        const randomIndex = Math.floor(Math.random() * sampleTradeCount);
        simulatedSequence.push(rMultiples[randomIndex]);
      }

      // Track equity, max drawdown, and losing streak for this simulation run
      let runningEquity = 0;
      let peakEquity = 0;
      let simMaxDrawdown = 0;
      let currentLosingStreak = 0;
      let simMaxLosingStreak = 0;

      for (const r of simulatedSequence) {
        runningEquity += r;
        if (runningEquity > peakEquity) peakEquity = runningEquity;
        const currentDd = peakEquity - runningEquity;
        if (currentDd > simMaxDrawdown) simMaxDrawdown = currentDd;

        if (r < 0) {
          currentLosingStreak++;
          if (currentLosingStreak > simMaxLosingStreak) simMaxLosingStreak = currentLosingStreak;
        } else {
          currentLosingStreak = 0;
        }
      }

      maxDrawdowns.push(simMaxDrawdown);
      maxLosingStreaks.push(simMaxLosingStreak);
      finalEquities.push(runningEquity);

      if (simMaxDrawdown >= this.config.severeDrawdownThresholdR) severeDrawdownCount++;
      if (simMaxDrawdown >= this.config.ruinThresholdR) ruinCount++;
    }

    // Sort arrays for percentile extraction
    maxDrawdowns.sort((a, b) => a - b);
    maxLosingStreaks.sort((a, b) => a - b);
    finalEquities.sort((a, b) => a - b);

    const medianMaxDrawdownR = Number(this.getPercentile(maxDrawdowns, 50).toFixed(2));
    const percentile95MaxDrawdownR = Number(this.getPercentile(maxDrawdowns, 95).toFixed(2));
    const percentile99MaxDrawdownR = Number(this.getPercentile(maxDrawdowns, 99).toFixed(2));

    const medianMaxLosingStreak = this.getPercentile(maxLosingStreaks, 50);
    const percentile95LosingStreak = this.getPercentile(maxLosingStreaks, 95);

    const medianFinalEquityR = Number(this.getPercentile(finalEquities, 50).toFixed(2));
    const percentile5FinalEquityR = Number(this.getPercentile(finalEquities, 5).toFixed(2));
    const percentile95FinalEquityR = Number(this.getPercentile(finalEquities, 95).toFixed(2));

    const probabilityOfSevereDrawdownPct = Number(
      ((severeDrawdownCount / this.config.iterations) * 100).toFixed(1)
    );
    const riskOfRuinPct = Number(((ruinCount / this.config.iterations) * 100).toFixed(1));

    // Determine simulation status
    let simulationStatus: MonteCarloStatus = 'ROBUST_STABLE';
    if (riskOfRuinPct > 5.0) {
      simulationStatus = 'HIGH_RUIN_RISK';
      reasons.push(`High risk of ruin detected (${riskOfRuinPct}% > 5.0% threshold).`);
    } else if (probabilityOfSevereDrawdownPct > 15.0) {
      simulationStatus = 'ELEVATED_DRAWDOWN_RISK';
      reasons.push(
        `Elevated probability of severe drawdown (${probabilityOfSevereDrawdownPct}% > 15.0% threshold).`
      );
    } else {
      reasons.push(
        `Monte Carlo sequence analysis confirms robust drawdown resilience across ${this.config.iterations} permutations.`
      );
    }

    return {
      simulationsCount: this.config.iterations,
      sampleTradeCount,
      medianMaxDrawdownR,
      percentile95MaxDrawdownR,
      percentile99MaxDrawdownR,
      medianMaxLosingStreak,
      percentile95LosingStreak,
      medianFinalEquityR,
      percentile5FinalEquityR,
      percentile95FinalEquityR,
      probabilityOfSevereDrawdownPct,
      riskOfRuinPct,
      simulationStatus,
      disclaimer: MONTE_CARLO_DISCLAIMER,
      summary: `Monte Carlo (${this.config.iterations} runs, N=${sampleTradeCount}): Median Max DD = ${medianMaxDrawdownR}R, 95th Percentile DD = ${percentile95MaxDrawdownR}R, Severe DD Prob = ${probabilityOfSevereDrawdownPct}%, Risk of Ruin = ${riskOfRuinPct}% (${simulationStatus}).`,
      reasons,
    };
  }
}
