import { NormalizedCandle, SignalDirection } from '../../types/index.js';
import { TechnicalIndicators } from './TechnicalIndicators.js';
import { logger } from '../logger.js';

export interface ScoringFactors {
  trendScore: number;
  structureScore: number;
  momentumScore: number;
  volatilityScore: number;
  volumeScore: number;
  riskRewardScore: number;
  freshnessAgreementScore: number;
  totalScore: number;
}

export interface ScoringResult {
  isValid: boolean;
  score: number;
  direction: SignalDirection;
  rejectionReason?: string;
  confluenceReasons: string[];
  stopLoss: number;
  takeProfit: number;
  riskRewardRatio: number;
  targetDistance?: number;
  stopDistance?: number;
  pipPointUnit?: 'PIPS' | 'POINTS';
  timeframesAligned: number;
  totalTimeframesEvaluated: number;
  isTopTradeCandidate: boolean;
  estimatedFriction: {
    spreadPipsOrPoints: number;
    feeBufferPct: number;
    netRiskRewardRatio: number;
  };
  hypotheticalRisk: {
    suggestedRiskAmount: number;
    suggestedPositionSize: number;
  };
  factors: ScoringFactors;
  technicalMetrics?: {
    htfEma9: number;
    htfEma21: number;
    htfRsi: number;
    ltfEma9: number;
    ltfEma21: number;
    ltfRsi: number;
    ltfMacdHistogram: number;
    atr: number;
  };
}

interface AssetExecutionProfile {
  assetClass: 'CRYPTO' | 'FOREX' | 'STOCK' | 'INDEX';
  precision: number;
  pipMultiplier: number;
  pipPointUnit: 'PIPS' | 'POINTS';
  estimatedSpreadUnits: number;
  estimatedFeeBufferPct: number;
  minPracticalTargetDistance: number;
  minPracticalStopDistance: number;
}

export class ScoringEngine {
  /**
   * Estimates win rate based on technical score and risk/reward ratio.
   */
  static estimateWinRate(score: number, rr: number): number {
    const baseWinRate = 25;
    const scoreFactor = score / 4; 
    const rrFactor = Math.min(rr * 5, 20); 
    return Math.min(95, baseWinRate + scoreFactor + rrFactor);
  }

  /**
   * Calculates hypothetical risk sizing based on a default balance and risk percentage.
   */
  static calculateHypotheticalRisk(entry: number, stopLoss: number, minStopDistance: number): { suggestedRiskAmount: number, suggestedPositionSize: number } {
    const hypotheticalBalance = 1000; // Default hypothetical balance
    const riskPercent = 0.01; // 1%
    const riskAmount = hypotheticalBalance * riskPercent;
    const riskDistance = Math.max(Math.abs(entry - stopLoss), minStopDistance);
    const positionSize = riskAmount / riskDistance;
    return {
      suggestedRiskAmount: Number(riskAmount.toFixed(2)),
      suggestedPositionSize: Number(positionSize.toFixed(4)),
    };
  }

