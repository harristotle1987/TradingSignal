/**
 * Scanner & Signal Notification Persistence Layer
 *
 * Persists:
 * 1. Daily Signal Cap & Rollover State (UTC Date YYYY-MM-DD)
 * 2. Sent Trading Signals & Setup Status (ACTIVE, EXPIRED, COMPLETED, SUPERSEDED)
 * 3. Rejected Candidates Audit Log with exact timestamps and rejection reasons
 * 4. Notification History (BEST_TRADE, HIGH_QUALITY, NO_TRADE, SETUP_UPDATE)
 * 5. Scanner Configurations
 *
 * Utilizes Firestore Admin as primary durable database, with synchronous local JSON
 * persistence fallback so Vercel/container restarts NEVER reset or lose state.
 */

import * as fs from 'fs';
import * as path from 'path';
import { getFirestoreAdmin } from '../firebaseAdmin.js';
import { logger } from '../logger.js';
import { TradingSignal, RankTier } from '../../types/index.js';

export interface DailyCapState {
  date: string;
  dailySignalCount: number;
  dailySignalCap: number;
  lastScanTime: number;
}

export interface PersistedSentSignal {
  id: string;
  snapshotId: string;
  symbol: string;
  direction: 'BUY' | 'SELL';
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  tp1?: number;
  tp2?: number;
  tp3?: number;
  riskRewardRatio: number;
  score: number;
  rankTier: RankTier;
  strategy: string;
  timeframe: string;
  dataSource: string;
  status: 'ACTIVE' | 'TP1_HIT' | 'TP2_HIT' | 'TP3_HIT' | 'SL_HIT' | 'EXPIRED' | 'COMPLETED' | 'SUPERSEDED' | 'AMBIGUOUS';
  timestamp: number;
  notificationSent: boolean;
  notificationTimestamp: number;
  date: string;
  estimatedWinRate?: number;
  aiAssessment?: string;
  tp1HitTimestamp?: number;
  tp2HitTimestamp?: number;
  tp3HitTimestamp?: number;
  slHitTimestamp?: number;
  detectedAt?: number;
  eventTime?: number;
  eventSource?: 'HISTORICAL_BACKFILL' | 'LIVE_STREAM' | 'TICK_EVALUATION';
  timeframeUsed?: string;
  isRecovered?: boolean;
  ambiguousDetails?: string;
  notifiedStates?: string[];
}

export interface PersistedRejectedCandidate {
  id: string;
  symbol: string;
  direction?: string;
  score?: number;
  reason: string;
  timestamp: number;
  date: string;
}

export interface PersistedNotification {
  id: string;
  timestamp: number;
  type: 'BEST_TRADE' | 'HIGH_QUALITY' | 'NO_TRADE' | 'SETUP_UPDATE';
  symbol: string;
  title: string;
  message: string;
  score?: number;
  rankTier?: RankTier;
  date: string;
}

export interface ScannerPersistenceData {
  capState: DailyCapState;
  sentSignals: PersistedSentSignal[];
  rejectedCandidates: PersistedRejectedCandidate[];
  notifications: PersistedNotification[];
  settings: {
    enabled: boolean;
    notificationsEnabled: boolean;
    notifyOnNoTrade: boolean;
  };
}

const LOCAL_PERSISTENCE_PATH = path.join(process.cwd(), 'scanner_persistence.json');

// Firestore Collection Paths
const FIRESTORE_CAP_DOC = 'scanner/cap_state';
const FIRESTORE_LOCK_DOC = 'scanner/lock_state';
const FIRESTORE_SIGNALS_COL = 'scanner_sent_signals';
const FIRESTORE_REJECTIONS_COL = 'scanner_rejected_candidates';
const FIRESTORE_NOTIFICATIONS_COL = 'scanner_notifications';

export interface ScanLockState {
  isScanning: boolean;
  lockAcquiredAt: number;
  instanceId?: string;
}

