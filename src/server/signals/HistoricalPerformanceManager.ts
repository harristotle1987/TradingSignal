/**
 * Historical Signal Performance & Outcome Attribution Manager
 *
 * Implements strict, verifiable calculation of historical signal performance:
 * - Aggregates from durable persistence (SignalLogger, SignalOutcomeLogger, ScannerPersistence)
 * - Strict deduplication by stable signal ID
 * - Authoritative status normalization: "WIN", "LOSS", "ACTIVE", "EXPIRED", "CANCELLED", "INVALID"
 * - Counts only completed wins and losses:
 *     Completed = Wins + Losses
 *     Success Rate = Wins / Completed * 100
 * - Excludes future records, validates timestamps, and eliminates mock data or hardcoded percentages
 * - Supports ranges: "7D", "30D", "90D", "ALL"
 */

import { SignalLogger, SignalLogRecord, isTradeableLogRecord } from './SignalLogger.js';
import { SignalOutcomeLogger, SignalOutcomeRecord } from './SignalOutcomeLogger.js';
import { ScannerPersistence } from './ScannerPersistence.js';
import {
  HistoricalPerformanceRange,
  HistoricalPerformanceResponse,
  HistoricalPerformanceSummary,
  HistoricalPerformanceTrendPoint,
  HistoricalSignalOutcomeItem,
} from '../../types/index.js';
import { logger } from '../logger.js';

export type AuthoritativeSignalStatus = 'WIN' | 'LOSS' | 'ACTIVE' | 'EXPIRED' | 'CANCELLED' | 'INVALID';

interface NormalizedSignalOutcome {
  id: string;
  symbol: string;
  direction: 'BUY' | 'SELL';
  timestamp: number;
  resolvedAt?: number;
  status: AuthoritativeSignalStatus;
  isCompleted: boolean;
  isWin: boolean;
  isLoss: boolean;
  entryPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  tp1?: number;
  tp2?: number;
  tp3?: number;
  strategy?: string;
  provider?: string;
  riskRewardRatio?: number;
  realizedRR?: number;
  finalOutcome?: string;
}

export class HistoricalPerformanceManager {
  /**
   * Normalizes arbitrary status strings to authoritative lifecycle categories.
   */
  public static normalizeStatus(
    statusStr?: string,
    finalOutcomeStr?: string,
    slStatus?: string,
    tp1Status?: string,
    tp2Status?: string,
    tp3Status?: string
  ): AuthoritativeSignalStatus {
    const raw = `${statusStr || ''} ${finalOutcomeStr || ''}`.toUpperCase().trim();

    // 1. WIN outcomes (Take-profit targets hit or completed profitably)
    if (
      raw.includes('TP1_HIT') ||
      raw.includes('TP2_HIT') ||
      raw.includes('TP3_HIT') ||
      raw.includes('TP1 HIT') ||
      raw.includes('TP2 HIT') ||
      raw.includes('TP3 HIT') ||
      raw.includes('TP HIT') ||
      raw.includes('COMPLETED') ||
      raw.includes('WIN') ||
      tp1Status === 'HIT' ||
      tp2Status === 'HIT' ||
      tp3Status === 'HIT'
    ) {
      return 'WIN';
    }

    // 2. LOSS outcomes (Stop-loss hit or stopped out)
    if (
      raw.includes('SL_HIT') ||
      raw.includes('SL HIT') ||
      raw.includes('STOPPED_OUT') ||
      raw.includes('LOSS') ||
      slStatus === 'HIT'
    ) {
      return 'LOSS';
    }

    // 3. EXPIRED outcomes (Timed out before entry or expired without execution)
    if (
      raw.includes('EXPIRED') ||
      raw.includes('NO_ENTRY') ||
      raw.includes('EXPIRED_BEFORE_ENTRY')
    ) {
      return 'EXPIRED';
    }

    // 4. CANCELLED outcomes
    if (
      raw.includes('CANCEL') ||
      raw.includes('SUPERSEDED')
    ) {
      return 'CANCELLED';
    }

    // 5. ACTIVE / Pending outcomes (In-flight, awaiting entry, or active management)
    if (
      raw.includes('ACTIVE') ||
      raw.includes('WAITING_ENTRY') ||
      raw.includes('ENTRY_CONFIRMED') ||
      raw.includes('PENDING')
    ) {
      return 'ACTIVE';
    }

    // 6. INVALID / Ambiguous / Filtered
    return 'INVALID';
  }

