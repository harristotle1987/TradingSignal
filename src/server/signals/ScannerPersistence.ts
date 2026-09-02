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
import { serverConfig } from '../config.js';
import { TradingSignal, RankTier, isActionableSignal, ExecutionEvidenceState, HistoricalEntryPolicy } from '../../types/index.js';

export interface DailyCapReservation {
  id: string;
  status: 'RESERVED' | 'COMMITTED' | 'RELEASED';
  timestamp: number;
}

export interface DailyCapState {
  date: string;
  dailySignalCount: number;
  dailySignalCap: number;

  // HARD GATE 2: Track scan & cron metrics separately in backend state
  lastCronExecution?: number;
  lastAutomatedScan?: number;
  lastScanCompletedAt?: number;
  lastScanDuration?: number;
  lastCandidatesEvaluated?: number;
  lastSignalsFound?: number;
  lastAcceptedSignals?: number;
  nextCronExecution?: number;

  // Granular Funnel Telemetry Counters
  universeSymbolsScanned?: number;
  preliminaryCandidatesFound?: number;
  candidatesRejectedPreliminary?: number;
  candidatesEvaluated?: number;
  candidatesRejectedFinal?: number;
  signalsGenerated?: number;
  signalsAccepted?: number;

  // Backward compatibility fields
  lastScanTime: number;
  lastCronTriggerTime?: number;
  reservations?: DailyCapReservation[];
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
  tp1Rr?: number;
  tp2Rr?: number;
  tp3Rr?: number;
  riskRewardRatio: number;
  targetQualityScore?: number;
  score: number;
  rankTier: RankTier;
  strategy: string;
  timeframe: string;
  dataSource: string;
  status: 'WAITING_ENTRY' | 'ACTIVE' | 'TP1_HIT' | 'TP2_HIT' | 'TP3_HIT' | 'SL_HIT' | 'STOPPED_OUT' | 'COMPLETED' | 'EXPIRED' | 'SUPERSEDED' | 'AMBIGUOUS' | 'REJECTED';
  isTradeableSignal?: boolean;
  signalClassification?: string;
  isActionableSignal?: boolean;
  executionEvidence?: ExecutionEvidenceState;
  historicalEntryPolicy?: HistoricalEntryPolicy;
  tp1Status?: 'PENDING' | 'HIT';
  tp2Status?: 'PENDING' | 'HIT';
  tp3Status?: 'PENDING' | 'HIT';
  slStatus?: 'ACTIVE' | 'HIT' | 'ACTIVE_FOR_ENTRY_ONLY';
  tp1HitAt?: string;
  tp2HitAt?: string;
  tp3HitAt?: string;
  stopLossHitAt?: string;
  tp1HitPrice?: number;
  tp2HitPrice?: number;
  tp3HitPrice?: number;
  stopLossHitPrice?: number;
  timestamp: number;
  expiresAt?: number;
  notificationSent: boolean;
  notificationTimestamp: number;
  date: string;
  estimatedWinRate?: number;
  aiAssessment?: string;
  entryHitTimestamp?: string | null;
  displayPrice?: number;
  bid?: number;
  ask?: number;
  executionSide?: 'ASK' | 'BID';
  executionPrice?: number;
  spread?: number;
  entryTriggerTimestamp?: string | null;
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
  marketRegime?: string;
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
  type: 'BEST_TRADE' | 'HIGH_QUALITY' | 'NO_TRADE' | 'SETUP_UPDATE' | 'TRADE_UPDATE';
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
  deletedSignals?: string[];
  settings: {
    enabled: boolean;
    notificationsEnabled: boolean;
    notifyOnNoTrade: boolean;
    intervalMinutes: number;
  };
}

const LOCAL_PERSISTENCE_PATH = path.join(process.cwd(), 'scanner_persistence.json');

