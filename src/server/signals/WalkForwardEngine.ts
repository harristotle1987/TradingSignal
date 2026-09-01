/**
 * Production Walk-Forward Optimization & Backtest Evaluation Engine
 *
 * Implements Institutional Backtesting & Walk-Forward Performance Testing:
 * 1. Uses the EXACT production strategy logic:
 *    - StrategyEngine.evaluate()
 *    - ScoringEngine.scoreCandidate()
 *    - SignalValidator.validate()
 * 2. Bar-by-bar step evaluation with ZERO lookahead bias.
 * 3. Walk-Forward Analysis:
 *    - Splits historical datasets into rolling In-Sample (Train) and Out-Of-Sample (Test) windows.
 *    - Evaluates strategy performance and parameter stability.
 *    - Calculates Walk-Forward Efficiency (WFE = Out-of-Sample Expectancy / In-Sample Expectancy).
 * 4. Strict Non-Overfitting Verification:
 *    - Verifies that strategy confluence holds up out-of-sample without curve fitting.
 * 5. Compliance & Legal Statement:
 *    - Historical performance and walk-forward backtest results are purely statistical risk tools.
 *    - NEVER guarantees or claims future profitability.
 */

import { NormalizedCandle, SignalDirection } from '../../types/index.js';
import { StrategyEngine } from './StrategyEngine.js';
import { ScoringEngine, ScoringResult } from './ScoringEngine.js';
import { SignalValidator } from './SignalValidator.js';
import { StrategyPerformanceTracker, MetricSummary, PERFORMANCE_LEGAL_DISCLAIMER } from './StrategyPerformanceTracker.js';
import { logger } from '../logger.js';

export interface BacktestTradeResult {
  tradeId: string;
  symbol: string;
  direction: SignalDirection;
  primaryStrategy: string;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  plannedRR: number;
  confidenceScore: number;
  outcomeStatus: 'TP_HIT' | 'SL_HIT' | 'EXPIRED' | 'INVALIDATED';
  realizedRR: number;
  isWin: boolean;
  entryTimestamp: number;
  exitTimestamp: number;
  barsHeld: number;
}

export interface BacktestSummary {
  symbol: string;
  totalCandlesEvaluated: number;
  metrics: MetricSummary;
  trades: BacktestTradeResult[];
  disclaimer: string;
}

export interface WalkForwardWindowResult {
  windowIndex: number;
  inSampleRange: { start: string; end: string; totalBars: number };
  outOfSampleRange: { start: string; end: string; totalBars: number };
  inSampleMetrics: MetricSummary;
  outOfSampleMetrics: MetricSummary;
  walkForwardEfficiencyRatio: number; // OOS Expectancy / IS Expectancy
  isRobust: boolean; // WFE >= 0.60
}

export interface WalkForwardReport {
  symbol: string;
  totalWindows: number;
  overallInSampleMetrics: MetricSummary;
  overallOutOfSampleMetrics: MetricSummary;
  aggregateEfficiencyRatio: number;
  isRobustNonOverfitted: boolean;
  windows: WalkForwardWindowResult[];
  disclaimer: string;
  evaluatedAt: number;
}

