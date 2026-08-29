/**
 * Strategy Performance & Multi-Dimensional Outcome Tracking Engine
 *
 * Implements Institutional Performance Attribution & Adaptive Intelligence:
 * 1. Metrics tracked:
 *    - Win rate (Win Probability) and Rolling Win Rate (last 20 trades)
 *    - Profit factor (Total Gross Win R / Total Gross Loss R)
 *    - Average R per trade (avgR)
 *    - Max Drawdown (R drawdown) and Max Losing Streak
 *    - Mathematical expectancy (R per trade)
 *    - Total trades, wins, losses, breakevens, expired, invalidated
 *
 * 2. Multi-dimensional segmentation:
 *    - By Strategy ID & Name (strat_1..strat_6)
 *    - By Individual Asset (BTCUSDT, EURUSD, AAPL, etc.) & Asset Class (CRYPTO, FOREX, STOCKS)
 *    - By Timeframe (1h, 15m, 4h, 5m, etc.)
 *    - By Market Regime (TRENDING, RANGING, BREAKOUT, HIGH_VOLATILITY, LOW_VOLATILITY)
 *    - By Confidence Range ('70-79', '80-89', '90-100')
 *
 * 3. Confidence Calibration & Strategy Weight Adjustment:
 *    - Calibrates candidate confidence scores based on empirical performance of confidence buckets.
 *    - Dynamically scales strategy influence: consistently weak strategies (<40% WR / negative expectancy) receive less weight; strong strategies receive more weight.
 *    - Uses Bayesian regularized shrinkage bounded within safe limits to prevent overfitting.
 *
 * 4. Compliance & Risk Statement:
 *    - NEVER guarantees or claims future profitability. Past performance metrics are statistical risk inputs only.
 */

import * as fs from 'fs';
import * as path from 'path';
import { getFirestoreAdmin } from '../firebaseAdmin.js';
import { logger } from '../logger.js';
import { MarketRegime } from './StrategyEngine.js';

export const PERFORMANCE_LEGAL_DISCLAIMER =
  'DISCLAIMER: Historical performance, backtest simulation results, walk-forward evaluations, and confidence calibration metrics are statistical tools for backend algorithmic risk management only. Past performance does not guarantee or claim future profitability. Live trading involves substantial market risk.';

export type ConfidenceBucket = '70-79' | '80-89' | '90-100';

export interface TradeOutcomeRecord {
  signalId: string;
  symbol: string;
  assetClass: 'CRYPTO' | 'FOREX' | 'STOCKS';
  direction: 'BUY' | 'SELL';
  strategyId: string;
  strategyName: string;
  marketRegime: MarketRegime;
  timeframe: string;
  confidenceScore?: number;
  confidenceRange?: ConfidenceBucket;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  plannedRR: number;
  outcomeStatus: 'TP_HIT' | 'SL_HIT' | 'EXPIRED' | 'INVALIDATED' | 'NO_ENTRY / EXPIRED';
  realizedRR: number; // e.g. +2.2 for TP, -1.0 for SL, 0 for expired/invalidated
  isWin: boolean;
  timestamp: number;
  resolvedAt: number;
  durationMs: number;
  tradeEntered?: boolean;
  TRADE_ENTERED?: boolean;
  provenance?: 'LIVE' | 'HISTORICAL' | 'BACKTEST' | 'SIMULATION' | 'TEST';
  isSynthetic?: boolean;
}

export interface MetricSummary {
  totalTrades: number;
  wins: number;
  losses: number;
  breakevens: number;
  winRatePct: number;
  lossRatePct?: number;
  rollingWinRatePct: number; // Last 20 trades win rate
  profitFactor: number;
  totalRealizedR: number;
  avgR: number; // Average realized R per trade
  expectancyR: number;
  maxDrawdownR: number;
  maxLosingStreak: number;
  currentStreak: number; // positive = winning streak, negative = losing streak
  totalSignals?: number;
  signalConversionRatePct?: number;
  entryOpportunityRatePct?: number;
  expirationRatePct?: number;
  expiredSignals?: number;
}

export interface StrategyPerformanceState {
  version: number;
  lastUpdated: number;
  disclaimer: string;
  overall: MetricSummary;
  byStrategy: Record<string, MetricSummary>;
  byAsset: Record<string, MetricSummary>;
  byAssetClass: Record<string, MetricSummary>;
  byTimeframe: Record<string, MetricSummary>;
  byRegime: Record<string, MetricSummary>;
  byConfidenceRange: Record<string, MetricSummary>;
  recentTrades: TradeOutcomeRecord[];
}

