/**
 * Centralized Market Data Manager
 * Single source of truth for all market data requests across Bitget, Finnhub, Twelve Data, Tiingo, and ExchangeRate APIs.
 *
 * Principles & Constraints:
 * 1. ZERO Pre-Scan API Activity (Gate 1): No external requests until a scan execution is explicitly activated.
 * 2. Scan Execution Context (Gate 3): Enforces active scan context check before performing provider requests.
 * 3. Cache-First Access: Checks cached market data before requesting from network.
 * 4. Scan-Level Request Deduplication: Same symbol+timeframe+limit in a scan execution context resolves to 1 provider request.
 * 5. Provider Fallback Routing & Rate Limit Protection:
 *    - FOREX: Tiingo -> Finnhub -> Twelve Data -> ExchangeRate
 *    - STOCKS: Finnhub -> Tiingo -> Twelve Data
 *    - CRYPTO: Bitget -> Finnhub -> Tiingo -> Twelve Data
 *    - Immediately fails over when 429 received.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { IMarketDataProvider } from './adapters/IMarketDataProvider.js';
import { BitgetAdapter } from './adapters/BitgetAdapter.js';
import { FinnhubAdapter } from './adapters/FinnhubAdapter.js';
import { TwelveDataAdapter } from './adapters/TwelveDataAdapter.js';
import { TiingoAdapter } from './adapters/TiingoAdapter.js';
import { ExchangeRateAdapter } from './adapters/ExchangeRateAdapter.js';
import { NormalizedTicker, NormalizedCandle, MarketStatusResponse, ProviderHealth, TruthfulMarketHealth } from './types.js';
import { SymbolNormalizer } from './SymbolNormalizer.js';
import { marketCache, requestRegistry, CACHE_TTL } from './CacheStore.js';
import { quotaManager } from './QuotaManager.js';
import { serverConfig } from '../config.js';
import { logger } from '../logger.js';
import { ScannerPersistence } from '../signals/ScannerPersistence.js';
import { NvidiaAIService } from '../signals/NvidiaAIService.js';
import { getActiveProfiler } from '../signals/ScanPerformanceProfiler.js';

export interface ScanExecutionContext {
  scanExecutionId: string;
  scanType: 'MANUAL' | 'CRON' | 'AI';
  scanStartedAt: number;
}

export interface ScanTelemetry {
  scanExecutionId: string;
  scanType: 'MANUAL' | 'CRON' | 'AI';
  scanStartedAt: number;
  providerRequests: number;
  providerSuccesses: number;
  provider429s: number;
  providerErrors: number;
  providerTimeouts: number;
  failoverCount: number;
  cacheHits: number;
  cacheMisses: number;
  apiRequestsBeforeScan: number;
}

export const scanContextStorage = new AsyncLocalStorage<ScanExecutionContext>();

class ProviderRequestQueue {
  private lastCallTime = new Map<string, number>();
  private providerQueues = new Map<string, Promise<any>>();

  // Minimum spacing in ms between outbound network requests per provider
  private minSpacingMs: Record<string, number> = {
    twelvedata: 1000,
    finnhub: 300,
    tiingo: 300,
    bitget: 100,
    exchangerate: 100,
  };

  async enqueue<T>(providerId: string, fn: () => Promise<T>, globalScanDeadlineMs?: number): Promise<T> {
    const cleanId = providerId.toLowerCase();
    const hasTwelveDataKey = Boolean(process.env.TWELVE_DATA_API_KEY && process.env.TWELVE_DATA_API_KEY.trim().length > 0);
    const spacing = cleanId === 'twelvedata' && !hasTwelveDataKey ? 0 : (this.minSpacingMs[cleanId] || 100);

    const safetyMargin = 100;
    if (globalScanDeadlineMs) {
      const remaining = globalScanDeadlineMs - Date.now();
      if (remaining <= safetyMargin) {
        throw new Error(`TIMEOUT: Global scanner deadline reached during queue wait for ${providerId}`);
      }
    }

    const previousPromise = this.providerQueues.get(cleanId) || Promise.resolve();

    const currentPromise = previousPromise
      .then(async () => {
        if (globalScanDeadlineMs) {
          const remaining = globalScanDeadlineMs - Date.now();
          if (remaining <= safetyMargin) {
            throw new Error(`TIMEOUT: Global scanner deadline reached during queue wait for ${providerId}`);
          }
        }
        const last = this.lastCallTime.get(cleanId) || 0;
        const elapsed = Date.now() - last;
        if (elapsed < spacing) {
          const sleepTime = spacing - elapsed;
          if (globalScanDeadlineMs && (Date.now() + sleepTime > globalScanDeadlineMs - safetyMargin)) {
            throw new Error(`TIMEOUT: Global scanner deadline would be reached during pacing delay for ${providerId}`);
          }
          await new Promise((res) => setTimeout(res, sleepTime));
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

  // Scan context and telemetry management
  private explicitScanContext: ScanExecutionContext | null = null;
  private preScanApiAttempts = 0;
  private scanTelemetryMap = new Map<string, ScanTelemetry>();
  private inFlightScanRequests = new Map<string, Promise<any>>();
  private scanRateLimitedProviders = new Map<string, Set<string>>();

  constructor() {
    this.registerProvider(new BitgetAdapter());
    this.registerProvider(new FinnhubAdapter());
    this.registerProvider(new TwelveDataAdapter());
    this.registerProvider(new TiingoAdapter());
    this.registerProvider(new ExchangeRateAdapter());
  }

  // --- Scan Context Activation & Tracking Methods ---

  public startScanContext(context: ScanExecutionContext): void {
    this.explicitScanContext = context;
    this.getOrCreateTelemetry(context);
  }

  public endScanContext(scanExecutionId?: string): void {
    if (!scanExecutionId || this.explicitScanContext?.scanExecutionId === scanExecutionId) {
      this.explicitScanContext = null;
    }
  }

  public runInScanContext<T>(context: ScanExecutionContext, fn: () => Promise<T>): Promise<T> {
    this.startScanContext(context);
    return scanContextStorage.run(context, async () => {
      try {
        return await fn();
      } finally {
        this.endScanContext(context.scanExecutionId);
      }
    });
  }

  public getActiveScanContext(): ScanExecutionContext | null {
    return scanContextStorage.getStore() || this.explicitScanContext;
  }

  private getOrCreateTelemetry(context: ScanExecutionContext): ScanTelemetry {
    if (!this.scanTelemetryMap.has(context.scanExecutionId)) {
      this.scanTelemetryMap.set(context.scanExecutionId, {
        scanExecutionId: context.scanExecutionId,
        scanType: context.scanType,
        scanStartedAt: context.scanStartedAt,
        providerRequests: 0,
        providerSuccesses: 0,
        provider429s: 0,
        providerErrors: 0,
        providerTimeouts: 0,
        failoverCount: 0,
        cacheHits: 0,
        cacheMisses: 0,
        apiRequestsBeforeScan: this.preScanApiAttempts,
      });
    }
    return this.scanTelemetryMap.get(context.scanExecutionId)!;
  }

  public getScanTelemetry(scanExecutionId?: string): ScanTelemetry | null {
    if (scanExecutionId) {
      return this.scanTelemetryMap.get(scanExecutionId) || null;
    }
    const current = this.getActiveScanContext();
    if (current) {
      return this.scanTelemetryMap.get(current.scanExecutionId) || null;
    }
    return this.getLatestScanTelemetry();
  }

  public getLatestScanTelemetry(): ScanTelemetry | null {
    const keys = Array.from(this.scanTelemetryMap.keys());
    if (keys.length === 0) return null;
    return this.scanTelemetryMap.get(keys[keys.length - 1]) || null;
  }

  private isProviderRateLimited(scanExecutionId: string, providerId: string): boolean {
    const set = this.scanRateLimitedProviders.get(scanExecutionId);
    return set ? set.has(providerId) : false;
  }

  private markProviderRateLimited(scanExecutionId: string, providerId: string): void {
    if (!this.scanRateLimitedProviders.has(scanExecutionId)) {
      this.scanRateLimitedProviders.set(scanExecutionId, new Set());
    }
    this.scanRateLimitedProviders.get(scanExecutionId)!.add(providerId);
  }

  /**
   * Evaluates truthful market data connectivity passively without triggering network calls.
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

    // 1. Bitget (Crypto) - Public & keyless
    const bitgetReachable = true;
    const bitgetQuoteTs: number | null = this.lastSuccessfulQuotes.get('bitget') || null;
    const bitgetQuoteAge = bitgetQuoteTs ? Math.max(0, now - bitgetQuoteTs) : null;
    const bitgetFresh = true;
    const bitgetErrMsg: string | undefined = undefined;

    // 2. Twelve Data (Forex / Stocks)
    const twelveDataConfigured = Boolean(process.env.TWELVE_DATA_API_KEY && process.env.TWELVE_DATA_API_KEY.trim().length > 0);
    const twelveDataReachable = twelveDataConfigured;
    const twelveDataQuoteTs: number | null = this.lastSuccessfulQuotes.get('twelvedata') || null;
    const twelveDataErrMsg: string | undefined = twelveDataConfigured ? undefined : 'TWELVE_DATA_API_KEY environment variable not configured';
    const twelveDataQuoteAge = twelveDataQuoteTs ? Math.max(0, now - twelveDataQuoteTs) : null;
    const twelveDataFresh = twelveDataConfigured;

    // 3. ExchangeRate (Forex Fallback)
    const exchangeRateConfigured = true;
    const exchangeRateReachable = true;
    const exchangeRateQuoteTs: number | null = this.lastSuccessfulQuotes.get('exchangerate') || null;
    const exchangeRateErrMsg: string | undefined = undefined;
    const exchangeRateQuoteAge = exchangeRateQuoteTs ? Math.max(0, now - exchangeRateQuoteTs) : null;
    const exchangeRateFresh = true;

    // 4. Finnhub (Stocks / Forex)
    const finnhubConfigured = Boolean(process.env.FINNHUB_API_KEY && process.env.FINNHUB_API_KEY.trim().length > 0);
    const finnhubReachable = finnhubConfigured;
    const finnhubQuoteTs: number | null = this.lastSuccessfulQuotes.get('finnhub') || null;
    const finnhubErrMsg: string | undefined = finnhubConfigured ? undefined : 'FINNHUB_API_KEY environment variable not configured';
    const finnhubQuoteAge = finnhubQuoteTs ? Math.max(0, now - finnhubQuoteTs) : null;
    const finnhubFresh = finnhubConfigured;

    // 5. Tiingo (Forex / Stocks / Crypto)
    const tiingoConfigured = Boolean(process.env.TIINGO_API_KEY && process.env.TIINGO_API_KEY.trim().length > 0);
    const tiingoReachable = tiingoConfigured;
    const tiingoQuoteTs: number | null = this.lastSuccessfulQuotes.get('tiingo') || null;
    const tiingoErrMsg: string | undefined = tiingoConfigured ? undefined : 'TIINGO_API_KEY environment variable not configured';
    const tiingoQuoteAge = tiingoQuoteTs ? Math.max(0, now - tiingoQuoteTs) : null;
    const tiingoFresh = tiingoConfigured;

    // Asset Class Readiness
    const cryptoReady = bitgetReachable && bitgetFresh;
    const forexReady = (tiingoReachable && tiingoFresh) || (finnhubReachable && finnhubFresh) || (twelveDataReachable && twelveDataFresh) || (exchangeRateReachable && exchangeRateFresh);
    const stockReady = (finnhubReachable && finnhubFresh) || (tiingoReachable && tiingoFresh) || (twelveDataReachable && twelveDataFresh);

    // Aggregate Connectivity
    const marketDataConnected = cryptoReady || forexReady || stockReady;

    const validQuoteTsList = [bitgetQuoteTs, twelveDataQuoteTs, exchangeRateQuoteTs, finnhubQuoteTs, tiingoQuoteTs].filter((ts): ts is number => ts !== null && ts > 0);
    const lastSuccessfulQuote = validQuoteTsList.length > 0 ? Math.max(...validQuoteTsList) : null;
    const quoteAge = lastSuccessfulQuote ? Math.max(0, now - lastSuccessfulQuote) : null;
    const dataFreshness = quoteAge !== null && quoteAge <= config.marketDataMaxAgeMs;
    const marketFeedsActive = marketDataConnected;

    const providerConfigured = true;
    const providerReachable = bitgetReachable || (twelveDataConfigured && twelveDataReachable) || (finnhubConfigured && finnhubReachable) || (tiingoConfigured && tiingoReachable) || exchangeRateReachable;

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
    } else if (!persistenceCheckPassed || (twelveDataConfigured && !twelveDataReachable) || (finnhubConfigured && !finnhubReachable) || (tiingoConfigured && !tiingoReachable) || !bitgetReachable) {
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
        tiingo: {
          providerConfigured: tiingoConfigured,
          providerReachable: tiingoReachable,
          lastSuccessfulQuote: tiingoQuoteTs,
          quoteAge: tiingoQuoteAge,
          dataFreshness: tiingoFresh,
          status: tiingoConfigured ? (tiingoReachable ? 'CONNECTED' : 'DEGRADED') : 'UNCONFIGURED',
          errorMessage: tiingoErrMsg,
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
          provider: tiingoReachable ? 'tiingo' : (finnhubReachable ? 'finnhub' : (twelveDataReachable ? 'twelvedata' : 'exchangerate')),
          fallbackActive: !tiingoReachable && (finnhubReachable || twelveDataReachable || exchangeRateReachable),
          quoteAge: tiingoReachable ? tiingoQuoteAge : (finnhubReachable ? finnhubQuoteAge : (twelveDataReachable ? twelveDataQuoteAge : exchangeRateQuoteAge)),
        },
        stock: {
          ready: stockReady,
          provider: finnhubReachable ? 'finnhub' : (tiingoReachable ? 'tiingo' : (twelveDataReachable ? 'twelvedata' : 'none')),
          quoteAge: finnhubReachable ? finnhubQuoteAge : (tiingoReachable ? tiingoQuoteAge : twelveDataQuoteAge),
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
   * Enforces strict provider routing & fallbacks:
   * - FOREX: Tiingo -> Finnhub -> Twelve Data -> ExchangeRate
   * - STOCKS: Finnhub -> Tiingo -> Twelve Data
   * - CRYPTO: Bitget -> Finnhub -> Tiingo -> Twelve Data
   */
  public getRoutingForSymbol(appSymbol: string, requestedProvider?: string): {
    assetClass: 'CRYPTO' | 'STOCK' | 'FOREX' | 'INDEX' | 'UNKNOWN';
    primaryProvider: string;
    fallbackProviders: string[];
  } {
    const assetClass = SymbolNormalizer.getAssetClassification(appSymbol);
    const cleanReq = requestedProvider ? requestedProvider.toLowerCase().trim() : undefined;
    const requested = cleanReq === 'forex' ? 'twelvedata' : cleanReq;

    const hasFinnhub = Boolean(process.env.FINNHUB_API_KEY && process.env.FINNHUB_API_KEY.trim().length > 0);
    const hasTwelveData = Boolean(process.env.TWELVE_DATA_API_KEY && process.env.TWELVE_DATA_API_KEY.trim().length > 0);
    const hasTiingo = Boolean(process.env.TIINGO_API_KEY && process.env.TIINGO_API_KEY.trim().length > 0);

    if (assetClass === 'CRYPTO') {
      const defaultChain = ['bitget'];
      if (hasFinnhub) defaultChain.push('finnhub');
      if (hasTiingo) defaultChain.push('tiingo');
      if (hasTwelveData) defaultChain.push('twelvedata');

      let primary = requested || 'bitget';
      if (!defaultChain.includes(primary)) primary = 'bitget';
      const fallbacks = defaultChain.filter((p) => p !== primary);

      return { assetClass: 'CRYPTO', primaryProvider: primary, fallbackProviders: fallbacks };
    }

    if (assetClass === 'FOREX') {
      const chain: string[] = [];
      if (hasTiingo) chain.push('tiingo');
      if (hasFinnhub) chain.push('finnhub');
      if (hasTwelveData) chain.push('twelvedata');
      chain.push('exchangerate');

      let primary = requested || chain[0];
      if (!chain.includes(primary)) primary = chain[0];
      const fallbacks = chain.filter((p) => p !== primary);

      return { assetClass: 'FOREX', primaryProvider: primary, fallbackProviders: fallbacks };
    }

    if (assetClass === 'STOCK') {
      const chain: string[] = [];
      if (hasFinnhub) chain.push('finnhub');
      if (hasTiingo) chain.push('tiingo');
      if (hasTwelveData) chain.push('twelvedata');
      if (chain.length === 0) chain.push('finnhub');

      let primary = requested || chain[0];
      if (!chain.includes(primary)) primary = chain[0];
      const fallbacks = chain.filter((p) => p !== primary);

      return { assetClass: 'STOCK', primaryProvider: primary, fallbackProviders: fallbacks };
    }

    return { assetClass: 'UNKNOWN', primaryProvider: requested || 'unknown', fallbackProviders: [] };
  }

  /**
   * Fetches normalized ticker price.
   * Checks cache first. Rejects requests outside scan context with REJECT_REQUEST: API_REQUEST_OUTSIDE_SCAN.
   */
  async getPrice(
    appSymbol: string,
    requestedProvider?: string,
    forceFresh = false,
    reason: 'USER_CLICK' | 'AUTOMATED_SCANNER' = 'USER_CLICK',
    globalScanDeadlineMs?: number
  ): Promise<NormalizedTicker> {
    if (globalScanDeadlineMs && globalScanDeadlineMs - Date.now() <= 0) {
      throw new Error('TIMEOUT: Global scanner deadline reached before starting request');
    }
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

    const routing = this.getRoutingForSymbol(cleanSymbol, requestedProvider);
    if (routing.assetClass === 'UNKNOWN') {
      return this.createErrorTicker(
        cleanSymbol,
        appSymbol,
        routing.primaryProvider,
        'UNKNOWN',
        'ASSET_NOT_SUPPORTED'
      );
    }

    if (routing.assetClass === 'FOREX') {
      const validReason = reason === 'AUTOMATED_SCANNER' ? 'AUTOMATED_SCANNER' : 'USER_CLICK';
      logger.info(`FOREX_PRICE_REQUEST reason=${validReason} symbol=${cleanSymbol}`);
    }

    let activeContext = this.getActiveScanContext();
    const cacheTtlMs = serverConfig.getConfig().marketDataCacheTtlMs;

    // 1. CACHE LOOKUP: Always check cache first if not forceFresh
    if (!forceFresh) {
      const cachedPrimary = marketCache.get(routing.primaryProvider, cleanSymbol);
      if (cachedPrimary && cachedPrimary.status === 'OK' && cachedPrimary.price > 0) {
        if (activeContext) {
          const telem = this.getOrCreateTelemetry(activeContext);
          telem.cacheHits++;
        }
        return cachedPrimary;
      }

      for (const fbId of routing.fallbackProviders) {
        const cachedFallback = marketCache.get(fbId, cleanSymbol);
        if (cachedFallback && cachedFallback.status === 'OK' && cachedFallback.price > 0) {
          if (activeContext) {
            const telem = this.getOrCreateTelemetry(activeContext);
            telem.cacheHits++;
          }
          return cachedFallback;
        }
      }
    }

    // 2. CONTEXT BOUNDARY CHECK: If no background scanner context exists, block external requests
    if (!activeContext && reason !== 'USER_CLICK') {
      logger.warn(`[MarketDataManager] Rejecting provider price request outside scan context for ${cleanSymbol}`);
      this.preScanApiAttempts++;
      return this.createErrorTicker(
        cleanSymbol,
        appSymbol,
        routing.primaryProvider,
        'ERROR',
        'REJECT_REQUEST: API_REQUEST_OUTSIDE_SCAN'
      );
    }

    let telemetry: ScanTelemetry | null = null;
    if (activeContext) {
      telemetry = this.getOrCreateTelemetry(activeContext);
      telemetry.cacheMisses++;
    }

    // 3. SCAN-LEVEL REQUEST DEDUPLICATION
    const dedupKey = activeContext 
      ? `price:${activeContext.scanExecutionId}:${cleanSymbol}:${requestedProvider || 'default'}`
      : `price:USER_CLICK:${cleanSymbol}:${requestedProvider || 'default'}`;
    if (this.inFlightScanRequests.has(dedupKey)) {
      return this.inFlightScanRequests.get(dedupKey)!;
    }

    const fetchPromise = (async () => {
      return await this.executePriceFetchWithFailover(
        cleanSymbol,
        routing,
        activeContext,
        telemetry,
        forceFresh,
        cacheTtlMs,
        globalScanDeadlineMs
      );
    })();

    this.inFlightScanRequests.set(dedupKey, fetchPromise);
    try {
      return await fetchPromise;
    } finally {
      this.inFlightScanRequests.delete(dedupKey);
    }
  }

  private async executePriceFetchWithFailover(
    cleanSymbol: string,
    routing: { assetClass: any; primaryProvider: string; fallbackProviders: string[] },
    activeContext: ScanExecutionContext | null,
    telemetry: ScanTelemetry | null,
    forceFresh: boolean,
    cacheTtlMs: number,
    globalScanDeadlineMs?: number
  ): Promise<NormalizedTicker> {
    const providerChain = [routing.primaryProvider, ...routing.fallbackProviders];

    for (let i = 0; i < providerChain.length; i++) {
      const providerId = providerChain[i];

      if (activeContext && this.isProviderRateLimited(activeContext.scanExecutionId, providerId)) {
        logger.warn(`[MarketDataManager] Provider '${providerId}' rate-limited during scan ${activeContext.scanExecutionId}. Skipping.`);
        if (i > 0 && telemetry) telemetry.failoverCount++;
        continue;
      }

      const adapter = this.getProvider(providerId);
      if (!adapter) continue;

      if (telemetry) telemetry.providerRequests++;

      try {
        const ticker = await providerQueue.enqueue(providerId, async () => {
          return adapter.fetchPrice(cleanSymbol, globalScanDeadlineMs);
        }, globalScanDeadlineMs);

        if (ticker && (ticker.status === 'OK' || ticker.price > 0)) {
          if (telemetry) telemetry.providerSuccesses++;
          this.lastSuccessfulQuotes.set(providerId, ticker.timestamp || ticker.receivedAt);
          marketCache.set(providerId, cleanSymbol, ticker, cacheTtlMs);
          return ticker;
        }

        const errMsg = ticker?.errorMessage || '';
        const is429 = errMsg.includes('429') || errMsg.toLowerCase().includes('rate limit');
        if (is429) {
          if (telemetry) telemetry.provider429s++;
          if (activeContext) this.markProviderRateLimited(activeContext.scanExecutionId, providerId);
        } else {
          if (telemetry) telemetry.providerErrors++;
        }
        if (i > 0 && telemetry) telemetry.failoverCount++;

      } catch (err: any) {
        const errMsg = String(err);
        const is429 = errMsg.includes('429') || errMsg.toLowerCase().includes('rate limit');
        const isTimeout = errMsg.toLowerCase().includes('timeout') || errMsg.toLowerCase().includes('aborted');

        if (is429) {
          if (telemetry) telemetry.provider429s++;
          if (activeContext) this.markProviderRateLimited(activeContext.scanExecutionId, providerId);
        } else if (isTimeout) {
          if (telemetry) telemetry.providerTimeouts++;
        } else {
          if (telemetry) telemetry.providerErrors++;
        }
        if (i > 0 && telemetry) telemetry.failoverCount++;
      }
    }

    return this.createErrorTicker(
      cleanSymbol,
      cleanSymbol,
      routing.primaryProvider,
      routing.assetClass,
      'MARKET_DATA_UNAVAILABLE: All providers failed'
    );
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
    if (tf === '1m' || tf === '1min') return CACHE_TTL.CANDLES_1M;
    if (tf === '5m' || tf === '5min') return CACHE_TTL.CANDLES_5M;
    if (tf === '15m' || tf === '15min') return CACHE_TTL.CANDLES_15M;
    if (tf === '1h') return CACHE_TTL.CANDLES_1H;
    if (tf === '4h') return CACHE_TTL.CANDLES_4H;

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
   * Fetches candles if supported by the specified provider with caching, rate-limit check, deduplication, and fallback.
   */
  async getCandles(
    appSymbol: string,
    requestedProvider?: string,
    timeframe = '1m',
    limit = 50,
    critical = false,
    globalScanDeadlineMs?: number
  ): Promise<NormalizedCandle[]> {
    const cleanSymbol = SymbolNormalizer.normalizeAppSymbol(appSymbol);
    const routing = this.getRoutingForSymbol(cleanSymbol, requestedProvider);
    let primaryProviderId = (requestedProvider || routing.primaryProvider).toLowerCase();
    if (primaryProviderId === 'forex') {
      primaryProviderId = 'twelvedata';
    }

    const ttlMs = this.getTimeframeTtl(timeframe);
    let activeContext = this.getActiveScanContext();

    // 1. CACHE LOOKUP: Check candles cache first
    const cachedCandles = marketCache.getCandles(primaryProviderId, cleanSymbol, timeframe);
    if (cachedCandles && cachedCandles.length > 0) {
      if (activeContext) {
        const telem = this.getOrCreateTelemetry(activeContext);
        telem.cacheHits++;
      }
      return cachedCandles;
    }

    for (const fbId of routing.fallbackProviders) {
      const cachedFb = marketCache.getCandles(fbId, cleanSymbol, timeframe);
      if (cachedFb && cachedFb.length > 0) {
        if (activeContext) {
          const telem = this.getOrCreateTelemetry(activeContext);
          telem.cacheHits++;
        }
        return cachedFb;
      }
    }

    // 2. CONTEXT BOUNDARY CHECK: If no background scanner context exists, block external requests
    if (!activeContext) {
      logger.warn(`[MarketDataManager] Rejecting provider candles request outside scan context for ${cleanSymbol}`);
      this.preScanApiAttempts++;
      throw new Error('REJECT_REQUEST: API_REQUEST_OUTSIDE_SCAN');
    }

    const telemetry = this.getOrCreateTelemetry(activeContext);
    telemetry.cacheMisses++;

    // 3. SCAN-LEVEL DEDUPLICATION
    const dedupKey = `candles:${activeContext.scanExecutionId}:${cleanSymbol}:${timeframe}:${limit}:${primaryProviderId}`;
    if (this.inFlightScanRequests.has(dedupKey)) {
      return this.inFlightScanRequests.get(dedupKey)!;
    }

    const fetchPromise = (async () => {
      return await this.executeCandlesFetchWithFailover(
        cleanSymbol,
        primaryProviderId,
        routing.fallbackProviders,
        timeframe,
        limit,
        critical,
        activeContext,
        telemetry,
        ttlMs,
        globalScanDeadlineMs
      );
    })();

    this.inFlightScanRequests.set(dedupKey, fetchPromise);
    try {
      return await fetchPromise;
    } finally {
      this.inFlightScanRequests.delete(dedupKey);
    }
  }

  private async executeCandlesFetchWithFailover(
    cleanSymbol: string,
    primaryProviderId: string,
    fallbackProviders: string[],
    timeframe: string,
    limit: number,
    critical: boolean,
    activeContext: ScanExecutionContext,
    telemetry: ScanTelemetry,
    ttlMs: number,
    globalScanDeadlineMs?: number
  ): Promise<NormalizedCandle[]> {
    const providerChain = [primaryProviderId, ...fallbackProviders];

    for (let i = 0; i < providerChain.length; i++) {
      const providerId = providerChain[i];

      if (this.isProviderRateLimited(activeContext.scanExecutionId, providerId)) {
        logger.warn(`[MarketDataManager] Provider '${providerId}' rate-limited during scan ${activeContext.scanExecutionId}. Skipping candles fetch.`);
        if (i > 0) telemetry.failoverCount++;
        continue;
      }

      const adapter = this.getProvider(providerId);
      if (!adapter || !adapter.fetchCandles) continue;

      if (!quotaManager.canMakeRequest(providerId, critical)) continue;

      telemetry.providerRequests++;
      const startTime = Date.now();

      try {
        const candles = await providerQueue.enqueue(providerId, async () => {
          quotaManager.recordRequest(providerId);
          requestRegistry.record(providerId, `fetchCandles:${timeframe}`, cleanSymbol, critical ? 'Critical Candle Fetch' : 'Candle Fetch');
          const res = await adapter.fetchCandles!(cleanSymbol, timeframe, limit, globalScanDeadlineMs);
          const latency = Date.now() - startTime;
          getActiveProfiler()?.recordProviderRequest(latency);
          getActiveProfiler()?.recordNetworkRequest(providerId, `fetchCandles:${timeframe}`, latency);
          if (res && res.length > 0) {
            quotaManager.recordResponse(providerId, 200, latency);
          }
          return res;
        }, globalScanDeadlineMs);

        if (candles && candles.length > 0) {
          telemetry.providerSuccesses++;
          marketCache.setCandles(providerId, cleanSymbol, timeframe, candles, ttlMs);
          return candles;
        }
      } catch (err: any) {
        const latency = Date.now() - startTime;
        const errMsg = String(err);
        const is429 = errMsg.includes('429') || errMsg.toLowerCase().includes('rate limit');
        const isTimeout = errMsg.toLowerCase().includes('timeout') || errMsg.toLowerCase().includes('aborted');

        quotaManager.recordResponse(providerId, is429 ? 429 : 500, latency, isTimeout, errMsg);
        if (is429) {
          telemetry.provider429s++;
          this.markProviderRateLimited(activeContext.scanExecutionId, providerId);
        } else if (isTimeout) {
          telemetry.providerTimeouts++;
        } else {
          telemetry.providerErrors++;
        }
        if (i > 0) telemetry.failoverCount++;
      }
    }

    // Retrieve expired candles if available
    const expired = marketCache.getExpiredCandles(primaryProviderId, cleanSymbol, timeframe);
    if (expired && expired.length > 0) {
      logger.info(`[MarketData Candles] Serving ${expired.length} expired candles from cache for ${cleanSymbol} (${timeframe})`);
      return expired;
    }

    return [];
  }

  /**
   * Tests real API status for all registered providers passively.
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
   * Fetches candles across multiple timeframes concurrently.
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
