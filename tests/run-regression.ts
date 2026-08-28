import { Gate31NewsRiskClassification, ScheduledNewsEvent } from '../src/server/signals/Gate31NewsRiskClassification.js';
import { HistoricalPerformanceManager } from '../src/server/signals/HistoricalPerformanceManager.js';
import { StrategyPerformanceTracker, TradeOutcomeRecord } from '../src/server/signals/StrategyPerformanceTracker.js';
import { runStagedPipeline } from '../src/server/signals/StagedScannerPipeline.js';
import { CronJobOrgService } from '../src/server/cron/CronJobOrgService.js';
import { marketCache } from '../src/server/market/CacheStore.js';
import { marketDataManager } from '../src/server/market/MarketDataManager.js';
import { BitgetAdapter } from '../src/server/market/adapters/BitgetAdapter.js';
import { TwelveDataAdapter } from '../src/server/market/adapters/TwelveDataAdapter.js';
import { ExchangeRateAdapter } from '../src/server/market/adapters/ExchangeRateAdapter.js';
import { logger } from '../src/server/logger.js';

// Disable default log output during tests to keep output clean
(logger as any).level = 'warn';

let totalTests = 0;
let passedTests = 0;
const failures: string[] = [];

function describe(suiteName: string, fn: () => void | Promise<void>) {
  console.log(`\n\x1b[36m=== SUITE: ${suiteName} ===\x1b[0m`);
  return fn();
}

