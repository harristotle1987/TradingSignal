import assert from 'assert';
import express, { Request, Response } from 'express';
import { ScannerPersistence, isValidActiveSignal, PersistedSentSignal } from '../src/server/signals/ScannerPersistence.js';
import { signalEngine } from '../src/server/signals/SignalEngine.js';
import { getSignalRepository, setRepositories, createNeonRepositories } from '../src/server/infrastructure/index.js';
import { setMockNeonPool } from '../src/server/infrastructure/neon/db.js';
import router from '../src/server/routes/signals.js';
import { TradingSignal } from '../src/types/index.js';

// Helper to simulate calling the GET /api/signals route via Express
async function invokeGetSignalsRoute(): Promise<{ status: number; body: any }> {
  return new Promise((resolve) => {
    const app = express();
    app.use(express.json());
    app.use('/api', router);

    const req: any = {
      method: 'GET',
      url: '/api/signals',
      headers: {},
      query: {},
      params: {},
    };

    let statusCode = 200;
    const res: any = {
      statusCode: 200,
      status(code: number) {
        statusCode = code;
        this.statusCode = code;
        return this;
      },
      json(data: any) {
        resolve({ status: statusCode, body: data });
        return this;
      },
      send(data: any) {
        resolve({ status: statusCode, body: data });
        return this;
      },
      setHeader() {},
      getHeader() {},
    };

    (app as any).handle(req, res, () => {
      resolve({ status: 404, body: { error: 'Not found' } });
    });
  });
}

// Client-side SignalsPage filter function directly matching src/components/SignalsPage.tsx
function filterSignalsForDisplay(signals: any[]): any[] {
  if (!Array.isArray(signals)) return [];
  return signals.filter(
    (sig: any) => sig && sig.isTradeableSignal === true && sig.signalClassification === 'TRADEABLE'
  );
}

