/**
 * FREQTRADE DYNAMIC EXIT ENGINE TEST SUITE
 *
 * Verifies dynamic stoploss, minimal ROI table, trailing stop exits,
 * and adaptive SL/TP generation according to volatility and holding time.
 */

import { FreqtradeExitEngine } from '../src/server/signals/FreqtradeExitEngine.js';

async function runFreqtradeExitEngineTests() {
  console.log('=== SUITE: FREQTRADE DYNAMIC EXIT ENGINE ===');

  // Test 1: Evaluates dynamic exit for profitable trade and respects ROI threshold
  const input1 = {
    symbol: 'BTCUSDT',
    direction: 'BUY' as const,
    entryPrice: 50000,
    currentPrice: 52200, // +4.4% profit
    stopLoss: 49000,
    takeProfit: 52500,
    holdingTimeMinutes: 10,
    atr: 500,
  };

  const result1 = FreqtradeExitEngine.evaluateExit(input1);
  if (!result1.roiExitTriggered) {
    throw new Error(`Test 1 Failed: Expected ROI exit to trigger for +4.4% profit at 10m holding time.`);
  }
  console.log(`✓ Test 1 passed: ROI exit triggered successfully (${result1.details.currentProfitPct}% >= ${result1.details.minimalRoiThresholdPct}%).`);

  // Test 2: Trailing stop activates once trailingOffset (1.5%) is achieved
  const input2 = {
    symbol: 'EURUSD',
    direction: 'BUY' as const,
    entryPrice: 1.0800,
    currentPrice: 1.0980, // +1.66% profit (exceeds 1.5% offset)
    stopLoss: 1.0720,
    takeProfit: 1.1000,
    holdingTimeMinutes: 25,
    highestProfitPct: 0.0166,
    atr: 0.0040,
  };

  const result2 = FreqtradeExitEngine.evaluateExit(input2);
  if (!result2.trailingStopActive || !result2.trailingStopPrice) {
    throw new Error(`Test 2 Failed: Trailing stop should be active once 1.5% offset is reached.`);
  }
  if (result2.recommendedStopLoss <= input2.stopLoss) {
    throw new Error(`Test 2 Failed: Recommended stop loss (${result2.recommendedStopLoss}) should be tighter than initial SL (${input2.stopLoss}).`);
  }
  console.log(`✓ Test 2 passed: Dynamic trailing stop activated at ${result2.trailingStopPrice.toFixed(4)}.`);

  // Test 3: Structural safety constraint never widens initial risk
  const input3 = {
    symbol: 'ETHUSDT',
    direction: 'SELL' as const,
    entryPrice: 3000,
    currentPrice: 3050, // Losing position
    stopLoss: 3060,
    takeProfit: 2900,
    atr: 35,
  };

  const result3 = FreqtradeExitEngine.evaluateExit(input3);
  if (result3.recommendedStopLoss > input3.stopLoss) {
    throw new Error(`Test 3 Failed: Dynamic exit must NEVER widen stop loss beyond initial structural SL (${input3.stopLoss}).`);
  }
  console.log(`✓ Test 3 passed: Structural stop loss safety bounds strictly preserved.`);

  // Test 4: Calculate adaptive SL/TP levels
  const adaptiveLevels = FreqtradeExitEngine.calculateAdaptiveLevels({
    entryPrice: 100,
    direction: 'BUY',
    atr: 2.0,
    adx: 38,
    baseSl: 97,
    baseTp1: 103,
    baseTp2: 105,
    baseTp3: 108,
  });

  if (adaptiveLevels.adaptiveSl < 97) {
    throw new Error(`Test 4 Failed: Adaptive SL (${adaptiveLevels.adaptiveSl}) widened initial risk.`);
  }
  if (adaptiveLevels.adaptiveTp1 <= 100 || adaptiveLevels.adaptiveTp2 <= adaptiveLevels.adaptiveTp1) {
    throw new Error(`Test 4 Failed: Adaptive TP levels geometry invalid.`);
  }
  console.log(`✓ Test 4 passed: Adaptive SL/TP levels generated accurately (SL: ${adaptiveLevels.adaptiveSl}, TP1: ${adaptiveLevels.adaptiveTp1}, TP2: ${adaptiveLevels.adaptiveTp2}).`);

  console.log(' \x1b[32m[FREQTRADE EXIT SUCCESS] All FreqtradeExitEngine tests passed successfully!\x1b[0m\n');
}

if (process.argv[1].endsWith('freqtrade-exit-engine.test.ts')) {
  runFreqtradeExitEngineTests().catch((err) => {
    console.error('FreqtradeExitEngine test failed:', err);
    process.exit(1);
  });
}

export { runFreqtradeExitEngineTests };
