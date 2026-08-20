/**
 * GATE 35 — SIGNAL FUNNEL ANALYTICS ENGINE
 *
 * Provides granular tracking, breakdown, and aggregate statistics for candidate setups
 * passing through the multi-stage Signal Pipeline & Gate Hierarchy:
 *
 * candidate (Universe scan)
 * → Stage 2 (Adaptive Candidate Pre-filter / Gate 32)
 * → Gate 0 (Data Integrity & Freshness)
 * → Gate 1 (Market Regime Classification)
 * → Gate 2 (Multi-Timeframe Trend Confluence)
 * → Gate 3 (Market Structure & Confluence Scoring)
 * → Gate 4 (Target Quality & Minimum Score / Threshold)
 * → Gate 5 (Volatility & ATR Suitability / Expansion)
 * → Gate 6 (Data Integrity & Provider Agreement)
 * → Gate 7 (Market Context & News Blackout)
 * → Gate 8 (Executable Entry Quality)
 * → Gate 9 (Risk Management, Net R:R & Friction Stress Test)
 * → ranking (Global Trade Ranking Engine)
 * → final signal (Dispatched Actionable Trade Signal)
 *
 * Record:
 * - symbol
 * - direction
 * - stage
 * - score
 * - regime
 * - strategy
 * - rejectionCode
 * - rejectionReason
 *
 * Aggregate:
 * - Top rejection reasons
 * - Signals lost by threshold
 * - Signals lost by R:R
 * - Signals lost by volatility
 * - Signals lost by data
 * - Signals lost by entry quality
 * - Signals lost by correlation
 * - Signals lost by daily cap
 */

import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../logger.js';

export type FunnelStage =
  | 'CANDIDATE'
  | 'STAGE_2'
  | 'GATE_0'
  | 'GATE_1'
  | 'GATE_2'
  | 'GATE_3'
  | 'GATE_4'
  | 'GATE_5'
  | 'GATE_6'
  | 'GATE_7'
  | 'GATE_8'
  | 'GATE_9'
  | 'RANKING'
  | 'FINAL_SIGNAL';

export const FUNNEL_STAGE_ORDER: FunnelStage[] = [
  'CANDIDATE',
  'STAGE_2',
  'GATE_0',
  'GATE_1',
  'GATE_2',
  'GATE_3',
  'GATE_4',
  'GATE_5',
  'GATE_6',
  'GATE_7',
  'GATE_8',
  'GATE_9',
  'RANKING',
  'FINAL_SIGNAL',
];

export type RejectionCategory =
  | 'THRESHOLD'
  | 'RR'
  | 'VOLATILITY'
  | 'DATA'
  | 'ENTRY_QUALITY'
  | 'CORRELATION'
  | 'DAILY_CAP'
  | 'OTHER';

export interface CandidateFunnelRecord {
  id: string;
  timestamp: number;
  symbol: string;
  direction: 'BUY' | 'SELL' | 'LONG' | 'SHORT' | 'NEUTRAL';
  stage: FunnelStage;
  score: number;
  regime: string;
  strategy: string;
  rejectionCode: string | null;
  rejectionReason: string | null;
  rejectionCategory: RejectionCategory | null;
  passedGates?: string[];
}

export interface RejectionReasonStat {
  rejectionCode: string;
  count: number;
  percentage: number;
  category: RejectionCategory;
  description: string;
}

export interface StagePassThroughStat {
  stage: FunnelStage;
  count: number;
  percentageOfCandidates: number;
  dropOffCount: number;
  dropOffRate: number;
}

export interface FunnelAnalyticsReport {
  timestamp: number;
  totalScannedCandidates: number;
  totalFinalSignals: number;
  conversionRatePct: number;
  stagePassThrough: StagePassThroughStat[];
  categoryBreakdown: {
    signalsLostByThreshold: number;
    signalsLostByRR: number;
    signalsLostByVolatility: number;
    signalsLostByData: number;
    signalsLostByEntryQuality: number;
    signalsLostByCorrelation: number;
    signalsLostByDailyCap: number;
    signalsLostByOther: number;
  };
  topRejectionReasons: RejectionReasonStat[];
  recordsCount: number;
}

