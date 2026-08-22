/**
 * Express Router for Web Push Notifications
 */

import { Router, Request, Response } from 'express';
import { PushNotificationService } from '../notifications/PushNotificationService.js';
import { logger } from '../logger.js';
import { adminAuthMiddleware } from '../middleware/adminAuth.js';

const router = Router();

/**
 * GET /api/notifications/vapid-public-key
 * Returns the VAPID public key needed for the client PushManager subscription.
 */
router.get('/notifications/vapid-public-key', async (_req: Request, res: Response) => {
  try {
    const publicKey = PushNotificationService.getVapidPublicKey();
    res.status(200).json({
      success: true,
      publicKey,
    });
  } catch (err: any) {
    logger.error('Failed to get VAPID public key:', { error: String(err) });
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve VAPID public key',
      error: err?.message || String(err),
    });
  }
});

/**
 * POST /api/notifications/subscribe
 * Registers a client's PushSubscription in persistent storage.
 */
router.post('/notifications/subscribe', async (req: Request, res: Response) => {
  try {
    const { subscription } = req.body || {};
    if (!subscription || !subscription.endpoint || !subscription.keys) {
      return res.status(400).json({
        success: false,
        message: 'Invalid subscription payload. Endpoint and keys are required.',
      });
    }

    const userAgent = req.headers['user-agent'] || 'Unknown';
    const result = await PushNotificationService.registerSubscription(subscription, userAgent);

    res.status(200).json({
      success: true,
      message: 'Push subscription registered successfully',
      id: result.id,
    });
  } catch (err: any) {
    logger.error('Push subscription failed:', { error: String(err) });
    res.status(500).json({
      success: false,
      message: 'Failed to register push subscription',
      error: err?.message || String(err),
    });
  }
});

/**
 * POST /api/notifications/unsubscribe
 * Unregisters a client's PushSubscription.
 */
router.post('/notifications/unsubscribe', async (req: Request, res: Response) => {
  try {
    const { endpoint } = req.body || {};
    if (!endpoint) {
      return res.status(400).json({
        success: false,
        message: 'Endpoint is required to unsubscribe',
      });
    }

    await PushNotificationService.unregisterSubscription(endpoint);
    res.status(200).json({
      success: true,
      message: 'Push subscription removed successfully',
    });
  } catch (err: any) {
    logger.error('Push unsubscription error:', { error: String(err) });
    res.status(500).json({
      success: false,
      message: 'Failed to unregister push subscription',
      error: err?.message || String(err),
    });
  }
});

/**
 * POST /api/notifications/test
 * Triggers a test push notification to verify delivery.
 */
router.post('/notifications/test', adminAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const { subscription } = req.body || {};
    const result = await PushNotificationService.sendTestPush(subscription);
    res.status(result.success ? 200 : 400).json(result);
  } catch (err: any) {
    logger.error('Test push notification error:', { error: String(err) });
    res.status(500).json({
      success: false,
      message: 'Failed to send test push notification',
      error: err?.message || String(err),
    });
  }
});

/**
 * GET /api/notifications/status
 * Returns push subscription status and active count.
 */
router.get('/notifications/status', async (_req: Request, res: Response) => {
  try {
    const status = PushNotificationService.getStatus();
    res.status(200).json({
      success: true,
      ...status,
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: err?.message || String(err),
    });
  }
});

export default router;
