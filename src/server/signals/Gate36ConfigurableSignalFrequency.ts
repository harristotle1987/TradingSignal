/**
 * GATE 36 — CONFIGURABLE SIGNAL FREQUENCY ENGINE
 *
 * Manages signal frequency configuration, daily caps, metric separation, and
 * portfolio exposure protection against correlated signal clustering.
 *
 * Requirements:
 * 1. Do not remove the daily cap. Keep cap active.
 * 2. Make cap configurable with supported presets: 5, 10, 15, CUSTOM.
 * 3. Separate metrics:
 *    - Candidate count: Total candidates/watchlist items evaluated in universe scan
 *    - Signal count: Total final confirmed signals generated (consumes quota slot)
 *    - Notification count: Total notifications actually delivered
 * 4. A candidate/watchlist item MUST NOT consume a signal slot. Only final confirmed signals consume signal quota.
 * 5. Prevent correlated signals from consuming the entire daily allocation (Cluster allocation cap).
 * 6. Maintain portfolio exposure protection.
 * 7. Do not increase default cap automatically (Default remains 5).
 */

import { serverConfig } from '../config.js';
import { ScannerPersistence } from './ScannerPersistence.js';
import { TradeRankingEngine } from './TradeRankingEngine.js';
import { logger } from '../logger.js';

export type SignalCapPreset = '5' | '10' | '15' | 'CUSTOM';

export interface FrequencyConfig {
  dailySignalCap: number;
  preset: SignalCapPreset;
  maxClusterAllocationPct: number;
}

export interface FrequencyMetrics {
  date: string;
  candidateCount: number;
  signalCount: number;
  notificationCount: number;
  dailySignalCap: number;
  preset: SignalCapPreset;
  remainingSignalSlots: number;
  maxSignalsPerCluster: number;
  clusterCountsToday: Record<string, number>;
}

export class Gate36ConfigurableSignalFrequency {
  private static config: FrequencyConfig = {
    dailySignalCap: 5, // Default remains 5 (not automatically increased)
    preset: '5',
    maxClusterAllocationPct: 0.40, // Max 40% of daily cap per correlation cluster
  };

  private static dailyCandidatesCount = 0;
  private static dailyNotificationsCount = 0;
  private static currentDate = new Date().toISOString().split('T')[0];

  /**
   * Checks and handles UTC date rollover for candidate and notification counters
   */
  public static checkRollover(): void {
    const today = new Date().toISOString().split('T')[0];
    if (this.currentDate !== today) {
      this.currentDate = today;
      this.dailyCandidatesCount = 0;
      this.dailyNotificationsCount = 0;
      logger.info(`[Gate 36 Frequency] Date rollover to ${today}. Reset candidate and notification counts.`);
    }
  }

  /**
   * Returns current signal frequency configuration
   */
  public static getConfig(): FrequencyConfig {
    const currentCap = serverConfig.getConfig().thresholds.dailySignalCap || this.config.dailySignalCap;
    return {
      dailySignalCap: currentCap,
      preset: this.config.preset,
      maxClusterAllocationPct: this.config.maxClusterAllocationPct,
    };
  }

  /**
   * Updates signal frequency configuration (supports 5, 10, 15, CUSTOM)
   */
  public static setConfig(params: {
    preset?: SignalCapPreset;
    customCap?: number;
    maxClusterAllocationPct?: number;
  }): FrequencyConfig {
    let newCap = 5;
    let preset: SignalCapPreset = params.preset || '5';

    if (preset === '5') newCap = 5;
    else if (preset === '10') newCap = 10;
    else if (preset === '15') newCap = 15;
    else if (preset === 'CUSTOM') {
      const customVal = typeof params.customCap === 'number' ? params.customCap : 5;
      newCap = Math.max(1, Math.min(100, Math.floor(customVal)));
    } else if (typeof params.customCap === 'number') {
      preset = 'CUSTOM';
      newCap = Math.max(1, Math.min(100, Math.floor(params.customCap)));
    }

    if (params.maxClusterAllocationPct && params.maxClusterAllocationPct > 0 && params.maxClusterAllocationPct <= 1) {
      this.config.maxClusterAllocationPct = params.maxClusterAllocationPct;
    }

    this.config.dailySignalCap = newCap;
    this.config.preset = preset;

    // Update serverConfig dynamically
    serverConfig.getConfig().thresholds.dailySignalCap = newCap;

    // Update ScannerPersistence local cap state
    ScannerPersistence.localData.capState.dailySignalCap = newCap;

    logger.info(`[Gate 36 Frequency] Updated daily signal cap to ${newCap} (Preset: ${preset})`);

    return this.getConfig();
  }

