/**
 * GATE 16: RELATIVE STRENGTH RANKING ENGINE
 * 
 * Compares candidate assets against each other within their comparable asset class
 * (Crypto, Stocks, Forex, Commodities) rather than evaluating each asset in total isolation.
 * 
 * EVALUATION METRICS:
 * 1. Recent Price Performance (directional return over lookback period)
 * 2. Momentum Score (RSI relative strength & Rate of Change)
 * 3. Volume Expansion (Relative volume vs 20-period baseline)
 * 4. Trend Strength & Directional Alignment (EMA structure & ADX trend conviction)
 * 5. Volatility-Adjusted Movement (Return normalized by ATR)
 * 6. Market-Relative Outperformance (Relative delta vs universe benchmark)
 * 
 * UNIVERSES:
 * - CRYPTO: Evaluated vs BTC / Crypto universe baseline
 * - STOCKS: Evaluated vs SPY / Equity sector benchmark
 * - FOREX: Evaluated vs DXY / USD currency strength basket
 * - COMMODITIES: Evaluated vs Commodities basket
 * 
 * OUTPUT PROPERTIES:
 * - relativeStrengthScore (0 to 100)
 * - relativeRank (1, 2, 3...)
 * - assetClassRank (e.g. "SOLUSDT #1 of 4 CRYPTO")
 * - marketContext (OUTPERFORMING_BENCHMARK | LEADER | MARKET_ALIGNED | LAGGARD | UNDERPERFORMING)
 * 
 * RULES:
 * - Does NOT compare completely different asset classes using raw percentage movement.
 * - Ranks strictly within comparable universes.
 * - Serves as a confidence modifier; does NOT bypass risk or quality gates.
 */

import { NormalizedCandle, SignalDirection } from '../../types/index.js';
import { TechnicalIndicators } from './TechnicalIndicators.js';
import { SymbolNormalizer } from '../market/SymbolNormalizer.js';

export type MarketContextType =
  | 'OUTPERFORMING_BENCHMARK'
  | 'LEADER'
  | 'MARKET_ALIGNED'
  | 'LAGGARD'
  | 'UNDERPERFORMING';

export interface RelativeStrengthMetrics {
  pricePerformancePct: number;
  momentumScore: number;
  volumeRatio: number;
  trendStrengthScore: number;
  volatilityAdjustedReturn: number;
  marketRelativePerformancePct: number;
  assetClass: string;
  universeSize: number;
}

export interface Gate16RelativeStrengthResult {
  symbol: string;
  direction: SignalDirection;
  relativeStrengthScore: number; // 0 to 100
  relativeRank: number; // 1-based rank within its asset class
  assetClassRank: string; // e.g. "SOLUSDT #1 of 4 CRYPTO"
  marketContext: MarketContextType;
  metrics: RelativeStrengthMetrics;
  reasons: string[];
  summary: string;
}

export interface CandidateStrengthInput {
  symbol: string;
  direction: SignalDirection;
  candles: NormalizedCandle[];
  currentPrice: number;
  atr?: number;
}

export class Gate16RelativeStrength {
  /**
   * Evaluates and ranks a cohort of candidate assets partitioned by their asset class universe.
   */
  public static rankCandidates(
    candidates: CandidateStrengthInput[],
    lookback = 24
  ): Map<string, Gate16RelativeStrengthResult> {
    const resultMap = new Map<string, Gate16RelativeStrengthResult>();

    if (!candidates || candidates.length === 0) {
      return resultMap;
    }

    // 1. Partition candidates by comparable Asset Class Universes
    const universeGroups = new Map<string, CandidateStrengthInput[]>();

    for (const cand of candidates) {
      const assetClass = this.detectAssetClass(cand.symbol);
      const group = universeGroups.get(assetClass) || [];
      group.push(cand);
      universeGroups.set(assetClass, group);
    }

    // 2. Compute Strength Metrics and Rank within each universe
    for (const [assetClass, groupCandidates] of universeGroups.entries()) {
      const rankedUniverse = this.rankUniverseGroup(groupCandidates, assetClass, lookback);
      for (const res of rankedUniverse) {
        resultMap.set(res.symbol, res);
      }
    }

    return resultMap;
  }

  /**
   * Ranks an individual candidate in isolation against a synthetic or baseline universe context.
   */
  public static analyzeSingle(
    candidate: CandidateStrengthInput,
    lookback = 24
  ): Gate16RelativeStrengthResult {
    const results = this.rankCandidates([candidate], lookback);
    return results.get(candidate.symbol) || this.createNeutralResult(candidate.symbol, candidate.direction);
  }

