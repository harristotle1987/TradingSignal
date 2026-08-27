/**
 * Express API Router for Trading Signals (Gate 3)
 */

import { Router, Request, Response } from 'express';
import { SignalGenerationResponse } from '../../types/index.js';
import { getDynamicPrecision } from '../../utils/formatters.js';
import { signalEngine } from '../signals/SignalEngine.js';
import { hourlyScanner } from '../signals/HourlyScanner.js';
import { SignalLogger } from '../signals/SignalLogger.js';
import { SignalAuditStore } from '../signals/SignalAuditStore.js';
import { SignalOutcomeLogger } from '../signals/SignalOutcomeLogger.js';
import { SignalLifecycleManager } from '../signals/SignalLifecycleManager.js';
import { StrategyPerformanceTracker, PERFORMANCE_LEGAL_DISCLAIMER } from '../signals/StrategyPerformanceTracker.js';
import { HistoricalPerformanceManager } from '../signals/HistoricalPerformanceManager.js';
import { HistoricalPerformanceRange } from '../../types/index.js';
import { WalkForwardEngine } from '../signals/WalkForwardEngine.js';
import { OpportunityFunnelStore } from '../signals/Gate26OpportunityFunnel.js';
import { Gate27RegimeThresholds } from '../signals/Gate27RegimeThresholds.js';
import { Gate28ConfirmationDiversity } from '../signals/Gate28ConfirmationDiversity.js';
import { Gate29ExecutableEntryValidation } from '../signals/Gate29ExecutableEntryValidation.js';
import { Gate30DataFreshness } from '../signals/Gate30DataFreshness.js';
import { Gate31NewsRiskClassification } from '../signals/Gate31NewsRiskClassification.js';
import { Gate32AdaptiveCandidateSelection } from '../signals/Gate32AdaptiveCandidateSelection.js';
import { Gate34ExecutionFrictionStressTest } from '../signals/Gate34ExecutionFrictionStressTest.js';
import { Gate35SignalFunnelAnalytics } from '../signals/Gate35SignalFunnelAnalytics.js';
import { Gate36ConfigurableSignalFrequency } from '../signals/Gate36ConfigurableSignalFrequency.js';
import { Gate2MTFConfluence } from '../signals/Gate2MTFConfluence.js';
import { Gate3PreliminaryScreen } from '../signals/Gate3PreliminaryScreen.js';
import { Gate4RequestBudget } from '../signals/Gate4RequestBudget.js';
import { Gate5DeepCandidateSelection } from '../signals/Gate5DeepCandidateSelection.js';
import { Gate6ProgressiveMTF } from '../signals/Gate6ProgressiveMTF.js';
import { Gate7FinalTradeValidation } from '../signals/Gate7FinalTradeValidation.js';
import { serverConfig } from '../config.js';
import { marketDataManager } from '../market/MarketDataManager.js';
import { marketCache } from '../market/CacheStore.js';
import { logger } from '../logger.js';
import { ScannerPersistence, PersistedSentSignal } from '../signals/ScannerPersistence.js';
import { getFirestoreAdmin } from '../firebaseAdmin.js';
import { adminAuthMiddleware } from '../middleware/adminAuth.js';
import { CronJobOrgService } from '../cron/CronJobOrgService.js';

const router = Router();

/**
 * GET /api/scanner/settings
 * Retrieves automated hourly scanner configurations, today's stats, and cron-job.org status.
 */
router.get('/scanner/settings', async (_req: Request, res: Response) => {
  const settings = await hourlyScanner.getSettingsAsync();
  const cronJobOrg = await CronJobOrgService.getJobStatus();
  res.status(200).json({
    success: true,
    settings,
    cronJobOrg,
    timestamp: Date.now(),
  });
});

/**
 * GET /api/cron/status
 * Dedicated route for retrieving cron-job.org execution details & history.
 */
router.get('/cron/status', async (req: Request, res: Response) => {
  const forceRefresh = req.query.refresh === 'true';
  const status = await CronJobOrgService.getJobStatus(forceRefresh);
  res.status(200).json({
    success: true,
    cronJobOrg: status,
    timestamp: Date.now(),
  });
});

/**
 * POST /api/scanner/settings
 * Updates automated hourly scanner configurations (enabled, notifications, notifyOnNoTrade).
 */
router.post('/scanner/settings', async (req: Request, res: Response) => {
  const { enabled, notificationsEnabled, notifyOnNoTrade, intervalMinutes } = req.body || {};
  hourlyScanner.updateSettings({ enabled, notificationsEnabled, notifyOnNoTrade, intervalMinutes });
  const settings = await hourlyScanner.getSettingsAsync();
  res.status(200).json({
    success: true,
    message: 'Scanner settings updated successfully',
    settings,
    timestamp: Date.now(),
  });
});

/**
 * GET /api/scanner/history
 * Retrieves full notification history, sent signals today, and rejected candidate logs.
 */
router.get('/scanner/history', async (_req: Request, res: Response) => {
  try {
    const history = await hourlyScanner.getFullHistory();
    res.status(200).json({
      success: true,
      ...history,
      timestamp: Date.now(),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve scanner history',
      error: msg,
      timestamp: Date.now(),
    });
  }
});

/**
 * GET & POST /api/scanner/trigger
 * Production entry point for external automated cron scheduler (e.g. cron-job.org, GitHub Actions, curl).
 * Supports both GET and POST to maximize compatibility with free external cron providers.
 * Strictly protected by SCANNER_CRON_SECRET token.
 */
