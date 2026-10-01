import { logger } from './logger.js';
import { ScannerPersistence, DailyCapState } from './signals/ScannerPersistence.js';
import { getNeonPool } from './infrastructure/neon/db.js';

let mockDb: any = undefined;

/**
 * Allows tests to mock persistence availability (e.g. simulate outage/unavailability).
 */
export function setMockFirestoreAdmin(mock: any): void {
  mockDb = mock;
}

/**
 * Checks if production persistence requirements are met.
 * For NODE_ENV=production, DATABASE_URL is REQUIRED.
 */
export function isProductionPersistenceReady(): boolean {
  if (mockDb !== undefined) {
    return mockDb !== null;
  }
  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    return true; // Local persistence allowed in development/testing
  }
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl || dbUrl.trim().length === 0) {
    return false;
  }
  return getNeonPool() !== null;
}

/**
 * Legacy stub for Firestore Admin instance (Disabled for production - Neon PostgreSQL is single source).
 */
export function getFirestoreAdmin(): any {
  return mockDb;
}

export type CapState = DailyCapState;

/**
 * Retrieves and/or updates/initializes cap state in Firestore / durable persistence.
 * Handles automated rollover when the date changes.
 */
export async function getOrInitializeCapState(defaultCap = 5): Promise<CapState> {
  return await ScannerPersistence.getCapState(defaultCap);
}

/**
 * Atomic transaction to verify cap and increment the counter if allowed.
 * Returns whether the increment was successful and the updated count.
 */
export async function tryIncrementCapCount(defaultCap = 5): Promise<{ allowed: boolean; count: number; cap: number }> {
  return await ScannerPersistence.tryIncrementCap(defaultCap);
}

/**
 * Resets only the current day's automated signal cap counter to 0.
 */
export async function resetDailyCapCount(): Promise<CapState> {
  return await ScannerPersistence.resetDailyCapCount();
}


