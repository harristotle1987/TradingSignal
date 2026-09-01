/**
 * In-Memory Market Data Cache & Request Deduplication
 * Reuses valid cached market data to protect provider rate limits and prevent duplicate parallel calls.
 */

import { NormalizedTicker, NormalizedCandle } from './types.js';
import { serverConfig } from '../config.js';
import { logger } from '../logger.js';

const getEnvInt = (key: string, defaultValue: number): number => {
  const val = process.env[key];
  return val ? parseInt(val, 10) : defaultValue;
};

// Configurable Freshness Windows (TTLs in milliseconds)
export const CACHE_TTL = {
  SYMBOL_METADATA: getEnvInt('CACHE_TTL_SYMBOL_METADATA', 24 * 60 * 60 * 1000),      // 24 hours
  TRADING_STATUS: getEnvInt('CACHE_TTL_TRADING_STATUS', 2 * 60 * 60 * 1000),         // 2 hours (1-6h)
  LATEST_PRICE: getEnvInt('CACHE_TTL_LATEST_PRICE', 60 * 1000),                      // 1 minute (1-3m)
  STATISTICS_24H: getEnvInt('CACHE_TTL_24H_STATS', 10 * 60 * 1000),                  // 10 minutes (5-15m)
  VOLUME: getEnvInt('CACHE_TTL_VOLUME', 10 * 60 * 1000),                             // 10 minutes (5-15m)
  VOLATILITY_STATE: getEnvInt('CACHE_TTL_VOLATILITY_STATE', 10 * 60 * 1000),         // 10 minutes (5-15m)
  TREND_STATE: getEnvInt('CACHE_TTL_TREND_STATE', 10 * 60 * 1000),                   // 10 minutes (5-15m)
  INDICATORS: getEnvInt('CACHE_TTL_INDICATORS', 10 * 60 * 1000),                     // 10 minutes (5-15m)
  LAST_SCAN_TIMESTAMP: getEnvInt('CACHE_TTL_LAST_SCAN', 60 * 60 * 1000),             // 1 hour
  PREVIOUS_SCORE: getEnvInt('CACHE_TTL_PREV_SCORE', 10 * 60 * 1000),                 // 10 minutes (5-15m)
  PREVIOUS_DIRECTION: getEnvInt('CACHE_TTL_PREV_DIRECTION', 10 * 60 * 1000),         // 10 minutes (5-15m)
  MARKET_SESSION_STATUS: getEnvInt('CACHE_TTL_MARKET_SESSION_STATUS', 2 * 60 * 60 * 1000), // 2 hours (1-6h)
  CANDLES_1M: getEnvInt('CACHE_TTL_CANDLES_1M', 2 * 60 * 1000),                      // 2 minutes (1-3m)
  CANDLES_5M: getEnvInt('CACHE_TTL_CANDLES_5M', 5 * 60 * 1000),                      // 5 minutes
  CANDLES_15M: getEnvInt('CACHE_TTL_CANDLES_15M', 15 * 60 * 1000),                    // 15 minutes
  CANDLES_1H: getEnvInt('CACHE_TTL_CANDLES_1H', 60 * 60 * 1000),                     // 1 hour
  CANDLES_4H: getEnvInt('CACHE_TTL_CANDLES_4H', 4 * 60 * 60 * 1000),                  // 4 hours
};

export interface ExternalRequestRecord {
  provider: string;
  endpoint: string;
  asset: string;
  timestamp: number;
  reason: string;
}

export class ExternalRequestRegistry {
  private records: ExternalRequestRecord[] = [];

  record(provider: string, endpoint: string, asset: string, reason: string): void {
    const timestamp = Date.now();
    const entry: ExternalRequestRecord = { provider, endpoint, asset, timestamp, reason };
    this.records.push(entry);
    logger.info(`[External Request Logged] Provider: ${provider}, Endpoint: ${endpoint}, Asset: ${asset}, Reason: ${reason}`);
  }

  getRecords(): ExternalRequestRecord[] {
    return this.records;
  }

  clear(): void {
    this.records = [];
  }
}

export const requestRegistry = new ExternalRequestRegistry();

interface CacheEntry {
  ticker: NormalizedTicker;
  expiresAt: number;
}

interface CandleCacheEntry {
  candles: NormalizedCandle[];
  expiresAt: number;
}

interface GenericCacheEntry {
  value: any;
  expiresAt: number;
}

export class MarketDataCache {
  private cache = new Map<string, CacheEntry>();
  private candleCache = new Map<string, CandleCacheEntry>();
  private genericCache = new Map<string, GenericCacheEntry>();
  private pendingRequests = new Map<string, Promise<NormalizedTicker>>();
  private pendingCandleRequests = new Map<string, Promise<NormalizedCandle[]>>();
  private hitsCount = 0;
  private missesCount = 0;

  public getStats(): { hits: number; misses: number; cachedEntries: number } {
    return {
      hits: this.hitsCount,
      misses: this.missesCount,
      cachedEntries: this.cache.size + this.candleCache.size,
    };
  }

