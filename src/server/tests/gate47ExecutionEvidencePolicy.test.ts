import assert from 'assert';
import { Gate29ExecutableEntryValidation } from '../signals/Gate29ExecutableEntryValidation.js';
import { SignalLifecycleManager } from '../signals/SignalLifecycleManager.js';
import { ScannerPersistence } from '../signals/ScannerPersistence.js';
import { marketDataManager } from '../market/MarketDataManager.js';
import { SignalOutcomeLogger } from '../signals/SignalOutcomeLogger.js';
import { PersistedSentSignal } from '../signals/ScannerPersistence.js';

import { describe, it } from "vitest";
describe("gate47ExecutionEvidencePolicy.test.ts", () => {
  it("runs the test suite", async () => {
    
    console.log('=== GATE 47 HISTORICAL EXECUTION EVIDENCE POLICY TESTS ===\n');
    
    // Reset helper
    function resetLifecycleManager() {
      // No-op or clear state if needed
    }
    
    async function runGate47Tests() {
      const originalGetActiveSignals = ScannerPersistence.getActiveSignals;
      const originalGetPrice = marketDataManager.getPrice;
      const originalGetCandles = marketDataManager.getCandles;
      const originalUpdateSignalStatus = ScannerPersistence.updateSignalStatus;
      const originalGetOutcome = SignalOutcomeLogger.getOutcome;
      const originalRecordOutcome = SignalOutcomeLogger.recordOutcome;
    
      try {
        // -------------------------------------------------------------------------
        // TEST 1: Live Quote Execution Evidence (BUY with ASK, SELL with BID)
        // -------------------------------------------------------------------------
        console.log('--- TEST 1: Live quote execution evidence validation ---');
        {
          // BUY: Ask <= Entry confirms executable
          const buyConfirmed = Gate29ExecutableEntryValidation.validateEntry('BUY', 10.0, {
            price: 10.0,
            bid: 9.9,
            ask: 9.98,
            source: 'LIVE',
          });
          assert.strictEqual(buyConfirmed.isEntryConfirmed, true);
          assert.strictEqual(buyConfirmed.executionEvidence, 'CONFIRMED_EXECUTABLE');
          assert.strictEqual(buyConfirmed.executionSide, 'ASK');
    
          // BUY: Ask > Entry rejects executable even if display price touches entry
          const buyRejected = Gate29ExecutableEntryValidation.validateEntry('BUY', 10.0, {
            price: 10.0,
            bid: 9.9,
            ask: 10.10, // Higher than entry 10.0
            source: 'LIVE',
          });
          assert.strictEqual(buyRejected.isEntryConfirmed, false);
          assert.strictEqual(buyRejected.executionEvidence, 'NOT_REACHED');
    
          // SELL: Bid >= Entry confirms executable
          const sellConfirmed = Gate29ExecutableEntryValidation.validateEntry('SELL', 10.0, {
            price: 10.0,
            bid: 10.05,
            ask: 10.15,
            source: 'LIVE',
          });
          assert.strictEqual(sellConfirmed.isEntryConfirmed, true);
          assert.strictEqual(sellConfirmed.executionEvidence, 'CONFIRMED_EXECUTABLE');
          assert.strictEqual(sellConfirmed.executionSide, 'BID');
    
          console.log('[PASS] Test 1: Live quote ask/bid execution evidence verified.');
        }
    
        // -------------------------------------------------------------------------
        // TEST 2: Historical Candle Touch under CONSERVATIVE Policy (Default)
        // -------------------------------------------------------------------------
        console.log('\n--- TEST 2: Historical candle touch under CONSERVATIVE policy ---');
        {
          const res = Gate29ExecutableEntryValidation.validateEntry(
            'BUY',
            10.0,
            {
              price: 9.95,
              low: 9.90,
              high: 10.20,
              isHistoricalCandle: true,
              source: 'HISTORICAL',
            },
            Date.now(),
            'CONSERVATIVE'
          );
    
          assert.strictEqual(res.isEntryConfirmed, false, 'CONSERVATIVE policy must NOT convert candle touch to executable entry');
          assert.strictEqual(res.executionEvidence, 'HISTORICAL_CANDLE_TOUCH');
          assert.strictEqual(res.policyUsed, 'CONSERVATIVE');
          console.log('[PASS] Test 2: Historical candle touch under CONSERVATIVE policy correctly marked HISTORICAL_CANDLE_TOUCH and unconfirmed.');
        }
    
        // -------------------------------------------------------------------------
        // TEST 3: Historical Candle Touch under CANDLE_TOUCH Policy
        // -------------------------------------------------------------------------
        console.log('\n--- TEST 3: Historical candle touch under CANDLE_TOUCH policy ---');
        {
          const res = Gate29ExecutableEntryValidation.validateEntry(
            'BUY',
            10.0,
            {
              price: 9.95,
              low: 9.90,
              high: 10.20,
              isHistoricalCandle: true,
              source: 'HISTORICAL',
            },
            Date.now(),
            'CANDLE_TOUCH'
          );
    
          assert.strictEqual(res.isEntryConfirmed, true, 'CANDLE_TOUCH policy allows entry confirmation');
          assert.strictEqual(res.executionEvidence, 'HISTORICAL_CANDLE_TOUCH');
          assert.strictEqual(res.policyUsed, 'CANDLE_TOUCH');
          console.log('[PASS] Test 3: Historical candle touch under CANDLE_TOUCH policy correctly confirmed.');
        }
    
        // -------------------------------------------------------------------------
        // TEST 4: Historical Candle Touch under UNVERIFIABLE Policy
        // -------------------------------------------------------------------------
        console.log('\n--- TEST 4: Historical candle touch under UNVERIFIABLE policy ---');
        {
          const res = Gate29ExecutableEntryValidation.validateEntry(
            'BUY',
            10.0,
            {
              price: 9.95,
              low: 9.90,
              high: 10.20,
              isHistoricalCandle: true,
              source: 'HISTORICAL',
            },
            Date.now(),
            'UNVERIFIABLE'
          );
    
          assert.strictEqual(res.isEntryConfirmed, false, 'UNVERIFIABLE policy must reject historical candle touch');
          assert.strictEqual(res.executionEvidence, 'UNVERIFIABLE');
          assert.strictEqual(res.policyUsed, 'UNVERIFIABLE');
          console.log('[PASS] Test 4: Historical candle touch under UNVERIFIABLE policy correctly rejected.');
        }
    
        // -------------------------------------------------------------------------
        // TEST 5: INJUSDT Regression Test - Live Chart Touch vs Execution Confirmation
        // -------------------------------------------------------------------------
        console.log('\n--- TEST 5: INJUSDT regression test in SignalLifecycleManager ---');
        {
          resetLifecycleManager();
          const injSignal: PersistedSentSignal = {
            id: 'sig_inj_gate47',
            snapshotId: 'snap_inj_gate47',
            symbol: 'INJUSDT',
            direction: 'BUY',
            entryPrice: 10.0,
            stopLoss: 9.5,
            takeProfit: 11.0,
            tp1: 10.2,
            tp2: 10.5,
            tp3: 11.0,
            riskRewardRatio: 2.0,
            score: 88,
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
    
          ScannerPersistence.getActiveSignals = async () => [injSignal];
          marketDataManager.getCandles = async () => [];
          
          // Live quote: display price 10.0 touches entry, but ask is 10.10
          marketDataManager.getPrice = async (sym) => ({
            symbol: sym,
            rawSymbol: sym,
            price: 10.0,
            bid: 9.90,
            ask: 10.10, // Higher than 10.0 entry
            timestamp: Date.now(),
            receivedAt: Date.now(),
            provider: 'bitget',
            assetType: 'CRYPTO',
            source: 'LIVE',
            isFresh: true,
            status: 'OK',
          });
    
          ScannerPersistence.updateSignalStatus = async (id, status, metadata) => {
            injSignal.status = status;
            if (metadata) Object.assign(injSignal, metadata);
          };
    
          await SignalLifecycleManager.evaluateActiveSignals();
    
          assert.strictEqual(injSignal.status, 'WAITING_ENTRY', 'INJUSDT must remain in WAITING_ENTRY when ask price (10.10) exceeds entry (10.0)');
          assert.strictEqual(injSignal.executionEvidence, 'NOT_REACHED');
          console.log('[PASS] Test 5: INJUSDT regression test passed (ask price 10.10 stayed in WAITING_ENTRY).');
        }
    
        console.log('\n=== ALL GATE 47 TESTS PASSED SUCCESSFULLY ===');
      } finally {
        ScannerPersistence.getActiveSignals = originalGetActiveSignals;
        marketDataManager.getPrice = originalGetPrice;
        marketDataManager.getCandles = originalGetCandles;
        ScannerPersistence.updateSignalStatus = originalUpdateSignalStatus;
        SignalOutcomeLogger.getOutcome = originalGetOutcome;
        SignalOutcomeLogger.recordOutcome = originalRecordOutcome;
      }
    }
    
    runGate47Tests().catch((err) => {
      console.error('Gate 47 Test Failed:', err);
      process.exit(1);
    });
    
  });
});
