/**
 * GATE 5 — DEEP CANDIDATE SELECTION
 *
 * OBJECTIVE:
 * From the 30–45 preliminary candidates (surviving Gate 3), select only 8–12 candidates
 * (or the maximum allowed by Gate 4 provider budget) for progressive deep MTF analysis.
 *
 * RANKING USING ALREADY AVAILABLE DATA (1H Baseline & Gate 3 Metrics):
 * Strictly does NOT fetch expensive MTF data merely to decide ranking.
 *
 * RANKING FACTORS & WEIGHTS (Total = 100%):
 * - Trend Alignment:    25%
 * - Momentum:           20%
 * - Volume Expansion:   15%
 * - Volatility Quality: 15%
 * - Liquidity:          10%
 * - Market Structure:   15%
 *
 * CORRELATION & DUPLICATION CONTROL:
 * Group assets into correlation sectors (Crypto Majors, Crypto Alts, FX USD Majors, FX Crosses, Mega Tech, Broad Equities).
 * Prevent single-sector crowding by applying max per-cluster allowances (e.g. max 2-3 per cluster).
 *
 * ACCEPTANCE CRITERIA:
 * 1. 30–45 candidates become no more than 8–12.
 * 2. Ranking occurs before expensive MTF calls.
 * 3. Provider budget determines the maximum number.
 * 4. Correlated assets are deprioritized / diversified across sectors.
 */

import { NormalizedCandle, SignalDirection } from '../../types/index.js';
import { Gate3PreliminaryScreenResult } from './Gate3PreliminaryScreen.js';
import { TechnicalIndicators } from './TechnicalIndicators.js';
import { SymbolNormalizer } from '../market/SymbolNormalizer.js';
import { logger } from '../logger.js';

export interface Gate5CandidateInput {
  asset: string;
  htf1h: NormalizedCandle[];
  preliminaryScore: number;
  direction: SignalDirection;
  gate3Result?: Gate3PreliminaryScreenResult;
}

export interface Gate5FactorScores {
  trendAlignment: number;      // 0 - 25
  momentum: number;            // 0 - 20
  volumeExpansion: number;     // 0 - 15
  volatilityQuality: number;   // 0 - 15
  liquidity: number;           // 0 - 10
  marketStructure: number;     // 0 - 15
  totalScore: number;          // 0 - 100
}

export interface Gate5RankedCandidate {
  asset: string;
  assetClass: 'CRYPTO' | 'FOREX' | 'STOCK';
  cluster: string;
  direction: SignalDirection;
  preliminaryScore: number;
  rankScore: number;
  rank: number;
  factorScores: Gate5FactorScores;
  selected: boolean;
  clusterRank: number;
  reason: string;
  htf1h: NormalizedCandle[];
}

export interface Gate5SelectionResult {
  passed: boolean;
  inputCandidateCount: number;
  selectedCandidateCount: number;
  maxBudgetLimit: number;
  candidatesAfterRankingCount: number;
  candidatesAfterCorrelationCount: number;
  selectedCandidates: Gate5RankedCandidate[];
  rankedCandidates: Gate5RankedCandidate[];
  rejectedCandidates: Gate5RankedCandidate[];
  clusterBreakdown: Record<string, number>;
  reason: string;
}

export class Gate5DeepCandidateSelection {
  /**
   * Identifies the correlation cluster / sector for duplication control.
   */
  public static getCorrelationCluster(asset: string): string {
    const sym = asset.toUpperCase();
    const assetClass = SymbolNormalizer.getAssetClassification(asset);

    if (assetClass === 'CRYPTO') {
      if (['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT'].includes(sym)) {
        return 'CRYPTO_MAJORS';
      }
      return 'CRYPTO_ALTS';
    }

    if (assetClass === 'FOREX') {
      if (['EURUSD', 'GBPUSD', 'AUDUSD', 'NZDUSD', 'USDCAD', 'USDCHF', 'USDJPY'].includes(sym)) {
        return 'FOREX_USD_MAJORS';
      }
      return 'FOREX_CROSSES';
    }

    // STOCKS
    const megaTech = ['AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN', 'META', 'TSLA', 'AMD', 'AVGO', 'NFLX'];
    if (megaTech.includes(sym)) {
      return 'EQUITY_MEGA_TECH';
    }
    return 'EQUITY_BROAD';
  }

