import { marketDataManager } from '../market/MarketDataManager.js';
import { ScannerPersistence, PersistedSentSignal } from './ScannerPersistence.js';
import { SignalOutcomeLogger } from './SignalOutcomeLogger.js';
import { SignalLifecycleManager } from './SignalLifecycleManager.js';
import { SignalLogger } from './SignalLogger.js';
import { logger } from '../logger.js';
import { NormalizedTicker, NormalizedCandle } from '../market/types.js';
import { ScoringEngine } from './ScoringEngine.js';
import { SignalValidator } from './SignalValidator.js';
import { HardGatesEvaluator, SoftConditionsEvaluator, OpportunityFunnelEngine, OpportunityFunnelStore } from './Gate26OpportunityFunnel.js';
import { Gate27RegimeThresholds } from './Gate27RegimeThresholds.js';
import { Gate28ConfirmationDiversity } from './Gate28ConfirmationDiversity.js';
import { Gate29ExecutableEntryValidation } from './Gate29ExecutableEntryValidation.js';
import { Gate30DataFreshness } from './Gate30DataFreshness.js';
import { Gate31NewsRiskClassification } from './Gate31NewsRiskClassification.js';
import { Gate32AdaptiveCandidateSelection, Stage2CandidateInput } from './Gate32AdaptiveCandidateSelection.js';
import { Gate33AiAssessmentPolicy } from './Gate33AiAssessmentPolicy.js';
import { Gate34ExecutionFrictionStressTest } from './Gate34ExecutionFrictionStressTest.js';
import { serverConfig } from '../config.js';

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
      // Initialize systems & reset evaluation lock
      await SignalLogger.getSignalLogs(); // init
      (SignalLifecycleManager as any).isEvaluating = false;
      
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
        const stopLoss = 4.014;
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


      // -----------------------------------------------------------------------
      // TEST 12: Expiration Logic (Single Source of Truth)
      // -----------------------------------------------------------------------
      {
        const now = Date.now();
        const configMs = serverConfig.getConfig().signalExpirationMs;
        
        const createSignal = (id: string, timeOffset: number, state: any = 'WAITING_ENTRY'): PersistedSentSignal => ({
          id, snapshotId: `snap_${id}`, symbol: id, direction: 'BUY',
          entryPrice: 100, stopLoss: 90, takeProfit: 110, riskRewardRatio: 1.0, score: 80,
          rankTier: 'BEST_TRADE', strategy: 'Test', timeframe: '1m', dataSource: 'bitget',
          status: state, timestamp: now + timeOffset, expiresAt: now + timeOffset + configMs,
          notificationSent: false, notificationTimestamp: 0, date: new Date().toISOString().split('T')[0],
        });

        // Test subjects
        const beforeExpiry = createSignal('before_expiry', -configMs + 10000); // 10s before expiry
        const exactExpiry = createSignal('exact_expiry', -configMs); // Exactly at expiry (age >= maxTtl)
        const afterExpiry = createSignal('after_expiry', -configMs - 10000); // 10s after expiry
        const activeTrade = createSignal('active_after_expiry', -configMs - 10000, 'ACTIVE'); // Started, but now beyond original expiry
        const entryBeforeExpiry = createSignal('entry_before_expiry', -configMs - 10000); 
        const entryAfterExpiry = createSignal('entry_after_expiry', -configMs - 10000); 

        const signals = [beforeExpiry, exactExpiry, afterExpiry, activeTrade, entryBeforeExpiry, entryAfterExpiry];
        
        const savedStatuses = {};
        signals.forEach(s => savedStatuses[s.id] = s.status);
        
        ScannerPersistence.getActiveSignals = async () => signals;
        
        ScannerPersistence.updateSignalStatus = async (id, status) => {
          savedStatuses[id] = status;
          const sig = signals.find(s => s.id === id);
          if (sig) sig.status = status;
        };

        marketDataManager.getPrice = async () => null;

        // Custom candle provider to simulate entries
        marketDataManager.getCandles = async (symbol) => {
          if (symbol === 'entry_before_expiry') {
            // Candle happens BEFORE the expiration time
            return [{
              symbol, provider: 'bitget', timeframe: '1m',
              open: 95, high: 101, low: 95, close: 100, volume: 100,
              timestamp: entryBeforeExpiry.timestamp + configMs - 5000, // 5s before expiry
            }];
          }
          if (symbol === 'entry_after_expiry') {
            // Candle happens AFTER the expiration time
            return [{
              symbol, provider: 'bitget', timeframe: '1m',
              open: 95, high: 101, low: 95, close: 100, volume: 100,
              timestamp: entryAfterExpiry.timestamp + configMs + 5000, // 5s after expiry
            }];
          }
          return [];
        };

        await SignalLifecycleManager.evaluateActiveSignals();

        results.push({
          name: 'Expiration Logic - Before Expiry',
          passed: savedStatuses['before_expiry'] === 'WAITING_ENTRY',
          message: `Expected WAITING_ENTRY, got ${savedStatuses['before_expiry']}`
        });
        results.push({
          name: 'Expiration Logic - Exact Expiry Boundary',
          passed: savedStatuses['exact_expiry'] === 'EXPIRED',
          message: `Expected EXPIRED, got ${savedStatuses['exact_expiry']}`
        });
        results.push({
          name: 'Expiration Logic - After Expiry',
          passed: savedStatuses['after_expiry'] === 'EXPIRED',
          message: `Expected EXPIRED, got ${savedStatuses['after_expiry']}`
        });
        results.push({
          name: 'Expiration Logic - Active Trade After Original Expiry',
          passed: savedStatuses['active_after_expiry'] === 'ACTIVE',
          message: `Expected ACTIVE, got ${savedStatuses['active_after_expiry']}`
        });
        results.push({
          name: 'Expiration Logic - Entry Hit Before Expiry',
          passed: savedStatuses['entry_before_expiry'] === 'ACTIVE',
          message: `Expected ACTIVE, got ${savedStatuses['entry_before_expiry']}`
        });
        results.push({
          name: 'Expiration Logic - Entry Hit After Expiry',
          passed: savedStatuses['entry_after_expiry'] === 'EXPIRED',
          message: `Expected EXPIRED, got ${savedStatuses['entry_after_expiry']}`
        });
      }

      // -----------------------------------------------------------------------
      // TEST 8: Gate 25 - Centralized Signal Thresholds & Standardized Rejection Codes
      // -----------------------------------------------------------------------
      {
        const thresholds = serverConfig.getThresholds();

        // 8.1 Configuration Object Completeness
        const hasAllKeys = (
          typeof thresholds.minimumScore === 'number' &&
          typeof thresholds.minimumRR === 'number' &&
          typeof thresholds.minimumNetRR === 'number' &&
          typeof thresholds.minimumWinProbability === 'number' &&
          typeof thresholds.minimumStrategyAgreement === 'number' &&
          typeof thresholds.minimumTimeframeAlignment === 'number' &&
          typeof thresholds.AIConfirmationMode === 'string' &&
          typeof thresholds.dailySignalCap === 'number' &&
          typeof thresholds.candidateThreshold === 'number' &&
          typeof thresholds.signalThreshold === 'number'
        );

        results.push({
          name: 'Gate 25 - Centralized Thresholds Configuration Object Integrity',
          passed: hasAllKeys,
          message: hasAllKeys ? 'All 10 required threshold properties present with correct types' : 'Missing required threshold properties in centralized config'
        });

        // Mock candle sequence for geometry validator
        const mock1hCandles: NormalizedCandle[] = Array.from({ length: 30 }, (_, i) => ({
          symbol: 'EURUSD',
          provider: 'twelvedata',
          timeframe: '1h',
          open: 1.0800 + i * 0.0001,
          high: 1.0860 + i * 0.0001,
          low: 1.0790 + i * 0.0001,
          close: 1.0850 + i * 0.0001,
          volume: 1000,
          timestamp: Date.now() - (30 - i) * 3600000,
        }));

        // 8.2 Score Below Threshold Rejection in SignalValidator
        const lowScoreValidation = SignalValidator.validate({
          symbol: 'EURUSD',
          direction: 'BUY',
          entryPrice: 1.0850,
          stopLoss: 1.0700,
          takeProfit: 1.1200,
          riskRewardRatio: 2.33,
          score: thresholds.minimumScore - 5, // Below minimumScore
          candlesMap: { '1h': mock1hCandles },
          liveTicker: {
            symbol: 'EURUSD',
            rawSymbol: 'EURUSD',
            provider: 'twelvedata',
            assetType: 'FOREX',
            bid: 1.0849,
            ask: 1.0851,
            price: 1.0850,
            timestamp: Date.now(),
            receivedAt: Date.now(),
            source: 'LIVE',
            isFresh: true,
            status: 'OK',
          },
        });

        results.push({
          name: 'Gate 25 - Score Below Threshold Exact Rejection Reason',
          passed: !lowScoreValidation.isValid && lowScoreValidation.detailedMessage.startsWith('REJECTED: SCORE_BELOW_THRESHOLD'),
          message: `Expected REJECTED: SCORE_BELOW_THRESHOLD, got: ${lowScoreValidation.detailedMessage}`
        });

        // 8.3 Stale Data Exact Rejection Reason in SignalValidator
        const staleValidation = SignalValidator.validate({
          symbol: 'EURUSD',
          direction: 'BUY',
          entryPrice: 1.0850,
          stopLoss: 1.0800,
          takeProfit: 1.0950,
          riskRewardRatio: 2.0,
          score: 85,
          candlesMap: {},
          liveTicker: {
            symbol: 'EURUSD',
            rawSymbol: 'EURUSD',
            provider: 'twelvedata',
            assetType: 'FOREX',
            bid: 1.0849,
            ask: 1.0851,
            price: 1.0850,
            timestamp: Date.now() - 300000, // 5 min old (stale)
            receivedAt: Date.now() - 300000,
            source: 'LIVE',
            isFresh: false,
            status: 'STALE',
          },
        });

        results.push({
          name: 'Gate 25 - Stale Data Exact Rejection Reason',
          passed: !staleValidation.isValid && staleValidation.detailedMessage.startsWith('REJECTED: DATA_STALE'),
          message: `Expected REJECTED: DATA_STALE, got: ${staleValidation.detailedMessage}`
        });
      }

      // -----------------------------------------------------------------------
      // TEST 9: Gate 26 - Adaptive Signal Opportunity Funnel (Hard/Soft Gates & Stages)
      // -----------------------------------------------------------------------
      {
        const mockValidTicker: NormalizedTicker = {
          symbol: 'BTCUSDT',
          rawSymbol: 'BTCUSDT',
          provider: 'bitget',
          assetType: 'CRYPTO',
          bid: 60000,
          ask: 60002,
          price: 60000,
          timestamp: Date.now(),
          receivedAt: Date.now(),
          source: 'LIVE',
          isFresh: true,
          status: 'OK',
        };

        const mockCandles: NormalizedCandle[] = Array.from({ length: 30 }, (_, i) => ({
          symbol: 'BTCUSDT',
          provider: 'bitget',
          timeframe: '15m',
          open: 59000 + i * 30,
          high: 59100 + i * 30,
          low: 58950 + i * 30,
          close: 59050 + i * 30,
          volume: 1500,
          timestamp: Date.now() - (30 - i) * 900000,
        }));

        const candlesMap = { '15m': mockCandles, '1h': mockCandles };

        // 9.1 Hard Gates Rejection (e.g. Invalid SL where BUY SL >= entry)
        const hardGateInvalidSl = HardGatesEvaluator.evaluate({
          symbol: 'BTCUSDT',
          direction: 'BUY',
          entryPrice: 60000,
          stopLoss: 61000, // Invalid: BUY SL above entry
          takeProfit: 63000,
          riskRewardRatio: 2.0,
          liveTicker: mockValidTicker,
          candlesMap,
        });

        results.push({
          name: 'Gate 26 - Hard Gate Strict Enforcement (Invalid SL Rejection)',
          passed: !hardGateInvalidSl.passed && hardGateInvalidSl.failedGate === 'INVALID_SL',
          message: `Expected INVALID_SL hard gate failure, got: ${hardGateInvalidSl.rejectionReason}`,
        });

        // 9.2 Soft Conditions Evaluation & Missing Confirmation Extraction
        const softResult = SoftConditionsEvaluator.evaluate('BUY', candlesMap, {
          rsi: 55, // Confirmed
          macdHist: -0.05, // Missing MACD expansion
          vwapDiff: 0.002, // Confirmed
          volumeRatio: 0.75, // Missing volume
          divergenceScore: 30, // Missing divergence
          relativeStrengthScore: 70, // Confirmed
          timeframeAlignmentCount: 3, // Confirmed
        });

        const hasPassedAndMissing = softResult.passedConditions.length > 0 && softResult.missingConditions.length > 0;
        results.push({
          name: 'Gate 26 - Soft Conditions Disaggregation & Missing Extraction',
          passed: hasPassedAndMissing && softResult.rsiConfirmed && !softResult.macdConfirmed,
          message: `Passed: [${softResult.passedConditions.join(', ')}], Missing: [${softResult.missingConditions.join(', ')}]`,
        });

        // 9.3 Funnel Classification: WATCHING stage (Score 72, NOT actionable signal)
        const watchingClass = OpportunityFunnelEngine.classifyOpportunity({
          symbol: 'BTCUSDT',
          direction: 'BUY',
          entryPrice: 60000,
          stopLoss: 58000,
          takeProfit: 65000,
          riskRewardRatio: 2.5,
          score: 72, // In 70-74 range -> WATCHING
          liveTicker: mockValidTicker,
          candlesMap,
          estimatedWinRate: 50,
          expectancy: 1.2,
        });

        results.push({
          name: 'Gate 26 - Opportunity Stage: WATCHING (70-74 Not Emitted as Signal)',
          passed: watchingClass.stage === 'WATCHING' && !watchingClass.isActionableSignal,
          message: `Stage: ${watchingClass.stage}, isActionableSignal: ${watchingClass.isActionableSignal} (Score: ${watchingClass.score})`,
        });

        // 9.4 Funnel Classification: QUALIFIED CANDIDATE (Score 78, Confirmed but pending final trigger)
        const candidateClass = OpportunityFunnelEngine.classifyOpportunity({
          symbol: 'BTCUSDT',
          direction: 'BUY',
          entryPrice: 60000,
          stopLoss: 58000,
          takeProfit: 65000,
          riskRewardRatio: 2.5,
          score: 78, // In 75-81 range -> QUALIFIED CANDIDATE
          liveTicker: mockValidTicker,
          candlesMap,
          estimatedWinRate: 55,
          expectancy: 1.5,
        });

        results.push({
          name: 'Gate 26 - Opportunity Stage: QUALIFIED CANDIDATE (75-81 Monitored)',
          passed: candidateClass.stage === 'CONFIRMED' && !candidateClass.isActionableSignal,
          message: `Stage: ${candidateClass.stage}, isActionableSignal: ${candidateClass.isActionableSignal} (Score: ${candidateClass.score})`,
        });

        // 9.5 Funnel Classification: Full SIGNAL (Score 85, Actionable trade signal)
        const signalClass = OpportunityFunnelEngine.classifyOpportunity({
          symbol: 'BTCUSDT',
          direction: 'BUY',
          entryPrice: 60000,
          stopLoss: 58000,
          takeProfit: 65000,
          riskRewardRatio: 2.5,
          score: 85, // In 82+ range -> Full SIGNAL
          liveTicker: mockValidTicker,
          candlesMap,
          estimatedWinRate: 60,
          expectancy: 1.8,
        });

        results.push({
          name: 'Gate 26 - Opportunity Stage: Full Actionable SIGNAL (82+)',
          passed: signalClass.stage === 'WAITING_ENTRY' && signalClass.isActionableSignal,
          message: `Stage: ${signalClass.stage}, isActionableSignal: ${signalClass.isActionableSignal} (Score: ${signalClass.score})`,
        });

        // 9.6 Opportunity Promotion & Invalidation State Machine
        const testCandidateId = 'test_cand_gate26_' + Date.now();
        OpportunityFunnelStore.addOrUpdate({
          id: testCandidateId,
          symbol: 'ETHUSDT_FUNNEL_TEST',
          direction: 'BUY',
          entryPrice: 3000,
          stopLoss: 2900,
          takeProfit: 3300,
          riskRewardRatio: 3.0,
          score: 72,
          stage: 'WATCHING',
          status: 'WATCHING',
          hardGatesPassed: true,
          passedSoftConditions: ['RSI confirmation'],
          missingSoftConditions: ['MACD expansion'],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          expiresAt: Date.now() + 3600000,
        });

        // Promote candidate when missing confirmation appears (Score: 72 -> 85)
        const promoted = OpportunityFunnelStore.promote(testCandidateId, 85, 'sig_promoted_123');
        const promotionValid = promoted?.stage === 'WAITING_ENTRY' && promoted?.status === 'PROMOTED' && promoted?.score === 85;

        // Invalidate another deteriorating candidate
        const invalidCandidateId = 'test_cand_invalid_' + Date.now();
        OpportunityFunnelStore.addOrUpdate({
          id: invalidCandidateId,
          symbol: 'SOL_DETERIORATED_TEST',
          direction: 'BUY',
          entryPrice: 150,
          stopLoss: 140,
          takeProfit: 170,
          riskRewardRatio: 2.0,
          score: 71,
          stage: 'WATCHING',
          status: 'WATCHING',
          hardGatesPassed: true,
          passedSoftConditions: [],
          missingSoftConditions: ['MACD', 'RSI'],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          expiresAt: Date.now() + 3600000,
        });

        const invalidated = OpportunityFunnelStore.invalidate(invalidCandidateId, 'Price broke key structural swing low');
        const invalidationValid = invalidated?.status === 'INVALIDATED' && invalidated?.invalidationReason?.includes('structural swing');

        results.push({
          name: 'Gate 26 - Opportunity Promotion & Invalidation Lifecycle',
          passed: Boolean(promotionValid && invalidationValid),
          message: `Promotion valid: ${Boolean(promotionValid)}, Invalidation valid: ${Boolean(invalidationValid)}`,
        });

        // ==========================================
        // TEST 10: Gate 27 — Regime-Adaptive Signal Thresholds
        // ==========================================
        
        // 10.1 Regime Normalization and Canonical Threshold Resolution
        const strongTrendRes = Gate27RegimeThresholds.resolveThreshold({
          symbol: 'BTCUSDT',
          actualScore: 76,
          regime: 'STRONG_BULL_TREND',
          strategy: 'TREND_CONTINUATION',
          assetClass: 'CRYPTO',
        });
        const strongTrendPassed = strongTrendRes.isExecutable && strongTrendRes.resolvedThreshold === 75 && strongTrendRes.marginAboveThreshold === 1;

        const normalTrendRes = Gate27RegimeThresholds.resolveThreshold({
          symbol: 'ETHUSDT',
          actualScore: 80,
          regime: 'NORMAL_TREND',
          strategy: 'TREND_CONTINUATION',
          assetClass: 'CRYPTO',
        });
        const normalTrendPassed = normalTrendRes.isExecutable && normalTrendRes.resolvedThreshold === 78 && normalTrendRes.marginAboveThreshold === 2;

        const rangeReversalRes = Gate27RegimeThresholds.resolveThreshold({
          symbol: 'EURUSD',
          actualScore: 79,
          regime: 'RANGE',
          strategy: 'RANGE_REVERSAL',
          assetClass: 'FOREX',
        });
        const rangePassed = rangeReversalRes.isExecutable && rangeReversalRes.resolvedThreshold === 78 && rangeReversalRes.marginAboveThreshold === 1;

        const breakoutRes = Gate27RegimeThresholds.resolveThreshold({
          symbol: 'SOLUSDT',
          actualScore: 81,
          regime: 'BREAKOUT',
          strategy: 'BREAKOUT',
          assetClass: 'CRYPTO',
        });
        const breakoutPassed = breakoutRes.isExecutable && breakoutRes.resolvedThreshold === 78 && breakoutRes.marginAboveThreshold === 3;

        const highVolRes = Gate27RegimeThresholds.resolveThreshold({
          symbol: 'NVDA',
          actualScore: 83,
          regime: 'HIGH_VOLATILITY',
          strategy: 'BREAKOUT',
          assetClass: 'STOCKS',
        });
        const highVolPassed = highVolRes.isExecutable && highVolRes.resolvedThreshold === 82 && highVolRes.marginAboveThreshold === 1;

        const transitionRes = Gate27RegimeThresholds.resolveThreshold({
          symbol: 'AAPL',
          actualScore: 84,
          regime: 'TRANSITION',
          strategy: 'MEAN_REVERSION',
          assetClass: 'STOCKS',
        });
        // Transition base is 85 (+1 for MEAN_REVERSION = 86)
        const transitionPassed = transitionRes.isExecutable && transitionRes.resolvedThreshold === 86 && transitionRes.marginAboveThreshold === -2;

        results.push({
          name: 'Gate 27 - Regime-Adaptive Baseline Thresholds & Margin Calculation',
          passed: Boolean(strongTrendPassed && normalTrendPassed && rangePassed && breakoutPassed && highVolPassed && transitionPassed),
          message: `StrongTrend: ${strongTrendPassed}, NormalTrend: ${normalTrendPassed}, Range: ${rangePassed}, Breakout: ${breakoutPassed}, HighVol: ${highVolPassed}, Transition: ${transitionPassed}`,
          details: { strongTrendRes, normalTrendRes, rangeReversalRes, breakoutRes, highVolRes, transitionRes },
        });

        // 10.2 Strict Block on UNKNOWN / Untradeable Regimes (NO SIGNAL)
        const unknownRegimeRes = Gate27RegimeThresholds.resolveThreshold({
          symbol: 'XRPUSDT',
          actualScore: 95,
          regime: 'UNKNOWN',
          strategy: 'TREND_CONTINUATION',
        });
        const unknownPassed = !unknownRegimeRes.isExecutable && unknownRegimeRes.resolvedThreshold === 999;

        results.push({
          name: 'Gate 27 - Strict UNKNOWN Regime Blocking (NO SIGNAL)',
          passed: unknownPassed,
          message: `UNKNOWN Regime isExecutable=${unknownRegimeRes.isExecutable}, threshold=${unknownRegimeRes.resolvedThreshold} (NO SIGNAL policy enforced)`,
        });

        // 10.3 Logging Format Verification (regime, strategy, threshold, actualScore, marginAboveThreshold)
        const recentLogs = Gate27RegimeThresholds.getLogs(10);
        const lastLog = recentLogs[0];
        const logValid = Boolean(
          lastLog &&
          typeof lastLog.regime === 'string' &&
          typeof lastLog.strategy === 'string' &&
          typeof lastLog.threshold === 'number' &&
          typeof lastLog.actualScore === 'number' &&
          typeof lastLog.marginAboveThreshold === 'number' &&
          typeof lastLog.passed === 'boolean'
        );

        results.push({
          name: 'Gate 27 - Evaluation Logging Completeness',
          passed: logValid,
          message: `Logged fields verified (regime: ${lastLog?.regime}, strategy: ${lastLog?.strategy}, threshold: ${lastLog?.threshold}, actualScore: ${lastLog?.actualScore}, margin: ${lastLog?.marginAboveThreshold})`,
        });

        // 10.4 Anti-Overfitting Sample Size Guardrail
        const smallSampleAttempt = Gate27RegimeThresholds.updatePolicy(
          { regimeThresholds: { STRONG_TREND: 70 } as any },
          12 // Tiny sample size: 12 < 30
        );
        const smallSampleRejected = !smallSampleAttempt.success && smallSampleAttempt.message.includes('INSUFFICIENT_SAMPLE_SIZE');

        const adequateSampleAttempt = Gate27RegimeThresholds.updatePolicy(
          { regimeThresholds: { STRONG_TREND: 75 } as any },
          45 // Adequate sample size: 45 >= 30
        );
        const adequateSampleAccepted = adequateSampleAttempt.success;

        results.push({
          name: 'Gate 27 - Anti-Overfitting Sample Size Protection',
          passed: Boolean(smallSampleRejected && adequateSampleAccepted),
          message: `Small sample size (12) rejected: ${smallSampleRejected}, Adequate sample size (45) accepted: ${adequateSampleAccepted}`,
        });

        // -----------------------------------------------------------------------
        // TEST 11: Gate 28 - Independent Confirmation Diversity
        // -----------------------------------------------------------------------
        // 11.1 Single-category redundancy (5 momentum indicators) must be rejected
        const redundantSingleCat = Gate28ConfirmationDiversity.evaluate([
          'RSI Overbought (72)',
          'MACD Bullish Histogram Crossover',
          'Zero-Lag MACD Momentum Signal',
          'ROC Acceleration Positive',
          'Stochastic Momentum Bullish',
        ]);
        const singleCatRejected = !redundantSingleCat.isValid && redundantSingleCat.categoryCount === 1;

        // 11.2 Multi-category confirmation (Structure + Momentum + Location + Participation) must pass
        const diverseMultiCat = Gate28ConfirmationDiversity.evaluate([
          'Bullish Market Structure BOS Break',
          'RSI Momentum Acceleration (62)',
          'Key Support Bounce S/R Level',
          'High Relative Volume Surge (2.4x rVol)',
        ]);
        const multiCatPassed = diverseMultiCat.isValid && diverseMultiCat.categoryCount === 4;

        results.push({
          name: 'Gate 28 - Single Category Correlated Redundancy Rejection',
          passed: singleCatRejected,
          message: `Redundant single-category setup (5 momentum indicators) rejected: ${singleCatRejected} (Category count: ${redundantSingleCat.categoryCount})`,
        });

        results.push({
          name: 'Gate 28 - Diverse Independent Confirmation Acceptance',
          passed: multiCatPassed,
          message: `Diverse multi-category setup (Structure + Momentum + Location + Participation) accepted: ${multiCatPassed} (Category count: ${diverseMultiCat.categoryCount})`,
        });

        // -----------------------------------------------------------------------
        // TEST 12: Gate 29 - Executable Entry Validation
        // -----------------------------------------------------------------------
        // 12.1 BUY Signal Executable ASK Entry Validation
        // BUY entry = 100.0.
        // Quote A: Mid price = 100.0, Bid = 99.8, Ask = 100.2. Ask > 100.0 => MUST NOT confirm entry.
        const buyNoExec = Gate29ExecutableEntryValidation.validateEntry('BUY', 100.0, { price: 100.0, bid: 99.8, ask: 100.2 });
        const buyMidTouchRejected = !buyNoExec.isEntryConfirmed && buyNoExec.executionSide === 'ASK' && buyNoExec.executionPrice === 100.2;

        // Quote B: Mid price = 99.7, Bid = 99.5, Ask = 99.9. Ask <= 100.0 => MUST confirm entry on ASK.
        const buyExec = Gate29ExecutableEntryValidation.validateEntry('BUY', 100.0, { price: 99.7, bid: 99.5, ask: 99.9 });
        const buyAskTouchConfirmed = buyExec.isEntryConfirmed && buyExec.executionSide === 'ASK' && buyExec.executionPrice === 99.9 && buyExec.spread === 0.4 && Boolean(buyExec.entryTriggerTimestamp);

        results.push({
          name: 'Gate 29 - BUY Executable ASK Entry Validation',
          passed: Boolean(buyMidTouchRejected && buyAskTouchConfirmed),
          message: `BUY mid-touch rejected when ASK (100.2) > entry (100.0): ${buyMidTouchRejected}. Confirmed when ASK (99.9) <= entry: ${buyAskTouchConfirmed} (Spread: ${buyExec.spread})`,
        });

        // 12.2 SELL Signal Executable BID Entry Validation
        // SELL entry = 100.0.
        // Quote A: Mid price = 100.0, Bid = 99.8, Ask = 100.2. Bid < 100.0 => MUST NOT confirm entry.
        const sellNoExec = Gate29ExecutableEntryValidation.validateEntry('SELL', 100.0, { price: 100.0, bid: 99.8, ask: 100.2 });
        const sellMidTouchRejected = !sellNoExec.isEntryConfirmed && sellNoExec.executionSide === 'BID' && sellNoExec.executionPrice === 99.8;

        // Quote B: Mid price = 100.3, Bid = 100.1, Ask = 100.5. Bid >= 100.0 => MUST confirm entry on BID.
        const sellExec = Gate29ExecutableEntryValidation.validateEntry('SELL', 100.0, { price: 100.3, bid: 100.1, ask: 100.5 });
        const sellBidTouchConfirmed = sellExec.isEntryConfirmed && sellExec.executionSide === 'BID' && sellExec.executionPrice === 100.1 && sellExec.spread === 0.4 && Boolean(sellExec.entryTriggerTimestamp);

        results.push({
          name: 'Gate 29 - SELL Executable BID Entry Validation',
          passed: Boolean(sellMidTouchRejected && sellBidTouchConfirmed),
          message: `SELL mid-touch rejected when BID (99.8) < entry (100.0): ${sellMidTouchRejected}. Confirmed when BID (100.1) >= entry: ${sellBidTouchConfirmed} (Spread: ${sellExec.spread})`,
        });

        // 12.3 Fallback to market price model when bid/ask is unavailable
        const fallbackExec = Gate29ExecutableEntryValidation.validateEntry('BUY', 100.0, { price: 99.5 });
        const fallbackConfirmed = fallbackExec.isEntryConfirmed && fallbackExec.isFallbackUsed && fallbackExec.executionPrice === 99.5;

        results.push({
          name: 'Gate 29 - Fallback Market Price Model',
          passed: fallbackConfirmed,
          message: `Fallback market price model used when bid/ask is null: ${fallbackConfirmed} (Execution price: ${fallbackExec.executionPrice})`,
        });

        // -----------------------------------------------------------------------
        // TEST 13: Gate 30 - Asset-Aware Data Freshness Policy
        // -----------------------------------------------------------------------
        const nowMs = 1700000000000;

        // 13.1 Fast Execution Quote Freshness (Crypto quote age limit: 15s)
        // Fresh quote (age 10s): Valid
        const freshCryptoQuote = Gate30DataFreshness.evaluate({
          symbol: 'BTCUSDT',
          assetClass: 'CRYPTO',
          executionRequirement: 'EXECUTABLE_SIGNAL',
          nowMs,
          quote: { price: 50000, timestamp: nowMs - 10000 },
        });

        // Stale quote (age 25s > 15s max for executable crypto): Rejected
        const staleCryptoQuote = Gate30DataFreshness.evaluate({
          symbol: 'BTCUSDT',
          assetClass: 'CRYPTO',
          executionRequirement: 'EXECUTABLE_SIGNAL',
          nowMs,
          quote: { price: 50000, timestamp: nowMs - 25000 },
        });

        const fastQuotePassed = freshCryptoQuote.isValid && !staleCryptoQuote.isValid && staleCryptoQuote.coverageStatus === 'STALE';

        results.push({
          name: 'Gate 30 - Fast Execution Quote Freshness',
          passed: fastQuotePassed,
          message: `Crypto quote age 10s passed: ${freshCryptoQuote.isValid}. Quote age 25s rejected (max 15s for executable crypto): ${!staleCryptoQuote.isValid} (Status: ${staleCryptoQuote.coverageStatus})`,
        });

        // 13.2 Future Timestamp Rejection
        const futureQuote = Gate30DataFreshness.evaluate({
          symbol: 'ETHUSDT',
          assetClass: 'CRYPTO',
          nowMs,
          quote: { price: 3000, timestamp: nowMs + 10000 },
        });
        const futurePassed = !futureQuote.isValid && futureQuote.isFutureTimestamp && futureQuote.coverageStatus === 'FUTURE_TIMESTAMP';

        results.push({
          name: 'Gate 30 - Future Timestamp Rejection',
          passed: futurePassed,
          message: `Future timestamp quote rejected: ${futurePassed} (Coverage status: ${futureQuote.coverageStatus})`,
        });

        // 13.3 Duplicate Candles & Missing Interval Detection
        const interval1h = 3600000;
        const duplicateCandles = [
          { open: 100, high: 105, low: 99, close: 102, timestamp: nowMs - 3 * interval1h },
          { open: 102, high: 106, low: 101, close: 104, timestamp: nowMs - 2 * interval1h },
          { open: 102, high: 106, low: 101, close: 104, timestamp: nowMs - 2 * interval1h }, // Duplicate!
          { open: 104, high: 108, low: 103, close: 107, timestamp: nowMs - interval1h },
        ];
        const dupRes = Gate30DataFreshness.evaluate({
          symbol: 'EURUSD',
          assetClass: 'FOREX',
          timeframe: '1h',
          nowMs,
          candles: duplicateCandles,
        });
        const dupPassed = !dupRes.isValid && dupRes.hasDuplicates && dupRes.coverageStatus === 'DUPLICATES_DETECTED';

        results.push({
          name: 'Gate 30 - Duplicate Candles Detection',
          passed: dupPassed,
          message: `Duplicate candle timestamps rejected: ${dupPassed} (Duplicates count: ${dupRes.details.duplicateTimestampsCount})`,
        });

        // -----------------------------------------------------------------------
        // TEST 14: Gate 31 - News Risk Classification
        // -----------------------------------------------------------------------
        const evalTimeMs = 1700000000000;

        // Register custom news events for deterministic testing
        Gate31NewsRiskClassification.setScheduledEvents([
          {
            id: 'test_fomc',
            title: 'Test FOMC Rate Decision',
            category: 'MACRO_US',
            impact: 'HIGH',
            scheduledTimeMs: evalTimeMs + 10 * 60000, // 10 minutes in future -> BLOCK window (-30m to +30m)
            affectedCurrencies: ['USD'],
            affectedAssetClasses: ['FOREX', 'CRYPTO', 'STOCKS'],
            blackoutBeforeMinutes: 30,
            blackoutAfterMinutes: 30,
          },
          {
            id: 'test_aapl_earnings',
            title: 'Test Apple Earnings Report',
            category: 'STOCK_EARNINGS',
            impact: 'HIGH',
            scheduledTimeMs: evalTimeMs + 10 * 60000, // 10 minutes in future -> BLOCK window
            affectedAssets: ['AAPL'],
            affectedAssetClasses: ['STOCKS'],
            blackoutBeforeMinutes: 30,
            blackoutAfterMinutes: 30,
          },
        ]);

        // 14.1 Asset-Specific Relevance Isolation
        // Apple Earnings MUST block AAPL stock, but MUST NOT block EURUSD or BTCUSDT!
        const eurUsdFomcEval = Gate31NewsRiskClassification.evaluate('EURUSD', evalTimeMs);
        const btcUsdFomcEval = Gate31NewsRiskClassification.evaluate('BTCUSDT', evalTimeMs);
        const aaplEval = Gate31NewsRiskClassification.evaluate('AAPL', evalTimeMs);

        // EURUSD & BTCUSDT blocked by FOMC (macro US)
        const usdPairsBlocked = eurUsdFomcEval.classification === 'BLOCK' && btcUsdFomcEval.classification === 'BLOCK';

        // AAPL stock blocked by Apple Earnings
        const aaplBlocked = aaplEval.classification === 'BLOCK';

        // Verify Apple Earnings alone does NOT block EURUSD when FOMC is removed
        Gate31NewsRiskClassification.setScheduledEvents([
          {
            id: 'test_aapl_earnings_only',
            title: 'Test Apple Earnings Report Only',
            category: 'STOCK_EARNINGS',
            impact: 'HIGH',
            scheduledTimeMs: evalTimeMs + 10 * 60000,
            affectedAssets: ['AAPL'],
            affectedAssetClasses: ['STOCKS'],
            blackoutBeforeMinutes: 30,
            blackoutAfterMinutes: 30,
          },
        ]);

        const eurUsdIrrelevantEval = Gate31NewsRiskClassification.evaluate('EURUSD', evalTimeMs);
        const btcUsdIrrelevantEval = Gate31NewsRiskClassification.evaluate('BTCUSDT', evalTimeMs);
        const stockIsolationPassed =
          eurUsdIrrelevantEval.classification === 'NORMAL' &&
          btcUsdIrrelevantEval.classification === 'NORMAL' &&
          usdPairsBlocked &&
          aaplBlocked;

        results.push({
          name: 'Gate 31 - Asset-Specific News Risk Isolation',
          passed: stockIsolationPassed,
          message: `Stock earnings blocked AAPL: ${aaplBlocked}, but spared EURUSD (${eurUsdIrrelevantEval.classification}) and BTC (${btcUsdIrrelevantEval.classification}): ${stockIsolationPassed}`,
        });

        // 14.2 CAUTION vs BLOCK State Classification
        Gate31NewsRiskClassification.setScheduledEvents([
          {
            id: 'test_ecb_caution',
            title: 'Test ECB Speech',
            category: 'CENTRAL_BANK',
            impact: 'MEDIUM',
            scheduledTimeMs: evalTimeMs + 45 * 60000, // 45m in future -> CAUTION window (30m - 60m)
            affectedCurrencies: ['EUR'],
            affectedAssetClasses: ['FOREX'],
            blackoutBeforeMinutes: 15,
            blackoutAfterMinutes: 15,
            cautionBeforeMinutes: 60,
            cautionAfterMinutes: 30,
          },
        ]);

        const eurusdCautionEval = Gate31NewsRiskClassification.evaluate('EURUSD', evalTimeMs);
        const cautionPassed =
          eurusdCautionEval.classification === 'CAUTION' &&
          eurusdCautionEval.isTradingAllowed === true &&
          eurusdCautionEval.minRequiredConfirmationScore === 80 &&
          eurusdCautionEval.neverFabricateSignalEnforced === true;

        results.push({
          name: 'Gate 31 - CAUTION Classification & Higher Threshold Requirement',
          passed: cautionPassed,
          message: `Approaching news classified as CAUTION: ${cautionPassed} (Trading allowed: ${eurusdCautionEval.isTradingAllowed}, Min score: ${eurusdCautionEval.minRequiredConfirmationScore})`,
        });

        // -----------------------------------------------------------------------
        // TEST 15: Gate 32 - Adaptive Deep-Candidate Selection Engine
        // -----------------------------------------------------------------------
        const sampleCandidates: Stage2CandidateInput[] = [
          { asset: 'EURUSD', preliminaryScore: 82, marketRegimeScore: 85, relativeStrengthScore: 80, volatilitySuitabilityScore: 80 }, // #1
          { asset: 'GBPUSD', preliminaryScore: 78, marketRegimeScore: 80, relativeStrengthScore: 75, volatilitySuitabilityScore: 75 }, // #2
          { asset: 'USDJPY', preliminaryScore: 75, marketRegimeScore: 75, relativeStrengthScore: 70, volatilitySuitabilityScore: 70 }, // #3
          { asset: 'AUDUSD', preliminaryScore: 72, marketRegimeScore: 70, relativeStrengthScore: 68, volatilitySuitabilityScore: 65 }, // #4
          { asset: 'USDCAD', preliminaryScore: 70, marketRegimeScore: 68, relativeStrengthScore: 65, volatilitySuitabilityScore: 65 }, // #5 (Cutoff if cap=5)
          { asset: 'NZDUSD', preliminaryScore: 69, marketRegimeScore: 68, relativeStrengthScore: 65, volatilitySuitabilityScore: 65 }, // #6 (Tightly clustered with #5! Delta ~0.9pt)
          { asset: 'USDCHF', preliminaryScore: 68, marketRegimeScore: 65, relativeStrengthScore: 62, volatilitySuitabilityScore: 60 }, // #7
          { asset: 'BTCUSDT', preliminaryScore: 50, marketRegimeScore: 40, relativeStrengthScore: 40, volatilitySuitabilityScore: 40 }, // #8 (Far away)
        ];

        // 15.1 Budget-based selection (CONSTRAINED budget = base cap 5, but cluster expansion includes #6 NZDUSD)
        const constrainedSelection = Gate32AdaptiveCandidateSelection.selectCandidates(
          sampleCandidates,
          { constrainedQuotaLimit: 5, clusterScoreDeltaThreshold: 4.0, clusterMaxBonusSlots: 2, maxApiQuotaLimit: 10 },
          'twelvedata'
        );

        const clusterExpandedPassed =
          constrainedSelection.clusterExpansionTriggered === true &&
          constrainedSelection.selectedCandidates.some((c) => c.asset === 'NZDUSD') &&
          constrainedSelection.selectedCandidates.length === 6;

        results.push({
          name: 'Gate 32 - Tightly Clustered Candidate Pool Expansion',
          passed: clusterExpandedPassed,
          message: `Cluster expansion triggered for #6 NZDUSD (delta <= 4pt): ${clusterExpandedPassed} (Selected count: ${constrainedSelection.selectedCandidates.length}, Expanded count: ${constrainedSelection.expandedCandidateCount})`,
        });

        // 15.2 Healthy API Budget expansion (HEALTHY budget = base cap 10 -> all qualified candidates selected up to max limit)
        const healthySelection = Gate32AdaptiveCandidateSelection.selectCandidates(
          sampleCandidates,
          { healthyQuotaLimit: 10, maxApiQuotaLimit: 10 },
          'twelvedata'
        );

        const healthyPassed = healthySelection.selectedCandidates.length === 8;

        results.push({
          name: 'Gate 32 - Healthy Budget Full Deep Scan',
          passed: healthyPassed,
          message: `Healthy budget expanded deep scan to all 8 candidates: ${healthyPassed} (Base cap: ${healthySelection.baseQuotaLimit})`,
        });

        // -----------------------------------------------------------------------
        // TEST 16: Gate 33 - AI Assessment is Qualitative, NOT Statistical Probability
        // -----------------------------------------------------------------------
        const baseDeterministicScore = 85;

        // 16.1 Confirmation response classification & zero confidence boost check
        const aiConfirmRes = Gate33AiAssessmentPolicy.classifyResponse(
          'Solid confluence. 1H trend alignment and 15m RSI divergence support entry.',
          baseDeterministicScore,
          true
        );

        const confirmPassed =
          aiConfirmRes.classification === 'QUALITATIVE_CONFIRMATION' &&
          aiConfirmRes.refinedConfidence === 85 && // MUST NOT be 87 (+2 removed)!
          aiConfirmRes.isAiValidated === true &&
          aiConfirmRes.neverBoostConfidenceEnforced === true &&
          aiConfirmRes.neverInventProbabilityEnforced === true;

        results.push({
          name: 'Gate 33 - Qualitative Confirmation & Zero Arbitrary Boost',
          passed: confirmPassed,
          message: `AI confirmation classified as ${aiConfirmRes.classification}. Deterministic score preserved at ${aiConfirmRes.refinedConfidence} (No +2 boost): ${confirmPassed}`,
        });

        // 16.2 Contradiction response classification
        const aiContradictRes = Gate33AiAssessmentPolicy.classifyResponse(
          'Caution: High risk due to severe higher timeframe bearish divergence against long entry.',
          baseDeterministicScore,
          true
        );

        const contradictPassed =
          aiContradictRes.classification === 'QUALITATIVE_CONTRADICTION' &&
          aiContradictRes.refinedConfidence === 85 &&
          aiContradictRes.isAiValidated === false;

        results.push({
          name: 'Gate 33 - Qualitative Contradiction Classification',
          passed: contradictPassed,
          message: `AI contradiction classified as ${aiContradictRes.classification}: ${contradictPassed} (isAiValidated: ${aiContradictRes.isAiValidated})`,
        });

        // 16.3 Unavailable AI service classification
        const aiUnavailableRes = Gate33AiAssessmentPolicy.classifyResponse(
          null,
          baseDeterministicScore,
          false
        );

        const unavailablePassed =
          aiUnavailableRes.classification === 'UNAVAILABLE' &&
          aiUnavailableRes.refinedConfidence === 85 &&
          aiUnavailableRes.isAiValidated === false;

        results.push({
          name: 'Gate 33 - AI Unavailable State Handling',
          passed: unavailablePassed,
          message: `AI offline handled gracefully as ${aiUnavailableRes.classification}: ${unavailablePassed}`,
        });

        // -----------------------------------------------------------------------
        // TEST 17: Gate 34 - Execution Friction Stress Test Engine
        // -----------------------------------------------------------------------
        // 17.1 Forex EURUSD test (Spread, slippage > 0, fees, latency buffer, Gross vs Net R:R)
        const eurusdFriction = Gate34ExecutionFrictionStressTest.evaluate('EURUSD', 1.08500, 1.08200, 1.09250);
        const eurusdPassed =
          eurusdFriction.assetClass === 'FOREX' &&
          eurusdFriction.grossRR === 2.5 &&
          eurusdFriction.normal.slippage > 0 && // Slippage NEVER zero!
          eurusdFriction.normal.netRR > 0 &&
          eurusdFriction.adverse.netRR > 0 &&
          eurusdFriction.normal.netRR < eurusdFriction.grossRR &&
          eurusdFriction.adverse.netRR <= eurusdFriction.normal.netRR &&
          eurusdFriction.isPassed === true;

        results.push({
          name: 'Gate 34 - Forex Execution Friction Stress Test (EURUSD)',
          passed: eurusdPassed,
          message: `EURUSD Gross R:R=${eurusdFriction.grossRR}:1, Normal Net R:R=${eurusdFriction.normal.netRR}:1, Adverse Net R:R=${eurusdFriction.adverse.netRR}:1: ${eurusdPassed}`,
        });

        // 17.2 Crypto BTCUSDT test (Percentage-based friction profile)
        const btcusdtFriction = Gate34ExecutionFrictionStressTest.evaluate('BTCUSDT', 65000, 64000, 68000);
        const cryptoPassed =
          btcusdtFriction.assetClass === 'CRYPTO' &&
          btcusdtFriction.normal.slippage > 0 &&
          btcusdtFriction.normal.fees > 0 &&
          btcusdtFriction.normal.latencyBuffer > 0 &&
          btcusdtFriction.normal.netRR < btcusdtFriction.grossRR &&
          btcusdtFriction.isPassed === true;

        results.push({
          name: 'Gate 34 - Crypto Execution Friction Stress Test (BTCUSDT)',
          passed: cryptoPassed,
          message: `BTCUSDT Gross R:R=${btcusdtFriction.grossRR}:1, Normal Net R:R=${btcusdtFriction.normal.netRR}:1, Adverse Net R:R=${btcusdtFriction.adverse.netRR}:1: ${cryptoPassed}`,
        });

        // 17.3 Stocks AAPL test (Share/cents-based friction profile)
        const aaplFriction = Gate34ExecutionFrictionStressTest.evaluate('AAPL', 220, 217, 227.5);
        const stocksPassed =
          aaplFriction.assetClass === 'STOCKS' &&
          aaplFriction.normal.slippage > 0 &&
          aaplFriction.normal.netRR < aaplFriction.grossRR &&
          aaplFriction.isPassed === true;

        results.push({
          name: 'Gate 34 - Stocks Execution Friction Stress Test (AAPL)',
          passed: stocksPassed,
          message: `AAPL Gross R:R=${aaplFriction.grossRR}:1, Normal Net R:R=${aaplFriction.normal.netRR}:1, Adverse Net R:R=${aaplFriction.adverse.netRR}:1: ${stocksPassed}`,
        });

        // 17.4 Rejection on insufficient Net R:R under adverse conditions
        const tightFriction = Gate34ExecutionFrictionStressTest.evaluate('EURUSD', 1.08500, 1.08480, 1.08520, { minimumNetRR: 1.50, minimumAdverseNetRR: 1.00 });
        const rejectionPassed = tightFriction.isPassed === false && tightFriction.rejectionReason !== undefined;

        results.push({
          name: 'Gate 34 - Rejection on Friction Degradation',
          passed: rejectionPassed,
          message: `Tight profit target rejected by Gate 34 as expected: ${rejectionPassed} (Reason: ${tightFriction.rejectionReason})`,
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