  /**
   * Retrieves and consolidates unique stored signals across persistence layers.
   */
  public static async getConsolidatedSignals(): Promise<NormalizedSignalOutcome[]> {
    const [signalLogs, outcomeLogs, sentSignals, deletedRecords] = await Promise.all([
      SignalLogger.getSignalLogs(1000).catch((err) => {
        logger.warn('[HistoricalPerformance] Error loading signal logs:', { error: String(err) });
        return [] as SignalLogRecord[];
      }),
      SignalOutcomeLogger.getOutcomeLogs(1000).catch((err) => {
        logger.warn('[HistoricalPerformance] Error loading outcome logs:', { error: String(err) });
        return [] as SignalOutcomeRecord[];
      }),
      ScannerPersistence.getSentSignals().catch((err) => {
        logger.warn('[HistoricalPerformance] Error loading sent signals:', { error: String(err) });
        return [];
      }),
      ScannerPersistence.getDeletedSignals().catch((err) => {
        logger.warn('[HistoricalPerformance] Error loading deleted signals:', { error: String(err) });
        return [];
      }),
    ]);

    const deletedIds = new Set<string>(deletedRecords.map((d) => d.id));
    const signalMap = new Map<string, NormalizedSignalOutcome>();
    const now = Date.now();
    const maxFutureAllowed = now + 60000; // Allow max 1-minute clock skew

    // Helper to validate & normalize timestamp
    const sanitizeTimestamp = (ts?: number): number | null => {
      if (typeof ts !== 'number' || isNaN(ts) || ts <= 0) return null;
      let cleaned = ts;
      if (cleaned < 10000000000) cleaned = cleaned * 1000; // Convert seconds to ms
      if (cleaned > maxFutureAllowed) return null;
      return cleaned;
    };

    // 1. Process Signal Logs (tradeable records only)
    for (const log of signalLogs) {
      if (!log || !log.id || deletedIds.has(log.id)) continue;
      if (!isTradeableLogRecord(log)) continue;

      const provenance = (log as any).provenance ? String((log as any).provenance).toUpperCase() : 'LIVE';
      const isSynthetic = Boolean((log as any).isSynthetic);
      if (provenance === 'BACKTEST' || provenance === 'SIMULATION' || provenance === 'TEST' || isSynthetic) {
        continue;
      }

      const ts = sanitizeTimestamp(log.timestamp || log.updatedAt);
      if (!ts) continue;

      const status = this.normalizeStatus(log.status);
      const isWin = status === 'WIN';
      const isLoss = status === 'LOSS';
      const isCompleted = isWin || isLoss;

      signalMap.set(log.id, {
        id: log.id,
        symbol: log.symbol,
        direction: (log.direction === 'BUY' || log.direction === 'SELL') ? log.direction : 'BUY',
        timestamp: ts,
        resolvedAt: sanitizeTimestamp(log.updatedAt) || undefined,
        status,
        isCompleted,
        isWin,
        isLoss,
        entryPrice: log.entryPrice,
        stopLoss: log.stopLoss,
        takeProfit: log.takeProfit,
        tp1: log.takeProfit,
        strategy: log.strategy,
        provider: log.provider,
        riskRewardRatio: log.riskRewardRatio,
        finalOutcome: log.status,
      });
    }

    // 2. Process Outcome Logs (higher precedence on terminal status resolution)
    for (const outcome of outcomeLogs) {
      if (!outcome || !outcome.id || deletedIds.has(outcome.id)) continue;

      const provenance = (outcome as any).provenance ? String((outcome as any).provenance).toUpperCase() : 'LIVE';
      const isSynthetic = Boolean((outcome as any).isSynthetic);
      if (provenance === 'BACKTEST' || provenance === 'SIMULATION' || provenance === 'TEST' || isSynthetic) {
        continue;
      }

      const ts = sanitizeTimestamp(outcome.timestamp || outcome.detectedAt || outcome.updatedAt);
      if (!ts) continue;

      const status = this.normalizeStatus(
        outcome.status,
        outcome.finalOutcome,
        outcome.slStatus,
        outcome.tp1Status,
        outcome.tp2Status,
        outcome.tp3Status
      );
      const isWin = status === 'WIN';
      const isLoss = status === 'LOSS';
      const isCompleted = isWin || isLoss;
      const resolvedAt = sanitizeTimestamp(outcome.updatedAt || outcome.eventTime) || undefined;

      const existing = signalMap.get(outcome.id);
      if (existing) {
        // Upgrade status if outcome provides authoritative completion
        if (isCompleted || existing.status === 'ACTIVE' || existing.status === 'INVALID') {
          existing.status = status;
          existing.isCompleted = isCompleted;
          existing.isWin = isWin;
          existing.isLoss = isLoss;
          if (resolvedAt) existing.resolvedAt = resolvedAt;
        }
        if (outcome.entryPrice) existing.entryPrice = outcome.entryPrice;
        if (outcome.stopLoss) existing.stopLoss = outcome.stopLoss;
        if (outcome.takeProfit) existing.takeProfit = outcome.takeProfit;
        if (outcome.tp1) existing.tp1 = outcome.tp1;
        if (outcome.tp2) existing.tp2 = outcome.tp2;
        if (outcome.tp3) existing.tp3 = outcome.tp3;
        if (outcome.provider) existing.provider = outcome.provider;
        if (outcome.finalOutcome) existing.finalOutcome = outcome.finalOutcome;
      } else {
        signalMap.set(outcome.id, {
          id: outcome.id,
          symbol: outcome.symbol,
          direction: outcome.direction || 'BUY',
          timestamp: ts,
          resolvedAt,
          status,
          isCompleted,
          isWin,
          isLoss,
          entryPrice: outcome.entryPrice,
          stopLoss: outcome.stopLoss,
          takeProfit: outcome.takeProfit,
          tp1: outcome.tp1,
          tp2: outcome.tp2,
          tp3: outcome.tp3,
          provider: outcome.provider,
          finalOutcome: outcome.finalOutcome || outcome.status,
        });
      }
    }

    // 3. Process Scanner Persistence Sent Signals
    for (const sent of sentSignals) {
      if (!sent || !sent.id || deletedIds.has(sent.id)) continue;
      // Filter out non-tradeable or internal items
      if (sent.isTradeableSignal === false || (sent.direction as string) === 'NO_TRADE') continue;

      const provenance = (sent as any).provenance ? String((sent as any).provenance).toUpperCase() : 'LIVE';
      const isSynthetic = Boolean((sent as any).isSynthetic);
      if (provenance === 'BACKTEST' || provenance === 'SIMULATION' || provenance === 'TEST' || isSynthetic) {
        continue;
      }

      const ts = sanitizeTimestamp(sent.timestamp || (sent as any).validatedAt);
      if (!ts) continue;

      const status = this.normalizeStatus(
        sent.status,
        (sent as any).finalOutcome,
        sent.slStatus,
        sent.tp1Status,
        sent.tp2Status,
        sent.tp3Status
      );
      const isWin = status === 'WIN';
      const isLoss = status === 'LOSS';
      const isCompleted = isWin || isLoss;

      const existing = signalMap.get(sent.id);
      if (existing) {
        if (isCompleted && !existing.isCompleted) {
          existing.status = status;
          existing.isCompleted = isCompleted;
          existing.isWin = isWin;
          existing.isLoss = isLoss;
        }
        if (sent.entryPrice && !existing.entryPrice) existing.entryPrice = sent.entryPrice;
        if (sent.stopLoss && !existing.stopLoss) existing.stopLoss = sent.stopLoss;
        if (sent.takeProfit && !existing.takeProfit) existing.takeProfit = sent.takeProfit;
        if (sent.strategy && !existing.strategy) existing.strategy = sent.strategy;
        if (sent.riskRewardRatio && !existing.riskRewardRatio) existing.riskRewardRatio = sent.riskRewardRatio;
      } else {
        signalMap.set(sent.id, {
          id: sent.id,
          symbol: sent.symbol,
          direction: sent.direction || 'BUY',
          timestamp: ts,
          status,
          isCompleted,
          isWin,
          isLoss,
          entryPrice: sent.entryPrice,
          stopLoss: sent.stopLoss,
          takeProfit: sent.takeProfit,
          tp1: sent.tp1 || sent.takeProfit,
          tp2: sent.tp2,
          tp3: sent.tp3,
          strategy: sent.strategy,
          provider: sent.dataSource,
          riskRewardRatio: sent.riskRewardRatio,
          finalOutcome: (sent as any).finalOutcome || sent.status,
        });
      }
    }

    return Array.from(signalMap.values()).sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Computes accurate historical performance summary and trend points for a given range.
   */
  public static async getPerformance(
    range: HistoricalPerformanceRange = '30D'
  ): Promise<HistoricalPerformanceResponse> {
    const allSignals = await this.getConsolidatedSignals();
    const now = Date.now();

    let cutoffTime = 0;
    if (range === '7D') {
      cutoffTime = now - 7 * 24 * 60 * 60 * 1000;
    } else if (range === '30D') {
      cutoffTime = now - 30 * 24 * 60 * 60 * 1000;
    } else if (range === '90D') {
      cutoffTime = now - 90 * 24 * 60 * 60 * 1000;
    } else {
      cutoffTime = 0; // ALL
    }

    // Filter by timestamp range
    const inRangeSignals = allSignals.filter((s) => s.timestamp >= cutoffTime && s.timestamp <= now);

    // Group completed signals into day buckets
    const dailyMap = new Map<string, { completed: number; wins: number; losses: number }>();

    let totalWins = 0;
    let totalLosses = 0;
    let activeCount = 0;
    let expiredCount = 0;

    for (const signal of inRangeSignals) {
      if (signal.status === 'ACTIVE') {
        activeCount += 1;
      } else if (signal.status === 'EXPIRED') {
        expiredCount += 1;
      }

      if (!signal.isCompleted) continue;

      const periodDate = new Date(signal.timestamp).toISOString().split('T')[0];
      if (!dailyMap.has(periodDate)) {
        dailyMap.set(periodDate, { completed: 0, wins: 0, losses: 0 });
      }

      const entry = dailyMap.get(periodDate)!;
      entry.completed += 1;

      if (signal.isWin) {
        entry.wins += 1;
        totalWins += 1;
      } else if (signal.isLoss) {
        entry.losses += 1;
        totalLosses += 1;
      }
    }

    const totalCompleted = totalWins + totalLosses;
    const overallSuccessRate =
      totalCompleted > 0 ? Number(((totalWins / totalCompleted) * 100).toFixed(1)) : null;

    const summary: HistoricalPerformanceSummary = {
      totalCompleted,
      wins: totalWins,
      losses: totalLosses,
      successRate: overallSuccessRate,
      activeCount,
      expiredCount,
      totalSignals: inRangeSignals.length,
    };

    // Sort periods chronologically
    const sortedPeriods = Array.from(dailyMap.keys()).sort();
    const trend: HistoricalPerformanceTrendPoint[] = sortedPeriods.map((period) => {
      const data = dailyMap.get(period)!;
      const rate =
        data.completed > 0 ? Number(((data.wins / data.completed) * 100).toFixed(1)) : null;
      return {
        period,
        completed: data.completed,
        wins: data.wins,
        losses: data.losses,
        successRate: rate,
      };
    });

    // Extract recent outcomes for transparency and auditability (sorted newest to oldest)
    const recentOutcomes: HistoricalSignalOutcomeItem[] = inRangeSignals
      .slice()
      .sort((a, b) => b.timestamp - a.timestamp)
      .map((s) => ({
        id: s.id,
        symbol: s.symbol,
        direction: s.direction,
        timestamp: s.timestamp,
        resolvedAt: s.resolvedAt,
        status: s.status,
        entryPrice: s.entryPrice,
        stopLoss: s.stopLoss,
        takeProfit: s.takeProfit,
        tp1: s.tp1,
        tp2: s.tp2,
        tp3: s.tp3,
        strategy: s.strategy,
        provider: s.provider,
        riskRewardRatio: s.riskRewardRatio,
        realizedRR: s.realizedRR,
        finalOutcome: s.finalOutcome,
      }));

    return {
      success: true,
      range,
      summary,
      trend,
      recentOutcomes,
      timestamp: now,
    };
  }
}