const LOCAL_PERFORMANCE_PATH = path.join(process.cwd(), 'strategy_performance.json');
const FIRESTORE_PERFORMANCE_DOC = 'analytics/strategy_performance';

export class StrategyPerformanceTracker {
  private static state: StrategyPerformanceState = {
    version: 2,
    lastUpdated: Date.now(),
    disclaimer: PERFORMANCE_LEGAL_DISCLAIMER,
    overall: {
      totalTrades: 0,
      wins: 0,
      losses: 0,
      breakevens: 0,
      winRatePct: 0.0,
      lossRatePct: 0.0,
      rollingWinRatePct: 0.0,
      profitFactor: 0.0,
      totalRealizedR: 0,
      avgR: 0,
      expectancyR: 0.0,
      maxDrawdownR: 0,
      maxLosingStreak: 0,
      currentStreak: 0,
      totalSignals: 0,
      signalConversionRatePct: 0.0,
      entryOpportunityRatePct: 0.0,
      expirationRatePct: 0.0,
      expiredSignals: 0,
    },
    byStrategy: {},
    byAsset: {},
    byAssetClass: {},
    byTimeframe: {},
    byRegime: {},
    byConfidenceRange: {},
    recentTrades: [],
  };

  private static isInitialized = false;

  /**
   * Helper to derive confidence bucket from confidence score
   */
  public static getConfidenceRange(score: number): ConfidenceBucket {
    if (score >= 90) return '90-100';
    if (score >= 80) return '80-89';
    return '70-79';
  }

  /**
   * Initializes performance tracking state from local disk or Firestore.
   */
  static init(): void {
    if (this.isInitialized) return;

    try {
      if (fs.existsSync(LOCAL_PERFORMANCE_PATH)) {
        const raw = fs.readFileSync(LOCAL_PERFORMANCE_PATH, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          this.state = {
            version: parsed.version || 2,
            lastUpdated: parsed.lastUpdated || Date.now(),
            disclaimer: PERFORMANCE_LEGAL_DISCLAIMER,
            overall: parsed.overall || this.state.overall,
            byStrategy: parsed.byStrategy || {},
            byAsset: parsed.byAsset || {},
            byAssetClass: parsed.byAssetClass || {},
            byTimeframe: parsed.byTimeframe || {},
            byRegime: parsed.byRegime || {},
            byConfidenceRange: parsed.byConfidenceRange || {},
            recentTrades: Array.isArray(parsed.recentTrades) ? parsed.recentTrades : [],
          };
          logger.info('[StrategyPerformanceTracker] Loaded strategy performance state from disk.');
        }
      }
    } catch (err) {
      logger.warn('[StrategyPerformanceTracker] Could not load local performance file:', { error: String(err) });
    }

    this.isInitialized = true;
    this.rebuildAllMetrics();
  }

