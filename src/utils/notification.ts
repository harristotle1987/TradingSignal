/**
 * Web Browser, Audio & Notification Service
 *
 * Provides:
 * 1. Instant in-app audio chime synthesis using Web Audio API.
 * 2. Native browser desktop notifications for active users.
 *
 * CRITICAL RULE:
 * Notification permission is NEVER requested on page load.
 * It is ONLY requested after an explicit, intentional user action.
 */

import { TradingSignal } from '../types/index.js';
import { formatRankTier } from './formatters.js';

export type NotificationPermissionStatus = 'granted' | 'denied' | 'default' | 'unsupported';

export class NotificationService {
  private static notifiedIds = new Set<string>();

  /**
   * Check if browser Notification API is available in current context.
   */
  static isSupported(): boolean {
    return typeof window !== 'undefined' && 'Notification' in window;
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

      const tierLabel = signal.rankTier ? formatRankTier(signal.rankTier, false) : (signal.isBestTrade ? 'BEST TRADE' : 'TOP TRADE');
      const title = `🚨 ${tierLabel}: ${signal.symbol} [${signal.direction}]`;
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
   * Sends a test alert with permission check and audio chime.
   */
  static async sendTestAlert(): Promise<{ success: boolean; message: string }> {
    this.playAlertChime();

    let perm = this.getPermission();
    if (perm !== 'granted') {
      perm = await this.requestPermission();
    }

    if (perm !== 'granted') {
      return {
        success: false,
        message: perm === 'denied'
          ? 'Notifications are blocked in your browser settings. Please enable notifications for this site.'
          : 'Notification permission was not granted.',
      };
    }

    try {
      const notification = new Notification('🔔 Trading Signal AI Alert Active', {
        body: 'Browser notifications are configured! You will receive instant alerts whenever a new verified trade is qualified.',
        icon: '/icon-192.png',
        tag: `test_alert_${Date.now()}`,
      });

      notification.onclick = () => {
        window.focus();
        notification.close();
      };

      return { success: true, message: 'Test alert triggered successfully! Check your notifications.' };
    } catch (err: any) {
      console.warn('Test notification error:', err);
      return { success: false, message: err?.message || 'Failed to send test alert.' };
    }
  }
}
