/**
 * Automated Hourly Scanner Service (Gate 10)
 * Runs once every hour in the background on the server.
 * Reuses the existing rate-limit protection and multi-timeframe SignalEngine.
 */

import { signalEngine } from './SignalEngine.js';
import { logger } from '../logger.js';
import * as fs from 'fs';
import * as path from 'path';

const SETTINGS_FILE_PATH = path.join(process.cwd(), 'scanner_settings.json');

export interface ScannerSettings {
  enabled: boolean;
  notificationsEnabled: boolean;
  signalsSentTimestamps: number[];
  lastScanTime: number;
}

export class HourlyScannerService {
  private settings: ScannerSettings = {
    enabled: true,
    notificationsEnabled: true,
    signalsSentTimestamps: [],
    lastScanTime: 0,
  };

  private timerId: NodeJS.Timeout | null = null;
  private isScanning = false;

  constructor() {
    this.loadSettings();
  }

  /**
   * Initializes the hourly scanner and starts the background timer loop.
   */
  start(): void {
    if (this.timerId) return;

    logger.info('[Hourly Scanner] Starting background service. Monitoring interval: 1 hour.');
    
    // Perform a quick initial check of the schedule
    this.checkScheduleAndRun();

    // Set interval to check every 1 minute to ensure high precision and robust recovery from restarts
    this.timerId = setInterval(() => {
      this.checkScheduleAndRun();
    }, 60 * 1000);
  }

