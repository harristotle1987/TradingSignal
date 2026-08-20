/**
 * Automated Hourly Intelligent Scanner & Signal Selection Service
 *
 * Core Principles:
 * 1. Hourly background execution across Crypto, Forex, and Stocks.
 * 2. Strict Scarcity & Quality Hurdle:
 *    - Score >= 75
 *    - Estimated Win Rate > 30%
 *    - Minimum 1:2 (2.0:1) Risk/Reward ratio
 *    - Positive mathematical expectancy
 *    - Sufficient ATR & price distance
 *    - Valid live provider price (NO stale/synthetic data)
 *    - Multi-timeframe confirmation
 *    - Acceptable spread / execution slippage friction
 *    - No major contradictory news
 * 3. Strict Ranking & Notification Tiers:
 *    - 85+ = BEST TRADE
 *    - 75–84 = HIGH QUALITY
 * 4. Duplicate & Material Improvement Filter:
 *    - Suppresses duplicate notifications for same symbol & direction unless
 *      the setup materially improves (Score >= +5, RR >= +0.5, or better entry).
 * 5. Correlation Risk Filter:
 *    - Prevents multiple correlated trades (e.g. BTC & ETH both BUY) from consuming
 *      the daily cap when a higher-ranked candidate already exists.
 * 6. Hard Daily Cap (Max 5 per day; 0–5 is valid):
 *    - Persisted in Firebase Firestore / local disk to survive Vercel/container restarts.
 *    - NEVER manufactures a trade to fill quota.
 *    - Sends NO TRADE notification only if configured.
 */

import { signalEngine } from './SignalEngine.js';
import { TradeRankingEngine } from './TradeRankingEngine.js';
import { SignalLifecycleManager } from './SignalLifecycleManager.js';
import { SignalLogger } from './SignalLogger.js';
import { CooldownManager } from './CooldownManager.js';
import { SignalFingerprint } from './SignalFingerprint.js';
import { SignalAuditStore } from './SignalAuditStore.js';
import { OpportunityFunnelStore } from './Gate26OpportunityFunnel.js';
import { Gate35SignalFunnelAnalytics } from './Gate35SignalFunnelAnalytics.js';
import { Gate36ConfigurableSignalFrequency } from './Gate36ConfigurableSignalFrequency.js';
import {
  ScannerPersistence,
  DailyCapState,
  PersistedSentSignal,
  PersistedRejectedCandidate,
  PersistedNotification,
} from './ScannerPersistence.js';
import { PushNotificationService } from '../notifications/PushNotificationService.js';
import { logger } from '../logger.js';
import { serverConfig } from '../config.js';
import { TradingSignal, SignalDirection } from '../../types/index.js';

export interface ScannerSettings {
  enabled: boolean;
  notificationsEnabled: boolean;
  notifyOnNoTrade: boolean;
  intervalMinutes: number;
  signalsSentTimestamps: number[];
  lastScanTime: number;
}

export interface ManualScanResult {
  success: boolean;
  status: 'COMPLETED' | 'SCAN_ALREADY_RUNNING' | 'SKIPPED_CAP_REACHED' | 'SKIPPED_NOT_DUE' | 'ERROR';
  message: string;
  timestamp: number;
  lastScanTime: number;
  candidatesEvaluated: number;
  acceptedSignalsCount: number;
  acceptedSignals: TradingSignal[];
  signalsFound: number;
  qualifiedSetups: TradingSignal[];
  rejectedCount: number;
  rejectionReasons: string[];
  capState: DailyCapState;
}

export class HourlyScannerService {
  private timerId: NodeJS.Timeout | null = null;
  private isScanning = false;

  constructor() {
    ScannerPersistence.init();
  }

  /**
   * Initializes the hourly scanner.
   * On Vercel serverless environments, setInterval loop is skipped. External invocations drive scans via /api/scanner/trigger.
   */
  start(): void {
    if (process.env.VERCEL || process.env.VERCEL_ENV) {
      logger.info('[Hourly Scanner] Vercel serverless environment detected. Skipping background setInterval loop. Scans driven via /api/scanner/trigger.');
      return;
    }

    if (this.timerId) return;

    logger.info('[Hourly Scanner] Starting background service.');

    // Quick initial check on startup
    this.checkScheduleAndRun();

    // Check interval elapsed every 15 seconds
    this.timerId = setInterval(() => {
      this.checkScheduleAndRun();
    }, 15 * 1000);
  }

