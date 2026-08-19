import assert from 'assert';
import { Gate22MonteCarloSimulation, MONTE_CARLO_DISCLAIMER } from '../signals/Gate22MonteCarloSimulation.js';
import { DetailedTradeRecord } from '../signals/Gate19RegimePerformanceMatrix.js';

console.log('========================================================================');
console.log('STARTING GATE 22: MONTE CARLO TRADE-SEQUENCE ANALYSIS TESTS');
console.log('========================================================================');

// --- TEST 1: Robust System Monte Carlo Permutation (1,000 Iterations) ---
console.log('\n--- TEST 1: Robust System Monte Carlo Permutation ---');
{
  // 30 actual completed trades (70% wins @ +2.0R, 30% losses @ -1.0R)
  const robustHistory: DetailedTradeRecord[] = Array.from({ length: 30 }, (_, i) => ({
    tradeId: `robust_mc_${i}`,
    strategy: 'TREND_PULLBACK',
    asset: 'BTCUSDT',
    assetClass: 'CRYPTO',
    marketRegime: 'BULL',
    timeframe: '1h',
    session: 'GLOBAL',
    signalScore: 88,
    result: i % 10 < 7 ? 'TP_HIT' : 'SL_HIT',
    rMultiple: i % 10 < 7 ? 2.0 : -1.0,
    mae: 0.3,
    mfe: 2.1,
    timestamp: Date.now() - i * 3600000,
  }));

  const res = Gate22MonteCarloSimulation.runSimulation('TREND_PULLBACK', robustHistory);

  assert.strictEqual(res.simulationsCount, 1000, 'Ran 1,000 Monte Carlo simulations');
  assert.strictEqual(res.sampleTradeCount, 30, 'Resampled from 30 actual completed trade records');
  assert.ok(res.medianMaxDrawdownR !== null && res.medianMaxDrawdownR >= 0, `Median Max DD computed (${res.medianMaxDrawdownR} R)`);
  assert.ok(res.percentile95MaxDrawdownR !== null && res.percentile95MaxDrawdownR >= res.medianMaxDrawdownR!, `95th Percentile Max DD computed (${res.percentile95MaxDrawdownR} R >= Median)`);
  assert.ok(res.riskOfRuinPct !== null && res.riskOfRuinPct < 5.0, `Low Risk of Ruin for profitable strategy (${res.riskOfRuinPct}%)`);
  assert.strictEqual(res.simulationStatus, 'ROBUST_STABLE', 'Classified as ROBUST_STABLE');
  assert.strictEqual(res.disclaimer, MONTE_CARLO_DISCLAIMER, 'Includes standard statistical simulation disclaimer');

  console.log(`[PASS] Robust System Monte Carlo (1,000 runs): Median Max DD = ${res.medianMaxDrawdownR}R, 95th Pct DD = ${res.percentile95MaxDrawdownR}R, Ruin Prob = ${res.riskOfRuinPct}%, Status = ${res.simulationStatus}`);
}

// --- TEST 2: High Ruin Risk / Negative Expectancy Permutation ---
console.log('\n--- TEST 2: High Ruin Risk / Negative Expectancy Permutation ---');
{
  // 30 actual completed trades with negative expectancy (20% wins @ +1.0R, 80% losses @ -1.5R)
  const lossHistory: DetailedTradeRecord[] = Array.from({ length: 30 }, (_, i) => ({
    tradeId: `loss_mc_${i}`,
    strategy: 'BREAKOUT',
    asset: 'EURUSD',
    assetClass: 'FOREX',
    marketRegime: 'RANGE',
    timeframe: '15m',
    session: 'LONDON',
    signalScore: 75,
    result: i % 10 < 2 ? 'TP_HIT' : 'SL_HIT',
    rMultiple: i % 10 < 2 ? 1.0 : -1.5,
    mae: 0.9,
    mfe: 0.5,
    timestamp: Date.now() - i * 3600000,
  }));

  const res = Gate22MonteCarloSimulation.runSimulation('BREAKOUT', lossHistory);

  assert.ok(res.probabilityOfSevereDrawdownPct !== null && res.probabilityOfSevereDrawdownPct > 15.0, `Detected high severe drawdown probability (${res.probabilityOfSevereDrawdownPct}%)`);
  assert.ok(res.simulationStatus === 'ELEVATED_DRAWDOWN_RISK' || res.simulationStatus === 'HIGH_RUIN_RISK', `Correctly flagged elevated risk status (${res.simulationStatus})`);

  console.log(`[PASS] High Ruin Risk System detected: Severe DD Prob = ${res.probabilityOfSevereDrawdownPct}%, Ruin Prob = ${res.riskOfRuinPct}%, Status = ${res.simulationStatus}`);
}

