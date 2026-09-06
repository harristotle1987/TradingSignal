/**
 * Automated Hourly Intelligent Scanner & Signal Selection Service
 *
 * Core Principles:
 * 1. Hourly background execution across Crypto, Forex, and Stocks.
 * 2. Strict Scarcity & Quality Hurdle:
 *    - Score >= signalThreshold (configured)
 *    - Estimated Win Rate > minimumWinProbability
 *    - Minimum Risk/Reward ratio
 *    - Positive mathematical expectancy
 *    - Sufficient ATR & price distance
 *    - Valid live provider price (NO stale/synthetic data)
 *    - Multi-timeframe confirmation
 *    - Acceptable spread / execution slippage friction
 *    - No major contradictory news
 * 3. Strict Ranking & Notification Tiers:
 *    - Rank 1: BEST TRADE (Highest Ranked Opportunity)
 *    - Rank 2: SECOND BEST
 *    - Rank 3+: SUGGESTIONS
 * 4. Duplicate & Material Improvement Filter:
 *    - Suppresses duplicate notifications for same symbol & direction unless
 *      the setup materially improves (Score >= +5, RR >= +0.5, or better entry).
 * 5. Correlation Risk Filter:
 *    - Prevents multiple correlated trades (e.g. BTC & ETH both BUY) from consuming
 *      the daily cap when a higher-ranked candidate already exists.
 * 6. Hard Daily Cap (Max 5 per day; 0–5 is valid):
 *    - Persisted in Firebase Firestore / local disk to survive Vercel/container restarts.
 *    - NEVER manufactures a trade to fill quota.
 *    - Sends NO TRADE notification only if configured.
 */

import { signalEngine } from './SignalEngine.js';
import { getDynamicPrecision } from '../../utils/formatters.js';
import { TradeRankingEngine } from './TradeRankingEngine.js';
import { SymbolNormalizer } from '../market/SymbolNormalizer.js';
import { Gate17CorrelationExposure } from './Gate17CorrelationExposure.js';
import { SignalLifecycleManager } from './SignalLifecycleManager.js';
import { SignalLogger } from './SignalLogger.js';
import { CooldownManager } from './CooldownManager.js';
import { CandidateRejectionTracker } from './CandidateRejectionTracker.js';
import { SignalFingerprint } from './SignalFingerprint.js';
import { SignalAuditStore } from './SignalAuditStore.js';
import { OpportunityFunnelStore } from './Gate26OpportunityFunnel.js';
import { Gate35SignalFunnelAnalytics } from './Gate35SignalFunnelAnalytics.js';
import { Gate36ConfigurableSignalFrequency } from './Gate36ConfigurableSignalFrequency.js';
import {
  ScannerPersistence,
  DailyCapState,
  PersistedSentSignal,
  PersistedRejectedCandidate,
  PersistedNotification,
} from './ScannerPersistence.js';
import { PushNotificationService } from '../notifications/PushNotificationService.js';
import { CronJobOrgService } from '../cron/CronJobOrgService.js';
import { logger } from '../logger.js';
import { serverConfig } from '../config.js';
import { TradingSignal, SignalDirection, isActionableSignal } from '../../types/index.js';

export interface ScannerSettings {
  enabled: boolean;
  notificationsEnabled: boolean;
  notifyOnNoTrade: boolean;
  intervalMinutes: number;
  signalsSentTimestamps: number[];
  lastScanTime: number;
}

export interface ManualScanResult {
  success: boolean;
  status: 'COMPLETED' | 'SCAN_ALREADY_RUNNING' | 'SKIPPED_CAP_REACHED' | 'SKIPPED_NOT_DUE' | 'PERSISTENCE_UNAVAILABLE_DEGRADED' | 'ERROR';
  message: string;
  timestamp: number;
  lastScanTime: number;
  universeSymbolsScanned?: number;
  preliminaryCandidatesFound?: number;
  candidatesRejectedPreliminary?: number;
  candidatesEvaluated: number;
  candidatesRejectedFinal?: number;
  candidatesRejectedBeforeMTF?: number;
  candidatesRejectedByMTF?: number;
  candidatesRejectedByScore?: number;
  candidatesRejectedByRR?: number;
  candidatesRejectedByStructure?: number;
  signalsGenerated?: number;
  signalsAccepted?: number;
  acceptedSignalsCount: number;
  acceptedSignals: TradingSignal[];
  signalsFound: number;
  qualifiedSetups: TradingSignal[];
  rejectedCount: number;
  rejectionReasons: string[];
  rejectionReasonsCounts?: Record<string, number>;
  rejectionReasonsAggregated?: Record<string, number>;
  candidateRejectionDetails?: any[];
  diagnosticsCount?: number;
  diagnostics?: string[];
  capState: DailyCapState;
  scanDurationMs?: number;
  timingTelemetry?: {
    globalScanStartMs: number;
    globalScanDeadlineMs: number;
    globalScanSoftDeadlineMs?: number;
    currentElapsedMs: number;
    remainingBudgetMs: number;
    gate6ElapsedMs: number;
    stage3ElapsedMs: number;
    timeBudgetExceeded: boolean;
    providerRequestsStoppedByBudget: boolean;
    executionId?: string;
    scanId?: string;
  };
  globalScanStartMs?: number;
  globalScanDeadlineMs?: number;
  globalScanSoftDeadlineMs?: number;
  currentElapsedMs?: number;
  remainingBudgetMs?: number;
  gate6ElapsedMs?: number;
  stage3ElapsedMs?: number;
  timeBudgetExceeded?: boolean;
  providerRequestsStoppedByBudget?: boolean;
  executionId?: string;
  scanId?: string;
}

export const SCANNER_SOFT_DEADLINE_MS = 16000;
export const SCANNER_HARD_DEADLINE_MS = 17500;

export class HourlyScannerService {
  private isScanning = false;

  constructor() {
    ScannerPersistence.init();
  }

  /**
   * Deduplicates rejection details across pipeline evaluations within the current scan cycle,
   * producing one authoritative deduplicated rejection set and consistent categorized counters.
   */
  public static processRejectionDetails(allCandidateRejectionDetails: any[]): {
    finalRejectedRecords: any[];
    authoritativeRejectedCount: number;
    finalCandidatesRejectedBeforeMTF: number;
    finalCandidatesRejectedByMTF: number;
    finalCandidatesRejectedByScore: number;
    finalCandidatesRejectedByRR: number;
    finalCandidatesRejectedByStructure: number;
    authoritativeRejectionCounts: Record<string, number>;
    rejectionReasonStrings: string[];
  } {
    const rejectedCandidateMap = new Map<string, any>();
    for (const record of allCandidateRejectionDetails) {
      if (
        record.finalDecision === 'REJECTED' ||
        (Array.isArray(record.failedGates) && record.failedGates.length > 0) ||
        record.primaryRejectionReason
      ) {
        const key = `${record.symbol}_${record.direction || ''}`;
        // Preserve the most complete/current evaluation record without merging historical failedGates
        rejectedCandidateMap.set(key, record);
      }
    }

    const finalRejectedRecords = Array.from(rejectedCandidateMap.values());
    const authoritativeRejectedCount = finalRejectedRecords.length;

    let finalCandidatesRejectedBeforeMTF = 0;
    let finalCandidatesRejectedByMTF = 0;
    let finalCandidatesRejectedByScore = 0;
    let finalCandidatesRejectedByRR = 0;
    let finalCandidatesRejectedByStructure = 0;
    const authoritativeRejectionCounts: Record<string, number> = {};

    for (const record of finalRejectedRecords) {
      const failedGates: string[] = Array.isArray(record.failedGates) ? record.failedGates : [];
      const reason: string = record.primaryRejectionReason || record.rejectionReason || record.reason || record.rejectionSummary || '';

      const isBeforeMTF =
        failedGates.includes('FINAL_SCORE_UNREACHABLE') ||
        record.stage === 'Gate 6 Pre-Audit' ||
        record.stage === 'Stage 0' ||
        record.stage === 'Stage 1';
      const isMTF = failedGates.includes('MTF_ALIGNMENT') || reason.includes('MTF');
      const isScore =
        failedGates.includes('FINAL_SCORE_BELOW_THRESHOLD') ||
        failedGates.includes('SCORE_TOO_LOW') ||
        failedGates.includes('SCORE') ||
        failedGates.includes('FINAL_SCORE_UNREACHABLE') ||
        reason.includes('SCORE');
      const isRR =
        failedGates.includes('RR') ||
        failedGates.includes('RR_INVALID') ||
        failedGates.includes('GROSS_RR_BELOW_THRESHOLD') ||
        failedGates.includes('NET_RR_BELOW_THRESHOLD') ||
        failedGates.includes('ADVERSE_NET_RR_BELOW_THRESHOLD') ||
        reason.includes('RR');
      const isStructure = failedGates.includes('MARKET_STRUCTURE') || reason.includes('STRUCTURE');

      if (isBeforeMTF) finalCandidatesRejectedBeforeMTF++;
      if (isMTF) finalCandidatesRejectedByMTF++;
      if (isScore) finalCandidatesRejectedByScore++;
      if (isRR) finalCandidatesRejectedByRR++;
      if (isStructure) finalCandidatesRejectedByStructure++;

      if (failedGates.length > 0) {
        const uniqueGates = Array.from(new Set(failedGates));
        for (const g of uniqueGates) {
          authoritativeRejectionCounts[g] = (authoritativeRejectionCounts[g] || 0) + 1;
        }
      } else {
        const match = reason.match(/REJECTED:\s*([A-Z0-9_]+)/);
        const fallbackGate = match ? match[1] : 'OTHER_REJECTION';
        authoritativeRejectionCounts[fallbackGate] = (authoritativeRejectionCounts[fallbackGate] || 0) + 1;
      }
    }

    const rejectionReasonStrings = finalRejectedRecords.map(
      (r) => `${r.symbol}${r.direction ? ` [${r.direction}]` : ''}: ${r.primaryRejectionReason || r.rejectionSummary || 'REJECTED'}`
    );

    return {
      finalRejectedRecords,
      authoritativeRejectedCount,
      finalCandidatesRejectedBeforeMTF,
      finalCandidatesRejectedByMTF,
      finalCandidatesRejectedByScore,
      finalCandidatesRejectedByRR,
      finalCandidatesRejectedByStructure,
      authoritativeRejectionCounts,
      rejectionReasonStrings,
    };
  }

