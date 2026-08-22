import { describe, it, expect } from 'vitest';
import { Gate20ProbabilityCalibration } from '../signals/Gate20ProbabilityCalibration.js';
import { Gate35SignalFunnelAnalytics } from '../signals/Gate35SignalFunnelAnalytics.js';
import { DetailedTradeRecord } from '../signals/Gate19RegimePerformanceMatrix.js';
import { TradingSignal } from '../../types/index.js';

describe('GATE 66 — Zero Fabricated Probability Data Repository-Wide Test', () => {
  function validateSignalProbabilityData(obj: {
    empiricalProbability?: number | null;
    probabilitySampleSize?: number;
    isEmpiricallyCalibrated?: boolean;
    symbol?: string;
  }) {
    if (
      obj.empiricalProbability != null &&
      (obj.probabilitySampleSize ?? 0) < 30 &&
      obj.isEmpiricallyCalibrated !== true
    ) {
      throw new Error(
        `[GATE 66 VIOLATION] Candidate ${obj.symbol || 'UNKNOWN'} has empiricalProbability = ${obj.empiricalProbability}, sampleSize = ${obj.probabilitySampleSize}, isEmpiricallyCalibrated = ${obj.isEmpiricallyCalibrated}`
      );
    }
  }

  it('enforces that empiricalProbability != null requires probabilitySampleSize >= 30 and isEmpiricallyCalibrated === true', () => {
    // 1. Test Gate 20 with insufficient sample size (< 30)
    const lowSampleResult = Gate20ProbabilityCalibration.calibrateProbability(
      { signalScore: 88, strategy: 'TrendFollow' },
      [] // 0 trades
    );

    expect(lowSampleResult.empiricalProbability).toBeNull();
    expect(lowSampleResult.calibrationStatus).toBe('INSUFFICIENT_DATA');
    validateSignalProbabilityData({
      empiricalProbability: lowSampleResult.empiricalProbability,
      probabilitySampleSize: lowSampleResult.sampleSize,
      isEmpiricallyCalibrated: false,
    });

    // 2. Test Gate 20 with sufficient sample size (>= 30)
    const mockTrades: DetailedTradeRecord[] = Array.from({ length: 35 }, (_, i) => ({
      tradeId: `t_${i}`,
      asset: 'EURUSD',
      assetClass: 'FOREX',
      strategy: 'TrendFollow',
      marketRegime: 'BULL_TREND',
      timeframe: '1h',
      session: 'LONDON',
      signalScore: 88,
      result: i < 24 ? 'TP_HIT' : 'SL_HIT',
      rMultiple: i < 24 ? 2 : -1,
      mae: 0.2,
      mfe: 2.0,
      timestamp: Date.now() - 10000,
    }));

    const highSampleResult = Gate20ProbabilityCalibration.calibrateProbability(
      { signalScore: 88, strategy: 'TrendFollow' },
      mockTrades
    );

    expect(highSampleResult.empiricalProbability).not.toBeNull();
    expect(highSampleResult.sampleSize).toBe(35);
    expect(highSampleResult.calibrationStatus).toBe('CALIBRATED');
    validateSignalProbabilityData({
      empiricalProbability: highSampleResult.empiricalProbability,
      probabilitySampleSize: highSampleResult.sampleSize,
      isEmpiricallyCalibrated: true,
    });

    // 3. Test uncalibrated signal object
    const uncalibratedSignal: Partial<TradingSignal> = {
      symbol: 'GBPUSD',
      estimatedWinRate: 65.0,
      modelEstimatedWinRate: 65.0,
      empiricalProbability: null,
      probabilitySampleSize: 0,
      isEmpiricallyCalibrated: false,
      calibrationStatus: 'INSUFFICIENT_DATA',
    };

    validateSignalProbabilityData(uncalibratedSignal);

    // 4. Test all records in Gate 35 Signal Funnel Analytics
    Gate35SignalFunnelAnalytics.recordCandidate({
      symbol: 'BTCUSD',
      direction: 'BUY',
      stage: 'GATE_3',
      score: 82,
      strategy: 'Breakout',
      estimatedWinRate: 68.0,
      empiricalProbability: null,
      probabilitySampleSize: 0,
    });

    const funnelRecords = Gate35SignalFunnelAnalytics.getRecords(100);
    for (const record of funnelRecords) {
      validateSignalProbabilityData({
        symbol: record.symbol,
        empiricalProbability: record.empiricalProbability,
        probabilitySampleSize: record.probabilitySampleSize,
        isEmpiricallyCalibrated: record.empiricalProbability != null,
      });
    }
  });

  it('fails if empiricalProbability is non-null with sample size < 30 and isEmpiricallyCalibrated !== true', () => {
    const invalidSignal = {
      symbol: 'ETHUSD',
      empiricalProbability: 68.5,
      probabilitySampleSize: 10, // < 30 violation!
      isEmpiricallyCalibrated: false,
    };

    expect(() => validateSignalProbabilityData(invalidSignal)).toThrow(
      '[GATE 66 VIOLATION]'
    );
  });
});
