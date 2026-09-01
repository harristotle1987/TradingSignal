import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../logger.js';
import { getFirestoreAdmin } from '../firebaseAdmin.js';
import { quotaManager } from '../market/QuotaManager.js';

const LOCAL_HISTORY_PATH = path.join(process.cwd(), 'scan_performance_history.json');
const FIRESTORE_COL = 'scan_performance_history';

export type ProviderHealthStatus = 'HEALTHY' | 'DEGRADED' | 'RATE_LIMITED' | 'TIMEOUT' | 'UNAVAILABLE';

export interface StagePerformanceRecord {
  stageName: string;
  startTime: number;
  endTime: number;
  durationMs: number;
  providerRequests: number;
  providerLatencyMs: number;
  cacheHits: number;
  cacheMisses: number;
  candidatesIn: number;
  candidatesOut: number;
}

export interface ScanPerformanceProfile {
  scanId: string;
  startTime: number;
  endTime: number;
  totalDurationMs: number;
  stageDurations: Record<string, number>;
  providerRequests: number;
  networkRequests: number;
  cacheHits: number;
  cacheMisses: number;
  cacheHitRate: number;
  providerLatency: number;

  // Candidate and signal funnel metrics
  preliminaryCandidates: number;
  deepCandidates: number;
  MTFCandidates: number;
  '72PlusCandidates': number;
  rejected72PlusCandidates: number;
  signalsGenerated: number;
  signalsAccepted: number;
  rejectionReasons: Record<string, number>;

  // Deadlines and Budgets
  globalDeadline: number;
  deadlineRemaining: number;
  providerRequestsStoppedByBudget: number;

  // Errors & Health
  errors: string[];
  providerHealth: Record<string, ProviderHealthStatus>;

  // Backward compatibility fields
  scanStartTime?: number;
  scanEndTime?: number;
  TOTAL_SCAN_DURATION_MS?: number;
  TOTAL_PROVIDER_LATENCY?: number;
  totalProviderRequests?: number;
  totalCacheHits?: number;
  totalCacheMisses?: number;
  stages?: Record<string, StagePerformanceRecord>;
  stageList?: StagePerformanceRecord[];
}

export class ScanPerformanceProfiler {
  private scanId: string;
  private scanStartTime: number = 0;
  private scanEndTime: number = 0;
  private currentStageName: string | null = null;
  private stageStartTimes: Map<string, number> = new Map();
  private stageCandidatesIn: Map<string, number> = new Map();

  private stageRecords: Map<string, StagePerformanceRecord> = new Map();
  private stageList: StagePerformanceRecord[] = [];

  // Stage-level metric counters
  private stageProviderRequests: Map<string, number> = new Map();
  private stageProviderLatency: Map<string, number> = new Map();
  private stageCacheHits: Map<string, number> = new Map();
  private stageCacheMisses: Map<string, number> = new Map();

  // Aggregate totals
  private totalProviderRequests: number = 0;
  private networkRequests: number = 0;
  private totalProviderLatency: number = 0;
  private totalCacheHits: number = 0;
  private totalCacheMisses: number = 0;

  // Funnel & Observatory metrics
  private preliminaryCandidates: number = 0;
  private deepCandidates: number = 0;
  private MTFCandidates: number = 0;
  private candidates72Plus: number = 0;
  private rejected72PlusCandidates: number = 0;
  private signalsGenerated: number = 0;
  private signalsAccepted: number = 0;
  private rejectionReasons: Record<string, number> = {};

  // Budget & Deadline tracking
  private globalDeadline: number = 0;
  private providerRequestsStoppedByBudget: number = 0;

  // Errors & Provider Health Map
  private errors: string[] = [];
  private providerHealthMap: Record<string, ProviderHealthStatus> = {};

