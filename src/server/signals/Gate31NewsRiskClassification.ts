/**
 * GATE 31 — ASSET-SPECIFIC NEWS RISK CLASSIFICATION ENGINE
 *
 * OBJECTIVE:
 * Classify news risk into three explicit operational states:
 * 1. NORMAL: Standard policy & baseline confirmation thresholds.
 * 2. CAUTION: Elevated volatility/uncertainty around moderate events. Requires stronger confirmation.
 * 3. BLOCK: Major scheduled market-moving events (e.g., FOMC, CPI, NFP, ECB Rate Decisions). Trading is BLOCKED.
 *
 * STRICT RELEVANCE & PROVENANCE RULES:
 * - Separates verified scheduled economic events from ordinary financial news articles.
 * - Ordinary news articles (publishedAtMs) NEVER trigger a scheduled blackout window.
 * - Scheduled economic events (scheduledTimeMs) ONLY block relevant assets during their specific window.
 * - Corporate stock earnings ONLY affect that specific stock — NEVER block EURUSD or Crypto.
 * - ECB rate decisions ONLY affect EUR pairs — NEVER block BTCUSDT or AAPL.
 * - Crypto-specific news/regulatory items ONLY affect Crypto — NEVER block EURUSD or Tesla.
 * - Macro US events (FOMC, NFP, US CPI) affect USD pairs, Gold (XAUUSD), US Indices, and Crypto.
 *
 * CRITICAL DIRECTIVES:
 * - News MUST NEVER fabricate or originate a trade signal. News can ONLY filter, block, or elevate confirmation thresholds.
 * - Explicitly reports NEWS_DATA_UNAVAILABLE when news/calendar source is unavailable, while retaining fail-closed safety.
 * - Cache-first, background, non-blocking execution to ensure global scan deadline / Cron response is never extended.
 */

import { SymbolNormalizer } from '../market/SymbolNormalizer.js';
import { logger } from '../logger.js';

export type NewsClassification = 'NORMAL' | 'CAUTION' | 'BLOCK';

export type NewsCategory =
  | 'MACRO_US'
  | 'CENTRAL_BANK'
  | 'STOCK_EARNINGS'
  | 'CRYPTO_REGULATORY'
  | 'COMMODITY_GEOPOLITICAL'
  | 'GENERAL_ECONOMIC';

export type NewsImpact = 'HIGH' | 'MEDIUM' | 'LOW';

export interface VerifiedNewsArticle {
  eventId: string;                  // Unique article ID e.g. "td_art_BTCUSDT_0_1787487169199"
  source: string;                   // e.g. "twelvedata" or "finnhub"
  provenance: 'twelvedata' | 'finnhub' | 'cached' | 'fallback' | string;
  title: string;
  url?: string;
  publishedAtMs: number;            // Actual article publication timestamp
  category: NewsCategory;
  impact: NewsImpact;
  affectedAssets?: string[];        // e.g. ['BTCUSDT']
  affectedAssetClasses?: string[];  // e.g. ['CRYPTO']
  affectedCurrencies?: string[];    // e.g. ['USD']
}

export interface ScheduledNewsEvent {
  id: string;                       // Unique event ID
  title: string;
  category: NewsCategory;
  impact: NewsImpact;
  scheduledTimeMs: number;          // Actual scheduled future event time
  affectedCurrencies?: string[];      // e.g. ['USD'], ['EUR'], ['GBP'], ['JPY']
  affectedAssets?: string[];          // e.g. ['AAPL'], ['BTCUSDT'], ['EURUSD']
  affectedAssetClasses?: string[];    // e.g. ['CRYPTO'], ['STOCKS'], ['FOREX'], ['COMMODITIES']
  blackoutBeforeMinutes?: number;     // Minutes before event to start blackout (default 30m)
  blackoutAfterMinutes?: number;      // Minutes after event to keep blackout (default 30m)
  cautionBeforeMinutes?: number;      // Minutes before event to start CAUTION window (default 60m)
  cautionAfterMinutes?: number;       // Minutes after event to keep CAUTION window (default 60m)
  provenance?: string;
}

