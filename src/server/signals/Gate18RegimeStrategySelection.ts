/**
 * Gate 18: Regime-Specific Strategy Selection Engine
 *
 * Prevents using the same strategy for every market condition.
 * 
 * Strategy categories:
 * 1. TREND_CONTINUATION
 * 2. TREND_PULLBACK
 * 3. BREAKOUT
 * 4. FALSE_BREAKOUT (Liquidity Sweep / Mean Trap)
 * 5. RANGE_REVERSAL
 * 6. MOMENTUM_CONTINUATION
 *
 * Workflow:
 * 1. Uses existing regime classification (Gate 1 & StrategyEngine)
 * 2. Determines eligible and preferred strategies for the detected regime
 * 3. Selects the highest priority compatible strategy without inventing new entry rules
 * 4. Integrates historical performance tracking to deprioritize strategies with poor track record in current regime
 * 5. Exposes: selectedStrategy, eligibleStrategies, strategyCompatibilityScore, regimeStrategyMatch
 */

import { Gate1Regime } from './Gate1MarketRegime.js';
import { MarketRegime } from './StrategyEngine.js';
import { StrategyPerformanceTracker } from './StrategyPerformanceTracker.js';
import { Gate19RegimePerformanceMatrix } from './Gate19RegimePerformanceMatrix.js';

export type StrategyCategory =
  | 'TREND_CONTINUATION'
  | 'TREND_PULLBACK'
  | 'BREAKOUT'
  | 'FALSE_BREAKOUT'
  | 'RANGE_REVERSAL'
  | 'MOMENTUM_CONTINUATION';

export type RegimeStrategyMatchLevel = 'OPTIMAL' | 'COMPATIBLE' | 'SUBOPTIMAL' | 'INCOMPATIBLE';

export interface Gate18SelectionResult {
  selectedStrategy: StrategyCategory;
  eligibleStrategies: StrategyCategory[];
  strategyCompatibilityScore: number; // 0 - 100
  regimeStrategyMatch: RegimeStrategyMatchLevel;
  marketRegime: string;
  reasons: string[];
  summary: string;
}

export interface StrategySelectionInput {
  symbol: string;
  regime: MarketRegime | Gate1Regime | string;
  candidateStrategyName?: string;
  strategyCategoryHint?: StrategyCategory;
  hasBreakoutConfirmation?: boolean;
  hasPullbackConfirmation?: boolean;
  hasLiquiditySweep?: boolean;
}

// Canonical Regime Strategy Mapping Table
interface RegimePreference {
  preferred: StrategyCategory[];
  acceptable: StrategyCategory[];
  incompatible: StrategyCategory[];
  defaultStrategy: StrategyCategory;
}

