import { NormalizedCandle } from '../../types/index.js';
import { TechnicalIndicators } from './TechnicalIndicators.js';
import { logger } from '../logger.js';

export type Gate1Regime =
  | 'STRONG_BULL_TREND'
  | 'WEAK_BULL_TREND'
  | 'STRONG_BEAR_TREND'
  | 'WEAK_BEAR_TREND'
  | 'RANGE'
  | 'BREAKOUT'
  | 'HIGH_VOLATILITY'
  | 'LOW_VOLATILITY'
  | 'TRANSITION'
  | 'UNKNOWN';

export interface Gate1RegimeResult {
  regime: Gate1Regime;
  confidence: number;
  factors: string[];
  invalidation: string[];
}

export class Gate1MarketRegime {
  /**
   * Detect the current market regime based on multiple timeframes and factors.
   */
  public static detectRegime(
    symbol: string,
    timeframes: Record<string, NormalizedCandle[]>
  ): Gate1RegimeResult {
    const factors: string[] = [];
    const invalidation: string[] = [];

    // Use 1H or highest available as baseline, fallback to 15m/5m if 1H missing
    const tfKeys = Object.keys(timeframes);
    let primaryTf = '1h';
    if (!timeframes['1h'] || timeframes['1h'].length < 50) {
       if (timeframes['4h'] && timeframes['4h'].length >= 50) primaryTf = '4h';
       else if (timeframes['30m'] && timeframes['30m'].length >= 50) primaryTf = '30m';
       else if (timeframes['15m'] && timeframes['15m'].length >= 50) primaryTf = '15m';
       else if (timeframes['5m'] && timeframes['5m'].length >= 50) primaryTf = '5m';
       else {
         return {
           regime: 'UNKNOWN',
           confidence: 0,
           factors: ['Insufficient candle data for robust regime detection'],
           invalidation: ['Need at least 50 candles on a stable timeframe']
         };
       }
    }

    const candles = timeframes[primaryTf];
    if (!candles || candles.length < 50) {
      return {
        regime: 'UNKNOWN',
        confidence: 0,
        factors: ['Insufficient candles for calculation'],
        invalidation: []
      };
    }

    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const opens = candles.map(c => c.open);
    const volumes = candles.map(c => c.volume || 0);

    const latestClose = closes[closes.length - 1];

    // Calculate indicators
    const ema20 = TechnicalIndicators.calculateEMA(candles, 20);
    const ema50 = TechnicalIndicators.calculateEMA(candles, 50);
    const ema200 = TechnicalIndicators.calculateEMA(candles, 200);
    const adxResult = TechnicalIndicators.calculateADX(candles, 14);
    
    // We need historical BB values to see expansion/contraction
    // The existing calculateBollingerBands returns only the latest value.
    // So we'll calculate it historically manually for the last 20 candles
    const bbHistory: { upper: number, middle: number, lower: number }[] = [];
    for (let i = candles.length - 20; i <= candles.length; i++) {
       const slice = candles.slice(0, i);
       if (slice.length >= 20) {
          const res = TechnicalIndicators.calculateBollingerBands(slice, 20, 2);
          if (res) bbHistory.push(res);
       }
    }
    
    // We need historical ATR too, but calculateATR only returns the latest.
    const atrHistory: number[] = [];
    for (let i = candles.length - 20; i <= candles.length; i++) {
       const slice = candles.slice(0, i);
       if (slice.length >= 14) {
          const res = TechnicalIndicators.calculateATR(slice, 14);
          atrHistory.push(res);
       }
    }

    if (!adxResult || bbHistory.length === 0 || atrHistory.length === 0) {
       return { regime: 'UNKNOWN', confidence: 0, factors: ['Failed to compute required indicators'], invalidation: [] };
    }

    const currentEma20 = ema20[ema20.length - 1];
    const currentEma50 = ema50[ema50.length - 1];
    const currentEma200 = ema200[ema200.length - 1] || currentEma50; // Fallback if <200 candles

    const currentAdx = adxResult.adx;
    const currentPdi = adxResult.pdi;
    const currentMdi = adxResult.mdi;

    const currentBb = bbHistory[bbHistory.length - 1];
    const bbWidth = (currentBb.upper - currentBb.lower) / currentBb.middle;

    // Check BB width relative to historical
    const historicalBbWidths = bbHistory.map(b => (b.upper - b.lower) / b.middle);
    const avgBbWidth = historicalBbWidths.reduce((a, b) => a + b, 0) / historicalBbWidths.length;
    
    // Check ATR expansion
    const currentAtr = atrHistory[atrHistory.length - 1];
    const atrPct = currentAtr / latestClose;
    const historicalAtr = atrHistory.reduce((a, b) => a + b, 0) / atrHistory.length;

    // Structure basics
    const recentHighs = Math.max(...highs.slice(-10));
    const recentLows = Math.min(...lows.slice(-10));
    const prevHighs = Math.max(...highs.slice(-20, -10));
    const prevLows = Math.min(...lows.slice(-20, -10));

    const higherHighs = recentHighs > prevHighs;
    const higherLows = recentLows > prevLows;
    const lowerHighs = recentHighs < prevHighs;
    const lowerLows = recentLows < prevLows;

    // Trend Logic Evaluation
    const bullAlignment = currentEma20 > currentEma50 && currentEma50 > currentEma200;
    const bearAlignment = currentEma20 < currentEma50 && currentEma50 < currentEma200;

    const strongTrendAdx = currentAdx > 25;
    const weakTrendAdx = currentAdx >= 20 && currentAdx <= 25;

    let regime: Gate1Regime = 'UNKNOWN';
    let confidence = 0;

    if (currentAtr > historicalAtr * 1.5 || bbWidth > avgBbWidth * 1.5) {
      // High Volatility / Expansion
      if (bbWidth > avgBbWidth * 1.5 && strongTrendAdx && (bullAlignment || bearAlignment)) {
        regime = 'BREAKOUT';
        confidence = 80 + Math.min(20, (currentAtr / historicalAtr) * 10);
        factors.push(`Price is expanding rapidly out of a structural range (BB Width: ${(bbWidth*100).toFixed(2)}% vs Avg: ${(avgBbWidth*100).toFixed(2)}%)`);
        factors.push(`Strong directional momentum (ADX: ${currentAdx.toFixed(1)})`);
        invalidation.push('Volume drops drastically or price falls back inside previous BB range.');
        invalidation.push('ADX falls below 20');
      } else {
        regime = 'HIGH_VOLATILITY';
        confidence = 80;
        factors.push(`ATR (${atrPct.toFixed(4)}) is significantly above its 20-period average`);
        factors.push(`Bollinger Bands are abnormally wide indicating volatile chop or shock`);
        invalidation.push('ATR contracts back to historical average levels');
      }
    } else if (bullAlignment && currentPdi > currentMdi) {
      if (strongTrendAdx && higherHighs && higherLows) {
        regime = 'STRONG_BULL_TREND';
        confidence = Math.min(100, 50 + currentAdx);
        factors.push(`EMA stack is bullish (20 > 50 > 200)`);
        factors.push(`ADX indicates strong trend (${currentAdx.toFixed(1)} > 25)`);
        factors.push(`+DI (${currentPdi.toFixed(1)}) > -DI (${currentMdi.toFixed(1)})`);
        factors.push(`Market structure shows higher highs and higher lows`);
        invalidation.push('Price breaks below the EMA 50');
        invalidation.push('-DI crosses above +DI');
      } else if ((strongTrendAdx || weakTrendAdx) && !lowerLows) {
        regime = 'WEAK_BULL_TREND';
        confidence = 60;
        factors.push(`EMA stack is generally bullish`);
        factors.push(`Trend strength is moderate/weak (ADX: ${currentAdx.toFixed(1)})`);
        factors.push(`Structure is not aggressively forming higher highs`);
        invalidation.push('Price breaks below EMA 200');
        invalidation.push('Market structure prints a clear lower low');
      }
    } else if (bearAlignment && currentMdi > currentPdi) {
      if (strongTrendAdx && lowerHighs && lowerLows) {
        regime = 'STRONG_BEAR_TREND';
        confidence = Math.min(100, 50 + currentAdx);
        factors.push(`EMA stack is bearish (20 < 50 < 200)`);
        factors.push(`ADX indicates strong trend (${currentAdx.toFixed(1)} > 25)`);
        factors.push(`-DI (${currentMdi.toFixed(1)}) > +DI (${currentPdi.toFixed(1)})`);
        factors.push(`Market structure shows lower highs and lower lows`);
        invalidation.push('Price breaks above the EMA 50');
        invalidation.push('+DI crosses above -DI');
      } else if ((strongTrendAdx || weakTrendAdx) && !higherHighs) {
        regime = 'WEAK_BEAR_TREND';
        confidence = 60;
        factors.push(`EMA stack is generally bearish`);
        factors.push(`Trend strength is moderate/weak (ADX: ${currentAdx.toFixed(1)})`);
        factors.push(`Structure is not aggressively forming lower lows`);
        invalidation.push('Price breaks above EMA 200');
        invalidation.push('Market structure prints a clear higher high');
      }
    } 
    
    if (regime === 'UNKNOWN') {
      if (currentAdx < 20 || bbWidth < avgBbWidth * 0.8 || bbWidth < 0.005) {
        if (bbWidth < avgBbWidth * 0.7) {
          regime = 'LOW_VOLATILITY';
          confidence = 70;
          factors.push(`Bollinger Bands are highly compressed (BB Width: ${(bbWidth*100).toFixed(2)}%)`);
          factors.push(`ADX is weak (${currentAdx.toFixed(1)} < 20)`);
          invalidation.push('Price breaks strongly out of the BB envelope');
        } else {
          regime = 'RANGE';
          confidence = 80 - (currentAdx * 2);
          factors.push(`ADX indicates absent trend (${currentAdx.toFixed(1)} < 20)`);
          factors.push(`EMAs are tangled or flat`);
          factors.push(`Directional structure (HH/HL or LH/LL) is absent`);
          invalidation.push('ADX rises above 25');
          invalidation.push('Price breaks significant recent support/resistance structure');
        }
      } else {
        regime = 'TRANSITION';
        confidence = 50;
        factors.push(`Conflicting signals: Trend indicators and market structure do not align`);
        factors.push(`ADX is ${currentAdx.toFixed(1)}, but EMAs are not fully stacked`);
        invalidation.push('EMAs achieve full bullish or bearish stack');
        invalidation.push('ADX drops below 20 indicating range consolidation');
      }
    }

    return {
      regime,
      confidence: Math.round(confidence),
      factors,
      invalidation
    };
  }
}
