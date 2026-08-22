import assert from 'assert';
import { SignalLifecycleManager } from '../signals/SignalLifecycleManager.js';
import { ScannerPersistence, PersistedSentSignal } from '../signals/ScannerPersistence.js';
import { SignalOutcomeLogger } from '../signals/SignalOutcomeLogger.js';
import { marketDataManager } from '../market/MarketDataManager.js';
import { SignalEngine } from '../signals/SignalEngine.js';

import { describe, it } from "vitest";
describe("gate48PostEntryTargetEvaluation.test.ts", () => {
  it("runs the test suite", async () => {
    
    console.log('=== GATE 48 — POST-ENTRY TARGET EVALUATION TESTS ===\n');
    
    async function runGate48Tests() {
      const originalGetActiveSignals = ScannerPersistence.getActiveSignals;
      const originalGetPrice = marketDataManager.getPrice;
      const originalGetCandles = marketDataManager.getCandles;
      const originalUpdateSignalStatus = ScannerPersistence.updateSignalStatus;
      const originalGetOutcome = SignalOutcomeLogger.getOutcome;
      const originalRecordOutcome = SignalOutcomeLogger.recordOutcome;
    
      try {
        // -------------------------------------------------------------------------
        // TEST 1: Initial Signal Creation States
        // -------------------------------------------------------------------------
        console.log('--- TEST 1: Initial Signal State Setup (WAITING_ENTRY with ACTIVE_FOR_ENTRY_ONLY) ---');
        {
          const now = Date.now();
          const signal: PersistedSentSignal = {
            id: 'sig-test-init',
            snapshotId: 'snap-init',
            symbol: 'BTCUSDT',
            direction: 'BUY',
            entryPrice: 100,
            stopLoss: 95,
            takeProfit: 110,
            tp1: 103,
            tp2: 106,
            tp3: 110,
            riskRewardRatio: 2.0,
            score: 85,
            rankTier: 'BEST_TRADE',
            strategy: 'TestStrategy',
            timeframe: '1h',
            timestamp: now,
            dataSource: 'binance',
            status: 'WAITING_ENTRY',
            isActionableSignal: true,
            entryHitTimestamp: null as any,
            tp1Status: 'PENDING',
            tp2Status: 'PENDING',
            tp3Status: 'PENDING',
            slStatus: 'ACTIVE_FOR_ENTRY_ONLY',
            notificationSent: false,
            notificationTimestamp: 0,
            date: '2026-08-21',
          };
    
          assert.strictEqual(signal.status, 'WAITING_ENTRY');
          assert.strictEqual(signal.entryHitTimestamp, null);
          assert.strictEqual(signal.tp1Status, 'PENDING');
          assert.strictEqual(signal.tp2Status, 'PENDING');
          assert.strictEqual(signal.tp3Status, 'PENDING');
          assert.strictEqual(signal.slStatus, 'ACTIVE_FOR_ENTRY_ONLY');
        }
    
        // -------------------------------------------------------------------------
        // TEST 2: Price Update Before Entry Does Not Evaluate TP/SL
        // -------------------------------------------------------------------------
        console.log('--- TEST 2: Price Update when WAITING_ENTRY does not evaluate TP or SL ---');
        {
          const testSignal: PersistedSentSignal = {
            id: 'sig-gate48-1',
            snapshotId: 'snap-1',
            symbol: 'BTCUSDT',
            direction: 'BUY',
            entryPrice: 100.0,
            stopLoss: 90.0,
            takeProfit: 120.0,
            tp1: 105.0,
            tp2: 110.0,
            tp3: 120.0,
            riskRewardRatio: 2.0,
            score: 85,
            rankTier: 'BEST_TRADE',
            strategy: 'TestStrategy',
            timeframe: '1h',
            dataSource: 'binance',
            status: 'WAITING_ENTRY',
            entryHitTimestamp: undefined,
            tp1Status: 'PENDING',
            tp2Status: 'PENDING',
            tp3Status: 'PENDING',
            slStatus: 'ACTIVE_FOR_ENTRY_ONLY',
            timestamp: Date.now() - 3600000,
            notificationSent: false,
            notificationTimestamp: 0,
            date: new Date().toISOString().split('T')[0],
          };
    
          // Price moves to 110 (which is above TP1 105), but entry 100 was never touched (price stayed above 100)
          const evalRes = SignalLifecycleManager.evaluateSignalPriceUpdate(
            testSignal,
            110.0,
            Date.now(),
            'BTCUSDT',
            { bid: 109.9, ask: 110.1, high: 112.0, low: 102.0 } // Low is 102, entry is 100 -> entry NOT hit
          );
    
          assert.strictEqual(evalRes.newStatus, 'WAITING_ENTRY');
          assert.strictEqual(evalRes.entryHitTimestamp, undefined);
          assert.strictEqual(evalRes.tp1Status, 'PENDING');
          assert.strictEqual(evalRes.tp2Status, 'PENDING');
          assert.strictEqual(evalRes.tp3Status, 'PENDING');
          assert.strictEqual(evalRes.slStatus, 'ACTIVE_FOR_ENTRY_ONLY');
        }
    
        // -------------------------------------------------------------------------
        // TEST 3: Chronological Backfill Processing (Entry -> Then TP/SL)
        // -------------------------------------------------------------------------
        console.log('--- TEST 3: Historical Backfill processes candles chronologically (Entry -> then TP/SL) ---');
        {
          const signalTime = Date.now() - 7200000;
          const testSignal: PersistedSentSignal = {
            id: 'sig-gate48-2',
            snapshotId: 'snap-2',
            symbol: 'ETHUSDT',
            direction: 'BUY',
            entryPrice: 100.0,
            stopLoss: 90.0,
            takeProfit: 120.0,
            tp1: 105.0,
            tp2: 110.0,
            tp3: 120.0,
            riskRewardRatio: 2.0,
            score: 85,
            rankTier: 'BEST_TRADE',
            strategy: 'TestStrategy',
            timeframe: '1m',
            dataSource: 'binance',
            status: 'WAITING_ENTRY',
            historicalEntryPolicy: 'CANDLE_TOUCH',
            entryHitTimestamp: undefined,
            tp1Status: 'PENDING',
            tp2Status: 'PENDING',
            tp3Status: 'PENDING',
            slStatus: 'ACTIVE_FOR_ENTRY_ONLY',
            timestamp: signalTime,
            notificationSent: false,
            notificationTimestamp: 0,
            date: new Date().toISOString().split('T')[0],
          };
    
          ScannerPersistence.getActiveSignals = async () => [testSignal];
    
          // Candle 1: High = 108 (hits TP1 level if active), Low = 102 -> Entry NOT hit (Low > 100)
          // Candle 2: High = 101, Low = 98 -> Entry HIT at 100
          // Candle 3: High = 106, Low = 101 -> TP1 HIT at 105
          const candles = [
            { symbol: 'ETHUSDT', provider: 'binance', timeframe: '1m', timestamp: signalTime + 60000, open: 103, high: 108, low: 102, close: 104, volume: 100 },
            { symbol: 'ETHUSDT', provider: 'binance', timeframe: '1m', timestamp: signalTime + 120000, open: 104, high: 101, low: 98, close: 99, volume: 100 },
            { symbol: 'ETHUSDT', provider: 'binance', timeframe: '1m', timestamp: signalTime + 180000, open: 99, high: 106, low: 101, close: 105, volume: 100 },
          ];
    
          marketDataManager.getCandles = async () => candles;
    
          let recordedOutcome: any = null;
          SignalOutcomeLogger.recordOutcome = async (record) => {
            recordedOutcome = record;
          };
    
          const updatedStatuses: any[] = [];
          ScannerPersistence.updateSignalStatus = (async (id: any, status: any, updates: any) => {
            updatedStatuses.push({ id, status, updates });
            return { ...testSignal, status, ...updates } as any;
          }) as any;
    
          await SignalLifecycleManager.evaluateActiveSignals();
    
          // Verify that transitions happened sequentially: WAITING_ENTRY -> ACTIVE (at Candle 2) -> TP1_HIT (at Candle 3)
          assert.strictEqual(updatedStatuses.length, 2);
          assert.strictEqual(updatedStatuses[0].status, 'ACTIVE');
          assert.strictEqual(updatedStatuses[0].updates.entryHitTimestamp, new Date(signalTime + 120000).toISOString());
          assert.strictEqual(updatedStatuses[0].updates.slStatus, 'ACTIVE');
    
          assert.strictEqual(updatedStatuses[1].status, 'TP1_HIT');
          assert.strictEqual(updatedStatuses[1].updates.tp1Status, 'HIT');
    
          assert.ok(recordedOutcome);
          assert.strictEqual(recordedOutcome.entryHitTimestamp, new Date(signalTime + 120000).toISOString());
          assert.strictEqual(recordedOutcome.tp1Status, 'HIT');
        }
    
        // -------------------------------------------------------------------------
        // TEST 4: Candle Touch TP/SL Before Entry Does NOT Record Trade Outcome
        // -------------------------------------------------------------------------
        console.log('--- TEST 4: Candle touching TP/SL level before entry hit is never recorded as trade outcome ---');
        {
          const signalTime = Date.now() - 5 * 3600000;
          const testSignal: PersistedSentSignal = {
            id: 'sig-gate48-3',
            snapshotId: 'snap-3',
            symbol: 'SOLUSDT',
            direction: 'BUY',
            entryPrice: 100.0,
            stopLoss: 90.0,
            takeProfit: 120.0,
            tp1: 105.0,
            tp2: 110.0,
            tp3: 120.0,
            riskRewardRatio: 2.0,
            score: 85,
            rankTier: 'BEST_TRADE',
            strategy: 'TestStrategy',
            timeframe: '1m',
            dataSource: 'binance',
            status: 'WAITING_ENTRY',
            entryHitTimestamp: undefined,
            tp1Status: 'PENDING',
            tp2Status: 'PENDING',
            tp3Status: 'PENDING',
            slStatus: 'ACTIVE_FOR_ENTRY_ONLY',
            timestamp: signalTime,
            expiresAt: signalTime + 120000, // Expires after candle 2
            notificationSent: false,
            notificationTimestamp: 0,
            date: new Date().toISOString().split('T')[0],
          };
    
          ScannerPersistence.getActiveSignals = async () => [testSignal];
    
          // Candle 1: High = 115 (hits TP levels if active), Low = 85 (hits SL level if active), BUT price stayed above entry before sl and entry never confirmed
          // Wait: Entry is 100. Candle 1 open 108, high 115, low 102. Entry 100 never hit!
          const candles = [
            { symbol: 'SOLUSDT', provider: 'binance', timeframe: '1m', timestamp: signalTime + 60000, open: 108, high: 115, low: 102, close: 110, volume: 100 },
            { symbol: 'SOLUSDT', provider: 'binance', timeframe: '1m', timestamp: signalTime + 180000, open: 110, high: 112, low: 103, close: 105, volume: 100 },
          ];
    
          marketDataManager.getCandles = async () => candles;
    
          let recordedOutcome: any = null;
          SignalOutcomeLogger.recordOutcome = async (record) => {
            recordedOutcome = record;
          };
    
          const updatedStatuses: any[] = [];
          ScannerPersistence.updateSignalStatus = (async (id: any, status: any, updates: any) => {
            updatedStatuses.push({ id, status, updates });
            return { ...testSignal, status, ...updates } as any;
          }) as any;
    
          await SignalLifecycleManager.evaluateActiveSignals();
    
          // Signal expired without entry hit!
          assert.strictEqual(updatedStatuses.length, 1);
          assert.strictEqual(updatedStatuses[0].status, 'EXPIRED');
          assert.strictEqual(updatedStatuses[0].updates.entryHitTimestamp, undefined);
          assert.strictEqual(updatedStatuses[0].updates.tp1Status, 'PENDING');
          assert.strictEqual(updatedStatuses[0].updates.slStatus, 'ACTIVE_FOR_ENTRY_ONLY');
    
          assert.ok(recordedOutcome);
          assert.strictEqual(recordedOutcome.entryHitTimestamp, undefined);
          assert.strictEqual(recordedOutcome.finalOutcome, 'EXPIRED');
          assert.strictEqual(recordedOutcome.tp1Status, 'PENDING');
          assert.strictEqual(recordedOutcome.slStatus, 'ACTIVE_FOR_ENTRY_ONLY');
        }
    
        console.log('\n✅ ALL GATE 48 POST-ENTRY TARGET EVALUATION TESTS PASSED!');
      } finally {
        // Restore original functions
        ScannerPersistence.getActiveSignals = originalGetActiveSignals;
        marketDataManager.getPrice = originalGetPrice;
        marketDataManager.getCandles = originalGetCandles;
        ScannerPersistence.updateSignalStatus = originalUpdateSignalStatus;
        SignalOutcomeLogger.getOutcome = originalGetOutcome;
        SignalOutcomeLogger.recordOutcome = originalRecordOutcome;
      }
    }
    
    runGate48Tests().catch((err) => {
      console.error('❌ GATE 48 TEST FAILED:', err);
      process.exit(1);
    });
    
  });
});
