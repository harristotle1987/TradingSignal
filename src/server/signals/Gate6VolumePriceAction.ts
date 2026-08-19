import { NormalizedCandle, SignalDirection } from '../../types/index.js';
import { TechnicalIndicators } from './TechnicalIndicators.js';

export interface Gate6Result {
  volumeConfirmation: string;
  vwapDirection: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  priceActionConfirmation: string;
  volumeScore: number;
  confirmationScore: number;
  score: number;
  reasons: string[];
}

export class Gate6VolumePriceAction {
  public static analyze(
    proposedDirection: SignalDirection,
    candles: NormalizedCandle[]
  ): Gate6Result {
    const reasons: string[] = [];
    
    if (!candles || candles.length < 20) {
       return {
          volumeConfirmation: 'INSUFFICIENT_DATA',
          vwapDirection: 'NEUTRAL',
          priceActionConfirmation: 'INSUFFICIENT_DATA',
          volumeScore: 50,
          confirmationScore: 50,
          score: 50,
          reasons: ['Insufficient candles for volume/price action analysis.']
       };
    }

    const lastCandle = candles[candles.length - 1];
    const prevCandle = candles[candles.length - 2];
    
    // 1. VWAP Calculation
    const vwapSeries = TechnicalIndicators.calculateVWAP(candles);
    const currentVwap = vwapSeries[vwapSeries.length - 1];
    let vwapDirection: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
    if (lastCandle.close > currentVwap) vwapDirection = 'BULLISH';
    else if (lastCandle.close < currentVwap) vwapDirection = 'BEARISH';

    // 2. Volume Analysis
    let volumeScore = 50;
    const recentVolume = lastCandle.volume;
    
    // Calculate 20-period average volume
    const volSlice = candles.slice(-20);
    const avgVolume = volSlice.reduce((sum, c) => sum + c.volume, 0) / volSlice.length;
    const relVolume = avgVolume > 0 ? recentVolume / avgVolume : 1;

    let volumeConfirmation = 'NEUTRAL';
    if (relVolume > 1.5) {
       volumeConfirmation = 'HIGH_VOLUME_EXPANSION';
       volumeScore += 20;
       reasons.push(`Strong volume expansion detected (${relVolume.toFixed(1)}x average).`);
    } else if (relVolume > 1.1) {
       volumeConfirmation = 'MODERATE_EXPANSION';
       volumeScore += 10;
    } else if (relVolume < 0.7) {
       volumeConfirmation = 'LOW_VOLUME_CONTRACTION';
       volumeScore -= 20;
       reasons.push(`Low volume participation (${relVolume.toFixed(1)}x average). Breakouts may lack conviction.`);
    }

    // OBV (On-Balance Volume) trend over last 5 candles
    const obvSeries = TechnicalIndicators.calculateOBV(candles);
    const currentObv = obvSeries[obvSeries.length - 1];
    const prevObv = obvSeries[obvSeries.length - 5];
    const obvTrendingUp = currentObv > prevObv;

    if (proposedDirection === 'BUY' && obvTrendingUp) {
       volumeScore += 15;
       reasons.push('OBV trend supports bullish momentum.');
    } else if (proposedDirection === 'SELL' && !obvTrendingUp) {
       volumeScore += 15;
       reasons.push('OBV trend supports bearish momentum.');
    } else {
       volumeScore -= 10;
       reasons.push('OBV trend conflicts with proposed direction.');
    }

    // 3. Price Action Confirmation
    let confirmationScore = 50;
    let priceActionConfirmation = 'NEUTRAL';
    
    // Calculate body vs range
    const range = lastCandle.high - lastCandle.low;
    const body = Math.abs(lastCandle.close - lastCandle.open);
    const bodyRatio = range > 0 ? body / range : 0;
    
    const isBullishCandle = lastCandle.close > lastCandle.open;
    const isBearishCandle = lastCandle.close < lastCandle.open;
    const isEngulfingBullish = isBullishCandle && lastCandle.close > prevCandle.high && lastCandle.open < prevCandle.low;
    const isEngulfingBearish = isBearishCandle && lastCandle.close < prevCandle.low && lastCandle.open > prevCandle.high;
    
    // Wick Rejection Analysis
    const bodyTop = Math.max(lastCandle.open, lastCandle.close);
    const bodyBottom = Math.min(lastCandle.open, lastCandle.close);
    const upperWick = lastCandle.high - bodyTop;
    const lowerWick = bodyBottom - lastCandle.low;
    const upperWickRatio = range > 0 ? upperWick / range : 0;
    const lowerWickRatio = range > 0 ? lowerWick / range : 0;

    if (proposedDirection === 'BUY') {
       if (vwapDirection === 'BEARISH') {
          confirmationScore -= 20;
          reasons.push('Price is below VWAP, resisting bullish context.');
       } else {
          confirmationScore += 15;
       }

       if (isEngulfingBullish) {
          priceActionConfirmation = 'BULLISH_ENGULFING';
          confirmationScore += 25;
          reasons.push('Bullish engulfing candle detected.');
       } else if (lowerWickRatio > 0.5) {
          priceActionConfirmation = 'STRONG_LOWER_WICK_REJECTION';
          confirmationScore += 20;
          reasons.push('Strong lower wick rejection implies buying pressure.');
       } else if (isBullishCandle && bodyRatio > 0.7) {
          priceActionConfirmation = 'STRONG_BULLISH_MOMENTUM_CANDLE';
          confirmationScore += 15;
       } else if (upperWickRatio > 0.5) {
          confirmationScore -= 20;
          reasons.push('Long upper wick implies rejection of higher prices (bearish structure).');
       }
    } else { // SELL
       if (vwapDirection === 'BULLISH') {
          confirmationScore -= 20;
          reasons.push('Price is above VWAP, resisting bearish context.');
       } else {
          confirmationScore += 15;
       }

       if (isEngulfingBearish) {
          priceActionConfirmation = 'BEARISH_ENGULFING';
          confirmationScore += 25;
          reasons.push('Bearish engulfing candle detected.');
       } else if (upperWickRatio > 0.5) {
          priceActionConfirmation = 'STRONG_UPPER_WICK_REJECTION';
          confirmationScore += 20;
          reasons.push('Strong upper wick rejection implies selling pressure.');
       } else if (isBearishCandle && bodyRatio > 0.7) {
          priceActionConfirmation = 'STRONG_BEARISH_MOMENTUM_CANDLE';
          confirmationScore += 15;
       } else if (lowerWickRatio > 0.5) {
          confirmationScore -= 20;
          reasons.push('Long lower wick implies rejection of lower prices (bullish structure).');
       }
    }

    // Ensure breakout participation penalty
    // Breakout definition: A strong move beyond recent extremes (for simplicity, we'll proxy breakout via high relative volume + momentum candle)
    if (bodyRatio > 0.6 && relVolume < 0.8) {
       confirmationScore -= 25;
       reasons.push('Failed breakout signature: Directional body expansion without volume participation.');
    }

    volumeScore = Math.max(0, Math.min(100, volumeScore));
    confirmationScore = Math.max(0, Math.min(100, confirmationScore));
    
    // Overall gate score
    const score = Math.round((volumeScore * 0.5) + (confirmationScore * 0.5));

    return {
       volumeConfirmation,
       vwapDirection,
       priceActionConfirmation,
       volumeScore,
       confirmationScore,
       score,
       reasons
    };
  }
}
