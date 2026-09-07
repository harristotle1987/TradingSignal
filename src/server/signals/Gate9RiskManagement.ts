import { SignalDirection } from '../../types/index.js';
import { RiskRewardCalculator, RiskRewardResult } from './RiskRewardCalculator.js';
import { serverConfig } from '../config.js';

export interface Gate9Result {
  entryPrice: number;
  sl: number;
  tp1: number;
  tp2: number;
  tp3: number;
  takeProfit: number;
  risk: number;
  reward: number;
  rrRatio: number;
  estimatedWinProbability: number;
  expectedValue: number;
  riskScore: number;
  reasons: string[];
  isValid?: boolean;
}

export class Gate9RiskManagement {
  public static calculate(
    currentPrice: number,
    direction: SignalDirection,
    stopLoss: number,
    tp1: number,
    tp2: number,
    tp3: number,
    riskRewardRatio?: number,
    providedRrResult?: RiskRewardResult
  ): Gate9Result {
    const reasons: string[] = [];
    const minimumRR = serverConfig.getConfig().thresholds.minimumRR;

    const rrResult = providedRrResult ?? RiskRewardCalculator.calculate(
      currentPrice,
      stopLoss,
      tp1,
      tp2,
      tp3,
      direction,
      minimumRR
    );

    const canonicalGrossRR = rrResult.grossRR;
    const rrPass =
      rrResult.selectedTarget !== null &&
      Number.isFinite(canonicalGrossRR) &&
      canonicalGrossRR >= minimumRR &&
      rrResult.isValid &&
      rrResult.riskDistance > 0;

    const risk = rrResult.riskDistance;
    const reward = rrResult.rewardDistance;
    const authoritativeTP = rrResult.selectedTarget === 'TP3' ? tp3 : tp2;

    if (!rrPass) {
      reasons.push(
        rrResult.reason ||
        `REJECTED: Canonical R:R ${canonicalGrossRR.toFixed(2)} is below minimum threshold ${minimumRR.toFixed(2)}:1 or target selection failed.`
      );
      return {
        entryPrice: currentPrice,
        sl: stopLoss,
        tp1,
        tp2,
        tp3,
        takeProfit: authoritativeTP,
        risk: risk > 0 ? risk : Math.abs(currentPrice - stopLoss),
        reward: 0,
        rrRatio: canonicalGrossRR,
        estimatedWinProbability: 0,
        expectedValue: 0,
        riskScore: 0,
        isValid: false,
        reasons,
      };
    }

    // Base estimated win probability on the canonical gross R:R to avoid drift
    let winProb = 0.45; // Base probability
    if (canonicalGrossRR > 2.5) winProb -= 0.05;
    else if (canonicalGrossRR <= minimumRR) winProb += 0.05;

    // Expected Value Calculation
    const expectedValue = (winProb * reward) - ((1 - winProb) * risk);

    // Risk Score based on authoritative canonical gross R:R
    let riskScore = 100;
    if (canonicalGrossRR < minimumRR) {
      riskScore -= 40;
      reasons.push(`Low Reward-to-Risk ratio: ${canonicalGrossRR.toFixed(2)} below minimum ${minimumRR.toFixed(2)}:1`);
    }
    if (expectedValue < 0) {
      riskScore -= 50;
      reasons.push('Negative Expected Value. Trade is statistically unfavorable.');
    }

    return {
      entryPrice: currentPrice,
      sl: stopLoss,
      tp1,
      tp2,
      tp3,
      takeProfit: authoritativeTP,
      risk,
      reward,
      rrRatio: canonicalGrossRR,
      estimatedWinProbability: winProb,
      expectedValue,
      riskScore,
      isValid: true,
      reasons,
    };
  }
}

