/**
 * /api/config/status Endpoint
 * Securely returns provider readiness status without exposing raw credentials.
 */

import { Request, Response, Router } from 'express';
import { serverConfig } from '../config.js';

const router = Router();

router.get('/config/status', (_req: Request, res: Response) => {
  const config = serverConfig.getConfig();
  const providers = serverConfig.getProviderStatus();

  res.status(200).json({
    success: true,
    timestamp: new Date().toISOString(),
    environment: config.nodeEnv,
    providers: {
      nvidia: {
        name: 'NVIDIA AI API',
        configured: providers.nvidiaConfigured,
        type: 'AI_INFERENCE_ENGINE',
        security: 'Server-Side Environment Variable (NVIDIA_API_KEY)',
      },
      bitget: {
        name: 'Bitget Exchange',
        configured: providers.bitgetConfigured,
        type: 'CRYPTO_MARKET_DATA',
        security: 'Server-Side Environment Variable',
      },
      finnhub: {
        name: 'Finnhub Market Data',
        configured: providers.finnhubConfigured,
        type: 'STOCKS_AND_FOREX_DATA',
        security: 'Server-Side Environment Variable',
      },
      twelvedata: {
        name: 'Twelve Data (Forex)',
        configured: providers.twelvedataConfigured,
        type: 'AUTHORITATIVE_FOREX_DATA',
        security: 'Server-Side Environment Variable (TWELVE_DATA_API_KEY)',
      },
    },
    gateInfo: {
      currentGate: 'GATE_3_VALIDATED_SIGNAL_ENGINE',
      signalsEnabled: true,
      marketFeedsActive: true,
      reason: 'Gate 3 enforces real-time Twelve Data/Bitget market feeds, multi-timeframe indicator confluence, and NVIDIA AI risk evaluation.',
    },

  });
});

export default router;