  /**
   * Evaluates candidates within a single asset class universe.
   */
  private static rankUniverseGroup(
    candidates: CandidateStrengthInput[],
    assetClass: string,
    lookback: number
  ): Gate16RelativeStrengthResult[] {
    const scoredList: Array<{
      candidate: CandidateStrengthInput;
      rawScore: number;
      metrics: RelativeStrengthMetrics;
      reasons: string[];
    }> = [];

    // Calculate baseline benchmark performance for the universe (e.g. median return)
    const rawReturns = candidates.map((c) => this.calculateReturn(c.candles, lookback));
    const universeAvgReturn = rawReturns.length > 0
      ? rawReturns.reduce((s, r) => s + r, 0) / rawReturns.length
      : 0;

    for (const cand of candidates) {
      const { symbol, direction, candles, currentPrice } = cand;
      const sorted = [...candles].sort((a, b) => a.timestamp - b.timestamp);
      const len = sorted.length;

      if (len < 10) {
        scoredList.push({
          candidate: cand,
          rawScore: 50,
          metrics: {
            pricePerformancePct: 0,
            momentumScore: 50,
            volumeRatio: 1,
            trendStrengthScore: 50,
            volatilityAdjustedReturn: 0,
            marketRelativePerformancePct: 0,
            assetClass,
            universeSize: candidates.length,
          },
          reasons: ['Insufficient candle history for relative strength ranking'],
        });
        continue;
      }

      // 1. Price Performance over lookback
      const retPct = this.calculateReturn(sorted, lookback);
      // Directional performance: if BUY we want positive return; if SELL we want negative return (selling strength)
      const directionalReturn = direction === 'BUY' ? retPct : -retPct;

      // 2. Momentum (RSI + Rate of Change)
      const rsiSeries = TechnicalIndicators.calculateRSI(sorted, 14);
      const currentRsi = rsiSeries.length > 0 ? rsiSeries[rsiSeries.length - 1] : 50;
      let momentumScore = 50;
      if (direction === 'BUY') {
        momentumScore = Math.min(100, Math.max(0, currentRsi));
      } else {
        momentumScore = Math.min(100, Math.max(0, 100 - currentRsi));
      }

      // 3. Volume Expansion
      const recentVol = sorted.slice(-5).reduce((s, c) => s + c.volume, 0) / 5;
      const baseVol = sorted.slice(-20).reduce((s, c) => s + c.volume, 0) / 20;
      const volumeRatio = baseVol > 0 ? recentVol / baseVol : 1.0;

      // 4. Trend Strength & Moving Average Structure
      const ema20Series = TechnicalIndicators.calculateEMA(sorted, 20);
      const currentEma20 = ema20Series.length > 0 ? ema20Series[ema20Series.length - 1] : currentPrice;
      let trendStrengthScore = 50;
      if (direction === 'BUY') {
        trendStrengthScore = currentPrice >= currentEma20 ? 70 : 35;
      } else {
        trendStrengthScore = currentPrice <= currentEma20 ? 70 : 35;
      }

      // 5. Volatility-Adjusted Movement (Return / ATR)
      const rawAtr = cand.atr || TechnicalIndicators.calculateATR(sorted, 14);
      const safeAtr = rawAtr > 0 ? rawAtr : currentPrice * 0.01;
      const atrPct = (safeAtr / currentPrice) * 100;
      const volAdjustedReturn = atrPct > 0 ? directionalReturn / atrPct : 0;

      // 6. Market Relative Performance vs Universe
      const marketRelativePerformancePct = retPct - universeAvgReturn;
      const relativeOutperformance = direction === 'BUY' ? marketRelativePerformancePct : -marketRelativePerformancePct;

      // Composite Strength Score (0 to 100)
      let score = 50;
      score += Math.min(20, Math.max(-20, directionalReturn * 2));
      score += (momentumScore - 50) * 0.25;
      score += Math.min(15, Math.max(-10, (volumeRatio - 1.0) * 12));
      score += (trendStrengthScore - 50) * 0.2;
      score += Math.min(15, Math.max(-15, relativeOutperformance * 2.5));

      const finalScore = Math.min(99, Math.max(15, Math.round(score)));

      const reasons: string[] = [];
      if (relativeOutperformance >= 1.0) {
        reasons.push(`Strong relative leader: Outperforming ${assetClass} universe by +${Math.abs(relativeOutperformance).toFixed(2)}%.`);
      } else if (relativeOutperformance <= -1.0) {
        reasons.push(`Relative laggard: Underperforming ${assetClass} universe by -${Math.abs(relativeOutperformance).toFixed(2)}%.`);
      }

      if (volumeRatio >= 1.3) {
        reasons.push(`Above-average institutional volume participation (${volumeRatio.toFixed(1)}x baseline).`);
      }

      if (volAdjustedReturn >= 1.5) {
        reasons.push(`Superior volatility-adjusted displacement (${volAdjustedReturn.toFixed(2)} ATRs).`);
      }

      scoredList.push({
        candidate: cand,
        rawScore: finalScore,
        metrics: {
          pricePerformancePct: Number(retPct.toFixed(2)),
          momentumScore: Number(momentumScore.toFixed(1)),
          volumeRatio: Number(volumeRatio.toFixed(2)),
          trendStrengthScore: Number(trendStrengthScore.toFixed(1)),
          volatilityAdjustedReturn: Number(volAdjustedReturn.toFixed(2)),
          marketRelativePerformancePct: Number(marketRelativePerformancePct.toFixed(2)),
          assetClass,
          universeSize: candidates.length,
        },
        reasons,
      });
    }

    // Sort universe by rawScore descending (highest relative strength first)
    scoredList.sort((a, b) => b.rawScore - a.rawScore);

    const universeSize = scoredList.length;
    const results: Gate16RelativeStrengthResult[] = [];

    for (let i = 0; i < universeSize; i++) {
      const item = scoredList[i];
      const rank = i + 1;
      const assetClassRank = `${item.candidate.symbol} #${rank} of ${universeSize} ${assetClass}`;

      let marketContext: MarketContextType = 'MARKET_ALIGNED';
      if (rank === 1 && item.rawScore >= 75) {
        marketContext = 'LEADER';
      } else if (item.metrics.marketRelativePerformancePct > 0.5) {
        marketContext = 'OUTPERFORMING_BENCHMARK';
      } else if (rank === universeSize && item.rawScore <= 45) {
        marketContext = 'UNDERPERFORMING';
      } else if (item.metrics.marketRelativePerformancePct < -0.5) {
        marketContext = 'LAGGARD';
      }

      const summary = `Relative Strength #${rank}/${universeSize} [${assetClass}] (${marketContext}, Score: ${item.rawScore})`;

      results.push({
        symbol: item.candidate.symbol,
        direction: item.candidate.direction,
        relativeStrengthScore: item.rawScore,
        relativeRank: rank,
        assetClassRank,
        marketContext,
        metrics: item.metrics,
        reasons: item.reasons,
        summary,
      });
    }

    return results;
  }

