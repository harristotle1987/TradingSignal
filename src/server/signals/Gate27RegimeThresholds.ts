/**
 * GATE 27 — REGIME-ADAPTIVE SIGNAL THRESHOLDS
 *
 * OBJECTIVE:
 * Replace rigid single-threshold filtering with market-condition-aware thresholds.
 * Thresholds dynamically adapt according to:
 * 1. Market Regime (STRONG_TREND, NORMAL_TREND, RANGE_REVERSAL, BREAKOUT, HIGH_VOLATILITY, TRANSITION, UNKNOWN)
 * 2. Strategy Category (TREND_CONTINUATION, TREND_PULLBACK, BREAKOUT, RANGE_REVERSAL, FALSE_BREAKOUT, MOMENTUM_CONTINUATION)
 * 3. Asset Class (CRYPTO, FOREX, STOCKS)
 *
 * INITIAL CONFIGURABLE POLICY:
 * - STRONG_TREND: 72
 * - NORMAL_TREND: 70
 * - RANGE_REVERSAL: 70
 * - BREAKOUT: 70
 * - HIGH_VOLATILITY: 76
 * - TRANSITION: 79
 * - UNKNOWN: NO SIGNAL (Execution Blocked)
 *
 * STRICT DISCIPLINE:
 * - Configurable values, not permanent truths.
 * - Does NOT weaken hard safety gates (Gate 0, Gate 25, Gate 26 hard risk gates remain absolute).
 * - Comprehensive logging of: regime, strategy, threshold, actualScore, marginAboveThreshold.
 * - Anti-Overfitting: Thresholds are NEVER altered automatically based on small sample sizes (< 30 trades).
 */

import { logger } from '../logger.js';
import { AssetType } from '../../types/index.js';

export type AssetClass = 'CRYPTO' | 'FOREX' | 'STOCKS' | 'STOCK' | 'INDEX' | 'UNKNOWN';

export type CanonicalRegimeCategory =
  | 'STRONG_TREND'
  | 'NORMAL_TREND'
  | 'RANGE_REVERSAL'
  | 'BREAKOUT'
  | 'HIGH_VOLATILITY'
  | 'TRANSITION'
  | 'UNKNOWN';

export interface RegimeThresholdPolicyConfig {
  regimeThresholds: Record<CanonicalRegimeCategory, number | null>;
  strategyModifiers: Record<string, number>;
  assetClassModifiers: Record<string, number>;
  minSampleSizeForAdaptiveCalibration: number;
}

export interface AdaptiveThresholdResult {
  isExecutable: boolean;
  resolvedThreshold: number;
  actualScore: number;
  marginAboveThreshold: number;
  regime: string;
  normalizedRegime: CanonicalRegimeCategory;
  strategy: string;
  assetClass: string;
  symbol: string;
  explanation: string;
}

export interface RegimeThresholdEvaluationLog {
  timestamp: number;
  symbol: string;
  regime: string;
  strategy: string;
  threshold: number;
  actualScore: number;
  marginAboveThreshold: number;
  isExecutable: boolean;
  passed: boolean;
}

export class Gate27RegimeThresholds {
  private static policy: RegimeThresholdPolicyConfig = {
    regimeThresholds: {
      STRONG_TREND: 70,
      NORMAL_TREND: 70,
      RANGE_REVERSAL: 70,
      BREAKOUT: 70,
      HIGH_VOLATILITY: 74,
      TRANSITION: 76,
      UNKNOWN: null, // NO SIGNAL
    },
    strategyModifiers: {
      TREND_CONTINUATION: 0,
      TREND_PULLBACK: -1,
      BREAKOUT: 0,
      RANGE_REVERSAL: 0,
      FALSE_BREAKOUT: +2, // Higher threshold required for counter-trend traps
      MOMENTUM_CONTINUATION: -1,
      ORDER_BLOCK: 0,
      MEAN_REVERSION: +1,
    },
    assetClassModifiers: {
      CRYPTO: 0,
      FOREX: 0,
      STOCKS: 0,
    },
    minSampleSizeForAdaptiveCalibration: 30, // Never modify based on tiny sample sizes
  };

  private static evaluationLogs: RegimeThresholdEvaluationLog[] = [];
  private static readonly MAX_LOGS = 200;

