/**
 * GATE 14 — HISTORICAL OUTCOME FEEDBACK ENGINE
 *
 * Implements strict live production outcome feedback:
 * 1. Strict separation of LIVE production outcomes from test/backtest/simulation data.
 * 2. Measures which factors (R:R quality, market regimes, strategies, asset classes)
 *    actually correlate with profitable outcomes in real production.
 */

import { HistoricalPerformanceManager, AuthoritativeSignalStatus } from './HistoricalPerformanceManager.js';
import { logger } from '../logger.js';

export interface FactorCorrelationResult {
  factorName: string;
  sampleSize: number;
  wins: number;
  losses: number;
  winRate: number; // 0 - 100
  averageRR: number;
  correlationStrength: 'STRONG_POSITIVE' | 'MODERATE_POSITIVE' | 'NEUTRAL' | 'NEGATIVE';
}

export interface OutcomeFeedbackReport {
  timestamp: number;
  totalLiveEvaluated: number;
  completedLiveCount: number;
  liveWinRate: number | null;
  rrCorrelations: FactorCorrelationResult[];
  strategyCorrelations: FactorCorrelationResult[];
  regimeCorrelations: FactorCorrelationResult[];
  summary: string;
}

export class HistoricalOutcomeFeedbackEngine {
  /**
   * Evaluates factor correlations from real live production outcomes only.
   * Backtest, simulation, test, and synthetic signals are strictly filtered out.
   */
  public static async analyzeLiveOutcomeFeedback(): Promise<OutcomeFeedbackReport> {
    const allSignals = await HistoricalPerformanceManager.getConsolidatedSignals();
    const now = Date.now();

    // Filter to only completed LIVE signals
    const liveCompleted = allSignals.filter((s) => {
      const prov = (s as any).provenance ? String((s as any).provenance).toUpperCase() : 'LIVE';
      const isSynth = Boolean((s as any).isSynthetic);
      const isTestId = s.id.startsWith('test_') || s.id.startsWith('sim_') || s.id.startsWith('backtest_');
      return s.isCompleted && prov === 'LIVE' && !isSynth && !isTestId;
    });

    const completedCount = liveCompleted.length;
    const totalWins = liveCompleted.filter((s) => s.isWin).length;
    const overallWinRate = completedCount > 0 ? Number(((totalWins / completedCount) * 100).toFixed(1)) : null;

    // 1. Measure R:R Tier Correlations (Gate 9 & Gate 14)
    const rrTiers = [
      { name: 'R:R >= 2.5R', filter: (s: any) => (s.riskRewardRatio ?? 0) >= 2.5 },
      { name: 'R:R 2.0R - 2.5R', filter: (s: any) => (s.riskRewardRatio ?? 0) >= 2.0 && (s.riskRewardRatio ?? 0) < 2.5 },
      { name: 'R:R 1.8R - 2.0R', filter: (s: any) => (s.riskRewardRatio ?? 0) >= 1.8 && (s.riskRewardRatio ?? 0) < 2.0 },
      { name: 'R:R < 1.8R (Sub-standard)', filter: (s: any) => (s.riskRewardRatio ?? 0) < 1.8 },
    ];

    const rrCorrelations: FactorCorrelationResult[] = rrTiers.map((tier) => {
      const matching = liveCompleted.filter(tier.filter);
      const wins = matching.filter((s) => s.isWin).length;
      const losses = matching.filter((s) => s.isLoss).length;
      const sampleSize = matching.length;
      const winRate = sampleSize > 0 ? Number(((wins / sampleSize) * 100).toFixed(1)) : 0;
      const avgRR = sampleSize > 0
        ? Number((matching.reduce((acc, s) => acc + (s.riskRewardRatio ?? 0), 0) / sampleSize).toFixed(2))
        : 0;

      let correlationStrength: FactorCorrelationResult['correlationStrength'] = 'NEUTRAL';
      if (sampleSize >= 5) {
        if (winRate >= 60) correlationStrength = 'STRONG_POSITIVE';
        else if (winRate >= 50) correlationStrength = 'MODERATE_POSITIVE';
        else correlationStrength = 'NEGATIVE';
      }

      return {
        factorName: tier.name,
        sampleSize,
        wins,
        losses,
        winRate,
        averageRR: avgRR,
        correlationStrength,
      };
    });

    // 2. Measure Strategy Correlations
    const strategyMap = new Map<string, any[]>();
    for (const s of liveCompleted) {
      const strat = s.strategy || 'Multi-Confluence';
      if (!strategyMap.has(strat)) strategyMap.set(strat, []);
      strategyMap.get(strat)!.push(s);
    }

    const strategyCorrelations: FactorCorrelationResult[] = Array.from(strategyMap.entries()).map(([stratName, signals]) => {
      const wins = signals.filter((s) => s.isWin).length;
      const losses = signals.filter((s) => s.isLoss).length;
      const sampleSize = signals.length;
      const winRate = sampleSize > 0 ? Number(((wins / sampleSize) * 100).toFixed(1)) : 0;
      const avgRR = sampleSize > 0
        ? Number((signals.reduce((acc, s) => acc + (s.riskRewardRatio ?? 0), 0) / sampleSize).toFixed(2))
        : 0;

      let correlationStrength: FactorCorrelationResult['correlationStrength'] = 'NEUTRAL';
      if (sampleSize >= 5) {
        if (winRate >= 60) correlationStrength = 'STRONG_POSITIVE';
        else if (winRate >= 50) correlationStrength = 'MODERATE_POSITIVE';
        else correlationStrength = 'NEGATIVE';
      }

      return {
        factorName: stratName,
        sampleSize,
        wins,
        losses,
        winRate,
        averageRR: avgRR,
        correlationStrength,
      };
    });

    // 3. Measure Market Regime Correlations
    const regimeMap = new Map<string, any[]>();
    for (const s of liveCompleted) {
      const reg = (s as any).marketRegime || (s as any).regime || 'UNKNOWN';
      if (!regimeMap.has(reg)) regimeMap.set(reg, []);
      regimeMap.get(reg)!.push(s);
    }

    const regimeCorrelations: FactorCorrelationResult[] = Array.from(regimeMap.entries()).map(([regName, signals]) => {
      const wins = signals.filter((s) => s.isWin).length;
      const losses = signals.filter((s) => s.isLoss).length;
      const sampleSize = signals.length;
      const winRate = sampleSize > 0 ? Number(((wins / sampleSize) * 100).toFixed(1)) : 0;
      const avgRR = sampleSize > 0
        ? Number((signals.reduce((acc, s) => acc + (s.riskRewardRatio ?? 0), 0) / sampleSize).toFixed(2))
        : 0;

      let correlationStrength: FactorCorrelationResult['correlationStrength'] = 'NEUTRAL';
      if (sampleSize >= 5) {
        if (winRate >= 60) correlationStrength = 'STRONG_POSITIVE';
        else if (winRate >= 50) correlationStrength = 'MODERATE_POSITIVE';
        else correlationStrength = 'NEGATIVE';
      }

      return {
        factorName: regName,
        sampleSize,
        wins,
        losses,
        winRate,
        averageRR: avgRR,
        correlationStrength,
      };
    });

    const summary = completedCount === 0
      ? 'No live production outcomes logged yet. Metrics will populate automatically as live signals resolve.'
      : `Evaluated ${completedCount} live completed trade outcomes with overall win rate ${overallWinRate}%. Test and backtest records strictly excluded.`;

    logger.info(`[Gate 14 Outcome Feedback] ${summary}`);

    return {
      timestamp: now,
      totalLiveEvaluated: allSignals.length,
      completedLiveCount: completedCount,
      liveWinRate: overallWinRate,
      rrCorrelations,
      strategyCorrelations,
      regimeCorrelations,
      summary,
    };
  }
}
