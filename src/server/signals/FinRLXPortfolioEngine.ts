/**
 * FinRLXPortfolioEngine
 *
 * Isolated quantitative portfolio risk & allocation engine adapted from FinRL-Trading:
 * Official Repository: https://github.com/AI4Finance-Foundation/FinRL-Trading
 * Reference: "FinRL: Deep Reinforcement Learning for Quantitative Finance"
 *
 * CORE QUANTITATIVE CONCEPTS IMPLEMENTED:
 * 1. Portfolio Exposure:
 *    Computes gross exposure, net directional exposure (long vs. short skew),
 *    and overall portfolio leverage.
 * 2. Correlated-Position Exposure:
 *    Clusters positions by economic and market correlation (Crypto majors, US Tech,
 *    Forex USD, etc.) and penalizes concentrated correlated risk.
 * 3. Risk Overlay:
 *    Calculates parametric Value at Risk (VaR at 95% and 99%), Expected Shortfall (CVaR),
 *    and volatility-parity position scaling to adjust suggested position sizes.
 * 4. Strategy Allocation:
 *    Monitors and balances capital distribution across active trading strategies
 *    (e.g., Trend Confluence, Breakout Quality, Range Reversal, Liquidity Sweep).
 * 5. Portfolio-Level Constraints:
 *    Enforces institutional hard limits: maximum single-asset weight, cluster concentration
 *    caps, asset-class boundaries, and maximum concurrent active trades.
 *
 * STRICT GOVERNANCE:
 * - NO broker execution. The system remains strictly signal-only.
 * - Produces portfolio-level risk evidence and candidate sizing constraints.
 */

import { TradingSignal, SignalDirection } from '../../types/index.js';
import { Gate17CorrelationExposure } from './Gate17CorrelationExposure.js';
import { logger } from '../logger.js';

export interface PortfolioPosition {
  id: string;
  symbol: string;
  direction: SignalDirection;
  entryPrice: number;
  currentPrice: number;
  stopLoss: number;
  takeProfit: number;
  quantity: number;
  allocatedValue: number;
  strategy?: string;
  assetClass: 'CRYPTO' | 'FOREX' | 'STOCK' | 'INDEX';
  correlationCluster: string;
  openedAt: number;
}

export interface PortfolioExposureMetrics {
  totalEquity: number;
  allocatedCapital: number;
  cashBalance: number;
  grossExposure: number;      // Total absolute position value / equity
  netExposure: number;        // (Long value - Short value) / equity
  longExposure: number;       // Long value / equity
  shortExposure: number;      // Short value / equity
  activePositionCount: number;
}

export interface ClusterExposure {
  clusterName: string;
  symbols: string[];
  totalValue: number;
  clusterWeight: number;      // Fraction of total portfolio equity
  isConcentrated: boolean;    // Exceeds concentration threshold (e.g. > 35%)
}

export interface PortfolioRiskOverlay {
  parametricVaR95: number;     // 95% 1-day Value at Risk (fraction of equity)
  parametricVaR99: number;     // 99% 1-day Value at Risk (fraction of equity)
  expectedShortfall95: number; // Conditional VaR / Expected Shortfall
  portfolioVolatilityEst: number; // Horizon volatility estimate
  riskBudgetConsumedPct: number;
  recommendedScalingFactor: number; // 0.0 to 1.0 sizing dampener based on aggregate risk
}

export interface StrategyAllocation {
  strategyName: string;
  activeSignalsCount: number;
  allocatedValue: number;
  weightPct: number;
}

export interface PortfolioConstraints {
  maxSingleAssetWeight: number;    // Default: 0.15 (15% of equity)
  maxClusterWeight: number;        // Default: 0.35 (35% of equity in any cluster)
  maxAssetClassWeight: number;     // Default: 0.60 (60% in Crypto, Stock, etc.)
  maxGrossLeverage: number;        // Default: 1.0 (No borrowing/unfunded leverage)
  maxNetSkew: number;              // Default: 0.70 (Maximum long or short directional bias)
  maxConcurrentPositions: number;  // Default: 10 active signals
}

export interface PortfolioCandidateInput {
  symbol: string;
  direction: SignalDirection;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  suggestedRiskAmount?: number;
  suggestedPositionSize?: number;
  strategy?: string;
  assetClass?: 'CRYPTO' | 'FOREX' | 'STOCK' | 'INDEX';
  correlationCluster?: string;
}