  /**
   * Increments candidate count (candidate/watchlist item).
   * NOTE: Candidate items do NOT consume a signal quota slot!
   */
  public static recordCandidateCount(count: number = 1): void {
    this.checkRollover();
    this.dailyCandidatesCount += count;
  }

  /**
   * Increments notification count when a notification is emitted.
   */
  public static recordNotificationCount(count: number = 1): void {
    this.checkRollover();
    this.dailyNotificationsCount += count;
  }

  /**
   * Calculates max signals allowed per correlation cluster based on current daily cap.
   */
  public static getMaxSignalsPerCluster(): number {
    const config = this.getConfig();
    return Math.max(1, Math.floor(config.dailySignalCap * config.maxClusterAllocationPct));
  }

  /**
   * Checks if a specific asset/cluster can accept an additional signal today
   * without violating portfolio exposure limits or consuming the entire daily allocation.
   */
  public static async evaluateClusterAllocation(
    symbol: string,
    clusterCountsToday?: Record<string, number>
  ): Promise<{ allowed: boolean; cluster: string; currentCount: number; maxAllowed: number; reason?: string }> {
    const cluster = TradeRankingEngine.getAssetCluster(symbol) || 'UNCLUSTERED';
    if (cluster === 'UNCLUSTERED') {
      return { allowed: true, cluster, currentCount: 0, maxAllowed: this.getConfig().dailySignalCap };
    }

    const maxAllowed = this.getMaxSignalsPerCluster();

    let counts = clusterCountsToday;
    if (!counts) {
      counts = await this.getClusterCountsToday();
    }

    const currentCount = counts[cluster] || 0;

    if (currentCount >= maxAllowed) {
      return {
        allowed: false,
        cluster,
        currentCount,
        maxAllowed,
        reason: `REJECTED: CORRELATION_CLUSTER_ALLOCATION_FULL. Risk cluster [${cluster}] reached daily cluster allocation limit (${currentCount}/${maxAllowed}) for daily signal cap (${this.getConfig().dailySignalCap}). Preserving remaining slots for uncorrelated assets.`,
      };
    }

    return { allowed: true, cluster, currentCount, maxAllowed };
  }

  /**
   * Computes current count of confirmed signals sent today grouped by risk cluster
   */
  public static async getClusterCountsToday(): Promise<Record<string, number>> {
    const sentToday = await ScannerPersistence.getSentSignalsToday();
    const counts: Record<string, number> = {};

    for (const sig of sentToday) {
      const cluster = TradeRankingEngine.getAssetCluster(sig.symbol) || 'UNCLUSTERED';
      if (cluster !== 'UNCLUSTERED') {
        counts[cluster] = (counts[cluster] || 0) + 1;
      }
    }

    return counts;
  }

  /**
   * Returns comprehensive frequency metrics separating candidate count, signal count, and notification count
   */
  public static async getMetrics(): Promise<FrequencyMetrics> {
    this.checkRollover();

    const config = this.getConfig();
    const capState = await ScannerPersistence.getCapState(config.dailySignalCap);
    const sentToday = await ScannerPersistence.getSentSignalsToday();
    const clusterCountsToday = await this.getClusterCountsToday();

    const candidateCount = this.dailyCandidatesCount;
    const signalCount = capState.dailySignalCount || sentToday.length;
    const notificationCount = this.dailyNotificationsCount || sentToday.filter(s => s.notificationSent).length;

    const remainingSignalSlots = Math.max(0, config.dailySignalCap - signalCount);
    const maxSignalsPerCluster = this.getMaxSignalsPerCluster();

    return {
      date: this.currentDate,
      candidateCount,
      signalCount,
      notificationCount,
      dailySignalCap: config.dailySignalCap,
      preset: config.preset,
      remainingSignalSlots,
      maxSignalsPerCluster,
      clusterCountsToday,
    };
  }
}