// --- TEST 3: Insufficient Trade Count Protection ---
console.log('\n--- TEST 3: Insufficient Trade Count Protection ---');
{
  const tinyHistory: DetailedTradeRecord[] = Array.from({ length: 5 }, (_, i) => ({
    tradeId: `tiny_mc_${i}`,
    strategy: 'RANGE_REVERSAL',
    asset: 'ETHUSDT',
    assetClass: 'CRYPTO',
    marketRegime: 'RANGE',
    timeframe: '1h',
    session: 'GLOBAL',
    signalScore: 80,
    result: i < 3 ? 'TP_HIT' : 'SL_HIT',
    rMultiple: i < 3 ? 1.5 : -1.0,
    mae: 0.3,
    mfe: 1.6,
    timestamp: Date.now() - i * 3600000,
  }));

  const res = Gate22MonteCarloSimulation.runSimulation('RANGE_REVERSAL', tinyHistory);

  assert.strictEqual(res.simulationStatus, 'INSUFFICIENT_DATA', 'Status is INSUFFICIENT_DATA for N=5 trades (< 15 min)');
  assert.strictEqual(res.medianMaxDrawdownR, null, 'Median Max DD is null');
  assert.strictEqual(res.riskOfRuinPct, null, 'Risk of Ruin is null');

  console.log(`[PASS] Insufficient sample size protected (< 15 trades -> Status=${res.simulationStatus})`);
}

// --- TEST 4: Interface Contract & Schema Verification ---
console.log('\n--- TEST 4: Interface Contract & Schema Verification ---');
{
  const res = Gate22MonteCarloSimulation.runSimulation('UNKNOWN_STRATEGY', []);

  assert.ok(typeof res.simulationsCount === 'number', 'Exposes simulationsCount');
  assert.ok(typeof res.sampleTradeCount === 'number', 'Exposes sampleTradeCount');
  assert.ok('medianMaxDrawdownR' in res, 'Exposes medianMaxDrawdownR');
  assert.ok('percentile95MaxDrawdownR' in res, 'Exposes percentile95MaxDrawdownR');
  assert.ok('percentile99MaxDrawdownR' in res, 'Exposes percentile99MaxDrawdownR');
  assert.ok('medianMaxLosingStreak' in res, 'Exposes medianMaxLosingStreak');
  assert.ok('percentile95LosingStreak' in res, 'Exposes percentile95LosingStreak');
  assert.ok('probabilityOfSevereDrawdownPct' in res, 'Exposes probabilityOfSevereDrawdownPct');
  assert.ok('riskOfRuinPct' in res, 'Exposes riskOfRuinPct');
  assert.ok(typeof res.simulationStatus === 'string', 'Exposes simulationStatus');
  assert.ok(typeof res.disclaimer === 'string', 'Exposes disclaimer string');

  console.log('[PASS] Exposes result.simulationsCount');
  console.log('[PASS] Exposes result.sampleTradeCount');
  console.log('[PASS] Exposes result.medianMaxDrawdownR');
  console.log('[PASS] Exposes result.percentile95MaxDrawdownR');
  console.log('[PASS] Exposes result.percentile99MaxDrawdownR');
  console.log('[PASS] Exposes result.medianMaxLosingStreak');
  console.log('[PASS] Exposes result.percentile95LosingStreak');
  console.log('[PASS] Exposes result.probabilityOfSevereDrawdownPct');
  console.log('[PASS] Exposes result.riskOfRuinPct');
  console.log('[PASS] Exposes result.simulationStatus');
  console.log('[PASS] Exposes result.disclaimer');
}

console.log('\n========================================================================');
console.log('GATE 22 MONTE CARLO TRADE-SEQUENCE SUITE COMPLETE: ALL TESTS PASSED');
console.log('========================================================================\n');
