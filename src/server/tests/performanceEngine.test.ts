/**
 * Performance Intelligence & Walk-Forward Engine Test Suite
 *
 * Verifies backend algorithmic performance tracking, outcome logging, confidence calibration,
 * dynamic strategy weighting, and walk-forward backtest evaluation using production logic.
 */

import { StrategyPerformanceTracker } from '../signals/StrategyPerformanceTracker.js';
import { WalkForwardEngine } from '../signals/WalkForwardEngine.js';
import { SignalLifecycleManager } from '../signals/SignalLifecycleManager.js';
import { ScoringEngine } from '../signals/ScoringEngine.js';
import { NormalizedCandle } from '../../types/index.js';

async function runPerformanceTestSuite() {
  console.log('========================================================================');
  console.log('STARTING BACKEND PERFORMANCE INTELLIGENCE & WALK-FORWARD ENGINE TESTS');
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

  // -------------------------------------------------------------------------
  // TEST 1: Outcome Tracking & Multi-Dimensional Performance Aggregation
  // -------------------------------------------------------------------------
  console.log('--- TEST 1: Multi-Dimensional Trade Outcome & Metrics Aggregation ---');
  StrategyPerformanceTracker.init();

  // Record 10 trade outcomes for strat_1 on BTCUSDT
  for (let i = 0; i < 7; i++) {
    StrategyPerformanceTracker.recordTradeOutcome({
      signalId: `test_win_${i}`,
      symbol: 'BTCUSDT',
      assetClass: 'CRYPTO',
      direction: 'BUY',
      strategyId: 'strat_1',
      strategyName: 'Trend Following',
      marketRegime: 'TRENDING',
      timeframe: '1h',
      confidenceScore: 88,
      confidenceRange: '80-89',
      entryPrice: 65000,
      stopLoss: 64000,
      takeProfit: 67200,
      plannedRR: 2.2,
      outcomeStatus: 'TP_HIT',
      realizedRR: 2.2,
      isWin: true,
      timestamp: Date.now() - 3600000 * (10 - i),
      resolvedAt: Date.now() - 3600000 * (9 - i),
      durationMs: 3600000,
    });
  }

  for (let i = 0; i < 3; i++) {
    StrategyPerformanceTracker.recordTradeOutcome({
      signalId: `test_loss_${i}`,
      symbol: 'BTCUSDT',
      assetClass: 'CRYPTO',
      direction: 'BUY',
      strategyId: 'strat_1',
      strategyName: 'Trend Following',
      marketRegime: 'TRENDING',
      timeframe: '1h',
      confidenceScore: 88,
      confidenceRange: '80-89',
      entryPrice: 65000,
      stopLoss: 64000,
      takeProfit: 67200,
      plannedRR: 2.2,
      outcomeStatus: 'SL_HIT',
      realizedRR: -1.0,
      isWin: false,
      timestamp: Date.now() - 3600000 * (3 - i),
      resolvedAt: Date.now() - 3600000 * (2 - i),
      durationMs: 3600000,
    });
  }

  const perfState = StrategyPerformanceTracker.getPerformanceMetrics();
  assert(
    perfState.overall.totalTrades >= 10,
    'Total trades tracked overall',
    `Total trades recorded: ${perfState.overall.totalTrades}`
  );
  assert(
    perfState.byStrategy['strat_1'] && perfState.byStrategy['strat_1'].totalTrades >= 10,
    'Multi-dimensional tracking by strategy (strat_1)',
    `strat_1 trades: ${perfState.byStrategy['strat_1']?.totalTrades}, WR: ${perfState.byStrategy['strat_1']?.winRatePct}%`
  );
  assert(
    perfState.byAsset['BTCUSDT'] && perfState.byAsset['BTCUSDT'].winRatePct === 70,
    'Multi-dimensional tracking by asset (BTCUSDT)',
    `BTCUSDT win rate: ${perfState.byAsset['BTCUSDT']?.winRatePct}%`
  );
  assert(
    perfState.byRegime['TRENDING'] !== undefined,
    'Multi-dimensional tracking by market regime (TRENDING)',
    `TRENDING trades: ${perfState.byRegime['TRENDING']?.totalTrades}`
  );
  assert(
    perfState.byConfidenceRange['80-89'] !== undefined,
    'Multi-dimensional tracking by confidence range (80-89)',
    `80-89 trades: ${perfState.byConfidenceRange['80-89']?.totalTrades}`
  );
  assert(
    perfState.overall.profitFactor > 1.0,
    'Profit Factor calculation (Gross Win R / Gross Loss R)',
    `Calculated Profit Factor: ${perfState.overall.profitFactor}`
  );
  assert(
    perfState.overall.expectancyR > 0,
    'Expectancy calculation (R per trade)',
    `Calculated Expectancy: ${perfState.overall.expectancyR}R`
  );

  // -------------------------------------------------------------------------
  // TEST 2: Dynamic Strategy Weighting & Confidence Calibration
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 2: Bayesian Strategy Weighting & Confidence Calibration ---');

  const strat1Weight = StrategyPerformanceTracker.getDynamicStrategyWeightMultiplier('strat_1', 'TRENDING');
  assert(
    strat1Weight >= 1.0,
    'Dynamic weight boost for strong strategy (strat_1 with 70% win rate)',
    `strat_1 dynamic weight multiplier: ${strat1Weight}x`
  );

  // Record 8 losses for weak strategy strat_4
  for (let i = 0; i < 8; i++) {
    StrategyPerformanceTracker.recordTradeOutcome({
      signalId: `test_strat4_loss_${i}`,
      symbol: 'EURUSD',
      assetClass: 'FOREX',
      direction: 'BUY',
      strategyId: 'strat_4',
      strategyName: 'RSI Mean Reversion',
      marketRegime: 'RANGING',
      timeframe: '15m',
      confidenceScore: 72,
      confidenceRange: '70-79',
      entryPrice: 1.085,
      stopLoss: 1.082,
      takeProfit: 1.09,
      plannedRR: 1.6,
      outcomeStatus: 'SL_HIT',
      realizedRR: -1.0,
      isWin: false,
      timestamp: Date.now() - 3600000 * (8 - i),
      resolvedAt: Date.now() - 3600000 * (7 - i),
      durationMs: 3600000,
    });
  }

  const strat4Weight = StrategyPerformanceTracker.getDynamicStrategyWeightMultiplier('strat_4', 'RANGING');
  assert(
    strat4Weight < 0.90,
    'Dynamic weight penalty for weak strategy (strat_4 with low win rate)',
    `strat_4 dynamic weight multiplier: ${strat4Weight}x`
  );

  const calibFactorHigh = StrategyPerformanceTracker.getConfidenceCalibrationFactor(88, 'strat_1', 'BTCUSDT');
  assert(
    calibFactorHigh >= 1.0,
    'Confidence calibration factor for high-confidence bucket',
    `Calibration factor: ${calibFactorHigh}x`
  );

  // -------------------------------------------------------------------------
  // TEST 3: Walk-Forward & Backtest Evaluation Engine
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 3: Walk-Forward Evaluation & Bar-by-Bar Backtest Simulation ---');

  // Generate 120 synthetic candles for test
  const synthetic1h: NormalizedCandle[] = [];
  const synthetic15m: NormalizedCandle[] = [];
  let basePrice = 60000;
  const nowTs = Date.now() - 120 * 3600000;

  for (let i = 0; i < 120; i++) {
    const time = nowTs + i * 3600000;
    const change = Math.sin(i / 5) * 300 + (i % 2 === 0 ? 150 : -80);
    const open = basePrice;
    const close = basePrice + change;
    const high = Math.max(open, close) + 100;
    const low = Math.min(open, close) - 100;
    synthetic1h.push({
      symbol: 'BTCUSDT',
      timeframe: '1h',
      timestamp: time,
      open,
      high,
      low,
      close,
      volume: 1200 + i * 10,
      provider: 'test',
    });
    basePrice = close;
  }

  for (let i = 0; i < 480; i++) {
    const time = nowTs + i * 900000;
    const change = Math.sin(i / 10) * 80;
    const open = 60000 + i * 10;
    const close = open + change;
    synthetic15m.push({
      symbol: 'BTCUSDT',
      timeframe: '15m',
      timestamp: time,
      open,
      high: Math.max(open, close) + 30,
      low: Math.min(open, close) - 30,
      close,
      volume: 300,
      provider: 'test',
    });
  }

  const candlesMap = {
    '1h': synthetic1h,
    '15m': synthetic15m,
  };

  const backtestRes = WalkForwardEngine.runBacktest('BTCUSDT', candlesMap, 100);
  assert(
    backtestRes.symbol === 'BTCUSDT' && backtestRes.totalCandlesEvaluated > 0,
    'Bar-by-bar backtest simulation execution',
    `Evaluated candles: ${backtestRes.totalCandlesEvaluated}, trades generated: ${backtestRes.metrics.totalTrades}`
  );

  const wfReport = WalkForwardEngine.runWalkForward('BTCUSDT', candlesMap, 2);
  assert(
    wfReport.symbol === 'BTCUSDT' && wfReport.windows.length === 2,
    'Walk-Forward rolling window evaluation (In-Sample vs Out-of-Sample)',
    `Total windows: ${wfReport.windows.length}, aggregate WFE: ${wfReport.aggregateEfficiencyRatio}`
  );

  // -------------------------------------------------------------------------
  // TEST SUMMARY
  // -------------------------------------------------------------------------
  console.log('\n========================================================================');
  console.log(`TEST SUITE COMPLETED: ${passedCount} PASSED, ${failedCount} FAILED`);
  console.log('========================================================================\n');

  if (failedCount > 0) {
    process.exit(1);
  }
}

runPerformanceTestSuite().catch((err) => {
  console.error('Fatal error running performance test suite:', err);
  process.exit(1);
});
