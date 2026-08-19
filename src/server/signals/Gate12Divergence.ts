/**
 * GATE 12: DIVERGENCE ANALYSIS ENGINE
 * 
 * Additive analytics module that analyzes price against momentum indicators (RSI & MACD)
 * using confirmed swing highs/lows.
 * 
 * DETECTS:
 * 1. Bullish RSI Divergence (Price creates meaningful lower low while RSI creates higher low)
 * 2. Bearish RSI Divergence (Price creates meaningful higher high while RSI creates lower high)
 * 3. Bullish MACD Divergence (Price creates meaningful lower low while MACD line/histogram creates higher low)
 * 4. Bearish MACD Divergence (Price creates meaningful higher high while MACD line/histogram creates lower high)
 * 
 * RULES:
 * - Uses confirmed swing points to prevent detecting minor noise fluctuations.
 * - Divergence does NOT independently generate a trade or override risk filters.
 * - Exposes: direction, type, strength, confirmed, score.
 */

import { NormalizedCandle, SignalDirection } from '../../types/index.js';
import { TechnicalIndicators } from './TechnicalIndicators.js';

export type DivergenceDirection = 'BULLISH' | 'BEARISH' | 'NONE';
export type DivergenceType = 'REGULAR_BULLISH' | 'REGULAR_BEARISH' | 'HIDDEN_BULLISH' | 'HIDDEN_BEARISH' | 'NONE';
export type DivergenceStrength = 'STRONG' | 'MODERATE' | 'WEAK' | 'NONE';

export interface DivergenceIndicatorDetail {
  indicator: 'RSI' | 'MACD' | 'MACD_HISTOGRAM';
  direction: DivergenceDirection;
  type: DivergenceType;
  strength: DivergenceStrength;
  confirmed: boolean;
  priceSwings: {
    priorSwingPrice: number;
    currentSwingPrice: number;
    priorSwingIndex: number;
    currentSwingIndex: number;
    priorSwingTime: number;
    currentSwingTime: number;
  };
  indicatorSwings: {
    priorValue: number;
    currentValue: number;
    delta: number;
  };
  reasons: string[];
}

export interface Gate12DivergenceResult {
  direction: DivergenceDirection;
  type: DivergenceType;
  strength: DivergenceStrength;
  confirmed: boolean;
  score: number; // 0-100 (50 = Neutral/None, >50 = Bullish confluence, <50 = Bearish confluence)
  rsiDivergence?: DivergenceIndicatorDetail;
  macdDivergence?: DivergenceIndicatorDetail;
  reasons: string[];
  summary: string;
}

export interface SwingPoint {
  type: 'HIGH' | 'LOW';
  price: number;
  index: number;
  timestamp: number;
}

