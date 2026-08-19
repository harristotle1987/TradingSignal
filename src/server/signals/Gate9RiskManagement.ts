import { NormalizedCandle, SignalDirection } from '../../types/index.js';
import { TechnicalIndicators } from './TechnicalIndicators.js';
import { Gate5SupportResistance, PriceZone } from './Gate5Liquidity.js';

export interface Gate9Result {
  entryPrice: number;
  sl: number;
  tp1: number;
  tp2: number;
  tp3: number;
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
    candles: NormalizedCandle[]
  ): Gate9Result {
    const reasons: string[] = [];
    const lastCandle = candles[candles.length - 1];
    
    // 1. Calculate Volatility (ATR)
    const atr = TechnicalIndicators.calculateATR(candles, 14);
    
    // 2. Identify Structure for SL/TP
    const sr = Gate5SupportResistance.analyze(direction, candles);
    
    // Initial SL based on ATR + Structure
    let sl = direction === 'BUY' ? lastCandle.low - (atr * 1.5) : lastCandle.high + (atr * 1.5);
    
    // Refine SL based on Support/Resistance zones
    if (direction === 'BUY' && sr.nearestSupport) {
      sl = Math.min(sl, sr.nearestSupport.bottom - (atr * 0.5));
    } else if (direction === 'SELL' && sr.nearestResistance) {
      sl = Math.max(sl, sr.nearestResistance.top + (atr * 0.5));
    }
    
    // TP calculations
    const risk = Math.abs(currentPrice - sl);
    const tp1 = direction === 'BUY' ? currentPrice + (risk * 1.5) : currentPrice - (risk * 1.5);
    const tp2 = direction === 'BUY' ? currentPrice + (risk * 2.5) : currentPrice - (risk * 2.5);
    const tp3 = direction === 'BUY' ? currentPrice + (risk * 4.0) : currentPrice - (risk * 4.0);
    const reward = Math.abs(tp1 - currentPrice);
    const rrRatio = risk > 0 ? reward / risk : 0;
    
    // Estimated Win Probability (simplified logic based on confluence score and RR)
    // In real system, this would be derived from historical strategy performance
    let winProb = 0.45; // Base probability
    if (rrRatio > 2) winProb -= 0.05;
    if (rrRatio < 1.5) winProb += 0.05;
    
    // Expected Value Calculation
    const expectedValue = (winProb * reward) - ((1 - winProb) * risk);
    
    // Risk Score
    let riskScore = 100;
    if (rrRatio < 1.2) {
      riskScore -= 40;
      reasons.push(`Low Reward-to-Risk ratio: ${rrRatio.toFixed(2)}`);
    }
    if (expectedValue < 0) {
      riskScore -= 50;
      reasons.push('Negative Expected Value. Trade is statistically unfavorable.');
    }
    
    return {
      entryPrice: currentPrice,
      sl,
      tp1,
      tp2,
      tp3,
      risk,
      reward,
      rrRatio,
      estimatedWinProbability: winProb,
      expectedValue,
      riskScore,
      reasons
    };
  }
}
