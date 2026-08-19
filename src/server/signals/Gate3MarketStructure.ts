import { NormalizedCandle, SignalDirection } from '../../types/index.js';

export interface SwingPoint {
  type: 'HIGH' | 'LOW';
  price: number;
  index: number;
  timestamp: number;
}

export interface Gate3StructureResult {
  direction: 'BULLISH' | 'BEARISH' | 'CONSOLIDATION' | 'UNKNOWN';
  strength: 'STRONG' | 'MODERATE' | 'WEAK' | 'NONE';
  bosStatus: 'BULLISH_BOS' | 'BEARISH_BOS' | 'NONE';
  chochStatus: 'BULLISH_CHOCH' | 'BEARISH_CHOCH' | 'NONE';
  supportZones: number[];
  resistanceZones: number[];
  score: number; // 0-100
  reasons: string[];
}

export class Gate3MarketStructure {
  public static analyzeStructure(
    proposedDirection: SignalDirection,
    candles: NormalizedCandle[],
    leftBars = 3,
    rightBars = 3
  ): Gate3StructureResult {
    if (!candles || candles.length < leftBars + rightBars + 5) {
      return this.getDefaultUnknown();
    }

    const swings = this.identifySwings(candles, leftBars, rightBars);
    if (swings.length < 4) {
      return this.getDefaultUnknown();
    }

    const recentSwings = swings.slice(-10); // Look at the last 10 swings for context
    const currentPrice = candles[candles.length - 1].close;

    // Detect structural trend
    let hh = 0, hl = 0, lh = 0, ll = 0;
    const highs = recentSwings.filter(s => s.type === 'HIGH');
    const lows = recentSwings.filter(s => s.type === 'LOW');

    for (let i = 1; i < highs.length; i++) {
      if (highs[i].price > highs[i - 1].price) hh++;
      else if (highs[i].price < highs[i - 1].price) lh++;
    }

    for (let i = 1; i < lows.length; i++) {
      if (lows[i].price > lows[i - 1].price) hl++;
      else if (lows[i].price < lows[i - 1].price) ll++;
    }

    let direction: Gate3StructureResult['direction'] = 'CONSOLIDATION';
    if (hh >= lh && hl >= ll && (hh > 0 || hl > 0)) {
       direction = 'BULLISH';
    } else if (lh >= hh && ll >= hl && (lh > 0 || ll > 0)) {
       direction = 'BEARISH';
    }

    // BOS and CHOCH Detection
    let bosStatus: Gate3StructureResult['bosStatus'] = 'NONE';
    let chochStatus: Gate3StructureResult['chochStatus'] = 'NONE';
    const reasons: string[] = [];
    
    // Evaluate last few swings and recent price action to determine BOS / CHOCH
    // Looking back at the last 2 highs and 2 lows
    const lastHigh = highs[highs.length - 1];
    const prevHigh = highs[highs.length - 2];
    const lastLow = lows[lows.length - 1];
    const prevLow = lows[lows.length - 2];

    if (lastHigh && prevHigh && lastLow && prevLow) {
      // Prior trend determination for CHOCH
      const wasBearish = prevHigh.price < (highs[highs.length - 3]?.price || Infinity) && prevLow.price < (lows[lows.length - 3]?.price || Infinity);
      const wasBullish = prevHigh.price > (highs[highs.length - 3]?.price || 0) && prevLow.price > (lows[lows.length - 3]?.price || 0);

      if (currentPrice > lastHigh.price) {
        if (wasBearish || direction === 'BEARISH') {
          chochStatus = 'BULLISH_CHOCH';
          reasons.push('Bullish CHOCH: Price broke above recent lower high.');
        } else {
          bosStatus = 'BULLISH_BOS';
          reasons.push('Bullish BOS: Price broke above recent higher high, continuing trend.');
        }
      } else if (currentPrice < lastLow.price) {
        if (wasBullish || direction === 'BULLISH') {
          chochStatus = 'BEARISH_CHOCH';
          reasons.push('Bearish CHOCH: Price broke below recent higher low.');
        } else {
          bosStatus = 'BEARISH_BOS';
          reasons.push('Bearish BOS: Price broke below recent lower low, continuing trend.');
        }
      }
    }

    // Determine Strength
    let strength: Gate3StructureResult['strength'] = 'MODERATE';
    if ((direction === 'BULLISH' && (bosStatus === 'BULLISH_BOS' || chochStatus === 'BULLISH_CHOCH')) ||
        (direction === 'BEARISH' && (bosStatus === 'BEARISH_BOS' || chochStatus === 'BEARISH_CHOCH'))) {
      strength = 'STRONG';
    } else if (direction === 'CONSOLIDATION') {
      strength = 'WEAK';
    }

    // Support and Resistance Zones
    const supportZones = lows.slice(-3).map(l => l.price);
    const resistanceZones = highs.slice(-3).map(h => h.price);

    // Scoring logic based on proposed direction
    let score = 50; // Base score
    
    if (proposedDirection === 'BUY') {
      if (direction === 'BULLISH') score += 20;
      if (bosStatus === 'BULLISH_BOS') score += 20;
      if (chochStatus === 'BULLISH_CHOCH') score += 15;
      if (direction === 'BEARISH') {
        score -= 30;
        reasons.push('Overall structure is Bearish, conflicting with BUY.');
      }
      if (chochStatus === 'BEARISH_CHOCH' || bosStatus === 'BEARISH_BOS') {
        score -= 40;
        reasons.push('Recent structural break is Bearish, severely conflicting with BUY.');
      }
    } else { // SELL
      if (direction === 'BEARISH') score += 20;
      if (bosStatus === 'BEARISH_BOS') score += 20;
      if (chochStatus === 'BEARISH_CHOCH') score += 15;
      if (direction === 'BULLISH') {
        score -= 30;
        reasons.push('Overall structure is Bullish, conflicting with SELL.');
      }
      if (chochStatus === 'BULLISH_CHOCH' || bosStatus === 'BULLISH_BOS') {
        score -= 40;
        reasons.push('Recent structural break is Bullish, severely conflicting with SELL.');
      }
    }

    // Ensure score is bounded
    score = Math.max(0, Math.min(100, score));

    return {
      direction,
      strength,
      bosStatus,
      chochStatus,
      supportZones,
      resistanceZones,
      score,
      reasons
    };
  }

