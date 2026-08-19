import assert from 'assert';
import { Gate21WalkForwardValidation } from '../signals/Gate21WalkForwardValidation.js';
import { DetailedTradeRecord } from '../signals/Gate19RegimePerformanceMatrix.js';

console.log('========================================================================');
console.log('STARTING GATE 21: WALK-FORWARD VALIDATION TESTS');
console.log('========================================================================');

// --- TEST 1: Robust Strategy Walk-Forward Validation ---
console.log('\n--- TEST 1: Robust Strategy Walk-Forward Validation ---');
{
  const now = Date.now();
  // 30 chronological trades (21 IS, 9 OOS)
  // IS: 15 wins (+2R), 6 losses (-1R) -> Win Rate 71.4%, Exp ~1.14R
  // OOS: 6 wins (+2R), 3 losses (-1R) -> Win Rate 66.7%, Exp ~1.00R
  const robustHistory: DetailedTradeRecord[] = Array.from({ length: 30 }, (_, i) => {
    const isTrainWindow = i < 21;
    const isWin = isTrainWindow ? (i % 7 < 5) : (i % 3 < 2);
    return {
      tradeId: `robust_${i}`,
      strategy: 'TREND_PULLBACK',
      asset: 'BTCUSDT',
      assetClass: 'CRYPTO',
      marketRegime: 'BULL',
      timeframe: '1h',
      session: 'GLOBAL',
      signalScore: 85,
      result: isWin ? 'TP_HIT' : 'SL_HIT',
      rMultiple: isWin ? 2.0 : -1.0,
      mae: 0.3,
      mfe: 2.1,
      timestamp: now - (30 - i) * 3600000, // Chronological ordering
    };
  });

  const res = Gate21WalkForwardValidation.validateStrategy('TREND_PULLBACK', robustHistory);

  assert.strictEqual(res.strategy, 'TREND_PULLBACK', 'Evaluates strategy TREND_PULLBACK');
  assert.strictEqual(res.inSampleMetrics.numTrades, 21, '21 trades allocated to In-Sample window');
  assert.strictEqual(res.outOfSampleMetrics.numTrades, 9, '9 trades allocated to Out-Of-Sample window');
  assert.ok(res.walkForwardEfficiency !== null && res.walkForwardEfficiency >= 75.0, `Walk-Forward Efficiency robust (got ${res.walkForwardEfficiency}%)`);
  assert.strictEqual(res.overfitRiskDetected, false, 'No overfit risk detected for robust strategy');
  assert.strictEqual(res.status, 'ROBUST_STABLE', 'Status classified as ROBUST_STABLE');

  console.log(`[PASS] Robust Strategy validated: WFE = ${res.walkForwardEfficiency}%, Status = ${res.status}, OverfitRisk = ${res.overfitRiskDetected}`);
}

// --- TEST 2: Overfit Risk Detection (Severe Out-of-Sample Degradation) ---
console.log('\n--- TEST 2: Overfit Risk Detection (Severe Out-of-Sample Degradation) ---');
{
  const now = Date.now();
  // 30 chronological trades
  // IS: 18 wins (+2R), 3 losses (-1R) -> 85.7% Win Rate, +1.57R Exp
  // OOS: 1 win (+2R), 8 losses (-1R) -> 11.1% Win Rate, -0.67R Exp (Severe Collapse)
  const overfitHistory: DetailedTradeRecord[] = Array.from({ length: 30 }, (_, i) => {
    const isTrainWindow = i < 21;
    const isWin = isTrainWindow ? (i < 18) : (i === 21);
    return {
      tradeId: `overfit_${i}`,
      strategy: 'BREAKOUT',
      asset: 'NVDA',
      assetClass: 'STOCKS',
      marketRegime: 'BREAKOUT',
      timeframe: '15m',
      session: 'NEW_YORK',
      signalScore: 92,
      result: isWin ? 'TP_HIT' : 'SL_HIT',
      rMultiple: isWin ? 2.0 : -1.0,
      mae: 0.4,
      mfe: 2.0,
      timestamp: now - (30 - i) * 3600000,
    };
  });

  const res = Gate21WalkForwardValidation.validateStrategy('BREAKOUT', overfitHistory);

  assert.strictEqual(res.overfitRiskDetected, true, 'Flags OVERFIT_RISK when OOS expectancy collapses to negative');
  assert.strictEqual(res.status, 'HIGH_OVERFIT_RISK', 'Classifies status as HIGH_OVERFIT_RISK');
  assert.ok(res.reasons.length > 0, 'Populates diagnostic reasons for degradation');

  console.log(`[PASS] Overfit Risk correctly detected: WFE = ${res.walkForwardEfficiency}%, Status = ${res.status}, OverfitRisk = ${res.overfitRiskDetected}`);
}

