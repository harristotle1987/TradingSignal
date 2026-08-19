// @ts-nocheck
/**
 * Gate 2 Acceptance Test Suite
 *
 * Verifies:
 * 1. Persistent fields (tp1HitAt, tp2HitAt, tp3HitAt, stopLossHitAt, tp1HitPrice, tp2HitPrice, tp3HitPrice, stopLossHitPrice)
 * 2. ISO/UTC timestamp generation on target detection
 * 3. Timestamp and hit price immutability (never overwritten on subsequent price updates)
 * 4. Target progress state progression (TP1 HIT -> TP2 HIT -> TP3 HIT -> COMPLETED)
 * 5. Price retracement immutability (status remains HIT even if price falls back below TP level)
 * 6. Stop loss hit tracking (stopLossHitAt and stopLossHitPrice recorded)
 */

import { describe, it, expect } from 'vitest';
import { SignalLifecycleManager } from '../SignalLifecycleManager.js';
import { PersistedSentSignal } from '../ScannerPersistence.js';

describe('GATE 2 — TP Hit Timestamps, Hit Price & Frontend Display Contract', () => {
  const createTestSignal = (overrides?: Partial<PersistedSentSignal>): PersistedSentSignal => ({
    id: 'sig_gate2_100',
    snapshotId: 'snap_gate2_100',
    symbol: 'EUR/USD',
    direction: 'BUY',
    entryPrice: 1.0800,
    stopLoss: 1.0750,
    takeProfit: 1.0950,
    tp1: 1.0850,
    tp2: 1.0900,
    tp3: 1.0950,
    riskRewardRatio: 3.0,
    confidenceScore: 85,
    status: 'ACTIVE',
    tp1Status: 'PENDING',
    tp2Status: 'PENDING',
    tp3Status: 'PENDING',
    slStatus: 'ACTIVE',
    timestamp: Date.now() - 60000,
    validatedAt: Date.now() - 60000,
    strategy: 'STRUCTURAL_BREAKOUT',
    dataSource: 'TWELVEDATA',
    confluenceReasons: ['H1 Trend Confluence'],
    timeframe: '1h',
    ...overrides,
  });

  const applyEvaluation = (signal: PersistedSentSignal, res: ReturnType<typeof SignalLifecycleManager.evaluateSignalPriceUpdate>): PersistedSentSignal => ({
    ...signal,
    status: res.newStatus,
    tp1Status: res.tp1Status,
    tp2Status: res.tp2Status,
    tp3Status: res.tp3Status,
    slStatus: res.slStatus,
    tp1HitAt: res.tp1HitAt,
    tp2HitAt: res.tp2HitAt,
    tp3HitAt: res.tp3HitAt,
    stopLossHitAt: res.stopLossHitAt,
    tp1HitPrice: res.tp1HitPrice,
    tp2HitPrice: res.tp2HitPrice,
    tp3HitPrice: res.tp3HitPrice,
    stopLossHitPrice: res.stopLossHitPrice,
  });

  it('Requirement 1 & 2: First detection sets tp1HitAt (ISO/UTC) and tp1HitPrice', () => {
    const signal = createTestSignal();
    const nowIso = new Date('2026-08-19T12:00:00.000Z').toISOString();
    const res = SignalLifecycleManager.evaluateSignalPriceUpdate(signal, 1.0860, new Date(nowIso).getTime(), 'EUR/USD');
    const updatedSignal = applyEvaluation(signal, res);

    expect(updatedSignal.tp1Status).toBe('HIT');
    expect(updatedSignal.tp1HitAt).toBeDefined();
    expect(updatedSignal.tp1HitAt).toBe(nowIso);
    expect(updatedSignal.tp1HitPrice).toBe(1.0860);
    expect(updatedSignal.status).toBe('TP1_HIT');
  });

  it('Requirement 2: Timestamp and hit price are IMMUTABLE when price updates again', () => {
    const originalHitTime = '2026-08-19T12:00:00.000Z';
    const originalHitPrice = 1.0855;
    const signal = createTestSignal({
      status: 'TP1_HIT',
      tp1Status: 'HIT',
      tp1HitAt: originalHitTime,
      tp1HitPrice: originalHitPrice,
    });

    const laterTime = new Date('2026-08-19T12:05:00.000Z').getTime();
    const res = SignalLifecycleManager.evaluateSignalPriceUpdate(signal, 1.0875, laterTime, 'EUR/USD');
    const updatedSignal = applyEvaluation(signal, res);

    // Initial TP1 hit details MUST NOT be modified
    expect(updatedSignal.tp1HitAt).toBe(originalHitTime);
    expect(updatedSignal.tp1HitPrice).toBe(originalHitPrice);
    expect(updatedSignal.tp1Status).toBe('HIT');
  });

  it('Requirement 3 & 4: Sequential TP progression records separate timestamps and hit prices', () => {
    let signal = createTestSignal();

    // Step 1: Hit TP1
    const t1 = new Date('2026-08-19T12:00:00.000Z').getTime();
    let res = SignalLifecycleManager.evaluateSignalPriceUpdate(signal, 1.0852, t1, 'EUR/USD');
    signal = applyEvaluation(signal, res);

    expect(signal.tp1Status).toBe('HIT');
    expect(signal.tp1HitAt).toBe('2026-08-19T12:00:00.000Z');
    expect(signal.tp1HitPrice).toBe(1.0852);
    expect(signal.tp2Status).toBe('PENDING');

    // Step 2: Hit TP2
    const t2 = new Date('2026-08-19T12:10:00.000Z').getTime();
    res = SignalLifecycleManager.evaluateSignalPriceUpdate(signal, 1.0905, t2, 'EUR/USD');
    signal = applyEvaluation(signal, res);

    expect(signal.tp1HitAt).toBe('2026-08-19T12:00:00.000Z'); // Preserved
    expect(signal.tp2Status).toBe('HIT');
    expect(signal.tp2HitAt).toBe('2026-08-19T12:10:00.000Z');
    expect(signal.tp2HitPrice).toBe(1.0905);
    expect(signal.tp3Status).toBe('PENDING');

    // Step 3: Hit TP3 -> COMPLETED
    const t3 = new Date('2026-08-19T12:20:00.000Z').getTime();
    res = SignalLifecycleManager.evaluateSignalPriceUpdate(signal, 1.0960, t3, 'EUR/USD');
    signal = applyEvaluation(signal, res);

    expect(signal.tp1HitAt).toBe('2026-08-19T12:00:00.000Z');
    expect(signal.tp2HitAt).toBe('2026-08-19T12:10:00.000Z');
    expect(signal.tp3Status).toBe('HIT');
    expect(signal.tp3HitAt).toBe('2026-08-19T12:20:00.000Z');
    expect(signal.tp3HitPrice).toBe(1.0960);
    expect(signal.status).toBe('COMPLETED');
  });

  it('Requirement 5: Price Retracement does NOT revert TP1 HIT to PENDING', () => {
    let signal = createTestSignal();
    const t1 = new Date('2026-08-19T12:00:00.000Z').getTime();
    let res = SignalLifecycleManager.evaluateSignalPriceUpdate(signal, 1.0860, t1, 'EUR/USD');
    signal = applyEvaluation(signal, res);

    expect(signal.tp1Status).toBe('HIT');

    // Price drops back below TP1 (1.0850) to 1.0820
    const tRetrace = new Date('2026-08-19T12:15:00.000Z').getTime();
    res = SignalLifecycleManager.evaluateSignalPriceUpdate(signal, 1.0820, tRetrace, 'EUR/USD');
    signal = applyEvaluation(signal, res);

    expect(signal.tp1Status).toBe('HIT');
    expect(signal.tp1HitAt).toBe('2026-08-19T12:00:00.000Z');
    expect(signal.tp1HitPrice).toBe(1.0860);
  });

  it('Requirement 7: Stop Loss hit records stopLossHitAt and stopLossHitPrice', () => {
    const signal = createTestSignal();
    const slTime = new Date('2026-08-19T13:00:00.000Z').getTime();
    const res = SignalLifecycleManager.evaluateSignalPriceUpdate(signal, 1.0740, slTime, 'EUR/USD');
    const updatedSignal = applyEvaluation(signal, res);

    expect(updatedSignal.slStatus).toBe('HIT');
    expect(updatedSignal.stopLossHitAt).toBe('2026-08-19T13:00:00.000Z');
    expect(updatedSignal.stopLossHitPrice).toBe(1.0740);
    expect(updatedSignal.status).toBe('STOPPED_OUT');
  });
});