  constructor(scanId?: string) {
    this.scanId = scanId || `scan_prof_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  }

  public getScanId(): string {
    return this.scanId;
  }

  public startScan(scanStartTime?: number): void {
    this.scanStartTime = scanStartTime || Date.now();
  }

  public setGlobalDeadline(deadlineMs: number): void {
    this.globalDeadline = deadlineMs;
  }

  public startStage(stageName: string, candidatesIn: number): void {
    const now = Date.now();
    this.currentStageName = stageName;
    this.stageStartTimes.set(stageName, now);
    this.stageCandidatesIn.set(stageName, candidatesIn);
    if (!this.stageProviderRequests.has(stageName)) this.stageProviderRequests.set(stageName, 0);
    if (!this.stageProviderLatency.has(stageName)) this.stageProviderLatency.set(stageName, 0);
    if (!this.stageCacheHits.has(stageName)) this.stageCacheHits.set(stageName, 0);
    if (!this.stageCacheMisses.has(stageName)) this.stageCacheMisses.set(stageName, 0);
  }

  public endStage(stageName: string, candidatesOut: number): StagePerformanceRecord {
    const now = Date.now();
    const startTime = this.stageStartTimes.get(stageName) || now;
    const durationMs = now - startTime;
    const candidatesIn = this.stageCandidatesIn.get(stageName) ?? 0;
    const providerRequests = this.stageProviderRequests.get(stageName) || 0;
    const providerLatencyMs = this.stageProviderLatency.get(stageName) || 0;
    const cacheHits = this.stageCacheHits.get(stageName) || 0;
    const cacheMisses = this.stageCacheMisses.get(stageName) || 0;

    const record: StagePerformanceRecord = {
      stageName,
      startTime,
      endTime: now,
      durationMs,
      providerRequests,
      providerLatencyMs,
      cacheHits,
      cacheMisses,
      candidatesIn,
      candidatesOut,
    };

    this.stageRecords.set(stageName, record);
    this.stageList.push(record);
    if (this.currentStageName === stageName) {
      this.currentStageName = null;
    }

    logger.info(`[STAGE PERFORMANCE PROFILE] Stage: ${stageName} | Duration: ${durationMs}ms | Requests: ${providerRequests} | Latency: ${providerLatencyMs}ms | Hits: ${cacheHits} | Misses: ${cacheMisses} | In: ${candidatesIn} -> Out: ${candidatesOut}`);

    return record;
  }

  public recordProviderRequest(latencyMs: number, stageName?: string): void {
    const targetStage = stageName || this.currentStageName;
    this.totalProviderRequests++;
    this.networkRequests++;
    this.totalProviderLatency += latencyMs;

    if (targetStage) {
      const currentRequests = this.stageProviderRequests.get(targetStage) || 0;
      this.stageProviderRequests.set(targetStage, currentRequests + 1);

      const currentLatency = this.stageProviderLatency.get(targetStage) || 0;
      this.stageProviderLatency.set(targetStage, currentLatency + latencyMs);
    }
  }

  public recordNetworkRequest(provider: string, endpoint: string, latencyMs: number): void {
    this.networkRequests++;
  }

  public recordCacheHit(stageName?: string): void {
    const targetStage = stageName || this.currentStageName;
    this.totalCacheHits++;
    if (targetStage) {
      const currentHits = this.stageCacheHits.get(targetStage) || 0;
      this.stageCacheHits.set(targetStage, currentHits + 1);
    }
  }

  public recordCacheMiss(stageName?: string): void {
    const targetStage = stageName || this.currentStageName;
    this.totalCacheMisses++;
    if (targetStage) {
      const currentMisses = this.stageCacheMisses.get(targetStage) || 0;
      this.stageCacheMisses.set(targetStage, currentMisses + 1);
    }
  }

  public recordError(errorMsg: string): void {
    this.errors.push(errorMsg);
  }

  public recordRejectionReason(reason: string, count: number = 1): void {
    this.rejectionReasons[reason] = (this.rejectionReasons[reason] || 0) + count;
  }

  public setRejectionReasons(reasons: Record<string, number>): void {
    this.rejectionReasons = { ...reasons };
  }

  public setFunnelMetrics(metrics: Partial<{
    preliminaryCandidates: number;
    deepCandidates: number;
    MTFCandidates: number;
    '72PlusCandidates': number;
    candidates72Plus: number;
    rejected72PlusCandidates: number;
    signalsGenerated: number;
    signalsAccepted: number;
  }>): void {
    if (metrics.preliminaryCandidates !== undefined) this.preliminaryCandidates = metrics.preliminaryCandidates;
    if (metrics.deepCandidates !== undefined) this.deepCandidates = metrics.deepCandidates;
    if (metrics.MTFCandidates !== undefined) this.MTFCandidates = metrics.MTFCandidates;
    if (metrics['72PlusCandidates'] !== undefined) this.candidates72Plus = metrics['72PlusCandidates'];
    if (metrics.candidates72Plus !== undefined) this.candidates72Plus = metrics.candidates72Plus;
    if (metrics.rejected72PlusCandidates !== undefined) this.rejected72PlusCandidates = metrics.rejected72PlusCandidates;
    if (metrics.signalsGenerated !== undefined) this.signalsGenerated = metrics.signalsGenerated;
    if (metrics.signalsAccepted !== undefined) this.signalsAccepted = metrics.signalsAccepted;
  }

  public setStoppedByBudget(stopped: boolean | number): void {
    this.providerRequestsStoppedByBudget = typeof stopped === 'boolean' ? (stopped ? 1 : 0) : stopped;
  }

  public setProviderHealth(provider: string, status: ProviderHealthStatus): void {
    this.providerHealthMap[provider.toLowerCase()] = status;
  }

  public computeProviderHealth(): Record<string, ProviderHealthStatus> {
    const result: Record<string, ProviderHealthStatus> = { ...this.providerHealthMap };
    const providers = ['twelvedata', 'finnhub', 'bitget', 'exchangerate'];
    const now = Date.now();

    for (const p of providers) {
      if (result[p]) continue;
      try {
        const metrics = quotaManager.getProviderMetrics(p);
        const isRateLimited = metrics.isLocked || metrics.recentErrors.some(e => e.status === 429 && now - e.timestamp < 120000);
        const isUnavailable = metrics.recentErrors.some(e => e.status >= 500 && now - e.timestamp < 120000);
        const isTimeout = metrics.recentTimeouts.some(t => now - t.timestamp < 120000);
        const isDegraded = metrics.budgetHealth === 'LOW' || metrics.budgetHealth === 'CRITICAL' || metrics.budgetHealth === 'EXHAUSTED' || metrics.averageLatencyMs > 2500;

        if (isRateLimited) {
          result[p] = 'RATE_LIMITED';
        } else if (isUnavailable) {
          result[p] = 'UNAVAILABLE';
        } else if (isTimeout) {
          result[p] = 'TIMEOUT';
        } else if (isDegraded) {
          result[p] = 'DEGRADED';
        } else {
          result[p] = 'HEALTHY';
        }
      } catch {
        result[p] = 'HEALTHY';
      }
    }
    return result;
  }

  public endScan(): ScanPerformanceProfile {
    this.scanEndTime = Date.now();
    const profile = this.getProfile();

    this.logSummary(profile);
    // Non-blocking asynchronous persistence: run after the current call stack clears
    setImmediate(() => {
      ScanPerformanceProfiler.persistProfile(profile);
    });
    return profile;
  }

  public getProfile(): ScanPerformanceProfile {
    const now = Date.now();
    const endTime = this.scanEndTime || now;
    const startTime = this.scanStartTime || endTime;
    const totalDurationMs = endTime - startTime;

    const stageDurations: Record<string, number> = {};
    const stagesObj: Record<string, StagePerformanceRecord> = {};
    for (const [name, rec] of this.stageRecords.entries()) {
      stagesObj[name] = rec;
      stageDurations[name] = rec.durationMs;
    }

    const totalCacheOps = this.totalCacheHits + this.totalCacheMisses;
    const cacheHitRate = totalCacheOps > 0 ? Number((this.totalCacheHits / totalCacheOps).toFixed(4)) : 1.0;
    const deadlineRemaining = this.globalDeadline > 0 ? Math.max(0, this.globalDeadline - endTime) : 0;
    const providerHealth = this.computeProviderHealth();

    return {
      scanId: this.scanId,
      startTime,
      endTime,
      totalDurationMs,
      stageDurations,
      providerRequests: this.totalProviderRequests,
      networkRequests: this.networkRequests || this.totalProviderRequests,
      cacheHits: this.totalCacheHits,
      cacheMisses: this.totalCacheMisses,
      cacheHitRate,
      providerLatency: this.totalProviderLatency,

      preliminaryCandidates: this.preliminaryCandidates,
      deepCandidates: this.deepCandidates,
      MTFCandidates: this.MTFCandidates,
      '72PlusCandidates': this.candidates72Plus,
      rejected72PlusCandidates: this.rejected72PlusCandidates,
      signalsGenerated: this.signalsGenerated,
      signalsAccepted: this.signalsAccepted,
      rejectionReasons: { ...this.rejectionReasons },

      globalDeadline: this.globalDeadline,
      deadlineRemaining,
      providerRequestsStoppedByBudget: this.providerRequestsStoppedByBudget,

      errors: [...this.errors],
      providerHealth,

      // Backward compatibility aliases
      scanStartTime: startTime,
      scanEndTime: endTime,
      TOTAL_SCAN_DURATION_MS: totalDurationMs,
      TOTAL_PROVIDER_LATENCY: this.totalProviderLatency,
      totalProviderRequests: this.totalProviderRequests,
      totalCacheHits: this.totalCacheHits,
      totalCacheMisses: this.totalCacheMisses,
      stages: stagesObj,
      stageList: [...this.stageList],
    };
  }

  public logSummary(profile?: ScanPerformanceProfile): void {
    const p = profile || this.getProfile();
    logger.info(`================================================================`);
    logger.info(`[STAGE-BY-STAGE PERFORMANCE PROFILE REPORT] Scan ID: ${p.scanId}`);
    logger.info(`TOTAL_SCAN_DURATION_MS: ${p.totalDurationMs}ms`);
    logger.info(`TOTAL_PROVIDER_LATENCY: ${p.providerLatency}ms across ${p.providerRequests} provider requests`);
    logger.info(`TOTAL_CACHE_STATS: Hits=${p.cacheHits}, Misses=${p.cacheMisses} (HitRate: ${(p.cacheHitRate * 100).toFixed(1)}%)`);
    logger.info(`FUNNEL_METRICS: Prelim=${p.preliminaryCandidates}, Deep=${p.deepCandidates}, MTF=${p.MTFCandidates}, 72+=${p['72PlusCandidates']}, Rejected72+=${p.rejected72PlusCandidates}, SignalsGen=${p.signalsGenerated}, SignalsAcc=${p.signalsAccepted}`);
    logger.info(`----------------------------------------------------------------`);
    for (const s of p.stageList || []) {
      logger.info(`Stage: [${s.stageName.padEnd(25)}] | Duration: ${String(s.durationMs).padStart(5)}ms | Req: ${String(s.providerRequests).padStart(3)} | Latency: ${String(s.providerLatencyMs).padStart(5)}ms | Cache Hits: ${String(s.cacheHits).padStart(3)} | Misses: ${String(s.cacheMisses).padStart(3)} | In: ${String(s.candidatesIn).padStart(3)} -> Out: ${String(s.candidatesOut).padStart(3)}`);
    }
    logger.info(`================================================================`);
  }

  public static persistProfile(profile: ScanPerformanceProfile): void {
    try {
      let history: ScanPerformanceProfile[] = [];
      if (fs.existsSync(LOCAL_HISTORY_PATH)) {
        try {
          const raw = fs.readFileSync(LOCAL_HISTORY_PATH, 'utf-8');
          history = JSON.parse(raw);
        } catch {
          history = [];
        }
      }
      history.push(profile);
      if (history.length > 100) {
        history = history.slice(-100);
      }
      fs.writeFileSync(LOCAL_HISTORY_PATH, JSON.stringify(history, null, 2), 'utf-8');
    } catch (err) {
      logger.warn('[ScanPerformanceProfiler] Failed to write profile history to disk:', { error: String(err) });
    }

    try {
      const firestore = getFirestoreAdmin();
      if (firestore) {
        firestore
          .collection(FIRESTORE_COL)
          .doc(profile.scanId)
          .set(profile)
          .catch((err) => {
            logger.debug('[ScanPerformanceProfiler] Firestore scan history sync deferred', { reason: String(err) });
          });
      }
    } catch {
      // ignore firestore sync errors in dev/unconfigured environment
    }
  }

  public static getHealthReport(): {
    status: 'HEALTHY' | 'DEGRADED' | 'CRITICAL';
    averageScanDurationMs: number;
    averageProviderLatencyMs: number;
    totalScansLogged: number;
    cacheHitRatio: number;
    healthWarnings: string[];
  } {
    let history: ScanPerformanceProfile[] = [];
    if (fs.existsSync(LOCAL_HISTORY_PATH)) {
      try {
        const raw = fs.readFileSync(LOCAL_HISTORY_PATH, 'utf-8');
        history = JSON.parse(raw);
      } catch {
        history = [];
      }
    }

    if (history.length === 0) {
      return {
        status: 'HEALTHY',
        averageScanDurationMs: 0,
        averageProviderLatencyMs: 0,
        totalScansLogged: 0,
        cacheHitRatio: 1.0,
        healthWarnings: ['No scan records logged yet.'],
      };
    }

    let totalDuration = 0;
    let totalLatency = 0;
    let totalHits = 0;
    let totalMisses = 0;

    for (const p of history) {
      totalDuration += p.totalDurationMs || p.TOTAL_SCAN_DURATION_MS || 0;
      totalLatency += p.providerLatency || p.TOTAL_PROVIDER_LATENCY || 0;
      totalHits += p.cacheHits || p.totalCacheHits || 0;
      totalMisses += p.cacheMisses || p.totalCacheMisses || 0;
    }

    const averageScanDurationMs = Math.round(totalDuration / history.length);
    const averageProviderLatencyMs = Math.round(totalLatency / history.length);
    const totalCacheOps = totalHits + totalMisses;
    const cacheHitRatio = totalCacheOps > 0 ? Number((totalHits / totalCacheOps).toFixed(4)) : 1.0;

    const healthWarnings: string[] = [];
    let status: 'HEALTHY' | 'DEGRADED' | 'CRITICAL' = 'HEALTHY';

    if (averageScanDurationMs > 20000) {
      status = 'DEGRADED';
      healthWarnings.push(`Average scan duration is elevated: ${averageScanDurationMs}ms (Threshold: 20s).`);
    }
    if (cacheHitRatio < 0.5) {
      status = 'DEGRADED';
      healthWarnings.push(`Cache hit ratio is lower than optimal: ${(cacheHitRatio * 100).toFixed(1)}% (Threshold: 50%).`);
    }
    if (averageScanDurationMs > 30000) {
      status = 'CRITICAL';
      healthWarnings.push(`Average scan duration is extremely high: ${averageScanDurationMs}ms (Threshold: 30s).`);
    }

    return {
      status,
      averageScanDurationMs,
      averageProviderLatencyMs,
      totalScansLogged: history.length,
      cacheHitRatio,
      healthWarnings,
    };
  }
}

// Active global profiler tracker (execution-scoped)
let activeProfilerInstance: ScanPerformanceProfiler | null = null;

export function setActiveProfiler(profiler: ScanPerformanceProfiler | null): void {
  activeProfilerInstance = profiler;
}

export function getActiveProfiler(): ScanPerformanceProfiler | null {
  return activeProfilerInstance;
}