const REGIME_PREFERENCE_TABLE: Record<string, RegimePreference> = {
  STRONG_BULL_TREND: {
    preferred: ['TREND_CONTINUATION', 'TREND_PULLBACK'],
    acceptable: ['MOMENTUM_CONTINUATION', 'BREAKOUT'],
    incompatible: ['RANGE_REVERSAL', 'FALSE_BREAKOUT'],
    defaultStrategy: 'TREND_CONTINUATION',
  },
  WEAK_BULL_TREND: {
    preferred: ['TREND_PULLBACK', 'TREND_CONTINUATION'],
    acceptable: ['BREAKOUT', 'MOMENTUM_CONTINUATION'],
    incompatible: ['RANGE_REVERSAL'],
    defaultStrategy: 'TREND_PULLBACK',
  },
  STRONG_BEAR_TREND: {
    preferred: ['TREND_CONTINUATION', 'TREND_PULLBACK'],
    acceptable: ['MOMENTUM_CONTINUATION', 'BREAKOUT'],
    incompatible: ['RANGE_REVERSAL', 'FALSE_BREAKOUT'],
    defaultStrategy: 'TREND_CONTINUATION',
  },
  WEAK_BEAR_TREND: {
    preferred: ['TREND_PULLBACK', 'TREND_CONTINUATION'],
    acceptable: ['BREAKOUT', 'MOMENTUM_CONTINUATION'],
    incompatible: ['RANGE_REVERSAL'],
    defaultStrategy: 'TREND_PULLBACK',
  },
  TRENDING: {
    preferred: ['TREND_CONTINUATION', 'TREND_PULLBACK'],
    acceptable: ['MOMENTUM_CONTINUATION', 'BREAKOUT'],
    incompatible: ['RANGE_REVERSAL'],
    defaultStrategy: 'TREND_CONTINUATION',
  },
  UPTREND: {
    preferred: ['TREND_CONTINUATION', 'TREND_PULLBACK'],
    acceptable: ['MOMENTUM_CONTINUATION', 'BREAKOUT'],
    incompatible: ['RANGE_REVERSAL'],
    defaultStrategy: 'TREND_CONTINUATION',
  },
  DOWNTREND: {
    preferred: ['TREND_CONTINUATION', 'TREND_PULLBACK'],
    acceptable: ['MOMENTUM_CONTINUATION', 'BREAKOUT'],
    incompatible: ['RANGE_REVERSAL'],
    defaultStrategy: 'TREND_CONTINUATION',
  },
  RANGE: {
    preferred: ['RANGE_REVERSAL', 'FALSE_BREAKOUT'],
    acceptable: ['TREND_PULLBACK'],
    incompatible: ['TREND_CONTINUATION', 'BREAKOUT'],
    defaultStrategy: 'RANGE_REVERSAL',
  },
  RANGING: {
    preferred: ['RANGE_REVERSAL', 'FALSE_BREAKOUT'],
    acceptable: ['TREND_PULLBACK'],
    incompatible: ['TREND_CONTINUATION', 'BREAKOUT'],
    defaultStrategy: 'RANGE_REVERSAL',
  },
  BREAKOUT: {
    preferred: ['BREAKOUT', 'MOMENTUM_CONTINUATION'],
    acceptable: ['TREND_CONTINUATION'],
    incompatible: ['RANGE_REVERSAL'],
    defaultStrategy: 'BREAKOUT',
  },
  HIGH_VOLATILITY: {
    preferred: ['BREAKOUT', 'FALSE_BREAKOUT', 'MOMENTUM_CONTINUATION'],
    acceptable: ['TREND_CONTINUATION'],
    incompatible: ['RANGE_REVERSAL'],
    defaultStrategy: 'BREAKOUT',
  },
  'HIGH-VOLATILITY': {
    preferred: ['BREAKOUT', 'FALSE_BREAKOUT', 'MOMENTUM_CONTINUATION'],
    acceptable: ['TREND_CONTINUATION'],
    incompatible: ['RANGE_REVERSAL'],
    defaultStrategy: 'BREAKOUT',
  },
  LOW_VOLATILITY: {
    preferred: ['RANGE_REVERSAL', 'FALSE_BREAKOUT'],
    acceptable: ['TREND_PULLBACK'],
    incompatible: ['MOMENTUM_CONTINUATION'],
    defaultStrategy: 'RANGE_REVERSAL',
  },
  'LOW-VOLATILITY': {
    preferred: ['RANGE_REVERSAL', 'FALSE_BREAKOUT'],
    acceptable: ['TREND_PULLBACK'],
    incompatible: ['MOMENTUM_CONTINUATION'],
    defaultStrategy: 'RANGE_REVERSAL',
  },
  TRANSITION: {
    preferred: ['TREND_PULLBACK', 'RANGE_REVERSAL'],
    acceptable: ['FALSE_BREAKOUT'],
    incompatible: ['MOMENTUM_CONTINUATION'],
    defaultStrategy: 'TREND_PULLBACK',
  },
  UNKNOWN: {
    preferred: ['TREND_PULLBACK', 'TREND_CONTINUATION'],
    acceptable: ['BREAKOUT', 'RANGE_REVERSAL', 'MOMENTUM_CONTINUATION', 'FALSE_BREAKOUT'],
    incompatible: [],
    defaultStrategy: 'TREND_PULLBACK',
  },
};

export class Gate18RegimeStrategySelection {
  /**
   * Maps freeform strategy names to canonical StrategyCategory
   */
  public static mapToCategory(strategyName?: string): StrategyCategory {
    if (!strategyName) return 'TREND_CONTINUATION';
    const norm = strategyName.toUpperCase();

    if (norm.includes('PULLBACK') || norm.includes('RETRACE')) {
      return 'TREND_PULLBACK';
    }
    if (norm.includes('FALSE_BREAKOUT') || norm.includes('SWEEP') || norm.includes('LIQUIDITY')) {
      return 'FALSE_BREAKOUT';
    }
    if (norm.includes('BREAKOUT') || norm.includes('EXPANSION')) {
      return 'BREAKOUT';
    }
    if (norm.includes('MEAN_REVERSION') || norm.includes('RANGE') || norm.includes('REVERSAL') || norm.includes('BOLLINGER')) {
      return 'RANGE_REVERSAL';
    }
    if (norm.includes('MOMENTUM') || norm.includes('MACD')) {
      return 'MOMENTUM_CONTINUATION';
    }
    return 'TREND_CONTINUATION';
  }

