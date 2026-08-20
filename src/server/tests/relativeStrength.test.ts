import assert from 'assert';
import { Gate16RelativeStrength, CandidateStrengthInput } from '../signals/Gate16RelativeStrength.js';
import { TradeRankingEngine, ValidatedCandidate } from '../signals/TradeRankingEngine.js';
import { NormalizedCandle, TradingSignal } from '../../types/index.js';

console.log('========================================================================');
console.log('STARTING GATE 16: RELATIVE STRENGTH RANKING TESTS');
console.log('========================================================================');

function createCandles(trend: 'STRONG_UP' | 'MODERATE_UP' | 'FLAT' | 'DOWN', basePrice: number, count = 30): NormalizedCandle[] {
  const candles: NormalizedCandle[] = [];
  let price = basePrice;
  const now = Date.now();

  for (let i = 0; i < count; i++) {
    const timestamp = now - (count - i) * 60 * 60 * 1000;
    let delta = 0;
    let volume = 1000;

    if (trend === 'STRONG_UP') {
      delta = basePrice * 0.008;
      volume = 2500;
    } else if (trend === 'MODERATE_UP') {
      delta = basePrice * 0.002;
      volume = 1200;
    } else if (trend === 'FLAT') {
      delta = (i % 2 === 0 ? 1 : -1) * (basePrice * 0.001);
      volume = 800;
    } else if (trend === 'DOWN') {
      delta = -basePrice * 0.006;
      volume = 1500;
    }

    const open = price;
    const close = Math.max(1, price + delta);
    const high = Math.max(open, close) + basePrice * 0.001;
    const low = Math.min(open, close) - basePrice * 0.001;
    price = close;

    candles.push({
      symbol: 'TEST',
      provider: 'TEST',
      timeframe: '1h',
      timestamp,
      open,
      high,
      low,
      close,
      volume,
    });
  }

  return candles;
}

// --- TEST 1: Comparable Universe Partitioning ---
console.log('\n--- TEST 1: Comparable Universe Partitioning ---');
{
  const candidates: CandidateStrengthInput[] = [
    { symbol: 'SOLUSDT', direction: 'BUY', currentPrice: 150, candles: createCandles('STRONG_UP', 120) },
    { symbol: 'ETHUSDT', direction: 'BUY', currentPrice: 3000, candles: createCandles('MODERATE_UP', 2900) },
    { symbol: 'BTCUSDT', direction: 'BUY', currentPrice: 65000, candles: createCandles('FLAT', 65000) },
    { symbol: 'AAPL', direction: 'BUY', currentPrice: 220, candles: createCandles('STRONG_UP', 200) },
    { symbol: 'MSFT', direction: 'BUY', currentPrice: 420, candles: createCandles('FLAT', 420) },
    { symbol: 'EURUSD', direction: 'BUY', currentPrice: 1.0850, candles: createCandles('MODERATE_UP', 1.0800) },
    { symbol: 'GBPUSD', direction: 'BUY', currentPrice: 1.2850, candles: createCandles('FLAT', 1.2850) },
  ];

  const results = Gate16RelativeStrength.rankCandidates(candidates);

  assert.strictEqual(results.size, 7, 'All 7 candidates evaluated');

  const sol = results.get('SOLUSDT')!;
  const eth = results.get('ETHUSDT')!;
  const btc = results.get('BTCUSDT')!;
  const aapl = results.get('AAPL')!;
  const msft = results.get('MSFT')!;
  const eurusd = results.get('EURUSD')!;

  assert.strictEqual(sol.metrics.assetClass, 'CRYPTO', 'SOL detected as CRYPTO');
  assert.strictEqual(sol.metrics.universeSize, 3, 'Crypto universe has size 3');
  assert.strictEqual(aapl.metrics.assetClass, 'STOCKS', 'AAPL detected as STOCKS');
  assert.strictEqual(aapl.metrics.universeSize, 2, 'Stocks universe has size 2');
  assert.strictEqual(eurusd.metrics.assetClass, 'FOREX', 'EURUSD detected as FOREX');
  assert.strictEqual(eurusd.metrics.universeSize, 2, 'Forex universe has size 2');

  console.log('[PASS] Partitioned symbols strictly into comparable universes (CRYPTO: 3, STOCKS: 2, FOREX: 2)');
}

