import assert from 'assert';
import { Gate19RegimePerformanceMatrix, DetailedTradeRecord } from '../signals/Gate19RegimePerformanceMatrix.js';

import { describe, it } from "vitest";
describe("regimePerformanceMatrix.test.ts", () => {
  it("runs the test suite", async () => {
    
    console.log('========================================================================');
    console.log('STARTING GATE 19: REGIME-SPECIFIC PERFORMANCE ANALYTICS TESTS');
    console.log('========================================================================');
    
    // Reset matrix state for clean test run
    Gate19RegimePerformanceMatrix.clear();
    
    // --- TEST 1: Tiny Sample Size Protection (< 10 trades) ---
    console.log('\n--- TEST 1: Tiny Sample Size Protection (< 10 trades) ---');
    {
      for (let i = 0; i < 5; i++) {
        const trade: DetailedTradeRecord = {
          tradeId: `test_tiny_${i}`,
          strategy: 'TREND_PULLBACK',
          asset: 'BTCUSDT',
          assetClass: 'CRYPTO',
          marketRegime: 'BULL',
          timeframe: '1h',
          session: 'GLOBAL',
          signalScore: 85,
          result: i < 4 ? 'TP_HIT' : 'SL_HIT',
          rMultiple: i < 4 ? 2.0 : -1.0,
          mae: 0.3,
          mfe: 2.1,
          timestamp: Date.now() - i * 3600000,
        };
        Gate19RegimePerformanceMatrix.recordTrade(trade);
      }
    
      const stats = Gate19RegimePerformanceMatrix.getRegimeStrategyPerformance('TREND_PULLBACK', 'BULL');
    
      assert.strictEqual(stats.sampleSize, 5, 'Recorded exactly 5 trades');
      assert.strictEqual(stats.confidenceLevel, 'INSUFFICIENT_SAMPLE', 'Sample of 5 trades classified as INSUFFICIENT_SAMPLE');
      assert.strictEqual(stats.performanceModifier, 0, 'Zero performance modifier applied for tiny sample (<10 trades)');
    
      console.log(`[PASS] Sample of 5 trades correctly protected from live weight modification (Confidence: ${stats.confidenceLevel}, Modifier: ${stats.performanceModifier})`);
    }
    
    // --- TEST 2: Statistically Significant Sample Aggregation ---
    console.log('\n--- TEST 2: Statistically Significant Sample Aggregation ---');
    {
      // Add 45 more trades for BREAKOUT x BREAKOUT regime (total 50 trades: 35 wins @ +2.0R, 15 losses @ -1.0R)
      for (let i = 0; i < 50; i++) {
        const isWin = i % 10 < 7; // 70% win rate
        const trade: DetailedTradeRecord = {
          tradeId: `test_sig_${i}`,
          strategy: 'BREAKOUT',
          asset: 'NVDA',
          assetClass: 'STOCKS',
          marketRegime: 'BREAKOUT',
          timeframe: '15m',
          session: 'NEW_YORK',
          signalScore: 88,
          result: isWin ? 'TP_HIT' : 'SL_HIT',
          rMultiple: isWin ? 2.0 : -1.0,
          mae: isWin ? 0.2 : 0.9,
          mfe: isWin ? 2.2 : 0.4,
          timestamp: Date.now() - i * 1800000,
        };
        Gate19RegimePerformanceMatrix.recordTrade(trade);
      }
    
      const stats = Gate19RegimePerformanceMatrix.getRegimeStrategyPerformance('BREAKOUT', 'BREAKOUT');
    
      assert.strictEqual(stats.sampleSize, 50, 'Sample size equals 50 trades');
      assert.strictEqual(stats.confidenceLevel, 'STATISTICALLY_SIGNIFICANT', 'Classified as STATISTICALLY_SIGNIFICANT');
      assert.strictEqual(stats.winRate, 70.0, 'Win rate calculated accurately (70.0%)');
      assert.ok(stats.expectancy > 0.8, `Positive expectancy calculated (>0.8 R), got: ${stats.expectancy}`);
      assert.ok(stats.profitFactor > 2.0, `Profit factor calculated (>2.0), got: ${stats.profitFactor}`);
      assert.ok(stats.performanceModifier > 0, `Positive statistical modifier applied (+${stats.performanceModifier}pts) for high-performing significant sample`);
    
      console.log(`[PASS] Significant sample (50 trades) calculated: Win Rate=${stats.winRate}%, Expectancy=${stats.expectancy}R, PF=${stats.profitFactor}, Modifier=+${stats.performanceModifier}`);
    }
    
    // --- TEST 3: MAE & MFE Excursion Metrics ---
    console.log('\n--- TEST 3: MAE & MFE Excursion Metrics ---');
    {
      const stats = Gate19RegimePerformanceMatrix.getRegimeStrategyPerformance('BREAKOUT', 'BREAKOUT');
    
      assert.ok(typeof stats.maeAvg === 'number' && stats.maeAvg > 0, 'MAE average computed');
      assert.ok(typeof stats.mfeAvg === 'number' && stats.mfeAvg > 0, 'MFE average computed');
    
      console.log(`[PASS] Excursion metrics calculated: MAE Avg = ${stats.maeAvg}R, MFE Avg = ${stats.mfeAvg}R`);
    }
    
    // --- TEST 4: Full STRATEGY × REGIME Performance Matrix ---
    console.log('\n--- TEST 4: Full STRATEGY × REGIME Performance Matrix ---');
    {
      const fullMatrix = Gate19RegimePerformanceMatrix.getPerformanceMatrix();
    
      assert.ok(fullMatrix.matrix['TREND_PULLBACK']['BULL'], 'Matrix contains TREND_PULLBACK x BULL cell');
      assert.ok(fullMatrix.matrix['BREAKOUT']['BREAKOUT'], 'Matrix contains BREAKOUT x BREAKOUT cell');
      assert.strictEqual(fullMatrix.totalTrades, 55, 'Total trades across matrix equals 55');
    
      console.log(`[PASS] Full STRATEGY × REGIME Matrix constructed (${fullMatrix.totalTrades} total trade records)`);
    }
    
    // --- TEST 5: Interface Contract & Schema Verification ---
    console.log('\n--- TEST 5: Interface Contract & Schema Verification ---');
    {
      const cell = Gate19RegimePerformanceMatrix.getRegimeStrategyPerformance('RANGE_REVERSAL', 'RANGE');
    
      assert.ok(typeof cell.sampleSize === 'number', 'Exposes cell.sampleSize');
      assert.ok(typeof cell.winRate === 'number', 'Exposes cell.winRate');
      assert.ok(typeof cell.averageR === 'number', 'Exposes cell.averageR');
      assert.ok(typeof cell.expectancy === 'number', 'Exposes cell.expectancy');
      assert.ok(typeof cell.profitFactor === 'number', 'Exposes cell.profitFactor');
      assert.ok(typeof cell.maxDrawdown === 'number', 'Exposes cell.maxDrawdown');
      assert.ok(typeof cell.confidenceLevel === 'string', 'Exposes cell.confidenceLevel');
    
      console.log('[PASS] Exposes cell.sampleSize');
      console.log('[PASS] Exposes cell.winRate');
      console.log('[PASS] Exposes cell.averageR');
      console.log('[PASS] Exposes cell.expectancy');
      console.log('[PASS] Exposes cell.profitFactor');
      console.log('[PASS] Exposes cell.maxDrawdown');
      console.log('[PASS] Exposes cell.confidenceLevel');
    }
    
    console.log('\n========================================================================');
    console.log('GATE 19 REGIME PERFORMANCE ANALYTICS SUITE COMPLETE: ALL TESTS PASSED');
    console.log('========================================================================\n');
    
  });
});