export interface PortfolioCandidateEvaluation {
  symbol: string;
  allowed: boolean;
  constraintViolations: string[];
  suggestedSize: number;
  adjustedSize: number;
  sizeReductionFactor: number;
  clusterName: string;
  clusterWeightAfter: number;
  portfolioGrossExposureAfter: number;
  portfolioNetExposureAfter: number;
  evidence: {
    exposureMetrics: PortfolioExposureMetrics;
    riskOverlay: PortfolioRiskOverlay;
    clusterExposures: Record<string, ClusterExposure>;
    strategyAllocations: Record<string, StrategyAllocation>;
  };
}

export class FinRLXPortfolioEngine {
  private static readonly DEFAULT_EQUITY = 10_000;

  private static readonly DEFAULT_CONSTRAINTS: PortfolioConstraints = {
    maxSingleAssetWeight: 0.15,
    maxClusterWeight: 0.35,
    maxAssetClassWeight: 0.60,
    maxGrossLeverage: 1.0,
    maxNetSkew: 0.70,
    maxConcurrentPositions: 10,
  };

  /**
   * Evaluates a prospective trade signal candidate against current portfolio exposures
   * and risk constraints, outputting an allocation decision and size adjustment.
   */
  static evaluateCandidate(
    candidate: PortfolioCandidateInput,
    activePositions: PortfolioPosition[],
    customConstraints?: Partial<PortfolioConstraints>,
    totalEquity = this.DEFAULT_EQUITY
  ): PortfolioCandidateEvaluation {
    const constraints: PortfolioConstraints = {
      ...this.DEFAULT_CONSTRAINTS,
      ...customConstraints,
    };

    const cleanSym = candidate.symbol.trim().toUpperCase();
    const cluster = Gate17CorrelationExposure.identifyCluster(cleanSym);
    const clusterName = candidate.correlationCluster || cluster.name;
    const assetClass = candidate.assetClass || this.inferAssetClass(cleanSym);

    // 1. Calculate Current Portfolio State
    const exposure = this.calculateExposure(activePositions, totalEquity);
    const clusterExposures = this.calculateCorrelatedExposure(activePositions, totalEquity);
    const riskOverlay = this.evaluateRiskOverlay(activePositions, totalEquity);
    const strategyAllocations = this.evaluateStrategyAllocation(activePositions, totalEquity);

    // 2. Candidate Sizing Defaults
    const defaultNominal = totalEquity * 0.05; // 5% allocation default ($500 on $10k equity)
    const baseSize = candidate.suggestedPositionSize ||
      (candidate.suggestedRiskAmount ? candidate.suggestedRiskAmount / Math.max(0.01, Math.abs(candidate.entryPrice - candidate.stopLoss)) : (candidate.entryPrice > 0 ? defaultNominal / candidate.entryPrice : 1));
    const nominalValue = baseSize * candidate.entryPrice;

    // 3. Multi-Constraint Evaluation
    const violations: string[] = [];

    // Constraint A: Max Concurrent Positions
    if (activePositions.length >= constraints.maxConcurrentPositions) {
      violations.push(`Maximum concurrent positions reached (${activePositions.length}/${constraints.maxConcurrentPositions})`);
    }

    // Constraint B: Existing position on same symbol
    const existingSameSymbol = activePositions.find(p => p.symbol === cleanSym);
    if (existingSameSymbol) {
      violations.push(`Position already exists for ${cleanSym} (${existingSameSymbol.direction} @ ${existingSameSymbol.entryPrice})`);
    }

    // Constraint C: Single-Asset Allocation Cap
    const candidateWeight = nominalValue / totalEquity;
    if (candidateWeight > constraints.maxSingleAssetWeight * 1.5) {
      violations.push(`Single-asset allocation ($${nominalValue.toFixed(2)}, ${(candidateWeight * 100).toFixed(1)}%) exceeds maximum cap (${(constraints.maxSingleAssetWeight * 100).toFixed(1)}%)`);
    }

    // Constraint D: Correlation Cluster Concentration Cap
    const currentClusterValue = clusterExposures[clusterName]?.totalValue || 0;
    const clusterValueAfter = currentClusterValue + nominalValue;
    const clusterWeightAfter = clusterValueAfter / totalEquity;
    if (clusterWeightAfter > constraints.maxClusterWeight) {
      violations.push(`Correlation cluster "${clusterName}" exposure (${(clusterWeightAfter * 100).toFixed(1)}%) would breach max limit (${(constraints.maxClusterWeight * 100).toFixed(1)}%)`);
    }

    // Constraint E: Asset-Class Cap
    const currentAssetClassVal = activePositions
      .filter(p => p.assetClass === assetClass)
      .reduce((s, p) => s + p.allocatedValue, 0);
    const assetClassWeightAfter = (currentAssetClassVal + nominalValue) / totalEquity;
    if (assetClassWeightAfter > constraints.maxAssetClassWeight) {
      violations.push(`Asset class "${assetClass}" exposure (${(assetClassWeightAfter * 100).toFixed(1)}%) exceeds limit (${(constraints.maxAssetClassWeight * 100).toFixed(1)}%)`);
    }

    // Constraint F: Gross Leverage Cap
    const grossValAfter = exposure.allocatedCapital + nominalValue;
    const grossExposureAfter = grossValAfter / totalEquity;
    if (grossExposureAfter > constraints.maxGrossLeverage) {
      violations.push(`Total portfolio gross exposure (${(grossExposureAfter * 100).toFixed(1)}%) exceeds max leverage (${(constraints.maxGrossLeverage * 100).toFixed(1)}%)`);
    }

    // 4. Calculate Risk-Adjusted Sizing with Volatility & Correlation Dampeners
    let sizeMultiplier = riskOverlay.recommendedScalingFactor;

    // Apply cluster concentration penalty if approaching cluster boundary
    if (clusterWeightAfter > constraints.maxClusterWeight * 0.75) {
      sizeMultiplier *= 0.65;
    }

    // Apply net skew dampener if candidate reinforces an already skewed portfolio
    const currentNetSkew = Math.abs(exposure.netExposure);
    const candidateIsLong = candidate.direction === 'BUY';
    const netSkewWorsened = (exposure.netExposure > 0 && candidateIsLong) || (exposure.netExposure < 0 && !candidateIsLong);
    if (currentNetSkew > constraints.maxNetSkew * 0.70 && netSkewWorsened) {
      sizeMultiplier *= 0.70;
    }

    // Single-asset size clamp
    const maxAllowedNominalForAsset = totalEquity * constraints.maxSingleAssetWeight;
    const clampedNominal = Math.min(nominalValue * sizeMultiplier, maxAllowedNominalForAsset);
    const adjustedSize = candidate.entryPrice > 0 ? Number((clampedNominal / candidate.entryPrice).toFixed(4)) : baseSize;
    const sizeReductionFactor = baseSize > 0 ? Number((adjustedSize / baseSize).toFixed(4)) : 1.0;

    const allowed = violations.length === 0;

    const netValAfter = candidate.direction === 'BUY'
      ? (exposure.longExposure * totalEquity + nominalValue) - (exposure.shortExposure * totalEquity)
      : (exposure.longExposure * totalEquity) - (exposure.shortExposure * totalEquity + nominalValue);

    return {
      symbol: cleanSym,
      allowed,
      constraintViolations: violations,
      suggestedSize: baseSize,
      adjustedSize: allowed ? adjustedSize : 0,
      sizeReductionFactor: allowed ? sizeReductionFactor : 0,
      clusterName,
      clusterWeightAfter: Number(clusterWeightAfter.toFixed(4)),
      portfolioGrossExposureAfter: Number(grossExposureAfter.toFixed(4)),
      portfolioNetExposureAfter: Number((netValAfter / totalEquity).toFixed(4)),
      evidence: {
        exposureMetrics: exposure,
        riskOverlay,
        clusterExposures,
        strategyAllocations,
      },
    };
  }

