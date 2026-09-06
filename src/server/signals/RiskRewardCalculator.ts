import { SignalDirection } from '../../types/index.js';
import { logger } from '../logger.js';
import { serverConfig } from '../config.js';

export interface RiskRewardResult {
  riskDistance: number;
  rewardDistance: number;
  tp1GrossRR: number;
  tp2GrossRR: number;
  tp3GrossRR: number;
  selectedTarget: 'TP2' | 'TP3' | null;
  grossRR: number;          // Selected target's gross R:R (0 if neither passes)
  netRR?: number;
  primaryRR: number;        // Selected target's gross R:R
  effectiveGrossRR: number; // Selected target's gross R:R (alias for grossRR)
  tp1RR: number;            // alias for tp1GrossRR
  tp2RR: number;            // alias for tp2GrossRR
  tp3RR: number;            // alias for tp3GrossRR
  isValid: boolean;
  passesRR: boolean;        // True when either TP2 or TP3 meets minimumRR
  passedViaTp3: boolean;    // True when selectedTarget === 'TP3'
  reason?: string;
}

export interface RrDiagnosticInput {
  symbol: string;
  direction: SignalDirection;
  entryPrice: number;
  stopLoss: number;
  tp1: number;
  tp2: number;
  tp3: number;
  structural15m?: number;
  structural1h?: number;
  assetClass?: string;
  rejectionReason?: string;
}

/**
  * Logs the 10-point diagnostic for every candidate rejected by R:R.
  */
export function logRrRejectionDiagnostic(input: RrDiagnosticInput, minRR?: number): void {
  const effectiveMinRR = minRR ?? serverConfig.getConfig().thresholds.minimumRR;
  const {
    symbol,
    direction,
    entryPrice,
    stopLoss,
    tp1,
    tp2,
    tp3,
    structural15m = 0,
    structural1h = 0,
    assetClass = 'DEFAULT',
  } = input;

  const riskDistance = Math.abs(entryPrice - stopLoss);
  const isBuy = direction === 'BUY';
  const requiredMinRTarget = isBuy ? entryPrice + (riskDistance * effectiveMinRR) : entryPrice - (riskDistance * effectiveMinRR);

  const distTP1 = Math.abs(tp1 - entryPrice);
  const distTP2 = Math.abs(tp2 - entryPrice);
  const distTP3 = Math.abs(tp3 - entryPrice);

  const nearestAnchor = structural1h > 0 ? structural1h : (structural15m > 0 ? structural15m : 0);

  let isMinRBeyondNearestAnchor = false;
  if (nearestAnchor > 0) {
    isMinRBeyondNearestAnchor = isBuy ? requiredMinRTarget > nearestAnchor : requiredMinRTarget < nearestAnchor;
  }

  // Stock guardrail default: 15% max, Crypto: 25% max, Forex: 8% max, Default: 15%
  const upperAsset = (assetClass || 'DEFAULT').toUpperCase();
  const maxTp3Pct = upperAsset.includes('CRYPTO') ? 25 : (upperAsset.includes('FOREX') ? 8 : 15);
  const maxTp3AllowedDistance = entryPrice * (maxTp3Pct / 100);

  const fartherTargetExists = (riskDistance * effectiveMinRR) <= maxTp3AllowedDistance;

  let fartherTargetRejectionReason = `No structural/liquidity target achieves ${effectiveMinRR}R within maximum TP guardrails.`;
  if (!fartherTargetExists) {
    fartherTargetRejectionReason = `Required ${effectiveMinRR}R distance (${(riskDistance * effectiveMinRR).toFixed(4)}) exceeds maximum allowed TP3 guardrail distance (${maxTp3AllowedDistance.toFixed(4)}, ${maxTp3Pct}% of entry).`;
  } else if (distTP3 / (riskDistance || 1) < effectiveMinRR) {
    fartherTargetRejectionReason = `Generated TP3 R:R (${(distTP3 / (riskDistance || 1)).toFixed(2)}:1) remains below ${effectiveMinRR}:1 minimum requirement even at maximum structural/ATR expansion.`;
  }

  logger.info(`[R:R REJECTION DIAGNOSTIC] Symbol: ${symbol} (${direction})
  1. Entry Price: ${entryPrice}
  2. Final SL: ${stopLoss}
  3. Risk Distance: ${riskDistance.toFixed(6)}
  4. Required ${effectiveMinRR}R Target: ${requiredMinRTarget.toFixed(6)}
  5. Targets: TP1=${tp1}, TP2=${tp2}, TP3=${tp3}
  6. Target Distances: TP1=${distTP1.toFixed(6)}, TP2=${distTP2.toFixed(6)}, TP3=${distTP3.toFixed(6)}
  7. Structural Levels Used: 15m=${structural15m}, 1h=${structural1h}
  8. ${effectiveMinRR}R Target Beyond Nearest Anchor: ${isMinRBeyondNearestAnchor} (anchor=${nearestAnchor})
  9. Farther Target Exists Within Max TP3 Guardrail (${maxTp3Pct}%): ${fartherTargetExists}
 10. Farther Target Rejection Reason: ${fartherTargetRejectionReason}`);
}

