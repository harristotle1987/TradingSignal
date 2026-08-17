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
   * Plays a clean, beautiful, and futuristic synthetic audio chime using Web Audio API.
   * Leverages layered frequency sliding and a long shimmering decay for high clarity.
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
      
      // Layered premium sound synthesis:
      // 1. Root / Resonance: Sine wave at 523.25 Hz (C5) sliding to 587.33 Hz (D5)
      // 2. Warm Harmonic: Triangle wave at 659.25 Hz (E5) sliding to 783.99 Hz (G5)
      // 3. Crisp Shimmer: Sine wave at 987.77 Hz (B5) sliding to 1174.66 Hz (D6)
      // 4. Ultra High Sparkle: Sine wave at 1318.51 Hz (E6) for clarity
      
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const osc3 = ctx.createOscillator();
      const osc4 = ctx.createOscillator();
      
      const gain1 = ctx.createGain();
      const gain2 = ctx.createGain();
      const gain3 = ctx.createGain();
      const gain4 = ctx.createGain();
      const masterGain = ctx.createGain();

      // Root Resonance Body (C5 -> D5)
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

      // Route all voices through their gains
      osc1.connect(gain1);
      osc2.connect(gain2);
      osc3.connect(gain3);
      osc4.connect(gain4);

      // Route to master channel
      gain1.connect(masterGain);
      gain2.connect(masterGain);
      gain3.connect(masterGain);
      gain4.connect(masterGain);

      // Set robust master gain for clean power without clipping
      masterGain.gain.setValueAtTime(0.65, now);
      masterGain.gain.exponentialRampToValueAtTime(0.001, now + 1.5);

      masterGain.connect(ctx.destination);

      // Trigger voices
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
