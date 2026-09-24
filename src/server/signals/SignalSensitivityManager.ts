/**
 * SIGNAL SENSITIVITY & STRICTNESS MANAGER
 *
 * Provides calibrated sensitivity profiles to resolve signal starvation
 * without compromising hard risk gates (capital preservation, stop loss, negative expectancy).
 *
 * PROFILES:
 * 1. BALANCED (Default / Recommended):
 *    - Score hurdle: ≥ 65 (down from 72/75)
 *    - Gross R:R hurdle: ≥ 1.5:1 (down from 1.8/2.0:1)
 *    - Net R:R hurdle: ≥ 1.10:1 (down from 1.30:1)
 *    - Win Probability hurdle: ≥ 50%
 *    - Frequency: ~2-5 signals/day
 *
 * 2. CONSERVATIVE (Institutional):
 *    - Score hurdle: ≥ 72
 *    - Gross R:R hurdle: ≥ 1.8:1
 *    - Net R:R hurdle: ≥ 1.30:1
 *    - Win Probability hurdle: ≥ 55%
 *    - Frequency: ~1-3 signals/week
 *
 * 3. ACTIVE (High Frequency / Intraday):
 *    - Score hurdle: ≥ 62
 *    - Gross R:R hurdle: ≥ 1.3:1
 *    - Net R:R hurdle: ≥ 1.05:1
 *    - Win Probability hurdle: ≥ 45%
 *    - Frequency: ~5-10 signals/day
 *
 * 4. CUSTOM:
 *    - User-defined thresholds with safe institutional bounds.
 */

import {
  SensitivityProfileName,
  SensitivityProfileConfig,
} from '../../types/index.js';
import { serverConfig } from '../config.js';
import { ScannerPersistence } from './ScannerPersistence.js';
import { logger } from '../logger.js';

export const FINAL_SCORE_FLOOR = 65;
export const FINAL_EXECUTABLE_RR_FLOOR = 1.8;

export const CANONICAL_SENSITIVITY_PROFILES: Record<
  Exclude<SensitivityProfileName, 'CUSTOM'>,
  SensitivityProfileConfig
> = {
  BALANCED: {
    name: 'BALANCED',
    label: 'Balanced (Recommended)',
    badge: 'Optimal Quality & Frequency',
    description:
      'Calibrated to eliminate signal starvation while preserving structural safety. Unlocks pristine swing and intraday momentum setups with strict >=1.8:1 gross R:R preservation.',
    signalThreshold: 65,
    minimumScore: 65,
    minimumRR: 1.8,
    minimumNetRR: 1.10,
    watchingThreshold: 60,
    qualifiedCandidateThreshold: 63,
    minimumWinProbability: 50,
    minimumTimeframeAlignment: 0.35,
    minimumStrategyAgreement: 0.40,
    estimatedFrequency: '2 – 5 signals / day',
  },
  CONSERVATIVE: {
    name: 'CONSERVATIVE',
    label: 'Conservative (Institutional)',
    badge: 'Ultra-Selective',
    description:
      'Original ultra-strict institutional filter demanding near-perfect MTF alignment and high 1.8:1 gross R:R. Generates very few signals.',
    signalThreshold: 72,
    minimumScore: 72,
    minimumRR: 1.8,
    minimumNetRR: 1.30,
    watchingThreshold: 68,
    qualifiedCandidateThreshold: 70,
    minimumWinProbability: 55,
    minimumTimeframeAlignment: 0.50,
    minimumStrategyAgreement: 0.50,
    estimatedFrequency: '1 – 3 signals / week',
  },
  ACTIVE: {
    name: 'ACTIVE',
    label: 'Active Trader',
    badge: 'High Frequency',
    description:
      'Optimized for intraday market participants. Lowers score hurdles to catch fast 15m and 1h momentum breakouts while maintaining strict >=1.8:1 gross R:R and score floor >=65.',
    signalThreshold: 65,
    minimumScore: 65,
    minimumRR: 1.8,
    minimumNetRR: 1.05,
    watchingThreshold: 58,
    qualifiedCandidateThreshold: 60,
    minimumWinProbability: 45,
    minimumTimeframeAlignment: 0.25,
    minimumStrategyAgreement: 0.30,
    estimatedFrequency: '5 – 10 signals / day',
  },
};

export class SignalSensitivityManager {
  private static activeProfileName: SensitivityProfileName = 'BALANCED';
  private static customConfig: SensitivityProfileConfig = {
    name: 'CUSTOM',
    label: 'Custom Configuration',
    badge: 'User Defined',
    description: 'Customized threshold bounds and risk parameters.',
    signalThreshold: 65,
    minimumScore: 65,
    minimumRR: 1.8,
    minimumNetRR: 1.10,
    watchingThreshold: 60,
    qualifiedCandidateThreshold: 63,
    minimumWinProbability: 50,
    minimumTimeframeAlignment: 0.35,
    minimumStrategyAgreement: 0.40,
    estimatedFrequency: 'Variable',
  };

  private static isInitialized = false;

