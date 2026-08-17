/**
 * Cross-Asset Correlation Filter Engine
 *
 * Prevents portfolio risk concentration by evaluating statistical correlations (r >= 0.75)
 * across Crypto, Forex, and Stock asset clusters.
 *
 * When multiple candidates in the same cluster generate signals in the same direction,
 * only the highest-scoring candidate is allowed; others are rejected due to correlation conflict.
 */

import { logger } from '../logger.js';

export interface CorrelationCluster {
  id: string;
  name: string;
  assets: string[];
  baseCorrelation: number; // typical internal correlation coefficient
}

const CORRELATION_CLUSTERS: CorrelationCluster[] = [
  // Crypto Clusters
  { id: 'CRYPTO_MAJORS', name: 'Crypto Majors', assets: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'AVAXUSDT', 'LINKUSDT'], baseCorrelation: 0.88 },
  { id: 'CRYPTO_MEMES', name: 'Crypto Meme Tokens', assets: ['DOGEUSDT', 'SHIBUSDT', 'PEPEUSDT', 'FLOKIUSDT', 'BONKUSDT', 'WIFUSDT'], baseCorrelation: 0.85 },
  { id: 'CRYPTO_L2_ALTS', name: 'Crypto L2 & DeFi', assets: ['ARBUSDT', 'OPUSDT', 'LDOUSDT', 'SUIUSDT', 'APTUSDT', 'UNIUSDT', 'AAVEUSDT'], baseCorrelation: 0.82 },
  { id: 'CRYPTO_AI_DEPIN', name: 'Crypto AI & Compute', assets: ['FETUSDT', 'RENDERUSDT', 'GRTUSDT', 'INJUSDT', 'NEARUSDT'], baseCorrelation: 0.84 },

  // Forex Clusters
  { id: 'FOREX_USD_BEAR', name: 'USD Bear Majors (EUR/GBP/AUD/NZD)', assets: ['EURUSD', 'GBPUSD', 'AUDUSD', 'NZDUSD'], baseCorrelation: 0.82 },
  { id: 'FOREX_USD_BULL', name: 'USD Bull Pairs (CAD/CHF)', assets: ['USDCAD', 'USDCHF'], baseCorrelation: 0.78 },
  { id: 'FOREX_JPY_CROSSES', name: 'JPY Crosses', assets: ['USDJPY', 'EURJPY', 'GBPJPY', 'AUDJPY', 'CADJPY', 'CHFJPY'], baseCorrelation: 0.86 },
  { id: 'FOREX_EUROPEAN_CROSSES', name: 'European Pairs', assets: ['EURGBP', 'EURCHF', 'GBPCHF'], baseCorrelation: 0.75 },

  // Stock Clusters
  { id: 'STOCKS_BIG_TECH', name: 'Mega-Cap Tech', assets: ['AAPL', 'MSFT', 'GOOGL', 'META', 'AMZN', 'NVDA'], baseCorrelation: 0.84 },
  { id: 'STOCKS_SEMIS', name: 'Semiconductors', assets: ['NVDA', 'AMD', 'TSM', 'AVGO', 'ASML', 'QCOM', 'INTC', 'TXN'], baseCorrelation: 0.88 },
  { id: 'STOCKS_FINANCIALS', name: 'Financial Institutions', assets: ['JPM', 'BAC', 'V', 'MA', 'AXP', 'SPGI'], baseCorrelation: 0.85 },
  { id: 'STOCKS_ENERGY', name: 'Energy Majors', assets: ['XOM', 'CVX'], baseCorrelation: 0.90 },
];

export class CorrelationFilter {
  /**
   * Identifies cluster for a given asset symbol
   */
  public static getCluster(symbol: string): CorrelationCluster | null {
    const sym = symbol.toUpperCase();
    for (const cluster of CORRELATION_CLUSTERS) {
      if (cluster.assets.includes(sym)) {
        return cluster;
      }
    }
    return null;
  }

  /**
   * Checks whether two symbols are highly correlated (r >= 0.75)
   */
  public static isCorrelated(
    symbolA: string,
    symbolB: string
  ): { isCorrelated: boolean; clusterName: string | null; coefficient: number } {
    const symA = symbolA.toUpperCase();
    const symB = symbolB.toUpperCase();

    if (symA === symB) {
      return { isCorrelated: true, clusterName: 'IDENTICAL_ASSET', coefficient: 1.0 };
    }

    const clusterA = this.getCluster(symA);
    const clusterB = this.getCluster(symB);

    if (clusterA && clusterB && clusterA.id === clusterB.id) {
      return {
        isCorrelated: true,
        clusterName: clusterA.name,
        coefficient: clusterA.baseCorrelation,
      };
    }

    return { isCorrelated: false, clusterName: null, coefficient: 0 };
  }

  /**
   * Filters a batch of candidate setups to remove correlated duplicates,
   * keeping only the candidate with the highest score in each cluster.
   */
  public static filterCorrelatedCandidates<T extends { symbol: string; direction: string; score: number }>(
    candidates: T[],
    activeSignals: Array<{ symbol: string; direction: string; score?: number }> = []
  ): { accepted: T[]; rejected: Array<{ candidate: T; reason: string }> } {
    const accepted: T[] = [];
    const rejected: Array<{ candidate: T; reason: string }> = [];

    // Map of active cluster exposures
    const activeClusterMap = new Map<string, { symbol: string; score: number }>();
    for (const active of activeSignals) {
      const cluster = this.getCluster(active.symbol);
      if (cluster) {
        const key = `${cluster.id}_${active.direction}`;
        activeClusterMap.set(key, { symbol: active.symbol, score: active.score || 80 });
      }
    }

    // Sort candidate setups descending by score so highest quality candidate wins
    const sorted = [...candidates].sort((a, b) => b.score - a.score);
    const acceptedClusterKeys = new Set<string>();

    for (const cand of sorted) {
      const cluster = this.getCluster(cand.symbol);

      if (!cluster) {
        // Unclustered asset - automatically pass correlation check
        accepted.push(cand);
        continue;
      }

      const clusterKey = `${cluster.id}_${cand.direction}`;

      // 1. Check if an active prior setup in the same cluster already exists
      const priorActive = activeClusterMap.get(clusterKey);
      if (priorActive && priorActive.symbol !== cand.symbol) {
        if (cand.score < priorActive.score + 5) {
          rejected.push({
            candidate: cand,
            reason: `Correlated trade conflict: Risk cluster [${cluster.name}] (${cand.direction}) is already occupied by active setup ${priorActive.symbol} (${priorActive.score}/100). Minimum 5pt score superiority required to replace.`,
          });
          continue;
        }
      }

      // 2. Check if another candidate in this current scan cycle already claimed this cluster
      if (acceptedClusterKeys.has(clusterKey)) {
        rejected.push({
          candidate: cand,
          reason: `Correlated trade conflict: Risk cluster [${cluster.name}] (${cand.direction}) was already claimed by a higher-scoring setup in this scan cycle.`,
        });
        continue;
      }

      // Mark cluster key as claimed
      acceptedClusterKeys.add(clusterKey);
      accepted.push(cand);
    }

    return { accepted, rejected };
  }
}
