import { NormalizedCandle, SignalDirection } from '../../types/index.js';
import { TechnicalIndicators } from './TechnicalIndicators.js';

export interface Gate4MomentumVolatilityResult {
  momentumDirection: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  momentumStrength: 'STRONG' | 'MODERATE' | 'WEAK';
  volatilityState: 'EXPANDING' | 'CONTRACTING' | 'NORMAL' | 'ERRATIC' | 'DEAD';
  overextensionStatus: 'OVERBOUGHT' | 'OVERSOLD' | 'NORMAL';
  atrContext: string;
  momentumScore: number;
  volatilityScore: number;
  score: number;
  reasons: string[];
}

export class Gate4MomentumVolatility {
  public static analyze(
    proposedDirection: SignalDirection,
    candles: NormalizedCandle[]
  ): Gate4MomentumVolatilityResult {
    const reasons: string[] = [];
    
    if (!candles || candles.length < 50) {
      return {
        momentumDirection: 'NEUTRAL',
        momentumStrength: 'WEAK',
        volatilityState: 'NORMAL',
        overextensionStatus: 'NORMAL',
        atrContext: 'Insufficient data',
        momentumScore: 50,
        volatilityScore: 50,
        score: 50,
        reasons: ['Insufficient candles for momentum and volatility calculation.']
      };
    }

    // -- CALCULATION --
    
    // 1. RSI
    const rsiValues = TechnicalIndicators.calculateRSI(candles, 14);
    const rsi = rsiValues[rsiValues.length - 1];
    const prevRsi = rsiValues[rsiValues.length - 2];
    
    // 2. MACD
    const macdResult = TechnicalIndicators.calculateMACD(candles);
    const macdHist = macdResult?.histogram || 0;
    
    const prevMacdResult = TechnicalIndicators.calculateMACD(candles.slice(0, -1));
    const prevMacdHist = prevMacdResult?.histogram || 0;
    
    // 3. ADX & DMI
    const adxResult = TechnicalIndicators.calculateADX(candles, 14);
    const adx = adxResult?.adx || 0;
    const pdi = adxResult?.pdi || 0;
    const mdi = adxResult?.mdi || 0;
    
    // 4. Volatility (ATR, Bollinger Bands)
    const volMetrics = TechnicalIndicators.calculateVolatilityMetrics(candles);
    const currentBB = TechnicalIndicators.calculateBollingerBands(candles, 20, 2);
    const currentPrice = candles[candles.length - 1].close;
    
    // BB Width and Position
    const bbWidth = currentBB ? currentBB.upper - currentBB.lower : 0;
    
    const prevBB = TechnicalIndicators.calculateBollingerBands(candles.slice(0, -1), 20, 2);
    const prevBBWidth = prevBB ? prevBB.upper - prevBB.lower : 0;
    
    // -- EVALUATION --
    
    // Momentum Direction & Strength
    let momentumDirection: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
    let momentumStrength: 'STRONG' | 'MODERATE' | 'WEAK' = 'WEAK';
    let momentumScore = 50;

    if (pdi > mdi && macdHist > 0 && rsi > 50) {
      momentumDirection = 'BULLISH';
      momentumStrength = (adx > 25 && macdHist > prevMacdHist) ? 'STRONG' : 'MODERATE';
    } else if (mdi > pdi && macdHist < 0 && rsi < 50) {
      momentumDirection = 'BEARISH';
      momentumStrength = (adx > 25 && macdHist < prevMacdHist) ? 'STRONG' : 'MODERATE';
    }

    // Momentum scoring aligned with proposed direction
    if (proposedDirection === 'BUY') {
      if (momentumDirection === 'BULLISH') {
        momentumScore = 70 + (momentumStrength === 'STRONG' ? 20 : 10);
      } else if (momentumDirection === 'BEARISH') {
        momentumScore = 30 - (momentumStrength === 'STRONG' ? 20 : 10);
        reasons.push('Momentum is Bearish, conflicting with BUY.');
      }
    } else { // SELL
      if (momentumDirection === 'BEARISH') {
        momentumScore = 70 + (momentumStrength === 'STRONG' ? 20 : 10);
      } else if (momentumDirection === 'BULLISH') {
        momentumScore = 30 - (momentumStrength === 'STRONG' ? 20 : 10);
        reasons.push('Momentum is Bullish, conflicting with SELL.');
      }
    }

    // Momentum Deceleration Check
    if (momentumDirection === 'BULLISH' && macdHist < prevMacdHist && rsi < prevRsi) {
      reasons.push('Bullish momentum is decelerating.');
      if (proposedDirection === 'BUY') momentumScore -= 15;
    } else if (momentumDirection === 'BEARISH' && macdHist > prevMacdHist && rsi > prevRsi) {
      reasons.push('Bearish momentum is decelerating.');
      if (proposedDirection === 'SELL') momentumScore -= 15;
    }

    // Overextension check
    let overextensionStatus: 'OVERBOUGHT' | 'OVERSOLD' | 'NORMAL' = 'NORMAL';
    if (currentBB && rsi > 75 && currentPrice >= currentBB.upper && macdHist < prevMacdHist) {
      overextensionStatus = 'OVERBOUGHT';
      if (proposedDirection === 'BUY') {
         momentumScore -= 30;
         reasons.push('Market appears overbought (RSI > 75, hitting Upper BB, momentum decelerating).');
      }
    } else if (currentBB && rsi < 25 && currentPrice <= currentBB.lower && macdHist > prevMacdHist) {
      overextensionStatus = 'OVERSOLD';
      if (proposedDirection === 'SELL') {
         momentumScore -= 30;
         reasons.push('Market appears oversold (RSI < 25, hitting Lower BB, momentum decelerating).');
      }
    }

    // Volatility State
    let volatilityState: 'EXPANDING' | 'CONTRACTING' | 'NORMAL' | 'ERRATIC' | 'DEAD' = 'NORMAL';
    let volatilityScore = 50;

    if (volMetrics.isDeadMarket || volMetrics.currentAtr === 0) {
      volatilityState = 'DEAD';
      volatilityScore = 10;
      reasons.push('Market is dead or has insufficient volatility to trade.');
    } else if (volMetrics.isErratic) {
      volatilityState = 'ERRATIC';
      volatilityScore = 30;
      reasons.push('Volatility is erratic or dangerously high, increasing risk of sudden drawdowns.');
    } else if (bbWidth > prevBBWidth * 1.1) {
      volatilityState = 'EXPANDING';
      volatilityScore = 90;
      reasons.push('Volatility is expanding, providing good conditions for breakouts and trend continuation.');
    } else if (bbWidth < prevBBWidth * 0.9) {
      volatilityState = 'CONTRACTING';
      volatilityScore = 60; // Squeeze can be good or bad depending on strategy
    } else {
      volatilityState = 'NORMAL';
      volatilityScore = 80;
    }

    // ATR Context Formatting
    const atrContext = `Current ATR: ${volMetrics.currentAtr.toFixed(4)} (Ratio to baseline: ${volMetrics.atrRatio.toFixed(2)})`;

    // Ensure scores are bounded
    momentumScore = Math.max(0, Math.min(100, momentumScore));
    volatilityScore = Math.max(0, Math.min(100, volatilityScore));

    // Blended Gate Score
    // We weigh momentum heavily since we need to confirm direction, but volatility is a strong filter.
    const score = Math.round((momentumScore * 0.6) + (volatilityScore * 0.4));

    return {
      momentumDirection,
      momentumStrength,
      volatilityState,
      overextensionStatus,
      atrContext,
      momentumScore,
      volatilityScore,
      score,
      reasons
    };
  }
}
