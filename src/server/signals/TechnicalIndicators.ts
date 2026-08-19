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
   * Average Directional Index (ADX)
   */
  static calculateADX(candles: NormalizedCandle[], period = 14): { adx: number; pdi: number; mdi: number } | null {
    if (candles.length <= period * 2) return null;

    let trSum = 0;
    let pdmSum = 0;
    let mdmSum = 0;

    // Initial true range and directional movement
    for (let i = 1; i <= period; i++) {
      const high = candles[i].high;
      const low = candles[i].low;
      const prevHigh = candles[i - 1].high;
      const prevLow = candles[i - 1].low;
      const prevClose = candles[i - 1].close;

      const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
      trSum += tr;

      const upMove = high - prevHigh;
      const downMove = prevLow - low;

      let pdm = 0;
      let mdm = 0;

      if (upMove > downMove && upMove > 0) {
        pdm = upMove;
      } else if (downMove > upMove && downMove > 0) {
        mdm = downMove;
      }

      pdmSum += pdm;
      mdmSum += mdm;
    }

    let pdi = trSum === 0 ? 0 : (pdmSum / trSum) * 100;
    let mdi = trSum === 0 ? 0 : (mdmSum / trSum) * 100;

    const dxList: number[] = [];
    let dx = pdi + mdi === 0 ? 0 : (Math.abs(pdi - mdi) / (pdi + mdi)) * 100;
    dxList.push(dx);

    let adx = 0;

    // Wilder's smoothing
    for (let i = period + 1; i < candles.length; i++) {
      const high = candles[i].high;
      const low = candles[i].low;
      const prevHigh = candles[i - 1].high;
      const prevLow = candles[i - 1].low;
      const prevClose = candles[i - 1].close;

      const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
      trSum = trSum - (trSum / period) + tr;

      const upMove = high - prevHigh;
      const downMove = prevLow - low;

      let pdm = 0;
      let mdm = 0;
      if (upMove > downMove && upMove > 0) pdm = upMove;
      else if (downMove > upMove && downMove > 0) mdm = downMove;

      pdmSum = pdmSum - (pdmSum / period) + pdm;
      mdmSum = mdmSum - (mdmSum / period) + mdm;

      pdi = trSum === 0 ? 0 : (pdmSum / trSum) * 100;
      mdi = trSum === 0 ? 0 : (mdmSum / trSum) * 100;

      dx = pdi + mdi === 0 ? 0 : (Math.abs(pdi - mdi) / (pdi + mdi)) * 100;
      dxList.push(dx);
    }

    if (dxList.length < period) return null;

    // Initial ADX
    adx = dxList.slice(0, period).reduce((a, b) => a + b, 0) / period;

    // Subsequent ADX
    for (let i = period; i < dxList.length; i++) {
      adx = (adx * (period - 1) + dxList[i]) / period;
    }

    return { adx, pdi, mdi };
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

  /**
   * Simple Moving Average (SMA)
   */
  static calculateSMA(candles: NormalizedCandle[], period: number): number[] {
    if (candles.length < period) return [];

    const smaValues: number[] = [];
    for (let i = period - 1; i < candles.length; i++) {
      const slice = candles.slice(i - period + 1, i + 1);
      const sum = slice.reduce((acc, c) => acc + c.close, 0);
      smaValues.push(sum / period);
    }
    return smaValues;
  }

  /**
   * Zero-Lag Exponential Moving Average (ZLEMA)
   * Formula: lag = (period - 1) / 2; zldata = close + (close - close[lag]); ZLEMA = EMA(zldata, period)
   */
  static calculateZLEMA(candles: NormalizedCandle[], period: number): number[] {
    const lag = Math.floor((period - 1) / 2);
    if (candles.length < period + lag) return [];

    // Create zero-lag adjusted series
    const zlCloses: number[] = [];
    for (let i = lag; i < candles.length; i++) {
      const current = candles[i].close;
      const lagged = candles[i - lag].close;
      zlCloses.push(current + (current - lagged));
    }

    if (zlCloses.length < period) return [];

    const k = 2 / (period + 1);
    const zlemaValues: number[] = [];

    let sum = 0;
    for (let i = 0; i < period; i++) {
      sum += zlCloses[i];
    }
    let currentZlema = sum / period;
    zlemaValues.push(currentZlema);

    for (let i = period; i < zlCloses.length; i++) {
      currentZlema = zlCloses[i] * k + currentZlema * (1 - k);
      zlemaValues.push(currentZlema);
    }

    return zlemaValues;
  }

  /**
   * Zero-Lag MACD (ZL-MACD)
   * Fast ZLEMA - Slow ZLEMA, Signal Line = ZLEMA of ZL-MACD line
   */
  static calculateZeroLagMACD(
    candles: NormalizedCandle[],
    fastPeriod = 12,
    slowPeriod = 26,
    signalPeriod = 9
  ): MACDResult | null {
    const fastZlema = this.calculateZLEMA(candles, fastPeriod);
    const slowZlema = this.calculateZLEMA(candles, slowPeriod);

    if (fastZlema.length === 0 || slowZlema.length === 0) return null;

    // Offset alignment
    const offset = fastZlema.length - slowZlema.length;
    if (offset < 0) return null;

    const zlMacdLine: number[] = [];
    for (let i = 0; i < slowZlema.length; i++) {
      zlMacdLine.push(fastZlema[i + offset] - slowZlema[i]);
    }

    if (zlMacdLine.length < signalPeriod) return null;

    // Signal line using EMA / smoothing of ZL-MACD line
    const k = 2 / (signalPeriod + 1);
    let sum = 0;
    for (let i = 0; i < signalPeriod; i++) {
      sum += zlMacdLine[i];
    }
    let signalLine = sum / signalPeriod;

    for (let i = signalPeriod; i < zlMacdLine.length; i++) {
      signalLine = zlMacdLine[i] * k + signalLine * (1 - k);
    }

    const latestMacd = zlMacdLine[zlMacdLine.length - 1];
    const histogram = latestMacd - signalLine;

    return {
      macdLine: latestMacd,
      signalLine,
      histogram,
    };
  }

  /**
   * Donchian Channels / Dynamic High-Low Range
   */
  static calculateDonchianChannels(
    candles: NormalizedCandle[],
    period = 20
  ): { upper: number; lower: number; middle: number } | null {
    if (candles.length < period) return null;

    const slice = candles.slice(-period);
    const upper = Math.max(...slice.map((c) => c.high));
    const lower = Math.min(...slice.map((c) => c.low));
    const middle = (upper + lower) / 2;

    return { upper, lower, middle };
  }

  /**
   * Order Flow Imbalance & Delta Proxy Metrics
   * Evaluates buying vs selling volume pressure and bar-by-bar delta
   */
  static calculateOrderFlowMetrics(
    candles: NormalizedCandle[],
    period = 10
  ): {
    buyingPressurePct: number;
    sellingPressurePct: number;
    deltaBias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    volumeSurge: boolean;
    avgVolume: number;
    latestVolume: number;
  } {
    if (candles.length < period) {
      return {
        buyingPressurePct: 50,
        sellingPressurePct: 50,
        deltaBias: 'NEUTRAL',
        volumeSurge: false,
        avgVolume: 0,
        latestVolume: 0,
      };
    }

    const slice = candles.slice(-period);
    let totalBuyingVolume = 0;
    let totalSellingVolume = 0;
    let totalVol = 0;

    for (const c of slice) {
      const range = c.high - c.low;
      const vol = c.volume || 1;
      totalVol += vol;

      if (range > 0) {
        // Buying pressure factor: where close is relative to the low
        const buyFactor = (c.close - c.low) / range;
        const sellFactor = (c.high - c.close) / range;
        totalBuyingVolume += vol * buyFactor;
        totalSellingVolume += vol * sellFactor;
      } else {
        totalBuyingVolume += vol * 0.5;
        totalSellingVolume += vol * 0.5;
      }
    }

    const totalCalculated = totalBuyingVolume + totalSellingVolume;
    const buyingPressurePct = totalCalculated > 0 ? (totalBuyingVolume / totalCalculated) * 100 : 50;
    const sellingPressurePct = totalCalculated > 0 ? (totalSellingVolume / totalCalculated) * 100 : 50;

    let deltaBias: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
    if (buyingPressurePct >= 55) deltaBias = 'BULLISH';
    else if (sellingPressurePct >= 55) deltaBias = 'BEARISH';

    const latestVolume = slice[slice.length - 1].volume || 0;
    const avgVolume = totalVol / period;
    const volumeSurge = latestVolume > 0 && avgVolume > 0 && latestVolume >= avgVolume * 1.2;

    return {
      buyingPressurePct: Number(buyingPressurePct.toFixed(1)),
      sellingPressurePct: Number(sellingPressurePct.toFixed(1)),
      deltaBias,
      volumeSurge,
      avgVolume: Math.round(avgVolume),
      latestVolume: Math.round(latestVolume),
    };
  }

  /**
   * Volatility Structure & Breakdown Protection Metrics
   */
  static calculateVolatilityMetrics(
    candles: NormalizedCandle[],
    atrPeriod = 14
  ): {
    currentAtr: number;
    baselineAtr: number;
    atrRatio: number;
    isSqueeze: boolean;
    isHealthyVolatility: boolean;
    isErratic: boolean;
    isDeadMarket: boolean;
    isValidExpansion: boolean;
  } {
    if (candles.length < atrPeriod + 10) {
      return {
        currentAtr: 0,
        baselineAtr: 0,
        atrRatio: 1,
        isSqueeze: false,
        isHealthyVolatility: true,
        isErratic: false,
        isDeadMarket: false,
        isValidExpansion: false,
      };
    }

    const currentAtr = this.calculateATR(candles, atrPeriod);
    const baselineAtr = this.calculateATR(candles, Math.min(candles.length - 1, 40));

    const atrRatio = baselineAtr > 0 ? currentAtr / baselineAtr : 1.0;
    const isSqueeze = atrRatio < 0.65; // ATR compressed below 65% of baseline
    const isErratic = atrRatio > 2.8; // ATR expanding > 280% (flash erratic breakdown risk)
    const isHealthyVolatility = atrRatio >= 0.70 && atrRatio <= 2.5;

    return {
      currentAtr,
      baselineAtr,
      atrRatio: Number(atrRatio.toFixed(2)),
      isSqueeze,
      isHealthyVolatility,
      isErratic,
      isDeadMarket: atrRatio < 0.45,
      isValidExpansion: atrRatio >= 1.10 && atrRatio <= 2.50,
    };
  }

  /**
   * Calculates the percentage slope of an EMA series over a lookback window.
   * Positive slope indicates upward trajectory; negative indicates downward.
   */
  static calculateEMASlope(emaValues: number[], lookback = 3): number {
    if (!emaValues || emaValues.length < lookback + 1) return 0;
    const current = emaValues[emaValues.length - 1];
    const prev = emaValues[emaValues.length - 1 - lookback];
    if (prev <= 0) return 0;
    return ((current - prev) / prev) * 100;
  }

  /**
   * Evaluates Price Action Market Structure (Higher Highs / Higher Lows vs Lower Highs / Lower Lows)
   */
  static calculateMarketStructure(
    candles: NormalizedCandle[],
    lookback = 15
  ): {
    structureBias: 'BULLISH' | 'BEARISH' | 'RANGE';
    higherHighsCount: number;
    higherLowsCount: number;
    lowerHighsCount: number;
    lowerLowsCount: number;
    swingHigh: number;
    swingLow: number;
  } {
    if (candles.length < 6) {
      return {
        structureBias: 'RANGE',
        higherHighsCount: 0,
        higherLowsCount: 0,
        lowerHighsCount: 0,
        lowerLowsCount: 0,
        swingHigh: 0,
        swingLow: 0,
      };
    }

    const slice = candles.slice(-Math.min(candles.length, lookback));
    const highs = slice.map((c) => c.high);
    const lows = slice.map((c) => c.low);

    const swingHigh = Math.max(...highs);
    const swingLow = Math.min(...lows);

    let higherHighsCount = 0;
    let higherLowsCount = 0;
    let lowerHighsCount = 0;
    let lowerLowsCount = 0;

    for (let i = 1; i < slice.length; i++) {
      if (slice[i].high > slice[i - 1].high) higherHighsCount++;
      else if (slice[i].high < slice[i - 1].high) lowerHighsCount++;

      if (slice[i].low > slice[i - 1].low) higherLowsCount++;
      else if (slice[i].low < slice[i - 1].low) lowerLowsCount++;
    }

    let structureBias: 'BULLISH' | 'BEARISH' | 'RANGE' = 'RANGE';
    if (higherHighsCount > lowerHighsCount && higherLowsCount >= lowerLowsCount) {
      structureBias = 'BULLISH';
    } else if (lowerHighsCount > higherHighsCount && lowerLowsCount >= higherLowsCount) {
      structureBias = 'BEARISH';
    }

    return {
      structureBias,
      higherHighsCount,
      higherLowsCount,
      lowerHighsCount,
      lowerLowsCount,
      swingHigh,
      swingLow,
    };
  }

  /**
   * Evaluates recent candlestick wick rejection (absorption & rejection pressure)
   */
  static calculateWickRejection(
    candles: NormalizedCandle[],
    lookback = 3
  ): {
    lowerWickRejectionPct: number; // Bullish wick rejection (buyers absorbing lows)
    upperWickRejectionPct: number; // Bearish wick rejection (sellers absorbing highs)
    hasBullishWickAbsorption: boolean;
    hasBearishWickAbsorption: boolean;
  } {
    if (candles.length < lookback) {
      return {
        lowerWickRejectionPct: 0,
        upperWickRejectionPct: 0,
        hasBullishWickAbsorption: false,
        hasBearishWickAbsorption: false,
      };
    }

    const slice = candles.slice(-lookback);
    let totalLowerWick = 0;
    let totalUpperWick = 0;
    let totalRange = 0;

    for (const c of slice) {
      const range = c.high - c.low;
      if (range <= 0) continue;
      totalRange += range;

      const bodyTop = Math.max(c.open, c.close);
      const bodyBottom = Math.min(c.open, c.close);

      const upperWick = c.high - bodyTop;
      const lowerWick = bodyBottom - c.low;

      totalUpperWick += upperWick;
      totalLowerWick += lowerWick;
    }

    const lowerWickRejectionPct = totalRange > 0 ? (totalLowerWick / totalRange) * 100 : 0;
    const upperWickRejectionPct = totalRange > 0 ? (totalUpperWick / totalRange) * 100 : 0;

    return {
      lowerWickRejectionPct: Number(lowerWickRejectionPct.toFixed(1)),
      upperWickRejectionPct: Number(upperWickRejectionPct.toFixed(1)),
      hasBullishWickAbsorption: lowerWickRejectionPct >= 38,
      hasBearishWickAbsorption: upperWickRejectionPct >= 38,
    };
  }

  static calculateVWAP(candles: NormalizedCandle[]): number[] {
    const vwapSeries: number[] = [];
    if (candles.length === 0) return vwapSeries;

    let cumulativePV = 0;
    let cumulativeVol = 0;
    let currentDay = new Date(candles[0].timestamp).getUTCDay();

    for (const c of candles) {
      const day = new Date(c.timestamp).getUTCDay();
      if (day !== currentDay) {
        // Reset daily
        cumulativePV = 0;
        cumulativeVol = 0;
        currentDay = day;
      }
      const typicalPrice = (c.high + c.low + c.close) / 3;
      cumulativePV += typicalPrice * c.volume;
      cumulativeVol += c.volume;
      vwapSeries.push(cumulativeVol > 0 ? cumulativePV / cumulativeVol : c.close);
    }
    return vwapSeries;
  }

  static calculateOBV(candles: NormalizedCandle[]): number[] {
    const obvSeries: number[] = [];
    if (candles.length === 0) return obvSeries;

    let obv = 0;
    obvSeries.push(obv);

    for (let i = 1; i < candles.length; i++) {
      const current = candles[i];
      const prev = candles[i - 1];
      if (current.close > prev.close) {
        obv += current.volume;
      } else if (current.close < prev.close) {
        obv -= current.volume;
      }
      obvSeries.push(obv);
    }
    return obvSeries;
  }
}