  /**
   * Evaluates all scoring components deterministically based on real, validated market data.
   * Enforces realistic execution hurdles (ATR, S/R structure, spread, fees, slippage, and market noise).
   */
  static calculateScore(
    symbol: string,
    entryPrice: number,
    candlesMap: Record<string, NormalizedCandle[]>,
    newsSentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL',
    crossCheckAgreementPct: number
  ): ScoringResult {
    const cleanSymbol = symbol.trim().toUpperCase();
    const confluenceReasons: string[] = [];

    // 1. Gather available timeframe candles
    const tf15m = candlesMap['15m'] || [];
    const tf1h = candlesMap['1h'] || [];
    const tf1d = candlesMap['1d'] || [];
    const tf5m = candlesMap['5m'] || [];
    const tf30m = candlesMap['30m'] || [];
    const tf4h = candlesMap['4h'] || [];

    // Require 15m and 1h candles as primary baseline
    if (tf15m.length < 35 || tf1h.length < 35) {
      return this.createRejection('Insufficient candle data in primary baseline (15m/1h required with min 35 candles)');
    }

    // Sort ascending
    const s15m = [...tf15m].sort((a, b) => a.timestamp - b.timestamp);
    const s1h = [...tf1h].sort((a, b) => a.timestamp - b.timestamp);
    const s1d = tf1d.length > 0 ? [...tf1d].sort((a, b) => a.timestamp - b.timestamp) : [];
    const s5m = tf5m.length > 0 ? [...tf5m].sort((a, b) => a.timestamp - b.timestamp) : [];
    const s30m = tf30m.length > 0 ? [...tf30m].sort((a, b) => a.timestamp - b.timestamp) : [];
    const s4h = tf4h.length > 0 ? [...tf4h].sort((a, b) => a.timestamp - b.timestamp) : [];

    // Calculate core technical indicators
    const ema9_15m = TechnicalIndicators.calculateEMA(s15m, 9);
    const ema21_15m = TechnicalIndicators.calculateEMA(s15m, 21);
    const rsi_15m = TechnicalIndicators.calculateRSI(s15m, 14);
    const macd_15m = TechnicalIndicators.calculateMACD(s15m, 12, 26, 9);
    const atr_15m = TechnicalIndicators.calculateATR(s15m, 14);

    const ema9_1h = TechnicalIndicators.calculateEMA(s1h, 9);
    const ema21_1h = TechnicalIndicators.calculateEMA(s1h, 21);
    const rsi_1h = TechnicalIndicators.calculateRSI(s1h, 14);
    const atr_1h = TechnicalIndicators.calculateATR(s1h, 14);

    if (
      ema9_15m.length === 0 ||
      ema21_15m.length === 0 ||
      rsi_15m.length === 0 ||
      !macd_15m ||
      ema9_1h.length === 0 ||
      ema21_1h.length === 0 ||
      rsi_1h.length === 0 ||
      atr_15m <= 0 ||
      atr_1h <= 0
    ) {
      return this.createRejection('Failed to compute authoritative baseline technical indicators (insufficient candle depth)');
    }

    const lastEma9_15m = ema9_15m[ema9_15m.length - 1];
    const lastEma21_15m = ema21_15m[ema21_15m.length - 1];
    const lastRsi_15m = rsi_15m[rsi_15m.length - 1];

    const lastEma9_1h = ema9_1h[ema9_1h.length - 1];
    const lastEma21_1h = ema21_1h[ema21_1h.length - 1];
    const lastRsi_1h = rsi_1h[rsi_1h.length - 1];

    // Determine baseline direction from 15m/1H momentum alignment
    let direction: SignalDirection | null = null;
    if (lastEma9_15m > lastEma21_15m && lastEma9_1h > lastEma21_1h) {
      direction = 'BUY';
    } else if (lastEma9_15m < lastEma21_15m && lastEma9_1h < lastEma21_1h) {
      direction = 'SELL';
    }

    if (!direction) {
      direction = lastEma9_1h > lastEma21_1h ? 'BUY' : 'SELL';
    }

    // --- Component 1: Multi-Timeframe Trend Alignment (Max 25 Points) ---
    let trendScore = 0;
    let timeframesAligned = 0;
    let totalTfsEvaluated = 6; // Standard 6 timeframes: 5m, 15m, 30m, 1H, 4H, 1D

    // Check 15m
    if ((direction === 'BUY' && entryPrice > lastEma21_15m) || (direction === 'SELL' && entryPrice < lastEma21_15m)) {
      timeframesAligned++;
    }

    // Check 1H
    if ((direction === 'BUY' && entryPrice > lastEma21_1h) || (direction === 'SELL' && entryPrice < lastEma21_1h)) {
      timeframesAligned++;
    }

    // Check 1D if available
    if (s1d.length >= 10) {
      const ema21_1d = TechnicalIndicators.calculateEMA(s1d, 21);
      if (ema21_1d.length > 0) {
        const lastEma21_1d = ema21_1d[ema21_1d.length - 1];
        if ((direction === 'BUY' && entryPrice > lastEma21_1d) || (direction === 'SELL' && entryPrice < lastEma21_1d)) {
          timeframesAligned++;
        }
      }
    } else {
      confluenceReasons.push('1D timeframe data unavailable — 0 points assigned');
    }

    // Check 30m if available
    if (s30m.length >= 10) {
      const ema21_30m = TechnicalIndicators.calculateEMA(s30m, 21);
      if (ema21_30m.length > 0) {
        const lastEma21_30m = ema21_30m[ema21_30m.length - 1];
        if ((direction === 'BUY' && entryPrice > lastEma21_30m) || (direction === 'SELL' && entryPrice < lastEma21_30m)) {
          timeframesAligned++;
        }
      }
    } else {
      confluenceReasons.push('30m timeframe data unavailable — 0 points assigned');
    }

    // Check 5m if available
    if (s5m.length >= 10) {
      const ema21_5m = TechnicalIndicators.calculateEMA(s5m, 21);
      if (ema21_5m.length > 0) {
        const lastEma21_5m = ema21_5m[ema21_5m.length - 1];
        if ((direction === 'BUY' && entryPrice > lastEma21_5m) || (direction === 'SELL' && entryPrice < lastEma21_5m)) {
          timeframesAligned++;
        }
      }
    } else {
      confluenceReasons.push('5m timeframe data unavailable — 0 points assigned');
    }

    // Check 4H if available
    if (s4h.length >= 10) {
      const ema21_4h = TechnicalIndicators.calculateEMA(s4h, 21);
      if (ema21_4h.length > 0) {
        const lastEma21_4h = ema21_4h[ema21_4h.length - 1];
        if ((direction === 'BUY' && entryPrice > lastEma21_4h) || (direction === 'SELL' && entryPrice < lastEma21_4h)) {
          timeframesAligned++;
        }
      }
    } else {
      confluenceReasons.push('4H timeframe data unavailable — 0 points assigned');
    }

    const alignmentRatio = timeframesAligned / totalTfsEvaluated;
    
    // Gate 7: Require at least 3 timeframes aligned for any trade
    if (timeframesAligned < 3) {
      return this.createRejection(`Insufficient multi-timeframe confirmation: only ${timeframesAligned}/${totalTfsEvaluated} aligned (minimum 3 required)`);
    }

    trendScore = Math.round(alignmentRatio * 25);
    confluenceReasons.push(`Multi-TF Trend aligned: ${timeframesAligned}/${totalTfsEvaluated} timeframes confirm ${direction} direction`);

    // --- Component 2: Market Structure (Max 15 Points) ---
    let structureScore = 0;
    const emaAlignment15m = (direction === 'BUY' && lastEma9_15m > lastEma21_15m) || (direction === 'SELL' && lastEma9_15m < lastEma21_15m);
    const emaAlignment1h = (direction === 'BUY' && lastEma9_1h > lastEma21_1h) || (direction === 'SELL' && lastEma9_1h < lastEma21_1h);

    if (emaAlignment15m && emaAlignment1h) {
      structureScore = 15;
      confluenceReasons.push('Market structure is organized: EMA9 & EMA21 hierarchically ordered across 15m and 1H');
    } else if (emaAlignment15m || emaAlignment1h) {
      structureScore = 8;
      confluenceReasons.push('Market structure is moderately aligned');
    }

    // --- Component 3: Momentum Indicators (Max 15 Points) ---
    let momentumScore = 0;
    let momentumFactors = 0;

    if (direction === 'BUY') {
      if (lastRsi_15m >= 45 && lastRsi_15m <= 65) {
        momentumFactors += 5; // Healthy buying zone (not overbought)
      }
      if (lastRsi_1h >= 40 && lastRsi_1h <= 65) {
        momentumFactors += 5; // Macro momentum supports
      }
      if (macd_15m.histogram >= 0) {
        momentumFactors += 5; // Bullish histogram expansion
      }
    } else {
      if (lastRsi_15m <= 55 && lastRsi_15m >= 35) {
        momentumFactors += 5; // Healthy selling zone (not oversold)
      }
      if (lastRsi_1h <= 60 && lastRsi_1h >= 35) {
        momentumFactors += 5; // Macro momentum supports
      }
      if (macd_15m.histogram <= 0) {
        momentumFactors += 5; // Bearish histogram expansion
      }
    }

    momentumScore = momentumFactors;
    confluenceReasons.push(`Momentum indicators verified (RSI 15m: ${lastRsi_15m.toFixed(1)}, RSI 1h: ${lastRsi_1h.toFixed(1)}, MACD Hist: ${macd_15m.histogram > 0 ? '+' : ''}${macd_15m.histogram.toFixed(decimals(entryPrice))})`);

    // --- Component 4: Volatility, Key Level Proximity & Entry Quality (Max 15 Points) ---
    let volatilityScore = 0;
    
    // Support/Resistance calculation from recent swings (15m & 1H)
    const lows15m = s15m.slice(-14).map((c) => c.low);
    const highs15m = s15m.slice(-14).map((c) => c.high);
    const support15m = Math.min(...lows15m);
    const resistance15m = Math.max(...highs15m);

    const lows1h = s1h.slice(-14).map((c) => c.low);
    const highs1h = s1h.slice(-14).map((c) => c.high);
    const majorSupport1h = lows1h.length > 0 ? Math.min(...lows1h) : support15m;
    const majorResistance1h = highs1h.length > 0 ? Math.max(...highs1h) : resistance15m;

    let isNearKeyLevel = false;
    if (direction === 'BUY') {
      const distanceToSupport = Math.abs(entryPrice - support15m);
      isNearKeyLevel = distanceToSupport <= 1.25 * atr_15m;
    } else {
      const distanceToResistance = Math.abs(resistance15m - entryPrice);
      isNearKeyLevel = distanceToResistance <= 1.25 * atr_15m;
    }

    if (isNearKeyLevel) {
      volatilityScore += 10;
      confluenceReasons.push(`Optimal entry zone confirmed near structural support/resistance boundary (<= 1.25x ATR)`);
    } else {
      volatilityScore += 4;
    }

    // Bollinger Band pullback evaluation
    const bb = TechnicalIndicators.calculateBollingerBands(s15m, 20, 2);
    if (bb) {
      if (direction === 'BUY' && entryPrice <= bb.middle) {
        volatilityScore += 5;
        confluenceReasons.push('Pullback entry validated near/below Bollinger Band median');
      } else if (direction === 'SELL' && entryPrice >= bb.middle) {
        volatilityScore += 5;
        confluenceReasons.push('Pullback entry validated near/above Bollinger Band median');
      }
    }

    // --- Component 5: Volume Confirmation (Max 10 Points) ---
    let volumeScore = 0;
    const totalVolume = s15m.slice(-20).reduce((acc, c) => acc + (c.volume || 0), 0);
    const avgVolume = totalVolume / 20;
    const latestVolume = s15m[s15m.length - 1].volume || 0;

    if (latestVolume > 0 && avgVolume > 0) {
      if (latestVolume >= avgVolume * 1.05) {
        volumeScore = 10;
        confluenceReasons.push(`Volume expansion confirmed: ${Math.round(latestVolume)} vs 20-period avg of ${Math.round(avgVolume)} (+${Math.round(((latestVolume - avgVolume) / avgVolume) * 100)}%)`);
      } else if (latestVolume >= avgVolume * 0.9) {
        volumeScore = 5;
        confluenceReasons.push('Standard liquid volume validated');
      }
    } else {
      volumeScore = 0; // Volume data unavailable - 0 points assigned
      confluenceReasons.push('Volume data unavailable — 0 points assigned');
    }

    // --- Component 6: Gate 7 Dynamic Execution Realism, ATR SL/TP & Friction Hurdle ---
    const profile = this.getAssetExecutionProfile(cleanSymbol, entryPrice, atr_15m);

    // Calculate ATR-based and Structure-based Stop Loss & Take Profit
    let stopLoss = 0;
    let takeProfit = 0;
    const precision = profile.precision;

    if (direction === 'BUY') {
      // SL placed below swing support with ATR buffer
      const structuralSl = support15m - (atr_15m * 0.5);
      const minDistanceSl = entryPrice - profile.minPracticalStopDistance;
      const proposedSl = Math.min(structuralSl, minDistanceSl);
      stopLoss = Number(proposedSl.toFixed(precision));

      // TP placed at major 1H resistance or extended projection
      let proposedTp: number;
      if (majorResistance1h > entryPrice + profile.minPracticalTargetDistance) {
        proposedTp = majorResistance1h - (atr_15m * 0.15);
      } else {
        const structuralExtension = entryPrice + Math.max(profile.minPracticalTargetDistance, (entryPrice - stopLoss) * 2.0);
        proposedTp = structuralExtension;
      }
      takeProfit = Number(proposedTp.toFixed(precision));
    } else {
      // SL placed above swing resistance with ATR buffer
      const structuralSl = resistance15m + (atr_15m * 0.5);
      const minDistanceSl = entryPrice + profile.minPracticalStopDistance;
      const proposedSl = Math.max(structuralSl, minDistanceSl);
      stopLoss = Number(proposedSl.toFixed(precision));

      // TP placed at major 1H support or extended projection
      let proposedTp: number;
      if (majorSupport1h > 0 && majorSupport1h < entryPrice - profile.minPracticalTargetDistance) {
        proposedTp = majorSupport1h + (atr_15m * 0.15);
      } else {
        const structuralExtension = entryPrice - Math.max(profile.minPracticalTargetDistance, (stopLoss - entryPrice) * 2.0);
        proposedTp = structuralExtension;
      }
      takeProfit = Number(proposedTp.toFixed(precision));
    }

    // Basic Trade Geometry Validation
    if (direction === 'BUY' && (stopLoss >= entryPrice || takeProfit <= entryPrice)) {
      return this.createRejection('Invalid trade geometry: BUY direction requires SL < Entry < TP');
    }
    if (direction === 'SELL' && (stopLoss <= entryPrice || takeProfit >= entryPrice)) {
      return this.createRejection('Invalid trade geometry: SELL direction requires SL > Entry > TP');
    }

    const rawRisk = Math.abs(entryPrice - stopLoss);
    const rawReward = Math.abs(takeProfit - entryPrice);

    // Gate 7: Zero or near-zero distance check
    if (rawRisk <= 0 || rawReward <= 0) {
      return this.createRejection('Invalid SL/TP placement: zero or negative distance');
    }

    // Gate 7: Asset-specific Minimum Practical Stop Distance
    if (rawRisk < profile.minPracticalStopDistance) {
      return this.createRejection(
        `Stop loss is unrealistically tight for ${cleanSymbol} (${rawRisk.toFixed(precision)} < minimum practical volatility stop of ${profile.minPracticalStopDistance.toFixed(precision)})`
      );
    }

    // Gate 7: Asset-specific Minimum Practical Target Distance (Friction & Noise Hurdle)
    if (rawReward < profile.minPracticalTargetDistance) {
      return this.createRejection(
        `Expected take profit distance (${rawReward.toFixed(precision)}) is too small to realistically overcome spread, fees, slippage and market noise (min required: ${profile.minPracticalTargetDistance.toFixed(precision)})`
      );
    }

    const rawRiskRewardRatio = Number((rawReward / rawRisk).toFixed(2));

    if (rawRiskRewardRatio < 2.0) {
      return this.createRejection(`Unfavorable risk/reward profile: calculated R:R is ${rawRiskRewardRatio}:1 (minimum requirement is 2:1)`);
    }

    if (rawRiskRewardRatio > 4.5 && timeframesAligned < 4) {
      return this.createRejection(`Unrealistically high R:R (${rawRiskRewardRatio}:1) requires 4+ timeframe confluence (only ${timeframesAligned} aligned)`);
    }

    // Gate 7: Execution Friction & Net R:R Hurdle
    const spreadInPrice = profile.estimatedSpreadUnits;
    const feeInPrice = entryPrice * profile.estimatedFeeBufferPct;
    const totalFriction = spreadInPrice + feeInPrice;

    const netReward = Math.max(0, rawReward - totalFriction);
    const effectiveRisk = rawRisk + totalFriction;
    const netRiskRewardRatio = effectiveRisk > 0 ? Number((netReward / effectiveRisk).toFixed(2)) : 0;

    if (netRiskRewardRatio < 1.5) {
      return this.createRejection(
        `Net risk/reward after spread and fees (${netRiskRewardRatio}:1) fails minimum 1.5:1 realistic execution threshold (Spread: ${spreadInPrice.toFixed(precision)}, Fees: ${feeInPrice.toFixed(precision)})`
      );
    }

    let riskRewardScore = 0;
    if (netRiskRewardRatio >= 1.5 && netRiskRewardRatio <= 3.8) {
      riskRewardScore = 10;
      confluenceReasons.push(`Realistic execution asymmetry confirmed: Raw R:R ${rawRiskRewardRatio}:1 (Net ${netRiskRewardRatio}:1 after estimated friction)`);
    } else if (netRiskRewardRatio > 3.8) {
      riskRewardScore = 6;
      confluenceReasons.push(`High asymmetric R:R profile (${rawRiskRewardRatio}:1 / Net ${netRiskRewardRatio}:1) with multi-timeframe backing`);
    } else {
      riskRewardScore = 4;
    }

    // --- Component 7: Data Freshness & Cross-Source Agreement (Max 10 Points) ---
    let freshnessAgreementScore = 0;
    if (crossCheckAgreementPct >= 99.0) {
      freshnessAgreementScore = 10;
    } else if (crossCheckAgreementPct >= 98.5) {
      freshnessAgreementScore = 5;
    } else {
      return this.createRejection(`Poor cross-source price agreement: ${crossCheckAgreementPct}% (tolerance limit is 98.5%)`);
    }

    // News/Sentiment modifier
    let finalScoreBonus = 0;
    if (direction === 'BUY' && newsSentiment === 'BULLISH') finalScoreBonus = 5;
    if (direction === 'SELL' && newsSentiment === 'BEARISH') finalScoreBonus = 5;
    if (direction === 'BUY' && newsSentiment === 'BEARISH') finalScoreBonus = -10;
    if (direction === 'SELL' && newsSentiment === 'BULLISH') finalScoreBonus = -10;

    // Total Score Computation
    const baseTotal = trendScore + structureScore + momentumScore + volatilityScore + volumeScore + riskRewardScore + freshnessAgreementScore;
    const totalScore = Math.max(0, Math.min(100, baseTotal + finalScoreBonus));

    // Minimum Quality Check Threshold
    if (totalScore < 70) {
      return this.createRejection(`Deterministic setup quality score ${totalScore}/100 fell below the strict Gate 7 requirement limit of 70`);
    }

    // Gate 7: Check if setup qualifies for TOP TRADE classification (requires score >= 80, >= 4 TFs aligned, and solid structure)
    const isTopTradeCandidate = totalScore >= 80 && timeframesAligned >= 4 && structureScore >= 12;

    const targetDistance = Number((rawReward * profile.pipMultiplier).toFixed(1));
    const stopDistance = Number((rawRisk * profile.pipMultiplier).toFixed(1));
    const spreadPipsOrPoints = Number((spreadInPrice * profile.pipMultiplier).toFixed(1));

    const factors: ScoringFactors = {
      trendScore,
      structureScore,
      momentumScore,
      volatilityScore,
      volumeScore,
      riskRewardScore,
      freshnessAgreementScore,
      totalScore,
    };

    const hypotheticalRisk = this.calculateHypotheticalRisk(entryPrice, stopLoss, profile.minPracticalStopDistance);

    const technicalMetrics = {
      htfEma9: Number(lastEma9_1h.toFixed(precision)),
      htfEma21: Number(lastEma21_1h.toFixed(precision)),
      htfRsi: Number(lastRsi_1h.toFixed(2)),
      ltfEma9: Number(lastEma9_15m.toFixed(precision)),
      ltfEma21: Number(lastEma21_15m.toFixed(precision)),
      ltfRsi: Number(lastRsi_15m.toFixed(2)),
      ltfMacdHistogram: Number(macd_15m.histogram.toFixed(precision)),
      atr: Number(atr_15m.toFixed(precision)),
    };

    return {
      isValid: true,
      score: totalScore,
      direction,
      confluenceReasons,
      stopLoss,
      takeProfit,
      riskRewardRatio: rawRiskRewardRatio,
      targetDistance,
      stopDistance,
      pipPointUnit: profile.pipPointUnit,
      timeframesAligned,
      totalTimeframesEvaluated: totalTfsEvaluated,
      isTopTradeCandidate,
      estimatedFriction: {
        spreadPipsOrPoints,
        feeBufferPct: Number((profile.estimatedFeeBufferPct * 100).toFixed(3)),
        netRiskRewardRatio,
      },
      hypotheticalRisk,
      factors,
      technicalMetrics,
    };
  }

