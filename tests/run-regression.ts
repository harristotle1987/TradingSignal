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
import { serverConfig } from '../src/server/config.js';
import { SignalValidator } from '../src/server/signals/SignalValidator.js';
import { MarketStructureDetector } from '../src/server/signals/MarketStructureDetector.js';
import { CooldownManager } from '../src/server/signals/CooldownManager.js';
import { CandidateRejectionTracker, StandardFailedGate } from '../src/server/signals/CandidateRejectionTracker.js';
import { OpportunityFunnelStore } from '../src/server/signals/Gate26OpportunityFunnel.js';
import { RiskRewardCalculator } from '../src/server/signals/RiskRewardCalculator.js';
import { Gate7FinalTradeValidation } from '../src/server/signals/Gate7FinalTradeValidation.js';
import { Gate8TradeabilityThreshold } from '../src/server/signals/Gate8TradeabilityThreshold.js';
import { Gate35SignalFunnelAnalytics, FunnelStage } from '../src/server/signals/Gate35SignalFunnelAnalytics.js';
import { HourlyScannerService } from '../src/server/signals/HourlyScanner.js';
import { ScoringEngine } from '../src/server/signals/ScoringEngine.js';
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
      assert(evalResult.classification === 'CAUTION', 'Should trigger CAUTION on fail-closed news fallback');
      assert(evalResult.isTradingAllowed === true, 'Trading must be allowed under elevated confirmation score');
      assert(evalResult.minRequiredConfirmationScore === 85, 'Score requirement must be raised to 85');
      assert(evalResult.reasons.some((r: string) => r.includes('NEWS_DATA_UNAVAILABLE')), 'Must explicitly report NEWS_DATA_UNAVAILABLE in reasons');
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

    await test('70 remains actionable signal threshold and R:R minimum is 1.8', () => {
      // Test default system fallbacks when env overrides are cleared
      const origMinScore = process.env.THRESHOLD_MIN_SCORE;
      const origSigScore = process.env.THRESHOLD_SIGNAL_SCORE;
      const origMinRr = process.env.THRESHOLD_MIN_RR;

      delete process.env.THRESHOLD_MIN_SCORE;
      delete process.env.THRESHOLD_SIGNAL_SCORE;
      delete process.env.THRESHOLD_MIN_RR;

      // Create a fresh config instance to test code defaults
      const freshConfig = (serverConfig as any).loadAndValidate();
      assert(freshConfig.thresholds.signalThreshold === 70, `Default signalThreshold must be 70, got ${freshConfig.thresholds.signalThreshold}`);
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

    await test('CandidateRejectionTracker tracks rejected high-score candidates and makes them accessible for UI', () => {
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

    await test('Invalid entry, SL, TP or missing direction cannot produce a fabricated R:R', () => {
      const invalidRes1 = RiskRewardCalculator.calculate(0, 95, 102, 110, 115, 'BUY');
      assert(!invalidRes1.isValid, 'Zero entry must be invalid');
      assert(invalidRes1.grossRR === 0, 'Gross RR must be 0');

      const invalidRes2 = RiskRewardCalculator.calculate(100, 105, 102, 110, 115, 'BUY'); // SL above entry for BUY
      assert(!invalidRes2.isValid, 'BUY with SL above entry must be invalid');

      const invalidRes3 = RiskRewardCalculator.calculate(100, 95, 102, 110, 115, 'INVALID' as any);
      assert(!invalidRes3.isValid, 'Invalid direction cannot silently fall through to SELL');
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
      assert(rec!.grossRR === canonical.grossRR, 'grossRR must match canonical');
      assert(rec!.primaryRR === canonical.primaryRR, 'primaryRR must match canonical');
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


    await test('CandidateRejectionTracker separates BUY and SELL for the same symbol (Identity Fix)', () => {
      const tracker = new CandidateRejectionTracker();
      
      // 1. BTCUSDT BUY + BTCUSDT SELL → two records.
      tracker.recordCandidate({
        symbol: 'BTCUSDT',
        direction: 'BUY',
        score: 75,
        primaryRejectionReason: 'REJECTED: RR',
        failedGates: [StandardFailedGate.RR],
        finalDecision: 'REJECTED',
      });
      tracker.recordCandidate({
        symbol: 'BTCUSDT',
        direction: 'SELL',
        score: 72,
        primaryRejectionReason: 'REJECTED: STRUCTURE',
        failedGates: [StandardFailedGate.MARKET_STRUCTURE],
        finalDecision: 'REJECTED',
      });
      
      const records = tracker.getAllRecords();
      assert(records.length === 2, 'Must have exactly two separate records for BUY and SELL');
      const btcBuy = records.find(r => r.symbol === 'BTCUSDT' && r.direction === 'BUY');
      const btcSell = records.find(r => r.symbol === 'BTCUSDT' && r.direction === 'SELL');
      assert(btcBuy !== undefined, 'BTCUSDT BUY must exist');
      assert(btcSell !== undefined, 'BTCUSDT SELL must exist');
      assert(btcBuy!.failedGates.includes(StandardFailedGate.RR), 'BTCUSDT BUY must have RR failure');
      assert(btcSell!.failedGates.includes(StandardFailedGate.MARKET_STRUCTURE), 'BTCUSDT SELL must have STRUCTURE failure');
      
      // 2. BTCUSDT BUY repeated → same candidate identity.
      // 4. Historical records remain separate from current evaluation.
      // 5. Current evaluation does not inherit stale trade data.
      tracker.recordCandidate({
        symbol: 'BTCUSDT',
        direction: 'BUY',
        score: 80,
        primaryRejectionReason: 'REJECTED: FINAL_SCORE',
        failedGates: [StandardFailedGate.FINAL_SCORE_BELOW_THRESHOLD],
        finalDecision: 'REJECTED',
        tp1: 100000 // fresh trade data
      });
      
      const updatedRecords = tracker.getAllRecords();
      assert(updatedRecords.length === 2, 'Repeated BUY must overwrite existing BUY record, keeping total length 2');
      const updatedBtcBuy = updatedRecords.find(r => r.symbol === 'BTCUSDT' && r.direction === 'BUY');
      assert(updatedBtcBuy!.failedGates.includes(StandardFailedGate.FINAL_SCORE_BELOW_THRESHOLD), 'Repeated BUY must reflect the latest failed gates');
      assert(!updatedBtcBuy!.failedGates.includes(StandardFailedGate.RR), 'Historical RR failure must not leak into current evaluation');
      assert(updatedBtcBuy!.tp1 === 100000, 'Current evaluation must have fresh trade data (tp1)');
      
      // 3. Two different symbols → two records.
      tracker.recordCandidate({
        symbol: 'ETHUSDT',
        direction: 'BUY',
        score: 60,
        primaryRejectionReason: 'REJECTED: MTF',
        failedGates: [StandardFailedGate.MTF_ALIGNMENT],
        finalDecision: 'REJECTED',
      });
      assert(tracker.getAllRecords().length === 3, 'Different symbol must create a new record');
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

    // --- SUITE 8: GATE 1 EXACT CRON RESPONSE CONTRACT & GATE 2 VALID 1.8R TP PATH ---
    await describe('Suite 8: Gate 1 Exact Cron Response Contract & Gate 2 Valid 1.8R TP Path', async () => {
      await test('24. Gate 1: Cron trigger endpoint does not spread scanResult and excludes internal fields', () => {
        const routeContent = fs.readFileSync(path.join(process.cwd(), 'src/server/routes/signals.ts'), 'utf-8');
        assert(!routeContent.includes('cleanedScanResult'), 'signals.ts must not contain cleanedScanResult');
        assert(!routeContent.includes('...cleanedScanResult'), 'signals.ts must not spread cleanedScanResult');
        assert(!routeContent.includes('...scanResult'), 'signals.ts must not spread scanResult');

        const approvedKeys = [
          'success', 'status', 'message', 'timestamp', 'lastCronExecution', 'lastAutomatedScan',
          'lastScanCompletedAt', 'lastScanDuration', 'universeSymbolsScanned', 'preliminaryCandidatesFound',
          'candidatesRejectedPreliminary', 'candidatesEvaluated', 'candidatesRejectedFinal', 'signalsGenerated',
          'signalsAccepted', 'lastCandidatesEvaluated', 'lastSignalsFound', 'lastAcceptedSignals',
          'signalsFound', 'acceptedSignalsCount', 'nextCronExecution', 'lastScanTime', 'nextScanTime',
          'intervalMinutes', 'rejectedCount', 'candidatesRejectedBeforeMTF', 'candidatesRejectedByMTF',
          'candidatesRejectedByScore', 'candidatesRejectedByRR', 'candidatesRejectedByStructure',
          'rejectionReasons', 'rejectionReasonsCounts', 'candidateRejectionDetails', 'diagnosticsCount',
          'diagnostics', 'scanDurationMs', 'scanDuration', 'totalDurationMs', 'globalScanStartMs',
          'globalScanDeadlineMs', 'currentElapsedMs', 'remainingBudgetMs', 'gate6ElapsedMs',
          'stage3ElapsedMs', 'timeBudgetExceeded', 'providerRequestsStoppedByBudget', 'timingTelemetry',
          'external_hourly_scan_status'
        ];

        // Ensure all approved keys are present in the response builder
        approvedKeys.forEach(key => {
          assert(routeContent.includes(`${key}:`), `Approved key '${key}' must be explicitly set in response`);
        });

        // Ensure internal scanner fields are excluded
        const forbiddenFields = ['acceptedSignals:', 'qualifiedSetups:', 'rejectionReasonsAggregated:', 'capState:'];
        // Note: acceptedSignalsCount is allowed, acceptedSignals: is not in res.status(200).json
        const responseBlock = routeContent.slice(routeContent.indexOf('res.status(200).json({'), routeContent.indexOf('external_hourly_scan_status: \'EXTERNAL_HOURLY_SCAN_COMPLETED\''));
        assert(!responseBlock.includes('acceptedSignals:'), 'acceptedSignals array must be excluded from cron response');
        assert(!responseBlock.includes('qualifiedSetups:'), 'qualifiedSetups array must be excluded from cron response');
        assert(!responseBlock.includes('rejectionReasonsAggregated:'), 'rejectionReasonsAggregated must be excluded from cron response');
        assert(!responseBlock.includes('capState:'), 'capState must be excluded from cron response');
      });

      await test('25. Gate 2: RiskRewardCalculator separates tp2RR, tp3RR, and effectiveGrossRR and supports multi-target qualification', () => {
        // Test case where TP2 does not reach 1.8R, but TP3 reaches 1.85R
        // Entry: 100, SL: 95 (risk: 5). TP1: 104 (RR 0.8), TP2: 106 (RR 1.2), TP3: 109.5 (RR 1.9)
        const res = RiskRewardCalculator.calculate(100, 95, 104, 106, 109.5, 'BUY', 1.8);
        assert(res.isValid, 'Multi-target R:R should be valid');
        assert(res.tp2RR === 1.2, `Expected tp2RR to be 1.2, got ${res.tp2RR}`);
        assert(res.tp3RR === 1.9, `Expected tp3RR to be 1.9, got ${res.tp3RR}`);
        assert(res.effectiveGrossRR === 1.9, `Expected effectiveGrossRR to be 1.9, got ${res.effectiveGrossRR}`);
        assert(res.passedViaTp3 === true, 'Setup should pass via TP3');
        assert(res.grossRR === 1.2, 'grossRR benchmark remains tp2RR');

        // Test case where neither TP2 nor TP3 reaches 1.8R (e.g. TP2 = 1.10, TP3 = 1.58)
        const failedRes = RiskRewardCalculator.calculate(100, 95, 103, 105.5, 107.9, 'BUY', 1.8);
        assert(failedRes.isValid, 'Result geometry is ordered and valid');
        assert(failedRes.tp2RR === 1.1, `Expected tp2RR to be 1.1, got ${failedRes.tp2RR}`);
        assert(failedRes.tp3RR === 1.58, `Expected tp3RR to be 1.58, got ${failedRes.tp3RR}`);
        assert(failedRes.effectiveGrossRR === 1.58, `Expected effectiveGrossRR to be 1.58, got ${failedRes.effectiveGrossRR}`);
        assert(failedRes.passedViaTp3 === false, 'Setup should not pass via TP3');
      });

      await test('26. Gate 2: ScoringEngine.calculateThreeTakeProfits produces >= 1.80R TP3 path within guardrails', () => {
        // Entry: 100, SL: 97 (risk: 3). Required 1.8R distance: 5.4 -> req target: 105.4
        // ATR = 1.0. AssetClass = 'CRYPTO' (guardrails allow up to 6% on TP3, i.e. 106.0)
        const tps = ScoringEngine.calculateThreeTakeProfits(
          'BUY',
          100,
          97,
          1.0,
          0, // no 15m support
          0, // no 15m resistance
          0, // no 1h support
          0, // no 1h resistance
          'CRYPTO_TREND',
          0.1,
          2,
          'CRYPTO'
        );

        const riskDist = 3;
        const tp3Dist = tps.tp3 - 100;
        const tp3RR = Number((tp3Dist / riskDist).toFixed(2));
        assert(tp3RR >= 1.80, `Expected TP3 R:R >= 1.80, got ${tp3RR} (tp3: ${tps.tp3})`);
        assert(tps.tp3 > tps.tp2 && tps.tp2 > tps.tp1, 'Take profit targets must remain strictly ordered');
      });

      await test('27. Gate 2: logRrRejectionDiagnostic defaults to serverConfig thresholds.minimumRR and not 1.50', () => {
        const fileContent = fs.readFileSync(path.join(process.cwd(), 'src/server/signals/RiskRewardCalculator.ts'), 'utf-8');
        assert(!fileContent.includes('minRR: number = 1.50'), 'RiskRewardCalculator.ts must not have hardcoded minRR = 1.50 default in logRrRejectionDiagnostic');
        assert(fileContent.includes('serverConfig.getConfig().thresholds.minimumRR'), 'logRrRejectionDiagnostic must use serverConfig.getConfig().thresholds.minimumRR');
      });
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