  /**
   * Initializes the sensitivity manager.
   * Restores persisted profile choice or defaults to BALANCED.
   */
  public static init(): void {
    if (this.isInitialized) return;

    try {
      ScannerPersistence.init();
      const settings = ScannerPersistence.getSettings();

      if (settings?.sensitivityProfile && (CANONICAL_SENSITIVITY_PROFILES as any)[settings.sensitivityProfile]) {
        this.activeProfileName = settings.sensitivityProfile as SensitivityProfileName;
        if (settings.customSensitivity) {
          this.customConfig = {
            ...this.customConfig,
            ...settings.customSensitivity,
          };
        }
      } else {
        // Default to BALANCED to resolve the strictness starvation
        this.activeProfileName = 'BALANCED';
      }

      this.isInitialized = true;
      this.syncThresholdsWithServerConfig();

      logger.info(`[SignalSensitivityManager] Initialized with active profile: ${this.activeProfileName}`, {
        activeProfile: this.activeProfileName,
        config: this.getActiveConfig(),
      });
    } catch (err) {
      logger.error('[SignalSensitivityManager] Failed to initialize from persistence, using BALANCED default', { error: err });
      this.activeProfileName = 'BALANCED';
      this.isInitialized = true;
      this.syncThresholdsWithServerConfig();
    }
  }

  /**
   * Retrieves all canonical profiles plus active custom configuration
   */
  public static getAllProfiles(): Record<SensitivityProfileName, SensitivityProfileConfig> {
    return {
      BALANCED: { ...CANONICAL_SENSITIVITY_PROFILES.BALANCED },
      CONSERVATIVE: { ...CANONICAL_SENSITIVITY_PROFILES.CONSERVATIVE },
      ACTIVE: { ...CANONICAL_SENSITIVITY_PROFILES.ACTIVE },
      CUSTOM: { ...this.customConfig },
    };
  }

  /**
   * Retrieves active profile name
   */
  public static getActiveProfileName(): SensitivityProfileName {
    if (!this.isInitialized) this.init();
    return this.activeProfileName;
  }

  /**
   * Retrieves active profile configuration
   */
  public static getActiveConfig(): SensitivityProfileConfig {
    if (!this.isInitialized) this.init();
    if (this.activeProfileName === 'CUSTOM') {
      return { ...this.customConfig };
    }
    return { ...CANONICAL_SENSITIVITY_PROFILES[this.activeProfileName] || CANONICAL_SENSITIVITY_PROFILES.BALANCED };
  }

  /**
   * Switches the active sensitivity profile or updates custom overrides
   */
  public static setActiveProfile(
    profileName: SensitivityProfileName,
    customOverrides?: Partial<SensitivityProfileConfig>
  ): SensitivityProfileConfig {
    if (!this.isInitialized) this.init();

    if (profileName === 'CUSTOM') {
      if (customOverrides) {
        // Enforce safe bounds on custom overrides to prevent invalid parameters
        const score = Math.max(FINAL_SCORE_FLOOR, Math.min(85, customOverrides.signalThreshold ?? customOverrides.minimumScore ?? this.customConfig.signalThreshold));
        const rr = Math.max(FINAL_EXECUTABLE_RR_FLOOR, Math.min(3.5, customOverrides.minimumRR ?? this.customConfig.minimumRR));
        const netRR = Math.max(1.0, Math.min(2.5, customOverrides.minimumNetRR ?? this.customConfig.minimumNetRR));
        const winProb = Math.max(35, Math.min(75, customOverrides.minimumWinProbability ?? this.customConfig.minimumWinProbability));

        this.customConfig = {
          ...this.customConfig,
          signalThreshold: score,
          minimumScore: score,
          minimumRR: rr,
          minimumNetRR: netRR,
          minimumWinProbability: winProb,
          watchingThreshold: Math.max(45, score - 5),
          qualifiedCandidateThreshold: Math.max(48, score - 2),
        };
      }
      this.activeProfileName = 'CUSTOM';
    } else if (CANONICAL_SENSITIVITY_PROFILES[profileName]) {
      this.activeProfileName = profileName;
    } else {
      throw new Error(`Unknown sensitivity profile: ${profileName}`);
    }

    this.syncThresholdsWithServerConfig();
    this.persistSettings();

    const config = this.getActiveConfig();
    logger.info(`[SignalSensitivityManager] Active profile set to ${this.activeProfileName}`, {
      profile: this.activeProfileName,
      config,
    });

    return config;
  }

  /**
   * Resets active profile back to recommended BALANCED default
   */
  public static resetToDefault(): SensitivityProfileConfig {
    return this.setActiveProfile('BALANCED');
  }

  /**
   * Synchronizes active sensitivity thresholds into serverConfig global thresholds
   */
  private static syncThresholdsWithServerConfig(): void {
    const config = this.getActiveConfig();

    serverConfig.updateThresholds({
      signalThreshold: Math.max(FINAL_SCORE_FLOOR, config.signalThreshold),
      minimumScore: Math.max(FINAL_SCORE_FLOOR, config.minimumScore),
      minimumRR: Math.max(FINAL_EXECUTABLE_RR_FLOOR, config.minimumRR),
      minimumNetRR: config.minimumNetRR,
      watchingThreshold: config.watchingThreshold,
      qualifiedCandidateThreshold: config.qualifiedCandidateThreshold,
      minimumWinProbability: config.minimumWinProbability,
      minimumTimeframeAlignment: config.minimumTimeframeAlignment,
      minimumStrategyAgreement: config.minimumStrategyAgreement,
    });
  }

  /**
   * Persists the current sensitivity selection to ScannerPersistence
   */
  private static persistSettings(): void {
    try {
      ScannerPersistence.updateSettings({
        sensitivityProfile: this.activeProfileName,
        customSensitivity: this.activeProfileName === 'CUSTOM' ? this.customConfig : undefined,
      });
    } catch (err) {
      logger.warn('[SignalSensitivityManager] Failed to persist sensitivity choice to disk', { error: err });
    }
  }
}