  /**
   * Initializes the hourly scanner in Authoritative Cron-Driven Mode.
   * Background setInterval loop is removed to eliminate competing timers against cron-job.org.
   * All automated scans are driven authoritatively through /api/scanner/trigger.
   */
  start(): void {
    ScannerPersistence.init();
    logger.info('[Hourly Scanner] Initialized in Authoritative Cron-Driven Mode. Automated scans driven strictly via /api/scanner/trigger (cron-job.org).');
  }

  /**
   * Stops the scanner service.
   */
  stop(): void {
    logger.info('[Hourly Scanner] Scanner service stopped.');
  }

  /**
   * Manually triggers a scan execution (e.g. from UI admin actions).
   */
  async triggerManualScan(isExternal = false, scanStartTime?: number): Promise<ManualScanResult> {
    return await this.executeIntelligentScan(isExternal, scanStartTime ? { scanStartedAt: scanStartTime } : undefined);
  }

  /**
   * Directly invokes Market Scan Engine when triggered by external cron-job.org.
   * A cron execution means: "SCAN THE MARKET NOW."
   * It does NOT check whether an internal timer or setting says it is due.
   */
  async triggerAutomatedScan(isExternal = true, scanStartTime?: number): Promise<ManualScanResult> {
    const now = Date.now();
    const configuredTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    logger.info(`[Hourly Scanner] CRON_TRIGGER_EXECUTING | Date.now(): ${now} | ISO UTC: ${new Date(now).toISOString()} | Runtime TZ: ${configuredTz}`);

    // Selectively clear expired cache entries and ticker quotes before scan cycle
    const { marketCache } = await import('../market/CacheStore.js');
    marketCache.clearExpired();
    marketCache.clearTickers();
    return await this.executeIntelligentScan(isExternal, scanStartTime ? { scanStartedAt: scanStartTime } : undefined);
  }

