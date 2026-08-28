import { logger } from '../logger.js';

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
  scanStartTime: number;
  scanEndTime: number;
  TOTAL_SCAN_DURATION_MS: number;
  TOTAL_PROVIDER_LATENCY: number;
  totalProviderRequests: number;
  totalCacheHits: number;
  totalCacheMisses: number;
  stages: Record<string, StagePerformanceRecord>;
  stageList: StagePerformanceRecord[];
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
  private totalProviderLatency: number = 0;
  private totalCacheHits: number = 0;
  private totalCacheMisses: number = 0;

  constructor(scanId?: string) {
    this.scanId = scanId || `scan_prof_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  }

  public startScan(scanStartTime?: number): void {
    this.scanStartTime = scanStartTime || Date.now();
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
    this.totalProviderLatency += latencyMs;

    if (targetStage) {
      const currentRequests = this.stageProviderRequests.get(targetStage) || 0;
      this.stageProviderRequests.set(targetStage, currentRequests + 1);

      const currentLatency = this.stageProviderLatency.get(targetStage) || 0;
      this.stageProviderLatency.set(targetStage, currentLatency + latencyMs);
    }
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

  public endScan(): ScanPerformanceProfile {
    this.scanEndTime = Date.now();
    const totalDuration = this.scanEndTime - (this.scanStartTime || this.scanEndTime);
    const profile = this.getProfile();

    this.logSummary(profile);
    return profile;
  }

  public getProfile(): ScanPerformanceProfile {
    const now = Date.now();
    const scanEndTime = this.scanEndTime || now;
    const TOTAL_SCAN_DURATION_MS = scanEndTime - (this.scanStartTime || scanEndTime);

    const stagesObj: Record<string, StagePerformanceRecord> = {};
    for (const [name, rec] of this.stageRecords.entries()) {
      stagesObj[name] = rec;
    }

    return {
      scanId: this.scanId,
      scanStartTime: this.scanStartTime,
      scanEndTime,
      TOTAL_SCAN_DURATION_MS,
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
    logger.info(`TOTAL_SCAN_DURATION_MS: ${p.TOTAL_SCAN_DURATION_MS}ms`);
    logger.info(`TOTAL_PROVIDER_LATENCY: ${p.TOTAL_PROVIDER_LATENCY}ms across ${p.totalProviderRequests} provider requests`);
    logger.info(`TOTAL_CACHE_STATS: Hits=${p.totalCacheHits}, Misses=${p.totalCacheMisses}`);
    logger.info(`----------------------------------------------------------------`);
    for (const s of p.stageList) {
      logger.info(`Stage: [${s.stageName.padEnd(20)}] | Duration: ${String(s.durationMs).padStart(5)}ms | Req: ${String(s.providerRequests).padStart(3)} | Latency: ${String(s.providerLatencyMs).padStart(5)}ms | Cache Hits: ${String(s.cacheHits).padStart(3)} | Misses: ${String(s.cacheMisses).padStart(3)} | In: ${String(s.candidatesIn).padStart(3)} -> Out: ${String(s.candidatesOut).padStart(3)}`);
    }
    logger.info(`================================================================`);
  }
}

// Active global profiler tracker (execution-scoped or thread-local storage)
let activeProfilerInstance: ScanPerformanceProfiler | null = null;

export function setActiveProfiler(profiler: ScanPerformanceProfiler | null): void {
  activeProfilerInstance = profiler;
}

export function getActiveProfiler(): ScanPerformanceProfiler | null {
  return activeProfilerInstance;
}
