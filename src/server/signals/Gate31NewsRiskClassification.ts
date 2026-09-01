/**
 * GATE 31 — ASSET-SPECIFIC NEWS RISK CLASSIFICATION ENGINE
 *
 * OBJECTIVE:
 * Classify news risk into three explicit operational states:
 * 1. NORMAL: Standard policy & baseline confirmation thresholds.
 * 2. CAUTION: Elevated volatility/uncertainty around moderate events. Requires stronger confirmation.
 * 3. BLOCK: Major scheduled market-moving events (e.g., FOMC, CPI, NFP, ECB Rate Decisions). Trading is BLOCKED.
 *
 * STRICT RELEVANCE RULES:
 * - Asset-Specific Relevance: News events MUST be explicitly relevant to the evaluated asset.
 * - Corporate stock earnings (e.g., Apple, Nvidia) ONLY affect that stock or specific equity index — NEVER block EURUSD or Crypto.
 * - ECB rate decisions ONLY affect EUR pairs — NEVER block BTCUSDT or AAPL.
 * - Crypto-specific regulatory/ETF events ONLY affect Crypto — NEVER block EURUSD or Tesla.
 * - Macro US events (FOMC, NFP, US CPI) affect USD pairs, Gold (XAUUSD), US Indices, and Crypto (due to USD liquidity).
 *
 * CRITICAL DIRECTIVE:
 * - News MUST NEVER fabricate or originate a trade signal. News can ONLY filter, block, or elevate confirmation thresholds.
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

export interface ScheduledNewsEvent {
  id: string;
  title: string;
  category: NewsCategory;
  impact: NewsImpact;
  scheduledTimeMs: number;
  affectedCurrencies?: string[];      // e.g. ['USD'], ['EUR'], ['GBP'], ['JPY']
  affectedAssets?: string[];          // e.g. ['AAPL'], ['BTCUSDT'], ['EURUSD']
  affectedAssetClasses?: string[];    // e.g. ['CRYPTO'], ['STOCKS'], ['FOREX'], ['COMMODITIES']
  blackoutBeforeMinutes?: number;     // Minutes before event to start blackout (default 30m)
  blackoutAfterMinutes?: number;      // Minutes after event to keep blackout (default 30m)
  cautionBeforeMinutes?: number;      // Minutes before event to start CAUTION window (default 60m)
  cautionAfterMinutes?: number;       // Minutes after event to keep CAUTION window (default 60m)
}

export interface NewsRiskEvaluationResult {
  symbol: string;
  classification: NewsClassification;
  isTradingAllowed: boolean;
  requiredConfirmationScoreMultiplier: number;
  minRequiredConfirmationScore: number; // e.g. 60 for NORMAL, 80 for CAUTION, Infinity for BLOCK
  activeEvents: ScheduledNewsEvent[];
  relevantEventsCount: number;
  reasons: string[];
  explanation: string;
  neverFabricateSignalEnforced: true;
}

export class Gate31NewsRiskClassification {
  private static scheduledEvents: ScheduledNewsEvent[] = [
    // Default mock scheduled events for standard testing
    {
      id: 'fomc_rate_decision',
      title: 'FOMC Interest Rate Decision & Fed Press Conference',
      category: 'MACRO_US',
      impact: 'HIGH',
      scheduledTimeMs: Date.now() + 3600000 * 2, // 2 hours from now
      affectedCurrencies: ['USD'],
      affectedAssetClasses: ['FOREX', 'CRYPTO', 'STOCKS', 'INDEX', 'COMMODITIES'],
      blackoutBeforeMinutes: 30,
      blackoutAfterMinutes: 45,
      cautionBeforeMinutes: 120,
      cautionAfterMinutes: 90,
    },
    {
      id: 'ecb_rate_decision',
      title: 'ECB Monetary Policy Decision',
      category: 'CENTRAL_BANK',
      impact: 'HIGH',
      scheduledTimeMs: Date.now() + 3600000 * 5, // 5 hours from now
      affectedCurrencies: ['EUR'],
      affectedAssetClasses: ['FOREX'],
      blackoutBeforeMinutes: 30,
      blackoutAfterMinutes: 30,
      cautionBeforeMinutes: 60,
      cautionAfterMinutes: 60,
    },
    {
      id: 'aapl_q3_earnings',
      title: 'Apple Inc. (AAPL) Q3 Earnings Report',
      category: 'STOCK_EARNINGS',
      impact: 'HIGH',
      scheduledTimeMs: Date.now() + 3600000 * 8, // 8 hours from now
      affectedAssets: ['AAPL', 'QQQ', 'SPY'],
      affectedAssetClasses: ['STOCKS', 'INDEX'],
      blackoutBeforeMinutes: 45,
      blackoutAfterMinutes: 60,
      cautionBeforeMinutes: 120,
      cautionAfterMinutes: 120,
    },
    {
      id: 'sec_crypto_etf',
      title: 'SEC Spot Bitcoin ETF Decision Window',
      category: 'CRYPTO_REGULATORY',
      impact: 'HIGH',
      scheduledTimeMs: Date.now() + 3600000 * 12,
      affectedAssets: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BTC', 'ETH'],
      affectedAssetClasses: ['CRYPTO'],
      blackoutBeforeMinutes: 30,
      blackoutAfterMinutes: 45,
      cautionBeforeMinutes: 90,
      cautionAfterMinutes: 90,
    },
  ];

  /**
   * Dynamically register or update a scheduled news event in the calendar
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
   * Retrieve all currently registered news events
   */
  public static getRegisteredEvents(): ScheduledNewsEvent[] {
    return [...this.scheduledEvents];
  }

  /**
   * Resets scheduled events list to empty or initial defaults
   */
  public static setScheduledEvents(events: ScheduledNewsEvent[]): void {
    this.scheduledEvents = [...events];
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
    // If event is STOCK_EARNINGS and asset is NOT a stock or equity index, or does not match the specific ticker, REJECT relevance.
    if (event.category === 'STOCK_EARNINGS') {
      if (assetClass !== 'STOCKS' && assetClass !== 'STOCK' && assetClass !== 'INDEX') {
        return false; // Corporate earnings NEVER affect Forex or Crypto!
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
        // EURUSD has EUR and USD
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
          `BLOCK: Active major news event '${event.title}' scheduled in ${diffMinutes.toFixed(1)}m (Blackout window: -${blackoutAfter}m to +${blackoutBefore}m).`
        );
      }
      // Check for CAUTION window (if not already BLOCK)
      else if (diffMinutes >= -cautionAfter && diffMinutes <= cautionBefore) {
        activeEvents.push(event);
        if (highestClassification !== 'BLOCK') {
          highestClassification = 'CAUTION';
        }
        reasons.push(
          `CAUTION: Approaching news event '${event.title}' in ${diffMinutes.toFixed(1)}m. Elevated volatility requires stronger confirmation score.`
        );
      }
    }

    const isTradingAllowed = highestClassification !== 'BLOCK';
    const requiredConfirmationScoreMultiplier =
      highestClassification === 'BLOCK' ? Infinity : highestClassification === 'CAUTION' ? 1.35 : 1.0;
    const minRequiredConfirmationScore =
      highestClassification === 'BLOCK' ? 1000 : highestClassification === 'CAUTION' ? 80 : 60;

    if (highestClassification === 'NORMAL') {
      reasons.push('NORMAL: No active or approaching asset-relevant news risk detected. Standard confirmation policy applies.');
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
      relevantEventsCount: activeEvents.length,
      reasons,
      explanation,
      neverFabricateSignalEnforced: true,
    };
  }
}
