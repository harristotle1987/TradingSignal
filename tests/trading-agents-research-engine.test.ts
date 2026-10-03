import assert from 'assert';
import { TradingAgentsResearchEngine, TradingAgentsResearchReport } from '../src/server/signals/TradingAgentsResearchEngine.js';
import { NormalizedCandle } from '../src/types/index.js';

function createMockCandles(count: number, basePrice = 100, trend: 'UP' | 'DOWN' | 'FLAT' = 'UP', now = Date.now()): NormalizedCandle[] {
  const candles: NormalizedCandle[] = [];
  let price = basePrice;

  for (let i = 0; i < count; i++) {
    const delta = trend === 'UP' ? 0.5 : trend === 'DOWN' ? -0.5 : (Math.sin(i) * 0.2);
    const open = price;
    const close = price + delta;
    const high = Math.max(open, close) + 0.3;
    const low = Math.min(open, close) - 0.3;
    const volume = 1000 + Math.random() * 500;

    candles.push({
      symbol: 'BTCUSDT',
      provider: 'bitget',
      timeframe: '1h',
      timestamp: now - (count - i) * 3600 * 1000,
      open,
      high,
      low,
      close,
      volume,
    });

    price = close;
  }

  return candles;
}

export async function runTradingAgentsTests() {
  console.log('\n=== SUITE: TRADING AGENTS MULTI-AGENT RESEARCH ENGINE ===\n');
  const now = Date.now();

  const candlesMap = {
    '15m': createMockCandles(40, 95000, 'UP', now),
    '1h': createMockCandles(40, 95000, 'UP', now),
    '4h': createMockCandles(25, 95000, 'UP', now),
  };

  // Test 1: Full multi-agent research dossier generation with all 5 roles
  console.log('Test 1: Generates independent specialist research reports for all 5 roles');
  const report: TradingAgentsResearchReport = TradingAgentsResearchEngine.research({
    snapshotId: 'snap_test_12345',
    symbol: 'BTCUSDT',
    direction: 'BUY',
    entryPrice: 95020.50,
    stopLoss: 93800.00,
    takeProfit: 97800.00,
    riskRewardRatio: 2.28,
    score: 82,
    candlesMap,
    newsSentiment: 'BULLISH',
    timestamp: now,
  });

  assert.strictEqual(report.snapshotId, 'snap_test_12345');
  assert.strictEqual(report.symbol, 'BTCUSDT');
  assert.strictEqual(report.proposedDirection, 'BUY');
  assert.strictEqual(report.framework.name, 'TradingAgents');
  assert.strictEqual(report.framework.repository, 'https://github.com/TauricResearch/TradingAgents');

  // Role 1: Technical Analysis
  assert.strictEqual(report.technicalAnalysis.role, 'TechnicalAnalyst');
  assert(['BULLISH', 'BEARISH', 'NEUTRAL'].includes(report.technicalAnalysis.stance));
  assert(report.technicalAnalysis.confidence >= 0 && report.technicalAnalysis.confidence <= 1.0);
  assert(report.technicalAnalysis.keyFindings.length > 0);
  assert(report.technicalAnalysis.indicatorSnapshot.price === 95020.50);
  assert(report.technicalAnalysis.indicatorSnapshot.rsi1h > 0);
  assert(report.technicalAnalysis.indicatorSnapshot.atr1h > 0);
  assert(report.technicalAnalysis.structureAssessment.length > 0);

  // Role 2: Sentiment Analysis
  assert.strictEqual(report.sentimentAnalysis.role, 'SentimentAnalyst');
  assert.strictEqual(report.sentimentAnalysis.stance, 'BULLISH');
  assert(['LOW', 'MEDIUM', 'HIGH', 'EXTREME'].includes(report.sentimentAnalysis.headlineRisk));
  assert(report.sentimentAnalysis.upcomingEvents.length > 0);
  assert(report.sentimentAnalysis.sentimentScore > 0);

  // Role 3: Fundamental / Context Analysis
  assert.strictEqual(report.fundamentalAnalysis.role, 'FundamentalContextAnalyst');
  assert.strictEqual(report.fundamentalAnalysis.assetClass, 'CRYPTO');
  assert(['HIGH', 'MEDIUM', 'LOW'].includes(report.fundamentalAnalysis.liquidityTier));
  assert(report.fundamentalAnalysis.thesis.length > 0);

  // Role 4: Risk Analysis
  assert.strictEqual(report.riskAnalysis.role, 'RiskManager');
  assert(['ACCEPTABLE', 'ELEVATED', 'HIGH', 'PROHIBITIVE'].includes(report.riskAnalysis.riskStance));
  assert.strictEqual(report.riskAnalysis.rewardToRiskRatio, 2.28);
  assert(report.riskAnalysis.stopDistanceToAtrMultiple > 0);
  assert(report.riskAnalysis.assessment.length > 0);

  // Role 5: Final Research Synthesis
  assert.strictEqual(report.synthesis.role, 'ResearchDirector');
  assert(['BULLISH', 'BEARISH', 'NEUTRAL'].includes(report.synthesis.consensusStance));
  assert(report.synthesis.consensusScore >= 0 && report.synthesis.consensusScore <= 100);
  assert(report.synthesis.bullThesis.length > 0);
  assert(report.synthesis.bearThesis.length > 0);
  assert(report.synthesis.consensusSummary.length > 0);
  assert(report.synthesis.evidenceCitations.length >= 3);
  console.log('✓ Test 1 passed: All 5 independent roles generated verified research reports.');

  // Test 2: Grounding and Snapshot Citations
  console.log('Test 2: Citations strictly reference the actual provided market snapshot values');
  const citations = report.synthesis.evidenceCitations;
  const entryCitation = citations.find(c => c.includes('95020.50'));
  assert(entryCitation !== undefined, 'Citation must directly quote the snapshot entry price 95020.50');
  const atrCitation = citations.find(c => c.includes('ATR is'));
  assert(atrCitation !== undefined, 'Citation must quote 1H ATR value from snapshot');
  console.log('✓ Test 2 passed: All claims are anchored to real snapshot metrics.');

  // Test 3: Look-Ahead Information & Data Leakage Prevention
  console.log('Test 3: Look-ahead timestamps are detected and flagged in provenance');
  const futureCandlesMap = {
    '1h': [
      ...createMockCandles(10, 95000, 'UP', now),
      {
        symbol: 'BTCUSDT',
        provider: 'bitget',
        timeframe: '1h',
        timestamp: now + 3600 * 1000 * 5, // 5 hours into the future
        open: 96000,
        high: 97000,
        low: 95500,
        close: 96500,
        volume: 2000,
      },
    ],
  };

  const lookAheadReport = TradingAgentsResearchEngine.research({
    snapshotId: 'snap_future_check',
    symbol: 'BTCUSDT',
    direction: 'BUY',
    entryPrice: 95000,
    stopLoss: 94000,
    takeProfit: 97000,
    riskRewardRatio: 2.0,
    score: 80,
    candlesMap: futureCandlesMap,
    timestamp: now,
  });

  assert.strictEqual(lookAheadReport.provenance.noLookAheadVerified, false, 'Must flag look-ahead timestamp as unverified');
  console.log('✓ Test 3 passed: Look-ahead bias strictly caught and flagged.');

  // Test 4: Strict Non-Authority Principle
  console.log('Test 4: TradingAgents engine CANNOT directly create, execute, or approve trades');
  const engineObj = TradingAgentsResearchEngine as any;
  assert.strictEqual(typeof engineObj.createTrade, 'undefined');
  assert.strictEqual(typeof engineObj.approveTrade, 'undefined');
  assert.strictEqual(typeof engineObj.executeTrade, 'undefined');
  assert.strictEqual(typeof engineObj.createSignal, 'undefined');
  assert.strictEqual(typeof engineObj.approveSignal, 'undefined');
  console.log('✓ Test 4 passed: Zero trading authority verified.');

  console.log('\n\x1b[32m[TRADING AGENTS SUCCESS] All TradingAgentsResearchEngine tests passed successfully!\x1b[0m\n');
}

if (process.argv[1]?.endsWith('trading-agents-research-engine.test.ts')) {
  runTradingAgentsTests().catch((err) => {
    console.error('\x1b[31m[TRADING AGENTS FAILED]\x1b[0m', err);
    process.exit(1);
  });
}
