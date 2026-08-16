import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, Firestore } from 'firebase-admin/firestore';
import { logger } from './logger.js';

let db: Firestore | null = null;

/**
 * Returns the Firestore admin instance.
 * Initializes Firebase Admin lazily if process.env.FIREBASE_SERVICE_ACCOUNT is available.
 * Handles missing credentials gracefully without crashing the server.
 */
export function getFirestoreAdmin(): Firestore | null {
  if (db) return db;

  const saJson = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!saJson) {
    logger.info('[Firebase Admin] FIREBASE_SERVICE_ACCOUNT environment variable is not defined. Falling back to local state.');
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

export interface CapState {
  dailySignalCount: number;
  dailySignalCap: number;
  date: string;
}

const CAP_DOC_PATH = 'scanner/cap_state';

/**
 * Atomic transaction to retrieve and/or update/initialize cap state in Firestore.
 * Handles automated rollover when the date changes.
 */
export async function getOrInitializeCapState(defaultCap = 5): Promise<CapState> {
  const firestore = getFirestoreAdmin();
  const today = new Date().toISOString().split('T')[0];

  if (!firestore) {
    // If Firebase is not configured, we return a fallback state that won't break things
    return {
      dailySignalCount: 0,
      dailySignalCap: defaultCap,
      date: today,
    };
  }

  const docRef = firestore.doc(CAP_DOC_PATH);

  try {
    const state = await firestore.runTransaction(async (transaction) => {
      const docSnapshot = await transaction.get(docRef);
      
      if (!docSnapshot.exists) {
        const initialState: CapState = {
          dailySignalCount: 0,
          dailySignalCap: defaultCap,
          date: today,
        };
        transaction.set(docRef, initialState);
        return initialState;
      }

      const data = docSnapshot.data() as CapState;
      
      // Automatic date reset check
      if (data.date !== today) {
        const resetState: CapState = {
          dailySignalCount: 0,
          dailySignalCap: data.dailySignalCap || defaultCap,
          date: today,
        };
        transaction.set(docRef, resetState);
        return resetState;
      }

      return data;
    });

    return state;
  } catch (err: unknown) {
    logger.error('[Firebase Admin] Failed in getOrInitializeCapState transaction:', { error: err instanceof Error ? err.message : String(err) });
    return {
      dailySignalCount: 0,
      dailySignalCap: defaultCap,
      date: today,
    };
  }
}

/**
 * Atomic transaction to verify cap and increment the counter if allowed.
 * Returns whether the increment was successful and the updated count.
 */
export async function tryIncrementCapCount(defaultCap = 5): Promise<{ allowed: boolean; count: number; cap: number }> {
  const firestore = getFirestoreAdmin();
  const today = new Date().toISOString().split('T')[0];

  if (!firestore) {
    // Local memory fallback logic if Firebase is not active
    return { allowed: true, count: 0, cap: defaultCap };
  }

  const docRef = firestore.doc(CAP_DOC_PATH);

  try {
    const result = await firestore.runTransaction(async (transaction) => {
      const docSnapshot = await transaction.get(docRef);
      let data: CapState;

      if (!docSnapshot.exists) {
        data = {
          dailySignalCount: 0,
          dailySignalCap: defaultCap,
          date: today,
        };
      } else {
        data = docSnapshot.data() as CapState;
        // Rollover if date changes
        if (data.date !== today) {
          data = {
            dailySignalCount: 0,
            dailySignalCap: data.dailySignalCap || defaultCap,
            date: today,
          };
        }
      }

      const limit = data.dailySignalCap || defaultCap;

      if (data.dailySignalCount >= limit) {
        return { allowed: false, count: data.dailySignalCount, cap: limit };
      }

      const newCount = data.dailySignalCount + 1;
      const updatedState: CapState = {
        dailySignalCount: newCount,
        dailySignalCap: limit,
        date: today,
      };

      transaction.set(docRef, updatedState);
      return { allowed: true, count: newCount, cap: limit };
    });

    return result;
  } catch (err: unknown) {
    logger.error('[Firebase Admin] Error in tryIncrementCapCount transaction:', { error: err instanceof Error ? err.message : String(err) });
    return { allowed: false, count: 999, cap: defaultCap };
  }
}