const LOCAL_FUNNEL_PATH = path.join(process.cwd(), 'signal_funnel_analytics.json');

export class Gate35SignalFunnelAnalytics {
  private static records: Map<string, CandidateFunnelRecord> = new Map();
  private static isInitialized = false;
  private static maxRecords = 2000;

  private static init(): void {
    if (this.isInitialized) return;

    try {
      if (fs.existsSync(LOCAL_FUNNEL_PATH)) {
        const raw = fs.readFileSync(LOCAL_FUNNEL_PATH, 'utf-8');
        const parsed: CandidateFunnelRecord[] = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            this.records.set(item.id, item);
          }
        }
      }
    } catch (err) {
      logger.warn('[Gate35FunnelAnalytics] Could not load persisted funnel records:', err);
    }

    this.isInitialized = true;
  }

  private static persistLocal(): void {
    try {
      const arr = Array.from(this.records.values())
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, this.maxRecords);
      fs.writeFileSync(LOCAL_FUNNEL_PATH, JSON.stringify(arr, null, 2), 'utf-8');
    } catch (err) {
      logger.warn('[Gate35FunnelAnalytics] Failed to write funnel records to local disk:', err);
    }
  }

  /**
   * Categorizes a rejection code or reason into one of the 7 core analytics buckets
   */
  public static categorizeRejection(code?: string | null, reason?: string | null): RejectionCategory {
    const text = `${code || ''} ${reason || ''}`.toUpperCase();

    if (
      text.includes('DAILY_CAP') ||
      text.includes('CAP_REACHED') ||
      text.includes('MAX_SIGNALS') ||
      text.includes('NOTIFICATION_CAP') ||
      text.includes('ALLOCATION_LIMIT')
    ) {
      return 'DAILY_CAP';
    }

    if (
      text.includes('CORRELATION') ||
      text.includes('DUPLICATE') ||
      text.includes('FINGERPRINT') ||
      text.includes('CLUSTER') ||
      text.includes('PORTFOLIO_EXPOSURE')
    ) {
      return 'CORRELATION';
    }

    if (
      text.includes('DATA_STALE') ||
      text.includes('INVALID_DATA') ||
      text.includes('PRICE_MISMATCH') ||
      text.includes('CANDLE') ||
      text.includes('PROVIDER_DISAGREEMENT') ||
      text.includes('STALE_EXECUTABLE_QUOTE') ||
      text.includes('IMPOSSIBLE_PRICE')
    ) {
      return 'DATA';
    }

    if (
      text.includes('VOLATILITY') ||
      text.includes('NOISE_FLOOR') ||
      text.includes('ATR') ||
      text.includes('CHOP') ||
      text.includes('REGIME_BLOCKED') ||
      text.includes('EXPANSION_FAILED')
    ) {
      return 'VOLATILITY';
    }

    if (
      text.includes('RR_BELOW') ||
      text.includes('NET_RR') ||
      text.includes('EXECUTION_COST') ||
      text.includes('SAFETY_BUFFER') ||
      text.includes('ADVERSE_NET_RR') ||
      text.includes('EXECUTION_FRICTION') ||
      text.includes('FRICTION')
    ) {
      return 'RR';
    }

    if (
      text.includes('ENTRY') ||
      text.includes('INVALID_SL') ||
      text.includes('UNEXECUTABLE') ||
      text.includes('CONFIRMATION_DIVERSITY') ||
      text.includes('LOCATION') ||
      text.includes('TIMEFRAME')
    ) {
      return 'ENTRY_QUALITY';
    }

    if (
      text.includes('THRESHOLD') ||
      text.includes('SCORE_BELOW') ||
      text.includes('WIN_RATE') ||
      text.includes('INSUFFICIENT_CONFLUENCE') ||
      text.includes('QUALITATIVE') ||
      text.includes('EXPECTANCY') ||
      text.includes('PROBABILITY') ||
      text.includes('SPECTRAL')
    ) {
      return 'THRESHOLD';
    }

    return 'OTHER';
  }

  /**
   * Logs or updates a scanned candidate record as it progresses through the funnel or gets rejected.
   */
  public static recordCandidate(params: {
    symbol: string;
    direction?: 'BUY' | 'SELL' | 'LONG' | 'SHORT' | 'NEUTRAL';
    stage: FunnelStage;
    score?: number;
    regime?: string;
    strategy?: string;
    rejectionCode?: string | null;
    rejectionReason?: string | null;
    passedGates?: string[];
  }): CandidateFunnelRecord {
    this.init();

    const now = Date.now();
    const symbolClean = params.symbol.toUpperCase().trim();
    const direction = params.direction || 'BUY';
    const score = typeof params.score === 'number' ? params.score : 0;
    const regime = params.regime || 'UNKNOWN';
    const strategy = params.strategy || 'MULTI_STRATEGY';

    const rejCode = params.rejectionCode || (params.rejectionReason ? this.extractRejectionCode(params.rejectionReason) : null);
    const rejReason = params.rejectionReason || null;
    const rejCategory = rejCode || rejReason ? this.categorizeRejection(rejCode, rejReason) : null;

    const id = `funnel_${now}_${symbolClean}_${Math.random().toString(36).substring(2, 7)}`;

    const record: CandidateFunnelRecord = {
      id,
      timestamp: now,
      symbol: symbolClean,
      direction,
      stage: params.stage,
      score,
      regime,
      strategy,
      rejectionCode: rejCode,
      rejectionReason: rejReason,
      rejectionCategory: rejCategory,
      passedGates: params.passedGates,
    };

    this.records.set(id, record);
    this.persistLocal();

    logger.debug(
      `[Gate 35 Funnel] Recorded ${symbolClean} at stage [${params.stage}] - Score: ${score}${
        rejCode ? ` (Rejected: ${rejCode})` : ' (Passed)'
      }`
    );

    return record;
  }

  private static extractRejectionCode(reason: string): string {
    const match = reason.match(/^REJECTED:\s*([A-Z0-9_]+)/i);
    if (match && match[1]) {
      return `REJECTED: ${match[1].toUpperCase()}`;
    }
    return 'REJECTED: GENERAL';
  }

  /**
   * Computes complete aggregate funnel analytics report
   */
  public static getFunnelAnalytics(limitMinutes?: number): FunnelAnalyticsReport {
    this.init();

    const now = Date.now();
    const cutoff = limitMinutes ? now - limitMinutes * 60 * 1000 : 0;

    const filteredRecords = Array.from(this.records.values()).filter(
      r => r.timestamp >= cutoff
    );

    const totalScannedCandidates = filteredRecords.filter(
      r => r.stage === 'CANDIDATE' || r.stage === 'STAGE_2'
    ).length || filteredRecords.length;

    const finalSignals = filteredRecords.filter(r => r.stage === 'FINAL_SIGNAL');
    const totalFinalSignals = finalSignals.length;
    const conversionRatePct =
      totalScannedCandidates > 0
        ? parseFloat(((totalFinalSignals / totalScannedCandidates) * 100).toFixed(2))
        : 0;

    // Stage pass-through calculation
    const stageCounts: Record<FunnelStage, number> = {
      CANDIDATE: 0,
      STAGE_2: 0,
      GATE_0: 0,
      GATE_1: 0,
      GATE_2: 0,
      GATE_3: 0,
      GATE_4: 0,
      GATE_5: 0,
      GATE_6: 0,
      GATE_7: 0,
      GATE_8: 0,
      GATE_9: 0,
      RANKING: 0,
      FINAL_SIGNAL: 0,
    };

    // Calculate maximum stage reached for each candidate setup
    for (const r of filteredRecords) {
      const idx = FUNNEL_STAGE_ORDER.indexOf(r.stage);
      if (idx >= 0) {
        // Count for current stage and all prior stages passed
        for (let i = 0; i <= idx; i++) {
          stageCounts[FUNNEL_STAGE_ORDER[i]]++;
        }
      }
    }

    const stagePassThrough: StagePassThroughStat[] = FUNNEL_STAGE_ORDER.map((stage, i) => {
      const count = stageCounts[stage];
      const pct =
        totalScannedCandidates > 0
          ? parseFloat(((count / totalScannedCandidates) * 100).toFixed(1))
          : 0;
      const prevCount = i > 0 ? stageCounts[FUNNEL_STAGE_ORDER[i - 1]] : totalScannedCandidates;
      const dropOffCount = Math.max(0, prevCount - count);
      const dropOffRate =
        prevCount > 0 ? parseFloat(((dropOffCount / prevCount) * 100).toFixed(1)) : 0;

      return {
        stage,
        count,
        percentageOfCandidates: pct,
        dropOffCount,
        dropOffRate,
      };
    });

    // Category breakdown
    const categoryBreakdown = {
      signalsLostByThreshold: 0,
      signalsLostByRR: 0,
      signalsLostByVolatility: 0,
      signalsLostByData: 0,
      signalsLostByEntryQuality: 0,
      signalsLostByCorrelation: 0,
      signalsLostByDailyCap: 0,
      signalsLostByOther: 0,
    };

    const rejectionCodeMap: Map<string, { count: number; category: RejectionCategory; description: string }> = new Map();

    for (const r of filteredRecords) {
      if (r.rejectionCategory) {
        switch (r.rejectionCategory) {
          case 'THRESHOLD':
            categoryBreakdown.signalsLostByThreshold++;
            break;
          case 'RR':
            categoryBreakdown.signalsLostByRR++;
            break;
          case 'VOLATILITY':
            categoryBreakdown.signalsLostByVolatility++;
            break;
          case 'DATA':
            categoryBreakdown.signalsLostByData++;
            break;
          case 'ENTRY_QUALITY':
            categoryBreakdown.signalsLostByEntryQuality++;
            break;
          case 'CORRELATION':
            categoryBreakdown.signalsLostByCorrelation++;
            break;
          case 'DAILY_CAP':
            categoryBreakdown.signalsLostByDailyCap++;
            break;
          default:
            categoryBreakdown.signalsLostByOther++;
            break;
        }
      }

      if (r.rejectionCode) {
        const existing = rejectionCodeMap.get(r.rejectionCode) || {
          count: 0,
          category: r.rejectionCategory || 'OTHER',
          description: r.rejectionReason || r.rejectionCode,
        };
        existing.count++;
        if (r.rejectionReason) existing.description = r.rejectionReason;
        rejectionCodeMap.set(r.rejectionCode, existing);
      }
    }

    const totalRejections = Array.from(rejectionCodeMap.values()).reduce(
      (acc, val) => acc + val.count,
      0
    );

    const topRejectionReasons: RejectionReasonStat[] = Array.from(rejectionCodeMap.entries())
      .map(([code, data]) => ({
        rejectionCode: code,
        count: data.count,
        percentage:
          totalRejections > 0
            ? parseFloat(((data.count / totalRejections) * 100).toFixed(1))
            : 0,
        category: data.category,
        description: data.description,
      }))
      .sort((a, b) => b.count - a.count);

    return {
      timestamp: now,
      totalScannedCandidates,
      totalFinalSignals,
      conversionRatePct,
      stagePassThrough,
      categoryBreakdown,
      topRejectionReasons,
      recordsCount: filteredRecords.length,
    };
  }

  /**
   * Returns recent candidate records for debugging and monitoring
   */
  public static getRecords(limit: number = 100): CandidateFunnelRecord[] {
    this.init();
    return Array.from(this.records.values())
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  /**
   * Resets stored records (primarily for testing)
   */
  public static clear(): void {
    this.records.clear();
    try {
      if (fs.existsSync(LOCAL_FUNNEL_PATH)) {
        fs.unlinkSync(LOCAL_FUNNEL_PATH);
      }
    } catch {
      // Ignore
    }
  }
}
