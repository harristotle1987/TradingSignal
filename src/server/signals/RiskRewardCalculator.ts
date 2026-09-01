import { SignalDirection } from '../../types/index.js';
import { logger } from '../logger.js';
import { ASSET_CLASS_GUARDRAILS } from './AtrTpGenerator.js';
import { SymbolNormalizer } from '../market/SymbolNormalizer.js';

export interface RiskRewardResult {
  riskDistance: number;
  rewardDistance: number;
  grossRR: number;          // Selected target's gross R:R (= selectedGrossRR = primaryRR)
  netRR: number;            // Selected target's net R:R (= selectedNetRR)
  selectedGrossRR: number;
  selectedNetRR: number;
  primaryRR: number;        // Selected target's gross R:R for tradeability/gross-RR pipeline
  effectiveGrossRR: number; // Selected target's gross R:R (backward compatibility)
  tp1GrossRR: number;
  tp2GrossRR: number;
  tp3GrossRR: number;
  tp1NetRR: number;
  tp2NetRR: number;
  tp3NetRR: number;
  tp1RR: number;            // tp1NetRR
  tp2RR: number;            // tp2NetRR
  tp3RR: number;            // tp3NetRR
  passedGrossRR: boolean;   // True if tp2GrossRR >= minGrossRR || tp3GrossRR >= minGrossRR and isOrdered
  passedNetRR: boolean;     // True if tp2NetRR >= minNetRR || tp3NetRR >= minNetRR
  passedViaTp3: boolean;    // True when TP3 Gross R:R >= minGrossRR satisfied the gate
  isValid: boolean;
  takeProfit?: number;
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
   * Calculates baseline (normal) execution friction profile for the asset.
   * Pure local calculation with zero API/provider requests.
   */
  public static calculateFriction(
    symbol: string | undefined,
    entryPrice: number,
    rawReward: number,
    rawRisk: number
  ): { totalFrictionPrice: number; netReward: number; netRisk: number; netRR: number } {
    if (!symbol) {
      return {
        totalFrictionPrice: 0,
        netReward: rawReward,
        netRisk: rawRisk,
        netRR: rawRisk > 0 ? parseFloat((rawReward / rawRisk).toFixed(2)) : 0
      };
    }
    const cleanSymbol = symbol ? (SymbolNormalizer.normalizeAppSymbol(symbol) || symbol.trim().toUpperCase()) : 'DEFAULT';
    const assetClassUpper = symbol ? SymbolNormalizer.getAssetClassification(cleanSymbol).toUpperCase() : 'STOCKS';

    const assetClass: 'FOREX' | 'CRYPTO' | 'STOCKS' | 'INDEX' =
      assetClassUpper === 'FOREX' ? 'FOREX' :
      assetClassUpper === 'CRYPTO' ? 'CRYPTO' :
      assetClassUpper === 'INDEX' ? 'INDEX' : 'STOCKS';

    let spread = 0;
    let slippage = 0;        // NEVER zero!
    let fees = 0;
    let latencyBuffer = 0;

    if (assetClass === 'FOREX') {
      const isJPY = cleanSymbol.includes('JPY');
      const pipMult = isJPY ? 100 : 10000;
      spread = (isJPY ? 2.0 : 1.2) / pipMult;
      slippage = (isJPY ? 0.8 : 0.5) / pipMult;        // Mandatory non-zero slippage
      fees = (isJPY ? 0.5 : 0.3) / pipMult;            // Broker commission
      latencyBuffer = (isJPY ? 0.5 : 0.3) / pipMult;   // Execution lag
    } else if (assetClass === 'CRYPTO') {
      spread = entryPrice * 0.0004;         // 0.04%
      slippage = entryPrice * 0.0005;       // 0.05% mandatory slippage
      fees = entryPrice * 0.0012;           // 0.12% (2x 0.06% taker fee)
      latencyBuffer = entryPrice * 0.0004;  // 0.04%
    } else {
      // STOCKS / INDEX
      spread = Math.max(0.03, entryPrice * 0.0003);
      slippage = Math.max(0.02, entryPrice * 0.0002);  // Mandatory non-zero slippage
      fees = Math.max(0.01, entryPrice * 0.0001);      // SEC/FINRA clearing
      latencyBuffer = Math.max(0.02, entryPrice * 0.0002);
    }

    const totalFrictionPrice = spread + slippage + fees + latencyBuffer;
    const netReward = Math.max(0, rawReward - totalFrictionPrice);
    const netRisk = rawRisk + totalFrictionPrice;
    const netRR = netRisk > 0 ? parseFloat((netReward / netRisk).toFixed(2)) : 0;

    return {
      totalFrictionPrice,
      netReward,
      netRisk,
      netRR,
    };
  }

