/**
 * Signal Fingerprinting Engine
 *
 * Prevents duplicate or near-identical signals by generating a deterministic fingerprint:
 * Fingerprint = symbol + direction + quantizedEntryZone + timeframe + primaryStrategy
 *
 * Stores active fingerprints in memory and persistent cache to eliminate duplicate signals.
 */

import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../logger.js';

export interface FingerprintRecord {
  fingerprint: string;
  symbol: string;
  direction: string;
  entryZone: number;
  timeframe: string;
  primaryStrategy: string;
  timestamp: number;
}

const FINGERPRINT_FILE_PATH = path.join(process.cwd(), 'signal_fingerprints.json');
const DEFAULT_EXPIRATION_MS = 24 * 60 * 60 * 1000; // 24 hours duplicate prevention window

export class SignalFingerprint {
  private static records: Map<string, FingerprintRecord> = new Map();
  private static isInitialized = false;

  private static init(): void {
    if (this.isInitialized) return;
    try {
      if (fs.existsSync(FINGERPRINT_FILE_PATH)) {
        const raw = fs.readFileSync(FINGERPRINT_FILE_PATH, 'utf-8');
        const parsed: FingerprintRecord[] = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          const now = Date.now();
          for (const rec of parsed) {
            if (now - rec.timestamp < DEFAULT_EXPIRATION_MS) {
              this.records.set(rec.fingerprint, rec);
            }
          }
        }
      }
    } catch (err) {
      logger.warn('[SignalFingerprint] Could not load persisted fingerprints:', err);
    }
    this.isInitialized = true;
  }

  private static persist(): void {
    try {
      const arr = Array.from(this.records.values());
      fs.writeFileSync(FINGERPRINT_FILE_PATH, JSON.stringify(arr, null, 2), 'utf-8');
    } catch (err) {
      logger.warn('[SignalFingerprint] Could not save fingerprints to disk:', err);
    }
  }

  /**
   * Quantizes entry price into a discrete zone to catch near-identical entry prices
   */
  public static quantizeEntryZone(symbol: string, entryPrice: number, atr?: number): number {
    const sym = symbol.toUpperCase();
    if (atr && atr > 0) {
      // Step size is half ATR
      const step = atr * 0.5;
      return Math.round(entryPrice / step) * step;
    }

    // Default percentage step quantization
    if (sym.includes('USDT') || sym.includes('BTC') || sym.includes('ETH')) {
      const step = entryPrice * 0.005; // 0.5% bucket for crypto
      return Number((Math.round(entryPrice / step) * step).toFixed(2));
    } else if (sym.length === 6 && (sym.includes('USD') || sym.includes('EUR') || sym.includes('JPY'))) {
      const isJPY = sym.includes('JPY');
      const step = isJPY ? 0.25 : 0.0025; // 25 pips JPY / 25 pips standard
      return Number((Math.round(entryPrice / step) * step).toFixed(4));
    } else {
      const step = Math.max(0.25, entryPrice * 0.005); // $0.25 bucket for stocks
      return Number((Math.round(entryPrice / step) * step).toFixed(2));
    }
  }

  /**
   * Generates a deterministic fingerprint for a candidate signal
   */
  public static generateFingerprint(params: {
    symbol: string;
    direction: string;
    entryPrice: number;
    timeframe: string;
    primaryStrategy: string;
    atr?: number;
  }): string {
    const sym = params.symbol.trim().toUpperCase();
    const dir = params.direction.trim().toUpperCase();
    const tf = params.timeframe.trim().toLowerCase();
    const strat = params.primaryStrategy.trim().toLowerCase().replace(/\s+/g, '_');
    const entryZone = this.quantizeEntryZone(sym, params.entryPrice, params.atr);

    return `${sym}_${dir}_${entryZone}_${tf}_${strat}`;
  }

  /**
   * Checks if a fingerprint already exists within the expiration window
   */
  public static checkDuplicateFingerprint(
    fingerprint: string,
    windowMs: number = DEFAULT_EXPIRATION_MS
  ): { isDuplicate: boolean; previousRecord?: FingerprintRecord } {
    this.init();
    const now = Date.now();
    const rec = this.records.get(fingerprint);

    if (rec && now - rec.timestamp < windowMs) {
      return { isDuplicate: true, previousRecord: rec };
    }

    return { isDuplicate: false };
  }

  /**
   * Records a new fingerprint
   */
  public static recordFingerprint(params: {
    symbol: string;
    direction: string;
    entryPrice: number;
    timeframe: string;
    primaryStrategy: string;
    atr?: number;
    timestamp?: number;
  }): string {
    this.init();
    const fingerprint = this.generateFingerprint(params);
    const rec: FingerprintRecord = {
      fingerprint,
      symbol: params.symbol.trim().toUpperCase(),
      direction: params.direction.trim().toUpperCase(),
      entryZone: this.quantizeEntryZone(params.symbol, params.entryPrice, params.atr),
      timeframe: params.timeframe,
      primaryStrategy: params.primaryStrategy,
      timestamp: params.timestamp || Date.now(),
    };

    this.records.set(fingerprint, rec);
    this.persist();
    return fingerprint;
  }
}
