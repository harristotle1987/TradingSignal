/**
 * Server-Side Web Push Notification Service
 *
 * Provides production-grade Web Push (W3C Push API / RFC 8291 / RFC 8292) delivery
 * for verified, accepted trading signals.
 *
 * Rules:
 * 1. ONLY genuinely accepted qualifying signals are notified.
 * 2. Rejected candidates, failed scans, stale data, and duplicates are strictly ignored.
 * 3. Prevents duplicate push alerts when external schedulers retry.
 * 4. Subscriptions are stored securely in Firestore with local JSON persistence fallback.
 * 5. Expired / invalid subscriptions (HTTP 410 / 404) are auto-pruned.
 */

import webpush from 'web-push';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { getFirestoreAdmin } from '../firebaseAdmin.js';
import { logger } from '../logger.js';
import { serverConfig } from '../config.js';
import { TradingSignal } from '../../types/index.js';

export interface StoredPushSubscription {
  id: string;
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
  createdAt: number;
  userAgent?: string;
  active: boolean;
}

interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

const LOCAL_SUBSCRIPTIONS_PATH = path.join(process.cwd(), 'push_subscriptions.json');
const LOCAL_VAPID_PATH = path.join(process.cwd(), 'push_vapid_keys.json');

const FIRESTORE_SUBSCRIPTIONS_COL = 'push_subscriptions';
const FIRESTORE_VAPID_DOC = 'push_config/vapid_keys';

export class PushNotificationService {
  private static vapidKeys: VapidKeys | null = null;
  private static subscriptions: Map<string, StoredPushSubscription> = new Map();
  private static notifiedSignalKeys: Set<string> = new Set();
  private static isInitialized = false;

  /**
   * Initializes VAPID keys, loads saved subscriptions from Firestore/disk, and configures web-push.
   */
  static async init(): Promise<void> {
    if (this.isInitialized) return;

    // 1. Initialize or load VAPID Keys
    this.initVapidKeys();

    // 2. Load cached subscriptions from local disk
    this.loadLocalSubscriptions();

    // 3. Sync from Firestore if available
    await this.syncSubscriptionsFromFirestore();

    this.isInitialized = true;
    logger.info(`[Push Notification Service] Initialized successfully. Active subscribers: ${this.subscriptions.size}`);
  }

  /**
   * Resolves VAPID keys from environment variables or persistent storage.
   */
  private static initVapidKeys(): void {
    const envPublic = process.env.VAPID_PUBLIC_KEY;
    const envPrivate = process.env.VAPID_PRIVATE_KEY;

    if (envPublic && envPrivate && envPublic.trim() && envPrivate.trim()) {
      this.vapidKeys = {
        publicKey: envPublic.trim(),
        privateKey: envPrivate.trim(),
      };
      logger.info('[Push Notification Service] Using VAPID keys from server environment.');
    } else {
      // Check local file
      try {
        if (fs.existsSync(LOCAL_VAPID_PATH)) {
          const raw = fs.readFileSync(LOCAL_VAPID_PATH, 'utf-8');
          const parsed = JSON.parse(raw);
          if (parsed.publicKey && parsed.privateKey) {
            this.vapidKeys = parsed;
            logger.info('[Push Notification Service] Loaded persisted VAPID keys from storage.');
          }
        }
      } catch (err) {
        logger.warn('[Push Notification Service] Failed to read local VAPID keys:', { error: String(err) });
      }

      // Generate new keys if still missing
      if (!this.vapidKeys) {
        const generated = webpush.generateVAPIDKeys();
        this.vapidKeys = generated;
        try {
          fs.writeFileSync(LOCAL_VAPID_PATH, JSON.stringify(generated, null, 2), 'utf-8');
          logger.info('[Push Notification Service] Generated and persisted new stable VAPID keypair.');
        } catch (saveErr) {
          logger.warn('[Push Notification Service] Could not write VAPID keys to disk:', { error: String(saveErr) });
        }
      }
    }

    const subject = process.env.VAPID_SUBJECT || 'mailto:alerts@tradingsignal.ai';
    webpush.setVapidDetails(subject, this.vapidKeys.publicKey, this.vapidKeys.privateKey);
  }

