import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isProductionPersistenceReady } from '../firebaseAdmin.js';
import { ScannerPersistence } from '../signals/ScannerPersistence.js';
import { serverConfig } from '../config.js';

describe('GATE 67 — PRODUCTION PERSISTENCE REQUIREMENT', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalSa = process.env.FIREBASE_SERVICE_ACCOUNT;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalSa !== undefined) {
      process.env.FIREBASE_SERVICE_ACCOUNT = originalSa;
    } else {
      delete process.env.FIREBASE_SERVICE_ACCOUNT;
    }
  });

  it('reports isProductionPersistenceReady = false when NODE_ENV=production and FIREBASE_SERVICE_ACCOUNT is missing', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.FIREBASE_SERVICE_ACCOUNT;

    expect(isProductionPersistenceReady()).toBe(false);
    expect(serverConfig.getConfig().productionPersistenceReady).toBe(false);
  });

  it('reports isProductionPersistenceReady = true when NODE_ENV=development even if FIREBASE_SERVICE_ACCOUNT is missing', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.FIREBASE_SERVICE_ACCOUNT;

    expect(isProductionPersistenceReady()).toBe(true);
    expect(serverConfig.getConfig().productionPersistenceReady).toBe(true);
  });

  it('fails closed for daily cap increment when NODE_ENV=production and Firebase is unavailable', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.FIREBASE_SERVICE_ACCOUNT;

    const result = await ScannerPersistence.tryIncrementCap(10);
    expect(result.allowed).toBe(false);
    expect(result.count).toBe(0);
  });

  it('fails closed for concurrency lock acquisition when NODE_ENV=production and Firebase is unavailable', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.FIREBASE_SERVICE_ACCOUNT;

    const lock = await ScannerPersistence.tryAcquireLock('test_instance_prod');
    expect(lock.acquired).toBe(false);
    expect(lock.reason).toContain('FAIL CLOSED');
  });

  it('fails closed for reading sent signals when NODE_ENV=production and Firebase is unavailable', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.FIREBASE_SERVICE_ACCOUNT;

    const signals = await ScannerPersistence.getSentSignalsToday();
    expect(signals).toEqual([]);
  });
});
