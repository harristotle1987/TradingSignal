/**
 * Web Browser, Audio & Web Push Notification Service
 *
 * Provides:
 * 1. Native Service-Worker Push Notification subscriptions (PWA background alerts).
 * 2. Instant in-app audio chime synthesis using Web Audio API.
 * 3. In-tab fallback notifications for active users.
 *
 * CRITICAL RULE:
 * Notification permission is NEVER requested on page load.
 * It is ONLY requested after an explicit, intentional user action.
 */

import { TradingSignal } from '../types/index.js';
import { api } from '../api/client.js';

export type NotificationPermissionStatus = 'granted' | 'denied' | 'default' | 'unsupported';

/**
 * Converts a Base64-encoded VAPID public key into a Uint8Array
 * required by navigator.serviceWorker registration.pushManager.subscribe().
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export class NotificationService {
  private static notifiedIds = new Set<string>();

  /**
   * Check if browser Notification API is available in current context.
   */
  static isSupported(): boolean {
    return typeof window !== 'undefined' && 'Notification' in window;
  }

  /**
   * Check if Web Push (PushManager + ServiceWorker) is supported.
   */
  static isPushSupported(): boolean {
    return (
      typeof window !== 'undefined' &&
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      'Notification' in window
    );
  }

  /**
   * Get current browser notification permission status.
   */
  static getPermission(): NotificationPermissionStatus {
    if (!this.isSupported()) return 'unsupported';
    return Notification.permission as NotificationPermissionStatus;
  }

  /**
   * Request permission from user to display native notifications.
   * MUST only be called in response to a user action (e.g. button click).
   */
  static async requestPermission(): Promise<NotificationPermissionStatus> {
    if (!this.isSupported()) return 'unsupported';
    try {
      const permission = await Notification.requestPermission();
      return permission as NotificationPermissionStatus;
    } catch (err) {
      console.warn('Failed to request notification permission:', err);
      return Notification.permission as NotificationPermissionStatus;
    }
  }

  /**
   * Subscribes the current PWA / browser to backend Web Push alerts.
   * NEVER runs automatically on page load.
   */
  static async subscribeToPushNotifications(): Promise<{
    success: boolean;
    status: NotificationPermissionStatus;
    message?: string;
    subscription?: PushSubscription | null;
  }> {
    if (!this.isPushSupported()) {
      return {
        success: false,
        status: 'unsupported',
        message: 'Push notifications are not supported on this browser or platform.',
      };
    }

    try {
      // 1. Explicitly request permission
      const permission = await this.requestPermission();
      if (permission !== 'granted') {
        return {
          success: false,
          status: permission,
          message: permission === 'denied' 
            ? 'Notifications are blocked in your browser settings. Please enable them to receive trading alerts.' 
            : 'Notification permission was not granted.',
        };
      }

      // 2. Fetch VAPID public key from backend
      const { publicKey } = await api.getVapidPublicKey();
      if (!publicKey) {
        throw new Error('Server VAPID public key could not be retrieved.');
      }

      // 3. Ensure Service Worker is ready
      const registration = await navigator.serviceWorker.ready;

      // 4. Subscribe to PushManager
      const convertedVapidKey = urlBase64ToUint8Array(publicKey);
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: convertedVapidKey,
      });

      // 5. Send subscription to server
      const subJson = subscription.toJSON();
      await api.subscribePush(subJson);

      // Play audio confirmation chime
      this.playAlertChime();

      return {
        success: true,
        status: 'granted',
        message: 'Push notifications successfully connected! You will receive instant alerts for qualified setups.',
        subscription,
      };
    } catch (err: any) {
      console.error('Failed to subscribe to push notifications:', err);
      return {
        success: false,
        status: this.getPermission(),
        message: err?.message || 'Failed to register push subscription.',
      };
    }
  }

  /**
   * Unsubscribes the current client from Push Notifications.
   */
  static async unsubscribeFromPushNotifications(): Promise<{ success: boolean; message: string }> {
    if (!this.isPushSupported()) {
      return { success: false, message: 'Push notifications not supported.' };
    }

    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();

      if (subscription) {
        const endpoint = subscription.endpoint;
        await subscription.unsubscribe();
        await api.unsubscribePush(endpoint);
      }

      return { success: true, message: 'Push notifications disabled successfully.' };
    } catch (err: any) {
      console.error('Error during push unsubscription:', err);
      return { success: false, message: err?.message || 'Failed to unsubscribe.' };
    }
  }

  /**
   * Gets the existing push subscription if already active.
   */
  static async getExistingPushSubscription(): Promise<PushSubscription | null> {
    if (!this.isPushSupported()) return null;
    try {
      const registration = await navigator.serviceWorker.ready;
      return await registration.pushManager.getSubscription();
    } catch {
      return null;
    }
  }

  /**
   * Plays a clean, beautiful synthetic audio chime using Web Audio API.
   */
  static playAlertChime(): void {
    try {
      const AudioContextClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return;

      const ctx = new AudioContextClass();
      if (ctx.state === 'suspended') {
        ctx.resume();
      }

      const now = ctx.currentTime;

      // Layered sound synthesis
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const osc3 = ctx.createOscillator();
      const osc4 = ctx.createOscillator();

      const gain1 = ctx.createGain();
      const gain2 = ctx.createGain();
      const gain3 = ctx.createGain();
      const gain4 = ctx.createGain();
      const masterGain = ctx.createGain();

      // Root Resonance (C5 -> D5)
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(523.25, now);
      osc1.frequency.exponentialRampToValueAtTime(587.33, now + 0.12);
      gain1.gain.setValueAtTime(0.01, now);
      gain1.gain.linearRampToValueAtTime(0.35, now + 0.04);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.8);

      // Warm Harmonic (E5 -> G5)
      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(659.25, now);
      osc2.frequency.exponentialRampToValueAtTime(783.99, now + 0.15);
      gain2.gain.setValueAtTime(0.01, now);
      gain2.gain.linearRampToValueAtTime(0.25, now + 0.05);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.6);

      // Crisp Glassy Shimmer (B5 -> D6)
      osc3.type = 'sine';
      osc3.frequency.setValueAtTime(987.77, now);
      osc3.frequency.exponentialRampToValueAtTime(1174.66, now + 0.2);
      gain3.gain.setValueAtTime(0.01, now);
      gain3.gain.linearRampToValueAtTime(0.2, now + 0.03);
      gain3.gain.exponentialRampToValueAtTime(0.001, now + 1.2);

      // High-End Crystal Sparkle (E6)
      osc4.type = 'sine';
      osc4.frequency.setValueAtTime(1318.51, now);
      gain4.gain.setValueAtTime(0.01, now);
      gain4.gain.linearRampToValueAtTime(0.12, now + 0.02);
      gain4.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

      osc1.connect(gain1);
      osc2.connect(gain2);
      osc3.connect(gain3);
      osc4.connect(gain4);

      gain1.connect(masterGain);
      gain2.connect(masterGain);
      gain3.connect(masterGain);
      gain4.connect(masterGain);

      masterGain.gain.setValueAtTime(0.65, now);
      masterGain.gain.exponentialRampToValueAtTime(0.001, now + 1.5);
      masterGain.connect(ctx.destination);

      osc1.start(now);
      osc1.stop(now + 1.0);
      osc2.start(now);
      osc2.stop(now + 0.8);
      osc3.start(now);
      osc3.stop(now + 1.5);
      osc4.start(now);
      osc4.stop(now + 0.5);
    } catch (err) {
      console.debug('Audio chime playback omitted:', err);
    }
  }

  /**
   * Dispatches an in-tab notification for an active user.
   */
  static notifyTopTrade(signal: TradingSignal, playSound = true): boolean {
    const key = signal.id || signal.snapshotId || `${signal.symbol}_${signal.timestamp}`;

    if (this.notifiedIds.has(key)) {
      return false;
    }
    this.notifiedIds.add(key);

    if (playSound) {
      this.playAlertChime();
    }

    if (this.getPermission() !== 'granted') {
      return false;
    }

    try {
      const precision = signal.entryPrice < 10 ? 5 : 2;
      const formattedEntry = signal.entryPrice.toFixed(precision);
      const formattedSL = signal.stopLoss.toFixed(precision);
      const formattedTP = signal.takeProfit.toFixed(precision);

      const title = `🚨 TOP TRADE: ${signal.symbol} [${signal.direction}]`;
      const body = `Live Entry: ${formattedEntry}\nTP: ${formattedTP} | SL: ${formattedSL} (R:R ${signal.riskRewardRatio}:1)\nScore: ${signal.score || signal.confidenceScore}/100`;

      const notification = new Notification(title, {
        body,
        icon: '/icon-192.png',
        tag: `top_trade_${signal.symbol}_${signal.timestamp}`,
        requireInteraction: false,
      });

      notification.onclick = () => {
        window.focus();
        notification.close();
      };

      return true;
    } catch (err) {
      console.warn('Native notification dispatch failed:', err);
      return false;
    }
  }

  /**
   * Sends a test alert via backend push service or browser fallback.
   */
  static async sendTestAlert(): Promise<boolean> {
    this.playAlertChime();

    try {
      const existingSub = await this.getExistingPushSubscription();
      if (existingSub) {
        await api.sendTestPushNotification(existingSub.toJSON());
        return true;
      }
    } catch (err) {
      console.warn('Push test failed, falling back to local Notification API:', err);
    }

    if (this.getPermission() !== 'granted') {
      return false;
    }

    try {
      const notification = new Notification('🔔 Trading Signal AI Alert Active', {
        body: 'Push notifications are configured! You will receive instant alerts whenever a new verified trade is qualified.',
        icon: '/icon-192.png',
        tag: `test_alert_${Date.now()}`,
      });

      notification.onclick = () => {
        window.focus();
        notification.close();
      };

      return true;
    } catch (err) {
      console.warn('Test notification error:', err);
      return false;
    }
  }
}
