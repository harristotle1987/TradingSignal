import assert from 'assert';
import { Gate20ProbabilityCalibration } from '../signals/Gate20ProbabilityCalibration.js';
import { DetailedTradeRecord } from '../signals/Gate19RegimePerformanceMatrix.js';

import { describe, it } from "vitest";
describe("probabilityCalibration.test.ts", () => {
  it("runs the test suite", async () => {
    
    console.log('========================================================================');
    console.log('STARTING GATE 20: EMPIRICAL PROBABILITY CALIBRATION TESTS');
    console.log('========================================================================');
    
    // --- TEST 1: Score Bucket Mapping ---
    console.log('\n--- TEST 1: Score Bucket Mapping ---');
    {
      assert.strictEqual(Gate20ProbabilityCalibration.getScoreBucket(98), '95-100');
      assert.strictEqual(Gate20ProbabilityCalibration.getScoreBucket(92), '90-94');
      assert.strictEqual(Gate20ProbabilityCalibration.getScoreBucket(88), '85-89');
      assert.strictEqual(Gate20ProbabilityCalibration.getScoreBucket(82), '80-84');
      assert.strictEqual(Gate20ProbabilityCalibration.getScoreBucket(77), '75-79');
      assert.strictEqual(Gate20ProbabilityCalibration.getScoreBucket(71), '70-74');
      assert.strictEqual(Gate20ProbabilityCalibration.getScoreBucket(65), 'BELOW_70');
    
      console.log('[PASS] All signal scores mapped accurately to canonical score buckets.');
    }
    
    // --- TEST 2: Score vs. Probability Separation & Insufficient Sample Protection ---
    console.log('\n--- TEST 2: Score vs. Probability Separation & Insufficient Sample Protection ---');
    {
      // Create 5 trade records in bucket 85-89 (less than min threshold 30)
      const tinyHistory: DetailedTradeRecord[] = Array.from({ length: 5 }, (_, i) => ({
        tradeId: `tiny_${i}`,
        strategy: 'TREND_PULLBACK',
        asset: 'BTCUSDT',
        assetClass: 'CRYPTO',
        marketRegime: 'BULL',
        timeframe: '1h',
        session: 'GLOBAL',
        signalScore: 88,
        result: i < 4 ? 'TP_HIT' : 'SL_HIT',
        rMultiple: i < 4 ? 2.0 : -1.0,
        mae: 0.3,
        mfe: 2.1,
        timestamp: Date.now() - i * 3600000,
      }));
    
      const res = Gate20ProbabilityCalibration.calibrateProbability(
        { signalScore: 88, strategy: 'TREND_PULLBACK' },
        tinyHistory
      );
    
      assert.strictEqual(res.empiricalProbability, null, 'Probability is strictly null when sample size < 30');
      assert.strictEqual(res.confidenceInterval, null, 'Confidence interval is strictly null when sample size < 30');
      assert.strictEqual(res.calibrationStatus, 'INSUFFICIENT_DATA', 'Status is INSUFFICIENT_DATA');
      assert.strictEqual(res.sampleSize, 5, 'Sample size equals 5');
    
      console.log(`[PASS] Signal Score 88 strictly separated from win probability (Probability=null, Status=${res.calibrationStatus}, N=${res.sampleSize})`);
    }
    
    // --- TEST 3: Empirical Probability Calibration & Wilson Score Interval (100 Trades: 67 Wins) ---
    console.log('\n--- TEST 3: Empirical Probability Calibration & Wilson Score Interval ---');
    {
      // 100 historical trades scoring 87 (67 wins, 33 losses -> 67% empirical win rate)
      const calibratedHistory: DetailedTradeRecord[] = Array.from({ length: 100 }, (_, i) => ({
        tradeId: `calib_${i}`,
        strategy: 'TREND_PULLBACK',
        asset: 'ETHUSDT',
        assetClass: 'CRYPTO',
        marketRegime: 'BULL',
        timeframe: '1h',
        session: 'GLOBAL',
        signalScore: 87,
        result: i < 67 ? 'TP_HIT' : 'SL_HIT',
        rMultiple: i < 67 ? 2.0 : -1.0,
        mae: 0.4,
        mfe: 2.0,
        timestamp: Date.now() - i * 3600000,
      }));
    
      const res = Gate20ProbabilityCalibration.calibrateProbability(
        { signalScore: 87, strategy: 'TREND_PULLBACK' },
        calibratedHistory
      );
    
      assert.strictEqual(res.empiricalProbability, 67.0, 'Empirical win probability calibrated to 67.0%');
      assert.strictEqual(res.calibrationStatus, 'HIGH_CONFIDENCE_CALIBRATION', 'Calibrated with HIGH_CONFIDENCE_CALIBRATION (N=100)');
      assert.ok(res.confidenceInterval !== null, 'Wilson score confidence interval generated');
      assert.ok(res.confidenceInterval!.lowerPct >= 55.0 && res.confidenceInterval!.lowerPct <= 60.0, `Lower CI (~57.3%): got ${res.confidenceInterval!.lowerPct}%`);
      assert.ok(res.confidenceInterval!.upperPct >= 72.0 && res.confidenceInterval!.upperPct <= 77.0, `Upper CI (~75.4%): got ${res.confidenceInterval!.upperPct}%`);
    
      console.log(`[PASS] Score 87 calibrated to 67.0% Win Rate [95% CI: ${res.confidenceInterval!.lowerPct}%–${res.confidenceInterval!.upperPct}%] from N=100 trades`);
    }
    
    // --- TEST 4: Wilson Score Mathematical Precision ---
    console.log('\n--- TEST 4: Wilson Score Mathematical Precision ---');
    {
      // 50 trades, 30 wins (60% sample win rate)
      const ci = Gate20ProbabilityCalibration.calculateWilsonScoreInterval(30, 50, 1.96);
    
      assert.ok(ci.lowerPct >= 45.0 && ci.lowerPct <= 48.0, `Wilson lower bound calculation accurate: got ${ci.lowerPct}%`);
      assert.ok(ci.upperPct >= 71.0 && ci.upperPct <= 74.0, `Wilson upper bound calculation accurate: got ${ci.upperPct}%`);
    
      console.log(`[PASS] Wilson 95% CI for 30/50 wins calculated accurately: [${ci.lowerPct}%, ${ci.upperPct}%]`);
    }
    
    // --- TEST 5: Interface Contract & Schema Verification ---
    console.log('\n--- TEST 5: Interface Contract & Schema Verification ---');
    {
      const res = Gate20ProbabilityCalibration.calibrateProbability({ signalScore: 92 });
    
      assert.ok('empiricalProbability' in res, 'Exposes empiricalProbability');
      assert.ok(typeof res.scoreBucket === 'string', 'Exposes scoreBucket');
      assert.ok(typeof res.sampleSize === 'number', 'Exposes sampleSize');
      assert.ok(typeof res.calibrationStatus === 'string', 'Exposes calibrationStatus');
      assert.ok(Array.isArray(res.reasons), 'Exposes reasons array');
      assert.ok(typeof res.summary === 'string', 'Exposes summary string');
    
      console.log('[PASS] Exposes result.empiricalProbability');
      console.log('[PASS] Exposes result.scoreBucket');
      console.log('[PASS] Exposes result.sampleSize');
      console.log('[PASS] Exposes result.calibrationStatus');
      console.log('[PASS] Exposes result.reasons');
      console.log('[PASS] Exposes result.summary');
    }
    
    console.log('\n========================================================================');
    console.log('GATE 20 EMPIRICAL PROBABILITY CALIBRATION SUITE COMPLETE: ALL TESTS PASSED');
    console.log('========================================================================\n');
    
  });
});
