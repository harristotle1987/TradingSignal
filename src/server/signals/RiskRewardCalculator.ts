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
  grossRR: number;
  netRR: number;
  primaryRR: number;
  passesRR: boolean;
  isValid: boolean;          // Alias for passesRR
  passedViaTp3: boolean;     // True when selectedTarget === 'TP3'
  effectiveGrossRR: number;  // Compatibility alias for grossRR
  tp1RR: number;             // Legacy alias for tp1GrossRR
  tp2RR: number;             // Legacy alias for tp2GrossRR
  tp3RR: number;             // Legacy alias for tp3GrossRR
  reason?: string;
  rejectionReason?: string;
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

const isValidPrice = (price: unknown): price is number =>
  typeof price === 'number' &&
  Number.isFinite(price) &&
  price > 0;

/**
 * Logs the 10-point diagnostic for every candidate rejected by R:R.
 */
export function logRrRejectionDiagnostic(input: RrDiagnosticInput, minRR?: number): void {
  const actualMinRR = minRR ?? serverConfig.getConfig().thresholds.minimumRR;
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
  const requiredMinRTarget = isBuy ? entryPrice + (riskDistance * actualMinRR) : entryPrice - (riskDistance * actualMinRR);

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

  const fartherTargetExists = (riskDistance * actualMinRR) <= maxTp3AllowedDistance;

  let fartherTargetRejectionReason = `No structural/liquidity target achieves ${actualMinRR.toFixed(2)}R within maximum TP guardrails.`;
  if (!fartherTargetExists) {
    fartherTargetRejectionReason = `Required ${actualMinRR.toFixed(2)}R distance (${(riskDistance * actualMinRR).toFixed(4)}) exceeds maximum allowed TP3 guardrail distance (${maxTp3AllowedDistance.toFixed(4)}, ${maxTp3Pct}% of entry).`;
  } else if (distTP3 / (riskDistance || 1) < actualMinRR) {
    fartherTargetRejectionReason = `Generated TP3 R:R (${(distTP3 / (riskDistance || 1)).toFixed(2)}:1) remains below ${actualMinRR.toFixed(2)}:1 minimum requirement even at maximum structural/ATR expansion.`;
  }

  logger.info(`[R:R REJECTION DIAGNOSTIC] Symbol: ${symbol} (${direction})
  1. Entry Price: ${entryPrice}
  2. Final SL: ${stopLoss}
  3. Risk Distance: ${riskDistance.toFixed(6)}
  4. Required ${actualMinRR.toFixed(2)}R Target: ${requiredMinRTarget.toFixed(6)}
  5. Targets: TP1=${tp1}, TP2=${tp2}, TP3=${tp3}
  6. Target Distances: TP1=${distTP1.toFixed(6)}, TP2=${distTP2.toFixed(6)}, TP3=${distTP3.toFixed(6)}
  7. Structural Levels Used: 15m=${structural15m}, 1h=${structural1h}
  8. ${actualMinRR.toFixed(2)}R Target Beyond Nearest Anchor: ${isMinRBeyondNearestAnchor} (anchor=${nearestAnchor})
  9. Farther Target Exists Within Max TP3 Guardrail (${maxTp3Pct}%): ${fartherTargetExists}
 10. Farther Target Rejection Reason: ${fartherTargetRejectionReason}`);
}

