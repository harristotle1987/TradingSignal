import assert from 'assert';
import { Gate0DataValidator } from '../signals/Gate0DataValidator.js';
import { SignalValidator, ValidationContext } from '../signals/SignalValidator.js';
import { NormalizedCandle, NormalizedTicker } from '../../types/index.js';

console.log('========================================================================');
console.log('STARTING GATE 1: MARKET & ENTRY VALIDATION TESTS');
console.log('========================================================================');

// Helper to generate 30 valid 1H candles
function generateMockCandles(basePrice = 100, count = 30, now = Date.now()): NormalizedCandle[] {
  const candles: NormalizedCandle[] = [];
  const intervalMs = 3600000;
  for (let i = 0; i < count; i++) {
    const timestamp = now - (count - i) * intervalMs;
    const open = basePrice + (i % 2 === 0 ? 0.2 : -0.2);
    const high = open + 1.5;
    const low = open - 1.5;
    const close = open + (i % 2 === 0 ? 0.5 : -0.5);
    candles.push({
      symbol: 'BTCUSDT',
      timeframe: '1h',
      open,
      high,
      low,
      close,
      volume: 1000 + i * 10,
      timestamp,
      provider: 'bitget',
    });
  }
  return candles;
}

function createTicker(price: number, timestamp: number, isFresh = true, status: NormalizedTicker['status'] = 'OK'): NormalizedTicker {
  return {
    symbol: 'BTCUSDT',
    rawSymbol: 'BTCUSDT',
    price,
    bid: price - 0.1,
    ask: price + 0.1,
    timestamp,
    receivedAt: timestamp,
    provider: 'bitget',
    assetType: 'CRYPTO',
    source: 'LIVE',
    status,
    isFresh,
  };
}

// --- TEST 1: Fresh Market Data Requirement & Stale Rejection ---
console.log('\n--- TEST 1: Fresh Market Data Requirement & Stale Rejection ---');
{
  const now = Date.now();
  const candles = generateMockCandles(100, 30, now);
  const livePrice = candles[candles.length - 1].close;

  // Stale Ticker (> 120s old)
  const staleTicker = createTicker(livePrice, now - 150000, false, 'STALE');

  const gate0Result = Gate0DataValidator.validate({
    symbol: 'BTCUSDT',
    timeframe: '1h',
    liveTicker: staleTicker,
    candles,
    simulatedTimeMs: now,
  });

  assert.strictEqual(gate0Result.dataStatus, 'STALE', 'Rejects stale market ticker (>120s age)');
  assert.ok(gate0Result.reasons[0].includes('stale'), 'Reason explicitly mentions stale market ticker');

  console.log(`[PASS] Stale market ticker rejected (Status=${gate0Result.dataStatus}, Reason="${gate0Result.reasons[0]}")`);
}

// --- TEST 2: Entry Price Drift & Tolerance Enforcement ---
console.log('\n--- TEST 2: Entry Price Drift & Tolerance Enforcement ---');
{
  const now = Date.now();
  const candles = generateMockCandles(100, 30, now);
  const livePrice = 100.0;
  const validTicker = createTicker(livePrice, now - 5000, true, 'OK');

  // Stale entry price drifted beyond 0.15% (e.g. entry 98.0 vs live 100.0 -> 2.0% drift)
  const staleContext: ValidationContext = {
    symbol: 'BTCUSDT',
    direction: 'BUY',
    entryPrice: 98.0, // Stale cached price
    stopLoss: 95.0,
    takeProfit: 106.0,
    riskRewardRatio: 2.0,
    score: 85,
    candlesMap: { '1h': candles },
    liveTicker: validTicker,
    simulatedTimeMs: now,
  };

  const valResult = SignalValidator.validate(staleContext);

  assert.strictEqual(valResult.isValid, false, 'Rejects stale entry price drifted beyond 0.15% tolerance');
  assert.strictEqual(valResult.validationReason, 'INVALID_ENTRY', 'Reason is INVALID_ENTRY');

  console.log(`[PASS] Stale entry price rejected (Reason=${valResult.validationReason}, Msg="${valResult.detailedMessage}")`);
}

// --- TEST 3: Strict SL/TP Geometry & Impossible-Price Checks ---
console.log('\n--- TEST 3: Strict SL/TP Geometry & Impossible-Price Checks ---');
{
  const now = Date.now();
  const candles = generateMockCandles(100, 30, now);
  const livePrice = 100.0;
  const validTicker = createTicker(livePrice, now - 5000, true, 'OK');

  // Invalid BUY Geometry (SL > Entry)
  const invalidBuyContext: ValidationContext = {
    symbol: 'BTCUSDT',
    direction: 'BUY',
    entryPrice: 100.0,
    stopLoss: 102.0, // Impossible SL for BUY
    takeProfit: 108.0,
    riskRewardRatio: 2.0,
    score: 85,
    candlesMap: { '1h': candles },
    liveTicker: validTicker,
    simulatedTimeMs: now,
  };

  const valResult = SignalValidator.validate(invalidBuyContext);

  assert.strictEqual(valResult.isValid, false, 'Rejects impossible BUY geometry (SL > Entry)');
  assert.strictEqual(valResult.validationReason, 'INVALID_SL_TP', 'Reason is INVALID_SL_TP');

  console.log(`[PASS] Impossible SL/TP price geometry strictly rejected (Reason=${valResult.validationReason}, Msg="${valResult.detailedMessage}")`);
}

// --- TEST 4: Valid Fresh Market & Entry Signal Validation ---
console.log('\n--- TEST 4: Valid Fresh Market & Entry Signal Validation ---');
{
  const now = Date.now();
  const candles = generateMockCandles(100, 30, now);
  const livePrice = 100.0;
  const validTicker = createTicker(livePrice, now - 3000, true, 'OK');

  // Valid BUY Signal
  const validContext: ValidationContext = {
    symbol: 'BTCUSDT',
    direction: 'BUY',
    entryPrice: 100.0,
    stopLoss: 97.0, // 3.0 ATR space
    takeProfit: 107.0, // 7.0 ATR space
    riskRewardRatio: 2.33,
    score: 88,
    candlesMap: { '1h': candles },
    liveTicker: validTicker,
    simulatedTimeMs: now,
  };

  const valResult = SignalValidator.validate(validContext);

  assert.strictEqual(valResult.isValid, true, 'Validates fresh, verified market data and accurate entry');
  assert.strictEqual(valResult.validationReason, 'VALID', 'Reason is VALID');
  assert.strictEqual(valResult.adjustedEntryPrice, 100.0, 'Entry matches latest live price');

  console.log(`[PASS] Fresh market data & accurate entry validated (Status=${valResult.validationReason}, Entry=${valResult.adjustedEntryPrice})`);
}

console.log('\n========================================================================');
console.log('GATE 1 MARKET & ENTRY VALIDATION SUITE COMPLETE: ALL TESTS PASSED');
console.log('========================================================================\n');