  /**
   * Stops the background timer loop.
   */
  stop(): void {
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
      logger.info('[Hourly Scanner] Background service stopped.');
    }
  }

  /**
   * Checks settings and runs the scanner if 1 hour has elapsed since lastScanTime.
   */
  private async checkScheduleAndRun(): Promise<void> {
    if (!this.settings.enabled) return;
    if (this.isScanning) return;

    const now = Date.now();
    const oneHourMs = 60 * 60 * 1000;

    if (now - this.settings.lastScanTime >= oneHourMs) {
      await this.runScan();
    }
  }

  /**
   * Manually triggers a scan execution (useful for testing and immediate runs).
   */
  async triggerManualScan(): Promise<{ success: boolean; message: string; signalsFound: number }> {
    if (this.isScanning) {
      return { success: false, message: 'Scan already in progress.', signalsFound: 0 };
    }
    const count = await this.runScan();
    return {
      success: true,
      message: 'Manual hourly scan completed successfully.',
      signalsFound: count,
    };
  }

  /**
   * Main scan execution loop.
   */
  private async runScan(): Promise<number> {
    this.isScanning = true;
    const startTime = Date.now();
    logger.info('[Hourly Scanner] Initiating automated multi-market hourly scan...');

    try {
      // 1. Enforce rolling 24-hour limit of 5 signals
      this.cleanSentTimestamps();
      const currentCount = this.settings.signalsSentTimestamps.length;
      if (currentCount >= 5) {
        logger.warn(`[Hourly Scanner] Daily automated signal cap reached (${currentCount}/5). Scanning skipped to protect user portfolio limits.`);
        this.settings.lastScanTime = Date.now();
        this.saveSettings();
        this.isScanning = false;
        return 0;
      }

      const remainingAllowance = 5 - currentCount;
      let newSignalsDispatched = 0;

      // 2. Scan all three universes in sequence using the existing rate-limiting signalEngine
      const categories: Array<'CRYPTO' | 'FOREX' | 'STOCKS'> = ['CRYPTO', 'FOREX', 'STOCKS'];
      
      for (const category of categories) {
        if (newSignalsDispatched >= remainingAllowance) {
          logger.info('[Hourly Scanner] Rolling 24-hour cap of 5 signals reached during this scan cycle. Halting additional dispatches.');
          break;
        }

        try {
          logger.info(`[Hourly Scanner] Analyzing ${category} category...`);
          // Use a dummy or category symbol like category itself to scan the entire universe
          const result = await signalEngine.generateSignal(category, category);
          
          if (result.success && Array.isArray(result.signals)) {
            // Pick validated high-confidence signals from the scanner
            const valid = result.signals.filter(s => s.status === 'ACTIVE' && s.confidenceScore >= 65);
            
            for (const sig of valid) {
              if (newSignalsDispatched >= remainingAllowance) break;

              // Check if already in our sent list to prevent duplicate counting
              const alreadyCounted = this.settings.signalsSentTimestamps.some(t => Math.abs(t - sig.timestamp) < 5000);
              if (!alreadyCounted) {
                // Attach a marker for automated validation
                sig.strategy = `[Hourly Automated] ${sig.strategy}`;
                this.settings.signalsSentTimestamps.push(Date.now());
                newSignalsDispatched++;
                logger.info(`[Hourly Scanner] Dispatching newly validated automated signal for ${sig.symbol} with score ${sig.confidenceScore}/100.`);
              }
            }
          }
        } catch (catErr) {
          logger.error(`[Hourly Scanner] Scan failed for category ${category}:`, { error: String(catErr) });
        }

        // Add defensive pause between category sweeps to safeguard API quotas
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }

      // 3. Complete scan session updates
      this.settings.lastScanTime = Date.now();
      this.saveSettings();
      logger.info(`[Hourly Scanner] Scan cycle complete. Dispatched ${newSignalsDispatched} new signals. Total sent in last 24h: ${this.settings.signalsSentTimestamps.length}/5.`);
      
      this.isScanning = false;
      return newSignalsDispatched;
    } catch (err) {
      logger.error('[Hourly Scanner] Critical failure in background scanner loop:', { error: String(err) });
      this.isScanning = false;
      return 0;
    }
  }

  /**
   * Return the current configuration and metrics.
   */
  getSettings(): ScannerSettings & { limit: number } {
    this.cleanSentTimestamps();
    return {
      ...this.settings,
      limit: 5,
    };
  }

  /**
   * Updates scanner state options.
   */
  updateSettings(options: Partial<Pick<ScannerSettings, 'enabled' | 'notificationsEnabled'>>): void {
    if (options.enabled !== undefined) {
      this.settings.enabled = options.enabled;
    }
    if (options.notificationsEnabled !== undefined) {
      this.settings.notificationsEnabled = options.notificationsEnabled;
    }
    this.saveSettings();
    logger.info('[Hourly Scanner] Updated settings successfully.', { ...this.settings });
  }

  /**
   * Trims any timestamps older than 24 hours.
   */
  private cleanSentTimestamps(): void {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    this.settings.signalsSentTimestamps = this.settings.signalsSentTimestamps.filter(t => t >= cutoff);
  }

  /**
   * Persists scanner settings to disk.
   */
  private saveSettings(): void {
    try {
      fs.writeFileSync(SETTINGS_FILE_PATH, JSON.stringify(this.settings, null, 2), 'utf-8');
    } catch (err) {
      logger.warn('[Hourly Scanner] Failed to persist settings to disk:', { error: String(err) });
    }
  }

  /**
   * Loads settings from disk if available.
   */
  private loadSettings(): void {
    try {
      if (fs.existsSync(SETTINGS_FILE_PATH)) {
        const raw = fs.readFileSync(SETTINGS_FILE_PATH, 'utf-8');
        const parsed = JSON.parse(raw);
        this.settings = {
          enabled: parsed.enabled ?? true,
          notificationsEnabled: parsed.notificationsEnabled ?? true,
          signalsSentTimestamps: Array.isArray(parsed.signalsSentTimestamps) ? parsed.signalsSentTimestamps : [],
          lastScanTime: parsed.lastScanTime ?? 0,
        };
        logger.info('[Hourly Scanner] Loaded persisted settings from disk.');
      }
    } catch (err) {
      logger.warn('[Hourly Scanner] Could not load persisted settings, using defaults:', { error: String(err) });
    }
  }
}

export const hourlyScanner = new HourlyScannerService();
