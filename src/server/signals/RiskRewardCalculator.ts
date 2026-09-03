import { SignalDirection } from '../../types/index.js';
import { logger } from '../logger.js';
import { serverConfig } from '../config.js';

export interface RiskRewardResult {
  riskDistance: number;
  rewardDistance: number;
  grossRR: number;          // TP2 R:R ratio (canonical benchmark)
  effectiveGrossRR: number; // Effective Gross R:R evaluated for gate (either TP2 or TP3 if condition 2 is met)
  tp1RR: number;
  tp2RR: number;
  tp3RR: number;
  primaryRR: number;
  isValid: boolean;
  passedViaTp3: boolean;    // True when condition 2 (TP3 R:R >= minRR) satisfied the gate
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
export function logRrRejectionDiagnostic(input: RrDiagnosticInput, minRR: number = 1.50): void {
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
  const requiredMinRTarget = isBuy ? entryPrice + (riskDistance * minRR) : entryPrice - (riskDistance * minRR);

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

  const fartherTargetExists = (riskDistance * minRR) <= maxTp3AllowedDistance;

  let fartherTargetRejectionReason = `No structural/liquidity target achieves ${minRR}R within maximum TP guardrails.`;
  if (!fartherTargetExists) {
    fartherTargetRejectionReason = `Required ${minRR}R distance (${(riskDistance * minRR).toFixed(4)}) exceeds maximum allowed TP3 guardrail distance (${maxTp3AllowedDistance.toFixed(4)}, ${maxTp3Pct}% of entry).`;
  } else if (distTP3 / (riskDistance || 1) < minRR) {
    fartherTargetRejectionReason = `Generated TP3 R:R (${(distTP3 / (riskDistance || 1)).toFixed(2)}:1) remains below ${minRR}:1 minimum requirement even at maximum structural/ATR expansion.`;
  }

  logger.info(`[R:R REJECTION DIAGNOSTIC] Symbol: ${symbol} (${direction})
  1. Entry Price: ${entryPrice}
  2. Final SL: ${stopLoss}
  3. Risk Distance: ${riskDistance.toFixed(6)}
  4. Required ${minRR}R Target: ${requiredMinRTarget.toFixed(6)}
  5. Targets: TP1=${tp1}, TP2=${tp2}, TP3=${tp3}
  6. Target Distances: TP1=${distTP1.toFixed(6)}, TP2=${distTP2.toFixed(6)}, TP3=${distTP3.toFixed(6)}
  7. Structural Levels Used: 15m=${structural15m}, 1h=${structural1h}
  8. ${minRR}R Target Beyond Nearest Anchor: ${isMinRBeyondNearestAnchor} (anchor=${nearestAnchor})
  9. Farther Target Exists Within Max TP3 Guardrail (${maxTp3Pct}%): ${fartherTargetExists}
 10. Farther Target Rejection Reason: ${fartherTargetRejectionReason}`);
}

export class RiskRewardCalculator {
  /**
   * Calculates gross R:R and individual target R:R ratios canonically.
   * Pure local calculation with zero API/provider requests.
   * Multi-target R:R gate evaluation:
   *  Condition 1: TP2 R:R >= minRR (e.g. 1.80)
   *  Condition 2: TP3 R:R >= minRR (e.g. 1.80) AND TP3 is structurally valid/reachable according to TP validation rules.
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
      grossRR: 0,
      effectiveGrossRR: 0,
      tp1RR: 0,
      tp2RR: 0,
      tp3RR: 0,
      primaryRR: 0,
      isValid: false,
      passedViaTp3: false,
    };

    if (direction !== 'BUY' && direction !== 'SELL') {
      return {
        ...invalidResult,
        reason: `Invalid or missing direction: ${direction} (must be exactly BUY or SELL)`,
      };
    }

    if (
      typeof entryPrice !== 'number' || isNaN(entryPrice) || entryPrice <= 0 ||
      typeof stopLoss !== 'number' || isNaN(stopLoss) || stopLoss <= 0 ||
      typeof tp1 !== 'number' || isNaN(tp1) || tp1 <= 0 ||
      typeof tp2 !== 'number' || isNaN(tp2) || tp2 <= 0 ||
      typeof tp3 !== 'number' || isNaN(tp3) || tp3 <= 0
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

    let tp1RR = 0;
    let tp2RR = 0;
    let tp3RR = 0;

    if (direction === 'BUY') {
      tp1RR = Number((Math.abs(tp1 - entryPrice) / riskDistance).toFixed(2));
      tp2RR = Number((Math.abs(tp2 - entryPrice) / riskDistance).toFixed(2));
      tp3RR = Number((Math.abs(tp3 - entryPrice) / riskDistance).toFixed(2));
    } else {
      tp1RR = Number((Math.abs(entryPrice - tp1) / riskDistance).toFixed(2));
      tp2RR = Number((Math.abs(entryPrice - tp2) / riskDistance).toFixed(2));
      tp3RR = Number((Math.abs(entryPrice - tp3) / riskDistance).toFixed(2));
    }

    const grossRR = tp2RR;

    // Validate logical positioning and strict target ordering relative to direction
    const isOrdered = direction === 'BUY'
      ? (stopLoss < entryPrice && tp1 > entryPrice && tp2 > tp1 && tp3 > tp2)
      : (stopLoss > entryPrice && tp1 < entryPrice && tp2 < tp1 && tp3 < tp2);

    if (!isOrdered) {
      return {
        riskDistance: Number(riskDistance.toFixed(4)),
        rewardDistance: Number(Math.abs(tp2 - entryPrice).toFixed(4)),
        grossRR,
        effectiveGrossRR: grossRR,
        tp1RR,
        tp2RR,
        tp3RR,
        primaryRR: grossRR,
        isValid: false,
        passedViaTp3: false,
        reason: `Invalid SL/TP placement or ordering relative to entry for direction ${direction}: SL=${stopLoss}, TP1=${tp1}, TP2=${tp2}, TP3=${tp3}`,
      };
    }

    // Multi-target R:R gate evaluation
    // Condition 1: TP2 R:R >= minRR
    // Condition 2: TP3 R:R >= minRR AND TP3 is structurally valid / ordered
    let passedViaTp3 = false;
    let effectiveGrossRR = tp2RR;
    let evaluatedRewardDistance = Math.abs(tp2 - entryPrice);

    if (tp2RR >= configMinRR) {
      effectiveGrossRR = tp2RR;
      passedViaTp3 = false;
      evaluatedRewardDistance = Math.abs(tp2 - entryPrice);
    } else if (tp3RR >= configMinRR) {
      effectiveGrossRR = tp3RR;
      passedViaTp3 = true;
      evaluatedRewardDistance = Math.abs(tp3 - entryPrice);
    } else {
      effectiveGrossRR = tp2RR;
      passedViaTp3 = false;
      evaluatedRewardDistance = Math.abs(tp2 - entryPrice);
    }

    return {
      riskDistance: Number(riskDistance.toFixed(4)),
      rewardDistance: Number(evaluatedRewardDistance.toFixed(4)),
      grossRR,
      effectiveGrossRR,
      tp1RR,
      tp2RR,
      tp3RR,
      primaryRR: effectiveGrossRR,
      isValid: true,
      passedViaTp3,
    };
  }
}

