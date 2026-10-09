/**
 * Asset & Strategy Cooldown Manager
 *
 * Enforces mandatory cooldown windows to eliminate repetitive or spammy signals:
 * 1. Asset Cooldown: 6-hour asset cooldown window (persisted in Neon PostgreSQL).
 * 2. Strategy Cooldown: 6-hour strategy cooldown window (persisted in Neon PostgreSQL).
 * 3. Early Replacement: Permitted ONLY when a documented material setup improvement occurs
 *    (score >= prev + 5 OR R:R >= prev + 0.5) AND the new signal passes all quality gates.
 */

import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../logger.js';
import { queryNeon, getNeonPool } from '../infrastructure/neon/db.js';

export interface CooldownRecord {
  symbol: string;
  lastAssetSignalMs: number;
  strategyCooldowns: Record<string, number>; // strategyId/name -> timestamp
}

const COOLDOWN_FILE_PATH = path.join(process.cwd(), 'cooldowns.json');

// Canonical 6-Hour Cooldown Windows per STEP 3
export const ASSET_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6 Hours
export const STRATEGY_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6 Hours

export class CooldownManager {
  private static cooldowns: Map<string, CooldownRecord> = new Map();
  private static isInitialized = false;

  public static async initAsync(): Promise<void> {
    if (this.isInitialized) return;

    // 1. Attempt loading from Neon/PostgreSQL first
    if (getNeonPool()) {
      try {
        const res = await queryNeon<any>(`SELECT symbol, last_asset_signal_ms, strategy_cooldowns FROM asset_cooldowns`);
        const rows: any[] = Array.isArray(res) ? res : ((res as any)?.rows || []);
        if (rows.length > 0) {
          for (const row of rows) {
            const sym = String(row.symbol).toUpperCase();
            let stratObj = row.strategy_cooldowns;
            if (typeof stratObj === 'string') {
              try { stratObj = JSON.parse(stratObj); } catch { stratObj = {}; }
            }
            this.cooldowns.set(sym, {
              symbol: sym,
              lastAssetSignalMs: Number(row.last_asset_signal_ms),
              strategyCooldowns: stratObj || {},
            });
          }
          this.isInitialized = true;
          return;
        }
      } catch (err) {
        logger.warn('[CooldownManager] Failed to load cooldowns from Neon database, checking local fallback:', err);
      }
    }

    // 2. Fallback to local file in development/testing mode
    try {
      if (fs.existsSync(COOLDOWN_FILE_PATH)) {
        const raw = fs.readFileSync(COOLDOWN_FILE_PATH, 'utf-8');
        const parsed: CooldownRecord[] = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            this.cooldowns.set(item.symbol.toUpperCase(), item);
          }
        }
      }
    } catch (err) {
      logger.warn('[CooldownManager] Failed to load persisted cooldowns from local file:', err);
    }
    this.isInitialized = true;
  }

  private static init(): void {
    if (this.isInitialized) return;
    this.initAsync().catch((err) => {
      logger.warn('[CooldownManager] Asynchronous init failed:', err);
    });
    this.isInitialized = true;
  }

  private static persist(rec?: CooldownRecord): void {
    // 1. Persist to Neon database if connected
    if (getNeonPool() && rec) {
      queryNeon(
        `INSERT INTO asset_cooldowns (symbol, last_asset_signal_ms, strategy_cooldowns, updated_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (symbol) DO UPDATE SET
           last_asset_signal_ms = EXCLUDED.last_asset_signal_ms,
           strategy_cooldowns = EXCLUDED.strategy_cooldowns,
           updated_at = EXCLUDED.updated_at`,
        [rec.symbol, rec.lastAssetSignalMs, JSON.stringify(rec.strategyCooldowns), Date.now()]
      ).catch((err) => {
        logger.warn('[CooldownManager] Failed to persist cooldown to Neon DB:', err);
      });
    }

    // 2. Also keep local file in sync for test/offline resilience
    try {
      const arr = Array.from(this.cooldowns.values());
      fs.writeFileSync(COOLDOWN_FILE_PATH, JSON.stringify(arr, null, 2), 'utf-8');
    } catch (err) {
      // Safe non-blocking warning
    }
  }

  /**
   * Evaluates whether an early replacement of an active/cooldown signal is permitted.
   * STRICT REQUIREMENT: Only permitted when a documented material setup improvement occurs
   * AND the candidate passes all quality gates.
   */
  public static canReplaceEarly(
    previous: { score?: number; riskRewardRatio?: number; entryPrice?: number },
    candidate: { score?: number; riskRewardRatio?: number; entryPrice?: number; passesQualityGates: boolean }
  ): { allowed: boolean; reason: string } {
    if (!candidate.passesQualityGates) {
      return { allowed: false, reason: 'REJECTED: Early replacement denied. Candidate failed mandatory quality gates.' };
    }

    const prevScore = previous.score ?? 0;
    const candScore = candidate.score ?? 0;
    const prevRR = previous.riskRewardRatio ?? 0;
    const candRR = candidate.riskRewardRatio ?? 0;

    const scoreImproved = candScore >= prevScore + 5;
    const rrImproved = candRR >= prevRR + 0.5;

    if (scoreImproved || rrImproved) {
      const details = scoreImproved
        ? `Score materially improved from ${prevScore} to ${candScore} (+${candScore - prevScore} pts)`
        : `R:R materially improved from ${prevRR.toFixed(2)}:1 to ${candRR.toFixed(2)}:1 (+${(candRR - prevRR).toFixed(2)})`;
      return { allowed: true, reason: `Material setup improvement documented: ${details}. Early replacement authorized.` };
    }

    return {
      allowed: false,
      reason: `No material setup improvement (Score ${candScore} vs prev ${prevScore}, R:R ${candRR.toFixed(2)} vs prev ${prevRR.toFixed(2)}). 6-hour cooldown enforced.`,
    };
  }

  /**
   * Checks if an asset is currently in Asset Cooldown (6 hours default)
   */
  public static isAssetInCooldown(
    symbol: string,
    cooldownMs: number = ASSET_COOLDOWN_MS
  ): { inCooldown: boolean; remainingMinutes: number; lastSignalMs?: number } {
    this.init();
    const sym = symbol.toUpperCase();
    const rec = this.cooldowns.get(sym);
    if (!rec || !rec.lastAssetSignalMs) {
      return { inCooldown: false, remainingMinutes: 0 };
    }

    const elapsed = Date.now() - rec.lastAssetSignalMs;
    if (elapsed < cooldownMs) {
      const remainingMinutes = Math.ceil((cooldownMs - elapsed) / (60 * 1000));
      return { inCooldown: true, remainingMinutes, lastSignalMs: rec.lastAssetSignalMs };
    }

    return { inCooldown: false, remainingMinutes: 0, lastSignalMs: rec.lastAssetSignalMs };
  }

  /**
   * Checks if a specific strategy on an asset is currently in Strategy Cooldown (6 hours default)
   */
  public static isStrategyInCooldown(
    symbol: string,
    strategyName: string,
    cooldownMs: number = STRATEGY_COOLDOWN_MS
  ): { inCooldown: boolean; remainingMinutes: number } {
    this.init();
    const sym = symbol.toUpperCase();
    const stratKey = strategyName.trim().toLowerCase();
    const rec = this.cooldowns.get(sym);

    if (!rec || !rec.strategyCooldowns || !rec.strategyCooldowns[stratKey]) {
      return { inCooldown: false, remainingMinutes: 0 };
    }

    const lastTime = rec.strategyCooldowns[stratKey];
    const elapsed = Date.now() - lastTime;
    if (elapsed < cooldownMs) {
      const remainingMinutes = Math.ceil((cooldownMs - elapsed) / (60 * 1000));
      return { inCooldown: true, remainingMinutes };
    }

    return { inCooldown: false, remainingMinutes: 0 };
  }

  /**
   * Records a signal emission timestamp for asset and strategy cooldown tracking
   */
  public static recordSignalEmit(symbol: string, strategyName: string, timestamp?: number): void {
    this.init();
    const sym = symbol.toUpperCase();
    const stratKey = strategyName.trim().toLowerCase();
    const now = timestamp || Date.now();

    let rec = this.cooldowns.get(sym);
    if (!rec) {
      rec = {
        symbol: sym,
        lastAssetSignalMs: now,
        strategyCooldowns: {},
      };
      this.cooldowns.set(sym, rec);
    } else {
      rec.lastAssetSignalMs = now;
    }

    if (!rec.strategyCooldowns) {
      rec.strategyCooldowns = {};
    }
    rec.strategyCooldowns[stratKey] = now;

    this.persist(rec);
  }

  /**
   * Clears cooldown for a symbol (e.g. upon trade completion or invalidation)
   */
  public static clearCooldown(symbol: string): void {
    this.init();
    const sym = symbol.toUpperCase();
    this.cooldowns.delete(sym);

    if (getNeonPool()) {
      queryNeon(`DELETE FROM asset_cooldowns WHERE symbol = $1`, [sym]).catch((err) => {
        logger.warn('[CooldownManager] Failed to delete cooldown record in Neon DB:', err);
      });
    }

    try {
      const arr = Array.from(this.cooldowns.values());
      fs.writeFileSync(COOLDOWN_FILE_PATH, JSON.stringify(arr, null, 2), 'utf-8');
    } catch {
      // safe
    }
  }
}
