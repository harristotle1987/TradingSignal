/**
 * Express API Router for Trading Signals (Gate 3)
 */

import { Router, Request, Response } from 'express';
import { signalEngine } from '../signals/SignalEngine.js';
import { hourlyScanner } from '../signals/HourlyScanner.js';
import { SignalLogger } from '../signals/SignalLogger.js';
import { SignalAuditStore } from '../signals/SignalAuditStore.js';
import { SignalOutcomeLogger } from '../signals/SignalOutcomeLogger.js';
import { SignalLifecycleManager } from '../signals/SignalLifecycleManager.js';
import { OutcomeTrackerTester } from '../signals/OutcomeTrackerTester.js';
import { StrategyPerformanceTracker, PERFORMANCE_LEGAL_DISCLAIMER } from '../signals/StrategyPerformanceTracker.js';
import { WalkForwardEngine } from '../signals/WalkForwardEngine.js';
import { marketDataManager } from '../market/MarketDataManager.js';
import { marketCache } from '../market/CacheStore.js';
import { logger } from '../logger.js';
import { ScannerPersistence, PersistedSentSignal } from '../signals/ScannerPersistence.js';
import { getFirestoreAdmin } from '../firebaseAdmin.js';

const router = Router();

/**
 * GET /api/scanner/settings
 * Retrieves automated hourly scanner configurations and today's stats.
 */
router.get('/scanner/settings', async (_req: Request, res: Response) => {
  const settings = await hourlyScanner.getSettingsAsync();
  res.status(200).json({
    success: true,
    settings,
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
 * POST /api/scanner/trigger
 * Production entry point for external automated cron scheduler.
 * Strictly protected by server-side SCANNER_CRON_SECRET bearer token.
 */
router.post('/scanner/trigger', async (req: Request, res: Response) => {
  const cronSecret = process.env.SCANNER_CRON_SECRET;
  const authHeader = req.headers.authorization;

  // Verify authentication BEFORE initiating any market data or AI API calls
  let isAuthenticated = false;
  if (cronSecret && cronSecret.trim().length > 0) {
    if (authHeader && authHeader.trim() === `Bearer ${cronSecret.trim()}`) {
      isAuthenticated = true;
    }
  }

  if (!isAuthenticated) {
    return res.status(401).json({
      success: false,
      status: 'UNAUTHORIZED',
      message: 'Unauthorized: Invalid or missing SCANNER_CRON_SECRET bearer token.',
      timestamp: Date.now(),
      lastScanTime: 0,
      candidatesEvaluated: 0,
      acceptedSignalsCount: 0,
      acceptedSignals: [],
      signalsFound: 0,
      qualifiedSetups: [],
      rejectedCount: 0,
      rejectionReasons: ['Unauthorized: Request missing valid Bearer SCANNER_CRON_SECRET token.'],
    });
  }

  // 1. Log external scan start
  logger.info('EXTERNAL_HOURLY_SCAN_STARTED');

  try {
    // Trigger automated scan enforcing configured interval (15m, 30m, 45m, 60m)
    const result = await hourlyScanner.triggerAutomatedScan(true);

    let statusLog = '';
    if (result.status === 'COMPLETED') {
      logger.info('EXTERNAL_HOURLY_SCAN_COMPLETED');
      statusLog = 'EXTERNAL_HOURLY_SCAN_COMPLETED';
    } else if (result.status === 'SKIPPED_CAP_REACHED' || result.status === 'SCAN_ALREADY_RUNNING' || result.status === 'SKIPPED_NOT_DUE') {
      logger.info('EXTERNAL_HOURLY_SCAN_SKIPPED');
      statusLog = 'EXTERNAL_HOURLY_SCAN_SKIPPED';
    } else {
      logger.error('EXTERNAL_HOURLY_SCAN_FAILED');
      statusLog = 'EXTERNAL_HOURLY_SCAN_FAILED';
    }

    const httpCode = result.status === 'ERROR' ? 500 : 200;
    res.status(httpCode).json({
      ...result,
      external_hourly_scan_status: statusLog
    });
  } catch (err: unknown) {
    logger.error('EXTERNAL_HOURLY_SCAN_FAILED');
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({
      success: false,
      status: 'ERROR',
      message: 'Failed to execute hourly scanner trigger',
      external_hourly_scan_status: 'EXTERNAL_HOURLY_SCAN_FAILED',
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
router.delete('/signals/outcomes', async (_req: Request, res: Response) => {
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
          dataSource: activeSig.dataSource || 'binance',
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
          dataSource: dataSource || 'binance',
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
      const dec = finalTp < 10 ? 5 : 2;

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
router.post('/signals/backfill-outcomes', async (_req: Request, res: Response) => {
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
    const success = await SignalLogger.deleteLog(id);
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
 * DELETE /api/signals/log
 * Clears dedicated signal log records.
 */
router.delete('/signals/log', async (_req: Request, res: Response) => {
  try {
    await SignalLogger.clearLogs();
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
 * Triggers multi-timeframe signal analysis and validation for a symbol (default EURUSD).
 */
router.post('/signals/generate', async (req: Request, res: Response) => {
  try {
    const symbol = (req.body?.symbol as string) || 'EURUSD';
    const category = req.body?.category as string | undefined;
    const result = await signalEngine.generateSignal(symbol, category);

    if (result.success) {
      return res.status(200).json(result);
    } else {
      // If no valid setup or market data unavailable, return 200/202 or 503 depending on cause
      return res.status(200).json(result);
    }
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
 * DELETE /api/signals
 * Resets/clears active signals cache.
 */
router.delete('/signals', (_req: Request, res: Response) => {
  signalEngine.clearSignals();
  res.status(200).json({
    success: true,
    message: 'Active signals cache cleared successfully',
    timestamp: Date.now(),
  });
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
 * POST /api/signals/test-outcome
 * Executes the complete integration test suite for automated Signal Outcome Tracking.
 */
router.post('/signals/test-outcome', async (_req: Request, res: Response) => {
  try {
    const report = await OutcomeTrackerTester.runSuite();
    const httpCode = report.success ? 200 : 500;
    res.status(httpCode).json({
      success: report.success,
      message: report.success ? 'All outcome tracking tests passed successfully' : 'Some outcome tracking tests failed',
      report,
      timestamp: Date.now(),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({
      success: false,
      message: 'Failed to run outcome tracking test suite',
      error: msg,
      timestamp: Date.now(),
    });
  }
});

export default router;