// --- TEST 2: Universe Ranking and Leadership ---
console.log('\n--- TEST 2: Universe Ranking and Leadership ---');
{
  const cryptoCandidates: CandidateStrengthInput[] = [
    { symbol: 'SOLUSDT', direction: 'BUY', currentPrice: 150, candles: createCandles('STRONG_UP', 120) },
    { symbol: 'ETHUSDT', direction: 'BUY', currentPrice: 3000, candles: createCandles('MODERATE_UP', 2900) },
    { symbol: 'BTCUSDT', direction: 'BUY', currentPrice: 65000, candles: createCandles('DOWN', 68000) },
  ];

  const results = Gate16RelativeStrength.rankCandidates(cryptoCandidates);
  const sol = results.get('SOLUSDT')!;
  const eth = results.get('ETHUSDT')!;
  const btc = results.get('BTCUSDT')!;

  assert.strictEqual(sol.relativeRank, 1, 'SOL is #1 ranked Crypto');
  assert.strictEqual(eth.relativeRank, 2, 'ETH is #2 ranked Crypto');
  assert.strictEqual(btc.relativeRank, 3, 'BTC is #3 ranked Crypto');

  assert.ok(sol.relativeStrengthScore > eth.relativeStrengthScore, 'SOL score > ETH score');
  assert.ok(eth.relativeStrengthScore > btc.relativeStrengthScore, 'ETH score > BTC score');

  assert.strictEqual(sol.assetClassRank, 'SOLUSDT #1 of 3 CRYPTO', 'Asset class rank formatted properly');
  assert.strictEqual(sol.marketContext, 'LEADER', 'SOL marked as LEADER');
  assert.strictEqual(btc.marketContext, 'UNDERPERFORMING', 'BTC marked as UNDERPERFORMING');

  console.log(`[PASS] Correctly ranked Crypto universe: SOL (#${sol.relativeRank}, Score ${sol.relativeStrengthScore}), ETH (#${eth.relativeRank}, Score ${eth.relativeStrengthScore}), BTC (#${btc.relativeRank}, Score ${btc.relativeStrengthScore})`);
}

// --- TEST 3: Bearish Short Relative Strength ---
console.log('\n--- TEST 3: Bearish Short Relative Strength ---');
{
  const candidates: CandidateStrengthInput[] = [
    { symbol: 'DOGEUSDT', direction: 'SELL', currentPrice: 0.12, candles: createCandles('DOWN', 0.15) },
    { symbol: 'BNBUSDT', direction: 'SELL', currentPrice: 550, candles: createCandles('STRONG_UP', 500) },
  ];

  const results = Gate16RelativeStrength.rankCandidates(candidates);
  const doge = results.get('DOGEUSDT')!;
  const bnb = results.get('BNBUSDT')!;

  assert.strictEqual(doge.relativeRank, 1, 'Strong downward displacement is #1 for SELL setup');
  assert.strictEqual(bnb.relativeRank, 2, 'Upward trending asset is ranked #2 for SELL setup');
  assert.ok(doge.relativeStrengthScore > bnb.relativeStrengthScore, 'DOGE score > BNB score for short candidate');

  console.log(`[PASS] Correctly evaluated direction-aware relative strength for SELL setups (DOGE Score: ${doge.relativeStrengthScore} vs BNB: ${bnb.relativeStrengthScore})`);
}

