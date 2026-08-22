import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, Firestore } from 'firebase-admin/firestore';
import { logger } from './logger.js';
import { ScannerPersistence, DailyCapState } from './signals/ScannerPersistence.js';

let db: Firestore | null = null;

/**
 * Checks if production persistence requirements are met.
 * For NODE_ENV=production, FIREBASE_SERVICE_ACCOUNT is REQUIRED.
 */
export function isProductionPersistenceReady(): boolean {
  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    return true; // Local persistence allowed in development/testing
  }
  const saJson = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!saJson || saJson.trim().length === 0) {
    return false;
  }
  const firestore = getFirestoreAdmin();
  return firestore !== null;
}

/**
 * Returns the Firestore admin instance.
 * Initializes Firebase Admin lazily if process.env.FIREBASE_SERVICE_ACCOUNT is available.
 * Handles missing credentials gracefully without crashing the server.
 */
export function getFirestoreAdmin(): Firestore | null {
  if (db) return db;

  const saJson = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!saJson) {
    return null;
  }

  try {
    const serviceAccount = JSON.parse(saJson);
    if (serviceAccount.private_key) {
      serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
    }

    // Initialize with a unique name or check if already initialized
    const apps = getApps();
    if (apps.length === 0) {
      initializeApp({
        credential: cert(serviceAccount),
      });
      logger.info('[Firebase Admin] Successfully initialized Firebase Admin.');
    }

    db = getFirestore();
    return db;
  } catch (err: unknown) {
    logger.warn('[Firebase Admin] Initialization failed:', { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
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


