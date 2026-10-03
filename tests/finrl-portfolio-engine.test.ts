import assert from 'assert';
import {
  FinRLXPortfolioEngine,
  PortfolioPosition,
  PortfolioConstraints,
  PortfolioCandidateInput,
} from '../src/server/signals/FinRLXPortfolioEngine.js';
import { TradingSignal } from '../src/types/index.js';

export async function runFinRLTests() {
  console.log('\n--- Running FinRLXPortfolioEngine Tests ---');

  const totalEquity = 10_000;

  // Test 1: Portfolio Exposure Calculation
  console.log('Test 1: Calculate gross, net, long, and short exposure accurately');
  const mockPositions: PortfolioPosition[] = [
    {
      id: 'pos_1',
      symbol: 'BTCUSDT',
      direction: 'BUY',
      entryPrice: 65000,
      currentPrice: 66000,
      stopLoss: 63000,
      takeProfit: 70000,
      quantity: 0.015,
      allocatedValue: 1000,
      strategy: 'Multi-Timeframe Trend Confluence',
      assetClass: 'CRYPTO',
      correlationCluster: 'CRYPTO_MAJORS',
      openedAt: Date.now() - 3600000,
    },
    {
      id: 'pos_2',
      symbol: 'ETHUSDT',
      direction: 'BUY',
      entryPrice: 3500,
      currentPrice: 3550,
      stopLoss: 3350,
      takeProfit: 3800,
      quantity: 0.28,
      allocatedValue: 1000,
      strategy: 'Breakout Quality',
      assetClass: 'CRYPTO',
      correlationCluster: 'CRYPTO_MAJORS',
      openedAt: Date.now() - 1800000,
    },
    {
      id: 'pos_3',
      symbol: 'EURUSD',
      direction: 'SELL',
      entryPrice: 1.085,
      currentPrice: 1.082,
      stopLoss: 1.092,
      takeProfit: 1.070,
      quantity: 500,
      allocatedValue: 500,
      strategy: 'Multi-Timeframe Trend Confluence',
      assetClass: 'FOREX',
      correlationCluster: 'FOREX_EUR',
      openedAt: Date.now() - 7200000,
    },
  ];

  const exposure = FinRLXPortfolioEngine.calculateExposure(mockPositions, totalEquity);
  assert.strictEqual(exposure.totalEquity, 10_000, 'Total equity should be 10000');
  assert.strictEqual(exposure.allocatedCapital, 2500, 'Allocated capital should be 1000+1000+500 = 2500');
  assert.strictEqual(exposure.cashBalance, 7500, 'Cash balance should be 10000 - 2500 = 7500');
  assert.strictEqual(exposure.grossExposure, 0.25, 'Gross exposure should be 0.25 (25%)');
  assert.strictEqual(exposure.longExposure, 0.20, 'Long exposure should be 0.20 (20%)');
  assert.strictEqual(exposure.shortExposure, 0.05, 'Short exposure should be 0.05 (5%)');
  assert.strictEqual(exposure.netExposure, 0.15, 'Net exposure should be 0.15 (15% long skew)');
  assert.strictEqual(exposure.activePositionCount, 3, 'Active position count should be 3');
  console.log('  -> Exposure metrics verified successfully.');

  // Test 2: Correlated-Position Exposure & Clustering
  console.log('Test 2: Identify correlated cluster exposure & concentration');
  const clusters = FinRLXPortfolioEngine.calculateCorrelatedExposure(mockPositions, totalEquity);
  assert(clusters['CRYPTO_MAJORS'] !== undefined, 'CRYPTO_MAJORS cluster should exist');
  assert.strictEqual(clusters['CRYPTO_MAJORS'].totalValue, 2000, 'Crypto majors total value should be 2000');
  assert.strictEqual(clusters['CRYPTO_MAJORS'].clusterWeight, 0.20, 'Crypto majors weight should be 20%');
  assert.strictEqual(clusters['CRYPTO_MAJORS'].isConcentrated, false, 'Crypto majors weight 20% < 35% concentration threshold');

  assert(clusters['FOREX_EUR'] !== undefined, 'FOREX_EUR cluster should exist');
  assert.strictEqual(clusters['FOREX_EUR'].totalValue, 500, 'Forex EUR value should be 500');
  console.log('  -> Correlation cluster analysis verified.');

  // Test 3: Parametric Risk Overlay (VaR and Expected Shortfall)
  console.log('Test 3: Evaluate Parametric VaR, Expected Shortfall, and scaling');
  const riskOverlay = FinRLXPortfolioEngine.evaluateRiskOverlay(mockPositions, totalEquity);
  assert(riskOverlay.parametricVaR95 > 0, 'Parametric VaR 95% should be positive');
  assert(riskOverlay.parametricVaR99 > riskOverlay.parametricVaR95, 'VaR 99% must be greater than VaR 95%');
  assert(riskOverlay.expectedShortfall95 >= riskOverlay.parametricVaR95, 'Expected Shortfall must exceed or equal VaR 95%');
  assert(riskOverlay.recommendedScalingFactor >= 0 && riskOverlay.recommendedScalingFactor <= 1.0, 'Scaling factor should be between 0 and 1');
  console.log(`  -> VaR 95%: ${(riskOverlay.parametricVaR95 * 100).toFixed(2)}%, VaR 99%: ${(riskOverlay.parametricVaR99 * 100).toFixed(2)}%, Scaling: ${riskOverlay.recommendedScalingFactor}`);

  // Test 4: Strategy Allocation
  console.log('Test 4: Verify multi-strategy allocation breakdown');
  const stratAllocs = FinRLXPortfolioEngine.evaluateStrategyAllocation(mockPositions, totalEquity);
  assert(stratAllocs['Multi-Timeframe Trend Confluence'] !== undefined, 'Trend Confluence strategy should exist');
  assert.strictEqual(stratAllocs['Multi-Timeframe Trend Confluence'].activeSignalsCount, 2, 'Trend Confluence should have 2 positions');
  assert.strictEqual(stratAllocs['Multi-Timeframe Trend Confluence'].allocatedValue, 1500, 'Allocated value should be 1500');
  assert.strictEqual(stratAllocs['Breakout Quality'].activeSignalsCount, 1, 'Breakout Quality should have 1 position');
  console.log('  -> Strategy allocation verified.');

  // Test 5: Candidate Constraint Enforcement
  console.log('Test 5: Enforce portfolio constraints on new candidate signals');
  // Candidate A: Normal valid candidate within limits
  const candidateA: PortfolioCandidateInput = {
    symbol: 'SOLUSDT',
    direction: 'BUY',
    entryPrice: 150,
    stopLoss: 142,
    takeProfit: 170,
    suggestedRiskAmount: 50,
    suggestedPositionSize: 5, // 5 * 150 = $750 (7.5% of equity)
    correlationCluster: 'CRYPTO_MAJORS',
  };

  const evalA = FinRLXPortfolioEngine.evaluateCandidate(candidateA, mockPositions);
  assert.strictEqual(evalA.allowed, true, 'Candidate A should be allowed');
  assert.strictEqual(evalA.constraintViolations.length, 0, 'No constraint violations for candidate A');
  assert(evalA.adjustedSize > 0, 'Adjusted size should be positive');

  // Candidate B: Excessive cluster concentration (pushing CRYPTO_MAJORS over 35%)
  const candidateB: PortfolioCandidateInput = {
    symbol: 'BTCUSDT',
    direction: 'BUY',
    entryPrice: 65000,
    stopLoss: 63000,
    takeProfit: 70000,
    suggestedRiskAmount: 200,
    suggestedPositionSize: 0.05, // 0.05 * 65000 = $3250. Current crypto = 2000 -> 5250 / 10000 = 52.5% > 35% cap
    correlationCluster: 'CRYPTO_MAJORS',
  };

  const evalB = FinRLXPortfolioEngine.evaluateCandidate(candidateB, mockPositions);
  assert.strictEqual(evalB.allowed, false, 'Candidate B should be rejected due to cluster cap and existing position');
  assert(evalB.constraintViolations.some(v => v.includes('Position already exists')), 'Should detect existing symbol position');
  assert(evalB.constraintViolations.some(v => v.includes('Correlation cluster')), 'Should detect cluster concentration violation');
  assert.strictEqual(evalB.adjustedSize, 0, 'Rejected candidate adjusted size must be 0');
  console.log('  -> Portfolio constraint violations enforced accurately.');

  // Test 6: Helper integration methods (signalsToPositions & evaluateSignalCandidate)
  console.log('Test 6: Verify signal adapter methods');
  const mockSignal: TradingSignal = {
    id: 'sig_test_1',
    symbol: 'EURUSD',
    direction: 'BUY',
    entryPrice: 1.085,
    stopLoss: 1.080,
    takeProfit: 1.095,
    suggestedPositionSize: 400,
    suggestedRiskAmount: 20,
    strategy: 'Trend Confluence',
  } as any;

  const positionsFromSignals = FinRLXPortfolioEngine.signalsToPositions([mockSignal]);
  assert.strictEqual(positionsFromSignals.length, 1, 'Should map 1 signal to 1 position');
  assert.strictEqual(positionsFromSignals[0].symbol, 'EURUSD', 'Mapped symbol should match');

  const evalSignal = FinRLXPortfolioEngine.evaluateSignalCandidate(
    { symbol: 'GBPUSD', direction: 'BUY', entryPrice: 1.28, stopLoss: 1.27, takeProfit: 1.30, suggestedPositionSize: 300 },
    [mockSignal]
  );
  assert.strictEqual(evalSignal.allowed, true, 'Valid new currency signal should be allowed');
  assert.strictEqual(evalSignal.symbol, 'GBPUSD');
  console.log('  -> Signal helper methods verified.');

  console.log('\n\x1b[32m[FINRL SUCCESS] All FinRLXPortfolioEngine tests passed successfully!\x1b[0m\n');
}

// Run standalone if executed directly
if (process.argv[1]?.endsWith('finrl-portfolio-engine.test.ts')) {
  runFinRLTests().catch((err) => {
    console.error('FinRLXPortfolioEngine test error:', err);
    process.exit(1);
  });
}