// --- TEST 4: Confidence Modifier & Safety Invariants ---
console.log('\n--- TEST 4: Confidence Modifier & Safety Invariants ---');
{
  const dummySignal: TradingSignal = {
    id: 'sig_test_1',
    snapshotId: 'snap_1',
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
    score: 80,
    marketRegime: 'STRONG_TREND',
    relativeStrengthScore: 92,
    relativeRank: 1,
    assetClassRank: 'SOLUSDT #1 of 3 CRYPTO',
    marketContext: 'LEADER',
  };

  const candidate: ValidatedCandidate = {
    signal: dummySignal,
    scoring: {
      isValid: true,
      score: 80,
      marketRegime: 'STRONG_TREND',
      direction: 'BUY',
      timeframesAligned: 3,
      confluenceReasons: [],
      factors: {
        totalScore: 80,
        trendScore: 80,
        momentumScore: 80,
        volatilityScore: 80,
        volumeScore: 80,
        supportResistanceScore: 80,
        entryQualityScore: 80,
      } as any,
      estimatedFriction: { netRiskRewardRatio: 2.0 } as any,
      hypotheticalRisk: {} as any,
    } as any,
    validation: { isValid: true, snapshotId: 'snap_1', detailedMessage: 'Valid' } as any,
    aiConfidence: 85,
    timeframesAligned: 3,
  };

  // Ranking test with TradeRankingEngine
  const ranking = TradeRankingEngine.rankOpportunities([candidate]);
  assert.strictEqual(ranking.allRanked.length, 1, 'Candidate ranked');
  assert.ok(ranking.bestTrade !== undefined, 'Best trade identified');

  // Strict quality filter test: score < 75 must be rejected even with top rank
  const lowQualitySignal = { ...dummySignal, score: 60, relativeStrengthScore: 99 };
  const lowQualityCand: ValidatedCandidate = {
    ...candidate,
    signal: lowQualitySignal,
    scoring: { ...candidate.scoring, score: 60, factors: { ...candidate.scoring.factors, totalScore: 60 } } as any,
  };

  const rejectedRanking = TradeRankingEngine.rankOpportunities([lowQualityCand]);
  assert.strictEqual(rejectedRanking.allRanked.length, 0, 'Low quality trade rejected');
  assert.strictEqual(rejectedRanking.rejectedCandidates.length, 1, 'Candidate in rejected list');

  console.log('[PASS] Verified Relative Strength acts as confidence modifier without bypassing quality/risk thresholds (<75 strictly rejected)');
}

// --- TEST 5: Interface Contract & Schema Verification ---
console.log('\n--- TEST 5: Interface Contract & Schema Verification ---');
{
  const cand: CandidateStrengthInput = {
    symbol: 'SOLUSDT',
    direction: 'BUY',
    currentPrice: 150,
    candles: createCandles('STRONG_UP', 120),
  };

  const res = Gate16RelativeStrength.analyzeSingle(cand);

  assert.ok(typeof res.relativeStrengthScore === 'number', 'Exposes res.relativeStrengthScore');
  assert.ok(typeof res.relativeRank === 'number', 'Exposes res.relativeRank');
  assert.ok(typeof res.assetClassRank === 'string', 'Exposes res.assetClassRank');
  assert.ok(typeof res.marketContext === 'string', 'Exposes res.marketContext');
  assert.ok(typeof res.metrics === 'object', 'Exposes res.metrics');
  assert.ok(Array.isArray(res.reasons), 'Exposes res.reasons');
  assert.ok(typeof res.summary === 'string', 'Exposes res.summary');

  console.log('[PASS] Exposes result.relativeStrengthScore');
  console.log('[PASS] Exposes result.relativeRank');
  console.log('[PASS] Exposes result.assetClassRank');
  console.log('[PASS] Exposes result.marketContext');
  console.log('[PASS] Exposes result.metrics');
  console.log('[PASS] Exposes result.reasons');
  console.log('[PASS] Exposes result.summary');
}

console.log('\n========================================================================');
console.log('GATE 16 RELATIVE STRENGTH SUITE COMPLETE: ALL TESTS PASSED');
console.log('========================================================================\n');
