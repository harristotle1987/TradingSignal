/**
 * Centralized Market Data Manager
 * Single source of truth for all market data requests across Bitget, Finnhub, Twelve Data, and Forex APIs.
 *
 * Responsibilities:
 * - Provider selection
 * - Symbol normalization
 * - Price & Candle fetching
 * - Response validation & Freshness checks
 * - Server-side caching (TTL) & In-flight Request Deduplication
 * - Timeout handling & Error isolation
 */

import { IMarketDataProvider } from './adapters/IMarketDataProvider.js';
import { BitgetAdapter } from './adapters/BitgetAdapter.js';
import { FinnhubAdapter } from './adapters/FinnhubAdapter.js';
import { TwelveDataAdapter } from './adapters/TwelveDataAdapter.js';
import { NormalizedTicker, NormalizedCandle, MarketStatusResponse, ProviderHealth } from './types.js';
import { SymbolNormalizer } from './SymbolNormalizer.js';
import { marketCache } from './CacheStore.js';
import { quotaManager } from './QuotaManager.js';
import { serverConfig } from '../config.js';
import { logger } from '../logger.js';

class ProviderRequestQueue {
  private lastCallTime = new Map<string, number>();
  private providerQueues = new Map<string, Promise<any>>();

  // Minimum spacing in ms between outbound network requests per provider
  private minSpacingMs: Record<string, number> = {
    twelvedata: 1200, // Twelve Data limit: 8 req/min (spaced safely)
    finnhub: 400,     // Finnhub limit: 30 req/min
    bitget: 100,      // Bitget limit: 100 req/min
  };

  async enqueue<T>(providerId: string, fn: () => Promise<T>): Promise<T> {
    const cleanId = providerId.toLowerCase();
    const spacing = this.minSpacingMs[cleanId] || 100;

    const previousPromise = this.providerQueues.get(cleanId) || Promise.resolve();

    const currentPromise = previousPromise
      .then(async () => {
        const last = this.lastCallTime.get(cleanId) || 0;
        const elapsed = Date.now() - last;
        if (elapsed < spacing) {
          await new Promise((res) => setTimeout(res, spacing - elapsed));
        }
        this.lastCallTime.set(cleanId, Date.now());
        return fn();
      })
      .catch(async (err) => {
        this.lastCallTime.set(cleanId, Date.now());
        throw err;
      });

    this.providerQueues.set(cleanId, currentPromise.catch(() => {}));
    return currentPromise;
  }
}

const providerQueue = new ProviderRequestQueue();

export class MarketDataManager {
  private providers = new Map<string, IMarketDataProvider>();

  constructor() {
    this.registerProvider(new BitgetAdapter());
    this.registerProvider(new FinnhubAdapter());
    this.registerProvider(new TwelveDataAdapter());
  }

  private registerProvider(provider: IMarketDataProvider): void {
    this.providers.set(provider.id.toLowerCase(), provider);
  }

  getProvider(id: string): IMarketDataProvider | undefined {
    return this.providers.get(id.toLowerCase());
  }

  /**
   * Enforces strict asset-class provider routing:
   * - CRYPTO -> Bitget
   * - FOREX -> Twelve Data (Authoritative)
   * - STOCKS -> Finnhub
   */
  private selectProviderForSymbol(appSymbol: string): string {
    const assetType = SymbolNormalizer.getAssetClassification(appSymbol);
    if (assetType === 'STOCK') {
      return 'finnhub';
    }
    if (assetType === 'FOREX') {
      return 'twelvedata';
    }
    // CRYPTO or other -> Bitget
    return 'bitget';
  }