export class ScannerPersistence {
  private static localLock: ScanLockState = {
    isScanning: false,
    lockAcquiredAt: 0,
  };

  public static localData: ScannerPersistenceData = {
    capState: {
      date: new Date().toISOString().split('T')[0],
      dailySignalCount: 0,
      dailySignalCap: 5,
      lastScanTime: 0,
    },
    sentSignals: [],
    rejectedCandidates: [],
    notifications: [],
    settings: {
      enabled: true,
      notificationsEnabled: true,
      notifyOnNoTrade: false,
    },
  };

  private static isInitialized = false;

  /**
   * Initializes local cache from disk on startup.
   */
  static init(): void {
    if (this.isInitialized) return;

    try {
      if (fs.existsSync(LOCAL_PERSISTENCE_PATH)) {
        const raw = fs.readFileSync(LOCAL_PERSISTENCE_PATH, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          this.localData = {
            capState: parsed.capState || this.localData.capState,
            sentSignals: Array.isArray(parsed.sentSignals) ? parsed.sentSignals : [],
            rejectedCandidates: Array.isArray(parsed.rejectedCandidates) ? parsed.rejectedCandidates : [],
            notifications: Array.isArray(parsed.notifications) ? parsed.notifications : [],
            settings: {
              enabled: parsed.settings?.enabled ?? true,
              notificationsEnabled: parsed.settings?.notificationsEnabled ?? true,
              notifyOnNoTrade: parsed.settings?.notifyOnNoTrade ?? false,
            },
          };
          logger.info('[ScannerPersistence] Loaded persisted scanner state from disk.');
        }
      }
    } catch (err) {
      logger.warn('[ScannerPersistence] Could not load local state file:', { error: String(err) });
    }

    this.checkDailyRollover();
    this.isInitialized = true;
  }

  /**
   * Checks and performs date rollover for daily signal cap.
   */
  private static checkDailyRollover(): boolean {
    const today = new Date().toISOString().split('T')[0];
    if (this.localData.capState.date !== today) {
      logger.info(`[ScannerPersistence] Daily rollover triggered: ${this.localData.capState.date} -> ${today}. Resetting daily signal count.`);
      this.localData.capState = {
        date: today,
        dailySignalCount: 0,
        dailySignalCap: this.localData.capState.dailySignalCap || 5,
        lastScanTime: this.localData.capState.lastScanTime,
      };
      this.saveLocalData();
      return true;
    }
    return false;
  }

  /**
   * Saves data to local JSON disk file.
   */
  private static saveLocalData(): void {
    try {
      // Keep only last 100 rejected candidates & 100 notifications to prevent unbounded growth
      if (this.localData.rejectedCandidates.length > 100) {
        this.localData.rejectedCandidates = this.localData.rejectedCandidates.slice(-100);
      }
      if (this.localData.notifications.length > 100) {
        this.localData.notifications = this.localData.notifications.slice(-100);
      }
      if (this.localData.sentSignals.length > 100) {
        this.localData.sentSignals = this.localData.sentSignals.slice(-100);
      }

      fs.writeFileSync(LOCAL_PERSISTENCE_PATH, JSON.stringify(this.localData, null, 2), 'utf-8');
    } catch (err) {
      logger.warn('[ScannerPersistence] Failed to write local state to disk:', { error: String(err) });
    }
  }