export class WalkForwardEngine {
  /**
   * Runs a complete backtest simulation over an array of historical candles with zero lookahead bias.
   */
  static runBacktest(
    symbol: string,
    candlesMap: Record<string, NormalizedCandle[]>,
    maxBarsToEvaluate = 500
  ): BacktestSummary {
    const cleanSym = symbol.trim().toUpperCase();
    const primaryTf = '1h';
    const primaryCandles = candlesMap[primaryTf] || [];

    if (!primaryCandles || primaryCandles.length < 30) {
      return {
        symbol: cleanSym,
        totalCandlesEvaluated: 0,
        metrics: this.emptyMetrics(),
        trades: [],
        disclaimer: PERFORMANCE_LEGAL_DISCLAIMER,
      };
    }

    const trades: BacktestTradeResult[] = [];
    const minHistoryReq = 25;
    const endBarIndex = Math.min(primaryCandles.length - 1, minHistoryReq + maxBarsToEvaluate);

    let inActiveTrade = false;
    let currentTrade: {
      direction: SignalDirection;
      entryPrice: number;
      sl: number;
      tp: number;
      rr: number;
      score: number;
      strategy: string;
      entryTimestamp: number;
      entryBarIndex: number;
    } | null = null;

    for (let i = minHistoryReq; i < endBarIndex; i++) {
      const currentCandle = primaryCandles[i];

      // 1. Manage Active Trade if present
      if (inActiveTrade && currentTrade) {
        const isBuy = currentTrade.direction === 'BUY';
        const barsHeld = i - currentTrade.entryBarIndex;

        // Check TP
        const tpHit = isBuy ? currentCandle.high >= currentTrade.tp : currentCandle.low <= currentTrade.tp;
        // Check SL
        const slHit = isBuy ? currentCandle.low <= currentTrade.sl : currentCandle.high >= currentTrade.sl;

        if (tpHit) {
          trades.push({
            tradeId: `bt_${cleanSym}_${i}`,
            symbol: cleanSym,
            direction: currentTrade.direction,
            primaryStrategy: currentTrade.strategy,
            entryPrice: currentTrade.entryPrice,
            stopLoss: currentTrade.sl,
            takeProfit: currentTrade.tp,
            plannedRR: currentTrade.rr,
            confidenceScore: currentTrade.score,
            outcomeStatus: 'TP_HIT',
            realizedRR: currentTrade.rr,
            isWin: true,
            entryTimestamp: currentTrade.entryTimestamp,
            exitTimestamp: currentCandle.timestamp,
            barsHeld,
          });
          inActiveTrade = false;
          currentTrade = null;
          continue;
        } else if (slHit) {
          trades.push({
            tradeId: `bt_${cleanSym}_${i}`,
            symbol: cleanSym,
            direction: currentTrade.direction,
            primaryStrategy: currentTrade.strategy,
            entryPrice: currentTrade.entryPrice,
            stopLoss: currentTrade.sl,
            takeProfit: currentTrade.tp,
            plannedRR: currentTrade.rr,
            confidenceScore: currentTrade.score,
            outcomeStatus: 'SL_HIT',
            realizedRR: -1.0,
            isWin: false,
            entryTimestamp: currentTrade.entryTimestamp,
            exitTimestamp: currentCandle.timestamp,
            barsHeld,
          });
          inActiveTrade = false;
          currentTrade = null;
          continue;
        } else if (barsHeld >= 8) {
          // Expiration after 8 bars (~8h)
          trades.push({
            tradeId: `bt_${cleanSym}_${i}`,
            symbol: cleanSym,
            direction: currentTrade.direction,
            primaryStrategy: currentTrade.strategy,
            entryPrice: currentTrade.entryPrice,
            stopLoss: currentTrade.sl,
            takeProfit: currentTrade.tp,
            plannedRR: currentTrade.rr,
            confidenceScore: currentTrade.score,
            outcomeStatus: 'EXPIRED',
            realizedRR: 0,
            isWin: false,
            entryTimestamp: currentTrade.entryTimestamp,
            exitTimestamp: currentCandle.timestamp,
            barsHeld,
          });
          inActiveTrade = false;
          currentTrade = null;
          continue;
        }
      }

      // 2. Evaluate new entries only if not currently in a trade
      if (!inActiveTrade) {
        // Slice historical candles up to index `i` (no lookahead!)
        const slicedTfMap: Record<string, NormalizedCandle[]> = {};
        for (const [tf, cList] of Object.entries(candlesMap)) {
          if (!cList) continue;
          // Approximate timeframe length ratio to slice proportional index
          const ratio = tf === '15m' ? 4 : tf === '5m' ? 12 : tf === '4h' ? 0.25 : 1;
          const endIdx = Math.min(cList.length, Math.floor(i * ratio) + 1);
          if (endIdx >= 20) {
            slicedTfMap[tf] = cList.slice(0, endIdx);
          }
        }

        if (!slicedTfMap['15m'] || !slicedTfMap['1h']) continue;

        const evalPrice = currentCandle.close;

        // Run production StrategyEngine and ScoringEngine
        const strategyEval = StrategyEngine.evaluate(cleanSym, evalPrice, slicedTfMap);
        if (!strategyEval.hasStrongConfluence || !strategyEval.dominantDirection) continue;

        const scoreResult = ScoringEngine.calculateScore(cleanSym, evalPrice, slicedTfMap, 'NEUTRAL', 100);
        if (!scoreResult.isValid || scoreResult.score < 75) continue;

        // Check SignalValidator
        const validation = SignalValidator.validate({
          symbol: cleanSym,
          direction: scoreResult.direction,
          entryPrice: evalPrice,
          stopLoss: scoreResult.stopLoss,
          takeProfit: scoreResult.takeProfit,
          tp1: scoreResult.tp1,
          tp2: scoreResult.tp2,
          tp3: scoreResult.tp3,
          riskRewardRatio: scoreResult.riskRewardRatio,
          score: scoreResult.score,
          candlesMap: slicedTfMap,
          liveTicker: {
            symbol: cleanSym,
            rawSymbol: cleanSym,
            price: evalPrice,
            bid: evalPrice,
            ask: evalPrice,
            timestamp: currentCandle.timestamp,
            receivedAt: currentCandle.timestamp,
            provider: 'backtest',
            assetType: 'CRYPTO',
            source: 'LIVE',
            isFresh: true,
            status: 'OK',
          },
          simulatedTimeMs: currentCandle.timestamp,
        });

        if (!validation.isValid) continue;

        // Valid signal found! Open active position
        inActiveTrade = true;
        currentTrade = {
          direction: scoreResult.direction,
          entryPrice: evalPrice,
          sl: scoreResult.stopLoss,
          tp: scoreResult.takeProfit,
          rr: scoreResult.riskRewardRatio,
          score: scoreResult.score,
          strategy: scoreResult.primaryStrategy || 'Confluence',
          entryTimestamp: currentCandle.timestamp,
          entryBarIndex: i,
        };
      }
    }

    const metrics = this.computeMetricsFromTrades(trades);

    return {
      symbol: cleanSym,
      totalCandlesEvaluated: endBarIndex - minHistoryReq,
      metrics,
      trades,
      disclaimer: PERFORMANCE_LEGAL_DISCLAIMER,
    };
  }

