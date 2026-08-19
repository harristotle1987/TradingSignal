import { NormalizedCandle, SignalDirection } from '../../types/index.js';
import { TechnicalIndicators } from './TechnicalIndicators.js';

export interface PriceZone {
  top: number;
  bottom: number;
  type: 'SUPPORT' | 'RESISTANCE' | 'LIQUIDITY_POOL';
  strength: number;
  factors: string[];
  isTested: boolean;
  isBroken: boolean;
}

export interface Gate5LiquidityResult {
  nearestSupport: PriceZone | null;
  nearestResistance: PriceZone | null;
  liquidityZones: PriceZone[];
  sweepDetected: string | null;
  retestDetected: string | null;
  srConfluenceScore: number;
  liquidityScore: number;
  score: number;
  reasons: string[];
}

export class Gate5SupportResistance {
  public static analyze(
    proposedDirection: SignalDirection,
    candles: NormalizedCandle[]
  ): Gate5LiquidityResult {
    const reasons: string[] = [];
    
    if (!candles || candles.length < 50) {
      return {
        nearestSupport: null,
        nearestResistance: null,
        liquidityZones: [],
        sweepDetected: null,
        retestDetected: null,
        srConfluenceScore: 50,
        liquidityScore: 50,
        score: 50,
        reasons: ['Insufficient candles for S/R and Liquidity calculation.']
      };
    }

    const currentPrice = candles[candles.length - 1].close;
    const atr = TechnicalIndicators.calculateATR(candles, 14);
    const zoneTolerance = atr * 0.3; // Zones are roughly 0.3 ATR wide per factor

    // 1. Extract significant price points
    const pricePoints: { price: number; type: 'HIGH' | 'LOW'; factor: string; volume: number }[] = [];

    // 1a. Daily & Weekly Highs/Lows
    // Estimate based on timestamps if available. 
    // 1 day = 86400000 ms. 1 week = 604800000 ms.
    const now = candles[candles.length - 1].timestamp;
    let dayHigh = -Infinity; let dayLow = Infinity;
    let weekHigh = -Infinity; let weekLow = Infinity;
    
    for (const c of candles) {
      const age = now - c.timestamp;
      if (age <= 86400000) {
        if (c.high > dayHigh) dayHigh = c.high;
        if (c.low < dayLow) dayLow = c.low;
      }
      if (age <= 604800000) {
        if (c.high > weekHigh) weekHigh = c.high;
        if (c.low < weekLow) weekLow = c.low;
      }
    }

    if (dayHigh !== -Infinity) pricePoints.push({ price: dayHigh, type: 'HIGH', factor: 'Daily High', volume: 0 });
    if (dayLow !== Infinity) pricePoints.push({ price: dayLow, type: 'LOW', factor: 'Daily Low', volume: 0 });
    if (weekHigh !== -Infinity && weekHigh !== dayHigh) pricePoints.push({ price: weekHigh, type: 'HIGH', factor: 'Weekly High', volume: 0 });
    if (weekLow !== Infinity && weekLow !== dayLow) pricePoints.push({ price: weekLow, type: 'LOW', factor: 'Weekly Low', volume: 0 });

    // 1b. Swing Highs & Lows (Fractal 5-candle: 2 left, 2 right)
    for (let i = 2; i < candles.length - 2; i++) {
      const c = candles[i];
      const isHigh = c.high > candles[i-1].high && c.high > candles[i-2].high && c.high > candles[i+1].high && c.high > candles[i+2].high;
      const isLow = c.low < candles[i-1].low && c.low < candles[i-2].low && c.low < candles[i+1].low && c.low < candles[i+2].low;
      
      if (isHigh) pricePoints.push({ price: c.high, type: 'HIGH', factor: 'Swing High', volume: c.volume });
      if (isLow) pricePoints.push({ price: c.low, type: 'LOW', factor: 'Swing Low', volume: c.volume });
    }

    // 1c. High Volume Nodes
    const sortedByVolume = [...candles].sort((a, b) => b.volume - a.volume);
    const topVolume = sortedByVolume.slice(0, Math.min(5, sortedByVolume.length));
    for (const v of topVolume) {
       pricePoints.push({ price: v.close, type: v.close > currentPrice ? 'HIGH' : 'LOW', factor: 'High Volume Node', volume: v.volume });
    }

    // 1d. Psychological Levels (Round numbers near current price)
    // Find magnitude to determine round numbers (e.g. 1.2300, 50000)
    const magnitude = Math.pow(10, Math.floor(Math.log10(currentPrice)));
    let roundStep = magnitude / 100;
    if (roundStep < 0.0001) roundStep = 0.0001; // floor for crypto/forex
    
    const nearestRoundUp = Math.ceil(currentPrice / roundStep) * roundStep;
    const nearestRoundDown = Math.floor(currentPrice / roundStep) * roundStep;
    pricePoints.push({ price: nearestRoundUp, type: 'HIGH', factor: 'Psychological', volume: 0 });
    pricePoints.push({ price: nearestRoundDown, type: 'LOW', factor: 'Psychological', volume: 0 });


    // 2. Cluster Price Points into Zones
    const zones: PriceZone[] = [];
    pricePoints.sort((a, b) => a.price - b.price);

    for (const pt of pricePoints) {
      // Find an existing zone that overlaps
      const overlappingZone = zones.find(z => pt.price >= z.bottom - zoneTolerance && pt.price <= z.top + zoneTolerance);
      
      if (overlappingZone) {
        overlappingZone.top = Math.max(overlappingZone.top, pt.price + zoneTolerance/2);
        overlappingZone.bottom = Math.min(overlappingZone.bottom, pt.price - zoneTolerance/2);
        overlappingZone.strength += 1;
        if (!overlappingZone.factors.includes(pt.factor)) {
          overlappingZone.factors.push(pt.factor);
        }
        // Promote to liquidity pool if it has many factors (e.g. Daily High + Swing High + Round Number)
        if (overlappingZone.factors.length >= 3 || overlappingZone.strength >= 4) {
          overlappingZone.type = 'LIQUIDITY_POOL';
        } else {
           // Decide if S or R based on position relative to current price, but prefer historical type if uncrossed
           if (currentPrice < overlappingZone.bottom) overlappingZone.type = 'RESISTANCE';
           else if (currentPrice > overlappingZone.top) overlappingZone.type = 'SUPPORT';
        }
      } else {
        zones.push({
          top: pt.price + zoneTolerance/2,
          bottom: pt.price - zoneTolerance/2,
          type: pt.price > currentPrice ? 'RESISTANCE' : 'SUPPORT',
          strength: 1,
          factors: [pt.factor],
          isTested: false,
          isBroken: false
        });
      }
    }

    // 3. Post-Process Zones (Identify SR Flips, Broken Zones)
    for (const z of zones) {
      // Check if price has crossed this zone recently
      let crosses = 0;
      for (let i = candles.length - 20; i < candles.length; i++) {
         if (i < 0) continue;
         const c = candles[i];
         const prevC = candles[i-1];
         if (!prevC) continue;
         
         const crossedUp = prevC.close < z.bottom && c.close > z.top;
         const crossedDown = prevC.close > z.top && c.close < z.bottom;
         
         if (crossedUp || crossedDown) {
            z.isBroken = true;
            crosses++;
         }
      }
      if (crosses > 0 && crosses % 2 !== 0) {
         // S/R flip occurred
         if (z.type === 'RESISTANCE' && currentPrice > z.top) {
            z.type = 'SUPPORT';
            z.factors.push('R->S Flip');
         } else if (z.type === 'SUPPORT' && currentPrice < z.bottom) {
            z.type = 'RESISTANCE';
            z.factors.push('S->R Flip');
         }
      }
    }

    // Sort zones by strength, then proximity
    const activeZones = zones.filter(z => !z.isBroken || z.factors.includes('R->S Flip') || z.factors.includes('S->R Flip'));
    
    let nearestSupport: PriceZone | null = null;
    let nearestResistance: PriceZone | null = null;
    
    let minSupDist = Infinity;
    let minResDist = Infinity;

    for (const z of activeZones) {
       if (z.top < currentPrice && (currentPrice - z.top) < minSupDist) {
          nearestSupport = z;
          minSupDist = currentPrice - z.top;
       }
       if (z.bottom > currentPrice && (z.bottom - currentPrice) < minResDist) {
          nearestResistance = z;
          minResDist = z.bottom - currentPrice;
       }
    }

    const liquidityZones = zones.filter(z => z.type === 'LIQUIDITY_POOL').sort((a, b) => b.strength - a.strength);

    // 4. Detect Price Action Anomalies (Sweeps, Retests, Rejections)
    let sweepDetected: string | null = null;
    let retestDetected: string | null = null;
    const lastCandle = candles[candles.length - 1];
    const prevCandle = candles[candles.length - 2];

    // Liquidity Sweep (Wick into liquidity/zone, close outside)
    for (const z of activeZones) {
       // Bullish Sweep (Swept Support/Liquidity below)
       if (lastCandle.low < z.bottom && lastCandle.close > z.top) {
          sweepDetected = `BULLISH_SWEEP: Swept liquidity below ${z.bottom.toFixed(2)} (${z.factors.join(', ')})`;
          z.isTested = true;
       }
       // Bearish Sweep (Swept Resistance/Liquidity above)
       if (lastCandle.high > z.top && lastCandle.close < z.bottom) {
          sweepDetected = `BEARISH_SWEEP: Swept liquidity above ${z.top.toFixed(2)} (${z.factors.join(', ')})`;
          z.isTested = true;
       }

       // Breakout & Retest
       if (z.factors.includes('R->S Flip') && lastCandle.low <= z.top && lastCandle.close > z.top) {
          retestDetected = `BULLISH_RETEST: Retesting flipped support at ${z.top.toFixed(2)}`;
          z.isTested = true;
       }
       if (z.factors.includes('S->R Flip') && lastCandle.high >= z.bottom && lastCandle.close < z.bottom) {
          retestDetected = `BEARISH_RETEST: Retesting flipped resistance at ${z.bottom.toFixed(2)}`;
          z.isTested = true;
       }
    }

    // 5. Evaluate and Score
    let srConfluenceScore = 50;
    let liquidityScore = 50;

    if (proposedDirection === 'BUY') {
       // Look for support confirmation
       if (sweepDetected && sweepDetected.startsWith('BULLISH')) {
          srConfluenceScore += 30;
          liquidityScore += 30;
          reasons.push('Bullish liquidity sweep detected. Strong reversal signal.');
       }
       if (retestDetected && retestDetected.startsWith('BULLISH')) {
          srConfluenceScore += 25;
          reasons.push('Successful bullish retest of flipped support.');
       }
       if (nearestSupport && minSupDist < atr * 2) {
          srConfluenceScore += nearestSupport.strength * 5;
          reasons.push(`Price is near structural support (${nearestSupport.factors.join(', ')}).`);
       } else if (nearestSupport && minSupDist > atr * 5) {
          srConfluenceScore -= 20;
          reasons.push('Price is far from any meaningful support, increasing risk.');
       }
       if (nearestResistance && minResDist < atr * 0.5) {
          srConfluenceScore -= 30;
          reasons.push('Buying directly into structural resistance is highly discouraged.');
       }
    } else { // SELL
       if (sweepDetected && sweepDetected.startsWith('BEARISH')) {
          srConfluenceScore += 30;
          liquidityScore += 30;
          reasons.push('Bearish liquidity sweep detected. Strong reversal signal.');
       }
       if (retestDetected && retestDetected.startsWith('BEARISH')) {
          srConfluenceScore += 25;
          reasons.push('Successful bearish retest of flipped resistance.');
       }
       if (nearestResistance && minResDist < atr * 2) {
          srConfluenceScore += nearestResistance.strength * 5;
          reasons.push(`Price is near structural resistance (${nearestResistance.factors.join(', ')}).`);
       } else if (nearestResistance && minResDist > atr * 5) {
          srConfluenceScore -= 20;
          reasons.push('Price is far from meaningful resistance, increasing risk.');
       }
       if (nearestSupport && minSupDist < atr * 0.5) {
          srConfluenceScore -= 30;
          reasons.push('Selling directly into structural support is highly discouraged.');
       }
    }

    // Bound scores
    srConfluenceScore = Math.max(0, Math.min(100, srConfluenceScore));
    liquidityScore = Math.max(0, Math.min(100, liquidityScore));

    const score = Math.round((srConfluenceScore * 0.7) + (liquidityScore * 0.3));

    return {
      nearestSupport,
      nearestResistance,
      liquidityZones,
      sweepDetected,
      retestDetected,
      srConfluenceScore,
      liquidityScore,
      score,
      reasons
    };
  }
}