  /**
   * Retrieves current Daily Cap State (with Firestore sync if available).
   */
  static async getCapState(defaultCap = 5): Promise<DailyCapState> {
    this.init();
    this.checkDailyRollover();

    const today = new Date().toISOString().split('T')[0];
    const firestore = getFirestoreAdmin();

    if (!firestore) {
      return this.localData.capState;
    }

    try {
      const docRef = firestore.doc(FIRESTORE_CAP_DOC);
      const snapshot = await docRef.get();

      if (!snapshot.exists) {
        const state: DailyCapState = {
          date: today,
          dailySignalCount: this.localData.capState.dailySignalCount,
          dailySignalCap: defaultCap,
          lastScanTime: this.localData.capState.lastScanTime,
        };
        await docRef.set(state);
        return state;
      }

      const remote = snapshot.data() as DailyCapState;
      if (remote.date !== today) {
        const resetState: DailyCapState = {
          date: today,
          dailySignalCount: 0,
          dailySignalCap: remote.dailySignalCap || defaultCap,
          lastScanTime: remote.lastScanTime || Date.now(),
        };
        await docRef.set(resetState);
        this.localData.capState = resetState;
        this.saveLocalData();
        return resetState;
      }

      // Sync local with remote (take max count to prevent duplicate resets)
      this.localData.capState = {
        date: today,
        dailySignalCount: Math.max(this.localData.capState.dailySignalCount, remote.dailySignalCount || 0),
        dailySignalCap: remote.dailySignalCap || defaultCap,
        lastScanTime: remote.lastScanTime || this.localData.capState.lastScanTime,
      };
      this.saveLocalData();
      return this.localData.capState;
    } catch (err) {
      logger.warn('[ScannerPersistence] Firestore getCapState error, using local:', { error: String(err) });
      return this.localData.capState;
    }
  }

  /**
   * Atomically verifies daily cap and increments counter if allowed.
   */
  static async tryIncrementCap(defaultCap = 5): Promise<{ allowed: boolean; count: number; cap: number }> {
    this.init();
    this.checkDailyRollover();

    const today = new Date().toISOString().split('T')[0];
    const firestore = getFirestoreAdmin();
    const limit = this.localData.capState.dailySignalCap || defaultCap;

    if (!firestore) {
      if (this.localData.capState.dailySignalCount >= limit) {
        return { allowed: false, count: this.localData.capState.dailySignalCount, cap: limit };
      }
      this.localData.capState.dailySignalCount += 1;
      this.saveLocalData();
      return { allowed: true, count: this.localData.capState.dailySignalCount, cap: limit };
    }

    try {
      const docRef = firestore.doc(FIRESTORE_CAP_DOC);
      const result = await firestore.runTransaction(async (tx) => {
        const snap = await tx.get(docRef);
        let data: DailyCapState;

        if (!snap.exists) {
          data = {
            date: today,
            dailySignalCount: 0,
            dailySignalCap: limit,
            lastScanTime: Date.now(),
          };
        } else {
          data = snap.data() as DailyCapState;
          if (data.date !== today) {
            data = {
              date: today,
              dailySignalCount: 0,
              dailySignalCap: data.dailySignalCap || limit,
              lastScanTime: Date.now(),
            };
          }
        }

        const currentLimit = data.dailySignalCap || limit;
        if (data.dailySignalCount >= currentLimit) {
          return { allowed: false, count: data.dailySignalCount, cap: currentLimit };
        }

        const newCount = data.dailySignalCount + 1;
        const updated: DailyCapState = {
          date: today,
          dailySignalCount: newCount,
          dailySignalCap: currentLimit,
          lastScanTime: Date.now(),
        };
        tx.set(docRef, updated);
        return { allowed: true, count: newCount, cap: currentLimit };
      });

      if (result.allowed) {
        this.localData.capState.dailySignalCount = result.count;
        this.saveLocalData();
      }
      return result;
    } catch (err) {
      logger.error('[ScannerPersistence] Transaction tryIncrementCap failed, fallback to local:', { error: String(err) });
      if (this.localData.capState.dailySignalCount >= limit) {
        return { allowed: false, count: this.localData.capState.dailySignalCount, cap: limit };
      }
      this.localData.capState.dailySignalCount += 1;
      this.saveLocalData();
      return { allowed: true, count: this.localData.capState.dailySignalCount, cap: limit };
    }
  }

