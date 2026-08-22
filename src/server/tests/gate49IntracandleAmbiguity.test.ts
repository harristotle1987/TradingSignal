import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SignalLifecycleManager } from '../signals/SignalLifecycleManager.js';
import { ScannerPersistence, PersistedSentSignal } from '../signals/ScannerPersistence.js';
import { NormalizedCandle as OHLCVCandle } from '../../types/index.js';
import { SignalLogger } from '../signals/SignalLogger.js';

vi.mock('../signals/ScannerPersistence', () => ({
  ScannerPersistence: {
    getSettings: vi.fn().mockReturnValue({ notificationsEnabled: false }),
    recordNotification: vi.fn().mockResolvedValue(undefined),
    updateSignalStatus: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../signals/SignalLogger', () => ({
  SignalLogger: {
    updateStatus: vi.fn().mockResolvedValue(undefined),
    writeOutcomeLog: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('GATE 49 — Multi-Target Intracandle Ambiguity', () => {
  const baseSignal: PersistedSentSignal = {
    id: 'sig-gate49-001',
    snapshotId: 'snap-49',
    symbol: 'EURUSD',
    direction: 'BUY',
    entryPrice: 1.1000,
    stopLoss: 1.0950,
    takeProfit: 1.1200,
    tp1: 1.1050,
    tp2: 1.1100,
    tp3: 1.1200,
    riskRewardRatio: 2.0,
    strategy: 'TestStrategy',
    timeframe: '1m',
    status: 'ACTIVE',
    entryHitTimestamp: new Date(1700000000000).toISOString(),
    timestamp: 1700000000000,
    score: 85,
    rankTier: 'BEST_TRADE',
    notifiedStates: ['ACTIVE'],
    tp1Status: 'PENDING',
    tp2Status: 'PENDING',
    tp3Status: 'PENDING',
    slStatus: 'ACTIVE',
    dataSource: 'FIX',
    notificationSent: false,
    notificationTimestamp: 0,
    date: '2026-08-21',
  };

  const createCandle = (override: Partial<OHLCVCandle>): OHLCVCandle => ({
    symbol: 'EURUSD',
    provider: 'FIX',
    timeframe: '1m',
    timestamp: 1700000060000,
    open: 1.1000,
    high: 1.1000,
    low: 1.1000,
    close: 1.1000,
    volume: 1000,
    ...override,
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('1. TP1 only - candle reaches TP1 without touching SL', async () => {
    const candles: OHLCVCandle[] = [
      createCandle({
        timestamp: 1700000060000,
        open: 1.1000,
        high: 1.1060, // >= tp1 (1.1050), < tp2 (1.1100)
        low: 1.0980,  // > sl (1.0950)
        close: 1.1055,
      }),
    ];

    const result = SignalLifecycleManager.evaluateCandleHistory(baseSignal, candles);

    expect(result.finalState).toBe('TP1_HIT');
    expect(result.timestamps.tp1Status).toBe('HIT');
    expect(result.timestamps.tp2Status).toBe('PENDING');
  });

  it('2. TP1 + TP2 - candle reaches TP2 without touching SL', async () => {
    const candles: OHLCVCandle[] = [
      createCandle({
        timestamp: 1700000060000,
        open: 1.1000,
        high: 1.1120, // >= tp2 (1.1100), < tp3 (1.1200)
        low: 1.0980,  // > sl (1.0950)
        close: 1.1110,
      }),
    ];

    const result = SignalLifecycleManager.evaluateCandleHistory(baseSignal, candles);

    expect(result.finalState).toBe('TP2_HIT');
    expect(result.timestamps.tp1Status).toBe('HIT');
    expect(result.timestamps.tp2Status).toBe('HIT');
    expect(result.timestamps.tp3Status).toBe('PENDING');
  });

  it('3. TP1 + TP2 + TP3 - candle reaches TP3 without touching SL', async () => {
    const candles: OHLCVCandle[] = [
      createCandle({
        timestamp: 1700000060000,
        open: 1.1000,
        high: 1.1250, // >= tp3 (1.1200)
        low: 1.0980,  // > sl (1.0950)
        close: 1.1210,
      }),
    ];

    const result = SignalLifecycleManager.evaluateCandleHistory(baseSignal, candles);

    expect(result.finalState).toBe('COMPLETED');
    expect(result.timestamps.tp1Status).toBe('HIT');
    expect(result.timestamps.tp2Status).toBe('HIT');
    expect(result.timestamps.tp3Status).toBe('HIT');
  });

  it('4. TP + SL same candle - open is between SL and TP, order unknown -> marks AMBIGUOUS', async () => {
    const candles: OHLCVCandle[] = [
      createCandle({
        timestamp: 1700000060000,
        open: 1.1000, // between SL (1.0950) and TP1 (1.1050)
        high: 1.1250, // reaches TP1, TP2, TP3
        low: 1.0900,  // reaches SL
        close: 1.1000,
      }),
    ];

    const result = SignalLifecycleManager.evaluateCandleHistory(baseSignal, candles);

    expect(result.finalState).toBe('AMBIGUOUS');
    expect(result.timestamps.tp1Status).toBe('PENDING');
    expect(result.transitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          nextState: 'AMBIGUOUS',
          ambiguousDetails: expect.stringContaining('Both TP level'),
        }),
      ])
    );
  });

  it('5. Entry + TP + SL same candle - WAITING_ENTRY signal touches Entry, TP and SL in same candle -> marks AMBIGUOUS', async () => {
    const unconfirmedSignal: PersistedSentSignal = {
      ...baseSignal,
      status: 'WAITING_ENTRY',
      entryHitTimestamp: undefined,
      slStatus: 'ACTIVE_FOR_ENTRY_ONLY',
      historicalEntryPolicy: 'CANDLE_TOUCH',
    };

    const candles: OHLCVCandle[] = [
      createCandle({
        timestamp: 1700000060000,
        open: 1.1020,
        high: 1.1250, // reaches TP1, TP2, TP3
        low: 1.0900,  // touches entry (1.1000) and SL (1.0950)
        close: 1.1010,
      }),
    ];

    const result = SignalLifecycleManager.evaluateCandleHistory(unconfirmedSignal, candles);

    expect(result.finalState).toBe('AMBIGUOUS');
    expect(result.timestamps.tp1Status).toBe('PENDING');
    expect(result.transitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          nextState: 'AMBIGUOUS',
          ambiguousDetails: expect.stringContaining('before confirmation'),
        }),
      ])
    );
  });

  it('6. Preserves existing confirmed historical milestones prior to ambiguity', async () => {
    // Candle 1 hits TP1 cleanly
    // Candle 2 touches TP2 and SL in same candle
    const candles: OHLCVCandle[] = [
      createCandle({
        timestamp: 1700000060000,
        open: 1.1000,
        high: 1.1060, // hits TP1
        low: 1.0980,
        close: 1.1055,
      }),
      createCandle({
        timestamp: 1700000120000,
        open: 1.1060, // between SL (1.0950) and TP2 (1.1100)
        high: 1.1250, // touches TP2, TP3
        low: 1.0900,  // touches SL
        close: 1.1000,
      }),
    ];

    const result = SignalLifecycleManager.evaluateCandleHistory(baseSignal, candles);

    expect(result.finalState).toBe('AMBIGUOUS');
    // Verify that TP1 was recorded as HIT and preserved
    expect(result.timestamps.tp1Status).toBe('HIT');
    expect(result.timestamps.tp2Status).toBe('PENDING');
    expect(result.transitions.map((t) => t.nextState)).toEqual(['TP1_HIT', 'AMBIGUOUS']);
  });
});
