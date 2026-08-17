import { logger } from '../logger.js';

interface ProviderQuota {
  maxPerMinute: number;
  lowThreshold: number;
}

export class QuotaManager {
  private static instance: QuotaManager;
  
  // Rolling API call log per provider: providerId -> list of timestamps
  private requestLogs = new Map<string, number[]>();
  
  // Backoff states per provider: providerId -> consecutive rate limits
  private backoffCount = new Map<string, number>();
  private lockedUntil = new Map<string, number>();
  
  // Configured limits
  private providerQuotas: Record<string, ProviderQuota> = {
    twelvedata: { maxPerMinute: 5, lowThreshold: 3 },
    finnhub: { maxPerMinute: 30, lowThreshold: 28 },
    bitget: { maxPerMinute: 120, lowThreshold: 100 },
  };

  private constructor() {}

  public static getInstance(): QuotaManager {
    if (!QuotaManager.instance) {
      QuotaManager.instance = new QuotaManager();
    }
    return QuotaManager.instance;
  }

  /**
   * Evaluates if a request should proceed or be blocked due to lock/cooldown or low quota.
   */
  public canMakeRequest(providerId: string, critical: boolean): boolean {
    const cleanProvider = providerId.toLowerCase();
    const now = Date.now();

    // 1. Check if the provider is locked due to rate-limiting backoff
    const lockedTime = this.lockedUntil.get(cleanProvider) || 0;
    if (now < lockedTime) {
      const waitLeft = Math.ceil((lockedTime - now) / 1000);
      logger.debug(`Request blocked: Provider ${providerId} is in cooldown lock`, { waitLeftSeconds: waitLeft });
      return false;
    }

    // 2. Clean up stale logs older than 1 minute
    this.cleanupLogs(cleanProvider, now);

    // 3. Count requests in the last 60 seconds
    const logs = this.requestLogs.get(cleanProvider) || [];
    const quota = this.providerQuotas[cleanProvider];
    
    if (quota) {
      // Exceeds absolute maximum limit
      if (logs.length >= quota.maxPerMinute) {
        logger.info(`Request blocked: Minute quota limit (${quota.maxPerMinute}/min) reached for ${providerId}`, { count: logs.length });
        return false;
      }

      // Quota is low: reject non-critical requests
      if (logs.length >= quota.lowThreshold) {
        if (!critical) {
          logger.info(`Request blocked: Low quota threshold reached for non-critical query on ${providerId}`, { count: logs.length });
          return false;
        } else {
          logger.info(`Low quota threshold active, allowing critical request for ${providerId}`, { count: logs.length });
        }
      }
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
  }

  /**
   * Records API response status to handle HTTP 429 rate limits and apply backoff.
   */
  public recordResponse(providerId: string, status: number): void {
    const cleanProvider = providerId.toLowerCase();

    if (status === 429) {
      const now = Date.now();
      const existingLock = this.lockedUntil.get(cleanProvider) || 0;

      // Guard against duplicate backoff increments if locked very recently (within last 5 seconds)
      if (existingLock > now && (existingLock - now) > 5000) {
        return;
      }

      // Trigger exponential backoff
      const currentCount = (this.backoffCount.get(cleanProvider) || 0) + 1;
      this.backoffCount.set(cleanProvider, currentCount);

      // Backoff doubles: 15s, 30s, 60s, 120s up to 600s (10 min)
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
      // Clear consecutive rate limit counts upon a successful request
      if (this.backoffCount.get(cleanProvider) !== 0) {
        this.backoffCount.set(cleanProvider, 0);
      }
    }
  }

  private cleanupLogs(providerId: string, now: number): void {
    const logs = this.requestLogs.get(providerId);
    if (!logs) return;

    // Filter only timestamps in the last 60 seconds
    const threshold = now - 60000;
    const freshLogs = logs.filter((ts) => ts > threshold);
    this.requestLogs.set(providerId, freshLogs);
  }
}

export const quotaManager = QuotaManager.getInstance();
