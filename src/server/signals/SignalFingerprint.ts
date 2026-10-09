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
import { serverConfig } from '../config.js';
import { queryNeon, getNeonPool } from '../infrastructure/neon/db.js';

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

export class SignalFingerprint {
  private static records: Map<string, FingerprintRecord> = new Map();
  private static isInitialized = false;

  public static async initAsync(): Promise<void> {
    if (this.isInitialized) return;

    // 1. Load active fingerprints from Neon PostgreSQL if available
    if (getNeonPool()) {
      try {
        const minTime = Date.now() - serverConfig.getConfig().signalExpirationMs;
        const res = await queryNeon<any>(`SELECT fingerprint, symbol, direction, created_at FROM signal_fingerprints WHERE created_at >= $1`, [minTime]);
        const rows: any[] = Array.isArray(res) ? res : ((res as any)?.rows || []);
        if (rows.length > 0) {
          for (const row of rows) {
            this.records.set(row.fingerprint, {
              fingerprint: row.fingerprint,
              symbol: row.symbol,
              direction: row.direction,
              entryZone: 0,
              timeframe: '1h',
              primaryStrategy: 'consolidated',
              timestamp: Number(row.created_at),
            });
          }
          this.isInitialized = true;
          return;
        }
      } catch (err) {
        logger.warn('[SignalFingerprint] Could not load fingerprints from Neon DB:', err);
      }
    }

    // 2. Fallback to local snapshot
    try {
      if (fs.existsSync(FINGERPRINT_FILE_PATH)) {
        const raw = fs.readFileSync(FINGERPRINT_FILE_PATH, 'utf-8');
        const parsed: FingerprintRecord[] = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          const now = Date.now();
          for (const rec of parsed) {
            if (now - rec.timestamp < serverConfig.getConfig().signalExpirationMs) {
              this.records.set(rec.fingerprint, rec);
            }
          }
        }
      }
    } catch (err) {
      logger.warn('[SignalFingerprint] Could not load persisted fingerprints from file:', err);
    }
    this.isInitialized = true;
  }

  private static init(): void {
    if (this.isInitialized) return;
    this.initAsync().catch((err) => {
      logger.warn('[SignalFingerprint] Asynchronous init failed:', err);
    });
    this.isInitialized = true;
  }

  /**
   * Removes fingerprint records that have aged out of the
   * signal-expiration window. Runs on every write so neither the
   * in-memory Map nor the on-disk snapshot grow unbounded over a
   * long-running process.
   */
  private static pruneExpired(): void {
    const now = Date.now();
    const windowMs = serverConfig.getConfig().signalExpirationMs;
    for (const [key, rec] of this.records.entries()) {
      if (now - rec.timestamp >= windowMs) {
        this.records.delete(key);
      }
    }
  }

  private static persist(rec?: FingerprintRecord): void {
    if (getNeonPool() && rec) {
      const id = `fp_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      queryNeon(
        `INSERT INTO signal_fingerprints (id, fingerprint, symbol, direction, created_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (fingerprint) DO NOTHING`,
        [id, rec.fingerprint, rec.symbol, rec.direction, rec.timestamp]
      ).catch((err) => {
        logger.warn('[SignalFingerprint] DB persistence warning:', err);
      });
    }

    try {
      const arr = Array.from(this.records.values());
      fs.writeFileSync(FINGERPRINT_FILE_PATH, JSON.stringify(arr, null, 2), 'utf-8');
    } catch (err) {
      // safe
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
    windowMs: number = serverConfig.getConfig().signalExpirationMs
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
    this.pruneExpired();
    this.persist(rec);
    return fingerprint;
  }

  /**
   * Database Uniqueness/Idempotency Safeguard:
   * Atomically claims a fingerprint using Neon PostgreSQL UNIQUE constraint.
   * Returns true if newly claimed, false if duplicate/concurrently claimed by another Cron worker.
   */
  public static async claimFingerprintIdempotent(
    fingerprint: string,
    symbol: string,
    direction: string
  ): Promise<{ success: boolean; isDuplicate: boolean }> {
    this.init();
    const existing = this.checkDuplicateFingerprint(fingerprint);
    if (existing.isDuplicate) {
      return { success: false, isDuplicate: true };
    }

    if (getNeonPool()) {
      try {
        const id = `fp_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        const res = await queryNeon(
          `INSERT INTO signal_fingerprints (id, fingerprint, symbol, direction, created_at)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (fingerprint) DO NOTHING
           RETURNING id`,
          [id, fingerprint, symbol.toUpperCase(), direction.toUpperCase(), Date.now()]
        );
        if (Array.isArray(res) && res.length === 0) {
          // Already inserted concurrently by another transaction/Cron worker!
          return { success: false, isDuplicate: true };
        }
      } catch (err) {
        logger.warn('[SignalFingerprint] claimFingerprintIdempotent DB check error:', err);
      }
    }

    // Cache in memory for instant local deduplication
    this.records.set(fingerprint, {
      fingerprint,
      symbol: symbol.toUpperCase(),
      direction: direction.toUpperCase(),
      entryZone: 0,
      timeframe: '1h',
      primaryStrategy: 'claimed',
      timestamp: Date.now(),
    });
    this.pruneExpired();

    return { success: true, isDuplicate: false };
  }
}
