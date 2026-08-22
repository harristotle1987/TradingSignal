import { describe, it, expect, vi, beforeEach } from 'vitest';
import { hourlyScanner } from '../signals/HourlyScanner.js';
import { ScannerPersistence, PersistedSentSignal, PersistedNotification } from '../signals/ScannerPersistence.js';

describe('Gate 60/63: Tradeable Signal & Notification History Contract', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const createSentSignal = (overrides: Partial<PersistedSentSignal>): PersistedSentSignal => ({
    id: 'sig_1',
    snapshotId: 'snap_1',
    symbol: 'BTCUSDT',
    direction: 'BUY',
    entryPrice: 50000,
    stopLoss: 49000,
    takeProfit: 52000,
    riskRewardRatio: 2.0,
    score: 85,
    rankTier: 'BEST_TRADE',
    strategy: 'TrendFollow',
    timeframe: '1h',
    dataSource: 'Bitget',
    status: 'WAITING_ENTRY',
    notificationSent: true,
    notificationTimestamp: Date.now(),
    timestamp: Date.now(),
    date: '2026-08-22',
    ...overrides,
  });

  it('correctly filters signals based on explicit tradeability contract', async () => {
    const mockSentSignals: PersistedSentSignal[] = [
      // 1. TRADEABLE + TRADEABLE -> VISIBLE
      createSentSignal({
        id: 'visible_tradeable',
        symbol: 'BTCUSDT',
        isTradeableSignal: true,
        signalClassification: 'TRADEABLE',
      }),
      // 2. WATCHING -> HIDDEN
      createSentSignal({
        id: 'hidden_watching',
        symbol: 'ETHUSDT',
        isTradeableSignal: false,
        signalClassification: 'WATCHING',
      }),
      // 3. QUALIFIED_CANDIDATE -> HIDDEN
      createSentSignal({
        id: 'hidden_qualified_candidate',
        symbol: 'SOLUSDT',
        isTradeableSignal: false,
        signalClassification: 'QUALIFIED_CANDIDATE',
      }),
      // 4. REJECTED -> HIDDEN
      createSentSignal({
        id: 'hidden_rejected',
        symbol: 'ADAUSDT',
        isTradeableSignal: false,
        signalClassification: 'REJECTED',
      }),
      // 5. FILTERED -> HIDDEN
      createSentSignal({
        id: 'hidden_filtered',
        symbol: 'XRPUSDT',
        isTradeableSignal: false,
        signalClassification: 'FILTERED',
      }),
      // 6. undefined classification -> HIDDEN
      createSentSignal({
        id: 'hidden_undefined_classification',
        symbol: 'BNBUSDT',
        isTradeableSignal: true,
        signalClassification: undefined,
      }),
      // 7. isTradeableSignal=false -> HIDDEN
      createSentSignal({
        id: 'hidden_tradeable_false',
        symbol: 'DOGEUSDT',
        isTradeableSignal: false,
        signalClassification: 'WATCHING',
      }),
      // 8. isTradeableSignal=true + classification != TRADEABLE -> HIDDEN
      createSentSignal({
        id: 'hidden_true_but_candidate',
        symbol: 'AVAXUSDT',
        isTradeableSignal: true,
        signalClassification: 'CANDIDATE',
      }),
      // 9. isTradeableSignal=false + classification=TRADEABLE -> HIDDEN
      createSentSignal({
        id: 'hidden_false_with_tradeable_class',
        symbol: 'LINKUSDT',
        isTradeableSignal: false,
        signalClassification: 'TRADEABLE',
      }),
      // 10. legacy undefined isTradeableSignal & undefined classification -> HIDDEN
      createSentSignal({
        id: 'hidden_legacy_undefined',
        symbol: 'DOTUSDT',
        isTradeableSignal: undefined,
        signalClassification: undefined,
      }),
    ];

    const mockNotifications: PersistedNotification[] = [
      {
        id: 'notif_1',
        symbol: 'BTCUSDT',
        type: 'BEST_TRADE',
        title: 'Best Trade Triggered',
        message: 'BTCUSDT Buy Signal',
        timestamp: Date.now(),
        date: '2026-08-22',
      },
      {
        id: 'notif_2',
        symbol: 'ETHUSDT',
        type: 'HIGH_QUALITY',
        title: 'High Quality Setup',
        message: 'ETHUSDT Buy Signal',
        timestamp: Date.now(),
        date: '2026-08-22',
      },
      {
        id: 'notif_3',
        symbol: 'ALL_MARKETS',
        type: 'NO_TRADE',
        title: 'No Trade Found',
        message: 'Scan completed with no qualifying setups',
        timestamp: Date.now(),
        date: '2026-08-22',
      },
      {
        id: 'notif_4',
        symbol: 'BTCUSDT',
        type: 'SETUP_UPDATE',
        title: 'Setup Update',
        message: 'TP1 Hit on BTCUSDT',
        timestamp: Date.now(),
        date: '2026-08-22',
      },
    ];

    vi.spyOn(ScannerPersistence, 'getCapState').mockResolvedValue({
      date: '2026-08-22',
      dailySignalCount: 1,
      dailySignalCap: 10,
      lastScanTime: Date.now(),
    });
    vi.spyOn(ScannerPersistence, 'getNotificationHistory').mockResolvedValue(mockNotifications);
    vi.spyOn(ScannerPersistence, 'getSentSignalsToday').mockResolvedValue(mockSentSignals);
    vi.spyOn(ScannerPersistence, 'getRejectedCandidatesToday').mockResolvedValue([]);

    const history = await hourlyScanner.getFullHistory();

    // STRICT CONTRACT ASSERTIONS:
    // Only 'visible_tradeable' (isTradeableSignal === true && signalClassification === 'TRADEABLE') must be visible
    expect(history.sentSignalsToday.length).toBe(1);
    expect(history.sentSignalsToday[0].id).toBe('visible_tradeable');
    expect(history.sentSignalsToday[0].symbol).toBe('BTCUSDT');
    expect(history.sentSignalsToday[0].isTradeableSignal).toBe(true);
    expect(history.sentSignalsToday[0].signalClassification).toBe('TRADEABLE');

    // Assert all hidden IDs are not in the result
    const returnedIds = history.sentSignalsToday.map(s => s.id);
    expect(returnedIds).not.toContain('hidden_watching');
    expect(returnedIds).not.toContain('hidden_qualified_candidate');
    expect(returnedIds).not.toContain('hidden_rejected');
    expect(returnedIds).not.toContain('hidden_filtered');
    expect(returnedIds).not.toContain('hidden_undefined_classification');
    expect(returnedIds).not.toContain('hidden_tradeable_false');
    expect(returnedIds).not.toContain('hidden_true_but_candidate');
    expect(returnedIds).not.toContain('hidden_false_with_tradeable_class');
    expect(returnedIds).not.toContain('hidden_legacy_undefined');

    // Notification types match actual PersistedNotification type values
    // GATE 64: NO_TRADE is excluded from user-facing tradeable alert log notifications
    expect(history.notifications.length).toBe(3);
    expect(history.notifications.map(n => n.type)).toEqual([
      'BEST_TRADE',
      'HIGH_QUALITY',
      'SETUP_UPDATE',
    ]);
    expect(history.notifications.map(n => n.type)).not.toContain('NO_TRADE');
  });
});
