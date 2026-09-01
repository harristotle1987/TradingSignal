/**
 * Express Market Data API Routes (Gate 2)
 * Exposes endpoints for testing individual providers and unified market data requests.
 */

import { Request, Response, Router } from 'express';
import { marketDataManager } from '../market/MarketDataManager.js';
import { logger } from '../logger.js';
import { MarketSessionManager } from '../market/MarketSessionManager.js';
import { requestRegistry } from '../market/CacheStore.js';

const router = Router();

/**
 * GET /api/market/status
 * Reports connectivity/availability for all market data providers based on real API tests.
 */
router.get('/market/status', async (_req: Request, res: Response) => {
  try {
    const status = await marketDataManager.getMarketStatus();
    res.status(200).json(status);
  } catch (err) {
    logger.error('Failed to retrieve market status', { error: String(err) });
    res.status(500).json({
      error: 'Failed to retrieve provider status',
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

/**
 * GET /api/market/twelvedata/status
 * Dedicated Twelve Data Forex diagnostic endpoint
 */
router.get('/market/twelvedata/status', async (_req: Request, res: Response) => {
  try {
    const provider = marketDataManager.getProvider('twelvedata');
    if (!provider) {
      return res.status(503).json({ error: 'Twelve Data provider not registered' });
    }
    const health = await provider.healthCheck();
    res.status(200).json(health);
  } catch (err) {
    res.status(500).json({
      error: 'Failed to retrieve Twelve Data status',
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

/**
 * GET /api/market/bitget/price?symbol=BTCUSDT
 */
router.get('/market/bitget/price', async (req: Request, res: Response) => {
  const symbol = (req.query.symbol as string) || 'BTCUSDT';
  const ticker = await marketDataManager.getPrice(symbol, 'bitget');

  if (ticker.status === 'MARKET_DATA_UNAVAILABLE') {
    res.status(503).json(ticker);
  } else {
    res.status(200).json(ticker);
  }
});

/**
 * GET /api/market/finnhub/price?symbol=AAPL
 */
router.get('/market/finnhub/price', async (req: Request, res: Response) => {
  const symbol = (req.query.symbol as string) || 'AAPL';
  const ticker = await marketDataManager.getPrice(symbol, 'finnhub');

  if (ticker.status === 'MARKET_DATA_UNAVAILABLE') {
    res.status(503).json(ticker);
  } else {
    res.status(200).json(ticker);
  }
});

/**
 * GET /api/market/twelvedata/price?symbol=EURUSD
 * Dedicated test endpoint for Twelve Data Forex
 */
router.get('/market/twelvedata/price', async (req: Request, res: Response) => {
  const symbol = (req.query.symbol as string) || 'EURUSD';
  const reasonParam = (req.query.reason as string) || 'USER_CLICK';
  const reason = reasonParam === 'AUTOMATED_SCANNER' ? 'AUTOMATED_SCANNER' : 'USER_CLICK';
  const ticker = await marketDataManager.getPrice(symbol, 'twelvedata', false, reason);

  if (ticker.status === 'MARKET_DATA_UNAVAILABLE') {
    res.status(503).json(ticker);
  } else {
    res.status(200).json(ticker);
  }
});

/**
 * GET /api/market/forex/price?symbol=EURUSD
 */
router.get('/market/forex/price', async (req: Request, res: Response) => {
  const symbol = (req.query.symbol as string) || 'EURUSD';
  const reasonParam = (req.query.reason as string) || 'USER_CLICK';
  const reason = reasonParam === 'AUTOMATED_SCANNER' ? 'AUTOMATED_SCANNER' : 'USER_CLICK';
  const ticker = await marketDataManager.getPrice(symbol, 'twelvedata', false, reason);

  if (ticker.status === 'MARKET_DATA_UNAVAILABLE') {
    res.status(503).json(ticker);
  } else {
    res.status(200).json(ticker);
  }
});

/**
 * GET /api/market/price?symbol=BTCUSDT&provider=bitget
 * Unified market price endpoint using MarketDataManager
 */
router.get('/market/price', async (req: Request, res: Response) => {
  const symbol = (req.query.symbol as string) || 'BTCUSDT';
  const provider = req.query.provider as string | undefined;
  const reasonParam = (req.query.reason as string) || 'USER_CLICK';
  const reason = reasonParam === 'AUTOMATED_SCANNER' ? 'AUTOMATED_SCANNER' : 'USER_CLICK';

  const ticker = await marketDataManager.getPrice(symbol, provider, false, reason);

  if (ticker.status === 'MARKET_DATA_UNAVAILABLE') {
    res.status(503).json(ticker);
  } else {
    res.status(200).json(ticker);
  }
});

/**
 * GET /api/market/session
 * Exposes the session status, asset classification, and timezone details of any symbol.
 */
router.get('/market/session', (req: Request, res: Response) => {
  try {
    const symbol = (req.query.symbol as string) || 'EURUSD';
    const cleanSymbol = symbol.trim().toUpperCase();

    const assetClassification = MarketSessionManager.getAssetClassification(cleanSymbol);
    const sessionState = MarketSessionManager.getSessionState(cleanSymbol);
    const currentTimestamp = MarketSessionManager.getCurrentTimestamp();
    const currentDate = MarketSessionManager.getCurrentDate();
    const ny = MarketSessionManager.getNYComponents(currentDate);
    const utc = MarketSessionManager.getComponentsForTimeZone(currentDate, 'UTC');
    const london = MarketSessionManager.getComponentsForTimeZone(currentDate, 'Europe/London');
    const tokyo = MarketSessionManager.getComponentsForTimeZone(currentDate, 'Asia/Tokyo');

    res.status(200).json({
      symbol: cleanSymbol,
      assetClassification,
      sessionState,
      timestamp: currentTimestamp,
      formattedUTC: currentDate.toISOString(),
      newYorkTime: {
        weekday: ny.weekday,
        hour: ny.hour,
        minute: ny.minute,
        second: ny.second,
        dateString: ny.dateString,
        timeZoneAbbr: ny.timeZoneAbbr,
        formatted: ny.formatted,
      },
      utcTime: {
        weekday: utc.weekday,
        hour: utc.hour,
        minute: utc.minute,
        second: utc.second,
        dateString: utc.dateString,
        timeZoneAbbr: 'UTC',
        formatted: utc.formatted,
      },
      londonTime: {
        weekday: london.weekday,
        hour: london.hour,
        minute: london.minute,
        second: london.second,
        dateString: london.dateString,
        timeZoneAbbr: london.timeZoneAbbr,
        formatted: london.formatted,
      },
      tokyoTime: {
        weekday: tokyo.weekday,
        hour: tokyo.hour,
        minute: tokyo.minute,
        second: tokyo.second,
        dateString: tokyo.dateString,
        timeZoneAbbr: tokyo.timeZoneAbbr,
        formatted: tokyo.formatted,
      }
    });
  } catch (err) {
    logger.error('Failed to get market session status', { error: String(err) });
    res.status(500).json({
      error: 'Failed to retrieve market session details',
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

/**
 * POST /api/market/time
 * Allows setting a simulated mock timestamp for timezone/weekend/holiday lock testing.
 */
router.post('/market/time', (req: Request, res: Response) => {
  try {
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Mock timestamps/simulation mode are disabled in the production environment.'
      });
    }

    const timestamp = req.body?.timestamp !== undefined ? req.body.timestamp : null;

    MarketSessionManager.setMockTimestamp(timestamp);

    const updatedDate = MarketSessionManager.getCurrentDate();
    const ny = MarketSessionManager.getNYComponents(updatedDate);

    res.status(200).json({
      success: true,
      message: timestamp ? 'Simulated system time updated successfully' : 'Resumed real-time tracking',
      timestamp: MarketSessionManager.getCurrentTimestamp(),
      formattedUTC: updatedDate.toISOString(),
      newYorkTime: {
        weekday: ny.weekday,
        hour: ny.hour,
        minute: ny.minute,
        second: ny.second,
        dateString: ny.dateString,
        timeZoneAbbr: ny.timeZoneAbbr,
        formatted: ny.formatted,
      }
    });
  } catch (err) {
    logger.error('Failed to update simulated system time', { error: String(err) });
    res.status(500).json({
      error: 'Failed to update simulated system time',
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

/**
 * GET /api/market/requests
 * Returns all recorded outbound external requests from the audit log.
 */
router.get('/market/requests', (_req: Request, res: Response) => {
  res.status(200).json(requestRegistry.getRecords());
});

/**
 * POST /api/market/requests/clear
 * Clears the external request registry logs.
 */
router.post('/market/requests/clear', (_req: Request, res: Response) => {
  requestRegistry.clear();
  res.status(200).json({ success: true, message: 'External request audit logs cleared' });
});

export default router;