const handleScannerTrigger = async (req: Request, res: Response) => {
  const requestStartTime = Date.now();
  logger.info(`[Scanner Trigger] REQUEST_START | timestamp: ${requestStartTime} | ISO: ${new Date(requestStartTime).toISOString()}`);

  const cronSecret = process.env.SCANNER_CRON_SECRET;
  const authHeader = req.headers.authorization;
  const xCronSecret = (req.headers['x-cron-secret'] || 
                       req.headers['x-scanner-secret'] || 
                       req.headers['x-cron-key'] ||
                       req.headers['x-api-key'] ||
                       req.headers['cron-secret']) as string | undefined;

  const querySecret = (req.query?.secret || 
                       req.query?.token || 
                       req.query?.key || 
                       req.query?.cron_secret || 
                       req.query?.cronSecret ||
                       req.query?.scanner_cron_secret) as string | undefined;

  const bodySecret = (req.body?.secret || 
                      req.body?.token || 
                      req.body?.key || 
                      req.body?.cronSecret || 
                      req.body?.cron_secret) as string | undefined;

  let isAuthenticated = false;
  if (cronSecret && cronSecret.trim().length > 0) {
    const trimmedSecret = cronSecret.trim();
    
    // Check Authorization header (Bearer <secret> or raw <secret>)
    if (authHeader) {
      const trimmedAuth = authHeader.trim();
      if (trimmedAuth === `Bearer ${trimmedSecret}` || 
          trimmedAuth.toLowerCase() === `bearer ${trimmedSecret.toLowerCase()}` ||
          trimmedAuth === trimmedSecret) {
        isAuthenticated = true;
      }
    }
    
    // Check custom headers
    if (!isAuthenticated && xCronSecret && xCronSecret.trim() === trimmedSecret) {
      isAuthenticated = true;
    }

    // Check query string parameters
    if (!isAuthenticated && querySecret && querySecret.trim() === trimmedSecret) {
      isAuthenticated = true;
    }

    // Check request body
    if (!isAuthenticated && bodySecret && bodySecret.trim() === trimmedSecret) {
      isAuthenticated = true;
    }
  } else {
    // If no SCANNER_CRON_SECRET is configured in server environment, allow invocation
    isAuthenticated = true;
  }

  const authDurationMs = Date.now() - requestStartTime;

  if (!isAuthenticated) {
    logger.warn(`[Scanner Trigger] UNAUTHORIZED_TRIGGER_ATTEMPT | duration: ${authDurationMs}ms`);
    return res.status(401).json({
      success: false,
      status: 'UNAUTHORIZED',
      message: 'Unauthorized: Invalid or missing SCANNER_CRON_SECRET token.',
      timestamp: Date.now(),
      lastScanTime: 0,
      nextScanTime: 0,
      candidatesEvaluated: 0,
      acceptedSignalsCount: 0,
      signalsFound: 0,
      rejectedCount: 0,
      rejectionReasons: ['Unauthorized: Request missing valid Bearer or x-cron-secret token.'],
    });
  }

  logger.info(`[Scanner Trigger] AUTHENTICATED | duration: ${authDurationMs}ms`);

  // 1. Log external scan start with full UTC / Unix timezone diagnostics and record cron execution timestamp
  const now = Date.now();
  await ScannerPersistence.updateLastCronExecution(now);
  const configuredTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  logger.info(`[Scanner Diagnostic] EXTERNAL_HOURLY_SCAN_TRIGGERED | Date.now(): ${now} | ISO UTC: ${new Date(now).toISOString()} | Runtime TZ: ${configuredTz}`);

  try {
    // Directly invoke Market Scan Engine as the single automated scan trigger
    logger.info(`[Scanner Trigger] MARKET_SCAN_ENGINE_START | triggerTime: ${Date.now()}`);
    const scanEngineStartTime = Date.now();
    const result = await hourlyScanner.triggerAutomatedScan(true);
    const scanEngineDurationMs = Date.now() - scanEngineStartTime;
    logger.info(`[Scanner Trigger] MARKET_SCAN_ENGINE_END | duration: ${scanEngineDurationMs}ms | status: ${result.status} | candidates: ${result.candidatesEvaluated} | accepted: ${result.acceptedSignalsCount}`);

    let statusLog = '';
    if (result.status === 'COMPLETED') {
      logger.info('EXTERNAL_HOURLY_SCAN_COMPLETED');
      statusLog = 'EXTERNAL_HOURLY_SCAN_COMPLETED';
    } else if (result.status === 'SKIPPED_CAP_REACHED' || result.status === 'SCAN_ALREADY_RUNNING') {
      logger.info('EXTERNAL_HOURLY_SCAN_SKIPPED');
      statusLog = 'EXTERNAL_HOURLY_SCAN_SKIPPED';
    } else {
      logger.error('EXTERNAL_HOURLY_SCAN_FAILED');
      statusLog = 'EXTERNAL_HOURLY_SCAN_FAILED';
    }

    const settings = ScannerPersistence.getSettings();
    const capState = result.capState || await ScannerPersistence.getCapState();
    const intervalMinutes = [15, 30, 45, 60].includes(Number(settings.intervalMinutes))
      ? Number(settings.intervalMinutes)
      : 30;
    const lastAutomatedScan = capState.lastAutomatedScan || capState.lastScanTime || 0;
    
    // Refresh cron status to get authoritative next execution from cron-job.org
    const cronStatus = await CronJobOrgService.getJobStatus(true);
    const nextCronExecution = cronStatus.nextExecution?.timestamp || 0;
    const nextScanTime = nextCronExecution;

    const httpCode = result.status === 'ERROR' ? 500 : 200;
    const durationMs = result.scanDurationMs ?? (Date.now() - now);
    const totalRequestDurationMs = Date.now() - requestStartTime;

    logger.info(`[Scanner Trigger] TOTAL_DURATION | duration: ${totalRequestDurationMs}ms | scanEngineDuration: ${durationMs}ms`);

    // Fast, lightweight HTTP response for cron scheduler with complete state metrics
    res.status(httpCode).json({
      success: result.success,
      status: result.status,
      message: result.message,
      timestamp: result.timestamp || Date.now(),
      lastCronExecution: now,
      lastAutomatedScan,
      lastScanCompletedAt: capState.lastScanCompletedAt || Date.now(),
      lastScanDuration: durationMs,
      universeSymbolsScanned: result.universeSymbolsScanned ?? capState.universeSymbolsScanned ?? 0,
      preliminaryCandidatesFound: result.preliminaryCandidatesFound ?? capState.preliminaryCandidatesFound ?? 0,
      candidatesRejectedPreliminary: result.candidatesRejectedPreliminary ?? capState.candidatesRejectedPreliminary ?? 0,
      candidatesEvaluated: result.candidatesEvaluated ?? capState.candidatesEvaluated ?? 0,
      candidatesRejectedFinal: result.candidatesRejectedFinal ?? capState.candidatesRejectedFinal ?? (result.rejectedCount ?? 0),
      signalsGenerated: result.signalsGenerated ?? result.signalsFound ?? capState.signalsGenerated ?? 0,
      signalsAccepted: result.signalsAccepted ?? result.acceptedSignalsCount ?? capState.signalsAccepted ?? 0,
      lastCandidatesEvaluated: result.candidatesEvaluated ?? capState.lastCandidatesEvaluated ?? 0,
      lastSignalsFound: result.signalsFound ?? result.acceptedSignalsCount ?? capState.lastSignalsFound ?? 0,
      lastAcceptedSignals: result.acceptedSignalsCount ?? capState.lastAcceptedSignals ?? 0,
      signalsFound: result.signalsFound ?? result.acceptedSignalsCount ?? capState.lastSignalsFound ?? 0,
      acceptedSignalsCount: result.acceptedSignalsCount ?? capState.lastAcceptedSignals ?? 0,
      nextCronExecution,
      lastScanTime: lastAutomatedScan,
      nextScanTime,
      intervalMinutes,
      rejectedCount: result.rejectedCount ?? 0,
      rejectionReasons: result.rejectionReasons ?? [],
      rejectionReasonsCounts: result.rejectionReasonsCounts ?? result.rejectionReasonsAggregated ?? {},
      candidateRejectionDetails: result.candidateRejectionDetails ?? [],
      diagnosticsCount: result.diagnosticsCount ?? 0,
      diagnostics: result.diagnostics ?? [],
      scanDurationMs: durationMs,
      scanDuration: `${(durationMs / 1000).toFixed(2)}s`,
      totalDurationMs: totalRequestDurationMs,
      external_hourly_scan_status: statusLog
    });
  } catch (err: unknown) {
    logger.error('EXTERNAL_HOURLY_SCAN_FAILED');
    const msg = err instanceof Error ? err.message : String(err);
    const totalRequestDurationMs = Date.now() - requestStartTime;
    res.status(500).json({
      success: false,
      status: 'ERROR',
      message: 'Failed to execute hourly scanner trigger',
      external_hourly_scan_status: 'EXTERNAL_HOURLY_SCAN_FAILED',
      timestamp: Date.now(),
      lastScanTime: 0,
      nextScanTime: 0,
      candidatesEvaluated: 0,
      acceptedSignalsCount: 0,
      signalsFound: 0,
      rejectedCount: 0,
      scanDurationMs: totalRequestDurationMs,
      scanDuration: `${(totalRequestDurationMs / 1000).toFixed(2)}s`,
      totalDurationMs: totalRequestDurationMs,
      rejectionReasons: [msg],
    });
  }
};

router.post('/scanner/trigger', handleScannerTrigger);
router.get('/scanner/trigger', handleScannerTrigger);

/**
 * POST /api/scanner/manual-trigger
 * Separate endpoint for in-app UI manual/admin scanner execution.
 */
router.post('/scanner/manual-trigger', async (_req: Request, res: Response) => {
  try {
    const result = await hourlyScanner.triggerManualScan();
    const httpCode = result.status === 'ERROR' ? 500 : 200;
    res.status(httpCode).json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({
      success: false,
      status: 'ERROR',
      message: 'Failed to execute manual scanner trigger',
      timestamp: Date.now(),
      lastScanTime: 0,
      candidatesEvaluated: 0,
      acceptedSignalsCount: 0,
      acceptedSignals: [],
      signalsFound: 0,
      qualifiedSetups: [],
      rejectedCount: 0,
      rejectionReasons: [msg],
    });
  }
});

/**
 * GET /api/signals/audits
 * Retrieves complete backend explanation audit records (passed/failed strategies, regime, ATR, expected R:R, rejection reason, fingerprint).
 */
router.get('/signals/audits', async (req: Request, res: Response) => {
  try {
    const symbol = req.query.symbol as string | undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;
    const audits = symbol
      ? SignalAuditStore.getAuditLogsBySymbol(symbol, limit)
      : SignalAuditStore.getAuditLogs(limit);

    res.status(200).json({
      success: true,
      audits,
      count: audits.length,
      timestamp: Date.now(),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve signal audit explanations',
      error: msg,
      timestamp: Date.now(),
    });
  }
});

