/**
 * Gate 17: Correlation and Signal Exposure Control Engine
 *
 * Prevents treating highly correlated signals as independent opportunities.
 * Detects statistical correlation between candidate assets using available historical price data.
 *
 * Classifies:
 * - LOW_CORRELATION (< 0.40)
 * - MODERATE_CORRELATION (0.40 - 0.75)
 * - HIGH_CORRELATION (> 0.75)
 *
 * Creates exposure clusters (e.g. CRYPTO_RISK_CLUSTER, EQUITY_RISK_CLUSTER, FOREX_USD_CLUSTER).
 * When multiple signals belong to the same cluster:
 * - Ranks them within the cluster
 * - Prioritizes the strongest setup (Rank #1)
 * - Calibrates confidence of weaker duplicates with correlationPenalty
 * - Exposes: correlationScore, correlationCluster, clusterExposure, correlationPenalty, correlationLevel
 *
 * NOTE: Acts as an analytics/ranking layer. Does NOT automatically prohibit trades unless requested.
 */

import { NormalizedCandle, SignalDirection } from '../../types/index.js';
import { SymbolNormalizer } from '../market/SymbolNormalizer.js';
import { serverConfig } from '../config.js';

export type CorrelationLevel = 'LOW_CORRELATION' | 'MODERATE_CORRELATION' | 'HIGH_CORRELATION';

export interface CandidateCorrelationInput {
  symbol: string;
  direction: SignalDirection;
  candles?: NormalizedCandle[];
  score?: number;
  relativeStrengthScore?: number;
}

export interface Gate17CorrelationResult {
  symbol: string;
  direction: SignalDirection;
  correlationScore: number; // 0 - 100
  correlationCluster: string;
  clusterExposure: number;
  correlationPenalty: number;
  correlationLevel: CorrelationLevel;
  clusterRank: number;
  rawCoefficient: number; // -1.0 to 1.0
  reasons: string[];
  summary: string;
}

interface ExposureClusterDef {
  id: string;
  name: string;
  assetClass: 'CRYPTO' | 'STOCKS' | 'FOREX' | 'COMMODITIES';
  members: string[];
  baseCorrelation: number;
}

const CANONICAL_CLUSTERS: ExposureClusterDef[] = [
  // Crypto Risk Clusters
  {
    id: 'CRYPTO_RISK_CLUSTER',
    name: 'Crypto Market Risk Cluster',
    assetClass: 'CRYPTO',
    members: [
      'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'AVAXUSDT', 'LINKUSDT',
      'DOGEUSDT', 'SHIBUSDT', 'PEPEUSDT', 'FLOKIUSDT', 'BONKUSDT', 'WIFUSDT',
      'ARBUSDT', 'OPUSDT', 'LDOUSDT', 'SUIUSDT', 'APTUSDT', 'UNIUSDT', 'AAVEUSDT',
      'FETUSDT', 'RENDERUSDT', 'GRTUSDT', 'INJUSDT', 'NEARUSDT', 'BTC', 'ETH', 'SOL',
    ],
    baseCorrelation: 0.85,
  },
  // Equity Risk Clusters
  {
    id: 'EQUITY_RISK_CLUSTER',
    name: 'Equity Broad Market & Tech Risk Cluster',
    assetClass: 'STOCKS',
    members: [
      'SPY', 'QQQ', 'AAPL', 'MSFT', 'GOOGL', 'META', 'AMZN', 'NVDA',
      'AMD', 'TSM', 'AVGO', 'ASML', 'QCOM', 'INTC', 'TXN', 'JPM', 'BAC',
      'V', 'MA', 'AXP', 'SPGI', 'XOM', 'CVX', 'TSLA',
    ],
    baseCorrelation: 0.80,
  },
  // Forex USD Cluster
  {
    id: 'FOREX_USD_CLUSTER',
    name: 'Forex USD Macro Cluster',
    assetClass: 'FOREX',
    members: ['EURUSD', 'GBPUSD', 'AUDUSD', 'NZDUSD', 'USDCAD', 'USDCHF', 'USDJPY'],
    baseCorrelation: 0.78,
  },
  // Forex JPY Crosses Cluster
  {
    id: 'FOREX_JPY_CROSS_CLUSTER',
    name: 'Forex JPY Crosses Cluster',
    assetClass: 'FOREX',
    members: ['EURJPY', 'GBPJPY', 'AUDJPY', 'CADJPY', 'CHFJPY', 'NZDJPY'],
    baseCorrelation: 0.82,
  },
  // Commodities Metals Cluster
  {
    id: 'COMMODITIES_METALS_CLUSTER',
    name: 'Precious Metals Risk Cluster',
    assetClass: 'COMMODITIES',
    members: ['XAUUSD', 'XAGUSD', 'GOLD', 'SILVER'],
    baseCorrelation: 0.82,
  },
  // Commodities Energy Cluster
  {
    id: 'COMMODITIES_ENERGY_CLUSTER',
    name: 'Energy & Oil Risk Cluster',
    assetClass: 'COMMODITIES',
    members: ['USOIL', 'UKOIL', 'BRENT', 'WTI', 'NGAS'],
    baseCorrelation: 0.88,
  },
];

