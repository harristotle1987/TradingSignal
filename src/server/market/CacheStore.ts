/**
 * In-Memory Market Data Cache & Request Deduplication
 * Reuses valid cached market data to protect provider rate limits and prevent duplicate parallel calls.
 */

import { NormalizedTicker, NormalizedCandle } from './types.js';
import { serverConfig } from '../config.js';

interface CacheEntry {
  ticker: NormalizedTicker;
  expiresAt: number;
}

interface CandleCacheEntry {
  candles: NormalizedCandle[];
  expiresAt: number;
}

export class MarketDataCache {
  private cache = new Map<string, CacheEntry>();
  private candleCache = new Map<string, CandleCacheEntry>();
  private pendingRequests = new Map<string, Promise<NormalizedTicker>>();
  private pendingCandleRequests = new Map<string, Promise<NormalizedCandle[]>>();

  private getCacheKey(provider: string, symbol: string): string {
    return `${provider.toLowerCase()}:${symbol.toUpperCase()}`;
  }

  private getCandleCacheKey(provider: string, symbol: string, timeframe: string): string {
    return `${provider.toLowerCase()}:${symbol.toUpperCase()}:${timeframe.toLowerCase()}`;
  }

  get(provider: string, symbol: string): NormalizedTicker | null {
    const key = this.getCacheKey(provider, symbol);
    const entry = this.cache.get(key);

    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    const maxAgeMs = serverConfig.getConfig().marketDataMaxAgeMs;
    const isFresh = (Date.now() - entry.ticker.receivedAt <= maxAgeMs) && entry.ticker.status === 'OK';

    return {
      ...entry.ticker,
      source: 'CACHE',
      isFresh,
      status: isFresh ? 'OK' : 'STALE',
    };
  }

  set(provider: string, symbol: string, ticker: NormalizedTicker, ttlMs: number): void {
    const key = this.getCacheKey(provider, symbol);
    this.cache.set(key, {
      ticker: {
        ...ticker,
        source: 'LIVE',
      },
      expiresAt: Date.now() + ttlMs,
    });
  }

  /**
   * Deduplicates concurrent identical requests for the same provider & symbol
   */
  async getOrFetch(
    provider: string,
    symbol: string,
    ttlMs: number,
    fetcher: () => Promise<NormalizedTicker>
  ): Promise<NormalizedTicker> {
    const key = this.getCacheKey(provider, symbol);

    // 1. Check Cache
    const cached = this.get(provider, symbol);
    if (cached) {
      return cached;
    }

    // 2. Check in-flight duplicate request
    const existingPromise = this.pendingRequests.get(key);
    if (existingPromise) {
      return existingPromise;
    }

    // 3. Initiate request & deduplicate
    const fetchPromise = (async () => {
      try {
        const result = await fetcher();
        if (result.status === 'OK') {
          this.set(provider, symbol, result, ttlMs);
        }
        return result;
      } finally {
        this.pendingRequests.delete(key);
      }
    })();

    this.pendingRequests.set(key, fetchPromise);
    return fetchPromise;
  }

  // --- Candle Caching Methods ---

  getCandles(provider: string, symbol: string, timeframe: string): NormalizedCandle[] | null {
    const key = this.getCandleCacheKey(provider, symbol, timeframe);
    const entry = this.candleCache.get(key);

    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.candleCache.delete(key);
      return null;
    }

    return entry.candles;
  }

  setCandles(provider: string, symbol: string, timeframe: string, candles: NormalizedCandle[], ttlMs: number): void {
    const key = this.getCandleCacheKey(provider, symbol, timeframe);
    this.candleCache.set(key, {
      candles,
      expiresAt: Date.now() + ttlMs,
    });
  }

  async getOrFetchCandles(
    provider: string,
    symbol: string,
    timeframe: string,
    ttlMs: number,
    fetcher: () => Promise<NormalizedCandle[]>
  ): Promise<NormalizedCandle[]> {
    const key = this.getCandleCacheKey(provider, symbol, timeframe);

    // 1. Check Cache
    const cached = this.getCandles(provider, symbol, timeframe);
    if (cached && cached.length > 0) {
      return cached;
    }

    // 2. Check in-flight duplicate request
    const existingPromise = this.pendingCandleRequests.get(key);
    if (existingPromise) {
      return existingPromise;
    }

    // 3. Fetch & Deduplicate
    const fetchPromise = (async () => {
      try {
        const result = await fetcher();
        if (result && result.length > 0) {
          this.setCandles(provider, symbol, timeframe, result, ttlMs);
        }
        return result;
      } finally {
        this.pendingCandleRequests.delete(key);
      }
    })();

    this.pendingCandleRequests.set(key, fetchPromise);
    return fetchPromise;
  }

  clear(): void {
    this.cache.clear();
    this.candleCache.clear();
    this.pendingRequests.clear();
    this.pendingCandleRequests.clear();
  }
}

export const marketCache = new MarketDataCache();
