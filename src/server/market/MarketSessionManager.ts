/**
 * Strict Market Session Manager (Gate 3.1)
 * Manages trading calendars, exchange hours, weekends, and holidays.
 * Supports timezone conversion using Intl.DateTimeFormat to prevent local time leaks.
 * Includes a simulation mode with mock timestamps for deterministic testing.
 */

import { SymbolNormalizer } from './SymbolNormalizer.js';
import { logger } from '../logger.js';
import { marketCache, CACHE_TTL } from './CacheStore.js';

export type MarketSessionState = 'MARKET_OPEN' | 'MARKET_CLOSED' | 'OUTSIDE_TRADING_SESSION';

export interface DateTimeComponents {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: string; // 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'
  dateString: string; // 'YYYY-MM-DD'
  timeString: string; // 'HH:mm:ss'
  timeZoneAbbr: string; // 'EDT', 'EST', etc.
  formatted: string;
}

export class MarketSessionManager {
  private static mockTimestamp: number | null = null;
  private static lastStates = new Map<string, MarketSessionState>();

  // US Stock Exchange Holiday Calendars (NYSE/NASDAQ)
  private static readonly US_HOLIDAYS: Record<string, Set<string>> = {
    '2025': new Set([
      '2025-01-01', // New Year's Day
      '2025-01-20', // Martin Luther King Jr. Day
      '2025-02-17', // Presidents' Day
      '2025-04-18', // Good Friday
      '2025-05-26', // Memorial Day
      '2025-06-19', // Juneteenth
      '2025-07-04', // Independence Day
      '2025-09-01', // Labor Day
      '2025-11-27', // Thanksgiving Day
      '2025-12-25', // Christmas Day
    ]),
    '2026': new Set([
      '2026-01-01', // New Year's Day
      '2026-01-19', // Martin Luther King Jr. Day
      '2026-02-16', // Presidents' Day
      '2026-04-03', // Good Friday
      '2026-05-25', // Memorial Day
      '2026-06-19', // Juneteenth
      '2026-07-03', // Independence Day Observed
      '2026-09-07', // Labor Day
      '2026-11-26', // Thanksgiving Day
      '2026-12-25', // Christmas Day
    ]),
    '2027': new Set([
      '2027-01-01', // New Year's Day
      '2027-01-18', // Martin Luther King Jr. Day
      '2027-02-15', // Presidents' Day
      '2027-03-26', // Good Friday
      '2027-05-31', // Memorial Day
      '2027-06-18', // Juneteenth Observed
      '2027-07-05', // Independence Day Observed
      '2027-09-06', // Labor Day
      '2027-11-25', // Thanksgiving Day
      '2027-12-24', // Christmas Day Observed
    ]),
  };

  /**
   * Sets a simulated system time for testing. Pass null to resume real-time mode.
   */
  static setMockTimestamp(timestamp: number | null): void {
    if (process.env.NODE_ENV === 'production') {
      logger.warn('Mock timestamps are disabled in production environment');
      return;
    }
    this.mockTimestamp = timestamp;
    logger.info('Simulated system time updated', {
      timestamp,
      formatted: timestamp ? new Date(timestamp).toISOString() : 'REAL_TIME',
    });
  }

  /**
   * Returns the current operational timestamp (real or mock).
   */
  static getCurrentTimestamp(): number {
    if (process.env.NODE_ENV === 'production') {
      return Date.now();
    }
    return this.mockTimestamp !== null ? this.mockTimestamp : Date.now();
  }

  /**
   * Returns the operational Date object.
   */
  static getCurrentDate(): Date {
    return new Date(this.getCurrentTimestamp());
  }

