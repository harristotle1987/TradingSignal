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

export interface AppServerConfig {
  port: number;
  nodeEnv: string;
  appUrl: string;
  marketDataMaxAgeMs: number;
  marketDataCacheTtlMs: number;
  marketDataTimeoutMs: number;
  providers: ProviderReadiness;
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
    const marketDataCacheTtlMs = parseInt(process.env.MARKET_DATA_CACHE_TTL_MS || '5000', 10);
    const marketDataTimeoutMs = parseInt(process.env.MARKET_DATA_TIMEOUT_MS || '8000', 10);

    const nvidiaConfigured = Boolean(process.env.NVIDIA_API_KEY && process.env.NVIDIA_API_KEY.trim().length > 0);
    const finnhubConfigured = Boolean(process.env.FINNHUB_API_KEY && process.env.FINNHUB_API_KEY.trim().length > 0);
    const bitgetConfigured = Boolean(
      process.env.BITGET_API_KEY &&
      process.env.BITGET_SECRET_KEY &&
      process.env.BITGET_PASSPHRASE
    );
    const twelvedataConfigured = Boolean(process.env.TWELVE_DATA_API_KEY && process.env.TWELVE_DATA_API_KEY.trim().length > 0);

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
      providersReady: providers,
    });

    return {
      port,
      nodeEnv,
      appUrl,
      marketDataMaxAgeMs,
      marketDataCacheTtlMs,
      marketDataTimeoutMs,
      providers,
    };
  }

  getConfig(): AppServerConfig {
    return this.config;
  }

  getProviderStatus(): ProviderReadiness {
    return this.config.providers;
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