  private static identifySwings(candles: NormalizedCandle[], left: number, right: number): SwingPoint[] {
    const swings: SwingPoint[] = [];
    
    for (let i = left; i < candles.length - right; i++) {
      let isHigh = true;
      let isLow = true;

      for (let j = 1; j <= left; j++) {
        if (candles[i].high <= candles[i - j].high) isHigh = false;
        if (candles[i].low >= candles[i - j].low) isLow = false;
      }

      for (let j = 1; j <= right; j++) {
        if (candles[i].high <= candles[i + j].high) isHigh = false;
        if (candles[i].low >= candles[i + j].low) isLow = false;
      }

      if (isHigh) {
        swings.push({ type: 'HIGH', price: candles[i].high, index: i, timestamp: candles[i].timestamp });
      }
      if (isLow) {
        swings.push({ type: 'LOW', price: candles[i].low, index: i, timestamp: candles[i].timestamp });
      }
    }

    // Sort swings by index to maintain time series order
    swings.sort((a, b) => a.index - b.index);

    // Filter out consecutive highs or consecutive lows by keeping the extreme
    const filteredSwings: SwingPoint[] = [];
    for (const s of swings) {
      if (filteredSwings.length === 0) {
        filteredSwings.push(s);
        continue;
      }
      
      const last = filteredSwings[filteredSwings.length - 1];
      if (last.type === s.type) {
        // If same type, keep the more extreme one
        if (s.type === 'HIGH' && s.price > last.price) {
          filteredSwings[filteredSwings.length - 1] = s;
        } else if (s.type === 'LOW' && s.price < last.price) {
          filteredSwings[filteredSwings.length - 1] = s;
        }
      } else {
        filteredSwings.push(s);
      }
    }

    return filteredSwings;
  }

  private static getDefaultUnknown(): Gate3StructureResult {
    return {
      direction: 'UNKNOWN',
      strength: 'NONE',
      bosStatus: 'NONE',
      chochStatus: 'NONE',
      supportZones: [],
      resistanceZones: [],
      score: 50,
      reasons: ['Insufficient data for structure analysis']
    };
  }
}
