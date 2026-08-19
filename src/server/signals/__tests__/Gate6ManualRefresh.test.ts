// @ts-nocheck
import { describe, it, expect, vi } from 'vitest';
import { SignalLifecycleManager } from '../SignalLifecycleManager.js';
import { PersistedSentSignal } from '../ScannerPersistence.js';

describe('GATE 6 — Manual TP/SL Refresh & Verification Unit Tests', () => {
  const baseActiveSignal: PersistedSentSignal = {
    id: 'gate6_test_1',
    symbol: 'BTCUSDT',
    direction: 'BUY',
    timeframe: '15m',
    entryPrice: 50000,
    stopLoss: 48000,
    takeProfit: 56000,
    tp1: 52000,
    tp2: 54000,
    tp3: 56000,
    status: 'ACTIVE',
    score: 85,
    timestamp: Date.now() - 3600000,
    dataSource: 'binance',
    strategy: 'Trend Continuation',
    riskRewardRatio: 3.0,
    tp1Status: 'PENDING',
    tp2Status: 'PENDING',
    tp3Status: 'PENDING',
    slStatus: 'ACTIVE',
    snapshotId: 'gate6_snap_1',
    rankTier: 'HIGH_CONVICTION',
    notificationSent: false,
    notificationTimestamp: null,
    date: '2026-08-19',
  };

  it('Requirement 1: Manual evaluation with unchanged price results in ACTIVE state and no hits', () => {
    const updated = SignalLifecycleManager.evaluateSignalPriceUpdate(
      baseActiveSignal,
      51000, // Price below TP1, above SL
      Date.now(),
      'BTCUSDT'
    );

    expect(updated.newStatus).toBe('ACTIVE');
    expect(updated.tp1Status).toBe('PENDING');
    expect(updated.tp2Status).toBe('PENDING');
    expect(updated.tp3Status).toBe('PENDING');
    expect(updated.slStatus).toBe('ACTIVE');
    expect(updated.tp1HitAt).toBeUndefined();
    expect(updated.stopLossHitAt).toBeUndefined();
  });

  it('Requirement 2: Manual evaluation when TP1 is hit updates status and records hit price and timestamp', () => {
    const testTime = 1718800000000;
    const updated = SignalLifecycleManager.evaluateSignalPriceUpdate(
      baseActiveSignal,
      52500, // Above TP1
      testTime,
      'BTCUSDT'
    );

    expect(updated.newStatus).toBe('TP1_HIT');
    expect(updated.tp1Status).toBe('HIT');
    expect(updated.tp1HitPrice).toBe(52500);
    expect(updated.tp1HitAt).toBe(new Date(testTime).toISOString());
    expect(updated.tp2Status).toBe('PENDING');
    expect(updated.slStatus).toBe('ACTIVE');
  });

  it('Requirement 3: Sequential TP hits preserve older hit records and record new hits', () => {
    const firstHitSignal: PersistedSentSignal = {
      ...baseActiveSignal,
      status: 'TP1_HIT',
      tp1Status: 'HIT',
      tp1HitPrice: 52200,
      tp1HitAt: new Date(1718800000000).toISOString(),
    };

    const testTime2 = 1718800600000;
    const updated = SignalLifecycleManager.evaluateSignalPriceUpdate(
      firstHitSignal,
      54500, // Above TP2
      testTime2,
      'BTCUSDT'
    );

    expect(updated.newStatus).toBe('TP2_HIT');
    expect(updated.tp1Status).toBe('HIT');
    expect(updated.tp1HitPrice).toBe(52200); // Preserved
    expect(updated.tp1HitAt).toBe(new Date(1718800000000).toISOString()); // Preserved
    
    expect(updated.tp2Status).toBe('HIT');
    expect(updated.tp2HitPrice).toBe(54500); // Newly recorded
    expect(updated.tp2HitAt).toBe(new Date(testTime2).toISOString()); // Newly recorded
    expect(updated.tp3Status).toBe('PENDING');
  });

  it('Requirement 4: Terminal status of COMPLETED prevents further evaluations or target rewrites', () => {
    const completedSignal: PersistedSentSignal = {
      ...baseActiveSignal,
      status: 'COMPLETED',
      tp1Status: 'HIT',
      tp2Status: 'HIT',
      tp3Status: 'HIT',
      tp1HitPrice: 52500,
      tp2HitPrice: 54500,
      tp3HitPrice: 56500,
      tp1HitAt: '2026-08-19T10:00:00.000Z',
      tp2HitAt: '2026-08-19T10:05:00.000Z',
      tp3HitAt: '2026-08-19T10:10:00.000Z',
    };

    const updated = SignalLifecycleManager.evaluateSignalPriceUpdate(
      completedSignal,
      47000, // Price crashes to Stop Loss
      Date.now(),
      'BTCUSDT'
    );

    // Should remain unchanged because it was already completed
    expect(updated.newStatus).toBe('COMPLETED');
    expect(updated.tp1Status).toBe('HIT');
    expect(updated.tp1HitPrice).toBe(52500);
    expect(updated.tp1HitAt).toBe('2026-08-19T10:00:00.000Z');
    expect(updated.slStatus).toBe('ACTIVE');
    expect(updated.stopLossHitAt).toBeUndefined();
  });

  it('Requirement 5: Terminal status of STOPPED_OUT prevents further evaluations or target rewrites', () => {
    const stoppedSignal: PersistedSentSignal = {
      ...baseActiveSignal,
      status: 'STOPPED_OUT',
      slStatus: 'HIT',
      stopLossHitPrice: 47500,
      stopLossHitAt: '2026-08-19T10:00:00.000Z',
    };

    const updated = SignalLifecycleManager.evaluateSignalPriceUpdate(
      stoppedSignal,
      57000, // Price shoots to TP3
      Date.now(),
      'BTCUSDT'
    );

    expect(updated.newStatus).toBe('STOPPED_OUT');
    expect(updated.slStatus).toBe('HIT');
    expect(updated.stopLossHitPrice).toBe(47500);
    expect(updated.tp1Status).toBe('PENDING');
    expect(updated.tp2Status).toBe('PENDING');
    expect(updated.tp3Status).toBe('PENDING');
  });
});