  /**
   * Calculates aggregate gross, net, long, and short exposure across the portfolio.
   */
  static calculateExposure(positions: PortfolioPosition[], totalEquity: number): PortfolioExposureMetrics {
    let longVal = 0;
    let shortVal = 0;

    for (const p of positions) {
      if (p.direction === 'BUY') {
        longVal += p.allocatedValue;
      } else {
        shortVal += p.allocatedValue;
      }
    }

    const allocatedCapital = longVal + shortVal;
    const cashBalance = Math.max(0, totalEquity - allocatedCapital);
    const grossExposure = totalEquity > 0 ? allocatedCapital / totalEquity : 0;
    const netExposure = totalEquity > 0 ? (longVal - shortVal) / totalEquity : 0;
    const longExposure = totalEquity > 0 ? longVal / totalEquity : 0;
    const shortExposure = totalEquity > 0 ? shortVal / totalEquity : 0;

    return {
      totalEquity,
      allocatedCapital: Number(allocatedCapital.toFixed(2)),
      cashBalance: Number(cashBalance.toFixed(2)),
      grossExposure: Number(grossExposure.toFixed(4)),
      netExposure: Number(netExposure.toFixed(4)),
      longExposure: Number(longExposure.toFixed(4)),
      shortExposure: Number(shortExposure.toFixed(4)),
      activePositionCount: positions.length,
    };
  }