async function test(name: string, fn: () => void | Promise<void>) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`  \x1b[32m✓ [PASS]\x1b[0m ${name}`);
  } catch (err: any) {
    console.error(`  \x1b[31m✗ [FAIL]\x1b[0m ${name}`);
    console.error(`     Error: ${err?.message || String(err)}`);
    failures.push(`${name}: ${err?.message || String(err)}`);
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

async function runAll() {
  console.log('\x1b[35m================================================================\x1b[0m');
  console.log('\x1b[35m[REGRESSION SUITE] Starting Production Hardening Regression Tests\x1b[0m');
  console.log('\x1b[35m================================================================\x1b[0m');

  // --- SUITE 1: GATE 31 NEWS RISK CLASS RULES ---
  await describe('Gate 31 News Risk Classification & Cross-Pollination Rules', async () => {
    await test('Corporate earnings for AAPL do NOT affect EURUSD or BTCUSDT', () => {
      const appleEvent: ScheduledNewsEvent = {
        id: 'apple_earnings_test',
        title: 'Apple Inc. Q3 Earnings Report',
        category: 'STOCK_EARNINGS',
        impact: 'HIGH',
        scheduledTimeMs: Date.now() + 10000,
        affectedAssets: ['AAPL'],
        affectedAssetClasses: ['STOCKS'],
      };

      const affectsEurUsd = Gate31NewsRiskClassification.isEventRelevantToAsset('EURUSD', appleEvent);
      const affectsBtc = Gate31NewsRiskClassification.isEventRelevantToAsset('BTCUSDT', appleEvent);
      const affectsAapl = Gate31NewsRiskClassification.isEventRelevantToAsset('AAPL', appleEvent);

      assert(!affectsEurUsd, 'Corporate earnings should not affect EURUSD');
      assert(!affectsBtc, 'Corporate earnings should not affect BTCUSDT');
      assert(affectsAapl, 'Corporate earnings should affect AAPL');
    });

    await test('ECB central bank decision does NOT block CRYPTO', () => {
      const ecbEvent: ScheduledNewsEvent = {
        id: 'ecb_test',
        title: 'ECB Monetary Policy Decision',
        category: 'CENTRAL_BANK',
        impact: 'HIGH',
        scheduledTimeMs: Date.now() + 10000,
        affectedCurrencies: ['EUR'],
        affectedAssetClasses: ['FOREX'],
      };

      const affectsBtc = Gate31NewsRiskClassification.isEventRelevantToAsset('BTCUSDT', ecbEvent);
      assert(!affectsBtc, 'ECB rate decision should not affect BTCUSDT');
    });

    await test('Fail-closed fallback is correctly triggered when source is empty and cache is expired', () => {
      // Simulate failed/empty fetch and expired cache
      // We can force this state by resetting lastFetchSuccessful to false and lastFetchTime to 0
      const Gate31Class = Gate31NewsRiskClassification as any;
      Gate31Class.lastFetchSuccessful = false;
      Gate31Class.lastFetchTime = 0;

      const evalResult = Gate31NewsRiskClassification.evaluate('EURUSD');
      assert(evalResult.classification === 'BLOCK', 'Should trigger BLOCK on fail-closed news fallback');
      assert(evalResult.isTradingAllowed === false, 'Trading must be blocked');
      assert(evalResult.minRequiredConfirmationScore === 1000, 'Score requirement must be raised to 1000');
    });
  });

  // --- SUITE 2: ANALYTICS PRODUCTION DATA EXCLUSION ---
  await describe('Analytics Production Data Exclusion', async () => {
    await test('StrategyPerformanceTracker strictly excludes BACKTEST, SIMULATION, and TEST records', async () => {
      // Setup some sample trade records with different provenances
      const liveTrade: TradeOutcomeRecord = {
        signalId: 't_live_01',
        symbol: 'BTCUSDT',
        assetClass: 'CRYPTO',
        direction: 'BUY',
        strategyId: 'strat_01',
        strategyName: 'TrendFollowing',
        marketRegime: 'TRENDING',
        timeframe: '1h',
        timestamp: Date.now(),
        resolvedAt: Date.now() + 3600000,
        durationMs: 3600000,
        entryPrice: 50000,
        stopLoss: 49000,
        takeProfit: 52000,
        plannedRR: 2,
        realizedRR: 2,
        outcomeStatus: 'TP_HIT',
        isWin: true,
        provenance: 'LIVE',
      };

      const testTrade: TradeOutcomeRecord = {
        signalId: 't_test_01',
        symbol: 'BTCUSDT',
        assetClass: 'CRYPTO',
        direction: 'BUY',
        strategyId: 'strat_01',
        strategyName: 'TrendFollowing',
        marketRegime: 'TRENDING',
        timeframe: '1h',
        timestamp: Date.now(),
        resolvedAt: Date.now() + 3600000,
        durationMs: 3600000,
        entryPrice: 50000,
        stopLoss: 49000,
        takeProfit: 52000,
        plannedRR: 2,
        realizedRR: -1,
        outcomeStatus: 'SL_HIT',
        isWin: false,
        provenance: 'TEST',
      };

      const simulationTrade: TradeOutcomeRecord = {
        signalId: 't_sim_01',
        symbol: 'BTCUSDT',
        assetClass: 'CRYPTO',
        direction: 'BUY',
        strategyId: 'strat_01',
        strategyName: 'TrendFollowing',
        marketRegime: 'TRENDING',
        timeframe: '1h',
        timestamp: Date.now(),
        resolvedAt: Date.now() + 3600000,
        durationMs: 3600000,
        entryPrice: 50000,
        stopLoss: 49000,
        takeProfit: 52000,
        plannedRR: 2,
        realizedRR: 2,
        outcomeStatus: 'TP_HIT',
        isWin: true,
        provenance: 'SIMULATION',
      };

      // Mock state on StrategyPerformanceTracker to test rebuildAllMetrics
      const tracker = StrategyPerformanceTracker as any;
      tracker.state = {
        totalSignals: 0,
        totalCompleted: 0,
        wins: 0,
        losses: 0,
        successRate: 0,
        averageProfitPercent: 0,
        profitFactor: 0,
        recentTrades: [liveTrade, testTrade, simulationTrade],
        totalUnderlyingPnLPips: 0,
        grossProfitPips: 0,
        grossLossPips: 0,
        averageDrawdownPct: 0,
        maxDrawdownPct: 0,
      };

      tracker.rebuildAllMetrics();

      // Assertions - check tracker.state.overall summary instead
      const overall = tracker.state.overall;
      assert(overall.totalTrades === 1, `Expected 1 completed trade, got ${overall.totalTrades}`);
      assert(overall.wins === 1, `Expected 1 win (LIVE), got ${overall.wins}`);
      assert(overall.losses === 0, `Expected 0 losses (TEST excluded), got ${overall.losses}`);
      assert(overall.winRatePct === 100, `Expected 100% success rate, got ${overall.winRatePct}`);
    });
  });

  // --- SUITE 3: STAGED SCANNER TIMEOUT Prediction ---
  await describe('Staged Scanner Pipeline Timing & Deadlines', async () => {
    await test('Predictably stops execution when globalScanDeadlineMs is exceeded', async () => {
      // Mock the engine object passed to runStagedPipeline
      const mockEngine = {
        activeSignals: new Map(),
        resolveTargetUniverse: (sym: string, cat?: string) => ({
          assetCategory: 'CRYPTO',
          universe: ['BTCUSDT'],
        }),
        fetchGeneralNews: async () => [],
        evaluateNewsSentiment: () => ({ sentiment: 'NEUTRAL', reason: 'N/A' }),
        verifyCrossSourcePrice: async () => ({ agreementPct: 100 }),
      };

      // Set options with globalScanBudgetMs = 100 to force an immediate timeout/expired deadline
      const result = await runStagedPipeline(
        mockEngine,
        'BTCUSDT',
        'CRYPTO',
        false, // do not persist
        { scanStartedAt: Date.now() - 5000, globalScanBudgetMs: 100 }
      );

      // Verify that scanner exits safely (it returns success: false with NO QUALIFIED TRADE on timeout, which is expected and graceful)
      assert(result !== null && typeof result === 'object', 'Scanner pipeline should return a valid result object');
      assert(result.success === false && result.message === 'NO QUALIFIED TRADE', 'Should gracefully return NO QUALIFIED TRADE when timed out');
    });
  });

  // --- SUITE 4: PRODUCTION HARDENING INTEGRATION & RELIABILITY ---
  await describe('Suite 4: Production Hardening Integration, Deadlines & Reliability Testing', async () => {
    await test('cron status check: CronJobOrgService.getCachedStatus is non-blocking and synchronous', () => {
      const startTime = Date.now();
      const status = CronJobOrgService.getCachedStatus();
      const elapsed = Date.now() - startTime;
      
      assert(elapsed < 10, `getCachedStatus took ${elapsed}ms, must be virtually instantaneous (<10ms)`);
      if (status !== null) {
        assert(typeof status === 'object', 'If not null, cached status must be a valid status object');
      }
    });

    await test('deadline propagation: BitgetAdapter fetchPrice throws TIMEOUT when deadline has passed', async () => {
      const adapter = new BitgetAdapter();
      const expiredDeadline = Date.now() - 500;
      
      let thrown = false;
      try {
        await adapter.fetchPrice('BTCUSDT', expiredDeadline);
      } catch (err: any) {
        thrown = true;
        assert(err.message.includes('TIMEOUT: Global scanner deadline reached'), `Expected timeout error message, got: ${err.message}`);
      }
      assert(thrown, 'Adapter should have immediately aborted and thrown a TIMEOUT error due to expired deadline');
    });

    await test('deadline propagation: TwelveDataAdapter fetchCandles throws TIMEOUT when deadline has passed', async () => {
      const adapter = new TwelveDataAdapter();
      const expiredDeadline = Date.now() - 500;
      
      let thrown = false;
      try {
        await adapter.fetchCandles('EURUSD', '1m', 10, expiredDeadline);
      } catch (err: any) {
        thrown = true;
        assert(err.message.includes('TIMEOUT: Global scanner deadline reached'), `Expected timeout error, got: ${err.message}`);
      }
      assert(thrown, 'Adapter fetchCandles should have aborted immediately due to expired deadline');
    });

    await test('ExchangeRateAdapter fetchPrice throws TIMEOUT when deadline has passed', async () => {
      const adapter = new ExchangeRateAdapter();
      const expiredDeadline = Date.now() - 500;
      
      let thrown = false;
      try {
        await adapter.fetchPrice('EURUSD', expiredDeadline);
      } catch (err: any) {
        thrown = true;
        assert(err.message.includes('TIMEOUT: Global scanner deadline reached'), `Expected timeout error, got: ${err.message}`);
      }
      assert(thrown, 'ExchangeRate fallback adapter should respect and abort on global scan deadline');
    });

    await test('MarketDataManager getPrice respects global scan deadline and aborts early in Queue', async () => {
      const expiredDeadline = Date.now() - 500;
      let thrown = false;
      try {
        await marketDataManager.getPrice('BTCUSDT', undefined, true, 'AUTOMATED_SCANNER', expiredDeadline);
      } catch (err: any) {
        thrown = true;
        assert(err.message.includes('TIMEOUT: Global scanner deadline reached'), `Expected queue timeout error, got: ${err.message}`);
      }
      assert(thrown, 'MarketDataManager should propagate and abort pricing queries on global scan deadline');
    });

    await test('MarketCache cache hits, misses, and expired fallbacks function correctly', () => {
      const sampleTicker = {
        symbol: 'BTCUSDT',
        rawSymbol: 'BTCUSDT',
        provider: 'bitget',
        assetType: 'CRYPTO' as any,
        bid: 60000,
        ask: 60005,
        price: 60002,
        timestamp: Date.now() - 1000,
        receivedAt: Date.now() - 1000,
        source: 'LIVE' as any,
        isFresh: true,
        status: 'OK' as any,
      };

      // Set sample ticker to cache
      marketCache.set('bitget', 'BTCUSDT', sampleTicker, 1000);

      const cachedFresh = marketCache.get('bitget', 'BTCUSDT');
      assert(cachedFresh !== null, 'Should return cached ticker');
      assert(cachedFresh?.price === 60002, 'Cached ticker should have correct price');

      // Test expired fallback retrieval for candles
      const sampleCandles = [{
        symbol: 'BTCUSDT',
        provider: 'bitget',
        timeframe: '1m',
        open: 60000,
        high: 60050,
        low: 59950,
        close: 60020,
        volume: 100,
        timestamp: Date.now() - 120000,
      }];

      marketCache.setCandles('bitget', 'BTCUSDT', '1m', sampleCandles, 10); // set short TTL of 10ms
      
      // Sleep slightly to let the cache expire
      const end = Date.now() + 50;
      while (Date.now() < end) {}

      const expiredCandles = marketCache.getExpiredCandles('bitget', 'BTCUSDT', '1m');
      assert(expiredCandles !== null && expiredCandles.length > 0, 'Should successfully retrieve expired candles as a high-quality fallback');
      assert(expiredCandles?.[0]?.close === 60020, 'Expired fallback candles should preserve data integrity');
    });

    await test('Gate31NewsRiskClassification global failure cooldown immediately protects provider from repeated failures', async () => {
      // Force failure state by passing invalid parameters or empty key
      const originalKey = process.env.TWELVE_DATA_API_KEY;
      process.env.TWELVE_DATA_API_KEY = 'invalid_test_api_key_to_force_failure';

      const Gate31Class = Gate31NewsRiskClassification as any;
      // Clear previous cache & state
      Gate31Class.symbolNewsCache.clear();
      Gate31Class.pendingFetches.clear();
      Gate31Class.lastFailureTime = 0;
      Gate31Class.lastFetchSuccessful = false;

      // First sync call (will hit network and fail because Twelve Data API key is invalid)
      await Gate31NewsRiskClassification.syncVerifiedNews('BTCUSDT');

      assert(Gate31Class.lastFailureTime > 0, 'Failure time must be recorded on fetch failure');
      assert(Gate31Class.lastFetchSuccessful === false, 'Last fetch must be marked unsuccessful');

      // Attempt to sync a different asset (e.g. EURUSD) immediately
      const startSync = Date.now();
      await Gate31NewsRiskClassification.syncVerifiedNews('EURUSD');
      const duration = Date.now() - startSync;

      assert(duration < 50, `Subsequent call took ${duration}ms. Cooldown must immediately bypass network requests and finish instantly`);

      // Restore key
      process.env.TWELVE_DATA_API_KEY = originalKey;
    });
  });

  console.log('\n\x1b[35m================================================================\x1b[0m');
  console.log(`[REGRESSION RESULTS] ${passedTests}/${totalTests} Tests Passed successfully.`);
  if (failures.length > 0) {
    console.error(`\x1b[31m[REGRESSION FAILURE] ${failures.length} failures detected:\x1b[0m`);
    failures.forEach((f) => console.error(`  - ${f}`));
    process.exit(1);
  } else {
    console.log('\x1b[32m[REGRESSION SUCCESS] All production hardening tests passed perfectly!\x1b[0m');
    process.exit(0);
  }
}

runAll().catch((err) => {
  console.error('Fatal error running regression tests:', err);
  process.exit(1);
});