export class Gate12Divergence {
  /**
   * Main entry point for Gate 12 Divergence Analysis.
   * Analyzes historical candles against RSI and MACD momentum indicators using swing structure.
   */
  public static analyze(
    candles: NormalizedCandle[],
    proposedDirection?: SignalDirection,
    leftBars = 3,
    rightBars = 3
  ): Gate12DivergenceResult {
    // 1. Data sufficiency check
    if (!candles || candles.length < 25) {
      return this.createNeutralResult(['Insufficient candle data for divergence analysis (minimum 25 required)']);
    }

    const sortedCandles = [...candles].sort((a, b) => a.timestamp - b.timestamp);

    // 2. Identify confirmed structural swings
    const swings = this.identifySwings(sortedCandles, leftBars, rightBars);
    const swingHighs = swings.filter((s) => s.type === 'HIGH');
    const swingLows = swings.filter((s) => s.type === 'LOW');

    if (swingHighs.length < 2 && swingLows.length < 2) {
      return this.createNeutralResult(['Insufficient swing data: at least 2 swing highs or 2 swing lows required']);
    }

    // 3. Compute continuous indicator series aligned with candle array indices
    const rsiSeries = this.calculateAlignedRSI(sortedCandles, 14);
    const macdSeries = this.calculateAlignedMACD(sortedCandles, 12, 26, 9);

    const currentPrice = sortedCandles[sortedCandles.length - 1].close;

    // 4. Evaluate Bullish Divergence across Swing Lows
    let bullishRsi: DivergenceIndicatorDetail | undefined;
    let bullishMacd: DivergenceIndicatorDetail | undefined;

    if (swingLows.length >= 2) {
      bullishRsi = this.evaluateBullishRsi(sortedCandles, swingLows, rsiSeries, currentPrice);
      bullishMacd = this.evaluateBullishMacd(sortedCandles, swingLows, macdSeries, currentPrice);
    }

    // 5. Evaluate Bearish Divergence across Swing Highs
    let bearishRsi: DivergenceIndicatorDetail | undefined;
    let bearishMacd: DivergenceIndicatorDetail | undefined;

    if (swingHighs.length >= 2) {
      bearishRsi = this.evaluateBearishRsi(sortedCandles, swingHighs, rsiSeries, currentPrice);
      bearishMacd = this.evaluateBearishMacd(sortedCandles, swingHighs, macdSeries, currentPrice);
    }

    // 6. Synthesize Confluent Divergence State
    const hasBullish = Boolean(bullishRsi || bullishMacd);
    const hasBearish = Boolean(bearishRsi || bearishMacd);

    const reasons: string[] = [];

    // Contradiction / Mixed divergence check
    if (hasBullish && hasBearish) {
      // Prioritize the setup aligning with the most recent swing structure or proposed direction
      if (proposedDirection === 'BUY' && (bullishRsi || bullishMacd)) {
        return this.synthesizeResult('BULLISH', bullishRsi, bullishMacd, ['Bullish divergence confirmed on recent swing lows while higher timeframe consolidates']);
      }
      if (proposedDirection === 'SELL' && (bearishRsi || bearishMacd)) {
        return this.synthesizeResult('BEARISH', bearishRsi, bearishMacd, ['Bearish divergence confirmed on recent swing highs while higher timeframe consolidates']);
      }
      return this.createNeutralResult(['Conflicting bullish and bearish divergence signals detected; neutral state maintained']);
    }

    if (hasBullish) {
      if (bullishRsi) reasons.push(...bullishRsi.reasons);
      if (bullishMacd) reasons.push(...bullishMacd.reasons);
      return this.synthesizeResult('BULLISH', bullishRsi, bullishMacd, reasons);
    }

    if (hasBearish) {
      if (bearishRsi) reasons.push(...bearishRsi.reasons);
      if (bearishMacd) reasons.push(...bearishMacd.reasons);
      return this.synthesizeResult('BEARISH', bearishRsi, bearishMacd, reasons);
    }

    return this.createNeutralResult(['No divergence detected: Price and momentum indicators in alignment']);
  }

  /**
   * Identifies structural swing points using multi-bar pivot analysis to ignore minor noise.
   */
  public static identifySwings(
    candles: NormalizedCandle[],
    leftBars = 3,
    rightBars = 3
  ): SwingPoint[] {
    const rawHighs: SwingPoint[] = [];
    const rawLows: SwingPoint[] = [];
    const len = candles.length;

    for (let i = leftBars; i < len - rightBars; i++) {
      const current = candles[i];
      let isHigh = true;
      let isLow = true;

      for (let j = i - leftBars; j <= i + rightBars; j++) {
        if (i === j) continue;
        if (candles[j].high > current.high) isHigh = false;
        if (candles[j].low < current.low) isLow = false;
      }

      if (isHigh) {
        rawHighs.push({
          type: 'HIGH',
          price: current.high,
          index: i,
          timestamp: current.timestamp,
        });
      }

      if (isLow) {
        rawLows.push({
          type: 'LOW',
          price: current.low,
          index: i,
          timestamp: current.timestamp,
        });
      }
    }

    // Cluster close peaks/troughs (min spacing 3 bars) to retain distinct structural pivots
    const minSpacing = 3;
    const filteredHighs: SwingPoint[] = [];
    for (const h of rawHighs) {
      if (filteredHighs.length === 0) {
        filteredHighs.push(h);
      } else {
        const last = filteredHighs[filteredHighs.length - 1];
        if (h.index - last.index < minSpacing) {
          if (h.price > last.price) {
            filteredHighs[filteredHighs.length - 1] = h;
          }
        } else {
          filteredHighs.push(h);
        }
      }
    }

    const filteredLows: SwingPoint[] = [];
    for (const l of rawLows) {
      if (filteredLows.length === 0) {
        filteredLows.push(l);
      } else {
        const last = filteredLows[filteredLows.length - 1];
        if (l.index - last.index < minSpacing) {
          if (l.price < last.price) {
            filteredLows[filteredLows.length - 1] = l;
          }
        } else {
          filteredLows.push(l);
        }
      }
    }

    const allSwings = [...filteredHighs, ...filteredLows].sort((a, b) => a.index - b.index);
    return allSwings;
  }

