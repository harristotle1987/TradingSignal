import { SignalDirection } from '../../types/index.js';
import { RiskRewardCalculator } from './RiskRewardCalculator.js';

export interface TargetQualityInput {
  direction: SignalDirection;
  entryPrice: number;
  stopLoss: number;
  tp1: number;
  tp2: number;
  tp3: number;
  atr: number;
  marketRegime?: string;
  hasStructureClearance?: boolean;
}

export interface TargetQualityResult {
  targetQualityScore: number;
  tp1Rr: number;
  tp2Rr: number;
  tp3Rr: number;
  breakdown: {
    rrQuality: number;
    atrSuitability: number;
    tpSpacingQuality: number;
    structureClearance: number;
    volatilityFit: number;
  };
}

/**
 * Calculates exact R:R using RiskRewardCalculator canonical module.
 */
export function calculateTargetRr(
  direction: SignalDirection,
  entryPrice: number,
  stopLoss: number,
  targetPrice: number
): number {
  if (!entryPrice || !stopLoss || !targetPrice) return 0;
  const riskDistance = Math.abs(entryPrice - stopLoss);
  if (riskDistance <= 0) return 0;
  const rewardDistance = Math.abs(targetPrice - entryPrice);
  return Number((rewardDistance / riskDistance).toFixed(2));
}

export class TargetQualityEvaluator {
  public static evaluate(input: TargetQualityInput): TargetQualityResult {
    const {
      direction,
      entryPrice,
      stopLoss,
      tp1,
      tp2,
      tp3,
      atr,
      marketRegime = 'NORMAL',
      hasStructureClearance = true,
    } = input;

    // 1. Calculate Exact R:R Ratios for each target using RiskRewardCalculator
    const rrResult = RiskRewardCalculator.calculate(entryPrice, stopLoss, tp1, tp2, tp3, direction);
    const tp1Rr = rrResult.tp1RR;
    const tp2Rr = rrResult.tp2RR;
    const tp3Rr = rrResult.tp3RR;

    // Factor 1: R Quality (Max 25 Pts)
    // Benchmark: TP1 >= 1.0R (8 pts), TP2 >= 1.5R (8 pts), TP3 >= 2.2R (9 pts)
    let rrQuality = 0;
    if (tp1Rr >= 1.0) rrQuality += 8;
    else rrQuality += Math.max(0, (tp1Rr / 1.0) * 8);

    if (tp2Rr >= 1.5) rrQuality += 8;
    else rrQuality += Math.max(0, (tp2Rr / 1.5) * 8);

    if (tp3Rr >= 2.2) rrQuality += 9;
    else rrQuality += Math.max(0, (tp3Rr / 2.2) * 9);

    rrQuality = Math.min(25, Math.round(rrQuality));

    // Factor 2: ATR Suitability (Max 25 Pts)
    // Check if TP distances are well proportional to ATR
    const cleanAtr = atr > 0 ? atr : entryPrice * 0.01;
    const tp1Dist = Math.abs(tp1 - entryPrice);
    const tp2Dist = Math.abs(tp2 - entryPrice);
    const tp3Dist = Math.abs(tp3 - entryPrice);

    let atrSuitability = 25;
    const m1 = tp1Dist / cleanAtr;
    const m2 = tp2Dist / cleanAtr;
    const m3 = tp3Dist / cleanAtr;

    // Ideal bounds: m1 in [0.8, 1.5], m2 in [1.5, 2.5], m3 in [2.2, 3.5]
    if (m1 < 0.5 || m1 > 2.5) atrSuitability -= 7;
    if (m2 < 1.0 || m2 > 3.5) atrSuitability -= 9;
    if (m3 < 1.5 || m3 > 4.5) atrSuitability -= 9;
    atrSuitability = Math.max(0, Math.min(25, atrSuitability));

    // Factor 3: TP Spacing & Progression Quality (Max 20 Pts)
    let tpSpacingQuality = 0;
    const isBuy = direction === 'BUY';
    const isOrdered = isBuy
      ? entryPrice < tp1 && tp1 < tp2 && tp2 < tp3
      : entryPrice > tp1 && tp1 > tp2 && tp2 > tp3;

    if (isOrdered) {
      tpSpacingQuality += 10;
      const step1 = Math.abs(tp2 - tp1);
      const step2 = Math.abs(tp3 - tp2);
      if (step1 > 0 && step2 > 0) {
        tpSpacingQuality += 10; // Clean non-zero spacing progression
      }
    }

    // Factor 4: Market Structure Clearance (Max 15 Pts)
    const structureClearance = hasStructureClearance ? 15 : 5;

    // Factor 5: Volatility & Regime Fit (Max 15 Pts)
    let volatilityFit = 12;
    const upperRegime = marketRegime.toUpperCase();
    if (upperRegime.includes('TRENDING') || upperRegime.includes('VOLATILE')) {
      volatilityFit = 15;
    } else if (upperRegime.includes('COMPRESSED') || upperRegime.includes('RANGE')) {
      volatilityFit = 10;
    }

    // Total Target Quality Score (0–100 integer)
    const targetQualityScore = Math.min(
      100,
      Math.max(0, Math.round(rrQuality + atrSuitability + tpSpacingQuality + structureClearance + volatilityFit))
    );

    return {
      targetQualityScore,
      tp1Rr,
      tp2Rr,
      tp3Rr,
      breakdown: {
        rrQuality,
        atrSuitability,
        tpSpacingQuality,
        structureClearance,
        volatilityFit,
      },
    };
  }
}