// Firestore Collection Paths
const FIRESTORE_CAP_DOC = 'scanner/cap_state';
const FIRESTORE_LOCK_DOC = 'scanner/lock_state';
const FIRESTORE_SIGNALS_COL = 'scanner_sent_signals';
const FIRESTORE_REJECTIONS_COL = 'scanner_rejected_candidates';
const FIRESTORE_NOTIFICATIONS_COL = 'scanner_notifications';
const FIRESTORE_DELETED_COL = 'scanner_deleted_signals';

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
      lastCronExecution: 0,
      lastAutomatedScan: 0,
      lastScanCompletedAt: 0,
      lastScanDuration: 0,
      lastCandidatesEvaluated: 0,
      lastSignalsFound: 0,
      lastAcceptedSignals: 0,
      reservations: [],
    },
    sentSignals: [],
    rejectedCandidates: [],
    notifications: [],
    settings: {
      enabled: true,
      notificationsEnabled: true,
      notifyOnNoTrade: false,
      intervalMinutes: 15,
    },
  };

  private static isInitialized = false;

  public static isProductionMode(): boolean {
    return process.env.NODE_ENV === 'production';
  }

  public static isProductionPersistenceReady(): boolean {
    if (!ScannerPersistence.isProductionMode()) {
      return true; // Local persistence allowed in dev/testing
    }
    const sa = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!sa || sa.trim().length === 0) {
      return false;
    }
    return getFirestoreAdmin() !== null;
  }

  /**
   * Initializes local cache from disk on startup.
   */
  static init(): void {
    if (this.isInitialized) return;
    this.isInitialized = true;

    try {
      const configCap = serverConfig?.getConfig?.()?.thresholds?.dailySignalCap;
      if (typeof configCap === 'number' && configCap > 0) {
        this.localData.capState.dailySignalCap = configCap;
      }
    } catch {
      // ignore uninitialized config during early bootstrap
    }

    if (this.isProductionMode() && !this.isProductionPersistenceReady()) {
      logger.warn('[ScannerPersistence] PRODUCTION PERSISTENCE NOT READY: FIREBASE_SERVICE_ACCOUNT is required in production. Local disk persistence disabled.');
    }

    try {
      if (fs.existsSync(LOCAL_PERSISTENCE_PATH)) {
        const raw = fs.readFileSync(LOCAL_PERSISTENCE_PATH, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          const parsedInterval = Number(parsed.settings?.intervalMinutes);
          this.localData = {
            capState: parsed.capState || this.localData.capState,
            sentSignals: Array.isArray(parsed.sentSignals) ? parsed.sentSignals : [],
            rejectedCandidates: Array.isArray(parsed.rejectedCandidates) ? parsed.rejectedCandidates : [],
            notifications: Array.isArray(parsed.notifications) ? parsed.notifications : [],
            settings: {
              enabled: parsed.settings?.enabled ?? true,
              notificationsEnabled: parsed.settings?.notificationsEnabled ?? true,
              notifyOnNoTrade: parsed.settings?.notifyOnNoTrade ?? false,
              intervalMinutes: [15, 30, 45, 60].includes(parsedInterval) ? parsedInterval : 15,
            },
          };
          logger.info('[ScannerPersistence] Loaded persisted scanner state from disk.');
        }
      } else {
        this.localData.capState.dailySignalCap = serverConfig.getConfig().thresholds.dailySignalCap;
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
        dailySignalCap: this.localData.capState.dailySignalCap || serverConfig.getConfig().thresholds.dailySignalCap,
        lastScanTime: this.localData.capState.lastScanTime,
        reservations: [],
      };
      this.saveLocalData();
      return true;
    }
    return false;
  }

  /**
   * Saves data to local JSON disk file (only in dev/testing mode).
   */
  private static saveLocalData(): void {
    if (this.isProductionMode()) {
      // In production mode, local disk persistence is forbidden
      return;
    }

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
      if (this.isProductionMode()) {
        logger.error('[ScannerPersistence] FAIL CLOSED: Production mode requires Firebase Admin persistence for daily cap state.');
        return {
          date: today,
          dailySignalCount: defaultCap,
          dailySignalCap: defaultCap,
          lastScanTime: this.localData.capState.lastScanTime || 0,
        };
      }
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
          reservations: this.localData.capState.reservations || [],
        };
        await docRef.set(state);
        return state;
      }

      const remote = snapshot.data() as DailyCapState;
      const remoteLastScan = typeof remote.lastScanTime === 'number' && remote.lastScanTime > 0
        ? remote.lastScanTime
        : (this.localData.capState.lastScanTime || 0);
      const remoteLastCronExecution = typeof remote.lastCronExecution === 'number' && remote.lastCronExecution > 0
        ? remote.lastCronExecution
        : (typeof remote.lastCronTriggerTime === 'number' && remote.lastCronTriggerTime > 0 ? remote.lastCronTriggerTime : (this.localData.capState.lastCronExecution || 0));
      const remoteLastAutomatedScan = typeof remote.lastAutomatedScan === 'number' && remote.lastAutomatedScan > 0
        ? remote.lastAutomatedScan
        : (this.localData.capState.lastAutomatedScan || remoteLastScan || 0);
      const remoteLastScanCompletedAt = typeof remote.lastScanCompletedAt === 'number' ? remote.lastScanCompletedAt : (this.localData.capState.lastScanCompletedAt || 0);
      const remoteLastScanDuration = typeof remote.lastScanDuration === 'number' ? remote.lastScanDuration : (this.localData.capState.lastScanDuration || 0);
      const remoteLastCandidatesEvaluated = typeof remote.lastCandidatesEvaluated === 'number' ? remote.lastCandidatesEvaluated : (this.localData.capState.lastCandidatesEvaluated || 0);
      const remoteLastSignalsFound = typeof remote.lastSignalsFound === 'number' ? remote.lastSignalsFound : (this.localData.capState.lastSignalsFound || 0);
      const remoteLastAcceptedSignals = typeof remote.lastAcceptedSignals === 'number' ? remote.lastAcceptedSignals : (this.localData.capState.lastAcceptedSignals || 0);

      if (remote.date !== today) {
        const resetState: DailyCapState = {
          date: today,
          dailySignalCount: 0,
          dailySignalCap: remote.dailySignalCap || defaultCap,
          lastScanTime: remoteLastScan,
          lastCronExecution: remoteLastCronExecution,
          lastAutomatedScan: remoteLastAutomatedScan,
          lastScanCompletedAt: remoteLastScanCompletedAt,
          lastScanDuration: remoteLastScanDuration,
          lastCandidatesEvaluated: remoteLastCandidatesEvaluated,
          lastSignalsFound: remoteLastSignalsFound,
          lastAcceptedSignals: remoteLastAcceptedSignals,
          lastCronTriggerTime: remoteLastCronExecution,
          reservations: [],
        };
        await docRef.set(resetState);
        this.localData.capState = resetState;
        this.saveLocalData();
        return resetState;
      }

      // Sync local with remote (remote Firestore is authoritative source of truth)
      this.localData.capState = {
        date: today,
        dailySignalCount: typeof remote.dailySignalCount === 'number' ? remote.dailySignalCount : 0,
        dailySignalCap: remote.dailySignalCap || defaultCap,
        lastScanTime: remoteLastScan,
        lastCronExecution: remoteLastCronExecution,
        lastAutomatedScan: remoteLastAutomatedScan,
        lastScanCompletedAt: remoteLastScanCompletedAt,
        lastScanDuration: remoteLastScanDuration,
        lastCandidatesEvaluated: remoteLastCandidatesEvaluated,
        lastSignalsFound: remoteLastSignalsFound,
        lastAcceptedSignals: remoteLastAcceptedSignals,
        lastCronTriggerTime: remoteLastCronExecution,
        reservations: remote.reservations || [],
      };
      this.saveLocalData();
      return this.localData.capState;
    } catch (err) {
      logger.warn('[ScannerPersistence] Firestore getCapState error:', { error: String(err) });
      if (this.isProductionMode()) {
        return {
          date: today,
          dailySignalCount: defaultCap,
          dailySignalCap: defaultCap,
          lastScanTime: this.localData.capState.lastScanTime || 0,
        };
      }
      return this.localData.capState;
    }
  }

  /**
   * Atomically verifies daily cap and increments counter if allowed, returning a reservationId.
   */
  static async tryIncrementCap(defaultCap = 5): Promise<{ allowed: boolean; count: number; cap: number; reservationId?: string }> {
    this.init();
    this.checkDailyRollover();

    const today = new Date().toISOString().split('T')[0];
    const firestore = getFirestoreAdmin();
    const limit = this.localData.capState.dailySignalCap || defaultCap;
    const reservationId = `res_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    if (!firestore) {
      if (this.isProductionMode()) {
        logger.error('[ScannerPersistence] FAIL CLOSED: Production mode requires Firebase Admin persistence for daily cap increment. No daily cap increment allowed.');
        return { allowed: false, count: 0, cap: limit };
      }
      if (this.localData.capState.dailySignalCount >= limit) {
        return { allowed: false, count: this.localData.capState.dailySignalCount, cap: limit };
      }
      this.localData.capState.dailySignalCount += 1;
      if (!this.localData.capState.reservations) {
        this.localData.capState.reservations = [];
      }
      this.localData.capState.reservations.push({
        id: reservationId,
        status: 'RESERVED',
        timestamp: Date.now(),
      });
      this.saveLocalData();
      return { allowed: true, count: this.localData.capState.dailySignalCount, cap: limit, reservationId };
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
            lastScanTime: this.localData.capState.lastScanTime || 0,
            reservations: [],
          };
        } else {
          data = snap.data() as DailyCapState;
          if (data.date !== today) {
            data = {
              date: today,
              dailySignalCount: 0,
              dailySignalCap: data.dailySignalCap || limit,
              lastScanTime: typeof data.lastScanTime === 'number' ? data.lastScanTime : (this.localData.capState.lastScanTime || 0),
              reservations: [],
            };
          }
        }

        const currentLimit = data.dailySignalCap || limit;
        if (data.dailySignalCount >= currentLimit) {
          return { allowed: false, count: data.dailySignalCount, cap: currentLimit };
        }

        const newCount = data.dailySignalCount + 1;
        const reservations = data.reservations || [];
        reservations.push({
          id: reservationId,
          status: 'RESERVED',
          timestamp: Date.now(),
        });

        const updated: DailyCapState = {
          date: today,
          dailySignalCount: newCount,
          dailySignalCap: currentLimit,
          lastScanTime: typeof data.lastScanTime === 'number' ? data.lastScanTime : (this.localData.capState.lastScanTime || 0),
          reservations,
        };
        tx.set(docRef, updated);
        return { allowed: true, count: newCount, cap: currentLimit, reservationId, reservations };
      });

      if (result.allowed) {
        this.localData.capState.dailySignalCount = result.count;
        this.localData.capState.reservations = (result as any).reservations;
        this.saveLocalData();
      }
      return {
        allowed: result.allowed,
        count: result.count,
        cap: result.cap,
        reservationId: result.reservationId,
      };
    } catch (err) {
      logger.error('[ScannerPersistence] Transaction tryIncrementCap failed:', { error: String(err) });
      if (this.isProductionMode()) {
        return { allowed: false, count: 0, cap: limit };
      }
      if (this.localData.capState.dailySignalCount >= limit) {
        return { allowed: false, count: this.localData.capState.dailySignalCount, cap: limit };
      }
      this.localData.capState.dailySignalCount += 1;
      if (!this.localData.capState.reservations) {
        this.localData.capState.reservations = [];
      }
      this.localData.capState.reservations.push({
        id: reservationId,
        status: 'RESERVED',
        timestamp: Date.now(),
      });
      this.saveLocalData();
      return { allowed: true, count: this.localData.capState.dailySignalCount, cap: limit, reservationId };
    }
  }

  /**
   * Commits a previously reserved daily cap count.
   */
  static async commitCap(reservationId?: string): Promise<{ success: boolean; error?: string }> {
    if (!reservationId) {
      logger.warn('[ScannerPersistence] commitCap called without a reservationId. No-op.');
      return { success: false, error: 'Missing reservationId' };
    }
    this.init();
    const today = new Date().toISOString().split('T')[0];
    const firestore = getFirestoreAdmin();

    if (!firestore) {
      if (!this.isProductionMode()) {
        const reservations = this.localData.capState.reservations || [];
        const res = reservations.find(r => r.id === reservationId);
        if (res && res.status === 'RESERVED') {
          res.status = 'COMMITTED';
          this.saveLocalData();
          logger.info(`[ScannerPersistence] Committed reservation locally: ${reservationId}`);
        }
      }
      return { success: true };
    }

    try {
      const docRef = firestore.doc(FIRESTORE_CAP_DOC);
      await firestore.runTransaction(async (tx) => {
        const snap = await tx.get(docRef);
        if (snap.exists) {
          const data = snap.data() as DailyCapState;
          if (data.date === today) {
            const reservations = data.reservations || [];
            const res = reservations.find(r => r.id === reservationId);
            if (res && res.status === 'RESERVED') {
              res.status = 'COMMITTED';
              tx.set(docRef, data);
            }
          }
        }
      });
      return { success: true };
    } catch (err) {
      logger.warn('[ScannerPersistence] commitCap Firestore transaction failed:', { error: String(err) });
      return { success: false, error: String(err) };
    }
  }

  /**
   * Releases/rolls back a previously reserved cap count if persistence fails.
   */
  static async releaseCap(reservationId?: string): Promise<void> {
    if (!reservationId) {
      logger.warn('[ScannerPersistence] releaseCap called without a reservationId. No-op to prevent unowned count decrement.');
      return;
    }
    this.init();
    const today = new Date().toISOString().split('T')[0];
    const firestore = getFirestoreAdmin();

    if (!firestore) {
      if (!this.isProductionMode()) {
        const reservations = this.localData.capState.reservations || [];
        const res = reservations.find(r => r.id === reservationId);
        if (res && res.status === 'RESERVED') {
          res.status = 'RELEASED';
          if (this.localData.capState.dailySignalCount > 0) {
            this.localData.capState.dailySignalCount -= 1;
          }
          this.saveLocalData();
          logger.info(`[ScannerPersistence] Released reservation locally: ${reservationId}`);
        } else {
          logger.warn(`[ScannerPersistence] Local reservation ${reservationId} not found or not in RESERVED state.`);
        }
      }
      return;
    }

    try {
      const docRef = firestore.doc(FIRESTORE_CAP_DOC);
      const updatedData = await firestore.runTransaction(async (tx) => {
        const snap = await tx.get(docRef);
        if (snap.exists) {
          const data = snap.data() as DailyCapState;
          if (data.date === today) {
            const reservations = data.reservations || [];
            const res = reservations.find(r => r.id === reservationId);
            if (res && res.status === 'RESERVED') {
              res.status = 'RELEASED';
              if (data.dailySignalCount > 0) {
                data.dailySignalCount -= 1;
              }
              tx.set(docRef, data);
              return data;
            }
          }
        }
        return null;
      });

      if (updatedData) {
        this.localData.capState.dailySignalCount = updatedData.dailySignalCount;
        this.localData.capState.reservations = updatedData.reservations;
        this.saveLocalData();
      }
    } catch (err) {
      logger.warn('[ScannerPersistence] releaseCap Firestore transaction failed:', { error: String(err) });
    }
  }

  /**
   * Records a validated sent signal with strict persistence confirmation.
   */
  static async recordSentSignal(signal: TradingSignal): Promise<{ success: boolean; persistedId?: string; error?: string }> {
    this.init();

    // GATE 79: Reject non-tradeable signals from sent signals persistence
    if (signal.isTradeableSignal !== true || signal.signalClassification !== 'TRADEABLE') {
      logger.warn(`[ScannerPersistence] Rejecting non-tradeable signal from persistence: ${signal.symbol}. Classification: ${signal.signalClassification}`);
      return { success: false, error: 'Rejected: Signal is not tradeable' };
    }

    const today = new Date().toISOString().split('T')[0];
    const now = Date.now();

    const firestore = getFirestoreAdmin();
    if (!firestore && this.isProductionMode()) {
      const errStr = '[ScannerPersistence] FAIL CLOSED: Cannot record sent signal without Firestore in production mode.';
      logger.error(errStr);
      return { success: false, error: errStr };
    }

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
      tp1Rr: signal.tp1Rr,
      tp2Rr: signal.tp2Rr,
      tp3Rr: signal.tp3Rr,
      riskRewardRatio: signal.riskRewardRatio,
      targetQualityScore: signal.targetQualityScore,
      score: signal.score || signal.confidenceScore || 72,
      rankTier: signal.rankTier || (signal.isBestTrade ? 'BEST_TRADE' : signal.isSecondBest ? 'SECOND_BEST' : 'SUGGESTION'),
      strategy: signal.strategy,
      timeframe: signal.timeframe,
      dataSource: signal.dataSource,
      status: signal.status || 'WAITING_ENTRY',
      timestamp: signal.timestamp || now,
      expiresAt: signal.expiresAt || ((signal.timestamp || now) + serverConfig.getConfig().signalExpirationMs),
      notificationSent: true,
      notificationTimestamp: now,
      date: today,
      estimatedWinRate: signal.estimatedWinRate,
      aiAssessment: signal.aiAssessment,
      marketRegime: signal.marketRegime || 'UNKNOWN',
      isTradeableSignal: signal.isTradeableSignal,
      signalClassification: signal.signalClassification,
    };

    if (!firestore) {
      if (this.isProductionMode()) {
        return { success: false, error: 'Firestore required in production mode' };
      }
      this.localData.sentSignals.push(persisted);
      this.saveLocalData();
      return { success: true, persistedId: persisted.id };
    }

    try {
      const cleanData = JSON.parse(JSON.stringify(persisted));
      await firestore.collection(FIRESTORE_SIGNALS_COL).doc(persisted.id).set(cleanData);
      if (!this.isProductionMode()) {
        this.localData.sentSignals.push(persisted);
        this.saveLocalData();
      }
      return { success: true, persistedId: persisted.id };
    } catch (err) {
      const errStr = String(err);
      logger.error('[ScannerPersistence] Firestore recordSentSignal failed:', { error: errStr });
      if (this.isProductionMode()) {
        return { success: false, error: errStr };
      }
      // Development local fallback
      this.localData.sentSignals.push(persisted);
      this.saveLocalData();
      return { success: true, persistedId: persisted.id };
    }
  }

  /**
   * Clears/deletes all sent signals and resets daily cap state in development.
   */
  static async clearSentSignals(): Promise<void> {
    this.init();
    if (!this.isProductionMode()) {
      this.localData.sentSignals = [];
      this.localData.notifications = [];
      this.localData.capState = {
        date: new Date().toISOString().split('T')[0],
        dailySignalCount: 0,
        dailySignalCap: serverConfig?.getConfig?.()?.thresholds?.dailySignalCap || 10,
        lastScanTime: this.localData.capState.lastScanTime || 0,
      };
      this.saveLocalData();
    }

    const firestore = getFirestoreAdmin();
    if (firestore) {
      try {
        const collections = [FIRESTORE_SIGNALS_COL, FIRESTORE_NOTIFICATIONS_COL, FIRESTORE_REJECTIONS_COL];
        for (const col of collections) {
          const snapshot = await firestore.collection(col).get();
          if (!snapshot.empty) {
            let count = 0;
            let batch = firestore.batch();
            for (const doc of snapshot.docs) {
              batch.delete(doc.ref);
              count++;
              if (count % 400 === 0) {
                await batch.commit();
                batch = firestore.batch();
              }
            }
            if (count % 400 !== 0) {
              await batch.commit();
            }
          }
        }

        const capDocRef = firestore.doc(FIRESTORE_CAP_DOC);
        await firestore.runTransaction(async (transaction) => {
          const capSnap = await transaction.get(capDocRef);
          const currentLastScan = capSnap.exists && typeof capSnap.data()?.lastScanTime === 'number'
            ? capSnap.data()!.lastScanTime
            : (this.localData.capState.lastScanTime || 0);

          transaction.set(capDocRef, {
            date: new Date().toISOString().split('T')[0],
            dailySignalCount: 0,
            dailySignalCap: serverConfig?.getConfig?.()?.thresholds?.dailySignalCap || 10,
            lastScanTime: currentLastScan,
          });
        });
      } catch (err) {
        logger.warn('[ScannerPersistence] Firestore clearSentSignals failed:', { error: String(err) });
      }
    } else if (this.isProductionMode()) {
      logger.error('[ScannerPersistence] FAIL CLOSED: Cannot clear sent signals without Firestore in production.');
    }
  }

  /**
   * Deletes a single sent signal by ID or snapshotId from memory, disk, and Firestore.
   */
  static async deleteSentSignal(id: string): Promise<boolean> {
    this.init();

    let deletedLocally = false;
    if (!this.isProductionMode()) {
      const initialLength = this.localData.sentSignals.length;
      this.localData.sentSignals = this.localData.sentSignals.filter((s) => s.id !== id && s.snapshotId !== id);
      deletedLocally = this.localData.sentSignals.length < initialLength;
      if (deletedLocally) {
        this.saveLocalData();
      }
    }

    let deletedInFirestore = false;
    const firestore = getFirestoreAdmin();
    if (firestore) {
      try {
        const query = await firestore
          .collection(FIRESTORE_SIGNALS_COL)
          .doc(id)
          .get();

        if (query.exists) {
          await firestore.collection(FIRESTORE_SIGNALS_COL).doc(id).delete();
          deletedInFirestore = true;
        } else {
          // Try querying by snapshotId
          const snapshotById = await firestore
            .collection(FIRESTORE_SIGNALS_COL)
            .where('snapshotId', '==', id)
            .get();
          if (!snapshotById.empty) {
            const batch = firestore.batch();
            snapshotById.docs.forEach((doc) => {
              batch.delete(doc.ref);
            });
            await batch.commit();
            deletedInFirestore = true;
          }
        }
      } catch (err) {
        logger.error('[ScannerPersistence] Firestore deleteSentSignal failed:', { error: String(err) });
        throw err;
      }
    } else if (this.isProductionMode()) {
      logger.error('[ScannerPersistence] FAIL CLOSED: Cannot delete sent signal without Firestore in production.');
      return false;
    }

    return deletedLocally || deletedInFirestore;
  }

  /**
   * Records a deleted signal ID and its setup parameters to prevent the scanner from reinserting it.
   */
  static async recordDeletedSignal(id: string, symbol?: string, direction?: string): Promise<void> {
    this.init();
    const today = new Date().toISOString().split('T')[0];

    let sym = symbol || '';
    let dir = direction || '';

    // If symbol or direction is not provided, try to find it from Firestore first
    const firestore = getFirestoreAdmin();
    if ((!sym || !dir) && firestore) {
      try {
        const doc = await firestore.collection(FIRESTORE_SIGNALS_COL).doc(id).get();
        if (doc.exists) {
          const data = doc.data();
          sym = sym || data?.symbol || '';
          dir = dir || data?.direction || '';
        }
      } catch (err) {
        logger.debug('[ScannerPersistence] Could not fetch signal doc during recordDeletedSignal:', err);
      }
    }

    if (!this.localData.deletedSignals) {
      this.localData.deletedSignals = [];
    }
    // Locally store as "id|symbol|direction" to keep it simple and backward compatible
    const localStr = `${id}|${sym}|${dir}`;
    if (!this.localData.deletedSignals.includes(localStr)) {
      this.localData.deletedSignals.push(localStr);
      this.saveLocalData();
    }

    if (firestore) {
      try {
        await firestore
          .collection(FIRESTORE_DELETED_COL)
          .doc(id)
          .set({
            id,
            symbol: sym,
            direction: dir,
            deletedAt: Date.now(),
            date: today,
          });
      } catch (err) {
        logger.error('[ScannerPersistence] Firestore recordDeletedSignal failed:', { error: String(err) });
        throw err;
      }
    }
  }

  /**
   * Retrieves all deleted signal records today.
   */
  static async getDeletedSignals(): Promise<Array<{ id: string; symbol: string; direction: string }>> {
    this.init();
    const today = new Date().toISOString().split('T')[0];

    const records: Array<{ id: string; symbol: string; direction: string }> = [];

    const firestore = getFirestoreAdmin();
    if (firestore) {
      try {
        const query = await firestore
          .collection(FIRESTORE_DELETED_COL)
          .where('date', '==', today)
          .get();

        query.forEach((doc) => {
          const data = doc.data();
          records.push({
            id: doc.id,
            symbol: data?.symbol || '',
            direction: data?.direction || '',
          });
        });

        // Merge with local if not production
        if (!this.isProductionMode() && this.localData.deletedSignals) {
          for (const localStr of this.localData.deletedSignals) {
            const [localId, localSym, localDir] = localStr.split('|');
            if (!records.some((r) => r.id === localId)) {
              records.push({
                id: localId,
                symbol: localSym || '',
                direction: localDir || '',
              });
            }
          }
        }
        return records;
      } catch (err) {
        logger.warn('[ScannerPersistence] Firestore getDeletedSignals failed:', { error: String(err) });
      }
    }

    if (this.localData.deletedSignals) {
      for (const localStr of this.localData.deletedSignals) {
        const [localId, localSym, localDir] = localStr.includes('|') ? localStr.split('|') : [localStr, '', ''];
        records.push({
          id: localId,
          symbol: localSym || '',
          direction: localDir || '',
        });
      }
    }
    return records;
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
          // Merge with local signals if not production
          const map = new Map<string, PersistedSentSignal>();
          if (!this.isProductionMode()) {
            for (const s of this.localData.sentSignals.filter((s) => s.date === today)) {
              map.set(s.id, s);
            }
          }
          for (const s of signals) {
            map.set(s.id, s);
          }
          return Array.from(map.values()).sort((a, b) => b.timestamp - a.timestamp);
        }
      } catch (err) {
        logger.warn('[ScannerPersistence] Firestore getSentSignalsToday failed:', { error: String(err) });
      }
    }

    if (this.isProductionMode()) {
      logger.error('[ScannerPersistence] FAIL CLOSED: Cannot read sent signals from local disk in production mode.');
      return [];
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

    if (!this.isProductionMode()) {
      this.localData.rejectedCandidates.push(...newItems);
      this.saveLocalData();
    }

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
    } else if (this.isProductionMode()) {
      logger.error('[ScannerPersistence] FAIL CLOSED: Cannot record rejected candidates without Firestore in production.');
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
          .get();

        if (!query.empty) {
          const items: PersistedRejectedCandidate[] = [];
          query.forEach((doc) => items.push(doc.data() as PersistedRejectedCandidate));

          const map = new Map<string, PersistedRejectedCandidate>();
          if (!this.isProductionMode()) {
            for (const c of this.localData.rejectedCandidates.filter((c) => c.date === today)) {
              map.set(c.id, c);
            }
          }
          for (const c of items) {
            map.set(c.id, c);
          }
          return Array.from(map.values())
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, limit);
        }
      } catch (err) {
        logger.debug('[ScannerPersistence] Firestore getRejectedCandidatesToday error:', { error: String(err) });
      }
    }

    if (this.isProductionMode()) {
      logger.error('[ScannerPersistence] FAIL CLOSED: Cannot read rejected candidates from local disk in production mode.');
      return [];
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
    type: 'BEST_TRADE' | 'HIGH_QUALITY' | 'NO_TRADE' | 'SETUP_UPDATE' | 'TRADE_UPDATE';
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
      ...(notification.score !== undefined ? { score: notification.score } : {}),
      ...(notification.rankTier !== undefined ? { rankTier: notification.rankTier } : {}),
      date: today,
    };

    if (!this.isProductionMode()) {
      this.localData.notifications.push(item);
      this.saveLocalData();
    }

    const firestore = getFirestoreAdmin();
    if (firestore) {
      try {
        const firestoreData = JSON.parse(JSON.stringify(item));
        await firestore.collection(FIRESTORE_NOTIFICATIONS_COL).doc(item.id).set(firestoreData);
      } catch (err) {
        logger.warn('[ScannerPersistence] Firestore recordNotification failed:', { error: String(err) });
      }
    } else if (this.isProductionMode()) {
      logger.error('[ScannerPersistence] FAIL CLOSED: Cannot record notification without Firestore in production.');
    }
  }

  /**
   * Deletes a single notification by ID.
   */
  static async deleteNotification(id: string): Promise<boolean> {
    this.init();
    let deletedLocally = false;
    
    if (!this.isProductionMode()) {
      const initialLength = this.localData.notifications.length;
      this.localData.notifications = this.localData.notifications.filter((n) => n.id !== id);
      deletedLocally = this.localData.notifications.length < initialLength;
      if (deletedLocally) {
        this.saveLocalData();
      }
    }

    let deletedInFirestore = false;
    const firestore = getFirestoreAdmin();
    if (firestore) {
      try {
        const query = await firestore
          .collection(FIRESTORE_NOTIFICATIONS_COL)
          .doc(id)
          .get();
        if (query.exists) {
          await firestore.collection(FIRESTORE_NOTIFICATIONS_COL).doc(id).delete();
          deletedInFirestore = true;
        } else {
          // If the ID is a signal snapshot ID instead of a notification ID, we should try querying by it
          const snapshotQuery = await firestore
            .collection(FIRESTORE_NOTIFICATIONS_COL)
            .where('snapshotId', '==', id)
            .get();
          if (!snapshotQuery.empty) {
            const batch = firestore.batch();
            snapshotQuery.forEach(doc => batch.delete(doc.ref));
            await batch.commit();
            deletedInFirestore = true;
          }
        }
      } catch (err) {
        logger.error('[ScannerPersistence] Firestore deleteNotification error', { error: String(err) });
        throw err;
      }
    } else if (this.isProductionMode()) {
      logger.error('[ScannerPersistence] FAIL CLOSED: Cannot delete notification without Firestore in production.');
      return false;
    }

    return deletedLocally || deletedInFirestore;
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
        logger.debug('[ScannerPersistence] Firestore getNotificationHistory error');
      }
    }

    if (this.isProductionMode()) {
      logger.error('[ScannerPersistence] FAIL CLOSED: Cannot read notification history from local disk in production mode.');
      return [];
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
    if (!this.isProductionMode()) {
      const target = this.localData.sentSignals.find((s) => s.id === signalId);
      if (target) {
        target.status = status;
        if (metadata) {
          Object.assign(target, metadata);
        }
        this.saveLocalData();
      }
    }

    const firestore = getFirestoreAdmin();
    if (firestore) {
      try {
        const updatePayload: Record<string, any> = { status };
        if (metadata) {
          for (const [key, val] of Object.entries(metadata)) {
            if (val !== undefined) {
              updatePayload[key] = val;
            }
          }
        }
        await firestore.collection(FIRESTORE_SIGNALS_COL).doc(signalId).set(updatePayload, { merge: true });
      } catch (err) {
        logger.warn('[ScannerPersistence] Firestore updateSignalStatus failed:', { error: String(err) });
      }
    } else if (this.isProductionMode()) {
      logger.error('[ScannerPersistence] FAIL CLOSED: Cannot update signal status without Firestore in production.');
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
    if (!this.isProductionMode()) {
      const target = this.localData.sentSignals.find((s) => s.id === signalIdOrSnapshotId || s.snapshotId === signalIdOrSnapshotId);
      if (target) {
        target.tp1 = tp1;
        target.tp2 = tp2;
        target.tp3 = tp3;
        target.takeProfit = takeProfit;
        target.riskRewardRatio = riskRewardRatio;
        this.saveLocalData();
      }
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
    } else if (this.isProductionMode()) {
      logger.error('[ScannerPersistence] FAIL CLOSED: Cannot update signal TPs without Firestore in production.');
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
          query.forEach((doc) => {
            const data = doc.data() as PersistedSentSignal;
            if (data && data.isTradeableSignal === true && data.signalClassification === 'TRADEABLE') {
              signals.push(data);
            }
          });
        }

        // Also query other potential non-terminal progressive statuses to ensure active monitoring of progressive levels
        const activeOrProgressive = ['TP1_HIT', 'TP2_HIT', 'WAITING_ENTRY'];
        for (const stat of activeOrProgressive) {
          const q = await firestore
            .collection(FIRESTORE_SIGNALS_COL)
            .where('status', '==', stat)
            .get();
          if (!q.empty) {
            q.forEach((doc) => {
              const data = doc.data() as PersistedSentSignal;
              if (data && data.isTradeableSignal === true && data.signalClassification === 'TRADEABLE') {
                signals.push(data);
              }
            });
          }
        }

        if (!this.isProductionMode()) {
          const firestoreActiveIds = new Set(signals.map((s) => s.id));
          const localActive = this.localData.sentSignals.filter((s) => 
            s.isTradeableSignal === true && s.signalClassification === 'TRADEABLE' &&
            (s.status === 'ACTIVE' || s.status === 'TP1_HIT' || s.status === 'TP2_HIT' || s.status === 'WAITING_ENTRY')
          );

          const missingFromActive = localActive.filter((s) => !firestoreActiveIds.has(s.id));
          let localUpdated = false;

          if (missingFromActive.length > 0) {
            await Promise.all(
              missingFromActive.map(async (localSig) => {
                try {
                  const docRef = firestore.collection(FIRESTORE_SIGNALS_COL).doc(localSig.id);
                  const docSnap = await docRef.get();
                  if (!docSnap.exists) {
                    // Completely deleted in Firestore -> remove locally
                    this.localData.sentSignals = this.localData.sentSignals.filter((s) => s.id !== localSig.id);
                    localUpdated = true;
                  } else {
                    // Updated to terminal status in Firestore -> sync status locally
                    const fsData = docSnap.data();
                    if (fsData && fsData.status) {
                      const target = this.localData.sentSignals.find((s) => s.id === localSig.id);
                      if (target) {
                        target.status = fsData.status;
                        localUpdated = true;
                      }
                    }
                  }
                } catch (docErr) {
                  logger.warn(`[ScannerPersistence] Failed to reconcile missing active signal ${localSig.id}:`, docErr);
                }
              })
            );
          }

          if (localUpdated) {
            this.saveLocalData();
          }
        }

        return signals.sort((a, b) => b.timestamp - a.timestamp);
      } catch (err) {
        logger.warn('[ScannerPersistence] Firestore getActiveSignals failed:', { error: String(err) });
      }
    }

    if (this.isProductionMode()) {
      logger.error('[ScannerPersistence] FAIL CLOSED: Cannot read active signals from local disk in production mode.');
      return [];
    }

    return this.localData.sentSignals
      .filter((s) => s.isTradeableSignal === true && s.signalClassification === 'TRADEABLE' && (s.status === 'ACTIVE' || s.status === 'TP1_HIT' || s.status === 'TP2_HIT' || s.status === 'WAITING_ENTRY'))
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Retrieves all sent signals from Firestore or local data.
   */
  static async getSentSignals(): Promise<PersistedSentSignal[]> {
    this.init();
    const firestore = getFirestoreAdmin();
    if (firestore) {
      try {
        const query = await firestore.collection(FIRESTORE_SIGNALS_COL).get();
        if (!query.empty) {
          const res: PersistedSentSignal[] = [];
          query.forEach((doc) => {
            const data = doc.data() as PersistedSentSignal;
            if (data && data.id) res.push(data);
          });
          return res;
        }
      } catch (err) {
        logger.warn('[ScannerPersistence] Failed to fetch sent signals from Firestore:', { error: String(err) });
      }
    }
    return this.localData.sentSignals || [];
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
   * Updates external cron trigger execution timestamp.
   */
  static async updateLastCronExecution(timestamp = Date.now()): Promise<void> {
    this.init();
    logger.info(`[ScannerPersistence] WRITING lastCronExecution: ${timestamp} (${new Date(timestamp).toISOString()})`);
    
    this.localData.capState.lastCronExecution = timestamp;
    this.localData.capState.lastCronTriggerTime = timestamp;
    this.saveLocalData();

    const firestore = getFirestoreAdmin();
    if (firestore) {
      try {
        await firestore
          .doc(FIRESTORE_CAP_DOC)
          .set({ lastCronExecution: timestamp, lastCronTriggerTime: timestamp }, { merge: true });
      } catch (err) {
        logger.warn('[ScannerPersistence] Failed to update lastCronExecution in Firestore:', { error: String(err) });
      }
    }
  }

  /**
   * Updates actual automated market scan engine metrics.
   * MAY ONLY BE CALLED when Market Scan Engine actually executes from /api/scanner/trigger (isExternal = true).
   * NEVER updated from UI activity, page loads, manual signal generation, heartbeat, scheduler checks, or skipped requests.
   */
  static async recordAutomatedScanMetrics(metrics: {
    lastAutomatedScan: number;
    lastScanCompletedAt: number;
    lastScanDuration: number;
    lastCandidatesEvaluated: number;
    lastSignalsFound: number;
    lastAcceptedSignals: number;
    universeSymbolsScanned?: number;
    preliminaryCandidatesFound?: number;
    candidatesRejectedPreliminary?: number;
    candidatesEvaluated?: number;
    candidatesRejectedFinal?: number;
    signalsGenerated?: number;
    signalsAccepted?: number;
  }): Promise<void> {
    this.init();
    logger.info(`[ScannerPersistence] WRITING lastAutomatedScan metrics:`, metrics);

    this.localData.capState.lastAutomatedScan = metrics.lastAutomatedScan;
    this.localData.capState.lastScanTime = metrics.lastAutomatedScan;
    this.localData.capState.lastScanCompletedAt = metrics.lastScanCompletedAt;
    this.localData.capState.lastScanDuration = metrics.lastScanDuration;
    this.localData.capState.lastCandidatesEvaluated = metrics.lastCandidatesEvaluated;
    this.localData.capState.lastSignalsFound = metrics.lastSignalsFound;
    this.localData.capState.lastAcceptedSignals = metrics.lastAcceptedSignals;

    if (metrics.universeSymbolsScanned !== undefined) this.localData.capState.universeSymbolsScanned = metrics.universeSymbolsScanned;
    if (metrics.preliminaryCandidatesFound !== undefined) this.localData.capState.preliminaryCandidatesFound = metrics.preliminaryCandidatesFound;
    if (metrics.candidatesRejectedPreliminary !== undefined) this.localData.capState.candidatesRejectedPreliminary = metrics.candidatesRejectedPreliminary;
    if (metrics.candidatesEvaluated !== undefined) this.localData.capState.candidatesEvaluated = metrics.candidatesEvaluated;
    if (metrics.candidatesRejectedFinal !== undefined) this.localData.capState.candidatesRejectedFinal = metrics.candidatesRejectedFinal;
    if (metrics.signalsGenerated !== undefined) this.localData.capState.signalsGenerated = metrics.signalsGenerated;
    if (metrics.signalsAccepted !== undefined) this.localData.capState.signalsAccepted = metrics.signalsAccepted;

    this.saveLocalData();

    const firestore = getFirestoreAdmin();
    if (firestore) {
      try {
        const payload: Record<string, any> = {
          lastAutomatedScan: metrics.lastAutomatedScan,
          lastScanTime: metrics.lastAutomatedScan,
          lastScanCompletedAt: metrics.lastScanCompletedAt,
          lastScanDuration: metrics.lastScanDuration,
          lastCandidatesEvaluated: metrics.lastCandidatesEvaluated,
          lastSignalsFound: metrics.lastSignalsFound,
          lastAcceptedSignals: metrics.lastAcceptedSignals,
        };
        if (metrics.universeSymbolsScanned !== undefined) payload.universeSymbolsScanned = metrics.universeSymbolsScanned;
        if (metrics.preliminaryCandidatesFound !== undefined) payload.preliminaryCandidatesFound = metrics.preliminaryCandidatesFound;
        if (metrics.candidatesRejectedPreliminary !== undefined) payload.candidatesRejectedPreliminary = metrics.candidatesRejectedPreliminary;
        if (metrics.candidatesEvaluated !== undefined) payload.candidatesEvaluated = metrics.candidatesEvaluated;
        if (metrics.candidatesRejectedFinal !== undefined) payload.candidatesRejectedFinal = metrics.candidatesRejectedFinal;
        if (metrics.signalsGenerated !== undefined) payload.signalsGenerated = metrics.signalsGenerated;
        if (metrics.signalsAccepted !== undefined) payload.signalsAccepted = metrics.signalsAccepted;

        await firestore.doc(FIRESTORE_CAP_DOC).set(payload, { merge: true });
        logger.info(`[ScannerPersistence] Firestore lastAutomatedScan metrics successfully synchronized.`);
      } catch (err) {
        logger.warn('[ScannerPersistence] Failed to update lastAutomatedScan metrics in Firestore:', { error: String(err) });
      }
    } else if (this.isProductionMode()) {
      logger.error('[ScannerPersistence] FAIL CLOSED: Cannot update scan metrics without Firestore in production.');
    }
  }

  /**
   * Updates last scan time in local disk persistence and Firestore.
   * Only called during actual market scan executions.
   */
  static async updateLastScanTime(timestamp = Date.now(), reason = 'UNSPECIFIED_SCAN_EVENT'): Promise<void> {
    this.init();
    logger.info(`[ScannerPersistence] WRITING lastScanTime: ${timestamp} (${new Date(timestamp).toISOString()}) | Reason: ${reason}`);
    
    this.localData.capState.lastScanTime = timestamp;
    this.localData.capState.lastAutomatedScan = timestamp;
    this.saveLocalData();

    const firestore = getFirestoreAdmin();
    if (firestore) {
      try {
        await firestore
          .doc(FIRESTORE_CAP_DOC)
          .set({ lastScanTime: timestamp, lastAutomatedScan: timestamp }, { merge: true });
        logger.info(`[ScannerPersistence] Firestore lastScanTime successfully synchronized: ${timestamp}`);
      } catch (err) {
        logger.warn('[ScannerPersistence] Failed to update lastScanTime in Firestore:', { error: String(err) });
      }
    } else if (this.isProductionMode()) {
      logger.error('[ScannerPersistence] FAIL CLOSED: Cannot update lastScanTime without Firestore in production.');
    }
  }

  /**
   * Records the timestamp of an external cron-job.org HTTP heartbeat/trigger ping.
   * Completely independent of lastScanTime (does not modify market scan state or schedule).
   */
  static async updateLastCronTriggerTime(timestamp = Date.now()): Promise<void> {
    this.init();
    logger.info(`[ScannerPersistence] Recording external cron trigger ping: ${timestamp} (${new Date(timestamp).toISOString()})`);

    this.localData.capState.lastCronTriggerTime = timestamp;
    this.saveLocalData();

    const firestore = getFirestoreAdmin();
    if (firestore) {
      try {
        await firestore
          .doc(FIRESTORE_CAP_DOC)
          .set({ lastCronTriggerTime: timestamp }, { merge: true });
      } catch (err) {
        logger.warn('[ScannerPersistence] Failed to update lastCronTriggerTime in Firestore:', { error: String(err) });
      }
    }
  }

  /**
   * Attempts to atomically acquire a scanner execution lock for concurrency protection across Vercel serverless containers.
   * Lock auto-expires after lockTimeoutMs (default 5 minutes) to recover from orphaned crashed instances.
   */
  static async tryAcquireLock(instanceId: string, lockTimeoutMs = 300000): Promise<{ acquired: boolean; reason?: string }> {
    this.init();
    const now = Date.now();

    const firestore = getFirestoreAdmin();
    if (!firestore) {
      if (this.isProductionMode()) {
        logger.error('[ScannerPersistence] FAIL CLOSED: Firestore required to acquire lock in production mode.');
        return { acquired: false, reason: 'FAIL CLOSED: Production mode requires Firestore to acquire concurrency lock across serverless instances.' };
      }
      if (this.localLock.isScanning && now - this.localLock.lockAcquiredAt < lockTimeoutMs) {
        return { acquired: false, reason: 'Scan lock currently held in local process.' };
      }
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
      logger.warn('[ScannerPersistence] Firestore tryAcquireLock error:', { error: String(err) });
      if (this.isProductionMode()) {
        return { acquired: false, reason: 'FAIL CLOSED: Firestore lock transaction failed in production mode.' };
      }
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
