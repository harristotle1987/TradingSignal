import { marketDataManager } from '../market/MarketDataManager.js';
import { ScannerPersistence, PersistedSentSignal } from './ScannerPersistence.js';
import { SignalOutcomeLogger } from './SignalOutcomeLogger.js';
import { SignalLifecycleManager } from './SignalLifecycleManager.js';
import { SignalLogger } from './SignalLogger.js';
import { logger } from '../logger.js';
import { NormalizedTicker, NormalizedCandle } from '../market/types.js';
import { ScoringEngine } from './ScoringEngine.js';
import { SignalValidator } from './SignalValidator.js';

export interface TestResult {
  name: string;
  passed: boolean;
  message: string;
  details?: any;
}

export class OutcomeTrackerTester {
  /**
   * Runs the complete suite of integration tests for Signal Outcome Tracking
   */
  public static async runSuite(): Promise<{
    success: boolean;
    passedCount: number;
    failedCount: number;
    results: TestResult[];
  }> {
    logger.info('========================================================================');
    logger.info('[OutcomeTrackerTester] STARTING INTEGRATION TEST SUITE');
    logger.info('========================================================================');

    const results: TestResult[] = [];
    const originalGetPrice = marketDataManager.getPrice;
    const originalGetCandles = marketDataManager.getCandles;
    const originalGetActiveSignals = ScannerPersistence.getActiveSignals;
    const originalUpdateSignalStatus = ScannerPersistence.updateSignalStatus;

    try {
      // Initialize systems
      await SignalLogger.getSignalLogs(); // init
      
      // -----------------------------------------------------------------------
      // TEST 1: BUY Signal Progressive TP Hit (TP1 -> TP2 -> TP3)
      // -----------------------------------------------------------------------
      {
        const testId = `test_buy_prog_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const testSignal: PersistedSentSignal = {
          id: testId,
          snapshotId: `snap_${testId}`,
          symbol: 'BTCUSDT_TEST_BUY',
          direction: 'BUY',
          entryPrice: 100,
          stopLoss: 95,
          takeProfit: 110,
          tp1: 102,
          tp2: 105,
          tp3: 110,
          riskRewardRatio: 2.0,
          score: 90,
          rankTier: 'BEST_TRADE',
          strategy: 'Trend Continuation',
          timeframe: '1h',
          dataSource: 'bitget',
          status: 'ACTIVE',
          timestamp: Date.now() - 60000,
          notificationSent: false,
          notificationTimestamp: 0,
          date: new Date().toISOString().split('T')[0],
        };

        // Stub getActiveSignals to return only our test signal
        ScannerPersistence.getActiveSignals = async () => [testSignal];

        // Stub getPrice to return current price matching final TP
        marketDataManager.getPrice = async (sym): Promise<NormalizedTicker> => ({
          symbol: sym,
          rawSymbol: sym,
          provider: 'bitget',
          assetType: 'CRYPTO',
          bid: 110,
          ask: 111,
          price: 111, // reached TP3!
          timestamp: Date.now(),
          receivedAt: Date.now(),
          source: 'LIVE',
          isFresh: true,
          status: 'OK',
        });

        // Stub getCandles to return 3 progressive bars
        const baseTime = testSignal.timestamp + 1000;
        marketDataManager.getCandles = async (): Promise<NormalizedCandle[]> => [
          {
            symbol: 'BTCUSDT_TEST_BUY',
            provider: 'bitget',
            timeframe: '1m',
            open: 100,
            high: 103, // Hits TP1 (102)
            low: 99,
            close: 101,
            volume: 10,
            timestamp: baseTime,
          },
          {
            symbol: 'BTCUSDT_TEST_BUY',
            provider: 'bitget',
            timeframe: '1m',
            open: 101,
            high: 106, // Hits TP2 (105)
            low: 101,
            close: 104,
            volume: 12,
            timestamp: baseTime + 60000,
          },
          {
            symbol: 'BTCUSDT_TEST_BUY',
            provider: 'bitget',
            timeframe: '1m',
            open: 104,
            high: 112, // Hits TP3 (110)
            low: 103,
            close: 111,
            volume: 15,
            timestamp: baseTime + 120000,
          },
        ];

        // Keep track of state transitions recorded locally
        const savedStatuses: string[] = [];
        ScannerPersistence.updateSignalStatus = async (id, status) => {
          if (id === testSignal.id) {
            savedStatuses.push(status);
            testSignal.status = status;
          }
        };

        // Run evaluation
        await SignalLifecycleManager.evaluateActiveSignals();

        const outcomeLog = await SignalOutcomeLogger.getOutcome(testSignal.id);

        const hasTP1 = savedStatuses.includes('TP1_HIT');
        const hasTP2 = savedStatuses.includes('TP2_HIT');
        const hasTP3 = savedStatuses.includes('TP3_HIT');
        const finalIsTP3 = testSignal.status === 'TP3_HIT';
        const logIsTP3 = outcomeLog?.status === 'TP3_HIT';

        results.push({
          name: 'BUY Signal Progressive TP Hit Sequence',
          passed: hasTP1 && hasTP2 && hasTP3 && finalIsTP3 && logIsTP3,
          message: `Expected sequence 'ACTIVE' -> 'TP1_HIT' -> 'TP2_HIT' -> 'TP3_HIT'. Sequence received: ${savedStatuses.join(' -> ')}. Outcome Log: ${outcomeLog?.status}`,
          details: { savedStatuses, outcomeLog },
        });
      }

      // -----------------------------------------------------------------------
      // TEST 2: SELL Signal Stop Loss Hit (SL-before-TP)
      // -----------------------------------------------------------------------
      {
        const testId = `test_sell_sl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const testSignal: PersistedSentSignal = {
          id: testId,
          snapshotId: `snap_${testId}`,
          symbol: 'EURUSD_TEST_SELL',
          direction: 'SELL',
          entryPrice: 1.1000,
          stopLoss: 1.1050,
          takeProfit: 1.0900,
          tp1: 1.0970,
          tp2: 1.0940,
          tp3: 1.0900,
          riskRewardRatio: 2.0,
          score: 85,
          rankTier: 'BEST_TRADE',
          strategy: 'Mean Reversion',
          timeframe: '15m',
          dataSource: 'twelvedata',
          status: 'ACTIVE',
          timestamp: Date.now() - 60000,
          notificationSent: false,
          notificationTimestamp: 0,
          date: new Date().toISOString().split('T')[0],
        };

        ScannerPersistence.getActiveSignals = async () => [testSignal];

        marketDataManager.getPrice = async (sym): Promise<NormalizedTicker> => ({
          symbol: sym,
          rawSymbol: sym,
          provider: 'twelvedata',
          assetType: 'FOREX',
          bid: 1.1060,
          ask: 1.1061,
          price: 1.1060, // Hits SL (1.1050)
          timestamp: Date.now(),
          receivedAt: Date.now(),
          source: 'LIVE',
          isFresh: true,
          status: 'OK',
        });

        const baseTime = testSignal.timestamp + 1000;
        marketDataManager.getCandles = async (): Promise<NormalizedCandle[]> => [
          {
            symbol: 'EURUSD_TEST_SELL',
            provider: 'twelvedata',
            timeframe: '1m',
            open: 1.1000,
            high: 1.1020,
            low: 1.0990,
            close: 1.1010,
            volume: 100,
            timestamp: baseTime,
          },
          {
            symbol: 'EURUSD_TEST_SELL',
            provider: 'twelvedata',
            timeframe: '1m',
            open: 1.1010,
            high: 1.1060, // Hits SL!
            low: 1.0980,
            close: 1.1055,
            volume: 120,
            timestamp: baseTime + 60000,
          },
        ];

        const savedStatuses: string[] = [];
        ScannerPersistence.updateSignalStatus = async (id, status) => {
          if (id === testSignal.id) {
            savedStatuses.push(status);
            testSignal.status = status;
          }
        };

        await SignalLifecycleManager.evaluateActiveSignals();

        const outcomeLog = await SignalOutcomeLogger.getOutcome(testSignal.id);

        results.push({
          name: 'SELL Signal Stop-Loss Hit Protection',
          passed: savedStatuses.includes('SL_HIT') && testSignal.status === 'SL_HIT' && outcomeLog?.status === 'SL_HIT',
          message: `Expected 'SL_HIT'. Sequence received: ${savedStatuses.join(' -> ')}. Outcome Log: ${outcomeLog?.status}`,
          details: { savedStatuses, outcomeLog },
        });
      }

      // -----------------------------------------------------------------------
      // TEST 3: Stale Price Protection
      // -----------------------------------------------------------------------
      {
        const testId = `test_stale_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const testSignal: PersistedSentSignal = {
          id: testId,
          snapshotId: `snap_${testId}`,
          symbol: 'BTC_STALE',
          direction: 'BUY',
          entryPrice: 100,
          stopLoss: 95,
          takeProfit: 110,
          tp1: 102,
          tp2: 105,
          tp3: 110,
          riskRewardRatio: 2.0,
          score: 80,
          rankTier: 'BEST_TRADE',
          strategy: 'Breakout',
          timeframe: '1h',
          dataSource: 'bitget',
          status: 'ACTIVE',
          timestamp: Date.now() - 60000,
          notificationSent: false,
          notificationTimestamp: 0,
          date: new Date().toISOString().split('T')[0],
        };

        ScannerPersistence.getActiveSignals = async () => [testSignal];

        // Price is technically a TP hit, but the receivedAt age is 20 minutes old (stale!)
        marketDataManager.getPrice = async (sym): Promise<NormalizedTicker> => ({
          symbol: sym,
          rawSymbol: sym,
          provider: 'bitget',
          assetType: 'CRYPTO',
          bid: 111,
          ask: 112,
          price: 111,
          timestamp: Date.now() - 40 * 60 * 1000, // 40m old
          receivedAt: Date.now() - 20 * 60 * 1000, // 20m old (stale)
          source: 'LIVE',
          isFresh: false,
          status: 'OK',
        });

        marketDataManager.getCandles = async (): Promise<NormalizedCandle[]> => [];

        let statusUpdated = false;
        ScannerPersistence.updateSignalStatus = async () => {
          statusUpdated = true;
        };

        await SignalLifecycleManager.evaluateActiveSignals();

        results.push({
          name: 'Stale Price Protection Filter',
          passed: !statusUpdated && testSignal.status === 'ACTIVE',
          message: `Expected signal to remain ACTIVE due to stale quote age. Transitioned: ${statusUpdated}. Status: ${testSignal.status}`,
          details: { statusUpdated, status: testSignal.status },
        });
      }

      // -----------------------------------------------------------------------
      // TEST 4: Provider Mismatch Protection
      // -----------------------------------------------------------------------
      {
        const testId = `test_mismatch_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const testSignal: PersistedSentSignal = {
          id: testId,
          snapshotId: `snap_${testId}`,
          symbol: 'BTC_MISMATCH',
          direction: 'BUY',
          entryPrice: 100,
          stopLoss: 95,
          takeProfit: 110,
          tp1: 102,
          tp2: 105,
          tp3: 110,
          riskRewardRatio: 2.0,
          score: 80,
          rankTier: 'BEST_TRADE',
          strategy: 'Breakout',
          timeframe: '1h',
          dataSource: 'bitget', // expects Bitget
          status: 'ACTIVE',
          timestamp: Date.now() - 60000,
          notificationSent: false,
          notificationTimestamp: 0,
          date: new Date().toISOString().split('T')[0],
        };

        ScannerPersistence.getActiveSignals = async () => [testSignal];

        // Returns Twelvedata provider instead of Bitget
        marketDataManager.getPrice = async (sym): Promise<NormalizedTicker> => ({
          symbol: sym,
          rawSymbol: sym,
          provider: 'twelvedata', // mismatched provider
          assetType: 'CRYPTO',
          bid: 111,
          ask: 112,
          price: 111,
          timestamp: Date.now(),
          receivedAt: Date.now(),
          source: 'LIVE',
          isFresh: true,
          status: 'OK',
        });

        marketDataManager.getCandles = async (): Promise<NormalizedCandle[]> => [];

        let statusUpdated = false;
        ScannerPersistence.updateSignalStatus = async () => {
          statusUpdated = true;
        };

        await SignalLifecycleManager.evaluateActiveSignals();

        results.push({
          name: 'Provider Mismatch Protection',
          passed: !statusUpdated && testSignal.status === 'ACTIVE',
          message: `Expected signal to be skipped due to provider mismatch. Transitioned: ${statusUpdated}. Status: ${testSignal.status}`,
          details: { statusUpdated, status: testSignal.status },
        });
      }

      // -----------------------------------------------------------------------
      // TEST 5: Duplicate Execution Prevention
      // -----------------------------------------------------------------------
      {
        const testId = `test_dup_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const testSignal: PersistedSentSignal = {
          id: testId,
          snapshotId: `snap_${testId}`,
          symbol: 'BTC_DUP',
          direction: 'BUY',
          entryPrice: 100,
          stopLoss: 95,
          takeProfit: 110,
          tp1: 102,
          tp2: 105,
          tp3: 110,
          riskRewardRatio: 2.0,
          score: 80,
          rankTier: 'BEST_TRADE',
          strategy: 'Breakout',
          timeframe: '1h',
          dataSource: 'bitget',
          status: 'ACTIVE',
          timestamp: Date.now() - 60000,
          notificationSent: false,
          notificationTimestamp: 0,
          date: new Date().toISOString().split('T')[0],
        };

        ScannerPersistence.getActiveSignals = async () => [testSignal];

        marketDataManager.getPrice = async (sym): Promise<NormalizedTicker> => ({
          symbol: sym,
          rawSymbol: sym,
          provider: 'bitget',
          assetType: 'CRYPTO',
          bid: 103,
          ask: 104,
          price: 103, // hits TP1
          timestamp: Date.now(),
          receivedAt: Date.now(),
          source: 'LIVE',
          isFresh: true,
          status: 'OK',
        });

        marketDataManager.getCandles = async (): Promise<NormalizedCandle[]> => [];

        let transitionCount = 0;
        ScannerPersistence.updateSignalStatus = async (id, status) => {
          transitionCount++;
          testSignal.status = status;
        };

        // Run evaluation 1st time (should transition)
        await SignalLifecycleManager.evaluateActiveSignals();

        // Run evaluation 2nd time (should NOT transition again because it's already in TP1_HIT)
        await SignalLifecycleManager.evaluateActiveSignals();

        results.push({
          name: 'Duplicate Execution Safety',
          passed: transitionCount === 1 && testSignal.status === 'TP1_HIT',
          message: `Expected exactly 1 state transition for hit level. Actual transitions: ${transitionCount}. Status: ${testSignal.status}`,
          details: { transitionCount, status: testSignal.status },
        });
      }

      // -----------------------------------------------------------------------
      // TEST 6: Take-Profit Level Distinctness & R:R Validation
      // -----------------------------------------------------------------------
      {
        // 1. Verify calculateThreeTakeProfits never outputs duplicates or incorrect ordering
        const buyTps = ScoringEngine.calculateThreeTakeProfits(
          'BUY',
          4.054, // entryPrice
          3.954, // stopLoss
          0.05,  // atr_15m
          4.0,   // support15m
          4.1,   // resistance15m
          3.9,   // majorSupport1h
          4.2,   // majorResistance1h
          'Trend Continuation',
          0.02,  // minPracticalTargetDistance
          5      // precision
        );

        const buyDistinct = buyTps.tp1 !== buyTps.tp2 && buyTps.tp2 !== buyTps.tp3 && buyTps.tp1 !== buyTps.tp3;
        const buyOrdered = buyTps.tp1 < buyTps.tp2 && buyTps.tp2 < buyTps.tp3;

        const sellTps = ScoringEngine.calculateThreeTakeProfits(
          'SELL',
          4.054, // entryPrice
          4.154, // stopLoss
          0.05,  // atr_15m
          4.0,   // support15m
          4.1,   // resistance15m
          3.9,   // majorSupport1h
          4.2,   // majorResistance1h
          'Trend Continuation',
          0.02,  // minPracticalTargetDistance
          5      // precision
        );

        const sellDistinct = sellTps.tp1 !== sellTps.tp2 && sellTps.tp2 !== sellTps.tp3 && sellTps.tp1 !== sellTps.tp3;
        const sellOrdered = sellTps.tp1 > sellTps.tp2 && sellTps.tp2 > sellTps.tp3;

        // 2. Verify SignalValidator rejects duplicate TPs
        const mockCandles = [
          { symbol: 'BTC_DUP', provider: 'bitget', timeframe: '1h', open: 100, high: 101, low: 99, close: 100, volume: 10, timestamp: Date.now() - 3600000 },
          { symbol: 'BTC_DUP', provider: 'bitget', timeframe: '1h', open: 100, high: 101, low: 99, close: 100, volume: 10, timestamp: Date.now() }
        ];
        const invalidValidationResult = SignalValidator.validate({
          symbol: 'BTC_DUP',
          direction: 'BUY',
          entryPrice: 100,
          stopLoss: 95,
          takeProfit: 110,
          tp1: 105,
          tp2: 105, // duplicate
          tp3: 110,
          riskRewardRatio: 2.0,
          score: 80,
          candlesMap: { '1h': mockCandles, '15m': mockCandles },
          liveTicker: {
            symbol: 'BTC_DUP',
            rawSymbol: 'BTC_DUP',
            price: 100,
            bid: 100,
            ask: 100,
            timestamp: Date.now(),
            receivedAt: Date.now(),
            provider: 'bitget',
            assetType: 'CRYPTO',
            source: 'LIVE',
            isFresh: true,
            status: 'OK',
          },
        });

        results.push({
          name: 'Take-Profit Level Distinctness & R:R Validation',
          passed: buyDistinct && buyOrdered && sellDistinct && sellOrdered && !invalidValidationResult.isValid,
          message: `BUY distinct: ${buyDistinct} (ordered: ${buyOrdered}). SELL distinct: ${sellDistinct} (ordered: ${sellOrdered}). Invalid TP Validator rejection: ${!invalidValidationResult.isValid}`,
          details: { buyTps, sellTps, invalidValidationMessage: invalidValidationResult.detailedMessage },
        });
      }

      // -----------------------------------------------------------------------
      // TEST 7: Validation Enforcement & Recalculation Regression
      // -----------------------------------------------------------------------
      {
        const entryPrice = 4.054;
        const stopLoss = 3.954;
        const badTp1 = 4.10;
        const badTp2 = 4.10; // duplicate
        const badTp3 = 4.10; // duplicate
        const atr = 0.05;
        const precision = 5;

        // Perform validation & enforcement (should recalculate because of duplicate TPs)
        const enforced = SignalValidator.validateAndEnforceTps(
          'BUY',
          entryPrice,
          stopLoss,
          badTp1,
          badTp2,
          badTp3,
          atr,
          precision
        );

        const repairedDistinct = enforced.tp1 !== enforced.tp2 && enforced.tp2 !== enforced.tp3 && enforced.tp1 !== enforced.tp3;
        const repairedOrdered = entryPrice < enforced.tp1 && enforced.tp1 < enforced.tp2 && enforced.tp2 < enforced.tp3;
        const satisfiesRR = enforced.riskRewardRatio >= 2.0;

        results.push({
          name: 'Take-Profit Recalculation & Enforcement Safety',
          passed: enforced.wasRecalculated && repairedDistinct && repairedOrdered && satisfiesRR,
          message: `Recalculated: ${enforced.wasRecalculated}. Distinct: ${repairedDistinct}. Ordered: ${repairedOrdered}. R:R: ${enforced.riskRewardRatio} (>=2.0: ${satisfiesRR})`,
          details: { enforced },
        });
      }

      // -----------------------------------------------------------------------
      // TEST 8: Historical Outcome Backfill (Chronological Past TP1 & TP2 Hits)
      // -----------------------------------------------------------------------
      {
        const testRunId = `test_backfill_hist_${Date.now()}`;
        const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
        const testSignal: PersistedSentSignal = {
          id: testRunId,
          snapshotId: `snap_${testRunId}`,
          symbol: 'ETHUSDT_BACKFILL_TEST',
          direction: 'BUY',
          entryPrice: 3000,
          stopLoss: 2900,
          takeProfit: 3300,
          tp1: 3100,
          tp2: 3200,
          tp3: 3300,
          riskRewardRatio: 2.0,
          score: 88,
          rankTier: 'BEST_TRADE',
          strategy: 'Trend Continuation',
          timeframe: '1h',
          dataSource: 'bitget',
          status: 'ACTIVE',
          timestamp: twoHoursAgo,
          notificationSent: true,
          notificationTimestamp: twoHoursAgo,
          date: new Date(twoHoursAgo).toISOString().split('T')[0],
        };

        ScannerPersistence.getActiveSignals = async () => [testSignal];

        // Current price has pulled back to 3050 (below TP1 and TP2)
        marketDataManager.getPrice = async (sym): Promise<NormalizedTicker> => ({
          symbol: sym,
          rawSymbol: sym,
          provider: 'bitget',
          assetType: 'CRYPTO',
          bid: 3050,
          ask: 3051,
          price: 3050,
          timestamp: Date.now(),
          receivedAt: Date.now(),
          source: 'LIVE',
          isFresh: true,
          status: 'OK',
        });

        // Historical candles starting 2 hours ago: Bar 1 hits TP1 (3100), Bar 2 hits TP2 (3200)
        const candle1Time = twoHoursAgo + 10 * 60 * 1000;
        const candle2Time = twoHoursAgo + 40 * 60 * 1000;
        marketDataManager.getCandles = async (): Promise<NormalizedCandle[]> => [
          {
            symbol: 'ETHUSDT_BACKFILL_TEST',
            provider: 'bitget',
            timeframe: '1m',
            open: 3000,
            high: 3150, // Reached TP1 (3100)
            low: 2980,
            close: 3080,
            volume: 50,
            timestamp: candle1Time,
          },
          {
            symbol: 'ETHUSDT_BACKFILL_TEST',
            provider: 'bitget',
            timeframe: '1m',
            open: 3080,
            high: 3220, // Reached TP2 (3200)
            low: 3070,
            close: 3190,
            volume: 80,
            timestamp: candle2Time,
          },
        ];

        const savedStatuses: string[] = [];
        ScannerPersistence.updateSignalStatus = async (id, status, metadata) => {
          if (id === testSignal.id) {
            savedStatuses.push(status);
            testSignal.status = status;
            if (metadata) Object.assign(testSignal, metadata);
          }
        };

        // Run backfill evaluation
        await SignalLifecycleManager.evaluateActiveSignals();

        const outcomeLog = await SignalOutcomeLogger.getOutcome(testSignal.id);

        const hitTP1 = savedStatuses.includes('TP1_HIT');
        const hitTP2 = savedStatuses.includes('TP2_HIT');
        const finalStatus = testSignal.status === 'TP2_HIT';
        const isRecovered = outcomeLog?.isRecovered === true;
        const correctEventSource = outcomeLog?.eventSource === 'HISTORICAL_BACKFILL';
        const preservedTimestamps = outcomeLog?.tp1HitTimestamp === candle1Time && outcomeLog?.tp2HitTimestamp === candle2Time;

        results.push({
          name: 'Historical Outcome Backfill Chronology & Recovery',
          passed: hitTP1 && hitTP2 && finalStatus && isRecovered && correctEventSource && preservedTimestamps,
          message: `TP1 hit: ${hitTP1}, TP2 hit: ${hitTP2}, Final status: ${testSignal.status}, Recovered: ${isRecovered}, Source: ${outcomeLog?.eventSource}, Timestamps verified: ${preservedTimestamps}`,
          details: { savedStatuses, outcomeLog },
        });
      }

      // -----------------------------------------------------------------------
      // TEST 9: Backfill Idempotency & Duplicate Notification Prevention
      // -----------------------------------------------------------------------
      {
        const testId = `test_idempotent_backfill_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const testSignal: PersistedSentSignal = {
          id: testId,
          snapshotId: `snap_${testId}`,
          symbol: 'SOLUSDT_IDEM_TEST',
          direction: 'BUY',
          entryPrice: 150,
          stopLoss: 140,
          takeProfit: 180,
          tp1: 160,
          tp2: 170,
          tp3: 180,
          riskRewardRatio: 2.0,
          score: 85,
          rankTier: 'BEST_TRADE',
          strategy: 'Momentum',
          timeframe: '1h',
          dataSource: 'bitget',
          status: 'TP1_HIT',
          timestamp: Date.now() - 3600000,
          notificationSent: true,
          notificationTimestamp: Date.now() - 3600000,
          date: new Date().toISOString().split('T')[0],
          notifiedStates: ['TP1_HIT'],
          tp1HitTimestamp: Date.now() - 1800000,
        };

        ScannerPersistence.getActiveSignals = async () => [testSignal];

        marketDataManager.getPrice = async (sym): Promise<NormalizedTicker> => ({
          symbol: sym,
          rawSymbol: sym,
          provider: 'bitget',
          assetType: 'CRYPTO',
          bid: 155,
          ask: 156,
          price: 155,
          timestamp: Date.now(),
          receivedAt: Date.now(),
          source: 'LIVE',
          isFresh: true,
          status: 'OK',
        });

        marketDataManager.getCandles = async (): Promise<NormalizedCandle[]> => [
          {
            symbol: 'SOLUSDT_IDEM_TEST',
            provider: 'bitget',
            timeframe: '1m',
            open: 150,
            high: 162, // Already reached TP1
            low: 149,
            close: 155,
            volume: 10,
            timestamp: testSignal.timestamp + 60000,
          },
        ];

        let extraTransitions = 0;
        ScannerPersistence.updateSignalStatus = async () => {
          extraTransitions++;
        };

        // Run backfill 1st time
        await SignalLifecycleManager.evaluateActiveSignals();
        // Run backfill 2nd time
        await SignalLifecycleManager.evaluateActiveSignals();

        results.push({
          name: 'Historical Backfill Idempotency & Repeat Execution Safety',
          passed: extraTransitions === 0 && testSignal.status === 'TP1_HIT',
          message: `Expected 0 redundant transitions for already confirmed state. Actual: ${extraTransitions}. Status: ${testSignal.status}`,
          details: { extraTransitions, status: testSignal.status },
        });
      }

      // -----------------------------------------------------------------------
      // TEST 10: Ambiguous Intra-Candle Conflict Resolution (Both TP & SL Touched)
      // -----------------------------------------------------------------------
      {
        const testId = `test_ambiguous_candle_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const testSignal: PersistedSentSignal = {
          id: testId,
          snapshotId: `snap_${testId}`,
          symbol: 'BTC_AMBIGUOUS_TEST',
          direction: 'BUY',
          entryPrice: 50000,
          stopLoss: 48000,
          takeProfit: 55000,
          tp1: 52000,
          tp2: 54000,
          tp3: 55000,
          riskRewardRatio: 2.0,
          score: 85,
          rankTier: 'BEST_TRADE',
          strategy: 'Volatility Breakout',
          timeframe: '1h',
          dataSource: 'bitget',
          status: 'ACTIVE',
          timestamp: Date.now() - 3600000,
          notificationSent: true,
          notificationTimestamp: Date.now() - 3600000,
          date: new Date().toISOString().split('T')[0],
        };

        ScannerPersistence.getActiveSignals = async () => [testSignal];

        marketDataManager.getPrice = async (sym): Promise<NormalizedTicker> => ({
          symbol: sym,
          rawSymbol: sym,
          provider: 'bitget',
          assetType: 'CRYPTO',
          bid: 50000,
          ask: 50001,
          price: 50000,
          timestamp: Date.now(),
          receivedAt: Date.now(),
          source: 'LIVE',
          isFresh: true,
          status: 'OK',
        });

        // Giant 1m candle with high=53000 (hits TP1 52000) AND low=47000 (hits SL 48000), open=50000 (in between)
        marketDataManager.getCandles = async (): Promise<NormalizedCandle[]> => [
          {
            symbol: 'BTC_AMBIGUOUS_TEST',
            provider: 'bitget',
            timeframe: '1m',
            open: 50000,
            high: 53000, // Touches TP1
            low: 47000,  // Touches SL
            close: 49000,
            volume: 500,
            timestamp: testSignal.timestamp + 60000,
          },
        ];

        let recordedStatus: string = '';
        let recordedDetails: string | undefined;
        ScannerPersistence.updateSignalStatus = async (id, status, metadata) => {
          if (id === testSignal.id) {
            recordedStatus = status;
            recordedDetails = metadata?.ambiguousDetails;
            testSignal.status = status;
          }
        };

        await SignalLifecycleManager.evaluateActiveSignals();

        const outcomeLog = await SignalOutcomeLogger.getOutcome(testSignal.id);

        results.push({
          name: 'Ambiguous Intra-Candle Conflict Detection Without Guessing',
          passed: recordedStatus === 'AMBIGUOUS' && testSignal.status === 'AMBIGUOUS' && outcomeLog?.status === 'AMBIGUOUS',
          message: `Expected 'AMBIGUOUS' state. Recorded: ${recordedStatus}. Outcome log status: ${outcomeLog?.status}. Details: ${recordedDetails || outcomeLog?.ambiguousDetails}`,
          details: { recordedStatus, recordedDetails, outcomeLog },
        });
      }

      // -----------------------------------------------------------------------
      // TEST 11: SELL Signal Historical Backfill Target Progression
      // -----------------------------------------------------------------------
      {
        const testId = `test_sell_hist_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const testSignal: PersistedSentSignal = {
          id: testId,
          snapshotId: `snap_${testId}`,
          symbol: 'GBPUSD_SELL_HIST',
          direction: 'SELL',
          entryPrice: 1.3000,
          stopLoss: 1.3050,
          takeProfit: 1.2850,
          tp1: 1.2950,
          tp2: 1.2900,
          tp3: 1.2850,
          riskRewardRatio: 2.0,
          score: 86,
          rankTier: 'BEST_TRADE',
          strategy: 'Trend Continuation',
          timeframe: '1h',
          dataSource: 'twelvedata',
          status: 'ACTIVE',
          timestamp: Date.now() - 7200000,
          notificationSent: true,
          notificationTimestamp: Date.now() - 7200000,
          date: new Date().toISOString().split('T')[0],
        };

        ScannerPersistence.getActiveSignals = async () => [testSignal];

        marketDataManager.getPrice = async (sym): Promise<NormalizedTicker> => ({
          symbol: sym,
          rawSymbol: sym,
          provider: 'twelvedata',
          assetType: 'FOREX',
          bid: 1.2980,
          ask: 1.2981,
          price: 1.2980,
          timestamp: Date.now(),
          receivedAt: Date.now(),
          source: 'LIVE',
          isFresh: true,
          status: 'OK',
        });

        // Historical candles: Bar 1 drops to 1.2940 (hits TP1 1.2950), Bar 2 drops to 1.2890 (hits TP2 1.2900)
        marketDataManager.getCandles = async (): Promise<NormalizedCandle[]> => [
          {
            symbol: 'GBPUSD_SELL_HIST',
            provider: 'twelvedata',
            timeframe: '1m',
            open: 1.3000,
            high: 1.3010,
            low: 1.2940, // Hits TP1 (1.2950)
            close: 1.2960,
            volume: 200,
            timestamp: testSignal.timestamp + 1800000,
          },
          {
            symbol: 'GBPUSD_SELL_HIST',
            provider: 'twelvedata',
            timeframe: '1m',
            open: 1.2960,
            high: 1.2970,
            low: 1.2890, // Hits TP2 (1.2900)
            close: 1.2910,
            volume: 250,
            timestamp: testSignal.timestamp + 3600000,
          },
        ];

        const savedStatuses: string[] = [];
        ScannerPersistence.updateSignalStatus = async (id, status, metadata) => {
          if (id === testSignal.id) {
            savedStatuses.push(status);
            testSignal.status = status;
            if (metadata) Object.assign(testSignal, metadata);
          }
        };

        await SignalLifecycleManager.evaluateActiveSignals();

        const outcomeLog = await SignalOutcomeLogger.getOutcome(testSignal.id);

        results.push({
          name: 'SELL Signal Historical Backfill & Progressive Level Recovery',
          passed: savedStatuses.includes('TP1_HIT') && savedStatuses.includes('TP2_HIT') && testSignal.status === 'TP2_HIT' && outcomeLog?.status === 'TP2_HIT',
          message: `Expected SELL transitions 'TP1_HIT' -> 'TP2_HIT'. Recorded: ${savedStatuses.join(' -> ')}. Outcome Log: ${outcomeLog?.status}`,
          details: { savedStatuses, outcomeLog },
        });
      }

    } catch (err) {
      logger.error('[OutcomeTrackerTester] Test execution threw an error:', { error: String(err) });
      results.push({
        name: 'Exception Safety',
        passed: false,
        message: `Exception during tests: ${String(err)}`,
      });
    } finally {
      // Clean up / Restore stubs to original implementations
      marketDataManager.getPrice = originalGetPrice;
      marketDataManager.getCandles = originalGetCandles;
      ScannerPersistence.getActiveSignals = originalGetActiveSignals;
      ScannerPersistence.updateSignalStatus = originalUpdateSignalStatus;
    }

    const passedCount = results.filter((r) => r.passed).length;
    const failedCount = results.length - passedCount;

    logger.info('========================================================================');
    logger.info(`[OutcomeTrackerTester] TESTS COMPLETED: ${passedCount} PASSED, ${failedCount} FAILED`);
    logger.info('========================================================================');

    return {
      success: failedCount === 0,
      passedCount,
      failedCount,
      results,
    };
  }
}
