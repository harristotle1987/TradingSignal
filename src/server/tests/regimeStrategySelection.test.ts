import assert from 'assert';
import { Gate18RegimeStrategySelection, StrategySelectionInput } from '../signals/Gate18RegimeStrategySelection.js';

console.log('========================================================================');
console.log('STARTING GATE 18: REGIME-SPECIFIC STRATEGY SELECTION TESTS');
console.log('========================================================================');

// --- TEST 1: Bull Trend Strategy Mapping ---
console.log('\n--- TEST 1: Bull Trend Strategy Mapping ---');
{
  const input: StrategySelectionInput = {
    symbol: 'BTCUSDT',
    regime: 'STRONG_BULL_TREND',
    candidateStrategyName: 'Trend Following',
  };

  const res = Gate18RegimeStrategySelection.selectStrategy(input);

  assert.strictEqual(res.selectedStrategy, 'TREND_CONTINUATION', 'Selects TREND_CONTINUATION in strong bull trend');
  assert.ok(res.eligibleStrategies.includes('TREND_CONTINUATION'), 'TREND_CONTINUATION in eligible strategies');
  assert.ok(res.eligibleStrategies.includes('TREND_PULLBACK'), 'TREND_PULLBACK in eligible strategies');
  assert.strictEqual(res.regimeStrategyMatch, 'OPTIMAL', 'Optimal match for trend continuation in strong trend');
  assert.ok(res.strategyCompatibilityScore >= 85, 'Compatibility score >= 85 for optimal strategy');

  console.log(`[PASS] Bull Trend mapped to: ${res.selectedStrategy} (${res.regimeStrategyMatch}, Score: ${res.strategyCompatibilityScore})`);
}

// --- TEST 2: Range Regime Strategy Mapping ---
console.log('\n--- TEST 2: Range Regime Strategy Mapping ---');
{
  const input: StrategySelectionInput = {
    symbol: 'ETHUSDT',
    regime: 'RANGE',
    candidateStrategyName: 'RSI + Bollinger Mean Reversion',
  };

  const res = Gate18RegimeStrategySelection.selectStrategy(input);

  assert.strictEqual(res.selectedStrategy, 'RANGE_REVERSAL', 'Selects RANGE_REVERSAL in ranging market');
  assert.ok(res.eligibleStrategies.includes('RANGE_REVERSAL'), 'RANGE_REVERSAL is eligible');
  assert.ok(res.eligibleStrategies.includes('FALSE_BREAKOUT'), 'FALSE_BREAKOUT is eligible');
  assert.strictEqual(res.regimeStrategyMatch, 'OPTIMAL', 'Optimal match for mean reversion in range');

  console.log(`[PASS] Range Regime mapped to: ${res.selectedStrategy} (${res.regimeStrategyMatch}, Score: ${res.strategyCompatibilityScore})`);
}

// --- TEST 3: Incompatible Strategy Penalty in Range ---
console.log('\n--- TEST 3: Incompatible Strategy Penalty in Range ---');
{
  const input: StrategySelectionInput = {
    symbol: 'SOLUSDT',
    regime: 'RANGE',
    candidateStrategyName: 'Breakout Expansion',
    strategyCategoryHint: 'BREAKOUT',
  };

  const res = Gate18RegimeStrategySelection.selectStrategy(input);

  assert.ok(!res.eligibleStrategies.includes('BREAKOUT'), 'BREAKOUT is not eligible in clean RANGE regime');
  assert.ok(res.strategyCompatibilityScore <= 55, 'Suboptimal / low compatibility score for breakout in range');

  console.log(`[PASS] Incompatible breakout strategy properly deprioritized in RANGE (Score: ${res.strategyCompatibilityScore})`);
}

// --- TEST 4: High Volatility Strategy Selection ---
console.log('\n--- TEST 4: High Volatility Strategy Selection ---');
{
  const input: StrategySelectionInput = {
    symbol: 'NVDA',
    regime: 'HIGH_VOLATILITY',
    candidateStrategyName: 'Intraday Breakout',
  };

  const res = Gate18RegimeStrategySelection.selectStrategy(input);

  assert.strictEqual(res.selectedStrategy, 'BREAKOUT', 'Selects BREAKOUT for HIGH_VOLATILITY regime');
  assert.ok(res.eligibleStrategies.includes('BREAKOUT'), 'BREAKOUT is eligible in high volatility');
  assert.ok(res.eligibleStrategies.includes('FALSE_BREAKOUT'), 'FALSE_BREAKOUT is eligible in high volatility');
  assert.ok(res.eligibleStrategies.includes('MOMENTUM_CONTINUATION'), 'MOMENTUM_CONTINUATION is eligible in high volatility');

  console.log(`[PASS] High Volatility regime selected: ${res.selectedStrategy} (${res.regimeStrategyMatch})`);
}

// --- TEST 5: Bear Trend Pullback Selection ---
console.log('\n--- TEST 5: Bear Trend Pullback Selection ---');
{
  const input: StrategySelectionInput = {
    symbol: 'EURUSD',
    regime: 'STRONG_BEAR_TREND',
    candidateStrategyName: 'Pullback Quality',
  };

  const res = Gate18RegimeStrategySelection.selectStrategy(input);

  assert.strictEqual(res.selectedStrategy, 'TREND_PULLBACK', 'Selects TREND_PULLBACK in bear trend');
  assert.strictEqual(res.regimeStrategyMatch, 'OPTIMAL', 'Optimal match for trend pullback in strong trend');

  console.log(`[PASS] Bear Trend Pullback mapped to: ${res.selectedStrategy} (${res.regimeStrategyMatch})`);
}

// --- TEST 6: Interface Contract & Schema Verification ---
console.log('\n--- TEST 6: Interface Contract & Schema Verification ---');
{
  const input: StrategySelectionInput = {
    symbol: 'SPY',
    regime: 'BREAKOUT',
    candidateStrategyName: 'Breakout',
  };

  const res = Gate18RegimeStrategySelection.selectStrategy(input);

  assert.ok(typeof res.selectedStrategy === 'string', 'Exposes res.selectedStrategy');
  assert.ok(Array.isArray(res.eligibleStrategies), 'Exposes res.eligibleStrategies');
  assert.ok(typeof res.strategyCompatibilityScore === 'number', 'Exposes res.strategyCompatibilityScore');
  assert.ok(typeof res.regimeStrategyMatch === 'string', 'Exposes res.regimeStrategyMatch');
  assert.ok(typeof res.marketRegime === 'string', 'Exposes res.marketRegime');
  assert.ok(Array.isArray(res.reasons), 'Exposes res.reasons');
  assert.ok(typeof res.summary === 'string', 'Exposes res.summary');

  console.log('[PASS] Exposes result.selectedStrategy');
  console.log('[PASS] Exposes result.eligibleStrategies');
  console.log('[PASS] Exposes result.strategyCompatibilityScore');
  console.log('[PASS] Exposes result.regimeStrategyMatch');
  console.log('[PASS] Exposes result.marketRegime');
  console.log('[PASS] Exposes result.reasons');
  console.log('[PASS] Exposes result.summary');
}

console.log('\n========================================================================');
console.log('GATE 18 REGIME STRATEGY SELECTION SUITE COMPLETE: ALL TESTS PASSED');
console.log('========================================================================\n');
