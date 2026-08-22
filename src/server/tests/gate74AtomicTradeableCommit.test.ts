import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ScannerPersistence } from '../signals/ScannerPersistence.js';
import { SignalLogger } from '../signals/SignalLogger.js';
import { TradingSignal } from '../../types/index.js';

describe('GATE 74 — ATOMIC TRADEABLE SIGNAL COMMIT', () => {
  const originalEnv = process.env.NODE_ENV;

  beforeEach(async () => {
    process.env.NODE_ENV = 'development';
    await ScannerPersistence.clearSentSignals();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    vi.restoreAllMocks();
  });

  it('1. Valid signal + persistence success results in TRADEABLE classification and successful persistence', async () => {
    const sig = {
      id: 'sig_test_1',
      symbol: 'BTCUSDT',
      direction: 'BUY',
      entryPrice: 50000,
      stopLoss: 49000,
      takeProfit: 53000,
      score: 85,
      confidenceScore: 85,
      strategy: 'Breakout',
      timestamp: Date.now(),
      marketRegime: 'TREND',
      snapshotId: 'snap_1',
      timeframe: '1h',
      confluenceReasons: ['Breakout'],
      riskRewardRatio: 3.0,
    } as TradingSignal;

    const capRes = await ScannerPersistence.tryIncrementCap(5);
    expect(capRes.allowed).toBe(true);

    // GATE 75 required order: mark tradeable before persistence and logging
    sig.isTradeableSignal = true;
    sig.signalClassification = 'TRADEABLE';

    const persRes = await ScannerPersistence.recordSentSignal(sig);
    expect(persRes.success).toBe(true);

    const logRes = await SignalLogger.logSignal(sig, 'TREND');
    expect(logRes.success).toBe(true);
    expect(logRes.status).toBe('TRADEABLE_RECORD_PERSISTED');

    await ScannerPersistence.commitCap(capRes.reservationId);

    expect(sig.isTradeableSignal).toBe(true);
    expect(sig.signalClassification).toBe('TRADEABLE');
  });

  it('2. Persistence failure results in cap rollback and signal remains non-tradeable', async () => {
    const sig = {
      id: 'sig_test_2',
      symbol: 'ETHUSDT',
      direction: 'SELL',
      entryPrice: 3000,
      stopLoss: 3100,
      takeProfit: 2800,
      score: 82,
      confidenceScore: 82,
      strategy: 'Mean Reversion',
      timestamp: Date.now(),
      marketRegime: 'RANGE',
      snapshotId: 'snap_2',
      timeframe: '1h',
      confluenceReasons: ['Mean Reversion'],
      riskRewardRatio: 2.0,
    } as TradingSignal;

    const capBefore = (await ScannerPersistence.getCapState()).dailySignalCount;
    const capRes = await ScannerPersistence.tryIncrementCap(5);
    expect(capRes.allowed).toBe(true);
    expect((await ScannerPersistence.getCapState()).dailySignalCount).toBe(capBefore + 1);

    // Mock recordSentSignal to fail
    vi.spyOn(ScannerPersistence, 'recordSentSignal').mockResolvedValueOnce({
      success: false,
      error: 'Simulated persistence failure',
    });

    const persRes = await ScannerPersistence.recordSentSignal(sig);
    expect(persRes.success).toBe(false);

    // Rollback cap
    await ScannerPersistence.releaseCap(capRes.reservationId);
    expect((await ScannerPersistence.getCapState()).dailySignalCount).toBe(capBefore);

    // Signal must NOT be marked tradeable
    sig.isTradeableSignal = false;
    sig.signalClassification = 'DIAGNOSTIC';

    expect(sig.isTradeableSignal).toBe(false);
    expect(sig.signalClassification).toBe('DIAGNOSTIC');
  });

  it('3. SignalLogger persistence failure returns PERSISTENCE_FAILED and does not silently succeed', async () => {
    const sig = {
      id: 'sig_test_3',
      symbol: 'SOLUSDT',
      direction: 'BUY',
      entryPrice: 150,
      stopLoss: 140,
      takeProfit: 180,
      score: 90,
      confidenceScore: 90,
      strategy: 'Momentum',
      timestamp: Date.now(),
      snapshotId: 'snap_3',
      timeframe: '1h',
      confluenceReasons: ['Momentum'],
      riskRewardRatio: 3.0,
    } as TradingSignal;

    vi.spyOn(SignalLogger, 'logSignal').mockResolvedValueOnce({
      success: false,
      status: 'PERSISTENCE_FAILED',
      error: 'Database timeout',
    });

    const logRes = await SignalLogger.logSignal(sig, 'TREND');
    expect(logRes.success).toBe(false);
    expect(logRes.status).toBe('PERSISTENCE_FAILED');
  });

  it('4. Concurrency test: Signal A reserves -> Signal B reserves -> A fails -> B succeeds', async () => {
    const capBefore = (await ScannerPersistence.getCapState()).dailySignalCount;

    // 1. Signal A reserves
    const resA = await ScannerPersistence.tryIncrementCap(5);
    expect(resA.allowed).toBe(true);
    expect(resA.reservationId).toBeDefined();

    // 2. Signal B reserves
    const resB = await ScannerPersistence.tryIncrementCap(5);
    expect(resB.allowed).toBe(true);
    expect(resB.reservationId).toBeDefined();

    expect((await ScannerPersistence.getCapState()).dailySignalCount).toBe(capBefore + 2);

    // 3. Signal A fails -> Release reservation A only
    await ScannerPersistence.releaseCap(resA.reservationId);

    // 4. Signal B succeeds -> Commit reservation B
    await ScannerPersistence.commitCap(resB.reservationId);

    // Verification
    const state = await ScannerPersistence.getCapState();
    expect(state.dailySignalCount).toBe(capBefore + 1);

    const reservations = state.reservations || [];
    const reservationA = reservations.find(r => r.id === resA.reservationId);
    const reservationB = reservations.find(r => r.id === resB.reservationId);

    expect(reservationA?.status).toBe('RELEASED');
    expect(reservationB?.status).toBe('COMMITTED');
  });
});
