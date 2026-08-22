import { describe, it, expect, vi } from 'vitest';

describe('GATE 53 — Daily Cap Single Source of Truth', () => {
  it('1. Verifies that the dailySignalCap default is consistently 5 across config, Gate36, and ScannerPersistence when no environment override is present', async () => {
    // Save original env
    const originalEnv = process.env.THRESHOLD_DAILY_SIGNAL_CAP;
    delete process.env.THRESHOLD_DAILY_SIGNAL_CAP;

    // Reset modules to test defaults
    vi.resetModules();
    const { serverConfig } = await import('../config.js');
    const { Gate36ConfigurableSignalFrequency } = await import('../signals/Gate36ConfigurableSignalFrequency.js');
    const { ScannerPersistence } = await import('../signals/ScannerPersistence.js');

    const cfg = serverConfig.getConfig();
    expect(cfg.thresholds.dailySignalCap).toBe(5);

    const freqConfig = Gate36ConfigurableSignalFrequency.getConfig();
    expect(freqConfig.dailySignalCap).toBe(5);
    expect(freqConfig.preset).toBe('5');

    // Restore original env
    if (originalEnv !== undefined) {
      process.env.THRESHOLD_DAILY_SIGNAL_CAP = originalEnv;
    }
  });
});