  /**
   * Translates a Date into components for a specified timezone to preserve exact market-exchange timezone rules.
   */
  static getComponentsForTimeZone(date: Date, timeZone: string = 'America/New_York'): DateTimeComponents {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
      timeZoneName: 'short',
    });

    const parts = formatter.formatToParts(date);
    const getPart = (type: string) => parts.find((p) => p.type === type)?.value || '';

    const year = parseInt(getPart('year'), 10) || date.getUTCFullYear();
    const month = parseInt(getPart('month'), 10) || (date.getUTCMonth() + 1);
    const day = parseInt(getPart('day'), 10) || date.getUTCDate();
    const hour = parseInt(getPart('hour'), 10) || 0;
    const minute = parseInt(getPart('minute'), 10) || 0;
    const second = parseInt(getPart('second'), 10) || 0;
    const timeZoneAbbr = getPart('timeZoneName') || (timeZone === 'America/New_York' ? 'ET' : timeZone);

    const weekdayFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
    });
    const weekday = weekdayFormatter.format(date); // 'Sun', 'Mon', 'Tue', etc.

    const dateString = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const timeString = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`;
    const formatted = `${weekday} ${timeString} ${timeZoneAbbr} (${dateString})`;

    return { year, month, day, hour, minute, second, weekday, dateString, timeString, timeZoneAbbr, formatted };
  }

  /**
   * Translates a Date into New York components to preserve exact market-exchange timezone rules.
   */
  static getNYComponents(date: Date): DateTimeComponents {
    return this.getComponentsForTimeZone(date, 'America/New_York');
  }

  /**
   * Resolves the Asset Classification of any normalized symbol.
   */
  static getAssetClassification(symbol: string): 'CRYPTO' | 'STOCK' | 'FOREX' {
    const key = `${symbol}:metadata:classification`;
    const cached = marketCache.getGeneric<'CRYPTO' | 'STOCK' | 'FOREX'>(key);
    if (cached) return cached;

    const assetType = SymbolNormalizer.getAssetClassification(symbol);
    const result = assetType === 'FOREX' ? 'FOREX' : (assetType === 'STOCK' ? 'STOCK' : 'CRYPTO');
    
    marketCache.setGeneric(key, result, CACHE_TTL.SYMBOL_METADATA);
    return result;
  }

  /**
   * Checks the exact operational state of any market symbol.
   */
  static getSessionState(symbol: string): MarketSessionState {
    const key = `${symbol}:session_status`;
    const cached = marketCache.getGeneric<MarketSessionState>(key);
    if (cached) return cached;

    const state = this.getSessionStateRaw(symbol);
    marketCache.setGeneric(key, state, CACHE_TTL.MARKET_SESSION_STATUS);
    return state;
  }

  private static getSessionStateRaw(symbol: string): MarketSessionState {
    const assetType = this.getAssetClassification(symbol);
    const now = this.getCurrentDate();
    const ny = this.getNYComponents(now);

    if (assetType === 'CRYPTO') {
      return 'MARKET_OPEN'; // Crypto is 24/7/365
    }

    if (assetType === 'FOREX') {
      // Forex Weekend Lock: Sunday 17:00 (5:00 PM) NY time to Friday 17:00 (5:00 PM) NY time.
      if (ny.weekday === 'Sat') {
        return 'MARKET_CLOSED';
      }
      if (ny.weekday === 'Fri' && ny.hour >= 17) {
        return 'MARKET_CLOSED';
      }
      if (ny.weekday === 'Sun' && ny.hour < 17) {
        return 'MARKET_CLOSED';
      }
      return 'MARKET_OPEN';
    }

    if (assetType === 'STOCK') {
      // Stock Weekend check
      if (ny.weekday === 'Sat' || ny.weekday === 'Sun') {
        return 'MARKET_CLOSED';
      }

      // Holiday Check
      const yearStr = String(ny.year);
      if (this.US_HOLIDAYS[yearStr]?.has(ny.dateString)) {
        return 'MARKET_CLOSED';
      }

      // Exchange operational hours (Mon-Fri Eastern Time):
      // - Regular Trading: 09:30 to 16:00
      // - Pre-Market: 04:00 to 09:30
      // - After-Hours: 16:00 to 20:00
      const minutes = ny.hour * 60 + ny.minute;
      const regularStart = 9 * 60 + 30; // 09:30
      const regularEnd = 16 * 60;       // 16:00
      const preStart = 4 * 60;          // 04:00
      const afterEnd = 20 * 60;         // 20:00

      if (minutes >= regularStart && minutes < regularEnd) {
        return 'MARKET_OPEN';
      }
      if (minutes >= preStart && minutes < regularStart) {
        return 'OUTSIDE_TRADING_SESSION'; // Pre-market
      }
      if (minutes >= regularEnd && minutes < afterEnd) {
        return 'OUTSIDE_TRADING_SESSION'; // After-hours
      }

      return 'MARKET_CLOSED'; // Outside Pre/After hours (e.g. 20:00 to 04:00)
    }

    return 'MARKET_CLOSED';
  }

  /**
   * Tracks whether a market was closed and has just opened.
   * If yes, triggers the eviction of cache entries to force fresh pricing.
   */
  static checkTransitionAndGetFreshnessFlag(symbol: string): boolean {
    const clean = SymbolNormalizer.normalizeAppSymbol(symbol);
    const currentState = this.getSessionState(clean);
    const previousState = this.lastStates.get(clean);

    this.lastStates.set(clean, currentState);

    // If transitioned from anything that wasn't MARKET_OPEN, to MARKET_OPEN
    if (currentState === 'MARKET_OPEN' && previousState && previousState !== 'MARKET_OPEN') {
      logger.info('Detected market opening transition. Forcing fresh pricing.', { symbol: clean });
      return true; // Require a fresh quote bypass
    }

    return false;
  }
}
