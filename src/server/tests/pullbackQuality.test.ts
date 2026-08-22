/**
 * Gate 14: Pullback Quality Engine Test Suite
 * 
 * Tests:
 * 1. High-Quality Bullish Pullback (Ideal ~50% depth, low volume, EMA bounce, RSI reset, structure preserved)
 * 2. Acceptable Pullback (Standard shallow/moderate retracement)
 * 3. Deep Pullback (78.6%+ retracement near swing origin)
 * 4. Structural Break (> 100% retracement violating swing origin)
 * 5. Possible Reversal (Aggressive counter-trend volume breaking major EMAs)
 * 6. High-Quality Bearish Counter-Rally
 * 7. Interface Contract & Property Verification
 */

import { Gate14PullbackQuality, Gate14PullbackResult } from '../signals/Gate14PullbackQuality.js';
import { NormalizedCandle } from '../../types/index.js';

export async function runPullbackQualityTestSuite() {
  console.log('========================================================================');
  console.log('STARTING GATE 14: PULLBACK QUALITY ENGINE TESTS');
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
      symbol: 'ETHUSDT',
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
  // TEST 1: High-Quality Bullish Pullback (Golden Zone 50%, Low Volume)
  // -------------------------------------------------------------------------
  console.log('--- TEST 1: High-Quality Bullish Pullback ---');
  {
    const candles: NormalizedCandle[] = [];
    let idx = 0;

    // 1. Initial base at price 100
    for (let i = 0; i < 10; i++) {
      candles.push(buildCandle(idx++, 100, 101, 99.5, 100.2, 1000));
    }

    // 2. Strong Bullish Impulse: 100 -> 140 (high volume 3000)
    for (let i = 1; i <= 10; i++) {
      const p = 100 + i * 4;
      candles.push(buildCandle(idx++, p - 4, p + 0.5, p - 4.2, p, 3000));
    }
    // Peak high at 140.5

    // 3. Orderly, controlled pullback: 140 -> 120 (50% Fib retracement, low volume 800)
    for (let i = 1; i <= 6; i++) {
      const p = 140 - i * 3.33;
      candles.push(buildCandle(idx++, p + 3.33, p + 3.5, p - 0.5, p, 800));
    }

    // 4. Stabilizing bounce candle at 120.5
    candles.push(buildCandle(idx++, 120, 122, 119.8, 121.5, 1200));

    const res1 = Gate14PullbackQuality.analyze(candles, 'BUY');

    assert(
      res1.pullbackQuality === 'HIGH_QUALITY_PULLBACK' || res1.pullbackQuality === 'ACCEPTABLE_PULLBACK',
      'Classifies controlled 50% retrace with low volume as HIGH_QUALITY or ACCEPTABLE',
      `quality=${res1.pullbackQuality}, score=${res1.pullbackScore}`
    );
    assert(
      res1.structurePreserved === true,
      'Confirms market structure preserved (higher low maintained)',
      `preserved=${res1.structurePreserved}`
    );
    assert(
      res1.reversalRisk === 'LOW',
      'Assesses reversal risk as LOW',
      `risk=${res1.reversalRisk}`
    );
    assert(
      res1.pullbackDepth >= 40 && res1.pullbackDepth <= 65,
      'Calculates accurate Fibonacci retracement depth in 40-65% zone',
      `depth=${res1.pullbackDepth}%`
    );
    assert(
      res1.pullbackScore >= 75,
      'High quality pullback achieves strong score >= 75',
      `score=${res1.pullbackScore}`
    );
  }

  // -------------------------------------------------------------------------
  // TEST 2: Structural Break (> 100% Retracement Violating Origin)
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 2: Structural Breakdown (> 100% Retracement) ---');
  {
    const candles: NormalizedCandle[] = [];
    let idx = 0;

    // 1. Base at 100 (15 candles)
    for (let i = 0; i < 15; i++) {
      candles.push(buildCandle(idx++, 100, 101, 99.8, 100.2, 1000));
    }

    // 2. Impulse 100 -> 130 (10 candles)
    for (let i = 1; i <= 10; i++) {
      const p = 100 + i * 3.0;
      candles.push(buildCandle(idx++, p - 3.0, p + 0.5, p - 3.1, p, 2000));
    }

    // 3. Catastrophic dump: 130 -> 95 (Breaches swing low origin 100!)
    for (let i = 1; i <= 10; i++) {
      const p = 130 - i * 3.5;
      candles.push(buildCandle(idx++, p + 3.5, p + 3.6, p - 0.5, p, 3500));
    }

    const res2 = Gate14PullbackQuality.analyze(candles, 'BUY');

    assert(
      res2.pullbackQuality === 'STRUCTURAL_BREAK',
      'Identifies breakdown below impulse origin as STRUCTURAL_BREAK',
      `quality=${res2.pullbackQuality}, score=${res2.pullbackScore}`
    );
    assert(
      res2.structurePreserved === false,
      'Flags structurePreserved = false',
      `preserved=${res2.structurePreserved}`
    );
    assert(
      res2.reversalRisk === 'EXTREME',
      'Flags reversalRisk = EXTREME on structural break',
      `risk=${res2.reversalRisk}`
    );
    assert(
      res2.pullbackScore <= 30,
      'Penalizes structural breakdown with low score <= 30',
      `score=${res2.pullbackScore}`
    );
  }

  // -------------------------------------------------------------------------
  // TEST 3: Deep Retracement (78.6% - 90%)
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 3: Deep Retracement ---');
  {
    const candles: NormalizedCandle[] = [];
    let idx = 0;

    for (let i = 0; i < 15; i++) {
      candles.push(buildCandle(idx++, 100, 101, 99.8, 100.2, 1000));
    }

    // Impulse 100 -> 140
    for (let i = 1; i <= 10; i++) {
      const p = 100 + i * 4.0;
      candles.push(buildCandle(idx++, p - 4.0, p + 0.5, p - 4.1, p, 2000));
    }

    // Deep retracement back down to 106 (~85% retracement)
    for (let i = 1; i <= 10; i++) {
      const p = 140 - i * 3.4;
      candles.push(buildCandle(idx++, p + 3.4, p + 3.5, p - 0.5, p, 1100));
    }

    const res3 = Gate14PullbackQuality.analyze(candles, 'BUY');

    assert(
      res3.pullbackQuality === 'DEEP_PULLBACK' || res3.pullbackQuality === 'POSSIBLE_REVERSAL',
      'Categorizes 85% retracement as DEEP_PULLBACK or POSSIBLE_REVERSAL',
      `quality=${res3.pullbackQuality}, depth=${res3.pullbackDepth}%`
    );
    assert(
      res3.reversalRisk === 'MODERATE' || res3.reversalRisk === 'HIGH',
      'Assesses elevated reversal risk for deep pullback',
      `risk=${res3.reversalRisk}`
    );
  }

  // -------------------------------------------------------------------------
  // TEST 4: Bearish Trend Pullback (Healthy Bearish Rally into Resistance)
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 4: Bearish Trend Counter-Rally ---');
  {
    const candles: NormalizedCandle[] = [];
    let idx = 0;

    // Top at 150 (15 candles)
    for (let i = 0; i < 15; i++) {
      candles.push(buildCandle(idx++, 150, 151, 149.5, 150.2, 1000));
    }

    // Bearish impulse dump: 150 -> 100 (high volume 3000)
    for (let i = 1; i <= 10; i++) {
      const p = 150 - i * 5.0;
      candles.push(buildCandle(idx++, p + 5.0, p + 5.1, p - 0.5, p, 3000));
    }

    // Gentle counter-rally into 125 (50% retrace, low volume 800)
    for (let i = 1; i <= 8; i++) {
      const p = 100 + i * 3.125;
      candles.push(buildCandle(idx++, p - 3.125, p + 0.5, p - 3.2, p, 800));
    }


    const res4 = Gate14PullbackQuality.analyze(candles, 'SELL');

    assert(
      res4.trendDirection === 'BEARISH',
      'Identifies BEARISH trend direction',
      `dir=${res4.trendDirection}`
    );
    assert(
      res4.structurePreserved === true,
      'Confirms bearish lower-high structure preserved',
      `preserved=${res4.structurePreserved}`
    );
    assert(
      res4.pullbackQuality === 'HIGH_QUALITY_PULLBACK' || res4.pullbackQuality === 'ACCEPTABLE_PULLBACK',
      'Classifies low-volume bearish counter-rally as healthy short setup',
      `quality=${res4.pullbackQuality}, score=${res4.pullbackScore}`
    );
  }

  // -------------------------------------------------------------------------
  // TEST 5: Interface Contract & Schema Verification
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 5: Interface Contract & Schema Verification ---');
  {
    const sampleCandles: NormalizedCandle[] = [];
    for (let i = 0; i < 30; i++) {
      sampleCandles.push(buildCandle(i, 100 + i, 101 + i, 99 + i, 100.5 + i, 1000));
    }

    const res5: Gate14PullbackResult = Gate14PullbackQuality.analyze(sampleCandles);

    assert('pullbackQuality' in res5, 'Exposes result.pullbackQuality');
    assert('pullbackScore' in res5, 'Exposes result.pullbackScore');
    assert('pullbackDepth' in res5, 'Exposes result.pullbackDepth');
    assert('structurePreserved' in res5, 'Exposes result.structurePreserved');
    assert('reversalRisk' in res5, 'Exposes result.reversalRisk');
    assert('trendDirection' in res5, 'Exposes result.trendDirection');
    assert('metrics' in res5, 'Exposes result.metrics');
    assert(Array.isArray(res5.reasons), 'Exposes result.reasons array');
    assert(typeof res5.summary === 'string', 'Exposes result.summary string');
  }

  console.log('\n========================================================================');
  console.log(`GATE 14 PULLBACK QUALITY SUITE COMPLETE: ${passedCount} PASSED, ${failedCount} FAILED`);
  console.log('========================================================================\n');

  if (failedCount > 0) {
    throw new Error(`Gate 14 Pullback Quality test suite failed with ${failedCount} errors.`);
  }
}

import { describe, it } from "vitest";
describe("pullbackQuality.test.ts", () => {
  it("runs successfully", async () => {
    await runPullbackQualityTestSuite();
  });
});