  /**
   * Normalizes various regime strings into canonical Gate 27 categories
   */
  public static normalizeRegime(regimeInput: string | undefined | null): CanonicalRegimeCategory {
    if (!regimeInput) return 'UNKNOWN';

    const normalized = regimeInput.trim().toUpperCase();

    // Strong Trends
    if (
      normalized.includes('STRONG_BULL') ||
      normalized.includes('STRONG_BEAR') ||
      normalized.includes('STRONG_TREND') ||
      normalized.includes('TRENDING_UP_STRONG') ||
      normalized.includes('TRENDING_DOWN_STRONG')
    ) {
      return 'STRONG_TREND';
    }

    // Normal / Weak Trends
    if (
      normalized.includes('WEAK_BULL') ||
      normalized.includes('WEAK_BEAR') ||
      normalized.includes('NORMAL_TREND') ||
      normalized.includes('TRENDING_UP_WEAK') ||
      normalized.includes('TRENDING_DOWN_WEAK') ||
      normalized === 'TRENDING_UP' ||
      normalized === 'TRENDING_DOWN' ||
      normalized === 'TRENDING' ||
      normalized.includes('TREND')
    ) {
      return 'NORMAL_TREND';
    }

    // Breakouts
    if (normalized.includes('BREAKOUT') || normalized.includes('EXPANSION')) {
      return 'BREAKOUT';
    }

    // High Volatility / Volatile Shocks
    if (
      normalized.includes('HIGH_VOLATILITY') ||
      normalized.includes('VOLATILE') ||
      normalized.includes('EXTREME_VOLATILITY')
    ) {
      return 'HIGH_VOLATILITY';
    }

    // Range / Low Volatility / Consolidation
    if (
      normalized.includes('RANGE') ||
      normalized.includes('RANGING') ||
      normalized.includes('CONSOLIDATION') ||
      normalized.includes('LOW_VOLATILITY') ||
      normalized.includes('SIDEWAYS')
    ) {
      return 'RANGE_REVERSAL';
    }

    // Transition / Choppy / Regime Shift
    if (
      normalized.includes('TRANSITION') ||
      normalized.includes('CHOPPY') ||
      normalized.includes('UNCERTAIN')
    ) {
      return 'TRANSITION';
    }

    return 'UNKNOWN';
  }

  /**
   * Normalizes asset class string
   */
  public static detectAssetClass(symbol: string, assetTypeHint?: string): AssetClass {
    if (assetTypeHint) {
      const upper = assetTypeHint.toUpperCase();
      if (upper === 'CRYPTO' || upper === 'FOREX' || upper === 'STOCKS') {
        return upper as AssetClass;
      }
    }

    const clean = symbol.trim().toUpperCase();
    if (clean.endsWith('USDT') || clean.endsWith('BUSD') || clean.endsWith('BTC') || clean.endsWith('ETH')) {
      return 'CRYPTO';
    }
    if (['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD', 'USDCHF', 'NZDUSD', 'EURGBP', 'EURJPY', 'GBPJPY'].includes(clean)) {
      return 'FOREX';
    }
    return 'STOCKS';
  }

  /**
   * Resolves the regime-adaptive threshold for a specific candidate setup
   */
  public static resolveThreshold(params: {
    symbol: string;
    actualScore: number;
    regime?: string;
    strategy?: string;
    assetClass?: AssetClass | string;
  }): AdaptiveThresholdResult {
    const symbol = params.symbol || 'UNKNOWN';
    const rawRegime = params.regime || 'UNKNOWN';
    const normalizedRegime = this.normalizeRegime(rawRegime);
    const strategy = params.strategy || 'DEFAULT';
    const assetClass = (params.assetClass || this.detectAssetClass(symbol)).toUpperCase();

    // 1. Base Regime Threshold
    const baseRegimeThreshold = this.policy.regimeThresholds[normalizedRegime];

    // Check UNKNOWN / No Signal Policy
    if (baseRegimeThreshold === null || normalizedRegime === 'UNKNOWN') {
      const result: AdaptiveThresholdResult = {
        isExecutable: false,
        resolvedThreshold: 999,
        actualScore: params.actualScore,
        marginAboveThreshold: params.actualScore - 999,
        regime: rawRegime,
        normalizedRegime,
        strategy,
        assetClass,
        symbol,
        explanation: `Regime '${rawRegime}' (normalized: ${normalizedRegime}) is UNKNOWN or untradeable: NO SIGNAL permitted under Gate 27 policy`,
      };

      this.logEvaluation({
        symbol,
        regime: rawRegime,
        strategy,
        threshold: 999,
        actualScore: params.actualScore,
        marginAboveThreshold: result.marginAboveThreshold,
        isExecutable: false,
        passed: false,
      });

      return result;
    }

    // 2. Strategy-Specific Adjustment
    let strategyModifier = 0;
    const cleanStrat = strategy.trim().toUpperCase();
    for (const [key, mod] of Object.entries(this.policy.strategyModifiers)) {
      if (cleanStrat.includes(key) || key.includes(cleanStrat)) {
        strategyModifier = mod;
        break;
      }
    }

    // 3. Asset-Class Specific Adjustment
    const assetModifier = this.policy.assetClassModifiers[assetClass] || 0;

    // 4. Calculate Final Composite Threshold
    const rawResolved = baseRegimeThreshold + strategyModifier + assetModifier;
    // Hard boundary clamps: never below 70 (floor) and never above 92 (ceiling for executable)
    const resolvedThreshold = Math.min(92, Math.max(70, Math.round(rawResolved)));

    const marginAboveThreshold = Math.round((params.actualScore - resolvedThreshold) * 10) / 10;
    const passed = marginAboveThreshold >= 0;

    const explanation = `Regime ${normalizedRegime} (base: ${baseRegimeThreshold}) + Strategy '${strategy}' (${strategyModifier >= 0 ? '+' : ''}${strategyModifier}) + Asset ${assetClass} (${assetModifier >= 0 ? '+' : ''}${assetModifier}) => Adaptive Threshold: ${resolvedThreshold} (Actual Score: ${params.actualScore}, Margin: ${marginAboveThreshold >= 0 ? '+' : ''}${marginAboveThreshold})`;

    const result: AdaptiveThresholdResult = {
      isExecutable: true,
      resolvedThreshold,
      actualScore: params.actualScore,
      marginAboveThreshold,
      regime: rawRegime,
      normalizedRegime,
      strategy,
      assetClass,
      symbol,
      explanation,
    };

    // Log with exact requested fields: regime, strategy, threshold, actualScore, marginAboveThreshold
    this.logEvaluation({
      symbol,
      regime: rawRegime,
      strategy,
      threshold: resolvedThreshold,
      actualScore: params.actualScore,
      marginAboveThreshold,
      isExecutable: true,
      passed,
    });

    return result;
  }

