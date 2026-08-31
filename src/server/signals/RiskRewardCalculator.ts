import { SignalDirection } from '../../types/index.js';
import { logger } from '../logger.js';
import { ASSET_CLASS_GUARDRAILS } from './AtrTpGenerator.js';

export interface RiskRewardResult {
  riskDistance: number;
  rewardDistance: number;
  grossRR: number;          // Canonical primary gross R:R (= effectiveGrossRR = primaryRR)
  effectiveGrossRR: number; // Effective Gross R:R evaluated for gate (TP2 or TP3)
  tp1RR: number;
  tp2RR: number;
  tp3RR: number;
  primaryRR: number;        // Primary qualifying R:R
  passedGrossRR: boolean;   // True if effectiveGrossRR >= minRR and isOrdered
  passedViaTp3: boolean;    // True when TP3 R:R >= minRR satisfied the gate
  isValid: boolean;
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
export function logRrRejectionDiagnostic(input: RrDiagnosticInput): void {
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
  const required1_5RTarget = isBuy ? entryPrice + (riskDistance * 1.5) : entryPrice - (riskDistance * 1.5);

  const distTP1 = Math.abs(tp1 - entryPrice);
  const distTP2 = Math.abs(tp2 - entryPrice);
  const distTP3 = Math.abs(tp3 - entryPrice);

  const nearestAnchor = structural1h > 0 ? structural1h : (structural15m > 0 ? structural15m : 0);

  let is1_5RBeyondNearestAnchor = false;
  if (nearestAnchor > 0) {
    is1_5RBeyondNearestAnchor = isBuy ? required1_5RTarget > nearestAnchor : required1_5RTarget < nearestAnchor;
  }

  // Read exact TP3 max percentage guardrail ceiling from ASSET_CLASS_GUARDRAILS
  const upperAsset = (assetClass || 'DEFAULT').toUpperCase();
  const guardrailKey = upperAsset.includes('CRYPTO') ? 'CRYPTO'
    : upperAsset.includes('FOREX') ? 'FOREX'
    : upperAsset.includes('STOCK') || upperAsset.includes('EQUITY') ? 'STOCKS'
    : upperAsset.includes('COMMODITY') || upperAsset.includes('METAL') || upperAsset.includes('ENERGY') ? 'COMMODITIES'
    : upperAsset.includes('INDEX') || upperAsset.includes('INDICES') ? 'INDICES'
    : (ASSET_CLASS_GUARDRAILS[upperAsset] ? upperAsset : 'DEFAULT');
  const maxTp3Pct = ASSET_CLASS_GUARDRAILS[guardrailKey]?.tp3.maxPct ?? ASSET_CLASS_GUARDRAILS.DEFAULT.tp3.maxPct;
  const maxTp3AllowedDistance = entryPrice * (maxTp3Pct / 100);

  const fartherTargetExists = (riskDistance * 1.5) <= maxTp3AllowedDistance;

  let fartherTargetRejectionReason = 'No structural/liquidity target achieves 1.5R within maximum TP guardrails.';
  if (!fartherTargetExists) {
    fartherTargetRejectionReason = `Required 1.5R distance (${(riskDistance * 1.5).toFixed(4)}) exceeds maximum allowed TP3 guardrail distance (${maxTp3AllowedDistance.toFixed(4)}, ${maxTp3Pct}% of entry).`;
  } else if (distTP3 / (riskDistance || 1) < 1.5) {
    fartherTargetRejectionReason = `Generated TP3 R:R (${(distTP3 / (riskDistance || 1)).toFixed(2)}:1) remains below 1.5:1 minimum requirement even at maximum structural/ATR expansion.`;
  }

  logger.info(`[R:R REJECTION DIAGNOSTIC] Symbol: ${symbol} (${direction})
  1. Entry Price: ${entryPrice}
  2. Final SL: ${stopLoss}
  3. Risk Distance: ${riskDistance.toFixed(6)}
  4. Required 1.5R Target: ${required1_5RTarget.toFixed(6)}
  5. Targets: TP1=${tp1}, TP2=${tp2}, TP3=${tp3}
  6. Target Distances: TP1=${distTP1.toFixed(6)}, TP2=${distTP2.toFixed(6)}, TP3=${distTP3.toFixed(6)}
  7. Structural Levels Used: 15m=${structural15m}, 1h=${structural1h}
  8. 1.5R Target Beyond Nearest Anchor: ${is1_5RBeyondNearestAnchor} (anchor=${nearestAnchor})
  9. Farther Target Exists Within Max TP3 Guardrail (${maxTp3Pct}%): ${fartherTargetExists}
 10. Farther Target Rejection Reason: ${fartherTargetRejectionReason}`);
}

export class RiskRewardCalculator {
  /**
   * Calculates gross R:R and individual target R:R ratios canonically.
   * Pure local calculation with zero API/provider requests.
   * Multi-target R:R gate evaluation:
   *  Condition 1: TP2 R:R >= minRR (e.g. 1.50)
   *  Condition 2: TP3 R:R >= minRR (e.g. 1.50) AND TP3 is structurally valid/reachable according to TP validation rules.
   */
  public static calculate(
    entryPrice: number,
    stopLoss: number,
    tp1: number,
    tp2: number,
    tp3: number,
    direction: SignalDirection,
    minRR: number = 1.50
  ): RiskRewardResult {
    const invalidResult: RiskRewardResult = {
      riskDistance: 0,
      rewardDistance: 0,
      grossRR: 0,
      effectiveGrossRR: 0,
      tp1RR: 0,
      tp2RR: 0,
      tp3RR: 0,
      primaryRR: 0,
      passedGrossRR: false,
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

    // Validate logical positioning and strict target ordering relative to direction
    const isOrdered = direction === 'BUY'
      ? (stopLoss < entryPrice && tp1 > entryPrice && tp2 > tp1 && tp3 > tp2)
      : (stopLoss > entryPrice && tp1 < entryPrice && tp2 < tp1 && tp3 < tp2);

    if (!isOrdered) {
      return {
        riskDistance: Number(riskDistance.toFixed(4)),
        rewardDistance: Number(Math.abs(tp2 - entryPrice).toFixed(4)),
        grossRR: tp2RR,
        effectiveGrossRR: tp2RR,
        tp1RR,
        tp2RR,
        tp3RR,
        primaryRR: tp2RR,
        passedGrossRR: false,
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

    if (tp2RR >= minRR) {
      effectiveGrossRR = tp2RR;
      passedViaTp3 = false;
      evaluatedRewardDistance = Math.abs(tp2 - entryPrice);
    } else if (tp3RR >= minRR) {
      effectiveGrossRR = tp3RR;
      passedViaTp3 = true;
      evaluatedRewardDistance = Math.abs(tp3 - entryPrice);
    } else {
      effectiveGrossRR = tp2RR;
      passedViaTp3 = false;
      evaluatedRewardDistance = Math.abs(tp2 - entryPrice);
    }

    const passedGrossRR = isOrdered && effectiveGrossRR >= minRR;

    return {
      riskDistance: Number(riskDistance.toFixed(4)),
      rewardDistance: Number(evaluatedRewardDistance.toFixed(4)),
      grossRR: effectiveGrossRR,
      effectiveGrossRR,
      tp1RR,
      tp2RR,
      tp3RR,
      primaryRR: effectiveGrossRR,
      passedGrossRR,
      isValid: true,
      passedViaTp3,
    };
  }

  /**
   * Automated consistency check: verifies that published R:R values,
   * score, and rejection reasons do not contradict the canonical calculation result.
   */
  public static verifyConsistency(params: {
    rrResult: RiskRewardResult;
    score: number;
    minimumScore: number;
    failedGates: string[];
    rejectionReason?: string;
  }): { isConsistent: boolean; violationReason?: string } {
    const { rrResult, score, minimumScore, failedGates, rejectionReason } = params;

    // 1. R:R Gross Consistency Check: If gross R:R passed, GROSS_RR_BELOW_THRESHOLD must NOT be reported.
    if (rrResult.passedGrossRR) {
      if (failedGates.some(g => g === 'GROSS_RR_BELOW_THRESHOLD' || g === 'RR')) {
        return {
          isConsistent: false,
          violationReason: `Contradiction: Canonical calculator passed gross R:R (${rrResult.primaryRR}:1) via ${rrResult.passedViaTp3 ? 'TP3' : 'TP2'}, but failedGates includes GROSS_RR_BELOW_THRESHOLD`,
        };
      }
      if (rejectionReason && rejectionReason.includes('GROSS_RR_BELOW_THRESHOLD')) {
        return {
          isConsistent: false,
          violationReason: `Contradiction: Canonical calculator passed gross R:R (${rrResult.primaryRR}:1), but rejectionReason was set to GROSS_RR_BELOW_THRESHOLD`,
        };
      }
    }

    // 2. Score Threshold Consistency Check: If score >= minimumScore, FINAL_SCORE_BELOW_70/72 must NOT be reported.
    if (score >= minimumScore) {
      if (failedGates.some(g => g.includes('FINAL_SCORE_BELOW_'))) {
        return {
          isConsistent: false,
          violationReason: `Contradiction: Score ${score} >= minimumScore (${minimumScore}), but failedGates includes score threshold rejection`,
        };
      }
      if (rejectionReason && rejectionReason.includes('FINAL_SCORE_BELOW_')) {
        return {
          isConsistent: false,
          violationReason: `Contradiction: Score ${score} >= minimumScore (${minimumScore}), but rejectionReason was score threshold rejection`,
        };
      }
    }

    return { isConsistent: true };
  }
}

