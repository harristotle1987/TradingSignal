import assert from 'assert';
import { Gate34ExecutionFrictionStressTest } from '../signals/Gate34ExecutionFrictionStressTest.js';
import { HardGatesEvaluator } from '../signals/Gate26OpportunityFunnel.js';
import { serverConfig } from '../config.js';

import { describe, it } from "vitest";
describe("gate45RRPolicy.test.ts", () => {
  it("runs the test suite", async () => {
    /**
     * Gate 45: R:R Policy Normalization Verification Tests
     *
     * DEFINITIONS:
     * - GROSS_RR = Raw Reward / Raw Risk (pre-friction ratio)
     * - NET_RR = Normal Net R:R after baseline friction (spread, slippage, fees, latency)
     * - ADVERSE_NET_RR = Stressed Net R:R under adverse conditions (wide spread, slippage spike)
     *
     * POLICY RULES:
     * 1. Calculate gross R:R.
     * 2. Reject if gross R:R < minimumRR (1.8).
     * 3. Calculate normal net R:R.
     * 4. Reject if normal net R:R < minimumNetRR (1.5).
     * 5. Calculate adverse/stress net R:R.
     * 6. Use adverse R:R as risk-quality modifier unless explicitly configured as hard gate.
     * 7. Do NOT compare NET R:R against minimumRR.
     * 8. Do NOT compare GROSS R:R against minimumNetRR.
     * 9. Every rejection log must identify whether it was GROSS_RR, NET_RR, or ADVERSE_NET_RR.
     */
    
    
    console.log('--- GATE 45: R:R POLICY NORMALIZATION VERIFICATION ---');
    
    // Test 1: Defaults verification
    {
      const thresholds = serverConfig.getThresholds();
      console.log(`[Test 1] Checking threshold defaults: minimumRR=${thresholds.minimumRR}, minimumNetRR=${thresholds.minimumNetRR}, minimumAdverseNetRR=${thresholds.minimumAdverseNetRR}`);
      assert.ok(typeof thresholds.minimumRR === 'number' && thresholds.minimumRR >= 1.8, 'minimumRR must be >= 1.8');
      assert.ok(typeof thresholds.minimumNetRR === 'number' && thresholds.minimumNetRR >= 1.5, 'minimumNetRR must be >= 1.5');
      assert.ok(typeof thresholds.minimumAdverseNetRR === 'number', 'minimumAdverseNetRR must be a number');
      console.log('✓ Test 1 Passed: Centralized threshold configuration verified.');
    }
    
    // Test 2: GROSS_RR evaluation & rejection
    {
      console.log('[Test 2] Testing GROSS_RR rejection when Gross R:R < minimumRR (1.8)...');
      // EURUSD: Entry 1.0850, SL 1.0840 (10 pips risk), TP 1.0865 (15 pips reward) -> Gross RR = 1.5:1 < 1.8
      const evalResult = Gate34ExecutionFrictionStressTest.evaluate('EURUSD', 1.08500, 1.08400, 1.08650, {
        minimumRR: 1.80,
        minimumNetRR: 1.50,
      });
    
      assert.strictEqual(evalResult.isPassed, false, 'Signal must be rejected when Gross R:R < minimumRR');
      assert.strictEqual(evalResult.rejectionReason, 'GROSS_RR_BELOW_THRESHOLD', 'Rejection reason must be GROSS_RR_BELOW_THRESHOLD');
      assert.strictEqual(evalResult.grossRR, 1.5, 'Gross RR should be 1.5:1');
      assert.ok(evalResult.reasons[0].includes('GROSS_RR_BELOW_THRESHOLD'), 'Rejection log must identify GROSS_RR failure');
      console.log('✓ Test 2 Passed: Gross R:R below minimumRR rejected with GROSS_RR_BELOW_THRESHOLD.');
    }
    
    // Test 3: NET_RR evaluation & rejection (Gross R:R >= 1.8, but Net R:R < 1.5)
    {
      console.log('[Test 3] Testing NET_RR rejection when Gross R:R >= 1.8, but Normal Net R:R < minimumNetRR (1.5)...');
      // EURUSD: Entry 1.08500, SL 1.08460 (4 pips risk), TP 1.08580 (8 pips reward) -> Gross RR = 2.0:1 (>= 1.8)
      // But friction (~2.4 pips total) reduces Net Reward to 5.6 pips and increases Net Risk to 6.4 pips -> Net RR < 1.0:1 (< 1.5)
      const evalResult = Gate34ExecutionFrictionStressTest.evaluate('EURUSD', 1.08500, 1.08460, 1.08580, {
        minimumRR: 1.80,
        minimumNetRR: 1.50,
        minSafetyBufferMultiplier: 1.0, // Lower safety buffer to isolate Net RR test
        maxFrictionRatio: 0.50,
      });
    
      assert.strictEqual(evalResult.grossRR >= 1.80, true, 'Gross R:R must be >= 1.80');
      assert.strictEqual(evalResult.isPassed, false, 'Signal must be rejected when Net R:R < minimumNetRR');
      assert.strictEqual(evalResult.rejectionReason, 'NET_RR_BELOW_THRESHOLD', 'Rejection reason must be NET_RR_BELOW_THRESHOLD');
      assert.ok(evalResult.reasons.some(r => r.includes('NET_RR_BELOW_THRESHOLD')), 'Rejection log must identify NET_RR failure');
      console.log('✓ Test 3 Passed: Net R:R below minimumNetRR rejected with NET_RR_BELOW_THRESHOLD.');
    }
    
    // Test 4: ADVERSE_NET_RR as risk-quality modifier by default (does not fail when Net R:R passes)
    {
      console.log('[Test 4] Testing ADVERSE_NET_RR behavior as risk modifier vs hard gate...');
      // Standard healthy trade: Gross RR = 2.5:1, Normal Net RR = 2.1:1, Adverse Net RR = 1.6:1
      const healthy = Gate34ExecutionFrictionStressTest.evaluate('EURUSD', 1.08500, 1.08200, 1.09250);
      assert.strictEqual(healthy.isPassed, true, 'Healthy trade should pass');
      assert.strictEqual(healthy.grossRR, 2.5);
      assert.ok(healthy.netRR >= 1.5, 'Normal Net RR should be >= 1.5');
      assert.ok(healthy.adverseRiskModifier >= 0, 'Adverse risk modifier should be positive for resilient trade');
    
      // Trade with hard gate explicitly enabled for adverse stress
      const hardGateStress = Gate34ExecutionFrictionStressTest.evaluate('EURUSD', 1.08500, 1.08470, 1.08560, {
        minimumRR: 1.80,
        minimumNetRR: 0.50,
        minimumAdverseNetRR: 2.00, // Impossibly high adverse hurdle
        enforceAdverseNetRRHardGate: true,
        minSafetyBufferMultiplier: 1.0,
        maxFrictionRatio: 0.50,
      });
      assert.strictEqual(hardGateStress.isPassed, false);
      assert.strictEqual(hardGateStress.rejectionReason, 'ADVERSE_NET_RR_BELOW_THRESHOLD');
      assert.ok(hardGateStress.reasons.some(r => r.includes('ADVERSE_NET_RR_BELOW_THRESHOLD')));
      console.log('✓ Test 4 Passed: Adverse Net RR properly acts as modifier by default and hard gate when configured.');
    }
    
    // Test 5: Opportunity Funnel Gate 26 Hard Gate Verification
    {
      console.log('[Test 5] Testing Opportunity Funnel Hard Gate 6 with normalized R:R...');
    
      // Mock live ticker
      const mockTicker = {
        symbol: 'EURUSD',
        rawSymbol: 'EUR/USD',
        provider: 'twelvedata' as const,
        assetType: 'FOREX' as const,
        price: 1.08500,
        bid: 1.08495,
        ask: 1.08505,
        timestamp: Date.now(),
        receivedAt: Date.now(),
        source: 'LIVE' as const,
        isFresh: true,
        status: 'OK' as const,
      };
    
      const createCandles = (count = 30) => {
        const list = [];
        const baseTime = Date.now() - count * 60000;
        for (let i = 0; i < count; i++) {
          list.push({
            timestamp: baseTime + i * 60000,
            open: 1.0845,
            high: 1.0855,
            low: 1.0840,
            close: 1.0850,
            volume: 1000 + i,
          });
        }
        return list;
      };
    
      const mockCandles = {
        '1h': createCandles(30),
        '15m': createCandles(30),
        '5m': createCandles(30),
      };
    
      // Gross RR = 1.4 < minimumRR -> GROSS_RR_BELOW_THRESHOLD
      const gate26GrossFail = HardGatesEvaluator.evaluate({
        symbol: 'EURUSD',
        direction: 'BUY',
        entryPrice: 1.08500,
        stopLoss: 1.08300,
        takeProfit: 1.08780,
        riskRewardRatio: 1.40,
        netRiskRewardRatio: 1.20,
        liveTicker: mockTicker,
        candlesMap: mockCandles,
        estimatedWinRate: 75,
        expectancy: 0.8,
      });
      assert.strictEqual(gate26GrossFail.passed, false);
      assert.strictEqual(gate26GrossFail.failedGate, 'GROSS_RR_BELOW_THRESHOLD');
      assert.ok(gate26GrossFail.rejectionReason.includes('GROSS_RR_BELOW_THRESHOLD'));
    
      // Gross RR = 2.2 (passes gross hurdle), but Net RR = 1.3 < 1.5 -> NET_RR_BELOW_THRESHOLD
      const gate26NetFail = HardGatesEvaluator.evaluate({
        symbol: 'EURUSD',
        direction: 'BUY',
        entryPrice: 1.08500,
        stopLoss: 1.08300,
        takeProfit: 1.08940,
        riskRewardRatio: 2.20,
        netRiskRewardRatio: 1.30,
        liveTicker: mockTicker,
        candlesMap: mockCandles,
        estimatedWinRate: 75,
        expectancy: 0.8,
      });
      assert.strictEqual(gate26NetFail.passed, false);
      assert.strictEqual(gate26NetFail.failedGate, 'NET_RR_BELOW_THRESHOLD');
      assert.ok(gate26NetFail.rejectionReason.includes('NET_RR_BELOW_THRESHOLD'));
    
      console.log('✓ Test 5 Passed: Gate 26 accurately discriminates GROSS_RR vs NET_RR.');
    }
    
    console.log('--- ALL GATE 45 R:R POLICY TESTS PASSED SUCCESSFULLY ---');
    
  });
});
