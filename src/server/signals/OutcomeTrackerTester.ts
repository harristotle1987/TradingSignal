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
        const testSignal: PersistedSentSignal = {
          id: 'test_buy_prog_id',
          snapshotId: 'snap_1',
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
        const testSignal: PersistedSentSignal = {
          id: 'test_sell_sl_id',
          snapshotId: 'snap_2',
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
        const testSignal: PersistedSentSignal = {
          id: 'test_stale_id',
          snapshotId: 'snap_3',
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
        const testSignal: PersistedSentSignal = {
          id: 'test_mismatch_id',
          snapshotId: 'snap_4',
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
        const testSignal: PersistedSentSignal = {
          id: 'test_dup_id',
          snapshotId: 'snap_5',
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