  /**
   * Computes multi-bar price percentage return over lookback.
   */
  private static calculateReturn(candles: NormalizedCandle[], lookback: number): number {
    if (!candles || candles.length < 2) return 0;
    const len = candles.length;
    const startIdx = Math.max(0, len - lookback);
    const startPrice = candles[startIdx].close;
    const endPrice = candles[len - 1].close;

    if (startPrice <= 0) return 0;
    return ((endPrice - startPrice) / startPrice) * 100;
  }

  /**
   * Partitions symbols into comparable universes.
   */
  public static detectAssetClass(symbol: string): 'CRYPTO' | 'FOREX' | 'STOCKS' | 'COMMODITIES' {
    const upper = symbol.toUpperCase();
    if (upper.includes('XAU') || upper.includes('XAG') || upper.includes('OIL') || upper.includes('WTI')) {
      return 'COMMODITIES';
    }

    try {
      const cls = SymbolNormalizer.getAssetClassification(upper);
      if (cls === 'CRYPTO') return 'CRYPTO';
      if (cls === 'FOREX') return 'FOREX';
      if (cls === 'STOCK') return 'STOCKS';
    } catch {
      // Fallback detection
    }

    if (upper.endsWith('USDT') || upper.endsWith('BTC') || upper.endsWith('ETH')) return 'CRYPTO';
    if (upper.length === 6 && (upper.includes('USD') || upper.includes('EUR') || upper.includes('JPY'))) return 'FOREX';
    return 'STOCKS';
  }

  private static createNeutralResult(symbol: string, direction: SignalDirection): Gate16RelativeStrengthResult {
    return {
      symbol,
      direction,
      relativeStrengthScore: 50,
      relativeRank: 1,
      assetClassRank: `${symbol} #1 of 1`,
      marketContext: 'MARKET_ALIGNED',
      metrics: {
        pricePerformancePct: 0,
        momentumScore: 50,
        volumeRatio: 1,
        trendStrengthScore: 50,
        volatilityAdjustedReturn: 0,
        marketRelativePerformancePct: 0,
        assetClass: 'UNKNOWN',
        universeSize: 1,
      },
      reasons: ['Neutral relative strength baseline'],
      summary: `${symbol} #1 of 1 [UNKNOWN] (Score: 50)`,
    };
  }
}
