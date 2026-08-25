import { logger } from '../logger.js';

export interface CronJobOrgSchedule {
  timezone?: string;
  hours?: number[];
  minutes?: number[];
  mdays?: number[];
  months?: number[];
  wdays?: number[];
  intervalDescription?: string;
}

export interface CronJobOrgExecution {
  timestamp: number; // Unix milliseconds
  dateIso: string;
  status?: string | number;
  durationMs?: number;
  httpStatus?: number;
}

export interface CronJobOrgStatusResponse {
  success: boolean;
  configured: boolean;
  jobId?: string | number;
  title?: string;
  url?: string;
  enabled?: boolean;
  status?: string | number;
  statusText?: string;
  schedule?: CronJobOrgSchedule;
  lastExecution?: CronJobOrgExecution | null;
  nextExecution?: CronJobOrgExecution | null;
  recentHistory?: CronJobOrgExecution[];
  lastCheckedAt: number;
  cacheExpiresAt: number;
  error?: string;
}

const CACHE_TTL_MS = 60 * 1000; // 60 seconds TTL to preserve API quota (default: 100 req/day)

export class CronJobOrgService {
  private static cachedStatus: CronJobOrgStatusResponse | null = null;
  private static cacheTimestamp = 0;
  private static isFetching = false;

  /**
   * Normalize cron-job.org timestamps which can be either seconds (10-digit), ms (13-digit),
   * nested objects ({ timestamp, date, executedAt }), or date strings.
   */
  private static normalizeTimestamp(raw: unknown): number {
    if (typeof raw === 'number' && raw > 0) {
      return raw < 1e11 ? raw * 1000 : raw;
    }
    if (typeof raw === 'object' && raw !== null) {
      const obj = raw as Record<string, unknown>;
      if (obj.timestamp !== undefined) return this.normalizeTimestamp(obj.timestamp);
      if (obj.date !== undefined) return this.normalizeTimestamp(obj.date);
      if (obj.executedAt !== undefined) return this.normalizeTimestamp(obj.executedAt);
    }
    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      const num = Number(trimmed);
      if (!isNaN(num) && num > 0) return num < 1e11 ? num * 1000 : num;
      
      const isoCandidate = trimmed.includes(' ') && !trimmed.includes('T') ? trimmed.replace(' ', 'T') + 'Z' : trimmed;
      const parsed = Date.parse(isoCandidate);
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
    return 0;
  }

  /**
   * Formats cron minutes array into human readable description
   */
  private static formatMinutesDescription(minutes?: number[]): string {
    if (!minutes || minutes.length === 0 || minutes.includes(-1)) {
      return 'Every minute';
    }
    if (minutes.length === 4 && [0, 15, 30, 45].every(m => minutes.includes(m))) {
      return 'Every 15 minutes (:00, :15, :30, :45)';
    }
    if (minutes.length === 2 && [0, 30].every(m => minutes.includes(m))) {
      return 'Every 30 minutes (:00, :30)';
    }
    if (minutes.length === 1 && minutes[0] === 0) {
      return 'Hourly (:00)';
    }
    return `Minutes: ${minutes.join(', ')}`;
  }

