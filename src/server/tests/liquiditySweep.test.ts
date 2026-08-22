/**
 * Gate 15: False Breakout & Liquidity Sweep Engine Test Suite
 * 
 * Tests:
 * 1. Bearish Liquidity Sweep (Resistance / Swing High sweep with strong upper rejection wick and close inside range)
 * 2. Bullish Liquidity Sweep (Support / Swing Low sweep with strong lower rejection wick and close inside range)
 * 3. Normal Breakout (Clean sustained close beyond level without rejection)
 * 4. Unconfirmed / Neutral (Oscillations without level breach)
 * 5. Interface Contract & Property Verification
 */

import { Gate15LiquiditySweep, Gate15SweepResult } from '../signals/Gate15LiquiditySweep.js';
import { NormalizedCandle } from '../../types/index.js';

export async function runLiquiditySweepTestSuite() {
  console.log('========================================================================');
  console.log('STARTING GATE 15: LIQUIDITY SWEEP & FALSE BREAKOUT TESTS');
  console.log('========================================================================\n');

  let passedCount = 0;
  let failedCount = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`[PASS] ${testName}`);
      if (detail) console.log(`       -> ${detail}`);
      passedCount++;
    } else {
      console.error(`[FAIL] ${testName}`);
      if (detail) console.error(`       -> ${detail}`);
      failedCount++;
    }
  }

  const now = Date.now();

  function buildCandle(
    idx: number,
    open: number,
    high: number,
    low: number,
    close: number,
    volume: number,
    baseTime = now - 100 * 60000
  ): NormalizedCandle {
    return {
      symbol: 'SOLUSDT',
      provider: 'test',
      timestamp: baseTime + idx * 60000,
      open,
      high,
      low,
      close,
      volume,
      timeframe: '15m',
    };
  }

  // -------------------------------------------------------------------------
  // TEST 1: Bearish Liquidity Sweep (Resistance / Swing High Stop Run)
  // -------------------------------------------------------------------------
  console.log('--- TEST 1: Bearish Resistance Sweep ---');
  {
    const candles: NormalizedCandle[] = [];
    let idx = 0;

    // Establish base and a clear swing high pivot at 150.0 (candle index 10)
    for (let i = 0; i < 10; i++) {
      candles.push(buildCandle(idx++, 140, 142, 139, 141, 1000));
    }
    // Swing high bar (high 150.0)
    candles.push(buildCandle(idx++, 145, 150.0, 144, 146, 1500));
    for (let i = 0; i < 15; i++) {
      candles.push(buildCandle(idx++, 142, 145, 140, 143, 1000));
    }

    // Sweep candle: Probes above 150 to 154.0, but gets aggressively dumped, closing at 145 (huge upper wick, vol 3500)
    // Open: 147, High: 154, Low: 144.5, Close: 145 (wick: 7 pts = 73% of 9.5 range)
    candles.push(buildCandle(idx++, 147, 154.0, 144.5, 145.0, 3500));

    const res1 = Gate15LiquiditySweep.analyze(candles, 'SELL');

    assert(
      res1.confirmationStatus === 'CONFIRMED_LIQUIDITY_SWEEP' || res1.confirmationStatus === 'POSSIBLE_SWEEP',
      'Classifies resistance probe with upper rejection wick as LIQUIDITY_SWEEP',
      `status=${res1.confirmationStatus}, score=${res1.sweepScore}`
    );
    assert(
      res1.sweepDirection === 'BEARISH',
      'Identifies BEARISH sweep direction',
      `dir=${res1.sweepDirection}`
    );
    assert(
      res1.sweepStrength === 'STRONG' || res1.sweepStrength === 'MODERATE',
      'Categorizes sweep strength as STRONG or MODERATE',
      `strength=${res1.sweepStrength}`
    );
    assert(
      res1.sweepLevel !== null && res1.sweepLevel >= 148,
      'Captures swept price level near 150.0',
      `level=${res1.sweepLevel}`
    );
    assert(
      res1.metrics.closedInsideRange === true,
      'Confirms candle closed back inside range',
      `closedInside=${res1.metrics.closedInsideRange}`
    );
  }

  // -------------------------------------------------------------------------
  // TEST 2: Bullish Liquidity Sweep (Support / Swing Low Stop Run)
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 2: Bullish Support Sweep ---');
  {
    const candles: NormalizedCandle[] = [];
    let idx = 0;

    for (let i = 0; i < 10; i++) {
      candles.push(buildCandle(idx++, 110, 112, 109, 111, 1000));
    }
    // Swing low bar (low 100.0)
    candles.push(buildCandle(idx++, 105, 107, 100.0, 104, 1500));
    for (let i = 0; i < 15; i++) {
      candles.push(buildCandle(idx++, 106, 108, 104, 106, 1000));
    }

    // Sweep candle: Probes down to 94.0, but gets aggressively bought up to close at 104 (huge lower wick, vol 3500)
    // Open: 103, High: 105, Low: 94.0, Close: 104.0 (lower wick: 9 pts = 81% of 11 range)
    candles.push(buildCandle(idx++, 103, 105.0, 94.0, 104.0, 3500));

    const res2 = Gate15LiquiditySweep.analyze(candles, 'BUY');

    assert(
      res2.confirmationStatus === 'CONFIRMED_LIQUIDITY_SWEEP' || res2.confirmationStatus === 'POSSIBLE_SWEEP',
      'Classifies support probe with lower rejection wick as BULLISH LIQUIDITY_SWEEP',
      `status=${res2.confirmationStatus}, score=${res2.sweepScore}`
    );
    assert(
      res2.sweepDirection === 'BULLISH',
      'Identifies BULLISH sweep direction',
      `dir=${res2.sweepDirection}`
    );
    assert(
      res2.sweepLevel !== null && res2.sweepLevel <= 102,
      'Captures swept support level near 100.0',
      `level=${res2.sweepLevel}`
    );
  }

  // -------------------------------------------------------------------------
  // TEST 3: Normal Breakout (No Sweep / Clean Sustained Break)
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 3: Normal Breakout (Clean Sustained Continuation) ---');
  {
    const candles: NormalizedCandle[] = [];
    let idx = 0;

    for (let i = 0; i < 10; i++) {
      candles.push(buildCandle(idx++, 120, 122, 119, 121, 1000));
    }
    // Swing high at 125
    candles.push(buildCandle(idx++, 122, 125.0, 121, 123, 1200));
    for (let i = 0; i < 15; i++) {
      candles.push(buildCandle(idx++, 121, 123, 120, 122, 1000));
    }

    // Breakout candle: Closes far above 125 at 132 with minimal wick (Open: 124, High: 132.5, Low: 123.8, Close: 132.0)
    candles.push(buildCandle(idx++, 124, 132.5, 123.8, 132.0, 3000));

    const res3 = Gate15LiquiditySweep.analyze(candles);

    assert(
      res3.confirmationStatus === 'NORMAL_BREAKOUT' || res3.confirmationStatus === 'UNCONFIRMED',
      'Does not falsely flag clean sustained breakout as liquidity sweep',
      `status=${res3.confirmationStatus}`
    );
    assert(
      res3.metrics.closedInsideRange === false,
      'Identifies that candle did NOT close inside range',
      `closedInside=${res3.metrics.closedInsideRange}`
    );
  }

  // -------------------------------------------------------------------------
  // TEST 4: Interface Contract & Schema Verification
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 4: Interface Contract & Schema Verification ---');
  {
    const sampleCandles: NormalizedCandle[] = [];
    for (let i = 0; i < 30; i++) {
      sampleCandles.push(buildCandle(i, 100 + i, 101 + i, 99 + i, 100.5 + i, 1000));
    }

    const res4: Gate15SweepResult = Gate15LiquiditySweep.analyze(sampleCandles);

    assert('sweepDirection' in res4, 'Exposes result.sweepDirection');
    assert('sweepLevel' in res4, 'Exposes result.sweepLevel');
    assert('sweepStrength' in res4, 'Exposes result.sweepStrength');
    assert('confirmationStatus' in res4, 'Exposes result.confirmationStatus');
    assert('sweepScore' in res4, 'Exposes result.sweepScore');
    assert('sweepType' in res4, 'Exposes result.sweepType');
    assert('metrics' in res4, 'Exposes result.metrics');
    assert(Array.isArray(res4.reasons), 'Exposes result.reasons array');
    assert(typeof res4.summary === 'string', 'Exposes result.summary string');
  }

  console.log('\n========================================================================');
  console.log(`GATE 15 LIQUIDITY SWEEP SUITE COMPLETE: ${passedCount} PASSED, ${failedCount} FAILED`);
  console.log('========================================================================\n');

  if (failedCount > 0) {
    throw new Error(`Gate 15 Liquidity Sweep test suite failed with ${failedCount} errors.`);
  }
}

import { describe, it } from "vitest";
describe("liquiditySweep.test.ts", () => {
  it("runs successfully", async () => {
    await runLiquiditySweepTestSuite();
  });
});
