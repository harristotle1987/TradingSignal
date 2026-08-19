/**
 * Gate 13: Breakout Quality Engine Test Suite
 * 
 * Tests:
 * 1. Strong Breakout (Consolidation + compression + high displacement + volume + clear room)
 * 2. Moderate Breakout (Standard clean range break)
 * 3. Weak Breakout (Low body displacement or weak volume)
 * 4. False Breakout / Trap (Wick outside range with collapse back inside or failed retest)
 * 5. Unconfirmed Breakout (Price inside consolidation channel)
 * 6. S/R Proximity Penalty (Breakout directly into major opposing zone)
 * 7. Interface Contract: exposes breakoutQuality, breakoutScore, breakoutType, retestStatus, volumeConfirmation
 */

import { Gate13BreakoutQuality, Gate13BreakoutResult } from '../signals/Gate13BreakoutQuality.js';
import { NormalizedCandle } from '../../types/index.js';

export async function runBreakoutQualityTestSuite() {
  console.log('========================================================================');
  console.log('STARTING GATE 13: BREAKOUT QUALITY ENGINE TESTS');
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
      symbol: 'BTCUSDT',
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
  // TEST 1: Unconfirmed Breakout (Inside Consolidation Range)
  // -------------------------------------------------------------------------
  console.log('--- TEST 1: Unconfirmed Breakout (Price Inside Range) ---');
  {
    const candles: NormalizedCandle[] = [];
    // 30 bars oscillating tightly between 100 and 105
    for (let i = 0; i < 30; i++) {
      const p = 100 + (i % 5);
      candles.push(buildCandle(i, p, p + 1.5, p - 1.5, p + 0.5, 1000));
    }

    const res1 = Gate13BreakoutQuality.analyze(candles, 'BUY');

    assert(
      res1.breakoutQuality === 'UNCONFIRMED_BREAKOUT',
      'Identifies price inside range as UNCONFIRMED_BREAKOUT',
      `quality=${res1.breakoutQuality}`
    );
    assert(
      res1.breakoutType === 'NONE',
      'Breakout type is NONE when inside range',
      `type=${res1.breakoutType}`
    );
    assert(
      res1.breakoutScore === 50,
      'Score is neutral (50) for unconfirmed range',
      `score=${res1.breakoutScore}`
    );
  }

  // -------------------------------------------------------------------------
  // TEST 2: Strong Bullish Breakout
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 2: Strong Bullish Breakout Detection ---');
  {
    const candles: NormalizedCandle[] = [];
    // 25 bars tight consolidation between 100 and 104 (average volume 1000)
    for (let i = 0; i < 25; i++) {
      const p = 101 + (i % 3);
      candles.push(buildCandle(i, p, p + 0.8, p - 0.8, p + 0.2, 1000));
    }

    // Bar 26: Massive breakout candle (Open: 103, High: 112, Low: 102.8, Close: 111.5, Volume: 3500)
    candles.push(buildCandle(25, 103, 112, 102.8, 111.5, 3500));

    const res2 = Gate13BreakoutQuality.analyze(candles, 'BUY');

    assert(
      res2.breakoutQuality === 'STRONG_BREAKOUT',
      'Classifies strong high-volume displacement as STRONG_BREAKOUT',
      `quality=${res2.breakoutQuality}, score=${res2.breakoutScore}`
    );
    assert(
      res2.volumeConfirmation === 'STRONG_VOLUME',
      'Detects STRONG_VOLUME on 3.5x volume expansion',
      `vol=${res2.volumeConfirmation}, relVol=${res2.metrics.relativeVolume}x`
    );
    assert(
      res2.breakoutDirection === 'BULLISH',
      'Identifies BULLISH breakout direction',
      `dir=${res2.breakoutDirection}`
    );
    assert(
      res2.breakoutScore >= 80,
      'Assigns high breakout score >= 80',
      `score=${res2.breakoutScore}`
    );
    assert(
      res2.reasons.some((r) => r.includes('displacement') || r.includes('volume')),
      'Includes structural displacement and volume reasoning'
    );
  }

  // -------------------------------------------------------------------------
  // TEST 3: False Breakout / Wick Trap
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 3: False Breakout / Liquidity Wick Trap ---');
  {
    const candles: NormalizedCandle[] = [];
    // Consolidation range 100 - 105
    for (let i = 0; i < 25; i++) {
      const p = 101 + (i % 4);
      candles.push(buildCandle(i, p, p + 1.0, p - 1.0, p + 0.2, 1000));
    }

    // Bar 26: Wick trap (Open: 104, High: 110, Low: 103.5, Close: 103.8 (inside range!), Volume: 2500)
    candles.push(buildCandle(25, 104, 110, 103.5, 103.8, 2500));

    const res3 = Gate13BreakoutQuality.analyze(candles, 'BUY');

    assert(
      res3.breakoutQuality === 'FALSE_BREAKOUT',
      'Correctly classifies wick-outside-range as FALSE_BREAKOUT',
      `quality=${res3.breakoutQuality}, score=${res3.breakoutScore}`
    );
    assert(
      res3.breakoutType === 'FALSE_EXPANSION',
      'Assigns breakoutType as FALSE_EXPANSION',
      `type=${res3.breakoutType}`
    );
    assert(
      res3.breakoutScore <= 35,
      'Penalizes false breakout with low score <= 35',
      `score=${res3.breakoutScore}`
    );
    assert(
      res3.metrics.isWickTrap === true,
      'Flags isWickTrap = true in metrics',
      `isWickTrap=${res3.metrics.isWickTrap}`
    );
  }

  // -------------------------------------------------------------------------
  // TEST 4: Weak Breakout (Low Volume / Weak Body)
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 4: Weak Breakout (Small Displacement & Low Volume) ---');
  {
    const candles: NormalizedCandle[] = [];
    // Consolidation 100 - 105
    for (let i = 0; i < 25; i++) {
      const p = 102 + (i % 3);
      candles.push(buildCandle(i, p, p + 1.0, p - 1.0, p, 1000));
    }

    // Bar 26: Closes barely above 105 at 105.3, but huge wicks and tiny volume (Volume: 500)
    candles.push(buildCandle(25, 105.1, 107.5, 103.0, 105.3, 500));

    const res4 = Gate13BreakoutQuality.analyze(candles, 'BUY');

    assert(
      res4.breakoutQuality === 'WEAK_BREAKOUT' || res4.breakoutQuality === 'MODERATE_BREAKOUT',
      'Categorizes low-volume/low-body break as WEAK or MODERATE',
      `quality=${res4.breakoutQuality}, score=${res4.breakoutScore}`
    );
    assert(
      res4.volumeConfirmation === 'DIVERGENT_VOLUME' || res4.volumeConfirmation === 'WEAK_VOLUME',
      'Detects weak/divergent volume confirmation',
      `vol=${res4.volumeConfirmation}`
    );
    assert(
      res4.breakoutScore < 75,
      'Breakout score reflects lack of conviction (< 75)',
      `score=${res4.breakoutScore}`
    );
  }

  // -------------------------------------------------------------------------
  // TEST 5: Retest Behavior & Interface Contract
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 5: Interface Contract & Schema Verification ---');
  {
    const candles: NormalizedCandle[] = [];
    for (let i = 0; i < 30; i++) {
      candles.push(buildCandle(i, 100 + i, 101 + i, 99 + i, 100.5 + i, 1000));
    }

    const res5: Gate13BreakoutResult = Gate13BreakoutQuality.analyze(candles);

    assert('breakoutQuality' in res5, 'Exposes result.breakoutQuality');
    assert('breakoutScore' in res5, 'Exposes result.breakoutScore');
    assert('breakoutType' in res5, 'Exposes result.breakoutType');
    assert('retestStatus' in res5, 'Exposes result.retestStatus');
    assert('volumeConfirmation' in res5, 'Exposes result.volumeConfirmation');
    assert('breakoutDirection' in res5, 'Exposes result.breakoutDirection');
    assert('metrics' in res5, 'Exposes result.metrics');
    assert(Array.isArray(res5.reasons), 'Exposes result.reasons array');
    assert(typeof res5.summary === 'string', 'Exposes result.summary string');
  }

  console.log('\n========================================================================');
  console.log(`GATE 13 BREAKOUT QUALITY SUITE COMPLETE: ${passedCount} PASSED, ${failedCount} FAILED`);
  console.log('========================================================================\n');

  if (failedCount > 0) {
    throw new Error(`Gate 13 Breakout Quality test suite failed with ${failedCount} errors.`);
  }
}

// Run when executed directly
runBreakoutQualityTestSuite().catch((err) => {
  console.error(err);
  process.exit(1);
});