export interface NewsRiskEvaluationResult {
  symbol: string;
  classification: NewsClassification;
  isTradingAllowed: boolean;
  requiredConfirmationScoreMultiplier: number;
  minRequiredConfirmationScore: number; // e.g. 60 for NORMAL, 80 for CAUTION, 1000 for BLOCK
  activeEvents: ScheduledNewsEvent[];
  recentArticles?: VerifiedNewsArticle[];
  relevantEventsCount: number;
  reasons: string[];
  explanation: string;
  neverFabricateSignalEnforced: true;
}

export class Gate31NewsRiskClassification {
  private static scheduledEvents: ScheduledNewsEvent[] = [];
  private static verifiedArticlesMap = new Map<string, VerifiedNewsArticle[]>();
  private static lastFetchSuccessful = false;
  private static lastFetchTime = 0;

  // Scan-level cache, deduplication, and failure cooldowns
  private static symbolNewsCache = new Map<string, { lastFetchTime: number; success: boolean; provider?: string }>();
  private static pendingFetches = new Map<string, Promise<void>>();
  private static twelveDataFailureTime = 0;
  private static finnhubFailureTime = 0;
  private static lastFailureTime = 0; // Legacy backwards compat for tests checking lastFailureTime

  /**
   * Syncs verified news from Twelve Data + Finnhub failover for a given symbol and updates verified articles.
   * Cache-first, background, non-blocking: respects maxWaitMs so scanner deadline is never extended.
   */
  public static async syncVerifiedNews(symbol: string, maxWaitMs?: number): Promise<void> {
    const twelveKey = process.env.TWELVE_DATA_API_KEY?.trim();
    const finnhubKey = process.env.FINNHUB_API_KEY?.trim();

    const cleanSymbol = SymbolNormalizer.normalizeAppSymbol(symbol) || symbol.trim().toUpperCase();
    const assetClass = SymbolNormalizer.getAssetClassification(cleanSymbol).toUpperCase();
    const extractedCurrencies = assetClass === 'FOREX' ? this.extractCurrenciesFromForex(cleanSymbol) : ['USD'];

    if (!twelveKey && !finnhubKey) {
      logger.warn('[Gate 31 News Risk] Neither TWELVE_DATA_API_KEY nor FINNHUB_API_KEY configured.');
      if (!this.verifiedArticlesMap.has(cleanSymbol)) {
        this.lastFetchSuccessful = false;
      }
      return;
    }

    // 1. Check global failure cooldown (5 minutes) to protect providers and avoid repeated failures
    const FAILURE_COOLDOWN_MS = 5 * 60 * 1000;
    if (this.lastFailureTime > 0 && (Date.now() - this.lastFailureTime < FAILURE_COOLDOWN_MS)) {
      logger.warn(`[Gate 31 News Risk] Skipping news sync for ${cleanSymbol} due to global failure cooldown.`);
      return;
    }

    // 2. Check symbol-specific cache (15 minutes TTL)
    const CACHE_TTL_MS = 15 * 60 * 1000;
    const cached = this.symbolNewsCache.get(cleanSymbol);
    if (cached && (Date.now() - cached.lastFetchTime < CACHE_TTL_MS)) {
      logger.debug(`[Gate 31 News Risk] Using cached news results for ${cleanSymbol}`);
      if (cached.success) {
        this.lastFetchSuccessful = true;
      }
      return;
    }

    // 3. Deduplicate parallel calls for the same symbol
    let fetchPromise = this.pendingFetches.get(cleanSymbol);
    if (!fetchPromise) {
      fetchPromise = (async () => {
        try {
          const now = Date.now();
          let fetchedArticles: VerifiedNewsArticle[] | null = null;
          let activeProvider = '';

          // Attempt A: Twelve Data (if key present and not in failure cooldown)
          if (twelveKey && (this.twelveDataFailureTime === 0 || now - this.twelveDataFailureTime >= FAILURE_COOLDOWN_MS)) {
            try {
              const provMapping = SymbolNormalizer.toProviderSymbol(cleanSymbol, 'twelvedata');
              const providerSymbol = provMapping.providerSymbol || cleanSymbol;
              const controller = new AbortController();
              const timeoutId = setTimeout(() => controller.abort(), 4000);

              const url = `https://api.twelvedata.com/news?symbol=${encodeURIComponent(providerSymbol)}&apikey=${twelveKey}`;
              const response = await fetch(url, { signal: controller.signal });
              clearTimeout(timeoutId);

              if (response.ok) {
                const json = await response.json() as any;
                if (!json.status || json.status !== 'error') {
                  const rawArticles = json.data || json.articles || [];
                  if (Array.isArray(rawArticles)) {
                    fetchedArticles = rawArticles.map((art: any, index: number) => {
                      const pubDate = art.date ? new Date(art.date).getTime() : now;
                      const title = art.title || 'Verified News Article';
                      const titleLower = title.toLowerCase();

                      let category: NewsCategory = 'GENERAL_ECONOMIC';
                      let impact: NewsImpact = 'LOW';

                      if (titleLower.includes('fed') || titleLower.includes('fomc') || titleLower.includes('powell') || titleLower.includes('rate decision')) {
                        category = 'MACRO_US';
                        impact = 'HIGH';
                      } else if (titleLower.includes('ecb') || titleLower.includes('central bank') || titleLower.includes('inflation') || titleLower.includes('cpi')) {
                        category = 'CENTRAL_BANK';
                        impact = 'HIGH';
                      } else if (titleLower.includes('crypto') || titleLower.includes('bitcoin') || titleLower.includes('sec') || titleLower.includes('etf')) {
                        category = 'CRYPTO_REGULATORY';
                        impact = 'MEDIUM';
                      } else if (titleLower.includes('earnings') || titleLower.includes('revenue') || titleLower.includes('profit')) {
                        category = 'STOCK_EARNINGS';
                        impact = 'MEDIUM';
                      }

                      return {
                        eventId: art.id || `td_art_${cleanSymbol}_${index}_${pubDate}`,
                        source: art.source || 'twelvedata',
                        provenance: 'twelvedata',
                        title,
                        url: art.url,
                        publishedAtMs: pubDate,
                        category,
                        impact,
                        affectedAssets: [cleanSymbol],
                        affectedAssetClasses: [assetClass],
                        affectedCurrencies: extractedCurrencies,
                      };
                    });
                    activeProvider = 'twelvedata';
                    this.lastFetchSuccessful = true;
                  }
                } else {
                  logger.warn(`[Gate 31 News Risk] Twelve Data returned error payload for ${cleanSymbol}: ${json.message || json.code}`);
                  this.twelveDataFailureTime = now;
                  this.lastFailureTime = now;
                  this.lastFetchSuccessful = false;
                }
              } else {
                logger.warn(`[Gate 31 News Risk] Twelve Data returned HTTP ${response.status} for ${cleanSymbol}`);
                this.twelveDataFailureTime = now;
                this.lastFailureTime = now;
                this.lastFetchSuccessful = false;
              }
            } catch (err) {
              logger.warn(`[Gate 31 News Risk] Twelve Data fetch failed for ${cleanSymbol}, failing over to Finnhub:`, { error: String(err) });
              this.twelveDataFailureTime = now;
              this.lastFailureTime = now;
              this.lastFetchSuccessful = false;
            }
          }

          // Attempt B: Finnhub Failover (if Twelve Data failed or was unconfigured)
          if (!fetchedArticles && finnhubKey && (this.finnhubFailureTime === 0 || now - this.finnhubFailureTime >= FAILURE_COOLDOWN_MS)) {
            try {
              const provMapping = SymbolNormalizer.toProviderSymbol(cleanSymbol, 'finnhub');
              const providerSymbol = provMapping.providerSymbol || cleanSymbol;
              const controller = new AbortController();
              const timeoutId = setTimeout(() => controller.abort(), 4000);

              let fhUrl = '';
              if (assetClass === 'STOCKS' || assetClass === 'STOCK') {
                const toDateStr = new Date().toISOString().split('T')[0];
                const fromDateStr = new Date(now - 7 * 86400000).toISOString().split('T')[0];
                fhUrl = `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(providerSymbol)}&from=${fromDateStr}&to=${toDateStr}&token=${finnhubKey}`;
              } else {
                const categoryParam = assetClass === 'CRYPTO' ? 'crypto' : assetClass === 'FOREX' ? 'forex' : 'general';
                fhUrl = `https://finnhub.io/api/v1/news?category=${categoryParam}&token=${finnhubKey}`;
              }

              const response = await fetch(fhUrl, { signal: controller.signal });
              clearTimeout(timeoutId);

              if (response.ok) {
                const json = await response.json() as any;
                if (Array.isArray(json)) {
                  fetchedArticles = json.map((art: any, index: number) => {
                    const pubDate = art.datetime ? art.datetime * 1000 : now;
                    const title = art.headline || art.title || 'Verified News Article';
                    const titleLower = title.toLowerCase();

                    let category: NewsCategory = 'GENERAL_ECONOMIC';
                    let impact: NewsImpact = 'LOW';

                    if (titleLower.includes('fed') || titleLower.includes('fomc') || titleLower.includes('powell') || titleLower.includes('rate decision')) {
                      category = 'MACRO_US';
                      impact = 'HIGH';
                    } else if (titleLower.includes('ecb') || titleLower.includes('central bank') || titleLower.includes('inflation') || titleLower.includes('cpi')) {
                      category = 'CENTRAL_BANK';
                      impact = 'HIGH';
                    } else if (titleLower.includes('crypto') || titleLower.includes('bitcoin') || titleLower.includes('sec') || titleLower.includes('etf')) {
                      category = 'CRYPTO_REGULATORY';
                      impact = 'MEDIUM';
                    } else if (titleLower.includes('earnings') || titleLower.includes('revenue') || titleLower.includes('profit')) {
                      category = 'STOCK_EARNINGS';
                      impact = 'MEDIUM';
                    }

                    return {
                      eventId: art.id ? String(art.id) : `fh_art_${cleanSymbol}_${index}_${pubDate}`,
                      source: art.source || 'finnhub',
                      provenance: 'finnhub',
                      title,
                      url: art.url,
                      publishedAtMs: pubDate,
                      category,
                      impact,
                      affectedAssets: [cleanSymbol],
                      affectedAssetClasses: [assetClass],
                      affectedCurrencies: extractedCurrencies,
                    };
                  });
                  activeProvider = 'finnhub';
                }
              }
            } catch (err) {
              logger.warn(`[Gate 31 News Risk] Finnhub news failover failed for ${cleanSymbol}:`, { error: String(err) });
              this.finnhubFailureTime = now;
              this.lastFailureTime = now;
            }
          }

          // Handle Results
          if (fetchedArticles !== null) {
            this.verifiedArticlesMap.set(cleanSymbol, fetchedArticles);
            this.symbolNewsCache.set(cleanSymbol, { lastFetchTime: now, success: true, provider: activeProvider });
            if (activeProvider === 'twelvedata') {
              this.lastFetchSuccessful = true;
            }
            this.lastFetchTime = now;
            logger.info(`[Gate 31 News Risk] Successfully synced ${fetchedArticles.length} verified news articles from ${activeProvider} for ${cleanSymbol}`);
          } else {
            // Check if we have valid cached data to fall back on
            const existingCache = this.verifiedArticlesMap.get(cleanSymbol);
            if (existingCache && existingCache.length > 0) {
              logger.info(`[Gate 31 News Risk] News provider fetch failed for ${cleanSymbol}, using existing valid cached data (${existingCache.length} articles)`);
              this.symbolNewsCache.set(cleanSymbol, { lastFetchTime: now, success: true, provider: 'cached' });
              this.lastFetchSuccessful = true;
            } else {
              logger.warn(`[Gate 31 News Risk] News sync failed for ${cleanSymbol} across both providers and no valid cache exists.`);
              this.symbolNewsCache.set(cleanSymbol, { lastFetchTime: now, success: false, provider: 'none' });
              this.lastFailureTime = now;
              this.lastFetchSuccessful = false;
            }
          }
        } catch (err) {
          logger.warn('[Gate 31 News Risk] Unexpected error syncing news:', { error: String(err) });
          this.symbolNewsCache.set(cleanSymbol, { lastFetchTime: Date.now(), success: false, provider: 'error' });
          this.lastFailureTime = Date.now();
          this.lastFetchSuccessful = false;
        } finally {
          this.pendingFetches.delete(cleanSymbol);
        }
      })();

      this.pendingFetches.set(cleanSymbol, fetchPromise);
    }

    // Cache-first / background requirement: if maxWaitMs is explicitly provided, wait at most maxWaitMs
    if (maxWaitMs !== undefined && maxWaitMs >= 0) {
      if (maxWaitMs > 0) {
        const timeoutPromise = new Promise<void>((resolve) => setTimeout(resolve, maxWaitMs));
        await Promise.race([fetchPromise, timeoutPromise]);
      }
    } else {
      await fetchPromise;
    }
  }

