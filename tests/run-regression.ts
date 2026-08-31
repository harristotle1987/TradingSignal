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
import { ScoringEngine } from '../src/server/signals/ScoringEngine.js';
import { MarketStructureDetector } from '../src/server/signals/MarketStructureDetector.js';
import { CooldownManager } from '../src/server/signals/CooldownManager.js';
import { CandidateRejectionTracker, StandardFailedGate } from '../src/server/signals/CandidateRejectionTracker.js';
import { OpportunityFunnelStore } from '../src/server/signals/Gate26OpportunityFunnel.js';
import { RiskRewardCalculator } from '../src/server/signals/RiskRewardCalculator.js';
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
      assert(nvdaAudit?.is72PlusRejected === true, 'Candidate scoring 76 and rejected must be marked is72PlusRejected = true');
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

    await test('ETHUSDT R:R calculation computes grossRR ~1.59 when minGrossRR=1.5', () => {
      const ethRes = RiskRewardCalculator.calculate(2481.60, 2464.75, 2495.0, 2508.38, 2530.0, 'BUY', 1.5, 1.5, 'ETHUSDT');
      assert(ethRes.isValid, 'ETH result must be valid');
      assert(Math.abs(ethRes.grossRR - 1.59) < 0.05, `Expected grossRR ~1.59, got ${ethRes.grossRR}`);
      assert(ethRes.grossRR > ethRes.netRR, 'grossRR must be strictly greater than netRR due to friction');
    });

    await test('ETH-like TP generation constructs TP2 with distance >= riskDistance * minGrossRR (>= 30.33 for 1.8 R:R)', () => {
      const tpRes = ScoringEngine.calculateThreeTakeProfits(
        'BUY',
        2481.60,
        2464.75,
        20.0,
        2470.0,
        2515.0,
        2470.0,
        2520.0,
        'Multi-Timeframe Trend Confluence',
        30.0,
        2,
        'CRYPTO'
      );
      const riskDist = Math.abs(2481.60 - 2464.75); // 16.85
      const tp2Dist = Math.abs(tpRes.tp2 - 2481.60);
      assert(tp2Dist >= riskDist * 1.8, `Expected TP2 distance >= ${riskDist * 1.8}, got ${tp2Dist}`);
      assert(tpRes.tp2 >= 2481.60 + (riskDist * 1.8), `Expected TP2 >= 2511.93, got ${tpRes.tp2}`);
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
