/**
 * /api/config/status Endpoint
 * Securely returns provider readiness status without exposing raw credentials.
 */

import { Request, Response, Router } from 'express';
import { serverConfig } from '../config.js';
import { marketDataManager } from '../market/MarketDataManager.js';

const router = Router();

router.get('/config/status', async (_req: Request, res: Response) => {
  const config = serverConfig.getConfig();
  const providers = serverConfig.getProviderStatus();

  const isProd = config.nodeEnv === 'production';
  const persistenceReady = config.productionPersistenceReady;

  const health = await marketDataManager.getTruthfulMarketHealth();

  let overallStatus: 'OPERATIONAL' | 'DEGRADED' | 'UNAVAILABLE' = health.status;
  if (isProd && !persistenceReady) {
    overallStatus = health.marketDataConnected ? 'DEGRADED' : 'UNAVAILABLE';
  }

  res.status(200).json({
    success: true,
    timestamp: new Date().toISOString(),
    environment: config.nodeEnv,
    productionPersistenceReady: persistenceReady,
    scannerReady: health.scannerReady,
    status: overallStatus,
    persistence: {
      ready: persistenceReady,
      type: isProd ? 'FIRESTORE_MANDATORY' : 'LOCAL_OR_FIRESTORE',
      status: persistenceReady ? 'OPERATIONAL' : 'DEGRADED_FIREBASE_REQUIRED',
    },
    providers: {
      nvidia: {
        name: 'NVIDIA AI API',
        configured: providers.nvidiaConfigured,
        type: 'AI_INFERENCE_ENGINE',
        security: 'Server-Side Environment Variable (NVIDIA_API_KEY)',
      },
      bitget: {
        name: 'Bitget Exchange',
        configured: health.providers.bitget.providerConfigured,
        reachable: health.providers.bitget.providerReachable,
        status: health.providers.bitget.status,
        type: 'CRYPTO_MARKET_DATA',
        security: 'Server-Side Environment Variable',
      },
      finnhub: {
        name: 'Finnhub Market Data',
        configured: health.providers.finnhub.providerConfigured,
        reachable: health.providers.finnhub.providerReachable,
        status: health.providers.finnhub.status,
        type: 'STOCKS_AND_FOREX_DATA',
        security: 'Server-Side Environment Variable',
      },
      twelvedata: {
        name: 'Twelve Data (Forex)',
        configured: health.providers.twelvedata.providerConfigured,
        reachable: health.providers.twelvedata.providerReachable,
        status: health.providers.twelvedata.status,
        type: 'AUTHORITATIVE_FOREX_DATA',
        security: 'Server-Side Environment Variable (TWELVE_DATA_API_KEY)',
      },
    },
    gateInfo: {
      currentGate: 'GATE_3_VALIDATED_SIGNAL_ENGINE',
      signalsEnabled: health.signalsEnabled,
      marketFeedsActive: health.marketFeedsActive,
      marketDataConnected: health.marketDataConnected,
      reason: health.signalsEnabled
        ? 'Gate 3 enforces real-time market feeds, multi-timeframe indicator confluence, and NVIDIA AI risk evaluation.'
        : 'Signals are disabled due to market data or persistence constraints.',
    },
    expirationPolicy: {
      signalExpirationMinutes: config.signalExpirationMinutes,
      signalExpirationMs: config.signalExpirationMs,
      appliesTo: 'WAITING_ENTRY',
      disabledAfterEntry: true,
    },
    thresholds: config.thresholds,
  });
});

export default router;