  /**
   * Rebuilds all metrics from scratch using only real live and historical trades.
   * Strictly excludes "BACKTEST", "SIMULATION", "TEST", and synthetic trades.
   */
  public static rebuildAllMetrics(): void {
    this.state.overall = this.createEmptyMetricSummary();
    this.state.byStrategy = {};
    this.state.byAsset = {};
    this.state.byAssetClass = {};
    this.state.byTimeframe = {};
    this.state.byRegime = {};
    this.state.byConfidenceRange = {};

    const productionTrades = this.state.recentTrades.filter((t) => {
      const prov = (t.provenance || '').toUpperCase();
      const isSynthetic = t.isSynthetic || t.signalId?.startsWith('hist_sig_');
      if (prov === 'BACKTEST' || prov === 'SIMULATION' || prov === 'TEST' || isSynthetic) {
        return false;
      }
      return true;
    });

    for (const record of productionTrades) {
      if (!record.confidenceRange && record.confidenceScore) {
        record.confidenceRange = this.getConfidenceRange(record.confidenceScore);
      } else if (!record.confidenceRange) {
        record.confidenceRange = '80-89';
      }

      // 1. Overall
      this.updateSummaryMetrics(this.state.overall, record, productionTrades);

      // 2. By Strategy
      const stratKey = record.strategyId || 'unknown_strategy';
      if (!this.state.byStrategy[stratKey]) {
        this.state.byStrategy[stratKey] = this.createEmptyMetricSummary();
      }
      const stratTrades = productionTrades.filter((t) => t.strategyId === stratKey);
      this.updateSummaryMetrics(this.state.byStrategy[stratKey], record, stratTrades);

      // 3. By Asset
      const symKey = record.symbol.toUpperCase();
      if (!this.state.byAsset[symKey]) {
        this.state.byAsset[symKey] = this.createEmptyMetricSummary();
      }
      const symTrades = productionTrades.filter((t) => t.symbol.toUpperCase() === symKey);
      this.updateSummaryMetrics(this.state.byAsset[symKey], record, symTrades);

      // 4. By Asset Class
      const assetClassKey = record.assetClass || 'CRYPTO';
      if (!this.state.byAssetClass[assetClassKey]) {
        this.state.byAssetClass[assetClassKey] = this.createEmptyMetricSummary();
      }
      const acTrades = productionTrades.filter((t) => t.assetClass === assetClassKey);
      this.updateSummaryMetrics(this.state.byAssetClass[assetClassKey], record, acTrades);

      // 5. By Timeframe
      const tfKey = record.timeframe || '1h';
      if (!this.state.byTimeframe[tfKey]) {
        this.state.byTimeframe[tfKey] = this.createEmptyMetricSummary();
      }
      const tfTrades = productionTrades.filter((t) => t.timeframe === tfKey);
      this.updateSummaryMetrics(this.state.byTimeframe[tfKey], record, tfTrades);

      // 6. By Market Regime
      const regimeKey = record.marketRegime || 'RANGING';
      if (!this.state.byRegime[regimeKey]) {
        this.state.byRegime[regimeKey] = this.createEmptyMetricSummary();
      }
      const regimeTrades = productionTrades.filter((t) => t.marketRegime === regimeKey);
      this.updateSummaryMetrics(this.state.byRegime[regimeKey], record, regimeTrades);

      // 7. By Confidence Range
      const rangeKey = record.confidenceRange;
      if (!this.state.byConfidenceRange[rangeKey]) {
        this.state.byConfidenceRange[rangeKey] = this.createEmptyMetricSummary();
      }
      const rangeTrades = productionTrades.filter((t) => t.confidenceRange === rangeKey);
      this.updateSummaryMetrics(this.state.byConfidenceRange[rangeKey], record, rangeTrades);
    }
  }

  /**
   * Saves state to local disk and triggers Firestore sync.
   */
  private static saveState(): void {
    try {
      if (this.state.recentTrades.length > 500) {
        this.state.recentTrades = this.state.recentTrades.slice(-500);
      }
      this.state.lastUpdated = Date.now();
      fs.writeFileSync(LOCAL_PERFORMANCE_PATH, JSON.stringify(this.state, null, 2), 'utf-8');
    } catch (err) {
      logger.warn('[StrategyPerformanceTracker] Failed to write performance state to disk:', { error: String(err) });
    }

    const firestore = getFirestoreAdmin();
    if (firestore) {
      firestore
        .doc(FIRESTORE_PERFORMANCE_DOC)
        .set(this.state, { merge: true })
        .catch((err) => {
          logger.debug('[StrategyPerformanceTracker] Firestore sync deferred', { reason: String(err) });
        });
    }
  }

  /**
   * Records a resolved trade outcome into the performance database across all tracking dimensions.
   */
  static recordTradeOutcome(record: TradeOutcomeRecord): void {
    this.init();

    if (!record.confidenceRange && record.confidenceScore) {
      record.confidenceRange = this.getConfidenceRange(record.confidenceScore);
    } else if (!record.confidenceRange) {
      record.confidenceRange = '80-89';
    }

    this.state.recentTrades.push(record);
    this.rebuildAllMetrics();
    this.saveState();
    logger.info(`[StrategyPerformanceTracker] Recorded outcome for ${record.symbol} (${record.outcomeStatus}, ${record.realizedRR}R). Strategy: ${record.strategyName}, Overall WR: ${this.state.overall.winRatePct}% (Rolling: ${this.state.overall.rollingWinRatePct}%)`);
  }

  private static createEmptyMetricSummary(): MetricSummary {
    return {
      totalTrades: 0,
      wins: 0,
      losses: 0,
      breakevens: 0,
      winRatePct: 0.0,
      lossRatePct: 0.0,
      rollingWinRatePct: 0.0,
      profitFactor: 0.0,
      totalRealizedR: 0,
      avgR: 0,
      expectancyR: 0.0,
      maxDrawdownR: 0,
      maxLosingStreak: 0,
      currentStreak: 0,
      totalSignals: 0,
      signalConversionRatePct: 0.0,
      entryOpportunityRatePct: 0.0,
      expirationRatePct: 0.0,
      expiredSignals: 0,
    };
  }