  /**
   * Ranks candidates from already available 1H data and Gate 3 metrics,
   * then selects the top 8–12 candidates subject to Gate 4 request budgets and correlation limits.
   */
  public static selectCandidates(
    candidates: Gate5CandidateInput[],
    maxBudgetLimit: number = 10
  ): Gate5SelectionResult {
    const inputCount = candidates.length;

    if (inputCount === 0 || maxBudgetLimit <= 0) {
      return {
        passed: false,
        inputCandidateCount: inputCount,
        selectedCandidateCount: 0,
        maxBudgetLimit,
        candidatesAfterRankingCount: 0,
        candidatesAfterCorrelationCount: 0,
        selectedCandidates: [],
        rankedCandidates: [],
        rejectedCandidates: [],
        clusterBreakdown: {},
        reason: maxBudgetLimit <= 0
          ? 'Gate 5 Selection bypassed: Gate 4 provider budget allows 0 deep candidates.'
          : 'Gate 5 Selection bypassed: No preliminary candidates supplied.',
      };
    }

    // 1. Calculate the 6 Ranking Factors for each candidate
    const scoredList: Gate5RankedCandidate[] = candidates.map((cand) => {
      const asset = cand.asset;
      const assetClass = SymbolNormalizer.getAssetClassification(asset) as 'CRYPTO' | 'FOREX' | 'STOCK';
      const cluster = this.getCorrelationCluster(asset);
      const htf1h = cand.htf1h;
      const g3 = cand.gate3Result;

      const factorScores = this.computeFactorScores(cand);
      const totalScore = factorScores.totalScore;

      return {
        asset,
        assetClass,
        cluster,
        direction: cand.direction,
        preliminaryScore: cand.preliminaryScore,
        rankScore: totalScore,
        rank: 0, // Assigned after sorting
        factorScores,
        selected: false,
        clusterRank: 0,
        reason: '',
        htf1h,
      };
    });

    // 2. Sort descending by Rank Score
    scoredList.sort((a, b) => b.rankScore - a.rankScore);
    scoredList.forEach((c, idx) => {
      c.rank = idx + 1;
    });

    // 3. Apply Correlation Control & Provider Budget Cap
    // Max candidates per correlation cluster (default max 3-4 for rich pool representation)
    const maxPerCluster = maxBudgetLimit >= 10 ? 4 : 3;
    const clusterCounts: Record<string, number> = {};
    const selected: Gate5RankedCandidate[] = [];
    const rejected: Gate5RankedCandidate[] = [];
    let correlationApprovedCount = 0;

    // Pass 1: Select top-ranked candidates adhering to cluster caps
    for (const cand of scoredList) {
      const currentClusterCount = clusterCounts[cand.cluster] || 0;
      if (currentClusterCount < maxPerCluster) {
        correlationApprovedCount++;
      }

      if (selected.length >= maxBudgetLimit) {
        cand.selected = false;
        cand.reason = `Budget cap reached (Max ${maxBudgetLimit} deep candidates allowed)`;
        rejected.push(cand);
        continue;
      }

      if (currentClusterCount < maxPerCluster) {
        cand.selected = true;
        cand.clusterRank = currentClusterCount + 1;
        cand.reason = `Selected (Rank #${cand.rank}, Score ${cand.rankScore.toFixed(1)}, Cluster ${cand.cluster} #${cand.clusterRank})`;
        clusterCounts[cand.cluster] = currentClusterCount + 1;
        selected.push(cand);
      } else {
        // Exceeds cluster limit in pass 1
        cand.clusterRank = currentClusterCount + 1;
        cand.reason = `Cluster limit reached for ${cand.cluster} (Max ${maxPerCluster} per cluster)`;
      }
    }

    // Pass 2: If we still have budget space and candidates were deferred solely due to cluster cap, backfill if needed
    if (selected.length < maxBudgetLimit) {
      for (const cand of scoredList) {
        if (selected.length >= maxBudgetLimit) break;
        if (!cand.selected && !rejected.includes(cand)) {
          cand.selected = true;
          cand.reason = `Selected via backfill (Rank #${cand.rank}, Score ${cand.rankScore.toFixed(1)})`;
          clusterCounts[cand.cluster] = (clusterCounts[cand.cluster] || 0) + 1;
          selected.push(cand);
        }
      }
    }

    // Collect all non-selected into rejected list
    for (const cand of scoredList) {
      if (!cand.selected && !rejected.includes(cand)) {
        rejected.push(cand);
      }
    }

    logger.info(
      `[Gate 5 Deep Candidate Selection] Input: ${inputCount} preliminary -> Output: ${selected.length} deep candidates (Budget Cap: ${maxBudgetLimit}). Selected: ${selected.map((s) => `${s.asset}(${s.rankScore.toFixed(0)})`).join(', ')}`
    );

    return {
      passed: selected.length > 0,
      inputCandidateCount: inputCount,
      selectedCandidateCount: selected.length,
      maxBudgetLimit,
      candidatesAfterRankingCount: scoredList.length,
      candidatesAfterCorrelationCount: Math.min(scoredList.length, correlationApprovedCount),
      selectedCandidates: selected,
      rankedCandidates: scoredList,
      rejectedCandidates: rejected,
      clusterBreakdown: clusterCounts,
      reason: `Selected ${selected.length} highest-ranked candidates from ${inputCount} preliminary candidates based on Trend (25%), Mom (20%), Vol (15%), VolQual (15%), Liq (10%), Struct (15%) with correlation control.`,
    };
  }