  /**
   * Dynamically register or update a scheduled economic event in the calendar
   */
  public static registerNewsEvent(event: ScheduledNewsEvent): void {
    const existingIdx = this.scheduledEvents.findIndex((e) => e.id === event.id);
    if (existingIdx >= 0) {
      this.scheduledEvents[existingIdx] = event;
    } else {
      this.scheduledEvents.push(event);
    }
    logger.info(`[Gate 31 News Risk] Registered event '${event.id}': ${event.title}`);
  }

  /**
   * Retrieve all currently registered scheduled news events
   */
  public static getRegisteredEvents(): ScheduledNewsEvent[] {
    return [...this.scheduledEvents];
  }

  /**
   * Resets scheduled events list to empty or given array
   */
  public static setScheduledEvents(events: ScheduledNewsEvent[]): void {
    this.scheduledEvents = [...events];
  }

  /**
   * Retrieve cached verified articles for a symbol
   */
  public static getVerifiedArticles(symbol: string): VerifiedNewsArticle[] {
    const cleanSymbol = SymbolNormalizer.normalizeAppSymbol(symbol) || symbol.trim().toUpperCase();
    return this.verifiedArticlesMap.get(cleanSymbol) || [];
  }

  /**
   * Determines if a scheduled news event is strictly relevant to a given symbol.
   */
  public static isEventRelevantToAsset(symbol: string, event: ScheduledNewsEvent): boolean {
    const cleanSymbol = SymbolNormalizer.normalizeAppSymbol(symbol) || symbol.trim().toUpperCase();
    const assetClass = SymbolNormalizer.getAssetClassification(cleanSymbol).toUpperCase();

    // 1. Check exact asset match (e.g., 'AAPL', 'BTCUSDT', 'EURUSD')
    if (event.affectedAssets && event.affectedAssets.length > 0) {
      const isExactAssetMatch = event.affectedAssets.some(
        (a) => a.toUpperCase() === cleanSymbol || cleanSymbol.includes(a.toUpperCase())
      );
      if (isExactAssetMatch) return true;
    }

    // 2. Check Corporate Stock Earnings Rule:
    // Corporate earnings NEVER affect Forex or Crypto!
    if (event.category === 'STOCK_EARNINGS') {
      if (assetClass !== 'STOCKS' && assetClass !== 'STOCK' && assetClass !== 'INDEX') {
        return false;
      }
      if (event.affectedAssets && event.affectedAssets.length > 0) {
        const matchesStock = event.affectedAssets.some((a) => cleanSymbol.startsWith(a.toUpperCase()));
        return matchesStock;
      }
    }

    // 3. Check Crypto Regulatory Rule:
    // Crypto regulatory news ONLY affects Crypto assets.
    if (event.category === 'CRYPTO_REGULATORY') {
      return assetClass === 'CRYPTO';
    }

    // 4. Check Currency match for FOREX / CENTRAL_BANK / MACRO
    if (event.affectedCurrencies && event.affectedCurrencies.length > 0) {
      const currs = event.affectedCurrencies.map((c) => c.toUpperCase());

      if (assetClass === 'FOREX') {
        const symbolCurrencies = this.extractCurrenciesFromForex(cleanSymbol);
        const matchesForexCurr = currs.some((c) => symbolCurrencies.includes(c));
        if (matchesForexCurr) return true;
      }

      if (assetClass === 'COMMODITIES' && currs.includes('USD') && cleanSymbol.includes('XAU')) {
        return true; // Gold is USD denominated and macro sensitive
      }

      if (assetClass === 'CRYPTO' && currs.includes('USD') && event.impact === 'HIGH' && event.category === 'MACRO_US') {
        return true; // US Fed/FOMC macro liquidity impacts Crypto
      }
    }

    // 5. Check Asset Class broad match
    if (event.affectedAssetClasses && event.affectedAssetClasses.length > 0) {
      const classUpper = event.affectedAssetClasses.map((c) => c.toUpperCase());
      if (classUpper.includes(assetClass) || (assetClass === 'STOCK' && classUpper.includes('STOCKS'))) {
        // If event specifies affectedCurrencies, ensure currency overlap unless macro US
        if (event.affectedCurrencies && event.affectedCurrencies.length > 0 && assetClass === 'FOREX') {
          const symbolCurrencies = this.extractCurrenciesFromForex(cleanSymbol);
          return event.affectedCurrencies.some((c) => symbolCurrencies.includes(c.toUpperCase()));
        }
        return true;
      }
    }

    return false;
  }