export class RiskRewardCalculator {
  /**
   * Calculates gross R:R and individual target R:R ratios canonically.
   * Pure local calculation with zero API/provider requests.
   * Multi-target R:R gate evaluation:
   *  TP2 >= minRR -> selectedTarget = 'TP2'
   *  TP2 < minRR AND TP3 >= minRR -> selectedTarget = 'TP3'
   *  TP2 < minRR AND TP3 < minRR -> reject (selectedTarget = null, grossRR = 0)
   */
  public static calculate(
    entryPrice: number,
    stopLoss: number,
    tp1: number,
    tp2: number,
    tp3: number,
    direction: SignalDirection,
    minRR?: number
  ): RiskRewardResult {
    const configMinRR = minRR ?? serverConfig.getConfig().thresholds.minimumRR;
    
    const invalidResult: RiskRewardResult = {
      riskDistance: 0,
      rewardDistance: 0,
      tp1GrossRR: 0,
      tp2GrossRR: 0,
      tp3GrossRR: 0,
      selectedTarget: null,
      grossRR: 0,
      primaryRR: 0,
      effectiveGrossRR: 0,
      tp1RR: 0,
      tp2RR: 0,
      tp3RR: 0,
      isValid: false,
      passesRR: false,
      passedViaTp3: false,
    };

    if (direction !== 'BUY' && direction !== 'SELL') {
      return {
        ...invalidResult,
        reason: `Invalid or missing direction: ${direction} (must be exactly BUY or SELL)`,
      };
    }

    if (
      !Number.isFinite(entryPrice) || entryPrice <= 0 ||
      !Number.isFinite(stopLoss) || stopLoss <= 0 ||
      !Number.isFinite(tp1) || tp1 <= 0 ||
      !Number.isFinite(tp2) || tp2 <= 0 ||
      !Number.isFinite(tp3) || tp3 <= 0
    ) {
      return {
        ...invalidResult,
        reason: 'Invalid or missing Entry, SL, or TP values',
      };
    }

    const riskDistance = Math.abs(entryPrice - stopLoss);
    if (riskDistance <= 0) {
      return {
        ...invalidResult,
        reason: 'Risk distance is zero or negative',
      };
    }

    // Preserve correct TP geometry:
    // For BUY: SL < Entry < TP1 < TP2 < TP3
    // For SELL: SL > Entry > TP1 > TP2 > TP3
    const isOrdered = direction === 'BUY'
      ? (stopLoss < entryPrice && entryPrice < tp1 && tp1 < tp2 && tp2 < tp3)
      : (stopLoss > entryPrice && entryPrice > tp1 && tp1 > tp2 && tp2 > tp3);

    if (!isOrdered) {
      return {
        ...invalidResult,
        riskDistance: Number(riskDistance.toFixed(4)),
        reason: `Invalid SL/TP placement or ordering relative to entry for direction ${direction}: SL=${stopLoss}, Entry=${entryPrice}, TP1=${tp1}, TP2=${tp2}, TP3=${tp3}`,
      };
    }

    const tp1RewardDistance = Math.abs(tp1 - entryPrice);
    const tp2RewardDistance = Math.abs(tp2 - entryPrice);
    const tp3RewardDistance = Math.abs(tp3 - entryPrice);

    const tp1GrossRR = Number((tp1RewardDistance / riskDistance).toFixed(2));
    const tp2GrossRR = Number((tp2RewardDistance / riskDistance).toFixed(2));
    const tp3GrossRR = Number((tp3RewardDistance / riskDistance).toFixed(2));

    let selectedTarget: 'TP2' | 'TP3' | null = null;
    if (tp2GrossRR >= configMinRR) {
      selectedTarget = 'TP2';
    } else if (tp3GrossRR >= configMinRR) {
      selectedTarget = 'TP3';
    }

    const passesRR = selectedTarget !== null;

    const grossRR =
      selectedTarget === 'TP2'
        ? tp2GrossRR
        : selectedTarget === 'TP3'
          ? tp3GrossRR
          : 0;

    const effectiveGrossRR = grossRR;
    const primaryRR = grossRR;
    const passedViaTp3 = selectedTarget === 'TP3';

    const evaluatedRewardDistance =
      selectedTarget === 'TP2'
        ? tp2RewardDistance
        : selectedTarget === 'TP3'
          ? tp3RewardDistance
          : tp2RewardDistance;

    const reason = passesRR
      ? undefined
      : `GROSS_RR_BELOW_THRESHOLD: Neither TP2 (R:R ${tp2GrossRR.toFixed(2)}) nor TP3 (R:R ${tp3GrossRR.toFixed(2)}) reaches minimum R:R threshold of ${configMinRR.toFixed(2)}`;

    return {
      riskDistance: Number(riskDistance.toFixed(4)),
      rewardDistance: Number(evaluatedRewardDistance.toFixed(4)),
      tp1GrossRR,
      tp2GrossRR,
      tp3GrossRR,
      selectedTarget,
      grossRR,
      primaryRR,
      effectiveGrossRR,
      tp1RR: tp1GrossRR,
      tp2RR: tp2GrossRR,
      tp3RR: tp3GrossRR,
      isValid: true,
      passesRR,
      passedViaTp3,
      reason,
    };
  }
}