export class RiskRewardCalculator {
  /**
   * Calculates gross R:R and individual target R:R ratios canonically.
   * Pure local calculation with zero API/provider requests.
   * Multi-target R:R gate evaluation:
   *  Condition 1: TP2 R:R >= minRR (e.g. 1.80) -> selectedTarget = 'TP2'
   *  Condition 2: TP3 R:R >= minRR (e.g. 1.80) AND ordered -> selectedTarget = 'TP3'
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

    // 1. Explicit Price Validation
    if (
      !isValidPrice(entryPrice) ||
      !isValidPrice(stopLoss) ||
      !isValidPrice(tp1) ||
      !isValidPrice(tp2) ||
      !isValidPrice(tp3)
    ) {
      return {
        riskDistance: 0,
        rewardDistance: 0,
        tp1GrossRR: 0,
        tp2GrossRR: 0,
        tp3GrossRR: 0,
        selectedTarget: null,
        grossRR: 0,
        netRR: 0,
        primaryRR: 0,
        passesRR: false,
        isValid: false,
        passedViaTp3: false,
        effectiveGrossRR: 0,
        tp1RR: 0,
        tp2RR: 0,
        tp3RR: 0,
        rejectionReason: 'INVALID_PRICE',
        reason: 'INVALID_PRICE: One or more price values (Entry, SL, TP1, TP2, TP3) are non-numeric, non-finite, or <= 0',
      };
    }

    // 2. Risk Distance Validation
    const riskDistance = Math.abs(entryPrice - stopLoss);
    if (!Number.isFinite(riskDistance) || riskDistance <= 0) {
      return {
        riskDistance: 0,
        rewardDistance: 0,
        tp1GrossRR: 0,
        tp2GrossRR: 0,
        tp3GrossRR: 0,
        selectedTarget: null,
        grossRR: 0,
        netRR: 0,
        primaryRR: 0,
        passesRR: false,
        isValid: false,
        passedViaTp3: false,
        effectiveGrossRR: 0,
        tp1RR: 0,
        tp2RR: 0,
        tp3RR: 0,
        rejectionReason: 'INVALID_RISK_DISTANCE',
        reason: 'INVALID_RISK_DISTANCE: Risk distance Math.abs(entryPrice - stopLoss) is zero, negative, or non-finite',
      };
    }

    if (direction !== 'BUY' && direction !== 'SELL') {
      return {
        riskDistance: Number(riskDistance.toFixed(4)),
        rewardDistance: 0,
        tp1GrossRR: 0,
        tp2GrossRR: 0,
        tp3GrossRR: 0,
        selectedTarget: null,
        grossRR: 0,
        netRR: 0,
        primaryRR: 0,
        passesRR: false,
        isValid: false,
        passedViaTp3: false,
        effectiveGrossRR: 0,
        tp1RR: 0,
        tp2RR: 0,
        tp3RR: 0,
        rejectionReason: 'INVALID_DIRECTION',
        reason: `Invalid or missing direction: ${direction} (must be exactly BUY or SELL)`,
      };
    }

    // 3. Target Distances & Gross R:R Ratios
    const tp1RewardDistance = Math.abs(tp1 - entryPrice);
    const tp2RewardDistance = Math.abs(tp2 - entryPrice);
    const tp3RewardDistance = Math.abs(tp3 - entryPrice);

    const tp1GrossRR = Number((tp1RewardDistance / riskDistance).toFixed(2));
    const tp2GrossRR = Number((tp2RewardDistance / riskDistance).toFixed(2));
    const tp3GrossRR = Number((tp3RewardDistance / riskDistance).toFixed(2));

    const tp1RR = tp1GrossRR;
    const tp2RR = tp2GrossRR;
    const tp3RR = tp3GrossRR;

    // 4. TP Geometry Validation
    // For BUY: SL < Entry < TP1 < TP2 < TP3
    // For SELL: SL > Entry > TP1 > TP2 > TP3
    const isOrdered = direction === 'BUY'
      ? (stopLoss < entryPrice && entryPrice < tp1 && tp1 < tp2 && tp2 < tp3)
      : (stopLoss > entryPrice && entryPrice > tp1 && tp1 > tp2 && tp2 > tp3);

    if (!isOrdered) {
      return {
        riskDistance: Number(riskDistance.toFixed(4)),
        rewardDistance: 0,
        tp1GrossRR,
        tp2GrossRR,
        tp3GrossRR,
        selectedTarget: null,
        grossRR: 0,
        netRR: 0,
        primaryRR: 0,
        passesRR: false,
        isValid: false,
        passedViaTp3: false,
        effectiveGrossRR: 0,
        tp1RR,
        tp2RR,
        tp3RR,
        rejectionReason: 'INVALID_TP_GEOMETRY',
        reason: `INVALID_TP_GEOMETRY: Invalid SL/TP placement or ordering relative to entry for direction ${direction}: SL=${stopLoss}, Entry=${entryPrice}, TP1=${tp1}, TP2=${tp2}, TP3=${tp3}`,
      };
    }

    // 5. Target Selection & Qualification Gate
    const passesTp2 = tp2GrossRR >= configMinRR;
    const passesTp3 = tp3GrossRR >= configMinRR;

    const selectedTarget: 'TP2' | 'TP3' | null =
      passesTp2
        ? 'TP2'
        : passesTp3
          ? 'TP3'
          : null;

    const passesRR = selectedTarget !== null;
    const passedViaTp3 = selectedTarget === 'TP3';

    const grossRR =
      selectedTarget === 'TP2'
        ? tp2GrossRR
        : selectedTarget === 'TP3'
          ? tp3GrossRR
          : 0;

    const evaluatedRewardDistance =
      selectedTarget === 'TP2'
        ? tp2RewardDistance
        : selectedTarget === 'TP3'
          ? tp3RewardDistance
          : 0;

    const primaryRR = grossRR;
    const effectiveGrossRR = grossRR;
    const netRR = grossRR;

    if (!passesRR) {
      return {
        riskDistance: Number(riskDistance.toFixed(4)),
        rewardDistance: Number(evaluatedRewardDistance.toFixed(4)),
        tp1GrossRR,
        tp2GrossRR,
        tp3GrossRR,
        selectedTarget: null,
        grossRR: 0,
        netRR: 0,
        primaryRR: 0,
        passesRR: false,
        isValid: false,
        passedViaTp3: false,
        effectiveGrossRR: 0,
        tp1RR,
        tp2RR,
        tp3RR,
        rejectionReason: 'GROSS_RR_BELOW_THRESHOLD',
        reason: `GROSS_RR_BELOW_THRESHOLD. Neither TP2 (${tp2GrossRR.toFixed(2)}:1) nor TP3 (${tp3GrossRR.toFixed(2)}:1) reaches the minimum configured R:R threshold of ${configMinRR.toFixed(2)}:1`,
      };
    }

    return {
      riskDistance: Number(riskDistance.toFixed(4)),
      rewardDistance: Number(evaluatedRewardDistance.toFixed(4)),
      tp1GrossRR,
      tp2GrossRR,
      tp3GrossRR,
      selectedTarget,
      grossRR,
      netRR,
      primaryRR,
      passesRR: true,
      isValid: true,
      passedViaTp3,
      effectiveGrossRR,
      tp1RR,
      tp2RR,
      tp3RR,
    };
  }
}