  /**
   * Records a validated sent signal.
   */
  static async recordSentSignal(signal: TradingSignal): Promise<void> {
    this.init();
    const today = new Date().toISOString().split('T')[0];
    const now = Date.now();

    const persisted: PersistedSentSignal = {
      id: signal.id,
      snapshotId: signal.snapshotId,
      symbol: signal.symbol,
      direction: signal.direction,
      entryPrice: signal.entryPrice,
      stopLoss: signal.stopLoss,
      takeProfit: signal.takeProfit,
      tp1: signal.tp1,
      tp2: signal.tp2,
      tp3: signal.tp3,
      riskRewardRatio: signal.riskRewardRatio,
      score: signal.score || signal.confidenceScore || 80,
      rankTier: signal.rankTier || (signal.isBestTrade ? 'BEST_TRADE' : signal.isSecondBest ? 'SECOND_BEST' : 'SUGGESTION'),
      strategy: signal.strategy,
      timeframe: signal.timeframe,
      dataSource: signal.dataSource,
      status: 'ACTIVE',
      timestamp: signal.timestamp || now,
      notificationSent: true,
      notificationTimestamp: now,
      date: today,
      estimatedWinRate: signal.estimatedWinRate,
      aiAssessment: signal.aiAssessment,
    };

    // Add to local data
    this.localData.sentSignals.push(persisted);
    this.saveLocalData();

    // Firestore async persist
    const firestore = getFirestoreAdmin();
    if (firestore) {
      try {
        await firestore.collection(FIRESTORE_SIGNALS_COL).doc(persisted.id).set(persisted);
      } catch (err) {
        logger.warn('[ScannerPersistence] Firestore recordSentSignal failed:', { error: String(err) });
      }
    }
  }