  /**
   * Fetches normalized ticker price for a given symbol and optional provider.
   */
  async getPrice(appSymbol: string, requestedProvider?: string, forceFresh = false): Promise<NormalizedTicker> {
    const assetType = SymbolNormalizer.getAssetClassification(appSymbol);
    if (assetType === 'UNKNOWN') {
      return {
        symbol: SymbolNormalizer.normalizeAppSymbol(appSymbol),
        rawSymbol: appSymbol,
        provider: requestedProvider || 'unknown',
        assetType: 'UNKNOWN',
        bid: null,
        ask: null,
        price: 0,
        timestamp: 0,
        receivedAt: Date.now(),
        source: 'LIVE',
        isFresh: false,
        status: 'MARKET_DATA_UNAVAILABLE',
        errorMessage: 'ASSET_NOT_SUPPORTED',
      };
    }

    const cleanSymbol = SymbolNormalizer.normalizeAppSymbol(appSymbol);
    if (!cleanSymbol) {
      return {
        symbol: '',
        rawSymbol: '',
        provider: requestedProvider || 'unknown',
        assetType: 'UNKNOWN',
        bid: null,
        ask: null,
        price: 0,
        timestamp: 0,
        receivedAt: Date.now(),
        source: 'LIVE',
        isFresh: false,
        status: 'MARKET_DATA_UNAVAILABLE',
        errorMessage: 'Invalid or empty symbol parameter',
      };
    }

    let providerId = (requestedProvider || this.selectProviderForSymbol(appSymbol)).toLowerCase();
    if (providerId === 'forex') {
      providerId = 'twelvedata'; // Twelve Data is the authoritative Forex market data source
    }

    const adapter = this.getProvider(providerId);

    if (!adapter) {
      return {
        symbol: cleanSymbol,
        rawSymbol: cleanSymbol,
        provider: providerId,
        assetType,
        bid: null,
        ask: null,
        price: 0,
        timestamp: 0,
        receivedAt: Date.now(),
        source: 'LIVE',
        isFresh: false,
        status: 'MARKET_DATA_UNAVAILABLE',
        errorMessage: `Provider '${providerId}' is not registered or supported`,
      };
    }

    const normalizeError = (ticker: NormalizedTicker): NormalizedTicker => {
      if (ticker.status === 'MARKET_DATA_UNAVAILABLE') {
        const msg = ticker.errorMessage?.toLowerCase() || '';
        const isQuota = msg.includes('429') || msg.includes('rate limit') || msg.includes('quota') || msg.includes('blocked');
        const isConn = msg.includes('connection') || msg.includes('timeout') || msg.includes('failed') || msg.includes('network');
        const isKey = msg.includes('key') || msg.includes('configure') || msg.includes('unauthorized') || msg.includes('credential');
        if (!isQuota && !isConn && !isKey) {
          ticker.errorMessage = 'ASSET_NOT_SUPPORTED';
        }
      }
      return ticker;
    };

    const cacheTtlMs = serverConfig.getConfig().marketDataCacheTtlMs;

    const isCritical = forceFresh;
    if (!quotaManager.canMakeRequest(providerId, isCritical)) {
      const cached = marketCache.get(providerId, cleanSymbol);
      if (cached) {
        logger.info(`Quota manager blocked live request; returning cached ticker for ${cleanSymbol}`);
        return cached;
      }
      return normalizeError({
        symbol: cleanSymbol,
        rawSymbol: cleanSymbol,
        provider: providerId,
        assetType,
        bid: null,
        ask: null,
        price: 0,
        timestamp: 0,
        receivedAt: Date.now(),
        source: 'LIVE',
        isFresh: false,
        status: 'MARKET_DATA_UNAVAILABLE',
        errorMessage: `Request blocked by API Quota/Rate-limit Manager for ${providerId}`,
      });
    }

    if (forceFresh) {
      logger.info('Bypassing cache to fetch fresh live market price', { provider: providerId, symbol: cleanSymbol });
      return providerQueue.enqueue(providerId, async () => {
        quotaManager.recordRequest(providerId);
        try {
          const result = await adapter.fetchPrice(cleanSymbol);
          const success = result.status === 'OK';
          quotaManager.recordResponse(providerId, success ? 200 : (result.errorMessage?.includes('429') ? 429 : 500));
          if (success) {
            marketCache.set(providerId, cleanSymbol, result, cacheTtlMs);
          }
          return normalizeError(result);
        } catch (err: any) {
          const errMsg = String(err);
          quotaManager.recordResponse(providerId, errMsg.includes('429') || errMsg.includes('rate limit') ? 429 : 500);
          throw err;
        }
      });
    }

    return marketCache.getOrFetch(providerId, cleanSymbol, cacheTtlMs, async () => {
      logger.info('Fetching live market price from provider', { provider: providerId, symbol: cleanSymbol });
      return providerQueue.enqueue(providerId, async () => {
        quotaManager.recordRequest(providerId);
        try {
          const result = await adapter.fetchPrice(cleanSymbol);
          const success = result.status === 'OK';
          quotaManager.recordResponse(providerId, success ? 200 : (result.errorMessage?.includes('429') ? 429 : 500));
          return normalizeError(result);
        } catch (err: any) {
          const errMsg = String(err);
          quotaManager.recordResponse(providerId, errMsg.includes('429') || errMsg.includes('rate limit') ? 429 : 500);
          throw err;
        }
      });
    });
  }