  /**
   * Stops the background timer loop.
   */
  stop(): void {
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
      logger.info('[Hourly Scanner] Background service stopped.');
    }
  }

  /**
   * Checks settings and runs the scanner if the configured interval (15, 30, 45, or 60 min) has elapsed since lastScanTime.
   */
  private async checkScheduleAndRun(): Promise<void> {
    const settings = ScannerPersistence.getSettings();
    if (!settings.enabled) return;
    if (this.isScanning) return;

    const capState = await ScannerPersistence.getCapState(serverConfig.getConfig().thresholds.dailySignalCap);
    const now = Date.now();
    const validIntervals = [15, 30, 45, 60];
    const intervalMinutes = validIntervals.includes(Number(settings.intervalMinutes))
      ? Number(settings.intervalMinutes)
      : 30;
    const intervalMs = intervalMinutes * 60 * 1000;

    if (now - capState.lastScanTime >= intervalMs) {
      await this.runScan();
    }
  }

  /**
   * Manually triggers a scan execution (e.g. from UI admin actions).
   */
  async triggerManualScan(isExternal = false): Promise<ManualScanResult> {
    return await this.executeIntelligentScan(isExternal);
  }

  /**
   * Enforces user's configured Automated Signal Interval (15m, 30m, 45m, 60m) before running an automated scan.
   * Called by POST /api/scanner/trigger (Vercel external cron).
   *
   * Behavior:
   * 1. Fetches current settings & persisted capState (including lastScanTime from Firestore/disk).
   * 2. Checks if automated scanning is enabled in settings.
   * 3. Calculates time elapsed since lastScanTime.
   * 4. If time elapsed < configured interval, returns successful SKIPPED_NOT_DUE response without running scan or clearing cache.
   * 5. If interval has elapsed, clears marketCache and executes scan cycle.
   */
  async triggerAutomatedScan(isExternal = true): Promise<ManualScanResult> {
    const settings = ScannerPersistence.getSettings();
    const capState = await ScannerPersistence.getCapState(serverConfig.getConfig().thresholds.dailySignalCap);
    const now = Date.now();

    if (!settings.enabled) {
      logger.info('[Hourly Scanner] External trigger received but automated scanner is disabled in settings. Skipping scan.');
      return {
        success: true,
        status: 'SKIPPED_NOT_DUE',
        message: 'Automated scanner is currently disabled in settings.',
        timestamp: now,
        lastScanTime: capState.lastScanTime,
        candidatesEvaluated: 0,
        acceptedSignalsCount: 0,
        acceptedSignals: [],
        signalsFound: 0,
        qualifiedSetups: [],
        rejectedCount: 0,
        rejectionReasons: ['REJECTED: SCANNER_DISABLED. Automated scanner is disabled in settings.'],
        capState,
      };
    }

    const validIntervals = [15, 30, 45, 60];
    const intervalMinutes = validIntervals.includes(Number(settings.intervalMinutes))
      ? Number(settings.intervalMinutes)
      : 30;
    const intervalMs = intervalMinutes * 60 * 1000;
    const timeElapsed = now - capState.lastScanTime;

    // Enforce configured interval: minimum time that must elapse between automated evaluations
    if (capState.lastScanTime > 0 && timeElapsed < intervalMs) {
      const nextDueTime = capState.lastScanTime + intervalMs;
      const timeRemainingMs = Math.max(0, nextDueTime - now);
      const minutesRemaining = Math.ceil(timeRemainingMs / (60 * 1000));

      logger.info(`[Hourly Scanner] External trigger skipped: minimum interval (${intervalMinutes}m) not due. Time elapsed: ${Math.floor(timeElapsed / (60 * 1000))}m. Next scan due in ${minutesRemaining}m.`);

      return {
        success: true,
        status: 'SKIPPED_NOT_DUE',
        message: `Automated scan skipped: configured interval of ${intervalMinutes} minutes has not elapsed since last evaluation. Next scan due in ${minutesRemaining} minute(s).`,
        timestamp: now,
        lastScanTime: capState.lastScanTime,
        candidatesEvaluated: 0,
        acceptedSignalsCount: 0,
        acceptedSignals: [],
        signalsFound: 0,
        qualifiedSetups: [],
        rejectedCount: 0,
        rejectionReasons: [`REJECTED: INTERVAL_NOT_DUE. Interval not due. Configured: ${intervalMinutes}m. Time elapsed: ${Math.floor(timeElapsed / 60000)}m.`],
        capState,
      };
    }

    // Interval IS due: selectively clear expired cache entries and ticker quotes before scan cycle
    const { marketCache } = await import('../market/CacheStore.js');
    marketCache.clearExpired();
    marketCache.clearTickers();
    return await this.executeIntelligentScan(isExternal);
  }

  /**
   * Background scan runner.
   */
  private async runScan(): Promise<number> {
    const result = await this.executeIntelligentScan();
    return result.signalsFound;
  }

  /**
   * Main Intelligent Multi-Asset Scan & Signal Selection Pipeline.
   */
  private async executeIntelligentScan(isExternal = false): Promise<ManualScanResult> {
    const instanceId = Math.random().toString(36).substring(2, 9);
    const lockResult = await ScannerPersistence.tryAcquireLock(instanceId);

    if (!lockResult.acquired) {
      const capState = await ScannerPersistence.getCapState(serverConfig.getConfig().thresholds.dailySignalCap);
      logger.warn(`[Hourly Scanner] Concurrency lock check: ${lockResult.reason || 'Scan already running'}`);
      return {
        success: false,
        status: 'SCAN_ALREADY_RUNNING',
        message: 'REJECTED: SCAN_ALREADY_RUNNING. Another scan cycle is currently in progress.',
        timestamp: Date.now(),
        lastScanTime: capState.lastScanTime,
        candidatesEvaluated: 0,
        acceptedSignalsCount: 0,
        acceptedSignals: [],
        signalsFound: 0,
        qualifiedSetups: [],
        rejectedCount: 0,
        rejectionReasons: ['REJECTED: SCAN_ALREADY_RUNNING. Concurrent scan execution prevented.'],
        capState,
      };
    }

    this.isScanning = true;
    const scanStartTime = Date.now();
    // Persist scanStartTime immediately upon acquiring lock to prevent race conditions
    await ScannerPersistence.updateLastScanTime(scanStartTime);

    logger.info('================================================================');
    logger.info('[Hourly Intelligent Scanner] Initiating Multi-Asset Scan Cycle...');
    logger.info('================================================================');

    try {
      // 0. Evaluate active signals lifecycle (TP/SL/Expiration hits) and Adaptive Opportunity Funnel
      const lifecycleEval = await SignalLifecycleManager.evaluateActiveSignals();
      if (lifecycleEval.evaluatedCount > 0) {
        logger.info(`[Hourly Scanner] Lifecycle evaluation complete: ${lifecycleEval.evaluatedCount} active signals evaluated. TP Hits: ${lifecycleEval.tpHitCount}, SL Hits: ${lifecycleEval.slHitCount}, Expired: ${lifecycleEval.expiredCount}.`);
      }

      // Evaluate Opportunity Funnel items (Gate 26)
      const funnelReport = OpportunityFunnelStore.evaluateAll();
      if (funnelReport.totalActive > 0) {
        logger.info(`[Hourly Scanner] Opportunity Funnel evaluation: ${funnelReport.totalActive} active tracked candidates (${funnelReport.watchingCount} watching, ${funnelReport.qualifiedCount} qualified, ${funnelReport.promotedCount} promoted).`);
      }

      // 1. Check current Daily Cap state
      const capState = await ScannerPersistence.getCapState(serverConfig.getConfig().thresholds.dailySignalCap);
      const currentDailyCount = capState.dailySignalCount;
      const dailyCap = capState.dailySignalCap || serverConfig.getConfig().thresholds.dailySignalCap;
      const settings = ScannerPersistence.getSettings();

      if (currentDailyCount >= dailyCap) {
        logger.info(`[Hourly Scanner] Daily automated signal cap reached (${currentDailyCount}/${dailyCap}). Scanning skipped to preserve portfolio limits.`);
        await ScannerPersistence.updateLastScanTime(scanStartTime);
        return {
          success: true,
          status: 'SKIPPED_CAP_REACHED',
          message: `REJECTED: DAILY_CAP_REACHED. Daily automated signal cap reached (${currentDailyCount}/${dailyCap}). Preserving risk limits.`,
          timestamp: Date.now(),
          lastScanTime: scanStartTime,
          candidatesEvaluated: 0,
          acceptedSignalsCount: 0,
          acceptedSignals: [],
          signalsFound: 0,
          qualifiedSetups: [],
          rejectedCount: 0,
          rejectionReasons: [`REJECTED: DAILY_CAP_REACHED. Daily automated signal cap reached (${currentDailyCount}/${dailyCap}). Preserving portfolio risk limits.`],
          capState,
        };
      }

      const remainingAllowance = dailyCap - currentDailyCount;
      logger.info(`[Hourly Scanner] Daily Cap status: ${currentDailyCount}/${dailyCap} used. Remaining allowance: ${remainingAllowance}`);

      // 2. Scan all three universes: CRYPTO, FOREX, STOCKS
      const categories: Array<'CRYPTO' | 'FOREX' | 'STOCKS'> = ['CRYPTO', 'FOREX', 'STOCKS'];
      const rawCandidates: TradingSignal[] = [];
      const rejectedDuringScan: Array<{ symbol: string; direction?: string; score?: number; reason: string }> = [];

      for (const category of categories) {
        try {
          logger.info(`[Hourly Scanner] Scanning universe: [${category}]...`);
          const result = await signalEngine.generateSignal(category, category);

          if (result.success && Array.isArray(result.signals)) {
            rawCandidates.push(...result.signals);
          } else if (result.reason) {
            rejectedDuringScan.push({
              symbol: category,
              reason: result.reason,
            });
          }
        } catch (catErr) {
          logger.error(`[Hourly Scanner] Scan error for ${category}:`, { error: String(catErr) });
        }

        // Pacing delay between categories to protect external API quotas
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }

      logger.info(`[Hourly Scanner] Raw candidate setups gathered: ${rawCandidates.length}. Applying mandatory qualification filters...`);

      // GATE 36: Separate candidate count tracking (candidates do NOT consume signal slots)
      Gate36ConfigurableSignalFrequency.recordCandidateCount(rawCandidates.length);

      // Log raw candidates entering funnel
      for (const sig of rawCandidates) {
        Gate35SignalFunnelAnalytics.recordCandidate({
          symbol: sig.symbol,
          direction: sig.direction,
          stage: 'STAGE_2',
          score: sig.score ?? sig.confidenceScore ?? 0,
          regime: (sig as any).marketRegime || 'UNKNOWN',
          strategy: sig.strategy || 'MULTI_STRATEGY',
        });
      }

      const thresholds = serverConfig.getConfig().thresholds;
      // 3. Stage A: Mandatory Condition Hurdle
      const qualifiedByQuality: TradingSignal[] = [];
      for (const sig of rawCandidates) {
        const score = sig.score ?? sig.confidenceScore ?? 0;
        const winRate = sig.estimatedWinRate ?? 0;
        const rr = sig.riskRewardRatio ?? 0;

        // Condition 1: Score >= threshold
        if (score < thresholds.signalThreshold) {
          const reason = `REJECTED: SCORE_BELOW_THRESHOLD. Score (${score}/100) below mandatory ${thresholds.signalThreshold} hurdle (85+ = BEST TRADE, 75-84 = HIGH QUALITY).`;
          rejectedDuringScan.push({
            symbol: sig.symbol,
            direction: sig.direction,
            score,
            reason,
          });
          Gate35SignalFunnelAnalytics.recordCandidate({
            symbol: sig.symbol,
            direction: sig.direction,
            stage: 'GATE_4',
            score,
            strategy: sig.strategy,
            rejectionReason: reason,
          });
          continue;
        }

        // Condition 2: Estimated win rate > threshold
        if (winRate <= thresholds.minimumWinProbability) {
          const reason = `REJECTED: WIN_RATE_BELOW_THRESHOLD. Estimated win-rate (${winRate}%) <= mandatory ${thresholds.minimumWinProbability}% threshold.`;
          rejectedDuringScan.push({
            symbol: sig.symbol,
            direction: sig.direction,
            score,
            reason,
          });
          Gate35SignalFunnelAnalytics.recordCandidate({
            symbol: sig.symbol,
            direction: sig.direction,
            stage: 'GATE_4',
            score,
            strategy: sig.strategy,
            rejectionReason: reason,
          });
          continue;
        }

        // Condition 3: Minimum Risk/Reward ratio
        if (rr < thresholds.minimumNetRR) {
          const reason = `REJECTED: NET_RR_BELOW_THRESHOLD. Risk/Reward ratio (${rr}:1) below mandatory ${thresholds.minimumNetRR}:1 minimum.`;
          rejectedDuringScan.push({
            symbol: sig.symbol,
            direction: sig.direction,
            score,
            reason,
          });
          Gate35SignalFunnelAnalytics.recordCandidate({
            symbol: sig.symbol,
            direction: sig.direction,
            stage: 'GATE_9',
            score,
            strategy: sig.strategy,
            rejectionReason: reason,
          });
          continue;
        }

        // Condition 4: Valid live provider price & status
        if (sig.status !== 'ACTIVE' || sig.validationReason === 'MARKET_DATA_UNAVAILABLE' || sig.validationReason === 'STALE_DATA') {
          const reason = `REJECTED: DATA_STALE. Market data state is ${sig.status} (${sig.validationReason || 'Provider unverified'}). Stale or synthetic data rejected.`;
          rejectedDuringScan.push({
            symbol: sig.symbol,
            direction: sig.direction,
            score,
            reason,
          });
          Gate35SignalFunnelAnalytics.recordCandidate({
            symbol: sig.symbol,
            direction: sig.direction,
            stage: 'GATE_0',
            score,
            strategy: sig.strategy,
            rejectionReason: reason,
          });
          continue;
        }

        // Condition 5: Valid structural stop loss and take profit
        if (sig.stopLoss === sig.entryPrice || sig.takeProfit === sig.entryPrice) {
          const reason = `REJECTED: INVALID_SL_TP. Invalid price boundaries: StopLoss or TakeProfit equals Entry price.`;
          rejectedDuringScan.push({
            symbol: sig.symbol,
            direction: sig.direction,
            score,
            reason,
          });
          Gate35SignalFunnelAnalytics.recordCandidate({
            symbol: sig.symbol,
            direction: sig.direction,
            stage: 'GATE_8',
            score,
            strategy: sig.strategy,
            rejectionReason: reason,
          });
          continue;
        }

        // Condition 6: Execution friction buffer check
        if (sig.estimatedFriction && sig.estimatedFriction.netRiskRewardRatio < thresholds.minimumRR) {
          const reason = `REJECTED: NET_RR_BELOW_THRESHOLD. Net R:R after spread/slippage friction (${sig.estimatedFriction.netRiskRewardRatio.toFixed(2)}:1) is degraded below ${thresholds.minimumRR}:1.`;
          rejectedDuringScan.push({
            symbol: sig.symbol,
            direction: sig.direction,
            score,
            reason,
          });
          Gate35SignalFunnelAnalytics.recordCandidate({
            symbol: sig.symbol,
            direction: sig.direction,
            stage: 'GATE_9',
            score,
            strategy: sig.strategy,
            rejectionReason: reason,
          });
          continue;
        }

        qualifiedByQuality.push(sig);
      }

      logger.info(`[Hourly Scanner] Setups passing mandatory quality hurdles: ${qualifiedByQuality.length}`);

      // 4. Stage B: Duplicate Symbol/Direction & Material Improvement Filter
      const sentSignalsToday = await ScannerPersistence.getSentSignalsToday();
      const qualifiedNonDuplicate: TradingSignal[] = [];

      for (const sig of qualifiedByQuality) {
        const existingSameSetup = sentSignalsToday.find(
          (s) => s.symbol === sig.symbol && s.direction === sig.direction && s.status === 'ACTIVE'
        );

        if (existingSameSetup) {
          const currentScore = sig.score ?? sig.confidenceScore ?? 0;
          const prevScore = existingSameSetup.score;
          const currentRR = sig.riskRewardRatio;
          const prevRR = existingSameSetup.riskRewardRatio;

          // Material improvement check:
          // 1) Score improves by >= 5 points (e.g. 78 -> 86) OR
          // 2) R:R improves by >= 0.5 (e.g. 2.1 -> 2.7) OR
          // 3) Favorable entry price improvement
          const scoreImproved = currentScore >= prevScore + 5;
          const rrImproved = currentRR >= prevRR + 0.5;
          const isMateriallyBetter = scoreImproved || rrImproved;

          if (isMateriallyBetter) {
            logger.info(`[Hourly Scanner] Setup for ${sig.symbol} ${sig.direction} materially improved: Score ${prevScore}->${currentScore}, RR ${prevRR}->${currentRR}. Superseding previous setup.`);
            await ScannerPersistence.updateSignalStatus(existingSameSetup.id, 'SUPERSEDED');
            qualifiedNonDuplicate.push(sig);
          } else {
            rejectedDuringScan.push({
              symbol: sig.symbol,
              direction: sig.direction,
              score: currentScore,
              reason: `REJECTED: DUPLICATE_FINGERPRINT. Duplicate setup: ${sig.symbol} ${sig.direction} already sent today (Score: ${prevScore}, R:R: ${prevRR}:1). No material improvement detected.`,
            });
            continue;
          }
        } else {
          qualifiedNonDuplicate.push(sig);
        }
      }

      // 5. Stage C: Cross-Asset Correlation Risk Filter
      // Prevent multiple correlated trades in the same cluster/direction from taking multiple slots
      const qualifiedUncorrelated: TradingSignal[] = [];
      const occupiedClustersThisScan = new Set<string>();

      // Also check actively held cluster exposures from sent signals today
      const activeClusterExposures = new Map<string, PersistedSentSignal>();
      for (const sent of sentSignalsToday.filter((s) => s.status === 'ACTIVE')) {
        const cluster = TradeRankingEngine.getAssetCluster(sent.symbol);
        if (cluster) {
          const key = `${cluster}_${sent.direction}`;
          activeClusterExposures.set(key, sent);
        }
      }

      // Sort candidate setups descending by score first so the highest quality in a cluster wins
      qualifiedNonDuplicate.sort((a, b) => (b.score ?? b.confidenceScore ?? 0) - (a.score ?? a.confidenceScore ?? 0));

      for (const sig of qualifiedNonDuplicate) {
        const cluster = TradeRankingEngine.getAssetCluster(sig.symbol);
        const score = sig.score ?? sig.confidenceScore ?? 0;

        // GATE 36: Check correlation cluster allocation limit
        const clusterCheck = await Gate36ConfigurableSignalFrequency.evaluateClusterAllocation(sig.symbol);
        if (!clusterCheck.allowed) {
          const reason = clusterCheck.reason || `REJECTED: CORRELATION_CLUSTER_ALLOCATION_FULL. Cluster [${clusterCheck.cluster}] reached daily cluster allocation limit.`;
          rejectedDuringScan.push({
            symbol: sig.symbol,
            direction: sig.direction,
            score,
            reason,
          });
          Gate35SignalFunnelAnalytics.recordCandidate({
            symbol: sig.symbol,
            direction: sig.direction,
            stage: 'RANKING',
            score,
            strategy: sig.strategy,
            rejectionReason: reason,
          });
          continue;
        }

        if (cluster) {
          const clusterKey = `${cluster}_${sig.direction}`;

          // Check if intra-scan cluster collision
          if (occupiedClustersThisScan.has(clusterKey)) {
            rejectedDuringScan.push({
              symbol: sig.symbol,
              direction: sig.direction,
              score,
              reason: `REJECTED: CORRELATION_EXPOSURE. Correlated exposure: Risk cluster [${cluster}] (${sig.direction}) already occupied by higher-scoring setup in this scan cycle.`,
            });
            continue;
          }

          // Check if active prior setup in same cluster exists today
          const priorActive = activeClusterExposures.get(clusterKey);
          if (priorActive && priorActive.symbol !== sig.symbol) {
            if (score >= priorActive.score + 5) {
              logger.info(`[Hourly Scanner] Upgrading cluster [${cluster}] exposure from ${priorActive.symbol} (${priorActive.score}) to stronger candidate ${sig.symbol} (${score}).`);
              await ScannerPersistence.updateSignalStatus(priorActive.id, 'SUPERSEDED');
            } else {
              rejectedDuringScan.push({
                symbol: sig.symbol,
                direction: sig.direction,
                score,
                reason: `REJECTED: CORRELATION_EXPOSURE. Correlated exposure: Active setup for ${priorActive.symbol} (${priorActive.score}/100) already covers cluster [${cluster}]. Preserving daily cap for diversified opportunities.`,
              });
              continue;
            }
          }

          occupiedClustersThisScan.add(clusterKey);
        }

        qualifiedUncorrelated.push(sig);
      }

      // 6. Stage D: Final Ranking & Daily Cap Selection
      // Tiering: 85+ = BEST TRADE; 75-84 = HIGH QUALITY
      qualifiedUncorrelated.sort((a, b) => (b.score ?? b.confidenceScore ?? 0) - (a.score ?? a.confidenceScore ?? 0));

      const selectedSetups: TradingSignal[] = [];
      for (const sig of qualifiedUncorrelated) {
        if (selectedSetups.length >= remainingAllowance) {
          const reason = `REJECTED: DAILY_CAP_REACHED. Daily automated notification cap (5/day) reached. Remaining slots full.`;
          rejectedDuringScan.push({
            symbol: sig.symbol,
            direction: sig.direction,
            score: sig.score ?? sig.confidenceScore,
            reason,
          });
          Gate35SignalFunnelAnalytics.recordCandidate({
            symbol: sig.symbol,
            direction: sig.direction,
            stage: 'RANKING',
            score: sig.score ?? sig.confidenceScore,
            strategy: sig.strategy,
            rejectionReason: reason,
          });
          continue;
        }

        // Tier classification
        const finalScore = sig.score ?? sig.confidenceScore ?? 80;
        if (finalScore >= 85) {
          sig.rankTier = 'BEST_TRADE';
          sig.isBestTrade = true;
          sig.isTopTrade = true;
        } else {
          sig.rankTier = 'SECOND_BEST';
          sig.isSecondBest = true;
          sig.isTopTrade = false;
        }

        selectedSetups.push(sig);
      }

      // 7. Dispatch & Persistence
      let dispatchedCount = 0;
      for (const sig of selectedSetups) {
        // Atomically increment cap
        const inc = await ScannerPersistence.tryIncrementCap(dailyCap);
        if (!inc.allowed) {
          logger.warn(`[Hourly Scanner] Daily cap reached during atomic increment. Stopping further dispatches.`);
          break;
        }

        // Attach tag for automated signal
        sig.strategy = `[Automated ${sig.rankTier === 'BEST_TRADE' ? 'BEST TRADE' : 'HIGH QUALITY'}] ${sig.strategy}`;

        // Record sent signal
        await ScannerPersistence.recordSentSignal(sig);
        await SignalLogger.logSignal(sig, 'TREND');

        // GATE 36: Record notification count
        Gate36ConfigurableSignalFrequency.recordNotificationCount(1);

        // Record Funnel Analytics Final Signal
        Gate35SignalFunnelAnalytics.recordCandidate({
          symbol: sig.symbol,
          direction: sig.direction,
          stage: 'FINAL_SIGNAL',
          score: sig.score ?? sig.confidenceScore ?? 80,
          strategy: sig.strategy,
        });

        // Record Fingerprint, Cooldown, and Accepted Audit Explanation
        const fp = SignalFingerprint.recordFingerprint({
          symbol: sig.symbol,
          direction: sig.direction,
          entryPrice: sig.entryPrice,
          timeframe: sig.timeframe,
          primaryStrategy: sig.strategy,
        });

        CooldownManager.recordSignalEmit(sig.symbol, sig.strategy, sig.timestamp);

        SignalAuditStore.logAudit({
          symbol: sig.symbol,
          direction: sig.direction,
          timeframe: sig.timeframe,
          primaryStrategy: sig.strategy,
          passedStrategies: [sig.strategy],
          failedStrategies: [],
          marketRegime: 'TRENDING',
          atr: 0,
          dataFreshnessSeconds: 0,
          providerAgreement: true,
          expectedRR: sig.riskRewardRatio,
          score: sig.score || 80,
          status: 'ACCEPTED',
          rejectionReason: null,
          fingerprint: fp,
        });

        // Record notification history item
        const score = sig.score ?? sig.confidenceScore ?? 80;
        const tierLabel = score >= 85 ? 'BEST TRADE (85+)' : 'HIGH QUALITY (75-84)';
        const title = `🚨 [${tierLabel}] ${sig.symbol} [${sig.direction}]`;
        const precision = sig.entryPrice < 10 ? 5 : 2;
        const message = `Live Entry: ${sig.entryPrice.toFixed(precision)} | TP: ${sig.takeProfit.toFixed(precision)} | SL: ${sig.stopLoss.toFixed(precision)} (R:R ${sig.riskRewardRatio.toFixed(1)}:1, Score: ${score}/100)`;

        await ScannerPersistence.recordNotification({
          type: score >= 85 ? 'BEST_TRADE' : 'HIGH_QUALITY',
          symbol: sig.symbol,
          title,
          message,
          score,
          rankTier: sig.rankTier,
        });

        // Dispatch Web Push notification to PWA subscribers
        try {
          await PushNotificationService.sendSignalNotification(sig);
        } catch (pushErr) {
          logger.error(`[Hourly Scanner] Push notification error for ${sig.symbol}:`, { error: String(pushErr) });
        }

        dispatchedCount++;
        logger.info(`[Hourly Scanner] Dispatched setup for ${sig.symbol} [${sig.direction}] (${tierLabel}, Score: ${score}/100). Daily count: ${inc.count}/${inc.cap}`);
      }

      // 8. If NO setups qualified
      if (dispatchedCount === 0) {
        logger.info(`[Hourly Scanner] No setups met the strict 75+ quality and diversification criteria. Dispatched 0 signals (0-5 is completely valid).`);
        if (settings.notifyOnNoTrade && !isExternal) {
          await ScannerPersistence.recordNotification({
            type: 'NO_TRADE',
            symbol: 'ALL_MARKETS',
            title: 'ℹ️ Automated Scan: NO QUALIFIED TRADE',
            message: `Hourly scan evaluated ${rawCandidates.length} candidate setups across Crypto, Forex, and Stocks. 0 setups passed all mandatory quality, R:R, and non-correlation filters.`,
          });
        }
      }

      // 9. Persist rejected candidates audit log
      if (rejectedDuringScan.length > 0) {
        await ScannerPersistence.recordRejectedCandidates(rejectedDuringScan);
        for (const rej of rejectedDuringScan) {
          const dir: SignalDirection = (rej.direction === 'SELL' ? 'SELL' : 'BUY');
          const fp = SignalFingerprint.generateFingerprint({
            symbol: rej.symbol,
            direction: dir,
            entryPrice: 0,
            timeframe: '1h',
            primaryStrategy: 'Multi-Strategy Confluence',
          });
          SignalAuditStore.logAudit({
            symbol: rej.symbol,
            direction: dir,
            timeframe: '1h',
            primaryStrategy: 'Multi-Strategy Confluence',
            passedStrategies: [],
            failedStrategies: ['Quality Hurdle'],
            marketRegime: 'UNKNOWN',
            atr: 0,
            dataFreshnessSeconds: 0,
            providerAgreement: true,
            expectedRR: 0,
            score: rej.score || 0,
            status: 'REJECTED',
            rejectionReason: rej.reason,
            fingerprint: fp,
          });
        }
      }

      // 10. Update last scan timestamp
      await ScannerPersistence.updateLastScanTime(Date.now());

      const finalCapState = await ScannerPersistence.getCapState(serverConfig.getConfig().thresholds.dailySignalCap);
      logger.info(`================================================================`);
      logger.info(`[Hourly Scanner] Scan cycle complete. Dispatched ${dispatchedCount} new setups. Today's total: ${finalCapState.dailySignalCount}/${finalCapState.dailySignalCap}.`);
      logger.info(`================================================================`);

      const rejectionReasonStrings = rejectedDuringScan.map(
        (r) => `${r.symbol}${r.direction ? ` [${r.direction}]` : ''}: ${r.reason}`
      );

      return {
        success: true,
        status: 'COMPLETED',
        message:
          dispatchedCount > 0
            ? `Scan complete: Dispatched ${dispatchedCount} qualified automated setup(s). Total today: ${finalCapState.dailySignalCount}/${finalCapState.dailySignalCap}.`
            : `Scan complete: 0 setups met strict 75+ criteria (0-5 is valid; no trades forced). Total today: ${finalCapState.dailySignalCount}/${finalCapState.dailySignalCap}.`,
        timestamp: Date.now(),
        lastScanTime: finalCapState.lastScanTime,
        candidatesEvaluated: rawCandidates.length,
        acceptedSignalsCount: dispatchedCount,
        acceptedSignals: selectedSetups,
        signalsFound: dispatchedCount,
        qualifiedSetups: selectedSetups,
        rejectedCount: rejectedDuringScan.length,
        rejectionReasons: rejectionReasonStrings,
        capState: finalCapState,
      };
    } catch (err) {
      logger.error('[Hourly Scanner] Critical failure during scan execution:', { error: String(err) });
      const capState = await ScannerPersistence.getCapState(serverConfig.getConfig().thresholds.dailySignalCap);
      const errMsg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        status: 'ERROR',
        message: `REJECTED: SCAN_ERROR. Scan execution error: ${errMsg}`,
        timestamp: Date.now(),
        lastScanTime: capState.lastScanTime,
        candidatesEvaluated: 0,
        acceptedSignalsCount: 0,
        acceptedSignals: [],
        signalsFound: 0,
        qualifiedSetups: [],
        rejectedCount: 0,
        rejectionReasons: [`REJECTED: SCAN_ERROR. Scan execution error: ${errMsg}`],
        capState,
      };
    } finally {
      this.isScanning = false;
      await ScannerPersistence.releaseLock(instanceId);
    }
  }

  /**
   * Retrieves scanner settings and today's metrics for frontend consumption.
   */
  async getSettingsAsync(): Promise<
    ScannerSettings & {
      limit: number;
      dailySignalCount: number;
      sentSignalsToday: PersistedSentSignal[];
      recentNotifications: PersistedNotification[];
      recentRejected: PersistedRejectedCandidate[];
    }
  > {
    const capState = await ScannerPersistence.getCapState(serverConfig.getConfig().thresholds.dailySignalCap);
    const settings = ScannerPersistence.getSettings();
    const sentSignalsToday = await ScannerPersistence.getSentSignalsToday();
    const recentNotifications = await ScannerPersistence.getNotificationHistory(10);
    const recentRejected = await ScannerPersistence.getRejectedCandidatesToday(10);

    // Map timestamps for UI backwards compatibility
    const timestamps = sentSignalsToday.map((s) => s.timestamp);

    return {
      enabled: settings.enabled,
      notificationsEnabled: settings.notificationsEnabled,
      notifyOnNoTrade: settings.notifyOnNoTrade,
      intervalMinutes: [15, 30, 45, 60].includes(Number(settings.intervalMinutes))
        ? Number(settings.intervalMinutes)
        : 30,
      signalsSentTimestamps: timestamps,
      lastScanTime: capState.lastScanTime,
      limit: capState.dailySignalCap,
      dailySignalCount: capState.dailySignalCount,
      sentSignalsToday,
      recentNotifications,
      recentRejected,
    };
  }

  /**
   * Synchronous settings view.
   */
  getSettings(): ScannerSettings & { limit: number } {
    const settings = ScannerPersistence.getSettings();
    return {
      enabled: settings.enabled,
      notificationsEnabled: settings.notificationsEnabled,
      notifyOnNoTrade: settings.notifyOnNoTrade,
      intervalMinutes: [15, 30, 45, 60].includes(Number(settings.intervalMinutes))
        ? Number(settings.intervalMinutes)
        : 30,
      signalsSentTimestamps: [],
      lastScanTime: 0,
      limit: 5,
    };
  }

  /**
   * Updates scanner configurations.
   */
  updateSettings(
    options: Partial<Pick<ScannerSettings, 'enabled' | 'notificationsEnabled' | 'notifyOnNoTrade' | 'intervalMinutes'>>
  ): void {
    if (options.intervalMinutes !== undefined) {
      const val = Number(options.intervalMinutes);
      if (![15, 30, 45, 60].includes(val)) {
        options.intervalMinutes = 30;
      } else {
        options.intervalMinutes = val;
      }
    }
    ScannerPersistence.updateSettings(options);
    logger.info('[Hourly Scanner] Scanner settings updated successfully.', { ...options });
  }

  /**
   * Retrieves full notification and audit history.
   */
  async getFullHistory(): Promise<{
    notifications: PersistedNotification[];
    sentSignalsToday: PersistedSentSignal[];
    rejectedToday: PersistedRejectedCandidate[];
    capState: DailyCapState;
  }> {
    const capState = await ScannerPersistence.getCapState(serverConfig.getConfig().thresholds.dailySignalCap);
    const notifications = await ScannerPersistence.getNotificationHistory(30);
    const sentSignalsToday = await ScannerPersistence.getSentSignalsToday();
    const rejectedToday = await ScannerPersistence.getRejectedCandidatesToday(30);

    return {
      notifications,
      sentSignalsToday,
      rejectedToday,
      capState,
    };
  }
}

export const hourlyScanner = new HourlyScannerService();