  /**
   * Aggregates position allocations into correlated clusters.
   */
  static calculateCorrelatedExposure(positions: PortfolioPosition[], totalEquity: number): Record<string, ClusterExposure> {
    const clusters: Record<string, ClusterExposure> = {};

    for (const p of positions) {
      const clusterKey = p.correlationCluster || Gate17CorrelationExposure.identifyCluster(p.symbol).name;
      if (!clusters[clusterKey]) {
        clusters[clusterKey] = {
          clusterName: clusterKey,
          symbols: [],
          totalValue: 0,
          clusterWeight: 0,
          isConcentrated: false,
        };
      }

      clusters[clusterKey].symbols.push(p.symbol);
      clusters[clusterKey].totalValue += p.allocatedValue;
    }

    for (const c of Object.values(clusters)) {
      c.totalValue = Number(c.totalValue.toFixed(2));
      c.clusterWeight = totalEquity > 0 ? Number((c.totalValue / totalEquity).toFixed(4)) : 0;
      c.isConcentrated = c.clusterWeight > 0.35;
    }

    return clusters;
  }

  /**
   * Computes portfolio risk overlay including Parametric Value-at-Risk (VaR)
   * and volatility-adjusted sizing factors.
   */
  static evaluateRiskOverlay(positions: PortfolioPosition[], totalEquity: number): PortfolioRiskOverlay {
    if (positions.length === 0) {
      return {
        parametricVaR95: 0,
        parametricVaR99: 0,
        expectedShortfall95: 0,
        portfolioVolatilityEst: 0,
        riskBudgetConsumedPct: 0,
        recommendedScalingFactor: 1.0,
      };
    }

    // Approximate portfolio volatility based on weighted asset volatilities and average correlation
    let weightedVolSum = 0;
    let totalValue = 0;

    for (const p of positions) {
      const assetVol = p.assetClass === 'CRYPTO' ? 0.045 : p.assetClass === 'STOCK' ? 0.022 : 0.012; // Daily standard deviation estimates
      weightedVolSum += p.allocatedValue * assetVol;
      totalValue += p.allocatedValue;
    }

    const portfolioDailyVol = totalValue > 0 ? (weightedVolSum / totalEquity) * 0.90 : 0.01;

    // Normal distribution Z-scores: 1.645 for 95%, 2.326 for 99%
    const parametricVaR95 = Number((portfolioDailyVol * 1.645).toFixed(4));
    const parametricVaR99 = Number((portfolioDailyVol * 2.326).toFixed(4));
    const expectedShortfall95 = Number((portfolioDailyVol * 2.062).toFixed(4)); // CVaR approximation for normal distribution

    // Max risk budget: 5% portfolio 1-day VaR
    const riskBudgetConsumedPct = Number(Math.min(100, (parametricVaR95 / 0.05) * 100).toFixed(1));

    // Dynamic sizing scaling factor: drops as VaR consumes more than 60% of budget
    let recommendedScalingFactor = 1.0;
    if (parametricVaR95 > 0.035) {
      recommendedScalingFactor = Math.max(0.40, Number((1.0 - (parametricVaR95 - 0.035) * 20).toFixed(2)));
    }

    return {
      parametricVaR95,
      parametricVaR99,
      expectedShortfall95,
      portfolioVolatilityEst: Number(portfolioDailyVol.toFixed(4)),
      riskBudgetConsumedPct,
      recommendedScalingFactor,
    };
  }