  private getTimeframeTtl(timeframe: string): number {
    const tf = timeframe.toLowerCase();
    if (tf.endsWith('m') || tf.endsWith('min')) {
      const mins = parseInt(tf);
      return (isNaN(mins) ? 1 : mins) * 60 * 1000;
    }
    if (tf.endsWith('h')) {
      const hrs = parseInt(tf);
      return (isNaN(hrs) ? 1 : hrs) * 60 * 60 * 1000;
    }
    if (tf.endsWith('d') || tf.endsWith('day')) {
      const days = parseInt(tf);
      return (isNaN(days) ? 1 : days) * 24 * 60 * 60 * 1000;
    }
    return 60 * 1000;
  }

  /**
   * Fetches candles if supported by the specified provider with caching & rate-limit check.
   */
  async getCandles(appSymbol: string, requestedProvider?: string, timeframe = '1m', limit = 50, critical = false): Promise<NormalizedCandle[]> {
    const cleanSymbol = SymbolNormalizer.normalizeAppSymbol(appSymbol);
    let primaryProviderId = (requestedProvider || this.selectProviderForSymbol(cleanSymbol)).toLowerCase();
    if (primaryProviderId === 'forex') {
      primaryProviderId = 'twelvedata'; // Twelve Data is authoritative
    }

    const adapter = this.getProvider(primaryProviderId);

    if (!adapter) {
      throw new Error(`Provider '${primaryProviderId}' is not registered`);
    }

    const ttlMs = this.getTimeframeTtl(timeframe);

    return marketCache.getOrFetchCandles(primaryProviderId, cleanSymbol, timeframe, ttlMs, async () => {
      let candles: NormalizedCandle[] = [];

      if (adapter && adapter.fetchCandles) {
        if (quotaManager.canMakeRequest(primaryProviderId, critical)) {
          candles = await providerQueue.enqueue(primaryProviderId, async () => {
            quotaManager.recordRequest(primaryProviderId);
            try {
              const res = await adapter.fetchCandles!(cleanSymbol, timeframe, limit);
              quotaManager.recordResponse(primaryProviderId, 200);
              return res;
            } catch (err: any) {
              const errMsg = String(err);
              quotaManager.recordResponse(primaryProviderId, errMsg.includes('429') || errMsg.includes('rate limit') ? 429 : 500);
              logger.warn(`Primary provider '${primaryProviderId}' candle fetch failed for ${cleanSymbol} (${timeframe})`, { error: errMsg });
              return [];
            }
          });
        }
      }

      if (candles && candles.length > 0) {
        return candles;
      }

      logger.warn(`No real OHLC candle data available for ${cleanSymbol} (${timeframe}) from authoritative provider ${primaryProviderId}`);
      return [];
    });
  }

  /**
   * Tests real API connectivity for all registered providers.
   */
  async getMarketStatus(): Promise<MarketStatusResponse> {
    const healthPromises = Array.from(this.providers.values()).map((provider) =>
      provider.healthCheck()
    );

    const healthResults = await Promise.all(healthPromises);
    const providerMap: Record<string, ProviderHealth> = {};

    let connectedCount = 0;

    for (const h of healthResults) {
      providerMap[h.provider] = h;
      if (h.status === 'CONNECTED') {
        connectedCount++;
      }
    }

    let overallStatus: 'OPERATIONAL' | 'DEGRADED' | 'UNAVAILABLE' = 'UNAVAILABLE';
    if (connectedCount === healthResults.length) {
      overallStatus = 'OPERATIONAL';
    } else if (connectedCount > 0) {
      overallStatus = 'DEGRADED';
    }

    return {
      timestamp: new Date().toISOString(),
      gate: 'GATE_2_REAL_MARKET_DATA',
      providers: providerMap,
      overallStatus,
    };
  }
}

export const marketDataManager = new MarketDataManager();