export class Gate17CorrelationExposure {
  /**
   * Identifies the exposure cluster for a given asset
   */
  public static identifyCluster(symbol: string): { id: string; name: string; baseCorrelation: number } {
    const upper = symbol.toUpperCase();

    // Check predefined clusters
    for (const cluster of CANONICAL_CLUSTERS) {
      if (cluster.members.includes(upper)) {
        return { id: cluster.id, name: cluster.name, baseCorrelation: cluster.baseCorrelation };
      }
    }

    // Dynamic classification based on asset type
    const cls = SymbolNormalizer.getAssetClassification(upper);
    if (cls === 'CRYPTO') {
      return { id: 'CRYPTO_RISK_CLUSTER', name: 'Crypto Risk Cluster', baseCorrelation: 0.85 };
    }
    if (cls === 'FOREX') {
      if (upper.includes('JPY')) {
        return { id: 'FOREX_JPY_CROSS_CLUSTER', name: 'Forex JPY Crosses Cluster', baseCorrelation: 0.82 };
      }
      return { id: 'FOREX_USD_CLUSTER', name: 'Forex USD Macro Cluster', baseCorrelation: 0.78 };
    }
    if (cls === 'STOCK') {
      return { id: 'EQUITY_RISK_CLUSTER', name: 'Equity Risk Cluster', baseCorrelation: 0.80 };
    }
    if (upper.includes('XAU') || upper.includes('XAG')) {
      return { id: 'COMMODITIES_METALS_CLUSTER', name: 'Precious Metals Risk Cluster', baseCorrelation: 0.82 };
    }
    if (upper.includes('OIL') || upper.includes('WTI') || upper.includes('BRENT')) {
      return { id: 'COMMODITIES_ENERGY_CLUSTER', name: 'Energy Risk Cluster', baseCorrelation: 0.88 };
    }

    return { id: 'UNCLASSIFIED_RISK_CLUSTER', name: 'Unclassified Risk Cluster', baseCorrelation: 0.20 };
  }

  /**
   * Calculates Pearson correlation coefficient between two series of price candles
   */
  public static calculatePearsonCorrelation(candlesA: NormalizedCandle[], candlesB: NormalizedCandle[]): number {
    if (!candlesA || !candlesB || candlesA.length < 10 || candlesB.length < 10) {
      return 0;
    }

    // Calculate percentage returns
    const minLen = Math.min(candlesA.length, candlesB.length, 50);
    const sliceA = candlesA.slice(-minLen);
    const sliceB = candlesB.slice(-minLen);

    const returnsA: number[] = [];
    const returnsB: number[] = [];

    for (let i = 1; i < sliceA.length; i++) {
      const prevA = sliceA[i - 1].close;
      const currA = sliceA[i].close;
      const prevB = sliceB[i - 1]?.close;
      const currB = sliceB[i]?.close;

      if (prevA > 0 && currA > 0 && prevB > 0 && currB > 0) {
        returnsA.push((currA - prevA) / prevA);
        returnsB.push((currB - prevB) / prevB);
      }
    }

    const n = returnsA.length;
    if (n < 5) return 0;

    const meanA = returnsA.reduce((sum, v) => sum + v, 0) / n;
    const meanB = returnsB.reduce((sum, v) => sum + v, 0) / n;

    let numerator = 0;
    let sumSqA = 0;
    let sumSqB = 0;

    for (let i = 0; i < n; i++) {
      const diffA = returnsA[i] - meanA;
      const diffB = returnsB[i] - meanB;
      numerator += diffA * diffB;
      sumSqA += diffA * diffA;
      sumSqB += diffB * diffB;
    }

    const denominator = Math.sqrt(sumSqA * sumSqB);
    if (denominator === 0) return 0;

    const coeff = numerator / denominator;
    return Math.max(-1.0, Math.min(1.0, coeff));
  }