  public getCachedSymbolsCount(universeSymbols: string[]): number {
    let count = 0;
    const now = Date.now();
    for (const sym of universeSymbols) {
      const clean = sym.toUpperCase();
      let found = false;
      for (const [key, entry] of this.cache.entries()) {
        if (key.includes(clean) && now <= entry.expiresAt) {
          found = true;
          break;
        }
      }
      if (found) count++;
    }
    return count;
  }

  private getCacheKey(provider: string, symbol: string): string {
    return `${provider.toLowerCase()}:${symbol.toUpperCase()}`;
  }

  private getCandleCacheKey(provider: string, symbol: string, timeframe: string): string {
    return `${provider.toLowerCase()}:${symbol.toUpperCase()}:${timeframe.toLowerCase()}`;
  }

  get(provider: string, symbol: string): NormalizedTicker | null {
    const key = this.getCacheKey(provider, symbol);
    const entry = this.cache.get(key);

    if (!entry) {
      this.missesCount++;
      logger.info(`[Cache MISS] Ticker key: ${key}`);
      return null;
    }

    const now = Date.now();
    if (now > entry.expiresAt) {
      this.missesCount++;
      logger.info(`[Cache STALE/MISS] Ticker key: ${key}`);
      this.cache.delete(key);
      return null;
    }

    const maxAgeMs = serverConfig.getConfig().marketDataMaxAgeMs;
    const ageMs = now - entry.ticker.receivedAt;
    const isFresh = (ageMs <= maxAgeMs) && entry.ticker.status === 'OK' && entry.ticker.price > 0;

    if (!isFresh) {
      this.missesCount++;
      logger.info(`[Cache STALE/MISS] Ticker key: ${key} (Not fresh)`);
      this.cache.delete(key);
      return null;
    }

    this.hitsCount++;
    logger.info(`[Cache HIT] Ticker key: ${key}`);
    return {
      ...entry.ticker,
      source: 'CACHE',
      isFresh: true,
      status: 'OK',
    };
  }

  set(provider: string, symbol: string, ticker: NormalizedTicker, ttlMs: number): void {
    if (ticker.status !== 'OK' || !ticker.price || isNaN(ticker.price) || ticker.price <= 0) {
      return; // Never cache failed or invalid tickers
    }
    const key = this.getCacheKey(provider, symbol);
    this.cache.set(key, {
      ticker: {
        ...ticker,
        source: 'LIVE',
      },
      expiresAt: Date.now() + ttlMs,
    });
    logger.info(`[Cache SET] Ticker key: ${key}, TTL: ${ttlMs}ms`);
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
      logger.info(`[Cache IN-FLIGHT HIT] Ticker key: ${key}`);
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

    if (!entry) {
      logger.info(`[Cache MISS] Candles key: ${key}`);
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      logger.info(`[Cache STALE/MISS] Candles key: ${key}`);
      this.candleCache.delete(key);
      return null;
    }

    logger.info(`[Cache HIT] Candles key: ${key}`);
    return entry.candles;
  }

  getExpiredCandles(provider: string, symbol: string, timeframe: string): NormalizedCandle[] | null {
    const key = this.getCandleCacheKey(provider, symbol, timeframe);
    const entry = this.candleCache.get(key);
    return entry ? entry.candles : null;
  }

  setCandles(provider: string, symbol: string, timeframe: string, candles: NormalizedCandle[], ttlMs: number): void {
    const key = this.getCandleCacheKey(provider, symbol, timeframe);
    this.candleCache.set(key, {
      candles,
      expiresAt: Date.now() + ttlMs,
    });
    logger.info(`[Cache SET] Candles key: ${key}, TTL: ${ttlMs}ms`);
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
      logger.info(`[Cache IN-FLIGHT HIT] Candles key: ${key}`);
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

  // --- Generic Caching Methods (for custom scanner fields) ---

  getGeneric<T>(key: string): T | null {
    const entry = this.genericCache.get(key);
    if (!entry) {
      logger.info(`[Cache MISS] Generic key: ${key}`);
      return null;
    }
    const now = Date.now();
    if (now > entry.expiresAt) {
      logger.info(`[Cache STALE/MISS] Generic key: ${key}`);
      this.genericCache.delete(key);
      return null;
    }
    logger.info(`[Cache HIT] Generic key: ${key}`);
    return entry.value as T;
  }

  setGeneric(key: string, value: any, ttlMs: number): void {
    if (value === undefined || value === null) return;
    this.genericCache.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
    });
    logger.info(`[Cache SET] Generic key: ${key}, TTL: ${ttlMs}ms`);
  }

  /**
   * Clears live ticker quotes cache while keeping HTF candles intact.
   */
  clearTickers(): void {
    this.cache.clear();
    this.pendingRequests.clear();
  }

  /**
   * Clears expired ticker and candle cache entries based on their individual TTLs.
   */
  clearExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
      }
    }
    for (const [key, entry] of this.candleCache.entries()) {
      if (now > entry.expiresAt) {
        this.candleCache.delete(key);
      }
    }
    for (const [key, entry] of this.genericCache.entries()) {
      if (now > entry.expiresAt) {
        this.genericCache.delete(key);
      }
    }
  }

  clear(): void {
    this.cache.clear();
    this.candleCache.clear();
    this.genericCache.clear();
    this.pendingRequests.clear();
    this.pendingCandleRequests.clear();
  }
}

export const marketCache = new MarketDataCache();
