/**
 * Central Provider Telemetry & Diagnostics (Gate 3)
 * Tracks request metrics, success rates, rate-limiting (429), timeouts, failovers,
 * cache hit/miss rates, and latency by provider.
 *
 * Exposes diagnostic logs without exposing API keys or secrets.
 */

import { logger } from '../logger.js';

export interface ProviderMetricStats {
  requests: number;
  successes: number;
  http429Count: number;
  timeoutCount: number;
  otherErrors: number;
  totalLatencyMs: number;
  avgLatencyMs: number;
  lastSuccessTimestamp?: number;
  lastErrorTimestamp?: number;
  lastErrorMessage?: string;
}

export interface TelemetrySummary {
  timestamp: string;
  uptimeSeconds: number;
  totalRequests: number;
  totalSuccesses: number;
  totalFailovers: number;
  cacheHits: number;
  cacheMisses: number;
  cacheHitRatio: number;
  providers: Record<string, ProviderMetricStats>;
  recentFailovers: Array<{
    timestamp: number;
    symbol: string;
    fromProvider: string;
    toProvider: string;
    reason: string;
  }>;
  recentActivity: Array<{
    timestamp: number;
    symbol: string;
    type: 'price' | 'candles';
    source: string;
    resolvedProvider: string;
    success: boolean;
    durationMs: number;
  }>;
}

export class ProviderTelemetryTracker {
  private static instance: ProviderTelemetryTracker;

  private startTime: number = Date.now();
  private cacheHits: number = 0;
  private cacheMisses: number = 0;
  private failoverCount: number = 0;

  private providerStats = new Map<string, ProviderMetricStats>();
  private recentFailovers: Array<{
    timestamp: number;
    symbol: string;
    fromProvider: string;
    toProvider: string;
    reason: string;
  }> = [];
  private recentActivity: Array<{
    timestamp: number;
    symbol: string;
    type: 'price' | 'candles';
    source: string;
    resolvedProvider: string;
    success: boolean;
    durationMs: number;
  }> = [];

  private static readonly MAX_RECENT_LOGS = 100;

  private constructor() {
    // Pre-initialize main providers
    const initialProviders = ['tiingo', 'finnhub', 'twelvedata', 'bitget', 'exchangerate'];
    for (const p of initialProviders) {
      this.getOrCreateStats(p);
    }
  }

  public static getInstance(): ProviderTelemetryTracker {
    if (!ProviderTelemetryTracker.instance) {
      ProviderTelemetryTracker.instance = new ProviderTelemetryTracker();
    }
    return ProviderTelemetryTracker.instance;
  }

  private getOrCreateStats(providerId: string): ProviderMetricStats {
    const key = providerId.toLowerCase();
    let stats = this.providerStats.get(key);
    if (!stats) {
      stats = {
        requests: 0,
        successes: 0,
        http429Count: 0,
        timeoutCount: 0,
        otherErrors: 0,
        totalLatencyMs: 0,
        avgLatencyMs: 0,
      };
      this.providerStats.set(key, stats);
    }
    return stats;
  }

  public recordRequest(providerId: string): void {
    const stats = this.getOrCreateStats(providerId);
    stats.requests++;
  }

  public recordSuccess(
    providerId: string,
    latencyMs: number,
    symbol: string,
    type: 'price' | 'candles'
  ): void {
    const stats = this.getOrCreateStats(providerId);
    stats.successes++;
    stats.totalLatencyMs += latencyMs;
    stats.avgLatencyMs = Math.round(stats.totalLatencyMs / Math.max(1, stats.successes));
    stats.lastSuccessTimestamp = Date.now();

    this.recordActivity(symbol, type, 'LIVE', providerId, true, latencyMs);
  }

  public record429(providerId: string, symbol?: string): void {
    const stats = this.getOrCreateStats(providerId);
    stats.http429Count++;
    stats.lastErrorTimestamp = Date.now();
    stats.lastErrorMessage = 'HTTP 429 Too Many Requests (Rate Limited)';
    logger.warn(`[Telemetry] Provider '${providerId}' received HTTP 429 Rate Limit${symbol ? ` for ${symbol}` : ''}`);
  }

  public recordTimeout(providerId: string, symbol?: string, message?: string): void {
    const stats = this.getOrCreateStats(providerId);
    stats.timeoutCount++;
    stats.lastErrorTimestamp = Date.now();
    stats.lastErrorMessage = message || 'Request Timed Out';
    logger.warn(`[Telemetry] Provider '${providerId}' timed out${symbol ? ` for ${symbol}` : ''}`);
  }

  public recordError(providerId: string, errorMessage: string, symbol?: string): void {
    const stats = this.getOrCreateStats(providerId);
    stats.otherErrors++;
    stats.lastErrorTimestamp = Date.now();
    stats.lastErrorMessage = errorMessage;
  }

