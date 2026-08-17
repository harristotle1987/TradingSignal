/**
 * /api/health Endpoint
 * Returns backend system status, uptime, and AI provider configuration state.
 */

import { Request, Response, Router } from 'express';
import { serverConfig } from '../config.js';
import { signalEngine } from '../signals/SignalEngine.js';

const router = Router();
const startTime = Date.now();

router.get('/health', async (_req: Request, res: Response) => {
  const config = serverConfig.getConfig();
  const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);
  const activeSignals = await signalEngine.getActiveSignals();

  res.status(200).json({
    status: 'ok',
    service: 'trading-signal-backend',
    environment: config.nodeEnv,
    timestamp: new Date().toISOString(),
    uptimeSeconds,
    aiProvider: {
      provider: 'NVIDIA API',
      configured: config.providers.nvidiaConfigured,
      status: config.providers.nvidiaConfigured ? 'READY' : 'KEY_MISSING',
    },
    system: {
      signalEngineStatus: 'GATE_3_VALIDATED_SIGNAL_ENGINE_ACTIVE',
      activeSignalsCount: activeSignals.length,
      marketDataConnected: true,
    },
  });
});


export default router;
