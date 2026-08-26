import { logger } from '../logger.js';

export interface ProviderQuotaConfig {
  maxPerMinute: number;
  maxPerSecond: number;
  lowThreshold: number;
  reservedRequests: number; // Reserved strictly for critical execution & cross-source validation
}

export interface ProviderRecentError {
  timestamp: number;
  status: number;
  message?: string;
}

export interface ProviderRecentTimeout {
  timestamp: number;
  message?: string;
}

export type ProviderBudgetHealth = 'HIGH' | 'NORMAL' | 'LOW' | 'CRITICAL' | 'EXHAUSTED';

export interface ProviderQuotaMetrics {
  providerId: string;
  requestsUsedRollingMinute: number;
  requestsUsedRollingSecond: number;
  requestsTotalSession: number;
  requestsRemainingRollingMinute: number;
  requestsRemainingUsable: number;
  maxPerMinute: number;
  maxPerSecond: number;
  reservedRequests: number;
  recentErrors: ProviderRecentError[];
  recentTimeouts: ProviderRecentTimeout[];
  averageLatencyMs: number;
  isLocked: boolean;
  lockedUntilMs: number;
  budgetHealth: ProviderBudgetHealth;
}

export class QuotaManager {
  private static instance: QuotaManager;

  // Rolling API call log per provider: providerId -> list of timestamps
  private requestLogs = new Map<string, number[]>();
  private totalSessionRequests = new Map<string, number>();

  // Latency tracking (Exponential moving average)
  private averageLatency = new Map<string, number>();

  // Error & Timeout logs (last 5 minutes)
  private recentErrors = new Map<string, ProviderRecentError[]>();
  private recentTimeouts = new Map<string, ProviderRecentTimeout[]>();

  // Backoff states per provider
  private backoffCount = new Map<string, number>();
  private lockedUntil = new Map<string, number>();

  // Configured limits & reserved quotas per provider
  private providerQuotas: Record<string, ProviderQuotaConfig> = {
    twelvedata: { maxPerMinute: 8, maxPerSecond: 2, lowThreshold: 5, reservedRequests: 2 },
    finnhub: { maxPerMinute: 30, maxPerSecond: 5, lowThreshold: 24, reservedRequests: 3 },
    bitget: { maxPerMinute: 120, maxPerSecond: 10, lowThreshold: 90, reservedRequests: 5 },
    exchangerate: { maxPerMinute: 10, maxPerSecond: 2, lowThreshold: 7, reservedRequests: 2 },
  };

  private constructor() {}

  public static getInstance(): QuotaManager {
    if (!QuotaManager.instance) {
      QuotaManager.instance = new QuotaManager();
    }
    return QuotaManager.instance;
  }

  /**
   * Returns comprehensive quota metrics for a single provider.
   */
  public getProviderMetrics(providerId: string): ProviderQuotaMetrics {
    const cleanProvider = providerId.toLowerCase();
    const now = Date.now();
    this.cleanupLogs(cleanProvider, now);

    const logs = this.requestLogs.get(cleanProvider) || [];
    const quota = this.providerQuotas[cleanProvider] || {
      maxPerMinute: 10,
      maxPerSecond: 2,
      lowThreshold: 7,
      reservedRequests: 2,
    };

    // Calculate 1-second and 60-second usage
    const oneSecAgo = now - 1000;
    const requestsInLastSec = logs.filter((ts) => ts > oneSecAgo).length;
    const requestsInLastMin = logs.length;

    const remainingMinute = Math.max(0, quota.maxPerMinute - requestsInLastMin);
    // Usable quota subtracts reserved requests unless performing critical validation
    const remainingUsable = Math.max(0, remainingMinute - quota.reservedRequests);

    const lockedTime = this.lockedUntil.get(cleanProvider) || 0;
    const isLocked = now < lockedTime;

    const errors = this.recentErrors.get(cleanProvider) || [];
    const timeouts = this.recentTimeouts.get(cleanProvider) || [];
    const avgLatency = this.averageLatency.get(cleanProvider) || 120;

    let budgetHealth: ProviderBudgetHealth = 'HIGH';
    if (isLocked || remainingUsable === 0) {
      budgetHealth = 'EXHAUSTED';
    } else if (remainingUsable <= 1 || errors.length >= 3 || timeouts.length >= 2) {
      budgetHealth = 'CRITICAL';
    } else if (remainingUsable <= 3 || requestsInLastMin >= quota.lowThreshold) {
      budgetHealth = 'LOW';
    } else if (remainingUsable < Math.floor(quota.maxPerMinute * 0.6)) {
      budgetHealth = 'NORMAL';
    } else {
      budgetHealth = 'HIGH';
    }

    return {
      providerId: cleanProvider,
      requestsUsedRollingMinute: requestsInLastMin,
      requestsUsedRollingSecond: requestsInLastSec,
      requestsTotalSession: this.totalSessionRequests.get(cleanProvider) || 0,
      requestsRemainingRollingMinute: remainingMinute,
      requestsRemainingUsable: remainingUsable,
      maxPerMinute: quota.maxPerMinute,
      maxPerSecond: quota.maxPerSecond,
      reservedRequests: quota.reservedRequests,
      recentErrors: [...errors],
      recentTimeouts: [...timeouts],
      averageLatencyMs: Math.round(avgLatency),
      isLocked,
      lockedUntilMs: lockedTime,
      budgetHealth,
    };
  }

