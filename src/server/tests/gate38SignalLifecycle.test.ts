import assert from 'assert';
import { SignalLifecycleManager } from '../signals/SignalLifecycleManager.js';
import { ScannerPersistence, PersistedSentSignal } from '../signals/ScannerPersistence.js';
import { SignalOutcomeLogger, SignalOutcomeRecord } from '../signals/SignalOutcomeLogger.js';
import { marketDataManager } from '../market/MarketDataManager.js';
import { NormalizedTicker, NormalizedCandle } from '../market/types.js';

import { describe, it } from "vitest";
describe("gate38SignalLifecycle.test.ts", () => {
  it("runs the test suite", async () => {
    
    console.log('========================================================================');
    console.log('STARTING GATE 38: COMPLETE SIGNAL LIFECYCLE TESTING');
    console.log('========================================================================');
    
    async function runTests() {
      const originalGetActiveSignals = ScannerPersistence.getActiveSignals;
      const originalGetPrice = marketDataManager.getPrice;
      const originalGetCandles = marketDataManager.getCandles;
      const originalUpdateSignalStatus = ScannerPersistence.updateSignalStatus;
      const originalGetOutcome = SignalOutcomeLogger.getOutcome;
      const originalRecordOutcome = SignalOutcomeLogger.recordOutcome;
    
      let outcomeStore = new Map<string, SignalOutcomeRecord>();
    
      // Mock SignalOutcomeLogger
      SignalOutcomeLogger.getOutcome = async (id: string) => {
        return outcomeStore.get(id) || null;
      };
      SignalOutcomeLogger.recordOutcome = async (record: SignalOutcomeRecord) => {
        outcomeStore.set(record.id, record);
      };
    
      // Helper to reset evaluation lock and clean up mocks
      const resetLifecycleManager = () => {
        (SignalLifecycleManager as any).isEvaluating = false;
      };
    
      // -------------------------------------------------------------------------
      // CASE 1: Signal generated. Entry never reached. → EXPIRED.
      // -------------------------------------------------------------------------
      console.log('\n--- CASE 1: Signal generated, Entry never reached → EXPIRED ---');
      {
        resetLifecycleManager();
        const testSignal: PersistedSentSignal = {
          id: 'sig_case1',
          snapshotId: 'snap_case1',
          symbol: 'BTCUSDT',
          direction: 'BUY',
          entryPrice: 100,
          stopLoss: 95,
          takeProfit: 110,
          tp1: 102,
          tp2: 105,
          tp3: 110,
          riskRewardRatio: 2.0,
          score: 85,
          rankTier: 'BEST_TRADE',
          strategy: 'Trend Continuation',
          timeframe: '1h',
          dataSource: 'bitget',
          status: 'WAITING_ENTRY',
          timestamp: Date.now() - 5 * 3600 * 1000, // 5 hours ago (older than 4h limit)
          date: new Date().toISOString().split('T')[0],
          notificationSent: false,
          notificationTimestamp: 0,
        };
    
        ScannerPersistence.getActiveSignals = async () => [testSignal];
        marketDataManager.getCandles = async () => [
          {
            symbol: 'BTCUSDT',
            provider: 'bitget',
            timeframe: '1m',
            open: 105,
            high: 106,
            low: 104, // never touches entry (100)
            close: 105,
            volume: 100,
            timestamp: Date.now() - 4 * 3600 * 1000,
          }
        ];
        marketDataManager.getPrice = async (sym) => ({
          symbol: sym,
          rawSymbol: sym,
          price: 105,
          bid: 104.9,
          ask: 105.1,
          timestamp: Date.now(),
          receivedAt: Date.now(),
          provider: 'bitget',
          assetType: 'CRYPTO',
          source: 'LIVE',
          isFresh: true,
          status: 'OK',
        });
    
        let savedStatus = '';
        ScannerPersistence.updateSignalStatus = async (id, status, metadata) => {
          savedStatus = status;
          testSignal.status = status;
          if (metadata) Object.assign(testSignal, metadata);
        };
    
        await SignalLifecycleManager.evaluateActiveSignals();
        assert.strictEqual(testSignal.status, 'EXPIRED', 'Signal should expire when time limit passes without entry hit');
        console.log('[PASS] Case 1 expired successfully.');
      }
    
      // -------------------------------------------------------------------------
      // CASE 2: Displayed price touches entry but executable-side entry not confirmed → EXPIRED.
      // -------------------------------------------------------------------------
      console.log('\n--- CASE 2: Price touches entry, but executable-side entry not confirmed → EXPIRED ---');
      {
        resetLifecycleManager();
        const testSignal: PersistedSentSignal = {
          id: 'sig_case2',
          snapshotId: 'snap_case2',
          symbol: 'BTCUSDT',
          direction: 'BUY',
          entryPrice: 100,
          stopLoss: 95,
          takeProfit: 110,
          tp1: 102,
          tp2: 105,
          tp3: 110,
          riskRewardRatio: 2.0,
          score: 85,
          rankTier: 'BEST_TRADE',
          strategy: 'Trend Continuation',
          timeframe: '1h',
          dataSource: 'bitget',
          status: 'WAITING_ENTRY',
          timestamp: Date.now() - 5 * 3600 * 1000, // 5 hours ago
          date: new Date().toISOString().split('T')[0],
          notificationSent: false,
          notificationTimestamp: 0,
        };
    
        ScannerPersistence.getActiveSignals = async () => [testSignal];
        marketDataManager.getCandles = async () => []; // No historical candles touch it
        marketDataManager.getPrice = async (sym) => ({
          symbol: sym,
          rawSymbol: sym,
          price: 99, // display price crossed below entry 100!
          bid: 101,
          ask: 101, // Executable Ask price is 101 (higher than entry 100), not confirmed!
          timestamp: Date.now(),
          receivedAt: Date.now(),
          provider: 'bitget',
          assetType: 'CRYPTO',
          source: 'LIVE',
          isFresh: true,
          status: 'OK',
        });
    
        ScannerPersistence.updateSignalStatus = async (id, status, metadata) => {
          testSignal.status = status;
          if (metadata) Object.assign(testSignal, metadata);
        };
    
        await SignalLifecycleManager.evaluateActiveSignals();
        assert.strictEqual(testSignal.status, 'EXPIRED', 'Should expire because actual execution ask price 101 did not touch entry 100');
        console.log('[PASS] Case 2 expired successfully.');
      }
    
      // -------------------------------------------------------------------------
      // CASE 3: Entry confirmed → ACTIVE.
      // -------------------------------------------------------------------------
      console.log('\n--- CASE 3: Entry confirmed → ACTIVE ---');
      {
        resetLifecycleManager();
        const testSignal: PersistedSentSignal = {
          id: 'sig_case3',
          snapshotId: 'snap_case3',
          symbol: 'BTCUSDT',
          direction: 'BUY',
          entryPrice: 100,
          stopLoss: 95,
          takeProfit: 110,
          tp1: 102,
          tp2: 105,
          tp3: 110,
          riskRewardRatio: 2.0,
          score: 85,
          rankTier: 'BEST_TRADE',
          strategy: 'Trend Continuation',
          timeframe: '1h',
          dataSource: 'bitget',
          status: 'WAITING_ENTRY',
          timestamp: Date.now() - 10 * 1000, // Fresh signal
          date: new Date().toISOString().split('T')[0],
          notificationSent: false,
          notificationTimestamp: 0,
        };
    
        ScannerPersistence.getActiveSignals = async () => [testSignal];
        marketDataManager.getCandles = async () => [];
        marketDataManager.getPrice = async (sym) => ({
          symbol: sym,
          rawSymbol: sym,
          price: 99.5,
          bid: 99.4,
          ask: 99.6, // Executable Ask <= entryPrice (100) -> Confirmed!
          timestamp: Date.now(),
          receivedAt: Date.now(),
          provider: 'bitget',
          assetType: 'CRYPTO',
          source: 'LIVE',
          isFresh: true,
          status: 'OK',
        });
    
        ScannerPersistence.updateSignalStatus = async (id, status, metadata) => {
          testSignal.status = status;
          if (metadata) Object.assign(testSignal, metadata);
        };
    
        await SignalLifecycleManager.evaluateActiveSignals();
        assert.strictEqual(testSignal.status, 'ACTIVE', 'Signal should transition to ACTIVE when executable price is crossed');
        console.log('[PASS] Case 3 transitioned to ACTIVE.');
      }
    
      // -------------------------------------------------------------------------
      // CASE 4: Entry confirmed, TP1 reached → TP1_HIT.
      // -------------------------------------------------------------------------
      console.log('\n--- CASE 4: Entry confirmed, TP1 reached → TP1_HIT ---');
      {
        resetLifecycleManager();
        const testSignal: PersistedSentSignal = {
          id: 'sig_case4',
          snapshotId: 'snap_case4',
          symbol: 'BTCUSDT',
          direction: 'BUY',
          entryPrice: 100,
          stopLoss: 95,
          takeProfit: 110,
          tp1: 102,
          tp2: 105,
          tp3: 110,
          riskRewardRatio: 2.0,
          score: 85,
          rankTier: 'BEST_TRADE',
          strategy: 'Trend Continuation',
          timeframe: '1h',
          dataSource: 'bitget',
          status: 'ACTIVE', // already active
          timestamp: Date.now() - 10000,
          date: new Date().toISOString().split('T')[0],
          notificationSent: false,
          notificationTimestamp: 0,
        };
    
        ScannerPersistence.getActiveSignals = async () => [testSignal];
        marketDataManager.getCandles = async () => [];
        marketDataManager.getPrice = async (sym) => ({
          symbol: sym,
          rawSymbol: sym,
          price: 103, // crossed TP1 (102) but not TP2 (105)
          bid: 102.9,
          ask: 103.1,
          timestamp: Date.now(),
          receivedAt: Date.now(),
          provider: 'bitget',
          assetType: 'CRYPTO',
          source: 'LIVE',
          isFresh: true,
          status: 'OK',
        });
    
        ScannerPersistence.updateSignalStatus = async (id, status, metadata) => {
          testSignal.status = status;
          if (metadata) Object.assign(testSignal, metadata);
        };
    
        await SignalLifecycleManager.evaluateActiveSignals();
        assert.strictEqual(testSignal.status, 'TP1_HIT', 'Signal should transition to TP1_HIT');
        assert.strictEqual(testSignal.tp1Status, 'HIT', 'TP1 status must be HIT');
        console.log('[PASS] Case 4 hit TP1.');
      }
    
      // -------------------------------------------------------------------------
      // CASE 5: Entry confirmed. TP1 → TP2 → TP3. → COMPLETED.
      // -------------------------------------------------------------------------
      console.log('\n--- CASE 5: Entry confirmed, TP1 → TP2 → TP3 → COMPLETED ---');
      {
        resetLifecycleManager();
        const testSignal: PersistedSentSignal = {
          id: 'sig_case5',
          snapshotId: 'snap_case5',
          symbol: 'BTCUSDT',
          direction: 'BUY',
          entryPrice: 100,
          stopLoss: 95,
          takeProfit: 110,
          tp1: 102,
          tp2: 105,
          tp3: 110,
          riskRewardRatio: 2.0,
          score: 85,
          rankTier: 'BEST_TRADE',
          strategy: 'Trend Continuation',
          timeframe: '1h',
          dataSource: 'bitget',
          status: 'ACTIVE',
          timestamp: Date.now() - 100000,
          date: new Date().toISOString().split('T')[0],
          notificationSent: false,
          notificationTimestamp: 0,
        };
    
        ScannerPersistence.getActiveSignals = async () => [testSignal];
        // Historical candles hitting TPs chronologically
        marketDataManager.getCandles = async () => [
          {
            symbol: 'BTCUSDT',
            provider: 'bitget',
            timeframe: '1m',
            open: 101,
            high: 103, // TP1 (102) hit
            low: 100,
            close: 101,
            volume: 10,
            timestamp: Date.now() - 50000,
          },
          {
            symbol: 'BTCUSDT',
            provider: 'bitget',
            timeframe: '1m',
            open: 101,
            high: 106, // TP2 (105) hit
            low: 101,
            close: 104,
            volume: 12,
            timestamp: Date.now() - 40000,
          },
          {
            symbol: 'BTCUSDT',
            provider: 'bitget',
            timeframe: '1m',
            open: 104,
            high: 111, // TP3 (110) hit
            low: 104,
            close: 111,
            volume: 15,
            timestamp: Date.now() - 30000,
          }
        ];
    
        marketDataManager.getPrice = async (sym) => ({
          symbol: sym,
          rawSymbol: sym,
          price: 111,
          bid: 110.9,
          ask: 111.1,
          timestamp: Date.now(),
          receivedAt: Date.now(),
          provider: 'bitget',
          assetType: 'CRYPTO',
          source: 'LIVE',
          isFresh: true,
          status: 'OK',
        });
    
        const statusTrace: string[] = [];
        ScannerPersistence.updateSignalStatus = async (id, status, metadata) => {
          statusTrace.push(status);
          testSignal.status = status;
          if (metadata) Object.assign(testSignal, metadata);
        };
    
        await SignalLifecycleManager.evaluateActiveSignals();
        assert.ok(testSignal.status === 'TP3_HIT' || testSignal.status === 'COMPLETED', 'Signal should transition to TP3_HIT/COMPLETED after all TPs hit');
        assert.ok(statusTrace.includes('TP1_HIT'), 'Status trace should include TP1_HIT');
        assert.ok(statusTrace.includes('TP2_HIT'), 'Status trace should include TP2_HIT');
        assert.ok(statusTrace.includes('COMPLETED') || statusTrace.includes('TP3_HIT'), 'Status trace should include COMPLETED / TP3_HIT');
        console.log('[PASS] Case 5 progressed to completion.');
      }
    
      // -------------------------------------------------------------------------
      // CASE 6: Entry confirmed. SL reached. → STOPPED_OUT.
      // -------------------------------------------------------------------------
      console.log('\n--- CASE 6: Entry confirmed, SL reached → STOPPED_OUT ---');
      {
        resetLifecycleManager();
        const testSignal: PersistedSentSignal = {
          id: 'sig_case6',
          snapshotId: 'snap_case6',
          symbol: 'BTCUSDT',
          direction: 'BUY',
          entryPrice: 100,
          stopLoss: 95,
          takeProfit: 110,
          tp1: 102,
          tp2: 105,
          tp3: 110,
          riskRewardRatio: 2.0,
          score: 85,
          rankTier: 'BEST_TRADE',
          strategy: 'Trend Continuation',
          timeframe: '1h',
          dataSource: 'bitget',
          status: 'ACTIVE',
          timestamp: Date.now() - 10000,
          date: new Date().toISOString().split('T')[0],
          notificationSent: false,
          notificationTimestamp: 0,
        };
    
        ScannerPersistence.getActiveSignals = async () => [testSignal];
        marketDataManager.getCandles = async () => [];
        marketDataManager.getPrice = async (sym) => ({
          symbol: sym,
          rawSymbol: sym,
          price: 94, // drops below Stop Loss (95)
          bid: 93.9,
          ask: 94.1,
          timestamp: Date.now(),
          receivedAt: Date.now(),
          provider: 'bitget',
          assetType: 'CRYPTO',
          source: 'LIVE',
          isFresh: true,
          status: 'OK',
        });
    
        ScannerPersistence.updateSignalStatus = async (id, status, metadata) => {
          testSignal.status = status;
          if (metadata) Object.assign(testSignal, metadata);
        };
    
        await SignalLifecycleManager.evaluateActiveSignals();
        assert.ok(testSignal.status === 'STOPPED_OUT' || testSignal.status === 'SL_HIT', 'Signal should transition to STOPPED_OUT or SL_HIT when SL reached');
        assert.strictEqual(testSignal.slStatus, 'HIT', 'Stop Loss status must be HIT');
        console.log('[PASS] Case 6 stopped out.');
      }
    
      // -------------------------------------------------------------------------
      // CASE 7: TP and SL occur in same candle with unknown order. → AMBIGUOUS.
      // -------------------------------------------------------------------------
      console.log('\n--- CASE 7: TP and SL in same candle → AMBIGUOUS ---');
      {
        resetLifecycleManager();
        const testSignal: PersistedSentSignal = {
          id: 'sig_case7',
          snapshotId: 'snap_case7',
          symbol: 'BTCUSDT',
          direction: 'BUY',
          entryPrice: 100,
          stopLoss: 95,
          takeProfit: 110,
          tp1: 102,
          tp2: 105,
          tp3: 110,
          riskRewardRatio: 2.0,
          score: 85,
          rankTier: 'BEST_TRADE',
          strategy: 'Trend Continuation',
          timeframe: '1h',
          dataSource: 'bitget',
          status: 'ACTIVE',
          timestamp: Date.now() - 100000,
          date: new Date().toISOString().split('T')[0],
          notificationSent: false,
          notificationTimestamp: 0,
        };
    
        ScannerPersistence.getActiveSignals = async () => [testSignal];
        marketDataManager.getCandles = async () => [
          {
            symbol: 'BTCUSDT',
            provider: 'bitget',
            timeframe: '1m',
            open: 98,  // open is between SL (95) and next TP (102)
            high: 103, // touches TP1
            low: 94,   // touches Stop Loss
            close: 99,
            volume: 100,
            timestamp: Date.now() - 50000,
          }
        ];
    
        marketDataManager.getPrice = async (sym) => ({
          symbol: sym,
          rawSymbol: sym,
          price: 99,
          bid: 98.9,
          ask: 99.1,
          timestamp: Date.now(),
          receivedAt: Date.now(),
          provider: 'bitget',
          assetType: 'CRYPTO',
          source: 'LIVE',
          isFresh: true,
          status: 'OK',
        });
    
        ScannerPersistence.updateSignalStatus = async (id, status, metadata) => {
          testSignal.status = status;
          if (metadata) Object.assign(testSignal, metadata);
        };
    
        await SignalLifecycleManager.evaluateActiveSignals();
        assert.strictEqual(testSignal.status, 'AMBIGUOUS', 'Signal with simultaneous TP & SL hits in same candle must be AMBIGUOUS');
        console.log('[PASS] Case 7 marked AMBIGUOUS correctly.');
      }
    
      // -------------------------------------------------------------------------
      // CASE 8: Signal is ACTIVE after entry. Original expiration passes. → MUST NOT EXPIRE.
      // -------------------------------------------------------------------------
      console.log('\n--- CASE 8: ACTIVE signal passes expiration time → MUST NOT EXPIRE ---');
      {
        resetLifecycleManager();
        const testSignal: PersistedSentSignal = {
          id: 'sig_case8',
          snapshotId: 'snap_case8',
          symbol: 'BTCUSDT',
          direction: 'BUY',
          entryPrice: 100,
          stopLoss: 95,
          takeProfit: 110,
          tp1: 102,
          tp2: 105,
          tp3: 110,
          riskRewardRatio: 2.0,
          score: 85,
          rankTier: 'BEST_TRADE',
          strategy: 'Trend Continuation',
          timeframe: '1h',
          dataSource: 'bitget',
          status: 'ACTIVE', // already active!
          timestamp: Date.now() - 10 * 3600 * 1000, // 10 hours ago (exceeds TTL)
          date: new Date().toISOString().split('T')[0],
          notificationSent: false,
          notificationTimestamp: 0,
        };
    
        ScannerPersistence.getActiveSignals = async () => [testSignal];
        marketDataManager.getCandles = async () => [];
        marketDataManager.getPrice = async (sym) => ({
          symbol: sym,
          rawSymbol: sym,
          price: 101, // stays in active range
          bid: 100.9,
          ask: 101.1,
          timestamp: Date.now(),
          receivedAt: Date.now(),
          provider: 'bitget',
          assetType: 'CRYPTO',
          source: 'LIVE',
          isFresh: true,
          status: 'OK',
        });
    
        let savedStatus = '';
        ScannerPersistence.updateSignalStatus = async (id, status, metadata) => {
          savedStatus = status;
          testSignal.status = status;
          if (metadata) Object.assign(testSignal, metadata);
        };
    
        await SignalLifecycleManager.evaluateActiveSignals();
        assert.notStrictEqual(testSignal.status, 'EXPIRED', 'ACTIVE signals must never expire by time');
        assert.strictEqual(testSignal.status, 'ACTIVE', 'ACTIVE signal remains ACTIVE within the range');
        console.log('[PASS] Case 8 did not expire.');
      }
    
      // -------------------------------------------------------------------------
      // CASE 9: Duplicate evaluation. → No duplicate transitions or notifications.
      // -------------------------------------------------------------------------
      console.log('\n--- CASE 9: Duplicate evaluation → No duplicate transitions ---');
      {
        resetLifecycleManager();
        const testSignal: PersistedSentSignal = {
          id: 'sig_case9',
          snapshotId: 'snap_case9',
          symbol: 'BTCUSDT',
          direction: 'BUY',
          entryPrice: 100,
          stopLoss: 95,
          takeProfit: 110,
          tp1: 102,
          tp2: 105,
          tp3: 110,
          riskRewardRatio: 2.0,
          score: 85,
          rankTier: 'BEST_TRADE',
          strategy: 'Trend Continuation',
          timeframe: '1h',
          dataSource: 'bitget',
          status: 'ACTIVE',
          timestamp: Date.now() - 10000,
          date: new Date().toISOString().split('T')[0],
          notificationSent: false,
          notificationTimestamp: 0,
        };
    
        // First evaluation hits TP1
        const res1 = SignalLifecycleManager.evaluateSignalPriceUpdate(testSignal, 103, Date.now());
        assert.strictEqual(res1.newStatus, 'TP1_HIT');
        assert.strictEqual(res1.transitions.length, 1, 'Should record exactly 1 transition');
    
        // Update state representing signal after TP1 hit
        const updatedState1: PersistedSentSignal = {
          ...testSignal,
          status: res1.newStatus,
          tp1Status: res1.tp1Status,
          tp1HitAt: res1.tp1HitAt,
          tp1HitPrice: res1.tp1HitPrice,
        };
    
        // Second evaluation with same or similar price in TP1 zone
        const res2 = SignalLifecycleManager.evaluateSignalPriceUpdate(updatedState1, 103.5, Date.now() + 1000);
        assert.strictEqual(res2.newStatus, 'TP1_HIT');
        assert.strictEqual(res2.transitions.length, 0, 'Should record 0 new transitions (no duplicates)');
        console.log('[PASS] Case 9 duplicate evaluation safety verified.');
      }
    
      // -------------------------------------------------------------------------
      // CASE 10: Service restarts. → Lifecycle state persists correctly.
      // -------------------------------------------------------------------------
      console.log('\n--- CASE 10: Service restarts → Lifecycle state persists correctly ---');
      {
        resetLifecycleManager();
        const testSignal: PersistedSentSignal = {
          id: 'sig_case10',
          snapshotId: 'snap_case10',
          symbol: 'BTCUSDT',
          direction: 'BUY',
          entryPrice: 100,
          stopLoss: 95,
          takeProfit: 110,
          tp1: 102,
          tp2: 105,
          tp3: 110,
          riskRewardRatio: 2.0,
          score: 85,
          rankTier: 'BEST_TRADE',
          strategy: 'Trend Continuation',
          timeframe: '1h',
          dataSource: 'bitget',
          status: 'TP1_HIT', // Stored state is already TP1_HIT
          tp1Status: 'HIT',
          tp1HitAt: new Date(Date.now() - 10000).toISOString(),
          tp1HitPrice: 103,
          timestamp: Date.now() - 20000,
          date: new Date().toISOString().split('T')[0],
          notificationSent: false,
          notificationTimestamp: 0,
        };
    
        // Store outcome log representation
        const record: SignalOutcomeRecord = {
          id: testSignal.id,
          symbol: testSignal.symbol,
          direction: testSignal.direction,
          provider: testSignal.dataSource,
          entryPrice: testSignal.entryPrice,
          stopLoss: testSignal.stopLoss,
          takeProfit: testSignal.takeProfit,
          tp1: testSignal.tp1!,
          tp2: testSignal.tp2!,
          tp3: testSignal.tp3!,
          tp1Status: 'HIT',
          tp1HitAt: testSignal.tp1HitAt,
          tp1HitPrice: testSignal.tp1HitPrice,
          status: 'TP1_HIT',
          timestamp: testSignal.timestamp,
          updatedAt: Date.now(),
        };
        outcomeStore.set(testSignal.id, record);
    
        ScannerPersistence.getActiveSignals = async () => [testSignal];
        marketDataManager.getCandles = async () => [];
        marketDataManager.getPrice = async (sym) => ({
          symbol: sym,
          rawSymbol: sym,
          price: 101, // drops back but TP1 hit is persistent
          bid: 100.9,
          ask: 101.1,
          timestamp: Date.now(),
          receivedAt: Date.now(),
          provider: 'bitget',
          assetType: 'CRYPTO',
          source: 'LIVE',
          isFresh: true,
          status: 'OK',
        });
    
        let statusUpdated = false;
        ScannerPersistence.updateSignalStatus = async (id, status, metadata) => {
          statusUpdated = true;
        };
    
        await SignalLifecycleManager.evaluateActiveSignals();
        // Verify that the status did NOT get demoted, and no update was triggered since state remains same
        assert.strictEqual(testSignal.status, 'TP1_HIT', 'State must persist after restart');
        assert.strictEqual(testSignal.tp1Status, 'HIT', 'Milestones must persist after restart');
        assert.strictEqual(statusUpdated, false, 'No database writes if state is already correctly evaluated');
        console.log('[PASS] Case 10 service restart persistence verified.');
      }
    
      // -------------------------------------------------------------------------
      // CASE 11: Historical backfill. → Entry must be established BEFORE TP/SL evaluation.
      // -------------------------------------------------------------------------
      console.log('\n--- CASE 11: Historical backfill, Entry before TP/SL ---');
      {
        resetLifecycleManager();
        const testSignal: PersistedSentSignal = {
          id: 'sig_case11',
          snapshotId: 'snap_case11',
          symbol: 'BTCUSDT',
          direction: 'BUY',
          entryPrice: 100,
          stopLoss: 95,
          takeProfit: 110,
          tp1: 102,
          tp2: 105,
          tp3: 110,
          riskRewardRatio: 2.0,
          score: 85,
          rankTier: 'BEST_TRADE',
          strategy: 'Trend Continuation',
          timeframe: '1h',
          dataSource: 'bitget',
          status: 'WAITING_ENTRY',
          timestamp: Date.now() - 100000,
          date: new Date().toISOString().split('T')[0],
          notificationSent: false,
          notificationTimestamp: 0,
          historicalEntryPolicy: 'CANDLE_TOUCH',
        };
    
        ScannerPersistence.getActiveSignals = async () => [testSignal];
        marketDataManager.getCandles = async () => [
          {
            symbol: 'BTCUSDT',
            provider: 'bitget',
            timeframe: '1m',
            open: 104,
            high: 105, // above TP1 (102), but low = 101. Low is above entry (100) so entry not yet confirmed!
            low: 101,
            close: 103,
            volume: 10,
            timestamp: Date.now() - 80000,
          },
          {
            symbol: 'BTCUSDT',
            provider: 'bitget',
            timeframe: '1m',
            open: 103,
            high: 103,
            low: 99, // crosses below entry (100). Entry is confirmed here!
            close: 101,
            volume: 12,
            timestamp: Date.now() - 70000,
          },
          {
            symbol: 'BTCUSDT',
            provider: 'bitget',
            timeframe: '1m',
            open: 101,
            high: 104, // high is 104, touches TP1 (102) AFTER entry is confirmed!
            low: 101,
            close: 103,
            volume: 15,
            timestamp: Date.now() - 60000,
          }
        ];
    
        marketDataManager.getPrice = async (sym) => ({
          symbol: sym,
          rawSymbol: sym,
          price: 103,
          bid: 102.9,
          ask: 103.1,
          timestamp: Date.now(),
          receivedAt: Date.now(),
          provider: 'bitget',
          assetType: 'CRYPTO',
          source: 'LIVE',
          isFresh: true,
          status: 'OK',
        });
    
        const transitionsTrace: string[] = [];
        ScannerPersistence.updateSignalStatus = async (id, status, metadata) => {
          transitionsTrace.push(status);
          testSignal.status = status;
          if (metadata) Object.assign(testSignal, metadata);
        };
    
        await SignalLifecycleManager.evaluateActiveSignals();
        // Order of transitions MUST be: WAITING_ENTRY -> ACTIVE -> TP1_HIT
        assert.strictEqual(transitionsTrace[0], 'ACTIVE', 'First transition must be ACTIVE');
        assert.strictEqual(transitionsTrace[1], 'TP1_HIT', 'Second transition must be TP1_HIT');
        assert.strictEqual(testSignal.status, 'TP1_HIT', 'Final state must be TP1_HIT');
        console.log('[PASS] Case 11 historical backfill chronological order verified.');
      }
    
      // -------------------------------------------------------------------------
      // CASE 12: INJUSDT regression. → Outcome determined from actual execution evidence, not merely chart touch.
      // -------------------------------------------------------------------------
      console.log('\n--- CASE 12: INJUSDT regression → execution price confirmation ---');
      {
        resetLifecycleManager();
        const testSignal: PersistedSentSignal = {
          id: 'sig_case12',
          snapshotId: 'snap_case12',
          symbol: 'INJUSDT',
          direction: 'BUY',
          entryPrice: 10.0,
          stopLoss: 9.5,
          takeProfit: 11.0,
          tp1: 10.2,
          tp2: 10.5,
          tp3: 11.0,
          riskRewardRatio: 2.0,
          score: 85,
          rankTier: 'BEST_TRADE',
          strategy: 'Trend Continuation',
          timeframe: '1h',
          dataSource: 'bitget',
          status: 'WAITING_ENTRY',
          timestamp: Date.now() - 10000,
          date: new Date().toISOString().split('T')[0],
          notificationSent: false,
          notificationTimestamp: 0,
        };
    
        ScannerPersistence.getActiveSignals = async () => [testSignal];
        marketDataManager.getCandles = async () => [];
        marketDataManager.getPrice = async (sym) => ({
          symbol: sym,
          rawSymbol: sym,
          price: 10.0, // Touches entry (10.0) on chart (display price)
          bid: 9.9,
          ask: 10.1, // Ask is 10.1 (higher than entry 10.0). No confirmation!
          timestamp: Date.now(),
          receivedAt: Date.now(),
          provider: 'bitget',
          assetType: 'CRYPTO',
          source: 'LIVE',
          isFresh: true,
          status: 'OK',
        });
    
        ScannerPersistence.updateSignalStatus = async (id, status, metadata) => {
          testSignal.status = status;
          if (metadata) Object.assign(testSignal, metadata);
        };
    
        await SignalLifecycleManager.evaluateActiveSignals();
        assert.strictEqual(testSignal.status, 'WAITING_ENTRY', 'Should stay in WAITING_ENTRY because ask price 10.1 is above entry 10.0');
        console.log('[PASS] Case 12 INJUSDT regression touch vs executable confirmed.');
      }
    
      // Restore mocks
      ScannerPersistence.getActiveSignals = originalGetActiveSignals;
      marketDataManager.getPrice = originalGetPrice;
      marketDataManager.getCandles = originalGetCandles;
      ScannerPersistence.updateSignalStatus = originalUpdateSignalStatus;
      SignalOutcomeLogger.getOutcome = originalGetOutcome;
      SignalOutcomeLogger.recordOutcome = originalRecordOutcome;
    
      console.log('\n========================================================================');
      console.log('GATE 38 COMPLETE: ALL 12 LIFE CYCLE TEST CASES PASSED!');
      console.log('========================================================================');
    }
    
    runTests().catch((err) => {
      console.error('[FAIL] Test execution failed with error:', err);
      process.exit(1);
    });
    
  });
});
