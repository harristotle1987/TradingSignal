/**
 * Central Server Configuration Module
 * Handles environment-variable validation and provider readiness checks.
 *
 * IMPORTANT SECURITY REQUIREMENT:
 * Sensitive API keys are strictly maintained server-side and never exposed to client code.
 */

import { logger } from './logger.js';
import { isProductionPersistenceReady } from './firebaseAdmin.js';

export const TP1_ALLOCATION = 0.40;
export const TP2_ALLOCATION = 0.30;
export const TP3_ALLOCATION = 0.30;
export const HISTORICAL_ENTRY_POLICY: 'CONSERVATIVE' = 'CONSERVATIVE';

if (Math.abs(TP1_ALLOCATION + TP2_ALLOCATION + TP3_ALLOCATION - 1.0) > 0.000001) {
  throw new Error(`FATAL: TP allocations must sum exactly to 1.0. Got: ${TP1_ALLOCATION + TP2_ALLOCATION + TP3_ALLOCATION}`);
}

export interface ProviderReadiness {
  nvidiaConfigured: boolean;
  finnhubConfigured: boolean;
  bitgetConfigured: boolean;
  twelvedataConfigured: boolean;
  tiingoConfigured: boolean;
}

export interface SignalThresholds {
  /** minimumScore: 0-100 points */
  minimumScore: number;
  /** watchingThreshold: 0-100 points */
  watchingThreshold: number;
  /** qualifiedCandidateThreshold: 0-100 points */
  qualifiedCandidateThreshold: number;
  /** signalThreshold: 0-100 points */
  signalThreshold: number;
  /** minimumRR: minimum acceptable GROSS R:R ratio, e.g. 1.5 */
  minimumRR: number;
  /** minimumNetRR: minimum acceptable NET R:R ratio, e.g. 1.5 */
  minimumNetRR: number;
  /** minimumAdverseNetRR: optional stress-test floor, e.g. 1.0 */
  minimumAdverseNetRR?: number;
  /** enforceAdverseNetRRHardGate: boolean flag to turn adverse net RR into a hard gate (default: false) */
  enforceAdverseNetRRHardGate?: boolean;
  /** minimumWinProbability: percentage from 0 to 100, e.g. 55 */
  minimumWinProbability: number;
  /** minimumStrategyAgreement: ratio from 0 to 1, e.g. 0.50 */
  minimumStrategyAgreement: number;
  /** minimumTimeframeAlignment: ratio from 0 to 1, e.g. 0.50 */
  minimumTimeframeAlignment: number;
  /** AI Confirmation Mode */
  AIConfirmationMode: 'REQUIRED' | 'OPTIONAL' | 'DISABLED';
  /** minimumAiConfidence: percentage from 0 to 100 (qualitative AI confidence), e.g. 55 */
  minimumAiConfidence: number;
  /** dailySignalCap: integer count */
  dailySignalCap: number;
  /** candidateLimit: integer count */
  candidateLimit: number;
  /** probabilitySource: EMPIRICAL | MODEL | NONE */
  probabilitySource: 'EMPIRICAL' | 'MODEL' | 'NONE';
  /** requireEmpiricalCalibration: boolean */
  requireEmpiricalCalibration: boolean;
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
  productionPersistenceReady: boolean;
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
    const tiingoConfigured = Boolean(process.env.TIINGO_API_KEY && process.env.TIINGO_API_KEY.trim().length > 0);

    const authoritativeMinScore = parseInt(process.env.THRESHOLD_MIN_SCORE || process.env.THRESHOLD_SIGNAL_SCORE || '70', 10);
    const rawWinProb = parseFloat(process.env.THRESHOLD_MIN_WIN_PROB || '55');
    const rawAiConf = parseFloat(process.env.THRESHOLD_MIN_AI_CONFIDENCE || '55');

    const thresholds: SignalThresholds = {
      minimumScore: authoritativeMinScore,
      watchingThreshold: parseInt(process.env.THRESHOLD_WATCHING_SCORE || '68', 10),
      qualifiedCandidateThreshold: parseInt(process.env.THRESHOLD_QUALIFIED_CANDIDATE_SCORE || '75', 10),
      signalThreshold: authoritativeMinScore,
      minimumRR: parseFloat(process.env.THRESHOLD_MIN_RR || '1.5'),
      minimumNetRR: parseFloat(process.env.THRESHOLD_MIN_NET_RR || '1.5'),
      minimumAdverseNetRR: process.env.THRESHOLD_MIN_ADVERSE_NET_RR ? parseFloat(process.env.THRESHOLD_MIN_ADVERSE_NET_RR) : 1.0,
      enforceAdverseNetRRHardGate: process.env.ENFORCE_ADVERSE_NET_RR_HARD_GATE === 'true',
      minimumWinProbability: rawWinProb <= 1.0 ? rawWinProb * 100 : rawWinProb,
      minimumStrategyAgreement: 0.50,
      minimumTimeframeAlignment: 0.50,
      AIConfirmationMode: (process.env.THRESHOLD_AI_CONFIRMATION_MODE as 'REQUIRED' | 'OPTIONAL' | 'DISABLED') || 'OPTIONAL',
      minimumAiConfidence: rawAiConf <= 1.0 ? rawAiConf * 100 : rawAiConf,
      dailySignalCap: parseInt(process.env.THRESHOLD_DAILY_SIGNAL_CAP || '5', 10),
      candidateLimit: parseInt(process.env.THRESHOLD_CANDIDATE_LIMIT || '10', 10),
      probabilitySource: (process.env.THRESHOLD_PROBABILITY_SOURCE || process.env.PROBABILITY_SOURCE || 'EMPIRICAL') as 'EMPIRICAL' | 'MODEL' | 'NONE',
      requireEmpiricalCalibration: process.env.REQUIRE_EMPIRICAL_CALIBRATION === 'true',
    };

    const providers: ProviderReadiness = {
      nvidiaConfigured,
      finnhubConfigured,
      bitgetConfigured,
      twelvedataConfigured,
      tiingoConfigured,
    };

    const persistenceReady = isProductionPersistenceReady();

    logger.info('Server configuration loaded successfully', {
      port,
      nodeEnv,
      marketDataMaxAgeMs,
      marketDataCacheTtlMs,
      marketDataTimeoutMs,
      signalExpirationMinutes,
      productionPersistenceReady: persistenceReady,
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
      productionPersistenceReady: persistenceReady,
      providers,
      thresholds,
    };
  }

  getConfig(): AppServerConfig {
    const currentNodeEnv = process.env.NODE_ENV || this.config.nodeEnv;
    return {
      ...this.config,
      nodeEnv: currentNodeEnv,
      productionPersistenceReady: isProductionPersistenceReady(),
    };
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