  /**
   * Evaluates Bullish RSI Divergence: Price Lower Low vs RSI Higher Low.
   */
  private static evaluateBullishRsi(
    candles: NormalizedCandle[],
    swingLows: SwingPoint[],
    rsiSeries: (number | null)[],
    currentPrice: number
  ): DivergenceIndicatorDetail | undefined {
    if (swingLows.length < 2) return undefined;

    // Examine the last 2 confirmed swing lows
    const currSwing = swingLows[swingLows.length - 1];
    const prevSwing = swingLows[swingLows.length - 2];

    const prevRsi = rsiSeries[prevSwing.index];
    const currRsi = rsiSeries[currSwing.index];

    if (prevRsi === null || currRsi === null) return undefined;

    // Minimum price drop of 0.05% to avoid micro-ticks
    const priceDropPct = ((prevSwing.price - currSwing.price) / prevSwing.price) * 100;
    const rsiDiff = currRsi - prevRsi;

    // Regular Bullish: Price Lower Low & RSI Higher Low
    if (currSwing.price < prevSwing.price && priceDropPct >= 0.05 && rsiDiff >= 1.2) {
      const isConfirmed = currentPrice > currSwing.price && (rsiSeries[candles.length - 1] || 0) >= currRsi;
      const isStrong = rsiDiff >= 4.0 && (prevRsi < 35 || currRsi < 40);
      const strength: DivergenceStrength = isStrong ? 'STRONG' : rsiDiff >= 2.0 ? 'MODERATE' : 'WEAK';

      return {
        indicator: 'RSI',
        direction: 'BULLISH',
        type: 'REGULAR_BULLISH',
        strength,
        confirmed: isConfirmed,
        priceSwings: {
          priorSwingPrice: prevSwing.price,
          currentSwingPrice: currSwing.price,
          priorSwingIndex: prevSwing.index,
          currentSwingIndex: currSwing.index,
          priorSwingTime: prevSwing.timestamp,
          currentSwingTime: currSwing.timestamp,
        },
        indicatorSwings: {
          priorValue: Number(prevRsi.toFixed(2)),
          currentValue: Number(currRsi.toFixed(2)),
          delta: Number(rsiDiff.toFixed(2)),
        },
        reasons: [
          `Bullish RSI Divergence: Price made lower low (${prevSwing.price} -> ${currSwing.price}, -${priceDropPct.toFixed(2)}%) while RSI formed higher low (${prevRsi.toFixed(1)} -> ${currRsi.toFixed(1)}, +${rsiDiff.toFixed(1)} pts)`,
        ],
      };
    }

    return undefined;
  }