/**
 * GET /api/signals/outcomes
 * Retrieves persistent Signal Outcome logs containing multi-level TP/SL hits and final statuses.
 */
router.get('/signals/outcomes', async (req: Request, res: Response) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;
    const outcomes = await SignalOutcomeLogger.getOutcomeLogs(limit);
    res.status(200).json({
      success: true,
      outcomes,
      count: outcomes.length,
      timestamp: Date.now(),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve signal outcome logs',
      error: msg,
      timestamp: Date.now(),
    });
  }
});

/**
 * DELETE /api/signals/outcomes
 * Clears persistent Signal Outcome logs.
 */
router.delete('/signals/outcomes', adminAuthMiddleware, async (_req: Request, res: Response) => {
  try {
    await SignalOutcomeLogger.clearLogs();
    res.status(200).json({
      success: true,
      message: 'Signal outcome logs cleared successfully',
      timestamp: Date.now(),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({
      success: false,
      message: 'Failed to clear signal outcome logs',
      error: msg,
      timestamp: Date.now(),
    });
  }
});

/**
 * POST /api/signals/monitor
 * Triggers immediate, on-demand evaluation of active signals against live prices and candle progression.
 */
router.post('/signals/monitor', async (_req: Request, res: Response) => {
  try {
    const result = await SignalLifecycleManager.evaluateActiveSignals();
    res.status(200).json({
      success: true,
      message: 'Active signals outcome tracking evaluation executed successfully',
      result,
      timestamp: Date.now(),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({
      success: false,
      message: 'Active signals outcome evaluation failed',
      error: msg,
      timestamp: Date.now(),
    });
  }
});

/**
 * POST /api/signals/refresh
 * Manually checks the latest verified market price for an individual active signal.
 * Guarantees idempotency, target pricing preservation, and correct status outcomes.
 */
router.post('/signals/refresh', async (req: Request, res: Response) => {
  try {
    const { id } = req.body || {};
    if (!id || typeof id !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Invalid or missing signal ID parameter.',
        timestamp: Date.now(),
      });
    }

    const firestore = getFirestoreAdmin();
    let signal: PersistedSentSignal | undefined;

    if (firestore) {
      try {
        const doc = await firestore.collection('scanner_sent_signals').doc(id).get();
        if (doc.exists) {
          signal = doc.data() as PersistedSentSignal;
        }
      } catch (err) {
        logger.warn(`[Refresh API] Firestore fetch failed for id=${id}: ${String(err)}`);
      }
    }

    if (!signal) {
      signal = ScannerPersistence.localData.sentSignals.find((s) => s.id === id);
    }

    if (!signal) {
      // Fallback: Check inside SignalLogger logs
      try {
        await SignalLogger.init();
        const logs = await SignalLogger.getSignalLogs();
        const logRecord = logs.find((l) => l.id === id || l.snapshotId === id);
        if (logRecord) {
          const rawStatus = logRecord.status || 'ACTIVE';
          const isCompleted = (rawStatus as string) === 'COMPLETED' || rawStatus === 'TP3 HIT' || rawStatus === 'TP HIT';
          const isStopped = (rawStatus as string) === 'STOPPED_OUT' || rawStatus === 'SL HIT';
          signal = {
            id: logRecord.id,
            snapshotId: logRecord.snapshotId || logRecord.id,
            symbol: logRecord.symbol,
            direction: logRecord.direction,
            entryPrice: logRecord.entryPrice,
            stopLoss: logRecord.stopLoss,
            takeProfit: logRecord.takeProfit,
            tp1: logRecord.tp1,
            tp2: logRecord.tp2,
            tp3: logRecord.tp3,
            riskRewardRatio: logRecord.riskRewardRatio,
            score: logRecord.score,
            rankTier: logRecord.isBestTrade ? 'BEST_TRADE' : 'SUGGESTION',
            strategy: logRecord.strategy,
            timeframe: logRecord.timeframe || '1h',
            dataSource: logRecord.provider || 'bitget',
            status: rawStatus === 'ACTIVE' ? 'ACTIVE' : 
                    (rawStatus === 'WAITING_ENTRY' ? 'WAITING_ENTRY' :
                    (isCompleted ? 'COMPLETED' : 
                     (isStopped ? 'STOPPED_OUT' : 
                      (rawStatus === 'TP1 HIT' ? 'TP1_HIT' : 
                       (rawStatus === 'TP2 HIT' ? 'TP2_HIT' : rawStatus as any))))),
            tp1Status: rawStatus.includes('TP') || isCompleted ? 'HIT' : 'PENDING',
            tp2Status: rawStatus.includes('TP2') || rawStatus.includes('TP3') || isCompleted ? 'HIT' : 'PENDING',
            tp3Status: rawStatus.includes('TP3') || isCompleted ? 'HIT' : 'PENDING',
            slStatus: rawStatus.includes('SL') || isStopped ? 'HIT' : 'ACTIVE',
            timestamp: logRecord.timestamp,
            notificationSent: false,
            notificationTimestamp: 0,
            date: new Date(logRecord.timestamp).toISOString().split('T')[0],
          };
        }
      } catch (err) {
        logger.warn(`[Refresh API] SignalLogger fetch fallback failed for id=${id}: ${String(err)}`);
      }
    }

    if (!signal) {
      // Fallback: Check inside signalEngine activeSignals map
      const activeSig = Array.from(signalEngine.activeSignals.values()).find((s) => s.id === id);
      if (activeSig) {
        signal = {
          id: activeSig.id,
          snapshotId: activeSig.snapshotId || 'manual',
          symbol: activeSig.symbol,
          direction: activeSig.direction,
          entryPrice: activeSig.entryPrice,
          stopLoss: activeSig.stopLoss,
          takeProfit: activeSig.takeProfit,
          tp1: activeSig.tp1,
          tp2: activeSig.tp2,
          tp3: activeSig.tp3,
          riskRewardRatio: activeSig.riskRewardRatio,
          score: activeSig.score,
          rankTier: activeSig.rankTier || 'SUGGESTION',
          strategy: activeSig.strategy,
          timeframe: activeSig.timeframe,
          dataSource: activeSig.dataSource || 'bitget',
          status: (activeSig.status as any) || 'ACTIVE',
          tp1Status: (activeSig.tp1Status as any) || 'PENDING',
          tp2Status: (activeSig.tp2Status as any) || 'PENDING',
          tp3Status: (activeSig.tp3Status as any) || 'PENDING',
          slStatus: (activeSig.slStatus as any) || 'ACTIVE',
          tp1HitAt: activeSig.tp1HitAt,
          tp2HitAt: activeSig.tp2HitAt,
          tp3HitAt: activeSig.tp3HitAt,
          stopLossHitAt: activeSig.stopLossHitAt,
          tp1HitPrice: activeSig.tp1HitPrice,
          tp2HitPrice: activeSig.tp2HitPrice,
          tp3HitPrice: activeSig.tp3HitPrice,
          stopLossHitPrice: activeSig.stopLossHitPrice,
          timestamp: activeSig.timestamp,
          notificationSent: false,
          notificationTimestamp: 0,
          date: new Date(activeSig.timestamp).toISOString().split('T')[0],
        };
      }
    }

    if (!signal) {
      const {
        symbol,
        direction,
        entryPrice,
        stopLoss,
        takeProfit,
        tp1,
        tp2,
        tp3,
        status,
        tp1Status,
        tp2Status,
        tp3Status,
        slStatus,
        timestamp,
        rankTier,
        strategy,
        timeframe,
        dataSource,
        riskRewardRatio,
        score
      } = req.body || {};

      if (symbol && direction && entryPrice !== undefined && stopLoss !== undefined) {
        logger.info(`[Refresh API] Rebuilding on-the-fly signal evaluation for missing signal id=${id || 'ad-hoc'}`);
        signal = {
          id: id || `adhoc_${Date.now()}`,
          snapshotId: id || `adhoc_${Date.now()}`,
          symbol,
          direction,
          entryPrice: Number(entryPrice),
          stopLoss: Number(stopLoss),
          takeProfit: Number(takeProfit || entryPrice),
          tp1: tp1 !== undefined ? Number(tp1) : undefined,
          tp2: tp2 !== undefined ? Number(tp2) : undefined,
          tp3: tp3 !== undefined ? Number(tp3) : undefined,
          status: status || 'ACTIVE',
          tp1Status: tp1Status || 'PENDING',
          tp2Status: tp2Status || 'PENDING',
          tp3Status: tp3Status || 'PENDING',
          slStatus: slStatus || 'ACTIVE',
          timestamp: timestamp || Date.now(),
          rankTier: rankTier || 'SUGGESTION',
          strategy: strategy || 'Ad-hoc Evaluation',
          timeframe: timeframe || '1h',
          dataSource: dataSource || 'bitget',
          notificationSent: false,
          notificationTimestamp: 0,
          date: new Date(timestamp || Date.now()).toISOString().split('T')[0],
          riskRewardRatio: Number(riskRewardRatio) || 2,
          score: Number(score) || 75,
        };
      }
    }

    if (!signal) {
      return res.status(404).json({
        success: false,
        message: `Signal with ID ${id} not found.`,
        timestamp: Date.now(),
      });
    }

    // Normalize legacy signal objects to ensure they contain required TP/SL threshold structures before evaluation
    if (signal.tp1 === undefined || signal.tp2 === undefined || signal.tp3 === undefined) {
      const entry = signal.entryPrice;
      const finalTp = signal.takeProfit;
      const diff = finalTp - entry;
      const dec = getDynamicPrecision(finalTp, signal.symbol);

      signal.tp1 = signal.tp1 ?? Number((entry + diff * 0.33).toFixed(dec));
      signal.tp2 = signal.tp2 ?? Number((entry + diff * 0.66).toFixed(dec));
      signal.tp3 = signal.tp3 ?? finalTp;

      signal.tp1Status = signal.tp1Status || 'PENDING';
      signal.tp2Status = signal.tp2Status || 'PENDING';
      signal.tp3Status = signal.tp3Status || 'PENDING';
      signal.slStatus = signal.slStatus || 'ACTIVE';
    }

    // For terminal historical results, return immediately without changes to avoid API wastage
    const isTerminal = [
      'COMPLETED',
      'STOPPED_OUT',
      'EXPIRED',
      'SUPERSEDED',
      'AMBIGUOUS',
      'REJECTED'
    ].includes(signal.status);

    if (isTerminal) {
      return res.status(200).json({
        success: true,
        changed: false,
        message: '✓ Checked. Historical trade setup is already terminal.',
        currentPrice: signal.tp3HitPrice || signal.stopLossHitPrice || signal.entryPrice,
        signal,
        lastChecked: new Date().toLocaleTimeString(),
        timestamp: Date.now(),
      });
    }

    // Fetch the latest verified market price bypassing standard cache to ensure freshness
    const ticker = await marketDataManager.getPrice(signal.symbol, undefined, true);

    if (ticker.status === 'MARKET_DATA_UNAVAILABLE' || !ticker.price || ticker.price <= 0) {
      return res.status(503).json({
        success: false,
        message: 'Unable to verify market price. Try again shortly.',
        timestamp: Date.now(),
      });
    }

    // Acceptable freshness check: within 120 seconds
    const freshnessAgeMs = Date.now() - ticker.timestamp;
    if (freshnessAgeMs > 120000) {
      return res.status(400).json({
        success: false,
        message: 'Market data is stale. Target status was not changed.',
        currentPrice: ticker.price,
        timestamp: Date.now(),
      });
    }

    // Run the SAME authoritative TP/SL evaluation logic used by automatic monitoring
    const evalResult = SignalLifecycleManager.evaluateSignalPriceUpdate(
      signal,
      ticker.price,
      ticker.timestamp,
      signal.symbol
    );

    const statusChanged =
      evalResult.newStatus !== signal.status ||
      evalResult.tp1Status !== signal.tp1Status ||
      evalResult.tp2Status !== signal.tp2Status ||
      evalResult.tp3Status !== signal.tp3Status ||
      evalResult.slStatus !== signal.slStatus;

    if (statusChanged) {
      const metadata: Partial<PersistedSentSignal> = {
        tp1Status: evalResult.tp1Status,
        tp2Status: evalResult.tp2Status,
        tp3Status: evalResult.tp3Status,
        slStatus: evalResult.slStatus,
        tp1HitAt: evalResult.tp1HitAt,
        tp2HitAt: evalResult.tp2HitAt,
        tp3HitAt: evalResult.tp3HitAt,
        stopLossHitAt: evalResult.stopLossHitAt,
        tp1HitPrice: evalResult.tp1HitPrice,
        tp2HitPrice: evalResult.tp2HitPrice,
        tp3HitPrice: evalResult.tp3HitPrice,
        stopLossHitPrice: evalResult.stopLossHitPrice,
      };

      const existsLocally = ScannerPersistence.localData.sentSignals.some(s => s.id === signal!.id);
      if (!existsLocally && signal) {
        ScannerPersistence.localData.sentSignals.push(signal);
      }

      await ScannerPersistence.updateSignalStatus(signal.id, evalResult.newStatus, metadata);

      // Re-fetch updated signal to return
      if (firestore) {
        try {
          const doc = await firestore.collection('scanner_sent_signals').doc(id).get();
          if (doc.exists) {
            signal = doc.data() as PersistedSentSignal;
          }
        } catch (err) {
          // ignore
        }
      }
      if (signal) {
        Object.assign(signal, metadata);
        signal.status = evalResult.newStatus;

        // Sync with signalEngine activeSignals map
        const activeSig = signalEngine.activeSignals.get(signal.symbol);
        if (activeSig && activeSig.id === signal.id) {
          activeSig.status = evalResult.newStatus as any;
          activeSig.tp1Status = evalResult.tp1Status as any;
          activeSig.tp2Status = evalResult.tp2Status as any;
          activeSig.tp3Status = evalResult.tp3Status as any;
          activeSig.slStatus = evalResult.slStatus as any;
          activeSig.tp1HitAt = evalResult.tp1HitAt;
          activeSig.tp2HitAt = evalResult.tp2HitAt;
          activeSig.tp3HitAt = evalResult.tp3HitAt;
          activeSig.stopLossHitAt = evalResult.stopLossHitAt;
          activeSig.tp1HitPrice = evalResult.tp1HitPrice;
          activeSig.tp2HitPrice = evalResult.tp2HitPrice;
          activeSig.tp3HitPrice = evalResult.tp3HitPrice;
          activeSig.stopLossHitPrice = evalResult.stopLossHitPrice;
        }
      }
    }

    // Build the specific change summary message for the user
    let feedbackMsg = 'No new TP/SL levels hit.';
    if (statusChanged) {
      if (evalResult.newStatus === 'STOPPED_OUT') {
        feedbackMsg = 'STOP LOSS HIT';
      } else if (evalResult.newStatus === 'COMPLETED') {
        feedbackMsg = 'TP1 ✓ HIT, TP2 ✓ HIT, TP3 ✓ HIT. TRADE COMPLETED';
      } else {
        const hits: string[] = [];
        if (evalResult.tp1Status === 'HIT' && signal.tp1Status !== 'HIT') hits.push('TP1 ✓ HIT');
        if (evalResult.tp2Status === 'HIT' && signal.tp2Status !== 'HIT') hits.push('TP2 ✓ HIT');
        if (evalResult.tp3Status === 'HIT' && signal.tp3Status !== 'HIT') hits.push('TP3 ✓ HIT');
        feedbackMsg = hits.length > 0 ? hits.join(', ') : 'Target states updated.';
      }
    }

    return res.status(200).json({
      success: true,
      changed: statusChanged,
      message: `✓ Checked. Current Price: ${ticker.price.toFixed(5)}. ${feedbackMsg}`,
      currentPrice: ticker.price,
      signal,
      lastChecked: new Date().toLocaleTimeString(),
      timestamp: Date.now(),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[Refresh API] Error refreshing signal status: ${msg}`);
    return res.status(500).json({
      success: false,
      message: 'Failed to manually verify market price setup.',
      error: msg,
      timestamp: Date.now(),
    });
  }
});

/**
 * POST /api/signals/backfill-outcomes
 * Triggers historical outcome backfill across all ACTIVE and progressive signals.
 */
router.post('/signals/backfill-outcomes', adminAuthMiddleware, async (_req: Request, res: Response) => {
  try {
    const result = await SignalLifecycleManager.backfillHistoricalOutcomesForActiveSignals();
    res.status(200).json({
      success: true,
      message: 'Historical outcome backfill executed successfully across active signals',
      result,
      timestamp: Date.now(),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({
      success: false,
      message: 'Historical outcome backfill failed',
      error: msg,
      timestamp: Date.now(),
    });
  }
});

/**
 * GET /api/signals/log
 * Retrieves dedicated signal logs separate from application logs.
 */
router.get('/signals/log', async (_req: Request, res: Response) => {
  try {
    const logs = await SignalLogger.getSignalLogs();
    res.status(200).json({
      success: true,
      logs,
      count: logs.length,
      timestamp: Date.now(),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve signal logs',
      error: msg,
      timestamp: Date.now(),
    });
  }
});

/**
 * DELETE /api/signals/log/:id
 * Deletes an individual dedicated signal log entry by ID.
 */
router.delete('/signals/log/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    
    // Record that this signal has been deleted first to capture its details
    await ScannerPersistence.recordDeletedSignal(id);

    // Deletions propagate errors from Firestore if they fail.
    const loggerSuccess = await SignalLogger.deleteLog(id);
    await SignalOutcomeLogger.deleteOutcome(id);
    
    // Also remove from active signals cache and persistent sent signals
    signalEngine.removeActiveSignal(id);
    const sentSignalSuccess = await ScannerPersistence.deleteSentSignal(id);
    const notificationSuccess = await ScannerPersistence.deleteNotification(id);

    const success = loggerSuccess || sentSignalSuccess || notificationSuccess;

    if (success) {
      res.status(200).json({
        success: true,
        message: `Signal log entry ${id} deleted successfully`,
        timestamp: Date.now(),
      });
    } else {
      res.status(404).json({
        success: false,
        message: `Signal log entry ${id} not found`,
        timestamp: Date.now(),
      });
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({
      success: false,
      message: 'Failed to delete individual signal log entry',
      error: msg,
      timestamp: Date.now(),
    });
  }
});

/**
 * POST /api/signals/log/bulk-delete
 * Deletes multiple signal log entries by IDs.
 */
router.post('/signals/log/bulk-delete', async (req: Request, res: Response) => {
  try {
    const { ids } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or empty ids array',
        timestamp: Date.now(),
      });
    }

    let deletedCount = 0;
    for (const id of ids) {
      // Record that this signal has been deleted first
      await ScannerPersistence.recordDeletedSignal(id);

      // Deletions propagate errors from Firestore if they fail.
      const loggerSuccess = await SignalLogger.deleteLog(id);
      await SignalOutcomeLogger.deleteOutcome(id);
      signalEngine.removeActiveSignal(id);
      const sentSignalSuccess = await ScannerPersistence.deleteSentSignal(id);
      const notificationSuccess = await ScannerPersistence.deleteNotification(id);
      
      if (loggerSuccess || sentSignalSuccess || notificationSuccess) {
        deletedCount++;
      }
    }

    res.status(200).json({
      success: true,
      message: `Successfully deleted ${deletedCount} of ${ids.length} signals`,
      timestamp: Date.now(),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({
      success: false,
      message: 'Failed to bulk delete signal log entries',
      error: msg,
      timestamp: Date.now(),
    });
  }
});

/**
 * DELETE /api/signals/log
 * Clears dedicated signal log records.
 */
router.delete('/signals/log', async (_req: Request, res: Response) => {
  try {
    await SignalLogger.clearLogs();
    await SignalOutcomeLogger.clearLogs();
    signalEngine.clearSignals();
    await ScannerPersistence.clearSentSignals();
    res.status(200).json({
      success: true,
      message: 'Dedicated signal logs cleared successfully',
      timestamp: Date.now(),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({
      success: false,
      message: 'Failed to clear signal logs',
      error: msg,
      timestamp: Date.now(),
    });
  }
});

/**
 * GET /api/signals
 * Retrieves all currently active validated trading signals.
 */
router.get('/signals', async (_req: Request, res: Response) => {
  const signals = await signalEngine.getActiveSignals();
  res.status(200).json({
    success: true,
    signals,
    activeCount: signals.length,
    timestamp: Date.now(),
  });
});

/**
 * POST /api/signals/generate
 * Triggers on-demand multi-timeframe signal analysis using the unified scan engine.
 */
router.post('/signals/generate', async (req: Request, res: Response) => {
  try {
    const requestedSymbol = (req.body?.symbol as string) || 'EURUSD';
    const generationResult = await signalEngine.generateSignal(requestedSymbol, undefined, true);
    return res.status(200).json(generationResult);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({
      success: false,
      message: 'Signal generation endpoint internal error',
      error: msg,
      timestamp: Date.now(),
    });
  }
});

/**
 * DELETE /api/signals/:id
 * Deletes a specific active signal by ID.
 */
router.delete('/signals/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    // Record that this signal has been deleted first
    await ScannerPersistence.recordDeletedSignal(id);

    // Remove from active signals cache and persistent sent signals
    const removedFromMemory = signalEngine.removeActiveSignal(id);
    const sentSignalSuccess = await ScannerPersistence.deleteSentSignal(id);
    const notificationSuccess = await ScannerPersistence.deleteNotification(id);
    const loggerSuccess = await SignalLogger.deleteLog(id);
    await SignalOutcomeLogger.deleteOutcome(id);

    const success = removedFromMemory || sentSignalSuccess || notificationSuccess || loggerSuccess;

    if (success) {
      res.status(200).json({
        success: true,
        message: `Signal ${id} deleted successfully`,
        timestamp: Date.now(),
      });
    } else {
      res.status(404).json({
        success: false,
        message: `Signal ${id} not found`,
        timestamp: Date.now(),
      });
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[API] Failed to delete signal ${req.params.id}`, { error: msg });
    res.status(500).json({
      success: false,
      message: `Failed to delete signal ${req.params.id}`,
      error: msg,
      timestamp: Date.now(),
    });
  }
});

/**
 * DELETE /api/signals
 * Resets/clears active signals cache.
 */
router.delete('/signals', async (_req: Request, res: Response) => {
  signalEngine.clearSignals();
  await ScannerPersistence.clearSentSignals();
  res.status(200).json({
    success: true,
    message: 'Active signals cache cleared successfully',
    timestamp: Date.now(),
  });
});

/**
 * GET /api/signals/historical-performance
 * Retrieves authoritative completed signal performance metrics and trends over time.
 * Supports query parameter range: "7D" | "30D" | "90D" | "ALL" (default: "30D").
 */
router.get('/signals/historical-performance', async (req: Request, res: Response) => {
  try {
    const rawRange = (req.query?.range as string || '30D').toUpperCase().trim();
    const validRange: HistoricalPerformanceRange =
      rawRange === '7D' || rawRange === '90D' || rawRange === 'ALL' ? rawRange : '30D';

    const result = await HistoricalPerformanceManager.getPerformance(validRange);
    res.status(200).json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('[API] Failed to retrieve historical performance:', { error: msg });
    res.status(500).json({
      success: false,
      message: 'Unable to load historical performance. Please try again.',
      error: msg,
      timestamp: Date.now(),
    });
  }
});

/**
 * GET /api/signals/performance
 * Retrieves backend performance intelligence state (strategy, asset, timeframe, regime, confidence range, rolling WR, expectancy, profit factor, max losing streak).
 */
router.get('/signals/performance', (_req: Request, res: Response) => {
  try {
    const performance = StrategyPerformanceTracker.getPerformanceMetrics();
    res.status(200).json({
      success: true,
      performance,
      disclaimer: PERFORMANCE_LEGAL_DISCLAIMER,
      timestamp: Date.now(),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve performance intelligence metrics',
      error: msg,
      timestamp: Date.now(),
    });
  }
});

/**
 * POST /api/signals/backtest
 * Runs bar-by-bar backtest simulation using production strategy logic.
 */
router.post('/signals/backtest', async (req: Request, res: Response) => {
  try {
    const symbol = (req.body?.symbol as string) || 'EURUSD';
    const maxBars = req.body?.maxBars ? parseInt(req.body.maxBars as string, 10) : 300;

    // Fetch multi-timeframe candle datasets for backtest
    const candlesMap = await marketDataManager.getMultiTimeframeCandles(symbol, ['15m', '1h', '4h']);
    const backtestResult = WalkForwardEngine.runBacktest(symbol, candlesMap, maxBars);

    res.status(200).json({
      success: true,
      backtest: backtestResult,
      disclaimer: PERFORMANCE_LEGAL_DISCLAIMER,
      timestamp: Date.now(),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({
      success: false,
      message: 'Backtest execution error',
      error: msg,
      timestamp: Date.now(),
    });
  }
});

/**
 * POST /api/signals/walk-forward
 * Runs rolling window walk-forward evaluation using production strategy logic.
 */
router.post('/signals/walk-forward', async (req: Request, res: Response) => {
  try {
    const symbol = (req.body?.symbol as string) || 'EURUSD';
    const windows = req.body?.windows ? parseInt(req.body.windows as string, 10) : 3;

    const candlesMap = await marketDataManager.getMultiTimeframeCandles(symbol, ['15m', '1h', '4h']);
    const wfReport = WalkForwardEngine.runWalkForward(symbol, candlesMap, windows);

    res.status(200).json({
      success: true,
      walkForward: wfReport,
      disclaimer: PERFORMANCE_LEGAL_DISCLAIMER,
      timestamp: Date.now(),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({
      success: false,
      message: 'Walk-forward evaluation error',
      error: msg,
      timestamp: Date.now(),
    });
  }
});

/**
 * GET /api/signals/funnel
 * Retrieves active Opportunity Funnel items (Watching, Candidates, Confirmed, Promoted, Invalidated).
 */
router.get('/signals/funnel', async (_req: Request, res: Response) => {
  try {
    const report = OpportunityFunnelStore.evaluateAll();
    res.status(200).json({
      success: true,
      report,
      timestamp: Date.now(),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve opportunity funnel',
      error: msg,
      timestamp: Date.now(),
    });
  }
});

/**
 * POST /api/signals/funnel/evaluate
 * Triggers re-evaluation of all opportunity funnel candidates against current market data.
 */
router.post('/signals/funnel/evaluate', async (_req: Request, res: Response) => {
  try {
    const report = OpportunityFunnelStore.evaluateAll();
    res.status(200).json({
      success: true,
      message: `Funnel evaluated: ${report.totalActive} active items monitored (${report.watchingCount} watching, ${report.qualifiedCount} qualified, ${report.promotedCount} promoted)`,
      report,
      timestamp: Date.now(),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({
      success: false,
      message: 'Failed to evaluate opportunity funnel',
      error: msg,
      timestamp: Date.now(),
    });
  }
});

/**
 * GET /api/signals/funnel/config
 * Retrieves centralized funnel thresholds configuration.
 */
router.get('/signals/funnel/config', (_req: Request, res: Response) => {
  const thresholds = serverConfig.getThresholds();
  res.status(200).json({
    success: true,
    funnelThresholds: {
      watchingThreshold: thresholds.watchingThreshold,
      qualifiedCandidateThreshold: thresholds.qualifiedCandidateThreshold,
      signalThreshold: thresholds.signalThreshold,
      minimumScore: thresholds.minimumScore,
      minimumRR: thresholds.minimumRR,
      minimumNetRR: thresholds.minimumNetRR,
      minimumWinProbability: thresholds.minimumWinProbability,
    },
    timestamp: Date.now(),
  });
});

/**
 * GET /api/signals/regime-thresholds
 * Retrieves Gate 27 regime-adaptive threshold policy, modifiers, and recent logs.
 */
router.get('/signals/regime-thresholds', (_req: Request, res: Response) => {
  try {
    const policy = Gate27RegimeThresholds.getPolicy();
    const logs = Gate27RegimeThresholds.getLogs(50);
    res.status(200).json({
      success: true,
      policy,
      recentEvaluations: logs,
      timestamp: Date.now(),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve regime thresholds',
      error: msg,
      timestamp: Date.now(),
    });
  }
});

/**
 * POST /api/signals/regime-thresholds/evaluate
 * Evaluates adaptive threshold and margin for a given symbol, regime, strategy, and score.
 */
router.post('/signals/regime-thresholds/evaluate', (req: Request, res: Response) => {
  try {
    const { symbol, actualScore, regime, strategy, assetClass } = req.body;
    if (!symbol || actualScore === undefined) {
      res.status(400).json({
        success: false,
        message: "Missing required fields: 'symbol' and 'actualScore' are required",
        timestamp: Date.now(),
      });
      return;
    }

    const evaluation = Gate27RegimeThresholds.resolveThreshold({
      symbol: String(symbol),
      actualScore: Number(actualScore),
      regime: regime ? String(regime) : undefined,
      strategy: strategy ? String(strategy) : undefined,
      assetClass: assetClass ? String(assetClass) : undefined,
    });

    res.status(200).json({
      success: true,
      evaluation,
      timestamp: Date.now(),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({
      success: false,
      message: 'Failed to evaluate regime-adaptive threshold',
      error: msg,
      timestamp: Date.now(),
    });
  }
});

/**
 * POST /api/signals/regime-thresholds/policy
 * Updates regime threshold policy configuration (guarded against tiny sample size over-fitting).
 */
router.post('/signals/regime-thresholds/policy', adminAuthMiddleware, (req: Request, res: Response) => {
  try {
    const { policy, sampleSize } = req.body;
    if (!policy) {
      res.status(400).json({
        success: false,
        message: "Missing required 'policy' object in request body",
        timestamp: Date.now(),
      });
      return;
    }

    const result = Gate27RegimeThresholds.updatePolicy(policy, sampleSize);
    const httpCode = result.success ? 200 : 400;
    res.status(httpCode).json({
      success: result.success,
      message: result.message,
      policy: result.policy,
      timestamp: Date.now(),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({
      success: false,
      message: 'Failed to update regime threshold policy',
      error: msg,
      timestamp: Date.now(),
    });
  }
});

/**
 * POST /api/signals/confirmation-diversity/evaluate
 * Evaluates Gate 28 independent confirmation diversity for a list of confluence reasons or technical parameters.
 */
router.post('/signals/confirmation-diversity/evaluate', (req: Request, res: Response) => {
  try {
    const { reasons, technicalData } = req.body;
    if (!reasons || !Array.isArray(reasons)) {
      res.status(400).json({
        success: false,
        message: "Missing or invalid 'reasons' array in request body",
        timestamp: Date.now(),
      });
      return;
    }

    const evaluation = Gate28ConfirmationDiversity.evaluate(reasons, technicalData);

    res.status(200).json({
      success: true,
      evaluation,
      timestamp: Date.now(),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({
      success: false,
      message: 'Failed to evaluate confirmation diversity',
      error: msg,
      timestamp: Date.now(),
    });
  }
});

/**
 * POST /api/signals/executable-entry/validate
 * Validates executable entry price (ASK for BUY, BID for SELL, fallback display price if bid/ask unavailable)
 * for Gate 29 Executable Entry Validation.
 */
router.post('/signals/executable-entry/validate', (req: Request, res: Response) => {
  try {
    const { direction, entryPrice, quote, timestampMs } = req.body;
    if (!direction || (direction !== 'BUY' && direction !== 'SELL') || typeof entryPrice !== 'number' || !quote) {
      res.status(400).json({
        success: false,
        message: "Missing or invalid parameters. Requires 'direction' ('BUY'|'SELL'), numeric 'entryPrice', and 'quote' object.",
        timestamp: Date.now(),
      });
      return;
    }

    const validation = Gate29ExecutableEntryValidation.validateEntry(
      direction,
      entryPrice,
      quote,
      timestampMs || Date.now()
    );

    res.status(200).json({
      success: true,
      validation,
      timestamp: Date.now(),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({
      success: false,
      message: 'Failed to validate executable entry',
      error: msg,
      timestamp: Date.now(),
    });
  }
});

/**
 * POST /api/signals/data-freshness/evaluate
 * Evaluates asset-aware quote & candle data freshness and coverage according to Gate 30.
 */
router.post('/signals/data-freshness/evaluate', (req: Request, res: Response) => {
  try {
    const { symbol, assetClass, provider, timeframe, executionRequirement, quote, candles, nowMs, sessionState } = req.body;
    if (!symbol) {
      res.status(400).json({
        success: false,
        message: "Missing required parameter 'symbol'.",
        timestamp: Date.now(),
      });
      return;
    }

    const freshnessResult = Gate30DataFreshness.evaluate({
      symbol,
      assetClass,
      provider,
      timeframe,
      executionRequirement,
      quote,
      candles,
      nowMs,
      sessionState,
    });

    res.status(200).json({
      success: true,
      result: freshnessResult,
      timestamp: Date.now(),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({
      success: false,
      message: 'Failed to evaluate data freshness policy',
      error: msg,
      timestamp: Date.now(),
    });
  }
});

/**
 * POST /api/signals/news-risk/evaluate
 * Evaluates asset-specific news risk classification according to Gate 31.
 */
router.post('/signals/news-risk/evaluate', (req: Request, res: Response) => {
  try {
    const { symbol, timestampMs } = req.body;
    if (!symbol) {
      res.status(400).json({
        success: false,
        message: "Missing required parameter 'symbol'.",
        timestamp: Date.now(),
      });
      return;
    }

    const evaluation = Gate31NewsRiskClassification.evaluate(symbol, timestampMs || Date.now());

    res.status(200).json({
      success: true,
      evaluation,
      timestamp: Date.now(),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({
      success: false,
      message: 'Failed to evaluate news risk classification',
      error: msg,
      timestamp: Date.now(),
    });
  }
});

/**
 * GET /api/signals/news-risk/events
 * Returns registered scheduled news events in the system calendar.
 */
router.get('/signals/news-risk/events', (_req: Request, res: Response) => {
  try {
    const events = Gate31NewsRiskClassification.getRegisteredEvents();
    res.status(200).json({
      success: true,
      events,
      timestamp: Date.now(),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch registered news events',
      error: msg,
      timestamp: Date.now(),
    });
  }
});

/**
 * POST /api/signals/news-risk/register
 * Dynamically registers or updates a scheduled news event in the system calendar.
 */
router.post('/signals/news-risk/register', adminAuthMiddleware, (req: Request, res: Response) => {
  try {
    const event = req.body;
    if (!event || !event.id || !event.title || !event.scheduledTimeMs) {
      res.status(400).json({
        success: false,
        message: "Missing required event fields ('id', 'title', 'scheduledTimeMs').",
        timestamp: Date.now(),
      });
      return;
    }

    Gate31NewsRiskClassification.registerNewsEvent(event);

    res.status(200).json({
      success: true,
      message: `Registered news event '${event.id}' successfully.`,
      timestamp: Date.now(),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({
      success: false,
      message: 'Failed to register news event',
      error: msg,
      timestamp: Date.now(),
    });
  }
});

/**
 * POST /api/signals/adaptive-candidates/select
 * Evaluates Stage-2 candidates and adaptively selects candidates for deep MTF analysis (Gate 32).
 */
router.post('/signals/adaptive-candidates/select', (req: Request, res: Response) => {
  try {
    const { candidates, config, providerId } = req.body;
    if (!candidates || !Array.isArray(candidates)) {
      res.status(400).json({
        success: false,
        message: "Missing or invalid required parameter 'candidates' (must be an array).",
        timestamp: Date.now(),
      });
      return;
    }

    const selection = Gate32AdaptiveCandidateSelection.selectCandidates(candidates, config, providerId);

    res.status(200).json({
      success: true,
      selection,
      timestamp: Date.now(),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({
      success: false,
      message: 'Failed to perform adaptive candidate selection',
      error: msg,
      timestamp: Date.now(),
    });
  }
});

/**
 * POST /api/signals/execution-friction/stress-test
 * Evaluates Gate 34 execution friction stress test for trade signals (spread, slippage, fees, latency buffer).
 */
router.post('/signals/execution-friction/stress-test', (req: Request, res: Response) => {
  try {
    const { symbol, entryPrice, stopLoss, takeProfit, thresholdOverrides } = req.body;
    if (!symbol || typeof entryPrice !== 'number' || typeof stopLoss !== 'number' || typeof takeProfit !== 'number') {
      res.status(400).json({
        success: false,
        message: "Missing or invalid required parameters ('symbol', 'entryPrice', 'stopLoss', 'takeProfit').",
        timestamp: Date.now(),
      });
      return;
    }

    const testResult = Gate34ExecutionFrictionStressTest.evaluate(
      symbol,
      entryPrice,
      stopLoss,
      takeProfit,
      thresholdOverrides
    );

    res.status(200).json({
      success: true,
      result: testResult,
      timestamp: Date.now(),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({
      success: false,
      message: 'Failed to perform execution friction stress test',
      error: msg,
      timestamp: Date.now(),
    });
  }
});

/**
 * GATE 35 — Signal Funnel Analytics
 * GET /api/signals/funnel-analytics
 * Returns complete aggregated funnel report tracking scanned candidate records through Stage 2 -> Gate 0-9 -> Final Signal
 */
router.get('/signals/funnel-analytics', (req: Request, res: Response) => {
  try {
    const report = Gate35SignalFunnelAnalytics.getFunnelAnalytics();
    res.status(200).json({
      success: true,
      data: report,
      timestamp: Date.now(),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve signal funnel analytics',
      error: msg,
      timestamp: Date.now(),
    });
  }
});

/**
 * DELETE /api/signals/funnel-analytics
 * Resets/clears the recorded funnel analytics candidates data
 */
router.delete('/signals/funnel-analytics', adminAuthMiddleware, (req: Request, res: Response) => {
  try {
    Gate35SignalFunnelAnalytics.clear();
    res.status(200).json({
      success: true,
      message: 'Signal funnel analytics records cleared successfully.',
      timestamp: Date.now(),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({
      success: false,
      message: 'Failed to clear signal funnel analytics',
      error: msg,
      timestamp: Date.now(),
    });
  }
});

/**
 * GATE 36 — Configurable Signal Frequency
 * GET /api/signals/frequency-config
 * Returns current daily signal cap configuration, preset mode, candidate/signal/notification counts, and cluster allocation limits.
 */
router.get('/signals/frequency-config', async (req: Request, res: Response) => {
  try {
    const metrics = await Gate36ConfigurableSignalFrequency.getMetrics();
    res.status(200).json({
      success: true,
      data: metrics,
      timestamp: Date.now(),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve signal frequency configuration',
      error: msg,
      timestamp: Date.now(),
    });
  }
});

/**
 * POST /api/signals/frequency-config & PUT /api/signals/frequency-config
 * Updates daily signal cap configuration and preset (5, 10, 15, CUSTOM)
 */
const updateFrequencyHandler = async (req: Request, res: Response) => {
  try {
    const { preset, customCap, maxClusterAllocationPct } = req.body || {};

    const updated = Gate36ConfigurableSignalFrequency.setConfig({
      preset,
      customCap: typeof customCap === 'number' ? customCap : undefined,
      maxClusterAllocationPct: typeof maxClusterAllocationPct === 'number' ? maxClusterAllocationPct : undefined,
    });

    const metrics = await Gate36ConfigurableSignalFrequency.getMetrics();

    res.status(200).json({
      success: true,
      message: `Signal frequency configuration updated successfully. Cap set to ${updated.dailySignalCap} (Preset: ${updated.preset}).`,
      data: metrics,
      timestamp: Date.now(),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({
      success: false,
      message: 'Failed to update signal frequency configuration',
      error: msg,
      timestamp: Date.now(),
    });
  }
};

router.post('/signals/frequency-config', adminAuthMiddleware, updateFrequencyHandler);
router.put('/signals/frequency-config', adminAuthMiddleware, updateFrequencyHandler);

/**
 * GATE 3 — CHEAP PRELIMINARY SCREEN
 * GET /api/signals/gate3/screen/:symbol
 * Evaluates cheap preliminary screening factors (Liquidity, Volume, Trend, Momentum, Volatility, Spread).
 * Does NOT generate a trade signal or request full MTF history.
 */
router.get('/signals/gate3/screen/:symbol', async (req: Request, res: Response) => {
  try {
    const symbol = (req.params.symbol || 'BTCUSDT').toUpperCase();
    const htf1h = await marketDataManager.getCandles(symbol, undefined, '1h', 50, false);
    const liveTicker = await marketDataManager.getPrice(symbol, undefined, false).catch(() => null);

    const gate3Result = Gate3PreliminaryScreen.screenAsset(symbol, htf1h, liveTicker);
    res.status(200).json({
      success: true,
      gate: 'GATE_3_CHEAP_PRELIMINARY_SCREEN',
      symbol,
      data: gate3Result,
      isTradeSignal: false, // Strict safety guarantee: preliminary scores never create trade signals
      timestamp: Date.now(),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({
      success: false,
      message: 'Failed to run Gate 3 preliminary screening',
      error: msg,
      timestamp: Date.now(),
    });
  }
});

/**
 * GATE 4 — PROVIDER QUOTA / REQUEST BUDGET GATE
 * GET /api/signals/gate4/budget
 * Returns current provider request tracking, error & timeout counts, latency, and dynamic deep analysis allowance.
 */
router.get('/signals/gate4/budget', async (req: Request, res: Response) => {
  try {
    const budgetEvaluation = Gate4RequestBudget.evaluateBudget();
    res.status(200).json({
      success: true,
      gate: 'GATE_4_PROVIDER_QUOTA_BUDGET',
      data: budgetEvaluation,
      timestamp: Date.now(),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({
      success: false,
      message: 'Failed to evaluate Gate 4 provider budget',
      error: msg,
      timestamp: Date.now(),
    });
  }
});

/**
 * GATE 5 — DEEP CANDIDATE SELECTION
 * GET /api/signals/gate5/preview
 * Runs preliminary screening on a cross-asset subset and selects the top 8–12 deep candidates
 * ranked by Trend (25%), Momentum (20%), Volume (15%), Volatility Quality (15%), Liquidity (10%), Structure (15%).
 */
router.get('/signals/gate5/preview', async (req: Request, res: Response) => {
  try {
    const sampleUniverse = [
      'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT', 'DOGEUSDT', 'LINKUSDT', 'AVAXUSDT', 'SUIUSDT',
      'EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD', 'NZDUSD', 'EURGBP', 'GBPJPY',
      'AAPL', 'NVDA', 'MSFT', 'TSLA', 'AMZN', 'GOOGL', 'META', 'LLY', 'V', 'JPM'
    ];

    // Screen each with Gate 3 using available 1H candles
    const preliminaryCandidates: Array<{
      asset: string;
      htf1h: any[];
      preliminaryScore: number;
      direction: any;
      gate3Result: any;
    }> = [];

    await Promise.all(
      sampleUniverse.map(async (asset) => {
        try {
          const htf1h = await marketDataManager.getCandles(asset, undefined, '1h', 50, false);
          if (!htf1h || htf1h.length < 15) return;
          const liveTicker = await marketDataManager.getPrice(asset, undefined, false).catch(() => null);
          const g3 = Gate3PreliminaryScreen.screenAsset(asset, htf1h, liveTicker);
          if (g3.passed) {
            preliminaryCandidates.push({
              asset,
              htf1h,
              preliminaryScore: g3.preliminaryScore,
              direction: g3.direction,
              gate3Result: g3,
            });
          }
        } catch {}
      })
    );

    const gate4Budget = Gate4RequestBudget.evaluateBudget();
    const gate5Result = Gate5DeepCandidateSelection.selectCandidates(
      preliminaryCandidates,
      gate4Budget.maxDeepCandidates
    );

    res.status(200).json({
      success: true,
      gate: 'GATE_5_DEEP_CANDIDATE_SELECTION',
      budgetHealth: gate4Budget.overallBudgetHealth,
      maxAllowedByBudget: gate4Budget.maxDeepCandidates,
      preliminaryPoolCount: preliminaryCandidates.length,
      data: gate5Result,
      timestamp: Date.now(),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({
      success: false,
      message: 'Failed to run Gate 5 deep candidate selection preview',
      error: msg,
      timestamp: Date.now(),
    });
  }
});

/**
 * GET /api/signals/gate6/mtf-preview
 * Runs Gate 6 Progressive Deep MTF Analysis on top 3-5 candidates.
 * Demonstrates Layer 1 early termination and Layer 2 confirmation.
 */
router.get('/signals/gate6/mtf-preview', async (_req: Request, res: Response) => {
  try {
    const sampleUniverse = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'EUR/USD', 'GBP/USD', 'XAU/USD', 'AAPL'];
    const candidatesInput: Array<{
      asset: string;
      direction: 'BUY' | 'SELL';
      htf1h: any[];
      preliminaryScore: number;
    }> = [];

    await Promise.all(
      sampleUniverse.slice(0, 5).map(async (asset) => {
        try {
          const htf1h = await marketDataManager.getCandles(asset, undefined, '1h', 50, false);
          if (!htf1h || htf1h.length < 15) return;
          const liveTicker = await marketDataManager.getPrice(asset, undefined, false).catch(() => null);
          const g3 = Gate3PreliminaryScreen.screenAsset(asset, htf1h, liveTicker);
          candidatesInput.push({
            asset,
            direction: (g3.direction as 'BUY' | 'SELL') || 'BUY',
            htf1h,
            preliminaryScore: g3.preliminaryScore,
          });
        } catch {}
      })
    );

    const gate6Result = await Gate6ProgressiveMTF.analyzeCandidates(candidatesInput, 5);

    res.status(200).json({
      success: true,
      gate: 'GATE_6_PROGRESSIVE_DEEP_MTF',
      inputCandidatesCount: candidatesInput.length,
      data: gate6Result,
      timestamp: Date.now(),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({
      success: false,
      message: 'Failed to run Gate 6 progressive MTF preview',
      error: msg,
      timestamp: Date.now(),
    });
  }
});

/**
 * GET /api/signals/gate7/validate/:symbol
 * Runs Gate 7 13-Point Mandatory Hard Gates validation on a given symbol.
 */
router.get('/signals/gate7/validate/:symbol', async (req: Request, res: Response) => {
  try {
    const symbol = decodeURIComponent(req.params.symbol);
    const liveTicker = await marketDataManager.getPrice(symbol, undefined, true);
    if (!liveTicker || liveTicker.price <= 0) {
      return res.status(400).json({
        success: false,
        message: `Unable to fetch live ticker for ${symbol}`,
      });
    }

    const intervals = ['1h', '15m', '5m', '4h'];
    const candlesMap: Record<string, any[]> = {};
    for (const interval of intervals) {
      try {
        const c = await marketDataManager.getCandles(symbol, undefined, interval, 50, false);
        if (c && c.length > 0) candlesMap[interval] = c;
      } catch {}
    }

    const price = liveTicker.price;
    const isCrypto = symbol.includes('USDT') || symbol.includes('BTC');
    const slOffset = price * (isCrypto ? 0.02 : 0.005);
    const tpOffset = slOffset * 2.0;

    const gate7Result = Gate7FinalTradeValidation.validateCandidate({
      symbol,
      direction: 'BUY',
      entryPrice: price,
      stopLoss: price - slOffset,
      takeProfit: price + tpOffset,
      tp1: price + tpOffset,
      tp2: price + (tpOffset * 1.5),
      tp3: price + (tpOffset * 2.0),
      riskRewardRatio: 2.0,
      netRiskRewardRatio: 1.8,
      score: 82,
      candlesMap,
      liveTicker,
      atr: slOffset,
      primaryStrategy: 'Multi-Timeframe Trend Confluence',
      marketRegime: 'TRENDING_UP',
      activeSignals: signalEngine.activeSignals,
      minimumRRThreshold: 1.5,
      minimumScoreThreshold: 75,
    });

    res.status(200).json({
      success: true,
      gate: 'GATE_7_FINAL_TRADE_VALIDATION',
      symbol,
      data: gate7Result,
      timestamp: Date.now(),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({
      success: false,
      message: `Failed to run Gate 7 validation for ${req.params.symbol}`,
      error: msg,
      timestamp: Date.now(),
    });
  }
});

export default router;
