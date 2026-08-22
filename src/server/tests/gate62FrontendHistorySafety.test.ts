import { describe, it, expect } from 'vitest';
import { TradingSignal, SignalHistoryItem } from '../../types/index.js';

describe('Gate 62: Frontend History Ingestion Safety', () => {
  const createSignal = (overrides: Partial<TradingSignal>): TradingSignal => ({
    id: 'test_123',
    snapshotId: 'snap_123',
    symbol: 'BTCUSDT',
    direction: 'BUY',
    entryPrice: 50000,
    stopLoss: 49000,
    takeProfit: 52000,
    riskRewardRatio: 2.0,
    score: 80,
    confidenceScore: 80,
    strategy: 'Test',
    confluenceReasons: [],
    timeframe: '1h',
    dataSource: 'Bitget',
    status: 'WAITING_ENTRY',
    timestamp: Date.now(),
    validatedAt: Date.now(),
    ...overrides,
  });

  // Helper simulating addSignalsToHistory filter
  const filterAndMapSignals = (signals: TradingSignal[]): SignalHistoryItem[] => {
    const items: SignalHistoryItem[] = [];
    for (const sig of signals) {
      if (sig.isTradeableSignal !== true || sig.signalClassification !== 'TRADEABLE') {
        continue;
      }
      items.push({
        id: sig.id || `${sig.symbol}_${sig.timestamp}`,
        snapshotId: sig.snapshotId || sig.id || 'snap',
        symbol: sig.symbol,
        direction: sig.direction,
        entryPrice: sig.entryPrice,
        stopLoss: sig.stopLoss,
        takeProfit: sig.takeProfit,
        score: sig.score,
        outcomeType: sig.isBestTrade ? 'BEST_TRADE' : 'VALIDATED',
        timestamp: sig.timestamp,
        isTradeableSignal: true,
        signalClassification: 'TRADEABLE',
      });
    }
    return items;
  };

  // Helper simulating localStorage loading filter
  const filterLocalStorageHistory = (savedList: any[]): SignalHistoryItem[] => {
    return savedList
      .filter((item: any) => item && item.isTradeableSignal === true && item.signalClassification === 'TRADEABLE')
      .slice(0, 30);
  };

  it('rejects signal with high score (e.g. 95) if isTradeableSignal is not true', () => {
    const signal = createSignal({
      id: 'sig_high_score',
      symbol: 'EURUSD',
      score: 95,
      rankTier: 'BEST_TRADE',
      isBestTrade: true,
      isTopTrade: true,
      isTradeableSignal: false,
      signalClassification: 'WATCHING',
    });

    const result = filterAndMapSignals([signal]);
    expect(result.length).toBe(0);
  });

  it('rejects signal with BEST_TRADE tier if signalClassification is not TRADEABLE', () => {
    const signal = createSignal({
      id: 'sig_best_trade_non_tradeable',
      symbol: 'BTCUSDT',
      score: 88,
      rankTier: 'BEST_TRADE',
      isBestTrade: true,
      isTradeableSignal: true,
      signalClassification: 'QUALIFIED_CANDIDATE', // Not TRADEABLE
    });

    const result = filterAndMapSignals([signal]);
    expect(result.length).toBe(0);
  });

  it('accepts signals ONLY when isTradeableSignal === true AND signalClassification === "TRADEABLE"', () => {
    const signal = createSignal({
      id: 'sig_valid_tradeable',
      symbol: 'ETHUSDT',
      score: 82,
      isTradeableSignal: true,
      signalClassification: 'TRADEABLE',
    });

    const result = filterAndMapSignals([signal]);
    expect(result.length).toBe(1);
    expect(result[0].id).toBe('sig_valid_tradeable');
    expect(result[0].isTradeableSignal).toBe(true);
    expect(result[0].signalClassification).toBe('TRADEABLE');
  });

  it('purges legacy/undefined localStorage items without explicit tradeable classification', () => {
    const legacyHistory = [
      {
        id: 'legacy_1',
        symbol: 'GBPUSD',
        score: 92,
        rankTier: 'BEST_TRADE',
        isBestTrade: true,
        // isTradeableSignal undefined
      },
      {
        id: 'legacy_2',
        symbol: 'AUDUSD',
        score: 80,
        isTradeableSignal: false,
        signalClassification: 'WATCHING',
      },
      {
        id: 'tradeable_1',
        symbol: 'BTCUSDT',
        score: 85,
        isTradeableSignal: true,
        signalClassification: 'TRADEABLE',
      },
    ];

    const cleaned = filterLocalStorageHistory(legacyHistory);
    expect(cleaned.length).toBe(1);
    expect(cleaned[0].id).toBe('tradeable_1');
  });
});
