/**
 * Central Server Configuration Module
 * Handles environment-variable validation and provider readiness checks.
 *
 * IMPORTANT SECURITY REQUIREMENT:
 * Sensitive API keys are strictly maintained server-side and never exposed to client code.
 */

import { logger } from './logger.js';

export interface ProviderReadiness {
  nvidiaConfigured: boolean;
  finnhubConfigured: boolean;
  bitgetConfigured: boolean;
  twelvedataConfigured: boolean;
}

export interface SignalThresholds {
  minimumScore: number;
  watchingThreshold: number;
  qualifiedCandidateThreshold: number;
  signalThreshold: number;
  minimumRR: number;
  minimumNetRR: number;
  minimumWinProbability: number;
  minimumStrategyAgreement: number;
  minimumTimeframeAlignment: number;
  AIConfirmationMode: 'REQUIRED' | 'OPTIONAL' | 'DISABLED';
  minimumAiConfidence: number;
  dailySignalCap: number;
  candidateThreshold: number;
}

export interface AppServerConfig {
  port: number;
  nodeEnv: string;
  appUrl: string;
  marketDataMaxAgeMs: number;
  marketDataCacheTtlMs: number;
  marketDataTimeoutMs: number;
  signalExpirationMinutes: number;
  signalExpirationMs: number;
  providers: ProviderReadiness;
  thresholds: SignalThresholds;
}

class ConfigService {
  private config: AppServerConfig;

  constructor() {
    this.config = this.loadAndValidate();
  }

  private loadAndValidate(): AppServerConfig {
    const port = parseInt(process.env.PORT || '3000', 10);
    const nodeEnv = process.env.NODE_ENV || 'development';
    const appUrl = process.env.APP_URL || `http://localhost:${port}`;

    const marketDataMaxAgeMs = parseInt(process.env.MARKET_DATA_MAX_AGE_MS || '60000', 10);
    const marketDataCacheTtlMs = parseInt(process.env.MARKET_DATA_CACHE_TTL_MS || '60000', 10);
    const marketDataTimeoutMs = parseInt(process.env.MARKET_DATA_TIMEOUT_MS || '8000', 10);
    
    // Configurable Signal Expiration (Default: 4 hours)
    const signalExpirationMinutes = parseInt(process.env.SIGNAL_EXPIRATION_MINUTES || '240', 10);
    const signalExpirationMs = signalExpirationMinutes * 60 * 1000;

    const nvidiaConfigured = Boolean(process.env.NVIDIA_API_KEY && process.env.NVIDIA_API_KEY.trim().length > 0);
    const finnhubConfigured = Boolean(process.env.FINNHUB_API_KEY && process.env.FINNHUB_API_KEY.trim().length > 0);
    const bitgetConfigured = Boolean(
      process.env.BITGET_API_KEY &&
      process.env.BITGET_SECRET_KEY &&
      process.env.BITGET_PASSPHRASE
    );
    const twelvedataConfigured = Boolean(process.env.TWELVE_DATA_API_KEY && process.env.TWELVE_DATA_API_KEY.trim().length > 0);

    const thresholds: SignalThresholds = {
      minimumScore: parseInt(process.env.THRESHOLD_MIN_SCORE || '70', 10),
      watchingThreshold: parseInt(process.env.THRESHOLD_WATCHING_SCORE || '70', 10),
      qualifiedCandidateThreshold: parseInt(process.env.THRESHOLD_QUALIFIED_CANDIDATE_SCORE || '75', 10),
      signalThreshold: parseInt(process.env.THRESHOLD_SIGNAL_SCORE || '78', 10),
      minimumRR: parseFloat(process.env.THRESHOLD_MIN_RR || '1.8'),
      minimumNetRR: parseFloat(process.env.THRESHOLD_MIN_NET_RR || '1.5'),
      minimumWinProbability: parseFloat(process.env.THRESHOLD_MIN_WIN_PROB || '0.55'),
      minimumStrategyAgreement: parseFloat(process.env.THRESHOLD_MIN_STRATEGY_AGREEMENT || '0.60'),
      minimumTimeframeAlignment: parseFloat(process.env.THRESHOLD_MIN_TIMEFRAME_ALIGNMENT || '0.60'),
      AIConfirmationMode: (process.env.THRESHOLD_AI_CONFIRMATION_MODE as 'REQUIRED' | 'OPTIONAL' | 'DISABLED') || 'OPTIONAL',
      minimumAiConfidence: parseFloat(process.env.THRESHOLD_MIN_AI_CONFIDENCE || '0.55'),
      dailySignalCap: parseInt(process.env.THRESHOLD_DAILY_SIGNAL_CAP || '5', 10),
      candidateThreshold: parseInt(process.env.THRESHOLD_CANDIDATE_LIMIT || '10', 10),
    };

    const providers: ProviderReadiness = {
      nvidiaConfigured,
      finnhubConfigured,
      bitgetConfigured,
      twelvedataConfigured,
    };

    logger.info('Server configuration loaded successfully', {
      port,
      nodeEnv,
      marketDataMaxAgeMs,
      marketDataCacheTtlMs,
      marketDataTimeoutMs,
      signalExpirationMinutes,
      providersReady: providers,
      thresholds,
    });

    return {
      port,
      nodeEnv,
      appUrl,
      marketDataMaxAgeMs,
      marketDataCacheTtlMs,
      marketDataTimeoutMs,
      signalExpirationMinutes,
      signalExpirationMs,
      providers,
      thresholds,
    };
  }

  getConfig(): AppServerConfig {
    return this.config;
  }

  getProviderStatus(): ProviderReadiness {
    return this.config.providers;
  }

  getThresholds(): SignalThresholds {
    return this.config.thresholds;
  }

  updateThresholds(partial: Partial<SignalThresholds>): SignalThresholds {
    this.config.thresholds = {
      ...this.config.thresholds,
      ...partial,
    };
    logger.info('Signal thresholds updated', { updatedThresholds: this.config.thresholds });
    return this.config.thresholds;
  }

  /**
   * Helper to retrieve server-side NVIDIA API Key.
   * NEVER pass or return this to the frontend.
   */
  getNvidiaApiKey(): string | null {
    return process.env.NVIDIA_API_KEY || null;
  }
}

export const serverConfig = new ConfigService();
