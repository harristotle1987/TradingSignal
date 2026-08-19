/**
 * Gate 19: Regime-Specific Performance Analytics Engine
 *
 * Measures which strategies actually perform under which market regimes.
 * 
 * Records completed trades with:
 * - strategy
 * - asset (symbol)
 * - assetClass
 * - marketRegime
 * - timeframe
 * - session
 * - signalScore
 * - result (outcome)
 * - rMultiple (realized R)
 * - mae (Maximum Adverse Excursion)
 * - mfe (Maximum Favorable Excursion)
 *
 * Builds the STRATEGY × REGIME matrix:
 * Exposes:
 * - sampleSize
 * - winRate
 * - averageR
 * - expectancy
 * - profitFactor
 * - maxDrawdown
 * - maeAvg
 * - mfeAvg
 * - confidenceLevel ('INSUFFICIENT_SAMPLE' | 'LOW_SAMPLE' | 'MODERATE_SAMPLE' | 'STATISTICALLY_SIGNIFICANT')
 *
 * Invariant: Never alters live strategy weights from tiny sample sizes.
 */

import * as fs from 'fs';
import * as path from 'path';
import { StrategyCategory } from './Gate18RegimeStrategySelection.js';
import { logger } from '../logger.js';

export type StatisticalConfidenceLevel =
  | 'INSUFFICIENT_SAMPLE' // < 10 trades
  | 'LOW_SAMPLE'          // 10 - 24 trades
  | 'MODERATE_SAMPLE'     // 25 - 49 trades
  | 'STATISTICALLY_SIGNIFICANT'; // >= 50 trades

export interface DetailedTradeRecord {
  tradeId: string;
  strategy: StrategyCategory | string;
  asset: string;
  assetClass: 'CRYPTO' | 'FOREX' | 'STOCKS';
  marketRegime: string;
  timeframe: string;
  session: 'ASIA' | 'LONDON' | 'NEW_YORK' | 'WEEKEND' | 'OVERLAP' | 'GLOBAL';
  signalScore: number;
  result: 'TP_HIT' | 'SL_HIT' | 'EXPIRED' | 'INVALIDATED' | 'WIN' | 'LOSS';
  rMultiple: number;
  mae: number; // Maximum Adverse Excursion in R (e.g. 0.45)
  mfe: number; // Maximum Favorable Excursion in R (e.g. 2.10)
  timestamp: number;
  durationMinutes?: number;
}

export interface RegimeStrategyCellStats {
  strategy: string;
  marketRegime: string;
  sampleSize: number;
  winRate: number; // Percentage (e.g. 68.5)
  averageR: number;
  expectancy: number;
  profitFactor: number;
  maxDrawdown: number;
  maeAvg: number;
  mfeAvg: number;
  confidenceLevel: StatisticalConfidenceLevel;
  confidenceScore: number; // 0 - 100
  performanceModifier: number; // Applied only if sample >= MODERATE_SAMPLE
}

export interface RegimePerformanceConfig {
  minSampleForLowConfidence: number; // default 10
  minSampleForModerateConfidence: number; // default 25
  minSampleForSignificance: number; // default 50
  maxDrawdownCapR: number;
}

export const DEFAULT_CONFIG: RegimePerformanceConfig = {
  minSampleForLowConfidence: 10,
  minSampleForModerateConfidence: 25,
  minSampleForSignificance: 50,
  maxDrawdownCapR: 10.0,
};

const MATRIX_PERSISTENCE_PATH = path.join(process.cwd(), 'regime_performance_matrix.json');

export class Gate19RegimePerformanceMatrix {
  private static trades: DetailedTradeRecord[] = [];
  private static config: RegimePerformanceConfig = { ...DEFAULT_CONFIG };
  private static isInitialized = false;

  /**
   * Initializes or loads persisted matrix data
   */
  public static init(): void {
    if (this.isInitialized) return;
    try {
      if (fs.existsSync(MATRIX_PERSISTENCE_PATH)) {
        const raw = fs.readFileSync(MATRIX_PERSISTENCE_PATH, 'utf-8');
        const data = JSON.parse(raw);
        if (Array.isArray(data.trades)) {
          this.trades = data.trades;
          logger.info(`[Gate 19 Performance Matrix] Loaded ${this.trades.length} trade records from disk.`);
        }
      }
    } catch (err: any) {
      logger.warn(`[Gate 19 Performance Matrix] Could not load matrix data: ${err.message}`);
    }
    this.isInitialized = true;
  }

