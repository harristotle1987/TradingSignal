import assert from 'assert';
import {
  AdvancedEnsembleDecisionEngine,
  EvidenceLedgerEntry,
  EnsembleExecutionMode,
} from '../src/server/signals/AdvancedEnsembleDecisionEngine.js';
import { TradingSignal, NormalizedCandle, NormalizedTicker } from '../src/types/index.js';

export async function runEnsembleTests() {
  console.log('\n--- Running AdvancedEnsembleDecisionEngine Tests ---');

  AdvancedEnsembleDecisionEngine.clearLedger();
  AdvancedEnsembleDecisionEngine.setMode('SHADOW');

  const now = Date.now();
  const mockCandles: NormalizedCandle[] = Array.from({ length: 30 }, (_, i) => ({
    timestamp: now - (30 - i) * 3600000,
    open: 60000 + i * 100,
    high: 60100 + i * 100,
    low: 59900 + i * 100,
    close: 60050 + i * 100,
    volume: 1500,
    symbol: 'BTCUSDT',
    provider: 'TEST',
    timeframe: '1h',
  }));

  const mockTicker: NormalizedTicker = {
    symbol: 'BTCUSDT',
    rawSymbol: 'BTCUSDT',
    provider: 'TEST',
    assetType: 'CRYPTO',
    price: 63000,
    bid: 62995,
    ask: 63005,
    timestamp: now - 1000, // Fresh quote (1s old)
    receivedAt: now,
    source: 'LIVE',
    isFresh: true,
    status: 'OK',
  };

  const validBaseSignal: TradingSignal = {
    id: 'sig_ensemble_valid',
    symbol: 'BTCUSDT',
    direction: 'BUY',
    entryPrice: 63000,
    stopLoss: 61500,
    takeProfit: 66500,
    riskRewardRatio: 2.33,
    confidenceScore: 82,
    score: 82,
    marketRegime: 'BULLISH_TREND',
    strategy: 'Multi-Timeframe Trend Confluence',
    timestamp: now,
  } as any;

  // Test 1: Evidence Ledger & 14-Pillar Regime-Aware Fusion
  console.log('Test 1: Full 14-pillar evaluation and Evidence Ledger generation');
  const ledger1 = AdvancedEnsembleDecisionEngine.evaluateCandidate({
    signal: validBaseSignal,
    candlesMap: { '1h': mockCandles },
    liveTicker: mockTicker,
    productionPassed: true,
  });

  assert(ledger1.id.startsWith('ledg_'), 'Ledger entry must have unique ID');
  assert.strictEqual(ledger1.symbol, 'BTCUSDT');
  assert.strictEqual(ledger1.direction, 'BUY');
  assert.strictEqual(ledger1.hardGatesPassed, true, 'Hard gates should pass for valid setup');
  assert.strictEqual(ledger1.regimeType, 'TRENDING', 'Should classify BULLISH_TREND as TRENDING');
  assert(ledger1.pillars.marketRegime !== undefined, 'Market regime pillar evaluated');
  assert(ledger1.pillars.structuralQuality !== undefined, 'Structural quality pillar evaluated');
  assert(ledger1.pillars.mtfAlignment !== undefined, 'MTF alignment pillar evaluated');
  assert(ledger1.pillars.qlibAlpha !== undefined, 'Qlib alpha pillar evaluated');
  assert(ledger1.pillars.kronosForecast !== undefined, 'Kronos forecast pillar evaluated');
  assert(ledger1.pillars.aiResearch !== undefined, 'AI research pillar evaluated');
  assert(ledger1.pillars.momentumTrend !== undefined, 'Momentum trend pillar evaluated');
  assert(ledger1.pillars.volatilityLiquidity !== undefined, 'Volatility liquidity pillar evaluated');
  assert(ledger1.pillars.portfolioExposure !== undefined, 'Portfolio exposure pillar evaluated');
  assert(ledger1.pillars.executionQuality !== undefined, 'Execution quality pillar evaluated');
  assert(ledger1.pillars.calibratedProbability !== undefined, 'Calibrated probability evaluated');
  assert(ledger1.pillars.expectedValue !== undefined, 'Expected value pillar evaluated');
  assert(ledger1.pillars.tpSlQuality !== undefined, 'TP/SL quality pillar evaluated');
  assert(ledger1.pillars.riskRewardRatio !== undefined, 'R:R pillar evaluated');

  assert(ledger1.nonLinearAdjustments.finalFusedScore >= 65, 'Final fused score should exceed qualification threshold');
  assert.strictEqual(ledger1.ensembleDecision, 'SHADOW_ONLY', 'Default mode should be SHADOW_ONLY');
  assert(ledger1.synthesisReasoning.length > 0, 'Synthesis narrative must explain rationale');
  console.log(`  -> Fused score: ${ledger1.nonLinearAdjustments.finalFusedScore}/100, Regime: ${ledger1.regimeType}`);
  console.log('  -> All 14 pillars evaluated and logged in Evidence Ledger.');

  // Test 2: Non-Linear Fusion (Concurrence Boost vs Divergence Penalty)
  console.log('Test 2: Non-linear Bayesian synergy (concurrence boost vs divergence penalty)');
  // Sub-case A: With concurring Kronos and Qlib
  const concurringSignal: TradingSignal = {
    ...validBaseSignal,
    kronosEvidence: {
      directionBias: 'BULLISH',
      forecastReturn: 0.025,
      confidence: 0.95,
      horizon: '1h',
    },
    qlibEvidence: {
      direction: 'BULLISH',
      expectedReturn: 0.03,
      informationCoefficient: 0.08,
      probability: 0.85,
    },
    tradingAgentsResearch: {
      finalSynthesis: {
        consensusRating: 'FAVORABLE',
        agreementScore: 0.80,
      },
    },
  } as any;

  const boostLedger = AdvancedEnsembleDecisionEngine.evaluateCandidate({
    signal: concurringSignal,
    candlesMap: { '1h': mockCandles },
    liveTicker: mockTicker,
  });

  assert(boostLedger.nonLinearAdjustments.concurrenceBonus >= 1.06, 'Should receive concurrence bonus for multi-model agreement');
  console.log(`  -> Concurrence bonus: x${boostLedger.nonLinearAdjustments.concurrenceBonus}`);

  // Sub-case B: Divergence penalty when Kronos strongly opposes candidate direction
  const dissentingSignal: TradingSignal = {
    ...validBaseSignal,
    kronosEvidence: {
      directionBias: 'BEARISH', // Opposes candidate BUY
      forecastReturn: -0.035,
      confidence: 0.90,
      horizon: '1h',
    },
    qlibEvidence: {
      direction: 'BEARISH', // Opposes candidate BUY
      expectedReturn: -0.04,
      informationCoefficient: 0.08,
      probability: 0.88,
    },
  } as any;

  const penaltyLedger = AdvancedEnsembleDecisionEngine.evaluateCandidate({
    signal: dissentingSignal,
    candlesMap: { '1h': mockCandles },
    liveTicker: mockTicker,
  });

  assert(penaltyLedger.nonLinearAdjustments.divergencePenalty < 1.0, 'Should apply divergence penalty when models dissent');
  assert(penaltyLedger.nonLinearAdjustments.finalFusedScore < boostLedger.nonLinearAdjustments.finalFusedScore, 'Dissenting models must lower fused score');
  console.log(`  -> Divergence penalty: x${penaltyLedger.nonLinearAdjustments.divergencePenalty} (Fused: ${penaltyLedger.nonLinearAdjustments.finalFusedScore} vs Boosted: ${boostLedger.nonLinearAdjustments.finalFusedScore})`);

  // Test 3: Hard Safety Gates are Inviolable
  console.log('Test 3: Hard safety gates are authoritative and cannot be overridden by AI/ML models');

  // Case A: Invalid zero/negative price with 100% AI confidence
  const invalidPriceSignal: TradingSignal = {
    ...concurringSignal,
    entryPrice: -100, // INVALID PRICE
  };
  const ledgerInvalidPrice = AdvancedEnsembleDecisionEngine.evaluateCandidate({
    signal: invalidPriceSignal,
    liveTicker: mockTicker,
  });
  assert.strictEqual(ledgerInvalidPrice.hardGatesPassed, false, 'Invalid price must fail hard gates');
  assert.strictEqual(ledgerInvalidPrice.ensembleDecision, 'REJECTED', 'Must reject candidate with invalid price');
  assert(ledgerInvalidPrice.hardGateViolations.some(v => v.includes('Invalid entry price')), 'Violation logged');

  // Case B: Inverted TP/SL trade geometry (BUY with TP below entry)
  const invertedGeometrySignal: TradingSignal = {
    ...concurringSignal,
    entryPrice: 63000,
    takeProfit: 60000, // INVALID: TP < Entry on BUY
    stopLoss: 64000,   // INVALID: SL > Entry on BUY
  };
  const ledgerInverted = AdvancedEnsembleDecisionEngine.evaluateCandidate({
    signal: invertedGeometrySignal,
    liveTicker: mockTicker,
  });
  assert.strictEqual(ledgerInverted.hardGatesPassed, false, 'Inverted geometry must fail hard gates');
  assert.strictEqual(ledgerInverted.ensembleDecision, 'REJECTED', 'Must reject inverted trade geometry');

  // Case C: Minimum R:R floor breach (R:R 0.5 < 1.5)
  const lowRrSignal: TradingSignal = {
    ...concurringSignal,
    riskRewardRatio: 0.5, // BELOW MINIMUM R:R
  };
  const ledgerLowRr = AdvancedEnsembleDecisionEngine.evaluateCandidate({
    signal: lowRrSignal,
    liveTicker: mockTicker,
  });
  assert.strictEqual(ledgerLowRr.hardGatesPassed, false, 'R:R < 1.5 must fail hard gates');
  assert.strictEqual(ledgerLowRr.ensembleDecision, 'REJECTED', 'Must reject below-floor R:R');

  // Case D: Stale Market Data (> 120s old)
  const staleTicker: NormalizedTicker = {
    ...mockTicker,
    timestamp: now - 300_000, // 5 minutes old
  };
  const ledgerStale = AdvancedEnsembleDecisionEngine.evaluateCandidate({
    signal: concurringSignal,
    liveTicker: staleTicker,
  });
  assert.strictEqual(ledgerStale.hardGatesPassed, false, 'Stale quote must fail hard gates');
  assert.strictEqual(ledgerStale.ensembleDecision, 'REJECTED', 'Must reject on stale market data');

  console.log('  -> Mandatory hard safety gates strictly authoritative across all failure scenarios.');

  // Test 4: Progressive Rollout Modes & Parity Telemetry
  console.log('Test 4: Progressive rollout (SHADOW vs ACTIVE mode) and parity tracking');
  AdvancedEnsembleDecisionEngine.setMode('ACTIVE');
  assert.strictEqual(AdvancedEnsembleDecisionEngine.getMode(), 'ACTIVE');

  const activeLedger = AdvancedEnsembleDecisionEngine.evaluateCandidate({
    signal: concurringSignal,
    candlesMap: { '1h': mockCandles },
    liveTicker: mockTicker,
    productionPassed: true,
  });
  assert.strictEqual(activeLedger.ensembleDecision, 'ACCEPTED', 'In ACTIVE mode, qualified signal is ACCEPTED');
  assert.strictEqual(activeLedger.isParityMatch, true, 'Parity match with production DISPATCHED');

  // Switch back to SHADOW
  AdvancedEnsembleDecisionEngine.setMode('SHADOW');
  assert.strictEqual(AdvancedEnsembleDecisionEngine.getMode(), 'SHADOW');

  const telemetry = AdvancedEnsembleDecisionEngine.getParityTelemetry();
  assert(telemetry.totalEvaluated > 0, 'Telemetry should record evaluated candidates');
  assert(telemetry.parityAgreementRate >= 0, 'Parity agreement rate computed');
  assert(telemetry.recentLedgerEntries.length > 0, 'Recent ledger entries accessible');
  console.log(`  -> Evaluated: ${telemetry.totalEvaluated}, Parity Agreement: ${telemetry.parityAgreementRate}%, Shadow Accepted: ${telemetry.shadowDecisions.accepted}`);

  // Test 5: Evidence Ledger Querying
  console.log('Test 5: Query and inspect Evidence Ledger');
  const btcLedger = AdvancedEnsembleDecisionEngine.getEvidenceLedger(5, 'BTCUSDT');
  assert(btcLedger.length > 0, 'Should return ledger entries for BTCUSDT');
  assert.strictEqual(btcLedger[0].symbol, 'BTCUSDT');
  console.log('  -> Evidence Ledger queryable by symbol and limit.');

  console.log('\n\x1b[32m[ENSEMBLE SUCCESS] All AdvancedEnsembleDecisionEngine tests passed successfully!\x1b[0m\n');
}

// Run standalone if executed directly
if (process.argv[1]?.endsWith('advanced-ensemble-decision-engine.test.ts')) {
  runEnsembleTests().catch((err) => {
    console.error('AdvancedEnsembleDecisionEngine test error:', err);
    process.exit(1);
  });
}
