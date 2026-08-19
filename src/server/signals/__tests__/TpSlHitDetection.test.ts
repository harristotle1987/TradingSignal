// @ts-nocheck
import { describe, it, expect } from 'vitest';
import {
  SignalLifecycleManager,
  normalizeSymbol,
  validatePrice,
} from '../SignalLifecycleManager.js';
import { PersistedSentSignal } from '../ScannerPersistence.js';

describe('BATCH 1 — Fix TP/SL Hit Detection and Status Updates', () => {
  const baseBuySignal: PersistedSentSignal = {
    id: 'sig_buy_test_1',
    symbol: 'BTC/USDT',
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
    snapshotId: 'snap_buy_1',
    rankTier: 'HIGH_CONVICTION',
    notificationSent: false,
    notificationTimestamp: null,
    date: '2026-08-19',
  };

  const baseSellSignal: PersistedSentSignal = {
    id: 'sig_sell_test_1',
    symbol: 'ETHUSDT',
    direction: 'SELL',
    timeframe: '15m',
    entryPrice: 3000,
    stopLoss: 3150,
    takeProfit: 2700,
    tp1: 2900,
    tp2: 2800,
    tp3: 2700,
    status: 'ACTIVE',
    score: 88,
    timestamp: Date.now() - 3600000,
    dataSource: 'binance',
    strategy: 'Momentum Breakdown',
    riskRewardRatio: 2.0,
    tp1Status: 'PENDING',
    tp2Status: 'PENDING',
    tp3Status: 'PENDING',
    slStatus: 'ACTIVE',
    snapshotId: 'snap_sell_1',
    rankTier: 'HIGH_CONVICTION',
    notificationSent: false,
    notificationTimestamp: null,
    date: '2026-08-19',
  };

  it('Requirement 1: Symbol Normalization and Price Validation', () => {
    expect(normalizeSymbol('btc/usdt')).toBe('BTCUSDT');
    expect(normalizeSymbol('ETH-USDT')).toBe('ETHUSDT');
    expect(normalizeSymbol('sol_usdt')).toBe('SOLUSDT');

    expect(validatePrice(50000, 'BTCUSDT')).toBe(true);
    expect(validatePrice(0, 'BTCUSDT')).toBe(false);
    expect(validatePrice(-100, 'BTCUSDT')).toBe(false);
    expect(validatePrice(NaN, 'BTCUSDT')).toBe(false);
    expect(validatePrice(Infinity, 'BTCUSDT')).toBe(false);
    expect(validatePrice(null, 'BTCUSDT')).toBe(false);
    expect(validatePrice(undefined, 'BTCUSDT')).toBe(false);
  });

  it('Requirement 2: BUY Signal TP1 -> TP2 -> TP3 Progression', () => {
    const t0 = Date.now();

    // Price 51,000 -> No target hit
    let res = SignalLifecycleManager.evaluateSignalPriceUpdate(baseBuySignal, 51000, t0);
    expect(res.newStatus).toBe('ACTIVE');
    expect(res.tp1Status).toBe('PENDING');

    // Price 52,100 -> TP1 Hit
    const t1 = t0 + 1000;
    res = SignalLifecycleManager.evaluateSignalPriceUpdate(baseBuySignal, 52100, t1);
    expect(res.newStatus).toBe('TP1_HIT');
    expect(res.tp1Status).toBe('HIT');
    expect(res.tp1HitPrice).toBe(52100);
    expect(res.tp1HitAt).toBe(new Date(t1).toISOString());

    // Create updated state representing signal after TP1 hit
    const updatedState1: PersistedSentSignal = {
      ...baseBuySignal,
      status: res.newStatus,
      tp1Status: res.tp1Status,
      tp1HitAt: res.tp1HitAt,
      tp1HitPrice: res.tp1HitPrice,
    };

    // Price 54,200 -> TP2 Hit
    const t2 = t1 + 1000;
    res = SignalLifecycleManager.evaluateSignalPriceUpdate(updatedState1, 54200, t2);
    expect(res.newStatus).toBe('TP2_HIT');
    expect(res.tp2Status).toBe('HIT');
    expect(res.tp2HitPrice).toBe(54200);
    expect(res.tp2HitAt).toBe(new Date(t2).toISOString());
    // Ensure TP1 hit info was preserved
    expect(res.tp1Status).toBe('HIT');
    expect(res.tp1HitPrice).toBe(52100);

    const updatedState2: PersistedSentSignal = {
      ...updatedState1,
      status: res.newStatus,
      tp2Status: res.tp2Status,
      tp2HitAt: res.tp2HitAt,
      tp2HitPrice: res.tp2HitPrice,
    };

    // Price 56,500 -> TP3 Hit (Completed)
    const t3 = t2 + 1000;
    res = SignalLifecycleManager.evaluateSignalPriceUpdate(updatedState2, 56500, t3);
    expect(res.newStatus).toBe('COMPLETED');
    expect(res.tp3Status).toBe('HIT');
    expect(res.tp3HitPrice).toBe(56500);
    expect(res.tp3HitAt).toBe(new Date(t3).toISOString());
  });

  it('Requirement 3: SELL Signal TP1 -> TP2 -> TP3 Progression & SELL SL', () => {
    const t0 = Date.now();

    // SELL TP1
    let res = SignalLifecycleManager.evaluateSignalPriceUpdate(baseSellSignal, 2890, t0);
    expect(res.newStatus).toBe('TP1_HIT');
    expect(res.tp1Status).toBe('HIT');
    expect(res.tp1HitPrice).toBe(2890);

    const state1: PersistedSentSignal = {
      ...baseSellSignal,
      status: res.newStatus,
      tp1Status: res.tp1Status,
      tp1HitAt: res.tp1HitAt,
      tp1HitPrice: res.tp1HitPrice,
    };

    // SELL TP2
    res = SignalLifecycleManager.evaluateSignalPriceUpdate(state1, 2790, t0 + 1000);
    expect(res.newStatus).toBe('TP2_HIT');
    expect(res.tp2Status).toBe('HIT');
    expect(res.tp2HitPrice).toBe(2790);

    const state2: PersistedSentSignal = {
      ...state1,
      status: res.newStatus,
      tp2Status: res.tp2Status,
      tp2HitAt: res.tp2HitAt,
      tp2HitPrice: res.tp2HitPrice,
    };

    // SELL TP3 (COMPLETED)
    res = SignalLifecycleManager.evaluateSignalPriceUpdate(state2, 2690, t0 + 2000);
    expect(res.newStatus).toBe('COMPLETED');
    expect(res.tp3Status).toBe('HIT');
    expect(res.tp3HitPrice).toBe(2690);

    // SELL SL (price rises above stopLoss 3150)
    const slRes = SignalLifecycleManager.evaluateSignalPriceUpdate(baseSellSignal, 3160, t0);
    expect(slRes.newStatus).toBe('STOPPED_OUT');
    expect(slRes.slStatus).toBe('HIT');
    expect(slRes.stopLossHitPrice).toBe(3160);
  });

  it('Requirement 4: Multi-Target Jump across all 3 TPs for BUY and SELL', () => {
    const t0 = Date.now();

    // BUY jump from 50,000 to 57,000 (crosses TP1 52000, TP2 54000, TP3 56000)
    const buyJump = SignalLifecycleManager.evaluateSignalPriceUpdate(baseBuySignal, 57000, t0);
    expect(buyJump.newStatus).toBe('COMPLETED');
    expect(buyJump.tp1Status).toBe('HIT');
    expect(buyJump.tp2Status).toBe('HIT');
    expect(buyJump.tp3Status).toBe('HIT');
    expect(buyJump.transitions.length).toBe(3);
    expect(buyJump.transitions[0].nextState).toBe('TP1_HIT');
    expect(buyJump.transitions[1].nextState).toBe('TP2_HIT');
    expect(buyJump.transitions[2].nextState).toBe('TP3_HIT');

    // SELL jump from 3000 to 2600 (crosses TP1 2900, TP2 2800, TP3 2700)
    const sellJump = SignalLifecycleManager.evaluateSignalPriceUpdate(baseSellSignal, 2600, t0);
    expect(sellJump.newStatus).toBe('COMPLETED');
    expect(sellJump.tp1Status).toBe('HIT');
    expect(sellJump.tp2Status).toBe('HIT');
    expect(sellJump.tp3Status).toBe('HIT');
    expect(sellJump.transitions.length).toBe(3);
  });

  it('Requirement 5: Stop Loss priority and status update to STOPPED_OUT', () => {
    const t0 = Date.now();
    // Price drops to 47,500 (below SL 48,000)
    const res = SignalLifecycleManager.evaluateSignalPriceUpdate(baseBuySignal, 47500, t0);

    expect(res.newStatus).toBe('STOPPED_OUT');
    expect(res.slStatus).toBe('HIT');
    expect(res.stopLossHitPrice).toBe(47500);
    expect(res.stopLossHitAt).toBe(new Date(t0).toISOString());
  });

  it('Requirement 6: Price retracement after TP hit does NOT erase target hit', () => {
    const t0 = Date.now();
    // TP1 hit first at 52,500
    const res1 = SignalLifecycleManager.evaluateSignalPriceUpdate(baseBuySignal, 52500, t0);
    expect(res1.newStatus).toBe('TP1_HIT');
    expect(res1.tp1Status).toBe('HIT');

    const tp1State: PersistedSentSignal = {
      ...baseBuySignal,
      status: res1.newStatus,
      tp1Status: res1.tp1Status,
      tp1HitAt: res1.tp1HitAt,
      tp1HitPrice: res1.tp1HitPrice,
    };

    // Price retraces back down to 49,500 (below TP1 52,000)
    const resRetrace = SignalLifecycleManager.evaluateSignalPriceUpdate(tp1State, 49500, t0 + 1000);
    expect(resRetrace.tp1Status).toBe('HIT'); // TP1 status MUST remain 'HIT'!
    expect(resRetrace.tp1HitPrice).toBe(52500); // Hit price MUST remain preserved!
    expect(resRetrace.tp1HitAt).toBe(new Date(t0).toISOString()); // Hit timestamp MUST remain preserved!

    // Subsequent price drop to 47,000 hits SL
    const res2 = SignalLifecycleManager.evaluateSignalPriceUpdate(tp1State, 47000, t0 + 2000);
    expect(res2.newStatus).toBe('STOPPED_OUT');
    expect(res2.slStatus).toBe('HIT');
    expect(res2.tp1Status).toBe('HIT');
    expect(res2.tp1HitPrice).toBe(52500);
    expect(res2.stopLossHitPrice).toBe(47000);
  });

  it('Requirement 7: Repeated polling & duplicate protection', () => {
    const t0 = Date.now();
    const iso0 = new Date(t0).toISOString();

    // Initial TP1 hit
    const res1 = SignalLifecycleManager.evaluateSignalPriceUpdate(baseBuySignal, 52500, t0);
    expect(res1.tp1HitAt).toBe(iso0);
    expect(res1.tp1HitPrice).toBe(52500);
    expect(res1.transitions.length).toBe(1);

    const state1: PersistedSentSignal = {
      ...baseBuySignal,
      status: res1.newStatus,
      tp1Status: res1.tp1Status,
      tp1HitAt: res1.tp1HitAt,
      tp1HitPrice: res1.tp1HitPrice,
    };

    // Second update later with price 52,600 (still in TP1 zone, TP2 not hit)
    const t1 = t0 + 5000;
    const res2 = SignalLifecycleManager.evaluateSignalPriceUpdate(state1, 52600, t1);
    expect(res2.tp1HitAt).toBe(iso0); // Timestamp MUST stay original t0!
    expect(res2.tp1HitPrice).toBe(52500); // Hit price MUST stay original 52,500!
    expect(res2.transitions.length).toBe(0); // NO duplicate transition created!
  });

  it('Requirement 8: Invalid price & wrong symbol rejection', () => {
    // Invalid price rejection
    const resInvalid = SignalLifecycleManager.evaluateSignalPriceUpdate(baseBuySignal, -500);
    expect(resInvalid.newStatus).toBe('ACTIVE');
    expect(resInvalid.tp1Status).toBe('PENDING');
    expect(resInvalid.transitions.length).toBe(0);

    // Wrong symbol rejection
    const resWrongSymbol = SignalLifecycleManager.evaluateSignalPriceUpdate(baseBuySignal, 53000, Date.now(), 'SOL/USDT');
    expect(resWrongSymbol.newStatus).toBe('ACTIVE');
    expect(resWrongSymbol.tp1Status).toBe('PENDING');
    expect(resWrongSymbol.transitions.length).toBe(0);
  });

  it('Requirement 9: Original trade values are strictly preserved', () => {
    const initialEntry = baseBuySignal.entryPrice;
    const initialSL = baseBuySignal.stopLoss;
    const initialTP1 = baseBuySignal.tp1;
    const initialTP2 = baseBuySignal.tp2;
    const initialTP3 = baseBuySignal.tp3;

    SignalLifecycleManager.evaluateSignalPriceUpdate(baseBuySignal, 57000);

    expect(baseBuySignal.entryPrice).toBe(initialEntry);
    expect(baseBuySignal.stopLoss).toBe(initialSL);
    expect(baseBuySignal.tp1).toBe(initialTP1);
    expect(baseBuySignal.tp2).toBe(initialTP2);
    expect(baseBuySignal.tp3).toBe(initialTP3);
  });
});
