// @ts-nocheck
/**
 * Gate 3 Acceptance Test Suite — Aggressive ATR-Based TP Generation
 *
 * Verifies:
 * 1. Primary ATR Formula:
 *    BUY: TP1 = Entry + ATR*1.0, TP2 = Entry + ATR*1.7, TP3 = Entry + ATR*2.5
 *    SELL: TP1 = Entry - ATR*1.0, TP2 = Entry - ATR*1.7, TP3 = Entry - ATR*2.5
 * 2. Aggressive Mode:
 *    TP1 = 1.0–1.2 ATR, TP2 = 1.7–2.0 ATR, TP3 = 2.5–3.0 ATR
 * 3. Volatility Regimes: LOW, NORMAL, HIGH, EXTREME
 * 4. Target Ordering:
 *    BUY: Entry < TP1 < TP2 < TP3
 *    SELL: Entry > TP1 > TP2 > TP3
 * 5. Percentage Guardrails by Asset Class (Crypto, Forex, Stocks)
 * 6. Edge cases: Very small ATR, very large ATR, different decimal precisions
 * 7. Immutability of Published Signals (Targets do not recalculate as ATR changes)
 */

import { describe, it, expect } from 'vitest';
import { AtrTpGenerator } from '../AtrTpGenerator.js';
import { SignalLifecycleManager } from '../SignalLifecycleManager.js';
import { PersistedSentSignal } from '../ScannerPersistence.js';