  /**
   * Helper to extract currency pairs from Forex symbol (e.g., 'EURUSD' -> ['EUR', 'USD'])
   */
  private static extractCurrenciesFromForex(symbol: string): string[] {
    const clean = symbol.replace(/[^A-Z]/g, '');
    if (clean.length === 6) {
      return [clean.substring(0, 3), clean.substring(3, 6)];
    }
    const currencies = ['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'NZD'];
    return currencies.filter((c) => clean.includes(c));
  }

  /**
   * Evaluates news risk classification for a target symbol at a given evaluation timestamp.
   */
  public static evaluate(symbol: string, nowMs: number = Date.now()): NewsRiskEvaluationResult {
    const cleanSymbol = SymbolNormalizer.normalizeAppSymbol(symbol) || symbol.trim().toUpperCase();
    const isCacheExpired = (Date.now() - this.lastFetchTime) > 15 * 60 * 1000;
    const apiKeyTwelve = process.env.TWELVE_DATA_API_KEY;
    const apiKeyFinnhub = process.env.FINNHUB_API_KEY;
    const hasAnyApiKey = Boolean((apiKeyTwelve && apiKeyTwelve.trim()) || (apiKeyFinnhub && apiKeyFinnhub.trim()));

    // Fail-closed fallback when news data is genuinely unavailable or unconfigured and no fresh cache is present
    if ((!hasAnyApiKey || !this.lastFetchSuccessful) && isCacheExpired) {
      const failClosedEvent: ScheduledNewsEvent = {
        id: 'news_data_unavailable_fail_closed',
        title: 'NEWS_DATA_UNAVAILABLE: Verified news/calendar source is unavailable or unconfigured (Fail-Closed Enforced)',
        category: 'GENERAL_ECONOMIC',
        impact: 'HIGH',
        scheduledTimeMs: nowMs,
        blackoutBeforeMinutes: 1440,
        blackoutAfterMinutes: 1440,
        provenance: 'fail_closed_fallback',
      };
      return {
        symbol: cleanSymbol,
        classification: 'BLOCK',
        isTradingAllowed: false,
        requiredConfirmationScoreMultiplier: Infinity,
        minRequiredConfirmationScore: 1000,
        activeEvents: [failClosedEvent],
        recentArticles: this.getVerifiedArticles(cleanSymbol),
        relevantEventsCount: 1,
        reasons: ['BLOCK: NEWS_DATA_UNAVAILABLE. Verified news/calendar source is unavailable or returned error and no valid cache exists.'],
        explanation: `Gate 31 News Risk for ${cleanSymbol}: State=BLOCK, TradingAllowed=false, MinRequiredScore=1000. Fail-Closed default enforced due to NEWS_DATA_UNAVAILABLE.`,
        neverFabricateSignalEnforced: true,
      };
    }

    const activeEvents: ScheduledNewsEvent[] = [];
    const reasons: string[] = [];

    let highestClassification: NewsClassification = 'NORMAL';

    for (const event of this.scheduledEvents) {
      // Check asset-specific relevance
      if (!this.isEventRelevantToAsset(cleanSymbol, event)) {
        continue;
      }

      const diffMs = event.scheduledTimeMs - nowMs;
      const diffMinutes = diffMs / 60000;

      const blackoutBefore = event.blackoutBeforeMinutes ?? (event.impact === 'HIGH' ? 30 : 15);
      const blackoutAfter = event.blackoutAfterMinutes ?? (event.impact === 'HIGH' ? 30 : 15);

      const cautionBefore = event.cautionBeforeMinutes ?? (event.impact === 'HIGH' ? 90 : 45);
      const cautionAfter = event.cautionAfterMinutes ?? (event.impact === 'HIGH' ? 60 : 30);

      // Check for BLOCK window
      if (diffMinutes >= -blackoutAfter && diffMinutes <= blackoutBefore) {
        activeEvents.push(event);
        highestClassification = 'BLOCK';
        reasons.push(
          `BLOCK: Active major scheduled event '${event.title}' in ${diffMinutes.toFixed(1)}m (Blackout window: -${blackoutAfter}m to +${blackoutBefore}m).`
        );
      }
      // Check for CAUTION window (if not already BLOCK)
      else if (diffMinutes >= -cautionAfter && diffMinutes <= cautionBefore) {
        activeEvents.push(event);
        if (highestClassification !== 'BLOCK') {
          highestClassification = 'CAUTION';
        }
        reasons.push(
          `CAUTION: Approaching scheduled event '${event.title}' in ${diffMinutes.toFixed(1)}m. Elevated volatility requires stronger confirmation score.`
        );
      }
    }

    const isTradingAllowed = highestClassification !== 'BLOCK';
    const requiredConfirmationScoreMultiplier =
      highestClassification === 'BLOCK' ? Infinity : highestClassification === 'CAUTION' ? 1.35 : 1.0;
    const minRequiredConfirmationScore =
      highestClassification === 'BLOCK' ? 1000 : highestClassification === 'CAUTION' ? 80 : 60;

    if (highestClassification === 'NORMAL') {
      reasons.push('NORMAL: No active or approaching asset-relevant scheduled news risk detected. Standard confirmation policy applies.');
    }

    const explanation = `Gate 31 News Risk for ${cleanSymbol}: State=${highestClassification}, TradingAllowed=${isTradingAllowed}, MinRequiredScore=${minRequiredConfirmationScore}. Active Events: ${activeEvents.length}.`;

    logger.debug(`[Gate 31 News Risk] symbol=${cleanSymbol} state=${highestClassification} activeEvents=${activeEvents.length}`);

    return {
      symbol: cleanSymbol,
      classification: highestClassification,
      isTradingAllowed,
      requiredConfirmationScoreMultiplier,
      minRequiredConfirmationScore,
      activeEvents,
      recentArticles: this.getVerifiedArticles(cleanSymbol),
      relevantEventsCount: activeEvents.length,
      reasons,
      explanation,
      neverFabricateSignalEnforced: true,
    };
  }
}