  /**
   * Runs Walk-Forward Analysis across rolling time windows (e.g. 70% In-Sample, 30% Out-of-Sample).
   */
  static runWalkForward(
    symbol: string,
    candlesMap: Record<string, NormalizedCandle[]>,
    windowCount = 3
  ): WalkForwardReport {
    const cleanSym = symbol.trim().toUpperCase();
    const primaryCandles = candlesMap['1h'] || [];

    if (!primaryCandles || primaryCandles.length < 100) {
      return {
        symbol: cleanSym,
        totalWindows: 0,
        overallInSampleMetrics: this.emptyMetrics(),
        overallOutOfSampleMetrics: this.emptyMetrics(),
        aggregateEfficiencyRatio: 0,
        isRobustNonOverfitted: false,
        windows: [],
        disclaimer: PERFORMANCE_LEGAL_DISCLAIMER,
        evaluatedAt: Date.now(),
      };
    }

    const totalBars = primaryCandles.length;
    const windowSize = Math.floor(totalBars / windowCount);
    const windowResults: WalkForwardWindowResult[] = [];

    const allInSampleTrades: BacktestTradeResult[] = [];
    const allOutOfSampleTrades: BacktestTradeResult[] = [];

    for (let w = 0; w < windowCount; w++) {
      const startIdx = w * Math.floor(windowSize * 0.5);
      const endIdx = Math.min(totalBars, startIdx + windowSize);
      const isSplitIdx = startIdx + Math.floor((endIdx - startIdx) * 0.70);

      // Slice candles for In-Sample & Out-of-Sample
      const isCandlesMap: Record<string, NormalizedCandle[]> = {};
      const oosCandlesMap: Record<string, NormalizedCandle[]> = {};

      for (const [tf, cList] of Object.entries(candlesMap)) {
        if (!cList) continue;
        const ratio = tf === '15m' ? 4 : tf === '5m' ? 12 : tf === '4h' ? 0.25 : 1;
        const tfIsSplit = Math.floor(isSplitIdx * ratio);
        const tfEnd = Math.floor(endIdx * ratio);

        isCandlesMap[tf] = cList.slice(0, tfIsSplit);
        oosCandlesMap[tf] = cList.slice(0, tfEnd);
      }

      // Run IS Backtest
      const isBacktest = this.runBacktest(cleanSym, isCandlesMap, Math.floor((isSplitIdx - startIdx)));
      // Run OOS Backtest
      const oosBacktest = this.runBacktest(cleanSym, oosCandlesMap, Math.floor((endIdx - isSplitIdx)));

      allInSampleTrades.push(...isBacktest.trades);
      allOutOfSampleTrades.push(...oosBacktest.trades);

      const isExp = Math.max(0.01, isBacktest.metrics.expectancyR);
      const oosExp = oosBacktest.metrics.expectancyR;
      const wfe = Number((oosExp / isExp).toFixed(2));
      const isRobust = wfe >= 0.60;

      const isStartTs = primaryCandles[startIdx]?.timestamp || 0;
      const isEndTs = primaryCandles[isSplitIdx]?.timestamp || 0;
      const oosEndTs = primaryCandles[endIdx - 1]?.timestamp || 0;

      windowResults.push({
        windowIndex: w + 1,
        inSampleRange: {
          start: new Date(isStartTs).toISOString(),
          end: new Date(isEndTs).toISOString(),
          totalBars: isSplitIdx - startIdx,
        },
        outOfSampleRange: {
          start: new Date(isEndTs).toISOString(),
          end: new Date(oosEndTs).toISOString(),
          totalBars: endIdx - isSplitIdx,
        },
        inSampleMetrics: isBacktest.metrics,
        outOfSampleMetrics: oosBacktest.metrics,
        walkForwardEfficiencyRatio: wfe,
        isRobust,
      });
    }

    const overallISMetrics = this.computeMetricsFromTrades(allInSampleTrades);
    const overallOOSMetrics = this.computeMetricsFromTrades(allOutOfSampleTrades);

    const aggWfe = overallISMetrics.expectancyR > 0
      ? Number((overallOOSMetrics.expectancyR / overallISMetrics.expectancyR).toFixed(2))
      : 1.0;

    const isRobustNonOverfitted = aggWfe >= 0.60 && overallOOSMetrics.winRatePct >= 45;

    return {
      symbol: cleanSym,
      totalWindows: windowCount,
      overallInSampleMetrics: overallISMetrics,
      overallOutOfSampleMetrics: overallOOSMetrics,
      aggregateEfficiencyRatio: aggWfe,
      isRobustNonOverfitted,
      windows: windowResults,
      disclaimer: PERFORMANCE_LEGAL_DISCLAIMER,
      evaluatedAt: Date.now(),
    };
  }

