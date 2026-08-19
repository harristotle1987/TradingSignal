import * as fs from 'fs';
import * as path from 'path';
import { getFirestoreAdmin } from '../firebaseAdmin.js';
import { logger } from '../logger.js';

export interface SignalOutcomeRecord {
  id: string; // unique signal ID
  symbol: string; // asset
  direction: 'BUY' | 'SELL';
  provider: string; // provider e.g. bitget, twelvedata, finnhub
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  tp1: number;
  tp2: number;
  tp3: number;
  tp1HitTimestamp?: number;
  tp2HitTimestamp?: number;
  tp3HitTimestamp?: number;
  slHitTimestamp?: number;
  entryHitTimestamp?: string | null;
  expiredTimestamp?: number;
  finalOutcome?: 'TP1_HIT' | 'TP2_HIT' | 'TP3_HIT' | 'SL_HIT' | 'EXPIRED' | 'AMBIGUOUS';
  status: 'ACTIVE' | 'TP1_HIT' | 'TP2_HIT' | 'TP3_HIT' | 'SL_HIT' | 'EXPIRED' | 'AMBIGUOUS';
  timestamp: number; // creation timestamp
  updatedAt: number; // last updated timestamp
  detectedAt?: number;
  eventTime?: number;
  eventSource?: 'HISTORICAL_BACKFILL' | 'LIVE_STREAM' | 'TICK_EVALUATION';
  timeframeUsed?: string;
  isRecovered?: boolean;
  ambiguousDetails?: string;
}

const LOCAL_OUTCOME_LOG_PATH = path.join(process.cwd(), 'signal_outcome_logs.json');
const FIRESTORE_OUTCOME_COL = 'signal_outcome_logs';

export class SignalOutcomeLogger {
  private static localLogs: Map<string, SignalOutcomeRecord> = new Map();
  private static isInitialized = false;

  private static init(): void {
    if (this.isInitialized) return;

    try {
      if (fs.existsSync(LOCAL_OUTCOME_LOG_PATH)) {
        const raw = fs.readFileSync(LOCAL_OUTCOME_LOG_PATH, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            this.localLogs.set(item.id, item);
          }
        }
        logger.info('[SignalOutcomeLogger] Loaded persisted outcome logs from disk.');
      }
    } catch (err) {
      logger.warn('[SignalOutcomeLogger] Failed to read local outcome logs:', { error: String(err) });
    }
    this.isInitialized = true;
  }

  private static saveLocal(): void {
    try {
      const records = Array.from(this.localLogs.values()).sort((a, b) => b.updatedAt - a.updatedAt);
      // Limit local outcomes to last 200 items
      const limited = records.slice(0, 200);
      fs.writeFileSync(LOCAL_OUTCOME_LOG_PATH, JSON.stringify(limited, null, 2), 'utf-8');
    } catch (err) {
      logger.warn('[SignalOutcomeLogger] Failed to write local outcome logs:', { error: String(err) });
    }
  }

  /**
   * Records a new outcome log entry or updates an existing one
   */
  public static async recordOutcome(record: SignalOutcomeRecord): Promise<void> {
    this.init();
    this.localLogs.set(record.id, record);
    this.saveLocal();

    const firestore = getFirestoreAdmin();
    if (firestore) {
      try {
        await firestore.collection(FIRESTORE_OUTCOME_COL).doc(record.id).set(record);
      } catch (err) {
        logger.warn('[SignalOutcomeLogger] Firestore failed to save record:', { error: String(err) });
      }
    }
  }

  /**
   * Retrieves an outcome log entry by ID
   */
  public static async getOutcome(id: string): Promise<SignalOutcomeRecord | null> {
    this.init();
    const local = this.localLogs.get(id);
    if (local) return local;

    const firestore = getFirestoreAdmin();
    if (firestore) {
      try {
        const doc = await firestore.collection(FIRESTORE_OUTCOME_COL).doc(id).get();
        if (doc.exists) {
          const remote = doc.data() as SignalOutcomeRecord;
          this.localLogs.set(id, remote);
          return remote;
        }
      } catch (err) {
        logger.warn('[SignalOutcomeLogger] Firestore failed to get record:', { error: String(err) });
      }
    }
    return null;
  }

  /**
   * Retrieves all outcome logs
   */
  public static async getOutcomeLogs(limit = 100): Promise<SignalOutcomeRecord[]> {
    this.init();
    const firestore = getFirestoreAdmin();
    if (firestore) {
      try {
        const query = await firestore
          .collection(FIRESTORE_OUTCOME_COL)
          .orderBy('updatedAt', 'desc')
          .limit(limit)
          .get();
        
        if (!query.empty) {
          const records: SignalOutcomeRecord[] = [];
          query.forEach((doc) => records.push(doc.data() as SignalOutcomeRecord));
          
          // Merge
          for (const item of records) {
            this.localLogs.set(item.id, item);
          }
          return records;
        }
      } catch (err) {
        logger.warn('[SignalOutcomeLogger] Firestore failed to retrieve logs, falling back to local:', { error: String(err) });
      }
    }

    return Array.from(this.localLogs.values())
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit);
  }

  /**
   * Clears outcome logs
   */
  public static async clearLogs(): Promise<void> {
    this.init();
    this.localLogs.clear();
    this.saveLocal();

    const firestore = getFirestoreAdmin();
    if (firestore) {
      try {
        const collectionRef = firestore.collection(FIRESTORE_OUTCOME_COL);
        const snapshot = await collectionRef.get();
        const batch = firestore.batch();
        snapshot.docs.forEach((doc) => {
          batch.delete(doc.ref);
        });
        await batch.commit();
      } catch (err) {
        logger.warn('[SignalOutcomeLogger] Firestore failed to clear logs:', { error: String(err) });
      }
    }
  }
}
