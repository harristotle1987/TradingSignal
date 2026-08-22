import assert from 'assert';
import { Gate17CorrelationExposure, CandidateCorrelationInput } from '../signals/Gate17CorrelationExposure.js';
import { TradeRankingEngine, ValidatedCandidate } from '../signals/TradeRankingEngine.js';
import { NormalizedCandle, TradingSignal } from '../../types/index.js';

import { describe, it } from "vitest";
describe("correlationExposure.test.ts", () => {
  it("runs the test suite", async () => {
    
    console.log('========================================================================');
    console.log('STARTING GATE 17: CORRELATION & EXPOSURE CONTROL TESTS');
    console.log('========================================================================');
    
    function createCandles(mode: 'CO_MOVING' | 'INVERSE' | 'RANDOM', count = 30): NormalizedCandle[] {
      const candles: NormalizedCandle[] = [];
      let price = 100;
      const now = Date.now();
    
      for (let i = 0; i < count; i++) {
        const timestamp = now - (count - i) * 60 * 60 * 1000;
        let step = 0;
        if (mode === 'CO_MOVING') {
          step = i % 2 === 0 ? 1.5 : -0.5;
        } else if (mode === 'INVERSE') {
          step = i % 2 === 0 ? -1.5 : 0.5;
        } else {
          step = (Math.sin(i) * 2);
        }
    
        price = Math.max(10, price + step);
        candles.push({
          symbol: 'TEST',
          provider: 'TEST',
          timeframe: '1h',
          timestamp,
          open: price,
          high: price + 0.5,
          low: price - 0.5,
          close: price,
          volume: 1000,
        });
      }
    
      return candles;
    }
    
    // --- TEST 1: Pearson Correlation & Classification ---
    console.log('\n--- TEST 1: Pearson Correlation & Classification ---');
    {
      const seriesA = createCandles('CO_MOVING', 30);
      const seriesB = createCandles('CO_MOVING', 30);
      const seriesC = createCandles('INVERSE', 30);
    
      const corrHigh = Gate17CorrelationExposure.calculatePearsonCorrelation(seriesA, seriesB);
      const corrLow = Gate17CorrelationExposure.calculatePearsonCorrelation(seriesA, seriesC);
    
      assert.ok(corrHigh > 0.85, `High correlation coefficient expected (>0.85), got: ${corrHigh}`);
      assert.ok(corrLow < 0.0, `Negative correlation coefficient expected (<0.0), got: ${corrLow}`);
    
      console.log(`[PASS] High correlation calculated accurately: r = ${corrHigh.toFixed(3)}`);
      console.log(`[PASS] Inverse correlation calculated accurately: r = ${corrLow.toFixed(3)}`);
    }
    
    // --- TEST 2: Canonical Exposure Clusters ---
    console.log('\n--- TEST 2: Canonical Exposure Clusters ---');
    {
      const btcCluster = Gate17CorrelationExposure.identifyCluster('BTCUSDT');
      const ethCluster = Gate17CorrelationExposure.identifyCluster('ETHUSDT');
      const solCluster = Gate17CorrelationExposure.identifyCluster('SOLUSDT');
      const qqqCluster = Gate17CorrelationExposure.identifyCluster('QQQ');
      const nvdaCluster = Gate17CorrelationExposure.identifyCluster('NVDA');
      const eurusdCluster = Gate17CorrelationExposure.identifyCluster('EURUSD');
      const goldCluster = Gate17CorrelationExposure.identifyCluster('XAUUSD');
    
      assert.strictEqual(btcCluster.id, 'CRYPTO_RISK_CLUSTER', 'BTC mapped to CRYPTO_RISK_CLUSTER');
      assert.strictEqual(ethCluster.id, 'CRYPTO_RISK_CLUSTER', 'ETH mapped to CRYPTO_RISK_CLUSTER');
      assert.strictEqual(solCluster.id, 'CRYPTO_RISK_CLUSTER', 'SOL mapped to CRYPTO_RISK_CLUSTER');
      assert.strictEqual(qqqCluster.id, 'EQUITY_RISK_CLUSTER', 'QQQ mapped to EQUITY_RISK_CLUSTER');
      assert.strictEqual(nvdaCluster.id, 'EQUITY_RISK_CLUSTER', 'NVDA mapped to EQUITY_RISK_CLUSTER');
      assert.strictEqual(eurusdCluster.id, 'FOREX_USD_CLUSTER', 'EURUSD mapped to FOREX_USD_CLUSTER');
      assert.strictEqual(goldCluster.id, 'COMMODITIES_METALS_CLUSTER', 'XAUUSD mapped to COMMODITIES_METALS_CLUSTER');
    
      console.log('[PASS] All asset classes accurately mapped to their risk exposure clusters.');
    }
    
    // --- TEST 3: Multi-Signal Exposure Ranking & Duplicate Penalty ---
    console.log('\n--- TEST 3: Multi-Signal Exposure Ranking & Duplicate Penalty ---');
    {
      const candidates: CandidateCorrelationInput[] = [
        { symbol: 'SOLUSDT', direction: 'BUY', score: 88, relativeStrengthScore: 92, candles: createCandles('CO_MOVING') },
        { symbol: 'ETHUSDT', direction: 'BUY', score: 84, relativeStrengthScore: 78, candles: createCandles('CO_MOVING') },
        { symbol: 'BTCUSDT', direction: 'BUY', score: 80, relativeStrengthScore: 65, candles: createCandles('CO_MOVING') },
      ];
    
      const results = Gate17CorrelationExposure.evaluateCandidates(candidates);
    
      const sol = results.get('SOLUSDT')!;
      const eth = results.get('ETHUSDT')!;
      const btc = results.get('BTCUSDT')!;
    
      assert.strictEqual(sol.clusterExposure, 3, 'Total cluster exposure is 3 signals');
      assert.strictEqual(sol.clusterRank, 1, 'SOL is cluster leader (Rank #1)');
      assert.strictEqual(sol.correlationPenalty, 0, 'Cluster leader receives 0 penalty');
      assert.strictEqual(sol.correlationLevel, 'HIGH_CORRELATION', 'High correlation classified');
    
      assert.strictEqual(eth.clusterRank, 2, 'ETH is cluster duplicate #2');
      assert.strictEqual(eth.correlationPenalty, 3, 'ETH receives -3pt duplicate penalty');
    
      assert.strictEqual(btc.clusterRank, 3, 'BTC is cluster duplicate #3');
      assert.strictEqual(btc.correlationPenalty, 6, 'BTC receives -6pt duplicate penalty');
    
      console.log(`[PASS] Correctly prioritized cluster leader SOL (#1, penalty 0) and penalized duplicates ETH (#2, -${eth.correlationPenalty}) and BTC (#3, -${btc.correlationPenalty})`);
    }
    
    // --- TEST 4: TradeRankingEngine Composite Score Integration ---
    console.log('\n--- TEST 4: TradeRankingEngine Composite Score Integration ---');
    {
      const baseSignal: TradingSignal = {
        id: 'sig_corr_1',
        snapshotId: 'snap_corr',
        symbol: 'SOLUSDT',
        direction: 'BUY',
        entryPrice: 150,
        timeframe: '1h',
        strategy: 'Trend Confluence',
        confluenceReasons: [],
        confidenceScore: 85,
        stopLoss: 140,
        takeProfit: 170,
        riskRewardRatio: 2.0,
        timestamp: Date.now(),
        validatedAt: Date.now(),
        dataSource: 'Bitget',
        status: 'ACTIVE',
        score: 85,
        marketRegime: 'STRONG_TREND',
        correlationScore: 88,
        correlationCluster: 'CRYPTO_RISK_CLUSTER',
        clusterExposure: 2,
        correlationPenalty: 0,
        correlationLevel: 'HIGH_CORRELATION',
      };
    
      const leaderCandidate: ValidatedCandidate = {
        signal: baseSignal,
        scoring: {
          isValid: true,
          score: 85,
          direction: 'BUY',
          timeframesAligned: 3,
          confluenceReasons: [],
          factors: { totalScore: 85 } as any,
        } as any,
        validation: { isValid: true } as any,
        aiConfidence: 85,
        timeframesAligned: 3,
      };
    
      const duplicateSignal = { ...baseSignal, symbol: 'ETHUSDT', correlationPenalty: 5 };
      const duplicateCandidate: ValidatedCandidate = {
        ...leaderCandidate,
        signal: duplicateSignal,
        scoring: { ...leaderCandidate.scoring, score: 85, factors: { totalScore: 85 } as any } as any,
      };
    
      const ranking = TradeRankingEngine.rankOpportunities([leaderCandidate, duplicateCandidate]);
      assert.strictEqual(ranking.allRanked.length, 2, 'Both signals ranked without blind hard prohibition');
      assert.strictEqual(ranking.bestTrade?.symbol, 'SOLUSDT', 'Leader without penalty is selected as best trade');
    
      console.log('[PASS] TradeRankingEngine integrates correlationPenalty into composite score without hard dropping valid analytical setups.');
    }
    
    // --- TEST 5: Interface Contract & Schema Verification ---
    console.log('\n--- TEST 5: Interface Contract & Schema Verification ---');
    {
      const input: CandidateCorrelationInput = {
        symbol: 'NVDA',
        direction: 'BUY',
        candles: createCandles('CO_MOVING'),
      };
    
      const res = Gate17CorrelationExposure.analyzeSingle(input);
    
      assert.ok(typeof res.correlationScore === 'number', 'Exposes res.correlationScore');
      assert.ok(typeof res.correlationCluster === 'string', 'Exposes res.correlationCluster');
      assert.ok(typeof res.clusterExposure === 'number', 'Exposes res.clusterExposure');
      assert.ok(typeof res.correlationPenalty === 'number', 'Exposes res.correlationPenalty');
      assert.ok(typeof res.correlationLevel === 'string', 'Exposes res.correlationLevel');
      assert.ok(typeof res.clusterRank === 'number', 'Exposes res.clusterRank');
      assert.ok(typeof res.rawCoefficient === 'number', 'Exposes res.rawCoefficient');
      assert.ok(Array.isArray(res.reasons), 'Exposes res.reasons');
      assert.ok(typeof res.summary === 'string', 'Exposes res.summary');
    
      console.log('[PASS] Exposes result.correlationScore');
      console.log('[PASS] Exposes result.correlationCluster');
      console.log('[PASS] Exposes result.clusterExposure');
      console.log('[PASS] Exposes result.correlationPenalty');
      console.log('[PASS] Exposes result.correlationLevel');
      console.log('[PASS] Exposes result.clusterRank');
      console.log('[PASS] Exposes result.rawCoefficient');
      console.log('[PASS] Exposes result.reasons');
      console.log('[PASS] Exposes result.summary');
    }
    
    console.log('\n========================================================================');
    console.log('GATE 17 CORRELATION & EXPOSURE SUITE COMPLETE: ALL TESTS PASSED');
    console.log('========================================================================\n');
    
  });
});