  /**
   * Computes the 6 weighted ranking factors using already available 1H data.
   */
  private static computeFactorScores(cand: Gate5CandidateInput): Gate5FactorScores {
    const { asset, htf1h, preliminaryScore, direction, gate3Result } = cand;
    const sorted = [...htf1h].sort((a, b) => a.timestamp - b.timestamp);
    const closes = sorted.map((c) => c.close);
    const len = closes.length;
    const latestClose = closes[len - 1] || 1;

    // -------------------------------------------------------------
    // 1. Trend Alignment (25%) -> 0 to 25 pts
    // -------------------------------------------------------------
    let trendScore = 15;
    if (gate3Result) {
      // Scale from Gate 3's 20 max to 25 max
      trendScore = (gate3Result.componentScores.trend / 20) * 25;
    } else {
      const ema9 = TechnicalIndicators.calculateEMA(sorted, 9);
      const ema21 = TechnicalIndicators.calculateEMA(sorted, 21);
      if (ema9.length > 0 && ema21.length > 0) {
        const lastEma9 = ema9[ema9.length - 1];
        const lastEma21 = ema21[ema21.length - 1];
        const spread = (Math.abs(lastEma9 - lastEma21) / lastEma21) * 100;
        const aligned = direction === 'BUY' ? lastEma9 > lastEma21 : lastEma9 < lastEma21;
        if (aligned) {
          trendScore = spread >= 0.3 ? 25 : spread >= 0.15 ? 21 : 17;
        } else {
          trendScore = 8;
        }
      }
    }

    // -------------------------------------------------------------
    // 2. Momentum (20%) -> 0 to 20 pts
    // -------------------------------------------------------------
    let momentumScore = 12;
    if (gate3Result) {
      momentumScore = (gate3Result.componentScores.momentum / 15) * 20;
    } else {
      const p5Ago = closes[Math.max(0, len - 6)] || latestClose;
      const momPct = p5Ago > 0 ? ((latestClose - p5Ago) / p5Ago) * 100 : 0;
      const momAligned = (direction === 'BUY' && momPct > 0) || (direction === 'SELL' && momPct < 0);
      if (momAligned) {
        const absM = Math.abs(momPct);
        momentumScore = absM >= 0.4 ? 20 : absM >= 0.2 ? 16 : 13;
      } else {
        momentumScore = 5;
      }
    }

    // -------------------------------------------------------------
    // 3. Volume Expansion (15%) -> 0 to 15 pts
    // -------------------------------------------------------------
    let volumeExpansionScore = 9;
    if (gate3Result) {
      volumeExpansionScore = (gate3Result.componentScores.volume / 20) * 15;
    } else {
      const volumes = sorted.map((c) => c.volume || 0).filter((v) => v > 0);
      if (volumes.length >= 5) {
        const lastVol = volumes[volumes.length - 1];
        const avgVol = volumes.reduce((acc, v) => acc + v, 0) / volumes.length;
        const rVol = avgVol > 0 ? lastVol / avgVol : 1.0;
        volumeExpansionScore = rVol >= 1.5 ? 15 : rVol >= 1.1 ? 12 : rVol >= 0.8 ? 9 : 5;
      }
    }

    // -------------------------------------------------------------
    // 4. Volatility Quality (15%) -> 0 to 15 pts
    // -------------------------------------------------------------
    let volatilityQualityScore = 9;
    if (gate3Result) {
      volatilityQualityScore = gate3Result.componentScores.volatilityQuality; // Already max 15
    } else {
      const atr14 = TechnicalIndicators.calculateATR(sorted, 14);
      const atrPct = latestClose > 0 ? (atr14 / latestClose) * 100 : 0;
      volatilityQualityScore = atrPct >= 0.25 ? 15 : atrPct >= 0.12 ? 12 : atrPct >= 0.08 ? 8 : 4;
    }

    // -------------------------------------------------------------
    // 5. Liquidity (10%) -> 0 to 10 pts
    // -------------------------------------------------------------
    let liquidityScore = 6;
    if (gate3Result) {
      liquidityScore = (gate3Result.componentScores.liquidity / 20) * 10;
    } else {
      const assetClass = SymbolNormalizer.getAssetClassification(asset);
      liquidityScore = assetClass === 'FOREX' || ['BTCUSDT', 'ETHUSDT', 'AAPL', 'NVDA'].includes(asset.toUpperCase())
        ? 10
        : 7;
    }

    // -------------------------------------------------------------
    // 6. Market Structure (15%) -> 0 to 15 pts
    // -------------------------------------------------------------
    let marketStructureScore = 9;
    try {
      const ms = TechnicalIndicators.calculateMarketStructure(sorted);
      if (direction === 'BUY') {
        if (ms.structureBias === 'BULLISH') {
          marketStructureScore = (ms.higherHighsCount >= 2 && ms.higherLowsCount >= 2) ? 15 : 12;
        } else if (ms.structureBias === 'RANGE') {
          marketStructureScore = 8;
        } else {
          marketStructureScore = 4;
        }
      } else {
        if (ms.structureBias === 'BEARISH') {
          marketStructureScore = (ms.lowerHighsCount >= 2 && ms.lowerLowsCount >= 2) ? 15 : 12;
        } else if (ms.structureBias === 'RANGE') {
          marketStructureScore = 8;
        } else {
          marketStructureScore = 4;
        }
      }
    } catch {
      marketStructureScore = 9;
    }

    // Total Score = sum of weighted factors (Max 100)
    const totalScore = Math.min(
      100,
      Math.max(
        0,
        trendScore +
        momentumScore +
        volumeExpansionScore +
        volatilityQualityScore +
        liquidityScore +
        marketStructureScore
      )
    );

    return {
      trendAlignment: parseFloat(trendScore.toFixed(2)),
      momentum: parseFloat(momentumScore.toFixed(2)),
      volumeExpansion: parseFloat(volumeExpansionScore.toFixed(2)),
      volatilityQuality: parseFloat(volatilityQualityScore.toFixed(2)),
      liquidity: parseFloat(liquidityScore.toFixed(2)),
      marketStructure: parseFloat(marketStructureScore.toFixed(2)),
      totalScore: parseFloat(totalScore.toFixed(2)),
    };
  }
}