  /**
   * Generates asset-specific execution hurdles (spread, fee buffer, minimum practical distances)
   * tailored to each asset's market characteristics.
   */
  private static getAssetExecutionProfile(
    symbol: string,
    entryPrice: number,
    atr15m: number
  ): AssetExecutionProfile {
    const isCrypto = symbol.includes('BTC') || symbol.includes('ETH') || symbol.includes('SOL');
    const isJPY = symbol.includes('JPY');
    const isForex = symbol.includes('USD') && (symbol.includes('EUR') || symbol.includes('GBP') || isJPY);

    if (isCrypto) {
      const precision = entryPrice < 100 ? 2 : 2;
      return {
        assetClass: 'CRYPTO',
        precision,
        pipMultiplier: 1,
        pipPointUnit: 'POINTS',
        estimatedSpreadUnits: entryPrice * 0.0003, // ~0.03% spread
        estimatedFeeBufferPct: 0.0010, // ~0.10% taker fee + slippage
        minPracticalTargetDistance: Math.max(entryPrice * 0.0035, atr15m * 1.0), // at least 35 bps or 1x ATR
        minPracticalStopDistance: Math.max(entryPrice * 0.0020, atr15m * 0.8), // at least 20 bps or 0.8x ATR
      };
    }

    if (isForex) {
      const precision = isJPY ? 3 : 5;
      const pipMultiplier = isJPY ? 100 : 10000;
      const spreadPips = isJPY ? 0.015 : 0.00015; // 1.5 pips
      const minTargetPips = isJPY ? 0.15 : 0.0012; // 12-15 pips
      const minStopPips = isJPY ? 0.08 : 0.0008; // 8 pips

      return {
        assetClass: 'FOREX',
        precision,
        pipMultiplier,
        pipPointUnit: 'PIPS',
        estimatedSpreadUnits: spreadPips,
        estimatedFeeBufferPct: 0.00005, // 0.5 pip equivalent commission
        minPracticalTargetDistance: Math.max(minTargetPips, atr15m * 1.0),
        minPracticalStopDistance: Math.max(minStopPips, atr15m * 0.8),
      };
    }

    // Stocks (AAPL, NVDA, MSFT)
    const precision = 2;
    return {
      assetClass: 'STOCK',
      precision,
      pipMultiplier: 1,
      pipPointUnit: 'POINTS',
      estimatedSpreadUnits: Math.max(0.08, entryPrice * 0.0004), // $0.08 - $0.15 spread
      estimatedFeeBufferPct: 0.0005, // ~0.05% slippage/commission
      minPracticalTargetDistance: Math.max(entryPrice * 0.0040, atr15m * 1.0), // at least 40 bps or 1x ATR
      minPracticalStopDistance: Math.max(entryPrice * 0.0025, atr15m * 0.8), // at least 25 bps or 0.8x ATR
    };
  }

  private static createRejection(reason: string): ScoringResult {
    return {
      isValid: false,
      score: 0,
      direction: 'BUY',
      rejectionReason: reason,
      confluenceReasons: [],
      stopLoss: 0,
      takeProfit: 0,
      riskRewardRatio: 0,
      targetDistance: 0,
      stopDistance: 0,
      pipPointUnit: 'POINTS',
      timeframesAligned: 0,
      totalTimeframesEvaluated: 0,
      isTopTradeCandidate: false,
      estimatedFriction: {
        spreadPipsOrPoints: 0,
        feeBufferPct: 0,
        netRiskRewardRatio: 0,
      },
      hypotheticalRisk: {
        suggestedRiskAmount: 0,
        suggestedPositionSize: 0,
      },
      factors: {
        trendScore: 0,
        structureScore: 0,
        momentumScore: 0,
        volatilityScore: 0,
        volumeScore: 0,
        riskRewardScore: 0,
        freshnessAgreementScore: 0,
        totalScore: 0,
      },
    };
  }
}

function decimals(price: number): number {
  return price < 10 ? 5 : 2;
}
