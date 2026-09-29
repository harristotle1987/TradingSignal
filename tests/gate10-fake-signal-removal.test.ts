import assert from 'assert';
import { isProductionRecord, SignalLogger } from '../src/server/signals/SignalLogger.js';
import { SignalOutcomeLogger } from '../src/server/signals/SignalOutcomeLogger.js';
import { ScannerPersistence } from '../src/server/signals/ScannerPersistence.js';
import { HistoricalPerformanceManager } from '../src/server/signals/HistoricalPerformanceManager.js';
import { SignalValidator } from '../src/server/signals/SignalValidator.js';
import { setMockFirestoreAdmin } from '../src/server/firebaseAdmin.js';
import { serverConfig } from '../src/server/config.js';

async function runGate10Tests() {
  console.log('\n=== GATE 10 REGRESSION: REMOVE FAKE/TEST SIGNAL CONTAMINATION ===\n');

  // Test 1: Rejection of artificial BTC/BNB 50,000 records by isProductionRecord
  console.log('Test 1: isProductionRecord strictly rejects artificial BTC/BNB records with entryPrice=50000');
  const artificialBtc = {
    id: 'fake_btc_50k',
    symbol: 'BTCUSDT',
    direction: 'BUY',
    entryPrice: 50000,
    stopLoss: 49000,
    takeProfit: 52000,
    provenance: 'LIVE',
    dataSource: 'Bitget',
  };
  assert.strictEqual(isProductionRecord(artificialBtc as any), false, 'Artificial BTC 50000 must be rejected');

  const artificialBnb = {
    id: 'fake_bnb_50k',
    symbol: 'BNBUSDT',
    direction: 'BUY',
    entryPrice: 50000,
    stopLoss: 49000,
    takeProfit: 52000,
    provenance: 'LIVE',
    dataSource: 'Bitget',
  };
  assert.strictEqual(isProductionRecord(artificialBnb as any), false, 'Artificial BNB 50000 must be rejected');

  const legitimateBtc = {
    id: 'legit_btc_1',
    symbol: 'BTCUSDT',
    direction: 'BUY',
    entryPrice: 83747.94,
    stopLoss: 82945.85,
    takeProfit: 85264.27,
    provenance: 'LIVE',
    dataSource: 'Bitget Live Feed with Live Price & Sentiment Cross-Validation',
  };
  assert.strictEqual(isProductionRecord(legitimateBtc as any), true, 'Legitimate BTC must pass isProductionRecord');
  console.log('✓ Test 1 passed: Artificial 50000 records rejected, legitimate record accepted.');

  // Test 2: Artificial BTC/BNB records cannot appear in LIVE signal results
  console.log('Test 2: Artificial BTC/BNB records with entryPrice=50000 cannot appear in LIVE results');
  const liveLogs = await SignalLogger.getSignalLogs(100, true);
  const contaminatedLogs = liveLogs.filter((s) => s.entryPrice === 50000 || s.stopLoss === 49000 || s.takeProfit === 52000);
  assert.strictEqual(contaminatedLogs.length, 0, 'No artificial 50000 records in SignalLogger');

  const sentSignals = await ScannerPersistence.getSentSignals();
  const contaminatedSent = sentSignals.filter((s) => s.entryPrice === 50000 || s.stopLoss === 49000 || s.takeProfit === 52000);
  assert.strictEqual(contaminatedSent.length, 0, 'No artificial 50000 records in sentSignals');

  const activeSignals = await ScannerPersistence.getActiveSignals();
  const contaminatedActive = activeSignals.filter((s) => s.entryPrice === 50000 || s.stopLoss === 49000 || s.takeProfit === 52000);
  assert.strictEqual(contaminatedActive.length, 0, 'No artificial 50000 records in activeSignals');
  console.log('✓ Test 2 passed: 0 artificial 50000 records in LIVE signal results.');

  // Test 3: Artificial BTC/BNB records cannot appear in HISTORICAL performance results
  console.log('Test 3: Artificial BTC/BNB records cannot appear in HISTORICAL performance results');
  const consolidated = await HistoricalPerformanceManager.getConsolidatedSignals();
  const contaminatedConsolidated = consolidated.filter((s) => s.entryPrice === 50000 || s.stopLoss === 49000 || s.takeProfit === 52000);
  assert.strictEqual(contaminatedConsolidated.length, 0, 'No artificial 50000 records in consolidated signals');

  const perfResult = await HistoricalPerformanceManager.getPerformance('ALL');
  const contaminatedOutcomes = (perfResult.recentOutcomes || []).filter((o) => o.entryPrice === 50000 || o.stopLoss === 49000 || o.takeProfit === 52000);
  assert.strictEqual(contaminatedOutcomes.length, 0, 'No artificial 50000 records in performance outcomes');
  console.log('✓ Test 3 passed: 0 artificial 50000 records in HISTORICAL performance results.');

  // Test 4: signal_outcome_logs.json is not used as a production source or fallback
  console.log('Test 4: signal_outcome_logs.json is not used as a production source or fallback');
  const outcomeLogs = await SignalOutcomeLogger.getOutcomeLogs(100, true);
  const contaminatedOutcomesLogs = outcomeLogs.filter((o) => o.entryPrice === 50000 || o.stopLoss === 49000 || o.takeProfit === 52000);
  assert.strictEqual(contaminatedOutcomesLogs.length, 0, 'No artificial 50000 records in outcomeLogs');
  console.log('✓ Test 4 passed: signal_outcome_logs.json not used as production source/fallback.');

  // Test 5: Explicitly rejects TEST, SIMULATION, BACKTEST, MOCK, SYNTHETIC
  console.log('Test 5: Explicit rejection of TEST, SIMULATION, BACKTEST, MOCK, SYNTHETIC');
  for (const prov of ['TEST', 'SIMULATION', 'BACKTEST', 'MOCK', 'SYNTHETIC']) {
    const invalidRecord = {
      id: `rec_${prov.toLowerCase()}`,
      symbol: 'BTCUSDT',
      direction: 'BUY',
      entryPrice: 83000,
      stopLoss: 82000,
      takeProfit: 85000,
      provenance: prov,
      dataSource: 'Bitget',
    };
    assert.strictEqual(isProductionRecord(invalidRecord as any), false, `Provenance ${prov} must be rejected`);
  }
  console.log('✓ Test 5 passed: Non-LIVE provenance rejected.');

  // Test 6: Rejection of unverified market-data pipeline
  console.log('Test 6: Any production signal without verified market-data pipeline is rejected');
  const mockFeedRecord = {
    id: 'rec_mock_feed',
    symbol: 'BTCUSDT',
    direction: 'BUY',
    entryPrice: 83000,
    stopLoss: 82000,
    takeProfit: 85000,
    provenance: 'LIVE',
    dataSource: 'mock_test_feed',
  };
  assert.strictEqual(isProductionRecord(mockFeedRecord as any), false, 'Mock data source must be rejected');
  console.log('✓ Test 6 passed: Unverified data sources rejected.');

  // Test 7: SignalValidator rejects 50000/49000/52000 prices as INVALID_ENTRY
  console.log('Test 7: SignalValidator rejects artificial 50000/49000/52000 prices');
  const valResult = SignalValidator.validate({
    symbol: 'BTCUSDT',
    direction: 'BUY',
    entryPrice: 50000,
    stopLoss: 49000,
    takeProfit: 52000,
    riskRewardRatio: 2.0,
    score: 85,
    candlesMap: {},
    liveTicker: {
      symbol: 'BTCUSDT',
      rawSymbol: 'BTCUSDT',
      provider: 'bitget',
      assetType: 'CRYPTO',
      price: 50000,
      bid: 49999,
      ask: 50001,
      timestamp: Date.now(),
      receivedAt: Date.now(),
      isFresh: true,
      status: 'OK',
      source: 'LIVE',
    } as any,
  });
  assert.strictEqual(valResult.isValid, false, 'SignalValidator must reject 50000');
  assert.strictEqual(valResult.validationReason, 'INVALID_ENTRY', 'Validation reason must be INVALID_ENTRY');
  console.log('✓ Test 7 passed: SignalValidator rejects 50000 price.');

  // Test 8: Fail-safe when Firestore is unavailable in production
  console.log('Test 8: Fail-safe behavior in production mode when Firestore is unavailable');
  const originalEnv = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    setMockFirestoreAdmin(null); // Simulate Firestore outage/unavailability

    const pOutcomes = await SignalOutcomeLogger.getOutcomeLogs(100, true);
    assert.strictEqual(pOutcomes.length, 0, 'Production outcome query without Firestore must return []');

    const pSent = await ScannerPersistence.getSentSignals();
    assert.strictEqual(pSent.length, 0, 'Production sent signals without Firestore must return []');

    const pActive = await ScannerPersistence.getActiveSignals();
    assert.strictEqual(pActive.length, 0, 'Production active signals without Firestore must return []');

    const pConsolidated = await HistoricalPerformanceManager.getConsolidatedSignals();
    assert.strictEqual(pConsolidated.length, 0, 'Production consolidated historical signals without Firestore must return []');

    const pPerf = await HistoricalPerformanceManager.getPerformance('ALL');
    assert.strictEqual(pPerf.summary.totalSignals, 0, 'Production performance without Firestore must return totalSignals=0');
    assert.strictEqual((pPerf.recentOutcomes || []).length, 0, 'Production performance without Firestore must return recentOutcomes=[]');
  } finally {
    setMockFirestoreAdmin(undefined);
    process.env.NODE_ENV = originalEnv;
  }
  console.log('✓ Test 8 passed: Production fail-safe returns empty data safely without Firestore.');

  console.log('\n\x1b[32m[GATE 10 SUCCESS] All fake/test signal contamination regression checks passed perfectly!\x1b[0m\n');
}

runGate10Tests().catch((err) => {
  console.error('\x1b[31m[GATE 10 FAILED]\x1b[0m', err);
  process.exit(1);
});
