/**
 * GATE 3 — CHEAP PRELIMINARY SCREEN
 *
 * OBJECTIVE:
 * Screen all eligible assets using only inexpensive/cached market information.
 * Strictly avoids requesting full multi-timeframe candle history for all 113 assets.
 *
 * SCORING BREAKDOWN (Total = 100):
 * - Liquidity: 20
 * - Volume: 20
 * - Trend: 20
 * - Momentum: 15
 * - Volatility Quality: 15
 * - Spread / Execution Quality: 10
 *
 * ROUTING / CANDIDATE SELECTION:
 * - <45:   REJECT (Stagnant / Untradeable)
 * - 45–59: REJECT (Sub-threshold Candidate)
 * - 60–69: PRELIMINARY_CANDIDATE (Deserves further analysis)
 * - 70+:   STRONG_PRELIMINARY_CANDIDATE (High-priority candidate)
 *
 * TARGET:
 * 113 assets -> approximately 30–45 candidates survive under normal market conditions.
 *
 * CRITICAL SAFETY RULES:
 * 1. The preliminary score MUST NEVER create a trade signal.
 * 2. It ONLY determines whether an asset qualifies for further, deeper analysis.
 * 3. All rejected assets stop processing immediately to conserve API quotas and compute.
 */

import { NormalizedCandle, NormalizedTicker, SignalDirection } from '../../types/index.js';
import { SymbolNormalizer } from '../market/SymbolNormalizer.js';
import { TechnicalIndicators } from './TechnicalIndicators.js';
import { marketCache, CACHE_TTL } from '../market/CacheStore.js';
import { logger } from '../logger.js';

export type Gate3Routing = 'REJECT' | 'PRELIMINARY_CANDIDATE' | 'STRONG_PRELIMINARY_CANDIDATE';

export interface Gate3ComponentScores {
  liquidity: number;              // 0 - 20
  volume: number;                 // 0 - 20
  trend: number;                  // 0 - 20
  momentum: number;               // 0 - 15
  volatilityQuality: number;      // 0 - 15
  spreadExecutionQuality: number; // 0 - 10
  total: number;                  // 0 - 100
}

export interface Gate3ScreeningMetrics {
  atr: number;
  atrPct: number;
  rangePct: number;
  relativeVolume: number;
  momentumPct: number;
  estimatedSpreadBps: number;
  ema9: number;
  ema21: number;
}

export interface Gate3PreliminaryScreenResult {
  asset: string;
  assetClass: 'CRYPTO' | 'FOREX' | 'STOCK';
  preliminaryScore: number;
  routing: Gate3Routing;
  passed: boolean; // true if score >= 60 (PRELIMINARY_CANDIDATE or STRONG_PRELIMINARY_CANDIDATE)
  direction: SignalDirection;
  componentScores: Gate3ComponentScores;
  metrics: Gate3ScreeningMetrics;
  reason: string;
}

export class Gate3PreliminaryScreen {
  public static readonly PASSING_THRESHOLD = 60;
  public static readonly STRONG_CANDIDATE_THRESHOLD = 70;