  /**
   * Evaluates Bearish RSI Divergence: Price Higher High vs RSI Lower High.
   */
  private static evaluateBearishRsi(
    candles: NormalizedCandle[],
    swingHighs: SwingPoint[],
    rsiSeries: (number | null)[],
    currentPrice: number
  ): DivergenceIndicatorDetail | undefined {
    if (swingHighs.length < 2) return undefined;

    const currSwing = swingHighs[swingHighs.length - 1];
    const prevSwing = swingHighs[swingHighs.length - 2];

    const prevRsi = rsiSeries[prevSwing.index];
    const currRsi = rsiSeries[currSwing.index];

    if (prevRsi === null || currRsi === null) return undefined;

    const priceRisePct = ((currSwing.price - prevSwing.price) / prevSwing.price) * 100;
    const rsiDiff = prevRsi - currRsi; // Positive means RSI formed a Lower High

    // Regular Bearish: Price Higher High & RSI Lower High
    if (currSwing.price > prevSwing.price && priceRisePct >= 0.05 && rsiDiff >= 1.2) {
      const isConfirmed = currentPrice < currSwing.price && (rsiSeries[candles.length - 1] || 100) <= currRsi;
      const isStrong = rsiDiff >= 4.0 && (prevRsi > 65 || currRsi > 60);
      const strength: DivergenceStrength = isStrong ? 'STRONG' : rsiDiff >= 2.0 ? 'MODERATE' : 'WEAK';

      return {
        indicator: 'RSI',
        direction: 'BEARISH',
        type: 'REGULAR_BEARISH',
        strength,
        confirmed: isConfirmed,
        priceSwings: {
          priorSwingPrice: prevSwing.price,
          currentSwingPrice: currSwing.price,
          priorSwingIndex: prevSwing.index,
          currentSwingIndex: currSwing.index,
          priorSwingTime: prevSwing.timestamp,
          currentSwingTime: currSwing.timestamp,
        },
        indicatorSwings: {
          priorValue: Number(prevRsi.toFixed(2)),
          currentValue: Number(currRsi.toFixed(2)),
          delta: Number((-rsiDiff).toFixed(2)),
        },
        reasons: [
          `Bearish RSI Divergence: Price made higher high (${prevSwing.price} -> ${currSwing.price}, +${priceRisePct.toFixed(2)}%) while RSI formed lower high (${prevRsi.toFixed(1)} -> ${currRsi.toFixed(1)}, -${rsiDiff.toFixed(1)} pts)`,
        ],
      };
    }

    return undefined;
  }

  /**
   * Evaluates Bullish MACD Divergence: Price Lower Low vs MACD Histogram/Line Higher Low.
   */
  private static evaluateBullishMacd(
    candles: NormalizedCandle[],
    swingLows: SwingPoint[],
    macdSeries: ({ macdLine: number; signalLine: number; histogram: number } | null)[],
    currentPrice: number
  ): DivergenceIndicatorDetail | undefined {
    if (swingLows.length < 2) return undefined;

    const currSwing = swingLows[swingLows.length - 1];
    const prevSwing = swingLows[swingLows.length - 2];

    const prevMacd = macdSeries[prevSwing.index];
    const currMacd = macdSeries[currSwing.index];

    if (!prevMacd || !currMacd) return undefined;

    const priceDropPct = ((prevSwing.price - currSwing.price) / prevSwing.price) * 100;
    const histDiff = currMacd.histogram - prevMacd.histogram;
    const lineDiff = currMacd.macdLine - prevMacd.macdLine;

    if (currSwing.price < prevSwing.price && priceDropPct >= 0.05 && (histDiff > 0 || lineDiff > 0)) {
      const isConfirmed = currentPrice > currSwing.price;
      const isStrong = histDiff > 0 && lineDiff > 0;
      const strength: DivergenceStrength = isStrong ? 'STRONG' : 'MODERATE';

      return {
        indicator: 'MACD',
        direction: 'BULLISH',
        type: 'REGULAR_BULLISH',
        strength,
        confirmed: isConfirmed,
        priceSwings: {
          priorSwingPrice: prevSwing.price,
          currentSwingPrice: currSwing.price,
          priorSwingIndex: prevSwing.index,
          currentSwingIndex: currSwing.index,
          priorSwingTime: prevSwing.timestamp,
          currentSwingTime: currSwing.timestamp,
        },
        indicatorSwings: {
          priorValue: Number(prevMacd.histogram.toFixed(4)),
          currentValue: Number(currMacd.histogram.toFixed(4)),
          delta: Number(histDiff.toFixed(4)),
        },
        reasons: [
          `Bullish MACD Divergence: Price made lower low while MACD histogram increased from ${prevMacd.histogram.toFixed(4)} to ${currMacd.histogram.toFixed(4)}`,
        ],
      };
    }

    return undefined;
  }