// --- TEST 3: Insufficient Data Protection ---
console.log('\n--- TEST 3: Insufficient Data Protection ---');
{
  const tinyHistory: DetailedTradeRecord[] = Array.from({ length: 5 }, (_, i) => ({
    tradeId: `tiny_${i}`,
    strategy: 'RANGE_REVERSAL',
    asset: 'EURUSD',
    assetClass: 'FOREX',
    marketRegime: 'RANGE',
    timeframe: '1h',
    session: 'LONDON',
    signalScore: 80,
    result: i < 3 ? 'TP_HIT' : 'SL_HIT',
    rMultiple: i < 3 ? 1.5 : -1.0,
    mae: 0.3,
    mfe: 1.6,
    timestamp: Date.now() - (5 - i) * 3600000,
  }));

  const res = Gate21WalkForwardValidation.validateStrategy('RANGE_REVERSAL', tinyHistory);

  assert.strictEqual(res.status, 'INSUFFICIENT_DATA', 'Status is INSUFFICIENT_DATA for N=5 trades');
  assert.strictEqual(res.walkForwardEfficiency, null, 'WFE is null for insufficient data');
  assert.strictEqual(res.overfitRiskDetected, false, 'Does not flag overfit risk without sufficient data');

  console.log(`[PASS] Insufficient sample protected (Status=${res.status}, WFE=null)`);
}

// --- TEST 4: Interface Contract & Schema Verification ---
console.log('\n--- TEST 4: Interface Contract & Schema Verification ---');
{
  const res = Gate21WalkForwardValidation.validateStrategy('MOMENTUM_CONTINUATION', []);

  assert.ok(typeof res.strategy === 'string', 'Exposes strategy name');
  assert.ok('inSampleMetrics' in res, 'Exposes inSampleMetrics');
  assert.ok('outOfSampleMetrics' in res, 'Exposes outOfSampleMetrics');
  assert.ok('walkForwardEfficiency' in res, 'Exposes walkForwardEfficiency');
  assert.ok(typeof res.overfitRiskDetected === 'boolean', 'Exposes overfitRiskDetected');
  assert.ok(typeof res.status === 'string', 'Exposes status');
  assert.ok(Array.isArray(res.reasons), 'Exposes reasons array');
  assert.ok(typeof res.summary === 'string', 'Exposes summary string');

  console.log('[PASS] Exposes result.strategy');
  console.log('[PASS] Exposes result.inSampleMetrics');
  console.log('[PASS] Exposes result.outOfSampleMetrics');
  console.log('[PASS] Exposes result.walkForwardEfficiency');
  console.log('[PASS] Exposes result.overfitRiskDetected');
  console.log('[PASS] Exposes result.status');
  console.log('[PASS] Exposes result.reasons');
  console.log('[PASS] Exposes result.summary');
}

console.log('\n========================================================================');
console.log('GATE 21 WALK-FORWARD VALIDATION SUITE COMPLETE: ALL TESTS PASSED');
console.log('========================================================================\n');