  /**
   * Main Intelligent Multi-Asset Scan & Signal Selection Pipeline.
   */
  private async executeIntelligentScan(
    isExternal = false,
    options?: { scanStartedAt?: number; globalScanBudgetMs?: number; executionId?: string }
  ): Promise<ManualScanResult> {
    const scanStartTime = options?.scanStartedAt ?? Date.now();
    const globalScanStartMs = scanStartTime;
    const GLOBAL_SCAN_BUDGET_MS = options?.globalScanBudgetMs ?? SCANNER_HARD_DEADLINE_MS;
    const globalScanDeadlineMs = globalScanStartMs + GLOBAL_SCAN_BUDGET_MS;
    const globalScanSoftDeadlineMs = globalScanStartMs + Math.min(SCANNER_SOFT_DEADLINE_MS, Math.max(0, GLOBAL_SCAN_BUDGET_MS - 1500));
    const executionId = options?.executionId ?? `scan-${globalScanStartMs}-${Math.random().toString(36).substring(2, 9)}`;
    logger.info(`[Scanner Telemetry] MARKET_SCAN_ENGINE_START | isExternal: ${isExternal} | startTime: ${scanStartTime} | deadline: ${globalScanDeadlineMs} | softDeadline: ${globalScanSoftDeadlineMs} | executionId: ${executionId}`);

    if (process.env.NODE_ENV === 'production' && !ScannerPersistence.isProductionPersistenceReady()) {
      logger.error('[Hourly Scanner] AUTOMATED SCANNER DISPATCH DISABLED: Production persistence is unavailable (FIREBASE_SERVICE_ACCOUNT required).');
      const capState = await ScannerPersistence.getCapState(serverConfig.getConfig().thresholds.dailySignalCap);
      return {
        success: false,
        status: 'PERSISTENCE_UNAVAILABLE_DEGRADED',
        message: 'REJECTED: PRODUCTION_PERSISTENCE_UNAVAILABLE. Firebase Service Account required for automated scanner dispatch in production.',
        timestamp: Date.now(),
        lastScanTime: capState.lastScanTime,
        candidatesEvaluated: 0,
        acceptedSignalsCount: 0,
        acceptedSignals: [],
        signalsFound: 0,
        qualifiedSetups: [],
        rejectedCount: 0,
        rejectionReasons: ['REJECTED: PRODUCTION_PERSISTENCE_UNAVAILABLE. FIREBASE_SERVICE_ACCOUNT is required in production mode.'],
        capState,
      };
    }

    const instanceId = Math.random().toString(36).substring(2, 9);
    const lockResult = await ScannerPersistence.tryAcquireLock(instanceId);

    if (!lockResult.acquired) {
      const capState = await ScannerPersistence.getCapState(serverConfig.getConfig().thresholds.dailySignalCap);
      logger.warn(`[Hourly Scanner] Concurrency lock check: ${lockResult.reason || 'Scan already running'}`);
      return {
        success: false,
        status: 'SCAN_ALREADY_RUNNING',
        message: 'REJECTED: SCAN_ALREADY_RUNNING. Another scan cycle is currently in progress.',
        timestamp: Date.now(),
        lastScanTime: capState.lastScanTime,
        candidatesEvaluated: 0,
        acceptedSignalsCount: 0,
        acceptedSignals: [],
        signalsFound: 0,
        qualifiedSetups: [],
        rejectedCount: 0,
        rejectionReasons: ['REJECTED: SCAN_ALREADY_RUNNING. Concurrent scan execution prevented.'],
        capState,
      };
    }

    this.isScanning = true;

    logger.info('================================================================');
    logger.info('[Hourly Intelligent Scanner] Initiating Multi-Asset Scan Cycle...');
    logger.info('================================================================');

    try {
      // 0. Evaluate active signals lifecycle (TP/SL/Expiration hits) and Adaptive Opportunity Funnel
      const lifecycleStart = Date.now();
      const lifecycleEval = await SignalLifecycleManager.evaluateActiveSignals();
      if (lifecycleEval.evaluatedCount > 0) {
        logger.info(`[Hourly Scanner] Lifecycle evaluation complete: ${lifecycleEval.evaluatedCount} active signals evaluated. TP Hits: ${lifecycleEval.tpHitCount}, SL Hits: ${lifecycleEval.slHitCount}, Expired: ${lifecycleEval.expiredCount}.`);
      }

      // Evaluate Opportunity Funnel items (Gate 26)
      const funnelReport = OpportunityFunnelStore.evaluateAll();
      if (funnelReport.totalActive > 0) {
        logger.info(`[Hourly Scanner] Opportunity Funnel evaluation: ${funnelReport.totalActive} active tracked candidates (${funnelReport.watchingCount} watching, ${funnelReport.qualifiedCount} qualified, ${funnelReport.promotedCount} promoted).`);
      }
      const lifecycleDurationMs = Date.now() - lifecycleStart;
      logger.info(`[Scanner Telemetry] LIFECYCLE_EVALUATION | duration: ${lifecycleDurationMs}ms`);

      // 1. Check current Daily Cap state
      const capState = await ScannerPersistence.getCapState(serverConfig.getConfig().thresholds.dailySignalCap);
      const currentDailyCount = capState.dailySignalCount;
      const dailyCap = capState.dailySignalCap || serverConfig.getConfig().thresholds.dailySignalCap;

      if (currentDailyCount >= dailyCap) {
        logger.info(`[Hourly Scanner] Daily automated signal cap reached (${currentDailyCount}/${dailyCap}). Scanning skipped to preserve portfolio limits.`);
        return {
          success: true,
          status: 'SKIPPED_CAP_REACHED',
          message: `REJECTED: DAILY_CAP_REACHED. Daily automated signal cap reached (${currentDailyCount}/${dailyCap}). Preserving risk limits.`,
          timestamp: Date.now(),
          lastScanTime: capState.lastAutomatedScan || capState.lastScanTime || 0,
          candidatesEvaluated: 0,
          acceptedSignalsCount: 0,
          acceptedSignals: [],
          signalsFound: 0,
          qualifiedSetups: [],
          rejectedCount: 0,
          rejectionReasons: [`REJECTED: DAILY_CAP_REACHED. Daily automated signal cap reached (${currentDailyCount}/${dailyCap}). Preserving portfolio risk limits.`],
          capState,
        };
      }

      const remainingAllowance = dailyCap - currentDailyCount;
      logger.info(`[Hourly Scanner] Daily Cap status: ${currentDailyCount}/${dailyCap} used. Remaining allowance: ${remainingAllowance}`);

      // 2. Scan all three universes in parallel: CRYPTO, FOREX, STOCKS
      const marketDataFetchStart = Date.now();
      const categories: Array<'CRYPTO' | 'FOREX' | 'STOCKS'> = ['CRYPTO', 'FOREX', 'STOCKS'];
      const rawCandidates: TradingSignal[] = [];
      const universeDiagnostics: Array<{ symbol: string; reason: string }> = [];
      const rejectedDuringScan: Array<{ symbol: string; direction?: string; score?: number; reason: string }> = [];

      let maxGate6ElapsedMs = 0;
      let maxStage3ElapsedMs = 0;
      let aggregatedTimeBudgetExceeded = false;
      let aggregatedProviderRequestsStoppedByBudget = false;

      const categoryScanResults = await Promise.all(
        categories.map(async (category) => {
          try {
            logger.info(`[Hourly Scanner] Scanning universe: [${category}]...`);
            const result = await signalEngine.generateSignal(category, category, false, {
              scanStartedAt: globalScanStartMs,
              globalScanBudgetMs: GLOBAL_SCAN_BUDGET_MS,
              executionId,
            });
            return { category, result };
          } catch (catErr) {
            logger.error(`[Hourly Scanner] Scan error for ${category}:`, { error: String(catErr) });
            return { category, result: { success: false, reason: String(catErr) } as any };
          }
        })
      );

      let totalUniverseSymbolsScanned = 0;
      let totalPreliminaryCandidatesFound = 0;
      let totalCandidatesRejectedPreliminary = 0;
      let totalCandidatesEvaluated = 0;
      let totalCandidatesRejectedFinal = 0;
      let totalSignalsGenerated = 0;
      const aggregatedRejectionCounts: Record<string, number> = {};
      const allCandidateRejectionDetails: any[] = [];

      for (const { category, result } of categoryScanResults) {
        const catUniverseSize = category === 'CRYPTO' ? 45 : category === 'FOREX' ? 20 : 48;
        const tel = result?.telemetry;

        const universeSymbolsScanned = tel?.universeSymbolsScanned ?? catUniverseSize;
        const preliminaryCandidatesFound = tel?.preliminaryCandidatesFound ?? (result.success && Array.isArray(result.signals) ? result.signals.length : 0);
        const candidatesRejectedPreliminary = tel?.candidatesRejectedPreliminary ?? (universeSymbolsScanned - preliminaryCandidatesFound);
        const candidatesEvaluated = tel?.candidatesEvaluated ?? preliminaryCandidatesFound;
        const candidatesRejectedFinal = tel?.candidatesRejectedFinal ?? (candidatesEvaluated - (result.success && Array.isArray(result.signals) ? result.signals.length : 0));
        const signalsGenerated = tel?.signalsGenerated ?? (result.success && Array.isArray(result.signals) ? result.signals.length : 0);

        if (tel) {
          if (typeof tel.gate6ElapsedMs === 'number' && tel.gate6ElapsedMs > maxGate6ElapsedMs) {
            maxGate6ElapsedMs = tel.gate6ElapsedMs;
          }
          if (typeof tel.stage3ElapsedMs === 'number' && tel.stage3ElapsedMs > maxStage3ElapsedMs) {
            maxStage3ElapsedMs = tel.stage3ElapsedMs;
          }
          if (tel.timeBudgetExceeded) aggregatedTimeBudgetExceeded = true;
          if (tel.providerRequestsStoppedByBudget) aggregatedProviderRequestsStoppedByBudget = true;
        }

        totalUniverseSymbolsScanned += universeSymbolsScanned;
        totalPreliminaryCandidatesFound += preliminaryCandidatesFound;
        totalCandidatesRejectedPreliminary += candidatesRejectedPreliminary;
        totalCandidatesEvaluated += candidatesEvaluated;
        totalCandidatesRejectedFinal += candidatesRejectedFinal;
        totalSignalsGenerated += signalsGenerated;

        // Aggregate granular rejection reasons and candidate logs
        if (result.rejectionReasons) {
          for (const [gate, count] of Object.entries(result.rejectionReasons)) {
            aggregatedRejectionCounts[gate] = (aggregatedRejectionCounts[gate] || 0) + (count as number);
          }
        }
        if (Array.isArray(result.candidateRejectionDetails)) {
          allCandidateRejectionDetails.push(...result.candidateRejectionDetails);
        }

        if (result.success && Array.isArray(result.signals)) {
          rawCandidates.push(...result.signals);
        } else if (result.reason) {
          universeDiagnostics.push({
            symbol: category,
            reason: result.reason,
          });
        }
      }

      logger.info(`================================================================`);
      logger.info(`[MULTI-ASSET FUNNEL AUDIT] (Total Scanned: ${totalUniverseSymbolsScanned})`);
      logger.info(`- preliminaryCandidates: ${totalPreliminaryCandidatesFound}`);
      logger.info(`- candidatesAfterQuota (deep budget sum): ${totalCandidatesEvaluated}`);
      logger.info(`- candidatesSelectedForDeepAnalysis: ${totalCandidatesEvaluated}`);
      logger.info(`- signalsSurvivingToStage3: ${totalSignalsGenerated}`);
      logger.info(`================================================================`);

      const marketDataFetchDurationMs = Date.now() - marketDataFetchStart;
      logger.info(`[Scanner Telemetry] MARKET_DATA_FETCHING | duration: ${marketDataFetchDurationMs}ms | rawCandidatesFound: ${rawCandidates.length}`);
      logger.info(`[Scanner Telemetry] CANDIDATE_DISCOVERY | rawCandidatesCount: ${rawCandidates.length} | duration: ${marketDataFetchDurationMs}ms`);

      logger.info(`[Hourly Scanner] Raw candidate setups gathered: ${rawCandidates.length}. Applying mandatory qualification filters...`);

      // Evaluation start
      const evaluationStart = Date.now();

      // GATE 36: Separate candidate count tracking (candidates do NOT consume signal slots)
      Gate36ConfigurableSignalFrequency.recordCandidateCount(rawCandidates.length);

      const thresholds = serverConfig.getConfig().thresholds;

      // Log raw candidates entering funnel
      for (const sig of rawCandidates) {
        const score = sig.score ?? sig.confidenceScore ?? 0;
        const grossRR = (sig as any).grossRiskRewardRatio ?? sig.riskRewardRatio ?? 0;
        const netRR = (sig as any).netRiskRewardRatio ?? sig.estimatedFriction?.netRiskRewardRatio ?? 0;
        const adverseNetRR = (sig as any).adverseNetRiskRewardRatio ?? (sig.estimatedFriction as any)?.adverseNetRiskRewardRatio ?? 0;
        const winRate = sig.modelEstimatedWinRate ?? sig.estimatedWinRate ?? 0;
        const empProb = sig.isEmpiricallyCalibrated === true && typeof sig.empiricalProbability === 'number' ? sig.empiricalProbability : null;
        const sampleSize = typeof sig.probabilitySampleSize === 'number' ? sig.probabilitySampleSize : 0;

        Gate35SignalFunnelAnalytics.recordCandidate({
          symbol: sig.symbol,
          direction: sig.direction,
          stage: 'STAGE_2',
          score: score,
          regime: (sig as any).marketRegime || 'UNKNOWN',
          strategy: sig.strategy || 'MULTI_STRATEGY',
          
          assetClass: SymbolNormalizer.getAssetClassification(sig.symbol),
          initialScore: score,
          watchingThreshold: thresholds.watchingThreshold,
          qualifiedCandidateThreshold: thresholds.qualifiedCandidateThreshold,
          signalThreshold: thresholds.signalThreshold,
          strategyAgreementRatio: (sig as any).strategyAgreementRatio ?? 0.83,
          timeframeAlignmentRatio: (sig as any).timeframeAlignmentRatio ?? 0.83,
          grossRR,
          netRR,
          adverseNetRR,
          estimatedWinRate: winRate,
          empiricalProbability: empProb,
          probabilitySampleSize: sampleSize,
          aiMode: 'None',
          aiResult: 'None',
          dataFreshness: '0s',
          entryQuality: 'Qualified Setup',
          newsStatus: (sig as any).newsStatus || 'NEUTRAL',
          correlationCluster: Gate17CorrelationExposure.identifyCluster(sig.symbol).name,
          finalDecision: 'WATCHING',
        });
      }

      // 3. Stage A: Mandatory Condition Hurdle (GATE 82: coreScore tradeability check)
      const qualifiedByQuality: TradingSignal[] = [];
      for (const sig of rawCandidates) {
        const coreScore = sig.coreScore ?? sig.score ?? sig.confidenceScore ?? 0;
        const score = coreScore;
        const winRate = sig.modelEstimatedWinRate ?? sig.estimatedWinRate ?? 0;
        const empProb = sig.isEmpiricallyCalibrated === true && typeof sig.empiricalProbability === 'number' ? sig.empiricalProbability : null;
        const sampleSize = typeof sig.probabilitySampleSize === 'number' ? sig.probabilitySampleSize : 0;
        const rr = sig.riskRewardRatio ?? 0;
        const grossRR = (sig as any).grossRiskRewardRatio ?? sig.riskRewardRatio ?? 0;
        const netRR = (sig as any).netRiskRewardRatio ?? sig.estimatedFriction?.netRiskRewardRatio ?? 0;
        const adverseNetRR = (sig as any).adverseNetRiskRewardRatio ?? (sig.estimatedFriction as any)?.adverseNetRiskRewardRatio ?? 0;

        const sigTelemetry = {
          assetClass: SymbolNormalizer.getAssetClassification(sig.symbol),
          initialScore: coreScore,
          watchingThreshold: thresholds.watchingThreshold,
          qualifiedCandidateThreshold: thresholds.qualifiedCandidateThreshold,
          signalThreshold: thresholds.signalThreshold,
          strategyAgreementRatio: (sig as any).strategyAgreementRatio ?? 0.83,
          timeframeAlignmentRatio: (sig as any).timeframeAlignmentRatio ?? 0.83,
          grossRR,
          netRR,
          adverseNetRR,
          estimatedWinRate: winRate,
          empiricalProbability: empProb,
          probabilitySampleSize: sampleSize,
          aiMode: 'None',
          aiResult: 'None',
          dataFreshness: '0s',
          entryQuality: 'Qualified Setup',
          newsStatus: (sig as any).newsStatus || 'NEUTRAL',
          correlationCluster: Gate17CorrelationExposure.identifyCluster(sig.symbol).name,
          finalDecision: 'REJECTED' as const,
        };

        // GATE 65 / GATE 82: Condition 1 - Centralized Final Tradeability Resolution on coreScore
        // finalRequiredScore = Math.max(thresholds.signalThreshold, regimeAdaptiveThreshold)
        // Gate 27 can make the system MORE selective, but NEVER less selective than signalThreshold.
        const tradeabilityCheck = TradeRankingEngine.calculateFinalRequiredScore({
          symbol: sig.symbol,
          actualScore: coreScore,
          regime: (sig as any).marketRegime,
          strategy: sig.strategy,
          assetClass: SymbolNormalizer.getAssetClassification(sig.symbol),
          signalThreshold: thresholds.signalThreshold,
        });

        if (!tradeabilityCheck.isExecutable || !tradeabilityCheck.passed) {
          const reason = tradeabilityCheck.rejectionReason || `REJECTED: SCORE_BELOW_FINAL_THRESHOLD. Core Score (${coreScore}/100) below final required score (${tradeabilityCheck.finalRequiredScore}).`;
          rejectedDuringScan.push({
            symbol: sig.symbol,
            direction: sig.direction,
            score: coreScore,
            reason,
          });
          Gate35SignalFunnelAnalytics.recordCandidate({
            symbol: sig.symbol,
            direction: sig.direction,
            stage: 'GATE_4',
            score: coreScore,
            strategy: sig.strategy,
            rejectionReason: reason,
            ...sigTelemetry,
            rejectionStage: 'GATE_4',
          });
          continue;
        }

        // Condition 2: Estimated win rate > threshold
        if (winRate <= thresholds.minimumWinProbability) {
          const reason = `REJECTED: WIN_RATE_BELOW_THRESHOLD. Estimated win-rate (${winRate}%) <= mandatory ${thresholds.minimumWinProbability}% threshold.`;
          rejectedDuringScan.push({
            symbol: sig.symbol,
            direction: sig.direction,
            score,
            reason,
          });
          Gate35SignalFunnelAnalytics.recordCandidate({
            symbol: sig.symbol,
            direction: sig.direction,
            stage: 'GATE_4',
            score,
            strategy: sig.strategy,
            rejectionReason: reason,
            ...sigTelemetry,
            rejectionStage: 'GATE_4',
          });
          continue;
        }

        // GATE 45 Condition 3: Minimum acceptable GROSS Risk/Reward ratio
        if (grossRR < thresholds.minimumRR) {
          const reason = `REJECTED: GROSS_RR_BELOW_THRESHOLD. Gross Risk/Reward ratio (${grossRR.toFixed(2)}:1) is below minimum acceptable GROSS R:R (${thresholds.minimumRR}:1).`;
          rejectedDuringScan.push({
            symbol: sig.symbol,
            direction: sig.direction,
            score,
            reason,
          });
          Gate35SignalFunnelAnalytics.recordCandidate({
            symbol: sig.symbol,
            direction: sig.direction,
            stage: 'GATE_9',
            score,
            strategy: sig.strategy,
            rejectionReason: reason,
            ...sigTelemetry,
            rejectionStage: 'GATE_9',
          });
          continue;
        }

        // Condition 4: Valid live provider price & status (Gate 46: actionable emitted signal state)
        if (!isActionableSignal(sig) || sig.validationReason === 'MARKET_DATA_UNAVAILABLE' || sig.validationReason === 'STALE_DATA') {
          const reason = `REJECTED: DATA_STALE. Signal state is not actionable (${sig.status}, ${sig.validationReason || 'Provider unverified'}). Stale or synthetic data rejected.`;
          rejectedDuringScan.push({
            symbol: sig.symbol,
            direction: sig.direction,
            score,
            reason,
          });
          Gate35SignalFunnelAnalytics.recordCandidate({
            symbol: sig.symbol,
            direction: sig.direction,
            stage: 'GATE_0',
            score,
            strategy: sig.strategy,
            rejectionReason: reason,
            ...sigTelemetry,
            rejectionStage: 'GATE_0',
          });
          continue;
        }

        // Condition 5: Valid structural stop loss and take profit
        if (sig.stopLoss === sig.entryPrice || sig.takeProfit === sig.entryPrice) {
          const reason = `REJECTED: INVALID_SL_TP. Invalid price boundaries: StopLoss or TakeProfit equals Entry price.`;
          rejectedDuringScan.push({
            symbol: sig.symbol,
            direction: sig.direction,
            score,
            reason,
          });
          Gate35SignalFunnelAnalytics.recordCandidate({
            symbol: sig.symbol,
            direction: sig.direction,
            stage: 'GATE_8',
            score,
            strategy: sig.strategy,
            rejectionReason: reason,
            ...sigTelemetry,
            rejectionStage: 'GATE_8',
          });
          continue;
        }

        // GATE 45 Condition 6: Minimum acceptable NET Risk/Reward ratio after spread/slippage friction
        if (netRR !== undefined && netRR < thresholds.minimumNetRR) {
          const reason = `REJECTED: NET_RR_BELOW_THRESHOLD. Normal Net R:R after spread/slippage friction (${netRR.toFixed(2)}:1) is below minimum acceptable NET R:R (${thresholds.minimumNetRR}:1) (Gross R:R: ${grossRR.toFixed(2)}:1).`;
          rejectedDuringScan.push({
            symbol: sig.symbol,
            direction: sig.direction,
            score,
            reason,
          });
          Gate35SignalFunnelAnalytics.recordCandidate({
            symbol: sig.symbol,
            direction: sig.direction,
            stage: 'GATE_9',
            score,
            strategy: sig.strategy,
            rejectionReason: reason,
            ...sigTelemetry,
            rejectionStage: 'GATE_9',
          });
          continue;
        }

        // GATE 45 Optional Adverse Net R:R Hard Gate
        if (thresholds.enforceAdverseNetRRHardGate && adverseNetRR !== undefined && adverseNetRR < (thresholds.minimumAdverseNetRR ?? 1.0)) {
          const reason = `REJECTED: ADVERSE_NET_RR_BELOW_THRESHOLD. Adverse Net R:R (${adverseNetRR.toFixed(2)}:1) is below required stress floor (${(thresholds.minimumAdverseNetRR ?? 1.0)}:1).`;
          rejectedDuringScan.push({
            symbol: sig.symbol,
            direction: sig.direction,
            score,
            reason,
          });
          Gate35SignalFunnelAnalytics.recordCandidate({
            symbol: sig.symbol,
            direction: sig.direction,
            stage: 'GATE_9',
            score,
            strategy: sig.strategy,
            rejectionReason: reason,
            ...sigTelemetry,
            rejectionStage: 'GATE_9',
          });
          continue;
        }

        qualifiedByQuality.push(sig);
      }

      logger.info(`[Hourly Scanner] Setups passing mandatory quality hurdles: ${qualifiedByQuality.length}`);

      // 4. Stage B: Duplicate Symbol/Direction & Material Improvement Filter
      const sentSignalsToday = await ScannerPersistence.getSentSignalsToday();
      const deletedSignalsToday = await ScannerPersistence.getDeletedSignals();
      const qualifiedNonDuplicate: TradingSignal[] = [];

      for (const sig of qualifiedByQuality) {
        // If the signal was explicitly deleted today, reject it.
        const wasDeleted = deletedSignalsToday.some(
          (d) => d.id === sig.id || d.id === sig.snapshotId || (d.symbol.toUpperCase() === sig.symbol.toUpperCase() && d.direction.toUpperCase() === sig.direction.toUpperCase())
        );

        if (wasDeleted) {
          logger.info(`[Hourly Scanner] Blocking re-insertion/recreation of deleted signal: ${sig.symbol} ${sig.direction}`);
          rejectedDuringScan.push({
            symbol: sig.symbol,
            direction: sig.direction,
            score: sig.score,
            reason: `REJECTED: SIGNAL_DELETED. Setup was previously generated and explicitly deleted today. Re-insertion blocked.`,
          });
          continue;
        }

        const existingSameSetup = sentSignalsToday.find(
          (s) => s.symbol === sig.symbol && s.direction === sig.direction && isActionableSignal(s)
        );

        if (existingSameSetup) {
          const currentScore = sig.score ?? sig.confidenceScore ?? 0;
          const prevScore = existingSameSetup.score;
          const currentRR = sig.riskRewardRatio;
          const prevRR = existingSameSetup.riskRewardRatio;

          // Material improvement check:
          // 1) Score improves by >= 5 points (e.g. 78 -> 86) OR
          // 2) R:R improves by >= 0.5 (e.g. 2.1 -> 2.7) OR
          // 3) Favorable entry price improvement
          const scoreImproved = currentScore >= prevScore + 5;
          const rrImproved = currentRR >= prevRR + 0.5;
          const isMateriallyBetter = scoreImproved || rrImproved;

          if (isMateriallyBetter) {
            logger.info(`[Hourly Scanner] Setup for ${sig.symbol} ${sig.direction} materially improved: Score ${prevScore}->${currentScore}, RR ${prevRR}->${currentRR}. Superseding previous setup.`);
            await ScannerPersistence.updateSignalStatus(existingSameSetup.id, 'SUPERSEDED');
            qualifiedNonDuplicate.push(sig);
          } else {
            rejectedDuringScan.push({
              symbol: sig.symbol,
              direction: sig.direction,
              score: currentScore,
              reason: `REJECTED: DUPLICATE_FINGERPRINT. Duplicate setup: ${sig.symbol} ${sig.direction} already sent today (Score: ${prevScore}, R:R: ${prevRR}:1). No material improvement detected.`,
            });
            continue;
          }
        } else {
          qualifiedNonDuplicate.push(sig);
        }
      }

      // 5. Stage C: Cross-Asset Correlation Risk Filter (Gate 54 — Correlation Allocation Policy)
      // Prevent multiple correlated trades in the same cluster/direction from taking multiple slots
      const qualifiedUncorrelated: TradingSignal[] = [];
      const occupiedClustersThisScan = new Set<string>();

      // Check actively held cluster exposures from sent signals today
      const activeClusterExposures = new Map<string, PersistedSentSignal[]>();
      for (const sent of sentSignalsToday.filter((s) => isActionableSignal(s))) {
        const cluster = TradeRankingEngine.getAssetCluster(sent.symbol) || 'UNCLUSTERED';
        const key = `${cluster}_${sent.direction}`;
        if (!activeClusterExposures.has(key)) {
          activeClusterExposures.set(key, []);
        }
        activeClusterExposures.get(key)!.push(sent);
      }

      // Sort candidate setups descending by score first so the highest quality in a cluster wins
      qualifiedNonDuplicate.sort((a, b) => (b.score ?? b.confidenceScore ?? 0) - (a.score ?? a.confidenceScore ?? 0));

      for (const sig of qualifiedNonDuplicate) {
        const cluster = TradeRankingEngine.getAssetCluster(sig.symbol) || 'UNCLUSTERED';
        const score = sig.score ?? sig.confidenceScore ?? 0;
        const clusterKey = `${cluster}_${sig.direction}`;

        // Get currently active signals in this cluster
        const activeInCluster = activeClusterExposures.get(clusterKey) || [];

        // GATE 54: Check correlation allocation policy
        const allocationCheck = Gate36ConfigurableSignalFrequency.evaluateCorrelationAllocation({
          symbol: sig.symbol,
          score,
          direction: sig.direction,
          activeSignalsInCluster: activeInCluster.map(s => ({
            id: s.id,
            symbol: s.symbol,
            score: s.score ?? 0
          }))
        });

        if (!allocationCheck.allowed) {
          rejectedDuringScan.push({
            symbol: sig.symbol,
            direction: sig.direction,
            score,
            reason: allocationCheck.reason,
          });
          const grossRR = (sig as any).grossRiskRewardRatio ?? sig.riskRewardRatio ?? 0;
          const netRR = (sig as any).netRiskRewardRatio ?? sig.estimatedFriction?.netRiskRewardRatio ?? 0;
          const adverseNetRR = (sig as any).adverseNetRiskRewardRatio ?? (sig.estimatedFriction as any)?.adverseNetRiskRewardRatio ?? 0;
          const winRate = sig.estimatedWinRate ?? 0;

          Gate35SignalFunnelAnalytics.recordCandidate({
            symbol: sig.symbol,
            direction: sig.direction,
            stage: 'RANKING',
            score,
            strategy: sig.strategy,
            rejectionReason: allocationCheck.reason,
            assetClass: SymbolNormalizer.getAssetClassification(sig.symbol),
            initialScore: score,
            watchingThreshold: thresholds.watchingThreshold,
            qualifiedCandidateThreshold: thresholds.qualifiedCandidateThreshold,
            signalThreshold: thresholds.signalThreshold,
            strategyAgreementRatio: (sig as any).strategyAgreementRatio ?? 0.83,
            timeframeAlignmentRatio: (sig as any).timeframeAlignmentRatio ?? 0.83,
            grossRR,
            netRR,
            adverseNetRR,
            estimatedWinRate: sig.modelEstimatedWinRate ?? sig.estimatedWinRate ?? 0,
            empiricalProbability: sig.isEmpiricallyCalibrated === true && typeof sig.empiricalProbability === 'number' ? sig.empiricalProbability : null,
            probabilitySampleSize: typeof sig.probabilitySampleSize === 'number' ? sig.probabilitySampleSize : 0,
            aiMode: 'None',
            aiResult: 'None',
            dataFreshness: '0s',
            entryQuality: 'Qualified Setup',
            newsStatus: (sig as any).newsStatus || 'NEUTRAL',
            correlationCluster: Gate17CorrelationExposure.identifyCluster(sig.symbol).name,
            finalDecision: 'REJECTED',
            rejectionStage: 'RANKING',
          });
          continue;
        }

        // Check if intra-scan cluster collision
        if (cluster !== 'UNCLUSTERED' && occupiedClustersThisScan.has(clusterKey)) {
          const reason = `REJECTED: CORRELATION_EXPOSURE. Correlated exposure: Risk cluster [${cluster}] (${sig.direction}) already occupied by higher-scoring setup in this scan cycle.`;
          rejectedDuringScan.push({
            symbol: sig.symbol,
            direction: sig.direction,
            score,
            reason,
          });
          continue;
        }

        // Handle swapping/superseding if evaluateCorrelationAllocation returned a signal to supersede
        if (allocationCheck.signalToSupersede) {
          logger.info(`[Gate 54] ${allocationCheck.reason}`);
          await ScannerPersistence.updateSignalStatus(allocationCheck.signalToSupersede, 'SUPERSEDED');
          
          // Update local activeClusterExposures map to reflect the superseded signal being replaced
          const filteredActive = activeInCluster.filter(s => s.id !== allocationCheck.signalToSupersede);
          activeClusterExposures.set(clusterKey, filteredActive);
        }

        if (cluster !== 'UNCLUSTERED') {
          occupiedClustersThisScan.add(clusterKey);
          
          // Also append this newly admitted signal to the activeClusterExposures map so subsequent iterations in this scan cycle see it
          const updatedActive = activeClusterExposures.get(clusterKey) || [];
          updatedActive.push({
            id: `temp_${sig.symbol}_${Date.now()}`,
            symbol: sig.symbol,
            direction: sig.direction,
            score,
          } as any);
          activeClusterExposures.set(clusterKey, updatedActive);
        }

        qualifiedUncorrelated.push(sig);
      }

      // 6. Stage D: Final Ranking & Daily Cap Selection
      qualifiedUncorrelated.sort((a, b) => ((b as any).rankingScore ?? b.score ?? b.confidenceScore ?? 0) - ((a as any).rankingScore ?? a.score ?? a.confidenceScore ?? 0));

      const selectedSetups: TradingSignal[] = [];
      for (const sig of qualifiedUncorrelated) {
        if (selectedSetups.length >= remainingAllowance) {
          const reason = `REJECTED: DAILY_CAP_REACHED. Daily automated notification cap (${dailyCap}/day) reached. Remaining slots full.`;
          rejectedDuringScan.push({
            symbol: sig.symbol,
            direction: sig.direction,
            score: sig.score ?? sig.confidenceScore,
            reason,
          });
          const scoreVal = sig.score ?? sig.confidenceScore ?? 0;
          const grossRR = (sig as any).grossRiskRewardRatio ?? sig.riskRewardRatio ?? 0;
          const netRR = (sig as any).netRiskRewardRatio ?? sig.estimatedFriction?.netRiskRewardRatio ?? 0;
          const adverseNetRR = (sig as any).adverseNetRiskRewardRatio ?? (sig.estimatedFriction as any)?.adverseNetRiskRewardRatio ?? 0;
          const winRate = sig.modelEstimatedWinRate ?? sig.estimatedWinRate ?? 0;
          const empProb = sig.isEmpiricallyCalibrated === true && typeof sig.empiricalProbability === 'number' ? sig.empiricalProbability : null;
          const sampleSize = typeof sig.probabilitySampleSize === 'number' ? sig.probabilitySampleSize : 0;

          Gate35SignalFunnelAnalytics.recordCandidate({
            symbol: sig.symbol,
            direction: sig.direction,
            stage: 'RANKING',
            score: scoreVal,
            strategy: sig.strategy,
            rejectionReason: reason,
            assetClass: SymbolNormalizer.getAssetClassification(sig.symbol),
            initialScore: scoreVal,
            watchingThreshold: thresholds.watchingThreshold,
            qualifiedCandidateThreshold: thresholds.qualifiedCandidateThreshold,
            signalThreshold: thresholds.signalThreshold,
            strategyAgreementRatio: (sig as any).strategyAgreementRatio ?? 0.83,
            timeframeAlignmentRatio: (sig as any).timeframeAlignmentRatio ?? 0.83,
            grossRR,
            netRR,
            adverseNetRR,
            estimatedWinRate: winRate,
            empiricalProbability: empProb,
            probabilitySampleSize: sampleSize,
            aiMode: 'None',
            aiResult: 'None',
            dataFreshness: '0s',
            entryQuality: 'Qualified Setup',
            newsStatus: (sig as any).newsStatus || 'NEUTRAL',
            correlationCluster: Gate17CorrelationExposure.identifyCluster(sig.symbol).name,
            finalDecision: 'REJECTED',
            rejectionStage: 'RANKING',
          });
          continue;
        }

        // Rank tier classification based on ranking order
        const rankIndex = selectedSetups.length;
        if (rankIndex === 0) {
          sig.rankTier = 'BEST_TRADE';
          sig.isBestTrade = true;
          sig.isSecondBest = false;
          sig.isTopTrade = true;
        } else if (rankIndex === 1) {
          sig.rankTier = 'SECOND_BEST';
          sig.isBestTrade = false;
          sig.isSecondBest = true;
          sig.isTopTrade = true;
        } else {
          sig.rankTier = 'SUGGESTION';
          sig.isBestTrade = false;
          sig.isSecondBest = false;
          sig.isTopTrade = false;
        }

        selectedSetups.push(sig);
      }

      const evaluationDurationMs = Date.now() - evaluationStart;
      logger.info(`[Scanner Telemetry] SIGNAL_EVALUATION | duration: ${evaluationDurationMs}ms | candidatesEvaluated: ${rawCandidates.length} | selectedSetupsCount: ${selectedSetups.length} | rejectedCandidatesCount: ${rejectedDuringScan.length} | universeDiagnosticsCount: ${universeDiagnostics.length}`);

      // 7. Dispatch & Persistence
      const persistenceStart = Date.now();
      let dispatchedCount = 0;
      for (const sig of selectedSetups) {
        const score = sig.score ?? sig.confidenceScore ?? 0;



        // Atomically increment cap
        const inc = await ScannerPersistence.tryIncrementCap(dailyCap);
        if (!inc.allowed) {
          logger.warn(`[Hourly Scanner] Daily cap reached during atomic increment. Stopping further dispatches.`);
          break;
        }

        // Attach tag for automated signal
        sig.strategy = `[Automated ${sig.rankTier === 'BEST_TRADE' ? 'BEST TRADE' : 'ACTIONABLE SIGNAL'}] ${sig.strategy}`;

        // MARK TRADEABLE BEFORE PERSISTENCE (Delegated to SignalEngine per Gate 90)
        signalEngine.promoteToTradeable(sig);

        // PERSIST & CONFIRM PERSISTENCE
        const persRes = await ScannerPersistence.recordSentSignal(sig);
        const logRes = await SignalLogger.logSignal(sig, 'TREND');

        if (!persRes.success || !logRes.success || logRes.status !== 'TRADEABLE_RECORD_PERSISTED') {
          logger.error(`[Hourly Scanner] Persistence failed for ${sig.symbol}. Rolling back cap and aborting dispatch.`, { persError: persRes.error, logError: logRes.error });
          await ScannerPersistence.releaseCap(inc.reservationId);
          signalEngine.demoteToDiagnostic(sig);
          continue;
        }

        // COMMIT CAP RESERVATION!
        const commitRes = await ScannerPersistence.commitCap(inc.reservationId);
        if (!commitRes.success) {
          logger.error(`[Hourly Scanner] CRITICAL CAP-STATE ERROR: Failed to commit cap reservation ${inc.reservationId} for ${sig.symbol}. Signal remains persisted and tradeable.`, { error: commitRes.error });
        }

        // GATE 36: Record notification count
        Gate36ConfigurableSignalFrequency.recordNotificationCount(1);

        // Record Funnel Analytics Final Signal
        const finalScore = sig.score ?? sig.confidenceScore ?? thresholds.signalThreshold;
        const grossRR = (sig as any).grossRiskRewardRatio ?? sig.riskRewardRatio ?? 0;
        const netRR = (sig as any).netRiskRewardRatio ?? sig.estimatedFriction?.netRiskRewardRatio ?? 0;
        const adverseNetRR = (sig as any).adverseNetRiskRewardRatio ?? (sig.estimatedFriction as any)?.adverseNetRiskRewardRatio ?? 0;
        const winRate = sig.modelEstimatedWinRate ?? sig.estimatedWinRate ?? 0;
        const empProb = sig.isEmpiricallyCalibrated === true && typeof sig.empiricalProbability === 'number' ? sig.empiricalProbability : null;
        const sampleSize = typeof sig.probabilitySampleSize === 'number' ? sig.probabilitySampleSize : 0;

        Gate35SignalFunnelAnalytics.recordCandidate({
          symbol: sig.symbol,
          direction: sig.direction,
          stage: 'FINAL_SIGNAL',
          score: finalScore,
          strategy: sig.strategy,
          assetClass: SymbolNormalizer.getAssetClassification(sig.symbol),
          initialScore: finalScore,
          watchingThreshold: thresholds.watchingThreshold,
          qualifiedCandidateThreshold: thresholds.qualifiedCandidateThreshold,
          signalThreshold: thresholds.signalThreshold,
          strategyAgreementRatio: (sig as any).strategyAgreementRatio ?? 0.83,
          timeframeAlignmentRatio: (sig as any).timeframeAlignmentRatio ?? 0.83,
          grossRR,
          netRR,
          adverseNetRR,
          estimatedWinRate: winRate,
          empiricalProbability: empProb,
          probabilitySampleSize: sampleSize,
          aiMode: 'None',
          aiResult: 'None',
          dataFreshness: '0s',
          entryQuality: 'Qualified Setup',
          newsStatus: (sig as any).newsStatus || 'NEUTRAL',
          correlationCluster: Gate17CorrelationExposure.identifyCluster(sig.symbol).name,
          finalDecision: 'SIGNALS',
        });

        // Record Fingerprint, Cooldown, and Accepted Audit Explanation
        const fp = SignalFingerprint.recordFingerprint({
          symbol: sig.symbol,
          direction: sig.direction,
          entryPrice: sig.entryPrice,
          timeframe: sig.timeframe,
          primaryStrategy: sig.strategy,
        });

        CooldownManager.recordSignalEmit(sig.symbol, sig.strategy, sig.timestamp);

        SignalAuditStore.logAudit({
          symbol: sig.symbol,
          direction: sig.direction,
          timeframe: sig.timeframe,
          primaryStrategy: sig.strategy,
          passedStrategies: [sig.strategy],
          failedStrategies: [],
          marketRegime: sig.marketRegime || 'UNKNOWN',
          atr: 0,
          dataFreshnessSeconds: 0,
          providerAgreement: true,
          expectedRR: sig.riskRewardRatio,
          score: sig.score ?? thresholds.signalThreshold,
          status: 'ACCEPTED',
          rejectionReason: null,
          fingerprint: fp,
        });

        // Record notification history item
        const tierLabel = sig.rankTier === 'BEST_TRADE'
          ? 'BEST TRADE (Rank #1)'
          : sig.rankTier === 'SECOND_BEST'
            ? 'SECOND BEST (Rank #2)'
            : `ACTIONABLE SIGNAL (${thresholds.signalThreshold}+)`;
        const title = `🚨 [${tierLabel}] ${sig.symbol} [${sig.direction}]`;
        const precision = getDynamicPrecision(sig.entryPrice, sig.symbol);
        const message = `Live Entry: ${sig.entryPrice.toFixed(precision)} | TP: ${sig.takeProfit.toFixed(precision)} | SL: ${sig.stopLoss.toFixed(precision)} (R:R ${sig.riskRewardRatio.toFixed(1)}:1, Score: ${score}/100)`;

        await ScannerPersistence.recordNotification({
          type: sig.rankTier === 'BEST_TRADE' ? 'BEST_TRADE' : 'HIGH_QUALITY',
          symbol: sig.symbol,
          title,
          message,
          score,
          rankTier: sig.rankTier,
        });

        // Dispatch Web Push notification to PWA subscribers
        try {
          await PushNotificationService.sendSignalNotification(sig);
        } catch (pushErr) {
          logger.error(`[Hourly Scanner] Push notification error for ${sig.symbol}:`, { error: String(pushErr) });
        }

        dispatchedCount++;
        logger.info(`[Hourly Scanner] Dispatched setup for ${sig.symbol} [${sig.direction}] (${tierLabel}, Score: ${score}/100). Daily count: ${inc.count}/${inc.cap}`);
      }

      // 8. If NO setups qualified
      if (dispatchedCount === 0) {
        logger.info(`[Hourly Scanner] No setups met the ${thresholds.signalThreshold}+ quality and diversification criteria. Dispatched 0 signals (0-${dailyCap} is completely valid).`);
        const settings = ScannerPersistence.getSettings();
        if (settings.notifyOnNoTrade && !isExternal) {
          await ScannerPersistence.recordNotification({
            type: 'NO_TRADE',
            symbol: 'ALL_MARKETS',
            title: 'ℹ️ Automated Scan: NO QUALIFIED TRADE',
            message: `Hourly scan evaluated ${rawCandidates.length} candidate setups across Crypto, Forex, and Stocks. 0 setups passed all mandatory quality, R:R, and non-correlation filters.`,
          });
        }
      }

      
      // 9. Persist rejected candidates audit log
      if (rejectedDuringScan.length > 0) {
        await ScannerPersistence.recordRejectedCandidates(rejectedDuringScan);
        for (const rej of rejectedDuringScan) {
          const match = rej.reason.match(/REJECTED: ([A-Z0-9_]+)/);
          const gate = match ? match[1] : 'OTHER_REJECTION';
          aggregatedRejectionCounts[gate] = (aggregatedRejectionCounts[gate] || 0) + 1;

          const dir: SignalDirection = (rej.direction === 'SELL' ? 'SELL' : 'BUY');

          const fp = SignalFingerprint.generateFingerprint({
            symbol: rej.symbol,
            direction: dir,
            entryPrice: 0,
            timeframe: '1h',
            primaryStrategy: 'Multi-Strategy Confluence',
          });
          SignalAuditStore.logAudit({
            symbol: rej.symbol,
            direction: dir,
            timeframe: '1h',
            primaryStrategy: 'Multi-Strategy Confluence',
            passedStrategies: [],
            failedStrategies: ['Quality Hurdle'],
            marketRegime: 'UNKNOWN',
            atr: 0,
            dataFreshnessSeconds: 0,
            providerAgreement: true,
            expectedRR: 0,
            score: rej.score || 0,
            status: 'REJECTED',
            rejectionReason: rej.reason,
            fingerprint: fp,
          });

          allCandidateRejectionDetails.push({
            symbol: rej.symbol,
            direction: dir,
            score: rej.score || 0,
            primaryRejectionReason: rej.reason,
            failedGates: [gate as any],
            finalDecision: 'REJECTED',
            rejectionSummary: CandidateRejectionTracker.formatHumanReadableSummary(rej.reason, [gate as any], rej.score || 0),
            timestamp: Date.now(),
          });
        }
      }

      const {
        finalRejectedRecords,
        authoritativeRejectedCount,
        finalCandidatesRejectedBeforeMTF,
        finalCandidatesRejectedByMTF,
        finalCandidatesRejectedByScore,
        finalCandidatesRejectedByRR,
        finalCandidatesRejectedByStructure,
        authoritativeRejectionCounts,
        rejectionReasonStrings,
      } = HourlyScannerService.processRejectionDetails(allCandidateRejectionDetails);

      const scanDurationMs = Date.now() - scanStartTime;

      // 10. Update authoritative lastAutomatedScan metrics ONLY if triggered externally from /api/scanner/trigger
      if (isExternal) {
        await ScannerPersistence.recordAutomatedScanMetrics({
          lastAutomatedScan: scanStartTime,
          lastScanCompletedAt: Date.now(),
          lastScanDuration: scanDurationMs,
          lastCandidatesEvaluated: totalCandidatesEvaluated,
          lastSignalsFound: totalSignalsGenerated,
          lastAcceptedSignals: dispatchedCount,
          universeSymbolsScanned: totalUniverseSymbolsScanned,
          preliminaryCandidatesFound: totalPreliminaryCandidatesFound,
          candidatesRejectedPreliminary: totalCandidatesRejectedPreliminary,
          candidatesEvaluated: totalCandidatesEvaluated,
          candidatesRejectedFinal: authoritativeRejectedCount,
          signalsGenerated: totalSignalsGenerated,
          signalsAccepted: dispatchedCount,
        });
      }

      const persistenceDurationMs = Date.now() - persistenceStart;
      logger.info(`[Scanner Telemetry] PERSISTENCE | duration: ${persistenceDurationMs}ms`);
      logger.info(`[Scanner Telemetry] TOTAL_SCAN_ENGINE_DURATION | duration: ${scanDurationMs}ms | status: COMPLETED`);

      const finalCapState = await ScannerPersistence.getCapState(serverConfig.getConfig().thresholds.dailySignalCap);
      logger.info(`================================================================`);
      logger.info(`[Hourly Scanner] Scan cycle complete. Dispatched ${dispatchedCount} new setups. Today's total: ${finalCapState.dailySignalCount}/${finalCapState.dailySignalCap}.`);
      logger.info(`================================================================`);

      const diagnosticStrings = universeDiagnostics.map(
        (d) => `${d.symbol}: ${d.reason}`
      );

      const currentElapsedMs = Date.now() - globalScanStartMs;
      const remainingBudgetMs = Math.max(0, globalScanDeadlineMs - Date.now());
      if (remainingBudgetMs <= 0) {
        aggregatedTimeBudgetExceeded = true;
      }

      const timingTelemetry = {
        globalScanStartMs,
        globalScanDeadlineMs,
        globalScanSoftDeadlineMs,
        currentElapsedMs,
        remainingBudgetMs,
        gate6ElapsedMs: maxGate6ElapsedMs,
        stage3ElapsedMs: maxStage3ElapsedMs,
        timeBudgetExceeded: aggregatedTimeBudgetExceeded,
        providerRequestsStoppedByBudget: aggregatedProviderRequestsStoppedByBudget,
        executionId,
        scanId: executionId,
      };

      return {
        success: true,
        status: 'COMPLETED',
        message:
          dispatchedCount > 0
            ? `Scan complete: Dispatched ${dispatchedCount} qualified automated setup(s). Total today: ${finalCapState.dailySignalCount}/${finalCapState.dailySignalCap}.`
            : `Scan complete: 0 setups met ${finalCapState.dailySignalCap > 0 ? `${thresholds.signalThreshold}+` : ''} criteria (0-${finalCapState.dailySignalCap} is valid; no trades forced). Total today: ${finalCapState.dailySignalCount}/${finalCapState.dailySignalCap}.`,
        timestamp: Date.now(),
        lastScanTime: finalCapState.lastAutomatedScan || finalCapState.lastScanTime || scanStartTime,
        universeSymbolsScanned: totalUniverseSymbolsScanned,
        preliminaryCandidatesFound: totalPreliminaryCandidatesFound,
        candidatesRejectedPreliminary: totalCandidatesRejectedPreliminary,
        candidatesEvaluated: totalCandidatesEvaluated,
        candidatesRejectedFinal: authoritativeRejectedCount,
        signalsGenerated: totalSignalsGenerated,
        signalsAccepted: dispatchedCount,
        acceptedSignalsCount: dispatchedCount,
        acceptedSignals: selectedSetups,
        signalsFound: totalSignalsGenerated,
        qualifiedSetups: selectedSetups,
        rejectedCount: authoritativeRejectedCount,
        candidatesRejectedBeforeMTF: finalCandidatesRejectedBeforeMTF,
        candidatesRejectedByMTF: finalCandidatesRejectedByMTF,
        candidatesRejectedByScore: finalCandidatesRejectedByScore,
        candidatesRejectedByRR: finalCandidatesRejectedByRR,
        candidatesRejectedByStructure: finalCandidatesRejectedByStructure,
        rejectionReasons: rejectionReasonStrings,
        rejectionReasonsAggregated: authoritativeRejectionCounts,
        rejectionReasonsCounts: authoritativeRejectionCounts,
        candidateRejectionDetails: finalRejectedRecords,
        diagnosticsCount: universeDiagnostics.length,
        diagnostics: diagnosticStrings,
        capState: finalCapState,
        scanDurationMs,
        timingTelemetry,
        globalScanStartMs,
        globalScanDeadlineMs,
        globalScanSoftDeadlineMs,
        executionId,
        scanId: executionId,
        currentElapsedMs,
        remainingBudgetMs,
        gate6ElapsedMs: maxGate6ElapsedMs,
        stage3ElapsedMs: maxStage3ElapsedMs,
        timeBudgetExceeded: aggregatedTimeBudgetExceeded,
        providerRequestsStoppedByBudget: aggregatedProviderRequestsStoppedByBudget,
      };
    } catch (err) {
      logger.error('[Hourly Scanner] Critical failure during scan execution:', { error: String(err) });
      if (isExternal) {
        try {
          await ScannerPersistence.recordAutomatedScanMetrics({
            lastAutomatedScan: scanStartTime,
            lastScanCompletedAt: Date.now(),
            lastScanDuration: Date.now() - scanStartTime,
            lastCandidatesEvaluated: 0,
            lastSignalsFound: 0,
            lastAcceptedSignals: 0,
          });
        } catch (tsErr) {
          logger.error('[Hourly Scanner] Failed to record automated scan metrics after error:', { error: String(tsErr) });
        }
      }
      const capState = await ScannerPersistence.getCapState(serverConfig.getConfig().thresholds.dailySignalCap);
      const errMsg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        status: 'ERROR',
        message: `REJECTED: SCAN_ERROR. Scan execution error: ${errMsg}`,
        timestamp: Date.now(),
        lastScanTime: capState.lastAutomatedScan || capState.lastScanTime || 0,
        candidatesEvaluated: 0,
        acceptedSignalsCount: 0,
        acceptedSignals: [],
        signalsFound: 0,
        qualifiedSetups: [],
        rejectedCount: 0,
        rejectionReasons: [`REJECTED: SCAN_ERROR. Scan execution error: ${errMsg}`],
        capState,
      };
    } finally {
      this.isScanning = false;
      await ScannerPersistence.releaseLock(instanceId);
    }
  }

  /**
   * Retrieves scanner settings and today's metrics for frontend consumption.
   */
  async getSettingsAsync(): Promise<
    ScannerSettings & {
      limit: number;
      dailySignalCount: number;
      sentSignalsToday: PersistedSentSignal[];
      recentNotifications: PersistedNotification[];
      recentRejected: PersistedRejectedCandidate[];
      nextScanTime: number;
      scannerStatus: 'ACTIVE' | 'RUNNING' | 'DISABLED' | 'CAP_REACHED';
      isScanning: boolean;
      lastCronExecution: number;
      lastAutomatedScan: number;
      lastScanCompletedAt: number;
      lastScanDuration: number;
      lastCandidatesEvaluated: number;
      lastSignalsFound: number;
      lastAcceptedSignals: number;
      nextCronExecution: number;
      capState: DailyCapState;
    }
  > {
    const capState = await ScannerPersistence.getCapState(serverConfig.getConfig().thresholds.dailySignalCap);
    const settings = ScannerPersistence.getSettings();
    const sentSignalsToday = await ScannerPersistence.getSentSignalsToday();
    const recentNotifications = await ScannerPersistence.getNotificationHistory(10);
    const recentRejected = await ScannerPersistence.getRejectedCandidatesToday(10);

    // Map timestamps for UI backwards compatibility
    const timestamps = sentSignalsToday.map((s) => s.timestamp);
    const validIntervals = [15, 30, 45, 60];
    const intervalMinutes = validIntervals.includes(Number(settings.intervalMinutes))
      ? Number(settings.intervalMinutes)
      : 15;

    const lastAutomatedScan = capState.lastAutomatedScan || capState.lastScanTime || 0;
    
    // Authoritative cron-job.org job status
    const cronStatus = await CronJobOrgService.getJobStatus();
    const lastCronExecution = cronStatus.lastExecution?.timestamp || capState.lastCronExecution || 0;
    const nextCronExecution = cronStatus.nextExecution?.timestamp || 0;
    const nextScanTime = nextCronExecution;

    let scannerStatus: 'ACTIVE' | 'RUNNING' | 'DISABLED' | 'CAP_REACHED' = 'ACTIVE';
    if (!settings.enabled) {
      scannerStatus = 'DISABLED';
    } else if (this.isScanning) {
      scannerStatus = 'RUNNING';
    } else if (capState.dailySignalCount >= capState.dailySignalCap) {
      scannerStatus = 'CAP_REACHED';
    }

    return {
      enabled: settings.enabled,
      notificationsEnabled: settings.notificationsEnabled,
      notifyOnNoTrade: settings.notifyOnNoTrade,
      intervalMinutes,
      signalsSentTimestamps: timestamps,
      lastScanTime: lastAutomatedScan,
      lastCronExecution,
      lastAutomatedScan,
      lastScanCompletedAt: capState.lastScanCompletedAt || 0,
      lastScanDuration: capState.lastScanDuration || 0,
      lastCandidatesEvaluated: capState.lastCandidatesEvaluated || 0,
      lastSignalsFound: capState.lastSignalsFound || 0,
      lastAcceptedSignals: capState.lastAcceptedSignals || 0,
      nextCronExecution,
      nextScanTime,
      scannerStatus,
      isScanning: this.isScanning,
      limit: capState.dailySignalCap,
      dailySignalCount: capState.dailySignalCount,
      sentSignalsToday,
      recentNotifications,
      recentRejected,
      capState,
    };
  }

  /**
   * Synchronous settings view.
   */
  getSettings(): ScannerSettings & { limit: number } {
    const settings = ScannerPersistence.getSettings();
    return {
      enabled: settings.enabled,
      notificationsEnabled: settings.notificationsEnabled,
      notifyOnNoTrade: settings.notifyOnNoTrade,
      intervalMinutes: [15, 30, 45, 60].includes(Number(settings.intervalMinutes))
        ? Number(settings.intervalMinutes)
        : 15,
      signalsSentTimestamps: [],
      lastScanTime: 0,
      limit: 5,
    };
  }

  /**
   * Updates scanner configurations.
   */
  updateSettings(
    options: Partial<Pick<ScannerSettings, 'enabled' | 'notificationsEnabled' | 'notifyOnNoTrade' | 'intervalMinutes'>>
  ): void {
    if (options.intervalMinutes !== undefined) {
      const val = Number(options.intervalMinutes);
      if (![15, 30, 45, 60].includes(val)) {
        options.intervalMinutes = 15;
      } else {
        options.intervalMinutes = val;
      }
    }
    ScannerPersistence.updateSettings(options);
    logger.info('[Hourly Scanner] Scanner settings updated successfully.', { ...options });
  }

  /**
   * Retrieves full notification and audit history.
   */
  async getFullHistory(): Promise<{
    notifications: PersistedNotification[];
    sentSignalsToday: PersistedSentSignal[];
    rejectedToday: PersistedRejectedCandidate[];
    capState: DailyCapState;
  }> {
    const capState = await ScannerPersistence.getCapState(serverConfig.getConfig().thresholds.dailySignalCap);
    const notifications = await ScannerPersistence.getNotificationHistory(30);
    const sentSignalsToday = await ScannerPersistence.getSentSignalsToday();
    const rejectedToday = await ScannerPersistence.getRejectedCandidatesToday(30);

    // GATE 60/63/64: Filter out any non-tradeable signals from user-facing history
    // Only explicit isTradeableSignal === true && signalClassification === 'TRADEABLE' qualifies
    // Undefined legacy records are NOT preserved in user-facing tradeable history
    const tradeableSignals = sentSignalsToday.filter(s => {
      return s.isTradeableSignal === true && s.signalClassification === 'TRADEABLE';
    });

    const tradeableNotifications = notifications.filter(n => {
      // GATE 64: NO_TRADE is a system status message, not a tradeable trade alert.
      // Filter out NO_TRADE from user-facing Tradeable History & Alert Log.
      // NO_TRADE events remain in ScannerPersistence/telemetry/diagnostics.
      return n.type === 'BEST_TRADE' || n.type === 'HIGH_QUALITY' || n.type === 'SETUP_UPDATE' || n.type === 'TRADE_UPDATE';
    });

    return {
      notifications: tradeableNotifications,
      sentSignalsToday: tradeableSignals,
      rejectedToday,
      capState,
    };
  }
}

export const hourlyScanner = new HourlyScannerService();