  /**
   * Returns snapshot metrics across all known providers.
   */
  public getAllProviderMetrics(): Record<string, ProviderQuotaMetrics> {
    const result: Record<string, ProviderQuotaMetrics> = {};
    for (const p of Object.keys(this.providerQuotas)) {
      result[p] = this.getProviderMetrics(p);
    }
    return result;
  }

  /**
   * Evaluates overall API budget status for deep scan routing:
   * HIGH -> 12 deep candidates
   * NORMAL -> 8-10 deep candidates
   * LOW -> 5-6 deep candidates
   * CRITICAL -> 2-3 deep candidates
   * EXHAUSTED -> 0 deep candidates
   */
  public getDynamicDeepBudget(): {
    overallHealth: ProviderBudgetHealth;
    maxDeepCandidates: number;
    metrics: Record<string, ProviderQuotaMetrics>;
    reason: string;
  } {
    const metrics = this.getAllProviderMetrics();
    const metricList = Object.values(metrics);

    // If all providers are locked or exhausted
    const allExhausted = metricList.every((m) => m.budgetHealth === 'EXHAUSTED');
    if (allExhausted) {
      return {
        overallHealth: 'EXHAUSTED',
        maxDeepCandidates: 0,
        metrics,
        reason: 'All providers are currently locked or have exhausted usable quota.',
      };
    }

    // Check minimum health among active providers
    const healthLevels: Record<ProviderBudgetHealth, number> = {
      EXHAUSTED: 0,
      CRITICAL: 1,
      LOW: 2,
      NORMAL: 3,
      HIGH: 4,
    };

    let minLevel = 4;
    for (const m of metricList) {
      const lvl = healthLevels[m.budgetHealth];
      if (lvl < minLevel) {
        minLevel = lvl;
      }
    }

    if (minLevel === 0) {
      // At least one provider exhausted, others may have minimal budget
      return {
        overallHealth: 'CRITICAL',
        maxDeepCandidates: 3,
        metrics,
        reason: 'One or more primary providers are in cooldown or low quota; limiting deep scan to 3 candidates.',
      };
    } else if (minLevel === 1) {
      return {
        overallHealth: 'CRITICAL',
        maxDeepCandidates: 3,
        metrics,
        reason: 'Provider quotas are in CRITICAL state; limiting deep scan to 2-3 candidates.',
      };
    } else if (minLevel === 2) {
      return {
        overallHealth: 'LOW',
        maxDeepCandidates: 6,
        metrics,
        reason: 'Provider quotas are in LOW state; limiting deep scan to 5-6 candidates.',
      };
    } else if (minLevel === 3) {
      return {
        overallHealth: 'NORMAL',
        maxDeepCandidates: 10,
        metrics,
        reason: 'Provider quotas are in NORMAL state; allowing 8-10 deep candidates.',
      };
    } else {
      return {
        overallHealth: 'HIGH',
        maxDeepCandidates: 12,
        metrics,
        reason: 'Provider quotas are HEALTHY with ample capacity; allowing maximum 12 deep candidates.',
      };
    }
  }