  /**
   * Retrieves authoritative cron-job.org job details and execution history.
   * Cached for 60 seconds to respect API rate limits.
   */
  public static async getJobStatus(forceRefresh = false): Promise<CronJobOrgStatusResponse> {
    const apiKey = process.env.CRONJOB_ORG_API_KEY?.trim();
    const jobId = process.env.CRONJOB_ORG_JOB_ID?.trim();
    const now = Date.now();

    if (!apiKey || !jobId) {
      return {
        success: true,
        configured: false,
        lastCheckedAt: now,
        cacheExpiresAt: now,
        error: 'CRONJOB_ORG_API_KEY or CRONJOB_ORG_JOB_ID not configured in server environment variables.',
      };
    }

    if (!forceRefresh && this.cachedStatus && now - this.cacheTimestamp < CACHE_TTL_MS) {
      return {
        ...this.cachedStatus,
        cacheExpiresAt: this.cacheTimestamp + CACHE_TTL_MS,
      };
    }

    if (this.isFetching && this.cachedStatus) {
      return this.cachedStatus;
    }

    this.isFetching = true;

    try {
      logger.info(`[CronJobOrgService] Fetching cron-job.org status for Job ID ${jobId}...`);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);

      const jobRes = await fetch(`https://api.cron-job.org/jobs/${jobId}`, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!jobRes.ok) {
        const errorText = await jobRes.text().catch(() => '');
        logger.warn(`[CronJobOrgService] API returned HTTP ${jobRes.status}: ${errorText}`);
        
        const fallbackStatus: CronJobOrgStatusResponse = {
          success: false,
          configured: true,
          jobId,
          lastCheckedAt: now,
          cacheExpiresAt: now + 30000, // Short retry TTL on error
          error: `cron-job.org API error (HTTP ${jobRes.status}): ${errorText || jobRes.statusText}`,
        };
        this.cachedStatus = fallbackStatus;
        this.cacheTimestamp = now;
        return fallbackStatus;
      }

      const jobData = await jobRes.json() as any;
      const details = jobData?.jobDetails || jobData?.job || jobData;

      // Also try fetching execution history (graceful)
      let historyItems: CronJobOrgExecution[] = [];
      try {
        const histController = new AbortController();
        const histTimeout = setTimeout(() => histController.abort(), 5000);
        const histRes = await fetch(`https://api.cron-job.org/jobs/${jobId}/history`, {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          signal: histController.signal,
        });
        clearTimeout(histTimeout);

        if (histRes.ok) {
          const histData = await histRes.json() as any;
          const rawHistory = histData?.history || histData?.jobHistory || [];
          if (Array.isArray(rawHistory)) {
            historyItems = rawHistory.slice(0, 5).map((item: any) => {
              const ts = this.normalizeTimestamp(item.date || item.timestamp || item.executedAt);
              return {
                timestamp: ts,
                dateIso: ts > 0 ? new Date(ts).toISOString() : 'UNKNOWN',
                status: item.status,
                durationMs: item.duration,
                httpStatus: item.httpStatus,
              };
            });
          }
        }
      } catch (histErr) {
        logger.warn('[CronJobOrgService] History fetch skipped or failed:', { error: String(histErr) });
      }

      const rawLastExec = details?.lastExecution ?? details?.lastRun ?? (historyItems.length > 0 ? historyItems[0].timestamp : null);
      const lastExecTs = this.normalizeTimestamp(rawLastExec);
      
      const rawNextExec = details?.nextExecution ?? details?.nextRun;
      const nextExecTs = this.normalizeTimestamp(rawNextExec);

      const minutes = Array.isArray(details?.schedule?.minutes) ? details.schedule.minutes : undefined;
      const intervalDesc = this.formatMinutesDescription(minutes);

      const statusMap: Record<number, string> = {
        0: 'DISABLED',
        1: 'ACTIVE',
        2: 'PAUSED',
        3: 'ERROR',
      };
      const statusText = typeof details?.status === 'number' 
        ? (statusMap[details.status] || `STATUS_${details.status}`)
        : (details?.enabled ? 'ACTIVE' : 'DISABLED');

      const response: CronJobOrgStatusResponse = {
        success: true,
        configured: true,
        jobId: details?.jobId || jobId,
        title: details?.title || 'Trading Signals Automated Scanner',
        url: details?.url || details?.request?.url,
        enabled: details?.enabled ?? true,
        status: details?.status,
        statusText,
        schedule: {
          timezone: details?.schedule?.timezone || 'UTC',
          hours: details?.schedule?.hours,
          minutes: details?.schedule?.minutes,
          mdays: details?.schedule?.mdays,
          months: details?.schedule?.months,
          wdays: details?.schedule?.wdays,
          intervalDescription: intervalDesc,
        },
        lastExecution: lastExecTs > 0 ? {
          timestamp: lastExecTs,
          dateIso: new Date(lastExecTs).toISOString(),
          status: details?.lastStatus ?? (historyItems[0]?.status),
          durationMs: details?.lastDuration ?? (historyItems[0]?.durationMs),
          httpStatus: details?.lastHttpStatus ?? (historyItems[0]?.httpStatus),
        } : null,
        nextExecution: nextExecTs > 0 ? {
          timestamp: nextExecTs,
          dateIso: new Date(nextExecTs).toISOString(),
        } : null,
        recentHistory: historyItems,
        lastCheckedAt: now,
        cacheExpiresAt: now + CACHE_TTL_MS,
      };

      this.cachedStatus = response;
      this.cacheTimestamp = now;
      logger.info(`[CronJobOrgService] Successfully updated status. Enabled: ${response.enabled}, Interval: ${intervalDesc}`);
      return response;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('[CronJobOrgService] Unexpected error connecting to cron-job.org:', { error: msg });
      
      const fallback: CronJobOrgStatusResponse = {
        success: false,
        configured: true,
        jobId,
        lastCheckedAt: now,
        cacheExpiresAt: now + 30000,
        error: `Network/connection error to cron-job.org: ${msg}`,
      };
      this.cachedStatus = fallback;
      this.cacheTimestamp = now;
      return fallback;
    } finally {
      this.isFetching = false;
    }
  }
}
