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
import { serverConfig } from '../config.js';

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

export type CandidateLifecycleStage =
  | 'DISCOVERED'
  | 'SCREENED'
  | 'SELECTED_FOR_DEEP_ANALYSIS'
  | 'DEEP_ANALYSIS_COMPLETED'
  | 'FINAL_CLASSIFICATION'
  | 'ACCEPTED'
  | 'REJECTED';

export type RejectionCategory =
  | 'THRESHOLD'
  | 'RR'
  | 'VOLATILITY'
  | 'DATA'
  | 'ENTRY_QUALITY'
  | 'CORRELATION'
  | 'DAILY_CAP'
  | 'OTHER'
  | 'SCORE'
  | 'PROBABILITY'
  | 'STRATEGY_AGREEMENT'
  | 'TIMEFRAME_ALIGNMENT'
  | 'NEWS';

export interface CandidateFunnelRecord {
  id: string;
  candidateKey: string;
  timestamp: number;
  symbol: string;
  direction: 'BUY' | 'SELL' | 'LONG' | 'SHORT' | 'NEUTRAL';
  timeframe?: string;
  stage: FunnelStage;
  lifecycleStage: CandidateLifecycleStage;
  highestLifecycleStage: CandidateLifecycleStage;
  status: 'IN_PROGRESS' | 'COMPLETED' | 'REJECTED' | 'ACCEPTED' | 'ERROR';
  score: number;
  regime: string;
  strategy: string;
  rejectionCode: string | null;
  rejectionReason: string | null;
  rejectionCategory: RejectionCategory | null;
  passedGates?: string[];

  // Gate 55 Complete Telemetry Fields
  assetClass?: string;
  initialScore?: number;
  watchingThreshold?: number;
  qualifiedCandidateThreshold?: number;
  signalThreshold?: number;
  strategyAgreementRatio?: number;
  timeframeAlignmentRatio?: number;
  grossRR?: number;
  netRR?: number;
  adverseNetRR?: number;
  estimatedWinRate?: number;
  empiricalProbability?: number | null;
  probabilitySampleSize?: number;
  aiMode?: string;
  aiResult?: string;
  dataFreshness?: string;
  entryQuality?: string;
  newsStatus?: string;
  correlationCluster?: string;
  finalDecision?: string;
  rejectionStage?: string;

  // Discrete stage transition flags guaranteeing mathematical invariants
  reachedScreened: boolean;
  reachedDeepAnalysis: boolean;
  completedDeepAnalysis: boolean;
  isAccepted: boolean;
  isRejected: boolean;
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

  funnelMetrics: {
    candidatesScanned: number;
    screened: number;
    deepAnalysis: number;
    completed: number;
    watching: number;
    qualified: number;
    signals: number;
    rejectedByScore: number;
    rejectedByRR: number;
    rejectedByProbability: number;
    rejectedByStrategyAgreement: number;
    rejectedByTimeframeAlignment: number;
    rejectedByData: number;
    rejectedByEntryQuality: number;
    rejectedByNews: number;
    rejectedByCorrelation: number;
    rejectedByDailyCap: number;
  };