  /**
   * Returns the VAPID public key for frontend subscription.
   */
  static getVapidPublicKey(): string {
    if (!this.vapidKeys) {
      this.initVapidKeys();
    }
    return this.vapidKeys?.publicKey || '';
  }

  /**
   * Hashes endpoint to create a safe document ID.
   */
  private static getSubscriptionId(endpoint: string): string {
    return crypto.createHash('sha256').update(endpoint).digest('hex').substring(0, 32);
  }

  /**
   * Loads subscriptions from local file.
   */
  private static loadLocalSubscriptions(): void {
    try {
      if (fs.existsSync(LOCAL_SUBSCRIPTIONS_PATH)) {
        const raw = fs.readFileSync(LOCAL_SUBSCRIPTIONS_PATH, 'utf-8');
        const list: StoredPushSubscription[] = JSON.parse(raw);
        if (Array.isArray(list)) {
          for (const sub of list) {
            if (sub.endpoint && sub.keys?.p256dh && sub.keys?.auth) {
              const id = sub.id || this.getSubscriptionId(sub.endpoint);
              this.subscriptions.set(id, { ...sub, id, active: sub.active ?? true });
            }
          }
        }
      }
    } catch (err) {
      logger.warn('[Push Notification Service] Error loading local subscriptions:', { error: String(err) });
    }
  }

  /**
   * Persists subscriptions to local JSON file.
   */
  private static saveLocalSubscriptions(): void {
    try {
      const list = Array.from(this.subscriptions.values());
      fs.writeFileSync(LOCAL_SUBSCRIPTIONS_PATH, JSON.stringify(list, null, 2), 'utf-8');
    } catch (err) {
      logger.warn('[Push Notification Service] Error saving local subscriptions:', { error: String(err) });
    }
  }

  /**
   * Synchronizes subscriptions with Firestore if available.
   */
  private static async syncSubscriptionsFromFirestore(): Promise<void> {
    const db = getFirestoreAdmin();
    if (!db) return;

    try {
      const snapshot = await db.collection(FIRESTORE_SUBSCRIPTIONS_COL).where('active', '==', true).get();
      if (!snapshot.empty) {
        snapshot.forEach((doc) => {
          const data = doc.data() as StoredPushSubscription;
          if (data && data.endpoint && data.keys) {
            this.subscriptions.set(doc.id, { ...data, id: doc.id });
          }
        });
        this.saveLocalSubscriptions();
      }
    } catch (err) {
      logger.warn('[Push Notification Service] Firestore subscriptions sync skipped:', { error: String(err) });
    }
  }

  /**
   * Registers or updates a client push subscription.
   */
  static async registerSubscription(
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    userAgent?: string
  ): Promise<{ success: boolean; id: string }> {
    await this.init();

    if (!subscription || !subscription.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) {
      throw new Error('Invalid PushSubscription payload. Endpoint and cryptographic keys required.');
    }

    const id = this.getSubscriptionId(subscription.endpoint);
    const record: StoredPushSubscription = {
      id,
      endpoint: subscription.endpoint,
      keys: subscription.keys,
      createdAt: Date.now(),
      userAgent: userAgent || 'Unknown Client',
      active: true,
    };

    this.subscriptions.set(id, record);
    this.saveLocalSubscriptions();

    // Persist to Firestore
    const db = getFirestoreAdmin();
    if (db) {
      try {
        await db.collection(FIRESTORE_SUBSCRIPTIONS_COL).doc(id).set(record, { merge: true });
      } catch (err) {
        logger.warn('[Push Notification Service] Firestore subscription write failed:', { error: String(err) });
      }
    }

    logger.info(`[Push Notification Service] Registered push subscription [${id}]. Total active: ${this.subscriptions.size}`);
    return { success: true, id };
  }

