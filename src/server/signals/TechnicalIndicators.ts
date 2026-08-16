/**
 * Technical Indicators Calculation Engine
 * Pure mathematical indicator utilities calculated on real historical/live market candles.
 * No hardcoded, synthetic, or simulated values.
 */

import { NormalizedCandle } from '../../types/index.js';

export interface MACDResult {
  macdLine: number;
  signalLine: number;
  histogram: number;
}

export interface BollingerBandsResult {
  upper: number;
  middle: number;
  lower: number;
}

export class TechnicalIndicators {
  /**
   * Exponential Moving Average (EMA)
   * Expects candles ordered chronologically ascending (oldest first, newest last).
   */
  static calculateEMA(candles: NormalizedCandle[], period: number): number[] {
    if (candles.length < period) return [];

    const k = 2 / (period + 1);
    const emaValues: number[] = [];

    // First EMA point is SMA of first 'period' closes
    let sum = 0;
    for (let i = 0; i < period; i++) {
      sum += candles[i].close;
    }
    let currentEma = sum / period;
    emaValues.push(currentEma);

    for (let i = period; i < candles.length; i++) {
      const price = candles[i].close;
      currentEma = price * k + currentEma * (1 - k);
      emaValues.push(currentEma);
    }

    return emaValues;
  }

  /**
   * Relative Strength Index (RSI) using Wilder's Smoothing
   */
  static calculateRSI(candles: NormalizedCandle[], period = 14): number[] {
    if (candles.length <= period) return [];

    const rsiValues: number[] = [];
    let avgGain = 0;
    let avgLoss = 0;

    // First period gains and losses
    for (let i = 1; i <= period; i++) {
      const change = candles[i].close - candles[i - 1].close;
      if (change > 0) avgGain += change;
      else avgLoss += Math.abs(change);
    }

    avgGain /= period;
    avgLoss /= period;

    let rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsiValues.push(100 - 100 / (1 + rs));

    for (let i = period + 1; i < candles.length; i++) {
      const change = candles[i].close - candles[i - 1].close;
      const gain = change > 0 ? change : 0;
      const loss = change < 0 ? Math.abs(change) : 0;

      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;

      if (avgLoss === 0) {
        rsiValues.push(100);
      } else {
        rs = avgGain / avgLoss;
        rsiValues.push(100 - 100 / (1 + rs));
      }
    }

    return rsiValues;
  }

  /**
   * Moving Average Convergence Divergence (MACD)
   */
  static calculateMACD(
    candles: NormalizedCandle[],
    fastPeriod = 12,
    slowPeriod = 26,
    signalPeriod = 9
  ): MACDResult | null {
    if (candles.length < slowPeriod + signalPeriod) return null;

    const fastEma = this.calculateEMA(candles, fastPeriod);
    const slowEma = this.calculateEMA(candles, slowPeriod);

    if (fastEma.length === 0 || slowEma.length === 0) return null;

    // Align fast and slow EMAs to the same length (slowEma starts later)
    const offset = slowPeriod - fastPeriod;
    const macdLineSeries: number[] = [];

    for (let i = 0; i < slowEma.length; i++) {
      const fastVal = fastEma[i + offset];
      const slowVal = slowEma[i];
      macdLineSeries.push(fastVal - slowVal);
    }

    if (macdLineSeries.length < signalPeriod) return null;

    // Calculate Signal Line (EMA of MACD line)
    const k = 2 / (signalPeriod + 1);
    let sum = 0;
    for (let i = 0; i < signalPeriod; i++) {
      sum += macdLineSeries[i];
    }
    let signalLine = sum / signalPeriod;

    for (let i = signalPeriod; i < macdLineSeries.length; i++) {
      signalLine = macdLineSeries[i] * k + signalLine * (1 - k);
    }

    const latestMacd = macdLineSeries[macdLineSeries.length - 1];
    const histogram = latestMacd - signalLine;

    return {
      macdLine: latestMacd,
      signalLine,
      histogram,
    };
  }

  /**
   * Average True Range (ATR)
   */
  static calculateATR(candles: NormalizedCandle[], period = 14): number {
    if (candles.length <= period) return 0; // Require sufficient candles to compute ATR

    const trs: number[] = [];
    for (let i = 1; i < candles.length; i++) {
      const high = candles[i].high;
      const low = candles[i].low;
      const prevClose = candles[i - 1].close;

      const tr = Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose)
      );
      trs.push(tr);
    }

    if (trs.length < period) return 0;

    // Initial ATR is simple average of first period TRs
    let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;

    // Wilder's smoothing for subsequent periods
    for (let i = period; i < trs.length; i++) {
      atr = (atr * (period - 1) + trs[i]) / period;
    }

    return atr;
  }

  /**
   * Bollinger Bands
   */
  static calculateBollingerBands(
    candles: NormalizedCandle[],
    period = 20,
    stdDevMultiplier = 2
  ): BollingerBandsResult | null {
    if (candles.length < period) return null;

    const slice = candles.slice(-period);
    const sum = slice.reduce((acc, c) => acc + c.close, 0);
    const middle = sum / period;

    const variance = slice.reduce((acc, c) => acc + Math.pow(c.close - middle, 2), 0) / period;
    const stdDev = Math.sqrt(variance);

    return {
      upper: middle + stdDev * stdDevMultiplier,
      middle,
      lower: middle - stdDev * stdDevMultiplier,
    };
  }
}