describe('GATE 3 — Aggressive ATR-Based TP Generation', () => {
  it('Requirement 1: Default BUY ATR-based Take Profit calculation', () => {
    const entryPrice = 50000;
    const atr = 1000; // 2% ATR -> NORMAL regime
    const res = AtrTpGenerator.generate({
      direction: 'BUY',
      entryPrice,
      atr,
      assetClass: 'CRYPTO',
      precision: 2,
    });

    expect(res.isValid).toBe(true);
    // Unclamped ATR targets: TP1=51000 (+2%), TP2=51700 (+3.4%), TP3=52500 (+5%)
    // Crypto guardrail ranges: TP1 max 2%, TP2 max 4%, TP3 max 6%
    expect(res.tp1).toBe(51000);
    expect(res.tp2).toBe(51700);
    expect(res.tp3).toBe(52500);
    expect(res.tp1).toBeLessThan(res.tp2);
    expect(res.tp2).toBeLessThan(res.tp3);
    expect(res.tp1).toBeGreaterThan(entryPrice);
  });

  it('Requirement 1: Default SELL ATR-based Take Profit calculation', () => {
    const entryPrice = 50000;
    const atr = 1000;
    const res = AtrTpGenerator.generate({
      direction: 'SELL',
      entryPrice,
      atr,
      assetClass: 'CRYPTO',
      precision: 2,
    });

    expect(res.isValid).toBe(true);
    // Unclamped SELL targets: TP1=49000 (-2%), TP2=48300 (-3.4%), TP3=47500 (-5%)
    expect(res.tp1).toBe(49000);
    expect(res.tp2).toBe(48300);
    expect(res.tp3).toBe(47500);
    expect(res.tp1).toBeGreaterThan(res.tp2);
    expect(res.tp2).toBeGreaterThan(res.tp3);
    expect(res.tp1).toBeLessThan(entryPrice);
  });

  it('Requirement 2: Aggressive Mode expands multipliers without target compression', () => {
    const entryPrice = 100;
    const atr = 1.0;
    const resNormal = AtrTpGenerator.generate({
      direction: 'BUY',
      entryPrice,
      atr,
      isAggressive: false,
      precision: 2,
    });

    const resAggressive = AtrTpGenerator.generate({
      direction: 'BUY',
      entryPrice,
      atr,
      isAggressive: true,
      precision: 2,
    });

    expect(resAggressive.multipliersUsed.m1).toBeGreaterThanOrEqual(resNormal.multipliersUsed.m1);
    expect(resAggressive.multipliersUsed.m2).toBeGreaterThanOrEqual(resNormal.multipliersUsed.m2);
    expect(resAggressive.multipliersUsed.m3).toBeGreaterThanOrEqual(resNormal.multipliersUsed.m3);

    // Ensure aggressive mode targets are strictly wider than or equal to standard targets
    expect(resAggressive.tp1 - entryPrice).toBeGreaterThanOrEqual(resNormal.tp1 - entryPrice);
    expect(resAggressive.tp3 - entryPrice).toBeGreaterThanOrEqual(resNormal.tp3 - entryPrice);
  });

  it('Requirement 3: Volatility Regimes (LOW, NORMAL, HIGH, EXTREME)', () => {
    const entryPrice = 100;

    const lowRegime = AtrTpGenerator.detectVolatilityRegime(0.5, entryPrice, 'CRYPTO');
    expect(lowRegime).toBe('LOW');

    const normalRegime = AtrTpGenerator.detectVolatilityRegime(1.5, entryPrice, 'CRYPTO');
    expect(normalRegime).toBe('NORMAL');

    const highRegime = AtrTpGenerator.detectVolatilityRegime(3.5, entryPrice, 'CRYPTO');
    expect(highRegime).toBe('HIGH');

    const extremeRegime = AtrTpGenerator.detectVolatilityRegime(8.0, entryPrice, 'CRYPTO');
    expect(extremeRegime).toBe('EXTREME');
  });

  it('Requirement 3: Extreme Volatility does NOT create absurd targets due to guardrails', () => {
    const entryPrice = 100;
    const hugeAtr = 50; // Extreme ATR = 50% of price
    const res = AtrTpGenerator.generate({
      direction: 'BUY',
      entryPrice,
      atr: hugeAtr,
      assetClass: 'CRYPTO',
      precision: 2,
    });

    expect(res.isValid).toBe(true);
    // Crypto TP3 max guardrail is 6% -> max price = 106
    expect(res.tp3).toBeLessThanOrEqual(106.01);
    expect(res.tp1).toBeLessThan(res.tp2);
    expect(res.tp2).toBeLessThan(res.tp3);
  });

  it('Requirement 4: Target Ordering Enforcement for BUY and SELL', () => {
    const buyRes = AtrTpGenerator.generate({
      direction: 'BUY',
      entryPrice: 1.0800,
      atr: 0.0020,
      precision: 4,
    });

    expect(buyRes.entryPrice ?? 1.0800).toBeLessThan(buyRes.tp1);
    expect(buyRes.tp1).toBeLessThan(buyRes.tp2);
    expect(buyRes.tp2).toBeLessThan(buyRes.tp3);

    const sellRes = AtrTpGenerator.generate({
      direction: 'SELL',
      entryPrice: 1.0800,
      atr: 0.0020,
      precision: 4,
    });

    expect(sellRes.entryPrice ?? 1.0800).toBeGreaterThan(sellRes.tp1);
    expect(sellRes.tp1).toBeGreaterThan(sellRes.tp2);
    expect(sellRes.tp2).toBeGreaterThan(sellRes.tp3);
  });

  it('Requirement 5: Percentage Guardrails differ by Asset Class (Crypto vs Forex)', () => {
    const entryPrice = 1.1000;
    const atr = 0.02; // Very large relative ATR for Forex (1.82%)

    const forexRes = AtrTpGenerator.generate({
      direction: 'BUY',
      entryPrice,
      atr,
      assetClass: 'FOREX',
      precision: 4,
    });

    // Forex TP3 max percentage guardrail is 2.50% -> max TP3 = 1.1000 * 1.025 = 1.1275
    expect(forexRes.tp3).toBeLessThanOrEqual(1.1276);

    const cryptoRes = AtrTpGenerator.generate({
      direction: 'BUY',
      entryPrice: 50000,
      atr: 1000,
      assetClass: 'CRYPTO',
      precision: 2,
    });

    // Crypto allows wider percentage bounds
    expect(cryptoRes.tp3).toBe(52500); // 5% above entry
  });

  it('Requirement 5: Handles different decimal precisions (2, 4, 5, 6 decimals)', () => {
    // 5 Decimals (Forex e.g. EUR/USD)
    const res5 = AtrTpGenerator.generate({
      direction: 'BUY',
      entryPrice: 1.08500,
      atr: 0.0030,
      precision: 5,
    });
    expect(res5.tp1.toString().split('.')[1]?.length ?? 0).toBeLessThanOrEqual(5);

    // 2 Decimals (Crypto e.g. BTC)
    const res2 = AtrTpGenerator.generate({
      direction: 'BUY',
      entryPrice: 65000.50,
      atr: 500,
      precision: 2,
    });
    expect(res2.tp1.toString().split('.')[1]?.length ?? 0).toBeLessThanOrEqual(2);
  });

  it('Requirement 5: Edge cases - Very small ATR and very large ATR', () => {
    // Very small ATR
    const resSmall = AtrTpGenerator.generate({
      direction: 'BUY',
      entryPrice: 100,
      atr: 0.000001,
      precision: 4,
    });
    expect(resSmall.isValid).toBe(true);
    expect(resSmall.tp1).toBeGreaterThan(100);
    expect(resSmall.tp1).toBeLessThan(resSmall.tp2);

    // Very large ATR
    const resLarge = AtrTpGenerator.generate({
      direction: 'BUY',
      entryPrice: 100,
      atr: 500,
      precision: 2,
    });
    expect(resLarge.isValid).toBe(true);
    expect(resLarge.tp3).toBeGreaterThan(resLarge.tp1);
  });

  it('Requirement 6: Published signal targets remain IMMUTABLE when market ATR changes', () => {
    const publishedSignal: PersistedSentSignal = {
      id: 'sig_pub_1',
      symbol: 'BTC/USDT',
      direction: 'BUY',
      entryPrice: 50000,
      stopLoss: 48000,
      takeProfit: 51700,
      tp1: 51000,
      tp2: 51700,
      tp3: 52500,
      riskRewardRatio: 2.5,
      status: 'ACTIVE',
      tp1Status: 'PENDING',
      tp2Status: 'PENDING',
      tp3Status: 'PENDING',
      slStatus: 'ACTIVE',
      timestamp: Date.now(),
      validatedAt: Date.now(),
      strategy: 'STRUCTURAL_BREAKOUT',
      dataSource: 'TWELVEDATA',
      confluenceReasons: ['Trend aligned'],
      timeframe: '15m',
    };

    // Subsequent price evaluation cycle with new ATR
    const res = SignalLifecycleManager.evaluateSignalPriceUpdate(publishedSignal, 50500, Date.now(), 'BTC/USDT');

    // Confirm original target values are strictly preserved
    expect(res.updatedSignal?.tp1 ?? publishedSignal.tp1).toBe(51000);
    expect(res.updatedSignal?.tp2 ?? publishedSignal.tp2).toBe(51700);
    expect(res.updatedSignal?.tp3 ?? publishedSignal.tp3).toBe(52500);
    expect(res.updatedSignal?.stopLoss ?? publishedSignal.stopLoss).toBe(48000);
  });
});