  /**
   * Evaluates strategy selection and compatibility for a given regime
   */
  public static selectStrategy(input: StrategySelectionInput): Gate18SelectionResult {
    const rawRegime = (input.regime || 'UNKNOWN').toUpperCase();
    const config = REGIME_PREFERENCE_TABLE[rawRegime] || REGIME_PREFERENCE_TABLE.UNKNOWN;

    const eligibleStrategies: StrategyCategory[] = [...config.preferred, ...config.acceptable];
    const candidateCategory = input.strategyCategoryHint || this.mapToCategory(input.candidateStrategyName);

    // Determine target selected strategy
    let selectedStrategy: StrategyCategory = candidateCategory || config.defaultStrategy;

    if (input.hasBreakoutConfirmation && eligibleStrategies.includes('BREAKOUT')) {
      selectedStrategy = 'BREAKOUT';
    } else if (input.hasPullbackConfirmation && eligibleStrategies.includes('TREND_PULLBACK')) {
      selectedStrategy = 'TREND_PULLBACK';
    } else if (input.hasLiquiditySweep && eligibleStrategies.includes('FALSE_BREAKOUT')) {
      selectedStrategy = 'FALSE_BREAKOUT';
    }

    // Determine compatibility score and match level
    let baseScore = 70;
    let matchLevel: RegimeStrategyMatchLevel = 'COMPATIBLE';

    if (config.preferred.includes(selectedStrategy)) {
      baseScore = 95;
      matchLevel = 'OPTIMAL';
    } else if (config.acceptable.includes(selectedStrategy)) {
      baseScore = 78;
      matchLevel = 'COMPATIBLE';
    } else if (config.incompatible.includes(selectedStrategy)) {
      baseScore = 30;
      matchLevel = 'INCOMPATIBLE';
    } else {
      baseScore = 55;
      matchLevel = 'SUBOPTIMAL';
    }

    // Historical Performance Calibration (Gate 19 Matrix & Performance Tracker)
    // Applied ONLY when sufficient sample size exists (Never alter weights from tiny samples)
    let performanceModifier = 0;
    try {
      const matrixCell = Gate19RegimePerformanceMatrix.getRegimeStrategyPerformance(selectedStrategy, rawRegime);
      if (matrixCell && (matrixCell.confidenceLevel === 'MODERATE_SAMPLE' || matrixCell.confidenceLevel === 'STATISTICALLY_SIGNIFICANT')) {
        performanceModifier = matrixCell.performanceModifier;
      } else {
        const perfState = StrategyPerformanceTracker.getPerformanceMetrics();
        if (perfState && perfState.byRegime) {
          const regimeMetrics = perfState.byRegime[rawRegime];
          if (regimeMetrics && regimeMetrics.totalTrades >= 25) {
            if (regimeMetrics.winRatePct < 40 || regimeMetrics.expectancyR < 0) {
              performanceModifier = -10;
            } else if (regimeMetrics.winRatePct >= 65 && regimeMetrics.expectancyR > 0.5) {
              performanceModifier = +5;
            }
          }
        }
      }
    } catch {
      // Non-blocking fallback if performance tracker state is initializing
    }

    const finalCompatibilityScore = Math.max(0, Math.min(100, baseScore + performanceModifier));

    // Update match level if modified by poor history
    if (finalCompatibilityScore < 45) {
      matchLevel = 'INCOMPATIBLE';
    } else if (finalCompatibilityScore < 70) {
      matchLevel = 'SUBOPTIMAL';
    } else if (finalCompatibilityScore >= 85) {
      matchLevel = 'OPTIMAL';
    } else {
      matchLevel = 'COMPATIBLE';
    }

    const reasons: string[] = [
      `Regime [${rawRegime}] mapped to strategy [${selectedStrategy}] (${matchLevel}, Score: ${finalCompatibilityScore}/100).`,
      `Eligible strategies for ${rawRegime}: ${eligibleStrategies.join(', ')}.`,
    ];

    if (performanceModifier !== 0) {
      reasons.push(`Historical regime performance modifier: ${performanceModifier > 0 ? '+' : ''}${performanceModifier}pts.`);
    }

    const summary = `Regime: ${rawRegime} | Strategy: ${selectedStrategy} | Match: ${matchLevel} (${finalCompatibilityScore}/100) | Eligible: [${eligibleStrategies.join(', ')}]`;

    return {
      selectedStrategy,
      eligibleStrategies,
      strategyCompatibilityScore: finalCompatibilityScore,
      regimeStrategyMatch: matchLevel,
      marketRegime: rawRegime,
      reasons,
      summary,
    };
  }
}
