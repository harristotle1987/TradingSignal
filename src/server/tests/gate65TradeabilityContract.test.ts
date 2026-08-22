import { describe, it, expect, beforeEach } from 'vitest';
import { TradeRankingEngine } from '../signals/TradeRankingEngine.js';
import { serverConfig } from '../config.js';
import { Gate27RegimeThresholds } from '../signals/Gate27RegimeThresholds.js';
import { TradingSignal } from '../../types/index.js';

describe('GATE 65: Centralized Final Tradeability Contract', () => {
  beforeEach(() => {
    // Reset config thresholds to standard defaults (signalThreshold: 78)
    serverConfig.updateThresholds({
      signalThreshold: 78,
      watchingThreshold: 70,
      qualifiedCandidateThreshold: 74,
      minimumWinProbability: 55,
      minimumRR: 1.5,
      minimumNetRR: 1.2,
    });
  });

  it('calculates finalRequiredScore as Math.max(thresholds.signalThreshold, regimeAdaptiveThreshold)', () => {
    // Case 1: Score 76 + STRONG_TREND (base 75) + TREND_CONTINUATION (0 mod) -> adaptive threshold 75
    // Floor is 78 -> finalRequiredScore = 78 -> NOT TRADEABLE (76 < 78)
    const res1 = TradeRankingEngine.calculateFinalRequiredScore({
      symbol: 'BTCUSDT',
      actualScore: 76,
      regime: 'STRONG_TREND',
      strategy: 'TREND_CONTINUATION',
      assetClass: 'CRYPTO',
      signalThreshold: 78,
    });

    expect(res1.isExecutable).toBe(true);
    expect(res1.regimeAdaptiveThreshold).toBe(75); // Strong trend base 75
    expect(res1.finalRequiredScore).toBe(78); // Math.max(78, 75)
    expect(res1.passed).toBe(false);
    expect(res1.actualScore).toBe(76);

    // Case 2: Score 77 + NORMAL_TREND (base 78) + TREND_CONTINUATION (0 mod) -> adaptive threshold 78
    // Floor is 78 -> finalRequiredScore = 78 -> NOT TRADEABLE (77 < 78)
    const res2 = TradeRankingEngine.calculateFinalRequiredScore({
      symbol: 'ETHUSDT',
      actualScore: 77,
      regime: 'NORMAL_TREND',
      strategy: 'TREND_CONTINUATION',
      assetClass: 'CRYPTO',
      signalThreshold: 78,
    });

    expect(res2.isExecutable).toBe(true);
    expect(res2.regimeAdaptiveThreshold).toBe(78);
    expect(res2.finalRequiredScore).toBe(78);
    expect(res2.passed).toBe(false);

    // Case 3: Score 78 + NORMAL_TREND (adaptive threshold 78)
    // Floor is 78 -> finalRequiredScore = 78 -> TRADEABLE (78 >= 78)
    const res3 = TradeRankingEngine.calculateFinalRequiredScore({
      symbol: 'ETHUSDT',
      actualScore: 78,
      regime: 'NORMAL_TREND',
      strategy: 'TREND_CONTINUATION',
      assetClass: 'CRYPTO',
      signalThreshold: 78,
    });

    expect(res3.isExecutable).toBe(true);
    expect(res3.finalRequiredScore).toBe(78);
    expect(res3.passed).toBe(true);

    // Case 4: Score 82 + HIGH_VOLATILITY (base 82) + BREAKOUT (0 mod) -> adaptive threshold 82
    // Floor is 78 -> finalRequiredScore = 82 -> TRADEABLE (82 >= 82)
    const res4 = TradeRankingEngine.calculateFinalRequiredScore({
      symbol: 'SOLUSDT',
      actualScore: 82,
      regime: 'HIGH_VOLATILITY',
      strategy: 'BREAKOUT',
      assetClass: 'CRYPTO',
      signalThreshold: 78,
    });

    expect(res4.isExecutable).toBe(true);
    expect(res4.regimeAdaptiveThreshold).toBe(82);
    expect(res4.finalRequiredScore).toBe(82);
    expect(res4.passed).toBe(true);

    // Case 5: Score 90 + UNKNOWN regime -> NOT TRADEABLE (Gate 27 policy: UNKNOWN -> NO SIGNAL)
    const res5 = TradeRankingEngine.calculateFinalRequiredScore({
      symbol: 'BTCUSDT',
      actualScore: 90,
      regime: 'UNKNOWN',
      strategy: 'TREND_CONTINUATION',
      assetClass: 'CRYPTO',
      signalThreshold: 78,
    });

    expect(res5.isExecutable).toBe(false);
    expect(res5.passed).toBe(false);
  });

  it('ensures Gate 27 never overrides or lowers the global final signal floor (scores 75-77 are never tradeable when signalThreshold=78)', () => {
    for (const score of [75, 76, 77]) {
      const evaluation = TradeRankingEngine.calculateFinalRequiredScore({
        symbol: 'BTCUSDT',
        actualScore: score,
        regime: 'STRONG_TREND', // Has lower regime threshold (75)
        strategy: 'MOMENTUM',
        assetClass: 'CRYPTO',
        signalThreshold: 78,
      });

      expect(evaluation.passed).toBe(false);
      expect(evaluation.finalRequiredScore).toBeGreaterThanOrEqual(78);
    }
  });

  it('rejects candidate in rankOpportunities when score is below global signalThreshold even if regime adaptive threshold is lower', () => {
    const mockCandidate = {
      signal: {
        id: 'test_1',
        symbol: 'BTCUSDT',
        direction: 'BUY' as const,
        entryPrice: 50000,
        stopLoss: 49000,
        takeProfit: 52000,
        strategy: 'MOMENTUM',
        timeframe: '1h',
        timestamp: Date.now(),
        marketRegime: 'STRONG_TREND',
        assetClass: 'CRYPTO',
      } as TradingSignal,
      scoring: {
        score: 76,
        confidenceScore: 76,
        direction: 'BUY' as const,
        marketRegime: 'STRONG_TREND',
        passedStrategies: ['MOMENTUM'],
        factors: { totalScore: 76 } as any,
      } as any,
      validation: { isValid: true } as any,
      timeframesAligned: 3,
    };

    const ranking = TradeRankingEngine.rankOpportunities([mockCandidate]);

    // Should be rejected because 76 < 78 floor
    expect(ranking.allRanked.length).toBe(0);
    expect(ranking.rejectedCandidates.length).toBe(1);
    expect(ranking.rejectedCandidates[0].symbol).toBe('BTCUSDT');
  });

  it('accepts candidate in rankOpportunities when score meets or exceeds Math.max(signalThreshold, regimeThreshold)', () => {
    const mockCandidate = {
      signal: {
        id: 'test_2',
        symbol: 'BTCUSDT',
        direction: 'BUY' as const,
        entryPrice: 50000,
        stopLoss: 49000,
        takeProfit: 52000,
        strategy: 'MOMENTUM',
        timeframe: '1h',
        timestamp: Date.now(),
        marketRegime: 'STRONG_TREND',
        assetClass: 'CRYPTO',
      } as TradingSignal,
      scoring: {
        score: 78,
        confidenceScore: 78,
        direction: 'BUY' as const,
        marketRegime: 'STRONG_TREND',
        passedStrategies: ['MOMENTUM'],
        factors: { totalScore: 78 } as any,
      } as any,
      validation: { isValid: true } as any,
      timeframesAligned: 3,
    };

    const ranking = TradeRankingEngine.rankOpportunities([mockCandidate]);

    expect(ranking.allRanked.length).toBe(1);
    expect(ranking.bestTrade?.symbol).toBe('BTCUSDT');
  });
});
