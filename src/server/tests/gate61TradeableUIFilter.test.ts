import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SignalLogger, SignalLogRecord } from '../signals/SignalLogger.js';
import { TradingSignal } from '../../types/index.js';
import { ScannerPersistence } from '../signals/ScannerPersistence.js';
import { SignalLifecycleManager } from '../signals/SignalLifecycleManager.js';

describe('Gate 61: Tradeable-Only Signal History', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    (SignalLogger as any).isInitialized = true;
    (SignalLogger as any).lastFirestoreSync = Date.now() + 1000000;
    (SignalLogger as any).logs.clear();
    vi.spyOn(SignalLogger as any, 'syncFromFirestore').mockResolvedValue(undefined);
    vi.spyOn(SignalLogger as any, 'flushToDisk').mockImplementation(() => {});
    vi.spyOn(SignalLogger as any, 'syncToFirestore').mockImplementation(() => {});
  });

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
    dataSource: 'Binance',
    status: 'WAITING_ENTRY',
    timestamp: Date.now(),
    validatedAt: Date.now(),
    ...overrides,
  });

  it('TEST 1: TRADEABLE signal appears in getSignalLogs', async () => {
    const sig = createSignal({ isTradeableSignal: true, signalClassification: 'TRADEABLE' });
    await SignalLogger.logSignal(sig);
    const logs = await SignalLogger.getSignalLogs();
    expect(logs.length).toBe(1);
    expect(logs[0].id).toBe('test_123');
  });

  it('TEST 2 & 3: WATCHING and QUALIFIED_CANDIDATE signals do not appear', async () => {
    const s1 = createSignal({ id: 's1', isTradeableSignal: false, signalClassification: 'WATCHING' });
    const s2 = createSignal({ id: 's2', isTradeableSignal: false, signalClassification: 'QUALIFIED_CANDIDATE' });
    await SignalLogger.logSignal(s1);
    await SignalLogger.logSignal(s2);
    const logs = await SignalLogger.getSignalLogs();
    expect(logs.length).toBe(0);
  });

  it('TEST 4, 5, 6: REJECTED, FILTERED, BLOCKED do not appear', async () => {
    const s1 = createSignal({ id: 's1', isTradeableSignal: false, signalClassification: 'REJECTED' });
    const s2 = createSignal({ id: 's2', isTradeableSignal: false, signalClassification: 'FILTERED' });
    const s3 = createSignal({ id: 's3', isTradeableSignal: false, signalClassification: 'BLOCKED' });
    await SignalLogger.logSignal(s1);
    await SignalLogger.logSignal(s2);
    await SignalLogger.logSignal(s3);
    const logs = await SignalLogger.getSignalLogs();
    expect(logs.length).toBe(0);
  });

  it('TEST 7: signalClassification undefined does not appear (Legacy block)', async () => {
    const s1 = createSignal({ id: 's1' }); // undefined
    await SignalLogger.logSignal(s1);
    const logs = await SignalLogger.getSignalLogs();
    expect(logs.length).toBe(0);
  });

  it('TEST 8 & 9: Mismatched tradeable fields do not appear', async () => {
    const s1 = createSignal({ id: 's1', isTradeableSignal: true, signalClassification: 'REJECTED' });
    const s2 = createSignal({ id: 's2', isTradeableSignal: false, signalClassification: 'TRADEABLE' });
    await SignalLogger.logSignal(s1);
    await SignalLogger.logSignal(s2);
    const logs = await SignalLogger.getSignalLogs();
    expect(logs.length).toBe(0);
  });

  it('TEST 10 & 11: WAITING_ENTRY and ACTIVE with TRADEABLE appear', async () => {
    const s1 = createSignal({ id: 's1', status: 'WAITING_ENTRY', isTradeableSignal: true, signalClassification: 'TRADEABLE' });
    const s2 = createSignal({ id: 's2', status: 'ACTIVE', isTradeableSignal: true, signalClassification: 'TRADEABLE' });
    await SignalLogger.logSignal(s1);
    await SignalLogger.logSignal(s2);
    const logs = await SignalLogger.getSignalLogs();
    expect(logs.length).toBe(2);
  });

  it('TEST 12 & 13: TP1_HIT and SL_HIT with TRADEABLE appear', async () => {
    const s1 = createSignal({ id: 's1', status: 'TP1_HIT', isTradeableSignal: true, signalClassification: 'TRADEABLE' });
    const s2 = createSignal({ id: 's2', status: 'SL_HIT', isTradeableSignal: true, signalClassification: 'TRADEABLE' });
    await SignalLogger.logSignal(s1);
    await SignalLogger.logSignal(s2);
    const logs = await SignalLogger.getSignalLogs();
    expect(logs.length).toBe(2);
  });

  it('TEST 14: Lifecycle update for non-tradeable parent produces no user-facing alert', async () => {
    vi.spyOn(ScannerPersistence, 'recordNotification').mockResolvedValue();
    vi.spyOn(ScannerPersistence, 'updateSignalStatus').mockResolvedValue();
    vi.spyOn(ScannerPersistence, 'getSettings').mockReturnValue({
       enabled: true, notificationsEnabled: true, notifyOnNoTrade: false, intervalMinutes: 60
    });
    const sig = createSignal({ id: 's1', status: 'ACTIVE', isTradeableSignal: false, signalClassification: 'WATCHING' });
    
    // Call the internal progressive state transition
    await (SignalLifecycleManager as any).transitionSignalProgressive(
       sig,
       {
         eventTime: Date.now(),
         nextState: 'TP1_HIT',
         isRecovered: false,
         timeframeUsed: '1h'
       },
       {}
    );
    
    expect(ScannerPersistence.recordNotification).not.toHaveBeenCalled();
  });

});
