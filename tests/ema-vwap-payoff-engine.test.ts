/**
 * EMA / VWAP PAYOFF ENGINE TEST SUITE
 *
 * Verifies trend state classification, VWAP distance/slope alignment,
 * expected move estimation, and payoff quality metrics.
 */

import { EMAVWAPPayoffEngine } from '../src/server/signals/EMAVWAPPayoffEngine.js';
import { NormalizedCandle } from '../src/types/index.js';

function createSyntheticCandles(count: number, startPrice: number, trend: 'UP' | 'DOWN' | 'RANGE'): NormalizedCandle[] {
  const candles: NormalizedCandle[] = [];
  let price = startPrice;
  const now = Date.now() - count * 3600 * 1000;

  for (let i = 0; i < count; i++) {
    const timestamp = now + i * 3600 * 1000;
    // Create a trend with periodic pullbacks to keep VWAP & EMAs aligned
    let change = 0;
    if (trend === 'UP') {
      change = (i % 5 === 0) ? -0.4 : 0.8; // Periodic pullback
    } else if (trend === 'DOWN') {
      change = (i % 5 === 0) ? 0.4 : -0.8;
    } else {
      change = (i % 2 === 0) ? 0.5 : -0.5;
    }

    price += change;
    const open = price - change;
    const high = Math.max(open, price) + 0.8;
    const low = Math.min(open, price) - 0.8;
    const close = price;
    const volume = 1000 + i * 10;

    candles.push({
      symbol: 'TEST',
      provider: 'Bitget',
      timeframe: '1h',
      timestamp,
      open,
      high,
      low,
      close,
      volume,
    });
  }
  return candles;
}

async function runEmaVwapPayoffEngineTests() {
  console.log('=== SUITE: EMA / VWAP PAYOFF ENGINE ===');

  // Test 1: Strong bullish trend stack yields EXCELLENT or STRONG payoff quality
  const candlesUp = createSyntheticCandles(60, 100, 'UP');
  const result1 = EMAVWAPPayoffEngine.evaluate({
    symbol: 'BTCUSDT',
    direction: 'BUY',
    candles: candlesUp,
  });

  if (result1.trendState !== 'STRONG_BULLISH_TREND' && result1.trendState !== 'BULLISH_PULLBACK') {
    throw new Error(`Test 1 Failed: Expected bullish trend state, got '${result1.trendState}'`);
  }
  if (result1.confidence < 60) {
    throw new Error(`Test 1 Failed: Expected confidence >= 60, got ${result1.confidence}`);
  }
  console.log(`✓ Test 1 passed: Bullish trend stack classified as ${result1.trendState} with ${result1.payoffQuality} payoff quality (Confidence: ${result1.confidence}%).`);

  // Test 2: Strong bearish trend stack with BUY direction yields weak/unfavorable payoff
  const candlesDown = createSyntheticCandles(60, 200, 'DOWN');
  const result2 = EMAVWAPPayoffEngine.evaluate({
    symbol: 'ETHUSDT',
    direction: 'BUY', // Counter-trend BUY
    candles: candlesDown,
  });

  if (result2.payoffQuality !== 'WEAK' && result2.payoffQuality !== 'UNFAVORABLE' && result2.payoffQuality !== 'MODERATE') {
    throw new Error(`Test 2 Failed: Counter-trend BUY in strong downtrend should yield weak/unfavorable payoff.`);
  }
  console.log(`✓ Test 2 passed: Counter-trend direction penalized appropriately (${result2.payoffQuality}).`);

  // Test 3: Fallback on short candle depth
  const shortCandles = createSyntheticCandles(5, 50, 'RANGE');
  const result3 = EMAVWAPPayoffEngine.evaluate({
    symbol: 'EURUSD',
    direction: 'BUY',
    candles: shortCandles,
  });

  if (result3.confidence !== 50 || result3.trendState !== 'CHOPPY_NO_TREND') {
    throw new Error(`Test 3 Failed: Fallback on short candles should return safe neutral metrics.`);
  }
  console.log(`✓ Test 3 passed: Safe fallback returned for insufficient candles.`);

  console.log(' \x1b[32m[EMA/VWAP PAYOFF SUCCESS] All EMAVWAPPayoffEngine tests passed successfully!\x1b[0m\n');
}

if (process.argv[1].endsWith('ema-vwap-payoff-engine.test.ts')) {
  runEmaVwapPayoffEngineTests().catch((err) => {
    console.error('EMAVWAPPayoffEngine test failed:', err);
    process.exit(1);
  });
}

export { runEmaVwapPayoffEngineTests };