  /**
   * Tracks capital allocation across distinct trading strategies.
   */
  static evaluateStrategyAllocation(positions: PortfolioPosition[], totalEquity: number): Record<string, StrategyAllocation> {
    const allocations: Record<string, StrategyAllocation> = {};

    for (const p of positions) {
      const strat = p.strategy || 'Multi-Timeframe Trend Confluence';
      if (!allocations[strat]) {
        allocations[strat] = {
          strategyName: strat,
          activeSignalsCount: 0,
          allocatedValue: 0,
          weightPct: 0,
        };
      }

      allocations[strat].activeSignalsCount += 1;
      allocations[strat].allocatedValue += p.allocatedValue;
    }

    for (const a of Object.values(allocations)) {
      a.allocatedValue = Number(a.allocatedValue.toFixed(2));
      a.weightPct = totalEquity > 0 ? Number(((a.allocatedValue / totalEquity) * 100).toFixed(2)) : 0;
    }

    return allocations;
  }

  private static inferAssetClass(symbol: string): 'CRYPTO' | 'FOREX' | 'STOCK' | 'INDEX' {
    const s = symbol.toUpperCase();
    if (s.includes('USDT') || s.includes('BTC') || s.includes('ETH') || s.includes('SOL')) return 'CRYPTO';
    if (s.includes('EUR') || s.includes('GBP') || s.includes('JPY') || s.includes('USD')) return 'FOREX';
    if (s.includes('SPX') || s.includes('NDX') || s.includes('DOW')) return 'INDEX';
    return 'STOCK';
  }

  /**
   * Helper to convert an array of active signals into portfolio positions for FinRL evaluation.
   */
  static signalsToPositions(
    signals: (TradingSignal | any)[],
    defaultAllocationPerTrade = 500
  ): PortfolioPosition[] {
    return (signals || []).map((s, idx) => {
      const entryPrice = s.entryPrice || 1;
      const nominalVal = (s.suggestedPositionSize && s.suggestedPositionSize > 0)
        ? s.suggestedPositionSize * entryPrice
        : defaultAllocationPerTrade;

      return {
        id: s.id || `pos_${idx}`,
        symbol: (s.symbol || '').toUpperCase(),
        direction: (s.direction as SignalDirection) || 'BUY',
        entryPrice,
        currentPrice: s.entryPrice || 1,
        stopLoss: s.stopLoss || entryPrice * 0.95,
        takeProfit: s.takeProfit || entryPrice * 1.05,
        quantity: entryPrice > 0 ? nominalVal / entryPrice : 1,
        allocatedValue: nominalVal,
        strategy: s.strategy || s.selectedStrategy || 'Trend Confluence',
        assetClass: s.assetClass || this.inferAssetClass(s.symbol || ''),
        correlationCluster: s.correlationCluster || Gate17CorrelationExposure.identifyCluster(s.symbol || '').name,
        openedAt: s.timestamp || Date.now(),
      };
    });
  }

  /**
   * Evaluates a TradingSignal candidate directly against an array of active signals.
   */
  static evaluateSignalCandidate(
    candidateSignal: TradingSignal | any,
    activeSignals: (TradingSignal | any)[],
    customConstraints?: Partial<PortfolioConstraints>,
    totalEquity = this.DEFAULT_EQUITY
  ): PortfolioCandidateEvaluation {
    const activePositions = this.signalsToPositions(activeSignals);
    const candidateInput: PortfolioCandidateInput = {
      symbol: candidateSignal.symbol,
      direction: candidateSignal.direction,
      entryPrice: candidateSignal.entryPrice,
      stopLoss: candidateSignal.stopLoss,
      takeProfit: candidateSignal.takeProfit,
      suggestedRiskAmount: candidateSignal.suggestedRiskAmount,
      suggestedPositionSize: candidateSignal.suggestedPositionSize,
      strategy: candidateSignal.strategy || candidateSignal.selectedStrategy,
      assetClass: candidateSignal.assetClass || this.inferAssetClass(candidateSignal.symbol),
    };

    return this.evaluateCandidate(candidateInput, activePositions, customConstraints, totalEquity);
  }
}
