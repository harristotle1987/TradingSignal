import assert from 'assert';
import {
  MasterGuardrailEngine,
  GuardrailEvaluationInput,
} from '../src/server/signals/MasterGuardrailEngine.js';
import { SignalDirection } from '../src/types/index.js';

export async function runMasterGuardrailTests(): Promise<void> {
  console.log('=== SUITE: MASTER GUARDRAIL ENGINE (ADAPTIVE PROFITABILITY & RISK) ===');

  const now = Date.now();

  const validBaseInput: GuardrailEvaluationInput = {
    symbol: 'BTCUSDT',
    direction: 'BUY',
    entryPrice: 65000,
    stopLoss: 64000,   // Risk: 1000
    takeProfit: 67000, // Reward: 2000 (2.0R)
    tp1: 66000,
    tp2: 67000,
    tp3: 68500,
    score: 82,
    atr: 500,
    marketRegime: 'TRENDING_BULLISH',
    primaryStrategy: 'Multi-Timeframe Trend Confluence',
    timeframeAlignmentRatio: 0.85,
    timeframesAligned: 3,
    agreeingStrategiesCount: 4,
    historicalWinRate: 62,
    walkForwardEfficiency: 0.78,
    estimatedFriction: {
      spreadPipsOrPoints: 5,
      feeBufferPct: 0.0008,
      netRiskRewardRatio: 1.95,
    },
    liveTicker: {
      symbol: 'BTCUSDT',
      rawSymbol: 'BTCUSDT',
      provider: 'BINANCE',
      assetType: 'CRYPTO',
      price: 65000,
      bid: 64995,
      ask: 65005,
      timestamp: now - 1000,
      receivedAt: now - 1000,
      status: 'OK',
      isFresh: true,
      source: 'LIVE',
    },
    currentTimeMs: now,
  };

  // ---------------------------------------------------------------------------
  // TEST 1: High-Quality Setup Validation & Decision Object Structure
  // ---------------------------------------------------------------------------
  console.log('Test 1: Evaluates high-quality candidate and returns complete MasterGuardrailDecision');
  const decision1 = MasterGuardrailEngine.evaluateCandidate(validBaseInput);

  assert.strictEqual(decision1.guardrailDecision, 'ACCEPTED', 'High-quality setup must be accepted');
  assert.strictEqual(decision1.hardGatesPassed, true, 'Hard gates must pass');
  assert.strictEqual(decision1.evFloorPassed, true, 'EV floor must pass');
  assert(decision1.probability >= 0.50, `Probability must be >= 50% (got ${decision1.probability})`);
  assert(decision1.expectedValue > 0, `Expected value must be positive (got ${decision1.expectedValue}R)`);
  assert(decision1.expectedReturn > 0, `Expected return must be positive (got ${decision1.expectedReturn})`);
  assert(decision1.actualRR >= 1.8, `Actual R:R must be >= 1.8 (got ${decision1.actualRR})`);
  assert(decision1.adaptiveMinRR >= MasterGuardrailEngine.CONSERVATIVE_SAFETY_FLOOR_RR, 'Adaptive Min RR must respect safety floor');
  assert.strictEqual(decision1.modelVersion, MasterGuardrailEngine.MODEL_VERSION);
  assert(typeof decision1.confidence === 'number' && decision1.confidence > 0, 'Confidence must be valid number');
  console.log(`  -> Win Probability: ${(decision1.probability * 100).toFixed(1)}%, Expected Value: ${decision1.expectedValue}R, Expected Return: ${(decision1.expectedReturn * 100).toFixed(2)}%, Adaptive Min R:R: ${decision1.adaptiveMinRR}R, Decision: ${decision1.guardrailDecision}`);
  console.log('✓ Test 1 passed: Complete MasterGuardrailDecision generated successfully.');

  // ---------------------------------------------------------------------------
  // TEST 2: Hard Safety Gates Enforcement (Fail-Closed on Geometry/Price)
  // ---------------------------------------------------------------------------
  console.log('Test 2: Hard safety gates strictly reject invalid geometry, inverted levels, or missing prices');
  
  // 2a. Inverted BUY Stop Loss (SL >= Entry)
  const invertedSlInput: GuardrailEvaluationInput = {
    ...validBaseInput,
    stopLoss: 65500, // Inverted!
  };
  const decision2a = MasterGuardrailEngine.evaluateCandidate(invertedSlInput);
  assert.strictEqual(decision2a.guardrailDecision, 'REJECTED', 'Inverted SL must be rejected');
  assert.strictEqual(decision2a.hardGatesPassed, false, 'Hard gates must fail for inverted SL');
  assert(decision2a.rejectionReason?.includes('INVALID_BUY_GEOMETRY') || decision2a.rejectionReason?.includes('Stop Loss'), 'Reason must cite geometry');

  // 2b. Inverted TP1 (TP1 <= Entry for BUY)
  const invertedTpInput: GuardrailEvaluationInput = {
    ...validBaseInput,
    tp1: 64500, // Inverted!
  };
  const decision2b = MasterGuardrailEngine.evaluateCandidate(invertedTpInput);
  assert.strictEqual(decision2b.guardrailDecision, 'REJECTED', 'Inverted TP1 must be rejected');
  assert.strictEqual(decision2b.hardGatesPassed, false, 'Hard gates must fail for inverted TP1');

  // 2c. Stale live market data (> 180s old)
  const staleDataInput: GuardrailEvaluationInput = {
    ...validBaseInput,
    liveTicker: {
      ...validBaseInput.liveTicker!,
      timestamp: now - (250 * 1000), // 250s old
    },
  };
  const decision2c = MasterGuardrailEngine.evaluateCandidate(staleDataInput);
  assert.strictEqual(decision2c.guardrailDecision, 'REJECTED', 'Stale quote data must be rejected');
  assert(decision2c.rejectionReason?.includes('STALE_MARKET_DATA'), 'Reason must cite stale data');
  console.log('✓ Test 2 passed: Hard safety gates fail closed across all geometry violations.');

  // ---------------------------------------------------------------------------
  // TEST 3: Expected Value (EV) Hard Floor Check
  // ---------------------------------------------------------------------------
  console.log('Test 3: Mathematical EV hard floor rejects setups where EV <= 0');
  
  // Low win rate + low reward setup leading to non-positive EV
  const negativeEvInput: GuardrailEvaluationInput = {
    ...validBaseInput,
    score: 45,
    takeProfit: 65800, // Only 0.8R reward
    tp1: 65400,
    tp2: 65800,
    tp3: 66200,
    timeframeAlignmentRatio: 0.33,
    agreeingStrategiesCount: 1,
    estimatedFriction: {
      spreadPipsOrPoints: 10,
      feeBufferPct: 0.003,
      netRiskRewardRatio: 0.65,
    },
  };
  const decision3 = MasterGuardrailEngine.evaluateCandidate(negativeEvInput);
  assert.strictEqual(decision3.guardrailDecision, 'REJECTED', 'Negative EV setup must be rejected');
  assert.strictEqual(decision3.evFloorPassed, false, 'EV floor must fail');
  assert(decision3.expectedValue <= 0, `Expected value must be non-positive (got ${decision3.expectedValue}R)`);
  console.log(`  -> Rejected with EV: ${decision3.expectedValue}R, Reason: ${decision3.rejectionReason}`);
  console.log('✓ Test 3 passed: Non-positive EV setups strictly blocked by hard EV floor.');

  // ---------------------------------------------------------------------------
  // TEST 4: Adaptive R:R Adaptation Curve & Safety Floor
  // ---------------------------------------------------------------------------
  console.log('Test 4: Adaptive R:R adapts to trade quality while strictly respecting the conservative safety floor (1.40R)');
  
  // 4a. Exceptional quality setup (Score 92, WinProb ~68%, MTF 100%, strong EV)
  const exceptionalInput: GuardrailEvaluationInput = {
    ...validBaseInput,
    score: 92,
    takeProfit: 66600, // 1.6R reward
    tp2: 66600,
    tp3: 67500,
    timeframeAlignmentRatio: 1.0,
    timeframesAligned: 4,
    agreeingStrategiesCount: 5,
    walkForwardEfficiency: 0.88,
  };
  const decision4a = MasterGuardrailEngine.evaluateCandidate(exceptionalInput);
  assert.strictEqual(decision4a.guardrailDecision, 'ACCEPTED', 'High quality 1.6R setup with strong EV should pass adaptive threshold');
  assert(decision4a.adaptiveMinRR < 1.80, `Adaptive Min RR (${decision4a.adaptiveMinRR}R) should relax below 1.80 for exceptional setup`);
  assert(decision4a.adaptiveMinRR >= MasterGuardrailEngine.CONSERVATIVE_SAFETY_FLOOR_RR, `Adaptive Min RR must not breach safety floor of ${MasterGuardrailEngine.CONSERVATIVE_SAFETY_FLOOR_RR}R`);

  // 4b. Mediocre quality setup (Score 62, moderate EV) requires higher R:R
  const mediocreInput: GuardrailEvaluationInput = {
    ...validBaseInput,
    score: 62,
    takeProfit: 66800, // 1.8R reward
    tp2: 66800,
    timeframeAlignmentRatio: 0.50,
    agreeingStrategiesCount: 2,
    historicalWinRate: 48,
  };
  const decision4b = MasterGuardrailEngine.evaluateCandidate(mediocreInput);
  assert(decision4b.adaptiveMinRR >= 1.80, `Mediocre quality setup must require stronger R:R >= 1.80 (got ${decision4b.adaptiveMinRR}R)`);
  console.log(`  -> Exceptional setup required R:R: ${decision4a.adaptiveMinRR}R (Passed: ${decision4a.guardrailDecision})`);
  console.log(`  -> Mediocre setup required R:R: ${decision4b.adaptiveMinRR}R (Passed: ${decision4b.guardrailDecision})`);
  console.log('✓ Test 4 passed: Adaptive R:R adjusts dynamically while preserving safety floor.');

  // ---------------------------------------------------------------------------
  // TEST 5: Regime-Aware Guardrails
  // ---------------------------------------------------------------------------
  console.log('Test 5: Regime-aware tuning enforces higher profit cushion in HIGH_VOLATILITY');
  const volatileInput: GuardrailEvaluationInput = {
    ...validBaseInput,
    marketRegime: 'HIGH_VOLATILITY_EXPANSION',
  };
  const decision5 = MasterGuardrailEngine.evaluateCandidate(volatileInput);
  assert(decision5.adaptiveMinRR >= 2.0, `High volatility regime must require minimum 2.0R (got ${decision5.adaptiveMinRR}R)`);
  assert.strictEqual(decision5.details?.regimeContext, 'HIGH_VOLATILITY');
  console.log(`  -> High Volatility adaptive Min R:R: ${decision5.adaptiveMinRR}R`);
  console.log('✓ Test 5 passed: Regime-aware guardrails enforced accurately.');

  console.log(' \x1b[32m[MASTER GUARDRAIL SUCCESS] All MasterGuardrailEngine tests passed!\x1b[0m');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMasterGuardrailTests()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('MasterGuardrail test suite failed:', err);
      process.exit(1);
    });
}