  /**
   * Calculates gross R:R and individual target R:R ratios canonically.
   * Pure local calculation with zero API/provider requests.
   * Multi-target R:R gate evaluation using Net R:R.
   */
  public static calculate(
    entryPrice: number,
    stopLoss: number,
    tp1: number,
    tp2: number,
    tp3: number,
    direction: SignalDirection,
    minGrossRR: number = 1.8,
    minNetRROrSymbol: number | string = 1.5,
    symbolArg?: string
  ): RiskRewardResult {
    const minRR = typeof minGrossRR === 'number' && !isNaN(minGrossRR) ? minGrossRR : 1.8;
    let minNet = 1.5;
    let symbol: string | undefined = undefined;

    if (typeof minNetRROrSymbol === 'number') {
      minNet = minNetRROrSymbol;
      symbol = symbolArg;
    } else if (typeof minNetRROrSymbol === 'string') {
      symbol = minNetRROrSymbol;
    }

    const invalidResult: RiskRewardResult = {
      riskDistance: 0,
      rewardDistance: 0,
      grossRR: 0,
      netRR: 0,
      selectedGrossRR: 0,
      selectedNetRR: 0,
      primaryRR: 0,
      effectiveGrossRR: 0,
      tp1GrossRR: 0,
      tp2GrossRR: 0,
      tp3GrossRR: 0,
      tp1NetRR: 0,
      tp2NetRR: 0,
      tp3NetRR: 0,
      tp1RR: 0,
      tp2RR: 0,
      tp3RR: 0,
      passedGrossRR: false,
      passedNetRR: false,
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

    const rawTp1Reward = Math.abs(tp1 - entryPrice);
    const rawTp2Reward = Math.abs(tp2 - entryPrice);
    const rawTp3Reward = Math.abs(tp3 - entryPrice);

    // Calculate individual targets' Gross R:R
    const tp1GrossRR = Number((rawTp1Reward / riskDistance).toFixed(2));
    const tp2GrossRR = Number((rawTp2Reward / riskDistance).toFixed(2));
    const tp3GrossRR = Number((rawTp3Reward / riskDistance).toFixed(2));

    // Calculate individual targets' Net R:R using authoritative friction calculations
    const tp1NetRR = this.calculateFriction(symbol, entryPrice, rawTp1Reward, riskDistance).netRR;
    const tp2NetRR = this.calculateFriction(symbol, entryPrice, rawTp2Reward, riskDistance).netRR;
    const tp3NetRR = this.calculateFriction(symbol, entryPrice, rawTp3Reward, riskDistance).netRR;

    // Validate logical positioning and strict target ordering relative to direction
    const isOrdered = direction === 'BUY'
      ? (stopLoss < entryPrice && tp1 > entryPrice && tp2 > tp1 && tp3 > tp2)
      : (stopLoss > entryPrice && tp1 < entryPrice && tp2 < tp1 && tp3 < tp2);

    if (!isOrdered) {
      return {
        riskDistance: Number(riskDistance.toFixed(4)),
        rewardDistance: Number(Math.abs(tp2 - entryPrice).toFixed(4)),
        grossRR: tp2GrossRR,
        netRR: tp2NetRR,
        selectedGrossRR: tp2GrossRR,
        selectedNetRR: tp2NetRR,
        primaryRR: tp2GrossRR,
        effectiveGrossRR: tp2GrossRR,
        tp1GrossRR,
        tp2GrossRR,
        tp3GrossRR,
        tp1NetRR,
        tp2NetRR,
        tp3NetRR,
        tp1RR: tp1NetRR,
        tp2RR: tp2NetRR,
        tp3RR: tp3NetRR,
        passedGrossRR: false,
        passedNetRR: false,
        isValid: false,
        passedViaTp3: false,
        takeProfit: tp2,
        reason: `Invalid SL/TP placement or ordering relative to entry for direction ${direction}: SL=${stopLoss}, TP1=${tp1}, TP2=${tp2}, TP3=${tp3}`,
      };
    }

    // A candidate passes the Gross R:R gate when:
    // TP2 Gross R:R >= minRR (default 1.8)
    // OR
    // TP3 Gross R:R >= minRR (default 1.8)
    // TP1 is informational and must not independently qualify a trade.
    let passedViaTp3 = false;
    let selectedTakeProfit = tp2;
    let selectedGrossRR = tp2GrossRR;
    let selectedNetRR = tp2NetRR;
    let evaluatedRewardDistance = rawTp2Reward;

    if (tp2GrossRR >= minRR) {
      selectedTakeProfit = tp2;
      selectedGrossRR = tp2GrossRR;
      selectedNetRR = tp2NetRR;
      passedViaTp3 = false;
      evaluatedRewardDistance = rawTp2Reward;
    } else if (tp3GrossRR >= minRR) {
      selectedTakeProfit = tp3;
      selectedGrossRR = tp3GrossRR;
      selectedNetRR = tp3NetRR;
      passedViaTp3 = true;
      evaluatedRewardDistance = rawTp3Reward;
    } else {
      selectedTakeProfit = tp2;
      selectedGrossRR = tp2GrossRR;
      selectedNetRR = tp2NetRR;
      passedViaTp3 = false;
      evaluatedRewardDistance = rawTp2Reward;
    }

    const passedGrossRR = isOrdered && (tp2GrossRR >= minRR || tp3GrossRR >= minRR);
    const passedNetRR = isOrdered && (tp2NetRR >= minNet || tp3NetRR >= minNet);

    return {
      riskDistance: Number(riskDistance.toFixed(4)),
      rewardDistance: Number(evaluatedRewardDistance.toFixed(4)),
      grossRR: selectedGrossRR,
      netRR: selectedNetRR,
      selectedGrossRR,
      selectedNetRR,
      primaryRR: selectedGrossRR,
      effectiveGrossRR: selectedGrossRR,
      tp1GrossRR,
      tp2GrossRR,
      tp3GrossRR,
      tp1NetRR,
      tp2NetRR,
      tp3NetRR,
      tp1RR: tp1NetRR,
      tp2RR: tp2NetRR,
      tp3RR: tp3NetRR,
      passedGrossRR,
      passedNetRR,
      isValid: true,
      passedViaTp3,
      takeProfit: selectedTakeProfit,
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

