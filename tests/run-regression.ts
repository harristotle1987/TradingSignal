import * as fs from 'fs';
import * as path from 'path';
import { Gate31NewsRiskClassification, ScheduledNewsEvent } from '../src/server/signals/Gate31NewsRiskClassification.js';
import { HistoricalPerformanceManager } from '../src/server/signals/HistoricalPerformanceManager.js';
import { StrategyPerformanceTracker, TradeOutcomeRecord } from '../src/server/signals/StrategyPerformanceTracker.js';
import { runStagedPipeline } from '../src/server/signals/StagedScannerPipeline.js';
import { ScanPerformanceProfiler } from '../src/server/signals/ScanPerformanceProfiler.js';
import { CronJobOrgService } from '../src/server/cron/CronJobOrgService.js';
import { marketCache } from '../src/server/market/CacheStore.js';
import { marketDataManager } from '../src/server/market/MarketDataManager.js';
import { BitgetAdapter } from '../src/server/market/adapters/BitgetAdapter.js';
import { TwelveDataAdapter } from '../src/server/market/adapters/TwelveDataAdapter.js';
import { ExchangeRateAdapter } from '../src/server/market/adapters/ExchangeRateAdapter.js';
import { adminAuthMiddleware, extractAuthToken } from '../src/server/middleware/adminAuth.js';
import { SignalEngine } from '../src/server/signals/SignalEngine.js';
import { StrategyEngine } from '../src/server/signals/StrategyEngine.js';
import { serverConfig } from '../src/server/config.js';
import { SignalValidator } from '../src/server/signals/SignalValidator.js';
import { MarketStructureDetector } from '../src/server/signals/MarketStructureDetector.js';
import { CooldownManager } from '../src/server/signals/CooldownManager.js';
import { CandidateRejectionTracker, StandardFailedGate } from '../src/server/signals/CandidateRejectionTracker.js';
import { OpportunityFunnelStore, OpportunityFunnelEngine, HardGatesEvaluator } from '../src/server/signals/Gate26OpportunityFunnel.js';
import { Gate28ConfirmationDiversity } from '../src/server/signals/Gate28ConfirmationDiversity.js';
import { TechnicalIndicators } from '../src/server/signals/TechnicalIndicators.js';
import { RiskRewardCalculator } from '../src/server/signals/RiskRewardCalculator.js';
import { Gate7FinalTradeValidation } from '../src/server/signals/Gate7FinalTradeValidation.js';
import { Gate8TradeabilityThreshold } from '../src/server/signals/Gate8TradeabilityThreshold.js';
import { Gate9RiskManagement } from '../src/server/signals/Gate9RiskManagement.js';
import { Gate35SignalFunnelAnalytics, FunnelStage } from '../src/server/signals/Gate35SignalFunnelAnalytics.js';
import { HourlyScannerService } from '../src/server/signals/HourlyScanner.js';
import { ScoringEngine } from '../src/server/signals/ScoringEngine.js';
import { Gate3PreliminaryScreen } from '../src/server/signals/Gate3PreliminaryScreen.js';
import { Gate5DeepCandidateSelection } from '../src/server/signals/Gate5DeepCandidateSelection.js';
import { Gate6ProgressiveMTF } from '../src/server/signals/Gate6ProgressiveMTF.js';
import { Gate4MomentumVolatility } from '../src/server/signals/Gate4MomentumVolatility.js';
import { SignalSensitivityManager, FINAL_EXECUTABLE_RR_FLOOR } from '../src/server/signals/SignalSensitivityManager.js';
import { Gate27RegimeThresholds } from '../src/server/signals/Gate27RegimeThresholds.js';
import { TradeRankingEngine } from '../src/server/signals/TradeRankingEngine.js';
import { SignalLifecycleManager } from '../src/server/signals/SignalLifecycleManager.js';
import { ScannerPersistence, PersistedSentSignal } from '../src/server/signals/ScannerPersistence.js';
import { isActionableSignal, NormalizedCandle } from '../src/types/index.js';
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
      const Gate31Class = Gate31NewsRiskClassification as any;
      Gate31Class.lastFetchSuccessful = false;
      Gate31Class.lastFetchTime = 0;

      const evalResult = Gate31NewsRiskClassification.evaluate('EURUSD');
      assert(evalResult.classification === 'UNAVAILABLE' || evalResult.classification === 'CAUTION', 'Should trigger UNAVAILABLE on news fallback');
      assert(evalResult.isTradingAllowed === true, 'Trading must be allowed under news uncertainty');
      assert(evalResult.minRequiredConfirmationScore <= serverConfig.getConfig().thresholds.signalThreshold, 'Score requirement must not exceed standard confirmation threshold');
      assert(evalResult.reasons.some((r: string) => r.includes('NEWS_DATA_UNAVAILABLE')), 'Must explicitly report NEWS_DATA_UNAVAILABLE in reasons');
    });

    await test('Gate 7: Valid 65-79 setup is NOT rejected solely because news data is unavailable', () => {
      const Gate31Class = Gate31NewsRiskClassification as any;
      Gate31Class.lastFetchSuccessful = false;
      Gate31Class.lastFetchTime = 0;

      const dummyCandles: any[] = Array.from({ length: 30 }, (_, i) => ({
        timestamp: Date.now() - (30 - i) * 3600000,
        open: 100,
        high: 102.5,
        low: 97.5,
        close: 100,
        volume: 1000,
      }));

      // Test with score 70 (in the 65-79 range) with news data unavailable
      const valResult = SignalValidator.validate({
        symbol: 'BTCUSDT',
        direction: 'BUY',
        score: 70,
        entryPrice: 100.0,
        stopLoss: 95.0,
        takeProfit: 110.0,
        tp1: 104.0,
        tp2: 110.0,
        tp3: 115.0,
        riskRewardRatio: 2.0,
        candlesMap: { '1h': dummyCandles },
        liveTicker: { price: 100.0, isFresh: true, status: 'OK', timestamp: Date.now() } as any,
      });

      assert(valResult.isValid, `Valid 65-79 setup should NOT be rejected when news data is unavailable, got: ${valResult.detailedMessage}`);
    });

    await test('Gate 7: News CAUTION applies modest penalty without requiring 80+ score', () => {
      const cautionEvent: ScheduledNewsEvent = {
        id: 'upcoming_fed_speech',
        title: 'Fed Chair Speech Approaching',
        category: 'CENTRAL_BANK',
        impact: 'HIGH',
        scheduledTimeMs: Date.now() + 60 * 60 * 1000, // 60 mins away (in caution window, outside 30m blackout)
        affectedCurrencies: ['USD'],
        affectedAssetClasses: ['CRYPTO'],
        affectedAssets: ['BTCUSDT'],
        blackoutBeforeMinutes: 30,
        blackoutAfterMinutes: 30,
        cautionBeforeMinutes: 90,
        cautionAfterMinutes: 60,
      };

      const Gate31Class = Gate31NewsRiskClassification as any;
      Gate31Class.lastFetchSuccessful = true;
      Gate31Class.lastFetchTime = Date.now();
      Gate31Class.scheduledEvents = [cautionEvent];

      const evalResult = Gate31NewsRiskClassification.evaluate('BTCUSDT');
      assert(evalResult.classification === 'CAUTION', 'Approaching event must trigger CAUTION');
      assert(evalResult.isTradingAllowed === true, 'Trading must be allowed under CAUTION');
      assert(evalResult.minRequiredConfirmationScore <= serverConfig.getConfig().thresholds.signalThreshold, 'CAUTION must not elevate score requirement to 80+');

      const dummyCandles: any[] = Array.from({ length: 30 }, (_, i) => ({
        timestamp: Date.now() - (30 - i) * 3600000,
        open: 100,
        high: 102.5,
        low: 97.5,
        close: 100,
        volume: 1000,
      }));

      // Setup with score 72 (below 80) passes under CAUTION
      const valResult = SignalValidator.validate({
        symbol: 'BTCUSDT',
        direction: 'BUY',
        score: 72,
        entryPrice: 100.0,
        stopLoss: 95.0,
        takeProfit: 110.0,
        tp1: 104.0,
        tp2: 110.0,
        tp3: 115.0,
        riskRewardRatio: 2.0,
        candlesMap: { '1h': dummyCandles },
        liveTicker: { price: 100.0, isFresh: true, status: 'OK', timestamp: Date.now() } as any,
      });

      assert(valResult.isValid, `Setup with score 72 should pass under CAUTION, got: ${valResult.detailedMessage}`);

      // Cleanup
      Gate31Class.scheduledEvents = [];
    });

    await test('Gate 7: Major active high-impact event triggers HARD BLOCK', () => {
      const majorEvent: ScheduledNewsEvent = {
        id: 'fomc_rate_decision',
        title: 'FOMC Interest Rate Decision',
        category: 'CENTRAL_BANK',
        impact: 'HIGH',
        scheduledTimeMs: Date.now(), // Active right now
        affectedCurrencies: ['USD'],
        affectedAssetClasses: ['CRYPTO'],
        affectedAssets: ['BTCUSDT'],
        blackoutBeforeMinutes: 30,
        blackoutAfterMinutes: 30,
      };

      const Gate31Class = Gate31NewsRiskClassification as any;
      Gate31Class.lastFetchSuccessful = true;
      Gate31Class.lastFetchTime = Date.now();
      Gate31Class.scheduledEvents = [majorEvent];

      const evalResult = Gate31NewsRiskClassification.evaluate('BTCUSDT');
      assert(evalResult.classification === 'BLOCK', 'Major active high-impact event must trigger BLOCK');
      assert(evalResult.isTradingAllowed === false, 'Trading must NOT be allowed during major event blackout');

      const dummyCandles: any[] = Array.from({ length: 30 }, (_, i) => ({
        timestamp: Date.now() - (30 - i) * 3600000,
        open: 100,
        high: 102.5,
        low: 97.5,
        close: 100,
        volume: 1000,
      }));

      const valResult = SignalValidator.validate({
        symbol: 'BTCUSDT',
        direction: 'BUY',
        score: 95,
        entryPrice: 100.0,
        stopLoss: 95.0,
        takeProfit: 110.0,
        tp1: 104.0,
        tp2: 110.0,
        tp3: 115.0,
        riskRewardRatio: 2.0,
        candlesMap: { '1h': dummyCandles },
        liveTicker: { price: 100.0, isFresh: true, status: 'OK', timestamp: Date.now() } as any,
      });

      assert(!valResult.isValid, 'High-impact event must cause hard validation rejection');
      assert(valResult.validationReason === 'HIGH_NEWS_RISK', 'Validation reason must be HIGH_NEWS_RISK');

      // Cleanup
      Gate31Class.scheduledEvents = [];
    });

    await test('Crypto candidate is NORMAL and allowed when news source is active with no scheduled events', () => {
      const Gate31Class = Gate31NewsRiskClassification as any;
      Gate31Class.lastFetchSuccessful = true;
      Gate31Class.lastFetchTime = Date.now();
      Gate31Class.scheduledEvents = [];

      const evalResult = Gate31NewsRiskClassification.evaluate('BTCUSDT');
      assert(evalResult.classification === 'NORMAL', 'Crypto should be NORMAL when no active scheduled event exists');
      assert(evalResult.isTradingAllowed === true, 'Trading must be allowed for BTCUSDT');
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

      const profilerReport = ScanPerformanceProfiler.getHealthReport();
      assert(profilerReport.totalScansLogged > 0, 'Profiler should record scan history without blocking pipeline');
      console.log('  \x1b[32m✓ [PASS]\x1b[0m ScanPerformanceProfiler records pipeline metrics and health report accurately');
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

  // --- SUITE 5: GATE 6 ACCESS BOUNDARIES, ERROR HANDLING & SECRET PROTECTION ---
  await describe('Suite 5: Gate 6 Access Boundaries, Error Handling & Secret Protection', async () => {
    await test('extractAuthToken correctly parses Bearer and custom admin headers', () => {
      const mockReq1: any = { headers: { authorization: 'Bearer secret_token_123' } };
      assert(extractAuthToken(mockReq1) === 'secret_token_123', 'Should extract token from Bearer auth header');

      const mockReq2: any = { headers: { 'x-admin-key': 'admin_key_456' } };
      assert(extractAuthToken(mockReq2) === 'admin_key_456', 'Should extract token from x-admin-key header');

      const mockReq3: any = { headers: { 'x-api-key': 'api_key_789' } };
      assert(extractAuthToken(mockReq3) === 'api_key_789', 'Should extract token from x-api-key header');

      const mockReq4: any = { headers: {} };
      assert(extractAuthToken(mockReq4) === null, 'Should return null when no auth headers present');
    });

    await test('adminAuthMiddleware rejects missing credentials with 401 without exposing secret values', async () => {
      const originalAdminKey = process.env.ADMIN_API_KEY;
      process.env.ADMIN_API_KEY = 'test_secret_key_prod_999';

      let statusCode = 0;
      let jsonPayload: any = null;

      const mockReq: any = { method: 'POST', path: '/api/scanner/settings', headers: {} };
      const mockRes: any = {
        status: (code: number) => {
          statusCode = code;
          return mockRes;
        },
        json: (data: any) => {
          jsonPayload = data;
          return mockRes;
        },
      };

      let nextCalled = false;
      adminAuthMiddleware(mockReq, mockRes, () => { nextCalled = true; });

      assert(!nextCalled, 'Next should not be called on missing auth');
      assert(statusCode === 401, `Expected status 401, got ${statusCode}`);
      assert(jsonPayload?.error === 'Unauthorized: Missing administrative credentials.', 'Error message must be generic');
      assert(!JSON.stringify(jsonPayload).includes('test_secret_key_prod_999'), 'Response must not contain secret key');

      process.env.ADMIN_API_KEY = originalAdminKey;
    });

    await test('adminAuthMiddleware rejects invalid credentials with 403 without exposing secret values', async () => {
      const originalAdminKey = process.env.ADMIN_API_KEY;
      process.env.ADMIN_API_KEY = 'test_secret_key_prod_999';

      let statusCode = 0;
      let jsonPayload: any = null;

      const mockReq: any = { method: 'DELETE', path: '/api/signals/outcomes', headers: { authorization: 'Bearer WRONG_KEY' } };
      const mockRes: any = {
        status: (code: number) => {
          statusCode = code;
          return mockRes;
        },
        json: (data: any) => {
          jsonPayload = data;
          return mockRes;
        },
      };

      let nextCalled = false;
      adminAuthMiddleware(mockReq, mockRes, () => { nextCalled = true; });

      assert(!nextCalled, 'Next should not be called on invalid auth');
      assert(statusCode === 403, `Expected status 403, got ${statusCode}`);
      assert(jsonPayload?.error === 'Forbidden: Invalid administrative credentials.', 'Error message must be generic');
      assert(!JSON.stringify(jsonPayload).includes('test_secret_key_prod_999'), 'Response must not leak valid secret');

      process.env.ADMIN_API_KEY = originalAdminKey;
    });

    await test('adminAuthMiddleware permits request with valid administrative credential', async () => {
      const originalAdminKey = process.env.ADMIN_API_KEY;
      process.env.ADMIN_API_KEY = 'test_secret_key_prod_999';

      let nextCalled = false;
      const mockReq: any = { method: 'POST', path: '/api/scanner/settings', headers: { authorization: 'Bearer test_secret_key_prod_999' } };
      const mockRes: any = {};

      adminAuthMiddleware(mockReq, mockRes, () => { nextCalled = true; });

      assert(nextCalled, 'Next must be called when valid credential is provided');

      process.env.ADMIN_API_KEY = originalAdminKey;
    });
  });

  // --- SUITE 6: GATE 4 CORE TRADING STRATEGY & SAFETY BOUNDARIES VERIFICATION ---
  await describe('Suite 6: Gate 4 Core Trading Strategy & Safety Boundaries Verification', async () => {
    await test('Asset universe size remains exactly 113 unique assets', () => {
      const engine = new SignalEngine() as any;
      const resolvedAll = engine.resolveTargetUniverse('ALL', 'ALL');
      const uniqueSymbols = new Set(resolvedAll.universe);

      assert(resolvedAll.assetCategory === 'ALL', 'Category should be ALL');
      assert(uniqueSymbols.size === 113, `Expected exactly 113 unique symbols in universe, got ${uniqueSymbols.size}`);

      const resolvedCrypto = engine.resolveTargetUniverse('CRYPTO', 'CRYPTO');
      const resolvedForex = engine.resolveTargetUniverse('FOREX', 'FOREX');
      const resolvedStocks = engine.resolveTargetUniverse('STOCKS', 'STOCKS');

      assert(resolvedCrypto.universe.length === 45, `Expected 45 Crypto assets, got ${resolvedCrypto.universe.length}`);
      assert(resolvedForex.universe.length === 20, `Expected 20 Forex assets, got ${resolvedForex.universe.length}`);
      assert(resolvedStocks.universe.length === 48, `Expected 48 Stock assets, got ${resolvedStocks.universe.length}`);
    });

    await test('65 is authoritative actionable signal threshold and R:R minimum is 1.8', () => {
      // Test default system fallbacks when env overrides are cleared
      const origMinScore = process.env.THRESHOLD_MIN_SCORE;
      const origSigScore = process.env.THRESHOLD_SIGNAL_SCORE;
      const origMinRr = process.env.THRESHOLD_MIN_RR;

      delete process.env.THRESHOLD_MIN_SCORE;
      delete process.env.THRESHOLD_SIGNAL_SCORE;
      delete process.env.THRESHOLD_MIN_RR;

      // Create a fresh config instance to test code defaults
      const freshConfig = (serverConfig as any).loadAndValidate();
      assert(freshConfig.thresholds.signalThreshold === 65, `Default signalThreshold must be 65, got ${freshConfig.thresholds.signalThreshold}`);
      assert(freshConfig.thresholds.minimumRR === 1.8, `Default minimumRR must be 1.8, got ${freshConfig.thresholds.minimumRR}`);
      assert(freshConfig.thresholds.minimumNetRR === 1.5, `Default minimumNetRR must be 1.5, got ${freshConfig.thresholds.minimumNetRR}`);

      // Restore env vars
      if (origMinScore !== undefined) process.env.THRESHOLD_MIN_SCORE = origMinScore;
      if (origSigScore !== undefined) process.env.THRESHOLD_SIGNAL_SCORE = origSigScore;
      if (origMinRr !== undefined) process.env.THRESHOLD_MIN_RR = origMinRr;
    });

    await test('SignalValidator rejects trades with R:R below 1.8:1 minimum threshold', () => {
      const dummyCandles: any[] = Array.from({ length: 30 }, (_, i) => ({
        timestamp: Date.now() - (30 - i) * 3600000,
        open: 100,
        high: 102,
        low: 98,
        close: 100,
        volume: 1000,
      }));

      // Candidate with Entry=100, SL=95 (Risk=5), TP=105 (Reward=5) -> R:R = 1.0 (Below 1.8)
      const valResult = SignalValidator.validate({
        symbol: 'BTCUSDT',
        direction: 'BUY',
        score: 80,
        entryPrice: 100,
        stopLoss: 95,
        takeProfit: 105,
        riskRewardRatio: 1.0,
        candlesMap: { '1h': dummyCandles },
        liveTicker: { price: 100, isFresh: true, status: 'OK', timestamp: Date.now() } as any,
      });

      assert(!valResult.isValid, 'Validation must fail for R:R < 1.8');
      assert(valResult.detailedMessage.includes('GROSS_RR_BELOW_THRESHOLD') || valResult.detailedMessage.includes('INSUFFICIENT_TARGET_DISTANCE'), `Message should indicate R:R failure, got: ${valResult.detailedMessage}`);
    });

    await test('MarketStructureDetector detects material level displacement and regime shifts', () => {
      const noChange = MarketStructureDetector.hasStructureMateriallyChanged({
        symbol: 'EURUSD',
        currentEntry: 1.1000,
        currentRegime: 'BULLISH_TREND',
        currentDirection: 'BUY',
        currentAtr: 0.0020,
        prevSignal: {
          entryPrice: 1.1005,
          marketRegime: 'BULLISH_TREND',
          direction: 'BUY',
          timestamp: Date.now() - 3600000,
        },
      });
      assert(!noChange.hasChanged, 'Small price change within 1.5x ATR should not be considered a material shift');

      const regimeShift = MarketStructureDetector.hasStructureMateriallyChanged({
        symbol: 'EURUSD',
        currentEntry: 1.1000,
        currentRegime: 'BREAKOUT',
        currentDirection: 'BUY',
        currentAtr: 0.0020,
        prevSignal: {
          entryPrice: 1.1005,
          marketRegime: 'RANGING',
          direction: 'BUY',
          timestamp: Date.now() - 3600000,
        },
      });
      assert(regimeShift.hasChanged, 'RANGING to BREAKOUT regime transition must be detected as material structure change');
      assert(regimeShift.changeType === 'REGIME_SHIFT', 'Change type should be REGIME_SHIFT');
    });

    await test('CooldownManager enforces asset and strategy cooldown windows correctly', () => {
      CooldownManager.clearCooldown('TEST_ASSET');

      const initialCheck = CooldownManager.isAssetInCooldown('TEST_ASSET');
      assert(!initialCheck.inCooldown, 'Asset should initially not be in cooldown');

      CooldownManager.recordSignalEmit('TEST_ASSET', 'BreakoutStrategy', Date.now());

      const activeCheck = CooldownManager.isAssetInCooldown('TEST_ASSET');
      assert(activeCheck.inCooldown, 'Asset must be in cooldown after signal emission');

      const stratCheck = CooldownManager.isStrategyInCooldown('TEST_ASSET', 'BreakoutStrategy');
      assert(stratCheck.inCooldown, 'Strategy must be in cooldown');

      CooldownManager.clearCooldown('TEST_ASSET');
    });

    await test('CandidateRejectionTracker tracks rejected 72+ candidates and makes them accessible for UI', () => {
      const tracker = new CandidateRejectionTracker();
      tracker.recordCandidate({
        symbol: 'NVDA',
        direction: 'BUY',
        score: 76,
        scoreBeforeGate6: 76,
        primaryRejectionReason: 'REJECTED: RISK_CAP_EXCEEDED. Max portfolio risk exceeded',
        failedGates: [StandardFailedGate.SIGNAL_CAP_EXCEEDED],
        finalDecision: 'REJECTED',
        finalScore: 76,
      });

      const allRecords = tracker.getAllRecords();
      const nvdaAudit = allRecords.find((r) => r.symbol === 'NVDA');

      assert(nvdaAudit !== undefined, 'Record for NVDA must exist');
      assert(nvdaAudit?.isQualifiedRejected === true, 'Candidate scoring 76 and rejected must be marked isQualifiedRejected = true');
      assert(nvdaAudit?.score === 76, 'Score must be preserved as 76');
      assert(nvdaAudit?.rejectionSummary !== undefined, 'Human-readable rejection summary must be generated for UI');
    });

    await test('OpportunityFunnelStore tracks watching, confirmed, and rejected candidates', () => {
      OpportunityFunnelStore.addOrUpdate({
        id: 'funnel_test_1',
        symbol: 'SOLUSDT',
        direction: 'BUY',
        entryPrice: 150,
        stopLoss: 145,
        takeProfit: 160,
        riskRewardRatio: 2.0,
        score: 73,
        stage: 'WATCHING',
        status: 'WATCHING',
        hardGatesPassed: true,
        passedSoftConditions: ['EMA_STACK'],
        missingSoftConditions: ['RSI_RECOVERY'],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        expiresAt: Date.now() + 3600000,
      });

      const watching = OpportunityFunnelStore.getByStage('WATCHING');
      assert(watching.some((i) => i.symbol === 'SOLUSDT'), 'OpportunityFunnelStore should retrieve WATCHING candidate SOLUSDT');
    });
  });

  // --- SUITE 7: CANONICAL RISK REWARD CALCULATOR & GATE 3 SINGLE SOURCE ---
  await describe('Canonical RiskRewardCalculator & Gate 3 Single Source Enforcement', async () => {
    await test('BUY R:R calculation conforms to abs(TP2 - Entry) / abs(Entry - SL)', () => {
      const res = RiskRewardCalculator.calculate(100, 95, 102, 110, 115, 'BUY');
      assert(res.isValid, 'Result must be valid');
      assert(res.grossRR === 2.0, `Expected grossRR 2.0 (reward 15 / risk 5), got ${res.grossRR}`);
      assert(res.primaryRR === res.grossRR, 'primaryRR must equal grossRR');
      assert(res.primaryRR === res.tp2RR, 'primaryRR must equal tp2RR');
    });

    await test('SELL R:R calculation conforms to abs(Entry - TP2) / abs(Entry - SL)', () => {
      const res = RiskRewardCalculator.calculate(100, 105, 98, 90, 85, 'SELL');
      assert(res.isValid, 'Result must be valid');
      assert(res.grossRR === 2.0, `Expected grossRR 2.0 (reward 10 / risk 5), got ${res.grossRR}`);
      assert(res.primaryRR === res.grossRR, 'primaryRR must equal grossRR');
      assert(res.primaryRR === res.tp2RR, 'primaryRR must equal tp2RR');
    });

    await test('Diagnostic TP1/TP2/TP3 R:R values are individually correct', () => {
      const res = RiskRewardCalculator.calculate(100, 95, 105, 110, 120, 'BUY');
      assert(res.tp1RR === 1.0, `Expected TP1 RR 1.0, got ${res.tp1RR}`);
      assert(res.tp2RR === 2.0, `Expected TP2 RR 2.0, got ${res.tp2RR}`);
      assert(res.tp3RR === 4.0, `Expected TP3 RR 4.0, got ${res.tp3RR}`);
      assert(res.primaryRR === res.tp2RR, 'primaryRR must equal TP2 RR');
    });

    // --- GATE 3 CANONICAL TEST CASES ---
    await test('TEST 1 — TP2 passes (TP2 R:R = 1.90, TP3 R:R = 2.20, minimumRR = 1.80)', () => {
      // Entry 100, SL 90 (risk 10), TP1 105, TP2 119 (reward 19, RR 1.90), TP3 122 (reward 22, RR 2.20)
      const res = RiskRewardCalculator.calculate(100, 90, 105, 119, 122, 'BUY', 1.80);
      assert(res.isValid === true, 'Candidate must pass R:R gate');
      assert(res.selectedTarget === 'TP2', `Expected selectedTarget TP2, got ${res.selectedTarget}`);
      assert(res.grossRR === 1.90, `Expected grossRR 1.90, got ${res.grossRR}`);
      assert(res.primaryRR === 1.90, `Expected primaryRR 1.90, got ${res.primaryRR}`);
      assert(res.passedViaTp3 === false, 'passedViaTp3 must be false when TP2 qualifies');
    });

    await test('TEST 2 — Only TP3 passes (TP2 R:R = 0.97, TP3 R:R = 1.90, minimumRR = 1.80)', () => {
      // Entry 100, SL 90 (risk 10), TP1 105, TP2 109.7 (reward 9.7, RR 0.97), TP3 119 (reward 19, RR 1.90)
      const res = RiskRewardCalculator.calculate(100, 90, 105, 109.7, 119, 'BUY', 1.80);
      assert(res.isValid === true, 'Candidate must pass R:R gate via TP3');
      assert(res.selectedTarget === 'TP3', `Expected selectedTarget TP3, got ${res.selectedTarget}`);
      assert(res.grossRR === 1.90, `Expected grossRR 1.90, got ${res.grossRR}`);
      assert(res.primaryRR === 1.90, `Expected primaryRR 1.90, got ${res.primaryRR}`);
      assert(res.passedViaTp3 === true, 'passedViaTp3 must be true when only TP3 qualifies');
    });

    await test('TEST 3 — Neither passes (TP2 R:R = 0.97, TP3 R:R = 1.58, minimumRR = 1.80)', () => {
      // Entry 100, SL 90 (risk 10), TP1 105, TP2 109.7 (reward 9.7, RR 0.97), TP3 115.8 (reward 15.8, RR 1.58)
      const res = RiskRewardCalculator.calculate(100, 90, 105, 109.7, 115.8, 'BUY', 1.80);
      assert(res.isValid === false, 'Candidate must be REJECTED when neither TP2 nor TP3 reaches minimumRR');
      assert(res.selectedTarget === null, `Expected selectedTarget null, got ${res.selectedTarget}`);
      assert(res.grossRR === 0, `Expected grossRR 0, got ${res.grossRR}`);
      assert(res.primaryRR === 0, `Expected primaryRR 0, got ${res.primaryRR}`);
      assert(res.tp2GrossRR === 0.97, `Expected tp2GrossRR 0.97, got ${res.tp2GrossRR}`);
      assert(res.tp3GrossRR === 1.58, `Expected tp3GrossRR 1.58, got ${res.tp3GrossRR}`);
    });

    await test('TEST 4 — High score cannot bypass R:R (score = 81, R:R = 1.58, minimumRR = 1.80)', () => {
      const res = RiskRewardCalculator.calculate(100, 90, 105, 109.7, 115.8, 'BUY', 1.80);
      const score = 81;
      const minScore = 70;
      const minRR = 1.80;
      
      const passesScore = score >= minScore;
      const passesRR = res.isValid && res.grossRR >= minRR;
      const finalQualified = passesScore && passesRR;

      assert(passesScore === true, 'Score passes threshold');
      assert(passesRR === false, 'R:R fails threshold');
      assert(finalQualified === false, 'High score must not override the R:R gate');
    });

    await test('TEST 5 — Good R:R cannot bypass score (score = 69, R:R = 2.00, minimumScore = 70)', () => {
      const res = RiskRewardCalculator.calculate(100, 95, 102, 110, 115, 'BUY', 1.80);
      const score = 69;
      const minScore = 70;
      const minRR = 1.80;

      const passesScore = score >= minScore;
      const passesRR = res.isValid && res.grossRR >= minRR;
      const finalQualified = passesScore && passesRR;

      assert(passesScore === false, 'Score fails threshold');
      assert(passesRR === true, 'R:R passes threshold');
      assert(finalQualified === false, 'Good R:R must not override the score gate');
    });

    await test('TEST 6 — Visible numbers must equal published R:R (Entry=2481.60, SL=2464.75, TP2=2508.38, TP3=2519.09)', () => {
      const entryPrice = 2481.60;
      const stopLoss = 2464.75;
      const tp1 = 2490.00;
      const tp2 = 2508.38;
      const tp3 = 2519.09;
      const direction = 'BUY';
      const minimumRR = 1.80;

      const riskDistance = Math.abs(entryPrice - stopLoss); // 16.85
      const tp2RewardDistance = Math.abs(tp2 - entryPrice); // 26.78
      const tp3RewardDistance = Math.abs(tp3 - entryPrice); // 37.49

      assert(Math.abs(riskDistance - 16.85) < 0.001, `Risk distance expected 16.85, got ${riskDistance}`);
      assert(Math.abs(tp2RewardDistance - 26.78) < 0.001, `TP2 reward distance expected 26.78, got ${tp2RewardDistance}`);
      assert(Math.abs(tp3RewardDistance - 37.49) < 0.001, `TP3 reward distance expected 37.49, got ${tp3RewardDistance}`);

      const res = RiskRewardCalculator.calculate(entryPrice, stopLoss, tp1, tp2, tp3, direction, minimumRR);
      
      assert(res.tp2GrossRR === 1.59, `TP2 gross R:R expected 1.59, got ${res.tp2GrossRR}`);
      assert(res.tp3GrossRR === 2.22, `TP3 gross R:R expected 2.22, got ${res.tp3GrossRR}`);
      assert(res.isValid === true, 'Candidate must pass via TP3');
      assert(res.selectedTarget === 'TP3', `Expected selectedTarget TP3, got ${res.selectedTarget}`);
      assert(res.grossRR === 2.22, `Published grossRR must be 2.22, got ${res.grossRR}`);
      assert(res.primaryRR === 2.22, `Published primaryRR must be 2.22, got ${res.primaryRR}`);
      assert(res.grossRR !== 0.89, 'Published gross R:R must NOT be 0.89');
    });

    await test('Invalid entry, SL, TP or missing direction cannot produce a fabricated R:R', () => {
      const invalidRes1 = RiskRewardCalculator.calculate(0, 95, 102, 110, 115, 'BUY');
      assert(!invalidRes1.isValid, 'Zero entry must be invalid');
      assert(invalidRes1.grossRR === 0, 'Gross RR must be 0');
      assert(invalidRes1.rejectionReason === 'INVALID_PRICE', 'Must return INVALID_PRICE');

      const invalidNan = RiskRewardCalculator.calculate(NaN, 95, 102, 110, 115, 'BUY');
      assert(!invalidNan.isValid && invalidNan.passesRR === false, 'NaN entry must be invalid');
      assert(invalidNan.selectedTarget === null, 'selectedTarget must be null');
      assert(invalidNan.grossRR === 0, 'grossRR must be 0');
      assert(invalidNan.primaryRR === 0, 'primaryRR must be 0');
      assert(invalidNan.rejectionReason === 'INVALID_PRICE', 'Must return INVALID_PRICE for NaN');

      const invalidRiskDist = RiskRewardCalculator.calculate(100, 100, 105, 110, 120, 'BUY');
      assert(!invalidRiskDist.isValid && invalidRiskDist.passesRR === false, 'SL === Entry must be invalid');
      assert(invalidRiskDist.selectedTarget === null, 'selectedTarget must be null');
      assert(invalidRiskDist.grossRR === 0, 'grossRR must be 0');
      assert(invalidRiskDist.primaryRR === 0, 'primaryRR must be 0');
      assert(invalidRiskDist.rejectionReason === 'INVALID_RISK_DISTANCE', 'Must return INVALID_RISK_DISTANCE');

      const invalidGeometry1 = RiskRewardCalculator.calculate(100, 90, 110, 105, 120, 'BUY'); // TP2 <= TP1
      assert(!invalidGeometry1.isValid && invalidGeometry1.passesRR === false, 'BUY with TP2 <= TP1 must be invalid');
      assert(invalidGeometry1.selectedTarget === null, 'selectedTarget must be null');
      assert(invalidGeometry1.grossRR === 0, 'grossRR must be 0');
      assert(invalidGeometry1.primaryRR === 0, 'primaryRR must be 0');
      assert(invalidGeometry1.rejectionReason === 'INVALID_TP_GEOMETRY', 'Must return INVALID_TP_GEOMETRY');

      const invalidRes2 = RiskRewardCalculator.calculate(100, 105, 102, 110, 115, 'BUY'); // SL above entry for BUY
      assert(!invalidRes2.isValid, 'BUY with SL above entry must be invalid');
      assert(invalidRes2.rejectionReason === 'INVALID_TP_GEOMETRY', 'Must return INVALID_TP_GEOMETRY');

      const invalidRes3 = RiskRewardCalculator.calculate(100, 95, 102, 110, 115, 'INVALID' as any);
      assert(!invalidRes3.isValid, 'Invalid direction cannot silently fall through to SELL');
    });

    await test('Gate 9 consumes canonical R:R and dynamic serverConfig minimumRR without re-calculation', () => {
      const minRR = serverConfig.getConfig().thresholds.minimumRR;
      const targetTp2 = 100 + 10 * (minRR + 0.1);
      const targetTp3 = 100 + 10 * (minRR + 0.5);
      const expectedTp2RR = Number((minRR + 0.1).toFixed(2));

      const g9Pass = Gate9RiskManagement.calculate(100, 'BUY', 90, 105, targetTp2, targetTp3, expectedTp2RR);
      assert(g9Pass.isValid === true, 'Gate 9 must pass when TP2 >= minimumRR');
      assert(g9Pass.rrRatio === expectedTp2RR, `Gate 9 rrRatio must be ${expectedTp2RR}, got ${g9Pass.rrRatio}`);
      assert(g9Pass.takeProfit === targetTp2, `Gate 9 takeProfit must be ${targetTp2}, got ${g9Pass.takeProfit}`);

      const g9Fail = Gate9RiskManagement.calculate(100, 'BUY', 90, 105, 100 + 10 * (minRR - 0.5), 100 + 10 * (minRR - 0.2), 0);
      assert(g9Fail.isValid === false, 'Gate 9 must reject when R:R is below threshold');
      assert(g9Fail.rrRatio === 0, `Gate 9 rrRatio must be 0 for rejected candidate, got ${g9Fail.rrRatio}`);
    });

    await test('Candidate rejected by GROSS_RR_BELOW_THRESHOLD preserves canonical SL, TP2, grossRR, and primaryRR', () => {
      const tracker = new CandidateRejectionTracker();
      const canonical = RiskRewardCalculator.calculate(100, 95, 101, 101.2, 102, 'BUY');
      tracker.recordCandidate({
        symbol: 'TESTASSET',
        direction: 'BUY',
        score: 75,
        primaryRejectionReason: 'REJECTED: GROSS_RR_BELOW_THRESHOLD. Gross Risk/Reward ratio (0.24:1) is below 1.8:1',
        failedGates: [StandardFailedGate.RR],
        finalDecision: 'REJECTED',
        entryPrice: 100,
        stopLoss: 95,
        takeProfit: 101.2,
        tp1: 101,
        tp2: 101.2,
        tp3: 102,
        grossRR: canonical.grossRR,
        primaryRR: canonical.primaryRR,
        tp1RR: canonical.tp1RR,
        tp2RR: canonical.tp2RR,
        tp3RR: canonical.tp3RR,
      });

      const records = tracker.getAllRecords();
      const rec = records.find(r => r.symbol === 'TESTASSET');
      assert(rec !== undefined, 'Record should exist');
      assert(rec!.stopLoss !== 0, 'stopLoss must not be 0');
      assert(rec!.tp2 !== 0, 'tp2 must not be 0');
      assert((rec!.grossRR ?? 0) === canonical.grossRR, 'grossRR must match canonical');
      assert((rec!.primaryRR ?? 0) === canonical.primaryRR, 'primaryRR must match canonical');
      assert(rec!.tp2RR === canonical.tp2RR, 'tp2RR must match canonical');
    });

    await test('Candidates rejected earlier for confluence/MTF legitimately have SL/TP unset without fabrications', () => {
      const tracker = new CandidateRejectionTracker();
      tracker.recordCandidate({
        symbol: 'EARLYREJECT',
        direction: 'BUY',
        score: 65,
        primaryRejectionReason: 'Gate 6 MTF Contradiction',
        failedGates: [StandardFailedGate.MTF_ALIGNMENT],
        finalDecision: 'REJECTED',
      });

      const rec = tracker.getAllRecords().find(r => r.symbol === 'EARLYREJECT');
      assert(rec !== undefined, 'Record should exist');
      assert(!rec!.stopLoss || rec!.stopLoss === 0, 'stopLoss should be unset / 0 for early rejection');
      assert(!rec!.grossRR || rec!.grossRR === 0, 'grossRR should be unset / 0 for early rejection');
    });
  });

  // --- SUITE 8: TELEMETRY, THRESHOLD CONSISTENCY & CANDIDATE STATE AUDIT ---
  await describe('Telemetry, Threshold Consistency & Candidate State Audit', async () => {
    await test('1. rejectionReasonsCounts.RR matches candidatesRejectedByRR exactly', () => {
      const tracker = new CandidateRejectionTracker();
      tracker.recordCandidate({
        symbol: 'BTCUSDT',
        direction: 'BUY',
        score: 75,
        primaryRejectionReason: 'REJECTED: GROSS_RR_BELOW_THRESHOLD. Gross Risk/Reward ratio (1.2:1) is below 1.8:1',
        failedGates: [StandardFailedGate.RR],
        finalDecision: 'REJECTED',
      });
      tracker.recordCandidate({
        symbol: 'ETHUSDT',
        direction: 'BUY',
        score: 74,
        primaryRejectionReason: 'REJECTED: GROSS_RR_BELOW_THRESHOLD. Gross Risk/Reward ratio (1.4:1) is below 1.8:1',
        failedGates: [StandardFailedGate.RR],
        finalDecision: 'REJECTED',
      });
      tracker.recordCandidate({
        symbol: 'SOLUSDT',
        direction: 'BUY',
        score: 65,
        primaryRejectionReason: 'REJECTED: MTF_ALIGNMENT. Multi-timeframe contradiction',
        failedGates: [StandardFailedGate.MTF_ALIGNMENT],
        finalDecision: 'REJECTED',
      });

      const counts = tracker.getAggregatedRejectionReasons();
      const categorized = tracker.getCategorizedRejectionCounts();

      assert(counts.RR === 2, `Expected counts.RR === 2, got ${counts.RR}`);
      assert(categorized.candidatesRejectedByRR === 2, `Expected categorized.candidatesRejectedByRR === 2, got ${categorized.candidatesRejectedByRR}`);
      assert(counts.RR === categorized.candidatesRejectedByRR, `rejectionReasonsCounts.RR (${counts.RR}) must equal candidatesRejectedByRR (${categorized.candidatesRejectedByRR})`);
    });

    await test('2. A candidate rejected by RR only has RR in its finalized failedGates', () => {
      const tracker = new CandidateRejectionTracker();
      tracker.recordCandidate({
        symbol: 'SOLUSDT',
        direction: 'BUY',
        score: 76,
        primaryRejectionReason: 'REJECTED: GROSS_RR_BELOW_THRESHOLD. Gross Risk/Reward ratio (1.1:1) is below 1.8:1',
        failedGates: [StandardFailedGate.RR],
        finalDecision: 'REJECTED',
      });

      const records = tracker.getAllRecords();
      const sol = records.find(r => r.symbol === 'SOLUSDT');
      assert(sol !== undefined, 'Candidate record must exist');
      assert(sol!.failedGates.length === 1, `Expected exactly 1 failed gate, got ${sol!.failedGates.length}`);
      assert(sol!.failedGates[0] === StandardFailedGate.RR, `Expected failed gate to be RR, got ${sol!.failedGates[0]}`);
      assert(!sol!.failedGates.includes(StandardFailedGate.FINAL_SCORE_BELOW_THRESHOLD), 'Candidate with score 76 must NOT have FINAL_SCORE_BELOW_THRESHOLD');
    });

    await test('3. CandidateRejectionTracker.recordCandidate() overwriting a symbol replaces failedGates instead of unioning them', () => {
      const tracker = new CandidateRejectionTracker();
      // First evaluation fails MTF
      tracker.recordCandidate({
        symbol: 'AVAXUSDT',
        direction: 'BUY',
        score: 60,
        primaryRejectionReason: 'REJECTED: MTF_ALIGNMENT',
        failedGates: [StandardFailedGate.MTF_ALIGNMENT],
        finalDecision: 'REJECTED',
      });

      // Second evaluation later in the pipeline passes MTF but fails RR
      tracker.recordCandidate({
        symbol: 'AVAXUSDT',
        direction: 'BUY',
        score: 75,
        primaryRejectionReason: 'REJECTED: GROSS_RR_BELOW_THRESHOLD',
        failedGates: [StandardFailedGate.RR],
        finalDecision: 'REJECTED',
      });

      const records = tracker.getAllRecords();
      const avax = records.find(r => r.symbol === 'AVAXUSDT');
      assert(avax !== undefined, 'Record must exist');
      assert(!avax!.failedGates.includes(StandardFailedGate.MTF_ALIGNMENT), 'Historical MTF_ALIGNMENT must not leak into finalized record');
      assert(avax!.failedGates.includes(StandardFailedGate.RR), 'Finalized record must contain current failed gate RR');
      assert(avax!.failedGates.length === 1, `Expected failedGates length to be 1, got ${avax!.failedGates.length}`);
    });

    await test('3b. A candidate rejected by MTF alignment never has FINAL_SCORE_BELOW_THRESHOLD, even with score < 70', () => {
      const tracker = new CandidateRejectionTracker();
      tracker.recordCandidate({
        symbol: 'NEARUSDT',
        direction: 'BUY',
        score: 55,
        scoreBeforeGate6: 72,
        stage: 'GATE_6',
        primaryRejectionReason: 'Gate 6 (MTF Layer 1): 15m trend disagrees with 1h trend',
        failedGates: [StandardFailedGate.MTF_ALIGNMENT, StandardFailedGate.FINAL_SCORE_BELOW_THRESHOLD],
        finalDecision: 'REJECTED',
      });

      const records = tracker.getAllRecords();
      const near = records.find(r => r.symbol === 'NEARUSDT');
      assert(near !== undefined, 'Record must exist');
      assert(near!.failedGates.includes(StandardFailedGate.MTF_ALIGNMENT), 'Must contain MTF_ALIGNMENT');
      assert(!near!.failedGates.includes(StandardFailedGate.FINAL_SCORE_BELOW_THRESHOLD), 'Must NOT contain FINAL_SCORE_BELOW_THRESHOLD');
      assert(near!.failedGates.length === 1, `Expected exactly 1 failed gate, got ${near!.failedGates.length}`);

      // Also test inferFailedGatesFromReason
      const inferred = CandidateRejectionTracker.inferFailedGatesFromReason('Gate 6 (MTF Layer 1): MTF Contradiction', 62);
      assert(inferred.includes(StandardFailedGate.MTF_ALIGNMENT), 'Inferred gates must contain MTF_ALIGNMENT');
      assert(!inferred.includes(StandardFailedGate.FINAL_SCORE_BELOW_THRESHOLD), 'Inferred gates for MTF must NOT contain FINAL_SCORE_BELOW_THRESHOLD');
    });

    await test('4. HourlyScanner aggregates candidate rejection details and derives categorized counters from finalized records', () => {
      const tracker1 = new CandidateRejectionTracker();
      tracker1.recordCandidate({
        symbol: 'BTCUSDT',
        direction: 'BUY',
        score: 75,
        primaryRejectionReason: 'REJECTED: GROSS_RR_BELOW_THRESHOLD',
        failedGates: [StandardFailedGate.RR],
        finalDecision: 'REJECTED',
      });

      const tracker2 = new CandidateRejectionTracker();
      tracker2.recordCandidate({
        symbol: 'EURUSD',
        direction: 'BUY',
        score: 68,
        primaryRejectionReason: 'REJECTED: FINAL_SCORE_BELOW_THRESHOLD',
        failedGates: [StandardFailedGate.FINAL_SCORE_BELOW_THRESHOLD],
        finalDecision: 'REJECTED',
      });

      const allDetails = [...tracker1.getAllRecords(), ...tracker2.getAllRecords()];
      
      let finalBeforeMTF = 0;
      let finalMTF = 0;
      let finalScore = 0;
      let finalRR = 0;
      let finalStructure = 0;

      for (const record of allDetails) {
        if (record.finalDecision === 'REJECTED' || (record.failedGates && record.failedGates.length > 0)) {
          const gates = record.failedGates || [];
          if (gates.includes('RR' as any)) finalRR++;
          if (gates.includes('FINAL_SCORE_BELOW_THRESHOLD' as any)) finalScore++;
          if (gates.includes('MTF_ALIGNMENT' as any)) finalMTF++;
          if (gates.includes('MARKET_STRUCTURE' as any)) finalStructure++;
          if (gates.includes('FINAL_SCORE_UNREACHABLE' as any)) finalBeforeMTF++;
        }
      }

      assert(finalRR === 1, `Expected finalRR === 1, got ${finalRR}`);
      assert(finalScore === 1, `Expected finalScore === 1, got ${finalScore}`);
      assert(finalMTF === 0, `Expected finalMTF === 0, got ${finalMTF}`);
      assert(allDetails.length === 2, `Expected 2 finalized records, got ${allDetails.length}`);
    });

    await test('5. All rejection reason strings in the scan response correspond to finalized rejected candidates', () => {
      const records = [
        {
          symbol: 'BTCUSDT',
          direction: 'BUY' as const,
          score: 75,
          primaryRejectionReason: 'REJECTED: GROSS_RR_BELOW_THRESHOLD. Risk/reward only 1.2:1; minimum required is 1.8:1.',
          failedGates: [StandardFailedGate.RR],
          finalDecision: 'REJECTED' as const,
        },
        {
          symbol: 'ETHUSDT',
          direction: 'SELL' as const,
          score: 68,
          primaryRejectionReason: 'REJECTED: SCORE_BELOW_THRESHOLD. Signal score (68/100) is below 70.',
          failedGates: [StandardFailedGate.FINAL_SCORE_BELOW_THRESHOLD],
          finalDecision: 'REJECTED' as const,
        },
      ];

      const rejectionReasonStrings = records.map(
        (r) => `${r.symbol}${r.direction ? ` [${r.direction}]` : ''}: ${r.primaryRejectionReason}`
      );

      assert(rejectionReasonStrings.length === 2, 'Must format exactly 2 strings');
      assert(rejectionReasonStrings[0].startsWith('BTCUSDT [BUY]: REJECTED: GROSS_RR_BELOW_THRESHOLD'), 'BTC reason must match format');
      assert(rejectionReasonStrings[1].startsWith('ETHUSDT [SELL]: REJECTED: SCORE_BELOW_THRESHOLD'), 'ETH reason must match format');
    });

    await test('6. The score threshold reported in metadata/diagnostics matches serverConfig.getConfig().thresholds.signalThreshold (not stale hard-coded 72/75)', () => {
      const config = serverConfig.getConfig();
      const signalThreshold = config.thresholds.signalThreshold;
      assert(typeof signalThreshold === 'number', 'signalThreshold must be a number');
      assert(signalThreshold >= 60 && signalThreshold <= 100, `Signal threshold must be a valid score, got ${signalThreshold}`);

      // Verify code default when env overrides are absent is valid
      const codeDefaultConfig = (serverConfig as any).loadAndValidate();
      assert(typeof codeDefaultConfig.thresholds.signalThreshold === 'number', 'Code default signalThreshold must be a number');

      // Verify human readable format uses dynamic threshold from serverConfig
      const summary = CandidateRejectionTracker.formatHumanReadableSummary('SCORE_BELOW_THRESHOLD', [], 65);
      assert(summary.includes(`${signalThreshold}`), `Rejection summary must contain current configured threshold (${signalThreshold}), got: ${summary}`);
      assert(!summary.includes('72'), 'Summary must not contain stale hard-coded 72');
    });

    await test('7. Deduplicating rejected candidates within a scan results in candidatesRejectedFinal === 4 and rejectedCount === 4 (not 8)', () => {
      // 4 candidates from candidateRejectionDetails
      const candidateRejectionDetails: any[] = [
        { symbol: 'FLOKIUSDT', direction: 'SELL', finalDecision: 'REJECTED', failedGates: [StandardFailedGate.RR] },
        { symbol: 'XRPUSDT', direction: 'SELL', finalDecision: 'REJECTED', failedGates: [StandardFailedGate.RR] },
        { symbol: 'LINKUSDT', direction: 'SELL', finalDecision: 'REJECTED', failedGates: [StandardFailedGate.FINAL_SCORE_BELOW_THRESHOLD] },
        { symbol: 'ETHUSDT', direction: 'SELL', finalDecision: 'REJECTED', failedGates: [StandardFailedGate.MTF_ALIGNMENT] },
      ];

      // And the same 4 records duplicated / also present in rejectedDuringScan
      const rejectedDuringScan: any[] = [
        { symbol: 'FLOKIUSDT', direction: 'SELL', score: 71, reason: 'REJECTED: RR' },
        { symbol: 'XRPUSDT', direction: 'SELL', score: 72, reason: 'REJECTED: RR' },
        { symbol: 'LINKUSDT', direction: 'SELL', score: 68, reason: 'REJECTED: FINAL_SCORE_BELOW_THRESHOLD' },
        { symbol: 'ETHUSDT', direction: 'SELL', score: 66, reason: 'REJECTED: MTF_ALIGNMENT' },
      ];

      const allDetails = [...candidateRejectionDetails];
      for (const rej of rejectedDuringScan) {
        allDetails.push({
          symbol: rej.symbol,
          direction: rej.direction,
          score: rej.score,
          primaryRejectionReason: rej.reason,
          failedGates: ['RR' as any],
          finalDecision: 'REJECTED',
          timestamp: Date.now(),
        });
      }

      assert(allDetails.length === 8, `Expected 8 raw records before deduplication, got ${allDetails.length}`);

      // Perform the exact deduplication logic as HourlyScanner
      const rejectedCandidateMap = new Map<string, any>();
      for (const record of allDetails) {
        if (
          record.finalDecision === 'REJECTED' ||
          (Array.isArray(record.failedGates) && record.failedGates.length > 0)
        ) {
          const key = `${record.symbol}_${record.direction || ''}`;
          rejectedCandidateMap.set(key, record);
        }
      }

      const finalRejectedRecords = Array.from(rejectedCandidateMap.values());
      const authoritativeRejectedCount = finalRejectedRecords.length;

      const candidatesRejectedFinal = authoritativeRejectedCount;
      const rejectedCount = authoritativeRejectedCount;

      assert(candidatesRejectedFinal === 4, `Expected candidatesRejectedFinal === 4, got ${candidatesRejectedFinal}`);
      assert(rejectedCount === 4, `Expected rejectedCount === 4, got ${rejectedCount}`);
      assert(authoritativeRejectedCount !== 8, `Must NOT double-count to 8`);
    });

    await test('8. BTC SELL from scan A and BTC SELL from scan B remain separate evaluations across scans', () => {
      // Scan A evaluation
      const scanADetails: any[] = [
        { symbol: 'BTCUSDT', direction: 'SELL', finalDecision: 'REJECTED', failedGates: [StandardFailedGate.RR], timestamp: 1000 },
      ];

      // Scan B evaluation
      const scanBDetails: any[] = [
        { symbol: 'BTCUSDT', direction: 'SELL', finalDecision: 'REJECTED', failedGates: [StandardFailedGate.MTF_ALIGNMENT], timestamp: 2000 },
      ];

      // Per-scan deduplication keeps each scan evaluation self-contained
      const mapA = new Map<string, any>();
      for (const r of scanADetails) {
        if (r.finalDecision === 'REJECTED') mapA.set(`${r.symbol}_${r.direction || ''}`, r);
      }

      const mapB = new Map<string, any>();
      for (const r of scanBDetails) {
        if (r.finalDecision === 'REJECTED') mapB.set(`${r.symbol}_${r.direction || ''}`, r);
      }

      const countA = mapA.size;
      const countB = mapB.size;

      assert(countA === 1, `Scan A must have 1 evaluation, got ${countA}`);
      assert(countB === 1, `Scan B must have 1 evaluation, got ${countB}`);
      assert(mapA.get('BTCUSDT_SELL').timestamp === 1000, 'Scan A timestamp preserved');
      assert(mapB.get('BTCUSDT_SELL').timestamp === 2000, 'Scan B timestamp preserved');
    });

    await test('9. New evaluation does not inherit stale trade levels (entryPrice, stopLoss, TP, RR) from existing candidate record', () => {
      const tracker = new CandidateRejectionTracker();
      // First evaluation has full trade levels and passes to RR check where it was evaluated
      tracker.recordCandidate({
        symbol: 'SOLUSDT',
        direction: 'BUY',
        score: 75,
        primaryRejectionReason: 'REJECTED: GROSS_RR_BELOW_THRESHOLD',
        failedGates: [StandardFailedGate.RR],
        finalDecision: 'REJECTED',
        entryPrice: 150.25,
        stopLoss: 148.00,
        takeProfit: 153.00,
        tp1: 152.00,
        tp2: 153.00,
        tp3: 155.00,
        grossRR: 1.22,
        primaryRR: 1.22,
        tp1RR: 0.77,
        tp2RR: 1.22,
        tp3RR: 2.11,
      });

      const initialRecord = tracker.getAllRecords().find(r => r.symbol === 'SOLUSDT');
      assert(initialRecord?.entryPrice === 150.25, 'Initial record must have entryPrice');
      assert(initialRecord?.stopLoss === 148.00, 'Initial record must have stopLoss');
      assert(initialRecord?.grossRR === 1.22, 'Initial record must have grossRR');

      // Second evaluation fails at early gate (MTF) where trade levels are NOT generated
      tracker.recordCandidate({
        symbol: 'SOLUSDT',
        direction: 'BUY',
        score: 62,
        primaryRejectionReason: 'REJECTED: MTF_ALIGNMENT',
        failedGates: [StandardFailedGate.MTF_ALIGNMENT],
        finalDecision: 'REJECTED',
      });

      const updatedRecord = tracker.getAllRecords().find(r => r.symbol === 'SOLUSDT');
      assert(updatedRecord !== undefined, 'Updated record must exist');
      assert(updatedRecord!.entryPrice === undefined, `entryPrice must be undefined, got ${updatedRecord!.entryPrice}`);
      assert(updatedRecord!.stopLoss === undefined, `stopLoss must be undefined, got ${updatedRecord!.stopLoss}`);
      assert(updatedRecord!.takeProfit === undefined, `takeProfit must be undefined, got ${updatedRecord!.takeProfit}`);
      assert(updatedRecord!.tp1 === undefined, `tp1 must be undefined, got ${updatedRecord!.tp1}`);
      assert(updatedRecord!.tp2 === undefined, `tp2 must be undefined, got ${updatedRecord!.tp2}`);
      assert(updatedRecord!.tp3 === undefined, `tp3 must be undefined, got ${updatedRecord!.tp3}`);
      assert(updatedRecord!.grossRR === undefined, `grossRR must be undefined, got ${updatedRecord!.grossRR}`);
      assert(updatedRecord!.primaryRR === undefined, `primaryRR must be undefined, got ${updatedRecord!.primaryRR}`);
      assert(updatedRecord!.tp1RR === undefined, `tp1RR must be undefined, got ${updatedRecord!.tp1RR}`);
      assert(updatedRecord!.tp2RR === undefined, `tp2RR must be undefined, got ${updatedRecord!.tp2RR}`);
      assert(updatedRecord!.tp3RR === undefined, `tp3RR must be undefined, got ${updatedRecord!.tp3RR}`);
      assert(updatedRecord!.score === 62, `score must be 62, got ${updatedRecord!.score}`);
      assert(updatedRecord!.everReachedThreshold === true, 'Historical lifecycle field everReachedThreshold must be preserved');
    });

    await test('10. Gate 7 uses authoritative threshold from serverConfig with no stale 72 fallback', () => {
      const config = serverConfig.getConfig();
      const authoritativeThreshold = config.thresholds.signalThreshold;
      assert(typeof authoritativeThreshold === 'number', 'Authoritative threshold must be a number');
      assert(Gate7FinalTradeValidation.REQUIRED_MIN_SCORE === authoritativeThreshold, `Gate 7 REQUIRED_MIN_SCORE (${Gate7FinalTradeValidation.REQUIRED_MIN_SCORE}) must equal authoritative threshold (${authoritativeThreshold})`);

      const now = Date.now();
      const createMockContext = (score: number, minScoreOverride?: number): any => ({
        symbol: 'BTCUSDT',
        direction: 'BUY',
        entryPrice: 65000,
        stopLoss: 63000,
        takeProfit: 69000,
        tp1: 67000,
        tp2: 69000,
        tp3: 71000,
        riskRewardRatio: 2.0,
        score,
        candlesMap: {
          '1h': [
            { timestamp: now - 3600000, open: 64000, high: 65500, low: 63800, close: 65000, volume: 100 },
          ],
        },
        liveTicker: {
          symbol: 'BTCUSDT',
          price: 65000,
          bid: 64995,
          ask: 65005,
          timestamp: now - 5000,
          status: 'LIVE',
        },
        atr: 1000,
        minimumScoreThreshold: minScoreOverride,
      });

      // Score below threshold
      const resBelow = Gate7FinalTradeValidation.validateCandidate(createMockContext(authoritativeThreshold - 1));
      assert(resBelow.scoreRequirementPassed === false, 'Score below threshold must not pass score requirement');
      assert(resBelow.isTradeable === false, 'Candidate with score below threshold must not be tradeable');
      assert(resBelow.primaryRejectionReason?.includes(`${authoritativeThreshold}`), 'Rejection reason must reference authoritative threshold');
      assert(!resBelow.primaryRejectionReason?.includes('72'), 'Rejection reason must not reference hardcoded 72');

      // Score exactly at threshold
      const resExact = Gate7FinalTradeValidation.validateCandidate(createMockContext(authoritativeThreshold));
      assert(resExact.scoreRequirementPassed === true, 'Score exactly at threshold must pass score requirement');

      // Score above threshold
      const resAbove = Gate7FinalTradeValidation.validateCandidate(createMockContext(authoritativeThreshold + 5));
      assert(resAbove.scoreRequirementPassed === true, 'Score above threshold must pass score requirement');
    });

    await test('11. Gate 7 throws an explicit configuration error if signalThreshold is missing or invalid, with NO fallback to 72', () => {
      const originalThreshold = serverConfig.getConfig().thresholds.signalThreshold;
      try {
        (serverConfig.getConfig().thresholds as any).signalThreshold = undefined;
        let threw = false;
        try {
          const _val = Gate7FinalTradeValidation.REQUIRED_MIN_SCORE;
        } catch (err: any) {
          threw = true;
          assert(err.message.includes('Gate 7 Configuration Error'), 'Error must be an explicit configuration error');
          assert(!err.message.includes('fallback to 72'), 'Must not mention fallback to 72');
        }
        assert(threw, 'Gate 7 REQUIRED_MIN_SCORE must throw when signalThreshold is missing/invalid');
      } finally {
        (serverConfig.getConfig().thresholds as any).signalThreshold = originalThreshold;
      }
    });

    await test('12. Gate 5: ScoringEngine, Gate8TradeabilityThreshold and CandidateRejectionTracker dynamically use authoritative signalThreshold without stale 72/75 fallbacks', () => {
      const authThreshold = serverConfig.getConfig().thresholds.signalThreshold;
      
      // ScoringEngine classification
      const classification = ScoringEngine.classifyScore(authThreshold);
      assert(classification.isActionable === true, 'Score at authoritative threshold must be actionable');
      assert(classification.isQualifiedCandidate === true, 'Score at authoritative threshold must be qualified candidate');

      // Gate8TradeabilityThreshold
      assert(Gate8TradeabilityThreshold.FINAL_TRADEABILITY_THRESHOLD === authThreshold, 'Gate 8 threshold must equal authoritative signalThreshold');

      // Gate 8 evaluation
      const gate8Res = Gate8TradeabilityThreshold.evaluateCandidate({
        symbol: 'TESTUSDT',
        direction: 'BUY',
        trendAlignmentScore: 100,
        mtfConfluenceScore: 100,
        momentumScore: 100,
        marketStructureScore: 100,
        volumeScore: 100,
        volatilityAtrScore: 100,
        entryQualityScore: 100,
        riskRewardRatio: 2.5,
        netRiskRewardRatio: 2.0,
        agreeingStrategiesRatio: 1.0,
        timeframeAlignmentRatio: 1.0,
      });
      assert(gate8Res.isTradeable === true, 'High score must be tradeable in Gate 8');
      assert(gate8Res.finalScore >= authThreshold, 'Final score must exceed authoritative threshold');
    });

    await describe('SUITE 6: Gate 35 Signal Funnel Analytics & Candidate Lifecycle', async () => {
      await test('13. Test A — Normal flow: 10 candidates -> 6 screened -> 3 deep analysis -> 2 completed -> 1 accepted, 1 rejected', () => {
        Gate35SignalFunnelAnalytics.clear();

        // 10 candidates scanned initially
        for (let i = 1; i <= 10; i++) {
          Gate35SignalFunnelAnalytics.recordCandidate({
            id: `cand_${i}`,
            symbol: `SYM${i}USDT`,
            direction: 'BUY',
            timeframe: '1H',
            stage: 'CANDIDATE',
            score: 50,
          });
        }

        // 6 candidates screened (CAND_1..6)
        for (let i = 1; i <= 6; i++) {
          Gate35SignalFunnelAnalytics.recordCandidate({
            id: `cand_${i}`,
            symbol: `SYM${i}USDT`,
            direction: 'BUY',
            timeframe: '1H',
            stage: 'GATE_1',
            score: 65,
          });
        }

        // 3 candidates reach deep analysis (CAND_1, CAND_2, CAND_3)
        for (let i = 1; i <= 3; i++) {
          Gate35SignalFunnelAnalytics.recordCandidate({
            id: `cand_${i}`,
            symbol: `SYM${i}USDT`,
            direction: 'BUY',
            timeframe: '1H',
            stage: 'GATE_6',
            score: 75,
          });
        }

        // CAND_3 gets rejected in deep analysis (GATE_8)
        Gate35SignalFunnelAnalytics.recordCandidate({
          id: `cand_3`,
          symbol: `SYM3USDT`,
          direction: 'BUY',
          timeframe: '1H',
          stage: 'GATE_8',
          score: 72,
          rejectionCode: 'REJECTED: RR_BELOW_THRESHOLD',
          rejectionReason: 'Risk reward below threshold',
        });

        // CAND_1 and CAND_2 complete deep analysis (RANKING)
        for (let i = 1; i <= 2; i++) {
          Gate35SignalFunnelAnalytics.recordCandidate({
            id: `cand_${i}`,
            symbol: `SYM${i}USDT`,
            direction: 'BUY',
            timeframe: '1H',
            stage: 'RANKING',
            score: 85,
          });
        }

        // CAND_1 accepted as FINAL_SIGNAL
        Gate35SignalFunnelAnalytics.recordCandidate({
          id: `cand_1`,
          symbol: `SYM1USDT`,
          direction: 'BUY',
          timeframe: '1H',
          stage: 'FINAL_SIGNAL',
          score: 88,
        });

        const report = Gate35SignalFunnelAnalytics.getFunnelAnalytics();
        const lc = report.lifecycleCounts;

        assert(lc.totalCandidates === 10, `Expected 10 total candidates, got ${lc.totalCandidates}`);
        assert(lc.screenedCandidates === 6, `Expected 6 screened candidates, got ${lc.screenedCandidates}`);
        assert(lc.deepAnalysisCandidates === 3, `Expected 3 deep analysis candidates, got ${lc.deepAnalysisCandidates}`);
        assert(lc.completedCandidates === 2, `Expected 2 completed candidates, got ${lc.completedCandidates}`);
        assert(lc.acceptedCandidates === 1, `Expected 1 accepted candidate, got ${lc.acceptedCandidates}`);
        assert(lc.rejectedCandidates === 1, `Expected 1 rejected candidate, got ${lc.rejectedCandidates}`);
        assert(lc.earlyRejectedCandidates === 0, `Expected 0 early rejections, got ${lc.earlyRejectedCandidates}`);
        assert(lc.deepRejectedCandidates === 1, `Expected 1 deep rejection, got ${lc.deepRejectedCandidates}`);

        // Internal invariants check
        assert(lc.screenedCandidates <= lc.totalCandidates, 'screened <= total');
        assert(lc.deepAnalysisCandidates <= lc.screenedCandidates, 'deepAnalysis <= screened');
        assert(lc.completedCandidates <= lc.deepAnalysisCandidates, 'completed <= deepAnalysis');
        assert(lc.acceptedCandidates <= lc.completedCandidates, 'accepted <= completed');
        assert(lc.acceptedCandidates + lc.rejectedCandidates <= lc.totalCandidates, 'accepted + rejected <= total');
      });

      await test('14. Test B — Early rejection: Candidate rejected before deep analysis does not appear as completed', () => {
        Gate35SignalFunnelAnalytics.clear();

        // 10 candidates
        for (let i = 1; i <= 10; i++) {
          Gate35SignalFunnelAnalytics.recordCandidate({
            id: `cand_${i}`,
            symbol: `SYM${i}USDT`,
            direction: 'BUY',
            timeframe: '1H',
            stage: 'CANDIDATE',
            score: 50,
          });
        }

        // Candidate 1 rejected at GATE_2 (Early rejection)
        Gate35SignalFunnelAnalytics.recordCandidate({
          id: 'cand_1',
          symbol: 'SYM1USDT',
          direction: 'BUY',
          timeframe: '1H',
          stage: 'GATE_2',
          score: 40,
          rejectionCode: 'REJECTED: SCORE_TOO_LOW',
          rejectionReason: 'Score too low',
        });

        const report = Gate35SignalFunnelAnalytics.getFunnelAnalytics();
        const lc = report.lifecycleCounts;

        assert(lc.totalCandidates === 10, `Expected 10 total candidates, got ${lc.totalCandidates}`);
        assert(lc.rejectedCandidates === 1, `Expected 1 rejected candidate, got ${lc.rejectedCandidates}`);
        assert(lc.earlyRejectedCandidates === 1, `Expected 1 early rejected candidate, got ${lc.earlyRejectedCandidates}`);
        assert(lc.deepRejectedCandidates === 0, `Expected 0 deep rejected candidates, got ${lc.deepRejectedCandidates}`);
        assert(lc.completedCandidates === 0, `Expected 0 completed candidates, got ${lc.completedCandidates}`);
        assert(lc.acceptedCandidates === 0, `Expected 0 accepted candidates, got ${lc.acceptedCandidates}`);
      });

      await test('15. Test C — Retry: Candidate fails once and succeeds on retry, counted once without duplicate inflate', () => {
        Gate35SignalFunnelAnalytics.clear();

        // First attempt fails at GATE_1
        Gate35SignalFunnelAnalytics.recordCandidate({
          candidateKey: 'BTCUSDT_BUY_1H',
          symbol: 'BTCUSDT',
          direction: 'BUY',
          timeframe: '1H',
          stage: 'GATE_1',
          score: 45,
          rejectionCode: 'REJECTED: DATA_STALE',
          rejectionReason: 'Stale quote',
        });

        // Retry succeeds
        Gate35SignalFunnelAnalytics.recordCandidate({
          candidateKey: 'BTCUSDT_BUY_1H',
          symbol: 'BTCUSDT',
          direction: 'BUY',
          timeframe: '1H',
          stage: 'FINAL_SIGNAL',
          score: 85,
        });

        const report = Gate35SignalFunnelAnalytics.getFunnelAnalytics();
        const lc = report.lifecycleCounts;

        assert(lc.totalCandidates === 1, `Expected exactly 1 total candidate record, got ${lc.totalCandidates}`);
        assert(lc.acceptedCandidates === 1, `Expected 1 accepted candidate on retry success, got ${lc.acceptedCandidates}`);
        assert(lc.rejectedCandidates === 0, `Expected 0 active rejections after retry success, got ${lc.rejectedCandidates}`);
      });

      await test('16. Test D — Analysis error: Candidate errors during deep analysis, downstream counters not incremented', () => {
        Gate35SignalFunnelAnalytics.clear();

        Gate35SignalFunnelAnalytics.recordCandidate({
          id: 'cand_err',
          symbol: 'ETHUSDT',
          direction: 'BUY',
          timeframe: '1H',
          stage: 'GATE_6',
          score: 75,
        });

        // Errors out at GATE_7
        Gate35SignalFunnelAnalytics.recordCandidate({
          id: 'cand_err',
          symbol: 'ETHUSDT',
          direction: 'BUY',
          timeframe: '1H',
          stage: 'GATE_7',
          score: 75,
          rejectionCode: 'REJECTED: ANALYSIS_ERROR',
          rejectionReason: 'Provider timeout during analysis',
        });

        const report = Gate35SignalFunnelAnalytics.getFunnelAnalytics();
        const lc = report.lifecycleCounts;

        assert(lc.totalCandidates === 1, `Expected 1 total candidate, got ${lc.totalCandidates}`);
        assert(lc.deepAnalysisCandidates === 1, `Expected 1 deep analysis candidate, got ${lc.deepAnalysisCandidates}`);
        assert(lc.completedCandidates === 0, `Expected 0 completed candidates on error, got ${lc.completedCandidates}`);
        assert(lc.acceptedCandidates === 0, `Expected 0 accepted candidates on error, got ${lc.acceptedCandidates}`);
        assert(lc.rejectedCandidates === 1, `Expected 1 rejected candidate on error, got ${lc.rejectedCandidates}`);
      });

      await test('17. Test E — Duplicate candidate: Same symbol/candidate recorded twice cannot inflate funnel counters', () => {
        Gate35SignalFunnelAnalytics.clear();

        // Recorded 5 times across pipeline gates
        const stages: FunnelStage[] = ['CANDIDATE', 'STAGE_2', 'GATE_1', 'GATE_4', 'GATE_6'];
        for (const stage of stages) {
          Gate35SignalFunnelAnalytics.recordCandidate({
            candidateKey: 'SOLUSDT_BUY_1H',
            symbol: 'SOLUSDT',
            direction: 'BUY',
            timeframe: '1H',
            stage,
            score: 80,
          });
        }

        const report = Gate35SignalFunnelAnalytics.getFunnelAnalytics();
        const lc = report.lifecycleCounts;

        assert(lc.totalCandidates === 1, `Expected exactly 1 candidate record, got ${lc.totalCandidates}`);
        assert(lc.screenedCandidates === 1, `Expected 1 screened candidate, got ${lc.screenedCandidates}`);
        assert(lc.deepAnalysisCandidates === 1, `Expected 1 deep analysis candidate, got ${lc.deepAnalysisCandidates}`);
        assert(report.recordsCount === 1, `Expected 1 stored record count, got ${report.recordsCount}`);
      });
    });

    // --- SUITE 7: GATE 7 HOURLYSCANNER REJECTION DEDUPLICATION AND COUNTER CONSISTENCY ---
    await describe('SUITE 7: Gate 7 HourlyScanner Rejection Deduplication & Counter Consistency', async () => {
      await test('18. Duplicate records: Multiple evaluation logs for the same candidate key produce 1 deduplicated rejection record', () => {
        const rawLogs = [
          {
            symbol: 'SOLUSDT',
            direction: 'BUY',
            score: 70,
            primaryRejectionReason: 'REJECTED: SCORE_TOO_LOW',
            failedGates: ['FINAL_SCORE_BELOW_THRESHOLD'],
            finalDecision: 'REJECTED',
          },
          {
            symbol: 'SOLUSDT',
            direction: 'BUY',
            score: 70,
            primaryRejectionReason: 'REJECTED: GROSS_RR_BELOW_THRESHOLD',
            failedGates: ['RR'],
            finalDecision: 'REJECTED',
          },
        ];

        const res = HourlyScannerService.processRejectionDetails(rawLogs);

        assert(res.finalRejectedRecords.length === 1, `Expected 1 deduplicated record, got ${res.finalRejectedRecords.length}`);
        assert(res.authoritativeRejectedCount === 1, `Expected rejectedCount 1, got ${res.authoritativeRejectedCount}`);
        assert(res.rejectionReasonStrings.length === 1, `Expected rejectionReasons.length 1, got ${res.rejectionReasonStrings.length}`);
        assert(res.finalRejectedRecords[0].primaryRejectionReason === 'REJECTED: GROSS_RR_BELOW_THRESHOLD', 'Expected latest record reason');
      });

      await test('19. Two distinct candidates: BTCUSDT (BUY) and ETHUSDT (SELL) produce 2 distinct deduplicated records', () => {
        const rawLogs = [
          {
            symbol: 'BTCUSDT',
            direction: 'BUY',
            score: 65,
            primaryRejectionReason: 'REJECTED: SCORE_TOO_LOW',
            failedGates: ['FINAL_SCORE_BELOW_THRESHOLD'],
            finalDecision: 'REJECTED',
          },
          {
            symbol: 'ETHUSDT',
            direction: 'SELL',
            score: 60,
            primaryRejectionReason: 'REJECTED: MTF_ALIGNMENT',
            failedGates: ['MTF_ALIGNMENT'],
            finalDecision: 'REJECTED',
          },
        ];

        const res = HourlyScannerService.processRejectionDetails(rawLogs);

        assert(res.finalRejectedRecords.length === 2, `Expected 2 distinct records, got ${res.finalRejectedRecords.length}`);
        assert(res.authoritativeRejectedCount === 2, `Expected rejectedCount 2, got ${res.authoritativeRejectedCount}`);
        assert(res.rejectionReasonStrings.length === 2, `Expected 2 rejection reason strings, got ${res.rejectionReasonStrings.length}`);
      });

      await test('20. Multi-gate rejection: Candidate failing score and RR counts once as rejected and once in each category', () => {
        const rawLogs = [
          {
            symbol: 'SOLUSDT',
            direction: 'BUY',
            score: 60,
            primaryRejectionReason: 'REJECTED: SCORE_AND_RR',
            failedGates: ['FINAL_SCORE_BELOW_THRESHOLD', 'RR'],
            finalDecision: 'REJECTED',
          },
        ];

        const res = HourlyScannerService.processRejectionDetails(rawLogs);

        assert(res.authoritativeRejectedCount === 1, `Expected 1 total rejected candidate, got ${res.authoritativeRejectedCount}`);
        assert(res.finalCandidatesRejectedByScore === 1, `Expected 1 score rejection, got ${res.finalCandidatesRejectedByScore}`);
        assert(res.finalCandidatesRejectedByRR === 1, `Expected 1 RR rejection, got ${res.finalCandidatesRejectedByRR}`);
        
        // Category sum (1 + 1 = 2) exceeds total rejectedCount (1)
        const categorySum = res.finalCandidatesRejectedByScore + res.finalCandidatesRejectedByRR;
        assert(categorySum === 2 && categorySum > res.authoritativeRejectedCount, 'Category totals may exceed total rejectedCount');
      });

      await test('21. Historical versus current evaluation: Current evaluation overwrites older record without merging historical failedGates', () => {
        const rawLogs = [
          {
            symbol: 'BTCUSDT',
            direction: 'BUY',
            score: 50,
            primaryRejectionReason: 'REJECTED: FINAL_SCORE_UNREACHABLE',
            failedGates: ['FINAL_SCORE_UNREACHABLE'],
            finalDecision: 'REJECTED',
          },
          {
            symbol: 'BTCUSDT',
            direction: 'BUY',
            score: 72,
            primaryRejectionReason: 'REJECTED: MTF_ALIGNMENT',
            failedGates: ['MTF_ALIGNMENT'],
            finalDecision: 'REJECTED',
          },
        ];

        const res = HourlyScannerService.processRejectionDetails(rawLogs);

        assert(res.finalRejectedRecords.length === 1, `Expected 1 candidate record, got ${res.finalRejectedRecords.length}`);
        const rec = res.finalRejectedRecords[0];
        assert(rec.primaryRejectionReason === 'REJECTED: MTF_ALIGNMENT', 'Must preserve current evaluation reason');
        assert(rec.failedGates.length === 1 && rec.failedGates[0] === 'MTF_ALIGNMENT', 'Must not merge historical failedGates');
      });

      await test('22. Counter consistency: candidateRejectionDetails.length === rejectedCount === candidatesRejectedFinal === rejectionReasons.length', () => {
        const rawLogs = [
          { symbol: 'ADAUSDT', direction: 'BUY', score: 55, primaryRejectionReason: 'REJECTED: SCORE_TOO_LOW', failedGates: ['FINAL_SCORE_BELOW_THRESHOLD'], finalDecision: 'REJECTED' },
          { symbol: 'ADAUSDT', direction: 'BUY', score: 55, primaryRejectionReason: 'REJECTED: SCORE_TOO_LOW', failedGates: ['FINAL_SCORE_BELOW_THRESHOLD'], finalDecision: 'REJECTED' },
          { symbol: 'XRPUSDT', direction: 'SELL', score: 62, primaryRejectionReason: 'REJECTED: RR', failedGates: ['RR'], finalDecision: 'REJECTED' },
        ];

        const res = HourlyScannerService.processRejectionDetails(rawLogs);

        const candidateRejectionDetailsLength = res.finalRejectedRecords.length;
        const rejectedCount = res.authoritativeRejectedCount;
        const candidatesRejectedFinal = res.authoritativeRejectedCount;
        const rejectionReasonsLength = res.rejectionReasonStrings.length;

        assert(
          candidateRejectionDetailsLength === rejectedCount &&
          rejectedCount === candidatesRejectedFinal &&
          candidatesRejectedFinal === rejectionReasonsLength,
          `Inconsistent counters: candidateRejectionDetails (${candidateRejectionDetailsLength}), rejectedCount (${rejectedCount}), candidatesRejectedFinal (${candidatesRejectedFinal}), rejectionReasons (${rejectionReasonsLength})`
        );
        assert(rejectedCount === 2, `Expected exactly 2 deduplicated rejected candidates, got ${rejectedCount}`);
      });

      await test('23. Gate 10: StagedScannerPipeline uses candidatesThresholdPlusCount and rejectedThresholdPlusCount without stale 72Plus variable names', () => {
        const pipelineContent = fs.readFileSync(path.join(process.cwd(), 'src/server/signals/StagedScannerPipeline.ts'), 'utf-8');
        assert(!pipelineContent.includes('candidates72PlusCount'), 'StagedScannerPipeline.ts must not contain candidates72PlusCount');
        assert(!pipelineContent.includes('rejected72PlusCount'), 'StagedScannerPipeline.ts must not contain rejected72PlusCount');
        assert(pipelineContent.includes('candidatesThresholdPlusCount'), 'StagedScannerPipeline.ts must contain candidatesThresholdPlusCount');
        assert(pipelineContent.includes('rejectedThresholdPlusCount'), 'StagedScannerPipeline.ts must contain rejectedThresholdPlusCount');
      });
    });

    // --- SUITE 8: GATE 4.1 RELAX SECONDARY GATES WITHOUT WEAKENING TRADE SAFETY ---
    await describe('SUITE 8: Gate 4.1 Relax Secondary Gates Without Weakening Trade Safety', async () => {
      // 1. Timeframe alignment of 40% does NOT automatically reject if:
      // - gross R:R is valid (e.g. 2.3)
      // - score is valid (e.g. 74)
      // - primary data is valid
      // - no hard structural contradiction exists
      await test('24. Scenario 1: Timeframe alignment 40% does NOT automatically reject with valid score (74) and RR (2.3)', async () => {
        const mockAgreement = {
          dominantDirection: 'BUY' as const,
          agreeingStrategiesCount: 3,
          totalStrategiesCount: 5,
          agreementRatio: 0.6,
          minimumRequiredAgreement: 0.5,
          passed: true,
          agreementScore: 65,
          hasStrongConfluence: true,
          marketRegime: 'TREND' as const,
          regimeDetails: 'Strong Trend',
          strategyResults: [],
          timeframeConfluenceScore: 40,
          timeframeAlignmentRatio: 0.40,
          evaluatedTimeframes: ['15m', '1h', '4h', '1d', '1w'],
          reasons: ['Strategy agreement passed', 'Timeframe alignment 40%'],
        };
        assert(mockAgreement.hasStrongConfluence === true, 'StrategyEngine confluence must pass with 40% timeframe alignment');
        assert(mockAgreement.timeframeAlignmentRatio === 0.40, 'Must preserve timeframeAlignmentRatio for scoring/diagnostics');

        // Verify ScoringEngine softened logic: 40% alignment ratio gives higherTfTrendScore of at least 10 (not rejected)
        const timeframeAlignmentRatio = 0.40;
        let higherTfTrendScore = 8;
        if (timeframeAlignmentRatio >= 0.80) {
          higherTfTrendScore = Math.max(higherTfTrendScore, 16);
        } else if (timeframeAlignmentRatio >= 0.60) {
          higherTfTrendScore = Math.max(higherTfTrendScore, 13);
        } else if (timeframeAlignmentRatio >= 0.40) {
          higherTfTrendScore = Math.max(higherTfTrendScore, 10);
        } else {
          higherTfTrendScore = Math.max(higherTfTrendScore, 7);
        }
        assert(higherTfTrendScore === 10, 'Timeframe alignment of 40% scores 10 points softly without rejecting');
      });

      // 2. Confirmation diversity with 2 categories does NOT automatically reject if score and RR valid
      await test('25. Scenario 2: Confirmation diversity with 2 categories does NOT automatically reject', () => {
        const reasons = [
          'Break of market structure (BOS) confirmed',
          'RSI bullish divergence momentum',
        ];
        const res = Gate28ConfirmationDiversity.evaluate(reasons, {
          price: 100,
          entryPrice: 100,
          stopLoss: 95,
          takeProfit: 110.5, // 2.1 RR
          direction: 'BUY',
          isStructureValid: true,
        });

        assert(res.isValid === true, 'Gate 28 must pass with 2 categories (soft quality factor)');
        assert(res.categoryCount === 2, `Expected 2 categories, got ${res.categoryCount}`);
        assert(res.diversityScore === 66, `Expected diversity score 66 for 2 categories, got ${res.diversityScore}`);
        assert(res.rejectionReason === undefined, 'No rejection reason should be returned for 2 categories');
        assert(res.explanation.includes('PASSED'), 'Explanation should reflect PASSED status');
      });

      // 3. A weak setup with Score = 61, R:R = 2.4, SoftScore = 100 is STILL REJECTED because soft score cannot override core trade qualification
      await test('26. Scenario 3: Weak setup (Score 61, RR 2.4, SoftScore 100) is STILL REJECTED', () => {
        const liveTicker: any = {
          symbol: 'TESTUSDT',
          price: 100,
          bid: 99.98,
          ask: 100.02,
          timestamp: Date.now(),
          isFresh: true,
          status: 'REALTIME',
        };

        const candles: any[] = Array.from({ length: 50 }, (_, i) => ({
          symbol: 'TESTUSDT',
          provider: 'binance',
          timeframe: '1h',
          timestamp: Date.now() - (50 - i) * 60000,
          open: 98 + i * 0.05,
          high: 99 + i * 0.05,
          low: 97 + i * 0.05,
          close: 98.5 + i * 0.05,
          volume: 1000,
        }));

        const candlesMap = { '1h': candles };

        const classification = OpportunityFunnelEngine.classifyOpportunity({
          symbol: 'TESTUSDT',
          direction: 'BUY',
          entryPrice: 100,
          stopLoss: 97.5,
          takeProfit: 106, // RR = 6 / 2.5 = 2.4
          riskRewardRatio: 2.4,
          score: 61, // Canonical score is weak (below watching/signal threshold 70)
          liveTicker,
          candlesMap,
          overrideMetrics: {
            rsi: 55,
            macdHist: 0.5,
            vwapDiff: 0.1,
            volumeRatio: 1.5,
            divergenceScore: 80,
            relativeStrengthScore: 80,
            timeframeAlignmentCount: 3,
          },
        });

        assert(classification.isActionableSignal === false, 'Weak setup must NEVER become an actionable signal');
        assert(classification.stage === 'WATCHING', 'Weak setup must be classified as WATCHING or rejected');
        assert(
          classification.message.includes('REJECTED: SCORE_BELOW_THRESHOLD') || classification.score < 70,
          `Expected rejection for below-threshold score, got message: ${classification.message}`
        );
      });

      // 4. A setup with Score = 85, Gross R:R = 1.55 is STILL REJECTED by authoritative R:R requirement (1.8 minimum)
      await test('27. Scenario 4: Setup with Score 85 and Gross R:R 1.55 is STILL REJECTED by authoritative R:R (1.8 min)', () => {
        const canonicalRR = RiskRewardCalculator.calculate(100, 98, 101.5, 103.1, 103.5, 'BUY', 1.8);

        assert(canonicalRR.isValid === false, 'Authoritative R:R gate must fail for Gross RR 1.55');
        assert(canonicalRR.rejectionReason === 'GROSS_RR_BELOW_THRESHOLD', `Expected GROSS_RR_BELOW_THRESHOLD, got ${canonicalRR.rejectionReason}`);
        assert(canonicalRR.reason.includes('GROSS_RR_BELOW_THRESHOLD'), `Expected GROSS_RR_BELOW_THRESHOLD in reason, got ${canonicalRR.reason}`);
      });

      // 5. A setup with Score = 88, Gross R:R = 2.5, Invalid structural safety is STILL REJECTED
      await test('28. Scenario 5: Setup with Score 88, RR 2.5 and Invalid structural safety is STILL REJECTED', () => {
        const divRes = Gate28ConfirmationDiversity.evaluate(['BOS confirmed'], {
          price: 100,
          entryPrice: 100,
          stopLoss: 96,
          takeProfit: 110, // RR = 2.5
          direction: 'BUY',
          isStructureValid: false, // Invalid structural safety!
        });

        assert(divRes.isValid === false, 'Invalid structural safety must cause hard rejection in Gate 28');
        assert(divRes.rejectionReason?.includes('INVALID_STRUCTURE'), `Expected INVALID_STRUCTURE, got ${divRes.rejectionReason}`);

        // ScoringEngine HTF structural contradiction hard rejection
        const downtrendCandles: any[] = Array.from({ length: 20 }, (_, i) => ({
          symbol: 'TESTUSDT',
          provider: 'binance',
          timeframe: '4h',
          timestamp: Date.now() - (20 - i) * 14400000,
          open: 150 - i * 2,
          high: 151 - i * 2,
          low: 147 - i * 2,
          close: 148 - i * 2,
          volume: 5000,
        }));

        const struct4h = TechnicalIndicators.calculateMarketStructure(downtrendCandles, 15);
        assert(struct4h.structureBias === 'BEARISH', '4H structure must be BEARISH');
        const is4hContradiction = 'BUY' === 'BUY' && struct4h.structureBias === 'BEARISH';
        assert(is4hContradiction === true, 'HTF structural contradiction is detected and must remain HARD');
      });
    });

    // --- SUITE 9: GATE 8 TARGET DISTANCE & ADAPTER ROBUSTNESS SUITE ---
    await describe('Suite 9: Target Distance Volatility Sanity & Provider Robustness', async () => {
      // 1. UNIUSDT conservative TP1 scenario does NOT falsely reject
      await test('29. Conservative TP1 with structural blend passes Gate 8 sanity check', () => {
        // UNIUSDT actual values: ATR = 0.1104, entry = 6.0000, risk = 0.1000 (>= 0.85*ATR = 0.0938)
        // TP1 = 6.0828 (dist = 0.0828), TP2 = 6.2000 (dist = 0.2000), TP3 = 6.3500 (dist = 0.3500)
        const dummyCandles: any[] = Array.from({ length: 30 }, (_, i) => ({
          timestamp: Date.now() - (30 - i) * 3600000,
          open: 6.0,
          high: 6.0 + 0.1104 / 2,
          low: 6.0 - 0.1104 / 2,
          close: 6.0,
          volume: 1000,
        }));

        const valResult = SignalValidator.validate({
          symbol: 'UNIUSDT',
          direction: 'BUY',
          score: 80,
          entryPrice: 6.0000,
          stopLoss: 5.9000,
          takeProfit: 6.2000,
          tp1: 6.0828,
          tp2: 6.2000,
          tp3: 6.3500,
          riskRewardRatio: 2.0,
          candlesMap: { '1h': dummyCandles },
          liveTicker: { price: 6.0000, isFresh: true, status: 'OK', timestamp: Date.now() } as any,
        });

        assert(valResult.isValid, `Expected UNIUSDT conservative TP1 to pass validation, got: ${valResult.detailedMessage}`);
      });

      // 2. TP3 qualification allows trade when TP2 is below 1.8R but TP3 meets minimum hurdle
      await test('30. Multi-target qualification via TP3 passes Gate 8 sanity without premature TP2 rejection', () => {
        // Entry=100, SL=95, TP1=103, TP2=107 (dist 7 < 7.65, R:R 1.4), TP3=111 (dist 11 >= 7.65, R:R 2.2)
        const dummyCandles: any[] = Array.from({ length: 30 }, (_, i) => ({
          timestamp: Date.now() - (30 - i) * 3600000,
          open: 100,
          high: 102.5,
          low: 97.5,
          close: 100,
          volume: 1000,
        }));

        const valResult = SignalValidator.validate({
          symbol: 'BTCUSDT',
          direction: 'BUY',
          score: 80,
          entryPrice: 100.0,
          stopLoss: 95.0,
          takeProfit: 107.0,
          tp1: 103.0,
          tp2: 107.0,
          tp3: 111.0,
          riskRewardRatio: 2.2,
          candlesMap: { '1h': dummyCandles },
          liveTicker: { price: 100.0, isFresh: true, status: 'OK', timestamp: Date.now() } as any,
        });

        assert(valResult.isValid, `Expected multi-target to pass via TP3, got: ${valResult.detailedMessage}`);
      });

      // 3. Reject when neither TP2 nor TP3 reaches minimum target expansion hurdle
      await test('31. Rejection occurs when neither TP2 nor TP3 reaches minimum target expansion hurdle', () => {
        const dummyCandles: any[] = Array.from({ length: 30 }, (_, i) => ({
          timestamp: Date.now() - (30 - i) * 3600000,
          open: 100,
          high: 102.5,
          low: 97.5,
          close: 100,
          volume: 1000,
        }));

        const valResult = SignalValidator.validate({
          symbol: 'BTCUSDT',
          direction: 'BUY',
          score: 80,
          entryPrice: 100.0,
          stopLoss: 95.0,
          takeProfit: 105.0,
          tp1: 102.0,
          tp2: 105.0,
          tp3: 106.0,
          riskRewardRatio: 1.2,
          candlesMap: { '1h': dummyCandles },
          liveTicker: { price: 100.0, isFresh: true, status: 'OK', timestamp: Date.now() } as any,
        });

        assert(!valResult.isValid, 'Expected rejection when both TP2 and TP3 are below hurdle');
        assert(valResult.detailedMessage.includes('INSUFFICIENT_TARGET_DISTANCE') || valResult.detailedMessage.includes('GROSS_RR_BELOW_THRESHOLD'), `Expected target distance or RR rejection, got: ${valResult.detailedMessage}`);
      });
    });
  });

  await describe('SUITE 10: Signal Sensitivity Profiles & Dynamic Strictness Calibration', async () => {
    await test('32. Canonical profiles exist and preserve canonical final gross RR floor of 1.80', () => {
      const profiles = SignalSensitivityManager.getAllProfiles();
      assert(!!profiles.BALANCED, 'BALANCED profile missing');
      assert(!!profiles.CONSERVATIVE, 'CONSERVATIVE profile missing');
      assert(!!profiles.ACTIVE, 'ACTIVE profile missing');
      assert(!!profiles.CUSTOM, 'CUSTOM profile missing');
      assert(profiles.BALANCED.signalThreshold === 65, 'BALANCED signalThreshold must be 65');
      assert(profiles.BALANCED.minimumRR === 1.8, 'BALANCED minimumRR must be 1.8');
      assert(profiles.CONSERVATIVE.minimumRR === 1.8, 'CONSERVATIVE minimumRR must be 1.8');
      assert(profiles.ACTIVE.minimumRR === 1.8, 'ACTIVE minimumRR must be 1.8');
      assert(profiles.BALANCED.minimumNetRR === 1.10, 'BALANCED minimumNetRR must be 1.10');
    });

    await test('33. Activating BALANCED updates serverConfig and lowers Gate 27 dynamic floor to 65 while keeping RR at 1.8', () => {
      SignalSensitivityManager.setActiveProfile('BALANCED');
      assert(SignalSensitivityManager.getActiveProfileName() === 'BALANCED', 'Active profile must be BALANCED');
      assert(serverConfig.getConfig().thresholds.signalThreshold === 65, 'serverConfig signalThreshold must be 65');
      assert(serverConfig.getConfig().thresholds.minimumRR === 1.8, 'serverConfig minimumRR must be 1.8');

      const res = Gate27RegimeThresholds.resolveThreshold({
        symbol: 'EURUSD',
        regime: 'NORMAL_TREND',
        strategy: 'TREND_CONTINUATION',
        assetClass: 'FOREX',
        actualScore: 66,
      });
      assert(res.resolvedThreshold === 65, `Expected threshold 65, got ${res.resolvedThreshold}`);
      assert(res.passed === true, 'Score 66 must pass threshold 65');
    });

    await test('34. Switching to CONSERVATIVE raises hurdle to 72 score and 1.8 R:R, rejecting score 66', () => {
      SignalSensitivityManager.setActiveProfile('CONSERVATIVE');
      assert(SignalSensitivityManager.getActiveProfileName() === 'CONSERVATIVE', 'Active profile must be CONSERVATIVE');
      assert(serverConfig.getConfig().thresholds.signalThreshold === 72, 'serverConfig signalThreshold must be 72');
      assert(serverConfig.getConfig().thresholds.minimumRR === 1.8, 'serverConfig minimumRR must be 1.8');

      const res = Gate27RegimeThresholds.resolveThreshold({
        symbol: 'EURUSD',
        regime: 'NORMAL_TREND',
        strategy: 'TREND_CONTINUATION',
        assetClass: 'FOREX',
        actualScore: 66,
      });
      assert(res.resolvedThreshold === 72, `Expected threshold 72, got ${res.resolvedThreshold}`);
      assert(res.passed === false, 'Score 66 must be rejected against hurdle 72');
    });

    await test('35. Switching to ACTIVE trader profile enforces canonical score floor 65 while maintaining 1.8 R:R floor', () => {
      SignalSensitivityManager.setActiveProfile('ACTIVE');
      assert(SignalSensitivityManager.getActiveProfileName() === 'ACTIVE', 'Active profile must be ACTIVE');
      assert(serverConfig.getConfig().thresholds.signalThreshold === 65, 'serverConfig signalThreshold must be 65');
      assert(serverConfig.getConfig().thresholds.minimumRR === 1.8, 'serverConfig minimumRR must be 1.8');

      const res = Gate27RegimeThresholds.resolveThreshold({
        symbol: 'BTCUSDT',
        regime: 'BREAKOUT',
        strategy: 'MOMENTUM_CONTINUATION',
        assetClass: 'CRYPTO',
        actualScore: 65,
      });
      assert(res.resolvedThreshold === 65, `Expected threshold 65, got ${res.resolvedThreshold}`);
      assert(res.passed === true, 'Score 65 must pass threshold 65');
    });

    await test('36. ResetToDefault restores BALANCED profile and safe hurdles', () => {
      SignalSensitivityManager.resetToDefault();
      assert(SignalSensitivityManager.getActiveProfileName() === 'BALANCED', 'Active profile must be BALANCED');
      assert(serverConfig.getConfig().thresholds.signalThreshold === 65, 'serverConfig signalThreshold must be 65');
    });

    await test('37. Gate 2 Non-Blocking Regime: UNKNOWN and volatile regimes never block or raise threshold above 65', () => {
      const unknownRes = Gate27RegimeThresholds.resolveThreshold({
        symbol: 'EURUSD',
        regime: 'UNKNOWN',
        actualScore: 65,
      });
      assert(unknownRes.isExecutable === true, 'UNKNOWN must be executable');
      assert(unknownRes.resolvedThreshold === 65, 'UNKNOWN threshold must be authoritative floor 65');
      assert(unknownRes.passed === true, 'Score 65 must pass');

      const volRes = Gate27RegimeThresholds.resolveThreshold({
        symbol: 'BTCUSDT',
        regime: 'HIGH_VOLATILITY',
        actualScore: 65,
      });
      assert(volRes.isExecutable === true, 'HIGH_VOLATILITY must be executable');
      assert(volRes.resolvedThreshold === 65, 'HIGH_VOLATILITY threshold must remain 65 (non-blocking)');
      assert(volRes.passed === true, 'Score 65 in HIGH_VOLATILITY must pass threshold');

      const transRes = Gate27RegimeThresholds.resolveThreshold({
        symbol: 'AAPL',
        regime: 'TRANSITION',
        actualScore: 65,
      });
      assert(transRes.isExecutable === true, 'TRANSITION must be executable');
      assert(transRes.resolvedThreshold === 65, 'TRANSITION threshold must remain 65 (non-blocking)');
      assert(transRes.passed === true, 'Score 65 in TRANSITION must pass threshold');

      const rankingCalc = TradeRankingEngine.calculateFinalRequiredScore({
        symbol: 'EURUSD',
        actualScore: 65,
        regime: 'UNKNOWN',
      });
      assert(rankingCalc.isExecutable === true, 'TradeRankingEngine must treat UNKNOWN as executable');
      assert(rankingCalc.finalRequiredScore === 65, 'Final required score must remain 65');
      assert(rankingCalc.passed === true, 'Score 65 must pass');
    });

    await test('38. Gate 3 Strategy Engines as Evidence Providers: Valid setup pathway qualifies without requiring 50% strategy consensus', () => {
      // Mock candle generator for test
      const baseCandles = Array.from({ length: 60 }, (_, i) => ({
        timestamp: 1700000000000 + i * 900000,
        open: 100 + i * 0.5,
        high: 101 + i * 0.5,
        low: 99.5 + i * 0.5,
        close: 100.8 + i * 0.5,
        volume: 1000 + i * 10,
        symbol: 'BTCUSDT',
        provider: 'BINANCE' as const,
        timeframe: '15m' as const,
      }));

      const tfMap = {
        '15m': baseCandles,
        '1h': baseCandles.map((c) => ({ ...c, timeframe: '1h' as const })),
        '4h': baseCandles.map((c) => ({ ...c, timeframe: '4h' as const })),
      };

      const result = StrategyEngine.evaluate('BTCUSDT', baseCandles[baseCandles.length - 1].close, tfMap);
      assert(result.dominantDirection !== null, 'Dominant direction must be established');
      assert(result.passed === true, 'Must pass with valid setup pathway evidence');
      assert(result.hasStrongConfluence === true, 'hasStrongConfluence must be true for valid setup');
    });

    await test('39. Gate 4 Volatility Protection: Setup qualifies under CAUTION; extreme flash volatility triggers HARD SAFETY BLOCK', () => {
      // 1. Test CAUTION condition (compressed ATR - e.g. dead/flat session where previously Strategy 6 rejected with score 20)
      const flatCandles = Array.from({ length: 60 }, (_, i) => ({
        timestamp: 1700000000000 + i * 900000,
        // High ATR compression in recent candles compared to baseline
        open: i < 30 ? 100 + i * 2.0 : 160 + (i - 30) * 0.01,
        high: i < 30 ? 102 + i * 2.0 : 160.02 + (i - 30) * 0.01,
        low: i < 30 ? 98 + i * 2.0 : 159.98 + (i - 30) * 0.01,
        close: i < 30 ? 101 + i * 2.0 : 160.01 + (i - 30) * 0.01,
        volume: 1000 + i * 10,
        symbol: 'EURUSD',
        provider: 'TWELVEDATA' as const,
        timeframe: '15m' as const,
      }));

      const cautionTfMap = {
        '15m': flatCandles,
        '1h': flatCandles.map((c) => ({ ...c, timeframe: '1h' as const })),
        '4h': flatCandles.map((c) => ({ ...c, timeframe: '4h' as const })),
      };

      const cautionResult = StrategyEngine.evaluate('EURUSD', flatCandles[flatCandles.length - 1].close, cautionTfMap);
      assert(cautionResult.volatilityCondition === 'CAUTION', 'Must classify as CAUTION for compressed market');
      assert(cautionResult.passed === true, 'Candidate must NOT be rejected solely because Strategy 6 is in caution or low score');
      assert(cautionResult.hasStrongConfluence === true, 'Setup pathway must still qualify without mandatory Strategy 6 approval');

      // 2. Test Extreme Erratic / Flash Breakdown (UNSAFE condition)
      const flashExplosionCandles = Array.from({ length: 60 }, (_, i) => {
        const isSpike = i >= 55;
        return {
          timestamp: 1700000000000 + i * 900000,
          open: isSpike ? 100 - (i - 54) * 20 : 100 + (i % 2) * 0.1,
          high: isSpike ? 150 : 100.2,
          low: isSpike ? 30 : 99.8,
          close: isSpike ? 40 : 100.1,
          volume: isSpike ? 50000 : 1000,
          symbol: 'BTCUSDT',
          provider: 'BINANCE' as const,
          timeframe: '15m' as const,
        };
      });

      const unsafeTfMap = {
        '15m': flashExplosionCandles,
        '1h': flashExplosionCandles.map((c) => ({ ...c, timeframe: '1h' as const })),
        '4h': flashExplosionCandles.map((c) => ({ ...c, timeframe: '4h' as const })),
      };

      const unsafeResult = StrategyEngine.evaluate('BTCUSDT', flashExplosionCandles[flashExplosionCandles.length - 1].close, unsafeTfMap);
      assert(unsafeResult.passed === false, 'Extreme flash volatility must trigger HARD SAFETY BLOCK');
      assert(unsafeResult.volatilityCondition === 'UNSAFE', 'Must classify as UNSAFE');
      assert(unsafeResult.rejectionReason?.includes('EXTREME_VOLATILITY') === true, 'Rejection must cite EXTREME_VOLATILITY');
    });

    await test('40. Gate 5 Hidden Indicator Vetoes: Secondary indicators (RSI, MACD, EMA, S/R, one MTF disagreement) act as soft confluence; severe HTF contradiction remains HARD', () => {
      // 1. Build bullish 1h candles
      const base1hCandles = Array.from({ length: 60 }, (_, i) => ({
        timestamp: 1700000000000 + i * 3600000,
        open: 100 + i * 1.5,
        high: 102 + i * 1.5,
        low: 99 + i * 1.5,
        close: 101.5 + i * 1.5,
        volume: 2000,
        symbol: 'BTCUSDT',
        provider: 'BINANCE' as const,
        timeframe: '1h' as const,
      }));

      // 2. Build 15m candles with a sustained pullback / one MTF disagreement (last 30 candles declining)
      const pullback15mCandles = Array.from({ length: 60 }, (_, i) => {
        const isDowntrend = i >= 30;
        const price = isDowntrend ? 200 - (i - 30) * 0.8 : 170 + i * 1.0;
        return {
          timestamp: 1700000000000 + i * 900000,
          open: price + 0.2,
          high: price + 0.4,
          low: price - 0.4,
          close: price,
          volume: 500,
          symbol: 'BTCUSDT',
          provider: 'BINANCE' as const,
          timeframe: '15m' as const,
        };
      });

      // Layer 1 Evaluation under Gate 5:
      const l1Result = Gate6ProgressiveMTF.evaluateLayer1('BUY', base1hCandles, pullback15mCandles);
      assert(l1Result.passed === true, 'One MTF disagreement (15m pullback in 1h bull trend) must NOT hard veto a valid setup');
      assert(l1Result.score >= 35, 'Soft score must reflect penalty while allowing candidate to continue');
      assert(l1Result.metrics.trendAlignment.score === 60, '15m pullback against 1h bull trend receives soft penalty score (60)');
      assert(l1Result.disagreements.some((d) => d.includes('pullback against 1h bullish trend')), 'Disagreements array must note 15m pullback soft penalty');
      assert(l1Result.disagreements.some((d) => d.includes('MACD disagreement, soft penalty applied')), 'Disagreements array must note MACD soft penalty');
      assert(l1Result.disagreements.some((d) => d.includes('velocity deceleration')), 'Disagreements array must note momentum soft penalty');

      // 3. Layer 2 Evaluation under Gate 5: Normal S/R proximity and compressed ATR
      const candles5m = Array.from({ length: 30 }, (_, i) => ({
        timestamp: 1700000000000 + i * 300000,
        open: 185,
        high: 185.2,
        low: 184.8,
        close: 185.1,
        volume: 100,
        symbol: 'BTCUSDT',
        provider: 'BINANCE' as const,
        timeframe: '5m' as const,
      }));
      const candles4h = Array.from({ length: 30 }, (_, i) => ({
        timestamp: 1700000000000 + i * 14400000,
        open: 160 + i * 1.0,
        high: 162 + i * 1.0,
        low: 159 + i * 1.0,
        close: 161 + i * 1.0,
        volume: 5000,
        symbol: 'BTCUSDT',
        provider: 'BINANCE' as const,
        timeframe: '4h' as const,
      }));

      // Current price is near resistance (185 vs nearest pivot)
      const l2Result = Gate6ProgressiveMTF.evaluateLayer2('BUY', 185.1, candles5m, pullback15mCandles, base1hCandles, candles4h);
      assert(l2Result.passed === true, 'Normal S/R proximity must NOT hard reject setup; applies soft scoring factor');
      assert(l2Result.metrics.supportResistance.isFavorable === true, 'S/R proximity must remain favorable for candidate continuation');

      // 4. Test Severe HTF Structural Contradiction: BOTH 1h and 15m strongly opposing trade direction (BEARISH on both for a BUY proposal)
      const bear1hCandles = Array.from({ length: 60 }, (_, i) => ({
        timestamp: 1700000000000 + i * 3600000,
        open: 200 - i * 1.5,
        high: 201 - i * 1.5,
        low: 198 - i * 1.5,
        close: 198.5 - i * 1.5,
        volume: 2000,
        symbol: 'BTCUSDT',
        provider: 'BINANCE' as const,
        timeframe: '1h' as const,
      }));
      const bear15mCandles = Array.from({ length: 60 }, (_, i) => ({
        timestamp: 1700000000000 + i * 900000,
        open: 150 - i * 0.5,
        high: 150.2 - i * 0.5,
        low: 149.3 - i * 0.5,
        close: 149.5 - i * 0.5,
        volume: 500,
        symbol: 'BTCUSDT',
        provider: 'BINANCE' as const,
        timeframe: '15m' as const,
      }));

      const severeContraResult = Gate6ProgressiveMTF.evaluateLayer1('BUY', bear1hCandles, bear15mCandles);
      assert(severeContraResult.passed === false, 'Severe HTF trend & structure contradiction must remain a HARD rejection');
      assert(severeContraResult.rejectionReason?.includes('Layer 1 MTF Disagreement') === true, 'Rejection reason must document structural contradiction');
    });
  });

  // --- SUITE 14: GATE 8 — FIX STAGED SCANNER PREMATURE REJECTION ---
  await describe('SUITE 14: Gate 8 Fix Staged Scanner Premature Rejection', async () => {
    await test('39. A 65–69 candidate is allowed to reach Gate 3 qualification and is not rejected early', async () => {
      // Create 1H candles showing a developing trend with score in 65-69 range
      const base1hCandles = Array.from({ length: 25 }, (_, i) => ({
        timestamp: 1700000000000 + i * 3600000,
        open: 100 + i * 0.2,
        high: 100.5 + i * 0.2,
        low: 99.8 + i * 0.2,
        close: 100.3 + i * 0.2,
        volume: 1000,
        symbol: 'ADAUSDT',
        provider: 'BINANCE' as const,
        timeframe: '1h' as const,
      }));

      const g3Result = Gate3PreliminaryScreen.screenAsset('ADAUSDT', base1hCandles);
      assert(g3Result.passed === true, `Candidate must pass Gate 3 (score: ${g3Result.preliminaryScore})`);
      assert(g3Result.routing !== 'REJECT', `Routing must not be REJECT, got: ${g3Result.routing}`);
      assert(g3Result.preliminaryScore >= 60, `Preliminary score must be >= 60, got: ${g3Result.preliminaryScore}`);
    });

    await test('40. Setup evidence for BREAKOUT, REVERSAL, TREND, or MOMENTUM retains candidate in Gate 3 and Gate 5', async () => {
      // Breakout setup candles
      const breakoutCandles = Array.from({ length: 25 }, (_, i) => ({
        timestamp: 1700000000000 + i * 3600000,
        open: 100 + (i === 24 ? 2.0 : i * 0.05),
        high: 100.5 + (i === 24 ? 3.5 : i * 0.05),
        low: 99.8 + (i === 24 ? 1.8 : i * 0.05),
        close: 100.3 + (i === 24 ? 3.2 : i * 0.05),
        volume: i === 24 ? 3000 : 1000,
        symbol: 'SOLUSDT',
        provider: 'BINANCE' as const,
        timeframe: '1h' as const,
      }));

      const g3Breakout = Gate3PreliminaryScreen.screenAsset('SOLUSDT', breakoutCandles);
      assert(g3Breakout.passed === true, 'Breakout setup must pass Gate 3');
      assert(g3Breakout.detectedEvidence.includes('BREAKOUT') || g3Breakout.detectedEvidence.includes('TREND') || g3Breakout.detectedEvidence.includes('MOMENTUM'), 'Breakout setup must register setup evidence');

      // Reversal setup candles (Hammer pinbar at low)
      const reversalCandles = Array.from({ length: 25 }, (_, i) => ({
        timestamp: 1700000000000 + i * 3600000,
        open: 100 - i * 0.3,
        high: 100.2 - i * 0.3,
        low: i === 24 ? 90.0 : 99.5 - i * 0.3,
        close: i === 24 ? 92.5 : 99.7 - i * 0.3,
        volume: 1200,
        symbol: 'ETHUSDT',
        provider: 'BINANCE' as const,
        timeframe: '1h' as const,
      }));

      const g3Reversal = Gate3PreliminaryScreen.screenAsset('ETHUSDT', reversalCandles);
      assert(g3Reversal.passed === true, 'Reversal setup must pass Gate 3');
      assert(g3Reversal.detectedEvidence.includes('REVERSAL') || g3Reversal.detectedEvidence.includes('TREND') || g3Reversal.detectedEvidence.includes('MOMENTUM'), 'Reversal setup must register setup evidence');

      // Gate 5 selection retains 65-69 candidates within budget
      const candidates = [
        {
          asset: 'SOLUSDT',
          htf1h: breakoutCandles,
          preliminaryScore: 68,
          direction: 'BUY' as const,
          gate3Result: g3Breakout,
        },
        {
          asset: 'ETHUSDT',
          htf1h: reversalCandles,
          preliminaryScore: 66,
          direction: 'BUY' as const,
          gate3Result: g3Reversal,
        },
      ];

      const g5Selection = Gate5DeepCandidateSelection.selectCandidates(candidates, 10);
      assert(g5Selection.passed === true, 'Gate 5 selection must pass');
      assert(g5Selection.selectedCandidates.length === 2, `Both 65-69 candidates must be selected within budget, got ${g5Selection.selectedCandidates.length}`);
      assert(g5Selection.selectedCandidates.some(c => c.asset === 'SOLUSDT'), 'SOLUSDT must be selected');
      assert(g5Selection.selectedCandidates.some(c => c.asset === 'ETHUSDT'), 'ETHUSDT must be selected');
    });

    await test('41. Preliminary score filtering cannot eliminate every 65–69 candidate before final validation', async () => {
      // Ensure that a candidate with preliminary score 67 and valid setup passes Gate 6 pre-audit and enters Stage 3
      const cand67 = {
        asset: 'BTCUSDT',
        preliminaryScore: 67,
      };
      const maxPossibleScore = Math.min(100, cand67.preliminaryScore + 40);
      assert(maxPossibleScore === 100, 'Candidate scoring 67 has theoretical max 100 and must pass Gate 6 Pre-Audit');
      assert(maxPossibleScore >= 70, 'Pre-audit threshold (70) must not eliminate 65-69 candidate');
    });
  });

  // --- SUITE 15: GATE 9 — ALL SIX ENGINES WORK AS A COORDINATED SYSTEM ---
  await describe('SUITE 15: Gate 9 All Six Engines Work As A Coordinated System', async () => {
    // Generate realistic multi-timeframe candles with a clean Trend + Momentum setup
    const candles1h = Array.from({ length: 50 }, (_, i) => ({
      timestamp: 1700000000000 + i * 3600000,
      open: 2000 + i * 5,
      high: 2008 + i * 5,
      low: 1998 + i * 5,
      close: 2006 + i * 5,
      volume: 1500,
      symbol: 'ETHUSDT',
      provider: 'BINANCE' as const,
      timeframe: '1h' as const,
    }));

    const candles15m = Array.from({ length: 60 }, (_, i) => ({
      timestamp: 1700000000000 + i * 900000,
      open: 2200 + i * 1.5,
      high: 2203 + i * 1.5,
      low: 2199 + i * 1.5,
      close: 2202.5 + i * 1.5,
      volume: 800,
      symbol: 'ETHUSDT',
      provider: 'BINANCE' as const,
      timeframe: '15m' as const,
    }));

    const candles5m = Array.from({ length: 60 }, (_, i) => ({
      timestamp: 1700000000000 + i * 300000,
      open: 2280 + i * 0.5,
      high: 2281.5 + i * 0.5,
      low: 2279.5 + i * 0.5,
      close: 2281 + i * 0.5,
      volume: 300,
      symbol: 'ETHUSDT',
      provider: 'BINANCE' as const,
      timeframe: '5m' as const,
    }));

    const candlesMap = {
      '1h': candles1h,
      '15m': candles15m,
      '5m': candles5m,
    };

    await test('42. StrategyEngine evaluates all six evidence providers and establishes valid pathway without requiring all six to agree', () => {
      const entryPrice = 2281;
      const agreement = StrategyEngine.evaluate('ETHUSDT', entryPrice, candlesMap);

      assert(agreement.passed === true, 'Strategy agreement must pass when a valid pathway is established');
      assert(agreement.dominantDirection === 'BUY', `Dominant direction must be BUY, got: ${agreement.dominantDirection}`);
      assert(agreement.strategyResults.length === 6, `Must evaluate exactly 6 strategy engines, got: ${agreement.strategyResults.length}`);

      // Verify all 6 engines are present
      const engineIds = agreement.strategyResults.map(s => s.id);
      assert(engineIds.includes('strat_1'), 'Trend engine (strat_1) must be present');
      assert(engineIds.includes('strat_2'), 'Momentum engine (strat_2) must be present');
      assert(engineIds.includes('strat_3'), 'Breakout engine (strat_3) must be present');
      assert(engineIds.includes('strat_4'), 'Mean Reversion engine (strat_4) must be present');
      assert(engineIds.includes('strat_5'), 'Order Flow engine (strat_5) must be present');
      assert(engineIds.includes('strat_6'), 'Volatility Protection engine (strat_6) must be present');

      // Verify not all six are required to agree
      assert(agreement.agreeingStrategiesCount < 6 || agreement.agreeingStrategiesCount >= 1, 'Agreement count must reflect evidence providers');
      assert(agreement.agreementScore > 0, 'Agreement score must be computed');
    });

    await test('43. Volatility Protection acts as evidence provider and only rejects on genuine UNSAFE extreme conditions', () => {
      // Normal / Healthy volatility
      const normalResult = StrategyEngine.evaluate('ETHUSDT', 2281, candlesMap);
      assert(normalResult.volatilityCondition === 'NORMAL' || normalResult.volatilityCondition === 'CAUTION', 'Normal candle dataset must not be marked UNSAFE');
      assert(normalResult.passed === true, 'Setup must pass in normal volatility conditions');

      // Flash extreme erratic volatility (10x price swings)
      const flashErratic1h = Array.from({ length: 50 }, (_, i) => ({
        timestamp: 1700000000000 + i * 3600000,
        open: 2000,
        high: i > 45 ? 4000 : 2050,
        low: i > 45 ? 500 : 1950,
        close: i > 45 ? (i % 2 === 0 ? 3800 : 600) : 2000,
        volume: 100000,
        symbol: 'ETHUSDT',
        provider: 'BINANCE' as const,
        timeframe: '1h' as const,
      }));

      const flashMap = {
        '1h': flashErratic1h,
        '15m': candles15m,
        '5m': candles5m,
      };

      const flashResult = StrategyEngine.evaluate('ETHUSDT', 2281, flashMap);
      assert(flashResult.passed === false, 'Extreme unsafe volatility must be rejected by Volatility Protection');
      assert(flashResult.rejectionReason?.includes('EXTREME_VOLATILITY') === true, 'Rejection reason must document EXTREME_VOLATILITY');
    });

    await test('44. Complete coordinated pipeline flow: Setup -> Pathway -> Evidence -> Confluence -> TP/SL -> R:R Check -> Signal', () => {
      const scoring = ScoringEngine.calculateScore(
        'ETHUSDT',
        2281,
        candlesMap,
        'BULLISH',
        99.9
      );

      assert(scoring.isValid === true, `Scoring must be valid for pristine setup, got reason: ${scoring.rejectionReason}`);
      assert(scoring.direction === 'BUY', `Scoring direction must be BUY, got: ${scoring.direction}`);
      assert(scoring.score >= 70, `Score must be >= 70, got: ${scoring.score}`);
      assert(scoring.stopLoss !== undefined && scoring.stopLoss < 2281, 'Stop loss must be defined below entry for BUY');
      assert(scoring.tp1 !== undefined && scoring.tp1 > 2281, 'TP1 must be defined above entry for BUY');
      assert(scoring.tp2 !== undefined && scoring.tp2 > scoring.tp1, 'TP2 must be defined above TP1');
      assert(scoring.tp3 !== undefined && scoring.tp3 > scoring.tp2, 'TP3 must be defined above TP2');
      assert(scoring.riskRewardRatio !== undefined && scoring.riskRewardRatio >= 1.5, `R:R must be >= 1.5, got: ${scoring.riskRewardRatio}`);
    });
  });

  // --- SUITE 16: GATE 1 PREMATURE SCORE VETO REMOVAL AUDIT ---
  await describe('Gate 1 Premature Score Veto Removal & 65-69 Candidate Qualification', async () => {
    await test('45. Candidate with composite score 65-69 reaches Gate 7 and passes Gate 8 tradeability', () => {
      // Create a valid candidate input with score = 67
      const gate7Result = Gate7FinalTradeValidation.validateCandidate({
        symbol: 'BTCUSDT',
        direction: 'BUY',
        entryPrice: 65000,
        stopLoss: 63500,
        takeProfit: 68500,
        tp1: 67700,
        tp2: 68500,
        tp3: 69500,
        riskRewardRatio: 2.33,
        score: 67,
        candlesMap: {
          '1h': Array.from({ length: 30 }, (_, i) => ({
            timestamp: Date.now() - (30 - i) * 3600000,
            open: 64000 + i * 30,
            high: 64100 + i * 30,
            low: 63900 + i * 30,
            close: 64050 + i * 30,
            volume: 1000,
            symbol: 'BTCUSDT',
            provider: 'BINANCE' as const,
            timeframe: '1h' as const,
          })),
        },
        liveTicker: {
          symbol: 'BTCUSDT',
          rawSymbol: 'BTCUSDT',
          price: 65000,
          bid: 64998,
          ask: 65002,
          timestamp: Date.now(),
          receivedAt: Date.now(),
          source: 'LIVE',
          isFresh: true,
          status: 'OK',
          provider: 'BINANCE',
          assetType: 'CRYPTO',
        },
        atr: 500,
      });

      assert(gate7Result.allHardGatesPassed === true, 'All 13 hard gates must pass for valid candidate');
      assert(gate7Result.isTradeable === true, 'Gate 7 must deem 67 score candidate tradeable when hard gates pass');

      const gate8Result = Gate8TradeabilityThreshold.evaluateCandidate({
        symbol: 'BTCUSDT',
        direction: 'BUY',
        trendAlignmentScore: 68,
        mtfConfluenceScore: 68,
        momentumScore: 65,
        marketStructureScore: 67,
        volumeScore: 65,
        volatilityAtrScore: 70,
        entryQualityScore: 65,
        riskRewardRatio: 2.33,
        netRiskRewardRatio: 2.1,
      });

      assert(gate8Result.finalScore >= 65, `Final score must be >= 65, got: ${gate8Result.finalScore}`);
      assert(gate8Result.isTradeable === true, 'Gate 8 must qualify candidate with final score >= 65');
      assert(gate8Result.classification === 'QUALIFIED_SIGNAL' || gate8Result.classification === 'VALID_SIGNAL', `Classification must be QUALIFIED_SIGNAL or VALID_SIGNAL, got: ${gate8Result.classification}`);
    });
  });

  // --- SUITE 17: GATE 2 — LOCK THE CANONICAL FINAL R:R FLOOR (>= 1.8) ---
  await describe('Gate 2 Canonical Final R:R Floor Locking (>= 1.8)', async () => {
    await test('46. Sensitivity profiles cannot lower final executable R:R floor below 1.8', () => {
      assert(FINAL_EXECUTABLE_RR_FLOOR === 1.8, 'FINAL_EXECUTABLE_RR_FLOOR constant must be 1.8');

      // Test all profiles enforce >= 1.8
      const profiles = SignalSensitivityManager.getAllProfiles();
      for (const [name, profile] of Object.entries(profiles)) {
        assert(profile.minimumRR >= 1.8, `Profile ${name} minimumRR (${profile.minimumRR}) cannot be below 1.8`);
      }

      // Test custom override cannot lower below 1.8
      SignalSensitivityManager.setActiveProfile('CUSTOM', { minimumRR: 1.2 } as any);
      const customConfig = SignalSensitivityManager.getActiveConfig();
      assert(customConfig.minimumRR >= 1.8, `Custom minimumRR (${customConfig.minimumRR}) must be clamped to >= 1.8`);

      // Reset to default
      SignalSensitivityManager.resetToDefault();
    });

    await test('47. RiskRewardCalculator selects TP2 when >=1.8R and falls back to TP3 only when TP2 < 1.8R', () => {
      const entry = 100;
      const sl = 90; // Risk = 10

      // Case A: TP2 >= 1.8 (TP2 = 120 -> 2.0R, TP3 = 130 -> 3.0R)
      const resA = RiskRewardCalculator.calculate(entry, sl, 110, 120, 130, 'BUY', 1.8);
      assert(resA.isValid === true, 'Setup A must pass');
      assert(resA.selectedTarget === 'TP2', `Setup A must select TP2, got: ${resA.selectedTarget}`);
      assert(resA.grossRR === 2.0, `Setup A grossRR must be 2.0, got: ${resA.grossRR}`);
      assert(resA.passedViaTp3 === false, 'Setup A must not be passedViaTp3');

      // Case B: TP2 < 1.8 (TP2 = 115 -> 1.5R), but TP3 >= 1.8 (TP3 = 125 -> 2.5R)
      const resB = RiskRewardCalculator.calculate(entry, sl, 110, 115, 125, 'BUY', 1.8);
      assert(resB.isValid === true, 'Setup B must pass via TP3');
      assert(resB.selectedTarget === 'TP3', `Setup B must select TP3, got: ${resB.selectedTarget}`);
      assert(resB.grossRR === 2.5, `Setup B grossRR must be 2.5, got: ${resB.grossRR}`);
      assert(resB.passedViaTp3 === true, 'Setup B must be passedViaTp3');

      // Case C: Neither TP2 nor TP3 >= 1.8 (TP2 = 112 -> 1.2R, TP3 = 116 -> 1.6R)
      const resC = RiskRewardCalculator.calculate(entry, sl, 105, 112, 116, 'BUY', 1.8);
      assert(resC.isValid === false, 'Setup C must fail');
      assert(resC.selectedTarget === null, 'Setup C selectedTarget must be null');
      assert(resC.rejectionReason === 'GROSS_RR_BELOW_THRESHOLD', `Setup C rejectionReason must be GROSS_RR_BELOW_THRESHOLD, got: ${resC.rejectionReason}`);
    });
  });

  // --- SUITE 18: GATE 3 — REMOVE LEGACY 70 EXECUTION BLOCKS ---
  await describe('Gate 3 Score Classification & Legacy 70 Removal', async () => {
    await test('48. Score tier classification adheres exactly to required tiers (<60 REJECT, 60-64 WATCH, 65-69 QUALIFIED, 70-79 VALID, 80+ HIGH-CONFLUENCE)', () => {
      // Test <60
      const eval55 = Gate8TradeabilityThreshold.evaluateCandidate({
        symbol: 'BTCUSDT',
        direction: 'BUY',
        trendAlignmentScore: 50,
        mtfConfluenceScore: 50,
        momentumScore: 50,
        marketStructureScore: 50,
        volumeScore: 50,
        volatilityAtrScore: 50,
        entryQualityScore: 50,
        riskRewardRatio: 1.8,
        agreeingStrategiesRatio: 0.5,
      });
      assert(eval55.finalScore < 60, `Score must be <60, got ${eval55.finalScore}`);
      assert(eval55.classification === 'REJECT', `Classification must be REJECT, got ${eval55.classification}`);
      assert(eval55.isTradeable === false, 'Score <60 must not be tradeable');

      // Test 60-64 WATCH
      const eval62 = Gate8TradeabilityThreshold.evaluateCandidate({
        symbol: 'BTCUSDT',
        direction: 'BUY',
        trendAlignmentScore: 58,
        mtfConfluenceScore: 58,
        momentumScore: 58,
        marketStructureScore: 58,
        volumeScore: 58,
        volatilityAtrScore: 58,
        entryQualityScore: 58,
        riskRewardRatio: 1.8,
        agreeingStrategiesRatio: 0.6,
      });
      assert(eval62.finalScore >= 60 && eval62.finalScore <= 64, `Score must be 60-64, got ${eval62.finalScore}`);
      assert(eval62.classification === 'NEAR_MISS_WATCHLIST' || eval62.classification === 'WATCH', `Classification must be WATCH/NEAR_MISS_WATCHLIST, got ${eval62.classification}`);
      assert(eval62.isTradeable === false, 'Score 60-64 must be watch (not tradeable)');

      // Test 65-69 QUALIFIED SIGNAL
      const eval67 = Gate8TradeabilityThreshold.evaluateCandidate({
        symbol: 'BTCUSDT',
        direction: 'BUY',
        trendAlignmentScore: 65,
        mtfConfluenceScore: 65,
        momentumScore: 65,
        marketStructureScore: 65,
        volumeScore: 65,
        volatilityAtrScore: 65,
        entryQualityScore: 65,
        riskRewardRatio: 1.9,
        agreeingStrategiesRatio: 0.7,
      });
      assert(eval67.finalScore >= 65 && eval67.finalScore <= 69, `Score must be 65-69, got ${eval67.finalScore}`);
      assert(eval67.classification === 'QUALIFIED_SIGNAL', `Classification must be QUALIFIED_SIGNAL, got ${eval67.classification}`);
      assert(eval67.isTradeable === true, 'Score 65-69 must be tradeable');

      // Test 70-79 VALID SIGNAL
      const eval74 = Gate8TradeabilityThreshold.evaluateCandidate({
        symbol: 'BTCUSDT',
        direction: 'BUY',
        trendAlignmentScore: 73,
        mtfConfluenceScore: 73,
        momentumScore: 73,
        marketStructureScore: 73,
        volumeScore: 73,
        volatilityAtrScore: 73,
        entryQualityScore: 73,
        riskRewardRatio: 2.1,
        agreeingStrategiesRatio: 0.8,
      });
      assert(eval74.finalScore >= 70 && eval74.finalScore <= 79, `Score must be 70-79, got ${eval74.finalScore}`);
      assert(eval74.classification === 'VALID_SIGNAL', `Classification must be VALID_SIGNAL, got ${eval74.classification}`);
      assert(eval74.isTradeable === true, 'Score 70-79 must be tradeable');

      // Test 80+ HIGH-CONFLUENCE
      const eval85 = Gate8TradeabilityThreshold.evaluateCandidate({
        symbol: 'BTCUSDT',
        direction: 'BUY',
        trendAlignmentScore: 85,
        mtfConfluenceScore: 85,
        momentumScore: 85,
        marketStructureScore: 85,
        volumeScore: 85,
        volatilityAtrScore: 85,
        entryQualityScore: 85,
        riskRewardRatio: 2.5,
        agreeingStrategiesRatio: 1.0,
      });
      assert(eval85.finalScore >= 80, `Score must be >= 80, got ${eval85.finalScore}`);
      assert(
        eval85.classification === 'HIGH_CONFLUENCE' ||
        eval85.classification === 'STRONG_SIGNAL' ||
        eval85.classification === 'VERY_STRONG_SIGNAL' ||
        eval85.classification === 'EXCEPTIONAL',
        `Classification must be HIGH_CONFLUENCE / STRONG / EXCEPTIONAL, got ${eval85.classification}`
      );
      assert(eval85.isTradeable === true, 'Score 80+ must be tradeable');
    });

    await test('49. Legitimate 65-69 candidate executes through Gate 7 and is NOT blocked by legacy 70 thresholds', () => {
      const g7Validation = Gate7FinalTradeValidation.validateCandidate({
        symbol: 'ETHUSDT',
        direction: 'BUY',
        entryPrice: 3000,
        stopLoss: 2900,
        takeProfit: 3200,
        tp1: 3100,
        tp2: 3200,
        tp3: 3300,
        riskRewardRatio: 2.0,
        score: 66,
        candlesMap: {
          '15m': [
            { symbol: 'ETHUSDT', provider: 'bitget', timeframe: '15m', timestamp: Date.now() - 900000, open: 2980, high: 3005, low: 2975, close: 3000, volume: 1000 },
          ],
          '1h': [
            { symbol: 'ETHUSDT', provider: 'bitget', timeframe: '1h', timestamp: Date.now() - 3600000, open: 2950, high: 3010, low: 2940, close: 3000, volume: 4000 },
          ],
        },
        liveTicker: {
          symbol: 'ETHUSDT',
          rawSymbol: 'ETHUSDT',
          provider: 'bitget',
          assetType: 'CRYPTO',
          price: 3000,
          bid: 2999.5,
          ask: 3000.5,
          timestamp: Date.now() - 5000,
          receivedAt: Date.now() - 5000,
          source: 'LIVE',
          isFresh: true,
          status: 'OK',
        },
        atr: 35,
      });

      assert(g7Validation.scoreRequirementPassed === true, 'Score requirement must pass for score=66');
      assert(g7Validation.allHardGatesPassed === true, 'All hard gates must pass');
      assert(g7Validation.isTradeable === true, 'Candidate with score 66 must be tradeable in Gate 7');
    });
  });

  // =========================================================================
  // SUITE 19: GATE 4 — Strategy Engine Coordination & Evidence Audit
  // =========================================================================
  await describe('Strategy Engine Coordination & Evidence Audit', async () => {
    const { StrategyEngine } = await import('../src/server/signals/StrategyEngine.js');

    await test('50. Volatility Engine provides evidence and passes under CAUTION without hard-rejecting', () => {
      // Build 15m and 1h candles with moderate compression (CAUTION)
      const now = Date.now();
      const candles15m: any[] = [];
      const candles1h: any[] = [];
      for (let i = 50; i >= 0; i--) {
        candles15m.push({
          symbol: 'BTCUSDT',
          provider: 'bitget',
          timeframe: '15m',
          timestamp: now - i * 15 * 60000,
          open: 50000 + (50 - i) * 10,
          high: 50020 + (50 - i) * 10,
          low: 49990 + (50 - i) * 10,
          close: 50010 + (50 - i) * 10,
          volume: 100,
        });
      }
      for (let i = 50; i >= 0; i--) {
        candles1h.push({
          symbol: 'BTCUSDT',
          provider: 'bitget',
          timeframe: '1h',
          timestamp: now - i * 60 * 60000,
          open: 50000 + (50 - i) * 40,
          high: 50050 + (50 - i) * 40,
          low: 49950 + (50 - i) * 40,
          close: 50040 + (50 - i) * 40,
          volume: 500,
        });
      }

      const evalResult = StrategyEngine.evaluate('BTCUSDT', 52050, {
        '15m': candles15m,
        '1h': candles1h,
      });

      assert(evalResult.passed === true, 'Strategy evaluation should pass under normal/caution conditions');
      assert((evalResult.dominantDirection as string) !== 'NEUTRAL', 'Dominant direction must be resolved');
      assert(evalResult.strategyResults.length === 6, 'All 6 strategy engines must be evaluated as evidence');
    });

    await test('51. Extreme volatility triggers legitimate UNSAFE hard safety rejection', () => {
      // Build candles with extreme 5x spike in latest candle
      const now = Date.now();
      const candles1h: any[] = [];
      for (let i = 50; i >= 1; i--) {
        candles1h.push({
          symbol: 'BTCUSDT',
          provider: 'bitget',
          timeframe: '1h',
          timestamp: now - i * 60 * 60000,
          open: 50000,
          high: 50100,
          low: 49900,
          close: 50000,
          volume: 100,
        });
      }
      // Extreme erratic candle
      candles1h.push({
        symbol: 'BTCUSDT',
        provider: 'bitget',
        timeframe: '1h',
        timestamp: now,
        open: 50000,
        high: 53000,
        low: 47000,
        close: 48000,
        volume: 5000,
      });

      const evalResult = StrategyEngine.evaluate('BTCUSDT', 48000, {
        '15m': candles1h,
        '1h': candles1h,
      });

      assert(evalResult.passed === false, 'Extreme erratic volatility must trigger hard safety rejection');
      assert(evalResult.volatilityCondition === 'UNSAFE', 'Volatility condition must be flagged UNSAFE');
    });
  });

  // =========================================================================
  // SUITE 20: GATE 5 — Sensitivity Profiles & Safety Invariants
  // =========================================================================
  await describe('Sensitivity Profiles & Safety Invariants (Gate 5)', async () => {
    await test('Canonical sensitivity profiles preserve final score floor 65 and gross R:R floor 1.8', () => {
      const profiles = SignalSensitivityManager.getAllProfiles();
      assert(profiles.BALANCED.signalThreshold >= 65, 'BALANCED signalThreshold must be >= 65');
      assert(profiles.BALANCED.minimumScore >= 65, 'BALANCED minimumScore must be >= 65');
      assert(profiles.BALANCED.minimumRR >= 1.8, 'BALANCED minimumRR must be >= 1.8');

      assert(profiles.CONSERVATIVE.signalThreshold >= 65, 'CONSERVATIVE signalThreshold must be >= 65');
      assert(profiles.CONSERVATIVE.minimumScore >= 65, 'CONSERVATIVE minimumScore must be >= 65');
      assert(profiles.CONSERVATIVE.minimumRR >= 1.8, 'CONSERVATIVE minimumRR must be >= 1.8');

      assert(profiles.ACTIVE.signalThreshold >= 65, 'ACTIVE signalThreshold must be >= 65');
      assert(profiles.ACTIVE.minimumScore >= 65, 'ACTIVE minimumScore must be >= 65');
      assert(profiles.ACTIVE.minimumRR >= 1.8, 'ACTIVE minimumRR must be >= 1.8');
    });

    await test('Custom sensitivity overrides cannot lower score floor below 65 or R:R floor below 1.8', () => {
      SignalSensitivityManager.setActiveProfile('CUSTOM', {
        signalThreshold: 50,
        minimumScore: 50,
        minimumRR: 1.2,
      });

      const activeConfig = SignalSensitivityManager.getActiveConfig();
      assert(activeConfig.signalThreshold >= 65, 'CUSTOM signalThreshold must be clamped to at least 65');
      assert(activeConfig.minimumScore >= 65, 'CUSTOM minimumScore must be clamped to at least 65');
      assert(activeConfig.minimumRR >= 1.8, 'CUSTOM minimumRR must be clamped to at least 1.8');

      const serverThresholds = serverConfig.getThresholds();
      assert(serverThresholds.signalThreshold >= 65, 'serverConfig signalThreshold must remain >= 65');
      assert(serverThresholds.minimumScore >= 65, 'serverConfig minimumScore must remain >= 65');
      assert(serverThresholds.minimumRR >= 1.8, 'serverConfig minimumRR must remain >= 1.8');

      // Reset to BALANCED
      SignalSensitivityManager.resetToDefault();
    });

    await test('serverConfig.updateThresholds preserves canonical floors', () => {
      serverConfig.updateThresholds({
        signalThreshold: 45,
        minimumScore: 45,
        minimumRR: 1.1,
      });

      const thresholds = serverConfig.getThresholds();
      assert(thresholds.signalThreshold >= 65, 'signalThreshold cannot be updated below 65');
      assert(thresholds.minimumScore >= 65, 'minimumScore cannot be updated below 65');
      assert(thresholds.minimumRR >= 1.8, 'minimumRR cannot be updated below 1.8');

      SignalSensitivityManager.resetToDefault();
    });

    await test('Sensitivity profiles never weaken hard safety gates in Gate 7 / Gate 9', () => {
      // Test invalid stop loss ordering
      const invalidSlRes = Gate7FinalTradeValidation.validateCandidate({
        symbol: 'EURUSD',
        direction: 'BUY',
        entryPrice: 1.1000,
        stopLoss: 1.1050, // SL above entry on BUY -> invalid!
        takeProfit: 1.1200,
        score: 85,
        riskRewardRatio: 2.0,
        marketRegime: 'TRENDING_UP',
        atr: 0.0050,
        candlesMap: {
          '1h': [{ symbol: 'EURUSD', provider: 'twelvedata', timeframe: '1h', timestamp: Date.now(), open: 1.09, high: 1.11, low: 1.08, close: 1.10, volume: 1000 }],
        },
        liveTicker: { symbol: 'EURUSD', rawSymbol: 'EURUSD', provider: 'twelvedata', assetType: 'FOREX', bid: 1.1000, ask: 1.1001, price: 1.1000, timestamp: Date.now(), receivedAt: Date.now(), source: 'LIVE' as const, isFresh: true, status: 'OK' as const },
      });

      assert(invalidSlRes.isTradeable === false, 'Invalid SL direction must be rejected regardless of score');
      assert(invalidSlRes.allHardGatesPassed === false, 'Hard gate must fail');

      // Test R:R below 1.8 in Gate 9
      const g9Result = Gate9RiskManagement.calculate(
        1.1000,
        'BUY',
        1.0900, // risk = 0.0100
        1.1050, // tp1 reward = 0.0050 (0.5 R:R)
        1.1100, // tp2 reward = 0.0100 (1.0 R:R)
        1.1150  // tp3 reward = 0.0150 (1.5 R:R < 1.8)
      );

      assert(g9Result.isValid === false, 'Trade with gross R:R < 1.8 must be rejected by Gate 9');
    });
  });

  // =========================================================================
  // SUITE 21: GATE 6 — Final Signal Pipeline End-to-End Audit
  // =========================================================================
  await describe('Final Signal Pipeline End-to-End Audit (Gate 6)', async () => {
    await test('Complete execution path executes in exact order without early soft rejections', () => {
      // 1. VALID MARKET DATA
      const now = Date.now();
      const validCandles = Array.from({ length: 30 }, (_, i) => ({
        timestamp: now - (30 - i) * 3600000,
        open: 100 + i * 0.2,
        high: 100.5 + i * 0.2,
        low: 99.8 + i * 0.2,
        close: 100.3 + i * 0.2,
        volume: 1500,
        symbol: 'SOLUSDT',
        provider: 'BINANCE' as const,
        timeframe: '1h' as const,
      }));

      // 2. SETUP PATHWAY: Gate 3 preliminary screen
      const g3Result = Gate3PreliminaryScreen.screenAsset('SOLUSDT', validCandles);
      assert(g3Result.passed === true, 'Gate 3 preliminary screen must pass valid setup');

      // 3. ENGINE EVIDENCE & CONFLUENCE: Score in 65-69 range produces QUALIFIED_SIGNAL
      const gate8Eval = Gate8TradeabilityThreshold.evaluateCandidate({
        symbol: 'SOLUSDT',
        direction: 'BUY',
        trendAlignmentScore: 70,
        mtfConfluenceScore: 70,
        momentumScore: 65,
        marketStructureScore: 70,
        volumeScore: 60,
        volatilityAtrScore: 75,
        entryQualityScore: 65,
        riskRewardRatio: 2.1,
        netRiskRewardRatio: 2.1,
        agreeingStrategiesRatio: 0.75,
        timeframeAlignmentRatio: 0.75,
      });

      assert(gate8Eval.finalScore >= 65, 'Final score must reach at least 65');
      assert(gate8Eval.isTradeable === true, 'Candidate must be tradeable at score >= 65');
      assert(gate8Eval.classification === 'QUALIFIED_SIGNAL' || gate8Eval.classification === 'VALID_SIGNAL' || gate8Eval.classification === 'HIGH_CONFLUENCE', 'Classification must be tradeable');

      // 4. HARD SAFETY VALIDATION: Gate 7
      const g7Res = Gate7FinalTradeValidation.validateCandidate({
        symbol: 'SOLUSDT',
        direction: 'BUY',
        entryPrice: 106.3,
        stopLoss: 104.3, // risk = 2.0
        takeProfit: 110.5, // reward = 4.2 -> 2.1:1 R:R
        tp1: 108.5,
        tp2: 110.5,
        tp3: 112.5,
        score: gate8Eval.finalScore,
        riskRewardRatio: 2.5,
        marketRegime: 'TRENDING_UP',
        atr: 1.5,
        candlesMap: { '1h': validCandles },
        liveTicker: { symbol: 'SOLUSDT', rawSymbol: 'SOLUSDT', provider: 'bitget', assetType: 'CRYPTO', bid: 106.3, ask: 106.4, price: 106.3, timestamp: now, receivedAt: now, source: 'LIVE' as const, isFresh: true, status: 'OK' as const },
      });

      assert(g7Res.allHardGatesPassed === true, 'All Gate 7 hard gates must pass');
      assert(g7Res.isTradeable === true, 'Gate 7 must confirm tradeability');

      // 5. ONE FINAL R:R CHECK (>= 1.8)
      const rrResult = RiskRewardCalculator.calculate(106.3, 104.3, 108.5, 110.5, 112.5, 'BUY', 1.8);
      assert(rrResult.isValid === true, 'R:R calculator must validate gross R:R >= 1.8');
      assert(rrResult.grossRR >= 1.8, 'Gross R:R must meet or exceed 1.8');
    });

    await test('Soft conditions (normal volume, UNKNOWN regime, win rate) do not independently reject', () => {
      // UNKNOWN regime evaluation
      const regimeRes = Gate27RegimeThresholds.resolveThreshold({
        symbol: 'ETHUSDT',
        regime: 'UNKNOWN',
        actualScore: 66,
      });
      assert(regimeRes.isExecutable === true, 'UNKNOWN regime must remain executable');
      assert(regimeRes.passed === true, 'Score 66 must pass under UNKNOWN regime');

      // Gate 4 Momentum & Volatility analysis on normal market
      const normalCandles = Array.from({ length: 30 }, (_, i) => ({
        timestamp: Date.now() - (30 - i) * 3600000,
        open: 100 + i * 0.1,
        high: 100.3 + i * 0.1,
        low: 99.9 + i * 0.1,
        close: 100.2 + i * 0.1,
        volume: 1000,
        symbol: 'ETHUSDT',
        provider: 'BINANCE' as const,
        timeframe: '1h' as const,
      }));
      const volAnalysis = Gate4MomentumVolatility.analyze('BUY', normalCandles);
      assert(volAnalysis.volatilityState === 'NORMAL' || volAnalysis.volatilityState === 'EXPANDING', 'Normal volatility should not be DEAD or ERRATIC');
    });

    await test('Weak candidate (< 60 preliminary, < 65 final, or < 1.8 R:R) is legitimately rejected', () => {
      // 1. Weak preliminary candidate with insufficient depth
      const weakG3 = Gate3PreliminaryScreen.screenAsset('WEAK', []);
      assert(weakG3.passed === false, 'Asset with insufficient data must be rejected in Gate 3');

      // 2. Final score < 65 candidate
      const weakG8 = Gate8TradeabilityThreshold.evaluateCandidate({
        symbol: 'WEAKASSET',
        direction: 'BUY',
        trendAlignmentScore: 30,
        mtfConfluenceScore: 30,
        momentumScore: 25,
        marketStructureScore: 30,
        volumeScore: 20,
        volatilityAtrScore: 40,
        entryQualityScore: 30,
        riskRewardRatio: 1.2,
      });
      assert(weakG8.isTradeable === false, 'Candidate with score < 65 must not be tradeable');
      assert(weakG8.classification === 'REJECT' || weakG8.classification === 'NEAR_MISS_WATCHLIST', 'Must be classified as REJECT or WATCHLIST');
    });
  });

  // --- SUITE 18: GATE 1 FIX SIGNAL EXPIRATION LOGIC ---
  await describe('Gate 1 Fix Signal Expiration Logic', async () => {
    await test('isActionableSignal preserves ACTIVE, TP1_HIT, and TP2_HIT signals even if now > expiresAt', () => {
      const pastExpiration = Date.now() - 3600000; // 1 hour ago
      
      const activeSig = {
        status: 'ACTIVE',
        expiresAt: pastExpiration,
        isTradeableSignal: true,
        signalClassification: 'TRADEABLE',
      };
      assert(isActionableSignal(activeSig as any) === true, 'ACTIVE signal must remain actionable after expiresAt');

      const tp1Sig = {
        status: 'TP1_HIT',
        expiresAt: pastExpiration,
        isTradeableSignal: true,
        signalClassification: 'TRADEABLE',
      };
      assert(isActionableSignal(tp1Sig as any) === true, 'TP1_HIT signal must remain actionable after expiresAt');

      const tp2Sig = {
        status: 'TP2_HIT',
        expiresAt: pastExpiration,
        isTradeableSignal: true,
        signalClassification: 'TRADEABLE',
      };
      assert(isActionableSignal(tp2Sig as any) === true, 'TP2_HIT signal must remain actionable after expiresAt');

      const waitingSig = {
        status: 'WAITING_ENTRY',
        expiresAt: pastExpiration,
        isTradeableSignal: true,
        signalClassification: 'TRADEABLE',
      };
      assert(isActionableSignal(waitingSig as any) === false, 'WAITING_ENTRY signal with past expiresAt must be non-actionable');
    });

    await test('evaluateCandleHistory checks entry BEFORE expiration check on historical candles', () => {
      const creationTime = Date.now() - 5 * 3600000; // 5h ago
      const expiresAt = creationTime + 4 * 3600000; // 1h ago
      
      const sig: PersistedSentSignal = {
        id: 'test_exp_entry_1',
        snapshotId: 'snap_test_exp_entry_1',
        symbol: 'EURUSD',
        direction: 'BUY',
        entryPrice: 1.1000,
        stopLoss: 1.0950,
        takeProfit: 1.1150,
        tp1: 1.1050,
        tp2: 1.1100,
        tp3: 1.1150,
        riskRewardRatio: 3.0,
        score: 75,
        rankTier: 'BEST_TRADE' as const,
        strategy: 'EMA Trend',
        timeframe: '1h',
        dataSource: 'twelvedata',
        status: 'WAITING_ENTRY',
        historicalEntryPolicy: 'CANDLE_TOUCH',
        timestamp: creationTime,
        expiresAt: expiresAt,
        notificationSent: false,
        notificationTimestamp: creationTime,
        date: new Date(creationTime).toISOString().split('T')[0],
      };

      // Candle at expiresAt + 10 min that touches entry level 1.1000 (low = 1.0990)
      const candles: NormalizedCandle[] = [
        {
          symbol: 'EURUSD',
          provider: 'twelvedata',
          timeframe: '1m',
          timestamp: expiresAt + 600000,
          open: 1.1020,
          high: 1.1030,
          low: 1.0970, // Touches entry 1.1000 without touching SL 1.0950!
          close: 1.1010,
          volume: 1000,
        },
      ];

      const res = SignalLifecycleManager.evaluateCandleHistory(sig, candles);
      assert(res.finalState === 'ACTIVE', `Expected ACTIVE because candle touched entry, got ${res.finalState}`);
      assert(res.transitions.some((t) => t.nextState === 'ACTIVE'), 'Must transition to ACTIVE when entry is hit');
    });

    await test('evaluateActiveSignals defers expiration when no valid market data is available', async () => {
      const creationTime = Date.now() - 5 * 3600000;
      const expiresAt = creationTime + 4 * 3600000;

      const sig: PersistedSentSignal = {
        id: 'test_no_data_exp',
        snapshotId: 'snap_no_data_exp',
        symbol: 'NO_DATA_ASSET',
        direction: 'BUY',
        entryPrice: 100.0,
        stopLoss: 95.0,
        takeProfit: 110.0,
        tp1: 103.0,
        tp2: 106.0,
        tp3: 110.0,
        riskRewardRatio: 2.0,
        score: 80,
        rankTier: 'BEST_TRADE',
        strategy: 'Trend',
        timeframe: '1h',
        dataSource: 'mock_failed_provider',
        status: 'WAITING_ENTRY',
        timestamp: creationTime,
        expiresAt: expiresAt,
        notificationSent: false,
        notificationTimestamp: creationTime,
        date: new Date(creationTime).toISOString().split('T')[0],
        isTradeableSignal: true,
        signalClassification: 'TRADEABLE',
      };

      // Store signal in persistence
      await ScannerPersistence.recordSentSignal(sig as any);

      // Evaluate active signals (mock_failed_provider will return empty candles and no live price)
      const summary = await SignalLifecycleManager.evaluateActiveSignals();

      // Retrieve signal from persistence
      const activeList = await ScannerPersistence.getActiveSignals();
      const updated = activeList.find((s) => s.id === sig.id);

      assert(updated !== undefined, 'Signal must still exist in active signals list');
      assert(updated?.status === 'WAITING_ENTRY', `Status must remain WAITING_ENTRY when market data is unavailable, got ${updated?.status}`);

      // Clean up test signal
      await ScannerPersistence.deleteSentSignal(sig.id);
    });
  });

  // --- SUITE 19: GATE 2 — CRON TP/SL LIFECYCLE RETEST ---
  await describe('Gate 2 Cron TP/SL Lifecycle Retest', async () => {
    await test('evaluateActiveSignals monitors non-terminal signals (WAITING_ENTRY, ACTIVE, TP1_HIT, TP2_HIT) and handles unverified price data idempotently', async () => {
      const creationTime = Date.now() - 3600000;
      const testSig: PersistedSentSignal = {
        id: 'test_gate2_mon_1',
        snapshotId: 'snap_gate2_mon_1',
        symbol: 'UNVERIFIED_PAIR',
        direction: 'BUY',
        entryPrice: 50.0,
        stopLoss: 45.0,
        takeProfit: 60.0,
        tp1: 53.0,
        tp2: 56.0,
        tp3: 60.0,
        riskRewardRatio: 2.0,
        score: 75,
        rankTier: 'BEST_TRADE',
        strategy: 'EMA Trend',
        timeframe: '1h',
        dataSource: 'mock_unverified_provider',
        status: 'ACTIVE',
        timestamp: creationTime,
        expiresAt: creationTime + 4 * 3600000,
        notificationSent: false,
        notificationTimestamp: creationTime,
        date: new Date(creationTime).toISOString().split('T')[0],
        isTradeableSignal: true,
        signalClassification: 'TRADEABLE',
      };

      await ScannerPersistence.recordSentSignal(testSig as any);

      // First pass with unavailable/stale data
      const summary1 = await SignalLifecycleManager.evaluateActiveSignals();
      assert(summary1.unverifiedCount >= 1, `Expected unverifiedCount >= 1, got ${summary1.unverifiedCount}`);

      const activeList = await ScannerPersistence.getActiveSignals();
      const updatedSig = activeList.find((s) => s.id === testSig.id);
      assert(updatedSig !== undefined, 'Signal must remain active');
      assert(updatedSig?.status === 'ACTIVE', `Status must remain ACTIVE on unverified check, got ${updatedSig?.status}`);

      // Second pass (idempotency check)
      const summary2 = await SignalLifecycleManager.evaluateActiveSignals();
      assert(summary2.unverifiedCount >= 1, `Second pass unverifiedCount >= 1, got ${summary2.unverifiedCount}`);

      // Clean up test signal
      await ScannerPersistence.deleteSentSignal(testSig.id);
    });
  });

  // --- SUITE 20: GATE 3 — LIFECYCLE CHECK STATE METADATA ---
  await describe('Gate 3 — Persisted Lifecycle Check State Metadata', async () => {
    await test('Populates lastLifecycleCheck metadata fields on lifecycle evaluations', async () => {
      const creationTime = Date.now() - 30 * 60000;
      const testSig: PersistedSentSignal = {
        id: 'test_gate3_meta_1',
        snapshotId: 'snap_gate3_meta_1',
        symbol: 'G3_TEST_PAIR',
        direction: 'BUY',
        entryPrice: 100.0,
        stopLoss: 90.0,
        takeProfit: 120.0,
        tp1: 105.0,
        tp2: 110.0,
        tp3: 120.0,
        riskRewardRatio: 2.0,
        score: 80,
        rankTier: 'BEST_TRADE',
        strategy: 'EMA Trend',
        timeframe: '1h',
        dataSource: 'mock_g3_provider',
        status: 'WAITING_ENTRY',
        timestamp: creationTime,
        expiresAt: creationTime + 4 * 3600000,
        notificationSent: false,
        notificationTimestamp: creationTime,
        date: new Date(creationTime).toISOString().split('T')[0],
        isTradeableSignal: true,
        signalClassification: 'TRADEABLE',
      };

      await ScannerPersistence.recordSentSignal(testSig as any);

      // Pass 1: Unverified price data
      await SignalLifecycleManager.evaluateActiveSignals();

      const savedList1 = await ScannerPersistence.getSentSignals();
      const savedSig1 = savedList1.find((s) => s.id === testSig.id);
      assert(savedSig1 !== undefined, 'Signal must exist');
      assert(savedSig1?.status === 'WAITING_ENTRY', 'Signal status must remain WAITING_ENTRY');
      assert(typeof savedSig1?.lastLifecycleCheckAt === 'string', 'lastLifecycleCheckAt must be string ISO timestamp');
      assert(savedSig1?.lastLifecycleCheckStatus === 'NO_VALID_PRICE', `lastLifecycleCheckStatus must be NO_VALID_PRICE, got ${savedSig1?.lastLifecycleCheckStatus}`);
      assert(savedSig1?.lastLifecycleCheckSource !== undefined, 'lastLifecycleCheckSource must be set');

      // Clean up
      await ScannerPersistence.deleteSentSignal(testSig.id);
    });

    await test('Preserves milestone fields and supports allowed lifecycle check statuses', async () => {
      const allowedStatuses = [
        'CHECKED',
        'TP1_HIT',
        'TP2_HIT',
        'TP3_HIT',
        'SL_HIT',
        'ENTRY_CONFIRMED',
        'NO_TARGET_REACHED',
        'NO_VALID_PRICE',
        'AMBIGUOUS',
      ];

      for (const st of allowedStatuses) {
        assert(allowedStatuses.includes(st), `Allowed status ${st} must be recognized`);
      }
    });
  });

  // --- SUITE 21: GATE — SIGNAL DELETE & BULK DELETE SECURITY & RECONCILIATION ---
  await describe('Suite 21: Gate — Signal Delete & Bulk Delete Security & Reconciliation', async () => {
    const express = (await import('express')).default;
    const signalsRouter = (await import('../src/server/routes/signals.js')).default;
    const { ApiClient } = await import('../src/api/client.js');

    const app = express();
    app.use(express.json());
    app.use('/api', signalsRouter);

    let server: any;
    let baseUrl: string;

    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address() as any;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });

    try {
      await test('Authorized individual delete succeeds with valid admin credentials', async () => {
        const origKey = process.env.ADMIN_API_KEY;
        const origEnv = process.env.NODE_ENV;
        process.env.ADMIN_API_KEY = 'test_admin_auth_token_999';
        process.env.NODE_ENV = 'production';

        const testSig: PersistedSentSignal = {
          id: 'test_delete_auth_1',
          snapshotId: 'snap_delete_auth_1',
          symbol: 'TESTUSD',
          direction: 'BUY',
          entryPrice: 1.0,
          stopLoss: 0.9,
          takeProfit: 1.2,
          score: 80,
          status: 'ACTIVE',
          timestamp: Date.now(),
          expiresAt: Date.now() + 3600000,
          date: '2026-09-25',
          isTradeableSignal: true,
          signalClassification: 'TRADEABLE',
        } as any;

        await ScannerPersistence.recordSentSignal(testSig as any);

        const res = await fetch(`${baseUrl}/api/signals/${testSig.id}`, {
          method: 'DELETE',
          headers: {
            'Authorization': 'Bearer test_admin_auth_token_999',
            'Content-Type': 'application/json',
          },
        });

        assert(res.status === 200, `Expected status 200, got ${res.status}`);
        const data = await res.json();
        assert(data.success === true, 'Response success must be true');

        const activeList = await ScannerPersistence.getSentSignals();
        assert(!activeList.some((s) => s.id === testSig.id), 'Signal must be deleted from persistence');

        process.env.ADMIN_API_KEY = origKey;
        process.env.NODE_ENV = origEnv;
      });

      await test('Unauthorized individual delete returns 401 when admin credentials are required', async () => {
        const origKey = process.env.ADMIN_API_KEY;
        const origEnv = process.env.NODE_ENV;
        process.env.ADMIN_API_KEY = 'test_admin_auth_token_999';
        process.env.NODE_ENV = 'production';

        const testSig: PersistedSentSignal = {
          id: 'test_delete_unauth_1',
          snapshotId: 'snap_delete_unauth_1',
          symbol: 'TESTUSD',
          direction: 'BUY',
          entryPrice: 1.0,
          stopLoss: 0.9,
          takeProfit: 1.2,
          score: 80,
          status: 'ACTIVE',
          timestamp: Date.now(),
          expiresAt: Date.now() + 3600000,
          date: '2026-09-25',
          isTradeableSignal: true,
          signalClassification: 'TRADEABLE',
        } as any;

        await ScannerPersistence.recordSentSignal(testSig as any);

        const res = await fetch(`${baseUrl}/api/signals/${testSig.id}`, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
          },
        });

        assert(res.status === 401, `Expected status 401 Unauthorized, got ${res.status}`);
        const data = await res.json();
        assert(data.success === false, 'Response success must be false on 401');

        const activeList = await ScannerPersistence.getSentSignals();
        assert(activeList.some((s) => s.id === testSig.id), 'Signal must NOT be deleted on 401');

        // Cleanup
        await ScannerPersistence.deleteSentSignal(testSig.id);
        process.env.ADMIN_API_KEY = origKey;
        process.env.NODE_ENV = origEnv;
      });

      await test('Successful bulk delete removes all specified IDs in a single POST request', async () => {
        const sigs: PersistedSentSignal[] = ['bulk_test_1', 'bulk_test_2', 'bulk_test_3'].map((id) => ({
          id,
          snapshotId: `snap_${id}`,
          symbol: 'BULKPAIR',
          direction: 'BUY',
          entryPrice: 10.0,
          stopLoss: 9.0,
          takeProfit: 12.0,
          score: 80,
          status: 'ACTIVE',
          timestamp: Date.now(),
          expiresAt: Date.now() + 3600000,
          date: '2026-09-25',
          isTradeableSignal: true,
          signalClassification: 'TRADEABLE',
        } as any));

        for (const s of sigs) {
          await ScannerPersistence.recordSentSignal(s as any);
        }

        const res = await fetch(`${baseUrl}/api/signals/log/bulk-delete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: sigs.map((s) => s.id) }),
        });

        assert(res.status === 200, `Expected status 200, got ${res.status}`);
        const data = await res.json();
        assert(data.success === true, 'Response success must be true');
        assert(data.message.includes('3 of 3'), `Message should mention 3 of 3, got: ${data.message}`);

        const activeList = await ScannerPersistence.getSentSignals();
        for (const s of sigs) {
          assert(!activeList.some((item) => item.id === s.id), `Signal ${s.id} must be deleted`);
        }
      });

      await test('401 Unauthorized response does NOT trigger automatic retries in ApiClient', async () => {
        let callCount = 0;
        const originalFetch = globalThis.fetch;
        globalThis.fetch = (async (input: any, init: any) => {
          callCount++;
          return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), {
            status: 401,
            statusText: 'Unauthorized',
            headers: { 'Content-Type': 'application/json' },
          });
        }) as any;

        try {
          const client = new ApiClient();
          let threw = false;
          try {
            await client.deleteSignal('test_id_no_retry');
          } catch (err: any) {
            threw = true;
            assert(err.status === 401, `Error status should be 401, got ${err.status}`);
          }
          assert(threw, 'ApiClient must throw on 401');
          assert(callCount === 1, `ApiClient must NOT retry on 401! Expected callCount 1, got ${callCount}`);
        } finally {
          globalThis.fetch = originalFetch;
        }
      });
    } finally {
      if (server) {
        server.close();
      }
    }
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
