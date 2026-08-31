import { SignalDirection } from '../../types/index.js';
import { RiskRewardCalculator } from './RiskRewardCalculator.js';

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
}

export class Gate9RiskManagement {
  public static calculate(
    currentPrice: number,
    direction: SignalDirection,
    stopLoss: number,
    tp1: number,
    tp2: number,
    tp3: number,
    riskRewardRatio: number
  ): Gate9Result {
    const reasons: string[] = [];

    const rrResult = RiskRewardCalculator.calculate(currentPrice, stopLoss, tp1, tp2, tp3, direction);
    const risk = rrResult.riskDistance;
    const reward = rrResult.rewardDistance;

    if (!rrResult.isValid || risk <= 0) {
      reasons.push(rrResult.reason || 'INVALID: stop-loss is on the wrong side of entry price');
      return {
        entryPrice: currentPrice,
        sl: stopLoss,
        tp1,
        tp2,
        tp3,
        takeProfit: tp2,
        risk: Math.abs(currentPrice - stopLoss),
        reward: 0,
        rrRatio: riskRewardRatio,
        estimatedWinProbability: 0,
        expectedValue: 0,
        riskScore: 0,
        reasons
      };
    }

    // Base estimated win probability on the passed-in riskRewardRatio to avoid re-derivation drift
    let winProb = 0.45; // Base probability
    if (riskRewardRatio > 2) winProb -= 0.05;
    if (riskRewardRatio < 1.5) winProb += 0.05;

    // Expected Value Calculation
    const expectedValue = (winProb * reward) - ((1 - winProb) * risk);

    // Risk Score based on authoritative passed-in riskRewardRatio
    let riskScore = 100;
    if (riskRewardRatio < 1.2) {
      riskScore -= 40;
      reasons.push(`Low Reward-to-Risk ratio: ${riskRewardRatio.toFixed(2)}`);
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
      takeProfit: rrResult.passedViaTp3 ? tp3 : tp2,
      risk,
      reward,
      rrRatio: riskRewardRatio,
      estimatedWinProbability: winProb,
      expectedValue,
      riskScore,
      reasons
    };
  }
}

