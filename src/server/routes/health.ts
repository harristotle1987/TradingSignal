/**
 * /api/health Endpoint
 * Returns backend system status, uptime, and AI provider configuration state.
 */

import { Request, Response, Router } from 'express';
import { serverConfig } from '../config.js';
import { signalEngine } from '../signals/SignalEngine.js';
import { marketDataManager } from '../market/MarketDataManager.js';
import { getNeonPool, verifyRequiredProductionTables } from '../infrastructure/neon/db.js';
import { getAuthRepository, getSignalRepository, getScannerStateRepository } from '../infrastructure/index.js';
import { logger } from '../logger.js';

const router = Router();
const startTime = Date.now();

router.get('/health', async (_req: Request, res: Response) => {
  try {
    const config = serverConfig.getConfig();
    const isProd = config.nodeEnv === 'production';

    // Fast-fail if production persistence is required but not configured
    if (isProd && !config.productionPersistenceReady) {
      return res.status(503).json({
        status: 'UNAVAILABLE',
        productionPersistenceReady: false
      });
    }

    const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);

    let activeSignals: any[] = [];
    try {
      if (config.productionPersistenceReady) {
        const pool = getNeonPool();
        if (!pool) {
          return res.status(503).json({
            status: 'UNAVAILABLE',
            productionPersistenceReady: false
          });
        }
        await pool.query('SELECT 1');
      }

      const activeSignalsDetailed = await signalEngine.getActiveSignalsDetailed();
      if (activeSignalsDetailed.success === false || activeSignalsDetailed.error === 'PERSISTENCE_UNAVAILABLE') {
        logger.error('[Health Endpoint] Database connection/query failed in getActiveSignalsDetailed');
        return res.status(503).json({
          status: 'UNAVAILABLE',
          productionPersistenceReady: false
        });
      }
      activeSignals = activeSignalsDetailed.signals || [];
    } catch (err: any) {
      logger.error('[Health Endpoint] Database check failed during health verify:', {
        error: err instanceof Error ? err.message : String(err),
      });
      return res.status(503).json({
        status: 'UNAVAILABLE',
        productionPersistenceReady: false
      });
    }

    const health = await marketDataManager.getTruthfulMarketHealth();
    const persistenceReady = config.productionPersistenceReady;

    let overallStatus: 'OPERATIONAL' | 'DEGRADED' | 'UNAVAILABLE' = health.status;
    if (isProd && !persistenceReady) {
      overallStatus = health.marketDataConnected ? 'DEGRADED' : 'UNAVAILABLE';
    }

    let signalEngineStatus = 'GATE_3_VALIDATED_SIGNAL_ENGINE_ACTIVE';
    if (isProd && !persistenceReady) {
      signalEngineStatus = 'DEGRADED_PERSISTENCE_MISSING';
    } else if (!health.marketDataConnected) {
      signalEngineStatus = 'UNAVAILABLE_MARKET_DATA_DISCONNECTED';
    } else if (!health.signalsEnabled) {
      signalEngineStatus = 'DEGRADED_SIGNALS_DISABLED';
    }

    return res.status(200).json({
      status: overallStatus,
      service: 'trading-signal-backend',
      environment: config.nodeEnv,
      timestamp: new Date().toISOString(),
      uptimeSeconds,

      // GATE 68 Truthful Health Metrics
      providerConfigured: health.providerConfigured,
      providerReachable: health.providerReachable,
      lastSuccessfulQuote: health.lastSuccessfulQuote,
      quoteAge: health.quoteAge,
      dataFreshness: health.dataFreshness,
      signalsEnabled: health.signalsEnabled,
      productionPersistenceReady: persistenceReady,
      scannerReady: health.scannerReady,
      marketDataConnected: health.marketDataConnected,
      marketFeedsActive: health.marketFeedsActive,

      aiProvider: {
        provider: 'NVIDIA API',
        configured: config.providers.nvidiaConfigured,
        status: config.providers.nvidiaConfigured ? 'READY' : 'KEY_MISSING',
      },
      system: {
        signalEngineStatus,
        activeSignalsCount: activeSignals.length,
        marketDataConnected: health.marketDataConnected,
        marketFeedsActive: health.marketFeedsActive,
        persistenceStatus: persistenceReady ? 'OPERATIONAL' : 'DEGRADED_DATABASE_URL_REQUIRED',
        scannerStatus: health.scannerReady ? 'OPERATIONAL' : 'DISABLED_OR_DEGRADED',
      },
      marketData: health,
    });
  } catch (outerErr: any) {
    logger.error('[Health Endpoint] Unexpected outer exception in /api/health:', {
      error: outerErr instanceof Error ? outerErr.message : String(outerErr),
    });
    return res.status(503).json({
      status: 'UNAVAILABLE',
      productionPersistenceReady: false
    });
  }
});