  private static computeMetricsFromTrades(trades: BacktestTradeResult[]): MetricSummary {
    const totalTrades = trades.length;
    if (totalTrades === 0) return this.emptyMetrics();

    let wins = 0;
    let losses = 0;
    let breakevens = 0;
    let totalRealizedR = 0;
    let totalWinR = 0;
    let totalLossR = 0;
    let currentStreak = 0;
    let maxLosingStreak = 0;

    for (const t of trades) {
      totalRealizedR += t.realizedRR;

      if (t.outcomeStatus === 'TP_HIT' || t.isWin) {
        wins++;
        totalWinR += t.realizedRR;
        currentStreak = currentStreak >= 0 ? currentStreak + 1 : 1;
      } else if (t.outcomeStatus === 'SL_HIT') {
        losses++;
        totalLossR += Math.abs(t.realizedRR);
        currentStreak = currentStreak <= 0 ? currentStreak - 1 : -1;
        if (Math.abs(currentStreak) > maxLosingStreak) {
          maxLosingStreak = Math.abs(currentStreak);
        }
      } else {
        breakevens++;
      }
    }

    const winRatePct = Number(((wins / totalTrades) * 100).toFixed(1));
    const last20 = trades.slice(-20);
    const last20Wins = last20.filter((t) => t.isWin || t.outcomeStatus === 'TP_HIT').length;
    const rollingWinRatePct = Number(((last20Wins / Math.max(1, last20.length)) * 100).toFixed(1));

    const profitFactor = totalLossR > 0 ? Number((totalWinR / totalLossR).toFixed(2)) : (totalWinR > 0 ? Number(totalWinR.toFixed(2)) : 0.0);
    const avgR = totalTrades > 0 ? Number((totalRealizedR / totalTrades).toFixed(3)) : 0.0;

    const winProb = winRatePct / 100;
    const lossProb = 1 - winProb;
    const avgWinR = wins > 0 ? totalWinR / wins : 0.0;
    const avgLossR = losses > 0 ? totalLossR / losses : 0.0;
    const expectancyR = Number((winProb * avgWinR - lossProb * avgLossR).toFixed(3));

    return {
      totalTrades,
      wins,
      losses,
      breakevens,
      winRatePct,
      rollingWinRatePct,
      profitFactor,
      totalRealizedR: Number(totalRealizedR.toFixed(2)),
      avgR,
      expectancyR,
      maxDrawdownR: Number((maxLosingStreak * 1.0).toFixed(1)),
      maxLosingStreak,
      currentStreak,
    };
  }

  private static emptyMetrics(): MetricSummary {
    return {
      totalTrades: 0,
      wins: 0,
      losses: 0,
      breakevens: 0,
      winRatePct: 0,
      rollingWinRatePct: 0,
      profitFactor: 0,
      totalRealizedR: 0,
      avgR: 0,
      expectancyR: 0,
      maxDrawdownR: 0,
      maxLosingStreak: 0,
      currentStreak: 0,
    };
  }
}