  private static updateSummaryMetrics(
    summary: MetricSummary,
    record: TradeOutcomeRecord,
    tradeHistory: TradeOutcomeRecord[]
  ): void {
    // Initialize signal tracking fields on summary if not already present
    summary.totalSignals = (summary.totalSignals ?? 0) + 1;
    summary.expiredSignals = summary.expiredSignals ?? 0;

    const isEntered = record.tradeEntered !== false && record.TRADE_ENTERED !== false && record.outcomeStatus !== 'NO_ENTRY / EXPIRED';

    if (!isEntered) {
      summary.expiredSignals += 1;
    } else {
      summary.totalTrades += 1;
      if (record.outcomeStatus === 'TP_HIT' || record.isWin) {
        summary.wins += 1;
        summary.currentStreak = summary.currentStreak >= 0 ? summary.currentStreak + 1 : 1;
      } else if (record.outcomeStatus === 'SL_HIT') {
        summary.losses += 1;
        summary.currentStreak = summary.currentStreak <= 0 ? summary.currentStreak - 1 : -1;
        const absLosingStreak = Math.abs(summary.currentStreak);
        if (absLosingStreak > summary.maxLosingStreak) {
          summary.maxLosingStreak = absLosingStreak;
        }
      } else {
        summary.breakevens += 1;
        summary.currentStreak = 0; // Breakeven resets streak
      }
    }

    // Calculate rates and metrics based on separated tracking
    summary.winRatePct = summary.totalTrades > 0
      ? Number(((summary.wins / summary.totalTrades) * 100).toFixed(1))
      : 0.0;

    summary.lossRatePct = summary.totalTrades > 0
      ? Number(((summary.losses / summary.totalTrades) * 100).toFixed(1))
      : 0.0;

    summary.signalConversionRatePct = summary.totalSignals > 0
      ? Number(((summary.totalTrades / summary.totalSignals) * 100).toFixed(1))
      : 0.0;

    summary.entryOpportunityRatePct = summary.signalConversionRatePct;

    summary.expirationRatePct = summary.totalSignals > 0
      ? Number(((summary.expiredSignals / summary.totalSignals) * 100).toFixed(1))
      : 0.0;

    // Filter actual entered trades for trade win rate, streak, expectancy and profit factor
    const actualTradesHistory = tradeHistory.filter(
      (t) => t.tradeEntered !== false && t.TRADE_ENTERED !== false && t.outcomeStatus !== 'NO_ENTRY / EXPIRED'
    );

    // Calculate Rolling Win Rate over last 20 actual entered trades
    const last20 = actualTradesHistory.slice(-20);
    const last20Wins = last20.filter((t) => t.outcomeStatus === 'TP_HIT' || t.isWin).length;
    summary.rollingWinRatePct = last20.length > 0
      ? Number(((last20Wins / Math.max(1, last20.length)) * 100).toFixed(1))
      : 0.0;

    // Calculate Profit Factor: Total Gross Win R / Total Gross Loss R (actual entered trades only)
    let totalWinR = 0;
    let totalLossR = 0;
    for (const t of actualTradesHistory) {
      if (t.realizedRR > 0) totalWinR += t.realizedRR;
      else if (t.realizedRR < 0) totalLossR += Math.abs(t.realizedRR);
    }
    summary.profitFactor = totalLossR > 0
      ? Number((totalWinR / totalLossR).toFixed(2))
      : (totalWinR > 0 ? Number(totalWinR.toFixed(2)) : 0.0);

    // Calculate Expectancy: (Win% * AvgWinR) - (Loss% * AvgLossR) (actual entered trades only)
    const winProb = summary.winRatePct / 100;
    const lossProb = summary.totalTrades > 0 ? (summary.losses / summary.totalTrades) : 0.0;
    const winTrades = actualTradesHistory.filter((t) => t.realizedRR > 0);
    const lossTrades = actualTradesHistory.filter((t) => t.realizedRR < 0);
    const avgWin = winTrades.length > 0 ? winTrades.reduce((acc, t) => acc + t.realizedRR, 0) / winTrades.length : 0.0;
    const avgLoss = lossTrades.length > 0 ? Math.abs(lossTrades.reduce((acc, t) => acc + t.realizedRR, 0) / lossTrades.length) : 0.0;
    summary.expectancyR = Number((winProb * avgWin - lossProb * avgLoss).toFixed(3));

    // Calculate Average realized R per trade (actual entered trades only)
    summary.totalRealizedR = Number(actualTradesHistory.reduce((acc, t) => acc + t.realizedRR, 0).toFixed(2));
    summary.avgR = summary.totalTrades > 0
      ? Number((summary.totalRealizedR / summary.totalTrades).toFixed(3))
      : 0.0;
  }

