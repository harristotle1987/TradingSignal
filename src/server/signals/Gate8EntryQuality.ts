import { NormalizedCandle, SignalDirection } from '../../types/index.js';
import { TechnicalIndicators } from './TechnicalIndicators.js';

export type EntryQualityClassification = 
  | 'OPTIMAL_ENTRY' 
  | 'ACCEPTABLE_ENTRY' 
  | 'LATE_ENTRY' 
  | 'OVEREXTENDED' 
  | 'WAIT_FOR_PULLBACK';

export interface Gate8Result {
  entryPrice: number;
  idealEntryZone: { min: number; max: number };
  entryQuality: EntryQualityClassification;
  chaseRisk: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';
  entryScore: number;
  reasons: string[];
}

export class Gate8EntryQuality {
  public static analyze(
    currentPrice: number,
    direction: SignalDirection,
    candles: NormalizedCandle[]
  ): Gate8Result {
    const reasons: string[] = [];
    
    if (!candles || candles.length < 20) {
       return {
         entryPrice: currentPrice,
         idealEntryZone: { min: currentPrice, max: currentPrice },
         entryQuality: 'ACCEPTABLE_ENTRY',
         chaseRisk: 'MEDIUM',
         entryScore: 50,
         reasons: ['Insufficient data for entry quality check.']
       };
    }

    const lastCandle = candles[candles.length - 1];
    const atrSeries = TechnicalIndicators.calculateATR(candles, 14);
    const currentAtr = atrSeries; // ATR function returns number, not number[]
    
    const ema9 = TechnicalIndicators.calculateEMA(candles, 9);
    const currentEma = ema9.length > 0 ? ema9[ema9.length - 1] : lastCandle.close;
    
    const lastCandleBody = Math.abs(lastCandle.close - lastCandle.open);
    
    // recentExpansion helps identify if the absolute latest candle was a massive structural break (chasing a green candle)
    const recentExpansion = lastCandleBody / currentAtr;

    // Ideal entry zone proxy: tightly around the short-term mean (EMA 9)
    const idealEntryZone = {
       min: currentEma - (currentAtr * 0.2),
       max: currentEma + (currentAtr * 0.2)
    };

    let distanceToIdeal = 0;
    let entryQuality: EntryQualityClassification = 'OPTIMAL_ENTRY';
    let chaseRisk: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME' = 'LOW';
    let entryScore = 100;

    if (direction === 'BUY') {
       distanceToIdeal = currentPrice - currentEma; // Positive means price is above ideal entry
       
       // Gate 8: Entry Flexibility - Relax overly strict entry thresholds.
       // Only truly overextended entries (> 2.0 ATR or extreme chase) are classified as OVEREXTENDED.
       if (distanceToIdeal > currentAtr * 2.2 || (distanceToIdeal > currentAtr * 1.6 && recentExpansion > 2.0)) {
          entryQuality = 'OVEREXTENDED';
          chaseRisk = 'EXTREME';
          entryScore = 20;
          reasons.push(`Price is severely overextended (${(distanceToIdeal/currentAtr).toFixed(1)} ATRs above mean). Do not chase.`);
       } else if (distanceToIdeal > currentAtr * 1.2 || recentExpansion > 1.6) {
          entryQuality = 'WAIT_FOR_PULLBACK';
          chaseRisk = 'HIGH';
          entryScore = 50;
          reasons.push('Price has expanded. Slightly extended entry; wait for minor pullback or enter with managed risk.');
       } else if (distanceToIdeal > currentAtr * 0.5) {
          entryQuality = 'LATE_ENTRY';
          chaseRisk = 'MEDIUM';
          entryScore = 70;
          reasons.push('Acceptable entry, slightly above baseline EMA. Favorable momentum continuation.');
       } else if (distanceToIdeal >= -(currentAtr * 0.6) && distanceToIdeal <= currentAtr * 0.5) {
          entryQuality = 'OPTIMAL_ENTRY';
          chaseRisk = 'LOW';
          entryScore = 95;
          reasons.push('Optimal entry near baseline support/mean. Favorable risk-to-reward.');
       } else {
          // Deep pullback - value buy near support
          entryQuality = 'ACCEPTABLE_ENTRY';
          chaseRisk = 'LOW';
          entryScore = 80;
          reasons.push('Deep pullback entry. Ensure broader trend and S/R logic remains valid.');
       }
    } else { // SELL
       distanceToIdeal = currentEma - currentPrice; // Positive means price is below ideal entry
       
       if (distanceToIdeal > currentAtr * 2.2 || (distanceToIdeal > currentAtr * 1.6 && recentExpansion > 2.0)) {
          entryQuality = 'OVEREXTENDED';
          chaseRisk = 'EXTREME';
          entryScore = 20;
          reasons.push(`Price is severely overextended downwards (${(distanceToIdeal/currentAtr).toFixed(1)} ATRs below mean). Do not chase short.`);
       } else if (distanceToIdeal > currentAtr * 1.2 || recentExpansion > 1.6) {
          entryQuality = 'WAIT_FOR_PULLBACK';
          chaseRisk = 'HIGH';
          entryScore = 50;
          reasons.push('Price has dropped rapidly. Extended short entry; wait for minor bear flag/retest or enter with managed size.');
       } else if (distanceToIdeal > currentAtr * 0.5) {
          entryQuality = 'LATE_ENTRY';
          chaseRisk = 'MEDIUM';
          entryScore = 70;
          reasons.push('Acceptable short entry, slightly below baseline EMA. Momentum continuation.');
       } else if (distanceToIdeal >= -(currentAtr * 0.6) && distanceToIdeal <= currentAtr * 0.5) {
          entryQuality = 'OPTIMAL_ENTRY';
          chaseRisk = 'LOW';
          entryScore = 95;
          reasons.push('Optimal short entry near baseline resistance/mean. Favorable risk-to-reward.');
       } else {
          entryQuality = 'ACCEPTABLE_ENTRY';
          chaseRisk = 'LOW';
          entryScore = 80;
          reasons.push('Deep bounce short entry. Ensure broader downtrend remains valid.');
       }
    }

    // Spread/Slippage Penalty Check
    // If the overall volatility is extremely tight, the spread might destroy the risk/reward
    const averageCandleRange = (lastCandle.high - lastCandle.low) / currentAtr;
    if (averageCandleRange < 0.2) {
       entryScore -= 15;
       reasons.push('Tight immediate price action detected; higher risk of slippage or spread friction.');
    }

    entryScore = Math.max(0, Math.min(100, entryScore));

    return {
       entryPrice: currentPrice,
       idealEntryZone,
       entryQuality,
       chaseRisk,
       entryScore,
       reasons
    };
  }
}