  /**
   * Evaluates a cohort of candidate opportunities across exposure clusters.
   */
  public static evaluateCandidates(
    candidates: CandidateCorrelationInput[],
    activeSignals: Array<{ symbol: string; direction: SignalDirection; score?: number }> = []
  ): Map<string, Gate17CorrelationResult> {
    const results = new Map<string, Gate17CorrelationResult>();
    if (!candidates || candidates.length === 0) return results;

    // Group candidates by cluster and direction
    const clusterGroups = new Map<string, CandidateCorrelationInput[]>();

    for (const cand of candidates) {
      const cluster = this.identifyCluster(cand.symbol);
      const groupKey = `${cluster.id}_${cand.direction}`;
      if (!clusterGroups.has(groupKey)) {
        clusterGroups.set(groupKey, []);
      }
      clusterGroups.get(groupKey)!.push(cand);
    }

    // Active signals cluster counts
    const activeClusterCounts = new Map<string, number>();
    for (const active of activeSignals) {
      const cluster = this.identifyCluster(active.symbol);
      const groupKey = `${cluster.id}_${active.direction}`;
      activeClusterCounts.set(groupKey, (activeClusterCounts.get(groupKey) || 0) + 1);
    }

    for (const [groupKey, groupCandidates] of clusterGroups.entries()) {
      const firstCand = groupCandidates[0];
      const cluster = this.identifyCluster(firstCand.symbol);
      const activeCount = activeClusterCounts.get(groupKey) || 0;
      const totalClusterExposure = groupCandidates.length + activeCount;

      // Rank group candidates descending by score + relativeStrengthScore
      const minThreshold = serverConfig.getConfig().thresholds.signalThreshold;
      const rankedInCluster = [...groupCandidates].sort((a, b) => {
        const scoreA = (a.score || minThreshold) + (a.relativeStrengthScore ? (a.relativeStrengthScore - 50) * 0.1 : 0);
        const scoreB = (b.score || minThreshold) + (b.relativeStrengthScore ? (b.relativeStrengthScore - 50) * 0.1 : 0);
        return scoreB - scoreA;
      });

      for (let rankIndex = 0; rankIndex < rankedInCluster.length; rankIndex++) {
        const cand = rankedInCluster[rankIndex];
        const clusterRank = rankIndex + 1;

        // Compute average correlation coefficient with peers
        let sumCoeff = 0;
        let peerCount = 0;

        for (const peer of groupCandidates) {
          if (peer.symbol !== cand.symbol) {
            if (cand.candles && peer.candles && cand.candles.length >= 10 && peer.candles.length >= 10) {
              const statCoeff = this.calculatePearsonCorrelation(cand.candles, peer.candles);
              sumCoeff += Math.abs(statCoeff);
              peerCount++;
            }
          }
        }

        const avgCoeff = peerCount > 0 ? sumCoeff / peerCount : cluster.baseCorrelation;
        const correlationScore = Math.round(Math.max(0, Math.min(100, avgCoeff * 100)));

        let correlationLevel: CorrelationLevel = 'LOW_CORRELATION';
        if (avgCoeff > 0.75) {
          correlationLevel = 'HIGH_CORRELATION';
        } else if (avgCoeff >= 0.40) {
          correlationLevel = 'MODERATE_CORRELATION';
        } else {
          correlationLevel = 'LOW_CORRELATION';
        }

        // Calibrate correlation penalty for duplicate setups in the same cluster
        let correlationPenalty = 0;
        if (clusterRank > 1) {
          if (correlationLevel === 'HIGH_CORRELATION') {
            correlationPenalty = Math.min(10, (clusterRank - 1) * 3);
          } else if (correlationLevel === 'MODERATE_CORRELATION') {
            correlationPenalty = Math.min(6, (clusterRank - 1) * 1.5);
          }
        }

        const reasons: string[] = [];
        if (totalClusterExposure > 1) {
          if (clusterRank === 1) {
            reasons.push(`Exposure Cluster [${cluster.id}]: Leader setup (Rank #1 of ${totalClusterExposure}, no correlation penalty).`);
          } else {
            reasons.push(`Exposure Cluster [${cluster.id}]: Correlated setup (Rank #${clusterRank} of ${totalClusterExposure}, -${correlationPenalty}pt penalty).`);
          }
        }

        const summary = `Cluster: ${cluster.id} | Level: ${correlationLevel} (r=${avgCoeff.toFixed(2)}) | Rank: #${clusterRank} of ${totalClusterExposure} | Penalty: -${correlationPenalty}`;

        results.set(cand.symbol, {
          symbol: cand.symbol,
          direction: cand.direction,
          correlationScore,
          correlationCluster: cluster.id,
          clusterExposure: totalClusterExposure,
          correlationPenalty,
          correlationLevel,
          clusterRank,
          rawCoefficient: Number(avgCoeff.toFixed(3)),
          reasons,
          summary,
        });
      }
    }

    return results;
  }

  /**
   * Analyzes a single candidate in isolation
   */
  public static analyzeSingle(candidate: CandidateCorrelationInput): Gate17CorrelationResult {
    const results = this.evaluateCandidates([candidate]);
    return results.get(candidate.symbol) || {
      symbol: candidate.symbol,
      direction: candidate.direction,
      correlationScore: 50,
      correlationCluster: 'UNCLASSIFIED_RISK_CLUSTER',
      clusterExposure: 1,
      correlationPenalty: 0,
      correlationLevel: 'LOW_CORRELATION',
      clusterRank: 1,
      rawCoefficient: 0.5,
      reasons: [],
      summary: 'Isolated candidate without active cluster duplicates',
    };
  }
}