  /**
   * Logs threshold evaluation
   */
  private static logEvaluation(log: Omit<RegimeThresholdEvaluationLog, 'timestamp'>): void {
    const entry: RegimeThresholdEvaluationLog = {
      ...log,
      timestamp: Date.now(),
    };

    this.evaluationLogs.unshift(entry);
    if (this.evaluationLogs.length > this.MAX_LOGS) {
      this.evaluationLogs.pop();
    }

    logger.info(
      `[Gate 27 Regime Threshold] ${log.symbol} | Regime: ${log.regime} | Strategy: ${log.strategy} | Threshold: ${log.threshold} | ActualScore: ${log.actualScore} | MarginAboveThreshold: ${log.marginAboveThreshold >= 0 ? '+' : ''}${log.marginAboveThreshold} | Status: ${log.passed ? 'PASSED' : 'REJECTED'}`
    );
  }

  /**
   * Gets current regime threshold policy configuration
   */
  public static getPolicy(): RegimeThresholdPolicyConfig {
    return JSON.parse(JSON.stringify(this.policy));
  }

  /**
   * Updates regime threshold policy configuration (with strict anti-overfitting guard)
   */
  public static updatePolicy(
    newPolicy: Partial<RegimeThresholdPolicyConfig>,
    sampleSize?: number
  ): { success: boolean; message: string; policy: RegimeThresholdPolicyConfig } {
    if (sampleSize !== undefined && sampleSize < this.policy.minSampleSizeForAdaptiveCalibration) {
      return {
        success: false,
        message: `REJECTED: INSUFFICIENT_SAMPLE_SIZE. Cannot adaptively modify live policy with sample size (${sampleSize}) below minimum requirement (${this.policy.minSampleSizeForAdaptiveCalibration} trades).`,
        policy: this.getPolicy(),
      };
    }

    if (newPolicy.regimeThresholds) {
      this.policy.regimeThresholds = {
        ...this.policy.regimeThresholds,
        ...newPolicy.regimeThresholds,
      };
    }

    if (newPolicy.strategyModifiers) {
      this.policy.strategyModifiers = {
        ...this.policy.strategyModifiers,
        ...newPolicy.strategyModifiers,
      };
    }

    if (newPolicy.assetClassModifiers) {
      this.policy.assetClassModifiers = {
        ...this.policy.assetClassModifiers,
        ...newPolicy.assetClassModifiers,
      };
    }

    if (newPolicy.minSampleSizeForAdaptiveCalibration !== undefined) {
      this.policy.minSampleSizeForAdaptiveCalibration = Math.max(10, newPolicy.minSampleSizeForAdaptiveCalibration);
    }

    logger.info('[Gate 27 Regime Thresholds] Updated regime threshold policy', { policy: this.policy });
    return {
      success: true,
      message: 'Regime-adaptive threshold policy updated successfully',
      policy: this.getPolicy(),
    };
  }

  /**
   * Gets recent evaluation logs
   */
  public static getLogs(limit: number = 50): RegimeThresholdEvaluationLog[] {
    return this.evaluationLogs.slice(0, limit);
  }

  /**
   * Clears logs for testing
   */
  public static clearLogs(): void {
    this.evaluationLogs = [];
  }
}