  /**
   * Retrieves all signals sent today (UTC).
   */
  static async getSentSignalsToday(): Promise<PersistedSentSignal[]> {
    this.init();
    const today = new Date().toISOString().split('T')[0];

    const firestore = getFirestoreAdmin();
    if (firestore) {
      try {
        const query = await firestore
          .collection(FIRESTORE_SIGNALS_COL)
          .where('date', '==', today)
          .get();

        if (!query.empty) {
          const signals: PersistedSentSignal[] = [];
          query.forEach((doc) => signals.push(doc.data() as PersistedSentSignal));
          // Merge with local signals
          const map = new Map<string, PersistedSentSignal>();
          for (const s of this.localData.sentSignals.filter((s) => s.date === today)) {
            map.set(s.id, s);
          }
          for (const s of signals) {
            map.set(s.id, s);
          }
          return Array.from(map.values()).sort((a, b) => b.timestamp - a.timestamp);
        }
      } catch (err) {
        logger.warn('[ScannerPersistence] Firestore getSentSignalsToday failed, using local:', { error: String(err) });
      }
    }

    return this.localData.sentSignals
      .filter((s) => s.date === today)
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Records rejected candidate setups for transparency and auditability.
   */
  static async recordRejectedCandidates(
    candidates: Array<{ symbol: string; direction?: string; score?: number; reason: string; timestamp?: number }>
  ): Promise<void> {
    if (!candidates || candidates.length === 0) return;
    this.init();

    const today = new Date().toISOString().split('T')[0];
    const now = Date.now();

    const newItems: PersistedRejectedCandidate[] = candidates.map((c) => {
      const item: PersistedRejectedCandidate = {
        id: `rej_${now}_${Math.random().toString(36).substring(2, 7)}`,
        symbol: c.symbol,
        reason: c.reason,
        timestamp: c.timestamp || now,
        date: today,
      };
      if (c.direction !== undefined) {
        item.direction = c.direction;
      }
      if (c.score !== undefined) {
        item.score = c.score;
      }
      return item;
    });

    this.localData.rejectedCandidates.push(...newItems);
    this.saveLocalData();

    const firestore = getFirestoreAdmin();
    if (firestore) {
      try {
        const batch = firestore.batch();
        for (const item of newItems) {
          const docRef = firestore.collection(FIRESTORE_REJECTIONS_COL).doc(item.id);
          batch.set(docRef, item);
        }
        await batch.commit();
      } catch (err) {
        logger.warn('[ScannerPersistence] Firestore recordRejectedCandidates failed:', { error: String(err) });
      }
    }
  }

  /**
   * Retrieves rejected candidates for today.
   */
  static async getRejectedCandidatesToday(limit = 20): Promise<PersistedRejectedCandidate[]> {
    this.init();
    const today = new Date().toISOString().split('T')[0];

    const firestore = getFirestoreAdmin();
    if (firestore) {
      try {
        const query = await firestore
          .collection(FIRESTORE_REJECTIONS_COL)
          .where('date', '==', today)
          .orderBy('timestamp', 'desc')
          .limit(limit)
          .get();

        if (!query.empty) {
          const items: PersistedRejectedCandidate[] = [];
          query.forEach((doc) => items.push(doc.data() as PersistedRejectedCandidate));
          return items;
        }
      } catch (err) {
        logger.debug('[ScannerPersistence] Firestore getRejectedCandidatesToday fallback to local');
      }
    }

    return this.localData.rejectedCandidates
      .filter((c) => c.date === today)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  /**
   * Records a notification history item.
   */
  static async recordNotification(notification: {
    type: 'BEST_TRADE' | 'HIGH_QUALITY' | 'NO_TRADE' | 'SETUP_UPDATE';
    symbol: string;
    title: string;
    message: string;
    score?: number;
    rankTier?: RankTier;
  }): Promise<void> {
    this.init();
    const today = new Date().toISOString().split('T')[0];
    const now = Date.now();

    const item: PersistedNotification = {
      id: `notif_${now}_${Math.random().toString(36).substring(2, 7)}`,
      timestamp: now,
      type: notification.type,
      symbol: notification.symbol,
      title: notification.title,
      message: notification.message,
      score: notification.score,
      rankTier: notification.rankTier,
      date: today,
    };

    this.localData.notifications.push(item);
    this.saveLocalData();

    const firestore = getFirestoreAdmin();
    if (firestore) {
      try {
        await firestore.collection(FIRESTORE_NOTIFICATIONS_COL).doc(item.id).set(item);
      } catch (err) {
        logger.warn('[ScannerPersistence] Firestore recordNotification failed:', { error: String(err) });
      }
    }
  }

  /**
   * Retrieves notification history.
   */
  static async getNotificationHistory(limit = 20): Promise<PersistedNotification[]> {
    this.init();

    const firestore = getFirestoreAdmin();
    if (firestore) {
      try {
        const query = await firestore
          .collection(FIRESTORE_NOTIFICATIONS_COL)
          .orderBy('timestamp', 'desc')
          .limit(limit)
          .get();

        if (!query.empty) {
          const list: PersistedNotification[] = [];
          query.forEach((doc) => list.push(doc.data() as PersistedNotification));
          return list;
        }
      } catch (err) {
        logger.debug('[ScannerPersistence] Firestore getNotificationHistory fallback to local');
      }
    }

    return [...this.localData.notifications].sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
  }

  /**
   * Updates status and optional metadata of an existing signal setup (e.g. SUPERSEDED, EXPIRED, progressive hits).
   */
  static async updateSignalStatus(
    signalId: string,
    status: PersistedSentSignal['status'],
    metadata?: Partial<PersistedSentSignal>
  ): Promise<void> {
    this.init();
    const target = this.localData.sentSignals.find((s) => s.id === signalId);
    if (target) {
      target.status = status;
      if (metadata) {
        Object.assign(target, metadata);
      }
      this.saveLocalData();
    }

    const firestore = getFirestoreAdmin();
    if (firestore) {
      try {
        const updatePayload: Record<string, any> = { status };
        if (metadata) {
          Object.assign(updatePayload, metadata);
        }
        await firestore.collection(FIRESTORE_SIGNALS_COL).doc(signalId).update(updatePayload);
      } catch (err) {
        logger.warn('[ScannerPersistence] Firestore updateSignalStatus failed:', { error: String(err) });
      }
    }
  }

  /**
   * Updates take-profit targets of an existing signal setup.
   */
  static async updateSignalTps(
    signalId: string,
    signalIdOrSnapshotId: string,
    tp1: number,
    tp2: number,
    tp3: number,
    takeProfit: number,
    riskRewardRatio: number
  ): Promise<void> {
    this.init();
    const target = this.localData.sentSignals.find((s) => s.id === signalIdOrSnapshotId || s.snapshotId === signalIdOrSnapshotId);
    if (target) {
      target.tp1 = tp1;
      target.tp2 = tp2;
      target.tp3 = tp3;
      target.takeProfit = takeProfit;
      target.riskRewardRatio = riskRewardRatio;
      this.saveLocalData();
    }

    const firestore = getFirestoreAdmin();
    if (firestore) {
      try {
        await firestore.collection(FIRESTORE_SIGNALS_COL).doc(signalIdOrSnapshotId).update({
          tp1,
          tp2,
          tp3,
          takeProfit,
          riskRewardRatio
        });
      } catch (err) {
        // Try querying by snapshotId or checking if signalId matches
        try {
          const snapshot = await firestore.collection(FIRESTORE_SIGNALS_COL)
            .where('snapshotId', '==', signalIdOrSnapshotId)
            .get();
          
          if (!snapshot.empty) {
            const batch = firestore.batch();
            snapshot.docs.forEach((doc) => {
              batch.update(doc.ref, {
                tp1,
                tp2,
                tp3,
                takeProfit,
                riskRewardRatio
              });
            });
            await batch.commit();
          } else {
            // Also search by id
            const snapshotById = await firestore.collection(FIRESTORE_SIGNALS_COL)
              .where('id', '==', signalIdOrSnapshotId)
              .get();
            if (!snapshotById.empty) {
              const batch = firestore.batch();
              snapshotById.docs.forEach((doc) => {
                batch.update(doc.ref, {
                  tp1,
                  tp2,
                  tp3,
                  takeProfit,
                  riskRewardRatio
                });
              });
              await batch.commit();
            }
          }
        } catch (queryErr) {
          logger.warn('[ScannerPersistence] Firestore updateSignalTps failed:', { error: String(queryErr) });
        }
      }
    }
  }

  /**
   * Retrieves all currently ACTIVE signals from persistence.
   */
  static async getActiveSignals(): Promise<PersistedSentSignal[]> {
    this.init();
    const firestore = getFirestoreAdmin();
    if (firestore) {
      try {
        const query = await firestore
          .collection(FIRESTORE_SIGNALS_COL)
          .where('status', '==', 'ACTIVE')
          .get();

        const signals: PersistedSentSignal[] = [];
        if (!query.empty) {
          query.forEach((doc) => signals.push(doc.data() as PersistedSentSignal));
        }

        // Also query other potential non-terminal progressive statuses to ensure active monitoring of progressive levels
        const activeOrProgressive = ['TP1_HIT', 'TP2_HIT'];
        for (const stat of activeOrProgressive) {
          const q = await firestore
            .collection(FIRESTORE_SIGNALS_COL)
            .where('status', '==', stat)
            .get();
          if (!q.empty) {
            q.forEach((doc) => signals.push(doc.data() as PersistedSentSignal));
          }
        }

        // Merge with local signals
        const map = new Map<string, PersistedSentSignal>();
        const localActive = this.localData.sentSignals.filter((s) => 
          s.status === 'ACTIVE' || s.status === 'TP1_HIT' || s.status === 'TP2_HIT'
        );
        for (const s of localActive) {
          map.set(s.id, s);
        }
        for (const s of signals) {
          map.set(s.id, s);
        }
        return Array.from(map.values()).sort((a, b) => b.timestamp - a.timestamp);
      } catch (err) {
        logger.warn('[ScannerPersistence] Firestore getActiveSignals failed, using local:', { error: String(err) });
      }
    }

    return this.localData.sentSignals
      .filter((s) => s.status === 'ACTIVE' || s.status === 'TP1_HIT' || s.status === 'TP2_HIT')
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Retrieves scanner settings.
   */
  static getSettings(): ScannerPersistenceData['settings'] {
    this.init();
    return { ...this.localData.settings };
  }

  /**
   * Updates scanner settings.
   */
  static updateSettings(options: Partial<ScannerPersistenceData['settings']>): void {
    this.init();
    this.localData.settings = {
      ...this.localData.settings,
      ...options,
    };
    this.saveLocalData();
  }

  /**
   * Updates last scan time.
   */
  static updateLastScanTime(timestamp = Date.now()): void {
    this.init();
    this.localData.capState.lastScanTime = timestamp;
    this.saveLocalData();

    const firestore = getFirestoreAdmin();
    if (firestore) {
      firestore
        .doc(FIRESTORE_CAP_DOC)
        .set({ lastScanTime: timestamp }, { merge: true })
        .catch(() => {});
    }
  }

  /**
   * Attempts to atomically acquire a scanner execution lock for concurrency protection across Vercel serverless containers.
   * Lock auto-expires after lockTimeoutMs (default 5 minutes) to recover from orphaned crashed instances.
   */
  static async tryAcquireLock(instanceId: string, lockTimeoutMs = 300000): Promise<{ acquired: boolean; reason?: string }> {
    this.init();
    const now = Date.now();

    // Check in-memory local lock first
    if (this.localLock.isScanning && now - this.localLock.lockAcquiredAt < lockTimeoutMs) {
      return { acquired: false, reason: 'Scan lock currently held in local process.' };
    }

    const firestore = getFirestoreAdmin();
    if (!firestore) {
      this.localLock = { isScanning: true, lockAcquiredAt: now, instanceId };
      return { acquired: true };
    }

    try {
      const docRef = firestore.doc(FIRESTORE_LOCK_DOC);
      const result = await firestore.runTransaction(async (tx) => {
        const snap = await tx.get(docRef);
        if (snap.exists) {
          const remoteLock = snap.data() as ScanLockState;
          if (remoteLock.isScanning && now - remoteLock.lockAcquiredAt < lockTimeoutMs) {
            return { acquired: false, reason: 'Scan lock currently held in remote Firestore container.' };
          }
        }
        const newLock: ScanLockState = {
          isScanning: true,
          lockAcquiredAt: now,
          instanceId,
        };
        tx.set(docRef, newLock);
        return { acquired: true };
      });

      if (result.acquired) {
        this.localLock = { isScanning: true, lockAcquiredAt: now, instanceId };
      }
      return result;
    } catch (err) {
      logger.warn('[ScannerPersistence] Firestore tryAcquireLock error, using local fallback:', { error: String(err) });
      if (this.localLock.isScanning && now - this.localLock.lockAcquiredAt < lockTimeoutMs) {
        return { acquired: false, reason: 'Scan lock held in local fallback memory.' };
      }
      this.localLock = { isScanning: true, lockAcquiredAt: now, instanceId };
      return { acquired: true };
    }
  }

  /**
   * Releases scanner execution lock.
   */
  static async releaseLock(instanceId: string): Promise<void> {
    this.init();
    this.localLock = { isScanning: false, lockAcquiredAt: 0 };

    const firestore = getFirestoreAdmin();
    if (firestore) {
      try {
        await firestore.doc(FIRESTORE_LOCK_DOC).set({
          isScanning: false,
          lockAcquiredAt: 0,
          instanceId,
        });
      } catch (err) {
        logger.warn('[ScannerPersistence] Firestore releaseLock error:', { error: String(err) });
      }
    }
  }
}