export async function runGate9ActiveSignalRegression(): Promise<void> {
  console.log('\n=== GATE 9: ACTIVE SIGNAL DISPLAY REGRESSION TEST ===\n');

  const baseValidSignal: PersistedSentSignal = {
    id: 'sig_neon_gate9_1',
    snapshotId: 'snap_neon_gate9_1',
    symbol: 'BTCUSDT',
    direction: 'BUY',
    entryPrice: 85250.0,
    stopLoss: 84300.0,
    takeProfit: 87500.0,
    tp1: 85900.0,
    tp2: 86600.0,
    tp3: 87500.0,
    riskRewardRatio: 2.36,
    score: 91,
    rankTier: 'BEST_TRADE',
    strategy: 'Trend Momentum',
    timeframe: 'H1',
    dataSource: 'Bitget Live Feed',
    status: 'ACTIVE',
    timestamp: Date.now(),
    expiresAt: Date.now() + 14400000,
    notificationSent: true,
    notificationTimestamp: Date.now(),
    date: '2026-10-01',
    isTradeableSignal: true,
    signalClassification: 'TRADEABLE',
    provenance: 'LIVE',
  };

  // Test 1: Complete Valid Path (Neon Repo -> ScannerPersistence -> SignalEngine -> GET /api/signals -> SignalsPage filtering)
  console.log('Test 1: Complete valid active signal path (Neon -> ScannerPersistence -> SignalEngine -> GET /api/signals -> SignalsPage)');
  const mockNeonStore = new Map<string, any>();
  mockNeonStore.set(baseValidSignal.id, baseValidSignal);

  const mockNeonInstance = {
    query: async (sql: string, params: any[] = []) => {
      if (sql.includes('FROM signals')) {
        const rows = Array.from(mockNeonStore.values()).map((s) => ({ payload_json: s }));
        return { rows, rowCount: rows.length };
      }
      return { rows: [], rowCount: 0 };
    },
  } as any;

  setMockNeonPool(mockNeonInstance);
  setRepositories(createNeonRepositories());
  signalEngine.clearSignals();

  try {
    // 1. Neon Repository check
    const repoSignals = await getSignalRepository().findActive();
    assert.strictEqual(repoSignals.length, 1, 'Neon repository must return 1 active signal');
    assert.strictEqual(repoSignals[0].id, baseValidSignal.id);

    // 2. ScannerPersistence.getActiveSignalsDetailed()
    const spResult = await ScannerPersistence.getActiveSignalsDetailed();
    assert.strictEqual(spResult.activeCount, 1, 'ScannerPersistence activeCount must be 1');
    assert.strictEqual(spResult.persistedActiveCount, 1, 'ScannerPersistence persistedActiveCount must be 1');
    assert.strictEqual(spResult.signals.length, 1, 'ScannerPersistence signals.length must be 1');
    assert.strictEqual(spResult.signals[0].isTradeableSignal, true, 'isTradeableSignal must be true');
    assert.strictEqual(spResult.signals[0].signalClassification, 'TRADEABLE', 'signalClassification must be TRADEABLE');

    // 3. SignalEngine.getActiveSignalsDetailed()
    const seResult = await signalEngine.getActiveSignalsDetailed();
    assert.strictEqual(seResult.activeCount, 1, 'SignalEngine activeCount must be 1');
    assert.strictEqual(seResult.persistedActiveCount, 1, 'SignalEngine persistedActiveCount must be 1');
    assert.strictEqual(seResult.signals.length, 1, 'SignalEngine signals.length must be 1');
    assert.strictEqual(seResult.signals[0].isTradeableSignal, true, 'SignalEngine signal must be tradeable');
    assert.strictEqual(seResult.signals[0].signalClassification, 'TRADEABLE', 'SignalEngine classification must be TRADEABLE');

    // 4. GET /api/signals HTTP API endpoint
    const httpRes = await invokeGetSignalsRoute();
    assert.strictEqual(httpRes.status, 200, 'GET /api/signals must return HTTP 200');
    assert.strictEqual(httpRes.body.success, true, 'GET /api/signals response success must be true');
    assert.strictEqual(httpRes.body.signals.length, 1, 'GET /api/signals signals length must be 1');
    assert.strictEqual(httpRes.body.activeCount, 1, 'GET /api/signals activeCount must be 1');
    assert.strictEqual(httpRes.body.persistedActiveCount, 1, 'GET /api/signals persistedActiveCount must be 1');
    assert.strictEqual(httpRes.body.signals[0].isTradeableSignal, true, 'API signal isTradeableSignal must be true');
    assert.strictEqual(httpRes.body.signals[0].signalClassification, 'TRADEABLE', 'API signal signalClassification must be TRADEABLE');

    // 5. SignalsPage client filtering
    const displaySignals = filterSignalsForDisplay(httpRes.body.signals);
    assert.strictEqual(displaySignals.length, 1, 'SignalsPage must display the tradeable active signal');
    assert.strictEqual(displaySignals[0].id, baseValidSignal.id, 'Displayed signal must match valid ID');
    console.log('✓ Test 1 passed: Valid signal flows completely from Neon to SignalsPage display (HTTP 200, length=1, activeCount=1).');
  } finally {
    setMockNeonPool(null);
  }

  // Test 2: Invalid signal with isTradeableSignal = false is not displayed
  console.log('Test 2: Invalid signal with isTradeableSignal=false is excluded from display');
  const nonTradeableSignal: PersistedSentSignal = {
    ...baseValidSignal,
    id: 'sig_non_tradeable_1',
    isTradeableSignal: false,
    signalClassification: 'TRADEABLE',
  };
  const mockNonTradeableStore = new Map<string, any>();
  mockNonTradeableStore.set(nonTradeableSignal.id, nonTradeableSignal);

  const mockNonTradeablePool = {
    query: async (sql: string) => {
      if (sql.includes('FROM signals')) {
        const rows = Array.from(mockNonTradeableStore.values()).map((s) => ({ payload_json: s }));
        return { rows, rowCount: rows.length };
      }
      return { rows: [], rowCount: 0 };
    },
  } as any;

  setMockNeonPool(mockNonTradeablePool);
  signalEngine.clearSignals();
  try {
    const spResult = await ScannerPersistence.getActiveSignalsDetailed();
    // ScannerPersistence filters out non-tradeable signals from active return array
    assert.strictEqual(spResult.signals.length, 0, 'ScannerPersistence must exclude isTradeableSignal=false from active return array');

    // Test SignalsPage client filter rejects it if ever encountered
    const displaySignals = filterSignalsForDisplay([nonTradeableSignal]);
    assert.strictEqual(displaySignals.length, 0, 'SignalsPage filter must reject isTradeableSignal=false');
    console.log('✓ Test 2 passed: isTradeableSignal=false signal is not displayed.');
  } finally {
    setMockNeonPool(null);
  }

  // Test 3: Wrong classification (signalClassification = 'WATCHING') is not displayed
  console.log('Test 3: Wrong classification (signalClassification=WATCHING) is excluded from display');
  const watchingSignal: PersistedSentSignal = {
    ...baseValidSignal,
    id: 'sig_watching_1',
    isTradeableSignal: true,
    signalClassification: 'WATCHING',
  };
  const mockWatchingStore = new Map<string, any>();
  mockWatchingStore.set(watchingSignal.id, watchingSignal);

  const mockWatchingPool = {
    query: async (sql: string) => {
      if (sql.includes('FROM signals')) {
        const rows = Array.from(mockWatchingStore.values()).map((s) => ({ payload_json: s }));
        return { rows, rowCount: rows.length };
      }
      return { rows: [], rowCount: 0 };
    },
  } as any;

  setMockNeonPool(mockWatchingPool);
  signalEngine.clearSignals();
  try {
    const spResult = await ScannerPersistence.getActiveSignalsDetailed();
    assert.strictEqual(spResult.signals.length, 0, 'ScannerPersistence must exclude signalClassification=WATCHING');

    const displaySignals = filterSignalsForDisplay([watchingSignal]);
    assert.strictEqual(displaySignals.length, 0, 'SignalsPage filter must reject signalClassification=WATCHING');
    console.log('✓ Test 3 passed: signalClassification=WATCHING signal is not displayed.');
  } finally {
    setMockNeonPool(null);
  }

  // Test 4: Database failure returns HTTP 503 PERSISTENCE_UNAVAILABLE (NOT HTTP 200 signals: [])
  console.log('Test 4: Database failure returns HTTP 503 PERSISTENCE_UNAVAILABLE, never HTTP 200 with empty signals');
  const failingPool = {
    query: async () => {
      throw new Error('Connection terminated unexpectedly: Neon database unreachable');
    },
  } as any;

  setMockNeonPool(failingPool);
  signalEngine.clearSignals();
  const origEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';

  try {
    const spResult = await ScannerPersistence.getActiveSignalsDetailed();
    assert.strictEqual(spResult.success, false, 'ScannerPersistence must return success=false on DB outage');
    assert.strictEqual(spResult.error, 'PERSISTENCE_UNAVAILABLE', 'ScannerPersistence error must be PERSISTENCE_UNAVAILABLE');

    const seResult = await signalEngine.getActiveSignalsDetailed();
    assert.strictEqual(seResult.success, false, 'SignalEngine must return success=false on DB outage');
    assert.strictEqual(seResult.error, 'PERSISTENCE_UNAVAILABLE', 'SignalEngine error must be PERSISTENCE_UNAVAILABLE');

    const httpRes = await invokeGetSignalsRoute();
    assert.strictEqual(httpRes.status, 503, 'GET /api/signals MUST return HTTP 503 on database failure');
    assert.strictEqual(httpRes.body.success, false, 'Response success must be false');
    assert.strictEqual(httpRes.body.error, 'PERSISTENCE_UNAVAILABLE', 'Response error must be PERSISTENCE_UNAVAILABLE');
    assert.notStrictEqual(httpRes.status, 200, 'Must NOT return HTTP 200 on DB failure');
    console.log('✓ Test 4 passed: Database outage returns HTTP 503 PERSISTENCE_UNAVAILABLE (no false 200 empty array).');
  } finally {
    process.env.NODE_ENV = origEnv;
    setMockNeonPool(null);
  }

  // Test 5: Fake price is not displayed and not persisted as LIVE
  console.log('Test 5: Fake price (e.g. entryPrice=50000 on BTC) is not displayed and not persisted as LIVE');
  const fakePriceSignal: PersistedSentSignal = {
    ...baseValidSignal,
    id: 'sig_fake_price_1',
    symbol: 'BTCUSDT',
    entryPrice: 50000.0,
    stopLoss: 49000.0,
    takeProfit: 52000.0,
    tp1: 50500.0,
    tp2: 51000.0,
    tp3: 52000.0,
  };

  const validationRes = isValidActiveSignal(fakePriceSignal, true);
  assert.strictEqual(validationRes.isValid, false, 'isValidActiveSignal must reject artificial 50000 BTC price');

  const mockFakeStore = new Map<string, any>();
  mockFakeStore.set(fakePriceSignal.id, fakePriceSignal);

  const mockFakePool = {
    query: async (sql: string) => {
      if (sql.includes('FROM signals')) {
        const rows = Array.from(mockFakeStore.values()).map((s) => ({ payload_json: s }));
        return { rows, rowCount: rows.length };
      }
      return { rows: [], rowCount: 0 };
    },
  } as any;

  setMockNeonPool(mockFakePool);
  signalEngine.clearSignals();
  try {
    const spResult = await ScannerPersistence.getActiveSignalsDetailed();
    assert.strictEqual(spResult.signals.length, 0, 'ScannerPersistence must filter out fake price signal');
    assert(spResult.filteredCount >= 1, 'Filtered count must record rejected fake price signal');
    console.log('✓ Test 5 passed: Fake price signal is strictly excluded and cannot appear in LIVE active display.');
  } finally {
    setMockNeonPool(null);
  }

  console.log('\n\x1b[32m[GATE 9 SUCCESS] All active signal display regression tests passed perfectly!\x1b[0m\n');
}

// If executed directly via tsx
if (process.argv[1]?.endsWith('gate9-active-signals-regression.test.ts')) {
  runGate9ActiveSignalRegression()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('\x1b[31m[GATE 9 FAILED]\x1b[0m', err);
      process.exit(1);
    });
}