  public recordFailover(
    fromProvider: string,
    toProvider: string,
    symbol: string,
    reason: string
  ): void {
    this.failoverCount++;
    const entry = {
      timestamp: Date.now(),
      symbol,
      fromProvider: fromProvider.toLowerCase(),
      toProvider: toProvider.toLowerCase(),
      reason,
    };
    this.recentFailovers.push(entry);
    if (this.recentFailovers.length > ProviderTelemetryTracker.MAX_RECENT_LOGS) {
      this.recentFailovers.shift();
    }
    logger.info(`[Telemetry Failover] ${symbol}: ${fromProvider} -> ${toProvider} | Reason: ${reason}`);
  }

  public recordCacheHit(symbol: string, type: 'price' | 'candles', provider: string = 'cache'): void {
    this.cacheHits++;
    this.recordActivity(symbol, type, 'CACHE', provider, true, 0);
  }

  public recordCacheMiss(symbol: string, type: 'price' | 'candles'): void {
    this.cacheMisses++;
  }

  private recordActivity(
    symbol: string,
    type: 'price' | 'candles',
    source: string,
    resolvedProvider: string,
    success: boolean,
    durationMs: number
  ): void {
    this.recentActivity.push({
      timestamp: Date.now(),
      symbol,
      type,
      source,
      resolvedProvider: resolvedProvider.toLowerCase(),
      success,
      durationMs,
    });
    if (this.recentActivity.length > ProviderTelemetryTracker.MAX_RECENT_LOGS) {
      this.recentActivity.shift();
    }
  }

  public getSummary(): TelemetrySummary {
    const now = Date.now();
    const providersObj: Record<string, ProviderMetricStats> = {};
    let totalReqs = 0;
    let totalSucc = 0;

    for (const [p, stats] of this.providerStats.entries()) {
      providersObj[p] = { ...stats };
      totalReqs += stats.requests;
      totalSucc += stats.successes;
    }

    const totalCacheOps = this.cacheHits + this.cacheMisses;
    const cacheHitRatio = totalCacheOps > 0 ? Number((this.cacheHits / totalCacheOps).toFixed(4)) : 1.0;

    return {
      timestamp: new Date(now).toISOString(),
      uptimeSeconds: Math.floor((now - this.startTime) / 1000),
      totalRequests: totalReqs,
      totalSuccesses: totalSucc,
      totalFailovers: this.failoverCount,
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      cacheHitRatio,
      providers: providersObj,
      recentFailovers: [...this.recentFailovers],
      recentActivity: [...this.recentActivity],
    };
  }

  /**
   * Generates formatted one-line log summary
   * e.g. "Tiingo requests: 42, successes: 39, 429: 3 | Finnhub requests: 18, successes: 17 | ..."
   */
  public getFormattedLogSummary(): string {
    const summary = this.getSummary();
    const p = summary.providers;
    const parts: string[] = [];

    if (p.tiingo && p.tiingo.requests > 0) {
      parts.push(`Tiingo: req=${p.tiingo.requests}, ok=${p.tiingo.successes}, 429=${p.tiingo.http429Count}, avg=${p.tiingo.avgLatencyMs}ms`);
    }
    if (p.finnhub && p.finnhub.requests > 0) {
      parts.push(`Finnhub: req=${p.finnhub.requests}, ok=${p.finnhub.successes}, 429=${p.finnhub.http429Count}, avg=${p.finnhub.avgLatencyMs}ms`);
    }
    if (p.twelvedata && p.twelvedata.requests > 0) {
      parts.push(`TwelveData: req=${p.twelvedata.requests}, ok=${p.twelvedata.successes}, 429=${p.twelvedata.http429Count}, avg=${p.twelvedata.avgLatencyMs}ms`);
    }
    if (p.bitget && p.bitget.requests > 0) {
      parts.push(`Bitget: req=${p.bitget.requests}, ok=${p.bitget.successes}, 429=${p.bitget.http429Count}, avg=${p.bitget.avgLatencyMs}ms`);
    }

    const providerStr = parts.length > 0 ? parts.join(' | ') : 'No outbound provider requests yet';
    return `[Provider Telemetry] ${providerStr} | Failovers: ${summary.totalFailovers} | Cache Hits: ${summary.cacheHits} / Misses: ${summary.cacheMisses}`;
  }

  public reset(): void {
    this.startTime = Date.now();
    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.failoverCount = 0;
    this.providerStats.clear();
    this.recentFailovers = [];
    this.recentActivity = [];
  }
}

export const providerTelemetry = ProviderTelemetryTracker.getInstance();