  /**
   * Evaluates current API budget health status for backward compatibility.
   */
  public getBudgetStatus(providerId: string = 'twelvedata'): 'HEALTHY' | 'MODERATE' | 'CONSTRAINED' {
    const metrics = this.getProviderMetrics(providerId);
    if (metrics.budgetHealth === 'EXHAUSTED' || metrics.budgetHealth === 'CRITICAL' || metrics.budgetHealth === 'LOW') {
      return 'CONSTRAINED';
    } else if (metrics.budgetHealth === 'NORMAL') {
      return 'MODERATE';
    }
    return 'HEALTHY';
  }

  /**
   * Returns remaining usable quota for a provider in the rolling 60-second window.
   */
  public getRemainingQuota(providerId: string = 'twelvedata'): number {
    return this.getProviderMetrics(providerId).requestsRemainingUsable;
  }

  /**
   * Evaluates if a request should proceed or be blocked.
   * NEVER consumes reserved quota for non-critical calls.
   */
  public canMakeRequest(providerId: string, critical: boolean): boolean {
    const cleanProvider = providerId.toLowerCase();
    const now = Date.now();

    // 1. Cooldown lock check
    const lockedTime = this.lockedUntil.get(cleanProvider) || 0;
    if (now < lockedTime) {
      const waitLeft = Math.ceil((lockedTime - now) / 1000);
      logger.debug(`Request blocked: Provider ${providerId} is in cooldown lock`, { waitLeftSeconds: waitLeft });
      return false;
    }

    // 2. Clean up logs
    this.cleanupLogs(cleanProvider, now);

    const logs = this.requestLogs.get(cleanProvider) || [];
    const quota = this.providerQuotas[cleanProvider] || {
      maxPerMinute: 10,
      maxPerSecond: 2,
      lowThreshold: 7,
      reservedRequests: 2,
    };

    // 3. Requests per second check
    const oneSecAgo = now - 1000;
    const rps = logs.filter((ts) => ts > oneSecAgo).length;
    if (rps >= quota.maxPerSecond) {
      logger.info(`Request blocked: Rate limit per second (${quota.maxPerSecond}/sec) reached for ${providerId}`);
      return false;
    }

    // 4. Requests per minute check
    if (logs.length >= quota.maxPerMinute) {
      logger.info(`Request blocked: Absolute minute quota limit (${quota.maxPerMinute}/min) reached for ${providerId}`);
      return false;
    }

    // 5. Reserved quota check: Non-critical requests cannot breach the reserved threshold
    const allowableForNonCritical = quota.maxPerMinute - quota.reservedRequests;
    if (!critical && logs.length >= allowableForNonCritical) {
      logger.info(`Request blocked: Reserved quota safety barrier reached on ${providerId} (${logs.length}/${allowableForNonCritical} used)`);
      return false;
    }

    return true;
  }

  /**
   * Tracks an active API call for rate limiting logs.
   */
  public recordRequest(providerId: string): void {
    const cleanProvider = providerId.toLowerCase();
    const now = Date.now();

    if (!this.requestLogs.has(cleanProvider)) {
      this.requestLogs.set(cleanProvider, []);
    }

    this.requestLogs.get(cleanProvider)!.push(now);
    const curTotal = (this.totalSessionRequests.get(cleanProvider) || 0) + 1;
    this.totalSessionRequests.set(cleanProvider, curTotal);
  }

