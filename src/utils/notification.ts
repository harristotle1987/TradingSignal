/**
 * Web Browser & Audio Notification Service for TOP TRADEs
 * Fires native desktop notifications and optional audio chimes when a new TOP TRADE is validated.
 */

import { TradingSignal } from '../types/index.js';

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
   * Plays a clean, subtle synthetic audio chime using Web Audio API.
   */
  static playAlertChime(): void {
    try {
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return;

      const ctx = new AudioContextClass();
      if (ctx.state === 'suspended') {
        ctx.resume();
      }

      const now = ctx.currentTime;
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();

      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(587.33, now); // D5
      osc1.frequency.exponentialRampToValueAtTime(880.0, now + 0.15); // A5

      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(880.0, now + 0.15); // A5
      osc2.frequency.exponentialRampToValueAtTime(1174.66, now + 0.35); // D6

      gain.gain.setValueAtTime(0.01, now);
      gain.gain.linearRampToValueAtTime(0.2, now + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);

      osc1.start(now);
      osc1.stop(now + 0.2);
      osc2.start(now + 0.15);
      osc2.stop(now + 0.5);
    } catch (err) {
      console.debug('Audio chime playback omitted:', err);
    }
  }

  /**
   * Dispatches a native browser notification for a validated TOP TRADE.
   */
  static notifyTopTrade(signal: TradingSignal, playSound = true): boolean {
    const key = signal.id || signal.snapshotId || `${signal.symbol}_${signal.timestamp}`;

    // Prevent duplicate alert triggers for the same trade setup
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
      const body = `Live Entry: ${formattedEntry}\nTP: ${formattedTP} | SL: ${formattedSL} (R:R ${signal.riskRewardRatio}:1)\nScore: ${signal.score || signal.confidenceScore}/100 • Snapshot: ${signal.snapshotId || 'Gate 9'}`;

      const notification = new Notification(title, {
        body,
        icon: '/favicon.ico',
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
   * Sends a test notification to verify user's browser settings.
   */
  static sendTestAlert(): boolean {
    this.playAlertChime();

    if (this.getPermission() !== 'granted') {
      return false;
    }

    try {
      const notification = new Notification('🔔 TOP TRADE Alert System Active', {
        body: 'Browser notifications are configured! You will receive instant desktop alerts whenever a new Gate 9 TOP TRADE is validated.',
        icon: '/favicon.ico',
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