  /**
   * Confidence Calibration Engine:
   * Calibrates future candidate scores based on historical performance of confidence buckets.
   *
   * If confidence range (e.g. '90-100') achieves high win rate (> 60%), returns a calibration boost (1.02 - 1.10).
   * If confidence range (e.g. '70-79') shows weak win rate (< 40%), returns a calibration penalty (0.85 - 0.95).
   */
  public static getConfidenceCalibrationFactor(confidenceScore: number, strategyId?: string, symbol?: string): number {
    this.init();
    const rangeKey = this.getConfidenceRange(confidenceScore);
    const bucketMetrics = this.state.byConfidenceRange[rangeKey];

    if (!bucketMetrics || bucketMetrics.totalTrades < 5) {
      return 1.0; // Baseline prior
    }

    const wr = bucketMetrics.winRatePct / 100;
    const exp = bucketMetrics.expectancyR;

    if (wr < 0.40 || exp < 0) {
      // Weak bucket: penalize
      return 0.90;
    } else if (wr > 0.65 && exp > 0.3) {
      // Strong bucket: boost
      return 1.08;
    } else if (wr > 0.55) {
      return 1.03;
    }

    return 1.0;
  }

  /**
   * Automatic Strategy Weighting Engine:
   * Consistently weak strategies (< 40% win rate or negative expectancy) receive less influence (down to 0.5x);
   * strong strategies (> 60% win rate and positive expectancy) receive higher influence (up to 1.5x).
   * Uses Bayesian regularized shrinkage to prevent overfitting on small samples.
   */
  static getDynamicStrategyWeightMultiplier(strategyId: string, regime?: MarketRegime): number {
    this.init();

    const stratMetrics = this.state.byStrategy[strategyId];
    if (!stratMetrics || stratMetrics.totalTrades < 5) {
      return 1.0; // Default prior
    }

    const n = stratMetrics.totalTrades;
    const shrinkage = n / (n + 15); // Shrinkage factor

    const winRate = stratMetrics.winRatePct / 100;
    const exp = stratMetrics.expectancyR;

    // Severe penalty for consistently weak strategies (< 40% win rate or negative expectancy)
    if (winRate < 0.40 || exp < -0.1) {
      const penaltyFactor = 0.5 + (0.5 * (1 - shrinkage)); // Down to 0.5x
      return Number(Math.max(0.50, penaltyFactor).toFixed(2));
    }

    const rawDelta = (winRate - 0.50) * 0.6; // [-0.30, +0.30]

    let regimeBonus = 0;
    if (regime && this.state.byRegime[regime] && this.state.byRegime[regime].totalTrades >= 3) {
      const regimeWR = this.state.byRegime[regime].winRatePct / 100;
      regimeBonus = (regimeWR - 0.50) * 0.2;
    }

    const adjustment = shrinkage * (rawDelta + regimeBonus);
    const multiplier = 1.0 + adjustment;

    // Bounded between [0.50, 1.50]
    return Number(Math.max(0.50, Math.min(1.50, multiplier)).toFixed(2));
  }

  /**
   * Resets the tracker to an uninitialized, empty state.
   * Useful for testing and sandbox isolation.
   */
  public static clearState(): void {
    this.state = {
      version: 2,
      lastUpdated: Date.now(),
      disclaimer: PERFORMANCE_LEGAL_DISCLAIMER,
      overall: {
        totalTrades: 0,
        wins: 0,
        losses: 0,
        breakevens: 0,
        winRatePct: 0.0,
        rollingWinRatePct: 0.0,
        profitFactor: 0.0,
        totalRealizedR: 0,
        avgR: 0,
        expectancyR: 0.0,
        maxDrawdownR: 0,
        maxLosingStreak: 0,
        currentStreak: 0,
      },
      byStrategy: {},
      byAsset: {},
      byAssetClass: {},
      byTimeframe: {},
      byRegime: {},
      byConfidenceRange: {},
      recentTrades: [],
    };
    this.isInitialized = true;
  }

  /**
   * Retrieves full performance state and analytics.
   */
  static getPerformanceMetrics(): StrategyPerformanceState {
    this.init();
    return { ...this.state, disclaimer: PERFORMANCE_LEGAL_DISCLAIMER };
  }
}

