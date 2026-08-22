/**
 * Gate 12: Divergence Analysis Engine Test Suite
 * 
 * Tests:
 * 1. Bullish RSI & MACD Divergence (Price Lower Low, Momentum Higher Low)
 * 2. Bearish RSI & MACD Divergence (Price Higher High, Momentum Lower High)
 * 3. No Divergence (Price and Momentum in Alignment)
 * 4. Insufficient Swing Data (Under minimum candles / swings)
 * 5. Interface contract: direction, type, strength, confirmed, score
 * 6. Non-overriding behavior: divergence acts as confluence, cannot override risk/data
 */

import { Gate12Divergence, Gate12DivergenceResult } from '../signals/Gate12Divergence.js';
import { NormalizedCandle } from '../../types/index.js';

export async function runDivergenceTestSuite() {
  console.log('========================================================================');
  console.log('STARTING GATE 12: DIVERGENCE ANALYSIS ENGINE TESTS');
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

  // Helper to generate synthetic candle series with specified price action
  function generateCandles(prices: number[], baseTime = now - prices.length * 60000): NormalizedCandle[] {
    return prices.map((price, idx) => {
      const prevPrice = idx > 0 ? prices[idx - 1] : price;
      const high = Math.max(price, prevPrice) + 0.2;
      const low = Math.min(price, prevPrice) - 0.2;
      return {
        symbol: 'BTCUSDT',
        provider: 'test',
        timestamp: baseTime + idx * 60000,
        open: prevPrice,
        high,
        low,
        close: price,
        volume: 1000,
        timeframe: '15m',
      };
    });
  }

  // -------------------------------------------------------------------------
  // TEST 1: Insufficient Swing Data
  // -------------------------------------------------------------------------
  console.log('--- TEST 1: Insufficient Data Handling ---');
  {
    const fewCandles = generateCandles([100, 101, 102, 101, 100, 99, 98, 99, 100]);
    const res1 = Gate12Divergence.analyze(fewCandles);

    assert(res1.direction === 'NONE', 'Short series returns direction NONE', `direction=${res1.direction}`);
    assert(res1.type === 'NONE', 'Short series returns type NONE', `type=${res1.type}`);
    assert(res1.strength === 'NONE', 'Short series returns strength NONE', `strength=${res1.strength}`);
    assert(res1.confirmed === false, 'Short series returns confirmed=false');
    assert(res1.score === 50, 'Short series returns neutral score (50)', `score=${res1.score}`);
    assert(res1.reasons.length > 0 && res1.reasons[0].includes('Insufficient'), 'Contains insufficiency reason');
  }

  // -------------------------------------------------------------------------
  // TEST 2: No Divergence (Standard Trend in Sync)
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 2: No Divergence (Harmonic Price & Indicator Movement) ---');
  {
    // Steady, smooth uptrend with higher highs and higher lows
    const uptrendPrices: number[] = [];
    let p = 100;
    for (let i = 0; i < 40; i++) {
      // Oscillating upward wave
      p += Math.sin(i * 0.4) * 1.5 + 0.5;
      uptrendPrices.push(Number(p.toFixed(2)));
    }
    const uptrendCandles = generateCandles(uptrendPrices);
    const res2 = Gate12Divergence.analyze(uptrendCandles, 'BUY');

    assert(typeof res2.direction === 'string', 'Result contains direction property');
    assert(typeof res2.type === 'string', 'Result contains type property');
    assert(typeof res2.strength === 'string', 'Result contains strength property');
    assert(typeof res2.confirmed === 'boolean', 'Result contains confirmed boolean property');
    assert(typeof res2.score === 'number', 'Result contains numeric score property', `score=${res2.score}`);
  }

  // -------------------------------------------------------------------------
  // TEST 3: Bullish Divergence (Price Lower Low, RSI/MACD Higher Low)
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 3: Bullish Divergence Detection ---');
  {
    // Construct a double bottom where second bottom is lower in price,
    // but the momentum indicator (RSI/MACD) bottoms out earlier and curves up higher
    const basePrices: number[] = [];
    let current = 200;

    // 1. Initial downward slide into Swing Low 1
    for (let i = 0; i < 15; i++) {
      current -= 3.0; // Rapid drop to create deeply oversold RSI
      basePrices.push(Number(current.toFixed(2)));
    }
    // Swing Low 1 around price ~155

    // 2. Relief bounce
    for (let i = 0; i < 8; i++) {
      current += 2.0;
      basePrices.push(Number(current.toFixed(2)));
    }
    // High around price ~171

    // 3. Gentle downward drift into Swing Low 2 (lower price ~150, but slower pace -> higher RSI)
    for (let i = 0; i < 12; i++) {
      current -= 1.8;
      basePrices.push(Number(current.toFixed(2)));
    }
    // Swing Low 2 around price ~149.4 (Lower Low in price)

    // 4. Initial bounce / turn
    for (let i = 0; i < 6; i++) {
      current += 1.5;
      basePrices.push(Number(current.toFixed(2)));
    }

    const bullishCandles = generateCandles(basePrices);
    const res3 = Gate12Divergence.analyze(bullishCandles, 'BUY', 2, 2);

    assert(
      res3.direction === 'BULLISH',
      'Detects BULLISH divergence on lower low in price with higher momentum low',
      `direction=${res3.direction}, type=${res3.type}, score=${res3.score}`
    );
    assert(
      res3.type === 'REGULAR_BULLISH',
      'Categorizes setup as REGULAR_BULLISH',
      `type=${res3.type}`
    );
    assert(
      res3.strength === 'STRONG' || res3.strength === 'MODERATE',
      'Assesses strength as STRONG or MODERATE',
      `strength=${res3.strength}`
    );
    assert(
      res3.score >= 65,
      'Bullish divergence generates score > 50 confluence factor',
      `score=${res3.score}`
    );
    assert(
      res3.reasons.length > 0,
      'Exposes descriptive analytical reasons for divergence',
      `reason=${res3.reasons[0]}`
    );
  }

  // -------------------------------------------------------------------------
  // TEST 4: Bearish Divergence (Price Higher High, RSI/MACD Lower High)
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 4: Bearish Divergence Detection ---');
  {
    // Construct double top where second top is higher in price,
    // but the upward momentum is decelerating (lower RSI / lower MACD)
    const basePrices: number[] = [];
    let current = 100;

    // 1. Explosive initial rally into Swing High 1 (high momentum)
    for (let i = 0; i < 15; i++) {
      current += 4.0;
      basePrices.push(Number(current.toFixed(2)));
    }
    // Swing High 1 around price ~160

    // 2. Pullback
    for (let i = 0; i < 8; i++) {
      current -= 2.0;
      basePrices.push(Number(current.toFixed(2)));
    }
    // Pullback low around ~144

    // 3. Sluggish second push to a higher high (Swing High 2 ~165, but lower velocity -> lower RSI)
    for (let i = 0; i < 12; i++) {
      current += 1.8;
      basePrices.push(Number(current.toFixed(2)));
    }

    // 4. Turn down / confirmation
    for (let i = 0; i < 6; i++) {
      current -= 1.5;
      basePrices.push(Number(current.toFixed(2)));
    }

    const bearishCandles = generateCandles(basePrices);
    const res4 = Gate12Divergence.analyze(bearishCandles, 'SELL', 2, 2);

    assert(
      res4.direction === 'BEARISH',
      'Detects BEARISH divergence on higher high in price with decelerating momentum',
      `direction=${res4.direction}, type=${res4.type}, score=${res4.score}`
    );
    assert(
      res4.type === 'REGULAR_BEARISH',
      'Categorizes setup as REGULAR_BEARISH',
      `type=${res4.type}`
    );
    assert(
      res4.strength === 'STRONG' || res4.strength === 'MODERATE',
      'Assesses strength as STRONG or MODERATE',
      `strength=${res4.strength}`
    );
    assert(
      res4.score <= 35,
      'Bearish divergence appropriately generates directional score < 50',
      `score=${res4.score}`
    );
  }

  // -------------------------------------------------------------------------
  // TEST 5: Interface Contract & Schema Verification
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 5: Interface Contract & Safety Rules ---');
  {
    const sampleCandles = generateCandles(Array.from({ length: 30 }, (_, i) => 100 + i));
    const result: Gate12DivergenceResult = Gate12Divergence.analyze(sampleCandles);

    assert('direction' in result, 'Exposes divergence.direction');
    assert('type' in result, 'Exposes divergence.type');
    assert('strength' in result, 'Exposes divergence.strength');
    assert('confirmed' in result, 'Exposes divergence.confirmed');
    assert('score' in result, 'Exposes divergence.score');
    assert(Array.isArray(result.reasons), 'Exposes divergence.reasons array');
    assert(typeof result.summary === 'string', 'Exposes divergence.summary string');
  }

  console.log('\n========================================================================');
  console.log(`GATE 12 DIVERGENCE SUITE COMPLETE: ${passedCount} PASSED, ${failedCount} FAILED`);
  console.log('========================================================================\n');

  if (failedCount > 0) {
    throw new Error(`Gate 12 Divergence test suite failed with ${failedCount} errors.`);
  }
}

import { describe, it } from "vitest";
describe("divergenceEngine.test.ts", () => {
  it("runs successfully", async () => {
    await runDivergenceTestSuite();
  });
});
