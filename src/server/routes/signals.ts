/**
 * Express API Router for Trading Signals (Gate 3)
 */

import { Router, Request, Response } from 'express';
import { signalEngine } from '../signals/SignalEngine.js';

const router = Router();

/**
 * GET /api/signals
 * Retrieves all currently active validated trading signals.
 */
router.get('/signals', (_req: Request, res: Response) => {
  const signals = signalEngine.getActiveSignals();
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

export default router;
