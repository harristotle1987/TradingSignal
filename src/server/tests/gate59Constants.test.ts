import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TP1_ALLOCATION, TP2_ALLOCATION, TP3_ALLOCATION, HISTORICAL_ENTRY_POLICY, serverConfig } from '../config.js';

describe('Gate 59: Hardcoded Constants', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('verifies that TP allocations sum exactly to 1.0', () => {
    expect(TP1_ALLOCATION + TP2_ALLOCATION + TP3_ALLOCATION).toBeCloseTo(1.0, 5);
  });

  it('verifies TP1_ALLOCATION is exactly 0.40', () => {
    expect(TP1_ALLOCATION).toBe(0.40);
  });

  it('verifies TP2_ALLOCATION is exactly 0.30', () => {
    expect(TP2_ALLOCATION).toBe(0.30);
  });

  it('verifies TP3_ALLOCATION is exactly 0.30', () => {
    expect(TP3_ALLOCATION).toBe(0.30);
  });

  it('verifies HISTORICAL_ENTRY_POLICY is exactly CONSERVATIVE', () => {
    expect(HISTORICAL_ENTRY_POLICY).toBe('CONSERVATIVE');
  });

  it('verifies environment variables do not override the constants in config thresholds', async () => {
    process.env.TP1_ALLOCATION = '0.90';
    process.env.TP2_ALLOCATION = '0.05';
    process.env.TP3_ALLOCATION = '0.05';
    process.env.HISTORICAL_ENTRY_POLICY = 'UNVERIFIABLE';
    
    // Dynamically re-import config to check if it reacts to process.env
    const configModule = await import('../config.js?test=' + Date.now());
    
    expect(configModule.TP1_ALLOCATION).toBe(0.40);
    expect(configModule.TP2_ALLOCATION).toBe(0.30);
    expect(configModule.TP3_ALLOCATION).toBe(0.30);
    expect(configModule.HISTORICAL_ENTRY_POLICY).toBe('CONSERVATIVE');

    // Also check the serverConfig thresholds to ensure they are NOT in there
    const thresholds = configModule.serverConfig.getThresholds();
    expect((thresholds as any).tp1Allocation).toBeUndefined();
    expect((thresholds as any).historicalEntryPolicy).toBeUndefined();
  });
});
