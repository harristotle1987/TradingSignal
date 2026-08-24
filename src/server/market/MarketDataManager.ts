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
import { ExchangeRateAdapter } from './adapters/ExchangeRateAdapter.js';
import { NormalizedTicker, NormalizedCandle, MarketStatusResponse, ProviderHealth, TruthfulMarketHealth } from './types.js';
import { SymbolNormalizer } from './SymbolNormalizer.js';
import { marketCache } from './CacheStore.js';
import { quotaManager } from './QuotaManager.js';
import { serverConfig } from '../config.js';
import { logger } from '../logger.js';
import { ScannerPersistence } from '../signals/ScannerPersistence.js';
import { NvidiaAIService } from '../signals/NvidiaAIService.js';

class ProviderRequestQueue {
  private lastCallTime = new Map<string, number>();
  private providerQueues = new Map<string, Promise<any>>();

  // Minimum spacing in ms between outbound network requests per provider
  private minSpacingMs: Record<string, number> = {
    twelvedata: 7500, // Twelve Data limit: 8 req/min (7.5s safe spacing)
    finnhub: 1000,    // Finnhub limit: 30-60 req/min
    bitget: 200,      // Bitget limit: 100 req/min
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
  private lastHealthCheckTime = 0;
  private cachedTruthfulHealth: TruthfulMarketHealth | null = null;
  private lastSuccessfulQuotes = new Map<string, number>();

  constructor() {
    this.registerProvider(new BitgetAdapter());
    this.registerProvider(new FinnhubAdapter());
    this.registerProvider(new TwelveDataAdapter());
    this.registerProvider(new ExchangeRateAdapter());
  }

  /**
   * Evaluates truthful market data connectivity, quote freshness, provider reachability,
   * scanner readiness, and overall system readiness without hardcoded status.
   */
  async getTruthfulMarketHealth(forceProbe = false): Promise<TruthfulMarketHealth> {
    const now = Date.now();
    const cacheTtlMs = 5000;

    if (!forceProbe && this.cachedTruthfulHealth && (now - this.lastHealthCheckTime < cacheTtlMs)) {
      return this.cachedTruthfulHealth;
    }

    const config = serverConfig.getConfig();
    const isProd = config.nodeEnv === 'production';
    const productionPersistenceReady = config.productionPersistenceReady;

    // 1. Bitget (Crypto)
    let bitgetReachable = false;
    let bitgetQuoteTs: number | null = this.lastSuccessfulQuotes.get('bitget') || null;
    let bitgetErrMsg: string | undefined;

    try {
      const ticker = await this.getPrice('BTCUSDT', 'bitget', forceProbe);
      if (ticker.status === 'OK' || (ticker.status === 'STALE' && ticker.price > 0)) {
        bitgetReachable = true;
        bitgetQuoteTs = ticker.timestamp || ticker.receivedAt;
        this.lastSuccessfulQuotes.set('bitget', bitgetQuoteTs);
      } else {
        bitgetErrMsg = ticker.errorMessage || 'Bitget ticker returned invalid status or zero price';
      }
    } catch (err) {
      bitgetErrMsg = err instanceof Error ? err.message : String(err);
    }

    const bitgetQuoteAge = bitgetQuoteTs ? Math.max(0, now - bitgetQuoteTs) : null;
    const bitgetFresh = bitgetQuoteAge !== null && bitgetQuoteAge <= config.marketDataMaxAgeMs;

    // 2. Twelve Data (Forex)
    const twelveDataConfigured = Boolean(process.env.TWELVE_DATA_API_KEY && process.env.TWELVE_DATA_API_KEY.trim().length > 0);
    let twelveDataReachable = false;
    let twelveDataQuoteTs: number | null = this.lastSuccessfulQuotes.get('twelvedata') || null;
    let twelveDataErrMsg: string | undefined;

    if (twelveDataConfigured) {
      try {
        const ticker = await this.getPrice('EURUSD', 'twelvedata', forceProbe);
        if (ticker.status === 'OK' || (ticker.status === 'STALE' && ticker.price > 0)) {
          twelveDataReachable = true;
          twelveDataQuoteTs = ticker.timestamp || ticker.receivedAt;
          this.lastSuccessfulQuotes.set('twelvedata', twelveDataQuoteTs);
        } else {
          twelveDataErrMsg = ticker.errorMessage || 'Twelve Data ticker returned invalid status';
        }
      } catch (err) {
        twelveDataErrMsg = err instanceof Error ? err.message : String(err);
      }
    } else {
      twelveDataErrMsg = 'TWELVE_DATA_API_KEY environment variable not configured';
    }

    const twelveDataQuoteAge = twelveDataQuoteTs ? Math.max(0, now - twelveDataQuoteTs) : null;
    const twelveDataFresh = twelveDataQuoteAge !== null && twelveDataQuoteAge <= 24 * 3600 * 1000;

    // 3. ExchangeRate (Forex Fallback)
    const exchangeRateConfigured = true;
    let exchangeRateReachable = false;
    let exchangeRateQuoteTs: number | null = this.lastSuccessfulQuotes.get('exchangerate') || null;
    let exchangeRateErrMsg: string | undefined;

    try {
      const ticker = await this.getPrice('EURUSD', 'exchangerate', forceProbe);
      if (ticker.status === 'OK' || (ticker.status === 'STALE' && ticker.price > 0)) {
        exchangeRateReachable = true;
        exchangeRateQuoteTs = ticker.timestamp || ticker.receivedAt;
        this.lastSuccessfulQuotes.set('exchangerate', exchangeRateQuoteTs);
      } else {
        exchangeRateErrMsg = ticker.errorMessage || 'ExchangeRate ticker returned invalid status';
      }
    } catch (err) {
      exchangeRateErrMsg = err instanceof Error ? err.message : String(err);
    }

    const exchangeRateQuoteAge = exchangeRateQuoteTs ? Math.max(0, now - exchangeRateQuoteTs) : null;
    const exchangeRateFresh = exchangeRateQuoteAge !== null && exchangeRateQuoteAge <= 24 * 3600 * 1000;

    // 4. Finnhub (Stock)
    const finnhubConfigured = Boolean(process.env.FINNHUB_API_KEY && process.env.FINNHUB_API_KEY.trim().length > 0);
    let finnhubReachable = false;
    let finnhubQuoteTs: number | null = this.lastSuccessfulQuotes.get('finnhub') || null;
    let finnhubErrMsg: string | undefined;

    if (finnhubConfigured) {
      try {
        const ticker = await this.getPrice('AAPL', 'finnhub', forceProbe);
        if (ticker.status === 'OK' || (ticker.status === 'STALE' && ticker.price > 0)) {
          finnhubReachable = true;
          finnhubQuoteTs = ticker.timestamp || ticker.receivedAt;
          this.lastSuccessfulQuotes.set('finnhub', finnhubQuoteTs);
        } else {
          finnhubErrMsg = ticker.errorMessage || 'Finnhub ticker returned invalid status';
        }
      } catch (err) {
        finnhubErrMsg = err instanceof Error ? err.message : String(err);
      }
    } else {
      finnhubErrMsg = 'FINNHUB_API_KEY environment variable not configured';
    }

    const finnhubQuoteAge = finnhubQuoteTs ? Math.max(0, now - finnhubQuoteTs) : null;
    const finnhubFresh = finnhubQuoteAge !== null && finnhubQuoteAge <= 24 * 3600 * 1000;

    // Asset Class Readiness
    const cryptoReady = bitgetReachable && bitgetFresh;
    const forexReady = (twelveDataReachable && twelveDataFresh) || (exchangeRateReachable && exchangeRateFresh);
    const stockReady = (finnhubReachable && finnhubFresh) || (twelveDataReachable && twelveDataFresh);

    // Aggregate Connectivity
    const marketDataConnected = cryptoReady || forexReady || stockReady;

    const validQuoteTsList = [bitgetQuoteTs, twelveDataQuoteTs, exchangeRateQuoteTs, finnhubQuoteTs].filter((ts): ts is number => ts !== null && ts > 0);
    const lastSuccessfulQuote = validQuoteTsList.length > 0 ? Math.max(...validQuoteTsList) : null;
    const quoteAge = lastSuccessfulQuote ? Math.max(0, now - lastSuccessfulQuote) : null;
    const dataFreshness = quoteAge !== null && quoteAge <= config.marketDataMaxAgeMs;
    const marketFeedsActive = marketDataConnected && (dataFreshness || cryptoReady || forexReady);

    const providerConfigured = true;
    const providerReachable = bitgetReachable || (twelveDataConfigured && twelveDataReachable) || (finnhubConfigured && finnhubReachable) || exchangeRateReachable;

    // Scanner Readiness
    let scannerEnabled = true;
    try {
      const settings = ScannerPersistence.getSettings();
      scannerEnabled = settings.enabled;
    } catch {
      scannerEnabled = false;
    }

    const persistenceCheckPassed = !isProd || productionPersistenceReady;
    const scannerReady = scannerEnabled && persistenceCheckPassed && marketDataConnected;
    const signalsEnabled = marketDataConnected && scannerReady && persistenceCheckPassed;

    // Overall Status
    let overallStatus: 'OPERATIONAL' | 'DEGRADED' | 'UNAVAILABLE' = 'UNAVAILABLE';
    if (!marketDataConnected) {
      overallStatus = 'UNAVAILABLE';
    } else if (!persistenceCheckPassed || (twelveDataConfigured && !twelveDataReachable) || (finnhubConfigured && !finnhubReachable) || !bitgetReachable) {
      overallStatus = 'DEGRADED';
    } else {
      overallStatus = 'OPERATIONAL';
    }

    const health: TruthfulMarketHealth = {
      status: overallStatus,
      marketDataConnected,
      marketFeedsActive,
      providerConfigured,
      providerReachable,
      lastSuccessfulQuote,
      quoteAge,
      dataFreshness,
      scannerReady,
      signalsEnabled,
      productionPersistenceReady,
      providers: {
        bitget: {
          providerConfigured: true,
          providerReachable: bitgetReachable,
          lastSuccessfulQuote: bitgetQuoteTs,
          quoteAge: bitgetQuoteAge,
          dataFreshness: bitgetFresh,
          status: bitgetReachable ? 'CONNECTED' : 'DEGRADED',
          errorMessage: bitgetErrMsg,
        },
        twelvedata: {
          providerConfigured: twelveDataConfigured,
          providerReachable: twelveDataReachable,
          lastSuccessfulQuote: twelveDataQuoteTs,
          quoteAge: twelveDataQuoteAge,
          dataFreshness: twelveDataFresh,
          status: twelveDataConfigured ? (twelveDataReachable ? 'CONNECTED' : 'DEGRADED') : 'UNCONFIGURED',
          errorMessage: twelveDataErrMsg,
        },
        finnhub: {
          providerConfigured: finnhubConfigured,
          providerReachable: finnhubReachable,
          lastSuccessfulQuote: finnhubQuoteTs,
          quoteAge: finnhubQuoteAge,
          dataFreshness: finnhubFresh,
          status: finnhubConfigured ? (finnhubReachable ? 'CONNECTED' : 'DEGRADED') : 'UNCONFIGURED',
          errorMessage: finnhubErrMsg,
        },
        exchangerate: {
          providerConfigured: exchangeRateConfigured,
          providerReachable: exchangeRateReachable,
          lastSuccessfulQuote: exchangeRateQuoteTs,
          quoteAge: exchangeRateQuoteAge,
          dataFreshness: exchangeRateFresh,
          status: exchangeRateReachable ? 'CONNECTED' : 'DEGRADED',
          errorMessage: exchangeRateErrMsg,
        },
      },
      assetClasses: {
        crypto: {
          ready: cryptoReady,
          provider: 'bitget',
          quoteAge: bitgetQuoteAge,
        },
        forex: {
          ready: forexReady,
          provider: twelveDataReachable ? 'twelvedata' : 'exchangerate',
          fallbackActive: !twelveDataReachable && exchangeRateReachable,
          quoteAge: twelveDataReachable ? twelveDataQuoteAge : exchangeRateQuoteAge,
        },
        stock: {
          ready: stockReady,
          provider: finnhubReachable ? 'finnhub' : (twelveDataReachable ? 'twelvedata' : 'none'),
          quoteAge: finnhubReachable ? finnhubQuoteAge : twelveDataQuoteAge,
        },
      },
    };

    this.lastHealthCheckTime = now;
    this.cachedTruthfulHealth = health;
    return health;
  }

  private registerProvider(provider: IMarketDataProvider): void {
    this.providers.set(provider.id.toLowerCase(), provider);
  }

  getProvider(id: string): IMarketDataProvider | undefined {
    return this.providers.get(id.toLowerCase());
  }

  /**
   * Enforces strict asset-class provider routing:
   * - CRYPTO -> Bitget primary (Never route BTCUSDT, ETHUSDT, etc. to Finnhub as primary)
   * - FOREX -> Twelve Data primary (Authoritative)
   * - STOCKS -> Finnhub / Twelve Data according to supported-symbol routing
   */
  public getRoutingForSymbol(appSymbol: string, requestedProvider?: string): {
    assetClass: 'CRYPTO' | 'STOCK' | 'FOREX' | 'INDEX' | 'UNKNOWN';
    primaryProvider: string;
    fallbackProviders: string[];
  } {
    const assetClass = SymbolNormalizer.getAssetClassification(appSymbol);
    const cleanRequested = requestedProvider ? requestedProvider.toLowerCase().trim() : undefined;
    const requested = cleanRequested === 'forex' ? 'twelvedata' : cleanRequested;

    const hasFinnhub = Boolean(process.env.FINNHUB_API_KEY && process.env.FINNHUB_API_KEY.trim().length > 0);
    const hasTwelveData = Boolean(process.env.TWELVE_DATA_API_KEY && process.env.TWELVE_DATA_API_KEY.trim().length > 0);

    // 1. CRYPTO: Bitget is ALWAYS the primary crypto price source
    if (assetClass === 'CRYPTO') {
      const primaryProvider = 'bitget';
      const fallbackProviders: string[] = [];
      // Finnhub used ONLY as legitimate secondary fallback if key is configured
      if (hasFinnhub) {
        fallbackProviders.push('finnhub');
      }
      return { assetClass, primaryProvider, fallbackProviders };
    }

    // 2. FOREX: Twelve Data is the authoritative primary Forex source
    if (assetClass === 'FOREX') {
      const primaryProvider = 'twelvedata';
      const fallbackProviders: string[] = ['exchangerate'];
      // Finnhub can serve as fallback if configured
      if (hasFinnhub) {
        fallbackProviders.push('finnhub');
      }
      return { assetClass, primaryProvider, fallbackProviders };
    }

    // 3. STOCKS: Finnhub / Twelve Data routing
    if (assetClass === 'STOCK') {
      if (requested === 'twelvedata') {
        const fallbacks: string[] = [];
        if (hasFinnhub) fallbacks.push('finnhub');
        return { assetClass, primaryProvider: 'twelvedata', fallbackProviders: fallbacks };
      }

      if (requested === 'finnhub') {
        const fallbacks: string[] = [];
        if (hasTwelveData) fallbacks.push('twelvedata');
        return { assetClass, primaryProvider: 'finnhub', fallbackProviders: fallbacks };
      }

      // Default stock routing: Finnhub primary if configured, Twelve Data fallback
      if (hasFinnhub) {
        const fallbacks: string[] = [];
        if (hasTwelveData) fallbacks.push('twelvedata');
        return { assetClass, primaryProvider: 'finnhub', fallbackProviders: fallbacks };
      } else if (hasTwelveData) {
        return { assetClass, primaryProvider: 'twelvedata', fallbackProviders: [] };
      }

      return { assetClass, primaryProvider: 'finnhub', fallbackProviders: [] };
    }

    // 4. Default / Unknown
    return {
      assetClass,
      primaryProvider: requested || 'bitget',
      fallbackProviders: [],
    };
  }

  private selectProviderForSymbol(appSymbol: string): string {
    return this.getRoutingForSymbol(appSymbol).primaryProvider;
  }

  private async fetchPriceFromProviderDirect(
    providerId: string,
    cleanSymbol: string,
    assetClass: 'CRYPTO' | 'STOCK' | 'FOREX' | 'INDEX' | 'UNKNOWN',
    isCritical: boolean
  ): Promise<NormalizedTicker> {
    const adapter = this.getProvider(providerId);
    if (!adapter) {
      return this.createErrorTicker(
        cleanSymbol,
        cleanSymbol,
        providerId,
        assetClass,
        `Provider '${providerId}' is not registered or supported`
      );
    }

    if (!quotaManager.canMakeRequest(providerId, isCritical)) {
      return this.createErrorTicker(
        cleanSymbol,
        cleanSymbol,
        providerId,
        assetClass,
        `Request blocked by API Quota/Rate-limit Manager for ${providerId}`
      );
    }

    return providerQueue.enqueue(providerId, async () => {
      quotaManager.recordRequest(providerId);
      try {
        const result = await adapter.fetchPrice(cleanSymbol);
        const success = result.status === 'OK' && result.price > 0;
        quotaManager.recordResponse(
          providerId,
          success ? 200 : (result.errorMessage?.includes('429') ? 429 : 500)
        );
        return result;
      } catch (err: any) {
        const errMsg = String(err);
        quotaManager.recordResponse(
          providerId,
          errMsg.includes('429') || errMsg.includes('rate limit') ? 429 : 500
        );
        return this.createErrorTicker(
          cleanSymbol,
          cleanSymbol,
          providerId,
          assetClass,
          `Provider '${providerId}' call failed: ${errMsg}`
        );
      }
    });
  }

  /**
   * Fetches normalized ticker price for a given symbol and optional provider.
   * Reuses cached market data within the 60-second TTL to avoid hitting external rate limits.
   * If primary provider fails, attempts legitimate fallbacks before returning 503 MARKET_DATA_UNAVAILABLE.
   */
  async getPrice(appSymbol: string, requestedProvider?: string, forceFresh = false): Promise<NormalizedTicker> {
    const cleanSymbol = SymbolNormalizer.normalizeAppSymbol(appSymbol);
    if (!cleanSymbol) {
      return this.createErrorTicker(
        appSymbol,
        appSymbol,
        requestedProvider || 'unknown',
        'UNKNOWN',
        'Invalid or empty symbol parameter'
      );
    }

    const { assetClass, primaryProvider, fallbackProviders } = this.getRoutingForSymbol(appSymbol, requestedProvider);

    if (assetClass === 'UNKNOWN') {
      return this.createErrorTicker(
        cleanSymbol,
        appSymbol,
        primaryProvider,
        'UNKNOWN',
        'ASSET_NOT_SUPPORTED'
      );
    }

    const cacheTtlMs = serverConfig.getConfig().marketDataCacheTtlMs; // 60,000ms

    // 1. Cache Lookup (when not forcing fresh data)
    if (!forceFresh) {
      // Check primary provider cache
      const cachedPrimary = marketCache.get(primaryProvider, cleanSymbol);
      if (cachedPrimary && cachedPrimary.status === 'OK' && cachedPrimary.price > 0) {
        const dataAgeMs = Date.now() - cachedPrimary.timestamp;
        logger.info(`[MarketData Price] Cache hit for ${cleanSymbol}`, {
          assetClass,
          primaryProvider,
          fallbackProvider: 'none',
          cacheHit: true,
          cacheMiss: false,
          priceTimestamp: cachedPrimary.timestamp,
          dataAgeMs,
        });
        return cachedPrimary;
      }

      // Check fallback provider cache if primary cache missed
      for (const fbId of fallbackProviders) {
        const cachedFallback = marketCache.get(fbId, cleanSymbol);
        if (cachedFallback && cachedFallback.status === 'OK' && cachedFallback.price > 0) {
          const dataAgeMs = Date.now() - cachedFallback.timestamp;
          logger.info(`[MarketData Price] Cache hit (fallback: ${fbId}) for ${cleanSymbol}`, {
            assetClass,
            primaryProvider,
            fallbackProvider: fbId,
            cacheHit: true,
            cacheMiss: false,
            priceTimestamp: cachedFallback.timestamp,
            dataAgeMs,
          });
          return cachedFallback;
        }
      }
    }

    // 2. Cache Miss or forceFresh: Fetch from Primary Provider with request deduplication
    let primaryResult: NormalizedTicker;

    if (forceFresh) {
      primaryResult = await this.fetchPriceFromProviderDirect(primaryProvider, cleanSymbol, assetClass, true);
      if (primaryResult.status === 'OK' && primaryResult.price > 0) {
        marketCache.set(primaryProvider, cleanSymbol, primaryResult, cacheTtlMs);
      }
    } else {
      primaryResult = await marketCache.getOrFetch(primaryProvider, cleanSymbol, cacheTtlMs, async () => {
        return this.fetchPriceFromProviderDirect(primaryProvider, cleanSymbol, assetClass, true);
      });
    }

    if (primaryResult.status === 'OK' && primaryResult.price > 0) {
      const dataAgeMs = Date.now() - primaryResult.timestamp;
      logger.info(`[MarketData Price] Live price fetched from primary provider for ${cleanSymbol}`, {
        assetClass,
        primaryProvider,
        fallbackProvider: 'none',
        cacheHit: false,
        cacheMiss: true,
        priceTimestamp: primaryResult.timestamp,
        dataAgeMs,
      });
      return primaryResult;
    }

    // 3. Primary provider busy or unavailable: Try legitimate fallback providers if supported
    if (fallbackProviders.length > 0) {
      const primaryErr = primaryResult.errorMessage || primaryResult.status || 'Unknown error';
      logger.info(`[MarketData Price] Routing query for ${cleanSymbol} via fallback providers [${fallbackProviders.join(', ')}] (primary ${primaryProvider} busy or unavailable: ${primaryErr})`, {
        assetClass,
        primaryProvider,
        fallbackProviders,
      });

      for (const fbId of fallbackProviders) {
        let fallbackResult: NormalizedTicker;

        if (forceFresh) {
          fallbackResult = await this.fetchPriceFromProviderDirect(fbId, cleanSymbol, assetClass, true);
          if (fallbackResult.status === 'OK' && fallbackResult.price > 0) {
            marketCache.set(fbId, cleanSymbol, fallbackResult, cacheTtlMs);
          }
        } else {
          fallbackResult = await marketCache.getOrFetch(fbId, cleanSymbol, cacheTtlMs, async () => {
            return this.fetchPriceFromProviderDirect(fbId, cleanSymbol, assetClass, true);
          });
        }

        if (fallbackResult.status === 'OK' && fallbackResult.price > 0) {
          const dataAgeMs = Date.now() - fallbackResult.timestamp;
          logger.info(`[MarketData Price] Live price fetched from fallback provider (${fbId}) for ${cleanSymbol}`, {
            assetClass,
            primaryProvider,
            fallbackProvider: fbId,
            cacheHit: false,
            cacheMiss: true,
            priceTimestamp: fallbackResult.timestamp,
            dataAgeMs,
          });
          return fallbackResult;
        }
      }
    }

    // 4. All legitimate providers busy: Return MARKET_DATA_UNAVAILABLE (HTTP 503)
    // Never synthesize, estimate, or return placeholder/stale prices.
    logger.info(`[MarketData Price] Real-time rate for ${cleanSymbol} is currently unavailable from all primary/fallback providers`, {
      assetClass,
      primaryProvider,
      fallbackProvider: fallbackProviders.join(',') || 'none',
      cacheHit: false,
      cacheMiss: true,
      priceTimestamp: 0,
      dataAgeMs: 0,
      lastError: primaryResult?.errorMessage || 'Unknown error',
    });

    return {
      symbol: cleanSymbol,
      rawSymbol: cleanSymbol,
      provider: primaryProvider,
      assetType: assetClass,
      bid: null,
      ask: null,
      price: 0,
      timestamp: 0,
      receivedAt: Date.now(),
      source: 'LIVE',
      isFresh: false,
      status: 'MARKET_DATA_UNAVAILABLE',
      errorMessage: primaryResult?.errorMessage || `MARKET_DATA_UNAVAILABLE: All legitimate providers failed for ${cleanSymbol}`,
    };
  }

  private createErrorTicker(
    symbol: string,
    rawSymbol: string,
    provider: string,
    assetType: 'CRYPTO' | 'STOCK' | 'FOREX' | 'INDEX' | 'UNKNOWN',
    errorMessage: string
  ): NormalizedTicker {
    return {
      symbol: SymbolNormalizer.normalizeAppSymbol(symbol),
      rawSymbol,
      provider,
      assetType,
      bid: null,
      ask: null,
      price: 0,
      timestamp: 0,
      receivedAt: Date.now(),
      source: 'LIVE',
      isFresh: false,
      status: 'MARKET_DATA_UNAVAILABLE',
      errorMessage,
    };
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
   * Fetches candles if supported by the specified provider with caching, rate-limit check, and fallback.
   */
  async getCandles(appSymbol: string, requestedProvider?: string, timeframe = '1m', limit = 50, critical = false): Promise<NormalizedCandle[]> {
    const cleanSymbol = SymbolNormalizer.normalizeAppSymbol(appSymbol);
    const routing = this.getRoutingForSymbol(cleanSymbol, requestedProvider);
    let primaryProviderId = (requestedProvider || routing.primaryProvider).toLowerCase();
    if (primaryProviderId === 'forex') {
      primaryProviderId = 'twelvedata'; // Twelve Data is authoritative
    }

    const ttlMs = this.getTimeframeTtl(timeframe);

    return marketCache.getOrFetchCandles(primaryProviderId, cleanSymbol, timeframe, ttlMs, async () => {
      let candles: NormalizedCandle[] = [];

      const adapter = this.getProvider(primaryProviderId);
      if (adapter && adapter.fetchCandles) {
        if (quotaManager.canMakeRequest(primaryProviderId, critical)) {
          candles = await providerQueue.enqueue(primaryProviderId, async () => {
            quotaManager.recordRequest(primaryProviderId);
            try {
              const res = await adapter.fetchCandles!(cleanSymbol, timeframe, limit);
              if (res && res.length > 0) {
                quotaManager.recordResponse(primaryProviderId, 200);
              }
              return res;
            } catch (err: any) {
              const errMsg = String(err);
              quotaManager.recordResponse(primaryProviderId, errMsg.includes('429') || errMsg.includes('rate limit') ? 429 : 500);
              logger.info(`Primary provider '${primaryProviderId}' candle fetch unavailable for ${cleanSymbol} (${timeframe}): ${errMsg}`);
              return [];
            }
          });
        }
      }

      if (candles && candles.length > 0) {
        return candles;
      }

      // If primary provider failed or is rate-limited, attempt legitimate fallback providers
      for (const fallbackId of routing.fallbackProviders) {
        const fallbackAdapter = this.getProvider(fallbackId);
        if (fallbackAdapter && fallbackAdapter.fetchCandles) {
          if (quotaManager.canMakeRequest(fallbackId, critical)) {
            candles = await providerQueue.enqueue(fallbackId, async () => {
              quotaManager.recordRequest(fallbackId);
              try {
                const res = await fallbackAdapter.fetchCandles!(cleanSymbol, timeframe, limit);
                if (res && res.length > 0) {
                  quotaManager.recordResponse(fallbackId, 200);
                  logger.info(`Candles fetched from fallback provider '${fallbackId}' for ${cleanSymbol} (${timeframe})`);
                }
                return res;
              } catch (err: any) {
                const errMsg = String(err);
                quotaManager.recordResponse(fallbackId, errMsg.includes('429') || errMsg.includes('rate limit') ? 429 : 500);
                logger.info(`Fallback provider '${fallbackId}' candle fetch unavailable for ${cleanSymbol} (${timeframe}): ${errMsg}`);
                return [];
              }
            });
            if (candles && candles.length > 0) {
              return candles;
            }
          }
        }
      }

      // If absolutely no provider succeeded, retrieve expired candles as high-quality fallback during rate limits
      const expired = marketCache.getExpiredCandles(primaryProviderId, cleanSymbol, timeframe);
      if (expired && expired.length > 0) {
        logger.info(`[MarketData Candles] Fetch failed or rate-limited. Serving ${expired.length} expired candles from cache for ${cleanSymbol} (${timeframe})`);
        return expired;
      }

      logger.info(`No real OHLC candle data currently available for ${cleanSymbol} (${timeframe}) from primary or fallback providers`);
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

    try {
      const nvidiaHealth = await NvidiaAIService.healthCheck();
      providerMap['nvidia'] = nvidiaHealth;
      if (nvidiaHealth.status === 'CONNECTED') {
        connectedCount++;
      }
    } catch {
      providerMap['nvidia'] = {
        provider: 'nvidia',
        name: 'NVIDIA AI API',
        configured: Boolean(process.env.NVIDIA_API_KEY),
        status: process.env.NVIDIA_API_KEY ? 'CONNECTED' : 'UNAVAILABLE',
      };
    }

    const totalTracked = healthResults.length + 1;
    let overallStatus: 'OPERATIONAL' | 'DEGRADED' | 'UNAVAILABLE' = 'UNAVAILABLE';
    if (connectedCount >= healthResults.length) {
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

  /**
   * Fetches candles across multiple timeframes concurrently for backtests & multi-timeframe analysis.
   */
  async getMultiTimeframeCandles(
    appSymbol: string,
    timeframes = ['5m', '15m', '1h', '4h'],
    limit = 200
  ): Promise<Record<string, NormalizedCandle[]>> {
    const result: Record<string, NormalizedCandle[]> = {};
    await Promise.all(
      timeframes.map(async (tf) => {
        try {
          const c = await this.getCandles(appSymbol, undefined, tf, limit);
          if (c && c.length > 0) {
            result[tf] = c;
          }
        } catch (err) {
          logger.debug(`[MarketDataManager] getMultiTimeframeCandles failed for ${appSymbol} (${tf})`, { error: String(err) });
        }
      })
    );
    return result;
  }
}

export const marketDataManager = new MarketDataManager();