  /**
   * Configure minimum sample size thresholds
   */
  public static configure(newConfig: Partial<RegimePerformanceConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * Normalizes regime names for matrix aggregation
   */
  public static normalizeRegime(regime: string): string {
    const norm = (regime || 'UNKNOWN').toUpperCase();
    if (norm.includes('BULL')) return 'BULL';
    if (norm.includes('BEAR')) return 'BEAR';
    if (norm.includes('RANGE') || norm.includes('RANGING')) return 'RANGE';
    if (norm.includes('BREAKOUT')) return 'BREAKOUT';
    if (norm.includes('VOLATILITY')) return 'VOLATILE';
    return norm;
  }

  /**
   * Normalizes strategy category for matrix aggregation
   */
  public static normalizeStrategy(strategy: string): string {
    const norm = (strategy || 'TREND_CONTINUATION').toUpperCase();
    if (norm.includes('PULLBACK')) return 'TREND_PULLBACK';
    if (norm.includes('SWEEP') || norm.includes('FALSE')) return 'FALSE_BREAKOUT';
    if (norm.includes('BREAKOUT')) return 'BREAKOUT';
    if (norm.includes('RANGE') || norm.includes('REVERSAL') || norm.includes('MEAN')) return 'RANGE_REVERSAL';
    if (norm.includes('MOMENTUM') || norm.includes('MACD')) return 'MOMENTUM_CONTINUATION';
    return 'TREND_CONTINUATION';
  }

  /**
   * Records a completed trade outcome
   */
  public static recordTrade(trade: DetailedTradeRecord): void {
    this.init();
    this.trades.push(trade);

    // Keep last 10,000 trades in memory/disk
    if (this.trades.length > 10000) {
      this.trades = this.trades.slice(-10000);
    }

    try {
      fs.writeFileSync(
        MATRIX_PERSISTENCE_PATH,
        JSON.stringify({ lastUpdated: Date.now(), trades: this.trades }, null, 2)
      );
    } catch {
      // Non-blocking disk write
    }
  }

  /**
   * Calculates metrics for a specific slice of trade records
   */
  public static calculateCellStats(
    strategy: string,
    marketRegime: string,
    tradeSubset: DetailedTradeRecord[]
  ): RegimeStrategyCellStats {
    const sampleSize = tradeSubset.length;

    // Determine confidence level strictly based on sample size
    let confidenceLevel: StatisticalConfidenceLevel = 'INSUFFICIENT_SAMPLE';
    let confidenceScore = 10;

    if (sampleSize >= this.config.minSampleForSignificance) {
      confidenceLevel = 'STATISTICALLY_SIGNIFICANT';
      confidenceScore = 95;
    } else if (sampleSize >= this.config.minSampleForModerateConfidence) {
      confidenceLevel = 'MODERATE_SAMPLE';
      confidenceScore = 75;
    } else if (sampleSize >= this.config.minSampleForLowConfidence) {
      confidenceLevel = 'LOW_SAMPLE';
      confidenceScore = 40;
    }

    if (sampleSize === 0) {
      return {
        strategy,
        marketRegime,
        sampleSize: 0,
        winRate: 50.0,
        averageR: 0,
        expectancy: 0,
        profitFactor: 1.0,
        maxDrawdown: 0,
        maeAvg: 0,
        mfeAvg: 0,
        confidenceLevel,
        confidenceScore,
        performanceModifier: 0,
      };
    }

    const wins = tradeSubset.filter((t) => t.result === 'TP_HIT' || t.result === 'WIN' || t.rMultiple > 0);
    const losses = tradeSubset.filter((t) => t.result === 'SL_HIT' || t.result === 'LOSS' || t.rMultiple < 0);

    const winRate = Number(((wins.length / sampleSize) * 100).toFixed(1));
    const totalR = tradeSubset.reduce((sum, t) => sum + t.rMultiple, 0);
    const averageR = Number((totalR / sampleSize).toFixed(3));

    const totalGrossWinR = wins.reduce((sum, t) => sum + t.rMultiple, 0);
    const totalGrossLossR = Math.abs(losses.reduce((sum, t) => sum + t.rMultiple, 0));
    const profitFactor = totalGrossLossR > 0
      ? Number((totalGrossWinR / totalGrossLossR).toFixed(2))
      : (totalGrossWinR > 0 ? 3.0 : 1.0);

    const winProb = winRate / 100;
    const lossProb = 1 - winProb;
    const avgWin = wins.length > 0 ? totalGrossWinR / wins.length : 2.0;
    const avgLoss = losses.length > 0 ? totalGrossLossR / losses.length : 1.0;
    const expectancy = Number((winProb * avgWin - lossProb * avgLoss).toFixed(3));

    // Calculate Max Drawdown in R
    let peakR = 0;
    let runningR = 0;
    let maxDd = 0;
    for (const t of tradeSubset) {
      runningR += t.rMultiple;
      if (runningR > peakR) peakR = runningR;
      const currentDd = peakR - runningR;
      if (currentDd > maxDd) maxDd = currentDd;
    }

    const totalMae = tradeSubset.reduce((sum, t) => sum + (t.mae || 0), 0);
    const totalMfe = tradeSubset.reduce((sum, t) => sum + (t.mfe || 0), 0);
    const maeAvg = Number((totalMae / sampleSize).toFixed(2));
    const mfeAvg = Number((totalMfe / sampleSize).toFixed(2));

    // Performance modifier: ONLY applied if sample is at least MODERATE_SAMPLE
    let performanceModifier = 0;
    if (confidenceLevel === 'STATISTICALLY_SIGNIFICANT' || confidenceLevel === 'MODERATE_SAMPLE') {
      if (winRate < 40 || expectancy < 0) {
        performanceModifier = -12;
      } else if (winRate >= 65 && expectancy >= 0.5) {
        performanceModifier = +8;
      } else if (winRate >= 55 && expectancy > 0.2) {
        performanceModifier = +4;
      }
    }

    return {
      strategy,
      marketRegime,
      sampleSize,
      winRate,
      averageR,
      expectancy,
      profitFactor,
      maxDrawdown: Number(maxDd.toFixed(2)),
      maeAvg,
      mfeAvg,
      confidenceLevel,
      confidenceScore,
      performanceModifier,
    };
  }

  /**
   * Retrieves stats for a specific strategy & regime combination
   */
  public static getRegimeStrategyPerformance(
    rawStrategy: string,
    rawRegime: string
  ): RegimeStrategyCellStats {
    this.init();
    const stratKey = this.normalizeStrategy(rawStrategy);
    const regimeKey = this.normalizeRegime(rawRegime);

    const matchingTrades = this.trades.filter((t) => {
      const matchStrat = this.normalizeStrategy(t.strategy) === stratKey;
      const matchRegime = this.normalizeRegime(t.marketRegime) === regimeKey;
      return matchStrat && matchRegime;
    });

    return this.calculateCellStats(stratKey, regimeKey, matchingTrades);
  }

  /**
   * Builds the complete STRATEGY × REGIME Performance Matrix
   */
  public static getPerformanceMatrix(): {
    matrix: Record<string, Record<string, RegimeStrategyCellStats>>;
    totalTrades: number;
    summary: string;
  } {
    this.init();
    const strategies = [
      'TREND_CONTINUATION',
      'TREND_PULLBACK',
      'BREAKOUT',
      'FALSE_BREAKOUT',
      'RANGE_REVERSAL',
      'MOMENTUM_CONTINUATION',
    ];
    const regimes = ['BULL', 'BEAR', 'RANGE', 'BREAKOUT', 'VOLATILE'];

    const matrix: Record<string, Record<string, RegimeStrategyCellStats>> = {};

    for (const strat of strategies) {
      matrix[strat] = {};
      for (const reg of regimes) {
        matrix[strat][reg] = this.getRegimeStrategyPerformance(strat, reg);
      }
    }

    return {
      matrix,
      totalTrades: this.trades.length,
      summary: `Performance Matrix built across ${strategies.length} strategies and ${regimes.length} regimes (${this.trades.length} historical records).`,
    };
  }

  /**
   * Clear all records (useful for testing)
   */
  public static clear(): void {
    this.trades = [];
    this.isInitialized = true;
    try {
      if (fs.existsSync(MATRIX_PERSISTENCE_PATH)) {
        fs.unlinkSync(MATRIX_PERSISTENCE_PATH);
      }
    } catch {
      // Ignored
    }
  }
}