  /**
   * Unregisters a client push subscription.
   */
  static async unregisterSubscription(endpoint: string): Promise<boolean> {
    const id = this.getSubscriptionId(endpoint);
    this.subscriptions.delete(id);
    this.saveLocalSubscriptions();

    const db = getFirestoreAdmin();
    if (db) {
      try {
        await db.collection(FIRESTORE_SUBSCRIPTIONS_COL).doc(id).delete();
      } catch (err) {
        logger.warn('[Push Notification Service] Firestore subscription removal error:', { error: String(err) });
      }
    }

    logger.info(`[Push Notification Service] Removed push subscription [${id}]. Remaining: ${this.subscriptions.size}`);
    return true;
  }

  /**
   * Dispatches a push notification to all active subscribers for an accepted qualifying signal.
   * STRICT: Deduplicated to prevent double-sends if external scheduler retries.
   */
  static async sendSignalNotification(signal: TradingSignal): Promise<{ sentCount: number; failureCount: number }> {
    await this.init();

    // 1. Strict Signal Validation
    if (!signal || !signal.symbol || !signal.direction || !signal.entryPrice) {
      logger.warn('[Push Notification Service] Attempted to notify invalid or incomplete signal.');
      return { sentCount: 0, failureCount: 0 };
    }

    // 2. Prevent duplicate notifications for the same signal snapshot / ID
    const dedupKey = `${signal.id || signal.snapshotId || signal.symbol}_${signal.direction}_${signal.timeframe || '1h'}_${Math.floor((signal.timestamp || Date.now()) / (30 * 60 * 1000))}`;
    if (this.notifiedSignalKeys.has(dedupKey)) {
      logger.info(`[Push Notification Service] Duplicate notification suppressed for [${signal.symbol}] (Key: ${dedupKey}).`);
      return { sentCount: 0, failureCount: 0 };
    }
    this.notifiedSignalKeys.add(dedupKey);

    // Keep set bounded
    if (this.notifiedSignalKeys.size > 500) {
      const keysArray = Array.from(this.notifiedSignalKeys);
      this.notifiedSignalKeys = new Set(keysArray.slice(-250));
    }

    if (this.subscriptions.size === 0) {
      logger.info(`[Push Notification Service] No active subscribers. Notification recorded for [${signal.symbol}].`);
      return { sentCount: 0, failureCount: 0 };
    }

    // 3. Format Notification Content
    const precision = signal.entryPrice < 10 ? 5 : 2;
    const score = signal.score ?? signal.confidenceScore ?? 80;
    const isBestTrade = score >= 85 || signal.isBestTrade || signal.rankTier === 'BEST_TRADE';
    const tierLabel = isBestTrade ? '★ BEST TRADE' : 'HIGH QUALITY';
    
    const title = `🚨 [${tierLabel}] ${signal.symbol} ${signal.direction}`;
    const tpDisplay = signal.takeProfit ? signal.takeProfit.toFixed(precision) : 'N/A';
    const slDisplay = signal.stopLoss ? signal.stopLoss.toFixed(precision) : 'N/A';
    const rrDisplay = signal.riskRewardRatio ? `${signal.riskRewardRatio.toFixed(1)}:1` : '2.0:1';

    const body = `Entry: ${signal.entryPrice.toFixed(precision)} | TP: ${tpDisplay} | SL: ${slDisplay} | R:R ${rrDisplay} (Score: ${score}/100)`;

    const payload = JSON.stringify({
      title,
      body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: `signal_${signal.symbol}_${signal.direction}_${Date.now()}`,
      url: `/?view=signals&symbol=${encodeURIComponent(signal.symbol)}`,
      symbol: signal.symbol,
      direction: signal.direction,
      entryPrice: signal.entryPrice,
      takeProfit: signal.takeProfit,
      stopLoss: signal.stopLoss,
      score,
      rankTier: isBestTrade ? 'BEST_TRADE' : 'HIGH_QUALITY',
      timestamp: signal.timestamp || Date.now(),
      expiresAt: signal.expiresAt || ((signal.timestamp || Date.now()) + serverConfig.getConfig().signalExpirationMs),
      requireInteraction: true,
    });

    let sentCount = 0;
    let failureCount = 0;
    const deadSubscriptions: string[] = [];

    const sendPromises = Array.from(this.subscriptions.values()).map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: sub.keys,
          },
          payload,
          {
            TTL: 3600, // 1 hour time-to-live
            urgency: 'high',
          }
        );
        sentCount++;
      } catch (err: any) {
        failureCount++;
        const statusCode = err?.statusCode;
        if (statusCode === 410 || statusCode === 404) {
          // Subscription has expired or been revoked by browser
          logger.info(`[Push Notification Service] Subscription expired (HTTP ${statusCode}). Queued for removal: ${sub.id}`);
          deadSubscriptions.push(sub.id);
        } else {
          logger.warn(`[Push Notification Service] Push delivery failed for ${sub.id}:`, {
            statusCode,
            error: err?.message || String(err),
          });
        }
      }
    });

    await Promise.allSettled(sendPromises);

    // Prune dead subscriptions
    if (deadSubscriptions.length > 0) {
      for (const id of deadSubscriptions) {
        this.subscriptions.delete(id);
      }
      this.saveLocalSubscriptions();
      const db = getFirestoreAdmin();
      if (db) {
        for (const id of deadSubscriptions) {
          db.collection(FIRESTORE_SUBSCRIPTIONS_COL).doc(id).delete().catch(() => {});
        }
      }
    }

    logger.info(`[Push Notification Service] Dispatched [${signal.symbol}] push alert. Success: ${sentCount}, Failed: ${failureCount}, Pruned: ${deadSubscriptions.length}`);
    return { sentCount, failureCount };
  }

  /**
   * Sends a test notification to a specific subscriber or all subscribers.
   */
  static async sendTestPush(subscription?: { endpoint: string; keys: { p256dh: string; auth: string } }): Promise<{ success: boolean; message: string }> {
    await this.init();

    const payload = JSON.stringify({
      title: '🔔 Trading Signal AI Alert System Active',
      body: 'Push notifications are connected! You will receive instant alerts for qualified BEST TRADE setups even when the app is closed.',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: `test_alert_${Date.now()}`,
      url: '/?view=signals',
      timestamp: Date.now(),
      requireInteraction: false,
    });

    if (subscription) {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: subscription.keys,
          },
          payload,
          { TTL: 60, urgency: 'high' }
        );
        return { success: true, message: 'Test push notification delivered successfully.' };
      } catch (err: any) {
        return { success: false, message: `Failed to deliver test push: ${err?.message || String(err)}` };
      }
    }

    if (this.subscriptions.size === 0) {
      return { success: false, message: 'No registered push subscribers found. Please enable notifications in your browser first.' };
    }

    const firstSub = Array.from(this.subscriptions.values())[0];
    try {
      await webpush.sendNotification(
        {
          endpoint: firstSub.endpoint,
          keys: firstSub.keys,
        },
        payload,
        { TTL: 60, urgency: 'high' }
      );
      return { success: true, message: 'Test push delivered to subscriber.' };
    } catch (err: any) {
      return { success: false, message: `Push test error: ${err?.message || String(err)}` };
    }
  }

  /**
   * Returns current subscriber count and status.
   */
  static getStatus(): { subscriberCount: number; vapidConfigured: boolean } {
    return {
      subscriberCount: this.subscriptions.size,
      vapidConfigured: Boolean(this.vapidKeys?.publicKey),
    };
  }
}