  lifecycleCounts: {
    totalCandidates: number;
    screenedCandidates: number;
    deepAnalysisCandidates: number;
    completedCandidates: number;
    acceptedCandidates: number;
    rejectedCandidates: number;
    earlyRejectedCandidates: number;
    deepRejectedCandidates: number;
  };
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
   * Categorizes a rejection code or reason into one of the core analytics buckets
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
      text.includes('NEWS') ||
      text.includes('ECONOMIC_EVENT') ||
      text.includes('BLACKOUT') ||
      text.includes('MARKET_CONTEXT_BLOCKED') ||
      text.includes('GATE_7') ||
      text.includes('NEWS_SENTIMENT')
    ) {
      return 'NEWS';
    }

    if (
      text.includes('DATA_STALE') ||
      text.includes('INVALID_DATA') ||
      text.includes('PRICE_MISMATCH') ||
      text.includes('CANDLE') ||
      text.includes('PROVIDER_DISAGREEMENT') ||
      text.includes('STALE_EXECUTABLE_QUOTE') ||
      text.includes('IMPOSSIBLE_PRICE') ||
      text.includes('STALE') ||
      text.includes('INSUFFICIENT_DATA')
    ) {
      return 'DATA';
    }

    if (
      text.includes('ENTRY') ||
      text.includes('INVALID_SL') ||
      text.includes('UNEXECUTABLE') ||
      text.includes('CONFIRMATION_DIVERSITY') ||
      text.includes('LOCATION') ||
      text.includes('INVALID_SL_TP') ||
      text.includes('SL_TP')
    ) {
      return 'ENTRY_QUALITY';
    }

    if (
      text.includes('RR_BELOW') ||
      text.includes('NET_RR') ||
      text.includes('EXECUTION_COST') ||
      text.includes('SAFETY_BUFFER') ||
      text.includes('ADVERSE_NET_RR') ||
      text.includes('EXECUTION_FRICTION') ||
      text.includes('FRICTION') ||
      text.includes('R:R')
    ) {
      return 'RR';
    }

    if (
      text.includes('TIMEFRAME_ALIGNMENT') ||
      text.includes('INSUFFICIENT_TIMEFRAME_ALIGNMENT') ||
      text.includes('TIMEFRAME')
    ) {
      return 'TIMEFRAME_ALIGNMENT';
    }

    if (
      text.includes('STRATEGY_AGREEMENT') ||
      text.includes('INSUFFICIENT_STRATEGY_AGREEMENT') ||
      text.includes('STRATEGY')
    ) {
      return 'STRATEGY_AGREEMENT';
    }

    if (
      text.includes('WIN_RATE_BELOW') ||
      text.includes('WIN_RATE') ||
      text.includes('PROBABILITY') ||
      text.includes('EXPECTANCY') ||
      text.includes('EXPECTED_VALUE') ||
      text.includes('NEGATIVE_EXPECTANCY')
    ) {
      return 'PROBABILITY';
    }

    if (
      text.includes('THRESHOLD') ||
      text.includes('SCORE_BELOW') ||
      text.includes('COMPOSITE_SCORE') ||
      text.includes('SCORE') ||
      text.includes('INSUFFICIENT_CONFLUENCE') ||
      text.includes('QUALITATIVE') ||
      text.includes('SPECTRAL')
    ) {
      return 'SCORE';
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

    return 'OTHER';
  }

  /**
   * Logs or updates a scanned candidate record as it progresses through the funnel or gets rejected.
   */
  public static recordCandidate(params: {
    symbol: string;
    direction?: 'BUY' | 'SELL' | 'LONG' | 'SHORT' | 'NEUTRAL';
    timeframe?: string;
    stage: FunnelStage;
    lifecycleStage?: CandidateLifecycleStage;
    score?: number;
    regime?: string;
    strategy?: string;
    rejectionCode?: string | null;
    rejectionReason?: string | null;
    passedGates?: string[];
    id?: string;
    candidateKey?: string;

    // Gate 55 Complete Telemetry Fields
    assetClass?: string;
    initialScore?: number;
    watchingThreshold?: number;
    qualifiedCandidateThreshold?: number;
    signalThreshold?: number;
    strategyAgreementRatio?: number;
    timeframeAlignmentRatio?: number;
    grossRR?: number;
    netRR?: number;
    adverseNetRR?: number;
    estimatedWinRate?: number;
    empiricalProbability?: number | null;
    probabilitySampleSize?: number;
    aiMode?: string;
    aiResult?: string;
    dataFreshness?: string;
    entryQuality?: string;
    newsStatus?: string;
    correlationCluster?: string;
    finalDecision?: string;
    rejectionStage?: string;
  }): CandidateFunnelRecord {
    this.init();

    const now = Date.now();
    const symbolClean = params.symbol.toUpperCase().trim();
    const direction = params.direction || 'BUY';
    const timeframe = params.timeframe || '1H';
    const score = typeof params.score === 'number' ? params.score : 0;
    const regime = params.regime || 'UNKNOWN';
    const strategy = params.strategy || 'MULTI_STRATEGY';

    const rejCode = params.rejectionCode || (params.rejectionReason ? this.extractRejectionCode(params.rejectionReason) : null);
    const rejReason = params.rejectionReason || null;
    const rejCategory = rejCode || rejReason ? this.categorizeRejection(rejCode, rejReason) : null;
    const isRejection = Boolean(
      rejCode ||
      rejReason ||
      params.finalDecision === 'REJECTED' ||
      (params.rejectionStage && params.rejectionStage !== 'NONE')
    );

    // Form stable candidate key
    const derivedKey = params.candidateKey || params.id || `${symbolClean}_${direction}_${timeframe}`;

    // Active lookup within last 10 minutes or matching ID/candidateKey/symbol+direction
    let record: CandidateFunnelRecord | undefined = undefined;
    const tenMinutesAgo = now - 10 * 60 * 1000;

    for (const r of this.records.values()) {
      if (r.timestamp >= tenMinutesAgo) {
        if (params.id && r.id === params.id) {
          record = r;
          break;
        }
        if (params.candidateKey && r.candidateKey === params.candidateKey) {
          record = r;
          break;
        }
        if (r.candidateKey === derivedKey) {
          record = r;
          break;
        }
        if (r.symbol === symbolClean && r.direction === direction && (r.timeframe === timeframe || !r.timeframe || !timeframe)) {
          record = r;
          break;
        }
      }
    }

    // Target lifecycle inference from stage
    let targetLifecycle: CandidateLifecycleStage = params.lifecycleStage || 'DISCOVERED';
    if (!params.lifecycleStage) {
      if (params.stage === 'FINAL_SIGNAL' || params.finalDecision === 'SIGNALS') {
        targetLifecycle = 'ACCEPTED';
      } else if (params.stage === 'RANKING') {
        targetLifecycle = 'DEEP_ANALYSIS_COMPLETED';
      } else if (['GATE_6', 'GATE_7', 'GATE_8', 'GATE_9'].includes(params.stage)) {
        targetLifecycle = 'SELECTED_FOR_DEEP_ANALYSIS';
      } else if (['STAGE_2', 'GATE_0', 'GATE_1', 'GATE_2', 'GATE_3', 'GATE_4', 'GATE_5'].includes(params.stage)) {
        targetLifecycle = 'SCREENED';
      } else {
        targetLifecycle = 'DISCOVERED';
      }
    }

    if (!record) {
      const id = params.id || `funnel_${now}_${symbolClean}_${Math.random().toString(36).substring(2, 7)}`;
      record = {
        id,
        candidateKey: derivedKey,
        timestamp: now,
        symbol: symbolClean,
        direction,
        timeframe,
        stage: params.stage,
        lifecycleStage: isRejection ? 'REJECTED' : targetLifecycle,
        highestLifecycleStage: isRejection ? 'DISCOVERED' : targetLifecycle,
        status: isRejection ? 'REJECTED' : (params.stage === 'FINAL_SIGNAL' ? 'ACCEPTED' : 'IN_PROGRESS'),
        score,
        regime,
        strategy,
        rejectionCode: rejCode,
        rejectionReason: rejReason,
        rejectionCategory: rejCategory,
        passedGates: params.passedGates,

        assetClass: params.assetClass,
        initialScore: params.initialScore !== undefined ? params.initialScore : score,
        watchingThreshold: params.watchingThreshold,
        qualifiedCandidateThreshold: params.qualifiedCandidateThreshold,
        signalThreshold: params.signalThreshold,
        strategyAgreementRatio: params.strategyAgreementRatio,
        timeframeAlignmentRatio: params.timeframeAlignmentRatio,
        grossRR: params.grossRR,
        netRR: params.netRR,
        adverseNetRR: params.adverseNetRR,
        estimatedWinRate: params.estimatedWinRate,
        empiricalProbability: params.empiricalProbability,
        probabilitySampleSize: params.probabilitySampleSize,
        aiMode: params.aiMode,
        aiResult: params.aiResult,
        dataFreshness: params.dataFreshness,
        entryQuality: params.entryQuality,
        newsStatus: params.newsStatus,
        correlationCluster: params.correlationCluster,
        finalDecision: params.finalDecision,
        rejectionStage: params.rejectionStage || params.stage,

        reachedScreened: ['STAGE_2', 'GATE_0', 'GATE_1', 'GATE_2', 'GATE_3', 'GATE_4', 'GATE_5', 'GATE_6', 'GATE_7', 'GATE_8', 'GATE_9', 'RANKING', 'FINAL_SIGNAL'].includes(params.stage),
        reachedDeepAnalysis: ['GATE_6', 'GATE_7', 'GATE_8', 'GATE_9', 'RANKING', 'FINAL_SIGNAL'].includes(params.stage),
        completedDeepAnalysis: ['RANKING', 'FINAL_SIGNAL'].includes(params.stage) && !isRejection,
        isAccepted: (params.stage === 'FINAL_SIGNAL' || params.finalDecision === 'SIGNALS') && !isRejection,
        isRejected: isRejection,
      };
      this.records.set(id, record);
    } else {
      // Update existing record cleanly
      record.timestamp = now; // update timestamp to keep active
      if (params.direction) record.direction = params.direction;
      if (params.timeframe) record.timeframe = params.timeframe;
      record.stage = params.stage;
      if (params.score !== undefined) record.score = params.score;
      if (params.regime) record.regime = params.regime;
      if (params.strategy) record.strategy = params.strategy;

      // Telemetry fields
      if (params.assetClass) record.assetClass = params.assetClass;
      if (params.initialScore !== undefined) record.initialScore = params.initialScore;
      if (params.watchingThreshold !== undefined) record.watchingThreshold = params.watchingThreshold;
      if (params.qualifiedCandidateThreshold !== undefined) record.qualifiedCandidateThreshold = params.qualifiedCandidateThreshold;
      if (params.signalThreshold !== undefined) record.signalThreshold = params.signalThreshold;
      if (params.strategyAgreementRatio !== undefined) record.strategyAgreementRatio = params.strategyAgreementRatio;
      if (params.timeframeAlignmentRatio !== undefined) record.timeframeAlignmentRatio = params.timeframeAlignmentRatio;
      if (params.grossRR !== undefined) record.grossRR = params.grossRR;
      if (params.netRR !== undefined) record.netRR = params.netRR;
      if (params.adverseNetRR !== undefined) record.adverseNetRR = params.adverseNetRR;
      if (params.estimatedWinRate !== undefined) record.estimatedWinRate = params.estimatedWinRate;
      if (params.empiricalProbability !== undefined) record.empiricalProbability = params.empiricalProbability;
      if (params.probabilitySampleSize !== undefined) record.probabilitySampleSize = params.probabilitySampleSize;
      if (params.aiMode) record.aiMode = params.aiMode;
      if (params.aiResult) record.aiResult = params.aiResult;
      if (params.dataFreshness) record.dataFreshness = params.dataFreshness;
      if (params.entryQuality) record.entryQuality = params.entryQuality;
      if (params.newsStatus) record.newsStatus = params.newsStatus;
      if (params.correlationCluster) record.correlationCluster = params.correlationCluster;
      if (params.finalDecision) record.finalDecision = params.finalDecision;
      if (params.passedGates) record.passedGates = params.passedGates;

      // Lifecycle updates
      if (['STAGE_2', 'GATE_0', 'GATE_1', 'GATE_2', 'GATE_3', 'GATE_4', 'GATE_5', 'GATE_6', 'GATE_7', 'GATE_8', 'GATE_9', 'RANKING', 'FINAL_SIGNAL'].includes(params.stage)) {
        record.reachedScreened = true;
      }
      if (['GATE_6', 'GATE_7', 'GATE_8', 'GATE_9', 'RANKING', 'FINAL_SIGNAL'].includes(params.stage)) {
        record.reachedDeepAnalysis = true;
      }

      if (isRejection) {
        record.isRejected = true;
        record.status = 'REJECTED';
        record.rejectionCode = rejCode;
        record.rejectionReason = rejReason;
        record.rejectionCategory = rejCategory;
        record.rejectionStage = params.rejectionStage || params.stage;
        record.lifecycleStage = 'REJECTED';
        record.completedDeepAnalysis = false;
        record.isAccepted = false;
      } else {
        record.isRejected = false;
        record.rejectionCode = null;
        record.rejectionReason = null;
        record.rejectionCategory = null;
        record.rejectionStage = undefined;

        if (['RANKING', 'FINAL_SIGNAL'].includes(params.stage)) {
          record.completedDeepAnalysis = true;
        }
        if (params.stage === 'FINAL_SIGNAL' || params.finalDecision === 'SIGNALS') {
          record.isAccepted = true;
          record.status = 'ACCEPTED';
          record.lifecycleStage = 'ACCEPTED';
        } else {
          record.lifecycleStage = targetLifecycle;
        }
      }
    }

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

    const totalCandidates = filteredRecords.length;
    const screenedCandidates = filteredRecords.filter(r => r.reachedScreened).length;
    const deepAnalysisCandidates = filteredRecords.filter(r => r.reachedDeepAnalysis).length;
    const completedCandidates = filteredRecords.filter(r => r.completedDeepAnalysis).length;
    const acceptedCandidates = filteredRecords.filter(r => r.isAccepted).length;
    const rejectedCandidates = filteredRecords.filter(r => r.isRejected).length;
    const earlyRejectedCandidates = filteredRecords.filter(r => r.isRejected && !r.reachedDeepAnalysis).length;
    const deepRejectedCandidates = filteredRecords.filter(r => r.isRejected && r.reachedDeepAnalysis).length;

    const totalScannedCandidates = totalCandidates;
    const totalFinalSignals = acceptedCandidates;
    const conversionRatePct =
      totalScannedCandidates > 0
        ? parseFloat(((totalFinalSignals / totalScannedCandidates) * 100).toFixed(2))
        : 0;

    // Calculate highest stage index for each candidate record
    const recordHighestStageIndices = filteredRecords.map(r => {
      if (r.isAccepted) return FUNNEL_STAGE_ORDER.indexOf('FINAL_SIGNAL');
      if (r.completedDeepAnalysis) return FUNNEL_STAGE_ORDER.indexOf('RANKING');
      if (r.isRejected) {
        const rejStage = (r.rejectionStage || r.stage) as FunnelStage;
        const idx = FUNNEL_STAGE_ORDER.indexOf(rejStage);
        return idx >= 0 ? idx : 0;
      }
      const idx = FUNNEL_STAGE_ORDER.indexOf(r.stage);
      return idx >= 0 ? idx : 0;
    });

    const stagePassThrough: StagePassThroughStat[] = FUNNEL_STAGE_ORDER.map((stage, stageIdx) => {
      const count = recordHighestStageIndices.filter(idx => idx >= stageIdx).length;
      const pct =
        totalScannedCandidates > 0
          ? parseFloat(((count / totalScannedCandidates) * 100).toFixed(1))
          : 0;
      const prevCount = stageIdx > 0
        ? recordHighestStageIndices.filter(idx => idx >= stageIdx - 1).length
        : totalScannedCandidates;
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

    // Category breakdown and funnelMetrics
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

    const funnelMetrics = {
      candidatesScanned: totalCandidates,
      screened: screenedCandidates,
      deepAnalysis: deepAnalysisCandidates,
      completed: completedCandidates,
      watching: 0,
      qualified: 0,
      signals: acceptedCandidates,
      rejectedByScore: 0,
      rejectedByRR: 0,
      rejectedByProbability: 0,
      rejectedByStrategyAgreement: 0,
      rejectedByTimeframeAlignment: 0,
      rejectedByData: 0,
      rejectedByEntryQuality: 0,
      rejectedByNews: 0,
      rejectedByCorrelation: 0,
      rejectedByDailyCap: 0,
    };

    const rejectionCodeMap: Map<string, { count: number; category: RejectionCategory; description: string }> = new Map();

    for (const r of filteredRecords) {
      if (r.isRejected) {
        const cat = r.rejectionCategory || 'OTHER';
        switch (cat) {
          case 'THRESHOLD':
          case 'SCORE':
            categoryBreakdown.signalsLostByThreshold++;
            funnelMetrics.rejectedByScore++;
            break;
          case 'RR':
            categoryBreakdown.signalsLostByRR++;
            funnelMetrics.rejectedByRR++;
            break;
          case 'VOLATILITY':
            categoryBreakdown.signalsLostByVolatility++;
            funnelMetrics.rejectedByScore++;
            break;
          case 'DATA':
            categoryBreakdown.signalsLostByData++;
            funnelMetrics.rejectedByData++;
            break;
          case 'ENTRY_QUALITY':
            categoryBreakdown.signalsLostByEntryQuality++;
            funnelMetrics.rejectedByEntryQuality++;
            break;
          case 'CORRELATION':
            categoryBreakdown.signalsLostByCorrelation++;
            funnelMetrics.rejectedByCorrelation++;
            break;
          case 'DAILY_CAP':
            categoryBreakdown.signalsLostByDailyCap++;
            funnelMetrics.rejectedByDailyCap++;
            break;
          case 'PROBABILITY':
            categoryBreakdown.signalsLostByOther++;
            funnelMetrics.rejectedByProbability++;
            break;
          case 'STRATEGY_AGREEMENT':
            categoryBreakdown.signalsLostByOther++;
            funnelMetrics.rejectedByStrategyAgreement++;
            break;
          case 'TIMEFRAME_ALIGNMENT':
            categoryBreakdown.signalsLostByOther++;
            funnelMetrics.rejectedByTimeframeAlignment++;
            break;
          case 'NEWS':
            categoryBreakdown.signalsLostByOther++;
            funnelMetrics.rejectedByNews++;
            break;
          default:
            categoryBreakdown.signalsLostByOther++;
            break;
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
      } else if (!r.isAccepted) {
        const authThresholds = serverConfig.getConfig().thresholds;
        const watchThresh = r.watchingThreshold ?? authThresholds.watchingThreshold;
        const qualThresh = r.qualifiedCandidateThreshold ?? authThresholds.qualifiedCandidateThreshold;

        if (r.score >= qualThresh) {
          funnelMetrics.qualified++;
        } else if (r.score >= watchThresh) {
          funnelMetrics.watching++;
        } else {
          funnelMetrics.watching++;
        }
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
      funnelMetrics,
      lifecycleCounts: {
        totalCandidates,
        screenedCandidates,
        deepAnalysisCandidates,
        completedCandidates,
        acceptedCandidates,
        rejectedCandidates,
        earlyRejectedCandidates,
        deepRejectedCandidates,
      },
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
    this.isInitialized = false;
  }
}