  /**
   * Evaluates Bearish MACD Divergence: Price Higher High vs MACD Histogram/Line Lower High.
   */
  private static evaluateBearishMacd(
    candles: NormalizedCandle[],
    swingHighs: SwingPoint[],
    macdSeries: ({ macdLine: number; signalLine: number; histogram: number } | null)[],
    currentPrice: number
  ): DivergenceIndicatorDetail | undefined {
    if (swingHighs.length < 2) return undefined;

    const currSwing = swingHighs[swingHighs.length - 1];
    const prevSwing = swingHighs[swingHighs.length - 2];

    const prevMacd = macdSeries[prevSwing.index];
    const currMacd = macdSeries[currSwing.index];

    if (!prevMacd || !currMacd) return undefined;

    const priceRisePct = ((currSwing.price - prevSwing.price) / prevSwing.price) * 100;
    const histDiff = prevMacd.histogram - currMacd.histogram;
    const lineDiff = prevMacd.macdLine - currMacd.macdLine;

    if (currSwing.price > prevSwing.price && priceRisePct >= 0.05 && (histDiff > 0 || lineDiff > 0)) {
      const isConfirmed = currentPrice < currSwing.price;
      const isStrong = histDiff > 0 && lineDiff > 0;
      const strength: DivergenceStrength = isStrong ? 'STRONG' : 'MODERATE';

      return {
        indicator: 'MACD',
        direction: 'BEARISH',
        type: 'REGULAR_BEARISH',
        strength,
        confirmed: isConfirmed,
        priceSwings: {
          priorSwingPrice: prevSwing.price,
          currentSwingPrice: currSwing.price,
          priorSwingIndex: prevSwing.index,
          currentSwingIndex: currSwing.index,
          priorSwingTime: prevSwing.timestamp,
          currentSwingTime: currSwing.timestamp,
        },
        indicatorSwings: {
          priorValue: Number(prevMacd.histogram.toFixed(4)),
          currentValue: Number(currMacd.histogram.toFixed(4)),
          delta: Number((-histDiff).toFixed(4)),
        },
        reasons: [
          `Bearish MACD Divergence: Price made higher high while MACD histogram decreased from ${prevMacd.histogram.toFixed(4)} to ${currMacd.histogram.toFixed(4)}`,
        ],
      };
    }

    return undefined;
  }

  /**
   * Synthesizes overall Gate 12 result from individual indicator divergences.
   */
  private static synthesizeResult(
    direction: DivergenceDirection,
    rsi?: DivergenceIndicatorDetail,
    macd?: DivergenceIndicatorDetail,
    reasons: string[] = []
  ): Gate12DivergenceResult {
    const isBoth = Boolean(rsi && macd);
    let strength: DivergenceStrength = 'WEAK';

    if (isBoth) {
      strength = rsi?.strength === 'STRONG' || macd?.strength === 'STRONG' ? 'STRONG' : 'MODERATE';
    } else if (rsi) {
      strength = rsi.strength;
    } else if (macd) {
      strength = macd.strength;
    }

    const confirmed = Boolean(rsi?.confirmed || macd?.confirmed);
    const type: DivergenceType = direction === 'BULLISH' ? 'REGULAR_BULLISH' : 'REGULAR_BEARISH';

    // Base score 50 (neutral). Confluence boosts or diminishes score smoothly.
    let score = 50;
    if (direction === 'BULLISH') {
      score = isBoth ? (strength === 'STRONG' ? 90 : 80) : strength === 'STRONG' ? 75 : 65;
    } else if (direction === 'BEARISH') {
      score = isBoth ? (strength === 'STRONG' ? 10 : 20) : strength === 'STRONG' ? 25 : 35;
    }

    const summary = `${direction} Divergence [${strength}] (Type: ${type}, Confirmed: ${confirmed}, Score: ${score})`;

    return {
      direction,
      type,
      strength,
      confirmed,
      score,
      rsiDivergence: rsi,
      macdDivergence: macd,
      reasons,
      summary,
    };
  }

