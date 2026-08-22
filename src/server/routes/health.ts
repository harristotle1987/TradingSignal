/**
 * /api/health Endpoint
 * Returns backend system status, uptime, and AI provider configuration state.
 */

import { Request, Response, Router } from 'express';
import { serverConfig } from '../config.js';
import { signalEngine } from '../signals/SignalEngine.js';
import { marketDataManager } from '../market/MarketDataManager.js';

const router = Router();
const startTime = Date.now();

router.get('/health', async (_req: Request, res: Response) => {
  const config = serverConfig.getConfig();
  const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);
  const activeSignals = await signalEngine.getActiveSignals();

  const health = await marketDataManager.getTruthfulMarketHealth();

  const persistenceReady = config.productionPersistenceReady;
  const isProd = config.nodeEnv === 'production';

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

  res.status(200).json({
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
      persistenceStatus: persistenceReady ? 'OPERATIONAL' : 'DEGRADED_FIREBASE_REQUIRED',
      scannerStatus: health.scannerReady ? 'OPERATIONAL' : 'DISABLED_OR_DEGRADED',
    },
    marketData: health,
  });
});


export default router;
