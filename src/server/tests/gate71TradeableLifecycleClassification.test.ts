import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SignalLifecycleManager } from '../signals/SignalLifecycleManager.js';
import { ScannerPersistence, PersistedNotification } from '../signals/ScannerPersistence.js';
import { hourlyScanner } from '../signals/HourlyScanner.js';
import { TradingSignal } from '../../types/index.js';

describe('Gate 71: Tradeable Lifecycle Event Classification', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const createSignal = (overrides: Partial<TradingSignal>): TradingSignal => ({
    id: 'sig_' + Math.random().toString(36).substring(2, 9),
    snapshotId: 'snap_' + Math.random().toString(36).substring(2, 9),
    symbol: 'BTCUSDT',
    direction: 'BUY',
    entryPrice: 50000,
    stopLoss: 49000,
    takeProfit: 52000,
    tp1: 51000,
    tp2: 52000,
    tp3: 53000,
    riskRewardRatio: 2.0,
    score: 80,
    confidenceScore: 80,
    strategy: 'Test Strategy',
    confluenceReasons: ['Confluence 1'],
    timeframe: '1h',
    dataSource: 'Bitget',
    status: 'WAITING_ENTRY',
    timestamp: Date.now(),
    validatedAt: Date.now(),
    isTradeableSignal: true,
    signalClassification: 'TRADEABLE',
    notifiedStates: [],
    ...overrides,
  });

  it('TEST 1: TRADEABLE SIGNAL -> SL_HIT produces SETUP_UPDATE alert (never NO_TRADE) in Alert Log', async () => {
    const recordedNotifications: PersistedNotification[] = [];

    vi.spyOn(ScannerPersistence, 'getSettings').mockReturnValue({
      enabled: true,
      notificationsEnabled: true,
      notifyOnNoTrade: true,
      intervalMinutes: 60,
    });

    vi.spyOn(ScannerPersistence, 'recordNotification').mockImplementation(async (notif) => {
      recordedNotifications.push({
        id: 'notif_1',
        timestamp: Date.now(),
        date: new Date().toISOString().split('T')[0],
        ...notif,
      });
    });

    vi.spyOn(ScannerPersistence, 'updateSignalStatus').mockResolvedValue();

    const sig = createSignal({
      symbol: 'BTCUSDT',
      status: 'ACTIVE',
      isTradeableSignal: true,
      signalClassification: 'TRADEABLE',
    });

    await (SignalLifecycleManager as any).transitionSignalProgressive(
      sig,
      {
        nextState: 'SL_HIT',
        eventTime: Date.now(),
        timeframeUsed: '15m',
      },
      {}
    );

    expect(recordedNotifications.length).toBe(1);
    expect(recordedNotifications[0].type).toBe('SETUP_UPDATE');
    expect(recordedNotifications[0].type).not.toBe('NO_TRADE');
    expect(recordedNotifications[0].title).toContain('STOP LOSS HIT');
    expect(recordedNotifications[0].title).toContain('BTCUSDT');
  });

  it('TEST 2: TRADEABLE SIGNAL -> TP1_HIT produces SETUP_UPDATE alert in Alert Log', async () => {
    const recordedNotifications: PersistedNotification[] = [];

    vi.spyOn(ScannerPersistence, 'getSettings').mockReturnValue({
      enabled: true,
      notificationsEnabled: true,
      notifyOnNoTrade: true,
      intervalMinutes: 60,
    });

    vi.spyOn(ScannerPersistence, 'recordNotification').mockImplementation(async (notif) => {
      recordedNotifications.push({
        id: 'notif_tp1',
        timestamp: Date.now(),
        date: new Date().toISOString().split('T')[0],
        ...notif,
      });
    });

    vi.spyOn(ScannerPersistence, 'updateSignalStatus').mockResolvedValue();

    const sig = createSignal({
      symbol: 'ETHUSDT',
      status: 'ACTIVE',
      isTradeableSignal: true,
      signalClassification: 'TRADEABLE',
    });

    await (SignalLifecycleManager as any).transitionSignalProgressive(
      sig,
      {
        nextState: 'TP1_HIT',
        eventTime: Date.now(),
        timeframeUsed: '15m',
      },
      {}
    );

    expect(recordedNotifications.length).toBe(1);
    expect(recordedNotifications[0].type).toBe('SETUP_UPDATE');
    expect(recordedNotifications[0].title).toContain('TP1 HIT');
    expect(recordedNotifications[0].title).toContain('ETHUSDT');
  });

  it('TEST 3: WATCHING candidate -> produces NO alert on lifecycle step', async () => {
    const recordedNotifications: PersistedNotification[] = [];

    vi.spyOn(ScannerPersistence, 'getSettings').mockReturnValue({
      enabled: true,
      notificationsEnabled: true,
      notifyOnNoTrade: true,
      intervalMinutes: 60,
    });

    vi.spyOn(ScannerPersistence, 'recordNotification').mockImplementation(async (notif) => {
      recordedNotifications.push({
        id: 'notif_watch',
        timestamp: Date.now(),
        date: new Date().toISOString().split('T')[0],
        ...notif,
      });
    });

    vi.spyOn(ScannerPersistence, 'updateSignalStatus').mockResolvedValue();

    const sig = createSignal({
      symbol: 'SOLUSDT',
      status: 'ACTIVE',
      isTradeableSignal: false,
      signalClassification: 'WATCHING',
    });

    await (SignalLifecycleManager as any).transitionSignalProgressive(
      sig,
      {
        nextState: 'SL_HIT',
        eventTime: Date.now(),
        timeframeUsed: '15m',
      },
      {}
    );

    expect(recordedNotifications.length).toBe(0);
  });

  it('TEST 4: QUALIFIED candidate -> produces NO alert on lifecycle step', async () => {
    const recordedNotifications: PersistedNotification[] = [];

    vi.spyOn(ScannerPersistence, 'getSettings').mockReturnValue({
      enabled: true,
      notificationsEnabled: true,
      notifyOnNoTrade: true,
      intervalMinutes: 60,
    });

    vi.spyOn(ScannerPersistence, 'recordNotification').mockImplementation(async (notif) => {
      recordedNotifications.push({
        id: 'notif_qual',
        timestamp: Date.now(),
        date: new Date().toISOString().split('T')[0],
        ...notif,
      });
    });

    vi.spyOn(ScannerPersistence, 'updateSignalStatus').mockResolvedValue();

    const sig = createSignal({
      symbol: 'XRPUSDT',
      status: 'ACTIVE',
      isTradeableSignal: false,
      signalClassification: 'QUALIFIED_CANDIDATE',
    });

    await (SignalLifecycleManager as any).transitionSignalProgressive(
      sig,
      {
        nextState: 'TP1_HIT',
        eventTime: Date.now(),
        timeframeUsed: '15m',
      },
      {}
    );

    expect(recordedNotifications.length).toBe(0);
  });

  it('TEST 5: REJECTED candidate -> produces NO alert on lifecycle step', async () => {
    const recordedNotifications: PersistedNotification[] = [];

    vi.spyOn(ScannerPersistence, 'getSettings').mockReturnValue({
      enabled: true,
      notificationsEnabled: true,
      notifyOnNoTrade: true,
      intervalMinutes: 60,
    });

    vi.spyOn(ScannerPersistence, 'recordNotification').mockImplementation(async (notif) => {
      recordedNotifications.push({
        id: 'notif_rej',
        timestamp: Date.now(),
        date: new Date().toISOString().split('T')[0],
        ...notif,
      });
    });

    vi.spyOn(ScannerPersistence, 'updateSignalStatus').mockResolvedValue();

    const sig = createSignal({
      symbol: 'ADAUSDT',
      status: 'WAITING_ENTRY',
      isTradeableSignal: false,
      signalClassification: 'REJECTED',
    });

    await (SignalLifecycleManager as any).transitionSignalProgressive(
      sig,
      {
        nextState: 'EXPIRED',
        eventTime: Date.now(),
        timeframeUsed: '15m',
      },
      {}
    );

    expect(recordedNotifications.length).toBe(0);
  });

  it('TEST 6: NO_TRADE is preserved ONLY for 0-setup scan completed, and excluded from user-facing Alert Log', async () => {
    const mockNotifications: PersistedNotification[] = [
      {
        id: 'notif_1',
        symbol: 'BTCUSDT',
        type: 'SETUP_UPDATE',
        title: 'BTCUSDT [BUY] - STOP LOSS HIT ❌',
        message: 'Stop-loss triggered for BTCUSDT at 49000.',
        timestamp: Date.now() - 3000,
        date: new Date().toISOString().split('T')[0],
      },
      {
        id: 'notif_2',
        symbol: 'ETHUSDT',
        type: 'SETUP_UPDATE',
        title: 'ETHUSDT [BUY] - TP1 HIT ✅',
        message: 'Conservative Take-Profit level reached for ETHUSDT at 3000.',
        timestamp: Date.now() - 2000,
        date: new Date().toISOString().split('T')[0],
      },
      {
        id: 'notif_3',
        symbol: 'ALL_MARKETS',
        type: 'NO_TRADE',
        title: 'ℹ️ Automated Scan: NO QUALIFIED TRADE',
        message: 'Hourly scan evaluated 15 candidate setups across Crypto. 0 setups passed all mandatory filters.',
        timestamp: Date.now() - 1000,
        date: new Date().toISOString().split('T')[0],
      },
    ];

    vi.spyOn(ScannerPersistence, 'getCapState').mockResolvedValue({
      date: new Date().toISOString().split('T')[0],
      dailySignalCount: 1,
      dailySignalCap: 10,
      lastScanTime: Date.now(),
    });
    vi.spyOn(ScannerPersistence, 'getNotificationHistory').mockResolvedValue(mockNotifications);
    vi.spyOn(ScannerPersistence, 'getSentSignalsToday').mockResolvedValue([]);
    vi.spyOn(ScannerPersistence, 'getRejectedCandidatesToday').mockResolvedValue([]);

    const history = await hourlyScanner.getFullHistory();

    expect(history.notifications.length).toBe(2);
    expect(history.notifications.map((n) => n.title)).toEqual([
      'BTCUSDT [BUY] - STOP LOSS HIT ❌',
      'ETHUSDT [BUY] - TP1 HIT ✅',
    ]);
    expect(history.notifications.map((n) => n.type)).not.toContain('NO_TRADE');
  });

  it('TEST 7: All lifecycle states (ENTRY_CONFIRMED, TP1, TP2, TP3, SL_HIT, STOPPED_OUT, AMBIGUOUS, EXPIRED) use SETUP_UPDATE', async () => {
    const states = [
      'ENTRY_CONFIRMED',
      'TP1_HIT',
      'TP2_HIT',
      'TP3_HIT',
      'SL_HIT',
      'STOPPED_OUT',
      'AMBIGUOUS',
      'EXPIRED',
    ];

    for (const state of states) {
      const recordedNotifications: PersistedNotification[] = [];

      vi.spyOn(ScannerPersistence, 'getSettings').mockReturnValue({
        enabled: true,
        notificationsEnabled: true,
        notifyOnNoTrade: true,
        intervalMinutes: 60,
      });

      vi.spyOn(ScannerPersistence, 'recordNotification').mockImplementation(async (notif) => {
        recordedNotifications.push({
          id: 'notif_' + state,
          timestamp: Date.now(),
          date: new Date().toISOString().split('T')[0],
          ...notif,
        });
      });

      vi.spyOn(ScannerPersistence, 'updateSignalStatus').mockResolvedValue();

      const sig = createSignal({
        symbol: 'BNBUSDT',
        status: 'ACTIVE',
        isTradeableSignal: true,
        signalClassification: 'TRADEABLE',
        notifiedStates: [],
      });

      await (SignalLifecycleManager as any).transitionSignalProgressive(
        sig,
        {
          nextState: state as any,
          eventTime: Date.now(),
          timeframeUsed: '15m',
        },
        {}
      );

      expect(recordedNotifications.length).toBe(1);
      expect(recordedNotifications[0].type).toBe('SETUP_UPDATE');
      expect(recordedNotifications[0].type).not.toBe('NO_TRADE');
    }
  });
});
