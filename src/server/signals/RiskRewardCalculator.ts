import { SignalDirection } from '../../types/index.js';

export interface RiskRewardResult {
  riskDistance: number;
  rewardDistance: number;
  grossRR: number;
  tp1RR: number;
  tp2RR: number;
  tp3RR: number;
  primaryRR: number;
  isValid: boolean;
  reason?: string;
}

export class RiskRewardCalculator {
  /**
   * Calculates gross R:R and individual target Rr ratios canonically.
   * Pure local calculation with zero API/provider requests.
   */
  public static calculate(
    entryPrice: number,
    stopLoss: number,
    tp1: number,
    tp2: number,
    tp3: number,
    direction: SignalDirection
  ): RiskRewardResult {
    const invalidResult: RiskRewardResult = {
      riskDistance: 0,
      rewardDistance: 0,
      grossRR: 0,
      tp1RR: 0,
      tp2RR: 0,
      tp3RR: 0,
      primaryRR: 0,
      isValid: false,
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

    let rewardDistance = 0;
    let tp1RR = 0;
    let tp2RR = 0;
    let tp3RR = 0;

    if (direction === 'BUY') {
      rewardDistance = Math.abs(tp2 - entryPrice);
      tp1RR = Number((Math.abs(tp1 - entryPrice) / riskDistance).toFixed(2));
      tp2RR = Number((Math.abs(tp2 - entryPrice) / riskDistance).toFixed(2));
      tp3RR = Number((Math.abs(tp3 - entryPrice) / riskDistance).toFixed(2));
    } else {
      rewardDistance = Math.abs(entryPrice - tp2);
      tp1RR = Number((Math.abs(entryPrice - tp1) / riskDistance).toFixed(2));
      tp2RR = Number((Math.abs(entryPrice - tp2) / riskDistance).toFixed(2));
      tp3RR = Number((Math.abs(entryPrice - tp3) / riskDistance).toFixed(2));
    }

    const grossRR = Number((rewardDistance / riskDistance).toFixed(2));
    const primaryRR = grossRR;

    // Validate logical positioning relative to direction
    const isValidPosition = direction === 'BUY'
      ? (stopLoss < entryPrice && tp1 > entryPrice && tp2 > entryPrice && tp3 > entryPrice)
      : (stopLoss > entryPrice && tp1 < entryPrice && tp2 < entryPrice && tp3 < entryPrice);

    if (!isValidPosition) {
      return {
        riskDistance: Number(riskDistance.toFixed(4)),
        rewardDistance: Number(rewardDistance.toFixed(4)),
        grossRR,
        tp1RR,
        tp2RR,
        tp3RR,
        primaryRR,
        isValid: false,
        reason: `Invalid SL/TP placement relative to entry for direction ${direction}`,
      };
    }

    return {
      riskDistance: Number(riskDistance.toFixed(4)),
      rewardDistance: Number(rewardDistance.toFixed(4)),
      grossRR,
      tp1RR,
      tp2RR,
      tp3RR,
      primaryRR,
      isValid: true,
    };
  }
}
