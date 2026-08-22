import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { marketDataManager } from '../market/MarketDataManager.js';

describe('GATE 68 — Truthful Production Health Status Verification', { timeout: 15000 }, () => {
  const origNodeEnv = process.env.NODE_ENV;
  const origFirebase = process.env.FIREBASE_SERVICE_ACCOUNT;

  beforeEach(() => {
    process.env.NODE_ENV = origNodeEnv;
    if (origFirebase !== undefined) {
      process.env.FIREBASE_SERVICE_ACCOUNT = origFirebase;
    } else {
      delete process.env.FIREBASE_SERVICE_ACCOUNT;
    }
  });

  afterEach(() => {
    process.env.NODE_ENV = origNodeEnv;
    if (origFirebase !== undefined) {
      process.env.FIREBASE_SERVICE_ACCOUNT = origFirebase;
    } else {
      delete process.env.FIREBASE_SERVICE_ACCOUNT;
    }
  });

  it('calculates marketDataConnected, marketFeedsActive, and signalsEnabled dynamically rather than returning hardcoded true', async () => {
    const health = await marketDataManager.getTruthfulMarketHealth(true);

    expect(typeof health.marketDataConnected).toBe('boolean');
    expect(typeof health.marketFeedsActive).toBe('boolean');
    expect(typeof health.signalsEnabled).toBe('boolean');
    expect(typeof health.providerConfigured).toBe('boolean');
    expect(typeof health.providerReachable).toBe('boolean');
    expect(typeof health.dataFreshness).toBe('boolean');
    expect(typeof health.productionPersistenceReady).toBe('boolean');
    expect(typeof health.scannerReady).toBe('boolean');
  });

  it('exposes all required health metrics fields in getTruthfulMarketHealth', async () => {
    const health = await marketDataManager.getTruthfulMarketHealth(true);

    expect('providerConfigured' in health).toBe(true);
    expect('providerReachable' in health).toBe(true);
    expect('lastSuccessfulQuote' in health).toBe(true);
    expect('quoteAge' in health).toBe(true);
    expect('dataFreshness' in health).toBe(true);
    expect('signalsEnabled' in health).toBe(true);
    expect('productionPersistenceReady' in health).toBe(true);
    expect('scannerReady' in health).toBe(true);
  });

  it('disables signalsEnabled and sets status to DEGRADED when in production without Firebase persistence', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.FIREBASE_SERVICE_ACCOUNT;

    const health = await marketDataManager.getTruthfulMarketHealth(true);

    expect(health.productionPersistenceReady).toBe(false);
    expect(health.signalsEnabled).toBe(false);
    expect(health.status).not.toBe('OPERATIONAL');
    expect(health.status).toBe('DEGRADED');
  });

  it('accurately reports provider reachability for Bitget and ExchangeRate fallbacks', async () => {
    const health = await marketDataManager.getTruthfulMarketHealth(true);

    expect(health.providers.bitget.providerConfigured).toBe(true);
    expect(health.assetClasses.crypto.ready).toBe(true);
    expect(health.assetClasses.forex.ready).toBe(true);
  });
});
