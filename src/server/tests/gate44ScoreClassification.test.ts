import assert from 'assert';
import { ScoringEngine } from '../signals/ScoringEngine.js';
import { TradeRankingEngine, ValidatedCandidate } from '../signals/TradeRankingEngine.js';
import { serverConfig } from '../config.js';
import { TradingSignal } from '../../types/index.js';

import { describe, it } from "vitest";
describe("gate44ScoreClassification.test.ts", () => {
  it("runs the test suite", async () => {
    /**
     * Gate 44: Score Classifications & Centralized Threshold Verification Tests
     */
    
    
    console.log('--- GATE 44: SCORE CLASSIFICATION AUDIT & VERIFICATION ---');
    
    // Test 1: Standard classification mapping using default thresholds
    {
      const defaultThresholds = serverConfig.getConfig().thresholds;
      console.log(`[Test 1] Testing with default thresholds: signal=${defaultThresholds.signalThreshold}, candidate=${defaultThresholds.qualifiedCandidateThreshold}, watching=${defaultThresholds.watchingThreshold}`);
    
      const actionable = ScoringEngine.classifyScore(defaultThresholds.signalThreshold);
      assert.strictEqual(actionable.tier, 'ACTIONABLE_SIGNAL');
      assert.strictEqual(actionable.isActionable, true);
      assert.strictEqual(actionable.isQualifiedCandidate, true);
      assert.strictEqual(actionable.isWatching, true);
      assert.ok(actionable.label.includes('ACTIONABLE SIGNAL'));
    
      const candidate = ScoringEngine.classifyScore(defaultThresholds.qualifiedCandidateThreshold);
      assert.strictEqual(candidate.tier, 'QUALIFIED_CANDIDATE');
      assert.strictEqual(candidate.isActionable, false);
      assert.strictEqual(candidate.isQualifiedCandidate, true);
      assert.strictEqual(candidate.isWatching, true);
      assert.ok(candidate.label.includes('QUALIFIED CANDIDATE'));
    
      const watching = ScoringEngine.classifyScore(defaultThresholds.watchingThreshold);
      assert.strictEqual(watching.tier, 'WATCHING');
      assert.strictEqual(watching.isActionable, false);
      assert.strictEqual(watching.isQualifiedCandidate, false);
      assert.strictEqual(watching.isWatching, true);
      assert.ok(watching.label.includes('WATCHING'));
    
      const reject = ScoringEngine.classifyScore(defaultThresholds.watchingThreshold - 1);
      assert.strictEqual(reject.tier, 'REJECT');
      assert.strictEqual(reject.isActionable, false);
      assert.strictEqual(reject.isQualifiedCandidate, false);
      assert.strictEqual(reject.isWatching, false);
      console.log('✓ Test 1 Passed: Default threshold classifications accurate.');
    }
    
    // Test 2: Custom / non-default configured thresholds (e.g. signalThreshold = 78)
    {
      console.log('[Test 2] Testing with custom thresholds (signalThreshold = 78, qualified = 72, watching = 65)...');
      const custom = {
        signalThreshold: 78,
        qualifiedCandidateThreshold: 72,
        watchingThreshold: 65,
      };
    
      // Score 78 should be actionable under custom config
      const res78 = ScoringEngine.classifyScore(78, custom);
      assert.strictEqual(res78.tier, 'ACTIONABLE_SIGNAL');
      assert.strictEqual(res78.isActionable, true);
      assert.ok(res78.label.includes('78+'));
      assert.ok(!res78.label.includes('85+'), 'Must never display 85+ when configured threshold is 78');
    
      // Score 75 should be qualified candidate
      const res75 = ScoringEngine.classifyScore(75, custom);
      assert.strictEqual(res75.tier, 'QUALIFIED_CANDIDATE');
      assert.strictEqual(res75.isActionable, false);
      assert.ok(res75.label.includes('72-77'));
    
      // Score 68 should be watching
      const res68 = ScoringEngine.classifyScore(68, custom);
      assert.strictEqual(res68.tier, 'WATCHING');
      assert.strictEqual(res68.isActionable, false);
    
      // Score 64 should be rejected
      const res64 = ScoringEngine.classifyScore(64, custom);
      assert.strictEqual(res64.tier, 'REJECT');
    
      console.log('✓ Test 2 Passed: Custom thresholds dynamic and never hardcode 85+ or 75-84.');
    }
    
    // Test 3: TradeRankingEngine assigns ranking tiers based strictly on ranking order
    {
      console.log('[Test 3] Testing TradeRankingEngine relative ranking tier assignment...');
      const createMockCandidate = (symbol: string, score: number): ValidatedCandidate => {
        const signal: TradingSignal = {
          id: `sig_${symbol}`,
          symbol,
          direction: 'BUY',
          timeframe: '1h',
          entryPrice: 100,
          stopLoss: 95,
          takeProfit: 110,
          riskRewardRatio: 2.0,
          score,
          confidenceScore: score,
          strategy: 'Trend Confluence',
          timestamp: Date.now(),
          status: 'WAITING_ENTRY',
          marketRegime: 'TRENDING',
          assetClass: 'CRYPTO',
          snapshotId: 'snap_1',
          confluenceReasons: ['Trend alignment'],
          validatedAt: Date.now(),
          dataSource: 'LIVE',
        };
    
        return {
          signal,
          scoring: {
            score,
            factors: {
              totalScore: score,
            },
            marketRegime: 'TRENDING',
            isTopTradeCandidate: true,
          } as any,
          validation: {
            isValid: true,
            rejectionReason: null,
          } as any,
          aiConfidence: 85,
          timeframesAligned: 5,
        };
      };
    
      // 3 candidates with scores 92, 88, 81 (all above default regime threshold)
      const candidates = [
        createMockCandidate('BTCUSDT', 88),
        createMockCandidate('ETHUSDT', 92),
        createMockCandidate('SOLUSDT', 81),
      ];
    
      const ranked = TradeRankingEngine.rankOpportunities(candidates);
      assert.ok(ranked.bestTrade, 'Must have a best trade');
      assert.strictEqual(ranked.bestTrade?.symbol, 'ETHUSDT', 'Highest score (82) must be ranked #1 BEST_TRADE');
      assert.strictEqual(ranked.bestTrade?.rankTier, 'BEST_TRADE');
      assert.strictEqual(ranked.bestTrade?.isBestTrade, true);
    
      assert.ok(ranked.secondBest, 'Must have a second best trade');
      assert.strictEqual(ranked.secondBest?.symbol, 'BTCUSDT', '2nd highest score (79) must be ranked #2 SECOND_BEST');
      assert.strictEqual(ranked.secondBest?.rankTier, 'SECOND_BEST');
      assert.strictEqual(ranked.secondBest?.isSecondBest, true);
    
      assert.strictEqual(ranked.suggestions.length, 1);
      assert.strictEqual(ranked.suggestions[0].symbol, 'SOLUSDT', '3rd candidate must be SUGGESTION');
      assert.strictEqual(ranked.suggestions[0].rankTier, 'SUGGESTION');
    
      console.log('✓ Test 3 Passed: TradeRankingEngine ranking tiers assigned strictly by rank order.');
    }
    
    console.log('All Gate 44 verification tests passed successfully!');
    
  });
});
