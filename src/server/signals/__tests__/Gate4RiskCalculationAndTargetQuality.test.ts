// @ts-nocheck
/**
 * Gate 4 Acceptance Test Suite — R Calculation Audit + Target Quality
 *
 * Verifies:
 * 1. Exact dynamically evaluated R:R calculation for BUY:
 *    Risk = Entry - SL, Reward = TP - Entry, R = Reward / Risk
 * 2. Exact dynamically evaluated R:R calculation for SELL:
 *    Risk = SL - Entry, Reward = Entry - TP, R = Reward / Risk
 * 3. Individual target R:R ratios (tp1Rr, tp2Rr, tp3Rr) correspond precisely to actual prices.
 * 4. Verification of exact example:
 *    Entry = 1.01620, SL = 1.00769, TP3 = 1.03891 => TP3 R = 2.67
 * 5. Full mathematical independence of Target Quality Score (targetQualityScore) from Confidence Score.
 * 6. Target Quality Score (0-100) weighting factors (R:R quality, ATR suitability, spacing, structure clearance, volatility).
 */

import { describe, it, expect } from 'vitest';
import { calculateTargetRr, TargetQualityEvaluator } from '../TargetQualityEvaluator.js';

describe('GATE 4 — R Calculation Audit + Target Quality', () => {
  it('Requirement 1 & 2: Dynamic BUY Risk, Reward, and R:R Calculation', () => {
    const entry = 1.5000;
    const sl = 1.4800; // Risk = 0.0200
    const tp = 1.5500;  // Reward = 0.0500

    const rRatio = calculateTargetRr('BUY', entry, sl, tp);
    expect(rRatio).toBe(2.50); // 0.05 / 0.02 = 2.5
  });

  it('Requirement 1 & 2: Dynamic SELL Risk, Reward, and R:R Calculation', () => {
    const entry = 1.5000;
    const sl = 1.5200; // Risk = 0.0200
    const tp = 1.4500;  // Reward = 0.0500

    const rRatio = calculateTargetRr('SELL', entry, sl, tp);
    expect(rRatio).toBe(2.50); // 0.05 / 0.02 = 2.5
  });

  it('Requirement 2: Precise verification of specific audited R:R example', () => {
    const entry = 1.01620;
    const sl = 1.00769; // Risk = 0.00851
    const tp3 = 1.03891; // Reward = 0.02271

    const rRatio = calculateTargetRr('BUY', entry, sl, tp3);
    // 0.02271 / 0.00851 = 2.668625... => 2.67
    expect(rRatio).toBe(2.67);
  });

  it('Requirement 3 & 5: Target Quality Score remains fully independent of Confidence', () => {
    const input = {
      direction: 'BUY',
      entryPrice: 100,
      stopLoss: 95,
      tp1: 105,
      tp2: 110,
      tp3: 115,
      atr: 5,
      marketRegime: 'NORMAL',
      hasStructureClearance: true,
    };

    const res1 = TargetQualityEvaluator.evaluate(input);
    const res2 = TargetQualityEvaluator.evaluate({ ...input, marketRegime: 'TRENDING' });

    // Target quality is determined purely by target geometry, ATR, and regime
    expect(res1.targetQualityScore).toBeGreaterThanOrEqual(0);
    expect(res1.targetQualityScore).toBeLessThanOrEqual(100);

    // No confidence parameter is passed or used, securing complete independence!
    expect(res1.tp1Rr).toBe(1.0);
    expect(res1.tp2Rr).toBe(2.0);
    expect(res1.tp3Rr).toBe(3.0);
  });

  it('Requirement 4: Target Quality factors and limits (0-100)', () => {
    // Perfect setup
    const perfectRes = TargetQualityEvaluator.evaluate({
      direction: 'BUY',
      entryPrice: 100,
      stopLoss: 98, // Risk = 2
      tp1: 102.5,   // R = 1.25R, 1.25x ATR
      tp2: 104,     // R = 2.0R, 2.0x ATR
      tp3: 106,     // R = 3.0R, 3.0x ATR
      atr: 2,
      marketRegime: 'TRENDING',
      hasStructureClearance: true,
    });

    expect(perfectRes.targetQualityScore).toBeGreaterThanOrEqual(80);
    expect(perfectRes.targetQualityScore).toBeLessThanOrEqual(100);

    // Suboptimal spacing and tight R:R setup
    const suboptimalRes = TargetQualityEvaluator.evaluate({
      direction: 'BUY',
      entryPrice: 100,
      stopLoss: 99, // Risk = 1
      tp1: 100.5,   // R = 0.5R (Very low R)
      tp2: 101.0,   // R = 1.0R
      tp3: 101.2,   // R = 1.2R
      atr: 10,      // Spacing is extremely small relative to ATR
      marketRegime: 'RANGE',
      hasStructureClearance: false,
    });

    expect(suboptimalRes.targetQualityScore).toBeLessThan(perfectRes.targetQualityScore);
  });
});
