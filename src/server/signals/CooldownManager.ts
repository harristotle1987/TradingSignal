/**
 * Asset & Strategy Cooldown Manager
 *
 * Enforces mandatory cooldown windows to eliminate repetitive or spammy signals:
 * 1. Asset Cooldown: Prevents emitting signals on the same symbol within a 4-hour window
 *    unless a material market structure change occurs.
 * 2. Strategy Cooldown: Prevents the same strategy from firing repeatedly on the same symbol
 *    within a 3-hour window.
 */

import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../logger.js';

export interface CooldownRecord {
  symbol: string;
  lastAssetSignalMs: number;
  strategyCooldowns: Record<string, number>; // strategyId/name -> timestamp
}

const COOLDOWN_FILE_PATH = path.join(process.cwd(), 'cooldowns.json');

// Default Cooldown Windows
export const ASSET_COOLDOWN_MS = 4 * 60 * 60 * 1000; // 4 Hours
export const STRATEGY_COOLDOWN_MS = 3 * 60 * 60 * 1000; // 3 Hours

export class CooldownManager {
  private static cooldowns: Map<string, CooldownRecord> = new Map();
  private static isInitialized = false;

  private static init(): void {
    if (this.isInitialized) return;
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
      logger.warn('[CooldownManager] Failed to load persisted cooldowns:', err);
    }
    this.isInitialized = true;
  }

  private static persist(): void {
    try {
      const arr = Array.from(this.cooldowns.values());
      fs.writeFileSync(COOLDOWN_FILE_PATH, JSON.stringify(arr, null, 2), 'utf-8');
    } catch (err) {
      logger.warn('[CooldownManager] Failed to persist cooldowns:', err);
    }
  }

  /**
   * Checks if an asset is currently in Asset Cooldown
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
   * Checks if a specific strategy on an asset is currently in Strategy Cooldown
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

    this.persist();
  }

  /**
   * Clears cooldown for a symbol (e.g. upon trade completion or invalidation)
   */
  public static clearCooldown(symbol: string): void {
    this.init();
    const sym = symbol.toUpperCase();
    this.cooldowns.delete(sym);
    this.persist();
  }
}
