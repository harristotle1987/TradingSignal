import assert from 'assert';
import { ScannerPersistence, isValidActiveSignal, PersistedSentSignal } from '../src/server/signals/ScannerPersistence.js';
import { signalEngine } from '../src/server/signals/SignalEngine.js';
import { setMockFirestoreAdmin } from '../src/server/firebaseAdmin.js';
import { serverConfig } from '../src/server/config.js';
import { TradingSignal } from '../src/types/index.js';

async function runGate11Tests() {
  console.log('\n=== GATE 11 REGRESSION: FIX WHY VALID SIGNALS STOP DISPLAYING ===\n');

  // Test 1: Complete Lifecycle Trace
  console.log('Test 1: Complete lifecycle verification (Generated → Validated → Persisted → Active → Displayed → Outcome → Historical)');
  assert(typeof signalEngine.generateSignal === 'function', 'Signal generation exists');
  assert(typeof ScannerPersistence.recordSentSignal === 'function', 'Persistence exists');
  assert(typeof ScannerPersistence.getActiveSignals === 'function', 'Active retrieval exists');
  assert(typeof signalEngine.getActiveSignalsDetailed === 'function', 'Display retrieval with diagnostics exists');
  console.log('✓ Test 1 passed: Lifecycle components verified.');

  // Test 2: isValidActiveSignal strictly rejects terminal and non-LIVE records
  console.log('Test 2: isValidActiveSignal strictly rejects terminal, synthetic, test, and invalid records');
  const baseValidSignal: PersistedSentSignal = {
    id: 'sig_valid_1',
    snapshotId: 'snap_valid_1',
    symbol: 'BTCUSDT',
    direction: 'BUY',
    entryPrice: 85000,
    stopLoss: 84000,
    takeProfit: 87000,
    tp1: 85500,
    tp2: 86000,
    tp3: 87000,
    riskRewardRatio: 2.0,
    score: 85,
    rankTier: 'BEST_TRADE',
    strategy: 'Trend Breakout',
    timeframe: 'H1',
    dataSource: 'Bitget Live Feed',
    status: 'ACTIVE',
    timestamp: Date.now(),
    expiresAt: Date.now() + 3600000,
    notificationSent: true,
    notificationTimestamp: Date.now(),
    date: '2026-09-29',
    isTradeableSignal: true,
    signalClassification: 'TRADEABLE',
    provenance: 'LIVE',
  };

  assert.strictEqual(isValidActiveSignal(baseValidSignal, true).isValid, true, 'Base valid LIVE signal must be valid');

  // Test terminal statuses: EXPIRED, SL_HIT, TP_HIT, TP3_HIT, CANCELLED, COMPLETED, SUPERSEDED
  const terminalStatuses = ['EXPIRED', 'SL_HIT', 'TP_HIT', 'TP3_HIT', 'CANCELLED', 'COMPLETED', 'SUPERSEDED', 'STOPPED_OUT', 'INVALID'];
  for (const term of terminalStatuses) {
    const invalidTerm = { ...baseValidSignal, status: term };
    const res = isValidActiveSignal(invalidTerm, true);
    assert.strictEqual(res.isValid, false, `Terminal status ${term} must be rejected from active display`);
  }

  // Test non-LIVE and test provenances: TEST, SIMULATION, BACKTEST, MOCK, SYNTHETIC
  const testProvenances = ['TEST', 'SIMULATION', 'BACKTEST', 'MOCK', 'SYNTHETIC'];
  for (const prov of testProvenances) {
    const invalidProv = { ...baseValidSignal, provenance: prov };
    const res = isValidActiveSignal(invalidProv, true);
    assert.strictEqual(res.isValid, false, `Provenance ${prov} must be rejected`);
  }

  const synthSignal = { ...baseValidSignal, isSynthetic: true };
  assert.strictEqual(isValidActiveSignal(synthSignal, true).isValid, false, 'Synthetic record must be rejected');

  // Test non-tradeable classification
  const nonTradeable1 = { ...baseValidSignal, isTradeableSignal: false };
  assert.strictEqual(isValidActiveSignal(nonTradeable1, true).isValid, false, 'isTradeableSignal=false must be rejected');
  const nonTradeable2 = { ...baseValidSignal, signalClassification: 'WATCHING' };
  assert.strictEqual(isValidActiveSignal(nonTradeable2, true).isValid, false, 'signalClassification=WATCHING must be rejected');

  // Test invalid prices: 50000, 49000, 52000, <= 0, NaN
  assert.strictEqual(isValidActiveSignal({ ...baseValidSignal, entryPrice: 50000 }, true).isValid, false, '50000 entry price rejected');
  assert.strictEqual(isValidActiveSignal({ ...baseValidSignal, stopLoss: 49000 }, true).isValid, false, '49000 stop loss rejected');
  assert.strictEqual(isValidActiveSignal({ ...baseValidSignal, takeProfit: 52000, tp3: 52000 }, true).isValid, false, '52000 take profit rejected');
  assert.strictEqual(isValidActiveSignal({ ...baseValidSignal, entryPrice: -10 }, true).isValid, false, 'Negative entry price rejected');

  // Test geometry: BUY entry <= SL, or BUY entry >= TP1
  assert.strictEqual(isValidActiveSignal({ ...baseValidSignal, entryPrice: 83000, stopLoss: 84000 }, true).isValid, false, 'BUY entry <= SL rejected');
  assert.strictEqual(isValidActiveSignal({ ...baseValidSignal, entryPrice: 86000, tp1: 85500 }, true).isValid, false, 'BUY entry >= TP1 rejected');

  // Test SELL geometry: entry >= SL, or entry <= TP1
  const sellValid: PersistedSentSignal = {
    ...baseValidSignal,
    direction: 'SELL',
    entryPrice: 85000,
    stopLoss: 86000,
    takeProfit: 83000,
    tp1: 84500,
    tp2: 84000,
    tp3: 83000,
  };
  assert.strictEqual(isValidActiveSignal(sellValid, true).isValid, true, 'Valid SELL signal must be valid');
  assert.strictEqual(isValidActiveSignal({ ...sellValid, entryPrice: 87000, stopLoss: 86000 }, true).isValid, false, 'SELL entry >= SL rejected');
  assert.strictEqual(isValidActiveSignal({ ...sellValid, entryPrice: 84000, tp1: 84500 }, true).isValid, false, 'SELL entry <= TP1 rejected');

  // Test R:R < 1.0 rejected
  assert.strictEqual(isValidActiveSignal({ ...baseValidSignal, riskRewardRatio: 0.8 }, true).isValid, false, 'R:R < 1.0 rejected');

  // Test expired by time
  const expiredByTime = { ...baseValidSignal, expiresAt: Date.now() - 1000 };
  assert.strictEqual(isValidActiveSignal(expiredByTime, true).isValid, false, 'Signal with expiresAt in past rejected');
  console.log('✓ Test 2 passed: All filtering and validation criteria enforced.');

  // Test 3: Clear diagnostics returned when zero active signals exist
  console.log('Test 3: Clear diagnostics returned when zero active signals exist');
  const emptyMockFirestore = {
    collection: () => ({
      where: () => ({
        get: async () => ({ empty: true, docs: [], forEach: () => {} }),
      }),
      doc: () => ({
        get: async () => ({ exists: false, data: () => null }),
        set: async () => {},
      }),
    }),
  } as any;
  setMockFirestoreAdmin(emptyMockFirestore);

  // In-memory local sent signals cleared
  ScannerPersistence.localData.sentSignals = [];
  signalEngine.clearSignals();

  const emptyResult = await signalEngine.getActiveSignalsDetailed();
  assert.strictEqual(emptyResult.activeCount, 0, 'Active count must be 0');
  assert.strictEqual(emptyResult.signals.length, 0, 'Signals array must be empty');
  assert.strictEqual(emptyResult.persistedActiveCount, 0, 'Persisted active count must be 0');
  assert.strictEqual(emptyResult.filteredCount, 0, 'Filtered count must be 0');
  assert(emptyResult.rejectionReason !== undefined && emptyResult.rejectionReason.length > 0, 'Rejection reason must be defined');
  assert.strictEqual(emptyResult.diagnostics.activeCount, 0, 'Diagnostics activeCount must be 0');
  console.log('✓ Test 3 passed: Diagnostics returned when count is zero, no signals manufactured.');

  // Test 4: Diagnostics when persisted signals are filtered out
  console.log('Test 4: Diagnostics when persisted candidates exist but are terminal/expired');
  const expiredSig: PersistedSentSignal = {
    ...baseValidSignal,
    id: 'sig_expired_1',
    symbol: 'ETHUSDT',
    status: 'EXPIRED',
  };
  const fakePriceSig: PersistedSentSignal = {
    ...baseValidSignal,
    id: 'sig_fake_price',
    symbol: 'SOLUSDT',
    entryPrice: 50000,
    status: 'ACTIVE',
  };
  const testCandidateDocs = new Map<string, any>();
  testCandidateDocs.set('sig_expired_1', expiredSig);
  testCandidateDocs.set('sig_fake_price', fakePriceSig);

  const filteredMockFirestore = {
    collection: () => ({
      where: (field: string, op: string, val: any) => ({
        get: async () => {
          const matching: any[] = [];
          for (const doc of testCandidateDocs.values()) {
            if (field === 'status' && doc.status === val) {
              matching.push({ id: doc.id, data: () => doc });
            }
          }
          return { empty: matching.length === 0, docs: matching, forEach: (cb: any) => matching.forEach(cb) };
        },
      }),
      doc: (docId: string) => ({
        get: async () => ({ exists: testCandidateDocs.has(docId), data: () => testCandidateDocs.get(docId) }),
        set: async (data: any, options?: any) => {
          const ex = testCandidateDocs.get(docId) || {};
          testCandidateDocs.set(docId, options?.merge ? { ...ex, ...data } : data);
        },
      }),
    }),
  } as any;
  setMockFirestoreAdmin(filteredMockFirestore);

  ScannerPersistence.localData.sentSignals = [expiredSig, fakePriceSig];
  signalEngine.clearSignals();

  const filteredResult = await ScannerPersistence.getActiveSignalsDetailed();
  assert.strictEqual(filteredResult.activeCount, 0, 'Filtered active count must be 0');
  assert.strictEqual(filteredResult.signals.length, 0, 'No active signals returned');
  assert(filteredResult.filteredCount >= 1, 'Filtered count recorded');
  assert(filteredResult.rejectionReason !== undefined, 'Rejection reason explained');
  console.log('✓ Test 4 passed: Filtered signals properly reported in diagnostics.');

  // Test 5: Immediate availability when new signal is persisted (no 5s race)
  console.log('Test 5: Newly persisted signal is immediately available without 5-second race');
  const dynamicMockDocs = new Map<string, any>();
  const dynamicMockFirestore = {
    collection: () => ({
      get: async () => {
        const all = Array.from(dynamicMockDocs.values()).map((d) => ({ id: d.id, data: () => d }));
        return { empty: all.length === 0, docs: all, forEach: (cb: any) => all.forEach(cb) };
      },
      where: (field: string, op: string, val: any) => ({
        get: async () => {
          const matching: any[] = [];
          for (const doc of dynamicMockDocs.values()) {
            if (op === '==' && doc[field] === val) {
              matching.push({ id: doc.id, data: () => doc });
            } else if (op === 'in' && Array.isArray(val) && val.includes(doc[field])) {
              matching.push({ id: doc.id, data: () => doc });
            }
          }
          return { empty: matching.length === 0, docs: matching, forEach: (cb: any) => matching.forEach(cb) };
        },
      }),
      doc: (docId: string) => ({
        get: async () => ({ exists: dynamicMockDocs.has(docId), data: () => dynamicMockDocs.get(docId) }),
        set: async (data: any, options?: any) => {
          const ex = dynamicMockDocs.get(docId) || {};
          dynamicMockDocs.set(docId, options?.merge ? { ...ex, ...data } : data);
        },
      }),
    }),
  } as any;
  setMockFirestoreAdmin(dynamicMockFirestore);
  ScannerPersistence.localData.sentSignals = [];
  signalEngine.clearSignals();

  const newSignalToPersist: TradingSignal = {
    id: 'sig_live_immed_1',
    snapshotId: 'snap_immed_1',
    symbol: 'BTCUSDT',
    direction: 'BUY',
    entryPrice: 85200.5,
    stopLoss: 84300.0,
    takeProfit: 87500.0,
    tp1: 85800.0,
    tp2: 86500.0,
    tp3: 87500.0,
    riskRewardRatio: 2.55,
    score: 88,
    confidenceScore: 88,
    rankTier: 'BEST_TRADE',
    strategy: 'Intraday Breakout',
    timeframe: 'H1',
    dataSource: 'Bitget Live Feed',
    status: 'ACTIVE',
    timestamp: Date.now(),
    expiresAt: Date.now() + 14400000,
    confluenceReasons: [],
    validatedAt: Date.now(),
    isTradeableSignal: true,
    signalClassification: 'TRADEABLE',
    provenance: 'LIVE',
  };

  const persistRes = await ScannerPersistence.recordSentSignal(newSignalToPersist);
  assert.strictEqual(persistRes.success, true, 'Signal must persist successfully');

  // Immediately query getActiveSignalsDetailed() without any delay
  const activeDetailed = await signalEngine.getActiveSignalsDetailed();
  assert.strictEqual(activeDetailed.activeCount, 1, 'Active count must immediately be 1');
  assert.strictEqual(activeDetailed.signals.length, 1, 'Signals length must immediately be 1');
  assert.strictEqual(activeDetailed.signals[0].symbol, 'BTCUSDT', 'BTCUSDT must be returned');
  assert.strictEqual(activeDetailed.signals[0].entryPrice, 85200.5, 'Entry price must match');
  console.log('✓ Test 5 passed: Newly persisted signal immediately available to active queries.');

  // Test 6: Expired signal in memory does not hide a newly persisted signal for the same symbol
  console.log('Test 6: Expired signal does not hide a newly persisted signal for the same symbol');
  // Simulate old expired signal in cache
  const oldExpiredSig: TradingSignal = {
    ...newSignalToPersist,
    id: 'sig_old_expired',
    status: 'EXPIRED',
    timestamp: Date.now() - 20000000,
    expiresAt: Date.now() - 5000000,
  };
  signalEngine.activeSignals.set('BTCUSDT', oldExpiredSig);

  // Now persist a new fresh signal for BTCUSDT
  const freshSignal: TradingSignal = {
    ...newSignalToPersist,
    id: 'sig_btc_fresh_2',
    entryPrice: 85500.0,
    stopLoss: 84600.0,
    takeProfit: 87800.0,
    tp1: 86100.0,
    tp2: 86800.0,
    tp3: 87800.0,
    timestamp: Date.now(),
    expiresAt: Date.now() + 14400000,
  };
  await ScannerPersistence.recordSentSignal(freshSignal);

  const refreshed = await signalEngine.getActiveSignalsDetailed();
  assert.strictEqual(refreshed.activeCount, 1, 'Active count must be 1');
  assert.strictEqual(refreshed.signals[0].id, 'sig_btc_fresh_2', 'Must return the new fresh signal');
  assert.strictEqual(refreshed.signals[0].status, 'ACTIVE', 'Status must be ACTIVE');
  console.log('✓ Test 6 passed: Expired signal did not hide new signal.');

  // Test 7: When signal expires or reaches TP/SL, removed from active display but preserved in history
  console.log('Test 7: When signal reaches terminal status, removed from active display but preserved in history');
  await ScannerPersistence.updateSignalStatus('sig_btc_fresh_2', 'TP3_HIT');

  const afterTpHit = await signalEngine.getActiveSignalsDetailed();
  assert.strictEqual(afterTpHit.activeCount, 0, 'After TP_HIT, signal must not be active');
  assert.strictEqual(afterTpHit.signals.length, 0, 'No active signals displayed');

  // Verify it is preserved in sent signals history
  const allSent = await ScannerPersistence.getSentSignals();
  const foundInHistory = allSent.find((s) => s.id === 'sig_btc_fresh_2');
  assert(foundInHistory !== undefined, 'Signal MUST be preserved in persistence history');
  assert.strictEqual(foundInHistory?.status, 'TP3_HIT', 'Status in history must be TP3_HIT');
  console.log('✓ Test 7 passed: Terminal signal removed from active display but preserved in persistence history.');

  // Test 8: Mock Firestore authoritative retrieval
  console.log('Test 8: Authoritative retrieval from Firestore mock');
  const mockDocs = new Map<string, any>();
  const mockSignal = {
    ...baseValidSignal,
    id: 'sig_firestore_authoritative_1',
    symbol: 'ETHUSDT',
    entryPrice: 3200,
    stopLoss: 3100,
    takeProfit: 3450,
    tp1: 3280,
    tp2: 3350,
    tp3: 3450,
  };
  mockDocs.set('sig_firestore_authoritative_1', mockSignal);

  const mockFirestoreInstance = {
    collection: (colName: string) => ({
      where: (field: string, op: string, val: any) => ({
        get: async () => {
          const matching: any[] = [];
          for (const doc of mockDocs.values()) {
            if (field === 'status' && doc.status === val) {
              matching.push({ id: doc.id, data: () => doc });
            }
          }
          return {
            empty: matching.length === 0,
            docs: matching,
            forEach: (cb: any) => matching.forEach(cb),
          };
        },
      }),
      doc: (docId: string) => ({
        get: async () => ({
          exists: mockDocs.has(docId),
          data: () => mockDocs.get(docId),
        }),
        set: async (data: any, options?: any) => {
          const existing = mockDocs.get(docId) || {};
          mockDocs.set(docId, options?.merge ? { ...existing, ...data } : data);
        },
      }),
    }),
  } as any;

  setMockFirestoreAdmin(mockFirestoreInstance);
  try {
    const firestoreActive = await ScannerPersistence.getActiveSignalsDetailed();
    assert.strictEqual(firestoreActive.activeCount, 1, 'Must find 1 active signal in mock Firestore');
    assert.strictEqual(firestoreActive.signals[0].id, 'sig_firestore_authoritative_1', 'Must return mock Firestore signal');

    // Update to SL_HIT in mock Firestore
    mockDocs.get('sig_firestore_authoritative_1').status = 'SL_HIT';
    const firestoreAfterSl = await ScannerPersistence.getActiveSignalsDetailed();
    assert.strictEqual(firestoreAfterSl.activeCount, 0, 'SL_HIT signal in Firestore must not be active');
    assert.strictEqual(firestoreAfterSl.signals.length, 0, '0 active signals after SL_HIT');
  } finally {
    setMockFirestoreAdmin(undefined);
  }
  console.log('✓ Test 8 passed: Firestore authoritative querying operates seamlessly.');

  console.log('\n\x1b[32m[GATE 11 SUCCESS] All Gate 11 active signals display regression checks passed perfectly!\x1b[0m\n');
}

runGate11Tests().catch((err) => {
  console.error('\x1b[31m[GATE 11 FAILED]\x1b[0m', err);
  process.exit(1);
});