  /**
   * Records API response status, latency, errors, and timeouts to handle HTTP 429 backoff.
   */
  public recordResponse(
    providerId: string,
    status: number,
    latencyMs?: number,
    isTimeout: boolean = false,
    errorMessage?: string
  ): void {
    const cleanProvider = providerId.toLowerCase();
    const now = Date.now();

    // 1. Update rolling average latency
    if (latencyMs && latencyMs > 0) {
      const prevLatency = this.averageLatency.get(cleanProvider) || latencyMs;
      const newLatency = prevLatency * 0.8 + latencyMs * 0.2;
      this.averageLatency.set(cleanProvider, newLatency);
    }

    // 2. Track timeouts
    if (isTimeout) {
      if (!this.recentTimeouts.has(cleanProvider)) {
        this.recentTimeouts.set(cleanProvider, []);
      }
      this.recentTimeouts.get(cleanProvider)!.push({ timestamp: now, message: errorMessage });
    }

    // 3. Track errors
    if (status >= 400 || isTimeout) {
      if (!this.recentErrors.has(cleanProvider)) {
        this.recentErrors.set(cleanProvider, []);
      }
      this.recentErrors.get(cleanProvider)!.push({ timestamp: now, status, message: errorMessage });
    }

    // 4. Handle HTTP 429 Rate Limits with exponential backoff
    if (status === 429) {
      const existingLock = this.lockedUntil.get(cleanProvider) || 0;

      // Guard against duplicate backoff increments within 5 seconds
      if (existingLock > now && (existingLock - now) > 5000) {
        return;
      }

      const currentCount = (this.backoffCount.get(cleanProvider) || 0) + 1;
      this.backoffCount.set(cleanProvider, currentCount);

      // Backoff: 15s, 30s, 60s, 120s up to 600s
      const baseBackoff = 15 * 1000;
      const backoffDuration = Math.min(600 * 1000, baseBackoff * Math.pow(2, currentCount - 1));
      const unlockTime = now + backoffDuration;

      this.lockedUntil.set(cleanProvider, unlockTime);
      logger.info(`Provider ${providerId} returned HTTP 429. Exponential backoff active`, {
        consecutiveRateLimits: currentCount,
        cooldownMs: backoffDuration,
        lockedUntil: new Date(unlockTime).toISOString(),
      });
    } else if (status >= 200 && status < 300) {
      if (this.backoffCount.get(cleanProvider) !== 0) {
        this.backoffCount.set(cleanProvider, 0);
      }
    }
  }

  /**
   * Returns total error count across all providers in the last 5 minutes.
   */
  public getTotalRecentErrors(): number {
    let total = 0;
    const now = Date.now();
    for (const p of Object.keys(this.providerQuotas)) {
      this.cleanupLogs(p, now);
      total += (this.recentErrors.get(p) || []).length;
    }
    return total;
  }

  /**
   * Returns total timeout count across all providers in the last 5 minutes.
   */
  public getTotalRecentTimeouts(): number {
    let total = 0;
    const now = Date.now();
    for (const p of Object.keys(this.providerQuotas)) {
      this.cleanupLogs(p, now);
      total += (this.recentTimeouts.get(p) || []).length;
    }
    return total;
  }

  /**
   * Returns total lifetime session requests made across all providers.
   */
  public getTotalSessionRequestsAll(): number {
    let total = 0;
    for (const count of this.totalSessionRequests.values()) {
      total += count;
    }
    return total;
  }

  /**
   * Returns sum of usable remaining requests across all providers in rolling minute.
   */
  public getOverallUsableQuota(): number {
    let total = 0;
    for (const p of Object.keys(this.providerQuotas)) {
      total += this.getProviderMetrics(p).requestsRemainingUsable;
    }
    return total;
  }

  private cleanupLogs(providerId: string, now: number): void {
    const logs = this.requestLogs.get(providerId);
    if (logs) {
      const threshold = now - 60000;
      const freshLogs = logs.filter((ts) => ts > threshold);
      this.requestLogs.set(providerId, freshLogs);
    }

    // Clean errors older than 5 minutes
    const errors = this.recentErrors.get(providerId);
    if (errors) {
      const errThreshold = now - 300000;
      this.recentErrors.set(providerId, errors.filter((e) => e.timestamp > errThreshold));
    }

    // Clean timeouts older than 5 minutes
    const timeouts = this.recentTimeouts.get(providerId);
    if (timeouts) {
      const toThreshold = now - 300000;
      this.recentTimeouts.set(providerId, timeouts.filter((t) => t.timestamp > toThreshold));
    }
  }
}

export const quotaManager = QuotaManager.getInstance();