  private static createNeutralResult(reasons: string[]): Gate12DivergenceResult {
    return {
      direction: 'NONE',
      type: 'NONE',
      strength: 'NONE',
      confirmed: false,
      score: 50,
      reasons,
      summary: 'No active divergence',
    };
  }

  /**
   * Computes an index-aligned RSI series matching candle array positions.
   */
  private static calculateAlignedRSI(candles: NormalizedCandle[], period = 14): (number | null)[] {
    const rsiValues = TechnicalIndicators.calculateRSI(candles, period);
    const aligned: (number | null)[] = new Array(candles.length).fill(null);

    // calculateRSI returns values starting from index `period`
    const offset = candles.length - rsiValues.length;
    for (let i = 0; i < rsiValues.length; i++) {
      aligned[offset + i] = rsiValues[i];
    }

    return aligned;
  }

  /**
   * Computes an index-aligned MACD series matching candle array positions.
   */
  private static calculateAlignedMACD(
    candles: NormalizedCandle[],
    fastPeriod = 12,
    slowPeriod = 26,
    signalPeriod = 9
  ): ({ macdLine: number; signalLine: number; histogram: number } | null)[] {
    const aligned: ({ macdLine: number; signalLine: number; histogram: number } | null)[] = new Array(candles.length).fill(null);

    if (candles.length < slowPeriod + signalPeriod) {
      return aligned;
    }

    const fastEma = TechnicalIndicators.calculateEMA(candles, fastPeriod);
    const slowEma = TechnicalIndicators.calculateEMA(candles, slowPeriod);

    if (fastEma.length === 0 || slowEma.length === 0) return aligned;

    const offset = slowPeriod - fastPeriod;
    const macdLineSeries: number[] = [];

    for (let i = 0; i < slowEma.length; i++) {
      const fastVal = fastEma[i + offset];
      const slowVal = slowEma[i];
      macdLineSeries.push(fastVal - slowVal);
    }

    if (macdLineSeries.length < signalPeriod) return aligned;

    // Signal Line (EMA of MACD Line)
    const k = 2 / (signalPeriod + 1);
    let sum = 0;
    for (let i = 0; i < signalPeriod; i++) {
      sum += macdLineSeries[i];
    }
    let currentSignal = sum / signalPeriod;
    const signalSeries: number[] = [currentSignal];

    for (let i = signalPeriod; i < macdLineSeries.length; i++) {
      currentSignal = macdLineSeries[i] * k + currentSignal * (1 - k);
      signalSeries.push(currentSignal);
    }

    // Align back to candles array index
    // macdLineSeries starts at (slowPeriod - 1)
    // signalSeries starts at (slowPeriod - 1 + signalPeriod - 1) = slowPeriod + signalPeriod - 2
    const totalMacdOffset = (candles.length - macdLineSeries.length) + (signalPeriod - 1);

    for (let i = 0; i < signalSeries.length; i++) {
      const macdIdx = i + (signalPeriod - 1);
      const macdLine = macdLineSeries[macdIdx];
      const signalLine = signalSeries[i];
      const histogram = macdLine - signalLine;

      const candleIdx = totalMacdOffset + i;
      if (candleIdx < candles.length) {
        aligned[candleIdx] = {
          macdLine,
          signalLine,
          histogram,
        };
      }
    }

    return aligned;
  }
}
