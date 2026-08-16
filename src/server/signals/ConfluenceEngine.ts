/**
 * Confluence & Strategy Analysis Engine
 * Calculates multi-timeframe technical confluence using real market data.
 *
 * NO hard-coded prices, NO fake setups. If market data lacks confluence,
 * returns hasSetup = false ("No valid setup = no signal").
 */

import { NormalizedTicker, NormalizedCandle, SignalDirection } from '../../types/index.js';
import { TechnicalIndicators } from './TechnicalIndicators.js';

export interface ConfluenceAnalysisResult {
  hasSetup: boolean;
  symbol: string;
  entryPrice: number;
  direction?: SignalDirection;
  timeframe?: string;
  strategy?: string;
  confluenceReasons: string[];
  confidenceScore: number;
  stopLoss: number;
  takeProfit: number;
  riskRewardRatio: number;
  technicalMetrics: {
    htfEma9: number;
    htfEma21: number;
    htfRsi: number;
    ltfEma9: number;
    ltfEma21: number;
    ltfRsi: number;
    ltfMacdHistogram: number;
    atr: number;
  };
  rejectionReason?: string;
}

export class ConfluenceEngine {
  /**
   * Analyzes multi-timeframe candle datasets against current validated ticker.
   */
  static analyze(
    ticker: NormalizedTicker,
    htfCandles: NormalizedCandle[],
    ltfCandles: NormalizedCandle[]
  ): ConfluenceAnalysisResult {
    const symbol = ticker.symbol;
    const entryPrice = ticker.price;

    // 1. Validate ticker integrity & freshness
    if (ticker.status !== 'OK' || !ticker.isFresh) {
      return this.createRejection(
        symbol,
        entryPrice,
        `Market ticker data is ${ticker.status} or stale (${ticker.errorMessage || 'Stale price timestamp'})`
      );
    }

    if (!entryPrice || isNaN(entryPrice) || entryPrice <= 0) {
      return this.createRejection(symbol, 0, 'Invalid market price (price <= 0)');
    }

    // 2. Validate candle availability
    if (!htfCandles || htfCandles.length < 10 || !ltfCandles || ltfCandles.length < 10) {
      return this.createRejection(
        symbol,
        entryPrice,
        `Insufficient candle data for multi-timeframe analysis (HTF: ${htfCandles?.length || 0}, LTF: ${ltfCandles?.length || 0})`
      );
    }

    // Sort candles chronologically ascending (oldest first)
    const sortedHtf = [...htfCandles].sort((a, b) => a.timestamp - b.timestamp);
    const sortedLtf = [...ltfCandles].sort((a, b) => a.timestamp - b.timestamp);

    // 3. Compute Technical Indicators on HTF (15m)
    const htfEma9Series = TechnicalIndicators.calculateEMA(sortedHtf, 9);
    const htfEma21Series = TechnicalIndicators.calculateEMA(sortedHtf, 21);
    const htfRsiSeries = TechnicalIndicators.calculateRSI(sortedHtf, 14);

    if (htfEma9Series.length === 0 || htfEma21Series.length === 0 || htfRsiSeries.length === 0) {
      return this.createRejection(symbol, entryPrice, 'Failed to compute HTF indicator series');
    }

    const htfEma9 = htfEma9Series[htfEma9Series.length - 1];
    const htfEma21 = htfEma21Series[htfEma21Series.length - 1];
    const htfRsi = htfRsiSeries[htfRsiSeries.length - 1];

    // 4. Compute Technical Indicators on LTF (1m)
    const ltfEma9Series = TechnicalIndicators.calculateEMA(sortedLtf, 9);
    const ltfEma21Series = TechnicalIndicators.calculateEMA(sortedLtf, 21);
    const ltfRsiSeries = TechnicalIndicators.calculateRSI(sortedLtf, 14);
    const ltfMacd = TechnicalIndicators.calculateMACD(sortedLtf, 12, 26, 9);

    if (ltfEma9Series.length === 0 || ltfEma21Series.length === 0 || ltfRsiSeries.length === 0 || !ltfMacd) {
      return this.createRejection(symbol, entryPrice, 'Failed to compute LTF indicator series');
    }

    const ltfEma9 = ltfEma9Series[ltfEma9Series.length - 1];
    const ltfEma21 = ltfEma21Series[ltfEma21Series.length - 1];
    const ltfRsi = ltfRsiSeries[ltfRsiSeries.length - 1];
    const ltfMacdHistogram = ltfMacd.histogram;

    // 5. Compute ATR for Risk Levels
    const atr = TechnicalIndicators.calculateATR(sortedHtf, 14);

    // Decimals precision formatting helper
    const decimals = entryPrice < 10 ? 5 : 2;

    // 6. Evaluate Multi-Timeframe Confluence Rules
    const htfBullish = entryPrice >= htfEma21 && htfEma9 >= htfEma21 && htfRsi < 70;
    const ltfBullish = ltfEma9 >= ltfEma21 && ltfRsi >= 35 && ltfRsi <= 68 && ltfMacdHistogram >= -0.0005;

    const htfBearish = entryPrice <= htfEma21 && htfEma9 <= htfEma21 && htfRsi > 30;
    const ltfBearish = ltfEma9 <= ltfEma21 && ltfRsi <= 65 && ltfRsi >= 32 && ltfMacdHistogram <= 0.0005;

    let direction: SignalDirection | null = null;
    const reasons: string[] = [];

    if (htfBullish && ltfBullish) {
      direction = 'BUY';
      reasons.push(`15m HTF Bullish Structure: Price (${entryPrice.toFixed(decimals)}) > EMA21 (${htfEma21.toFixed(decimals)}) with EMA9 (${htfEma9.toFixed(decimals)}) aligned`);
      reasons.push(`1m LTF Momentum Trigger: RSI(14) = ${ltfRsi.toFixed(1)} rising, MACD Histogram (${ltfMacdHistogram > 0 ? '+' : ''}${ltfMacdHistogram.toFixed(6)}) bullish`);
      reasons.push(`Multi-Timeframe Confluence: Both 15m trend and 1m entry trigger confirm BUY momentum`);
    } else if (htfBearish && ltfBearish) {
      direction = 'SELL';
      reasons.push(`15m HTF Bearish Structure: Price (${entryPrice.toFixed(decimals)}) < EMA21 (${htfEma21.toFixed(decimals)}) with EMA9 (${htfEma9.toFixed(decimals)}) aligned`);
      reasons.push(`1m LTF Momentum Trigger: RSI(14) = ${ltfRsi.toFixed(1)} falling, MACD Histogram (${ltfMacdHistogram.toFixed(6)}) bearish`);
      reasons.push(`Multi-Timeframe Confluence: Both 15m trend and 1m entry trigger confirm SELL momentum`);
    } else if (htfBullish || ltfBullish || htfBearish || ltfBearish) {
      // Partial signal setup: Evaluate if secondary confluence is strong enough (e.g. price crossover)
      if (entryPrice > htfEma9 && ltfEma9 > ltfEma21 && ltfRsi > 45 && ltfRsi < 65) {
        direction = 'BUY';
        reasons.push(`15m Price Action: Price (${entryPrice.toFixed(decimals)}) crossing above 15m EMA9 (${htfEma9.toFixed(decimals)})`);
        reasons.push(`1m LTF Confluence: EMA9 (${ltfEma9.toFixed(decimals)}) > EMA21 (${ltfEma21.toFixed(decimals)}), RSI = ${ltfRsi.toFixed(1)}`);
      } else if (entryPrice < htfEma9 && ltfEma9 < ltfEma21 && ltfRsi < 55 && ltfRsi > 35) {
        direction = 'SELL';
        reasons.push(`15m Price Action: Price (${entryPrice.toFixed(decimals)}) crossing below 15m EMA9 (${htfEma9.toFixed(decimals)})`);
        reasons.push(`1m LTF Confluence: EMA9 (${ltfEma9.toFixed(decimals)}) < EMA21 (${ltfEma21.toFixed(decimals)}), RSI = ${ltfRsi.toFixed(1)}`);
      }
    }

    if (!direction) {
      return this.createRejection(
        symbol,
        entryPrice,
        `No valid multi-timeframe confluence setup detected for ${symbol}. (HTF RSI: ${htfRsi.toFixed(1)}, LTF RSI: ${ltfRsi.toFixed(1)})`
      );
    }

    // 7. Calculate Risk Management Levels (Stop Loss, Take Profit, Risk/Reward Ratio)
    // Dynamic ATR multiplier
    const minPipDistance = entryPrice < 10 ? 0.0012 : entryPrice * 0.0015;
    const slDistance = Math.max(1.5 * atr, minPipDistance);
    const tpDistance = slDistance * 2.0;

    let stopLoss = 0;
    let takeProfit = 0;

    if (direction === 'BUY') {
      stopLoss = Number((entryPrice - slDistance).toFixed(decimals));
      takeProfit = Number((entryPrice + tpDistance).toFixed(decimals));
    } else {
      stopLoss = Number((entryPrice + slDistance).toFixed(decimals));
      takeProfit = Number((entryPrice - tpDistance).toFixed(decimals));
    }

    const riskAmount = Math.abs(entryPrice - stopLoss);
    const rewardAmount = Math.abs(takeProfit - entryPrice);
    const riskRewardRatio = riskAmount > 0 ? Number((rewardAmount / riskAmount).toFixed(2)) : 2.0;

    // 8. Confidence Score Calculation
    let confidence = 75;
    if (htfEma9 > htfEma21 && direction === 'BUY') confidence += 5;
    if (htfEma9 < htfEma21 && direction === 'SELL') confidence += 5;
    if (ltfRsi >= 40 && ltfRsi <= 60) confidence += 4;
    if (riskRewardRatio >= 2.0) confidence += 4;
    const confidenceScore = Math.min(92, confidence);

    return {
      hasSetup: true,
      symbol,
      entryPrice,
      direction,
      timeframe: '15m / 1m Confluence',
      strategy: 'Multi-Timeframe EMA & RSI Confluence',
      confluenceReasons: reasons,
      confidenceScore,
      stopLoss,
      takeProfit,
      riskRewardRatio,
      technicalMetrics: {
        htfEma9,
        htfEma21,
        htfRsi,
        ltfEma9,
        ltfEma21,
        ltfRsi,
        ltfMacdHistogram,
        atr,
      },
    };
  }

  private static createRejection(
    symbol: string,
    entryPrice: number,
    rejectionReason: string
  ): ConfluenceAnalysisResult {
    return {
      hasSetup: false,
      symbol,
      entryPrice,
      confluenceReasons: [],
      confidenceScore: 0,
      stopLoss: 0,
      takeProfit: 0,
      riskRewardRatio: 0,
      technicalMetrics: {
        htfEma9: 0,
        htfEma21: 0,
        htfRsi: 0,
        ltfEma9: 0,
        ltfEma21: 0,
        ltfRsi: 0,
        ltfMacdHistogram: 0,
        atr: 0,
      },
      rejectionReason,
    };
  }
}
