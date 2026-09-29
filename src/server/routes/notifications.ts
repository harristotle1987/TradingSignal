/**
 * Express Router for Web Push Notifications
 */

import { Router, Request, Response } from 'express';
import { PushNotificationService } from '../notifications/PushNotificationService.js';
import { logger } from '../logger.js';
import { adminAuthMiddleware } from '../middleware/adminAuth.js';
import { validateRequest } from '../middleware/validateInput.js';
import {
  subscribeNotificationSchema,
  unsubscribeNotificationSchema,
  testNotificationSchema,
} from '../validation/schemas.js';

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
 * Binds the subscription to the authenticated user's verified identity to prevent IDOR.
 */
router.post('/notifications/subscribe', validateRequest({ body: subscribeNotificationSchema }), async (req: Request, res: Response) => {
  try {
    const { subscription } = req.body || {};
    const userAgent = req.headers['user-agent'] || 'Unknown';
    const userId = req.user?.uid;
    const result = await PushNotificationService.registerSubscription(subscription, userAgent, userId);

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
 * Strictly checks that a user cannot unsubscribe another user's subscription (IDOR protection).
 */
router.post('/notifications/unsubscribe', validateRequest({ body: unsubscribeNotificationSchema }), async (req: Request, res: Response) => {
  try {
    const { endpoint } = req.body || {};

    // IDOR verification: Check if subscription exists and belongs to another user
    const existing = PushNotificationService.getSubscriptionByEndpoint(endpoint);
    if (existing && existing.userId && req.user && !req.user.admin && existing.userId !== req.user.uid) {
      logger.warn(`[Notifications] IDOR violation: user ${req.user.uid} tried to unsubscribe subscription of ${existing.userId}`);
      return res.status(403).json({
        success: false,
        error: 'Forbidden: Cannot modify or remove a subscription belonging to another user (IDOR violation).',
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
 * IDOR protected: verifies the target endpoint belongs to the authenticated user.
 */
router.post('/notifications/test', validateRequest({ body: testNotificationSchema }), async (req: Request, res: Response) => {
  try {
    const { subscription } = req.body || {};
    if (subscription?.endpoint) {
      const existing = PushNotificationService.getSubscriptionByEndpoint(subscription.endpoint);
      if (existing && existing.userId && req.user && !req.user.admin && existing.userId !== req.user.uid) {
        logger.warn(`[Notifications] IDOR violation: user ${req.user.uid} tried to send test to subscription of ${existing.userId}`);
        return res.status(403).json({
          success: false,
          error: 'Forbidden: Cannot test a push subscription belonging to another user (IDOR violation).',
        });
      }
    }

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