/**
 * GET /api/health/readiness
 * Performs thorough and independent verification of database, repositories, 
 * scanner state, market data providers, and AI system configurations.
 */
router.get('/health/readiness', async (_req: Request, res: Response) => {
  try {
    const config = serverConfig.getConfig();

    // 1. Verify DATABASE_URL exists
    const dbUrl = process.env.DATABASE_URL?.trim();
    if (!dbUrl) {
      logger.warn('[Readiness Check] DATABASE_URL is missing or empty.');
      return res.status(503).json({
        ready: false,
        failedComponent: 'database'
      });
    }

    // 2. Verify Neon connection works
    const pool = getNeonPool();
    if (!pool) {
      logger.warn('[Readiness Check] Neon pool is unavailable.');
      return res.status(503).json({
        ready: false,
        failedComponent: 'database'
      });
    }

    try {
      await pool.query('SELECT 1');
    } catch (err: any) {
      logger.error('[Readiness Check] Neon connection works test query failed:', {
        error: err instanceof Error ? err.message : String(err),
      });
      return res.status(503).json({
        ready: false,
        failedComponent: 'database'
      });
    }

    // 3. Verify required Neon tables exist
    try {
      const tableVerification = await verifyRequiredProductionTables();
      if (!tableVerification.ready) {
        logger.error('[Readiness Check] Database schema check failed. Missing tables:', {
          missingTables: tableVerification.missingTables
        });
        return res.status(503).json({
          ready: false,
          failedComponent: 'database'
        });
      }
    } catch (err: any) {
      logger.error('[Readiness Check] Error querying database schema tables:', {
        error: err instanceof Error ? err.message : String(err),
      });
      return res.status(503).json({
        ready: false,
        failedComponent: 'database'
      });
    }

    // 4. Verify authentication repository works
    try {
      const authRepo = getAuthRepository();
      const testVerify = await authRepo.verifyToken('bogus_token');
      if (testVerify === undefined) {
        throw new Error('Auth repository check returned undefined');
      }
    } catch (err: any) {
      logger.error('[Readiness Check] Authentication repository check failed:', {
        error: err instanceof Error ? err.message : String(err),
      });
      return res.status(503).json({
        ready: false,
        failedComponent: 'authentication'
      });
    }

    // 5. Verify signal repository works
    try {
      const signalRepo = getSignalRepository();
      await signalRepo.findById('bogus_id');
    } catch (err: any) {
      logger.error('[Readiness Check] Signal repository check failed:', {
        error: err instanceof Error ? err.message : String(err),
      });
      return res.status(503).json({
        ready: false,
        failedComponent: 'signals'
      });
    }

    // 6. Verify scanner infrastructure is available
    try {
      const scannerRepo = getScannerStateRepository();
      await scannerRepo.getCapState('2026-10-01');
    } catch (err: any) {
      logger.error('[Readiness Check] Scanner state repository is unreachable/unavailable:', {
        error: err instanceof Error ? err.message : String(err),
      });
      return res.status(503).json({
        ready: false,
        failedComponent: 'scanner'
      });
    }

    // 7. Verify market-data configuration exists
    const hasFinnhub = Boolean(process.env.FINNHUB_API_KEY && process.env.FINNHUB_API_KEY.trim().length > 0);
    const hasBitget = Boolean(
      process.env.BITGET_API_KEY &&
      process.env.BITGET_SECRET_KEY &&
      process.env.BITGET_PASSPHRASE
    );
    const hasTwelveData = Boolean(process.env.TWELVE_DATA_API_KEY && process.env.TWELVE_DATA_API_KEY.trim().length > 0);

    if (!hasFinnhub && !hasBitget && !hasTwelveData) {
      logger.error('[Readiness Check] All market-data configurations are missing.');
      return res.status(503).json({
        ready: false,
        failedComponent: 'market-data'
      });
    }

    // 8. Verify required AI configuration exists
    const hasNvidia = Boolean(process.env.NVIDIA_API_KEY && process.env.NVIDIA_API_KEY.trim().length > 0);
    if (!hasNvidia) {
      logger.error('[Readiness Check] NVIDIA_API_KEY config is missing.');
      return res.status(503).json({
        ready: false,
        failedComponent: 'ai-provider'
      });
    }

    // All checks completed successfully
    return res.status(200).json({
      ready: true,
      database: {
        configured: true,
        reachable: true,
        schemaReady: true
      },
      authentication: {
        ready: true
      },
      signals: {
        repositoryReady: true
      }
    });

  } catch (outerErr: any) {
    logger.error('[Readiness Check] Unexpected exception executing readiness probe:', {
      error: outerErr instanceof Error ? outerErr.message : String(outerErr),
    });
    return res.status(503).json({
      ready: false,
      failedComponent: 'unexpected-error'
    });
  }
});

export default router;
