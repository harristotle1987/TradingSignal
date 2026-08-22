import { describe, it, expect, vi, beforeEach } from 'vitest';
import { hourlyScanner } from '../signals/HourlyScanner.js';
import { ScannerPersistence, PersistedNotification } from '../signals/ScannerPersistence.js';

describe('Gate 64: Remove NO_TRADE from Tradeable Alert Log', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('excludes NO_TRADE notifications from getFullHistory() user-facing alert log', async () => {
    const mockNotifications: PersistedNotification[] = [
      {
        id: 'n_best',
        symbol: 'BTCUSDT',
        type: 'BEST_TRADE',
        title: 'Best Trade Triggered',
        message: 'BTCUSDT BUY Signal',
        timestamp: Date.now() - 3000,
        date: '2026-08-22',
      },
      {
        id: 'n_notrade_1',
        symbol: 'ALL_MARKETS',
        type: 'NO_TRADE',
        title: 'No Trade Opportunities',
        message: 'Market conditions do not meet qualification thresholds',
        timestamp: Date.now() - 2000,
        date: '2026-08-22',
      },
      {
        id: 'n_high_quality',
        symbol: 'ETHUSDT',
        type: 'HIGH_QUALITY',
        title: 'High Quality Setup',
        message: 'ETHUSDT BUY Signal',
        timestamp: Date.now() - 1500,
        date: '2026-08-22',
      },
      {
        id: 'n_notrade_2',
        symbol: 'FOREX',
        type: 'NO_TRADE',
        title: 'No Trade Opportunities in Forex',
        message: 'No qualifying forex setups in this scan cycle',
        timestamp: Date.now() - 1000,
        date: '2026-08-22',
      },
      {
        id: 'n_lifecycle',
        symbol: 'BTCUSDT',
        type: 'SETUP_UPDATE',
        title: 'Setup Update: TP1 Hit',
        message: 'Target 1 reached on BTCUSDT',
        timestamp: Date.now() - 500,
        date: '2026-08-22',
      },
    ];

    vi.spyOn(ScannerPersistence, 'getCapState').mockResolvedValue({
      date: '2026-08-22',
      dailySignalCount: 2,
      dailySignalCap: 10,
      lastScanTime: Date.now(),
    });
    vi.spyOn(ScannerPersistence, 'getNotificationHistory').mockResolvedValue(mockNotifications);
    vi.spyOn(ScannerPersistence, 'getSentSignalsToday').mockResolvedValue([]);
    vi.spyOn(ScannerPersistence, 'getRejectedCandidatesToday').mockResolvedValue([]);

    const history = await hourlyScanner.getFullHistory();

    // 1. Assert NO_TRADE notifications are stripped from the returned alert log
    expect(history.notifications.length).toBe(3);
    const notificationTypes = history.notifications.map(n => n.type);
    expect(notificationTypes).not.toContain('NO_TRADE');
    expect(notificationTypes).toEqual(['BEST_TRADE', 'HIGH_QUALITY', 'SETUP_UPDATE']);

    const notificationIds = history.notifications.map(n => n.id);
    expect(notificationIds).toContain('n_best');
    expect(notificationIds).toContain('n_high_quality');
    expect(notificationIds).toContain('n_lifecycle');
    expect(notificationIds).not.toContain('n_notrade_1');
    expect(notificationIds).not.toContain('n_notrade_2');
  });

  it('keeps NO_TRADE events available in persistence storage for telemetry/diagnostics', async () => {
    // Verify that ScannerPersistence stores NO_TRADE correctly without throwing or corrupting
    ScannerPersistence.init();
    await ScannerPersistence.recordNotification({
      symbol: 'ALL_MARKETS',
      type: 'NO_TRADE',
      title: 'Telemetry No Trade Log',
      message: 'System status telemetry recorded',
    });

    const stored = await ScannerPersistence.getNotificationHistory(50);
    const noTradeEntries = stored.filter(n => n.type === 'NO_TRADE');
    expect(noTradeEntries.length).toBeGreaterThan(0);
    expect(noTradeEntries.some(n => n.title === 'Telemetry No Trade Log')).toBe(true);
  });
});
