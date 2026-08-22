import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SignalLogger, SignalLogRecord, isTradeableLogRecord } from '../signals/SignalLogger.js';
import { TradingSignal } from '../../types/index.js';
import { Gate35SignalFunnelAnalytics } from '../signals/Gate35SignalFunnelAnalytics.js';

describe('Gate 70: Tradeable History Consistency', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    (SignalLogger as any).isInitialized = true;
    (SignalLogger as any).lastFirestoreSync = Date.now() + 1000000;
    (SignalLogger as any).logs.clear();
    Gate35SignalFunnelAnalytics.clear();
    vi.spyOn(SignalLogger as any, 'syncFromFirestore').mockResolvedValue(undefined);
    vi.spyOn(SignalLogger as any, 'flushToDisk').mockImplementation(() => {});
    vi.spyOn(SignalLogger as any, 'syncToFirestore').mockImplementation(() => {});
  });

  const createSignal = (overrides: Partial<TradingSignal>): TradingSignal => {
    const ts = overrides.timestamp || Date.now();
    return {
      id: 'test_' + Math.random().toString(36).substring(2, 9),
      snapshotId: 'snap_' + Math.random().toString(36).substring(2, 9),
      symbol: 'BTCUSDT',
      direction: 'BUY',
      entryPrice: 50000,
      stopLoss: 49000,
      takeProfit: 52000,
      riskRewardRatio: 2.0,
      score: 80,
      confidenceScore: 80,
      strategy: 'Test Strategy',
      confluenceReasons: ['Confluence 1'],
      timeframe: '1h',
      dataSource: 'Bitget',
      status: 'WAITING_ENTRY',
      timestamp: ts,
      validatedAt: ts,
      ...overrides,
    };
  };

  describe('isTradeableLogRecord predicate validation', () => {
    it('identifies explicitly tradeable signals correctly', () => {
      const record: SignalLogRecord = {
        id: '1',
        timestamp: Date.now(),
        symbol: 'BTCUSDT',
        marketType: 'Crypto',
        provider: 'Bitget',
        direction: 'BUY',
        entryPrice: 50000,
        stopLoss: 49000,
        takeProfit: 52000,
        riskRewardRatio: 2.0,
        score: 80,
        confidenceScore: 80,
        strategy: 'Test',
        marketRegime: 'TREND',
        status: 'WAITING_ENTRY',
        snapshotId: 'snap_1',
        isTradeableSignal: true,
        signalClassification: 'TRADEABLE',
      };
      expect(isTradeableLogRecord(record)).toBe(true);
    });

    it('rejects WATCHING, QUALIFIED_CANDIDATE, REJECTED, FILTERED, BLOCKED, LEGACY UNKNOWN', () => {
      const nonTradeables: Array<Partial<SignalLogRecord>> = [
        { isTradeableSignal: false, signalClassification: 'WATCHING' },
        { isTradeableSignal: false, signalClassification: 'QUALIFIED_CANDIDATE' },
        { isTradeableSignal: false, signalClassification: 'REJECTED' },
        { isTradeableSignal: false, signalClassification: 'FILTERED' },
        { isTradeableSignal: false, signalClassification: 'BLOCKED' },
        { isTradeableSignal: false, signalClassification: 'INVALID' },
        { isTradeableSignal: false, signalClassification: 'EXPIRED_BEFORE_ENTRY' },
        { isTradeableSignal: false, signalClassification: 'NON_TRADEABLE' },
        { isTradeableSignal: false, signalClassification: 'ANALYTICS_ONLY' },
        { isTradeableSignal: false, signalClassification: 'DIAGNOSTIC' },
        { isTradeableSignal: false, signalClassification: 'LEGACY UNKNOWN' as any },
        { isTradeableSignal: true, signalClassification: 'REJECTED' },
        { isTradeableSignal: false, signalClassification: 'TRADEABLE' },
        { isTradeableSignal: undefined, signalClassification: undefined },
      ];

      for (const item of nonTradeables) {
        const record = { id: 'x', symbol: 'BTCUSDT', timestamp: Date.now(), ...item } as SignalLogRecord;
        expect(isTradeableLogRecord(record)).toBe(false);
      }
    });
  });

  describe('getLastSignalForSymbol tradeable vs candidate isolation', () => {
    it('returns undefined if only internal candidate signals exist for symbol', async () => {
      const s1 = createSignal({
        symbol: 'BTCUSDT',
        timestamp: 1000,
        isTradeableSignal: false,
        signalClassification: 'WATCHING',
      });
      const s2 = createSignal({
        symbol: 'BTCUSDT',
        timestamp: 2000,
        isTradeableSignal: false,
        signalClassification: 'QUALIFIED_CANDIDATE',
      });
      const s3 = createSignal({
        symbol: 'BTCUSDT',
        timestamp: 3000,
        isTradeableSignal: false,
        signalClassification: 'REJECTED',
      });

      await SignalLogger.logSignal(s1);
      await SignalLogger.logSignal(s2);
      await SignalLogger.logSignal(s3);

      const lastTradeable = SignalLogger.getLastSignalForSymbol('BTCUSDT');
      expect(lastTradeable).toBeUndefined();

      const lastCandidate = SignalLogger.getLastCandidateForSymbol('BTCUSDT');
      expect(lastCandidate).toBeDefined();
      expect(lastCandidate?.signalClassification).toBe('REJECTED');
    });

    it('returns ONLY explicitly tradeable signals when tradeable signals exist', async () => {
      const candidate1 = createSignal({
        id: 'cand_1',
        symbol: 'ETHUSDT',
        timestamp: 1000,
        isTradeableSignal: false,
        signalClassification: 'WATCHING',
      });
      const tradeable1 = createSignal({
        id: 'trad_1',
        symbol: 'ETHUSDT',
        timestamp: 2000,
        isTradeableSignal: true,
        signalClassification: 'TRADEABLE',
      });
      const candidate2 = createSignal({
        id: 'cand_2',
        symbol: 'ETHUSDT',
        timestamp: 3000,
        isTradeableSignal: false,
        signalClassification: 'REJECTED',
      });

      await SignalLogger.logSignal(candidate1);
      await SignalLogger.logSignal(tradeable1);
      await SignalLogger.logSignal(candidate2);

      const last = SignalLogger.getLastSignalForSymbol('ETHUSDT');
      expect(last).toBeDefined();
      expect(last?.id).toBe('trad_1');
      expect(last?.isTradeableSignal).toBe(true);
      expect(last?.signalClassification).toBe('TRADEABLE');
    });

    it('supports retrieving candidate history separately for internal analytics', async () => {
      const cand = createSignal({
        id: 'cand_99',
        symbol: 'SOLUSDT',
        isTradeableSignal: false,
        signalClassification: 'FILTERED',
      });
      await SignalLogger.logSignal(cand);

      const allLogs = await SignalLogger.getAllSignalLogs();
      expect(allLogs.length).toBe(1);
      expect(allLogs[0].id).toBe('cand_99');

      const publicLogs = await SignalLogger.getSignalLogs();
      expect(publicLogs.length).toBe(0);
    });
  });

  describe('Duplicate suppression and cooldown isolation', () => {
    it('prevents candidates (e.g. WATCHING/REJECTED) from triggering duplicate suppression', async () => {
      const watchingSig = createSignal({
        symbol: 'ADAUSDT',
        direction: 'BUY',
        score: 75,
        isTradeableSignal: false,
        signalClassification: 'WATCHING',
      });
      await SignalLogger.logSignal(watchingSig);

      const lastSig = SignalLogger.getLastSignalForSymbol('ADAUSDT');
      expect(lastSig).toBeUndefined(); // Candidate cannot participate in tradeable duplicate suppression
    });
  });
});
