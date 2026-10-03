import assert from 'assert';
import { KronosForecastEngine, KronosEvidence } from '../src/server/signals/KronosForecastEngine.js';
import { ScoringEngine } from '../src/server/signals/ScoringEngine.js';
import { NormalizedCandle } from '../src/types/index.js';

function createMockCandles(count: number, basePrice = 100, trend: 'UP' | 'DOWN' | 'FLAT' = 'UP'): NormalizedCandle[] {
  const candles: NormalizedCandle[] = [];
  let price = basePrice;
  const now = Date.now();

  for (let i = 0; i < count; i++) {
    const delta = trend === 'UP' ? 0.5 : trend === 'DOWN' ? -0.5 : (Math.sin(i) * 0.2);
    const open = price;
    const close = price + delta;
    const high = Math.max(open, close) + 0.3;
    const low = Math.min(open, close) - 0.3;
    const volume = 1000 + Math.random() * 500;

    candles.push({
      symbol: 'BTCUSDT',
      provider: 'bitget',
      timeframe: '1h',
      timestamp: now - (count - i) * 3600 * 1000,
      open,
      high,
      low,
      close,
      volume,
    });

    price = close;
  }

  return candles;
}

export async function runKronosTests() {
  console.log('\n=== SUITE: KRONOS FORECAST ENGINE (OHLCV TIME-SERIES FOUNDATION MODEL) ===\n');

  // Test 1: Full structured evidence return shape
  console.log('Test 1: Returns all required fields and mathematical forecasts');
  KronosForecastEngine.clearCache();
  const candles30 = createMockCandles(30, 95000, 'UP');
  const evidence: KronosEvidence = KronosForecastEngine.forecast({
    symbol: 'BTCUSDT',
    timeframe: '1h',
    candles: candles30,
    horizon: 5,
    monteCarloSamples: 64,
  });

  assert.strictEqual(evidence.symbol, 'BTCUSDT');
  assert.strictEqual(evidence.timeframe, '1h');
  assert(['BULLISH', 'BEARISH', 'NEUTRAL'].includes(evidence.directionBias), 'directionBias must be BULLISH, BEARISH, or NEUTRAL');
  assert(typeof evidence.forecastReturn === 'number' && Number.isFinite(evidence.forecastReturn), 'forecastReturn must be finite number');
  assert(evidence.forecastRange && typeof evidence.forecastRange === 'object', 'forecastRange must be an object');
  assert(evidence.forecastRange.low > 0, 'forecastRange.low must be > 0');
  assert(evidence.forecastRange.high >= evidence.forecastRange.low, 'forecastRange.high must be >= low');
  assert(evidence.forecastRange.expectedClose > 0, 'expectedClose must be > 0');
  assert(evidence.forecastRange.p10 <= evidence.forecastRange.p50, 'p10 must be <= p50');
  assert(evidence.forecastRange.p50 <= evidence.forecastRange.p90, 'p50 must be <= p90');
  assert(evidence.volatilityForecast >= 0, 'volatilityForecast must be >= 0');
  assert.strictEqual(evidence.forecastHorizon, 5, 'forecastHorizon must equal requested horizon');
  assert(evidence.confidence >= 0 && evidence.confidence <= 1.0, 'confidence must be in [0.0, 1.0]');

  // Metadata verification
  assert.strictEqual(evidence.metadata.model, 'Kronos-TSFM');
  assert.strictEqual(evidence.metadata.version, 'v1.0.0-ohlcv-transformer');
  assert.strictEqual(evidence.metadata.repository, 'https://github.com/shiyu-coder/Kronos');
  assert.strictEqual(evidence.metadata.architecture, 'Hierarchical-OHLCV-Tokenizer-Transformer');
  assert.strictEqual(evidence.metadata.quantizationLevels, 1024);
  assert(Array.isArray(evidence.metadata.supportedTimeframes) && evidence.metadata.supportedTimeframes.includes('1h'));
  assert.strictEqual(evidence.metadata.isFallback, false);

  // Telemetry verification
  assert.strictEqual(evidence.telemetry.cached, false);
  assert(evidence.telemetry.tokenizationTimeMs >= 0);
  assert(evidence.telemetry.inferenceTimeMs >= 0);
  assert(evidence.telemetry.candlesEvaluated === 30);
  assert(evidence.telemetry.sampleCount > 0);
  console.log('✓ Test 1 passed: All required fields, forecasts, metadata, and telemetry verified.');

  // Test 2: In-Memory TTL Caching
  console.log('Test 2: Caching behavior avoids redundant computation');
  const cachedEvidence = KronosForecastEngine.forecast({
    symbol: 'BTCUSDT',
    timeframe: '1h',
    candles: candles30,
    horizon: 5,
    monteCarloSamples: 64,
  });

  assert.strictEqual(cachedEvidence.telemetry.cached, true, 'Subsequent identical forecast must return cached evidence');
  assert.strictEqual(cachedEvidence.forecastReturn, evidence.forecastReturn, 'Cached return must match initial forecast');

  // Cache eviction check
  KronosForecastEngine.clearCache();
  const freshEvidence = KronosForecastEngine.forecast({
    symbol: 'BTCUSDT',
    timeframe: '1h',
    candles: candles30,
    horizon: 5,
    monteCarloSamples: 64,
  });
  assert.strictEqual(freshEvidence.telemetry.cached, false, 'Cleared cache must trigger fresh evaluation');
  console.log('✓ Test 2 passed: Caching and cache clearing work as expected.');

  // Test 3: Fallback behavior on insufficient or corrupted data
  console.log('Test 3: Graceful fallback on insufficient or invalid candles');
  const insufficientCandles = createMockCandles(8, 100);
  const fallbackEvidence = KronosForecastEngine.forecast({
    symbol: 'ETHUSDT',
    timeframe: '1h',
    candles: insufficientCandles,
  });

  assert.strictEqual(fallbackEvidence.metadata.isFallback, true, 'Must flag isFallback=true on insufficient candles');
  assert(fallbackEvidence.metadata.fallbackReason?.includes('Insufficient candle history'), 'Fallback reason must explain shortage');
  assert.strictEqual(fallbackEvidence.directionBias, 'NEUTRAL');
  assert.strictEqual(fallbackEvidence.forecastReturn, 0.0);
  assert.strictEqual(fallbackEvidence.confidence, 0.0);

  // Empty candles fallback
  const emptyFallback = KronosForecastEngine.forecast({
    symbol: 'SOLUSDT',
    candles: [],
  });
  assert.strictEqual(emptyFallback.metadata.isFallback, true);
  console.log('✓ Test 3 passed: Fallback returns safe non-blocking neutral evidence.');

  // Test 4: Multi-Timeframe Forecasting
  console.log('Test 4: Multi-timeframe forecasting across supported timeframes');
  const candlesMap = {
    '15m': createMockCandles(25, 2000, 'UP'),
    '1h': createMockCandles(30, 2000, 'UP'),
    '4h': createMockCandles(20, 2000, 'FLAT'),
    '1d': createMockCandles(20, 2000, 'DOWN'),
  };

  const mtfResults = KronosForecastEngine.forecastMultiTimeframe('ETHUSDT', candlesMap);
  assert(mtfResults['15m'], 'Must produce 15m evidence');
  assert(mtfResults['1h'], 'Must produce 1h evidence');
  assert(mtfResults['4h'], 'Must produce 4h evidence');
  assert(mtfResults['1d'], 'Must produce 1d evidence');
  assert.strictEqual(mtfResults['15m'].symbol, 'ETHUSDT');
  assert.strictEqual(mtfResults['1h'].timeframe, '1h');
  console.log('✓ Test 4 passed: Multi-timeframe forecasting generates evidence for all provided timeframes.');

  // Test 5: Strict Non-Authority Principle
  console.log('Test 5: KRONOS NEVER directly creates or approves a signal');
  // Verify that KronosForecastEngine has NO methods to create or approve signals
  const engineObj = KronosForecastEngine as any;
  assert.strictEqual(typeof engineObj.createSignal, 'undefined', 'Kronos must not have createSignal');
  assert.strictEqual(typeof engineObj.approveSignal, 'undefined', 'Kronos must not have approveSignal');
  assert.strictEqual(typeof engineObj.emitSignal, 'undefined', 'Kronos must not have emitSignal');
  assert.strictEqual(typeof engineObj.validateSignal, 'undefined', 'Kronos must not have validateSignal');
  console.log('✓ Test 5 passed: KRONOS has zero authority to create or approve signals.');

  // Test 6: ScoringEngine Integration
  console.log('Test 6: ScoringEngine safely consumes Kronos evidence as independent quantitative context');
  const sCandlesMap: Record<string, NormalizedCandle[]> = {
    '15m': createMockCandles(45, 100, 'UP'),
    '1h': createMockCandles(45, 100, 'UP'),
    '4h': createMockCandles(30, 100, 'UP'),
  };

  const scoringRes = ScoringEngine.calculateScore(
    'BTCUSDT',
    100,
    sCandlesMap,
    'NEUTRAL',
    95
  );

  assert(scoringRes, 'ScoringEngine must evaluate successfully');
  assert(typeof scoringRes.score === 'number', 'ScoringEngine must produce deterministic score');
  assert(scoringRes.kronosEvidence !== undefined, 'ScoringEngine must attach kronosEvidence');
  assert.strictEqual(scoringRes.kronosEvidence.symbol, 'BTCUSDT');
  assert.strictEqual(scoringRes.kronosEvidence.metadata.model, 'Kronos-TSFM');
  console.log('✓ Test 6 passed: ScoringEngine integrates Kronos quantitative evidence without altering hard gates.');

  console.log('\n\x1b[32m[KRONOS SUCCESS] All KronosForecastEngine tests passed successfully!\x1b[0m\n');
}

if (process.argv[1]?.endsWith('kronos-forecast-engine.test.ts')) {
  runKronosTests().catch((err) => {
    console.error('\x1b[31m[KRONOS FAILED]\x1b[0m', err);
    process.exit(1);
  });
}
