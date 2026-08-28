/**
 * Scan-Level Request & Computation Caching Manager
 *
 * Requirement 5: Cache identical symbol, timeframe, indicator, and market requests
 * in memory during a scan cycle:
 *   const scanCache = new Map<string, Promise<any>>();
 */

import { logger } from '../logger.js';

export class ScanCacheManager {
  private static scanCache = new Map<string, Promise<any>>();

  /**
   * Retrieves an existing cached promise or executes the fetcher and caches its promise.
   */
  public static getOrFetch<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
    const cleanKey = key.trim().toLowerCase();
    if (this.scanCache.has(cleanKey)) {
      logger.debug(`[ScanCacheManager] HIT for key: ${cleanKey}`);
      return this.scanCache.get(cleanKey)! as Promise<T>;
    }

    const promise = fetcher().catch((err) => {
      // Remove failed request so future attempts in a new cycle can retry
      this.scanCache.delete(cleanKey);
      throw err;
    });

    this.scanCache.set(cleanKey, promise);
    return promise;
  }

  /**
   * Clears the scan-level cache at the start of every scan cycle.
   */
  public static clear(): void {
    const size = this.scanCache.size;
    this.scanCache.clear();
    if (size > 0) {
      logger.debug(`[ScanCacheManager] Cleared ${size} scan-level cache entries.`);
    }
  }

  /**
   * Returns current scan cache size for diagnostics.
   */
  public static size(): number {
    return this.scanCache.size;
  }
}