  /**
   * Evaluates an individual asset against Gate 3 criteria using cached/1H baseline information.
   * Does NOT make or require multi-timeframe calls.
   */
  public static screenAsset(
    asset: string,
    htf1h: NormalizedCandle[],
    liveTicker?: NormalizedTicker | null
  ): Gate3PreliminaryScreenResult {
    const assetClass = SymbolNormalizer.getAssetClassification(asset) as 'CRYPTO' | 'FOREX' | 'STOCK';

    // 1. Validate basic candle sufficiency
    if (!htf1h || htf1h.length < 15) {
      return this.createRejectResult(
        asset,
        assetClass,
        'BUY',
        0,
        'Insufficient 1H candle history for preliminary screening (<15 candles)',
        {
          liquidity: 0,
          volume: 0,
          trend: 0,
          momentum: 0,
          volatilityQuality: 0,
          spreadExecutionQuality: 0,
          total: 0,
        },
        {
          atr: 0,
          atrPct: 0,
          rangePct: 0,
          relativeVolume: 0,
          momentumPct: 0,
          estimatedSpreadBps: 0,
          ema9: 0,
          ema21: 0,
        }
      );
    }

    const sorted = [...htf1h].sort((a, b) => a.timestamp - b.timestamp);
    const closes = sorted.map((c) => c.close);
    const len = closes.length;
    const latestClose = closes[len - 1];

    if (!latestClose || latestClose <= 0 || isNaN(latestClose)) {
      return this.createRejectResult(
        asset,
        assetClass,
        'BUY',
        0,
        'Invalid candle close price (<= 0 or NaN)',
        {
          liquidity: 0,
          volume: 0,
          trend: 0,
          momentum: 0,
          volatilityQuality: 0,
          spreadExecutionQuality: 0,
          total: 0,
        },
        {
          atr: 0,
          atrPct: 0,
          rangePct: 0,
          relativeVolume: 0,
          momentumPct: 0,
          estimatedSpreadBps: 0,
          ema9: 0,
          ema21: 0,
        }
      );
    }

    // -------------------------------------------------------------
    // 1. LIQUIDITY EVALUATION (Max 20 pts)
    // -------------------------------------------------------------
    let liquidityScore = 0;
    const upperSym = asset.toUpperCase();

    // High liquidity tier check (Major FX, top crypto, large cap stocks)
    const tier1Majors = new Set([
      'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT',
      'EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD', 'USDCHF',
      'AAPL', 'NVDA', 'MSFT', 'TSLA', 'AMZN', 'GOOGL', 'META'
    ]);
    const tier2Majors = new Set([
      'ADAUSDT', 'DOGEUSDT', 'DOTUSDT', 'LINKUSDT', 'AVAXUSDT', 'SUIUSDT', 'NEARUSDT',
      'NZDUSD', 'EURGBP', 'EURJPY', 'GBPJPY', 'AUDJPY', 'EURCAD',
      'LLY', 'V', 'JPM', 'XOM', 'WMT', 'MA', 'AVGO', 'COST', 'AMD', 'NFLX'
    ]);

    if (tier1Majors.has(upperSym)) {
      liquidityScore = 20;
    } else if (tier2Majors.has(upperSym)) {
      liquidityScore = 17;
    } else {
      // General universe assets with valid quote presence
      liquidityScore = 14;
    }

    // Adjust for live quote validation if available
    if (liveTicker && liveTicker.status === 'OK' && liveTicker.price > 0) {
      // Bonus stability check
      liquidityScore = Math.min(20, liquidityScore + 1);
    }

    // -------------------------------------------------------------
    // 2. VOLUME EVALUATION (Max 20 pts)
    // -------------------------------------------------------------
    let volumeScore = 0;
    let relativeVolume = 1.0;
    const volumes = sorted.map((c) => c.volume || 0).filter((v) => v > 0);

    if (volumes.length >= 5) {
      const recentVolume = volumes[volumes.length - 1];
      const avgVolume = volumes.reduce((acc, v) => acc + v, 0) / volumes.length;
      relativeVolume = avgVolume > 0 ? recentVolume / avgVolume : 1.0;

      if (relativeVolume >= 1.5) {
        volumeScore = 20; // Strong volume surge
      } else if (relativeVolume >= 1.1) {
        volumeScore = 17; // Above average volume
      } else if (relativeVolume >= 0.8) {
        volumeScore = 14; // Healthy steady volume
      } else if (relativeVolume >= 0.5) {
        volumeScore = 10; // Moderate volume
      } else {
        volumeScore = 6;  // Dry / below average volume
      }
    } else {
      // Forex or instruments without explicit volume: estimate activity via candle range expansion
      const ranges = sorted.slice(-10).map((c) => c.high - c.low);
      const recentRange = ranges[ranges.length - 1] || 0;
      const avgRange = ranges.reduce((acc, r) => acc + r, 0) / (ranges.length || 1);
      const rangeRatio = avgRange > 0 ? recentRange / avgRange : 1.0;
      relativeVolume = rangeRatio;

      if (rangeRatio >= 1.3) volumeScore = 18;
      else if (rangeRatio >= 0.9) volumeScore = 15;
      else if (rangeRatio >= 0.6) volumeScore = 11;
      else volumeScore = 7;
    }

    // -------------------------------------------------------------
    // 3. TREND EVALUATION (Max 20 pts)
    // -------------------------------------------------------------
    let trendScore = 0;
    const ema9Series = TechnicalIndicators.calculateEMA(sorted, 9);
    const ema21Series = TechnicalIndicators.calculateEMA(sorted, 21);

    const ema9 = ema9Series.length > 0 ? ema9Series[ema9Series.length - 1] : latestClose;
    const ema21 = ema21Series.length > 0 ? ema21Series[ema21Series.length - 1] : latestClose;

    const isBullish = ema9 > ema21 && latestClose >= ema9 * 0.998;
    const isBearish = ema9 < ema21 && latestClose <= ema9 * 1.002;
    const proposedDirection: SignalDirection = isBullish ? 'BUY' : isBearish ? 'SELL' : 'BUY';

    const emaSpreadPct = (Math.abs(ema9 - ema21) / ema21) * 100;

    if (isBullish || isBearish) {
      if (emaSpreadPct >= 0.35) {
        trendScore = 20; // Clear, well-separated directional trend
      } else if (emaSpreadPct >= 0.15) {
        trendScore = 17; // Established trend
      } else {
        trendScore = 13; // Developing trend / nascent crossover
      }
    } else {
      // Choppy / moving average convergence
      if (emaSpreadPct < 0.05) {
        trendScore = 4; // Flat chop
      } else {
        trendScore = 8; // Mixed / consolidating
      }
    }

    // -------------------------------------------------------------
    // 4. MOMENTUM EVALUATION (Max 15 pts)
    // -------------------------------------------------------------
    let momentumScore = 0;
    const lookback5 = Math.max(0, len - 6);
    const price5BarsAgo = closes[lookback5] || latestClose;
    const momentumPct = price5BarsAgo > 0 ? ((latestClose - price5BarsAgo) / price5BarsAgo) * 100 : 0;

    const momentumAligned = (proposedDirection === 'BUY' && momentumPct > 0) || (proposedDirection === 'SELL' && momentumPct < 0);
    const absMomentum = Math.abs(momentumPct);

    if (momentumAligned) {
      if (absMomentum >= 0.40) {
        momentumScore = 15; // Strong directional momentum
      } else if (absMomentum >= 0.15) {
        momentumScore = 13; // Healthy momentum
      } else {
        momentumScore = 10; // Mild aligned momentum
      }
    } else {
      if (absMomentum < 0.10) {
        momentumScore = 6; // Minor pullback / neutral
      } else {
        momentumScore = 3; // Counter-trend momentum pressure
      }
    }

    // -------------------------------------------------------------
    // 5. VOLATILITY QUALITY EVALUATION (Max 15 pts)
    // -------------------------------------------------------------
    let volatilityQualityScore = 0;
    const atr14 = TechnicalIndicators.calculateATR(sorted, 14);
    const atrPct = latestClose > 0 ? (atr14 / latestClose) * 100 : 0;

    // 10-bar range check
    const last10 = sorted.slice(-10);
    let maxHigh = -Infinity;
    let minLow = Infinity;
    for (const c of last10) {
      if (c.high > maxHigh) maxHigh = c.high;
      if (c.low < minLow) minLow = c.low;
    }
    const rangePct = latestClose > 0 ? ((maxHigh - minLow) / latestClose) * 100 : 0;

    // Reject compressed zero-volatility or reward healthy volatility expansion
    if (atrPct < 0.05 || rangePct < 0.10) {
      volatilityQualityScore = 2; // Dead compressed market
    } else if (atrPct >= 0.25 && rangePct >= 0.50) {
      volatilityQualityScore = 15; // Optimal tradeable volatility
    } else if (atrPct >= 0.12 && rangePct >= 0.25) {
      volatilityQualityScore = 12; // Healthy volatility
    } else if (atrPct >= 0.08) {
      volatilityQualityScore = 9;  // Acceptable volatility
    } else {
      volatilityQualityScore = 5;  // Sub-optimal volatility
    }

    // -------------------------------------------------------------
    // 6. SPREAD / EXECUTION QUALITY EVALUATION (Max 10 pts)
    // -------------------------------------------------------------
    let spreadExecutionQualityScore = 0;
    let estimatedSpreadBps = 2.0; // default standard

    if (assetClass === 'FOREX') {
      const isMajorFx = ['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD'].includes(upperSym);
      estimatedSpreadBps = isMajorFx ? 0.8 : 1.8;
    } else if (assetClass === 'CRYPTO') {
      const isMajorCrypto = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT'].includes(upperSym);
      estimatedSpreadBps = isMajorCrypto ? 1.5 : 4.0;
    } else {
      // STOCKS
      estimatedSpreadBps = tier1Majors.has(upperSym) ? 1.0 : 3.5;
    }

    if (estimatedSpreadBps <= 1.0) {
      spreadExecutionQualityScore = 10;
    } else if (estimatedSpreadBps <= 2.5) {
      spreadExecutionQualityScore = 8;
    } else if (estimatedSpreadBps <= 5.0) {
      spreadExecutionQualityScore = 6;
    } else {
      spreadExecutionQualityScore = 3;
    }

    // -------------------------------------------------------------
    // TOTAL SCORE CALCULATION & ROUTING
    // -------------------------------------------------------------
    const totalScore = Math.min(
      100,
      Math.max(
        0,
        liquidityScore +
        volumeScore +
        trendScore +
        momentumScore +
        volatilityQualityScore +
        spreadExecutionQualityScore
      )
    );

    let routing: Gate3Routing;
    if (totalScore >= this.STRONG_CANDIDATE_THRESHOLD) {
      routing = 'STRONG_PRELIMINARY_CANDIDATE';
    } else if (totalScore >= this.PASSING_THRESHOLD) {
      routing = 'PRELIMINARY_CANDIDATE';
    } else {
      routing = 'REJECT';
    }

    const passed = routing !== 'REJECT';

    const componentScores: Gate3ComponentScores = {
      liquidity: liquidityScore,
      volume: volumeScore,
      trend: trendScore,
      momentum: momentumScore,
      volatilityQuality: volatilityQualityScore,
      spreadExecutionQuality: spreadExecutionQualityScore,
      total: totalScore,
    };

    const metrics: Gate3ScreeningMetrics = {
      atr: atr14,
      atrPct,
      rangePct,
      relativeVolume,
      momentumPct,
      estimatedSpreadBps,
      ema9,
      ema21,
    };

    const reason = passed
      ? `Gate 3 ${routing}: Score ${totalScore}/100 [Liq:${liquidityScore}, Vol:${volumeScore}, Trend:${trendScore}, Mom:${momentumScore}, VolQual:${volatilityQualityScore}, Spread:${spreadExecutionQualityScore}]. Qualified for deep analysis.`
      : `Gate 3 REJECT: Score ${totalScore}/100 (Threshold ${this.PASSING_THRESHOLD}) [Liq:${liquidityScore}, Vol:${volumeScore}, Trend:${trendScore}, Mom:${momentumScore}, VolQual:${volatilityQualityScore}, Spread:${spreadExecutionQualityScore}].`;

    // Cache the preliminary score and trend direction for fast lookups
    marketCache.setGeneric(`${asset}:preliminary_score`, totalScore, CACHE_TTL.PREVIOUS_SCORE);
    marketCache.setGeneric(`${asset}:trend_direction`, proposedDirection, CACHE_TTL.PREVIOUS_DIRECTION);

    return {
      asset,
      assetClass,
      preliminaryScore: totalScore,
      routing,
      passed,
      direction: proposedDirection,
      componentScores,
      metrics,
      reason,
    };
  }

  private static createRejectResult(
    asset: string,
    assetClass: 'CRYPTO' | 'FOREX' | 'STOCK',
    direction: SignalDirection,
    score: number,
    reason: string,
    componentScores: Gate3ComponentScores,
    metrics: Gate3ScreeningMetrics
  ): Gate3PreliminaryScreenResult {
    return {
      asset,
      assetClass,
      preliminaryScore: score,
      routing: 'REJECT',
      passed: false,
      direction,
      componentScores,
      metrics,
      reason,
    };
  }
}
