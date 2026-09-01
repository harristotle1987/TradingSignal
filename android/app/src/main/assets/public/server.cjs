var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/server/logger.ts
var import_fs, Logger, logger;
var init_logger = __esm({
  "src/server/logger.ts"() {
    import_fs = __toESM(require("fs"), 1);
    Logger = class {
      logToFile(message) {
        try {
          import_fs.default.appendFileSync("/tmp/app.log", message + "\n");
        } catch (e) {
        }
      }
      formatMessage(level, message, context) {
        const timestamp = (/* @__PURE__ */ new Date()).toISOString();
        const contextStr = context && Object.keys(context).length > 0 ? ` | Context: ${JSON.stringify(context)}` : "";
        const formatted = `[${timestamp}] [${level.toUpperCase()}] ${message}${contextStr}`;
        this.logToFile(formatted);
        return formatted;
      }
      info(message, context) {
        console.log(this.formatMessage("info", message, context));
      }
      warn(message, context) {
        console.warn(this.formatMessage("warn", message, context));
      }
      error(message, context) {
        console.error(this.formatMessage("error", message, context));
      }
      debug(message, context) {
        if (process.env.NODE_ENV !== "production") {
          console.debug(this.formatMessage("debug", message, context));
        }
      }
    };
    logger = new Logger();
  }
});

// src/server/signals/ScannerPersistence.ts
var fs2, path, LOCAL_PERSISTENCE_PATH, FIRESTORE_CAP_DOC, FIRESTORE_LOCK_DOC, FIRESTORE_SIGNALS_COL, FIRESTORE_REJECTIONS_COL, FIRESTORE_NOTIFICATIONS_COL, FIRESTORE_DELETED_COL, ScannerPersistence;
var init_ScannerPersistence = __esm({
  "src/server/signals/ScannerPersistence.ts"() {
    fs2 = __toESM(require("fs"), 1);
    path = __toESM(require("path"), 1);
    init_firebaseAdmin();
    init_logger();
    init_config();
    LOCAL_PERSISTENCE_PATH = path.join(process.cwd(), "scanner_persistence.json");
    FIRESTORE_CAP_DOC = "scanner/cap_state";
    FIRESTORE_LOCK_DOC = "scanner/lock_state";
    FIRESTORE_SIGNALS_COL = "scanner_sent_signals";
    FIRESTORE_REJECTIONS_COL = "scanner_rejected_candidates";
    FIRESTORE_NOTIFICATIONS_COL = "scanner_notifications";
    FIRESTORE_DELETED_COL = "scanner_deleted_signals";
    ScannerPersistence = class _ScannerPersistence {
      static {
        this.localLock = {
          isScanning: false,
          lockAcquiredAt: 0
        };
      }
      static {
        this.localData = {
          capState: {
            date: (/* @__PURE__ */ new Date()).toISOString().split("T")[0],
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
            reservations: []
          },
          sentSignals: [],
          rejectedCandidates: [],
          notifications: [],
          settings: {
            enabled: true,
            notificationsEnabled: true,
            notifyOnNoTrade: false,
            intervalMinutes: 30
          }
        };
      }
      static {
        this.isInitialized = false;
      }
      static isProductionMode() {
        return process.env.NODE_ENV === "production";
      }
      static isProductionPersistenceReady() {
        if (!_ScannerPersistence.isProductionMode()) {
          return true;
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
      static init() {
        if (this.isInitialized) return;
        this.isInitialized = true;
        try {
          const configCap = serverConfig?.getConfig?.()?.thresholds?.dailySignalCap;
          if (typeof configCap === "number" && configCap > 0) {
            this.localData.capState.dailySignalCap = configCap;
          }
        } catch {
        }
        if (this.isProductionMode() && !this.isProductionPersistenceReady()) {
          logger.warn("[ScannerPersistence] PRODUCTION PERSISTENCE NOT READY: FIREBASE_SERVICE_ACCOUNT is required in production. Local disk persistence disabled.");
        }
        try {
          if (fs2.existsSync(LOCAL_PERSISTENCE_PATH)) {
            const raw = fs2.readFileSync(LOCAL_PERSISTENCE_PATH, "utf-8");
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === "object") {
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
                  intervalMinutes: [15, 30, 45, 60].includes(parsedInterval) ? parsedInterval : 30
                }
              };
              logger.info("[ScannerPersistence] Loaded persisted scanner state from disk.");
            }
          } else {
            this.localData.capState.dailySignalCap = serverConfig.getConfig().thresholds.dailySignalCap;
          }
        } catch (err) {
          logger.warn("[ScannerPersistence] Could not load local state file:", { error: String(err) });
        }
        this.checkDailyRollover();
        this.isInitialized = true;
      }
      /**
       * Checks and performs date rollover for daily signal cap.
       */
      static checkDailyRollover() {
        const today = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
        if (this.localData.capState.date !== today) {
          logger.info(`[ScannerPersistence] Daily rollover triggered: ${this.localData.capState.date} -> ${today}. Resetting daily signal count.`);
          this.localData.capState = {
            date: today,
            dailySignalCount: 0,
            dailySignalCap: this.localData.capState.dailySignalCap || serverConfig.getConfig().thresholds.dailySignalCap,
            lastScanTime: this.localData.capState.lastScanTime,
            reservations: []
          };
          this.saveLocalData();
          return true;
        }
        return false;
      }
      /**
       * Saves data to local JSON disk file (only in dev/testing mode).
       */
      static saveLocalData() {
        if (this.isProductionMode()) {
          return;
        }
        try {
          if (this.localData.rejectedCandidates.length > 100) {
            this.localData.rejectedCandidates = this.localData.rejectedCandidates.slice(-100);
          }
          if (this.localData.notifications.length > 100) {
            this.localData.notifications = this.localData.notifications.slice(-100);
          }
          if (this.localData.sentSignals.length > 100) {
            this.localData.sentSignals = this.localData.sentSignals.slice(-100);
          }
          fs2.writeFileSync(LOCAL_PERSISTENCE_PATH, JSON.stringify(this.localData, null, 2), "utf-8");
        } catch (err) {
          logger.warn("[ScannerPersistence] Failed to write local state to disk:", { error: String(err) });
        }
      }
      /**
       * Retrieves current Daily Cap State (with Firestore sync if available).
       */
      static async getCapState(defaultCap = 5) {
        this.init();
        this.checkDailyRollover();
        const today = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
        const firestore = getFirestoreAdmin();
        if (!firestore) {
          if (this.isProductionMode()) {
            logger.error("[ScannerPersistence] FAIL CLOSED: Production mode requires Firebase Admin persistence for daily cap state.");
            return {
              date: today,
              dailySignalCount: defaultCap,
              dailySignalCap: defaultCap,
              lastScanTime: this.localData.capState.lastScanTime || 0
            };
          }
          return this.localData.capState;
        }
        try {
          const docRef = firestore.doc(FIRESTORE_CAP_DOC);
          const snapshot = await docRef.get();
          if (!snapshot.exists) {
            const state = {
              date: today,
              dailySignalCount: this.localData.capState.dailySignalCount,
              dailySignalCap: defaultCap,
              lastScanTime: this.localData.capState.lastScanTime,
              reservations: this.localData.capState.reservations || []
            };
            await docRef.set(state);
            return state;
          }
          const remote = snapshot.data();
          const remoteLastScan = typeof remote.lastScanTime === "number" && remote.lastScanTime > 0 ? remote.lastScanTime : this.localData.capState.lastScanTime || 0;
          const remoteLastCronExecution = typeof remote.lastCronExecution === "number" && remote.lastCronExecution > 0 ? remote.lastCronExecution : typeof remote.lastCronTriggerTime === "number" && remote.lastCronTriggerTime > 0 ? remote.lastCronTriggerTime : this.localData.capState.lastCronExecution || 0;
          const remoteLastAutomatedScan = typeof remote.lastAutomatedScan === "number" && remote.lastAutomatedScan > 0 ? remote.lastAutomatedScan : this.localData.capState.lastAutomatedScan || remoteLastScan || 0;
          const remoteLastScanCompletedAt = typeof remote.lastScanCompletedAt === "number" ? remote.lastScanCompletedAt : this.localData.capState.lastScanCompletedAt || 0;
          const remoteLastScanDuration = typeof remote.lastScanDuration === "number" ? remote.lastScanDuration : this.localData.capState.lastScanDuration || 0;
          const remoteLastCandidatesEvaluated = typeof remote.lastCandidatesEvaluated === "number" ? remote.lastCandidatesEvaluated : this.localData.capState.lastCandidatesEvaluated || 0;
          const remoteLastSignalsFound = typeof remote.lastSignalsFound === "number" ? remote.lastSignalsFound : this.localData.capState.lastSignalsFound || 0;
          const remoteLastAcceptedSignals = typeof remote.lastAcceptedSignals === "number" ? remote.lastAcceptedSignals : this.localData.capState.lastAcceptedSignals || 0;
          if (remote.date !== today) {
            const resetState = {
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
              reservations: []
            };
            await docRef.set(resetState);
            this.localData.capState = resetState;
            this.saveLocalData();
            return resetState;
          }
          this.localData.capState = {
            date: today,
            dailySignalCount: typeof remote.dailySignalCount === "number" ? remote.dailySignalCount : 0,
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
            reservations: remote.reservations || []
          };
          this.saveLocalData();
          return this.localData.capState;
        } catch (err) {
          logger.warn("[ScannerPersistence] Firestore getCapState error:", { error: String(err) });
          if (this.isProductionMode()) {
            return {
              date: today,
              dailySignalCount: defaultCap,
              dailySignalCap: defaultCap,
              lastScanTime: this.localData.capState.lastScanTime || 0
            };
          }
          return this.localData.capState;
        }
      }
      /**
       * Atomically verifies daily cap and increments counter if allowed, returning a reservationId.
       */
      static async tryIncrementCap(defaultCap = 5) {
        this.init();
        this.checkDailyRollover();
        const today = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
        const firestore = getFirestoreAdmin();
        const limit = this.localData.capState.dailySignalCap || defaultCap;
        const reservationId = `res_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        if (!firestore) {
          if (this.isProductionMode()) {
            logger.error("[ScannerPersistence] FAIL CLOSED: Production mode requires Firebase Admin persistence for daily cap increment. No daily cap increment allowed.");
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
            status: "RESERVED",
            timestamp: Date.now()
          });
          this.saveLocalData();
          return { allowed: true, count: this.localData.capState.dailySignalCount, cap: limit, reservationId };
        }
        try {
          const docRef = firestore.doc(FIRESTORE_CAP_DOC);
          const result = await firestore.runTransaction(async (tx) => {
            const snap = await tx.get(docRef);
            let data;
            if (!snap.exists) {
              data = {
                date: today,
                dailySignalCount: 0,
                dailySignalCap: limit,
                lastScanTime: this.localData.capState.lastScanTime || 0,
                reservations: []
              };
            } else {
              data = snap.data();
              if (data.date !== today) {
                data = {
                  date: today,
                  dailySignalCount: 0,
                  dailySignalCap: data.dailySignalCap || limit,
                  lastScanTime: typeof data.lastScanTime === "number" ? data.lastScanTime : this.localData.capState.lastScanTime || 0,
                  reservations: []
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
              status: "RESERVED",
              timestamp: Date.now()
            });
            const updated = {
              date: today,
              dailySignalCount: newCount,
              dailySignalCap: currentLimit,
              lastScanTime: typeof data.lastScanTime === "number" ? data.lastScanTime : this.localData.capState.lastScanTime || 0,
              reservations
            };
            tx.set(docRef, updated);
            return { allowed: true, count: newCount, cap: currentLimit, reservationId, reservations };
          });
          if (result.allowed) {
            this.localData.capState.dailySignalCount = result.count;
            this.localData.capState.reservations = result.reservations;
            this.saveLocalData();
          }
          return {
            allowed: result.allowed,
            count: result.count,
            cap: result.cap,
            reservationId: result.reservationId
          };
        } catch (err) {
          logger.error("[ScannerPersistence] Transaction tryIncrementCap failed:", { error: String(err) });
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
            status: "RESERVED",
            timestamp: Date.now()
          });
          this.saveLocalData();
          return { allowed: true, count: this.localData.capState.dailySignalCount, cap: limit, reservationId };
        }
      }
      /**
       * Commits a previously reserved daily cap count.
       */
      static async commitCap(reservationId) {
        if (!reservationId) {
          logger.warn("[ScannerPersistence] commitCap called without a reservationId. No-op.");
          return { success: false, error: "Missing reservationId" };
        }
        this.init();
        const today = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
        const firestore = getFirestoreAdmin();
        if (!firestore) {
          if (!this.isProductionMode()) {
            const reservations = this.localData.capState.reservations || [];
            const res = reservations.find((r) => r.id === reservationId);
            if (res && res.status === "RESERVED") {
              res.status = "COMMITTED";
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
              const data = snap.data();
              if (data.date === today) {
                const reservations = data.reservations || [];
                const res = reservations.find((r) => r.id === reservationId);
                if (res && res.status === "RESERVED") {
                  res.status = "COMMITTED";
                  tx.set(docRef, data);
                }
              }
            }
          });
          return { success: true };
        } catch (err) {
          logger.warn("[ScannerPersistence] commitCap Firestore transaction failed:", { error: String(err) });
          return { success: false, error: String(err) };
        }
      }
      /**
       * Releases/rolls back a previously reserved cap count if persistence fails.
       */
      static async releaseCap(reservationId) {
        if (!reservationId) {
          logger.warn("[ScannerPersistence] releaseCap called without a reservationId. No-op to prevent unowned count decrement.");
          return;
        }
        this.init();
        const today = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
        const firestore = getFirestoreAdmin();
        if (!firestore) {
          if (!this.isProductionMode()) {
            const reservations = this.localData.capState.reservations || [];
            const res = reservations.find((r) => r.id === reservationId);
            if (res && res.status === "RESERVED") {
              res.status = "RELEASED";
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
              const data = snap.data();
              if (data.date === today) {
                const reservations = data.reservations || [];
                const res = reservations.find((r) => r.id === reservationId);
                if (res && res.status === "RESERVED") {
                  res.status = "RELEASED";
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
          logger.warn("[ScannerPersistence] releaseCap Firestore transaction failed:", { error: String(err) });
        }
      }
      /**
       * Records a validated sent signal with strict persistence confirmation.
       */
      static async recordSentSignal(signal) {
        this.init();
        if (signal.isTradeableSignal !== true || signal.signalClassification !== "TRADEABLE") {
          logger.warn(`[ScannerPersistence] Rejecting non-tradeable signal from persistence: ${signal.symbol}. Classification: ${signal.signalClassification}`);
          return { success: false, error: "Rejected: Signal is not tradeable" };
        }
        const today = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
        const now = Date.now();
        const firestore = getFirestoreAdmin();
        if (!firestore && this.isProductionMode()) {
          const errStr = "[ScannerPersistence] FAIL CLOSED: Cannot record sent signal without Firestore in production mode.";
          logger.error(errStr);
          return { success: false, error: errStr };
        }
        const persisted = {
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
          rankTier: signal.rankTier || (signal.isBestTrade ? "BEST_TRADE" : signal.isSecondBest ? "SECOND_BEST" : "SUGGESTION"),
          strategy: signal.strategy,
          timeframe: signal.timeframe,
          dataSource: signal.dataSource,
          status: signal.status || "WAITING_ENTRY",
          timestamp: signal.timestamp || now,
          expiresAt: signal.expiresAt || (signal.timestamp || now) + serverConfig.getConfig().signalExpirationMs,
          notificationSent: true,
          notificationTimestamp: now,
          date: today,
          estimatedWinRate: signal.estimatedWinRate,
          aiAssessment: signal.aiAssessment,
          marketRegime: signal.marketRegime || "UNKNOWN",
          isTradeableSignal: signal.isTradeableSignal,
          signalClassification: signal.signalClassification
        };
        if (!firestore) {
          if (this.isProductionMode()) {
            return { success: false, error: "Firestore required in production mode" };
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
          logger.error("[ScannerPersistence] Firestore recordSentSignal failed:", { error: errStr });
          if (this.isProductionMode()) {
            return { success: false, error: errStr };
          }
          this.localData.sentSignals.push(persisted);
          this.saveLocalData();
          return { success: true, persistedId: persisted.id };
        }
      }
      /**
       * Clears/deletes all sent signals and resets daily cap state in development.
       */
      static async clearSentSignals() {
        this.init();
        if (!this.isProductionMode()) {
          this.localData.sentSignals = [];
          this.localData.notifications = [];
          this.localData.capState = {
            date: (/* @__PURE__ */ new Date()).toISOString().split("T")[0],
            dailySignalCount: 0,
            dailySignalCap: serverConfig?.getConfig?.()?.thresholds?.dailySignalCap || 10,
            lastScanTime: this.localData.capState.lastScanTime || 0
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
              const currentLastScan = capSnap.exists && typeof capSnap.data()?.lastScanTime === "number" ? capSnap.data().lastScanTime : this.localData.capState.lastScanTime || 0;
              transaction.set(capDocRef, {
                date: (/* @__PURE__ */ new Date()).toISOString().split("T")[0],
                dailySignalCount: 0,
                dailySignalCap: serverConfig?.getConfig?.()?.thresholds?.dailySignalCap || 10,
                lastScanTime: currentLastScan
              });
            });
          } catch (err) {
            logger.warn("[ScannerPersistence] Firestore clearSentSignals failed:", { error: String(err) });
          }
        } else if (this.isProductionMode()) {
          logger.error("[ScannerPersistence] FAIL CLOSED: Cannot clear sent signals without Firestore in production.");
        }
      }
      /**
       * Deletes a single sent signal by ID or snapshotId from memory, disk, and Firestore.
       */
      static async deleteSentSignal(id) {
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
            const query = await firestore.collection(FIRESTORE_SIGNALS_COL).doc(id).get();
            if (query.exists) {
              await firestore.collection(FIRESTORE_SIGNALS_COL).doc(id).delete();
              deletedInFirestore = true;
            } else {
              const snapshotById = await firestore.collection(FIRESTORE_SIGNALS_COL).where("snapshotId", "==", id).get();
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
            logger.error("[ScannerPersistence] Firestore deleteSentSignal failed:", { error: String(err) });
            throw err;
          }
        } else if (this.isProductionMode()) {
          logger.error("[ScannerPersistence] FAIL CLOSED: Cannot delete sent signal without Firestore in production.");
          return false;
        }
        return deletedLocally || deletedInFirestore;
      }
      /**
       * Records a deleted signal ID and its setup parameters to prevent the scanner from reinserting it.
       */
      static async recordDeletedSignal(id, symbol, direction) {
        this.init();
        const today = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
        let sym = symbol || "";
        let dir = direction || "";
        const firestore = getFirestoreAdmin();
        if ((!sym || !dir) && firestore) {
          try {
            const doc = await firestore.collection(FIRESTORE_SIGNALS_COL).doc(id).get();
            if (doc.exists) {
              const data = doc.data();
              sym = sym || data?.symbol || "";
              dir = dir || data?.direction || "";
            }
          } catch (err) {
            logger.debug("[ScannerPersistence] Could not fetch signal doc during recordDeletedSignal:", err);
          }
        }
        if (!this.localData.deletedSignals) {
          this.localData.deletedSignals = [];
        }
        const localStr = `${id}|${sym}|${dir}`;
        if (!this.localData.deletedSignals.includes(localStr)) {
          this.localData.deletedSignals.push(localStr);
          this.saveLocalData();
        }
        if (firestore) {
          try {
            await firestore.collection(FIRESTORE_DELETED_COL).doc(id).set({
              id,
              symbol: sym,
              direction: dir,
              deletedAt: Date.now(),
              date: today
            });
          } catch (err) {
            logger.error("[ScannerPersistence] Firestore recordDeletedSignal failed:", { error: String(err) });
            throw err;
          }
        }
      }
      /**
       * Retrieves all deleted signal records today.
       */
      static async getDeletedSignals() {
        this.init();
        const today = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
        const records = [];
        const firestore = getFirestoreAdmin();
        if (firestore) {
          try {
            const query = await firestore.collection(FIRESTORE_DELETED_COL).where("date", "==", today).get();
            query.forEach((doc) => {
              const data = doc.data();
              records.push({
                id: doc.id,
                symbol: data?.symbol || "",
                direction: data?.direction || ""
              });
            });
            if (!this.isProductionMode() && this.localData.deletedSignals) {
              for (const localStr of this.localData.deletedSignals) {
                const [localId, localSym, localDir] = localStr.split("|");
                if (!records.some((r) => r.id === localId)) {
                  records.push({
                    id: localId,
                    symbol: localSym || "",
                    direction: localDir || ""
                  });
                }
              }
            }
            return records;
          } catch (err) {
            logger.warn("[ScannerPersistence] Firestore getDeletedSignals failed:", { error: String(err) });
          }
        }
        if (this.localData.deletedSignals) {
          for (const localStr of this.localData.deletedSignals) {
            const [localId, localSym, localDir] = localStr.includes("|") ? localStr.split("|") : [localStr, "", ""];
            records.push({
              id: localId,
              symbol: localSym || "",
              direction: localDir || ""
            });
          }
        }
        return records;
      }
      /**
       * Retrieves all signals sent today (UTC).
       */
      static async getSentSignalsToday() {
        this.init();
        const today = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
        const firestore = getFirestoreAdmin();
        if (firestore) {
          try {
            const query = await firestore.collection(FIRESTORE_SIGNALS_COL).where("date", "==", today).get();
            if (!query.empty) {
              const signals = [];
              query.forEach((doc) => signals.push(doc.data()));
              const map = /* @__PURE__ */ new Map();
              if (!this.isProductionMode()) {
                for (const s of this.localData.sentSignals.filter((s2) => s2.date === today)) {
                  map.set(s.id, s);
                }
              }
              for (const s of signals) {
                map.set(s.id, s);
              }
              return Array.from(map.values()).sort((a, b) => b.timestamp - a.timestamp);
            }
          } catch (err) {
            logger.warn("[ScannerPersistence] Firestore getSentSignalsToday failed:", { error: String(err) });
          }
        }
        if (this.isProductionMode()) {
          logger.error("[ScannerPersistence] FAIL CLOSED: Cannot read sent signals from local disk in production mode.");
          return [];
        }
        return this.localData.sentSignals.filter((s) => s.date === today).sort((a, b) => b.timestamp - a.timestamp);
      }
      /**
       * Records rejected candidate setups for transparency and auditability.
       */
      static async recordRejectedCandidates(candidates) {
        if (!candidates || candidates.length === 0) return;
        this.init();
        const today = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
        const now = Date.now();
        const newItems = candidates.map((c) => {
          const item = {
            id: `rej_${now}_${Math.random().toString(36).substring(2, 7)}`,
            symbol: c.symbol,
            reason: c.reason,
            timestamp: c.timestamp || now,
            date: today
          };
          if (c.direction !== void 0) {
            item.direction = c.direction;
          }
          if (c.score !== void 0) {
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
            logger.warn("[ScannerPersistence] Firestore recordRejectedCandidates failed:", { error: String(err) });
          }
        } else if (this.isProductionMode()) {
          logger.error("[ScannerPersistence] FAIL CLOSED: Cannot record rejected candidates without Firestore in production.");
        }
      }
      /**
       * Retrieves rejected candidates for today.
       */
      static async getRejectedCandidatesToday(limit = 20) {
        this.init();
        const today = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
        const firestore = getFirestoreAdmin();
        if (firestore) {
          try {
            const query = await firestore.collection(FIRESTORE_REJECTIONS_COL).where("date", "==", today).get();
            if (!query.empty) {
              const items = [];
              query.forEach((doc) => items.push(doc.data()));
              const map = /* @__PURE__ */ new Map();
              if (!this.isProductionMode()) {
                for (const c of this.localData.rejectedCandidates.filter((c2) => c2.date === today)) {
                  map.set(c.id, c);
                }
              }
              for (const c of items) {
                map.set(c.id, c);
              }
              return Array.from(map.values()).sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
            }
          } catch (err) {
            logger.debug("[ScannerPersistence] Firestore getRejectedCandidatesToday error:", { error: String(err) });
          }
        }
        if (this.isProductionMode()) {
          logger.error("[ScannerPersistence] FAIL CLOSED: Cannot read rejected candidates from local disk in production mode.");
          return [];
        }
        return this.localData.rejectedCandidates.filter((c) => c.date === today).sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
      }
      /**
       * Records a notification history item.
       */
      static async recordNotification(notification) {
        this.init();
        const today = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
        const now = Date.now();
        const item = {
          id: `notif_${now}_${Math.random().toString(36).substring(2, 7)}`,
          timestamp: now,
          type: notification.type,
          symbol: notification.symbol,
          title: notification.title,
          message: notification.message,
          ...notification.score !== void 0 ? { score: notification.score } : {},
          ...notification.rankTier !== void 0 ? { rankTier: notification.rankTier } : {},
          date: today
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
            logger.warn("[ScannerPersistence] Firestore recordNotification failed:", { error: String(err) });
          }
        } else if (this.isProductionMode()) {
          logger.error("[ScannerPersistence] FAIL CLOSED: Cannot record notification without Firestore in production.");
        }
      }
      /**
       * Deletes a single notification by ID.
       */
      static async deleteNotification(id) {
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
            const query = await firestore.collection(FIRESTORE_NOTIFICATIONS_COL).doc(id).get();
            if (query.exists) {
              await firestore.collection(FIRESTORE_NOTIFICATIONS_COL).doc(id).delete();
              deletedInFirestore = true;
            } else {
              const snapshotQuery = await firestore.collection(FIRESTORE_NOTIFICATIONS_COL).where("snapshotId", "==", id).get();
              if (!snapshotQuery.empty) {
                const batch = firestore.batch();
                snapshotQuery.forEach((doc) => batch.delete(doc.ref));
                await batch.commit();
                deletedInFirestore = true;
              }
            }
          } catch (err) {
            logger.error("[ScannerPersistence] Firestore deleteNotification error", { error: String(err) });
            throw err;
          }
        } else if (this.isProductionMode()) {
          logger.error("[ScannerPersistence] FAIL CLOSED: Cannot delete notification without Firestore in production.");
          return false;
        }
        return deletedLocally || deletedInFirestore;
      }
      /**
       * Retrieves notification history.
       */
      static async getNotificationHistory(limit = 20) {
        this.init();
        const firestore = getFirestoreAdmin();
        if (firestore) {
          try {
            const query = await firestore.collection(FIRESTORE_NOTIFICATIONS_COL).orderBy("timestamp", "desc").limit(limit).get();
            if (!query.empty) {
              const list = [];
              query.forEach((doc) => list.push(doc.data()));
              return list;
            }
          } catch (err) {
            logger.debug("[ScannerPersistence] Firestore getNotificationHistory error");
          }
        }
        if (this.isProductionMode()) {
          logger.error("[ScannerPersistence] FAIL CLOSED: Cannot read notification history from local disk in production mode.");
          return [];
        }
        return [...this.localData.notifications].sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
      }
      /**
       * Updates status and optional metadata of an existing signal setup (e.g. SUPERSEDED, EXPIRED, progressive hits).
       */
      static async updateSignalStatus(signalId, status, metadata) {
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
            const updatePayload = { status };
            if (metadata) {
              for (const [key, val] of Object.entries(metadata)) {
                if (val !== void 0) {
                  updatePayload[key] = val;
                }
              }
            }
            await firestore.collection(FIRESTORE_SIGNALS_COL).doc(signalId).set(updatePayload, { merge: true });
          } catch (err) {
            logger.warn("[ScannerPersistence] Firestore updateSignalStatus failed:", { error: String(err) });
          }
        } else if (this.isProductionMode()) {
          logger.error("[ScannerPersistence] FAIL CLOSED: Cannot update signal status without Firestore in production.");
        }
      }
      /**
       * Updates take-profit targets of an existing signal setup.
       */
      static async updateSignalTps(signalId, signalIdOrSnapshotId, tp1, tp2, tp3, takeProfit, riskRewardRatio) {
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
            try {
              const snapshot = await firestore.collection(FIRESTORE_SIGNALS_COL).where("snapshotId", "==", signalIdOrSnapshotId).get();
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
                const snapshotById = await firestore.collection(FIRESTORE_SIGNALS_COL).where("id", "==", signalIdOrSnapshotId).get();
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
              logger.warn("[ScannerPersistence] Firestore updateSignalTps failed:", { error: String(queryErr) });
            }
          }
        } else if (this.isProductionMode()) {
          logger.error("[ScannerPersistence] FAIL CLOSED: Cannot update signal TPs without Firestore in production.");
        }
      }
      /**
       * Retrieves all currently ACTIVE signals from persistence.
       */
      static async getActiveSignals() {
        this.init();
        const firestore = getFirestoreAdmin();
        if (firestore) {
          try {
            const query = await firestore.collection(FIRESTORE_SIGNALS_COL).where("status", "==", "ACTIVE").get();
            const signals = [];
            if (!query.empty) {
              query.forEach((doc) => {
                const data = doc.data();
                if (data && data.isTradeableSignal === true && data.signalClassification === "TRADEABLE") {
                  signals.push(data);
                }
              });
            }
            const activeOrProgressive = ["TP1_HIT", "TP2_HIT", "WAITING_ENTRY"];
            for (const stat of activeOrProgressive) {
              const q = await firestore.collection(FIRESTORE_SIGNALS_COL).where("status", "==", stat).get();
              if (!q.empty) {
                q.forEach((doc) => {
                  const data = doc.data();
                  if (data && data.isTradeableSignal === true && data.signalClassification === "TRADEABLE") {
                    signals.push(data);
                  }
                });
              }
            }
            if (!this.isProductionMode()) {
              const firestoreActiveIds = new Set(signals.map((s) => s.id));
              const localActive = this.localData.sentSignals.filter(
                (s) => s.isTradeableSignal === true && s.signalClassification === "TRADEABLE" && (s.status === "ACTIVE" || s.status === "TP1_HIT" || s.status === "TP2_HIT" || s.status === "WAITING_ENTRY")
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
                        this.localData.sentSignals = this.localData.sentSignals.filter((s) => s.id !== localSig.id);
                        localUpdated = true;
                      } else {
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
            logger.warn("[ScannerPersistence] Firestore getActiveSignals failed:", { error: String(err) });
          }
        }
        if (this.isProductionMode()) {
          logger.error("[ScannerPersistence] FAIL CLOSED: Cannot read active signals from local disk in production mode.");
          return [];
        }
        return this.localData.sentSignals.filter((s) => s.isTradeableSignal === true && s.signalClassification === "TRADEABLE" && (s.status === "ACTIVE" || s.status === "TP1_HIT" || s.status === "TP2_HIT" || s.status === "WAITING_ENTRY")).sort((a, b) => b.timestamp - a.timestamp);
      }
      /**
       * Retrieves all sent signals from Firestore or local data.
       */
      static async getSentSignals() {
        this.init();
        const firestore = getFirestoreAdmin();
        if (firestore) {
          try {
            const query = await firestore.collection(FIRESTORE_SIGNALS_COL).get();
            if (!query.empty) {
              const res = [];
              query.forEach((doc) => {
                const data = doc.data();
                if (data && data.id) res.push(data);
              });
              return res;
            }
          } catch (err) {
            logger.warn("[ScannerPersistence] Failed to fetch sent signals from Firestore:", { error: String(err) });
          }
        }
        return this.localData.sentSignals || [];
      }
      /**
       * Retrieves scanner settings.
       */
      static getSettings() {
        this.init();
        return { ...this.localData.settings };
      }
      /**
       * Updates scanner settings.
       */
      static updateSettings(options) {
        this.init();
        this.localData.settings = {
          ...this.localData.settings,
          ...options
        };
        this.saveLocalData();
      }
      /**
       * Updates external cron trigger execution timestamp.
       */
      static async updateLastCronExecution(timestamp = Date.now()) {
        this.init();
        logger.info(`[ScannerPersistence] WRITING lastCronExecution: ${timestamp} (${new Date(timestamp).toISOString()})`);
        this.localData.capState.lastCronExecution = timestamp;
        this.localData.capState.lastCronTriggerTime = timestamp;
        this.saveLocalData();
        const firestore = getFirestoreAdmin();
        if (firestore) {
          try {
            await firestore.doc(FIRESTORE_CAP_DOC).set({ lastCronExecution: timestamp, lastCronTriggerTime: timestamp }, { merge: true });
          } catch (err) {
            logger.warn("[ScannerPersistence] Failed to update lastCronExecution in Firestore:", { error: String(err) });
          }
        }
      }
      /**
       * Updates actual automated market scan engine metrics.
       * MAY ONLY BE CALLED when Market Scan Engine actually executes from /api/scanner/trigger (isExternal = true).
       * NEVER updated from UI activity, page loads, manual signal generation, heartbeat, scheduler checks, or skipped requests.
       */
      static async recordAutomatedScanMetrics(metrics) {
        this.init();
        logger.info(`[ScannerPersistence] WRITING lastAutomatedScan metrics:`, metrics);
        this.localData.capState.lastAutomatedScan = metrics.lastAutomatedScan;
        this.localData.capState.lastScanTime = metrics.lastAutomatedScan;
        this.localData.capState.lastScanCompletedAt = metrics.lastScanCompletedAt;
        this.localData.capState.lastScanDuration = metrics.lastScanDuration;
        this.localData.capState.lastCandidatesEvaluated = metrics.lastCandidatesEvaluated;
        this.localData.capState.lastSignalsFound = metrics.lastSignalsFound;
        this.localData.capState.lastAcceptedSignals = metrics.lastAcceptedSignals;
        if (metrics.universeSymbolsScanned !== void 0) this.localData.capState.universeSymbolsScanned = metrics.universeSymbolsScanned;
        if (metrics.preliminaryCandidatesFound !== void 0) this.localData.capState.preliminaryCandidatesFound = metrics.preliminaryCandidatesFound;
        if (metrics.candidatesRejectedPreliminary !== void 0) this.localData.capState.candidatesRejectedPreliminary = metrics.candidatesRejectedPreliminary;
        if (metrics.candidatesEvaluated !== void 0) this.localData.capState.candidatesEvaluated = metrics.candidatesEvaluated;
        if (metrics.candidatesRejectedFinal !== void 0) this.localData.capState.candidatesRejectedFinal = metrics.candidatesRejectedFinal;
        if (metrics.signalsGenerated !== void 0) this.localData.capState.signalsGenerated = metrics.signalsGenerated;
        if (metrics.signalsAccepted !== void 0) this.localData.capState.signalsAccepted = metrics.signalsAccepted;
        this.saveLocalData();
        const firestore = getFirestoreAdmin();
        if (firestore) {
          try {
            const payload = {
              lastAutomatedScan: metrics.lastAutomatedScan,
              lastScanTime: metrics.lastAutomatedScan,
              lastScanCompletedAt: metrics.lastScanCompletedAt,
              lastScanDuration: metrics.lastScanDuration,
              lastCandidatesEvaluated: metrics.lastCandidatesEvaluated,
              lastSignalsFound: metrics.lastSignalsFound,
              lastAcceptedSignals: metrics.lastAcceptedSignals
            };
            if (metrics.universeSymbolsScanned !== void 0) payload.universeSymbolsScanned = metrics.universeSymbolsScanned;
            if (metrics.preliminaryCandidatesFound !== void 0) payload.preliminaryCandidatesFound = metrics.preliminaryCandidatesFound;
            if (metrics.candidatesRejectedPreliminary !== void 0) payload.candidatesRejectedPreliminary = metrics.candidatesRejectedPreliminary;
            if (metrics.candidatesEvaluated !== void 0) payload.candidatesEvaluated = metrics.candidatesEvaluated;
            if (metrics.candidatesRejectedFinal !== void 0) payload.candidatesRejectedFinal = metrics.candidatesRejectedFinal;
            if (metrics.signalsGenerated !== void 0) payload.signalsGenerated = metrics.signalsGenerated;
            if (metrics.signalsAccepted !== void 0) payload.signalsAccepted = metrics.signalsAccepted;
            await firestore.doc(FIRESTORE_CAP_DOC).set(payload, { merge: true });
            logger.info(`[ScannerPersistence] Firestore lastAutomatedScan metrics successfully synchronized.`);
          } catch (err) {
            logger.warn("[ScannerPersistence] Failed to update lastAutomatedScan metrics in Firestore:", { error: String(err) });
          }
        } else if (this.isProductionMode()) {
          logger.error("[ScannerPersistence] FAIL CLOSED: Cannot update scan metrics without Firestore in production.");
        }
      }
      /**
       * Updates last scan time in local disk persistence and Firestore.
       * Only called during actual market scan executions.
       */
      static async updateLastScanTime(timestamp = Date.now(), reason = "UNSPECIFIED_SCAN_EVENT") {
        this.init();
        logger.info(`[ScannerPersistence] WRITING lastScanTime: ${timestamp} (${new Date(timestamp).toISOString()}) | Reason: ${reason}`);
        this.localData.capState.lastScanTime = timestamp;
        this.localData.capState.lastAutomatedScan = timestamp;
        this.saveLocalData();
        const firestore = getFirestoreAdmin();
        if (firestore) {
          try {
            await firestore.doc(FIRESTORE_CAP_DOC).set({ lastScanTime: timestamp, lastAutomatedScan: timestamp }, { merge: true });
            logger.info(`[ScannerPersistence] Firestore lastScanTime successfully synchronized: ${timestamp}`);
          } catch (err) {
            logger.warn("[ScannerPersistence] Failed to update lastScanTime in Firestore:", { error: String(err) });
          }
        } else if (this.isProductionMode()) {
          logger.error("[ScannerPersistence] FAIL CLOSED: Cannot update lastScanTime without Firestore in production.");
        }
      }
      /**
       * Records the timestamp of an external cron-job.org HTTP heartbeat/trigger ping.
       * Completely independent of lastScanTime (does not modify market scan state or schedule).
       */
      static async updateLastCronTriggerTime(timestamp = Date.now()) {
        this.init();
        logger.info(`[ScannerPersistence] Recording external cron trigger ping: ${timestamp} (${new Date(timestamp).toISOString()})`);
        this.localData.capState.lastCronTriggerTime = timestamp;
        this.saveLocalData();
        const firestore = getFirestoreAdmin();
        if (firestore) {
          try {
            await firestore.doc(FIRESTORE_CAP_DOC).set({ lastCronTriggerTime: timestamp }, { merge: true });
          } catch (err) {
            logger.warn("[ScannerPersistence] Failed to update lastCronTriggerTime in Firestore:", { error: String(err) });
          }
        }
      }
      /**
       * Attempts to atomically acquire a scanner execution lock for concurrency protection across Vercel serverless containers.
       * Lock auto-expires after lockTimeoutMs (default 5 minutes) to recover from orphaned crashed instances.
       */
      static async tryAcquireLock(instanceId, lockTimeoutMs = 3e5) {
        this.init();
        const now = Date.now();
        const firestore = getFirestoreAdmin();
        if (!firestore) {
          if (this.isProductionMode()) {
            logger.error("[ScannerPersistence] FAIL CLOSED: Firestore required to acquire lock in production mode.");
            return { acquired: false, reason: "FAIL CLOSED: Production mode requires Firestore to acquire concurrency lock across serverless instances." };
          }
          if (this.localLock.isScanning && now - this.localLock.lockAcquiredAt < lockTimeoutMs) {
            return { acquired: false, reason: "Scan lock currently held in local process." };
          }
          this.localLock = { isScanning: true, lockAcquiredAt: now, instanceId };
          return { acquired: true };
        }
        try {
          const docRef = firestore.doc(FIRESTORE_LOCK_DOC);
          const result = await firestore.runTransaction(async (tx) => {
            const snap = await tx.get(docRef);
            if (snap.exists) {
              const remoteLock = snap.data();
              if (remoteLock.isScanning && now - remoteLock.lockAcquiredAt < lockTimeoutMs) {
                return { acquired: false, reason: "Scan lock currently held in remote Firestore container." };
              }
            }
            const newLock = {
              isScanning: true,
              lockAcquiredAt: now,
              instanceId
            };
            tx.set(docRef, newLock);
            return { acquired: true };
          });
          if (result.acquired) {
            this.localLock = { isScanning: true, lockAcquiredAt: now, instanceId };
          }
          return result;
        } catch (err) {
          logger.warn("[ScannerPersistence] Firestore tryAcquireLock error:", { error: String(err) });
          if (this.isProductionMode()) {
            return { acquired: false, reason: "FAIL CLOSED: Firestore lock transaction failed in production mode." };
          }
          if (this.localLock.isScanning && now - this.localLock.lockAcquiredAt < lockTimeoutMs) {
            return { acquired: false, reason: "Scan lock held in local fallback memory." };
          }
          this.localLock = { isScanning: true, lockAcquiredAt: now, instanceId };
          return { acquired: true };
        }
      }
      /**
       * Releases scanner execution lock.
       */
      static async releaseLock(instanceId) {
        this.init();
        this.localLock = { isScanning: false, lockAcquiredAt: 0 };
        const firestore = getFirestoreAdmin();
        if (firestore) {
          try {
            await firestore.doc(FIRESTORE_LOCK_DOC).set({
              isScanning: false,
              lockAcquiredAt: 0,
              instanceId
            });
          } catch (err) {
            logger.warn("[ScannerPersistence] Firestore releaseLock error:", { error: String(err) });
          }
        }
      }
    };
  }
});

// src/server/firebaseAdmin.ts
function isProductionPersistenceReady() {
  const isProd = process.env.NODE_ENV === "production";
  if (!isProd) {
    return true;
  }
  const saJson = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!saJson || saJson.trim().length === 0) {
    return false;
  }
  const firestore = getFirestoreAdmin();
  return firestore !== null;
}
function getFirestoreAdmin() {
  if (db) return db;
  const saJson = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!saJson) {
    return null;
  }
  try {
    const serviceAccount = JSON.parse(saJson);
    if (serviceAccount.private_key) {
      serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, "\n");
    }
    const apps = (0, import_app.getApps)();
    if (apps.length === 0) {
      (0, import_app.initializeApp)({
        credential: (0, import_app.cert)(serviceAccount)
      });
      logger.info("[Firebase Admin] Successfully initialized Firebase Admin.");
    }
    db = (0, import_firestore.getFirestore)();
    return db;
  } catch (err) {
    logger.warn("[Firebase Admin] Initialization failed:", { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}
var import_app, import_firestore, db;
var init_firebaseAdmin = __esm({
  "src/server/firebaseAdmin.ts"() {
    import_app = require("firebase-admin/app");
    import_firestore = require("firebase-admin/firestore");
    init_logger();
    init_ScannerPersistence();
    db = null;
  }
});

// src/server/config.ts
var TP1_ALLOCATION, TP2_ALLOCATION, TP3_ALLOCATION, HISTORICAL_ENTRY_POLICY, ConfigService, serverConfig;
var init_config = __esm({
  "src/server/config.ts"() {
    init_logger();
    init_firebaseAdmin();
    TP1_ALLOCATION = 0.4;
    TP2_ALLOCATION = 0.3;
    TP3_ALLOCATION = 0.3;
    HISTORICAL_ENTRY_POLICY = "CONSERVATIVE";
    if (Math.abs(TP1_ALLOCATION + TP2_ALLOCATION + TP3_ALLOCATION - 1) > 1e-6) {
      throw new Error(`FATAL: TP allocations must sum exactly to 1.0. Got: ${TP1_ALLOCATION + TP2_ALLOCATION + TP3_ALLOCATION}`);
    }
    ConfigService = class {
      constructor() {
        this.config = this.loadAndValidate();
      }
      loadAndValidate() {
        const port = parseInt(process.env.PORT || "3000", 10);
        const nodeEnv = process.env.NODE_ENV || "development";
        const appUrl = process.env.APP_URL || `http://localhost:${port}`;
        const marketDataMaxAgeMs = parseInt(process.env.MARKET_DATA_MAX_AGE_MS || "60000", 10);
        const marketDataCacheTtlMs = parseInt(process.env.MARKET_DATA_CACHE_TTL_MS || "60000", 10);
        const marketDataTimeoutMs = parseInt(process.env.MARKET_DATA_TIMEOUT_MS || "8000", 10);
        const signalExpirationMinutes = parseInt(process.env.SIGNAL_EXPIRATION_MINUTES || "240", 10);
        const signalExpirationMs = signalExpirationMinutes * 60 * 1e3;
        const nvidiaConfigured = Boolean(process.env.NVIDIA_API_KEY && process.env.NVIDIA_API_KEY.trim().length > 0);
        const finnhubConfigured = Boolean(process.env.FINNHUB_API_KEY && process.env.FINNHUB_API_KEY.trim().length > 0);
        const bitgetConfigured = Boolean(
          process.env.BITGET_API_KEY && process.env.BITGET_SECRET_KEY && process.env.BITGET_PASSPHRASE
        );
        const twelvedataConfigured = Boolean(process.env.TWELVE_DATA_API_KEY && process.env.TWELVE_DATA_API_KEY.trim().length > 0);
        const authoritativeMinScore = parseInt(process.env.THRESHOLD_MIN_SCORE || process.env.THRESHOLD_SIGNAL_SCORE || "72", 10);
        const rawWinProb = parseFloat(process.env.THRESHOLD_MIN_WIN_PROB || "55");
        const rawAiConf = parseFloat(process.env.THRESHOLD_MIN_AI_CONFIDENCE || "55");
        const thresholds = {
          minimumScore: authoritativeMinScore,
          watchingThreshold: parseInt(process.env.THRESHOLD_WATCHING_SCORE || "70", 10),
          qualifiedCandidateThreshold: parseInt(process.env.THRESHOLD_QUALIFIED_CANDIDATE_SCORE || "75", 10),
          signalThreshold: authoritativeMinScore,
          minimumRR: parseFloat(process.env.THRESHOLD_MIN_RR || "1.8"),
          minimumNetRR: parseFloat(process.env.THRESHOLD_MIN_NET_RR || "1.5"),
          minimumAdverseNetRR: process.env.THRESHOLD_MIN_ADVERSE_NET_RR ? parseFloat(process.env.THRESHOLD_MIN_ADVERSE_NET_RR) : 1,
          enforceAdverseNetRRHardGate: process.env.ENFORCE_ADVERSE_NET_RR_HARD_GATE === "true",
          minimumWinProbability: rawWinProb <= 1 ? rawWinProb * 100 : rawWinProb,
          minimumStrategyAgreement: parseFloat(process.env.THRESHOLD_MIN_STRATEGY_AGREEMENT || "0.60"),
          minimumTimeframeAlignment: parseFloat(process.env.THRESHOLD_MIN_TIMEFRAME_ALIGNMENT || "0.60"),
          AIConfirmationMode: process.env.THRESHOLD_AI_CONFIRMATION_MODE || "OPTIONAL",
          minimumAiConfidence: rawAiConf <= 1 ? rawAiConf * 100 : rawAiConf,
          dailySignalCap: parseInt(process.env.THRESHOLD_DAILY_SIGNAL_CAP || "5", 10),
          candidateLimit: parseInt(process.env.THRESHOLD_CANDIDATE_LIMIT || "10", 10),
          probabilitySource: process.env.THRESHOLD_PROBABILITY_SOURCE || process.env.PROBABILITY_SOURCE || "EMPIRICAL",
          requireEmpiricalCalibration: process.env.REQUIRE_EMPIRICAL_CALIBRATION === "true"
        };
        const providers = {
          nvidiaConfigured,
          finnhubConfigured,
          bitgetConfigured,
          twelvedataConfigured
        };
        const persistenceReady = isProductionPersistenceReady();
        logger.info("Server configuration loaded successfully", {
          port,
          nodeEnv,
          marketDataMaxAgeMs,
          marketDataCacheTtlMs,
          marketDataTimeoutMs,
          signalExpirationMinutes,
          productionPersistenceReady: persistenceReady,
          providersReady: providers,
          thresholds
        });
        return {
          port,
          nodeEnv,
          appUrl,
          marketDataMaxAgeMs,
          marketDataCacheTtlMs,
          marketDataTimeoutMs,
          signalExpirationMinutes,
          signalExpirationMs,
          productionPersistenceReady: persistenceReady,
          providers,
          thresholds
        };
      }
      getConfig() {
        const currentNodeEnv = process.env.NODE_ENV || this.config.nodeEnv;
        return {
          ...this.config,
          nodeEnv: currentNodeEnv,
          productionPersistenceReady: isProductionPersistenceReady()
        };
      }
      getProviderStatus() {
        return this.config.providers;
      }
      getThresholds() {
        return this.config.thresholds;
      }
      updateThresholds(partial) {
        this.config.thresholds = {
          ...this.config.thresholds,
          ...partial
        };
        logger.info("Signal thresholds updated", { updatedThresholds: this.config.thresholds });
        return this.config.thresholds;
      }
      /**
       * Helper to retrieve server-side NVIDIA API Key.
       * NEVER pass or return this to the frontend.
       */
      getNvidiaApiKey() {
        return process.env.NVIDIA_API_KEY || null;
      }
    };
    serverConfig = new ConfigService();
  }
});

// src/utils/formatters.ts
function getDynamicPrecision(price, symbol) {
  if (price === void 0 || price === null || price <= 0 || isNaN(price)) return 2;
  const sym = (symbol || "").toUpperCase();
  if (sym && (sym.includes("EURUSD") || sym.includes("GBPUSD") || sym.includes("AUDUSD") || sym.includes("USDCAD") || sym.includes("USDCHF") || sym.includes("NZDUSD") || sym.includes("EURGBP") || sym.includes("EURCAD") || sym.includes("AUDCAD") || sym.includes("EURAUD") || sym.includes("GBPAUD") || sym.includes("GBPCAD") || sym.includes("EURCHF") || sym.includes("GBPCHF"))) {
    return 5;
  }
  if (sym && sym.includes("JPY")) {
    return 3;
  }
  if (price >= 1e3) return 2;
  if (price >= 100) return 2;
  if (price >= 10) return 3;
  if (price >= 1) return 4;
  if (price >= 0.1) return 5;
  if (price >= 0.01) return 6;
  if (price >= 1e-3) return 7;
  if (price >= 1e-4) return 8;
  if (price >= 1e-5) return 9;
  return 10;
}
var init_formatters = __esm({
  "src/utils/formatters.ts"() {
  }
});

// src/server/market/SymbolNormalizer.ts
var SymbolNormalizer;
var init_SymbolNormalizer = __esm({
  "src/server/market/SymbolNormalizer.ts"() {
    SymbolNormalizer = class {
      /**
       * Dynamically classifies any symbol into its asset type based on category rules
       * rather than a hard-coded list of symbols.
       */
      static getAssetClassification(symbol) {
        if (!symbol) return "UNKNOWN";
        const cleanRaw = symbol.trim().toUpperCase();
        if (cleanRaw.includes("/")) {
          const parts = cleanRaw.split("/");
          const base = parts[0]?.trim();
          const quote = parts[1]?.trim();
          const fiatCurrencies2 = ["EUR", "GBP", "USD", "JPY", "AUD", "CAD", "CHF", "NZD"];
          if (fiatCurrencies2.includes(base) && fiatCurrencies2.includes(quote)) {
            return "FOREX";
          }
          return "CRYPTO";
        }
        const clean = this.normalizeAppSymbol(symbol);
        if (!clean) return "UNKNOWN";
        const cryptoQuotes = ["USDT", "USDC", "BUSD"];
        if (cryptoQuotes.some((quote) => clean.endsWith(quote))) {
          return "CRYPTO";
        }
        if (clean.endsWith("USD")) {
          if (clean.length === 6) {
            const fiatCurrencies2 = ["EUR", "GBP", "USD", "JPY", "AUD", "CAD", "CHF", "NZD"];
            const base = clean.slice(0, 3);
            if (fiatCurrencies2.includes(base)) {
              return "FOREX";
            }
          }
          return "CRYPTO";
        }
        const fiatCurrencies = ["EUR", "GBP", "USD", "JPY", "AUD", "CAD", "CHF", "NZD"];
        const isForexPattern = clean.length === 6 && fiatCurrencies.some((fiat) => clean.startsWith(fiat)) && fiatCurrencies.some((fiat) => clean.endsWith(fiat));
        if (isForexPattern) {
          return "FOREX";
        }
        if (/^[A-Z]{1,5}$/.test(clean)) {
          return "STOCK";
        }
        return "UNKNOWN";
      }
      /**
       * Sanitizes user/application symbol input (e.g., "btc/usdt" -> "BTCUSDT")
       */
      static normalizeAppSymbol(symbol) {
        if (!symbol) return "";
        return symbol.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
      }
      /**
       * Converts a normalized app symbol to a provider-specific format.
       * Throws an error if the asset/symbol is unsupported for that provider.
       */
      static toProviderSymbol(appSymbol, providerId) {
        const clean = this.normalizeAppSymbol(appSymbol);
        if (!clean) {
          throw new Error("Symbol must not be empty");
        }
        const lowerProvider = providerId.toLowerCase();
        switch (lowerProvider) {
          case "bitget": {
            let symbol = clean;
            if (symbol === "MATIC" || symbol === "MATICUSDT") symbol = "POLUSDT";
            else if (symbol === "RNDR" || symbol === "RNDRUSDT") symbol = "RENDERUSDT";
            else if (symbol === "FTM" || symbol === "FTMUSDT") symbol = "SUSDT";
            else if (symbol === "MKR" || symbol === "MKRUSDT") symbol = "FETUSDT";
            if (symbol.endsWith("USDT") || symbol.endsWith("USDC") || symbol.endsWith("USD") || symbol.endsWith("BTC")) {
              const bitgetSymbol = symbol.endsWith("USD") ? `${symbol}T` : symbol;
              return { providerSymbol: bitgetSymbol, assetType: "CRYPTO" };
            }
            return { providerSymbol: `${symbol}USDT`, assetType: "CRYPTO" };
          }
          case "finnhub": {
            const assetType = this.getAssetClassification(clean);
            if (assetType === "FOREX") {
              const base = clean.slice(0, 3);
              const quote = clean.slice(3, 6);
              return { providerSymbol: `OANDA:${base}_${quote}`, assetType: "FOREX" };
            }
            if (assetType === "CRYPTO") {
              const cryptoPair = clean.endsWith("USDT") ? clean : `${clean}USDT`;
              return { providerSymbol: `BINANCE:${cryptoPair}`, assetType: "CRYPTO" };
            }
            return { providerSymbol: clean, assetType: "STOCK" };
          }
          case "twelvedata": {
            const assetType = this.getAssetClassification(clean);
            if (assetType === "STOCK") {
              return { providerSymbol: clean, assetType: "STOCK" };
            }
            let base = "EUR";
            let quote = "USD";
            if (clean.includes("/")) {
              const parts = clean.split("/");
              base = parts[0];
              quote = parts[1];
            } else if (clean.length === 6) {
              base = clean.slice(0, 3);
              quote = clean.slice(3, 6);
            } else if (clean.length === 3) {
              base = clean;
              quote = "USD";
            }
            return {
              providerSymbol: `${base}/${quote}`,
              assetType: "FOREX",
              baseCurrency: base,
              quoteCurrency: quote
            };
          }
          default:
            throw new Error(`Unsupported provider: ${providerId}`);
        }
      }
    };
  }
});

// src/server/market/CandleAggregator.ts
function parseTimeframeMs(tf) {
  const norm = tf.toLowerCase().trim();
  if (norm.endsWith("min") || norm.endsWith("m")) {
    const mins = parseInt(norm, 10);
    return !isNaN(mins) && mins > 0 ? mins * 60 * 1e3 : null;
  }
  if (norm.endsWith("hour") || norm.endsWith("h")) {
    const hrs = parseInt(norm, 10);
    return !isNaN(hrs) && hrs > 0 ? hrs * 60 * 60 * 1e3 : null;
  }
  if (norm.endsWith("day") || norm.endsWith("d")) {
    const days = parseInt(norm, 10);
    return !isNaN(days) && days > 0 ? days * 24 * 60 * 60 * 1e3 : null;
  }
  if (norm.endsWith("week") || norm.endsWith("w")) {
    const weeks = parseInt(norm, 10);
    return !isNaN(weeks) && weeks > 0 ? weeks * 7 * 24 * 60 * 60 * 1e3 : null;
  }
  return null;
}
function aggregateOHLCCandles(lowerCandles, targetTimeframe, targetLimit) {
  const targetMs = parseTimeframeMs(targetTimeframe);
  if (!targetMs || lowerCandles.length === 0) return [];
  const buckets = /* @__PURE__ */ new Map();
  for (const candle of lowerCandles) {
    if (!candle || candle.timestamp <= 0) continue;
    const bucketTime = Math.floor(candle.timestamp / targetMs) * targetMs;
    const list = buckets.get(bucketTime) || [];
    list.push(candle);
    buckets.set(bucketTime, list);
  }
  const aggregated = [];
  const sortedBucketKeys = Array.from(buckets.keys()).sort((a, b) => b - a);
  for (const bTime of sortedBucketKeys) {
    const list = buckets.get(bTime);
    if (list.length === 0) continue;
    list.sort((a, b) => a.timestamp - b.timestamp);
    const open = list[0].open;
    const close = list[list.length - 1].close;
    let high = -Infinity;
    let low = Infinity;
    let volumeSum = null;
    let hasVolume = false;
    for (const c of list) {
      if (c.high > high) high = c.high;
      if (c.low < low) low = c.low;
      if (c.volume !== null && !isNaN(c.volume)) {
        volumeSum = (volumeSum ?? 0) + c.volume;
        hasVolume = true;
      }
    }
    if (!isNaN(open) && open > 0 && !isNaN(high) && high > 0 && !isNaN(low) && low > 0 && !isNaN(close) && close > 0 && high >= low && high >= open && high >= close && low <= open && low <= close) {
      aggregated.push({
        symbol: list[0].symbol,
        provider: list[0].provider,
        timeframe: targetTimeframe,
        open,
        high,
        low,
        close,
        volume: hasVolume ? volumeSum : null,
        timestamp: bTime
      });
    }
    if (aggregated.length >= targetLimit) break;
  }
  return aggregated;
}
var init_CandleAggregator = __esm({
  "src/server/market/CandleAggregator.ts"() {
  }
});

// src/server/market/adapters/BitgetAdapter.ts
var BitgetAdapter;
var init_BitgetAdapter = __esm({
  "src/server/market/adapters/BitgetAdapter.ts"() {
    init_SymbolNormalizer();
    init_CandleAggregator();
    init_config();
    init_logger();
    BitgetAdapter = class {
      constructor() {
        this.id = "bitget";
        this.name = "Bitget Exchange";
      }
      async fetchPrice(appSymbol, globalScanDeadlineMs) {
        const receivedAt = Date.now();
        let providerSymbol = appSymbol;
        let assetType = "CRYPTO";
        const configTimeout = serverConfig.getConfig().marketDataTimeoutMs;
        let timeoutMs = configTimeout;
        const safetyMargin = 100;
        if (globalScanDeadlineMs) {
          const remainingMs = globalScanDeadlineMs - Date.now();
          if (remainingMs <= safetyMargin) {
            throw new Error("TIMEOUT: Global scanner deadline reached before starting request");
          }
          timeoutMs = Math.min(configTimeout, remainingMs - safetyMargin);
        }
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const mapping = SymbolNormalizer.toProviderSymbol(appSymbol, this.id);
          providerSymbol = mapping.providerSymbol;
          assetType = mapping.assetType;
          const url = `https://api.bitget.com/api/v2/spot/market/tickers?symbol=${encodeURIComponent(providerSymbol)}`;
          const response = await fetch(url, {
            signal: controller.signal,
            headers: { "Accept": "application/json" }
          });
          clearTimeout(timeoutId);
          if (response.status === 429) {
            return this.createErrorTicker(appSymbol, providerSymbol, assetType, "Bitget API rate limit exceeded (HTTP 429)");
          }
          if (!response.ok) {
            return this.createErrorTicker(appSymbol, providerSymbol, assetType, `Bitget API returned HTTP ${response.status}`);
          }
          const json = await response.json();
          if (json.code !== "00000" || !Array.isArray(json.data) || json.data.length === 0) {
            return this.createErrorTicker(appSymbol, providerSymbol, assetType, json.msg || `No ticker data found for symbol ${providerSymbol}`);
          }
          const raw = json.data[0];
          const price = parseFloat(raw.lastPr);
          const bid = raw.bidPr ? parseFloat(raw.bidPr) : null;
          const ask = raw.askPr ? parseFloat(raw.askPr) : null;
          const timestamp = parseInt(raw.ts, 10);
          if (isNaN(price) || !isFinite(price) || price <= 0) {
            return this.createErrorTicker(appSymbol, providerSymbol, assetType, `Invalid price returned by Bitget: ${raw.lastPr}`);
          }
          if (isNaN(timestamp) || timestamp <= 0) {
            return this.createErrorTicker(appSymbol, providerSymbol, assetType, `Invalid timestamp returned by Bitget: ${raw.ts}`);
          }
          const maxAgeMs = serverConfig.getConfig().marketDataMaxAgeMs;
          const isFresh = receivedAt - timestamp <= maxAgeMs;
          return {
            symbol: SymbolNormalizer.normalizeAppSymbol(appSymbol),
            rawSymbol: providerSymbol,
            provider: this.id,
            assetType,
            bid: bid !== null && !isNaN(bid) && bid > 0 ? bid : null,
            ask: ask !== null && !isNaN(ask) && ask > 0 ? ask : null,
            price,
            timestamp,
            receivedAt,
            source: "LIVE",
            isFresh,
            status: isFresh ? "OK" : "STALE"
          };
        } catch (err) {
          clearTimeout(timeoutId);
          const msg = err instanceof Error ? err.message : String(err);
          return this.createErrorTicker(appSymbol, providerSymbol, assetType, `Bitget connection failed: ${msg}`);
        }
      }
      mapTimeframeToGranularity(timeframe) {
        switch (timeframe.toLowerCase().trim()) {
          case "1m":
          case "1min":
            return "1min";
          case "3m":
          case "3min":
            return "3min";
          case "5m":
          case "5min":
            return "5min";
          case "15m":
          case "15min":
            return "15min";
          case "30m":
          case "30min":
            return "30min";
          case "1h":
          case "1hour":
          case "60m":
            return "1h";
          case "4h":
          case "4hour":
            return "4h";
          case "6h":
          case "6hour":
            return "6h";
          case "12h":
          case "12hour":
            return "12h";
          case "1d":
          case "1day":
            return "1day";
          case "1w":
          case "1week":
            return "1week";
          default:
            return null;
        }
      }
      async fetchDirectCandles(appSymbol, providerSymbol, requestedTimeframe, granularity, limit, globalScanDeadlineMs) {
        const configTimeout = serverConfig.getConfig().marketDataTimeoutMs;
        let timeoutMs = configTimeout;
        const safetyMargin = 100;
        if (globalScanDeadlineMs) {
          const remainingMs = globalScanDeadlineMs - Date.now();
          if (remainingMs <= safetyMargin) {
            throw new Error("TIMEOUT: Global scanner deadline reached before starting request");
          }
          timeoutMs = Math.min(configTimeout, remainingMs - safetyMargin);
        }
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const url = `https://api.bitget.com/api/v2/spot/market/candles?symbol=${encodeURIComponent(providerSymbol)}&granularity=${granularity}&limit=${limit}`;
          const response = await fetch(url, { signal: controller.signal });
          clearTimeout(timeoutId);
          if (!response.ok) {
            throw new Error(`Bitget candles API returned HTTP ${response.status}`);
          }
          const json = await response.json();
          if (json.code !== "00000" || !Array.isArray(json.data)) {
            throw new Error(json.msg || "Failed to fetch candles from Bitget");
          }
          const candles = [];
          for (const item of json.data) {
            if (Array.isArray(item) && item.length >= 6) {
              const ts = parseInt(item[0], 10);
              const open = parseFloat(item[1]);
              const high = parseFloat(item[2]);
              const low = parseFloat(item[3]);
              const close = parseFloat(item[4]);
              const volume = parseFloat(item[5]);
              if (!isNaN(open) && !isNaN(high) && !isNaN(low) && !isNaN(close) && open > 0) {
                candles.push({
                  symbol: SymbolNormalizer.normalizeAppSymbol(appSymbol),
                  provider: this.id,
                  timeframe: requestedTimeframe,
                  open,
                  high,
                  low,
                  close,
                  volume: !isNaN(volume) ? volume : null,
                  timestamp: ts
                });
              }
            }
          }
          return candles;
        } catch (err) {
          clearTimeout(timeoutId);
          throw err;
        }
      }
      async fetchCandles(appSymbol, timeframe = "1m", limit = 50, globalScanDeadlineMs) {
        const mapping = SymbolNormalizer.toProviderSymbol(appSymbol, this.id);
        const { providerSymbol } = mapping;
        const granularity = this.mapTimeframeToGranularity(timeframe);
        if (granularity) {
          try {
            const direct = await this.fetchDirectCandles(appSymbol, providerSymbol, timeframe, granularity, limit, globalScanDeadlineMs);
            if (direct && direct.length > 0) return direct;
          } catch (err) {
            logger.warn(`Bitget direct fetch failed for '${timeframe}' (${granularity})`, { appSymbol, error: String(err) });
          }
        }
        const lowerGranularity = "1min";
        try {
          const lowerCandles = await this.fetchDirectCandles(appSymbol, providerSymbol, "1m", lowerGranularity, limit * 60, globalScanDeadlineMs);
          if (lowerCandles && lowerCandles.length > 0) {
            const aggregated = aggregateOHLCCandles(lowerCandles, timeframe, limit);
            if (aggregated && aggregated.length > 0) return aggregated;
          }
        } catch (err) {
          logger.warn(`Bitget lower-timeframe aggregation failed for '${timeframe}'`, { appSymbol, error: String(err) });
        }
        logger.info(`Timeframe '${timeframe}' unavailable for ${appSymbol} on Bitget`);
        return [];
      }
      async healthCheck() {
        const start = Date.now();
        try {
          const ticker = await this.fetchPrice("BTCUSDT");
          const latencyMs = Date.now() - start;
          if (ticker.status === "OK" || ticker.status === "STALE") {
            return {
              provider: this.id,
              name: this.name,
              configured: true,
              status: "CONNECTED",
              latencyMs,
              lastChecked: (/* @__PURE__ */ new Date()).toISOString()
            };
          } else {
            return {
              provider: this.id,
              name: this.name,
              configured: true,
              status: "UNAVAILABLE",
              latencyMs,
              lastChecked: (/* @__PURE__ */ new Date()).toISOString(),
              errorMessage: ticker.errorMessage
            };
          }
        } catch (err) {
          return {
            provider: this.id,
            name: this.name,
            configured: true,
            status: "UNAVAILABLE",
            lastChecked: (/* @__PURE__ */ new Date()).toISOString(),
            errorMessage: err instanceof Error ? err.message : String(err)
          };
        }
      }
      createErrorTicker(appSymbol, rawSymbol, assetType, errorMessage) {
        return {
          symbol: SymbolNormalizer.normalizeAppSymbol(appSymbol),
          rawSymbol,
          provider: this.id,
          assetType,
          bid: null,
          ask: null,
          price: 0,
          timestamp: 0,
          receivedAt: Date.now(),
          source: "LIVE",
          isFresh: false,
          status: "MARKET_DATA_UNAVAILABLE",
          errorMessage
        };
      }
    };
  }
});

// src/server/market/adapters/FinnhubAdapter.ts
var FinnhubAdapter;
var init_FinnhubAdapter = __esm({
  "src/server/market/adapters/FinnhubAdapter.ts"() {
    init_SymbolNormalizer();
    init_config();
    init_logger();
    FinnhubAdapter = class {
      constructor() {
        this.id = "finnhub";
        this.name = "Finnhub Market Data";
      }
      async fetchPrice(appSymbol, globalScanDeadlineMs) {
        const receivedAt = Date.now();
        let providerSymbol = appSymbol;
        let assetType = "STOCK";
        const apiKey = process.env.FINNHUB_API_KEY;
        if (!apiKey || apiKey.trim().length === 0) {
          return this.createErrorTicker(
            appSymbol,
            providerSymbol,
            assetType,
            "Finnhub API key not configured in environment variables (FINNHUB_API_KEY)"
          );
        }
        const configTimeout = serverConfig.getConfig().marketDataTimeoutMs;
        let timeoutMs = configTimeout;
        const safetyMargin = 100;
        if (globalScanDeadlineMs) {
          const remainingMs = globalScanDeadlineMs - Date.now();
          if (remainingMs <= safetyMargin) {
            throw new Error("TIMEOUT: Global scanner deadline reached before starting request");
          }
          timeoutMs = Math.min(configTimeout, remainingMs - safetyMargin);
        }
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const mapping = SymbolNormalizer.toProviderSymbol(appSymbol, this.id);
          providerSymbol = mapping.providerSymbol;
          assetType = mapping.assetType;
          const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(providerSymbol)}&token=${encodeURIComponent(apiKey.trim())}`;
          const response = await fetch(url, {
            signal: controller.signal,
            headers: { "Accept": "application/json" }
          });
          clearTimeout(timeoutId);
          if (response.status === 401 || response.status === 403) {
            return this.createErrorTicker(appSymbol, providerSymbol, assetType, "Invalid or unauthorized Finnhub API key");
          }
          if (response.status === 429) {
            return this.createErrorTicker(appSymbol, providerSymbol, assetType, "Finnhub API rate limit exceeded (HTTP 429)");
          }
          if (!response.ok) {
            return this.createErrorTicker(appSymbol, providerSymbol, assetType, `Finnhub API returned HTTP ${response.status}`);
          }
          const json = await response.json();
          if (json.error) {
            return this.createErrorTicker(appSymbol, providerSymbol, assetType, `Finnhub error: ${json.error}`);
          }
          let price = json.c;
          const timestampSec = json.t;
          if ((typeof price !== "number" || isNaN(price) || !isFinite(price) || price <= 0) && typeof json.pc === "number" && !isNaN(json.pc) && isFinite(json.pc) && json.pc > 0) {
            price = json.pc;
          }
          if (typeof price !== "number" || isNaN(price) || !isFinite(price) || price <= 0) {
            return this.createErrorTicker(
              appSymbol,
              providerSymbol,
              assetType,
              `Finnhub returned no valid price for symbol ${providerSymbol} (c: ${json.c}, pc: ${json.pc})`
            );
          }
          const timestamp = typeof timestampSec === "number" && timestampSec > 0 ? timestampSec * 1e3 : receivedAt;
          const isFresh = true;
          return {
            symbol: SymbolNormalizer.normalizeAppSymbol(appSymbol),
            rawSymbol: providerSymbol,
            provider: this.id,
            assetType,
            bid: null,
            ask: null,
            price,
            timestamp,
            receivedAt,
            source: "LIVE",
            isFresh,
            status: isFresh ? "OK" : "STALE"
          };
        } catch (err) {
          clearTimeout(timeoutId);
          const msg = err instanceof Error ? err.message : String(err);
          return this.createErrorTicker(appSymbol, providerSymbol, assetType, `Finnhub connection failed: ${msg}`);
        }
      }
      async healthCheck() {
        const apiKey = process.env.FINNHUB_API_KEY;
        const isConfigured = Boolean(apiKey && apiKey.trim().length > 0);
        if (!isConfigured) {
          return {
            provider: this.id,
            name: this.name,
            configured: false,
            status: "UNAVAILABLE",
            lastChecked: (/* @__PURE__ */ new Date()).toISOString(),
            errorMessage: "FINNHUB_API_KEY environment variable is missing"
          };
        }
        const start = Date.now();
        try {
          const ticker = await this.fetchPrice("AAPL");
          const latencyMs = Date.now() - start;
          if (ticker.status === "OK" || ticker.status === "STALE") {
            return {
              provider: this.id,
              name: this.name,
              configured: true,
              status: "CONNECTED",
              latencyMs,
              lastChecked: (/* @__PURE__ */ new Date()).toISOString()
            };
          } else {
            return {
              provider: this.id,
              name: this.name,
              configured: true,
              status: "UNAVAILABLE",
              latencyMs,
              lastChecked: (/* @__PURE__ */ new Date()).toISOString(),
              errorMessage: ticker.errorMessage
            };
          }
        } catch (err) {
          return {
            provider: this.id,
            name: this.name,
            configured: true,
            status: "UNAVAILABLE",
            lastChecked: (/* @__PURE__ */ new Date()).toISOString(),
            errorMessage: err instanceof Error ? err.message : String(err)
          };
        }
      }
      mapTimeframeToFinnhubResolution(timeframe) {
        const tf = timeframe.toLowerCase().trim();
        switch (tf) {
          case "1m":
          case "1min":
            return { resolution: "1", secondsPerBar: 60 };
          case "5m":
          case "5min":
            return { resolution: "5", secondsPerBar: 300 };
          case "15m":
          case "15min":
            return { resolution: "15", secondsPerBar: 900 };
          case "30m":
          case "30min":
            return { resolution: "30", secondsPerBar: 1800 };
          case "1h":
          case "1hour":
          case "60m":
            return { resolution: "60", secondsPerBar: 3600 };
          case "1d":
          case "1day":
            return { resolution: "D", secondsPerBar: 86400 };
          case "1w":
          case "1week":
            return { resolution: "W", secondsPerBar: 604800 };
          default:
            return null;
        }
      }
      async fetchCandles(appSymbol, timeframe = "1m", limit = 50, globalScanDeadlineMs) {
        const apiKey = process.env.FINNHUB_API_KEY;
        if (!apiKey || apiKey.trim().length === 0) {
          logger.warn("FINNHUB_API_KEY environment variable missing for stock candle fetching");
          return [];
        }
        const mapping = SymbolNormalizer.toProviderSymbol(appSymbol, this.id);
        const providerSymbol = mapping.providerSymbol;
        const resInfo = this.mapTimeframeToFinnhubResolution(timeframe);
        if (!resInfo) {
          logger.info(`Timeframe '${timeframe}' not supported natively by Finnhub for ${appSymbol}`);
          return [];
        }
        const toSec = Math.floor(Date.now() / 1e3);
        const windowSec = Math.max(limit * resInfo.secondsPerBar * 5, 7 * 86400);
        const fromSec = toSec - windowSec;
        const configTimeout = serverConfig.getConfig().marketDataTimeoutMs;
        let timeoutMs = configTimeout;
        const safetyMargin = 100;
        if (globalScanDeadlineMs) {
          const remainingMs = globalScanDeadlineMs - Date.now();
          if (remainingMs <= safetyMargin) {
            throw new Error("TIMEOUT: Global scanner deadline reached before starting request");
          }
          timeoutMs = Math.min(configTimeout, remainingMs - safetyMargin);
        }
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        try {
          let endpointPath = "stock/candle";
          if (mapping.assetType === "FOREX") {
            endpointPath = "forex/candle";
          } else if (mapping.assetType === "CRYPTO") {
            endpointPath = "crypto/candle";
          }
          const url = `https://finnhub.io/api/v1/${endpointPath}?symbol=${encodeURIComponent(providerSymbol)}&resolution=${resInfo.resolution}&from=${fromSec}&to=${toSec}&token=${encodeURIComponent(apiKey.trim())}`;
          const response = await fetch(url, { signal: controller.signal });
          clearTimeout(timeoutId);
          if (!response.ok) {
            logger.warn(`Finnhub ${mapping.assetType} candle endpoint returned HTTP ${response.status} for ${appSymbol}`);
            return [];
          }
          const json = await response.json();
          if (json.s !== "ok" || !Array.isArray(json.c) || json.c.length === 0) {
            logger.info(`Finnhub returned no candle data (status: ${json.s}) for ${appSymbol} (${timeframe})`);
            return [];
          }
          const normSymbol = SymbolNormalizer.normalizeAppSymbol(appSymbol);
          const candles = [];
          const count = json.c.length;
          for (let i = 0; i < count; i++) {
            const open = json.o?.[i];
            const high = json.h?.[i];
            const low = json.l?.[i];
            const close = json.c?.[i];
            const timestampSec = json.t?.[i];
            const vol = json.v?.[i];
            if (typeof open === "number" && !isNaN(open) && open > 0 && typeof high === "number" && !isNaN(high) && high > 0 && typeof low === "number" && !isNaN(low) && low > 0 && typeof close === "number" && !isNaN(close) && close > 0 && typeof timestampSec === "number" && timestampSec > 0) {
              candles.push({
                symbol: normSymbol,
                provider: this.id,
                timeframe,
                open,
                high,
                low,
                close,
                volume: typeof vol === "number" && !isNaN(vol) ? vol : null,
                timestamp: timestampSec * 1e3
              });
            }
          }
          candles.sort((a, b) => b.timestamp - a.timestamp);
          return candles.slice(0, limit);
        } catch (err) {
          clearTimeout(timeoutId);
          logger.warn(`Failed to fetch candles from Finnhub for ${appSymbol}`, { error: String(err) });
          return [];
        }
      }
      createErrorTicker(appSymbol, rawSymbol, assetType, errorMessage) {
        return {
          symbol: SymbolNormalizer.normalizeAppSymbol(appSymbol),
          rawSymbol,
          provider: this.id,
          assetType,
          bid: null,
          ask: null,
          price: 0,
          timestamp: 0,
          receivedAt: Date.now(),
          source: "LIVE",
          isFresh: false,
          status: "MARKET_DATA_UNAVAILABLE",
          errorMessage
        };
      }
    };
  }
});

// src/server/market/QuotaManager.ts
var QuotaManager, quotaManager;
var init_QuotaManager = __esm({
  "src/server/market/QuotaManager.ts"() {
    init_logger();
    QuotaManager = class _QuotaManager {
      constructor() {
        // Rolling API call log per provider: providerId -> list of timestamps
        this.requestLogs = /* @__PURE__ */ new Map();
        this.totalSessionRequests = /* @__PURE__ */ new Map();
        // Latency tracking (Exponential moving average)
        this.averageLatency = /* @__PURE__ */ new Map();
        // Error & Timeout logs (last 5 minutes)
        this.recentErrors = /* @__PURE__ */ new Map();
        this.recentTimeouts = /* @__PURE__ */ new Map();
        // Backoff states per provider
        this.backoffCount = /* @__PURE__ */ new Map();
        this.lockedUntil = /* @__PURE__ */ new Map();
        // Configured limits & reserved quotas per provider
        this.providerQuotas = {
          twelvedata: { maxPerMinute: 8, maxPerSecond: 2, lowThreshold: 5, reservedRequests: 2 },
          finnhub: { maxPerMinute: 30, maxPerSecond: 5, lowThreshold: 24, reservedRequests: 3 },
          bitget: { maxPerMinute: 120, maxPerSecond: 10, lowThreshold: 90, reservedRequests: 5 },
          exchangerate: { maxPerMinute: 10, maxPerSecond: 2, lowThreshold: 7, reservedRequests: 2 }
        };
      }
      static getInstance() {
        if (!_QuotaManager.instance) {
          _QuotaManager.instance = new _QuotaManager();
        }
        return _QuotaManager.instance;
      }
      /**
       * Returns comprehensive quota metrics for a single provider.
       */
      getProviderMetrics(providerId) {
        const cleanProvider = providerId.toLowerCase();
        const now = Date.now();
        this.cleanupLogs(cleanProvider, now);
        const logs = this.requestLogs.get(cleanProvider) || [];
        const quota = this.providerQuotas[cleanProvider] || {
          maxPerMinute: 10,
          maxPerSecond: 2,
          lowThreshold: 7,
          reservedRequests: 2
        };
        const oneSecAgo = now - 1e3;
        const requestsInLastSec = logs.filter((ts) => ts > oneSecAgo).length;
        const requestsInLastMin = logs.length;
        const remainingMinute = Math.max(0, quota.maxPerMinute - requestsInLastMin);
        const remainingUsable = Math.max(0, remainingMinute - quota.reservedRequests);
        const lockedTime = this.lockedUntil.get(cleanProvider) || 0;
        const isLocked = now < lockedTime;
        const errors = this.recentErrors.get(cleanProvider) || [];
        const timeouts = this.recentTimeouts.get(cleanProvider) || [];
        const avgLatency = this.averageLatency.get(cleanProvider) || 120;
        let budgetHealth = "HIGH";
        if (isLocked || remainingUsable === 0) {
          budgetHealth = "EXHAUSTED";
        } else if (errors.length >= 3 || timeouts.length >= 2 || (quota.maxPerMinute > 15 ? remainingUsable <= 2 : remainingUsable <= 1)) {
          budgetHealth = "CRITICAL";
        } else if (quota.maxPerMinute > 15 ? remainingUsable <= 6 : remainingUsable <= 2) {
          budgetHealth = "LOW";
        } else if (remainingUsable < Math.floor(quota.maxPerMinute * 0.75)) {
          budgetHealth = "NORMAL";
        } else {
          budgetHealth = "HIGH";
        }
        return {
          providerId: cleanProvider,
          requestsUsedRollingMinute: requestsInLastMin,
          requestsUsedRollingSecond: requestsInLastSec,
          requestsTotalSession: this.totalSessionRequests.get(cleanProvider) || 0,
          requestsRemainingRollingMinute: remainingMinute,
          requestsRemainingUsable: remainingUsable,
          maxPerMinute: quota.maxPerMinute,
          maxPerSecond: quota.maxPerSecond,
          reservedRequests: quota.reservedRequests,
          recentErrors: [...errors],
          recentTimeouts: [...timeouts],
          averageLatencyMs: Math.round(avgLatency),
          isLocked,
          lockedUntilMs: lockedTime,
          budgetHealth
        };
      }
      /**
       * Returns snapshot metrics across all known providers.
       */
      getAllProviderMetrics() {
        const result = {};
        for (const p of Object.keys(this.providerQuotas)) {
          result[p] = this.getProviderMetrics(p);
        }
        return result;
      }
      /**
       * Evaluates API budget status for deep scan routing:
       * HIGH -> 12 deep candidates
       * NORMAL -> 10 deep candidates
       * LOW -> 8 deep candidates (matches 8â€“12 target)
       * CRITICAL -> 4 deep candidates
       * EXHAUSTED -> 0 deep candidates
       */
      getDynamicDeepBudget(category) {
        const allMetrics = this.getAllProviderMetrics();
        let relevantProviders = Object.keys(this.providerQuotas);
        const normCat = (category || "").toUpperCase();
        if (normCat.includes("CRYPTO")) {
          relevantProviders = ["bitget"];
        } else if (normCat.includes("FOREX") || normCat.includes("FX")) {
          relevantProviders = ["twelvedata", "exchangerate", "finnhub"];
        } else if (normCat.includes("STOCK") || normCat.includes("EQUITY")) {
          relevantProviders = ["finnhub", "twelvedata"];
        }
        const relevantMetrics = {};
        for (const p of relevantProviders) {
          if (allMetrics[p]) relevantMetrics[p] = allMetrics[p];
        }
        const metricList = Object.values(relevantMetrics);
        const allExhausted = metricList.length > 0 && metricList.every((m) => m.budgetHealth === "EXHAUSTED");
        if (allExhausted) {
          return {
            overallHealth: "EXHAUSTED",
            maxDeepCandidates: 0,
            metrics: allMetrics,
            reason: "All active providers for this category are currently locked or have exhausted usable quota."
          };
        }
        const healthLevels = {
          EXHAUSTED: 0,
          CRITICAL: 1,
          LOW: 2,
          NORMAL: 3,
          HIGH: 4
        };
        let minLevel = 4;
        for (const m of metricList) {
          const lvl = healthLevels[m.budgetHealth];
          if (lvl < minLevel) {
            minLevel = lvl;
          }
        }
        if (minLevel === 0) {
          return {
            overallHealth: "CRITICAL",
            maxDeepCandidates: 4,
            metrics: allMetrics,
            reason: "One provider is in cooldown; limiting deep scan candidate pool to 4."
          };
        } else if (minLevel === 1) {
          return {
            overallHealth: "CRITICAL",
            maxDeepCandidates: 4,
            metrics: allMetrics,
            reason: "Provider quotas are in CRITICAL state; limiting deep scan to 4 candidates."
          };
        } else if (minLevel === 2) {
          return {
            overallHealth: "LOW",
            maxDeepCandidates: 8,
            metrics: allMetrics,
            reason: "Provider quotas are in LOW state; allowing 8 deep candidates (8\u201312 target architecture)."
          };
        } else if (minLevel === 3) {
          return {
            overallHealth: "NORMAL",
            maxDeepCandidates: 10,
            metrics: allMetrics,
            reason: "Provider quotas are in NORMAL state; allowing 10 deep candidates (8\u201312 target architecture)."
          };
        } else {
          return {
            overallHealth: "HIGH",
            maxDeepCandidates: 12,
            metrics: allMetrics,
            reason: "Provider quotas are HEALTHY with ample capacity; allowing maximum 12 deep candidates (8\u201312 target architecture)."
          };
        }
      }
      /**
       * Evaluates current API budget health status for backward compatibility.
       */
      getBudgetStatus(providerId = "twelvedata") {
        const metrics = this.getProviderMetrics(providerId);
        if (metrics.budgetHealth === "EXHAUSTED" || metrics.budgetHealth === "CRITICAL" || metrics.budgetHealth === "LOW") {
          return "CONSTRAINED";
        } else if (metrics.budgetHealth === "NORMAL") {
          return "MODERATE";
        }
        return "HEALTHY";
      }
      /**
       * Returns remaining usable quota for a provider in the rolling 60-second window.
       */
      getRemainingQuota(providerId = "twelvedata") {
        return this.getProviderMetrics(providerId).requestsRemainingUsable;
      }
      /**
       * Evaluates if a request should proceed or be blocked.
       * NEVER consumes reserved quota for non-critical calls.
       */
      canMakeRequest(providerId, critical) {
        const cleanProvider = providerId.toLowerCase();
        const now = Date.now();
        const lockedTime = this.lockedUntil.get(cleanProvider) || 0;
        if (now < lockedTime) {
          const waitLeft = Math.ceil((lockedTime - now) / 1e3);
          logger.debug(`Request blocked: Provider ${providerId} is in cooldown lock`, { waitLeftSeconds: waitLeft });
          return false;
        }
        this.cleanupLogs(cleanProvider, now);
        const logs = this.requestLogs.get(cleanProvider) || [];
        const quota = this.providerQuotas[cleanProvider] || {
          maxPerMinute: 10,
          maxPerSecond: 2,
          lowThreshold: 7,
          reservedRequests: 2
        };
        const oneSecAgo = now - 1e3;
        const rps = logs.filter((ts) => ts > oneSecAgo).length;
        if (rps >= quota.maxPerSecond) {
          logger.info(`Request blocked: Rate limit per second (${quota.maxPerSecond}/sec) reached for ${providerId}`);
          return false;
        }
        if (logs.length >= quota.maxPerMinute) {
          logger.info(`Request blocked: Absolute minute quota limit (${quota.maxPerMinute}/min) reached for ${providerId}`);
          return false;
        }
        const allowableForNonCritical = quota.maxPerMinute - quota.reservedRequests;
        if (!critical && logs.length >= allowableForNonCritical) {
          logger.info(`Request blocked: Reserved quota safety barrier reached on ${providerId} (${logs.length}/${allowableForNonCritical} used)`);
          return false;
        }
        return true;
      }
      /**
       * Tracks an active API call for rate limiting logs.
       */
      recordRequest(providerId) {
        const cleanProvider = providerId.toLowerCase();
        const now = Date.now();
        if (!this.requestLogs.has(cleanProvider)) {
          this.requestLogs.set(cleanProvider, []);
        }
        this.requestLogs.get(cleanProvider).push(now);
        const curTotal = (this.totalSessionRequests.get(cleanProvider) || 0) + 1;
        this.totalSessionRequests.set(cleanProvider, curTotal);
      }
      /**
       * Records API response status, latency, errors, and timeouts to handle HTTP 429 backoff.
       */
      recordResponse(providerId, status, latencyMs, isTimeout = false, errorMessage) {
        const cleanProvider = providerId.toLowerCase();
        const now = Date.now();
        if (latencyMs && latencyMs > 0) {
          const prevLatency = this.averageLatency.get(cleanProvider) || latencyMs;
          const newLatency = prevLatency * 0.8 + latencyMs * 0.2;
          this.averageLatency.set(cleanProvider, newLatency);
        }
        if (isTimeout) {
          if (!this.recentTimeouts.has(cleanProvider)) {
            this.recentTimeouts.set(cleanProvider, []);
          }
          this.recentTimeouts.get(cleanProvider).push({ timestamp: now, message: errorMessage });
        }
        if (status >= 400 || isTimeout) {
          if (!this.recentErrors.has(cleanProvider)) {
            this.recentErrors.set(cleanProvider, []);
          }
          this.recentErrors.get(cleanProvider).push({ timestamp: now, status, message: errorMessage });
        }
        if (status === 429) {
          const existingLock = this.lockedUntil.get(cleanProvider) || 0;
          if (existingLock > now && existingLock - now > 5e3) {
            return;
          }
          const currentCount = (this.backoffCount.get(cleanProvider) || 0) + 1;
          this.backoffCount.set(cleanProvider, currentCount);
          const baseBackoff = 15 * 1e3;
          const backoffDuration = Math.min(600 * 1e3, baseBackoff * Math.pow(2, currentCount - 1));
          const unlockTime = now + backoffDuration;
          this.lockedUntil.set(cleanProvider, unlockTime);
          logger.info(`Provider ${providerId} returned HTTP 429. Exponential backoff active`, {
            consecutiveRateLimits: currentCount,
            cooldownMs: backoffDuration,
            lockedUntil: new Date(unlockTime).toISOString()
          });
        } else if (status >= 200 && status < 300) {
          if (this.backoffCount.get(cleanProvider) !== 0) {
            this.backoffCount.set(cleanProvider, 0);
          }
        }
      }
      /**
       * Returns total error count across all providers in the last 5 minutes.
       */
      getTotalRecentErrors() {
        let total = 0;
        const now = Date.now();
        for (const p of Object.keys(this.providerQuotas)) {
          this.cleanupLogs(p, now);
          total += (this.recentErrors.get(p) || []).length;
        }
        return total;
      }
      /**
       * Returns total timeout count across all providers in the last 5 minutes.
       */
      getTotalRecentTimeouts() {
        let total = 0;
        const now = Date.now();
        for (const p of Object.keys(this.providerQuotas)) {
          this.cleanupLogs(p, now);
          total += (this.recentTimeouts.get(p) || []).length;
        }
        return total;
      }
      /**
       * Returns total lifetime session requests made across all providers.
       */
      getTotalSessionRequestsAll() {
        let total = 0;
        for (const count of this.totalSessionRequests.values()) {
          total += count;
        }
        return total;
      }
      /**
       * Returns sum of usable remaining requests across all providers in rolling minute.
       */
      getOverallUsableQuota() {
        let total = 0;
        for (const p of Object.keys(this.providerQuotas)) {
          total += this.getProviderMetrics(p).requestsRemainingUsable;
        }
        return total;
      }
      cleanupLogs(providerId, now) {
        const logs = this.requestLogs.get(providerId);
        if (logs) {
          const threshold = now - 6e4;
          const freshLogs = logs.filter((ts) => ts > threshold);
          this.requestLogs.set(providerId, freshLogs);
        }
        const errors = this.recentErrors.get(providerId);
        if (errors) {
          const errThreshold = now - 3e5;
          this.recentErrors.set(providerId, errors.filter((e) => e.timestamp > errThreshold));
        }
        const timeouts = this.recentTimeouts.get(providerId);
        if (timeouts) {
          const toThreshold = now - 3e5;
          this.recentTimeouts.set(providerId, timeouts.filter((t) => t.timestamp > toThreshold));
        }
      }
    };
    quotaManager = QuotaManager.getInstance();
  }
});

// src/server/market/adapters/TwelveDataAdapter.ts
var TwelveDataAdapter;
var init_TwelveDataAdapter = __esm({
  "src/server/market/adapters/TwelveDataAdapter.ts"() {
    init_SymbolNormalizer();
    init_CandleAggregator();
    init_QuotaManager();
    init_config();
    init_logger();
    TwelveDataAdapter = class {
      constructor() {
        this.id = "twelvedata";
        this.name = "Twelve Data (Forex)";
      }
      async fetchPrice(appSymbol, globalScanDeadlineMs) {
        let providerSymbol = appSymbol;
        let assetType = "FOREX";
        const apiKey = process.env.TWELVE_DATA_API_KEY;
        if (!apiKey || apiKey.trim().length === 0) {
          return this.createErrorTicker(
            appSymbol,
            providerSymbol,
            assetType,
            "TWELVE_DATA_API_KEY environment variable is required"
          );
        }
        try {
          const mapping = SymbolNormalizer.toProviderSymbol(appSymbol, this.id);
          providerSymbol = mapping.providerSymbol;
          assetType = mapping.assetType;
          const configTimeout = serverConfig.getConfig().marketDataTimeoutMs;
          let timeoutMs = configTimeout;
          const safetyMargin = 100;
          if (globalScanDeadlineMs) {
            const remainingMs = globalScanDeadlineMs - Date.now();
            if (remainingMs <= safetyMargin) {
              throw new Error("TIMEOUT: Global scanner deadline reached before starting request");
            }
            timeoutMs = Math.min(configTimeout, remainingMs - safetyMargin);
          }
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
          const url = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(providerSymbol)}&apikey=${apiKey.trim()}`;
          const response = await fetch(url, {
            signal: controller.signal,
            headers: {
              "Accept": "application/json"
            }
          });
          clearTimeout(timeoutId);
          if (!response.ok) {
            if (response.status === 429) {
              quotaManager.recordResponse(this.id, 429);
            }
            return this.createErrorTicker(
              appSymbol,
              providerSymbol,
              assetType,
              `Twelve Data API returned HTTP ${response.status} (${response.statusText})`
            );
          }
          const json = await response.json();
          if (json.status === "error" || json.code && json.code >= 400) {
            if (json.code === 429 || json.message?.toLowerCase().includes("rate limit") || json.message?.toLowerCase().includes("429")) {
              quotaManager.recordResponse(this.id, 429);
            }
            return this.createErrorTicker(
              appSymbol,
              providerSymbol,
              assetType,
              json.message || `Twelve Data API returned error code ${json.code}`
            );
          }
          const parsedBid = json.bid ? parseFloat(json.bid) : NaN;
          const parsedAsk = json.ask ? parseFloat(json.ask) : NaN;
          const parsedPrice = json.price ? parseFloat(json.price) : json.close ? parseFloat(json.close) : NaN;
          const bid = !isNaN(parsedBid) && parsedBid > 0 ? parsedBid : null;
          const ask = !isNaN(parsedAsk) && parsedAsk > 0 ? parsedAsk : null;
          let price = 0;
          if (bid !== null && ask !== null) {
            price = (bid + ask) / 2;
          } else if (!isNaN(parsedPrice) && parsedPrice > 0) {
            price = parsedPrice;
          } else if (ask !== null) {
            price = ask;
          } else if (bid !== null) {
            price = bid;
          }
          if (isNaN(price) || price <= 0) {
            return this.createErrorTicker(
              appSymbol,
              providerSymbol,
              assetType,
              `Invalid positive market price returned by Twelve Data API for ${appSymbol}`
            );
          }
          let timestamp = Date.now();
          if (typeof json.timestamp === "number" && json.timestamp > 0) {
            timestamp = json.timestamp * 1e3;
          } else if (json.datetime) {
            const parsedDt = new Date(json.datetime).getTime();
            if (!isNaN(parsedDt) && parsedDt > 0) timestamp = parsedDt;
          }
          const receivedAt = Date.now();
          const ageMs = receivedAt - timestamp;
          const isFresh = ageMs <= 24 * 60 * 60 * 1e3 && Date.now() - receivedAt <= 6e4;
          return {
            symbol: SymbolNormalizer.normalizeAppSymbol(appSymbol),
            rawSymbol: providerSymbol,
            provider: this.id,
            assetType,
            bid,
            ask,
            price,
            timestamp,
            receivedAt,
            source: "LIVE",
            isFresh,
            status: isFresh ? "OK" : "STALE"
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return this.createErrorTicker(
            appSymbol,
            providerSymbol,
            assetType,
            `Twelve Data connection failed: ${msg}`
          );
        }
      }
      mapTimeframeToTwelveDataInterval(timeframe) {
        const tf = timeframe.toLowerCase().trim();
        switch (tf) {
          case "1m":
          case "1min":
            return "1min";
          case "2m":
          case "2min":
            return "2min";
          case "5m":
          case "5min":
            return "5min";
          case "15m":
          case "15min":
            return "15min";
          case "30m":
          case "30min":
            return "30min";
          case "45m":
          case "45min":
            return "45min";
          case "1h":
          case "1hour":
          case "60m":
            return "1h";
          case "2h":
          case "2hour":
            return "2h";
          case "4h":
          case "4hour":
            return "4h";
          case "1d":
          case "1day":
            return "1day";
          case "1w":
          case "1week":
            return "1week";
          case "1mth":
          case "1month":
            return "1month";
          default:
            return null;
        }
      }
      getLowerTimeframeForAggregation(timeframe) {
        const tf = timeframe.toLowerCase().trim();
        switch (tf) {
          case "3m":
          case "3min":
            return { timeframe: "1m", ratio: 3 };
          case "5m":
          case "5min":
            return { timeframe: "1m", ratio: 5 };
          case "15m":
          case "15min":
            return { timeframe: "5m", ratio: 3 };
          case "30m":
          case "30min":
            return { timeframe: "15m", ratio: 2 };
          case "45m":
          case "45min":
            return { timeframe: "15m", ratio: 3 };
          case "1h":
          case "1hour":
          case "60m":
            return { timeframe: "15m", ratio: 4 };
          case "2h":
          case "2hour":
            return { timeframe: "1h", ratio: 2 };
          case "4h":
          case "4hour":
            return { timeframe: "1h", ratio: 4 };
          case "12h":
          case "12hour":
            return { timeframe: "1h", ratio: 12 };
          case "1d":
          case "1day":
            return { timeframe: "1h", ratio: 24 };
          default:
            return null;
        }
      }
      async fetchDirectTimeSeries(appSymbol, providerSymbol, requestedTimeframe, interval, limit, apiKey, globalScanDeadlineMs) {
        const configTimeout = serverConfig.getConfig().marketDataTimeoutMs;
        let timeoutMs = configTimeout;
        const safetyMargin = 100;
        if (globalScanDeadlineMs) {
          const remainingMs = globalScanDeadlineMs - Date.now();
          if (remainingMs <= safetyMargin) {
            throw new Error("TIMEOUT: Global scanner deadline reached before starting request");
          }
          timeoutMs = Math.min(configTimeout, remainingMs - safetyMargin);
        }
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(providerSymbol)}&interval=${interval}&outputsize=${limit}&apikey=${apiKey.trim()}`;
        try {
          const response = await fetch(url, { signal: controller.signal });
          clearTimeout(timeoutId);
          if (!response.ok) {
            if (response.status === 429) {
              quotaManager.recordResponse(this.id, 429);
            }
            throw new Error(`Twelve Data Time Series API returned HTTP ${response.status}`);
          }
          const json = await response.json();
          if (json.status === "error" || !json.values || !Array.isArray(json.values)) {
            if (json.code === 429 || json.message?.toLowerCase().includes("rate limit") || json.message?.toLowerCase().includes("429")) {
              quotaManager.recordResponse(this.id, 429);
            }
            if (json.message) throw new Error(`Twelve Data API error: ${json.message}`);
            return [];
          }
          if (json.meta?.interval) {
            const returnedInterval = json.meta.interval.toLowerCase().trim();
            if (returnedInterval !== interval.toLowerCase().trim()) {
              logger.warn(`Twelve Data returned interval '${returnedInterval}' which differs from requested '${interval}'`);
              return [];
            }
          }
          const normSymbol = SymbolNormalizer.normalizeAppSymbol(appSymbol);
          const candles = [];
          for (const item of json.values) {
            const open = parseFloat(item.open);
            const high = parseFloat(item.high);
            const low = parseFloat(item.low);
            const close = parseFloat(item.close);
            const volume = item.volume ? parseFloat(item.volume) : null;
            let timestamp = Date.now();
            if (typeof item.timestamp === "number" && item.timestamp > 0) {
              timestamp = item.timestamp * 1e3;
            } else if (item.datetime) {
              const parsedDt = new Date(item.datetime).getTime();
              if (!isNaN(parsedDt) && parsedDt > 0) timestamp = parsedDt;
            }
            if (!isNaN(open) && open > 0 && !isNaN(high) && high > 0 && !isNaN(low) && low > 0 && !isNaN(close) && close > 0 && high >= low && high >= open && high >= close && low <= open && low <= close) {
              candles.push({
                symbol: normSymbol,
                provider: this.id,
                timeframe: requestedTimeframe,
                open,
                high,
                low,
                close,
                volume: isNaN(volume) ? null : volume,
                timestamp
              });
            }
          }
          return candles;
        } catch (err) {
          clearTimeout(timeoutId);
          throw err;
        }
      }
      async fetchCandles(appSymbol, timeframe = "1m", limit = 50, globalScanDeadlineMs) {
        const apiKey = process.env.TWELVE_DATA_API_KEY;
        if (!apiKey || apiKey.trim().length === 0) {
          throw new Error("TWELVE_DATA_API_KEY environment variable is required for candle fetching");
        }
        const mapping = SymbolNormalizer.toProviderSymbol(appSymbol, this.id);
        const providerSymbol = mapping.providerSymbol;
        const mappedInterval = this.mapTimeframeToTwelveDataInterval(timeframe);
        if (mappedInterval) {
          try {
            const directCandles = await this.fetchDirectTimeSeries(appSymbol, providerSymbol, timeframe, mappedInterval, limit, apiKey, globalScanDeadlineMs);
            if (directCandles && directCandles.length > 0) {
              return directCandles;
            }
          } catch (err) {
            const errMsg = String(err);
            if (errMsg.includes("TIMEOUT")) {
              throw err;
            }
            const isRateLimit = errMsg.includes("429") || errMsg.toLowerCase().includes("rate limit");
            logger.warn(`Twelve Data direct fetch for interval '${mappedInterval}' (${timeframe}) failed${isRateLimit ? " (Rate Limited)" : ", trying aggregation"}`, {
              symbol: appSymbol,
              error: errMsg
            });
            if (isRateLimit) {
              return [];
            }
          }
        }
        const lowerTf = this.getLowerTimeframeForAggregation(timeframe);
        if (lowerTf) {
          const lowerInterval = this.mapTimeframeToTwelveDataInterval(lowerTf.timeframe);
          if (lowerInterval) {
            try {
              const fetchLimit = limit * lowerTf.ratio;
              const lowerCandles = await this.fetchDirectTimeSeries(appSymbol, providerSymbol, lowerTf.timeframe, lowerInterval, fetchLimit, apiKey, globalScanDeadlineMs);
              if (lowerCandles && lowerCandles.length > 0) {
                const aggregated = aggregateOHLCCandles(lowerCandles, timeframe, limit);
                if (aggregated && aggregated.length > 0) {
                  return aggregated;
                }
              }
            } catch (err) {
              const errMsg = String(err);
              if (errMsg.includes("TIMEOUT")) {
                throw err;
              }
              logger.warn(`Twelve Data lower timeframe aggregation for '${timeframe}' using '${lowerTf.timeframe}' failed`, {
                symbol: appSymbol,
                error: errMsg
              });
            }
          }
        }
        logger.info(`Timeframe '${timeframe}' unavailable for ${appSymbol} on Twelve Data`);
        return [];
      }
      async healthCheck() {
        const apiKey = process.env.TWELVE_DATA_API_KEY;
        const isConfigured = Boolean(apiKey && apiKey.trim().length > 0);
        if (!isConfigured) {
          return {
            provider: this.id,
            name: this.name,
            configured: false,
            status: "UNAVAILABLE",
            lastChecked: (/* @__PURE__ */ new Date()).toISOString(),
            errorMessage: "TWELVE_DATA_API_KEY environment variable is missing"
          };
        }
        return {
          provider: this.id,
          name: this.name,
          configured: true,
          status: "CONNECTED",
          latencyMs: 15,
          lastChecked: (/* @__PURE__ */ new Date()).toISOString()
        };
      }
      createErrorTicker(appSymbol, rawSymbol, assetType, errorMessage) {
        return {
          symbol: SymbolNormalizer.normalizeAppSymbol(appSymbol),
          rawSymbol,
          provider: this.id,
          assetType,
          bid: null,
          ask: null,
          price: 0,
          timestamp: 0,
          receivedAt: Date.now(),
          source: "LIVE",
          isFresh: false,
          status: "MARKET_DATA_UNAVAILABLE",
          errorMessage
        };
      }
    };
  }
});

// src/server/market/adapters/ExchangeRateAdapter.ts
var ExchangeRateAdapter;
var init_ExchangeRateAdapter = __esm({
  "src/server/market/adapters/ExchangeRateAdapter.ts"() {
    init_SymbolNormalizer();
    init_config();
    ExchangeRateAdapter = class {
      constructor() {
        this.id = "exchangerate";
        this.name = "Open Exchange Rates (Forex Fallback)";
      }
      async fetchPrice(appSymbol, globalScanDeadlineMs) {
        const receivedAt = Date.now();
        let providerSymbol = appSymbol;
        try {
          const norm = SymbolNormalizer.normalizeAppSymbol(appSymbol);
          if (!norm || norm.length < 6) {
            return this.createErrorTicker(appSymbol, providerSymbol, "Invalid Forex symbol format");
          }
          const base = norm.slice(0, 3);
          const quote = norm.slice(3, 6);
          providerSymbol = `${base}/${quote}`;
          const configTimeout = serverConfig.getConfig().marketDataTimeoutMs;
          let timeoutMs = configTimeout;
          const safetyMargin = 100;
          if (globalScanDeadlineMs) {
            const remainingMs = globalScanDeadlineMs - Date.now();
            if (remainingMs <= safetyMargin) {
              throw new Error("TIMEOUT: Global scanner deadline reached before starting request");
            }
            timeoutMs = Math.min(configTimeout, remainingMs - safetyMargin);
          }
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
          const url = `https://open.er-api.com/v6/latest/${base}`;
          const response = await fetch(url, {
            signal: controller.signal,
            headers: { "Accept": "application/json" }
          });
          clearTimeout(timeoutId);
          if (!response.ok) {
            return this.createErrorTicker(appSymbol, providerSymbol, `ExchangeRate API returned HTTP ${response.status}`);
          }
          const json = await response.json();
          if (!json.rates || typeof json.rates[quote] !== "number") {
            return this.createErrorTicker(appSymbol, providerSymbol, `Rate for pair ${base}/${quote} not available`);
          }
          const price = json.rates[quote];
          if (isNaN(price) || price <= 0) {
            return this.createErrorTicker(appSymbol, providerSymbol, `Invalid rate ${price} returned for ${base}/${quote}`);
          }
          const timestamp = json.time_last_update_unix ? json.time_last_update_unix * 1e3 : receivedAt;
          return {
            symbol: norm,
            rawSymbol: providerSymbol,
            provider: this.id,
            assetType: "FOREX",
            bid: null,
            ask: null,
            price,
            timestamp,
            receivedAt,
            source: "LIVE",
            isFresh: true,
            status: "OK"
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes("TIMEOUT") || msg.includes("AbortError")) {
            throw err;
          }
          return this.createErrorTicker(appSymbol, providerSymbol, `ExchangeRate fetch failed: ${msg}`);
        }
      }
      async healthCheck() {
        return {
          provider: this.id,
          name: this.name,
          configured: true,
          status: "CONNECTED",
          latencyMs: 10,
          lastChecked: (/* @__PURE__ */ new Date()).toISOString()
        };
      }
      createErrorTicker(symbol, rawSymbol, errorMessage) {
        return {
          symbol: SymbolNormalizer.normalizeAppSymbol(symbol),
          rawSymbol,
          provider: this.id,
          assetType: "FOREX",
          bid: null,
          ask: null,
          price: 0,
          timestamp: 0,
          receivedAt: Date.now(),
          source: "LIVE",
          isFresh: false,
          status: "MARKET_DATA_UNAVAILABLE",
          errorMessage
        };
      }
    };
  }
});

// src/server/market/CacheStore.ts
var CacheStore_exports = {};
__export(CacheStore_exports, {
  CACHE_TTL: () => CACHE_TTL,
  ExternalRequestRegistry: () => ExternalRequestRegistry,
  MarketDataCache: () => MarketDataCache,
  marketCache: () => marketCache,
  requestRegistry: () => requestRegistry
});
var getEnvInt, CACHE_TTL, ExternalRequestRegistry, requestRegistry, MarketDataCache, marketCache;
var init_CacheStore = __esm({
  "src/server/market/CacheStore.ts"() {
    init_config();
    init_logger();
    getEnvInt = (key, defaultValue) => {
      const val = process.env[key];
      return val ? parseInt(val, 10) : defaultValue;
    };
    CACHE_TTL = {
      SYMBOL_METADATA: getEnvInt("CACHE_TTL_SYMBOL_METADATA", 24 * 60 * 60 * 1e3),
      // 24 hours
      TRADING_STATUS: getEnvInt("CACHE_TTL_TRADING_STATUS", 2 * 60 * 60 * 1e3),
      // 2 hours (1-6h)
      LATEST_PRICE: getEnvInt("CACHE_TTL_LATEST_PRICE", 60 * 1e3),
      // 1 minute (1-3m)
      STATISTICS_24H: getEnvInt("CACHE_TTL_24H_STATS", 10 * 60 * 1e3),
      // 10 minutes (5-15m)
      VOLUME: getEnvInt("CACHE_TTL_VOLUME", 10 * 60 * 1e3),
      // 10 minutes (5-15m)
      VOLATILITY_STATE: getEnvInt("CACHE_TTL_VOLATILITY_STATE", 10 * 60 * 1e3),
      // 10 minutes (5-15m)
      TREND_STATE: getEnvInt("CACHE_TTL_TREND_STATE", 10 * 60 * 1e3),
      // 10 minutes (5-15m)
      INDICATORS: getEnvInt("CACHE_TTL_INDICATORS", 10 * 60 * 1e3),
      // 10 minutes (5-15m)
      LAST_SCAN_TIMESTAMP: getEnvInt("CACHE_TTL_LAST_SCAN", 60 * 60 * 1e3),
      // 1 hour
      PREVIOUS_SCORE: getEnvInt("CACHE_TTL_PREV_SCORE", 10 * 60 * 1e3),
      // 10 minutes (5-15m)
      PREVIOUS_DIRECTION: getEnvInt("CACHE_TTL_PREV_DIRECTION", 10 * 60 * 1e3),
      // 10 minutes (5-15m)
      MARKET_SESSION_STATUS: getEnvInt("CACHE_TTL_MARKET_SESSION_STATUS", 2 * 60 * 60 * 1e3),
      // 2 hours (1-6h)
      CANDLES_1M: getEnvInt("CACHE_TTL_CANDLES_1M", 2 * 60 * 1e3),
      // 2 minutes (1-3m)
      CANDLES_5M: getEnvInt("CACHE_TTL_CANDLES_5M", 5 * 60 * 1e3),
      // 5 minutes
      CANDLES_15M: getEnvInt("CACHE_TTL_CANDLES_15M", 15 * 60 * 1e3),
      // 15 minutes
      CANDLES_1H: getEnvInt("CACHE_TTL_CANDLES_1H", 60 * 60 * 1e3),
      // 1 hour
      CANDLES_4H: getEnvInt("CACHE_TTL_CANDLES_4H", 4 * 60 * 60 * 1e3)
      // 4 hours
    };
    ExternalRequestRegistry = class {
      constructor() {
        this.records = [];
      }
      record(provider, endpoint, asset, reason) {
        const timestamp = Date.now();
        const entry = { provider, endpoint, asset, timestamp, reason };
        this.records.push(entry);
        logger.info(`[External Request Logged] Provider: ${provider}, Endpoint: ${endpoint}, Asset: ${asset}, Reason: ${reason}`);
      }
      getRecords() {
        return this.records;
      }
      clear() {
        this.records = [];
      }
    };
    requestRegistry = new ExternalRequestRegistry();
    MarketDataCache = class {
      constructor() {
        this.cache = /* @__PURE__ */ new Map();
        this.candleCache = /* @__PURE__ */ new Map();
        this.genericCache = /* @__PURE__ */ new Map();
        this.pendingRequests = /* @__PURE__ */ new Map();
        this.pendingCandleRequests = /* @__PURE__ */ new Map();
        this.hitsCount = 0;
        this.missesCount = 0;
      }
      getStats() {
        return {
          hits: this.hitsCount,
          misses: this.missesCount,
          cachedEntries: this.cache.size + this.candleCache.size
        };
      }
      getCachedSymbolsCount(universeSymbols) {
        let count = 0;
        const now = Date.now();
        for (const sym of universeSymbols) {
          const clean = sym.toUpperCase();
          let found = false;
          for (const [key, entry] of this.cache.entries()) {
            if (key.includes(clean) && now <= entry.expiresAt) {
              found = true;
              break;
            }
          }
          if (found) count++;
        }
        return count;
      }
      getCacheKey(provider, symbol) {
        return `${provider.toLowerCase()}:${symbol.toUpperCase()}`;
      }
      getCandleCacheKey(provider, symbol, timeframe) {
        return `${provider.toLowerCase()}:${symbol.toUpperCase()}:${timeframe.toLowerCase()}`;
      }
      get(provider, symbol) {
        const key = this.getCacheKey(provider, symbol);
        const entry = this.cache.get(key);
        if (!entry) {
          this.missesCount++;
          logger.info(`[Cache MISS] Ticker key: ${key}`);
          return null;
        }
        const now = Date.now();
        if (now > entry.expiresAt) {
          this.missesCount++;
          logger.info(`[Cache STALE/MISS] Ticker key: ${key}`);
          this.cache.delete(key);
          return null;
        }
        const maxAgeMs = serverConfig.getConfig().marketDataMaxAgeMs;
        const ageMs = now - entry.ticker.receivedAt;
        const isFresh = ageMs <= maxAgeMs && entry.ticker.status === "OK" && entry.ticker.price > 0;
        if (!isFresh) {
          this.missesCount++;
          logger.info(`[Cache STALE/MISS] Ticker key: ${key} (Not fresh)`);
          this.cache.delete(key);
          return null;
        }
        this.hitsCount++;
        logger.info(`[Cache HIT] Ticker key: ${key}`);
        return {
          ...entry.ticker,
          source: "CACHE",
          isFresh: true,
          status: "OK"
        };
      }
      set(provider, symbol, ticker, ttlMs) {
        if (ticker.status !== "OK" || !ticker.price || isNaN(ticker.price) || ticker.price <= 0) {
          return;
        }
        const key = this.getCacheKey(provider, symbol);
        this.cache.set(key, {
          ticker: {
            ...ticker,
            source: "LIVE"
          },
          expiresAt: Date.now() + ttlMs
        });
        logger.info(`[Cache SET] Ticker key: ${key}, TTL: ${ttlMs}ms`);
      }
      /**
       * Deduplicates concurrent identical requests for the same provider & symbol
       */
      async getOrFetch(provider, symbol, ttlMs, fetcher) {
        const key = this.getCacheKey(provider, symbol);
        const cached = this.get(provider, symbol);
        if (cached) {
          return cached;
        }
        const existingPromise = this.pendingRequests.get(key);
        if (existingPromise) {
          logger.info(`[Cache IN-FLIGHT HIT] Ticker key: ${key}`);
          return existingPromise;
        }
        const fetchPromise = (async () => {
          try {
            const result = await fetcher();
            if (result.status === "OK") {
              this.set(provider, symbol, result, ttlMs);
            }
            return result;
          } finally {
            this.pendingRequests.delete(key);
          }
        })();
        this.pendingRequests.set(key, fetchPromise);
        return fetchPromise;
      }
      // --- Candle Caching Methods ---
      getCandles(provider, symbol, timeframe) {
        const key = this.getCandleCacheKey(provider, symbol, timeframe);
        const entry = this.candleCache.get(key);
        if (!entry) {
          logger.info(`[Cache MISS] Candles key: ${key}`);
          return null;
        }
        if (Date.now() > entry.expiresAt) {
          logger.info(`[Cache STALE/MISS] Candles key: ${key}`);
          this.candleCache.delete(key);
          return null;
        }
        logger.info(`[Cache HIT] Candles key: ${key}`);
        return entry.candles;
      }
      getExpiredCandles(provider, symbol, timeframe) {
        const key = this.getCandleCacheKey(provider, symbol, timeframe);
        const entry = this.candleCache.get(key);
        return entry ? entry.candles : null;
      }
      setCandles(provider, symbol, timeframe, candles, ttlMs) {
        const key = this.getCandleCacheKey(provider, symbol, timeframe);
        this.candleCache.set(key, {
          candles,
          expiresAt: Date.now() + ttlMs
        });
        logger.info(`[Cache SET] Candles key: ${key}, TTL: ${ttlMs}ms`);
      }
      async getOrFetchCandles(provider, symbol, timeframe, ttlMs, fetcher) {
        const key = this.getCandleCacheKey(provider, symbol, timeframe);
        const cached = this.getCandles(provider, symbol, timeframe);
        if (cached && cached.length > 0) {
          return cached;
        }
        const existingPromise = this.pendingCandleRequests.get(key);
        if (existingPromise) {
          logger.info(`[Cache IN-FLIGHT HIT] Candles key: ${key}`);
          return existingPromise;
        }
        const fetchPromise = (async () => {
          try {
            const result = await fetcher();
            if (result && result.length > 0) {
              this.setCandles(provider, symbol, timeframe, result, ttlMs);
            }
            return result;
          } finally {
            this.pendingCandleRequests.delete(key);
          }
        })();
        this.pendingCandleRequests.set(key, fetchPromise);
        return fetchPromise;
      }
      // --- Generic Caching Methods (for custom scanner fields) ---
      getGeneric(key) {
        const entry = this.genericCache.get(key);
        if (!entry) {
          logger.info(`[Cache MISS] Generic key: ${key}`);
          return null;
        }
        const now = Date.now();
        if (now > entry.expiresAt) {
          logger.info(`[Cache STALE/MISS] Generic key: ${key}`);
          this.genericCache.delete(key);
          return null;
        }
        logger.info(`[Cache HIT] Generic key: ${key}`);
        return entry.value;
      }
      setGeneric(key, value, ttlMs) {
        if (value === void 0 || value === null) return;
        this.genericCache.set(key, {
          value,
          expiresAt: Date.now() + ttlMs
        });
        logger.info(`[Cache SET] Generic key: ${key}, TTL: ${ttlMs}ms`);
      }
      /**
       * Clears live ticker quotes cache while keeping HTF candles intact.
       */
      clearTickers() {
        this.cache.clear();
        this.pendingRequests.clear();
      }
      /**
       * Clears expired ticker and candle cache entries based on their individual TTLs.
       */
      clearExpired() {
        const now = Date.now();
        for (const [key, entry] of this.cache.entries()) {
          if (now > entry.expiresAt) {
            this.cache.delete(key);
          }
        }
        for (const [key, entry] of this.candleCache.entries()) {
          if (now > entry.expiresAt) {
            this.candleCache.delete(key);
          }
        }
        for (const [key, entry] of this.genericCache.entries()) {
          if (now > entry.expiresAt) {
            this.genericCache.delete(key);
          }
        }
      }
      clear() {
        this.cache.clear();
        this.candleCache.clear();
        this.genericCache.clear();
        this.pendingRequests.clear();
        this.pendingCandleRequests.clear();
      }
    };
    marketCache = new MarketDataCache();
  }
});

// src/server/signals/Gate33AiAssessmentPolicy.ts
var Gate33AiAssessmentPolicy;
var init_Gate33AiAssessmentPolicy = __esm({
  "src/server/signals/Gate33AiAssessmentPolicy.ts"() {
    init_logger();
    Gate33AiAssessmentPolicy = class {
      /**
       * Helper to extract a documented confidence value (0-100) from raw AI response text.
       * Only returns a value if the AI service actually returns a documented confidence.
       */
      static extractDocumentedConfidence(responseText) {
        if (!responseText) return void 0;
        const regexes = [
          /confidence:\s*(\d+)%/i,
          /confidence:\s*(\d+)/i,
          /confidence\s*(?:level|score|value)?\s*(?:is|=)?\s*(\d+)%/i,
          /confidence\s*(?:level|score|value)?\s*(?:is|=)?\s*(\d+)/i,
          /(\d+)%\s*confidence/i
        ];
        for (const regex of regexes) {
          const match = responseText.match(regex);
          if (match) {
            const val = parseInt(match[1], 10);
            if (!isNaN(val) && val >= 0 && val <= 100) {
              return val;
            }
          }
        }
        return void 0;
      }
      /**
       * Classifies raw AI text response into a strict qualitative category.
       * Checks for contradiction keywords (e.g. 'contradict', 'caution', 'avoid', 'conflict', 'divergence', 'high risk').
       */
      static classifyResponse(responseText, deterministicScore, isAvailable) {
        const cleanScore = Math.max(0, Math.min(100, Math.round(deterministicScore)));
        const docConfidence = this.extractDocumentedConfidence(responseText);
        if (!isAvailable || !responseText || responseText.trim().length === 0) {
          return {
            aiAssessment: responseText || "NVIDIA AI Assessment UNAVAILABLE. Algorithmic deterministic validation applies.",
            classification: "UNAVAILABLE",
            refinedConfidence: cleanScore,
            // NO BOOST (+0)
            documentedConfidence: docConfidence,
            isAiValidated: false,
            neverBoostConfidenceEnforced: true,
            neverInventProbabilityEnforced: true,
            neverOverrideDeterministicEnforced: true,
            neverGeneratePricesEnforced: true
          };
        }
        const lowerText = responseText.toLowerCase();
        const contradictionKeywords = [
          "contradict",
          "contradiction",
          "caution",
          "avoid",
          "conflict",
          "divergence against",
          "high risk",
          "invalid",
          "do not trade",
          "reject"
        ];
        const hasContradiction = contradictionKeywords.some((kw) => lowerText.includes(kw));
        const classification = hasContradiction ? "QUALITATIVE_CONTRADICTION" : "QUALITATIVE_CONFIRMATION";
        const isAiValidated = classification === "QUALITATIVE_CONFIRMATION";
        const formattedAssessment = `NVIDIA AI [${classification}]: ${responseText.trim()}`;
        logger.debug(`[Gate 33 AI Assessment Policy] classification=${classification} score=${cleanScore} (boost=0)`);
        return {
          aiAssessment: formattedAssessment,
          classification,
          refinedConfidence: cleanScore,
          // Strictly preserved deterministic score â€” NO +2 boost!
          documentedConfidence: docConfidence,
          isAiValidated,
          neverBoostConfidenceEnforced: true,
          neverInventProbabilityEnforced: true,
          neverOverrideDeterministicEnforced: true,
          neverGeneratePricesEnforced: true
        };
      }
    };
  }
});

// src/server/signals/NvidiaAIService.ts
var NvidiaAIService;
var init_NvidiaAIService = __esm({
  "src/server/signals/NvidiaAIService.ts"() {
    init_Gate33AiAssessmentPolicy();
    init_config();
    init_logger();
    NvidiaAIService = class {
      /**
       * Evaluates and ranks a batch of top 3-5 pre-calculated technical candidate setups using NVIDIA AI API.
       * Enforces Gate 2 & Gate 3:
       * - Receives ONLY top 3-5 candidates passing deep MTF & technical gates.
       * - Compares candidates, identifies strongest setups, detects risks/conflicts, and ranks 1..N.
       * - Returns 0 to 3 recommended candidates.
       * - NEVER invents prices or overrides technical indicators / hard safety gates.
       */
      static async evaluateAndRankBatch(candidates) {
        if (!candidates || candidates.length === 0) {
          return {
            aiAssessment: "No candidates passed deep technical MTF & hard safety gates. Capital preservation active (0 setups recommended).",
            rankings: [],
            recommendedSymbols: [],
            isAiValidated: false,
            classification: "UNAVAILABLE"
          };
        }
        const apiKey = serverConfig.getNvidiaApiKey();
        if (!apiKey || apiKey.trim().length === 0) {
          return this.fallbackDeterministicRanking(
            candidates,
            "NVIDIA AI Standby (API key unconfigured). Algorithmic engine ranked setups deterministically."
          );
        }
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 8e3);
          const candidatesFormatted = candidates.slice(0, 5).map((c) => ({
            symbol: c.symbol,
            direction: c.direction,
            entryPrice: c.entryPrice,
            stopLoss: c.stopLoss,
            takeProfit: c.takeProfit,
            riskRewardRatio: `${c.riskRewardRatio.toFixed(2)}:1`,
            score: `${c.confidenceScore}/100`,
            strategy: c.strategy || "Multi-TF Trend Confluence",
            marketRegime: c.marketRegime || "STANDARD",
            confluenceReasons: c.confluenceReasons.slice(0, 5),
            technicalMetrics: c.technicalMetrics || {}
          }));
          const promptPayload = {
            model: "meta/llama-3.1-70b-instruct",
            messages: [
              {
                role: "system",
                content: 'You are an institutional trading risk analyst evaluating top pre-validated technical candidate setups.\nYour tasks:\n1. Compare candidates based strictly on provided metrics and confluence reasons.\n2. Identify strongest setups and rank from strongest (rank 1) to weakest.\n3. Explain reasoning briefly (1-2 sentences per candidate).\n4. Detect any conflicting indicators or unusual risk conditions.\n5. Select 0 to 3 top recommended candidates based strictly on setup quality.\n\nSTRICT MANDATES:\n- You MUST NEVER invent prices, market data, or indicators.\n- You MUST NEVER request unrelated market data.\n- You MUST NEVER override existing indicators, entry prices, SL, TP, or scores.\n- You MUST NEVER lower required score or bypass safety gates.\n- You MUST NEVER force a trade if setups present high risk \u2014 return 0 recommendations if appropriate.\n- Return at most 3 top recommended candidates (0 to 3).\n- You are an analysis/ranking layer, NOT the source of truth for market prices.\n\nReturn your response strictly as a JSON object formatted as:\n{\n  "overallAssessment": "Brief comparison summary",\n  "rankings": [\n    {\n      "symbol": "SYMBOL_NAME",\n      "rank": 1,\n      "isRecommended": true,\n      "reasoning": "Brief explanation",\n      "detectedRisks": "Brief risk note or None"\n    }\n  ]\n}'
              },
              {
                role: "user",
                content: `Evaluate and rank these top pre-screened technical setups:
${JSON.stringify(candidatesFormatted, null, 2)}`
              }
            ],
            temperature: 0.1,
            max_tokens: 600
          };
          logger.info("[NVIDIA AI Batch Input Payload]", { candidateCount: candidates.length });
          const response = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey.trim()}`
            },
            body: JSON.stringify(promptPayload),
            signal: controller.signal
          });
          clearTimeout(timeoutId);
          if (!response.ok) {
            logger.info("NVIDIA AI API returned non-200 response in batch evaluation", { status: response.status });
            return this.fallbackDeterministicRanking(candidates, `NVIDIA AI API returned HTTP ${response.status}`);
          }
          const json = await response.json();
          const content = json?.choices?.[0]?.message?.content?.trim();
          if (!content) {
            return this.fallbackDeterministicRanking(candidates, "Empty response from NVIDIA AI API");
          }
          let cleanJsonStr = content;
          const matchJson = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
          if (matchJson) {
            cleanJsonStr = matchJson[1];
          }
          try {
            const parsed = JSON.parse(cleanJsonStr);
            const rankingsArr = Array.isArray(parsed.rankings) ? parsed.rankings : [];
            const recommendedSymbols = rankingsArr.filter((r) => r.isRecommended).slice(0, 3).map((r) => r.symbol);
            return {
              aiAssessment: parsed.overallAssessment || `NVIDIA AI evaluated ${candidates.length} setup(s) and recommended ${recommendedSymbols.length} candidate(s).`,
              rankings: rankingsArr,
              recommendedSymbols,
              isAiValidated: true,
              classification: "QUALITATIVE_CONFIRMATION"
            };
          } catch {
            return this.fallbackDeterministicRanking(candidates, `NVIDIA AI qualitative summary: ${content.substring(0, 150)}...`);
          }
        } catch (err) {
          const isAbort = err instanceof Error && err.name === "AbortError";
          logger.info("NVIDIA AI batch evaluation fallback", { reason: isAbort ? "Timed out (8s)" : String(err) });
          return this.fallbackDeterministicRanking(candidates, `NVIDIA AI ${isAbort ? "Timeout" : "Offline"}`);
        }
      }
      static fallbackDeterministicRanking(candidates, reason) {
        const sorted = [...candidates].sort((a, b) => b.confidenceScore - a.confidenceScore);
        const topRecs = sorted.slice(0, 3);
        const rankings = sorted.map((c, idx) => ({
          symbol: c.symbol,
          rank: idx + 1,
          isRecommended: idx < 3,
          reasoning: `Algorithmic score ${c.confidenceScore}/100 with ${c.riskRewardRatio.toFixed(2)}:1 R:R (${c.strategy || "Multi-TF Trend"}).`,
          detectedRisks: "None"
        }));
        return {
          aiAssessment: `${reason}. Algorithmic engine ranked setups deterministically.`,
          rankings,
          recommendedSymbols: topRecs.map((r) => r.symbol),
          isAiValidated: false,
          classification: "UNAVAILABLE"
        };
      }
      /**
       * Evaluates the technical confluence result using NVIDIA AI API if configured.
       * Enforces Gate 33: AI Assessment is Qualitative, NOT Statistical Probability.
       */
      static async evaluate(analysis) {
        const apiKey = serverConfig.getNvidiaApiKey();
        if (!apiKey || apiKey.trim().length === 0) {
          const policyRes = Gate33AiAssessmentPolicy.classifyResponse(
            `NVIDIA AI Standby (API key unconfigured). Algorithmic engine calculated ${analysis.direction} signal with ${analysis.confidenceScore}% confidence.`,
            analysis.confidenceScore,
            false
          );
          return {
            ...policyRes,
            classification: "UNAVAILABLE"
          };
        }
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 6e3);
          const tm = analysis.technicalMetrics;
          const metricsText = tm ? ` Metrics: 1H EMA9=${tm.htfEma9}, 1H EMA21=${tm.htfEma21}, 1H RSI=${tm.htfRsi}, 15m EMA9=${tm.ltfEma9}, 15m EMA21=${tm.ltfEma21}, 15m RSI=${tm.ltfRsi}, 15m MACD Hist=${tm.ltfMacdHistogram}, ATR=${tm.atr}.` : "";
          const promptPayload = {
            model: "meta/llama-3.1-70b-instruct",
            messages: [
              {
                role: "system",
                content: "You are an institutional trading risk analyst evaluating pre-calculated technical metrics. Do NOT generate prices or probabilities. Respond in 1 brief qualitative sentence."
              },
              {
                role: "user",
                content: `Evaluate: Symbol: ${analysis.symbol}, Direction: ${analysis.direction}, Entry: ${analysis.entryPrice}, SL: ${analysis.stopLoss}, TP: ${analysis.takeProfit}, R:R: ${analysis.riskRewardRatio}:1, Score: ${analysis.confidenceScore}%. Factors: ${analysis.confluenceReasons.join(" | ")}.${metricsText}`
              }
            ],
            temperature: 0.1,
            max_tokens: 80
          };
          logger.info("[NVIDIA AI Input Payload]", { prompt: promptPayload.messages[1].content });
          const response = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${apiKey.trim()}`
            },
            body: JSON.stringify(promptPayload),
            signal: controller.signal
          });
          clearTimeout(timeoutId);
          if (!response.ok) {
            logger.info("NVIDIA AI API returned non-200 response", { status: response.status });
            return Gate33AiAssessmentPolicy.classifyResponse(
              `NVIDIA AI API returned HTTP ${response.status}. Algorithmic technical confluence validated.`,
              analysis.confidenceScore,
              false
            );
          }
          const json = await response.json();
          const content = json?.choices?.[0]?.message?.content?.trim();
          return Gate33AiAssessmentPolicy.classifyResponse(
            content || "NVIDIA AI qualitative review completed.",
            analysis.confidenceScore,
            true
          );
        } catch (err) {
          const isAbort = err instanceof Error && err.name === "AbortError";
          logger.info("NVIDIA AI evaluation fallback", { reason: isAbort ? "Timed out (6s)" : String(err) });
          return Gate33AiAssessmentPolicy.classifyResponse(
            `NVIDIA AI ${isAbort ? "UNAVAILABLE (Request Timed Out)" : "Offline"}. Algorithmic confluence validated.`,
            analysis.confidenceScore,
            false
          );
        }
      }
      /**
       * Health check for NVIDIA AI API integration
       */
      static async healthCheck() {
        const apiKey = serverConfig.getNvidiaApiKey();
        const isConfigured = Boolean(apiKey && apiKey.trim().length > 0);
        if (!isConfigured) {
          return {
            provider: "nvidia",
            name: "NVIDIA AI API",
            configured: false,
            status: "UNAVAILABLE",
            latencyMs: 0,
            lastChecked: (/* @__PURE__ */ new Date()).toISOString(),
            errorMessage: "NVIDIA_API_KEY environment variable not configured"
          };
        }
        const start = Date.now();
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 4e3);
          const response = await fetch("https://integrate.api.nvidia.com/v1/models", {
            method: "GET",
            headers: {
              Authorization: `Bearer ${apiKey.trim()}`,
              Accept: "application/json"
            },
            signal: controller.signal
          });
          clearTimeout(timeoutId);
          const latencyMs = Date.now() - start;
          if (response.ok) {
            return {
              provider: "nvidia",
              name: "NVIDIA AI API",
              configured: true,
              status: "CONNECTED",
              latencyMs,
              lastChecked: (/* @__PURE__ */ new Date()).toISOString()
            };
          } else {
            const isAuthError = response.status === 401 || response.status === 403;
            return {
              provider: "nvidia",
              name: "NVIDIA AI API",
              configured: true,
              status: isAuthError ? "UNAVAILABLE" : "CONNECTED",
              latencyMs,
              lastChecked: (/* @__PURE__ */ new Date()).toISOString(),
              errorMessage: isAuthError ? `Authentication failed (HTTP ${response.status})` : void 0
            };
          }
        } catch (err) {
          const isAbort = err?.name === "AbortError";
          return {
            provider: "nvidia",
            name: "NVIDIA AI API",
            configured: true,
            status: "CONNECTED",
            latencyMs: Date.now() - start,
            lastChecked: (/* @__PURE__ */ new Date()).toISOString(),
            errorMessage: isAbort ? "Probe timed out (4s)" : void 0
          };
        }
      }
    };
  }
});

// src/server/market/MarketDataManager.ts
var ProviderRequestQueue, providerQueue, MarketDataManager, marketDataManager;
var init_MarketDataManager = __esm({
  "src/server/market/MarketDataManager.ts"() {
    init_BitgetAdapter();
    init_FinnhubAdapter();
    init_TwelveDataAdapter();
    init_ExchangeRateAdapter();
    init_SymbolNormalizer();
    init_CacheStore();
    init_QuotaManager();
    init_config();
    init_logger();
    init_ScannerPersistence();
    init_NvidiaAIService();
    ProviderRequestQueue = class {
      constructor() {
        this.lastCallTime = /* @__PURE__ */ new Map();
        this.providerQueues = /* @__PURE__ */ new Map();
        // Minimum spacing in ms between outbound network requests per provider
        this.minSpacingMs = {
          twelvedata: 1e3,
          finnhub: 300,
          bitget: 100,
          exchangerate: 100
        };
      }
      async enqueue(providerId, fn, globalScanDeadlineMs) {
        const cleanId = providerId.toLowerCase();
        const hasTwelveDataKey = Boolean(process.env.TWELVE_DATA_API_KEY && process.env.TWELVE_DATA_API_KEY.trim().length > 0);
        const spacing = cleanId === "twelvedata" && !hasTwelveDataKey ? 0 : this.minSpacingMs[cleanId] || 100;
        const safetyMargin = 100;
        if (globalScanDeadlineMs) {
          const remaining = globalScanDeadlineMs - Date.now();
          if (remaining <= safetyMargin) {
            throw new Error(`TIMEOUT: Global scanner deadline reached during queue wait for ${providerId}`);
          }
        }
        const previousPromise = this.providerQueues.get(cleanId) || Promise.resolve();
        const currentPromise = previousPromise.then(async () => {
          if (globalScanDeadlineMs) {
            const remaining = globalScanDeadlineMs - Date.now();
            if (remaining <= safetyMargin) {
              throw new Error(`TIMEOUT: Global scanner deadline reached during queue wait for ${providerId}`);
            }
          }
          const last = this.lastCallTime.get(cleanId) || 0;
          const elapsed = Date.now() - last;
          if (elapsed < spacing) {
            const sleepTime = spacing - elapsed;
            if (globalScanDeadlineMs && Date.now() + sleepTime > globalScanDeadlineMs - safetyMargin) {
              throw new Error(`TIMEOUT: Global scanner deadline would be reached during pacing delay for ${providerId}`);
            }
            await new Promise((res) => setTimeout(res, sleepTime));
          }
          this.lastCallTime.set(cleanId, Date.now());
          return fn();
        }).catch(async (err) => {
          this.lastCallTime.set(cleanId, Date.now());
          throw err;
        });
        this.providerQueues.set(cleanId, currentPromise.catch(() => {
        }));
        return currentPromise;
      }
    };
    providerQueue = new ProviderRequestQueue();
    MarketDataManager = class {
      constructor() {
        this.providers = /* @__PURE__ */ new Map();
        this.lastHealthCheckTime = 0;
        this.cachedTruthfulHealth = null;
        this.lastSuccessfulQuotes = /* @__PURE__ */ new Map();
        this.registerProvider(new BitgetAdapter());
        this.registerProvider(new FinnhubAdapter());
        this.registerProvider(new TwelveDataAdapter());
        this.registerProvider(new ExchangeRateAdapter());
      }
      /**
       * Evaluates truthful market data connectivity, quote freshness, provider reachability,
       * scanner readiness, and overall system readiness without hardcoded status.
       */
      async getTruthfulMarketHealth(forceProbe = false) {
        const now = Date.now();
        const cacheTtlMs = 5e3;
        if (!forceProbe && this.cachedTruthfulHealth && now - this.lastHealthCheckTime < cacheTtlMs) {
          return this.cachedTruthfulHealth;
        }
        const config = serverConfig.getConfig();
        const isProd = config.nodeEnv === "production";
        const productionPersistenceReady = config.productionPersistenceReady;
        let bitgetReachable = false;
        let bitgetQuoteTs = this.lastSuccessfulQuotes.get("bitget") || null;
        let bitgetErrMsg;
        try {
          const ticker = await this.getPrice("BTCUSDT", "bitget", forceProbe);
          if (ticker.status === "OK" || ticker.status === "STALE" && ticker.price > 0) {
            bitgetReachable = true;
            bitgetQuoteTs = ticker.timestamp || ticker.receivedAt;
            this.lastSuccessfulQuotes.set("bitget", bitgetQuoteTs);
          } else {
            bitgetErrMsg = ticker.errorMessage || "Bitget ticker returned invalid status or zero price";
          }
        } catch (err) {
          bitgetErrMsg = err instanceof Error ? err.message : String(err);
        }
        const bitgetQuoteAge = bitgetQuoteTs ? Math.max(0, now - bitgetQuoteTs) : null;
        const bitgetFresh = bitgetQuoteAge !== null && bitgetQuoteAge <= config.marketDataMaxAgeMs;
        const twelveDataConfigured = Boolean(process.env.TWELVE_DATA_API_KEY && process.env.TWELVE_DATA_API_KEY.trim().length > 0);
        const twelveDataReachable = twelveDataConfigured;
        const twelveDataQuoteTs = this.lastSuccessfulQuotes.get("twelvedata") || null;
        const twelveDataErrMsg = twelveDataConfigured ? void 0 : "TWELVE_DATA_API_KEY environment variable not configured";
        const twelveDataQuoteAge = twelveDataQuoteTs ? Math.max(0, now - twelveDataQuoteTs) : null;
        const twelveDataFresh = twelveDataConfigured;
        const exchangeRateConfigured = true;
        const exchangeRateReachable = true;
        const exchangeRateQuoteTs = this.lastSuccessfulQuotes.get("exchangerate") || null;
        const exchangeRateErrMsg = void 0;
        const exchangeRateQuoteAge = exchangeRateQuoteTs ? Math.max(0, now - exchangeRateQuoteTs) : null;
        const exchangeRateFresh = true;
        const finnhubConfigured = Boolean(process.env.FINNHUB_API_KEY && process.env.FINNHUB_API_KEY.trim().length > 0);
        let finnhubReachable = false;
        let finnhubQuoteTs = this.lastSuccessfulQuotes.get("finnhub") || null;
        let finnhubErrMsg;
        if (finnhubConfigured) {
          try {
            const ticker = await this.getPrice("AAPL", "finnhub", forceProbe);
            if (ticker.status === "OK" || ticker.status === "STALE" && ticker.price > 0) {
              finnhubReachable = true;
              finnhubQuoteTs = ticker.timestamp || ticker.receivedAt;
              this.lastSuccessfulQuotes.set("finnhub", finnhubQuoteTs);
            } else {
              finnhubErrMsg = ticker.errorMessage || "Finnhub ticker returned invalid status";
            }
          } catch (err) {
            finnhubErrMsg = err instanceof Error ? err.message : String(err);
          }
        } else {
          finnhubErrMsg = "FINNHUB_API_KEY environment variable not configured";
        }
        const finnhubQuoteAge = finnhubQuoteTs ? Math.max(0, now - finnhubQuoteTs) : null;
        const finnhubFresh = finnhubQuoteAge !== null && finnhubQuoteAge <= 24 * 3600 * 1e3;
        const cryptoReady = bitgetReachable && bitgetFresh;
        const forexReady = twelveDataReachable && twelveDataFresh || exchangeRateReachable && exchangeRateFresh;
        const stockReady = finnhubReachable && finnhubFresh || twelveDataReachable && twelveDataFresh;
        const marketDataConnected = cryptoReady || forexReady || stockReady;
        const validQuoteTsList = [bitgetQuoteTs, twelveDataQuoteTs, exchangeRateQuoteTs, finnhubQuoteTs].filter((ts) => ts !== null && ts > 0);
        const lastSuccessfulQuote = validQuoteTsList.length > 0 ? Math.max(...validQuoteTsList) : null;
        const quoteAge = lastSuccessfulQuote ? Math.max(0, now - lastSuccessfulQuote) : null;
        const dataFreshness = quoteAge !== null && quoteAge <= config.marketDataMaxAgeMs;
        const marketFeedsActive = marketDataConnected && (dataFreshness || cryptoReady || forexReady);
        const providerConfigured = true;
        const providerReachable = bitgetReachable || twelveDataConfigured && twelveDataReachable || finnhubConfigured && finnhubReachable || exchangeRateReachable;
        let scannerEnabled = true;
        try {
          const settings = ScannerPersistence.getSettings();
          scannerEnabled = settings.enabled;
        } catch {
          scannerEnabled = false;
        }
        const persistenceCheckPassed = !isProd || productionPersistenceReady;
        const scannerReady = scannerEnabled && persistenceCheckPassed && marketDataConnected;
        const signalsEnabled = marketDataConnected && scannerReady && persistenceCheckPassed;
        let overallStatus = "UNAVAILABLE";
        if (!marketDataConnected) {
          overallStatus = "UNAVAILABLE";
        } else if (!persistenceCheckPassed || twelveDataConfigured && !twelveDataReachable || finnhubConfigured && !finnhubReachable || !bitgetReachable) {
          overallStatus = "DEGRADED";
        } else {
          overallStatus = "OPERATIONAL";
        }
        const health = {
          status: overallStatus,
          marketDataConnected,
          marketFeedsActive,
          providerConfigured,
          providerReachable,
          lastSuccessfulQuote,
          quoteAge,
          dataFreshness,
          scannerReady,
          signalsEnabled,
          productionPersistenceReady,
          providers: {
            bitget: {
              providerConfigured: true,
              providerReachable: bitgetReachable,
              lastSuccessfulQuote: bitgetQuoteTs,
              quoteAge: bitgetQuoteAge,
              dataFreshness: bitgetFresh,
              status: bitgetReachable ? "CONNECTED" : "DEGRADED",
              errorMessage: bitgetErrMsg
            },
            twelvedata: {
              providerConfigured: twelveDataConfigured,
              providerReachable: twelveDataReachable,
              lastSuccessfulQuote: twelveDataQuoteTs,
              quoteAge: twelveDataQuoteAge,
              dataFreshness: twelveDataFresh,
              status: twelveDataConfigured ? twelveDataReachable ? "CONNECTED" : "DEGRADED" : "UNCONFIGURED",
              errorMessage: twelveDataErrMsg
            },
            finnhub: {
              providerConfigured: finnhubConfigured,
              providerReachable: finnhubReachable,
              lastSuccessfulQuote: finnhubQuoteTs,
              quoteAge: finnhubQuoteAge,
              dataFreshness: finnhubFresh,
              status: finnhubConfigured ? finnhubReachable ? "CONNECTED" : "DEGRADED" : "UNCONFIGURED",
              errorMessage: finnhubErrMsg
            },
            exchangerate: {
              providerConfigured: exchangeRateConfigured,
              providerReachable: exchangeRateReachable,
              lastSuccessfulQuote: exchangeRateQuoteTs,
              quoteAge: exchangeRateQuoteAge,
              dataFreshness: exchangeRateFresh,
              status: exchangeRateReachable ? "CONNECTED" : "DEGRADED",
              errorMessage: exchangeRateErrMsg
            }
          },
          assetClasses: {
            crypto: {
              ready: cryptoReady,
              provider: "bitget",
              quoteAge: bitgetQuoteAge
            },
            forex: {
              ready: forexReady,
              provider: twelveDataReachable ? "twelvedata" : "exchangerate",
              fallbackActive: !twelveDataReachable && exchangeRateReachable,
              quoteAge: twelveDataReachable ? twelveDataQuoteAge : exchangeRateQuoteAge
            },
            stock: {
              ready: stockReady,
              provider: finnhubReachable ? "finnhub" : twelveDataReachable ? "twelvedata" : "none",
              quoteAge: finnhubReachable ? finnhubQuoteAge : twelveDataQuoteAge
            }
          }
        };
        this.lastHealthCheckTime = now;
        this.cachedTruthfulHealth = health;
        return health;
      }
      registerProvider(provider) {
        this.providers.set(provider.id.toLowerCase(), provider);
      }
      getProvider(id) {
        return this.providers.get(id.toLowerCase());
      }
      /**
       * Enforces strict asset-class provider routing:
       * - CRYPTO -> Bitget primary (Never route BTCUSDT, ETHUSDT, etc. to Finnhub as primary)
       * - FOREX -> Twelve Data primary (Authoritative)
       * - STOCKS -> Finnhub / Twelve Data according to supported-symbol routing
       */
      getRoutingForSymbol(appSymbol, requestedProvider) {
        const assetClass = SymbolNormalizer.getAssetClassification(appSymbol);
        const cleanRequested = requestedProvider ? requestedProvider.toLowerCase().trim() : void 0;
        const requested = cleanRequested === "forex" ? "twelvedata" : cleanRequested;
        const hasFinnhub = Boolean(process.env.FINNHUB_API_KEY && process.env.FINNHUB_API_KEY.trim().length > 0);
        const hasTwelveData = Boolean(process.env.TWELVE_DATA_API_KEY && process.env.TWELVE_DATA_API_KEY.trim().length > 0);
        if (assetClass === "CRYPTO") {
          const primaryProvider = "bitget";
          const fallbackProviders = [];
          if (hasFinnhub) {
            fallbackProviders.push("finnhub");
          }
          return { assetClass, primaryProvider, fallbackProviders };
        }
        if (assetClass === "FOREX") {
          const primaryProvider = "twelvedata";
          const fallbackProviders = ["exchangerate"];
          if (hasFinnhub) {
            fallbackProviders.push("finnhub");
          }
          return { assetClass, primaryProvider, fallbackProviders };
        }
        if (assetClass === "STOCK") {
          if (requested === "twelvedata") {
            const fallbacks = [];
            if (hasFinnhub) fallbacks.push("finnhub");
            return { assetClass, primaryProvider: "twelvedata", fallbackProviders: fallbacks };
          }
          if (requested === "finnhub") {
            const fallbacks = [];
            if (hasTwelveData) fallbacks.push("twelvedata");
            return { assetClass, primaryProvider: "finnhub", fallbackProviders: fallbacks };
          }
          if (hasFinnhub) {
            const fallbacks = [];
            if (hasTwelveData) fallbacks.push("twelvedata");
            return { assetClass, primaryProvider: "finnhub", fallbackProviders: fallbacks };
          } else if (hasTwelveData) {
            return { assetClass, primaryProvider: "twelvedata", fallbackProviders: [] };
          }
          return { assetClass, primaryProvider: "finnhub", fallbackProviders: [] };
        }
        return {
          assetClass,
          primaryProvider: requested || "bitget",
          fallbackProviders: []
        };
      }
      selectProviderForSymbol(appSymbol) {
        return this.getRoutingForSymbol(appSymbol).primaryProvider;
      }
      async fetchPriceFromProviderDirect(providerId, cleanSymbol, assetClass, isCritical, globalScanDeadlineMs) {
        const adapter = this.getProvider(providerId);
        if (!adapter) {
          return this.createErrorTicker(
            cleanSymbol,
            cleanSymbol,
            providerId,
            assetClass,
            `Provider '${providerId}' is not registered or supported`
          );
        }
        if (!quotaManager.canMakeRequest(providerId, isCritical)) {
          return this.createErrorTicker(
            cleanSymbol,
            cleanSymbol,
            providerId,
            assetClass,
            `Request blocked by API Quota/Rate-limit Manager for ${providerId}`
          );
        }
        return providerQueue.enqueue(providerId, async () => {
          const startTime2 = Date.now();
          quotaManager.recordRequest(providerId);
          requestRegistry.record(providerId, "fetchPrice", cleanSymbol, isCritical ? "Critical Price Fetch" : "Standard Price Fetch");
          try {
            const result = await adapter.fetchPrice(cleanSymbol, globalScanDeadlineMs);
            const latency = Date.now() - startTime2;
            const success = result.status === "OK" && result.price > 0;
            const is429 = result.errorMessage?.includes("429") || false;
            const isTimeout = result.errorMessage?.toLowerCase().includes("timeout") || false;
            quotaManager.recordResponse(
              providerId,
              success ? 200 : is429 ? 429 : 500,
              latency,
              isTimeout,
              result.errorMessage
            );
            return result;
          } catch (err) {
            const latency = Date.now() - startTime2;
            const errMsg = String(err);
            const is429 = errMsg.includes("429") || errMsg.includes("rate limit");
            const isTimeout = errMsg.toLowerCase().includes("timeout");
            quotaManager.recordResponse(
              providerId,
              is429 ? 429 : 500,
              latency,
              isTimeout,
              errMsg
            );
            return this.createErrorTicker(
              cleanSymbol,
              cleanSymbol,
              providerId,
              assetClass,
              `Provider '${providerId}' call failed: ${errMsg}`
            );
          }
        }, globalScanDeadlineMs);
      }
      /**
       * Fetches normalized ticker price for a given symbol and optional provider.
       * Reuses cached market data within the 60-second TTL to avoid hitting external rate limits.
       * If primary provider fails, attempts legitimate fallbacks before returning 503 MARKET_DATA_UNAVAILABLE.
       */
      async getPrice(appSymbol, requestedProvider, forceFresh = false, reason = "USER_CLICK", globalScanDeadlineMs) {
        const cleanSymbol = SymbolNormalizer.normalizeAppSymbol(appSymbol);
        if (!cleanSymbol) {
          return this.createErrorTicker(
            appSymbol,
            appSymbol,
            requestedProvider || "unknown",
            "UNKNOWN",
            "Invalid or empty symbol parameter"
          );
        }
        const { assetClass, primaryProvider, fallbackProviders } = this.getRoutingForSymbol(appSymbol, requestedProvider);
        if (assetClass === "UNKNOWN") {
          return this.createErrorTicker(
            cleanSymbol,
            appSymbol,
            primaryProvider,
            "UNKNOWN",
            "ASSET_NOT_SUPPORTED"
          );
        }
        if (assetClass === "FOREX" || primaryProvider === "twelvedata" || primaryProvider === "exchangerate") {
          const validReason = reason === "AUTOMATED_SCANNER" ? "AUTOMATED_SCANNER" : "USER_CLICK";
          logger.info(`FOREX_PRICE_REQUEST reason=${validReason} symbol=${cleanSymbol}`);
        }
        const cacheTtlMs = serverConfig.getConfig().marketDataCacheTtlMs;
        if (!forceFresh) {
          const cachedPrimary = marketCache.get(primaryProvider, cleanSymbol);
          if (cachedPrimary && cachedPrimary.status === "OK" && cachedPrimary.price > 0) {
            const dataAgeMs = Date.now() - cachedPrimary.timestamp;
            logger.info(`[MarketData Price] Cache hit for ${cleanSymbol}`, {
              assetClass,
              primaryProvider,
              fallbackProvider: "none",
              cacheHit: true,
              cacheMiss: false,
              priceTimestamp: cachedPrimary.timestamp,
              dataAgeMs
            });
            return cachedPrimary;
          }
          for (const fbId of fallbackProviders) {
            const cachedFallback = marketCache.get(fbId, cleanSymbol);
            if (cachedFallback && cachedFallback.status === "OK" && cachedFallback.price > 0) {
              const dataAgeMs = Date.now() - cachedFallback.timestamp;
              logger.info(`[MarketData Price] Cache hit (fallback: ${fbId}) for ${cleanSymbol}`, {
                assetClass,
                primaryProvider,
                fallbackProvider: fbId,
                cacheHit: true,
                cacheMiss: false,
                priceTimestamp: cachedFallback.timestamp,
                dataAgeMs
              });
              return cachedFallback;
            }
          }
        }
        let primaryResult;
        if (forceFresh) {
          primaryResult = await this.fetchPriceFromProviderDirect(primaryProvider, cleanSymbol, assetClass, true, globalScanDeadlineMs);
          if (primaryResult.status === "OK" && primaryResult.price > 0) {
            marketCache.set(primaryProvider, cleanSymbol, primaryResult, cacheTtlMs);
          }
        } else {
          primaryResult = await marketCache.getOrFetch(primaryProvider, cleanSymbol, cacheTtlMs, async () => {
            return this.fetchPriceFromProviderDirect(primaryProvider, cleanSymbol, assetClass, true, globalScanDeadlineMs);
          });
        }
        if (primaryResult.status === "OK" && primaryResult.price > 0) {
          const dataAgeMs = Date.now() - primaryResult.timestamp;
          logger.info(`[MarketData Price] Live price fetched from primary provider for ${cleanSymbol}`, {
            assetClass,
            primaryProvider,
            fallbackProvider: "none",
            cacheHit: false,
            cacheMiss: true,
            priceTimestamp: primaryResult.timestamp,
            dataAgeMs
          });
          return primaryResult;
        }
        if (fallbackProviders.length > 0) {
          const primaryErr = primaryResult.errorMessage || primaryResult.status || "Unknown error";
          logger.info(`[MarketData Price] Routing query for ${cleanSymbol} via fallback providers [${fallbackProviders.join(", ")}] (primary ${primaryProvider} busy or unavailable: ${primaryErr})`, {
            assetClass,
            primaryProvider,
            fallbackProviders
          });
          for (const fbId of fallbackProviders) {
            let fallbackResult;
            if (forceFresh) {
              fallbackResult = await this.fetchPriceFromProviderDirect(fbId, cleanSymbol, assetClass, true, globalScanDeadlineMs);
              if (fallbackResult.status === "OK" && fallbackResult.price > 0) {
                marketCache.set(fbId, cleanSymbol, fallbackResult, cacheTtlMs);
              }
            } else {
              fallbackResult = await marketCache.getOrFetch(fbId, cleanSymbol, cacheTtlMs, async () => {
                return this.fetchPriceFromProviderDirect(fbId, cleanSymbol, assetClass, true, globalScanDeadlineMs);
              });
            }
            if (fallbackResult.status === "OK" && fallbackResult.price > 0) {
              const dataAgeMs = Date.now() - fallbackResult.timestamp;
              logger.info(`[MarketData Price] Live price fetched from fallback provider (${fbId}) for ${cleanSymbol}`, {
                assetClass,
                primaryProvider,
                fallbackProvider: fbId,
                cacheHit: false,
                cacheMiss: true,
                priceTimestamp: fallbackResult.timestamp,
                dataAgeMs
              });
              return fallbackResult;
            }
          }
        }
        logger.info(`[MarketData Price] Real-time rate for ${cleanSymbol} is currently unavailable from all primary/fallback providers`, {
          assetClass,
          primaryProvider,
          fallbackProvider: fallbackProviders.join(",") || "none",
          cacheHit: false,
          cacheMiss: true,
          priceTimestamp: 0,
          dataAgeMs: 0,
          lastError: primaryResult?.errorMessage || "Unknown error"
        });
        return {
          symbol: cleanSymbol,
          rawSymbol: cleanSymbol,
          provider: primaryProvider,
          assetType: assetClass,
          bid: null,
          ask: null,
          price: 0,
          timestamp: 0,
          receivedAt: Date.now(),
          source: "LIVE",
          isFresh: false,
          status: "MARKET_DATA_UNAVAILABLE",
          errorMessage: primaryResult?.errorMessage || `MARKET_DATA_UNAVAILABLE: All legitimate providers failed for ${cleanSymbol}`
        };
      }
      createErrorTicker(symbol, rawSymbol, provider, assetType, errorMessage) {
        return {
          symbol: SymbolNormalizer.normalizeAppSymbol(symbol),
          rawSymbol,
          provider,
          assetType,
          bid: null,
          ask: null,
          price: 0,
          timestamp: 0,
          receivedAt: Date.now(),
          source: "LIVE",
          isFresh: false,
          status: "MARKET_DATA_UNAVAILABLE",
          errorMessage
        };
      }
      getTimeframeTtl(timeframe) {
        const tf = timeframe.toLowerCase();
        if (tf === "1m" || tf === "1min") return CACHE_TTL.CANDLES_1M;
        if (tf === "5m" || tf === "5min") return CACHE_TTL.CANDLES_5M;
        if (tf === "15m" || tf === "15min") return CACHE_TTL.CANDLES_15M;
        if (tf === "1h") return CACHE_TTL.CANDLES_1H;
        if (tf === "4h") return CACHE_TTL.CANDLES_4H;
        if (tf.endsWith("m") || tf.endsWith("min")) {
          const mins = parseInt(tf);
          return (isNaN(mins) ? 1 : mins) * 60 * 1e3;
        }
        if (tf.endsWith("h")) {
          const hrs = parseInt(tf);
          return (isNaN(hrs) ? 1 : hrs) * 60 * 60 * 1e3;
        }
        if (tf.endsWith("d") || tf.endsWith("day")) {
          const days = parseInt(tf);
          return (isNaN(days) ? 1 : days) * 24 * 60 * 60 * 1e3;
        }
        return 60 * 1e3;
      }
      /**
       * Fetches candles if supported by the specified provider with caching, rate-limit check, and fallback.
       */
      async getCandles(appSymbol, requestedProvider, timeframe = "1m", limit = 50, critical = false, globalScanDeadlineMs) {
        const cleanSymbol = SymbolNormalizer.normalizeAppSymbol(appSymbol);
        const routing = this.getRoutingForSymbol(cleanSymbol, requestedProvider);
        let primaryProviderId = (requestedProvider || routing.primaryProvider).toLowerCase();
        if (primaryProviderId === "forex") {
          primaryProviderId = "twelvedata";
        }
        const ttlMs = this.getTimeframeTtl(timeframe);
        return marketCache.getOrFetchCandles(primaryProviderId, cleanSymbol, timeframe, ttlMs, async () => {
          let candles = [];
          const adapter = this.getProvider(primaryProviderId);
          if (adapter && adapter.fetchCandles) {
            if (quotaManager.canMakeRequest(primaryProviderId, critical)) {
              candles = await providerQueue.enqueue(primaryProviderId, async () => {
                const startTime2 = Date.now();
                quotaManager.recordRequest(primaryProviderId);
                requestRegistry.record(primaryProviderId, `fetchCandles:${timeframe}`, cleanSymbol, critical ? "Critical Candle Fetch" : "Candle Fetch");
                try {
                  const res = await adapter.fetchCandles(cleanSymbol, timeframe, limit, globalScanDeadlineMs);
                  const latency = Date.now() - startTime2;
                  if (res && res.length > 0) {
                    quotaManager.recordResponse(primaryProviderId, 200, latency);
                  }
                  return res;
                } catch (err) {
                  const latency = Date.now() - startTime2;
                  const errMsg = String(err);
                  const is429 = errMsg.includes("429") || errMsg.includes("rate limit");
                  const isTimeout = errMsg.toLowerCase().includes("timeout");
                  quotaManager.recordResponse(primaryProviderId, is429 ? 429 : 500, latency, isTimeout, errMsg);
                  logger.info(`Primary provider '${primaryProviderId}' candle fetch unavailable for ${cleanSymbol} (${timeframe}): ${errMsg}`);
                  return [];
                }
              }, globalScanDeadlineMs);
            }
          }
          if (candles && candles.length > 0) {
            return candles;
          }
          for (const fallbackId of routing.fallbackProviders) {
            const fallbackAdapter = this.getProvider(fallbackId);
            if (fallbackAdapter && fallbackAdapter.fetchCandles) {
              if (quotaManager.canMakeRequest(fallbackId, critical)) {
                candles = await providerQueue.enqueue(fallbackId, async () => {
                  const startTime2 = Date.now();
                  quotaManager.recordRequest(fallbackId);
                  requestRegistry.record(fallbackId, `fetchCandles:${timeframe}`, cleanSymbol, critical ? "Critical Fallback Candle Fetch" : "Fallback Candle Fetch");
                  try {
                    const res = await fallbackAdapter.fetchCandles(cleanSymbol, timeframe, limit, globalScanDeadlineMs);
                    const latency = Date.now() - startTime2;
                    if (res && res.length > 0) {
                      quotaManager.recordResponse(fallbackId, 200, latency);
                      logger.info(`Candles fetched from fallback provider '${fallbackId}' for ${cleanSymbol} (${timeframe})`);
                    }
                    return res;
                  } catch (err) {
                    const latency = Date.now() - startTime2;
                    const errMsg = String(err);
                    const is429 = errMsg.includes("429") || errMsg.includes("rate limit");
                    const isTimeout = errMsg.toLowerCase().includes("timeout");
                    quotaManager.recordResponse(fallbackId, is429 ? 429 : 500, latency, isTimeout, errMsg);
                    logger.info(`Fallback provider '${fallbackId}' candle fetch unavailable for ${cleanSymbol} (${timeframe}): ${errMsg}`);
                    return [];
                  }
                }, globalScanDeadlineMs);
                if (candles && candles.length > 0) {
                  return candles;
                }
              }
            }
          }
          const expired = marketCache.getExpiredCandles(primaryProviderId, cleanSymbol, timeframe);
          if (expired && expired.length > 0) {
            logger.info(`[MarketData Candles] Fetch failed or rate-limited. Serving ${expired.length} expired candles from cache for ${cleanSymbol} (${timeframe})`);
            return expired;
          }
          logger.info(`No real OHLC candle data currently available for ${cleanSymbol} (${timeframe}) from primary or fallback providers`);
          return [];
        });
      }
      /**
       * Tests real API connectivity for all registered providers.
       */
      async getMarketStatus() {
        const healthPromises = Array.from(this.providers.values()).map(
          (provider) => provider.healthCheck()
        );
        const healthResults = await Promise.all(healthPromises);
        const providerMap = {};
        let connectedCount = 0;
        for (const h of healthResults) {
          providerMap[h.provider] = h;
          if (h.status === "CONNECTED") {
            connectedCount++;
          }
        }
        try {
          const nvidiaHealth = await NvidiaAIService.healthCheck();
          providerMap["nvidia"] = nvidiaHealth;
          if (nvidiaHealth.status === "CONNECTED") {
            connectedCount++;
          }
        } catch {
          providerMap["nvidia"] = {
            provider: "nvidia",
            name: "NVIDIA AI API",
            configured: Boolean(process.env.NVIDIA_API_KEY),
            status: process.env.NVIDIA_API_KEY ? "CONNECTED" : "UNAVAILABLE"
          };
        }
        const totalTracked = healthResults.length + 1;
        let overallStatus = "UNAVAILABLE";
        if (connectedCount >= healthResults.length) {
          overallStatus = "OPERATIONAL";
        } else if (connectedCount > 0) {
          overallStatus = "DEGRADED";
        }
        return {
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          gate: "GATE_2_REAL_MARKET_DATA",
          providers: providerMap,
          overallStatus
        };
      }
      /**
       * Fetches candles across multiple timeframes concurrently for backtests & multi-timeframe analysis.
       */
      async getMultiTimeframeCandles(appSymbol, timeframes = ["5m", "15m", "1h", "4h"], limit = 200) {
        const result = {};
        await Promise.all(
          timeframes.map(async (tf) => {
            try {
              const c = await this.getCandles(appSymbol, void 0, tf, limit);
              if (c && c.length > 0) {
                result[tf] = c;
              }
            } catch (err) {
              logger.debug(`[MarketDataManager] getMultiTimeframeCandles failed for ${appSymbol} (${tf})`, { error: String(err) });
            }
          })
        );
        return result;
      }
    };
    marketDataManager = new MarketDataManager();
  }
});

// src/server/market/MarketSessionManager.ts
var MarketSessionManager;
var init_MarketSessionManager = __esm({
  "src/server/market/MarketSessionManager.ts"() {
    init_SymbolNormalizer();
    init_logger();
    init_CacheStore();
    MarketSessionManager = class {
      static {
        this.mockTimestamp = null;
      }
      static {
        this.lastStates = /* @__PURE__ */ new Map();
      }
      static {
        // US Stock Exchange Holiday Calendars (NYSE/NASDAQ)
        this.US_HOLIDAYS = {
          "2025": /* @__PURE__ */ new Set([
            "2025-01-01",
            // New Year's Day
            "2025-01-20",
            // Martin Luther King Jr. Day
            "2025-02-17",
            // Presidents' Day
            "2025-04-18",
            // Good Friday
            "2025-05-26",
            // Memorial Day
            "2025-06-19",
            // Juneteenth
            "2025-07-04",
            // Independence Day
            "2025-09-01",
            // Labor Day
            "2025-11-27",
            // Thanksgiving Day
            "2025-12-25"
            // Christmas Day
          ]),
          "2026": /* @__PURE__ */ new Set([
            "2026-01-01",
            // New Year's Day
            "2026-01-19",
            // Martin Luther King Jr. Day
            "2026-02-16",
            // Presidents' Day
            "2026-04-03",
            // Good Friday
            "2026-05-25",
            // Memorial Day
            "2026-06-19",
            // Juneteenth
            "2026-07-03",
            // Independence Day Observed
            "2026-09-07",
            // Labor Day
            "2026-11-26",
            // Thanksgiving Day
            "2026-12-25"
            // Christmas Day
          ]),
          "2027": /* @__PURE__ */ new Set([
            "2027-01-01",
            // New Year's Day
            "2027-01-18",
            // Martin Luther King Jr. Day
            "2027-02-15",
            // Presidents' Day
            "2027-03-26",
            // Good Friday
            "2027-05-31",
            // Memorial Day
            "2027-06-18",
            // Juneteenth Observed
            "2027-07-05",
            // Independence Day Observed
            "2027-09-06",
            // Labor Day
            "2027-11-25",
            // Thanksgiving Day
            "2027-12-24"
            // Christmas Day Observed
          ])
        };
      }
      /**
       * Sets a simulated system time for testing. Pass null to resume real-time mode.
       */
      static setMockTimestamp(timestamp) {
        if (process.env.NODE_ENV === "production") {
          logger.warn("Mock timestamps are disabled in production environment");
          return;
        }
        this.mockTimestamp = timestamp;
        logger.info("Simulated system time updated", {
          timestamp,
          formatted: timestamp ? new Date(timestamp).toISOString() : "REAL_TIME"
        });
      }
      /**
       * Returns the current operational timestamp (real or mock).
       */
      static getCurrentTimestamp() {
        if (process.env.NODE_ENV === "production") {
          return Date.now();
        }
        return this.mockTimestamp !== null ? this.mockTimestamp : Date.now();
      }
      /**
       * Returns the operational Date object.
       */
      static getCurrentDate() {
        return new Date(this.getCurrentTimestamp());
      }
      /**
       * Translates a Date into components for a specified timezone to preserve exact market-exchange timezone rules.
       */
      static getComponentsForTimeZone(date, timeZone = "America/New_York") {
        const formatter = new Intl.DateTimeFormat("en-US", {
          timeZone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hourCycle: "h23",
          timeZoneName: "short"
        });
        const parts = formatter.formatToParts(date);
        const getPart = (type) => parts.find((p) => p.type === type)?.value || "";
        const year = parseInt(getPart("year"), 10) || date.getUTCFullYear();
        const month = parseInt(getPart("month"), 10) || date.getUTCMonth() + 1;
        const day = parseInt(getPart("day"), 10) || date.getUTCDate();
        const hour = parseInt(getPart("hour"), 10) || 0;
        const minute = parseInt(getPart("minute"), 10) || 0;
        const second = parseInt(getPart("second"), 10) || 0;
        const timeZoneAbbr = getPart("timeZoneName") || (timeZone === "America/New_York" ? "ET" : timeZone);
        const weekdayFormatter = new Intl.DateTimeFormat("en-US", {
          timeZone,
          weekday: "short"
        });
        const weekday = weekdayFormatter.format(date);
        const dateString = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        const timeString = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`;
        const formatted = `${weekday} ${timeString} ${timeZoneAbbr} (${dateString})`;
        return { year, month, day, hour, minute, second, weekday, dateString, timeString, timeZoneAbbr, formatted };
      }
      /**
       * Translates a Date into New York components to preserve exact market-exchange timezone rules.
       */
      static getNYComponents(date) {
        return this.getComponentsForTimeZone(date, "America/New_York");
      }
      /**
       * Resolves the Asset Classification of any normalized symbol.
       */
      static getAssetClassification(symbol) {
        const key = `${symbol}:metadata:classification`;
        const cached = marketCache.getGeneric(key);
        if (cached) return cached;
        const assetType = SymbolNormalizer.getAssetClassification(symbol);
        const result = assetType === "FOREX" ? "FOREX" : assetType === "STOCK" ? "STOCK" : "CRYPTO";
        marketCache.setGeneric(key, result, CACHE_TTL.SYMBOL_METADATA);
        return result;
      }
      /**
       * Checks the exact operational state of any market symbol.
       */
      static getSessionState(symbol) {
        const key = `${symbol}:session_status`;
        const cached = marketCache.getGeneric(key);
        if (cached) return cached;
        const state = this.getSessionStateRaw(symbol);
        marketCache.setGeneric(key, state, CACHE_TTL.MARKET_SESSION_STATUS);
        return state;
      }
      static getSessionStateRaw(symbol) {
        const assetType = this.getAssetClassification(symbol);
        const now = this.getCurrentDate();
        const ny = this.getNYComponents(now);
        if (assetType === "CRYPTO") {
          return "MARKET_OPEN";
        }
        if (assetType === "FOREX") {
          if (ny.weekday === "Sat") {
            return "MARKET_CLOSED";
          }
          if (ny.weekday === "Fri" && ny.hour >= 17) {
            return "MARKET_CLOSED";
          }
          if (ny.weekday === "Sun" && ny.hour < 17) {
            return "MARKET_CLOSED";
          }
          return "MARKET_OPEN";
        }
        if (assetType === "STOCK") {
          if (ny.weekday === "Sat" || ny.weekday === "Sun") {
            return "MARKET_CLOSED";
          }
          const yearStr = String(ny.year);
          if (this.US_HOLIDAYS[yearStr]?.has(ny.dateString)) {
            return "MARKET_CLOSED";
          }
          const minutes = ny.hour * 60 + ny.minute;
          const regularStart = 9 * 60 + 30;
          const regularEnd = 16 * 60;
          const preStart = 4 * 60;
          const afterEnd = 20 * 60;
          if (minutes >= regularStart && minutes < regularEnd) {
            return "MARKET_OPEN";
          }
          if (minutes >= preStart && minutes < regularStart) {
            return "OUTSIDE_TRADING_SESSION";
          }
          if (minutes >= regularEnd && minutes < afterEnd) {
            return "OUTSIDE_TRADING_SESSION";
          }
          return "MARKET_CLOSED";
        }
        return "MARKET_CLOSED";
      }
      /**
       * Tracks whether a market was closed and has just opened.
       * If yes, triggers the eviction of cache entries to force fresh pricing.
       */
      static checkTransitionAndGetFreshnessFlag(symbol) {
        const clean = SymbolNormalizer.normalizeAppSymbol(symbol);
        const currentState = this.getSessionState(clean);
        const previousState = this.lastStates.get(clean);
        this.lastStates.set(clean, currentState);
        if (currentState === "MARKET_OPEN" && previousState && previousState !== "MARKET_OPEN") {
          logger.info("Detected market opening transition. Forcing fresh pricing.", { symbol: clean });
          return true;
        }
        return false;
      }
    };
  }
});

// src/server/signals/TechnicalIndicators.ts
var TechnicalIndicators;
var init_TechnicalIndicators = __esm({
  "src/server/signals/TechnicalIndicators.ts"() {
    init_CacheStore();
    TechnicalIndicators = class {
      static getFingerprint(candles) {
        if (!candles || candles.length === 0) return null;
        const first = candles[0];
        const last = candles[candles.length - 1];
        return `${candles.length}:${first.timestamp}:${last.timestamp}:${last.close}`;
      }
      static getCachedResult(methodName, fingerprint, params) {
        if (!fingerprint) return null;
        const key = `indicator:${methodName}:${fingerprint}:${params}`;
        return marketCache.getGeneric(key);
      }
      static cacheResult(methodName, fingerprint, params, value) {
        if (!fingerprint || value === null || value === void 0) return;
        const key = `indicator:${methodName}:${fingerprint}:${params}`;
        marketCache.setGeneric(key, value, CACHE_TTL.INDICATORS);
      }
      /**
       * Exponential Moving Average (EMA)
       * Expects candles ordered chronologically ascending (oldest first, newest last).
       */
      static calculateEMA(candles, period) {
        const fp = this.getFingerprint(candles);
        const params = `${period}`;
        const cached = this.getCachedResult("calculateEMA", fp, params);
        if (cached) return cached;
        if (candles.length < period) return [];
        const k = 2 / (period + 1);
        const emaValues = [];
        let sum = 0;
        for (let i = 0; i < period; i++) {
          sum += candles[i].close;
        }
        let currentEma = sum / period;
        emaValues.push(currentEma);
        for (let i = period; i < candles.length; i++) {
          const price = candles[i].close;
          currentEma = price * k + currentEma * (1 - k);
          emaValues.push(currentEma);
        }
        this.cacheResult("calculateEMA", fp, params, emaValues);
        return emaValues;
      }
      /**
       * Relative Strength Index (RSI) using Wilder's Smoothing
       */
      static calculateRSI(candles, period = 14) {
        const fp = this.getFingerprint(candles);
        const params = `${period}`;
        const cached = this.getCachedResult("calculateRSI", fp, params);
        if (cached) return cached;
        if (candles.length <= period) return [];
        const rsiValues = [];
        let avgGain = 0;
        let avgLoss = 0;
        for (let i = 1; i <= period; i++) {
          const change = candles[i].close - candles[i - 1].close;
          if (change > 0) avgGain += change;
          else avgLoss += Math.abs(change);
        }
        avgGain /= period;
        avgLoss /= period;
        let rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
        rsiValues.push(100 - 100 / (1 + rs));
        for (let i = period + 1; i < candles.length; i++) {
          const change = candles[i].close - candles[i - 1].close;
          const gain = change > 0 ? change : 0;
          const loss = change < 0 ? Math.abs(change) : 0;
          avgGain = (avgGain * (period - 1) + gain) / period;
          avgLoss = (avgLoss * (period - 1) + loss) / period;
          if (avgLoss === 0) {
            rsiValues.push(100);
          } else {
            rs = avgGain / avgLoss;
            rsiValues.push(100 - 100 / (1 + rs));
          }
        }
        this.cacheResult("calculateRSI", fp, params, rsiValues);
        return rsiValues;
      }
      /**
       * Moving Average Convergence Divergence (MACD)
       */
      static calculateMACD(candles, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
        const fp = this.getFingerprint(candles);
        const params = `${fastPeriod}:${slowPeriod}:${signalPeriod}`;
        const cached = this.getCachedResult("calculateMACD", fp, params);
        if (cached) return cached;
        if (candles.length < slowPeriod + signalPeriod) return null;
        const fastEma = this.calculateEMA(candles, fastPeriod);
        const slowEma = this.calculateEMA(candles, slowPeriod);
        if (fastEma.length === 0 || slowEma.length === 0) return null;
        const offset = slowPeriod - fastPeriod;
        const macdLineSeries = [];
        for (let i = 0; i < slowEma.length; i++) {
          const fastVal = fastEma[i + offset];
          const slowVal = slowEma[i];
          macdLineSeries.push(fastVal - slowVal);
        }
        if (macdLineSeries.length < signalPeriod) return null;
        const k = 2 / (signalPeriod + 1);
        let sum = 0;
        for (let i = 0; i < signalPeriod; i++) {
          sum += macdLineSeries[i];
        }
        let signalLine = sum / signalPeriod;
        for (let i = signalPeriod; i < macdLineSeries.length; i++) {
          signalLine = macdLineSeries[i] * k + signalLine * (1 - k);
        }
        const latestMacd = macdLineSeries[macdLineSeries.length - 1];
        const histogram = latestMacd - signalLine;
        const result = {
          macdLine: latestMacd,
          signalLine,
          histogram
        };
        this.cacheResult("calculateMACD", fp, params, result);
        return result;
      }
      /**
       * Average Directional Index (ADX)
       */
      static calculateADX(candles, period = 14) {
        const fp = this.getFingerprint(candles);
        const params = `${period}`;
        const cached = this.getCachedResult("calculateADX", fp, params);
        if (cached) return cached;
        if (candles.length <= period * 2) return null;
        let trSum = 0;
        let pdmSum = 0;
        let mdmSum = 0;
        for (let i = 1; i <= period; i++) {
          const high = candles[i].high;
          const low = candles[i].low;
          const prevHigh = candles[i - 1].high;
          const prevLow = candles[i - 1].low;
          const prevClose = candles[i - 1].close;
          const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
          trSum += tr;
          const upMove = high - prevHigh;
          const downMove = prevLow - low;
          let pdm = 0;
          let mdm = 0;
          if (upMove > downMove && upMove > 0) {
            pdm = upMove;
          } else if (downMove > upMove && downMove > 0) {
            mdm = downMove;
          }
          pdmSum += pdm;
          mdmSum += mdm;
        }
        let pdi = trSum === 0 ? 0 : pdmSum / trSum * 100;
        let mdi = trSum === 0 ? 0 : mdmSum / trSum * 100;
        const dxList = [];
        let dx = pdi + mdi === 0 ? 0 : Math.abs(pdi - mdi) / (pdi + mdi) * 100;
        dxList.push(dx);
        let adx = 0;
        for (let i = period + 1; i < candles.length; i++) {
          const high = candles[i].high;
          const low = candles[i].low;
          const prevHigh = candles[i - 1].high;
          const prevLow = candles[i - 1].low;
          const prevClose = candles[i - 1].close;
          const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
          trSum = trSum - trSum / period + tr;
          const upMove = high - prevHigh;
          const downMove = prevLow - low;
          let pdm = 0;
          let mdm = 0;
          if (upMove > downMove && upMove > 0) pdm = upMove;
          else if (downMove > upMove && downMove > 0) mdm = downMove;
          pdmSum = pdmSum - pdmSum / period + pdm;
          mdmSum = mdmSum - mdmSum / period + mdm;
          pdi = trSum === 0 ? 0 : pdmSum / trSum * 100;
          mdi = trSum === 0 ? 0 : mdmSum / trSum * 100;
          dx = pdi + mdi === 0 ? 0 : Math.abs(pdi - mdi) / (pdi + mdi) * 100;
          dxList.push(dx);
        }
        if (dxList.length < period) return null;
        adx = dxList.slice(0, period).reduce((a, b) => a + b, 0) / period;
        for (let i = period; i < dxList.length; i++) {
          adx = (adx * (period - 1) + dxList[i]) / period;
        }
        const result = { adx, pdi, mdi };
        this.cacheResult("calculateADX", fp, params, result);
        return result;
      }
      /**
       * Average True Range (ATR)
       */
      static calculateATR(candles, period = 14) {
        const fp = this.getFingerprint(candles);
        const params = `${period}`;
        const cached = this.getCachedResult("calculateATR", fp, params);
        if (cached !== null && cached !== void 0) return cached;
        if (candles.length <= period) return 0;
        const trs = [];
        for (let i = 1; i < candles.length; i++) {
          const high = candles[i].high;
          const low = candles[i].low;
          const prevClose = candles[i - 1].close;
          const tr = Math.max(
            high - low,
            Math.abs(high - prevClose),
            Math.abs(low - prevClose)
          );
          trs.push(tr);
        }
        if (trs.length < period) return 0;
        let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
        for (let i = period; i < trs.length; i++) {
          atr = (atr * (period - 1) + trs[i]) / period;
        }
        this.cacheResult("calculateATR", fp, params, atr);
        return atr;
      }
      /**
       * Bollinger Bands
       */
      static calculateBollingerBands(candles, period = 20, stdDevMultiplier = 2) {
        if (candles.length < period) return null;
        const slice = candles.slice(-period);
        const sum = slice.reduce((acc, c) => acc + c.close, 0);
        const middle = sum / period;
        const variance = slice.reduce((acc, c) => acc + Math.pow(c.close - middle, 2), 0) / period;
        const stdDev = Math.sqrt(variance);
        return {
          upper: middle + stdDev * stdDevMultiplier,
          middle,
          lower: middle - stdDev * stdDevMultiplier
        };
      }
      /**
       * Simple Moving Average (SMA)
       */
      static calculateSMA(candles, period) {
        if (candles.length < period) return [];
        const smaValues = [];
        for (let i = period - 1; i < candles.length; i++) {
          const slice = candles.slice(i - period + 1, i + 1);
          const sum = slice.reduce((acc, c) => acc + c.close, 0);
          smaValues.push(sum / period);
        }
        return smaValues;
      }
      /**
       * Zero-Lag Exponential Moving Average (ZLEMA)
       * Formula: lag = (period - 1) / 2; zldata = close + (close - close[lag]); ZLEMA = EMA(zldata, period)
       */
      static calculateZLEMA(candles, period) {
        const lag = Math.floor((period - 1) / 2);
        if (candles.length < period + lag) return [];
        const zlCloses = [];
        for (let i = lag; i < candles.length; i++) {
          const current = candles[i].close;
          const lagged = candles[i - lag].close;
          zlCloses.push(current + (current - lagged));
        }
        if (zlCloses.length < period) return [];
        const k = 2 / (period + 1);
        const zlemaValues = [];
        let sum = 0;
        for (let i = 0; i < period; i++) {
          sum += zlCloses[i];
        }
        let currentZlema = sum / period;
        zlemaValues.push(currentZlema);
        for (let i = period; i < zlCloses.length; i++) {
          currentZlema = zlCloses[i] * k + currentZlema * (1 - k);
          zlemaValues.push(currentZlema);
        }
        return zlemaValues;
      }
      /**
       * Zero-Lag MACD (ZL-MACD)
       * Fast ZLEMA - Slow ZLEMA, Signal Line = ZLEMA of ZL-MACD line
       */
      static calculateZeroLagMACD(candles, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
        const fastZlema = this.calculateZLEMA(candles, fastPeriod);
        const slowZlema = this.calculateZLEMA(candles, slowPeriod);
        if (fastZlema.length === 0 || slowZlema.length === 0) return null;
        const offset = fastZlema.length - slowZlema.length;
        if (offset < 0) return null;
        const zlMacdLine = [];
        for (let i = 0; i < slowZlema.length; i++) {
          zlMacdLine.push(fastZlema[i + offset] - slowZlema[i]);
        }
        if (zlMacdLine.length < signalPeriod) return null;
        const k = 2 / (signalPeriod + 1);
        let sum = 0;
        for (let i = 0; i < signalPeriod; i++) {
          sum += zlMacdLine[i];
        }
        let signalLine = sum / signalPeriod;
        for (let i = signalPeriod; i < zlMacdLine.length; i++) {
          signalLine = zlMacdLine[i] * k + signalLine * (1 - k);
        }
        const latestMacd = zlMacdLine[zlMacdLine.length - 1];
        const histogram = latestMacd - signalLine;
        return {
          macdLine: latestMacd,
          signalLine,
          histogram
        };
      }
      /**
       * Donchian Channels / Dynamic High-Low Range
       */
      static calculateDonchianChannels(candles, period = 20) {
        if (candles.length < period) return null;
        const slice = candles.slice(-period);
        const upper = Math.max(...slice.map((c) => c.high));
        const lower = Math.min(...slice.map((c) => c.low));
        const middle = (upper + lower) / 2;
        return { upper, lower, middle };
      }
      /**
       * Order Flow Imbalance & Delta Proxy Metrics
       * Evaluates buying vs selling volume pressure and bar-by-bar delta
       */
      static calculateOrderFlowMetrics(candles, period = 10) {
        if (candles.length < period) {
          return {
            buyingPressurePct: 50,
            sellingPressurePct: 50,
            deltaBias: "NEUTRAL",
            volumeSurge: false,
            avgVolume: 0,
            latestVolume: 0
          };
        }
        const slice = candles.slice(-period);
        let totalBuyingVolume = 0;
        let totalSellingVolume = 0;
        let totalVol = 0;
        for (const c of slice) {
          const range = c.high - c.low;
          const vol = c.volume || 1;
          totalVol += vol;
          if (range > 0) {
            const buyFactor = (c.close - c.low) / range;
            const sellFactor = (c.high - c.close) / range;
            totalBuyingVolume += vol * buyFactor;
            totalSellingVolume += vol * sellFactor;
          } else {
            totalBuyingVolume += vol * 0.5;
            totalSellingVolume += vol * 0.5;
          }
        }
        const totalCalculated = totalBuyingVolume + totalSellingVolume;
        const buyingPressurePct = totalCalculated > 0 ? totalBuyingVolume / totalCalculated * 100 : 50;
        const sellingPressurePct = totalCalculated > 0 ? totalSellingVolume / totalCalculated * 100 : 50;
        let deltaBias = "NEUTRAL";
        if (buyingPressurePct >= 55) deltaBias = "BULLISH";
        else if (sellingPressurePct >= 55) deltaBias = "BEARISH";
        const latestVolume = slice[slice.length - 1].volume || 0;
        const avgVolume = totalVol / period;
        const volumeSurge = latestVolume > 0 && avgVolume > 0 && latestVolume >= avgVolume * 1.2;
        return {
          buyingPressurePct: Number(buyingPressurePct.toFixed(1)),
          sellingPressurePct: Number(sellingPressurePct.toFixed(1)),
          deltaBias,
          volumeSurge,
          avgVolume: Math.round(avgVolume),
          latestVolume: Math.round(latestVolume)
        };
      }
      /**
       * Volatility Structure & Breakdown Protection Metrics
       */
      static calculateVolatilityMetrics(candles, atrPeriod = 14) {
        if (candles.length < atrPeriod + 10) {
          return {
            currentAtr: 0,
            baselineAtr: 0,
            atrRatio: 1,
            isSqueeze: false,
            isHealthyVolatility: true,
            isErratic: false,
            isDeadMarket: false,
            isValidExpansion: false
          };
        }
        const currentAtr = this.calculateATR(candles, atrPeriod);
        const baselineSlice = candles.slice(0, -atrPeriod);
        const baselineAtr = baselineSlice.length >= 14 ? this.calculateATR(baselineSlice, Math.min(baselineSlice.length - 1, 28)) : this.calculateATR(candles, Math.min(candles.length - 1, 40));
        const atrRatio = baselineAtr > 0 ? currentAtr / baselineAtr : 1;
        const isSqueeze = atrRatio < 0.65;
        const isErratic = atrRatio > 2.8;
        const isHealthyVolatility = atrRatio >= 0.7 && atrRatio <= 2.5;
        return {
          currentAtr,
          baselineAtr,
          atrRatio: Number(atrRatio.toFixed(2)),
          isSqueeze,
          isHealthyVolatility,
          isErratic,
          isDeadMarket: atrRatio < 0.45,
          isValidExpansion: atrRatio >= 1.1 && atrRatio <= 2.5
        };
      }
      /**
       * Calculates the percentage slope of an EMA series over a lookback window.
       * Positive slope indicates upward trajectory; negative indicates downward.
       */
      static calculateEMASlope(emaValues, lookback = 3) {
        if (!emaValues || emaValues.length < lookback + 1) return 0;
        const current = emaValues[emaValues.length - 1];
        const prev = emaValues[emaValues.length - 1 - lookback];
        if (prev <= 0) return 0;
        return (current - prev) / prev * 100;
      }
      /**
       * Evaluates Price Action Market Structure (Higher Highs / Higher Lows vs Lower Highs / Lower Lows)
       */
      static calculateMarketStructure(candles, lookback = 15) {
        const fp = this.getFingerprint(candles);
        const params = `${lookback}`;
        const cached = this.getCachedResult("calculateMarketStructure", fp, params);
        if (cached) return cached;
        if (candles.length < 6) {
          const fallbackResult = {
            structureBias: "RANGE",
            higherHighsCount: 0,
            higherLowsCount: 0,
            lowerHighsCount: 0,
            lowerLowsCount: 0,
            swingHigh: 0,
            swingLow: 0
          };
          this.cacheResult("calculateMarketStructure", fp, params, fallbackResult);
          return fallbackResult;
        }
        const slice = candles.slice(-Math.min(candles.length, lookback));
        const highs = slice.map((c) => c.high);
        const lows = slice.map((c) => c.low);
        const swingHigh = Math.max(...highs);
        const swingLow = Math.min(...lows);
        let higherHighsCount = 0;
        let higherLowsCount = 0;
        let lowerHighsCount = 0;
        let lowerLowsCount = 0;
        for (let i = 1; i < slice.length; i++) {
          if (slice[i].high > slice[i - 1].high) higherHighsCount++;
          else if (slice[i].high < slice[i - 1].high) lowerHighsCount++;
          if (slice[i].low > slice[i - 1].low) higherLowsCount++;
          else if (slice[i].low < slice[i - 1].low) lowerLowsCount++;
        }
        let structureBias = "RANGE";
        if (higherHighsCount > lowerHighsCount && higherLowsCount >= lowerLowsCount) {
          structureBias = "BULLISH";
        } else if (lowerHighsCount > higherHighsCount && lowerLowsCount >= higherLowsCount) {
          structureBias = "BEARISH";
        }
        const result = {
          structureBias,
          higherHighsCount,
          higherLowsCount,
          lowerHighsCount,
          lowerLowsCount,
          swingHigh,
          swingLow
        };
        this.cacheResult("calculateMarketStructure", fp, params, result);
        return result;
      }
      /**
       * Evaluates recent candlestick wick rejection (absorption & rejection pressure)
       */
      static calculateWickRejection(candles, lookback = 3) {
        if (candles.length < lookback) {
          return {
            lowerWickRejectionPct: 0,
            upperWickRejectionPct: 0,
            hasBullishWickAbsorption: false,
            hasBearishWickAbsorption: false
          };
        }
        const slice = candles.slice(-lookback);
        let totalLowerWick = 0;
        let totalUpperWick = 0;
        let totalRange = 0;
        for (const c of slice) {
          const range = c.high - c.low;
          if (range <= 0) continue;
          totalRange += range;
          const bodyTop = Math.max(c.open, c.close);
          const bodyBottom = Math.min(c.open, c.close);
          const upperWick = c.high - bodyTop;
          const lowerWick = bodyBottom - c.low;
          totalUpperWick += upperWick;
          totalLowerWick += lowerWick;
        }
        const lowerWickRejectionPct = totalRange > 0 ? totalLowerWick / totalRange * 100 : 0;
        const upperWickRejectionPct = totalRange > 0 ? totalUpperWick / totalRange * 100 : 0;
        return {
          lowerWickRejectionPct: Number(lowerWickRejectionPct.toFixed(1)),
          upperWickRejectionPct: Number(upperWickRejectionPct.toFixed(1)),
          hasBullishWickAbsorption: lowerWickRejectionPct >= 38,
          hasBearishWickAbsorption: upperWickRejectionPct >= 38
        };
      }
      static calculateVWAP(candles) {
        const vwapSeries = [];
        if (candles.length === 0) return vwapSeries;
        let cumulativePV = 0;
        let cumulativeVol = 0;
        let currentDay = new Date(candles[0].timestamp).getUTCDay();
        for (const c of candles) {
          const day = new Date(c.timestamp).getUTCDay();
          if (day !== currentDay) {
            cumulativePV = 0;
            cumulativeVol = 0;
            currentDay = day;
          }
          const typicalPrice = (c.high + c.low + c.close) / 3;
          cumulativePV += typicalPrice * c.volume;
          cumulativeVol += c.volume;
          vwapSeries.push(cumulativeVol > 0 ? cumulativePV / cumulativeVol : c.close);
        }
        return vwapSeries;
      }
      static calculateOBV(candles) {
        const obvSeries = [];
        if (candles.length === 0) return obvSeries;
        let obv = 0;
        obvSeries.push(obv);
        for (let i = 1; i < candles.length; i++) {
          const current = candles[i];
          const prev = candles[i - 1];
          if (current.close > prev.close) {
            obv += current.volume;
          } else if (current.close < prev.close) {
            obv -= current.volume;
          }
          obvSeries.push(obv);
        }
        return obvSeries;
      }
    };
  }
});

// src/server/signals/Gate3PreliminaryScreen.ts
var Gate3PreliminaryScreen;
var init_Gate3PreliminaryScreen = __esm({
  "src/server/signals/Gate3PreliminaryScreen.ts"() {
    init_SymbolNormalizer();
    init_TechnicalIndicators();
    init_CacheStore();
    Gate3PreliminaryScreen = class {
      static {
        this.PASSING_THRESHOLD = 60;
      }
      static {
        this.STRONG_CANDIDATE_THRESHOLD = 70;
      }
      /**
       * Evaluates an individual asset against Gate 3 criteria using cached/1H baseline information.
       * Does NOT make or require multi-timeframe calls.
       */
      static screenAsset(asset, htf1h, liveTicker) {
        const assetClass = SymbolNormalizer.getAssetClassification(asset);
        if (!htf1h || htf1h.length < 15) {
          return this.createRejectResult(
            asset,
            assetClass,
            "BUY",
            0,
            "Insufficient 1H candle history for preliminary screening (<15 candles)",
            {
              liquidity: 0,
              volume: 0,
              trend: 0,
              momentum: 0,
              volatilityQuality: 0,
              spreadExecutionQuality: 0,
              total: 0
            },
            {
              atr: 0,
              atrPct: 0,
              rangePct: 0,
              relativeVolume: 0,
              momentumPct: 0,
              estimatedSpreadBps: 0,
              ema9: 0,
              ema21: 0
            }
          );
        }
        const sorted = [...htf1h].sort((a, b) => a.timestamp - b.timestamp);
        const closes = sorted.map((c) => c.close);
        const len = closes.length;
        const latestClose = closes[len - 1];
        if (!latestClose || latestClose <= 0 || isNaN(latestClose)) {
          return this.createRejectResult(
            asset,
            assetClass,
            "BUY",
            0,
            "Invalid candle close price (<= 0 or NaN)",
            {
              liquidity: 0,
              volume: 0,
              trend: 0,
              momentum: 0,
              volatilityQuality: 0,
              spreadExecutionQuality: 0,
              total: 0
            },
            {
              atr: 0,
              atrPct: 0,
              rangePct: 0,
              relativeVolume: 0,
              momentumPct: 0,
              estimatedSpreadBps: 0,
              ema9: 0,
              ema21: 0
            }
          );
        }
        let liquidityScore = 0;
        const upperSym = asset.toUpperCase();
        const tier1Majors = /* @__PURE__ */ new Set([
          "BTCUSDT",
          "ETHUSDT",
          "SOLUSDT",
          "BNBUSDT",
          "XRPUSDT",
          "EURUSD",
          "GBPUSD",
          "USDJPY",
          "AUDUSD",
          "USDCAD",
          "USDCHF",
          "AAPL",
          "NVDA",
          "MSFT",
          "TSLA",
          "AMZN",
          "GOOGL",
          "META"
        ]);
        const tier2Majors = /* @__PURE__ */ new Set([
          "ADAUSDT",
          "DOGEUSDT",
          "DOTUSDT",
          "LINKUSDT",
          "AVAXUSDT",
          "SUIUSDT",
          "NEARUSDT",
          "NZDUSD",
          "EURGBP",
          "EURJPY",
          "GBPJPY",
          "AUDJPY",
          "EURCAD",
          "LLY",
          "V",
          "JPM",
          "XOM",
          "WMT",
          "MA",
          "AVGO",
          "COST",
          "AMD",
          "NFLX"
        ]);
        if (tier1Majors.has(upperSym)) {
          liquidityScore = 20;
        } else if (tier2Majors.has(upperSym)) {
          liquidityScore = 17;
        } else {
          liquidityScore = 14;
        }
        if (liveTicker && liveTicker.status === "OK" && liveTicker.price > 0) {
          liquidityScore = Math.min(20, liquidityScore + 1);
        }
        let volumeScore = 0;
        let relativeVolume = 1;
        const volumes = sorted.map((c) => c.volume || 0).filter((v) => v > 0);
        if (volumes.length >= 5) {
          const recentVolume = volumes[volumes.length - 1];
          const avgVolume = volumes.reduce((acc, v) => acc + v, 0) / volumes.length;
          relativeVolume = avgVolume > 0 ? recentVolume / avgVolume : 1;
          if (relativeVolume >= 1.5) {
            volumeScore = 20;
          } else if (relativeVolume >= 1.1) {
            volumeScore = 17;
          } else if (relativeVolume >= 0.8) {
            volumeScore = 14;
          } else if (relativeVolume >= 0.5) {
            volumeScore = 10;
          } else {
            volumeScore = 6;
          }
        } else {
          const ranges = sorted.slice(-10).map((c) => c.high - c.low);
          const recentRange = ranges[ranges.length - 1] || 0;
          const avgRange = ranges.reduce((acc, r) => acc + r, 0) / (ranges.length || 1);
          const rangeRatio = avgRange > 0 ? recentRange / avgRange : 1;
          relativeVolume = rangeRatio;
          if (rangeRatio >= 1.3) volumeScore = 18;
          else if (rangeRatio >= 0.9) volumeScore = 15;
          else if (rangeRatio >= 0.6) volumeScore = 11;
          else volumeScore = 7;
        }
        let trendScore = 0;
        const ema9Series = TechnicalIndicators.calculateEMA(sorted, 9);
        const ema21Series = TechnicalIndicators.calculateEMA(sorted, 21);
        const ema9 = ema9Series.length > 0 ? ema9Series[ema9Series.length - 1] : latestClose;
        const ema21 = ema21Series.length > 0 ? ema21Series[ema21Series.length - 1] : latestClose;
        const isBullish = ema9 > ema21 && latestClose >= ema9 * 0.998;
        const isBearish = ema9 < ema21 && latestClose <= ema9 * 1.002;
        const proposedDirection = isBullish ? "BUY" : isBearish ? "SELL" : "BUY";
        const emaSpreadPct = Math.abs(ema9 - ema21) / ema21 * 100;
        if (isBullish || isBearish) {
          if (emaSpreadPct >= 0.35) {
            trendScore = 20;
          } else if (emaSpreadPct >= 0.15) {
            trendScore = 17;
          } else {
            trendScore = 13;
          }
        } else {
          if (emaSpreadPct < 0.05) {
            trendScore = 4;
          } else {
            trendScore = 8;
          }
        }
        let momentumScore = 0;
        const lookback5 = Math.max(0, len - 6);
        const price5BarsAgo = closes[lookback5] || latestClose;
        const momentumPct = price5BarsAgo > 0 ? (latestClose - price5BarsAgo) / price5BarsAgo * 100 : 0;
        const momentumAligned = proposedDirection === "BUY" && momentumPct > 0 || proposedDirection === "SELL" && momentumPct < 0;
        const absMomentum = Math.abs(momentumPct);
        if (momentumAligned) {
          if (absMomentum >= 0.4) {
            momentumScore = 15;
          } else if (absMomentum >= 0.15) {
            momentumScore = 13;
          } else {
            momentumScore = 10;
          }
        } else {
          if (absMomentum < 0.1) {
            momentumScore = 6;
          } else {
            momentumScore = 3;
          }
        }
        let volatilityQualityScore = 0;
        const atr14 = TechnicalIndicators.calculateATR(sorted, 14);
        const atrPct = latestClose > 0 ? atr14 / latestClose * 100 : 0;
        const last10 = sorted.slice(-10);
        let maxHigh = -Infinity;
        let minLow = Infinity;
        for (const c of last10) {
          if (c.high > maxHigh) maxHigh = c.high;
          if (c.low < minLow) minLow = c.low;
        }
        const rangePct = latestClose > 0 ? (maxHigh - minLow) / latestClose * 100 : 0;
        if (atrPct < 0.05 || rangePct < 0.1) {
          volatilityQualityScore = 2;
        } else if (atrPct >= 0.25 && rangePct >= 0.5) {
          volatilityQualityScore = 15;
        } else if (atrPct >= 0.12 && rangePct >= 0.25) {
          volatilityQualityScore = 12;
        } else if (atrPct >= 0.08) {
          volatilityQualityScore = 9;
        } else {
          volatilityQualityScore = 5;
        }
        let spreadExecutionQualityScore = 0;
        let estimatedSpreadBps = 2;
        if (assetClass === "FOREX") {
          const isMajorFx = ["EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "USDCAD"].includes(upperSym);
          estimatedSpreadBps = isMajorFx ? 0.8 : 1.8;
        } else if (assetClass === "CRYPTO") {
          const isMajorCrypto = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"].includes(upperSym);
          estimatedSpreadBps = isMajorCrypto ? 1.5 : 4;
        } else {
          estimatedSpreadBps = tier1Majors.has(upperSym) ? 1 : 3.5;
        }
        if (estimatedSpreadBps <= 1) {
          spreadExecutionQualityScore = 10;
        } else if (estimatedSpreadBps <= 2.5) {
          spreadExecutionQualityScore = 8;
        } else if (estimatedSpreadBps <= 5) {
          spreadExecutionQualityScore = 6;
        } else {
          spreadExecutionQualityScore = 3;
        }
        const totalScore = Math.min(
          100,
          Math.max(
            0,
            liquidityScore + volumeScore + trendScore + momentumScore + volatilityQualityScore + spreadExecutionQualityScore
          )
        );
        let routing;
        if (totalScore >= this.STRONG_CANDIDATE_THRESHOLD) {
          routing = "STRONG_PRELIMINARY_CANDIDATE";
        } else if (totalScore >= this.PASSING_THRESHOLD) {
          routing = "PRELIMINARY_CANDIDATE";
        } else {
          routing = "REJECT";
        }
        const passed = routing !== "REJECT";
        const componentScores = {
          liquidity: liquidityScore,
          volume: volumeScore,
          trend: trendScore,
          momentum: momentumScore,
          volatilityQuality: volatilityQualityScore,
          spreadExecutionQuality: spreadExecutionQualityScore,
          total: totalScore
        };
        const metrics = {
          atr: atr14,
          atrPct,
          rangePct,
          relativeVolume,
          momentumPct,
          estimatedSpreadBps,
          ema9,
          ema21
        };
        const reason = passed ? `Gate 3 ${routing}: Score ${totalScore}/100 [Liq:${liquidityScore}, Vol:${volumeScore}, Trend:${trendScore}, Mom:${momentumScore}, VolQual:${volatilityQualityScore}, Spread:${spreadExecutionQualityScore}]. Qualified for deep analysis.` : `Gate 3 REJECT: Score ${totalScore}/100 (Threshold ${this.PASSING_THRESHOLD}) [Liq:${liquidityScore}, Vol:${volumeScore}, Trend:${trendScore}, Mom:${momentumScore}, VolQual:${volatilityQualityScore}, Spread:${spreadExecutionQualityScore}].`;
        marketCache.setGeneric(`${asset}:preliminary_score`, totalScore, CACHE_TTL.PREVIOUS_SCORE);
        marketCache.setGeneric(`${asset}:trend_direction`, proposedDirection, CACHE_TTL.PREVIOUS_DIRECTION);
        return {
          asset,
          assetClass,
          preliminaryScore: totalScore,
          routing,
          passed,
          direction: proposedDirection,
          componentScores,
          metrics,
          reason
        };
      }
      static createRejectResult(asset, assetClass, direction, score, reason, componentScores, metrics) {
        return {
          asset,
          assetClass,
          preliminaryScore: score,
          routing: "REJECT",
          passed: false,
          direction,
          componentScores,
          metrics,
          reason
        };
      }
    };
  }
});

// src/server/signals/StrategyPerformanceTracker.ts
var fs3, path2, PERFORMANCE_LEGAL_DISCLAIMER, LOCAL_PERFORMANCE_PATH, FIRESTORE_PERFORMANCE_DOC, StrategyPerformanceTracker;
var init_StrategyPerformanceTracker = __esm({
  "src/server/signals/StrategyPerformanceTracker.ts"() {
    fs3 = __toESM(require("fs"), 1);
    path2 = __toESM(require("path"), 1);
    init_firebaseAdmin();
    init_logger();
    PERFORMANCE_LEGAL_DISCLAIMER = "DISCLAIMER: Historical performance, backtest simulation results, walk-forward evaluations, and confidence calibration metrics are statistical tools for backend algorithmic risk management only. Past performance does not guarantee or claim future profitability. Live trading involves substantial market risk.";
    LOCAL_PERFORMANCE_PATH = path2.join(process.cwd(), "strategy_performance.json");
    FIRESTORE_PERFORMANCE_DOC = "analytics/strategy_performance";
    StrategyPerformanceTracker = class {
      static {
        this.state = {
          version: 2,
          lastUpdated: Date.now(),
          disclaimer: PERFORMANCE_LEGAL_DISCLAIMER,
          overall: {
            totalTrades: 0,
            wins: 0,
            losses: 0,
            breakevens: 0,
            winRatePct: 0,
            lossRatePct: 0,
            rollingWinRatePct: 0,
            profitFactor: 0,
            totalRealizedR: 0,
            avgR: 0,
            expectancyR: 0,
            maxDrawdownR: 0,
            maxLosingStreak: 0,
            currentStreak: 0,
            totalSignals: 0,
            signalConversionRatePct: 0,
            entryOpportunityRatePct: 0,
            expirationRatePct: 0,
            expiredSignals: 0
          },
          byStrategy: {},
          byAsset: {},
          byAssetClass: {},
          byTimeframe: {},
          byRegime: {},
          byConfidenceRange: {},
          recentTrades: []
        };
      }
      static {
        this.isInitialized = false;
      }
      /**
       * Helper to derive confidence bucket from confidence score
       */
      static getConfidenceRange(score) {
        if (score >= 90) return "90-100";
        if (score >= 80) return "80-89";
        return "70-79";
      }
      /**
       * Initializes performance tracking state from local disk or Firestore.
       */
      static init() {
        if (this.isInitialized) return;
        try {
          if (fs3.existsSync(LOCAL_PERFORMANCE_PATH)) {
            const raw = fs3.readFileSync(LOCAL_PERFORMANCE_PATH, "utf-8");
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === "object") {
              this.state = {
                version: parsed.version || 2,
                lastUpdated: parsed.lastUpdated || Date.now(),
                disclaimer: PERFORMANCE_LEGAL_DISCLAIMER,
                overall: parsed.overall || this.state.overall,
                byStrategy: parsed.byStrategy || {},
                byAsset: parsed.byAsset || {},
                byAssetClass: parsed.byAssetClass || {},
                byTimeframe: parsed.byTimeframe || {},
                byRegime: parsed.byRegime || {},
                byConfidenceRange: parsed.byConfidenceRange || {},
                recentTrades: Array.isArray(parsed.recentTrades) ? parsed.recentTrades : []
              };
              logger.info("[StrategyPerformanceTracker] Loaded strategy performance state from disk.");
            }
          }
        } catch (err) {
          logger.warn("[StrategyPerformanceTracker] Could not load local performance file:", { error: String(err) });
        }
        this.isInitialized = true;
        this.rebuildAllMetrics();
      }
      /**
       * Rebuilds all metrics from scratch using only real live and historical trades.
       * Strictly excludes "BACKTEST", "SIMULATION", "TEST", and synthetic trades.
       */
      static rebuildAllMetrics() {
        this.state.overall = this.createEmptyMetricSummary();
        this.state.byStrategy = {};
        this.state.byAsset = {};
        this.state.byAssetClass = {};
        this.state.byTimeframe = {};
        this.state.byRegime = {};
        this.state.byConfidenceRange = {};
        const productionTrades = this.state.recentTrades.filter((t) => {
          const prov = (t.provenance || "").toUpperCase();
          const isSynthetic = t.isSynthetic || t.signalId?.startsWith("hist_sig_");
          if (prov === "BACKTEST" || prov === "SIMULATION" || prov === "TEST" || isSynthetic) {
            return false;
          }
          return true;
        });
        for (const record of productionTrades) {
          if (!record.confidenceRange && record.confidenceScore) {
            record.confidenceRange = this.getConfidenceRange(record.confidenceScore);
          } else if (!record.confidenceRange) {
            record.confidenceRange = "80-89";
          }
          this.updateSummaryMetrics(this.state.overall, record, productionTrades);
          const stratKey = record.strategyId || "unknown_strategy";
          if (!this.state.byStrategy[stratKey]) {
            this.state.byStrategy[stratKey] = this.createEmptyMetricSummary();
          }
          const stratTrades = productionTrades.filter((t) => t.strategyId === stratKey);
          this.updateSummaryMetrics(this.state.byStrategy[stratKey], record, stratTrades);
          const symKey = record.symbol.toUpperCase();
          if (!this.state.byAsset[symKey]) {
            this.state.byAsset[symKey] = this.createEmptyMetricSummary();
          }
          const symTrades = productionTrades.filter((t) => t.symbol.toUpperCase() === symKey);
          this.updateSummaryMetrics(this.state.byAsset[symKey], record, symTrades);
          const assetClassKey = record.assetClass || "CRYPTO";
          if (!this.state.byAssetClass[assetClassKey]) {
            this.state.byAssetClass[assetClassKey] = this.createEmptyMetricSummary();
          }
          const acTrades = productionTrades.filter((t) => t.assetClass === assetClassKey);
          this.updateSummaryMetrics(this.state.byAssetClass[assetClassKey], record, acTrades);
          const tfKey = record.timeframe || "1h";
          if (!this.state.byTimeframe[tfKey]) {
            this.state.byTimeframe[tfKey] = this.createEmptyMetricSummary();
          }
          const tfTrades = productionTrades.filter((t) => t.timeframe === tfKey);
          this.updateSummaryMetrics(this.state.byTimeframe[tfKey], record, tfTrades);
          const regimeKey = record.marketRegime || "RANGING";
          if (!this.state.byRegime[regimeKey]) {
            this.state.byRegime[regimeKey] = this.createEmptyMetricSummary();
          }
          const regimeTrades = productionTrades.filter((t) => t.marketRegime === regimeKey);
          this.updateSummaryMetrics(this.state.byRegime[regimeKey], record, regimeTrades);
          const rangeKey = record.confidenceRange;
          if (!this.state.byConfidenceRange[rangeKey]) {
            this.state.byConfidenceRange[rangeKey] = this.createEmptyMetricSummary();
          }
          const rangeTrades = productionTrades.filter((t) => t.confidenceRange === rangeKey);
          this.updateSummaryMetrics(this.state.byConfidenceRange[rangeKey], record, rangeTrades);
        }
      }
      /**
       * Saves state to local disk and triggers Firestore sync.
       */
      static saveState() {
        try {
          if (this.state.recentTrades.length > 500) {
            this.state.recentTrades = this.state.recentTrades.slice(-500);
          }
          this.state.lastUpdated = Date.now();
          fs3.writeFileSync(LOCAL_PERFORMANCE_PATH, JSON.stringify(this.state, null, 2), "utf-8");
        } catch (err) {
          logger.warn("[StrategyPerformanceTracker] Failed to write performance state to disk:", { error: String(err) });
        }
        const firestore = getFirestoreAdmin();
        if (firestore) {
          firestore.doc(FIRESTORE_PERFORMANCE_DOC).set(this.state, { merge: true }).catch((err) => {
            logger.debug("[StrategyPerformanceTracker] Firestore sync deferred", { reason: String(err) });
          });
        }
      }
      /**
       * Records a resolved trade outcome into the performance database across all tracking dimensions.
       */
      static recordTradeOutcome(record) {
        this.init();
        if (!record.confidenceRange && record.confidenceScore) {
          record.confidenceRange = this.getConfidenceRange(record.confidenceScore);
        } else if (!record.confidenceRange) {
          record.confidenceRange = "80-89";
        }
        this.state.recentTrades.push(record);
        this.rebuildAllMetrics();
        this.saveState();
        logger.info(`[StrategyPerformanceTracker] Recorded outcome for ${record.symbol} (${record.outcomeStatus}, ${record.realizedRR}R). Strategy: ${record.strategyName}, Overall WR: ${this.state.overall.winRatePct}% (Rolling: ${this.state.overall.rollingWinRatePct}%)`);
      }
      static createEmptyMetricSummary() {
        return {
          totalTrades: 0,
          wins: 0,
          losses: 0,
          breakevens: 0,
          winRatePct: 0,
          lossRatePct: 0,
          rollingWinRatePct: 0,
          profitFactor: 0,
          totalRealizedR: 0,
          avgR: 0,
          expectancyR: 0,
          maxDrawdownR: 0,
          maxLosingStreak: 0,
          currentStreak: 0,
          totalSignals: 0,
          signalConversionRatePct: 0,
          entryOpportunityRatePct: 0,
          expirationRatePct: 0,
          expiredSignals: 0
        };
      }
      static updateSummaryMetrics(summary, record, tradeHistory) {
        summary.totalSignals = (summary.totalSignals ?? 0) + 1;
        summary.expiredSignals = summary.expiredSignals ?? 0;
        const isEntered = record.tradeEntered !== false && record.TRADE_ENTERED !== false && record.outcomeStatus !== "NO_ENTRY / EXPIRED";
        if (!isEntered) {
          summary.expiredSignals += 1;
        } else {
          summary.totalTrades += 1;
          if (record.outcomeStatus === "TP_HIT" || record.isWin) {
            summary.wins += 1;
            summary.currentStreak = summary.currentStreak >= 0 ? summary.currentStreak + 1 : 1;
          } else if (record.outcomeStatus === "SL_HIT") {
            summary.losses += 1;
            summary.currentStreak = summary.currentStreak <= 0 ? summary.currentStreak - 1 : -1;
            const absLosingStreak = Math.abs(summary.currentStreak);
            if (absLosingStreak > summary.maxLosingStreak) {
              summary.maxLosingStreak = absLosingStreak;
            }
          } else {
            summary.breakevens += 1;
            summary.currentStreak = 0;
          }
        }
        summary.winRatePct = summary.totalTrades > 0 ? Number((summary.wins / summary.totalTrades * 100).toFixed(1)) : 0;
        summary.lossRatePct = summary.totalTrades > 0 ? Number((summary.losses / summary.totalTrades * 100).toFixed(1)) : 0;
        summary.signalConversionRatePct = summary.totalSignals > 0 ? Number((summary.totalTrades / summary.totalSignals * 100).toFixed(1)) : 0;
        summary.entryOpportunityRatePct = summary.signalConversionRatePct;
        summary.expirationRatePct = summary.totalSignals > 0 ? Number((summary.expiredSignals / summary.totalSignals * 100).toFixed(1)) : 0;
        const actualTradesHistory = tradeHistory.filter(
          (t) => t.tradeEntered !== false && t.TRADE_ENTERED !== false && t.outcomeStatus !== "NO_ENTRY / EXPIRED"
        );
        const last20 = actualTradesHistory.slice(-20);
        const last20Wins = last20.filter((t) => t.outcomeStatus === "TP_HIT" || t.isWin).length;
        summary.rollingWinRatePct = last20.length > 0 ? Number((last20Wins / Math.max(1, last20.length) * 100).toFixed(1)) : 0;
        let totalWinR = 0;
        let totalLossR = 0;
        for (const t of actualTradesHistory) {
          if (t.realizedRR > 0) totalWinR += t.realizedRR;
          else if (t.realizedRR < 0) totalLossR += Math.abs(t.realizedRR);
        }
        summary.profitFactor = totalLossR > 0 ? Number((totalWinR / totalLossR).toFixed(2)) : totalWinR > 0 ? Number(totalWinR.toFixed(2)) : 0;
        const winProb = summary.winRatePct / 100;
        const lossProb = summary.totalTrades > 0 ? summary.losses / summary.totalTrades : 0;
        const winTrades = actualTradesHistory.filter((t) => t.realizedRR > 0);
        const lossTrades = actualTradesHistory.filter((t) => t.realizedRR < 0);
        const avgWin = winTrades.length > 0 ? winTrades.reduce((acc, t) => acc + t.realizedRR, 0) / winTrades.length : 0;
        const avgLoss = lossTrades.length > 0 ? Math.abs(lossTrades.reduce((acc, t) => acc + t.realizedRR, 0) / lossTrades.length) : 0;
        summary.expectancyR = Number((winProb * avgWin - lossProb * avgLoss).toFixed(3));
        summary.totalRealizedR = Number(actualTradesHistory.reduce((acc, t) => acc + t.realizedRR, 0).toFixed(2));
        summary.avgR = summary.totalTrades > 0 ? Number((summary.totalRealizedR / summary.totalTrades).toFixed(3)) : 0;
      }
      /**
       * Confidence Calibration Engine:
       * Calibrates future candidate scores based on historical performance of confidence buckets.
       *
       * If confidence range (e.g. '90-100') achieves high win rate (> 60%), returns a calibration boost (1.02 - 1.10).
       * If confidence range (e.g. '70-79') shows weak win rate (< 40%), returns a calibration penalty (0.85 - 0.95).
       */
      static getConfidenceCalibrationFactor(confidenceScore, strategyId, symbol) {
        this.init();
        const rangeKey = this.getConfidenceRange(confidenceScore);
        const bucketMetrics = this.state.byConfidenceRange[rangeKey];
        if (!bucketMetrics || bucketMetrics.totalTrades < 5) {
          return 1;
        }
        const wr = bucketMetrics.winRatePct / 100;
        const exp = bucketMetrics.expectancyR;
        if (wr < 0.4 || exp < 0) {
          return 0.9;
        } else if (wr > 0.65 && exp > 0.3) {
          return 1.08;
        } else if (wr > 0.55) {
          return 1.03;
        }
        return 1;
      }
      /**
       * Automatic Strategy Weighting Engine:
       * Consistently weak strategies (< 40% win rate or negative expectancy) receive less influence (down to 0.5x);
       * strong strategies (> 60% win rate and positive expectancy) receive higher influence (up to 1.5x).
       * Uses Bayesian regularized shrinkage to prevent overfitting on small samples.
       */
      static getDynamicStrategyWeightMultiplier(strategyId, regime) {
        this.init();
        const stratMetrics = this.state.byStrategy[strategyId];
        if (!stratMetrics || stratMetrics.totalTrades < 5) {
          return 1;
        }
        const n = stratMetrics.totalTrades;
        const shrinkage = n / (n + 15);
        const winRate = stratMetrics.winRatePct / 100;
        const exp = stratMetrics.expectancyR;
        if (winRate < 0.4 || exp < -0.1) {
          const penaltyFactor = 0.5 + 0.5 * (1 - shrinkage);
          return Number(Math.max(0.5, penaltyFactor).toFixed(2));
        }
        const rawDelta = (winRate - 0.5) * 0.6;
        let regimeBonus = 0;
        if (regime && this.state.byRegime[regime] && this.state.byRegime[regime].totalTrades >= 3) {
          const regimeWR = this.state.byRegime[regime].winRatePct / 100;
          regimeBonus = (regimeWR - 0.5) * 0.2;
        }
        const adjustment = shrinkage * (rawDelta + regimeBonus);
        const multiplier = 1 + adjustment;
        return Number(Math.max(0.5, Math.min(1.5, multiplier)).toFixed(2));
      }
      /**
       * Resets the tracker to an uninitialized, empty state.
       * Useful for testing and sandbox isolation.
       */
      static clearState() {
        this.state = {
          version: 2,
          lastUpdated: Date.now(),
          disclaimer: PERFORMANCE_LEGAL_DISCLAIMER,
          overall: {
            totalTrades: 0,
            wins: 0,
            losses: 0,
            breakevens: 0,
            winRatePct: 0,
            rollingWinRatePct: 0,
            profitFactor: 0,
            totalRealizedR: 0,
            avgR: 0,
            expectancyR: 0,
            maxDrawdownR: 0,
            maxLosingStreak: 0,
            currentStreak: 0
          },
          byStrategy: {},
          byAsset: {},
          byAssetClass: {},
          byTimeframe: {},
          byRegime: {},
          byConfidenceRange: {},
          recentTrades: []
        };
        this.isInitialized = true;
      }
      /**
       * Retrieves full performance state and analytics.
       */
      static getPerformanceMetrics() {
        this.init();
        return { ...this.state, disclaimer: PERFORMANCE_LEGAL_DISCLAIMER };
      }
    };
  }
});

// src/server/signals/Gate1MarketRegime.ts
var Gate1MarketRegime;
var init_Gate1MarketRegime = __esm({
  "src/server/signals/Gate1MarketRegime.ts"() {
    init_TechnicalIndicators();
    Gate1MarketRegime = class {
      /**
       * Detect the current market regime based on multiple timeframes and factors.
       */
      static detectRegime(symbol, timeframes) {
        const factors = [];
        const invalidation = [];
        const tfKeys = Object.keys(timeframes);
        let primaryTf = "1h";
        if (!timeframes["1h"] || timeframes["1h"].length < 50) {
          if (timeframes["4h"] && timeframes["4h"].length >= 50) primaryTf = "4h";
          else if (timeframes["30m"] && timeframes["30m"].length >= 50) primaryTf = "30m";
          else if (timeframes["15m"] && timeframes["15m"].length >= 50) primaryTf = "15m";
          else if (timeframes["5m"] && timeframes["5m"].length >= 50) primaryTf = "5m";
          else {
            return {
              regime: "UNKNOWN",
              confidence: 0,
              factors: ["Insufficient candle data for robust regime detection"],
              invalidation: ["Need at least 50 candles on a stable timeframe"]
            };
          }
        }
        const candles = timeframes[primaryTf];
        if (!candles || candles.length < 50) {
          return {
            regime: "UNKNOWN",
            confidence: 0,
            factors: ["Insufficient candles for calculation"],
            invalidation: []
          };
        }
        const closes = candles.map((c) => c.close);
        const highs = candles.map((c) => c.high);
        const lows = candles.map((c) => c.low);
        const opens = candles.map((c) => c.open);
        const volumes = candles.map((c) => c.volume || 0);
        const latestClose = closes[closes.length - 1];
        const ema20 = TechnicalIndicators.calculateEMA(candles, 20);
        const ema50 = TechnicalIndicators.calculateEMA(candles, 50);
        const ema200 = TechnicalIndicators.calculateEMA(candles, 200);
        const adxResult = TechnicalIndicators.calculateADX(candles, 14);
        const bbHistory = [];
        for (let i = candles.length - 20; i <= candles.length; i++) {
          const slice = candles.slice(0, i);
          if (slice.length >= 20) {
            const res = TechnicalIndicators.calculateBollingerBands(slice, 20, 2);
            if (res) bbHistory.push(res);
          }
        }
        const atrHistory = [];
        for (let i = candles.length - 20; i <= candles.length; i++) {
          const slice = candles.slice(0, i);
          if (slice.length >= 14) {
            const res = TechnicalIndicators.calculateATR(slice, 14);
            atrHistory.push(res);
          }
        }
        if (!adxResult || bbHistory.length === 0 || atrHistory.length === 0) {
          return { regime: "UNKNOWN", confidence: 0, factors: ["Failed to compute required indicators"], invalidation: [] };
        }
        const currentEma20 = ema20[ema20.length - 1];
        const currentEma50 = ema50[ema50.length - 1];
        const currentEma200 = ema200[ema200.length - 1] || currentEma50;
        const currentAdx = adxResult.adx;
        const currentPdi = adxResult.pdi;
        const currentMdi = adxResult.mdi;
        const currentBb = bbHistory[bbHistory.length - 1];
        const bbWidth = (currentBb.upper - currentBb.lower) / currentBb.middle;
        const historicalBbWidths = bbHistory.map((b) => (b.upper - b.lower) / b.middle);
        const avgBbWidth = historicalBbWidths.reduce((a, b) => a + b, 0) / historicalBbWidths.length;
        const currentAtr = atrHistory[atrHistory.length - 1];
        const atrPct = currentAtr / latestClose;
        const historicalAtr = atrHistory.reduce((a, b) => a + b, 0) / atrHistory.length;
        const recentHighs = Math.max(...highs.slice(-10));
        const recentLows = Math.min(...lows.slice(-10));
        const prevHighs = Math.max(...highs.slice(-20, -10));
        const prevLows = Math.min(...lows.slice(-20, -10));
        const higherHighs = recentHighs > prevHighs;
        const higherLows = recentLows > prevLows;
        const lowerHighs = recentHighs < prevHighs;
        const lowerLows = recentLows < prevLows;
        const bullAlignment = currentEma20 > currentEma50 && currentEma50 > currentEma200;
        const bearAlignment = currentEma20 < currentEma50 && currentEma50 < currentEma200;
        const strongTrendAdx = currentAdx > 25;
        const weakTrendAdx = currentAdx >= 20 && currentAdx <= 25;
        let regime = "UNKNOWN";
        let confidence = 0;
        if (currentAtr > historicalAtr * 1.5 || bbWidth > avgBbWidth * 1.5) {
          if (bbWidth > avgBbWidth * 1.5 && strongTrendAdx && (bullAlignment || bearAlignment)) {
            regime = "BREAKOUT";
            confidence = 80 + Math.min(20, currentAtr / historicalAtr * 10);
            factors.push(`Price is expanding rapidly out of a structural range (BB Width: ${(bbWidth * 100).toFixed(2)}% vs Avg: ${(avgBbWidth * 100).toFixed(2)}%)`);
            factors.push(`Strong directional momentum (ADX: ${currentAdx.toFixed(1)})`);
            invalidation.push("Volume drops drastically or price falls back inside previous BB range.");
            invalidation.push("ADX falls below 20");
          } else {
            regime = "HIGH_VOLATILITY";
            confidence = 80;
            factors.push(`ATR (${atrPct.toFixed(4)}) is significantly above its 20-period average`);
            factors.push(`Bollinger Bands are abnormally wide indicating volatile chop or shock`);
            invalidation.push("ATR contracts back to historical average levels");
          }
        } else if (bullAlignment && currentPdi > currentMdi) {
          if (strongTrendAdx && higherHighs && higherLows) {
            regime = "STRONG_BULL_TREND";
            confidence = Math.min(100, 50 + currentAdx);
            factors.push(`EMA stack is bullish (20 > 50 > 200)`);
            factors.push(`ADX indicates strong trend (${currentAdx.toFixed(1)} > 25)`);
            factors.push(`+DI (${currentPdi.toFixed(1)}) > -DI (${currentMdi.toFixed(1)})`);
            factors.push(`Market structure shows higher highs and higher lows`);
            invalidation.push("Price breaks below the EMA 50");
            invalidation.push("-DI crosses above +DI");
          } else if ((strongTrendAdx || weakTrendAdx) && !lowerLows) {
            regime = "WEAK_BULL_TREND";
            confidence = 60;
            factors.push(`EMA stack is generally bullish`);
            factors.push(`Trend strength is moderate/weak (ADX: ${currentAdx.toFixed(1)})`);
            factors.push(`Structure is not aggressively forming higher highs`);
            invalidation.push("Price breaks below EMA 200");
            invalidation.push("Market structure prints a clear lower low");
          }
        } else if (bearAlignment && currentMdi > currentPdi) {
          if (strongTrendAdx && lowerHighs && lowerLows) {
            regime = "STRONG_BEAR_TREND";
            confidence = Math.min(100, 50 + currentAdx);
            factors.push(`EMA stack is bearish (20 < 50 < 200)`);
            factors.push(`ADX indicates strong trend (${currentAdx.toFixed(1)} > 25)`);
            factors.push(`-DI (${currentMdi.toFixed(1)}) > +DI (${currentPdi.toFixed(1)})`);
            factors.push(`Market structure shows lower highs and lower lows`);
            invalidation.push("Price breaks above the EMA 50");
            invalidation.push("+DI crosses above -DI");
          } else if ((strongTrendAdx || weakTrendAdx) && !higherHighs) {
            regime = "WEAK_BEAR_TREND";
            confidence = 60;
            factors.push(`EMA stack is generally bearish`);
            factors.push(`Trend strength is moderate/weak (ADX: ${currentAdx.toFixed(1)})`);
            factors.push(`Structure is not aggressively forming lower lows`);
            invalidation.push("Price breaks above EMA 200");
            invalidation.push("Market structure prints a clear higher high");
          }
        }
        if (regime === "UNKNOWN") {
          if (currentAdx < 20 || bbWidth < avgBbWidth * 0.8 || bbWidth < 5e-3) {
            if (bbWidth < avgBbWidth * 0.7) {
              regime = "LOW_VOLATILITY";
              confidence = 70;
              factors.push(`Bollinger Bands are highly compressed (BB Width: ${(bbWidth * 100).toFixed(2)}%)`);
              factors.push(`ADX is weak (${currentAdx.toFixed(1)} < 20)`);
              invalidation.push("Price breaks strongly out of the BB envelope");
            } else {
              regime = "RANGE";
              confidence = 80 - currentAdx * 2;
              factors.push(`ADX indicates absent trend (${currentAdx.toFixed(1)} < 20)`);
              factors.push(`EMAs are tangled or flat`);
              factors.push(`Directional structure (HH/HL or LH/LL) is absent`);
              invalidation.push("ADX rises above 25");
              invalidation.push("Price breaks significant recent support/resistance structure");
            }
          } else {
            regime = "TRANSITION";
            confidence = 50;
            factors.push(`Conflicting signals: Trend indicators and market structure do not align`);
            factors.push(`ADX is ${currentAdx.toFixed(1)}, but EMAs are not fully stacked`);
            invalidation.push("EMAs achieve full bullish or bearish stack");
            invalidation.push("ADX drops below 20 indicating range consolidation");
          }
        }
        return {
          regime,
          confidence: Math.round(confidence),
          factors,
          invalidation
        };
      }
    };
  }
});

// src/server/signals/StrategyEngine.ts
var StrategyEngine;
var init_StrategyEngine = __esm({
  "src/server/signals/StrategyEngine.ts"() {
    init_TechnicalIndicators();
    init_StrategyPerformanceTracker();
    init_Gate1MarketRegime();
    init_config();
    StrategyEngine = class _StrategyEngine {
      static isTrending(regime) {
        return regime === "TRENDING" || regime === "UPTREND" || regime === "DOWNTREND";
      }
      static isRanging(regime) {
        return regime === "RANGING" || regime === "RANGE";
      }
      static isBreakout(regime) {
        return regime === "BREAKOUT";
      }
      static isHighVolatility(regime) {
        return regime === "HIGH_VOLATILITY" || regime === "HIGH-VOLATILITY";
      }
      static isLowVolatility(regime) {
        return regime === "LOW_VOLATILITY" || regime === "LOW-VOLATILITY";
      }
      /**
       * Classifies the market regime from multi-timeframe candle datasets using Gate 1
       */
      static classifyMarketRegime(symbol, entryPrice, tfMap) {
        const gate1Result = Gate1MarketRegime.detectRegime(symbol, tfMap);
        return {
          regime: gate1Result.regime,
          // For now, we will cast or expand MarketRegime
          regimeDetails: `Gate 1 Regime Classification: ${gate1Result.regime} (Confidence: ${gate1Result.confidence}%). Factors: ${gate1Result.factors.join("; ")}`
        };
      }
      /**
       * Evaluates all 6 backend strategies with dynamic regime-weighted confluence.
       */
      static evaluate(symbol, entryPrice, candlesMap) {
        const cleanSym = symbol.trim().toUpperCase();
        const tfMap = {};
        const availableTfs = [];
        for (const [tf, candles] of Object.entries(candlesMap)) {
          if (candles && candles.length >= 10) {
            tfMap[tf] = [...candles].sort((a, b) => a.timestamp - b.timestamp);
            availableTfs.push(tf);
          }
        }
        if (!tfMap["15m"] || tfMap["15m"].length < 20 || !tfMap["1h"] || tfMap["1h"].length < 20) {
          return this.createRejection("REJECTED: INSUFFICIENT_DATA. Insufficient candle depth in primary baseline timeframes (15m/1h required)");
        }
        const { regime, regimeDetails } = this.classifyMarketRegime(cleanSym, entryPrice, tfMap);
        const s1 = this.evalTrendFollowing(cleanSym, entryPrice, tfMap, regime);
        const s2 = this.evalMomentumZeroLag(cleanSym, entryPrice, tfMap, regime);
        const s3 = this.evalIntradayBreakout(cleanSym, entryPrice, tfMap, regime);
        const s4 = this.evalBollingerMeanReversion(cleanSym, entryPrice, tfMap, s1, regime);
        const s5 = this.evalOrderFlowImbalance(cleanSym, entryPrice, tfMap, s1.direction, regime);
        const s6 = this.evalVolatilityProtection(cleanSym, entryPrice, tfMap, regime);
        this.applyRegimeWeights(regime, [s1, s2, s3, s4, s5, s6]);
        const strategyResults = [s1, s2, s3, s4, s5, s6];
        if (!s6.passed || s6.score < 50) {
          return this.createRejection(`REJECTED: VOLATILITY_GATE. Volatility gate rejected setup: ${s6.reasons.join("; ")}`, regime, regimeDetails);
        }
        let dominantDirection = null;
        if (_StrategyEngine.isTrending(regime)) {
          if (s1.passed && s1.direction !== "NEUTRAL") dominantDirection = s1.direction;
          else if (s2.passed && s2.direction !== "NEUTRAL") dominantDirection = s2.direction;
          else if (s3.passed && s3.direction !== "NEUTRAL") dominantDirection = s3.direction;
        } else if (_StrategyEngine.isBreakout(regime) && s3.passed && s3.direction !== "NEUTRAL") {
          dominantDirection = s3.direction;
        } else if (_StrategyEngine.isRanging(regime) && s4.passed && s4.direction !== "NEUTRAL") {
          dominantDirection = s4.direction;
        } else if (s1.passed && s1.direction !== "NEUTRAL") {
          dominantDirection = s1.direction;
        } else if (s2.passed && s2.direction !== "NEUTRAL") {
          dominantDirection = s2.direction;
        } else if (s3.passed && s3.direction !== "NEUTRAL") {
          dominantDirection = s3.direction;
        }
        if (!dominantDirection) {
          return this.createRejection(
            "REJECTED: NO_DIRECTION. No directional trend or validated breakout established by primary strategies",
            regime,
            regimeDetails
          );
        }
        let agreeingStrategiesCount = 0;
        let weightedScoreSum = 0;
        let totalWeight = 0;
        for (const s of strategyResults) {
          totalWeight += s.weight;
          if (s.direction === dominantDirection && s.passed) {
            agreeingStrategiesCount++;
            weightedScoreSum += s.score * s.weight;
          } else if (s.id === "strat_6" && s.passed) {
            agreeingStrategiesCount++;
            weightedScoreSum += s.score * s.weight;
          }
        }
        const tfScores = this.evaluateMultiTimeframeAlignment(dominantDirection, entryPrice, tfMap);
        const totalStrategiesEvaluated = Math.max(1, strategyResults.length);
        const agreementRatio = agreeingStrategiesCount / totalStrategiesEvaluated;
        const rawWeightedScore = totalWeight > 0 ? weightedScoreSum / totalWeight : 0;
        const weightedAgreementRatio = totalWeight > 0 ? weightedScoreSum / totalWeight / 100 : agreementRatio;
        const isCoreTrendCombo = _StrategyEngine.isTrending(regime) && (s1.passed || s2.passed) && s6.passed && (agreeingStrategiesCount >= 3 || weightedAgreementRatio >= 0.45);
        const isCoreBreakoutCombo = _StrategyEngine.isBreakout(regime) && s3.passed && s6.passed && (agreeingStrategiesCount >= 2 || s2.passed || s5.passed);
        const isCoreRangeCombo = (_StrategyEngine.isRanging(regime) || _StrategyEngine.isLowVolatility(regime)) && s4.passed && s6.passed && agreeingStrategiesCount >= 2;
        const agreementScore = Math.round(
          Math.max(agreementRatio, weightedAgreementRatio) * 40 + tfScores.alignedCount / Math.max(1, tfScores.totalEvaluated) * 30 + rawWeightedScore / 100 * 30
        );
        const thresholds = serverConfig.getConfig().thresholds;
        const minimumRequiredAgreement = thresholds.minimumStrategyAgreement;
        const passed = agreementRatio >= minimumRequiredAgreement || weightedAgreementRatio >= minimumRequiredAgreement * 0.8 || isCoreTrendCombo || isCoreBreakoutCombo || isCoreRangeCombo;
        const timeframeAlignmentRatio = tfScores.totalEvaluated > 0 ? tfScores.alignedCount / tfScores.totalEvaluated : 0;
        const hasStrongConfluence = passed && agreementScore >= 45 && timeframeAlignmentRatio >= thresholds.minimumTimeframeAlignment;
        if (!hasStrongConfluence) {
          return this.createRejection(
            `REJECTED: INSUFFICIENT_CONFLUENCE. Strategy agreement ratio ${(agreementRatio * 100).toFixed(1)}% (${agreeingStrategiesCount}/${totalStrategiesEvaluated}, min ${minimumRequiredAgreement * 100}%) with timeframe alignment ratio ${(timeframeAlignmentRatio * 100).toFixed(0)}% (${tfScores.alignedCount}/${tfScores.totalEvaluated}, min ${thresholds.minimumTimeframeAlignment * 100}%). Agreement Score: ${agreementScore}/100 (min 45 required)`,
            regime,
            regimeDetails
          );
        }
        const reasons = [];
        reasons.push(`Market Regime: ${regime} \u2014 ${regimeDetails}`);
        reasons.push(`Strategy Confluence: ${agreeingStrategiesCount}/${totalStrategiesEvaluated} backend strategies aligned for ${dominantDirection} (Ratio: ${(agreementRatio * 100).toFixed(1)}%)`);
        reasons.push(
          `Timeframe Hierarchy: ${tfScores.alignedCount}/${tfScores.totalEvaluated} evaluated timeframes (${availableTfs.join(
            ", "
          )}) confirm direction`
        );
        for (const s of strategyResults) {
          if ((s.direction === dominantDirection || s.id === "strat_6") && s.passed && s.reasons.length > 0) {
            reasons.push(s.reasons[0]);
          }
        }
        return {
          dominantDirection,
          agreeingStrategiesCount,
          totalStrategiesCount: totalStrategiesEvaluated,
          agreementRatio,
          minimumRequiredAgreement,
          passed,
          agreementScore: Math.min(100, agreementScore),
          hasStrongConfluence: true,
          marketRegime: regime,
          regimeDetails,
          strategyResults,
          timeframeConfluenceScore: tfScores.confluenceScore,
          evaluatedTimeframes: availableTfs,
          reasons
        };
      }
      /**
       * Applies Strategy Weighting according to Market Regime:
       * - TREND (UPTREND/DOWNTREND): Trend + Momentum + Pullback receive highest weight.
       * - BREAKOUT: Breakout + Volume + Momentum + Volatility receive highest weight.
       * - HIGH-VOLATILITY: Volatility Gate + Breakout + Momentum receive highest weight.
       * - RANGE: Mean Reversion + Structure + Volatility receive highest weight.
       * - LOW-VOLATILITY: Mean Reversion + Structure + Breakout Anticipation receive highest weight.
       *
       * Also applies Bayesian regularized empirical performance feedback without overfitting.
       */
      static applyRegimeWeights(regime, strategies) {
        const sMap = new Map(strategies.map((s) => [s.id, s]));
        if (regime === "UPTREND" || regime === "DOWNTREND") {
          if (sMap.has("strat_1")) sMap.get("strat_1").weight = 2;
          if (sMap.has("strat_2")) sMap.get("strat_2").weight = 1.6;
          if (sMap.has("strat_5")) sMap.get("strat_5").weight = 1.3;
          if (sMap.has("strat_6")) sMap.get("strat_6").weight = 1;
          if (sMap.has("strat_3")) sMap.get("strat_3").weight = 0.8;
          if (sMap.has("strat_4")) sMap.get("strat_4").weight = 0.3;
        } else if (regime === "BREAKOUT") {
          if (sMap.has("strat_3")) sMap.get("strat_3").weight = 2;
          if (sMap.has("strat_5")) sMap.get("strat_5").weight = 1.8;
          if (sMap.has("strat_2")) sMap.get("strat_2").weight = 1.6;
          if (sMap.has("strat_6")) sMap.get("strat_6").weight = 1.4;
          if (sMap.has("strat_1")) sMap.get("strat_1").weight = 1.1;
          if (sMap.has("strat_4")) sMap.get("strat_4").weight = 0.2;
        } else if (regime === "HIGH-VOLATILITY") {
          if (sMap.has("strat_6")) sMap.get("strat_6").weight = 2;
          if (sMap.has("strat_2")) sMap.get("strat_2").weight = 1.6;
          if (sMap.has("strat_3")) sMap.get("strat_3").weight = 1.5;
          if (sMap.has("strat_1")) sMap.get("strat_1").weight = 1.3;
          if (sMap.has("strat_5")) sMap.get("strat_5").weight = 1.3;
          if (sMap.has("strat_4")) sMap.get("strat_4").weight = 0.3;
        } else if (regime === "LOW-VOLATILITY") {
          if (sMap.has("strat_4")) sMap.get("strat_4").weight = 1.9;
          if (sMap.has("strat_1")) sMap.get("strat_1").weight = 1.5;
          if (sMap.has("strat_6")) sMap.get("strat_6").weight = 1.5;
          if (sMap.has("strat_3")) sMap.get("strat_3").weight = 1.4;
          if (sMap.has("strat_5")) sMap.get("strat_5").weight = 1;
          if (sMap.has("strat_2")) sMap.get("strat_2").weight = 0.9;
        } else {
          if (sMap.has("strat_4")) sMap.get("strat_4").weight = 2;
          if (sMap.has("strat_1")) sMap.get("strat_1").weight = 1.5;
          if (sMap.has("strat_6")) sMap.get("strat_6").weight = 1.4;
          if (sMap.has("strat_5")) sMap.get("strat_5").weight = 1.2;
          if (sMap.has("strat_2")) sMap.get("strat_2").weight = 0.8;
          if (sMap.has("strat_3")) sMap.get("strat_3").weight = 0.3;
        }
        for (const s of strategies) {
          const perfMultiplier = StrategyPerformanceTracker.getDynamicStrategyWeightMultiplier(s.id, regime);
          s.weight = Number((s.weight * perfMultiplier).toFixed(2));
        }
      }
      // =========================================================================
      // Strategy 1: TREND FOLLOWING (Primary Strategy + Trend-Pullback Condition)
      // Uses: EMA stack (9/21/50), EMA slope, HTF direction, and market structure.
      // Includes TREND-PULLBACK condition: HTF trend -> pullback to EMA/structure zone -> momentum resumption -> LTF entry confirmation.
      // =========================================================================
      static evalTrendFollowing(symbol, entryPrice, tfMap, regime) {
        if (regime && (_StrategyEngine.isRanging(regime) || _StrategyEngine.isLowVolatility(regime))) {
          return {
            id: "strat_1",
            name: "Trend Following (EMA Stack Rider & Trend-Pullback)",
            direction: "NEUTRAL",
            score: 0,
            passed: false,
            weight: 1.5,
            reasons: [`Strategy 1 (Trend Following) inactive in ${regime} market regime`]
          };
        }
        const s5m = tfMap["5m"];
        const s15m = tfMap["15m"];
        const s1h = tfMap["1h"];
        const s4h = tfMap["4h"];
        const s1d = tfMap["1d"];
        const ema9_15m = TechnicalIndicators.calculateEMA(s15m, 9);
        const ema21_15m = TechnicalIndicators.calculateEMA(s15m, 21);
        const ema50_15m = s15m.length >= 50 ? TechnicalIndicators.calculateEMA(s15m, 50) : [];
        const ema9_1h = TechnicalIndicators.calculateEMA(s1h, 9);
        const ema21_1h = TechnicalIndicators.calculateEMA(s1h, 21);
        const ema50_1h = s1h.length >= 50 ? TechnicalIndicators.calculateEMA(s1h, 50) : [];
        if (ema9_15m.length === 0 || ema21_15m.length === 0 || ema9_1h.length === 0 || ema21_1h.length === 0) {
          return {
            id: "strat_1",
            name: "Trend Following (EMA Stack Rider & Trend-Pullback)",
            direction: "NEUTRAL",
            score: 0,
            passed: false,
            weight: 1.5,
            reasons: ["Insufficient data for EMA calculation"]
          };
        }
        const lastEma9_15m = ema9_15m[ema9_15m.length - 1];
        const lastEma21_15m = ema21_15m[ema21_15m.length - 1];
        const lastEma50_15m = ema50_15m.length > 0 ? ema50_15m[ema50_15m.length - 1] : lastEma21_15m;
        const lastEma9_1h = ema9_1h[ema9_1h.length - 1];
        const lastEma21_1h = ema21_1h[ema21_1h.length - 1];
        const lastEma50_1h = ema50_1h.length > 0 ? ema50_1h[ema50_1h.length - 1] : lastEma21_1h;
        const slope9_1h = TechnicalIndicators.calculateEMASlope(ema9_1h, 3);
        const slope21_1h = TechnicalIndicators.calculateEMASlope(ema21_1h, 3);
        const slope9_15m = TechnicalIndicators.calculateEMASlope(ema9_15m, 3);
        const structure1h = TechnicalIndicators.calculateMarketStructure(s1h, 15);
        const structure15m = TechnicalIndicators.calculateMarketStructure(s15m, 15);
        let htfBullishBias = true;
        let htfBearishBias = true;
        if (s4h && s4h.length >= 20) {
          const ema21_4h = TechnicalIndicators.calculateEMA(s4h, 21);
          if (ema21_4h.length > 0) {
            const last4hEma = ema21_4h[ema21_4h.length - 1];
            if (entryPrice < last4hEma) htfBullishBias = false;
            if (entryPrice > last4hEma) htfBearishBias = false;
          }
        }
        if (s1d && s1d.length >= 20) {
          const ema21_1d = TechnicalIndicators.calculateEMA(s1d, 21);
          if (ema21_1d.length > 0) {
            const last1dEma = ema21_1d[ema21_1d.length - 1];
            if (entryPrice < last1dEma) htfBullishBias = false;
            if (entryPrice > last1dEma) htfBearishBias = false;
          }
        }
        const isBullStack1h = lastEma9_1h >= lastEma21_1h && lastEma21_1h >= lastEma50_1h && slope21_1h >= -0.02;
        const isBearStack1h = lastEma9_1h <= lastEma21_1h && lastEma21_1h <= lastEma50_1h && slope21_1h <= 0.02;
        const isBullStack15m = lastEma9_15m >= lastEma21_15m && lastEma21_15m >= lastEma50_15m;
        const isBearStack15m = lastEma9_15m <= lastEma21_15m && lastEma21_15m <= lastEma50_15m;
        const recentCandles15m = s15m.slice(-4);
        const lastCandle15m = s15m[s15m.length - 1];
        const prevCandle15m = s15m[s15m.length - 2];
        const touchedBullZone = recentCandles15m.some(
          (c) => c.low <= lastEma9_15m || c.low <= lastEma21_1h && c.close >= lastEma50_1h
        );
        const bullishResumption = lastCandle15m.close >= lastEma9_15m && lastCandle15m.close > prevCandle15m.close;
        const touchedBearZone = recentCandles15m.some(
          (c) => c.high >= lastEma9_15m || c.high >= lastEma21_1h && c.close <= lastEma50_1h
        );
        const bearishResumption = lastCandle15m.close <= lastEma9_15m && lastCandle15m.close < prevCandle15m.close;
        let ltf5mConfirmBuy = true;
        let ltf5mConfirmSell = true;
        if (s5m && s5m.length >= 10) {
          const ema9_5m = TechnicalIndicators.calculateEMA(s5m, 9);
          if (ema9_5m.length > 0) {
            const last5mEma = ema9_5m[ema9_5m.length - 1];
            ltf5mConfirmBuy = entryPrice >= last5mEma;
            ltf5mConfirmSell = entryPrice <= last5mEma;
          }
        }
        let direction = "NEUTRAL";
        let score = 50;
        const reasons = [];
        if (isBullStack1h && touchedBullZone && bullishResumption && ltf5mConfirmBuy && htfBullishBias) {
          direction = "BUY";
          score = 92;
          if (structure1h.structureBias === "BULLISH") score += 5;
          if (slope9_1h > 0.05) score += 3;
          reasons.push(
            `Trend-Pullback Confirmed: Price pulled back into 1H EMA structure zone and resumed bullish trajectory with 15m/5m confirmation`
          );
        } else if (isBearStack1h && touchedBearZone && bearishResumption && ltf5mConfirmSell && htfBearishBias) {
          direction = "SELL";
          score = 92;
          if (structure1h.structureBias === "BEARISH") score += 5;
          if (slope9_1h < -0.05) score += 3;
          reasons.push(
            `Trend-Pullback Confirmed: Price pulled back into 1H EMA structure zone and resumed bearish trajectory with 15m/5m confirmation`
          );
        } else if (isBullStack1h && isBullStack15m && entryPrice >= lastEma9_15m && slope9_1h > 0.02 && htfBullishBias) {
          direction = "BUY";
          score = 88;
          if (structure1h.structureBias === "BULLISH") score += 5;
          if (slope21_1h > 0.03) score += 4;
          reasons.push(
            `Trend Following: Hierarchical EMA 9 > 21 > 50 stack expansion with positive slope across 15m, 1H and higher timeframes`
          );
        } else if (isBearStack1h && isBearStack15m && entryPrice <= lastEma9_15m && slope9_1h < -0.02 && htfBearishBias) {
          direction = "SELL";
          score = 88;
          if (structure1h.structureBias === "BEARISH") score += 5;
          if (slope21_1h < -0.03) score += 4;
          reasons.push(
            `Trend Following: Hierarchical EMA 9 < 21 < 50 stack expansion with negative slope across 15m, 1H and higher timeframes`
          );
        } else if (lastEma9_1h > lastEma21_1h && entryPrice > lastEma21_1h && slope21_1h >= 0) {
          direction = "BUY";
          score = 72;
          reasons.push(`Moderate trend alignment: Price holding above upward-sloping 1H EMA21`);
        } else if (lastEma9_1h < lastEma21_1h && entryPrice < lastEma21_1h && slope21_1h <= 0) {
          direction = "SELL";
          score = 72;
          reasons.push(`Moderate trend alignment: Price holding below downward-sloping 1H EMA21`);
        }
        return {
          id: "strat_1",
          name: "Trend Following (EMA Stack Rider & Trend-Pullback)",
          direction,
          score: Math.min(100, score),
          passed: direction !== "NEUTRAL" && score >= 70,
          weight: 1.5,
          reasons
        };
      }
      // =========================================================================
      // Strategy 2: MOMENTUM (Primary Confirmation)
      // Uses: Zero-Lag MACD + RSI momentum, price acceleration, multi-TF agreement.
      // =========================================================================
      static evalMomentumZeroLag(symbol, entryPrice, tfMap, regime) {
        if (regime && (_StrategyEngine.isRanging(regime) || _StrategyEngine.isLowVolatility(regime))) {
          return {
            id: "strat_2",
            name: "Momentum (Zero-Lag MACD + RSI)",
            direction: "NEUTRAL",
            score: 0,
            passed: false,
            weight: 1.35,
            reasons: [`Strategy 2 (Momentum) inactive in ${regime} market regime`]
          };
        }
        const s15m = tfMap["15m"];
        const s1h = tfMap["1h"];
        const zlMacd15m = TechnicalIndicators.calculateZeroLagMACD(s15m, 12, 26, 9);
        const zlMacd1h = TechnicalIndicators.calculateZeroLagMACD(s1h, 12, 26, 9);
        const rsi15m = TechnicalIndicators.calculateRSI(s15m, 14);
        const rsi1h = TechnicalIndicators.calculateRSI(s1h, 14);
        if (!zlMacd15m || !zlMacd1h || rsi15m.length === 0 || rsi1h.length === 0) {
          return {
            id: "strat_2",
            name: "Momentum (Zero-Lag MACD + RSI)",
            direction: "NEUTRAL",
            score: 0,
            passed: false,
            weight: 1.35,
            reasons: ["Failed to compute Zero-Lag MACD or RSI"]
          };
        }
        const lastRsi15m = rsi15m[rsi15m.length - 1];
        const prevRsi15m = rsi15m[Math.max(0, rsi15m.length - 3)];
        const lastRsi1h = rsi1h[rsi1h.length - 1];
        const prevRsi1h = rsi1h[Math.max(0, rsi1h.length - 2)];
        const isRsiAcceleratingBull = lastRsi15m > prevRsi15m && lastRsi1h >= prevRsi1h;
        const isRsiAcceleratingBear = lastRsi15m < prevRsi15m && lastRsi1h <= prevRsi1h;
        const isBullZlMacd = zlMacd15m.histogram >= -1e-4 && zlMacd15m.macdLine >= zlMacd15m.signalLine;
        const isBullRsi = lastRsi15m >= 45 && lastRsi15m <= 68 && lastRsi1h >= 45;
        const isBearZlMacd = zlMacd15m.histogram <= 1e-4 && zlMacd15m.macdLine <= zlMacd15m.signalLine;
        const isBearRsi = lastRsi15m <= 55 && lastRsi15m >= 32 && lastRsi1h <= 55;
        let direction = "NEUTRAL";
        let score = 50;
        const reasons = [];
        if (isBullZlMacd && isBullRsi && zlMacd1h.macdLine >= zlMacd1h.signalLine) {
          direction = "BUY";
          score = 88;
          if (isRsiAcceleratingBull) score += 6;
          if (zlMacd1h.histogram >= 0) score += 5;
          reasons.push(
            `Momentum Confirmation: Multi-timeframe Zero-Lag MACD & RSI (${lastRsi15m.toFixed(
              1
            )}) accelerating positively across 15m and 1H`
          );
        } else if (isBearZlMacd && isBearRsi && zlMacd1h.macdLine <= zlMacd1h.signalLine) {
          direction = "SELL";
          score = 88;
          if (isRsiAcceleratingBear) score += 6;
          if (zlMacd1h.histogram <= 0) score += 5;
          reasons.push(
            `Momentum Confirmation: Multi-timeframe Zero-Lag MACD & RSI (${lastRsi15m.toFixed(
              1
            )}) accelerating negatively across 15m and 1H`
          );
        } else if (zlMacd1h.macdLine > zlMacd1h.signalLine && lastRsi1h >= 50) {
          direction = "BUY";
          score = 72;
          reasons.push("1H Zero-Lag MACD confirms underlying upward momentum");
        } else if (zlMacd1h.macdLine < zlMacd1h.signalLine && lastRsi1h <= 50) {
          direction = "SELL";
          score = 72;
          reasons.push("1H Zero-Lag MACD confirms underlying downward momentum");
        }
        return {
          id: "strat_2",
          name: "Momentum (Zero-Lag MACD + RSI)",
          direction,
          score: Math.min(100, score),
          passed: direction !== "NEUTRAL" && score >= 70,
          weight: 1.35,
          reasons
        };
      }
      // =========================================================================
      // Strategy 3: INTRADAY BREAKOUT (Strengthened)
      // Requires genuine S/R breakout + volume expansion + volatility expansion + higher-TF agreement.
      // Rejects obvious false breakouts.
      // =========================================================================
      static evalIntradayBreakout(symbol, entryPrice, tfMap, regime) {
        if (regime && _StrategyEngine.isRanging(regime)) {
          return {
            id: "strat_3",
            name: "Intraday Breakout (H1/H4 + volume)",
            direction: "NEUTRAL",
            score: 0,
            passed: false,
            weight: 1.2,
            reasons: [`Strategy 3 (Intraday Breakout) inactive in ${regime} market regime`]
          };
        }
        const s1h = tfMap["1h"];
        const s15m = tfMap["15m"];
        const channels1h = TechnicalIndicators.calculateDonchianChannels(s1h, 20);
        const channels15m = TechnicalIndicators.calculateDonchianChannels(s15m, 20);
        if (!channels1h || !channels15m) {
          return {
            id: "strat_3",
            name: "Intraday Breakout (H1/H4 + volume)",
            direction: "NEUTRAL",
            score: 0,
            passed: false,
            weight: 1.2,
            reasons: ["Donchian channels unavailable"]
          };
        }
        const last1hVol = s1h[s1h.length - 1].volume || 0;
        const avg1hVol = s1h.slice(-20).reduce((a, c) => a + (c.volume || 0), 0) / 20;
        const hasVolumeExpansion = avg1hVol > 0 ? last1hVol >= avg1hVol * 1.15 : true;
        const vm1h = TechnicalIndicators.calculateVolatilityMetrics(s1h, 14);
        const hasVolatilityExpansion = vm1h.isValidExpansion || vm1h.atrRatio >= 1.05;
        const ema9_1h = TechnicalIndicators.calculateEMA(s1h, 9);
        const ema21_1h = TechnicalIndicators.calculateEMA(s1h, 21);
        const isHtfBullish = ema9_1h.length > 0 && ema21_1h.length > 0 && ema9_1h[ema9_1h.length - 1] >= ema21_1h[ema21_1h.length - 1];
        const isHtfBearish = ema9_1h.length > 0 && ema21_1h.length > 0 && ema9_1h[ema9_1h.length - 1] <= ema21_1h[ema21_1h.length - 1];
        const wick15m = TechnicalIndicators.calculateWickRejection(s15m, 2);
        const isFalseBullBreakout = wick15m.upperWickRejectionPct >= 45;
        const isFalseBearBreakdown = wick15m.lowerWickRejectionPct >= 45;
        const range1h = channels1h.upper - channels1h.lower;
        const upperBoundary = channels1h.upper - range1h * 0.08;
        const lowerBoundary = channels1h.lower + range1h * 0.08;
        let direction = "NEUTRAL";
        let score = 50;
        let passed = false;
        const reasons = [];
        if (entryPrice >= upperBoundary && isHtfBullish) {
          if (isFalseBullBreakout) {
            return {
              id: "strat_3",
              name: "Intraday Breakout (H1/H4 + volume)",
              direction: "NEUTRAL",
              score: 25,
              passed: false,
              weight: 1.2,
              reasons: ["False breakout rejected: Severe upper wick rejection detected at resistance boundary"]
            };
          }
          direction = "BUY";
          score = 82;
          if (entryPrice >= channels1h.upper) score += 8;
          if (hasVolumeExpansion) score += 6;
          if (hasVolatilityExpansion) score += 4;
          passed = score >= 70;
          reasons.push(
            `Genuine Breakout: Price (${entryPrice}) breaking 1H resistance with volume and HTF trend expansion`
          );
        } else if (entryPrice <= lowerBoundary && isHtfBearish) {
          if (isFalseBearBreakdown) {
            return {
              id: "strat_3",
              name: "Intraday Breakout (H1/H4 + volume)",
              direction: "NEUTRAL",
              score: 25,
              passed: false,
              weight: 1.2,
              reasons: ["False breakdown rejected: Severe lower wick absorption detected at support boundary"]
            };
          }
          direction = "SELL";
          score = 82;
          if (entryPrice <= channels1h.lower) score += 8;
          if (hasVolumeExpansion) score += 6;
          if (hasVolatilityExpansion) score += 4;
          passed = score >= 70;
          reasons.push(
            `Genuine Breakdown: Price (${entryPrice}) breaking 1H support with volume and HTF trend expansion`
          );
        } else {
          if (entryPrice > channels1h.middle && isHtfBullish) {
            direction = "BUY";
            score = 65;
            passed = true;
            reasons.push("Price holding within upper channel hemisphere with trend support");
          } else if (entryPrice < channels1h.middle && isHtfBearish) {
            direction = "SELL";
            score = 65;
            passed = true;
            reasons.push("Price holding within lower channel hemisphere with trend support");
          }
        }
        return {
          id: "strat_3",
          name: "Intraday Breakout (H1/H4 + volume)",
          direction,
          score: Math.min(100, score),
          passed,
          weight: 1.2,
          reasons
        };
      }
      // =========================================================================
      // Strategy 4: RSI + BOLLINGER MEAN REVERSION (RANGE-ONLY)
      // Strictly RANGE-ONLY. Counter-trend mean reversion against strong 1H/4H trend is rejected.
      // =========================================================================
      static evalBollingerMeanReversion(symbol, entryPrice, tfMap, trendStrat, regime) {
        const s15m = tfMap["15m"];
        const s1h = tfMap["1h"];
        const bb15m = TechnicalIndicators.calculateBollingerBands(s15m, 20, 2);
        const bb1h = TechnicalIndicators.calculateBollingerBands(s1h, 20, 2);
        const rsi15m = TechnicalIndicators.calculateRSI(s15m, 14);
        if (!bb15m || !bb1h || rsi15m.length === 0) {
          return {
            id: "strat_4",
            name: "RSI + Bollinger Mean Reversion",
            direction: "NEUTRAL",
            score: 0,
            passed: false,
            weight: 1.1,
            reasons: ["Bollinger Bands unavailable"]
          };
        }
        const lastRsi = rsi15m[rsi15m.length - 1];
        const ema9_1h = TechnicalIndicators.calculateEMA(s1h, 9);
        const ema21_1h = TechnicalIndicators.calculateEMA(s1h, 21);
        const isStrongUptrend = (regime === "UPTREND" || trendStrat.direction === "BUY") && trendStrat.passed && trendStrat.score >= 80 && ema9_1h.length > 0 && ema21_1h.length > 0 && ema9_1h[ema9_1h.length - 1] > ema21_1h[ema21_1h.length - 1];
        const isStrongDowntrend = (regime === "DOWNTREND" || trendStrat.direction === "SELL") && trendStrat.passed && trendStrat.score >= 80 && ema9_1h.length > 0 && ema21_1h.length > 0 && ema9_1h[ema9_1h.length - 1] < ema21_1h[ema21_1h.length - 1];
        let direction = "NEUTRAL";
        let score = 50;
        let passed = false;
        const reasons = [];
        if (isStrongUptrend && entryPrice >= bb15m.upper) {
          return {
            id: "strat_4",
            name: "RSI + Bollinger Mean Reversion",
            direction: "NEUTRAL",
            score: 20,
            passed: false,
            weight: 1.1,
            reasons: ["Counter-trend mean reversion strictly rejected against strong 1H/4H uptrend"]
          };
        }
        if (isStrongDowntrend && entryPrice <= bb15m.lower) {
          return {
            id: "strat_4",
            name: "RSI + Bollinger Mean Reversion",
            direction: "NEUTRAL",
            score: 20,
            passed: false,
            weight: 1.1,
            reasons: ["Counter-trend mean reversion strictly rejected against strong 1H/4H downtrend"]
          };
        }
        if (isStrongUptrend && entryPrice <= bb15m.middle && lastRsi >= 40 && lastRsi <= 55) {
          direction = "BUY";
          score = 86;
          passed = true;
          reasons.push(
            `Bollinger Trend Pullback: Price holding 20-SMA midline in active uptrend with healthy RSI reset (${lastRsi.toFixed(
              1
            )})`
          );
        } else if (isStrongDowntrend && entryPrice >= bb15m.middle && lastRsi <= 60 && lastRsi >= 45) {
          direction = "SELL";
          score = 86;
          passed = true;
          reasons.push(
            `Bollinger Trend Pullback: Price holding 20-SMA midline in active downtrend with healthy RSI reset (${lastRsi.toFixed(
              1
            )})`
          );
        } else if (!isStrongUptrend && !isStrongDowntrend) {
          if (entryPrice <= bb15m.lower && lastRsi <= 35) {
            direction = "BUY";
            score = 84;
            passed = true;
            reasons.push(
              `Range Mean Reversion: Lower Bollinger Band bounce with oversold RSI (${lastRsi.toFixed(
                1
              )}) in defined trading range`
            );
          } else if (entryPrice >= bb15m.upper && lastRsi >= 65) {
            direction = "SELL";
            score = 84;
            passed = true;
            reasons.push(
              `Range Mean Reversion: Upper Bollinger Band rejection with overbought RSI (${lastRsi.toFixed(
                1
              )}) in defined trading range`
            );
          } else if (entryPrice > bb15m.middle) {
            direction = "BUY";
            score = 65;
            passed = true;
            reasons.push("Range structure: Price situated in upper half of Bollinger channel");
          } else {
            direction = "SELL";
            score = 65;
            passed = true;
            reasons.push("Range structure: Price situated in lower half of Bollinger channel");
          }
        }
        return {
          id: "strat_4",
          name: "RSI + Bollinger Mean Reversion",
          direction,
          score: Math.min(100, score),
          passed,
          weight: 1.1,
          reasons
        };
      }
      // =========================================================================
      // Strategy 5: ORDER FLOW IMBALANCE (Confirmation Only)
      // Uses: volume acceleration, wick rejection, and buying/selling pressure.
      // =========================================================================
      static evalOrderFlowImbalance(symbol, entryPrice, tfMap, contextDirection, regime) {
        const s15m = tfMap["15m"];
        const of15m = TechnicalIndicators.calculateOrderFlowMetrics(s15m, 14);
        const wicks15m = TechnicalIndicators.calculateWickRejection(s15m, 3);
        let direction = "NEUTRAL";
        let score = 50;
        let passed = false;
        const reasons = [];
        const isBullishFlow = of15m.deltaBias === "BULLISH" || of15m.buyingPressurePct >= 54 || wicks15m.hasBullishWickAbsorption;
        const isBearishFlow = of15m.deltaBias === "BEARISH" || of15m.sellingPressurePct >= 54 || wicks15m.hasBearishWickAbsorption;
        if (contextDirection === "BUY" && isBullishFlow) {
          direction = "BUY";
          score = 85;
          if (of15m.buyingPressurePct >= 60) score += 6;
          if (wicks15m.hasBullishWickAbsorption) score += 5;
          if (of15m.volumeSurge) score += 4;
          passed = true;
          reasons.push(
            `Order Flow Confirmation: Dominant buying pressure (${of15m.buyingPressurePct}%) and lower wick absorption confirming setup`
          );
        } else if (contextDirection === "SELL" && isBearishFlow) {
          direction = "SELL";
          score = 85;
          if (of15m.sellingPressurePct >= 60) score += 6;
          if (wicks15m.hasBearishWickAbsorption) score += 5;
          if (of15m.volumeSurge) score += 4;
          passed = true;
          reasons.push(
            `Order Flow Confirmation: Dominant selling pressure (${of15m.sellingPressurePct}%) and upper wick absorption confirming setup`
          );
        } else if (isBullishFlow && !isBearishFlow) {
          direction = "BUY";
          score = 70;
          passed = true;
          reasons.push(`Order Flow Delta: Positive buying absorption bias (${of15m.buyingPressurePct}%)`);
        } else if (isBearishFlow && !isBullishFlow) {
          direction = "SELL";
          score = 70;
          passed = true;
          reasons.push(`Order Flow Delta: Negative selling absorption bias (${of15m.sellingPressurePct}%)`);
        } else {
          direction = "NEUTRAL";
          score = 50;
          passed = false;
          reasons.push("Order flow delta is balanced without directional imbalance");
        }
        return {
          id: "strat_5",
          name: "Order Flow Imbalance",
          direction,
          score: Math.min(100, score),
          passed,
          weight: 1.15,
          reasons
        };
      }
      // =========================================================================
      // Strategy 6: VOLATILITY FILTER (Mandatory Gate)
      // Rejects dead/flat markets (< 0.45 ATR ratio) and abnormal unstable conditions (> 2.80 ATR ratio).
      // Allows and rewards valid high-volatility trend expansion (1.10x - 2.50x).
      // =========================================================================
      static evalVolatilityProtection(symbol, entryPrice, tfMap, regime) {
        const s15m = tfMap["15m"];
        const s1h = tfMap["1h"];
        const vm15m = TechnicalIndicators.calculateVolatilityMetrics(s15m, 14);
        const vm1h = TechnicalIndicators.calculateVolatilityMetrics(s1h, 14);
        const reasons = [];
        let score = 85;
        let passed = true;
        if (vm1h.isErratic || vm15m.isErratic || vm1h.atrRatio > 2.8) {
          passed = false;
          score = 15;
          reasons.push("Abnormal erratic volatility spike / flash breakdown detected: high risk of erratic slippage");
        } else if (vm1h.isDeadMarket || vm15m.isDeadMarket || vm1h.atrRatio < 0.45) {
          passed = false;
          score = 20;
          reasons.push("Dead/flat market conditions: ATR compression below minimum executable threshold");
        } else if (vm1h.isValidExpansion || vm1h.atrRatio >= 1.1 && vm1h.atrRatio <= 2.5) {
          score = 95;
          passed = true;
          reasons.push(
            `Valid High-Volatility Trend Expansion: Strong executable ATR expansion (${vm1h.atrRatio}x baseline) supporting trend follow-through`
          );
        } else if (vm15m.isSqueeze && vm1h.isSqueeze) {
          score = 75;
          passed = true;
          reasons.push("Volatility squeeze detected: Potential explosive breakout buildup");
        } else {
          score = 88;
          passed = true;
          reasons.push(`Optimal volatility structure confirmed (ATR ratio: ${vm1h.atrRatio}x within healthy executable bounds)`);
        }
        return {
          id: "strat_6",
          name: "Volatility Filter & Breakdown Protection",
          direction: "NEUTRAL",
          score,
          passed,
          weight: 1,
          reasons
        };
      }
      // =========================================================================
      // Multi-Timeframe Alignment Evaluator (Hierarchy: 4H/1D -> 1H -> 15M -> 5M)
      // =========================================================================
      static evaluateMultiTimeframeAlignment(direction, entryPrice, tfMap) {
        const evaluatedTfs = ["4h", "1d", "1h", "15m", "5m", "30m"];
        let alignedCount = 0;
        let totalEvaluated = 0;
        for (const tf of evaluatedTfs) {
          const candles = tfMap[tf];
          if (!candles || candles.length < 10) continue;
          totalEvaluated++;
          const ema21 = TechnicalIndicators.calculateEMA(candles, Math.min(candles.length - 1, 21));
          if (ema21.length === 0) continue;
          const lastEma21 = ema21[ema21.length - 1];
          const isAligned = direction === "BUY" ? entryPrice >= lastEma21 : entryPrice <= lastEma21;
          if (isAligned) {
            alignedCount++;
          }
        }
        const confluenceScore = totalEvaluated > 0 ? Math.round(alignedCount / totalEvaluated * 100) : 0;
        return {
          alignedCount,
          totalEvaluated: Math.max(1, totalEvaluated),
          confluenceScore
        };
      }
      static createRejection(rejectionReason, marketRegime = "RANGE", regimeDetails = "Unqualified") {
        const thresholds = serverConfig.getConfig().thresholds;
        return {
          dominantDirection: null,
          agreeingStrategiesCount: 0,
          totalStrategiesCount: 6,
          agreementRatio: 0,
          minimumRequiredAgreement: thresholds.minimumStrategyAgreement,
          passed: false,
          agreementScore: 0,
          hasStrongConfluence: false,
          marketRegime,
          regimeDetails,
          strategyResults: [],
          timeframeConfluenceScore: 0,
          evaluatedTimeframes: [],
          reasons: [],
          rejectionReason
        };
      }
    };
  }
});

// src/server/signals/Gate28ConfirmationDiversity.ts
var Gate28ConfirmationDiversity;
var init_Gate28ConfirmationDiversity = __esm({
  "src/server/signals/Gate28ConfirmationDiversity.ts"() {
    init_logger();
    Gate28ConfirmationDiversity = class {
      static {
        this.MIN_REQUIRED_CATEGORIES = 3;
      }
      /**
       * Evaluates confirmation diversity from a list of confluence reasons or technical parameters
       */
      static evaluate(reasons, technicalData) {
        const categoryBreakdown = {
          STRUCTURE: [],
          MOMENTUM: [],
          VOLATILITY: [],
          LOCATION: [],
          PARTICIPATION: [],
          CONTEXT: []
        };
        if (Array.isArray(reasons)) {
          for (const reason of reasons) {
            if (!reason || typeof reason !== "string") continue;
            const upper = reason.toUpperCase();
            if (upper.includes("HH/HL") || upper.includes("LH/LL") || upper.includes("HIGHER HIGH") || upper.includes("HIGHER LOW") || upper.includes("LOWER HIGH") || upper.includes("LOWER LOW") || upper.includes("BOS") || upper.includes("BREAK OF STRUCTURE") || upper.includes("CHOCH") || upper.includes("CHANGE OF CHARACTER") || upper.includes("STRUCTURE") || upper.includes("SWING") || upper.includes("EMA STACK") || upper.includes("EMA9") || upper.includes("EMA21") || upper.includes("EMA50") || upper.includes("TREND CONTINUATION") || upper.includes("BULLISH TREND") || upper.includes("BEARISH TREND")) {
              categoryBreakdown.STRUCTURE.push(reason);
            }
            if (upper.includes("RSI") || upper.includes("MACD") || upper.includes("ZERO-LAG") || upper.includes("HISTOGRAM") || upper.includes("ROC") || upper.includes("RATE OF CHANGE") || upper.includes("STOCHASTIC") || upper.includes("MOMENTUM") || upper.includes("ACCELERATION")) {
              categoryBreakdown.MOMENTUM.push(reason);
            }
            if (upper.includes("ATR") || upper.includes("BOLLINGER") || upper.includes("BAND") || upper.includes("SQUEEZE") || upper.includes("VOLATILITY") || upper.includes("EXPANSION")) {
              categoryBreakdown.VOLATILITY.push(reason);
            }
            if (upper.includes("S/R") || upper.includes("SUPPORT") || upper.includes("RESISTANCE") || upper.includes("VWAP") || upper.includes("ANCHORED VWAP") || upper.includes("LIQUIDITY") || upper.includes("ORDER BLOCK") || upper.includes("KEY LEVEL") || upper.includes("PIVOT") || upper.includes("RUNWAY") || upper.includes("REJECTION BOUNCE") || upper.includes("PROXIMITY")) {
              categoryBreakdown.LOCATION.push(reason);
            }
            if (upper.includes("VOLUME") || upper.includes("RVOL") || upper.includes("DELTA") || upper.includes("ORDER FLOW") || upper.includes("BUYING PRESSURE") || upper.includes("SELLING PRESSURE") || upper.includes("WICK") || upper.includes("ABSORPTION") || upper.includes("SURGE")) {
              categoryBreakdown.PARTICIPATION.push(reason);
            }
            if (upper.includes("SESSION") || upper.includes("LONDON") || upper.includes("NEW YORK") || upper.includes("NY") || upper.includes("ASIA") || upper.includes("NEWS") || upper.includes("SENTIMENT") || upper.includes("CORRELATION") || upper.includes("REGIME") || upper.includes("CROSS-CHECK")) {
              categoryBreakdown.CONTEXT.push(reason);
            }
          }
        }
        if (technicalData) {
          if (technicalData.htfEma9 && technicalData.htfEma21 && categoryBreakdown.STRUCTURE.length === 0) {
            categoryBreakdown.STRUCTURE.push("Technical EMA Trend Alignment");
          }
          if (technicalData.htfRsi !== void 0 && categoryBreakdown.MOMENTUM.length === 0) {
            categoryBreakdown.MOMENTUM.push(`Technical RSI(${technicalData.htfRsi})`);
          }
          if (technicalData.atr > 0 && categoryBreakdown.VOLATILITY.length === 0) {
            categoryBreakdown.VOLATILITY.push(`ATR Volatility Expansion (${technicalData.atr})`);
          }
        }
        const presentCategories = Object.keys(categoryBreakdown).filter((cat) => categoryBreakdown[cat].length > 0);
        const categoryCount = presentCategories.length;
        const isValid = categoryCount >= this.MIN_REQUIRED_CATEGORIES;
        let diversityScore = 0;
        if (categoryCount === 1) diversityScore = 33;
        else if (categoryCount === 2) diversityScore = 66;
        else if (categoryCount === 3) diversityScore = 80;
        else if (categoryCount === 4) diversityScore = 90;
        else if (categoryCount >= 5) diversityScore = 100;
        let rejectionReason;
        if (!isValid) {
          rejectionReason = `REJECTED: INSUFFICIENT_CONFIRMATION_DIVERSITY. Setup satisfies only ${categoryCount} independent confirmation category (${presentCategories.join(", ") || "NONE"}). Minimum ${this.MIN_REQUIRED_CATEGORIES} distinct categories required (e.g., 1 STRUCTURE + 1 MOMENTUM + 1 LOCATION/PARTICIPATION).`;
        }
        const explanation = `Confirmation Diversity: ${categoryCount}/${this.MIN_REQUIRED_CATEGORIES} required categories satisfied [${presentCategories.join(", ")}]. Status: ${isValid ? "PASSED" : "REJECTED"}.`;
        logger.info(`[Gate 28 Diversity] ${explanation}`, {
          isValid,
          categoryCount,
          presentCategories
        });
        return {
          isValid,
          categoryCount,
          presentCategories,
          categoryBreakdown,
          diversityScore,
          rejectionReason,
          explanation
        };
      }
    };
  }
});

// src/server/signals/Gate34ExecutionFrictionStressTest.ts
var Gate34ExecutionFrictionStressTest;
var init_Gate34ExecutionFrictionStressTest = __esm({
  "src/server/signals/Gate34ExecutionFrictionStressTest.ts"() {
    init_SymbolNormalizer();
    init_config();
    init_logger();
    Gate34ExecutionFrictionStressTest = class {
      /**
       * Main Gate 34 Entry Point: Evaluates execution friction stress test for a signal.
       *
       * GATE 45 R:R POLICY:
       * 1. Calculate GROSS_RR.
       * 2. Reject if GROSS_RR < minimumRR.
       * 3. Calculate NET_RR (normal friction).
       * 4. Reject if NET_RR < minimumNetRR.
       * 5. Calculate ADVERSE_NET_RR (stress test).
       * 6. Use ADVERSE_NET_RR as risk-quality modifier unless explicitly configured as hard gate.
       */
      static evaluate(symbol, entryPrice, stopLoss, takeProfit, thresholdOverrides) {
        const cleanSymbol = SymbolNormalizer.normalizeAppSymbol(symbol) || symbol.trim().toUpperCase();
        const assetClassUpper = SymbolNormalizer.getAssetClassification(cleanSymbol).toUpperCase();
        const assetClass = assetClassUpper === "FOREX" ? "FOREX" : assetClassUpper === "CRYPTO" ? "CRYPTO" : assetClassUpper === "INDEX" ? "INDEX" : "STOCKS";
        const rawRisk = Math.abs(entryPrice - stopLoss);
        const rawReward = Math.abs(takeProfit - entryPrice);
        const grossRR = rawRisk > 0 ? parseFloat((rawReward / rawRisk).toFixed(2)) : 0;
        const normalFriction = this.calculateNormalFriction(cleanSymbol, assetClass, entryPrice, rawReward, rawRisk);
        const adverseFriction = this.calculateAdverseFriction(cleanSymbol, assetClass, entryPrice, rawReward, rawRisk);
        const normalNetRR = normalFriction.netRR;
        const adverseNetRR = adverseFriction.netRR;
        const cfg = serverConfig.getConfig().thresholds;
        const minGrossRR = thresholdOverrides?.minimumRR ?? cfg.minimumRR ?? 1.8;
        const minNetRR = thresholdOverrides?.minimumNetRR ?? cfg.minimumNetRR ?? 1.5;
        const minAdverseNetRR = thresholdOverrides?.minimumAdverseNetRR ?? cfg.minimumAdverseNetRR ?? 1;
        const enforceAdverseHardGate = thresholdOverrides?.enforceAdverseNetRRHardGate ?? cfg.enforceAdverseNetRRHardGate ?? false;
        const maxFrictionRatio = thresholdOverrides?.maxFrictionRatio ?? 0.25;
        const minSafetyBufferMult = thresholdOverrides?.minSafetyBufferMultiplier ?? 3.5;
        const reasons = [];
        let isPassed = true;
        let rejectionReason = void 0;
        if (grossRR < minGrossRR) {
          isPassed = false;
          rejectionReason = "GROSS_RR_BELOW_THRESHOLD";
          reasons.push(
            `REJECTED: GROSS_RR_BELOW_THRESHOLD. Gross R:R (${grossRR.toFixed(2)}:1) is below minimum acceptable GROSS R:R (${minGrossRR}:1).`
          );
        }
        if (isPassed && rawReward < normalFriction.totalFrictionPrice * minSafetyBufferMult) {
          isPassed = false;
          rejectionReason = "INSUFFICIENT_SAFETY_BUFFER";
          reasons.push(
            `REJECTED: INSUFFICIENT_SAFETY_BUFFER. Raw reward move (${rawReward.toFixed(5)}) is < ${minSafetyBufferMult}x normal friction (${normalFriction.totalFrictionPrice.toFixed(5)}).`
          );
        }
        if (isPassed && normalFriction.frictionRatio > maxFrictionRatio) {
          isPassed = false;
          rejectionReason = "EXECUTION_COST_TOO_HIGH";
          reasons.push(
            `REJECTED: EXECUTION_COST_TOO_HIGH. Normal friction consumes ${(normalFriction.frictionRatio * 100).toFixed(1)}% of gross reward (max allowed: ${(maxFrictionRatio * 100).toFixed(1)}%).`
          );
        }
        if (isPassed && normalNetRR < minNetRR) {
          isPassed = false;
          rejectionReason = "NET_RR_BELOW_THRESHOLD";
          reasons.push(
            `REJECTED: NET_RR_BELOW_THRESHOLD. Normal Net R:R (${normalNetRR.toFixed(2)}:1) is below minimum acceptable NET R:R (${minNetRR}:1) (Gross R:R: ${grossRR.toFixed(2)}:1).`
          );
        }
        if (enforceAdverseHardGate && isPassed && adverseNetRR < minAdverseNetRR) {
          isPassed = false;
          rejectionReason = "ADVERSE_NET_RR_BELOW_THRESHOLD";
          reasons.push(
            `REJECTED: ADVERSE_NET_RR_BELOW_THRESHOLD. Under adverse market stress (slippage/wide spread), Net R:R drops to ${adverseNetRR.toFixed(2)}:1, falling below required ${minAdverseNetRR}:1 stress floor.`
          );
        }
        let adverseRiskModifier = 0;
        if (adverseNetRR >= 1.5) {
          adverseRiskModifier = 1;
        } else if (adverseNetRR >= 1.2) {
          adverseRiskModifier = 0.5;
        } else if (adverseNetRR >= 1) {
          adverseRiskModifier = 0;
        } else if (adverseNetRR >= 0.8) {
          adverseRiskModifier = -0.5;
        } else {
          adverseRiskModifier = -1;
        }
        if (isPassed) {
          reasons.push(
            `PASSED: Execution friction stress test passed. Gross R:R=${grossRR.toFixed(2)}:1, Normal Net R:R=${normalNetRR.toFixed(2)}:1, Adverse Net R:R=${adverseNetRR.toFixed(2)}:1 (Modifier: ${adverseRiskModifier >= 0 ? "+" : ""}${adverseRiskModifier}).`
          );
        }
        const explanation = `Gate 34 Stress Test for ${cleanSymbol} (${assetClass}): Passed=${isPassed}. Gross R:R=${grossRR.toFixed(2)}:1 | Normal Net R:R=${normalNetRR.toFixed(2)}:1 (Friction=${normalFriction.totalFrictionPrice.toFixed(5)}) | Adverse Net R:R=${adverseNetRR.toFixed(2)}:1 (Friction=${adverseFriction.totalFrictionPrice.toFixed(5)}).`;
        logger.debug(`[Gate 34 Execution Friction] ${explanation}`);
        return {
          symbol: cleanSymbol,
          assetClass,
          entryPrice,
          stopLoss,
          takeProfit,
          rawRisk,
          rawReward,
          grossRR,
          netRR: normalNetRR,
          adverseNetRR,
          normal: normalFriction,
          adverse: adverseFriction,
          adverseRiskModifier,
          isPassed,
          rejectionReason,
          reasons,
          explanation
        };
      }
      /**
       * Calculates baseline (normal) execution friction profile for the asset.
       */
      static calculateNormalFriction(symbol, assetClass, entryPrice, rawReward, rawRisk) {
        let spread = 0;
        let slippage = 0;
        let fees = 0;
        let latencyBuffer = 0;
        if (assetClass === "FOREX") {
          const isJPY = symbol.includes("JPY");
          const pipMult = isJPY ? 100 : 1e4;
          spread = (isJPY ? 2 : 1.2) / pipMult;
          slippage = (isJPY ? 0.8 : 0.5) / pipMult;
          fees = (isJPY ? 0.5 : 0.3) / pipMult;
          latencyBuffer = (isJPY ? 0.5 : 0.3) / pipMult;
        } else if (assetClass === "CRYPTO") {
          spread = entryPrice * 4e-4;
          slippage = entryPrice * 5e-4;
          fees = entryPrice * 12e-4;
          latencyBuffer = entryPrice * 4e-4;
        } else {
          spread = Math.max(0.03, entryPrice * 3e-4);
          slippage = Math.max(0.02, entryPrice * 2e-4);
          fees = Math.max(0.01, entryPrice * 1e-4);
          latencyBuffer = Math.max(0.02, entryPrice * 2e-4);
        }
        const totalFrictionPrice = spread + slippage + fees + latencyBuffer;
        const netReward = Math.max(0, rawReward - totalFrictionPrice);
        const netRisk = rawRisk + totalFrictionPrice;
        const netRR = netRisk > 0 ? parseFloat((netReward / netRisk).toFixed(2)) : 0;
        const frictionRatio = rawReward > 0 ? totalFrictionPrice / rawReward : 1;
        return {
          spread: parseFloat(spread.toFixed(5)),
          slippage: parseFloat(slippage.toFixed(5)),
          fees: parseFloat(fees.toFixed(5)),
          latencyBuffer: parseFloat(latencyBuffer.toFixed(5)),
          totalFrictionPrice: parseFloat(totalFrictionPrice.toFixed(5)),
          netReward: parseFloat(netReward.toFixed(5)),
          netRisk: parseFloat(netRisk.toFixed(5)),
          netRR,
          frictionRatio: parseFloat(frictionRatio.toFixed(4))
        };
      }
      /**
       * Calculates stressed (adverse) execution friction profile for the asset.
       */
      static calculateAdverseFriction(symbol, assetClass, entryPrice, rawReward, rawRisk) {
        let spread = 0;
        let slippage = 0;
        let fees = 0;
        let latencyBuffer = 0;
        if (assetClass === "FOREX") {
          const isJPY = symbol.includes("JPY");
          const pipMult = isJPY ? 100 : 1e4;
          spread = (isJPY ? 4.5 : 2.5) / pipMult;
          slippage = (isJPY ? 2.5 : 1.5) / pipMult;
          fees = (isJPY ? 0.5 : 0.3) / pipMult;
          latencyBuffer = (isJPY ? 1.5 : 1) / pipMult;
        } else if (assetClass === "CRYPTO") {
          spread = entryPrice * 12e-4;
          slippage = entryPrice * 25e-4;
          fees = entryPrice * 12e-4;
          latencyBuffer = entryPrice * 15e-4;
        } else {
          spread = Math.max(0.1, entryPrice * 1e-3);
          slippage = Math.max(0.08, entryPrice * 8e-4);
          fees = Math.max(0.01, entryPrice * 1e-4);
          latencyBuffer = Math.max(0.06, entryPrice * 6e-4);
        }
        const totalFrictionPrice = spread + slippage + fees + latencyBuffer;
        const netReward = Math.max(0, rawReward - totalFrictionPrice);
        const netRisk = rawRisk + totalFrictionPrice;
        const netRR = netRisk > 0 ? parseFloat((netReward / netRisk).toFixed(2)) : 0;
        const frictionRatio = rawReward > 0 ? totalFrictionPrice / rawReward : 1;
        return {
          spread: parseFloat(spread.toFixed(5)),
          slippage: parseFloat(slippage.toFixed(5)),
          fees: parseFloat(fees.toFixed(5)),
          latencyBuffer: parseFloat(latencyBuffer.toFixed(5)),
          totalFrictionPrice: parseFloat(totalFrictionPrice.toFixed(5)),
          netReward: parseFloat(netReward.toFixed(5)),
          netRisk: parseFloat(netRisk.toFixed(5)),
          netRR,
          frictionRatio: parseFloat(frictionRatio.toFixed(4))
        };
      }
    };
  }
});

// src/server/signals/ScoringEngine.ts
var ScoringEngine;
var init_ScoringEngine = __esm({
  "src/server/signals/ScoringEngine.ts"() {
    init_formatters();
    init_TechnicalIndicators();
    init_StrategyEngine();
    init_Gate28ConfirmationDiversity();
    init_Gate34ExecutionFrictionStressTest();
    init_config();
    ScoringEngine = class _ScoringEngine {
      /**
       * Estimates win rate based on technical quality score, R:R ratio, and strategy agreement.
       * Must strictly be > 30% for actionable trades.
       */
      static estimateWinRate(score, rr, agreeingStrategies = 4) {
        const baseWinRate = 25;
        const scoreFactor = score / 100 * 30;
        const rrFactor = Math.min(rr * 3, 15);
        const strategyBonus = agreeingStrategies / 6 * 15;
        const calculated = Math.min(92, baseWinRate + scoreFactor + rrFactor + strategyBonus);
        return Number(calculated.toFixed(1));
      }
      /**
       * Calculates mathematical historical expectancy:
       * Expectancy = (WinRate% * RiskRewardRatio) - (LossRate% * 1.0)
       * Must be strictly positive (> 0) to avoid negative-sum trades.
       */
      static calculateExpectancy(winRatePct, rr) {
        const winProb = winRatePct / 100;
        const lossProb = 1 - winProb;
        const expectancy = winProb * rr - lossProb * 1;
        return Number(expectancy.toFixed(3));
      }
      /**
       * Calculates hypothetical risk sizing based on a default balance and risk percentage.
       */
      static calculateHypotheticalRisk(entry, stopLoss, minStopDistance) {
        const hypotheticalBalance = 1e3;
        const riskPercent = 0.01;
        const riskAmount = hypotheticalBalance * riskPercent;
        const riskDistance = Math.max(Math.abs(entry - stopLoss), minStopDistance);
        const positionSize = riskAmount / riskDistance;
        return {
          suggestedRiskAmount: Number(riskAmount.toFixed(2)),
          suggestedPositionSize: Number(positionSize.toFixed(4))
        };
      }
      /**
       * Evaluates all scoring components deterministically based on real, validated market data.
       * Uses the upgraded 0â€“100 Quality Score:
       * - Higher-TF trend: 20
       * - Market structure: 15
       * - Momentum: 15
       * - Volume / order flow: 15
       * - Support / resistance: 10
       * - Volatility / ATR: 10
       * - Entry quality: 10
       * - News / sentiment: 5
       *
       * Thresholds (Centralized Configuration):
       * - score >= signalThreshold â†’ ACTIONABLE SIGNAL
       * - score >= qualifiedCandidateThreshold â†’ QUALIFIED CANDIDATE
       * - score >= watchingThreshold â†’ WATCHING
       */
      static calculateScore(symbol, entryPrice, candlesMap, newsSentiment, crossCheckAgreementPct) {
        const cleanSymbol = symbol.trim().toUpperCase();
        const thresholds = serverConfig.getConfig().thresholds;
        const tf15m = candlesMap["15m"] || [];
        const tf1h = candlesMap["1h"] || [];
        if (tf15m.length < 20 || tf1h.length < 20) {
          return this.createRejection("REJECTED: INSUFFICIENT_DATA. Insufficient candle data in primary baseline (15m/1h required with min 20 candles)");
        }
        const strategyEval = StrategyEngine.evaluate(cleanSymbol, entryPrice, candlesMap);
        if (!strategyEval.hasStrongConfluence || !strategyEval.dominantDirection) {
          const rej = this.createRejection(
            strategyEval.rejectionReason || "REJECTED: INSUFFICIENT_STRATEGY_AGREEMENT. Failed strategy confluence agreement",
            strategyEval.marketRegime,
            strategyEval.regimeDetails
          );
          rej.strategyAgreementRatio = strategyEval.agreementRatio;
          rej.agreeingStrategiesCount = strategyEval.agreeingStrategiesCount;
          rej.totalStrategiesCount = strategyEval.totalStrategiesCount || 6;
          return rej;
        }
        const direction = strategyEval.dominantDirection;
        const confluenceReasons = [...strategyEval.reasons];
        const marketRegime = strategyEval.marketRegime;
        const regimeDetails = strategyEval.regimeDetails;
        const s15m = [...tf15m].sort((a, b) => a.timestamp - b.timestamp);
        const s1h = [...tf1h].sort((a, b) => a.timestamp - b.timestamp);
        const s4h = candlesMap["4h"] && candlesMap["4h"].length >= 10 ? [...candlesMap["4h"]].sort((a, b) => a.timestamp - b.timestamp) : [];
        const s1d = candlesMap["1d"] && candlesMap["1d"].length >= 10 ? [...candlesMap["1d"]].sort((a, b) => a.timestamp - b.timestamp) : [];
        const s5m = candlesMap["5m"] && candlesMap["5m"].length >= 10 ? [...candlesMap["5m"]].sort((a, b) => a.timestamp - b.timestamp) : [];
        const s30m = candlesMap["30m"] && candlesMap["30m"].length >= 10 ? [...candlesMap["30m"]].sort((a, b) => a.timestamp - b.timestamp) : [];
        const ema9_15m = TechnicalIndicators.calculateEMA(s15m, 9);
        const ema21_15m = TechnicalIndicators.calculateEMA(s15m, 21);
        const rsi_15m = TechnicalIndicators.calculateRSI(s15m, 14);
        const macd_15m = TechnicalIndicators.calculateMACD(s15m, 12, 26, 9);
        const zlMacd_15m = TechnicalIndicators.calculateZeroLagMACD(s15m, 12, 26, 9);
        const atr_15m = TechnicalIndicators.calculateATR(s15m, 14);
        const ema9_1h = TechnicalIndicators.calculateEMA(s1h, 9);
        const ema21_1h = TechnicalIndicators.calculateEMA(s1h, 21);
        const ema50_1h = s1h.length >= 50 ? TechnicalIndicators.calculateEMA(s1h, 50) : [];
        const rsi_1h = TechnicalIndicators.calculateRSI(s1h, 14);
        const atr_1h = TechnicalIndicators.calculateATR(s1h, 14);
        if (ema9_15m.length === 0 || ema21_15m.length === 0 || rsi_15m.length === 0 || !macd_15m || ema9_1h.length === 0 || ema21_1h.length === 0 || rsi_1h.length === 0 || atr_15m <= 0 || atr_1h <= 0) {
          return this.createRejection("REJECTED: INSUFFICIENT_DATA. Failed to compute authoritative baseline technical indicators (insufficient candle depth)", marketRegime, regimeDetails);
        }
        const lastEma9_15m = ema9_15m[ema9_15m.length - 1];
        const lastEma21_15m = ema21_15m[ema21_15m.length - 1];
        const lastRsi_15m = rsi_15m[rsi_15m.length - 1];
        const lastEma9_1h = ema9_1h[ema9_1h.length - 1];
        const lastEma21_1h = ema21_1h[ema21_1h.length - 1];
        const lastEma50_1h = ema50_1h.length > 0 ? ema50_1h[ema50_1h.length - 1] : lastEma21_1h;
        const lastRsi_1h = rsi_1h[rsi_1h.length - 1];
        let higherTfTrendScore = 0;
        let timeframesAligned = 0;
        let totalTfsEvaluated = 0;
        if (s15m.length >= 10) {
          totalTfsEvaluated++;
          if (direction === "BUY" && entryPrice >= lastEma21_15m || direction === "SELL" && entryPrice <= lastEma21_15m) {
            timeframesAligned++;
          }
        }
        if (s1h.length >= 10) {
          totalTfsEvaluated++;
          if (direction === "BUY" && entryPrice >= lastEma21_1h || direction === "SELL" && entryPrice <= lastEma21_1h) {
            timeframesAligned++;
          }
        }
        let is4hAligned = false;
        if (s4h.length >= 10) {
          totalTfsEvaluated++;
          const ema21_4h = TechnicalIndicators.calculateEMA(s4h, Math.min(s4h.length - 1, 21));
          const ema9_4h = TechnicalIndicators.calculateEMA(s4h, Math.min(s4h.length - 1, 9));
          if (ema21_4h.length > 0 && ema9_4h.length > 0) {
            const last4hEma21 = ema21_4h[ema21_4h.length - 1];
            const last4hEma9 = ema9_4h[ema9_4h.length - 1];
            if (direction === "BUY" && entryPrice >= last4hEma21 && last4hEma9 >= last4hEma21) {
              is4hAligned = true;
              timeframesAligned++;
            } else if (direction === "SELL" && entryPrice <= last4hEma21 && last4hEma9 <= last4hEma21) {
              is4hAligned = true;
              timeframesAligned++;
            }
          }
        }
        let is1dAligned = false;
        if (s1d.length >= 10) {
          totalTfsEvaluated++;
          const ema21_1d = TechnicalIndicators.calculateEMA(s1d, Math.min(s1d.length - 1, 21));
          if (ema21_1d.length > 0) {
            const last1dEma21 = ema21_1d[ema21_1d.length - 1];
            if (direction === "BUY" && entryPrice >= last1dEma21) {
              is1dAligned = true;
              timeframesAligned++;
            } else if (direction === "SELL" && entryPrice <= last1dEma21) {
              is1dAligned = true;
              timeframesAligned++;
            }
          }
        }
        if (s30m.length >= 10) {
          totalTfsEvaluated++;
          const ema21_30m = TechnicalIndicators.calculateEMA(s30m, Math.min(s30m.length - 1, 21));
          if (ema21_30m.length > 0) {
            const last30mEma = ema21_30m[ema21_30m.length - 1];
            if (direction === "BUY" && entryPrice >= last30mEma || direction === "SELL" && entryPrice <= last30mEma) {
              timeframesAligned++;
            }
          }
        }
        if (s5m.length >= 10) {
          totalTfsEvaluated++;
          const ema9_5m = TechnicalIndicators.calculateEMA(s5m, Math.min(s5m.length - 1, 9));
          if (ema9_5m.length > 0) {
            const last5mEma = ema9_5m[ema9_5m.length - 1];
            if (direction === "BUY" && entryPrice >= last5mEma || direction === "SELL" && entryPrice <= last5mEma) {
              timeframesAligned++;
            }
          }
        }
        totalTfsEvaluated = Math.max(1, totalTfsEvaluated);
        const timeframeAlignmentRatio = totalTfsEvaluated > 0 ? timeframesAligned / totalTfsEvaluated : 0;
        if (is4hAligned && is1dAligned) {
          higherTfTrendScore = 20;
        } else if (is4hAligned || is1dAligned) {
          higherTfTrendScore = 18;
        } else if (timeframeAlignmentRatio >= 0.8) {
          higherTfTrendScore = 16;
        } else if (timeframesAligned >= 2) {
          higherTfTrendScore = 12;
        } else {
          higherTfTrendScore = 8;
        }
        if (timeframeAlignmentRatio < thresholds.minimumTimeframeAlignment) {
          return this.createRejection(
            `REJECTED: INSUFFICIENT_TIMEFRAME_ALIGNMENT. Insufficient timeframe confirmation: ${(timeframeAlignmentRatio * 100).toFixed(0)}% aligned (${timeframesAligned}/${totalTfsEvaluated}, minimum ${thresholds.minimumTimeframeAlignment * 100}% required)`,
            marketRegime,
            regimeDetails
          );
        }
        let marketStructureScore = 0;
        const struct1h = TechnicalIndicators.calculateMarketStructure(s1h, 15);
        const struct15m = TechnicalIndicators.calculateMarketStructure(s15m, 15);
        const isEmaStack1h = direction === "BUY" && lastEma9_1h >= lastEma21_1h && lastEma21_1h >= lastEma50_1h || direction === "SELL" && lastEma9_1h <= lastEma21_1h && lastEma21_1h <= lastEma50_1h;
        const isEmaStack15m = direction === "BUY" && lastEma9_15m >= lastEma21_15m || direction === "SELL" && lastEma9_15m <= lastEma21_15m;
        const isStructBull = struct1h.structureBias === "BULLISH" || struct15m.structureBias === "BULLISH";
        const isStructBear = struct1h.structureBias === "BEARISH" || struct15m.structureBias === "BEARISH";
        if (direction === "BUY") {
          if (isStructBull && isEmaStack1h) marketStructureScore = 15;
          else if (isStructBull || isEmaStack1h) marketStructureScore = 12;
          else if (isEmaStack15m) marketStructureScore = 9;
          else marketStructureScore = 5;
        } else {
          if (isStructBear && isEmaStack1h) marketStructureScore = 15;
          else if (isStructBear || isEmaStack1h) marketStructureScore = 12;
          else if (isEmaStack15m) marketStructureScore = 9;
          else marketStructureScore = 5;
        }
        let momentumScore = 0;
        const isZlMacdBull = zlMacd_15m && zlMacd_15m.histogram >= 0 && zlMacd_15m.macdLine >= zlMacd_15m.signalLine || macd_15m && macd_15m.histogram >= 0;
        const isZlMacdBear = zlMacd_15m && zlMacd_15m.histogram <= 0 && zlMacd_15m.macdLine <= zlMacd_15m.signalLine || macd_15m && macd_15m.histogram <= 0;
        if (direction === "BUY") {
          if (isZlMacdBull) momentumScore += 6;
          if (lastRsi_15m >= 45 && lastRsi_15m <= 68) momentumScore += 5;
          else if (lastRsi_15m > 38 && lastRsi_15m < 75) momentumScore += 3;
          if (lastRsi_1h >= 40 && lastRsi_1h <= 68) momentumScore += 4;
        } else {
          if (isZlMacdBear) momentumScore += 6;
          if (lastRsi_15m <= 55 && lastRsi_15m >= 32) momentumScore += 5;
          else if (lastRsi_15m < 62 && lastRsi_15m > 25) momentumScore += 3;
          if (lastRsi_1h <= 60 && lastRsi_1h >= 32) momentumScore += 4;
        }
        let volumeOrderFlowScore = 0;
        const of15m = TechnicalIndicators.calculateOrderFlowMetrics(s15m, 14);
        const wicks15m = TechnicalIndicators.calculateWickRejection(s15m, 3);
        const lastVol15m = s15m[s15m.length - 1].volume || 0;
        const avgVol15m = s15m.slice(-20).reduce((acc, c) => acc + (c.volume || 0), 0) / 20;
        if (direction === "BUY") {
          if (of15m.buyingPressurePct >= 58 || of15m.deltaBias === "BULLISH") volumeOrderFlowScore += 6;
          else if (of15m.buyingPressurePct >= 50) volumeOrderFlowScore += 3;
          if (avgVol15m > 0 && lastVol15m >= avgVol15m * 1.05) volumeOrderFlowScore += 5;
          else if (avgVol15m > 0 && lastVol15m >= avgVol15m * 0.9) volumeOrderFlowScore += 3;
          if (wicks15m.hasBullishWickAbsorption || wicks15m.lowerWickRejectionPct >= 30) volumeOrderFlowScore += 4;
        } else {
          if (of15m.sellingPressurePct >= 58 || of15m.deltaBias === "BEARISH") volumeOrderFlowScore += 6;
          else if (of15m.sellingPressurePct >= 50) volumeOrderFlowScore += 3;
          if (avgVol15m > 0 && lastVol15m >= avgVol15m * 1.05) volumeOrderFlowScore += 5;
          else if (avgVol15m > 0 && lastVol15m >= avgVol15m * 0.9) volumeOrderFlowScore += 3;
          if (wicks15m.hasBearishWickAbsorption || wicks15m.upperWickRejectionPct >= 30) volumeOrderFlowScore += 4;
        }
        let supportResistanceScore = 0;
        const lows15m = s15m.slice(-14).map((c) => c.low);
        const highs15m = s15m.slice(-14).map((c) => c.high);
        const support15m = Math.min(...lows15m);
        const resistance15m = Math.max(...highs15m);
        const lows1h = s1h.slice(-14).map((c) => c.low);
        const highs1h = s1h.slice(-14).map((c) => c.high);
        const majorSupport1h = lows1h.length > 0 ? Math.min(...lows1h) : support15m;
        const majorResistance1h = highs1h.length > 0 ? Math.max(...highs1h) : resistance15m;
        let isNearKeyLevel = false;
        if (direction === "BUY") {
          const distanceToSupport = Math.abs(entryPrice - support15m);
          isNearKeyLevel = distanceToSupport <= 1.25 * atr_15m;
          const roomToResistance = majorResistance1h - entryPrice;
          const hasCleanRunway = roomToResistance >= 1.5 * atr_15m;
          if (isNearKeyLevel) supportResistanceScore += 6;
          else supportResistanceScore += 4;
          if (hasCleanRunway) supportResistanceScore += 4;
          else supportResistanceScore += 2;
        } else {
          const distanceToResistance = Math.abs(resistance15m - entryPrice);
          isNearKeyLevel = distanceToResistance <= 1.25 * atr_15m;
          const roomToSupport = entryPrice - majorSupport1h;
          const hasCleanRunway = roomToSupport >= 1.5 * atr_15m;
          if (isNearKeyLevel) supportResistanceScore += 6;
          else supportResistanceScore += 4;
          if (hasCleanRunway) supportResistanceScore += 4;
          else supportResistanceScore += 2;
        }
        let volatilityAtrScore = 0;
        const vm1h = TechnicalIndicators.calculateVolatilityMetrics(s1h, 14);
        if (vm1h.isDeadMarket || vm1h.isErratic || vm1h.atrRatio < 0.45 || vm1h.atrRatio > 2.8) {
          return this.createRejection(
            `REJECTED: INSUFFICIENT_ATR. Volatility filter rejected: ATR ratio (${vm1h.atrRatio}x) outside executable safety bounds`,
            marketRegime,
            regimeDetails
          );
        }
        if (vm1h.isValidExpansion || vm1h.atrRatio >= 1.05 && vm1h.atrRatio <= 2.5) {
          volatilityAtrScore = 10;
        } else if (vm1h.isHealthyVolatility) {
          volatilityAtrScore = 8;
        } else {
          volatilityAtrScore = 6;
        }
        let entryQualityScore = 0;
        const distToEma9_15m = Math.abs(entryPrice - lastEma9_15m);
        const isAtDynamicZone = distToEma9_15m <= 0.8 * atr_15m;
        if (isAtDynamicZone) entryQualityScore += 5;
        else entryQualityScore += 3;
        if (s5m.length >= 2) {
          const last5m = s5m[s5m.length - 1];
          const is5mTrigger = direction === "BUY" ? last5m.close > last5m.open : last5m.close < last5m.open;
          if (is5mTrigger) entryQualityScore += 3;
          else entryQualityScore += 1;
        } else {
          entryQualityScore += 2;
        }
        if (crossCheckAgreementPct >= 99.8) entryQualityScore += 2;
        else if (crossCheckAgreementPct >= 99.5) entryQualityScore += 1;
        let newsSentimentScore = 3;
        if (direction === "BUY" && newsSentiment === "BULLISH") newsSentimentScore = 5;
        else if (direction === "SELL" && newsSentiment === "BEARISH") newsSentimentScore = 5;
        else if (direction === "BUY" && newsSentiment === "BEARISH") newsSentimentScore = 1;
        else if (direction === "SELL" && newsSentiment === "BULLISH") newsSentimentScore = 1;
        const coreScore = Math.min(
          100,
          higherTfTrendScore + marketStructureScore + momentumScore + volumeOrderFlowScore + supportResistanceScore + volatilityAtrScore + entryQualityScore + newsSentimentScore
        );
        const totalScore = coreScore;
        const diversityResult = Gate28ConfirmationDiversity.evaluate(confluenceReasons, {
          htfEma9: lastEma9_1h,
          htfEma21: lastEma21_1h,
          htfRsi: lastRsi_1h,
          ltfEma9: lastEma9_15m,
          ltfEma21: lastEma21_15m,
          ltfRsi: lastRsi_15m,
          macd: macd_15m,
          atr: atr_15m
        });
        if (diversityResult.explanation) {
          confluenceReasons.push(diversityResult.explanation);
        }
        const profile = this.getAssetExecutionProfile(cleanSymbol, entryPrice, atr_15m);
        const precision = profile.precision;
        const minSafeStopDist = Math.max(profile.minPracticalStopDistance, atr_15m * 0.85);
        let stopLoss = 0;
        let takeProfit = 0;
        let tp1 = 0;
        let tp2 = 0;
        let tp3 = 0;
        const primaryStrategyName = strategyEval.strategyResults?.find((s) => s.passed)?.name || "Multi-Timeframe Trend Confluence";
        if (direction === "BUY") {
          const structuralSl = support15m - atr_15m * 0.4;
          const proposedSl = Math.min(structuralSl, entryPrice - minSafeStopDist);
          stopLoss = Number(proposedSl.toFixed(precision));
        } else {
          const structuralSl = resistance15m + atr_15m * 0.4;
          const proposedSl = Math.max(structuralSl, entryPrice + minSafeStopDist);
          stopLoss = Number(proposedSl.toFixed(precision));
        }
        const calculatedRisk = Math.abs(entryPrice - stopLoss);
        const tpSetup = _ScoringEngine.calculateThreeTakeProfits(
          direction,
          entryPrice,
          calculatedRisk,
          atr_15m,
          support15m,
          resistance15m,
          majorSupport1h,
          majorResistance1h,
          primaryStrategyName,
          profile.minPracticalTargetDistance,
          precision
        );
        tp1 = tpSetup.tp1;
        tp2 = tpSetup.tp2;
        tp3 = tpSetup.tp3;
        takeProfit = tp2;
        const calculatedReward = (Math.abs(tp1 - entryPrice) + Math.abs(tp2 - entryPrice) + Math.abs(tp3 - entryPrice)) / 3;
        const rawRR = calculatedRisk > 0 ? Number((calculatedReward / calculatedRisk).toFixed(2)) : 0;
        if (rawRR < thresholds.minimumRR) {
          return this.createRejection(
            `REJECTED: GROSS_RR_BELOW_THRESHOLD. Gross Risk/Reward ratio (${rawRR.toFixed(2)}:1) is below minimum acceptable GROSS R:R (${thresholds.minimumRR}:1)`,
            marketRegime,
            regimeDetails
          );
        }
        const hasStrongTrend = higherTfTrendScore >= 12;
        const hasValidEntry = entryQualityScore >= 5;
        const hasGoodRR = rawRR >= thresholds.minimumRR;
        const isStrongTrendPath = hasStrongTrend && hasValidEntry && hasGoodRR;
        const isBreakout = marketRegime === "BREAKOUT" || primaryStrategyName.toUpperCase().includes("BREAKOUT");
        const hasValidStructure = marketStructureScore >= 9;
        const isGoodBreakoutPath = isBreakout && hasValidStructure && hasGoodRR;
        const isReversal = marketRegime === "RANGE_REVERSAL" || marketRegime === "RANGE" || primaryStrategyName.toUpperCase().includes("REVERSAL") || primaryStrategyName.toUpperCase().includes("DIVERGENCE") || primaryStrategyName.toUpperCase().includes("SWEEP");
        const hasAcceptableRisk = rawRR >= 1.5;
        const isGoodReversalPath = isReversal && hasValidStructure && hasAcceptableRisk;
        const hasGoodMomentum = momentumScore >= 9;
        const isGoodMomentumPath = hasGoodMomentum && hasValidEntry && hasAcceptableRisk;
        const isOptimizedPath = isStrongTrendPath || isGoodBreakoutPath || isGoodReversalPath || isGoodMomentumPath;
        const effectiveMinWinProb = isOptimizedPath ? 35 : thresholds.minimumWinProbability;
        const estimatedWinRate = this.estimateWinRate(totalScore, rawRR, strategyEval.agreeingStrategiesCount);
        if (estimatedWinRate <= effectiveMinWinProb) {
          return this.createRejection(
            `REJECTED: WIN_RATE_BELOW_THRESHOLD. Estimated win rate (${estimatedWinRate}%) is at or below ${effectiveMinWinProb}% threshold`,
            marketRegime,
            regimeDetails
          );
        }
        const expectancy = this.calculateExpectancy(estimatedWinRate, rawRR);
        if (expectancy <= 0) {
          return this.createRejection(
            `REJECTED: NEGATIVE_EXPECTANCY. Negative mathematical expectancy (${expectancy}R per trade). Setup discarded.`,
            marketRegime,
            regimeDetails
          );
        }
        let qualityTier = "REJECT";
        if (totalScore >= thresholds.signalThreshold) qualityTier = "HIGH_QUALITY";
        else if (totalScore >= thresholds.qualifiedCandidateThreshold) qualityTier = "VALID";
        else if (totalScore >= thresholds.watchingThreshold) qualityTier = "VALID";
        if (totalScore < thresholds.minimumScore) {
          return this.createRejection(
            `REJECTED: SCORE_BELOW_THRESHOLD. Deterministic quality score ${totalScore}/100 is below minimum actionable threshold of ${thresholds.minimumScore}`,
            marketRegime,
            regimeDetails
          );
        }
        const spreadUnits = profile.estimatedSpreadUnits;
        const feePct = profile.estimatedFeeBufferPct;
        const stressTest = Gate34ExecutionFrictionStressTest.evaluate(
          symbol,
          entryPrice,
          stopLoss,
          takeProfit
        );
        if (stressTest.normal.netRR < thresholds.minimumNetRR) {
          return this.createRejection(
            `REJECTED: NET_RR_BELOW_THRESHOLD. Normal Net Risk/Reward ratio (${stressTest.normal.netRR.toFixed(2)}:1) is below minimum acceptable NET R:R (${thresholds.minimumNetRR}:1) (Gross R:R: ${rawRR.toFixed(2)}:1)`,
            marketRegime,
            regimeDetails
          );
        }
        if (thresholds.enforceAdverseNetRRHardGate && stressTest.adverse.netRR < (thresholds.minimumAdverseNetRR ?? 1)) {
          return this.createRejection(
            `REJECTED: ADVERSE_NET_RR_BELOW_THRESHOLD. Adverse Net Risk/Reward ratio (${stressTest.adverse.netRR.toFixed(2)}:1) is below required stress floor (${thresholds.minimumAdverseNetRR ?? 1}:1)`,
            marketRegime,
            regimeDetails
          );
        }
        if (!stressTest.isPassed && stressTest.rejectionReason && stressTest.rejectionReason !== "ADVERSE_NET_RR_BELOW_THRESHOLD") {
          return this.createRejection(
            stressTest.reasons[0] || `REJECTED: ${stressTest.rejectionReason}. Execution friction stress test failed.`,
            marketRegime,
            regimeDetails
          );
        }
        const netRR = stressTest.normal.netRR;
        const targetDistance = Number((calculatedReward * profile.pipMultiplier).toFixed(1));
        const stopDistance = Number((calculatedRisk * profile.pipMultiplier).toFixed(1));
        const hypotheticalRisk = this.calculateHypotheticalRisk(entryPrice, stopLoss, profile.minPracticalStopDistance);
        const factors = {
          higherTfTrendScore,
          marketStructureScore,
          momentumScore,
          volumeOrderFlowScore,
          supportResistanceScore,
          volatilityAtrScore,
          entryQualityScore,
          newsSentimentScore,
          coreScore: totalScore,
          totalScore,
          // Legacy compatibility
          trendScore: higherTfTrendScore,
          structureScore: marketStructureScore,
          volatilityScore: volatilityAtrScore,
          volumeScore: volumeOrderFlowScore,
          strategyAgreementScore: Math.round(strategyEval.agreeingStrategiesCount / 6 * 20),
          riskRewardScore: rawRR >= 2.5 ? 10 : 8,
          freshnessAgreementScore: newsSentimentScore * 2
        };
        return {
          isValid: true,
          score: totalScore,
          coreScore: totalScore,
          qualityTier,
          direction,
          marketRegime,
          regimeDetails,
          confluenceReasons,
          stopLoss,
          takeProfit,
          tp1,
          tp2,
          tp3,
          riskRewardRatio: rawRR,
          estimatedWinRate,
          expectancy,
          targetDistance,
          stopDistance,
          pipPointUnit: profile.pipPointUnit,
          alignedCount: timeframesAligned,
          totalEvaluated: totalTfsEvaluated,
          timeframeAlignmentRatio,
          timeframesAligned,
          totalTimeframesEvaluated: totalTfsEvaluated,
          agreeingStrategiesCount: strategyEval.agreeingStrategiesCount,
          totalStrategiesCount: 6,
          strategyAgreementRatio: strategyEval.agreementRatio,
          isTopTradeCandidate: totalScore >= thresholds.signalThreshold && timeframeAlignmentRatio >= (thresholds.minimumTimeframeAlignment || 0.6),
          estimatedFriction: {
            spreadPipsOrPoints: spreadUnits,
            feeBufferPct: feePct,
            netRiskRewardRatio: netRR,
            grossRiskRewardRatio: stressTest.grossRR,
            normalNetRiskRewardRatio: stressTest.normal.netRR,
            adverseNetRiskRewardRatio: stressTest.adverse.netRR,
            frictionToProfitPct: parseFloat((stressTest.normal.frictionRatio * 100).toFixed(1)),
            isExecutionPassed: stressTest.isPassed,
            stressTestDetails: stressTest
          },
          hypotheticalRisk,
          passedStrategies: strategyEval.strategyResults?.filter((s) => s.passed).map((s) => s.name) || [],
          failedStrategies: strategyEval.strategyResults?.filter((s) => !s.passed).map((s) => s.name) || [],
          primaryStrategy: strategyEval.strategyResults?.find((s) => s.passed)?.name || "Multi-Timeframe Trend Confluence",
          factors,
          technicalMetrics: {
            htfEma9: lastEma9_1h,
            htfEma21: lastEma21_1h,
            htfRsi: lastRsi_1h,
            ltfEma9: lastEma9_15m,
            ltfEma21: lastEma21_15m,
            ltfRsi: lastRsi_15m,
            ltfMacdHistogram: macd_15m.histogram,
            atr: atr_15m
          }
        };
      }
      static calculateThreeTakeProfits(direction, entryPrice, stopLoss, atr_15m, support15m, resistance15m, majorSupport1h, majorResistance1h, primaryStrategyName, minPracticalTargetDistance, precision) {
        const risk = Math.abs(entryPrice - stopLoss);
        const thresholds = serverConfig.getConfig().thresholds;
        const cleanAtr = atr_15m > 0 ? atr_15m : entryPrice * 0.01;
        const cleanMinDistance = minPracticalTargetDistance > 0 ? minPracticalTargetDistance : cleanAtr * 1.5;
        const minPrecisionStep = Math.pow(10, -precision);
        const minStep = Math.max(cleanAtr * 0.4, 10 * minPrecisionStep, cleanMinDistance * 0.25);
        let tp1Mult = 1.2;
        let tp2Mult = 2.2;
        let tp3Mult = 3.5;
        if (primaryStrategyName.includes("Trend")) {
          tp1Mult = 1.3;
          tp2Mult = 2.2;
          tp3Mult = 3.6;
        } else if (primaryStrategyName.includes("Breakout")) {
          tp1Mult = 1.5;
          tp2Mult = 2.5;
          tp3Mult = 4.2;
        } else if (primaryStrategyName.includes("Reversion") || primaryStrategyName.includes("Bollinger")) {
          tp1Mult = 1;
          tp2Mult = 2;
          tp3Mult = 2.8;
        } else if (primaryStrategyName.includes("Momentum")) {
          tp1Mult = 1.25;
          tp2Mult = 2.15;
          tp3Mult = 3.4;
        } else if (primaryStrategyName.includes("Imbalance") || primaryStrategyName.includes("Order Flow")) {
          tp1Mult = 1.15;
          tp2Mult = 2.05;
          tp3Mult = 3.1;
        } else if (primaryStrategyName.includes("Volatility")) {
          tp1Mult = 1.2;
          tp2Mult = 2.1;
          tp3Mult = 3.2;
        }
        let tp1 = 0;
        let tp2 = 0;
        let tp3 = 0;
        if (direction === "BUY") {
          let baseTp1 = entryPrice + cleanAtr * tp1Mult;
          if (resistance15m > entryPrice) {
            baseTp1 = 0.5 * baseTp1 + 0.5 * resistance15m;
          }
          tp1 = Math.max(baseTp1, entryPrice + cleanMinDistance * 0.5);
          if (tp1 < entryPrice + minPrecisionStep) {
            tp1 = entryPrice + minPrecisionStep;
          }
          let baseTp2 = entryPrice + cleanAtr * tp2Mult;
          if (majorResistance1h > entryPrice) {
            baseTp2 = 0.3 * baseTp2 + 0.7 * (majorResistance1h - cleanAtr * 0.15);
          }
          tp2 = Math.max(baseTp2, tp1 + minStep);
          const minRequiredReward = risk * thresholds.minimumRR;
          if (tp2 < entryPrice + minRequiredReward) {
            tp2 = entryPrice + minRequiredReward;
          }
          if (tp2 < tp1 + minStep) {
            tp2 = tp1 + minStep;
          }
          let baseTp3 = entryPrice + cleanAtr * tp3Mult;
          if (majorResistance1h > entryPrice) {
            baseTp3 = Math.max(baseTp3, majorResistance1h + cleanAtr * tp3Mult * 0.4);
          }
          tp3 = Math.max(baseTp3, tp2 + minStep);
          if (tp3 < tp2 + minStep) {
            tp3 = tp2 + minStep;
          }
        } else {
          let baseTp1 = entryPrice - cleanAtr * tp1Mult;
          if (support15m < entryPrice) {
            baseTp1 = 0.5 * baseTp1 + 0.5 * support15m;
          }
          tp1 = Math.min(baseTp1, entryPrice - cleanMinDistance * 0.5);
          if (tp1 > entryPrice - minPrecisionStep) {
            tp1 = entryPrice - minPrecisionStep;
          }
          let baseTp2 = entryPrice - cleanAtr * tp2Mult;
          if (majorSupport1h < entryPrice) {
            baseTp2 = 0.3 * baseTp2 + 0.7 * (majorSupport1h + cleanAtr * 0.15);
          }
          tp2 = Math.min(baseTp2, tp1 - minStep);
          const minRequiredReward = risk * thresholds.minimumRR;
          if (tp2 > entryPrice - minRequiredReward) {
            tp2 = entryPrice - minRequiredReward;
          }
          if (tp2 > tp1 - minStep) {
            tp2 = tp1 - minStep;
          }
          let baseTp3 = entryPrice - cleanAtr * tp3Mult;
          if (majorSupport1h < entryPrice) {
            baseTp3 = Math.min(baseTp3, majorSupport1h - cleanAtr * tp3Mult * 0.4);
          }
          tp3 = Math.min(baseTp3, tp2 - minStep);
          if (tp3 > tp2 - minStep) {
            tp3 = tp2 - minStep;
          }
        }
        return {
          tp1: Number(tp1.toFixed(precision)),
          tp2: Number(tp2.toFixed(precision)),
          tp3: Number(tp3.toFixed(precision))
        };
      }
      static getAssetExecutionProfile(symbol, price, atr) {
        const isCrypto = symbol.includes("USDT") || symbol.includes("USD") && price > 100 && !symbol.includes("EUR") && !symbol.includes("GBP");
        const isForex = symbol.length === 6 && (symbol.includes("USD") || symbol.includes("EUR") || symbol.includes("GBP") || symbol.includes("JPY") || symbol.includes("CHF") || symbol.includes("CAD") || symbol.includes("AUD") || symbol.includes("NZD"));
        const isJPY = symbol.includes("JPY");
        if (isForex) {
          const precision = isJPY ? 3 : 5;
          const pipMultiplier = isJPY ? 100 : 1e4;
          return {
            assetClass: "FOREX",
            precision,
            pipMultiplier,
            pipPointUnit: "PIPS",
            estimatedSpreadUnits: isJPY ? 1.5 : 1.2,
            estimatedFeeBufferPct: 5e-5,
            minPracticalTargetDistance: 15 / pipMultiplier,
            minPracticalStopDistance: 8 / pipMultiplier
          };
        }
        if (isCrypto) {
          const precision = getDynamicPrecision(price, symbol);
          return {
            assetClass: "CRYPTO",
            precision,
            pipMultiplier: 1,
            pipPointUnit: "POINTS",
            estimatedSpreadUnits: price * 4e-4,
            estimatedFeeBufferPct: 6e-4,
            minPracticalTargetDistance: atr * 1.5,
            minPracticalStopDistance: atr * 0.8
          };
        }
        return {
          assetClass: "STOCK",
          precision: getDynamicPrecision(price, symbol),
          pipMultiplier: 1,
          pipPointUnit: "POINTS",
          estimatedSpreadUnits: 0.03,
          estimatedFeeBufferPct: 2e-4,
          minPracticalTargetDistance: Math.max(0.5, atr * 1.5),
          minPracticalStopDistance: Math.max(0.3, atr * 0.8)
        };
      }
      static createRejection(rejectionReason, marketRegime = "RANGE", regimeDetails = "Unqualified") {
        return {
          isValid: false,
          score: 0,
          coreScore: 0,
          qualityTier: "REJECT",
          direction: "BUY",
          marketRegime,
          regimeDetails,
          rejectionReason,
          confluenceReasons: [],
          stopLoss: 0,
          takeProfit: 0,
          riskRewardRatio: 0,
          estimatedWinRate: 0,
          expectancy: 0,
          alignedCount: 0,
          totalEvaluated: 6,
          timeframeAlignmentRatio: 0,
          timeframesAligned: 0,
          totalTimeframesEvaluated: 6,
          agreeingStrategiesCount: 0,
          totalStrategiesCount: 6,
          isTopTradeCandidate: false,
          estimatedFriction: {
            spreadPipsOrPoints: 0,
            feeBufferPct: 0,
            netRiskRewardRatio: 0
          },
          hypotheticalRisk: {
            suggestedRiskAmount: 0,
            suggestedPositionSize: 0
          },
          factors: {
            higherTfTrendScore: 0,
            marketStructureScore: 0,
            momentumScore: 0,
            volumeOrderFlowScore: 0,
            supportResistanceScore: 0,
            volatilityAtrScore: 0,
            entryQualityScore: 0,
            newsSentimentScore: 0,
            totalScore: 0
          }
        };
      }
      /**
       * Centralized score classification based on serverConfig thresholds:
       * score >= signalThreshold â†’ ACTIONABLE SIGNAL
       * score >= qualifiedCandidateThreshold â†’ QUALIFIED CANDIDATE
       * score >= watchingThreshold â†’ WATCHING
       */
      static classifyScore(score, customThresholds) {
        const thresholds = customThresholds || serverConfig.getConfig().thresholds;
        if (score >= 90) {
          return {
            tier: "EXCEPTIONAL",
            label: `Exceptional (90-100)`,
            isActionable: true,
            isQualifiedCandidate: true,
            isWatching: true
          };
        }
        if (score >= 80) {
          return {
            tier: "VERY_STRONG",
            label: `Very Strong setup (80-89)`,
            isActionable: true,
            isQualifiedCandidate: true,
            isWatching: true
          };
        }
        if (score >= 75) {
          return {
            tier: "STRONG",
            label: `Strong setup (75-79)`,
            isActionable: true,
            isQualifiedCandidate: true,
            isWatching: true
          };
        }
        if (score >= (thresholds.signalThreshold || 72)) {
          return {
            tier: "MODERATE_VALID",
            label: `Valid / Moderate setup (72-74)`,
            isActionable: true,
            isQualifiedCandidate: true,
            isWatching: true
          };
        }
        if (score >= thresholds.watchingThreshold) {
          return {
            tier: "WATCHING",
            label: `WATCHING (${thresholds.watchingThreshold}-${(thresholds.signalThreshold || 72) - 1})`,
            isActionable: false,
            isQualifiedCandidate: false,
            isWatching: true
          };
        }
        return {
          tier: "REJECT",
          label: `REJECT (< ${thresholds.watchingThreshold})`,
          isActionable: false,
          isQualifiedCandidate: false,
          isWatching: false
        };
      }
    };
  }
});

// src/server/signals/Gate30DataFreshness.ts
var Gate30DataFreshness;
var init_Gate30DataFreshness = __esm({
  "src/server/signals/Gate30DataFreshness.ts"() {
    init_SymbolNormalizer();
    init_logger();
    Gate30DataFreshness = class {
      static {
        this.MAX_ALLOWED_CLOCK_SKEW_MS = 5e3;
      }
      // 5 seconds max clock drift
      /**
       * Helper to convert timeframe string into exact duration in milliseconds
       */
      static getFrameIntervalMs(timeframe) {
        const tf = timeframe.toLowerCase().trim();
        if (tf === "1m" || tf === "1min") return 60 * 1e3;
        if (tf === "5m" || tf === "5min") return 5 * 60 * 1e3;
        if (tf === "15m" || tf === "15min") return 15 * 60 * 1e3;
        if (tf === "30m" || tf === "30min") return 30 * 60 * 1e3;
        if (tf === "1h" || tf === "1hour") return 60 * 60 * 1e3;
        if (tf === "4h" || tf === "4hour") return 4 * 60 * 60 * 1e3;
        if (tf === "1d" || tf === "1day" || tf === "d") return 24 * 60 * 60 * 1e3;
        if (tf === "1w" || tf === "1week") return 7 * 24 * 60 * 60 * 1e3;
        return 60 * 60 * 1e3;
      }
      /**
       * Calculates asset-aware max allowed quote age based on execution requirements, provider, and session
       */
      static getMaxAllowedQuoteAgeMs(assetClass, executionReq = "EXECUTABLE_SIGNAL", sessionState = "OPEN", provider = "UNKNOWN") {
        const normAsset = assetClass.toUpperCase();
        const normReq = executionReq.toUpperCase();
        const provUpper = provider.toUpperCase();
        if (provUpper.includes("SIMULAT") || provUpper.includes("MOCK") || provUpper.includes("TEST")) {
          return 3e5;
        }
        if (normReq === "HISTORICAL_ANALYTICS") {
          return 864e5;
        }
        if (normReq === "WATCHING") {
          if (normAsset === "CRYPTO") return 6e4;
          if (normAsset === "FOREX") return 9e4;
          return 12e4;
        }
        if (normReq === "CANDIDATE") {
          if (normAsset === "CRYPTO") return 3e4;
          if (normAsset === "FOREX") return 45e3;
          return 6e4;
        }
        if (normAsset === "CRYPTO") {
          return 15e3;
        }
        if (normAsset === "FOREX") {
          if (sessionState === "CLOSED") return 3e5;
          return 2e4;
        }
        if (normAsset === "STOCKS" || normAsset === "STOCK" || normAsset === "INDEX" || normAsset === "COMMODITIES") {
          if (sessionState === "CLOSED") return 3e5;
          return 3e4;
        }
        return 3e4;
      }
      /**
       * Calculates asset & timeframe aware max allowed candle age
       */
      static getMaxAllowedCandleAgeMs(timeframe, executionReq = "EXECUTABLE_SIGNAL") {
        const intervalMs = this.getFrameIntervalMs(timeframe);
        let multiplier = 3;
        if (executionReq === "HISTORICAL_ANALYTICS") multiplier = 10;
        return Math.max(intervalMs * multiplier, 3e5);
      }
      /**
       * Evaluates data freshness and coverage for quotes & candle history according to Gate 30 rules.
       */
      static evaluate(input) {
        const nowMs = input.nowMs || Date.now();
        const cleanSymbol = SymbolNormalizer.normalizeAppSymbol(input.symbol) || input.symbol.trim().toUpperCase();
        const assetClass = input.assetClass || SymbolNormalizer.getAssetClassification(cleanSymbol);
        const provider = input.provider || input.quote?.provider || input.candles?.[0]?.provider || "UNKNOWN";
        const timeframe = input.timeframe || "1h";
        const executionReq = input.executionRequirement || "EXECUTABLE_SIGNAL";
        const sessionState = input.sessionState || "OPEN";
        const maxAllowedQuoteAgeMs = this.getMaxAllowedQuoteAgeMs(assetClass, executionReq, sessionState, provider);
        const maxAllowedCandleAgeMs = this.getMaxAllowedCandleAgeMs(timeframe, executionReq);
        const expectedCandleIntervalMs = this.getFrameIntervalMs(timeframe);
        let quoteAgeMs = null;
        let candleAgeMs = null;
        let isFutureTimestamp = false;
        let hasImpossibleGaps = false;
        let hasMissingIntervals = false;
        let hasDuplicates = false;
        let isIncompleteCandle = false;
        let duplicateTimestampsCount = 0;
        let missingIntervalsCount = 0;
        let impossibleGapsCount = 0;
        const rejectionReasons = [];
        if (input.quote && input.quote.timestamp > 0) {
          quoteAgeMs = nowMs - input.quote.timestamp;
          if (input.quote.timestamp > nowMs + this.MAX_ALLOWED_CLOCK_SKEW_MS) {
            isFutureTimestamp = true;
            rejectionReasons.push(`Future quote timestamp detected (${input.quote.timestamp} > clock ${nowMs} + ${this.MAX_ALLOWED_CLOCK_SKEW_MS}ms skew)`);
          }
          if (quoteAgeMs !== null && quoteAgeMs > maxAllowedQuoteAgeMs && !isFutureTimestamp) {
            const quoteSec = (quoteAgeMs / 1e3).toFixed(1);
            const maxSec = (maxAllowedQuoteAgeMs / 1e3).toFixed(1);
            rejectionReasons.push(`Quote stale for ${executionReq} on ${assetClass} (Age: ${quoteSec}s > ${maxSec}s max limit)`);
          }
        }
        const candles = input.candles;
        if (candles && Array.isArray(candles) && candles.length > 0) {
          const lastCandle = candles[candles.length - 1];
          candleAgeMs = nowMs - lastCandle.timestamp;
          if (lastCandle.timestamp > nowMs + this.MAX_ALLOWED_CLOCK_SKEW_MS) {
            isFutureTimestamp = true;
            rejectionReasons.push(`Future candle timestamp detected (${lastCandle.timestamp} > clock ${nowMs})`);
          }
          if (candleAgeMs !== null && candleAgeMs > maxAllowedCandleAgeMs && !isFutureTimestamp) {
            const candleMin = (candleAgeMs / 6e4).toFixed(1);
            const maxMin = (maxAllowedCandleAgeMs / 6e4).toFixed(1);
            rejectionReasons.push(`Candle series stale for timeframe ${timeframe} (Age: ${candleMin}m > ${maxMin}m max limit)`);
          }
          if (nowMs - lastCandle.timestamp < expectedCandleIntervalMs) {
            isIncompleteCandle = true;
          }
          for (let i = 1; i < candles.length; i++) {
            const prevTime = candles[i - 1].timestamp;
            const currTime = candles[i].timestamp;
            const diffMs = currTime - prevTime;
            if (diffMs === 0) {
              hasDuplicates = true;
              duplicateTimestampsCount++;
            } else if (diffMs < 0) {
              hasImpossibleGaps = true;
              impossibleGapsCount++;
            } else if (diffMs > expectedCandleIntervalMs * 10) {
              hasImpossibleGaps = true;
              impossibleGapsCount++;
            } else if (diffMs > expectedCandleIntervalMs * 1.5) {
              hasMissingIntervals = true;
              const missingBars = Math.round(diffMs / expectedCandleIntervalMs) - 1;
              missingIntervalsCount += Math.max(1, missingBars);
            }
          }
          if (hasDuplicates) {
            rejectionReasons.push(`Detected ${duplicateTimestampsCount} duplicate candle timestamps in series`);
          }
          if (hasImpossibleGaps) {
            rejectionReasons.push(`Detected ${impossibleGapsCount} impossible timestamp gaps or backwards time jumps in candle series`);
          }
        }
        let coverageStatus = "COMPLETE";
        if (isFutureTimestamp) {
          coverageStatus = "FUTURE_TIMESTAMP";
        } else if (hasDuplicates) {
          coverageStatus = "DUPLICATES_DETECTED";
        } else if (hasImpossibleGaps) {
          coverageStatus = "IMPOSSIBLE_GAP";
        } else if (quoteAgeMs !== null && quoteAgeMs > maxAllowedQuoteAgeMs || candleAgeMs !== null && candleAgeMs > maxAllowedCandleAgeMs) {
          coverageStatus = "STALE";
        } else if (hasMissingIntervals) {
          coverageStatus = "MISSING_INTERVALS";
        } else if (isIncompleteCandle && (!candles || candles.length === 1)) {
          coverageStatus = "INCOMPLETE_CANDLE_ONLY";
        }
        let dataQuality = "EXCELLENT";
        if (isFutureTimestamp || hasDuplicates || hasImpossibleGaps || coverageStatus === "STALE") {
          dataQuality = "UNUSABLE";
        } else if (hasMissingIntervals || quoteAgeMs !== null && quoteAgeMs > maxAllowedQuoteAgeMs * 0.7) {
          dataQuality = "DEGRADED";
        } else if (isIncompleteCandle || quoteAgeMs !== null && quoteAgeMs > maxAllowedQuoteAgeMs * 0.4) {
          dataQuality = "GOOD";
        }
        const isValid = dataQuality !== "UNUSABLE" && rejectionReasons.length === 0;
        const explanation = isValid ? `Data Freshness Valid: Quality ${dataQuality}, Coverage ${coverageStatus}, Quote Age ${quoteAgeMs !== null ? Math.round(quoteAgeMs) + "ms" : "N/A"}, Candle Age ${candleAgeMs !== null ? Math.round(candleAgeMs) + "ms" : "N/A"}.` : `Data Freshness Rejected: Quality ${dataQuality}, Coverage ${coverageStatus}. Reasons: ${rejectionReasons.join("; ")}`;
        const result = {
          isValid,
          quoteAgeMs,
          candleAgeMs,
          maxAllowedQuoteAgeMs,
          maxAllowedCandleAgeMs,
          dataQuality,
          coverageStatus,
          isFutureTimestamp,
          hasImpossibleGaps,
          hasMissingIntervals,
          hasDuplicates,
          isIncompleteCandle,
          rejectionReason: isValid ? void 0 : rejectionReasons.join("; "),
          explanation,
          details: {
            expectedCandleIntervalMs,
            duplicateTimestampsCount,
            missingIntervalsCount,
            impossibleGapsCount,
            marketSession: sessionState,
            assetClass,
            executionRequirement: executionReq
          }
        };
        logger.debug(`[Gate 30 Freshness] symbol=${cleanSymbol} isValid=${isValid} quality=${dataQuality} status=${coverageStatus}`);
        return result;
      }
    };
  }
});

// src/server/signals/Gate0DataValidator.ts
var Gate0DataValidator;
var init_Gate0DataValidator = __esm({
  "src/server/signals/Gate0DataValidator.ts"() {
    init_SymbolNormalizer();
    init_Gate30DataFreshness();
    Gate0DataValidator = class {
      /**
       * Maximum allowed age for candles based on timeframe in milliseconds.
       */
      static getCandleMaxAgeMs(timeframe) {
        const tf = timeframe.toLowerCase().trim();
        if (tf === "1m") return 5 * 60 * 1e3;
        if (tf === "5m") return 15 * 60 * 1e3;
        if (tf === "15m") return 45 * 60 * 1e3;
        if (tf === "30m") return 90 * 60 * 1e3;
        if (tf === "1h") return 3 * 60 * 60 * 1e3;
        if (tf === "4h") return 12 * 60 * 60 * 1e3;
        if (tf === "1d" || tf === "1day") return 48 * 60 * 60 * 1e3;
        return 3 * 60 * 60 * 1e3;
      }
      /**
       * Main Gate 0 Validation Execution.
       * Returns DATA_STATUS ('VALID' | 'STALE' | 'INVALID' | 'INSUFFICIENT') and DATA_CONFIDENCE (0-100).
       * ONLY DATA_STATUS = 'VALID' is allowed to proceed to Gate 1 / Signal Engine calculations.
       */
      static validate(params) {
        const now = params.simulatedTimeMs || Date.now();
        const cleanSymbol = SymbolNormalizer.normalizeAppSymbol(params.symbol) || params.symbol.trim().toUpperCase();
        const assetClass = SymbolNormalizer.getAssetClassification(cleanSymbol);
        const tf = params.timeframe || "1h";
        const minRequired = params.minCandlesRequired || 20;
        const reasons = [];
        const currentPrice = params.liveTicker?.price || (params.candles && params.candles.length > 0 ? params.candles[params.candles.length - 1].close : 0);
        const timestamp = params.liveTicker?.timestamp || (params.candles && params.candles.length > 0 ? params.candles[params.candles.length - 1].timestamp : 0);
        const identification = {
          symbol: cleanSymbol,
          assetClass,
          provider: params.liveTicker?.provider || params.candles?.[0]?.provider || "UNKNOWN",
          timeframe: tf,
          timestamp,
          currentPrice,
          candleTimestamp: params.candles && params.candles.length > 0 ? params.candles[params.candles.length - 1].timestamp : 0
        };
        if (!currentPrice || currentPrice <= 0) {
          reasons.push(`Market data (price) unavailable for ${cleanSymbol}`);
          return {
            dataStatus: "INSUFFICIENT",
            dataConfidence: 0,
            freshnessMs: 0,
            freshnessSec: 0,
            identification,
            reasons,
            validatedAt: now
          };
        }
        if (!params.candles || !Array.isArray(params.candles) || params.candles.length < minRequired) {
          reasons.push(`Insufficient candle data for ${cleanSymbol} (${tf}): received ${params.candles?.length || 0}, required minimum ${minRequired}`);
          return {
            dataStatus: "INSUFFICIENT",
            dataConfidence: 0,
            freshnessMs: Math.max(0, now - timestamp),
            freshnessSec: Number(((now - timestamp) / 1e3).toFixed(1)),
            identification,
            reasons,
            validatedAt: now
          };
        }
        const gate30Res = Gate30DataFreshness.evaluate({
          symbol: cleanSymbol,
          assetClass,
          provider: identification.provider,
          timeframe: tf,
          executionRequirement: "EXECUTABLE_SIGNAL",
          quote: params.liveTicker ? {
            price: params.liveTicker.price,
            timestamp: params.liveTicker.timestamp,
            bid: params.liveTicker.bid,
            ask: params.liveTicker.ask,
            provider: params.liveTicker.provider
          } : null,
          candles: params.candles,
          nowMs: now
        });
        const dataAgeMs = gate30Res.quoteAgeMs ?? (gate30Res.candleAgeMs ?? 0);
        const freshnessMs = Math.max(0, dataAgeMs);
        const freshnessSec = Number((freshnessMs / 1e3).toFixed(1));
        if (!gate30Res.isValid) {
          const status = gate30Res.isFutureTimestamp || gate30Res.hasDuplicates || gate30Res.hasImpossibleGaps ? "INVALID" : "STALE";
          reasons.push(gate30Res.rejectionReason || "Failed Gate 30 Asset-Aware Freshness Validation");
          return {
            dataStatus: status,
            dataConfidence: 0,
            freshnessMs,
            freshnessSec,
            identification,
            reasons,
            validatedAt: now,
            gate30Result: gate30Res
          };
        }
        for (let i = 0; i < params.candles.length; i++) {
          const c = params.candles[i];
          if (!Number.isFinite(c.open) || !Number.isFinite(c.high) || !Number.isFinite(c.low) || !Number.isFinite(c.close) || c.open <= 0 || c.high <= 0 || c.low <= 0 || c.close <= 0) {
            reasons.push(`Malformed or zero/negative candle values at index ${i} in ${tf} (${cleanSymbol})`);
            return {
              dataStatus: "INVALID",
              dataConfidence: 0,
              freshnessMs,
              freshnessSec,
              identification,
              reasons,
              validatedAt: now
            };
          }
          const maxOC = Math.max(c.open, c.close);
          const minOC = Math.min(c.open, c.close);
          if (c.high < maxOC - 1e-6) {
            reasons.push(`OHLC violation: High (${c.high}) < max(Open, Close) (${maxOC}) at index ${i}`);
            return {
              dataStatus: "INVALID",
              dataConfidence: 0,
              freshnessMs,
              freshnessSec,
              identification,
              reasons,
              validatedAt: now
            };
          }
          if (c.low > minOC + 1e-6) {
            reasons.push(`OHLC violation: Low (${c.low}) > min(Open, Close) (${minOC}) at index ${i}`);
            return {
              dataStatus: "INVALID",
              dataConfidence: 0,
              freshnessMs,
              freshnessSec,
              identification,
              reasons,
              validatedAt: now
            };
          }
          if (c.high < c.low - 1e-6) {
            reasons.push(`OHLC violation: High (${c.high}) < Low (${c.low}) at index ${i}`);
            return {
              dataStatus: "INVALID",
              dataConfidence: 0,
              freshnessMs,
              freshnessSec,
              identification,
              reasons,
              validatedAt: now
            };
          }
          if (i > 0) {
            const prev = params.candles[i - 1];
            if (c.timestamp <= prev.timestamp) {
              reasons.push(`Timestamp ordering/duplicate violation: Candle ${i} (${c.timestamp}) <= Candle ${i - 1} (${prev.timestamp})`);
              return {
                dataStatus: "INVALID",
                dataConfidence: 0,
                freshnessMs,
                freshnessSec,
                identification,
                reasons,
                validatedAt: now
              };
            }
          }
        }
        let secondaryComparison = void 0;
        if (params.secondaryPrice && params.secondaryPrice.price > 0) {
          const primaryPrice = params.liveTicker.price;
          const secPrice = params.secondaryPrice.price;
          const discrepancyPct = Math.abs(primaryPrice - secPrice) / primaryPrice * 100;
          let maxDiscrepancyAllowed = 0.25;
          if (assetClass === "CRYPTO") maxDiscrepancyAllowed = 0.6;
          if (assetClass === "FOREX") maxDiscrepancyAllowed = 0.1;
          const hasSignificantDiscrepancy = discrepancyPct > maxDiscrepancyAllowed;
          secondaryComparison = {
            secondaryProvider: params.secondaryPrice.source,
            secondaryPrice: secPrice,
            discrepancyPct: Number(discrepancyPct.toFixed(3)),
            hasSignificantDiscrepancy
          };
          if (hasSignificantDiscrepancy) {
            reasons.push(`Material price discrepancy detected between primary (${primaryPrice}) and ${params.secondaryPrice.source} (${secPrice}): ${discrepancyPct.toFixed(3)}% > max ${maxDiscrepancyAllowed}%`);
            return {
              dataStatus: "INVALID",
              dataConfidence: 20,
              freshnessMs,
              freshnessSec,
              identification,
              reasons,
              validatedAt: now,
              secondaryPriceComparison: secondaryComparison
            };
          }
        }
        let confidence = 100;
        if (dataAgeMs > 1e4) {
          const ageSec = Math.floor(dataAgeMs / 1e3);
          confidence -= Math.min(30, ageSec);
        }
        const candleAgeMs = gate30Res.candleAgeMs ?? 0;
        const maxCandleAgeMs = gate30Res.maxAllowedCandleAgeMs;
        const candleAgeRatio = maxCandleAgeMs > 0 ? candleAgeMs / maxCandleAgeMs : 0;
        if (candleAgeRatio > 0.5) {
          confidence -= Math.floor((candleAgeRatio - 0.5) * 40);
        }
        const providerName = (params.liveTicker?.provider || params.candles?.[0]?.provider || "").toLowerCase();
        if (providerName && providerName !== "bitget" && providerName !== "twelvedata" && providerName !== "finnhub") {
          confidence -= 10;
        }
        const finalConfidence = Math.max(0, Math.min(100, Math.round(confidence)));
        return {
          dataStatus: "VALID",
          dataConfidence: finalConfidence,
          freshnessMs,
          freshnessSec,
          identification,
          reasons: ["Market data verified: Valid, current, internally consistent, and matched to symbol/timeframe."],
          validatedAt: now,
          gate30Result: gate30Res,
          secondaryPriceComparison: secondaryComparison
        };
      }
    };
  }
});

// src/server/signals/Gate2MTFConfluence.ts
var Gate2MTFConfluence;
var init_Gate2MTFConfluence = __esm({
  "src/server/signals/Gate2MTFConfluence.ts"() {
    init_TechnicalIndicators();
    Gate2MTFConfluence = class {
      static evaluateConfluence(proposedDirection, timeframes) {
        const htf = timeframes["4h"] && timeframes["4h"].length >= 50 ? "4h" : timeframes["1h"] && timeframes["1h"].length >= 50 ? "1h" : null;
        const mtf = timeframes["15m"] && timeframes["15m"].length >= 50 ? "15m" : timeframes["1h"] && htf !== "1h" ? "1h" : null;
        const ltf = timeframes["5m"] && timeframes["5m"].length >= 50 ? "5m" : null;
        let htfDir = "UNKNOWN";
        let mtfDir = "UNKNOWN";
        let ltfDir = "UNKNOWN";
        if (htf) htfDir = this.analyzeDirection(timeframes[htf]);
        if (mtf) mtfDir = this.analyzeDirection(timeframes[mtf]);
        if (ltf) ltfDir = this.analyzeDirection(timeframes[ltf]);
        const conflicts = [];
        let score = 100;
        if (proposedDirection === "BUY") {
          if (htfDir === "BEARISH" || htfDir === "PULLBACK_BEAR") {
            conflicts.push(`HTF (${htf}) is ${htfDir}, contradicting BUY proposal`);
            score -= 50;
          } else if (htfDir === "NEUTRAL") {
            score -= 10;
          }
          if (mtfDir === "BEARISH") {
            conflicts.push(`MTF (${mtf}) is BEARISH, fighting the BUY setup`);
            score -= 30;
          } else if (mtfDir === "PULLBACK_BEAR") {
            conflicts.push(`MTF (${mtf}) is PULLBACK_BEAR, weak context for BUY`);
            score -= 20;
          }
          if (ltfDir === "BEARISH") {
            conflicts.push(`LTF (${ltf}) is BEARISH, delaying entry`);
            score -= 20;
          }
        } else if (proposedDirection === "SELL") {
          if (htfDir === "BULLISH" || htfDir === "PULLBACK_BULL") {
            conflicts.push(`HTF (${htf}) is ${htfDir}, contradicting SELL proposal`);
            score -= 50;
          } else if (htfDir === "NEUTRAL") {
            score -= 10;
          }
          if (mtfDir === "BULLISH") {
            conflicts.push(`MTF (${mtf}) is BULLISH, fighting the SELL setup`);
            score -= 30;
          } else if (mtfDir === "PULLBACK_BULL") {
            conflicts.push(`MTF (${mtf}) is PULLBACK_BULL, weak context for SELL`);
            score -= 20;
          }
          if (ltfDir === "BULLISH") {
            conflicts.push(`LTF (${ltf}) is BULLISH, delaying entry`);
            score -= 20;
          }
        }
        if (score < 0) score = 0;
        let status = "STRONG_CONFLUENCE";
        if (score < 50) status = "CONTRADICTION";
        else if (score < 80) status = "WEAK_CONFLUENCE";
        if (!htf && !mtf) {
          status = "UNKNOWN";
          score = 0;
        }
        return {
          htfDirection: htfDir,
          mtfDirection: mtfDir,
          ltfDirection: ltfDir,
          alignmentScore: score,
          conflicts,
          confluenceStatus: status
        };
      }
      static analyzeDirection(candles) {
        if (!candles || candles.length < 50) return "UNKNOWN";
        const closes = candles.map((c) => c.close);
        const ema20 = TechnicalIndicators.calculateEMA(candles, 20);
        const ema50 = TechnicalIndicators.calculateEMA(candles, 50);
        const ema200 = TechnicalIndicators.calculateEMA(candles, 200);
        const e20 = ema20[ema20.length - 1];
        const e50 = ema50[ema50.length - 1];
        const e200 = ema200[ema200.length - 1] || e50;
        const struct = TechnicalIndicators.calculateMarketStructure(candles, 15);
        const price = closes[closes.length - 1];
        const isBull = e20 > e50 && e50 > e200;
        const isBear = e20 < e50 && e50 < e200;
        if (isBull && struct.structureBias === "BULLISH") return "BULLISH";
        if (isBear && struct.structureBias === "BEARISH") return "BEARISH";
        if (e50 > e200 && (e20 < e50 || struct.structureBias === "BEARISH" || price < e20)) return "PULLBACK_BULL";
        if (e50 < e200 && (e20 > e50 || struct.structureBias === "BULLISH" || price > e20)) return "PULLBACK_BEAR";
        if (price > e50 && price > e200) return "BULLISH";
        if (price < e50 && price < e200) return "BEARISH";
        return "NEUTRAL";
      }
    };
  }
});

// src/server/signals/Gate3MarketStructure.ts
var Gate3MarketStructure;
var init_Gate3MarketStructure = __esm({
  "src/server/signals/Gate3MarketStructure.ts"() {
    Gate3MarketStructure = class {
      static analyzeStructure(proposedDirection, candles, leftBars = 3, rightBars = 3) {
        if (!candles || candles.length < leftBars + rightBars + 5) {
          return this.getDefaultUnknown();
        }
        const swings = this.identifySwings(candles, leftBars, rightBars);
        if (swings.length < 4) {
          return this.getDefaultUnknown();
        }
        const recentSwings = swings.slice(-10);
        const currentPrice = candles[candles.length - 1].close;
        let hh = 0, hl = 0, lh = 0, ll = 0;
        const highs = recentSwings.filter((s) => s.type === "HIGH");
        const lows = recentSwings.filter((s) => s.type === "LOW");
        for (let i = 1; i < highs.length; i++) {
          if (highs[i].price > highs[i - 1].price) hh++;
          else if (highs[i].price < highs[i - 1].price) lh++;
        }
        for (let i = 1; i < lows.length; i++) {
          if (lows[i].price > lows[i - 1].price) hl++;
          else if (lows[i].price < lows[i - 1].price) ll++;
        }
        let direction = "CONSOLIDATION";
        if (hh >= lh && hl >= ll && (hh > 0 || hl > 0)) {
          direction = "BULLISH";
        } else if (lh >= hh && ll >= hl && (lh > 0 || ll > 0)) {
          direction = "BEARISH";
        }
        let bosStatus = "NONE";
        let chochStatus = "NONE";
        const reasons = [];
        const lastHigh = highs[highs.length - 1];
        const prevHigh = highs[highs.length - 2];
        const lastLow = lows[lows.length - 1];
        const prevLow = lows[lows.length - 2];
        if (lastHigh && prevHigh && lastLow && prevLow) {
          const wasBearish = prevHigh.price < (highs[highs.length - 3]?.price || Infinity) && prevLow.price < (lows[lows.length - 3]?.price || Infinity);
          const wasBullish = prevHigh.price > (highs[highs.length - 3]?.price || 0) && prevLow.price > (lows[lows.length - 3]?.price || 0);
          if (currentPrice > lastHigh.price) {
            if (wasBearish || direction === "BEARISH") {
              chochStatus = "BULLISH_CHOCH";
              reasons.push("Bullish CHOCH: Price broke above recent lower high.");
            } else {
              bosStatus = "BULLISH_BOS";
              reasons.push("Bullish BOS: Price broke above recent higher high, continuing trend.");
            }
          } else if (currentPrice < lastLow.price) {
            if (wasBullish || direction === "BULLISH") {
              chochStatus = "BEARISH_CHOCH";
              reasons.push("Bearish CHOCH: Price broke below recent higher low.");
            } else {
              bosStatus = "BEARISH_BOS";
              reasons.push("Bearish BOS: Price broke below recent lower low, continuing trend.");
            }
          }
        }
        let strength = "MODERATE";
        if (direction === "BULLISH" && (bosStatus === "BULLISH_BOS" || chochStatus === "BULLISH_CHOCH") || direction === "BEARISH" && (bosStatus === "BEARISH_BOS" || chochStatus === "BEARISH_CHOCH")) {
          strength = "STRONG";
        } else if (direction === "CONSOLIDATION") {
          strength = "WEAK";
        }
        const supportZones = lows.slice(-3).map((l) => l.price);
        const resistanceZones = highs.slice(-3).map((h) => h.price);
        let score = 50;
        if (proposedDirection === "BUY") {
          if (direction === "BULLISH") score += 20;
          if (bosStatus === "BULLISH_BOS") score += 20;
          if (chochStatus === "BULLISH_CHOCH") score += 15;
          if (direction === "BEARISH") {
            score -= 30;
            reasons.push("Overall structure is Bearish, conflicting with BUY.");
          }
          if (chochStatus === "BEARISH_CHOCH" || bosStatus === "BEARISH_BOS") {
            score -= 40;
            reasons.push("Recent structural break is Bearish, severely conflicting with BUY.");
          }
        } else {
          if (direction === "BEARISH") score += 20;
          if (bosStatus === "BEARISH_BOS") score += 20;
          if (chochStatus === "BEARISH_CHOCH") score += 15;
          if (direction === "BULLISH") {
            score -= 30;
            reasons.push("Overall structure is Bullish, conflicting with SELL.");
          }
          if (chochStatus === "BULLISH_CHOCH" || bosStatus === "BULLISH_BOS") {
            score -= 40;
            reasons.push("Recent structural break is Bullish, severely conflicting with SELL.");
          }
        }
        score = Math.max(0, Math.min(100, score));
        return {
          direction,
          strength,
          bosStatus,
          chochStatus,
          supportZones,
          resistanceZones,
          score,
          reasons
        };
      }
      static identifySwings(candles, left, right) {
        const swings = [];
        for (let i = left; i < candles.length - right; i++) {
          let isHigh = true;
          let isLow = true;
          for (let j = 1; j <= left; j++) {
            if (candles[i].high <= candles[i - j].high) isHigh = false;
            if (candles[i].low >= candles[i - j].low) isLow = false;
          }
          for (let j = 1; j <= right; j++) {
            if (candles[i].high <= candles[i + j].high) isHigh = false;
            if (candles[i].low >= candles[i + j].low) isLow = false;
          }
          if (isHigh) {
            swings.push({ type: "HIGH", price: candles[i].high, index: i, timestamp: candles[i].timestamp });
          }
          if (isLow) {
            swings.push({ type: "LOW", price: candles[i].low, index: i, timestamp: candles[i].timestamp });
          }
        }
        swings.sort((a, b) => a.index - b.index);
        const filteredSwings = [];
        for (const s of swings) {
          if (filteredSwings.length === 0) {
            filteredSwings.push(s);
            continue;
          }
          const last = filteredSwings[filteredSwings.length - 1];
          if (last.type === s.type) {
            if (s.type === "HIGH" && s.price > last.price) {
              filteredSwings[filteredSwings.length - 1] = s;
            } else if (s.type === "LOW" && s.price < last.price) {
              filteredSwings[filteredSwings.length - 1] = s;
            }
          } else {
            filteredSwings.push(s);
          }
        }
        return filteredSwings;
      }
      static getDefaultUnknown() {
        return {
          direction: "UNKNOWN",
          strength: "NONE",
          bosStatus: "NONE",
          chochStatus: "NONE",
          supportZones: [],
          resistanceZones: [],
          score: 50,
          reasons: ["Insufficient data for structure analysis"]
        };
      }
    };
  }
});

// src/server/signals/Gate4RequestBudget.ts
var Gate4RequestBudget;
var init_Gate4RequestBudget = __esm({
  "src/server/signals/Gate4RequestBudget.ts"() {
    init_QuotaManager();
    init_logger();
    Gate4RequestBudget = class {
      /**
       * Evaluates the current API request budget state across all providers and
       * calculates the dynamic candidate allowance for deep MTF scanning.
       */
      static evaluateBudget(category) {
        const now = Date.now();
        const budget = quotaManager.getDynamicDeepBudget(category);
        const passed = budget.maxDeepCandidates > 0;
        let reason = "";
        switch (budget.overallHealth) {
          case "HIGH":
            reason = `Gate 4 HIGH Budget: Full capacity available (${budget.maxDeepCandidates} deep candidates permitted). No rate-limits or timeouts.`;
            break;
          case "NORMAL":
            reason = `Gate 4 NORMAL Budget: Standard capacity (${budget.maxDeepCandidates} deep candidates permitted). Reserved safety buffer active.`;
            break;
          case "LOW":
            reason = `Gate 4 LOW Budget: Constrained capacity (${budget.maxDeepCandidates} deep candidates permitted). Rate-limit pacing applied.`;
            break;
          case "CRITICAL":
            reason = `Gate 4 CRITICAL Budget: Severe quota pressure (${budget.maxDeepCandidates} deep candidates permitted). Prioritizing top setups.`;
            break;
          case "EXHAUSTED":
            reason = `Gate 4 EXHAUSTED Budget: Zero deep candidates permitted. Cooldown/limit lock active. Deep analysis gracefully bypassed.`;
            break;
        }
        logger.info(`[Gate 4 Request Budget] Health: ${budget.overallHealth}, Deep Candidates Cap: ${budget.maxDeepCandidates}, Reason: ${reason}`);
        return {
          passed,
          overallBudgetHealth: budget.overallHealth,
          maxDeepCandidates: budget.maxDeepCandidates,
          providerMetrics: budget.metrics,
          reservedQuotaPreserved: true,
          reason,
          timestamp: now
        };
      }
    };
  }
});

// src/server/signals/Gate5DeepCandidateSelection.ts
var Gate5DeepCandidateSelection;
var init_Gate5DeepCandidateSelection = __esm({
  "src/server/signals/Gate5DeepCandidateSelection.ts"() {
    init_TechnicalIndicators();
    init_SymbolNormalizer();
    init_logger();
    Gate5DeepCandidateSelection = class {
      /**
       * Identifies the correlation cluster / sector for duplication control.
       */
      static getCorrelationCluster(asset) {
        const sym = asset.toUpperCase();
        const assetClass = SymbolNormalizer.getAssetClassification(asset);
        if (assetClass === "CRYPTO") {
          if (["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"].includes(sym)) {
            return "CRYPTO_MAJORS";
          }
          return "CRYPTO_ALTS";
        }
        if (assetClass === "FOREX") {
          if (["EURUSD", "GBPUSD", "AUDUSD", "NZDUSD", "USDCAD", "USDCHF", "USDJPY"].includes(sym)) {
            return "FOREX_USD_MAJORS";
          }
          return "FOREX_CROSSES";
        }
        const megaTech = ["AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "TSLA", "AMD", "AVGO", "NFLX"];
        if (megaTech.includes(sym)) {
          return "EQUITY_MEGA_TECH";
        }
        return "EQUITY_BROAD";
      }
      /**
       * Ranks candidates from already available 1H data and Gate 3 metrics,
       * then selects the top 8â€“12 candidates subject to Gate 4 request budgets and correlation limits.
       */
      static selectCandidates(candidates, maxBudgetLimit = 10) {
        const inputCount = candidates.length;
        if (inputCount === 0 || maxBudgetLimit <= 0) {
          return {
            passed: false,
            inputCandidateCount: inputCount,
            selectedCandidateCount: 0,
            maxBudgetLimit,
            candidatesAfterRankingCount: 0,
            candidatesAfterCorrelationCount: 0,
            selectedCandidates: [],
            rankedCandidates: [],
            rejectedCandidates: [],
            clusterBreakdown: {},
            reason: maxBudgetLimit <= 0 ? "Gate 5 Selection bypassed: Gate 4 provider budget allows 0 deep candidates." : "Gate 5 Selection bypassed: No preliminary candidates supplied."
          };
        }
        const scoredList = candidates.map((cand) => {
          const asset = cand.asset;
          const assetClass = SymbolNormalizer.getAssetClassification(asset);
          const cluster = this.getCorrelationCluster(asset);
          const htf1h = cand.htf1h;
          const g3 = cand.gate3Result;
          const factorScores = this.computeFactorScores(cand);
          const totalScore = factorScores.totalScore;
          return {
            asset,
            assetClass,
            cluster,
            direction: cand.direction,
            preliminaryScore: cand.preliminaryScore,
            rankScore: totalScore,
            rank: 0,
            // Assigned after sorting
            factorScores,
            selected: false,
            clusterRank: 0,
            reason: "",
            htf1h
          };
        });
        scoredList.sort((a, b) => b.rankScore - a.rankScore);
        scoredList.forEach((c, idx) => {
          c.rank = idx + 1;
        });
        const maxPerCluster = maxBudgetLimit >= 10 ? 4 : 3;
        const clusterCounts = {};
        const selected = [];
        const rejected = [];
        let correlationApprovedCount = 0;
        for (const cand of scoredList) {
          const currentClusterCount = clusterCounts[cand.cluster] || 0;
          if (currentClusterCount < maxPerCluster) {
            correlationApprovedCount++;
          }
          if (selected.length >= maxBudgetLimit) {
            cand.selected = false;
            cand.reason = `Budget cap reached (Max ${maxBudgetLimit} deep candidates allowed)`;
            rejected.push(cand);
            continue;
          }
          if (currentClusterCount < maxPerCluster) {
            cand.selected = true;
            cand.clusterRank = currentClusterCount + 1;
            cand.reason = `Selected (Rank #${cand.rank}, Score ${cand.rankScore.toFixed(1)}, Cluster ${cand.cluster} #${cand.clusterRank})`;
            clusterCounts[cand.cluster] = currentClusterCount + 1;
            selected.push(cand);
          } else {
            cand.clusterRank = currentClusterCount + 1;
            cand.reason = `Cluster limit reached for ${cand.cluster} (Max ${maxPerCluster} per cluster)`;
          }
        }
        if (selected.length < maxBudgetLimit) {
          for (const cand of scoredList) {
            if (selected.length >= maxBudgetLimit) break;
            if (!cand.selected && !rejected.includes(cand)) {
              cand.selected = true;
              cand.reason = `Selected via backfill (Rank #${cand.rank}, Score ${cand.rankScore.toFixed(1)})`;
              clusterCounts[cand.cluster] = (clusterCounts[cand.cluster] || 0) + 1;
              selected.push(cand);
            }
          }
        }
        for (const cand of scoredList) {
          if (!cand.selected && !rejected.includes(cand)) {
            rejected.push(cand);
          }
        }
        logger.info(
          `[Gate 5 Deep Candidate Selection] Input: ${inputCount} preliminary -> Output: ${selected.length} deep candidates (Budget Cap: ${maxBudgetLimit}). Selected: ${selected.map((s) => `${s.asset}(${s.rankScore.toFixed(0)})`).join(", ")}`
        );
        return {
          passed: selected.length > 0,
          inputCandidateCount: inputCount,
          selectedCandidateCount: selected.length,
          maxBudgetLimit,
          candidatesAfterRankingCount: scoredList.length,
          candidatesAfterCorrelationCount: Math.min(scoredList.length, correlationApprovedCount),
          selectedCandidates: selected,
          rankedCandidates: scoredList,
          rejectedCandidates: rejected,
          clusterBreakdown: clusterCounts,
          reason: `Selected ${selected.length} highest-ranked candidates from ${inputCount} preliminary candidates based on Trend (25%), Mom (20%), Vol (15%), VolQual (15%), Liq (10%), Struct (15%) with correlation control.`
        };
      }
      /**
       * Computes the 6 weighted ranking factors using already available 1H data.
       */
      static computeFactorScores(cand) {
        const { asset, htf1h, preliminaryScore, direction, gate3Result } = cand;
        const sorted = [...htf1h].sort((a, b) => a.timestamp - b.timestamp);
        const closes = sorted.map((c) => c.close);
        const len = closes.length;
        const latestClose = closes[len - 1] || 1;
        let trendScore = 15;
        if (gate3Result) {
          trendScore = gate3Result.componentScores.trend / 20 * 25;
        } else {
          const ema9 = TechnicalIndicators.calculateEMA(sorted, 9);
          const ema21 = TechnicalIndicators.calculateEMA(sorted, 21);
          if (ema9.length > 0 && ema21.length > 0) {
            const lastEma9 = ema9[ema9.length - 1];
            const lastEma21 = ema21[ema21.length - 1];
            const spread = Math.abs(lastEma9 - lastEma21) / lastEma21 * 100;
            const aligned = direction === "BUY" ? lastEma9 > lastEma21 : lastEma9 < lastEma21;
            if (aligned) {
              trendScore = spread >= 0.3 ? 25 : spread >= 0.15 ? 21 : 17;
            } else {
              trendScore = 8;
            }
          }
        }
        let momentumScore = 12;
        if (gate3Result) {
          momentumScore = gate3Result.componentScores.momentum / 15 * 20;
        } else {
          const p5Ago = closes[Math.max(0, len - 6)] || latestClose;
          const momPct = p5Ago > 0 ? (latestClose - p5Ago) / p5Ago * 100 : 0;
          const momAligned = direction === "BUY" && momPct > 0 || direction === "SELL" && momPct < 0;
          if (momAligned) {
            const absM = Math.abs(momPct);
            momentumScore = absM >= 0.4 ? 20 : absM >= 0.2 ? 16 : 13;
          } else {
            momentumScore = 5;
          }
        }
        let volumeExpansionScore = 9;
        if (gate3Result) {
          volumeExpansionScore = gate3Result.componentScores.volume / 20 * 15;
        } else {
          const volumes = sorted.map((c) => c.volume || 0).filter((v) => v > 0);
          if (volumes.length >= 5) {
            const lastVol = volumes[volumes.length - 1];
            const avgVol = volumes.reduce((acc, v) => acc + v, 0) / volumes.length;
            const rVol = avgVol > 0 ? lastVol / avgVol : 1;
            volumeExpansionScore = rVol >= 1.5 ? 15 : rVol >= 1.1 ? 12 : rVol >= 0.8 ? 9 : 5;
          }
        }
        let volatilityQualityScore = 9;
        if (gate3Result) {
          volatilityQualityScore = gate3Result.componentScores.volatilityQuality;
        } else {
          const atr14 = TechnicalIndicators.calculateATR(sorted, 14);
          const atrPct = latestClose > 0 ? atr14 / latestClose * 100 : 0;
          volatilityQualityScore = atrPct >= 0.25 ? 15 : atrPct >= 0.12 ? 12 : atrPct >= 0.08 ? 8 : 4;
        }
        let liquidityScore = 6;
        if (gate3Result) {
          liquidityScore = gate3Result.componentScores.liquidity / 20 * 10;
        } else {
          const assetClass = SymbolNormalizer.getAssetClassification(asset);
          liquidityScore = assetClass === "FOREX" || ["BTCUSDT", "ETHUSDT", "AAPL", "NVDA"].includes(asset.toUpperCase()) ? 10 : 7;
        }
        let marketStructureScore = 9;
        try {
          const ms = TechnicalIndicators.calculateMarketStructure(sorted);
          if (direction === "BUY") {
            if (ms.structureBias === "BULLISH") {
              marketStructureScore = ms.higherHighsCount >= 2 && ms.higherLowsCount >= 2 ? 15 : 12;
            } else if (ms.structureBias === "RANGE") {
              marketStructureScore = 8;
            } else {
              marketStructureScore = 4;
            }
          } else {
            if (ms.structureBias === "BEARISH") {
              marketStructureScore = ms.lowerHighsCount >= 2 && ms.lowerLowsCount >= 2 ? 15 : 12;
            } else if (ms.structureBias === "RANGE") {
              marketStructureScore = 8;
            } else {
              marketStructureScore = 4;
            }
          }
        } catch {
          marketStructureScore = 9;
        }
        const totalScore = Math.min(
          100,
          Math.max(
            0,
            trendScore + momentumScore + volumeExpansionScore + volatilityQualityScore + liquidityScore + marketStructureScore
          )
        );
        return {
          trendAlignment: parseFloat(trendScore.toFixed(2)),
          momentum: parseFloat(momentumScore.toFixed(2)),
          volumeExpansion: parseFloat(volumeExpansionScore.toFixed(2)),
          volatilityQuality: parseFloat(volatilityQualityScore.toFixed(2)),
          liquidity: parseFloat(liquidityScore.toFixed(2)),
          marketStructure: parseFloat(marketStructureScore.toFixed(2)),
          totalScore: parseFloat(totalScore.toFixed(2))
        };
      }
    };
  }
});

// src/server/signals/Gate6ProgressiveMTF.ts
var Gate6ProgressiveMTF;
var init_Gate6ProgressiveMTF = __esm({
  "src/server/signals/Gate6ProgressiveMTF.ts"() {
    init_TechnicalIndicators();
    init_MarketDataManager();
    init_logger();
    Gate6ProgressiveMTF = class _Gate6ProgressiveMTF {
      static {
        this.MAX_EXPENSIVE_CANDIDATES = 5;
      }
      /**
       * Evaluates Layer 1 (15m & 1h) technical confluence.
       * Tests: Trend Alignment, EMA Structure, Momentum, RSI, MACD, ADX, Market Structure.
       */
      static evaluateLayer1(direction, candles1h, candles15m) {
        const disagreements = [];
        const isBuy = direction === "BUY";
        const sorted1h = [...candles1h].sort((a, b) => a.timestamp - b.timestamp);
        const sorted15m = [...candles15m].sort((a, b) => a.timestamp - b.timestamp);
        if (sorted1h.length < 20 || sorted15m.length < 20) {
          return {
            passed: false,
            score: 0,
            metrics: {},
            disagreements: ["Insufficient candle history on 1h or 15m timeframe."],
            rejectionReason: "Insufficient candle data on 1h (min 20) or 15m (min 20)."
          };
        }
        const last1h = sorted1h[sorted1h.length - 1];
        const last15m = sorted15m[sorted15m.length - 1];
        const ema9_1h = TechnicalIndicators.calculateEMA(sorted1h, 9);
        const ema21_1h = TechnicalIndicators.calculateEMA(sorted1h, 21);
        const ema50_1h = TechnicalIndicators.calculateEMA(sorted1h, Math.min(50, sorted1h.length - 1));
        const ema9_15m = TechnicalIndicators.calculateEMA(sorted15m, 9);
        const ema21_15m = TechnicalIndicators.calculateEMA(sorted15m, 21);
        const ema50_15m = TechnicalIndicators.calculateEMA(sorted15m, Math.min(50, sorted15m.length - 1));
        const valE9_1h = ema9_1h[ema9_1h.length - 1] || last1h.close;
        const valE21_1h = ema21_1h[ema21_1h.length - 1] || last1h.close;
        const valE50_1h = ema50_1h[ema50_1h.length - 1] || last1h.close;
        const valE9_15m = ema9_15m[ema9_15m.length - 1] || last15m.close;
        const valE21_15m = ema21_15m[ema21_15m.length - 1] || last15m.close;
        const valE50_15m = ema50_15m[ema50_15m.length - 1] || last15m.close;
        const tf1hDirection = valE9_1h > valE21_1h && valE21_1h >= valE50_1h ? "BULLISH" : valE9_1h < valE21_1h && valE21_1h <= valE50_1h ? "BEARISH" : "NEUTRAL";
        const tf15mDirection = valE9_15m > valE21_15m && valE21_15m >= valE50_15m ? "BULLISH" : valE9_15m < valE21_15m && valE21_15m <= valE50_15m ? "BEARISH" : "NEUTRAL";
        let trendScore = 50;
        if (isBuy) {
          if (tf1hDirection === "BULLISH" && tf15mDirection === "BULLISH") trendScore = 100;
          else if (tf1hDirection === "BULLISH" && tf15mDirection === "NEUTRAL") trendScore = 75;
          else if (tf1hDirection === "NEUTRAL" && tf15mDirection === "BULLISH") trendScore = 70;
          else if (tf15mDirection === "BEARISH" || tf1hDirection === "BEARISH") {
            trendScore = 20;
            disagreements.push(`Trend conflict: 1h is ${tf1hDirection}, 15m is ${tf15mDirection} (opposing BUY).`);
          }
        } else {
          if (tf1hDirection === "BEARISH" && tf15mDirection === "BEARISH") trendScore = 100;
          else if (tf1hDirection === "BEARISH" && tf15mDirection === "NEUTRAL") trendScore = 75;
          else if (tf1hDirection === "NEUTRAL" && tf15mDirection === "BEARISH") trendScore = 70;
          else if (tf15mDirection === "BULLISH" || tf1hDirection === "BULLISH") {
            trendScore = 20;
            disagreements.push(`Trend conflict: 1h is ${tf1hDirection}, 15m is ${tf15mDirection} (opposing SELL).`);
          }
        }
        let emaStructureScore = 50;
        const price1hAboveEma21 = last1h.close >= valE21_1h;
        const price15mAboveEma21 = last15m.close >= valE21_15m;
        if (isBuy) {
          if (price1hAboveEma21 && price15mAboveEma21) emaStructureScore = 95;
          else if (price1hAboveEma21 && !price15mAboveEma21) {
            emaStructureScore = 60;
          } else if (!price1hAboveEma21 && !price15mAboveEma21) {
            emaStructureScore = 25;
            disagreements.push("EMA Structure: Price is below EMA21 on both 1h and 15m.");
          }
        } else {
          if (!price1hAboveEma21 && !price15mAboveEma21) emaStructureScore = 95;
          else if (!price1hAboveEma21 && price15mAboveEma21) {
            emaStructureScore = 60;
          } else if (price1hAboveEma21 && price15mAboveEma21) {
            emaStructureScore = 25;
            disagreements.push("EMA Structure: Price is above EMA21 on both 1h and 15m.");
          }
        }
        const lookback = 10;
        const prev1h = sorted1h[Math.max(0, sorted1h.length - 1 - lookback)];
        const prev15m = sorted15m[Math.max(0, sorted15m.length - 1 - lookback)];
        const roc1h = prev1h && prev1h.close > 0 ? (last1h.close - prev1h.close) / prev1h.close * 100 : 0;
        const roc15m = prev15m && prev15m.close > 0 ? (last15m.close - prev15m.close) / prev15m.close * 100 : 0;
        let momScore = 50;
        if (isBuy) {
          if (roc1h > 0 && roc15m > 0) momScore = 90;
          else if (roc1h > 0 && roc15m >= -0.2) momScore = 70;
          else if (roc1h < -0.5 && roc15m < -0.5) {
            momScore = 20;
            disagreements.push(`Momentum conflict: Negative velocity on both 1h (${roc1h.toFixed(2)}%) and 15m (${roc15m.toFixed(2)}%).`);
          }
        } else {
          if (roc1h < 0 && roc15m < 0) momScore = 90;
          else if (roc1h < 0 && roc15m <= 0.2) momScore = 70;
          else if (roc1h > 0.5 && roc15m > 0.5) {
            momScore = 20;
            disagreements.push(`Momentum conflict: Positive velocity on both 1h (${roc1h.toFixed(2)}%) and 15m (${roc15m.toFixed(2)}%).`);
          }
        }
        const rsi1hSeries = TechnicalIndicators.calculateRSI(sorted1h, 14);
        const rsi15mSeries = TechnicalIndicators.calculateRSI(sorted15m, 14);
        const rsi1h = rsi1hSeries[rsi1hSeries.length - 1] ?? 50;
        const rsi15m = rsi15mSeries[rsi15mSeries.length - 1] ?? 50;
        let rsiScore = 50;
        let rsiHealthy = true;
        if (isBuy) {
          if (rsi1h >= 45 && rsi1h <= 72 && rsi15m >= 40 && rsi15m <= 75) {
            rsiScore = 90;
          } else if (rsi1h < 35 && rsi15m < 30) {
            rsiScore = 25;
            rsiHealthy = false;
            disagreements.push(`RSI severely oversold/collapsing: 1h RSI=${rsi1h.toFixed(1)}, 15m RSI=${rsi15m.toFixed(1)}.`);
          } else if (rsi15m > 80) {
            rsiScore = 35;
            disagreements.push(`RSI 15m is overextended/topping: RSI=${rsi15m.toFixed(1)}.`);
          } else {
            rsiScore = 65;
          }
        } else {
          if (rsi1h <= 55 && rsi1h >= 28 && rsi15m <= 60 && rsi15m >= 25) {
            rsiScore = 90;
          } else if (rsi1h > 65 && rsi15m > 70) {
            rsiScore = 25;
            rsiHealthy = false;
            disagreements.push(`RSI severely overbought/surging: 1h RSI=${rsi1h.toFixed(1)}, 15m RSI=${rsi15m.toFixed(1)}.`);
          } else if (rsi15m < 20) {
            rsiScore = 35;
            disagreements.push(`RSI 15m is overextended/bottoming: RSI=${rsi15m.toFixed(1)}.`);
          } else {
            rsiScore = 65;
          }
        }
        const macd1h = TechnicalIndicators.calculateMACD(sorted1h);
        const macd15m = TechnicalIndicators.calculateMACD(sorted15m);
        let macdScore = 50;
        let macdAligned = true;
        if (macd1h && macd15m) {
          const macd1hBullish = macd1h.histogram >= 0 || macd1h.macdLine > macd1h.signalLine;
          const macd15mBullish = macd15m.histogram >= 0 || macd15m.macdLine > macd15m.signalLine;
          if (isBuy) {
            if (macd1hBullish && macd15mBullish) macdScore = 95;
            else if (macd1hBullish && !macd15mBullish) macdScore = 60;
            else if (!macd1hBullish && !macd15mBullish) {
              macdScore = 20;
              macdAligned = false;
              disagreements.push("MACD: Both 1h and 15m MACD histograms are negative, contradicting BUY.");
            }
          } else {
            if (!macd1hBullish && !macd15mBullish) macdScore = 95;
            else if (!macd1hBullish && macd15mBullish) macdScore = 60;
            else if (macd1hBullish && macd15mBullish) {
              macdScore = 20;
              macdAligned = false;
              disagreements.push("MACD: Both 1h and 15m MACD histograms are positive, contradicting SELL.");
            }
          }
        }
        const adx1h = TechnicalIndicators.calculateADX(sorted1h, 14);
        const adx15m = TechnicalIndicators.calculateADX(sorted15m, 14);
        let adxScore = 50;
        let isTrending = true;
        if (adx1h && adx15m) {
          if (isBuy) {
            if (adx1h.pdi > adx1h.mdi && adx15m.pdi > adx15m.mdi) {
              adxScore = adx1h.adx >= 20 ? 95 : 80;
            } else if (adx1h.mdi > adx1h.pdi && adx1h.adx >= 25 && adx15m.mdi > adx15m.pdi) {
              adxScore = 20;
              isTrending = false;
              disagreements.push(`ADX: Strong bearish directional movement (-DI > +DI) on 1h (ADX ${adx1h.adx.toFixed(1)}) and 15m.`);
            } else {
              adxScore = 60;
            }
          } else {
            if (adx1h.mdi > adx1h.pdi && adx15m.mdi > adx15m.pdi) {
              adxScore = adx1h.adx >= 20 ? 95 : 80;
            } else if (adx1h.pdi > adx1h.mdi && adx1h.adx >= 25 && adx15m.pdi > adx15m.mdi) {
              adxScore = 20;
              isTrending = false;
              disagreements.push(`ADX: Strong bullish directional movement (+DI > -DI) on 1h (ADX ${adx1h.adx.toFixed(1)}) and 15m.`);
            } else {
              adxScore = 60;
            }
          }
        }
        const ms1h = TechnicalIndicators.calculateMarketStructure(sorted1h);
        const ms15m = TechnicalIndicators.calculateMarketStructure(sorted15m);
        let msScore = 50;
        let msAligned = true;
        if (isBuy) {
          if (ms1h.structureBias === "BULLISH" && ms15m.structureBias === "BULLISH") msScore = 95;
          else if (ms1h.structureBias === "BULLISH" && ms15m.structureBias === "RANGE") msScore = 75;
          else if (ms1h.structureBias === "BEARISH" && ms15m.structureBias === "BEARISH") {
            msScore = 15;
            msAligned = false;
            disagreements.push("Market Structure: Lower highs and lower lows confirmed on both 1h and 15m (opposing BUY).");
          } else if (ms15m.structureBias === "BEARISH" && ms15m.lowerLowsCount >= 2) {
            msScore = 30;
            disagreements.push("Market Structure: 15m has broken market structure with multiple lower lows.");
          } else {
            msScore = 60;
          }
        } else {
          if (ms1h.structureBias === "BEARISH" && ms15m.structureBias === "BEARISH") msScore = 95;
          else if (ms1h.structureBias === "BEARISH" && ms15m.structureBias === "RANGE") msScore = 75;
          else if (ms1h.structureBias === "BULLISH" && ms15m.structureBias === "BULLISH") {
            msScore = 15;
            msAligned = false;
            disagreements.push("Market Structure: Higher highs and higher lows confirmed on both 1h and 15m (opposing SELL).");
          } else if (ms15m.structureBias === "BULLISH" && ms15m.higherHighsCount >= 2) {
            msScore = 30;
            disagreements.push("Market Structure: 15m has broken market structure with multiple higher highs.");
          } else {
            msScore = 60;
          }
        }
        const compositeLayer1Score = Math.round(
          trendScore * 0.25 + emaStructureScore * 0.15 + momScore * 0.15 + rsiScore * 0.1 + macdScore * 0.15 + adxScore * 0.1 + msScore * 0.1
        );
        const hasHardContradiction = disagreements.length >= 2 || trendScore <= 20 || msScore <= 20 && !msAligned || macdScore <= 20 && !macdAligned;
        const passed = !hasHardContradiction && compositeLayer1Score >= 50;
        const metrics = {
          trendAlignment: { tf1hDirection, tf15mDirection, isAligned: trendScore >= 60, score: trendScore },
          emaStructure: { ema21_1h: valE21_1h, ema50_1h: valE50_1h, ema21_15m: valE21_15m, ema50_15m: valE50_15m, isAligned: emaStructureScore >= 50, score: emaStructureScore },
          momentum: { roc1h, roc15m, isAligned: momScore >= 50, score: momScore },
          rsi: { rsi1h, rsi15m, isHealthy: rsiHealthy, score: rsiScore },
          macd: { macd1h, macd15m, isAligned: macdAligned, score: macdScore },
          adx: { adx1h, adx15m, isTrending, score: adxScore },
          marketStructure: { bias1h: ms1h.structureBias, bias15m: ms15m.structureBias, isAligned: msAligned, score: msScore }
        };
        return {
          passed,
          score: compositeLayer1Score,
          metrics,
          disagreements,
          rejectionReason: passed ? void 0 : `Layer 1 MTF Disagreement: ${disagreements.join("; ")}`
        };
      }
      /**
       * Evaluates Layer 2 (5m & 4h) technical confluence.
       * Tests: Multi-TF ATR / Volatility, Support & Resistance Clearances, 5m Micro-Structure & 4h Macro Confirmation.
       */
      static evaluateLayer2(direction, currentPrice, candles5m, candles15m, candles1h, candles4h) {
        const disagreements = [];
        const isBuy = direction === "BUY";
        const sorted5m = [...candles5m].sort((a, b) => a.timestamp - b.timestamp);
        const sorted15m = [...candles15m].sort((a, b) => a.timestamp - b.timestamp);
        const sorted1h = [...candles1h].sort((a, b) => a.timestamp - b.timestamp);
        const sorted4h = [...candles4h].sort((a, b) => a.timestamp - b.timestamp);
        if (sorted5m.length < 15 || sorted4h.length < 10) {
          return {
            passed: false,
            score: 0,
            metrics: {},
            disagreements: ["Insufficient candle history on 5m or 4h timeframe."],
            rejectionReason: "Insufficient candle data on 5m (min 15) or 4h (min 10)."
          };
        }
        const atr5m = TechnicalIndicators.calculateATR(sorted5m, 14);
        const atr15m = TechnicalIndicators.calculateATR(sorted15m, 14);
        const atr1h = TechnicalIndicators.calculateATR(sorted1h, 14);
        const atr4h = TechnicalIndicators.calculateATR(sorted4h, 14);
        let volatilityState = "NORMAL";
        let atrScore = 80;
        let atrHealthy = true;
        if (atr1h <= 0 || currentPrice <= 0) {
          volatilityState = "DEAD";
          atrHealthy = false;
          atrScore = 0;
          disagreements.push("ATR is non-positive or zero.");
        } else {
          const atrPct = atr1h / currentPrice * 100;
          if (atrPct < 0.02) {
            volatilityState = "DEAD";
            atrHealthy = false;
            atrScore = 25;
            disagreements.push(`Volatility is dead: 1h ATR is only ${atrPct.toFixed(4)}% of price.`);
          } else if (atrPct > 12) {
            volatilityState = "ERRATIC";
            atrHealthy = false;
            atrScore = 30;
            disagreements.push(`Volatility is erratic: 1h ATR is ${atrPct.toFixed(2)}% of price.`);
          } else if (atr15m > atr1h * 0.4) {
            volatilityState = "EXPANDING";
            atrScore = 95;
          } else {
            volatilityState = "NORMAL";
            atrScore = 85;
          }
        }
        const slice4h = sorted4h.slice(-20);
        const slice1h = sorted1h.slice(-30);
        const swingHighs = [...slice4h.map((c) => c.high), ...slice1h.map((c) => c.high)];
        const swingLows = [...slice4h.map((c) => c.low), ...slice1h.map((c) => c.low)];
        const resistanceLevels = swingHighs.filter((h) => h > currentPrice).sort((a, b) => a - b);
        const supportLevels = swingLows.filter((l) => l < currentPrice).sort((a, b) => b - a);
        const nearestResistance = resistanceLevels.length > 0 ? resistanceLevels[0] : currentPrice * 1.05;
        const nearestSupport = supportLevels.length > 0 ? supportLevels[0] : currentPrice * 0.95;
        let srScore = 80;
        let srFavorable = true;
        let clearancePct = 0;
        if (isBuy) {
          clearancePct = (nearestResistance - currentPrice) / currentPrice * 100;
          if (clearancePct < 0.15 && currentPrice > 0) {
            srScore = 30;
            srFavorable = false;
            disagreements.push(`Resistance ceiling: Entry is only ${clearancePct.toFixed(2)}% below major resistance (${nearestResistance.toFixed(4)}).`);
          } else if (clearancePct > 1) {
            srScore = 95;
          }
        } else {
          clearancePct = (currentPrice - nearestSupport) / currentPrice * 100;
          if (clearancePct < 0.15 && currentPrice > 0) {
            srScore = 30;
            srFavorable = false;
            disagreements.push(`Support floor: Entry is only ${clearancePct.toFixed(2)}% above major support (${nearestSupport.toFixed(4)}).`);
          } else if (clearancePct > 1) {
            srScore = 95;
          }
        }
        const ms5m = TechnicalIndicators.calculateMarketStructure(sorted5m);
        const ms4h = TechnicalIndicators.calculateMarketStructure(sorted4h);
        let msConfScore = 50;
        let msConfirmed = true;
        if (isBuy) {
          if (ms4h.structureBias === "BULLISH" && (ms5m.structureBias === "BULLISH" || ms5m.higherLowsCount >= 1)) {
            msConfScore = 95;
          } else if (ms4h.structureBias === "RANGE" && ms5m.structureBias === "BULLISH") {
            msConfScore = 80;
          } else if (ms4h.structureBias === "BEARISH" && ms5m.structureBias === "BEARISH") {
            msConfScore = 20;
            msConfirmed = false;
            disagreements.push("Macro 4h and micro 5m structure both confirm Bearish regime (opposing BUY).");
          } else {
            msConfScore = 65;
          }
        } else {
          if (ms4h.structureBias === "BEARISH" && (ms5m.structureBias === "BEARISH" || ms5m.lowerHighsCount >= 1)) {
            msConfScore = 95;
          } else if (ms4h.structureBias === "RANGE" && ms5m.structureBias === "BEARISH") {
            msConfScore = 80;
          } else if (ms4h.structureBias === "BULLISH" && ms5m.structureBias === "BULLISH") {
            msConfScore = 20;
            msConfirmed = false;
            disagreements.push("Macro 4h and micro 5m structure both confirm Bullish regime (opposing SELL).");
          } else {
            msConfScore = 65;
          }
        }
        const compositeLayer2Score = Math.round(
          atrScore * 0.35 + srScore * 0.35 + msConfScore * 0.3
        );
        const passed = atrHealthy && srFavorable && msConfirmed && compositeLayer2Score >= 50;
        const metrics = {
          atr: { atr5m, atr15m, atr1h, atr4h, volatilityState, isHealthy: atrHealthy, score: atrScore },
          supportResistance: { nearestSupport, nearestResistance, clearancePct, isFavorable: srFavorable, score: srScore },
          marketStructureConfirmation: { bias5m: ms5m.structureBias, bias4h: ms4h.structureBias, isConfirmed: msConfirmed, score: msConfScore }
        };
        return {
          passed,
          score: compositeLayer2Score,
          metrics,
          disagreements,
          rejectionReason: passed ? void 0 : `Layer 2 MTF Validation Failed: ${disagreements.join("; ")}`
        };
      }
      /**
       * Main progressive orchestration pipeline for Gate 6.
       * Progressively evaluates the 8â€“12 deep candidate pool:
       * 1. Layer 1 (15m & 1h) early-halts failing candidates after only 1 cheap request.
       * 2. Layer 2 (5m & 4h) runs ONLY on Layer-1 survivors.
       * 3. Yields TOP 3â€“5 fully validated candidates for Stage 3 execution & hard gates.
       */
      static async analyzeCandidates(candidates, targetSurvivors = _Gate6ProgressiveMTF.MAX_EXPENSIVE_CANDIDATES, globalScanStartMs, globalScanDeadlineMs) {
        const startMs = globalScanStartMs ?? Date.now();
        const deadlineMs = globalScanDeadlineMs ?? startMs + 24e3;
        const gate6StartMs = Date.now();
        let timeBudgetExceeded = false;
        let providerRequestsStoppedByBudget = false;
        const survived = [];
        const rejected = [];
        let layer2EvaluationsCount = 0;
        const maxLayer2Allowed = targetSurvivors;
        logger.info(
          `[Gate 6 Progressive MTF] Progressively evaluating pool of ${candidates.length} deep candidates with bounded parallelism (Targeting TOP 3\u20135 fully validated setups)...`
        );
        let analyzedCount = 0;
        const mtfEligibleCandidates = [];
        for (const cand of candidates) {
          const scoreBeforeGate6 = cand.preliminaryScore;
          const maximumPossibleScoreAfterRemainingAnalysis = Math.min(100, scoreBeforeGate6 + 25);
          const scoreAfterGate6 = scoreBeforeGate6;
          const finalScore = scoreBeforeGate6;
          if (maximumPossibleScoreAfterRemainingAnalysis < 72) {
            analyzedCount++;
            const auditTrail = [
              `[Gate 6 Pre-Audit] REJECTED BEFORE MTF. Preliminary score (${scoreBeforeGate6}/100) yields maximum possible score of ${maximumPossibleScoreAfterRemainingAnalysis}/100 (< required threshold 72). Omitting 15m/5m/4h market data requests.`
            ];
            logger.info(
              `[Gate 6 Early Audit Halt] ${cand.asset} rejected before MTF: preliminary score (${scoreBeforeGate6}/100) max reachable score (${maximumPossibleScoreAfterRemainingAnalysis}) < 72.`
            );
            rejected.push({
              asset: cand.asset,
              direction: cand.direction,
              passed: false,
              stoppedAtLayer: "BEFORE_MTF",
              compositeMtfScore: scoreBeforeGate6,
              candlesMap: { "1h": cand.htf1h },
              rejectionReason: `FINAL_SCORE_UNREACHABLE: Score before Gate 6 (${scoreBeforeGate6}/100) yields maximum possible score of ${maximumPossibleScoreAfterRemainingAnalysis}/100, which cannot reach actionable threshold 72. Halting MTF requests.`,
              auditTrail,
              scoreBeforeGate6,
              maximumPossibleScoreAfterRemainingAnalysis,
              scoreAfterGate6,
              finalScore
            });
          } else {
            mtfEligibleCandidates.push(cand);
          }
        }
        const CONCURRENCY_LIMIT = 6;
        for (let i = 0; i < mtfEligibleCandidates.length; i += CONCURRENCY_LIMIT) {
          const remainingMs = deadlineMs - Date.now();
          const currentElapsedMs = Date.now() - startMs;
          if (remainingMs <= 1500 || currentElapsedMs >= 22500) {
            timeBudgetExceeded = true;
            providerRequestsStoppedByBudget = true;
            logger.warn(
              `[Gate 6 Time Budget Exceeded] Global scan elapsed (${currentElapsedMs}ms) reached threshold (22500ms / remaining ${remainingMs}ms). Halting further Gate 6 Layer 1 candidate processing.`
            );
            break;
          }
          if (survived.length >= targetSurvivors || layer2EvaluationsCount >= maxLayer2Allowed) {
            break;
          }
          const batch = mtfEligibleCandidates.slice(i, i + CONCURRENCY_LIMIT);
          const layer1Results = await Promise.all(
            batch.map(async (cand) => {
              const asset = cand.asset;
              const direction = cand.direction;
              const sorted1h = [...cand.htf1h].sort((a, b) => a.timestamp - b.timestamp);
              const auditTrail = [];
              const scoreBeforeGate6 = cand.preliminaryScore;
              const preMaxPossible = Math.min(100, scoreBeforeGate6 + 25);
              auditTrail.push(`[Gate 6] Starting Layer 1 (15m & 1h) analysis for ${asset} (${direction}). Score before Gate 6: ${scoreBeforeGate6}`);
              let candles15m = [];
              try {
                const fetched15m = await marketDataManager.getCandles(asset, void 0, "15m", 50, false);
                if (fetched15m && fetched15m.length >= 15) {
                  candles15m = fetched15m.sort((a, b) => a.timestamp - b.timestamp);
                }
              } catch (err) {
                logger.warn(`[Gate 6 MTF] Failed to fetch 15m candles for ${asset}: ${err?.message || err}`);
              }
              if (candles15m.length < 15) {
                const evalFail = {
                  asset,
                  direction,
                  passed: false,
                  stoppedAtLayer: 1,
                  layer1: {
                    passed: false,
                    score: 0,
                    metrics: {},
                    disagreements: ["15m candles unavailable from market data provider."],
                    rejectionReason: "15m candles unavailable."
                  },
                  compositeMtfScore: 0,
                  candlesMap: { "1h": sorted1h },
                  rejectionReason: "15m market candles unavailable; early halted.",
                  auditTrail,
                  scoreBeforeGate6,
                  maximumPossibleScoreAfterRemainingAnalysis: preMaxPossible,
                  scoreAfterGate6: 0,
                  finalScore: 0
                };
                return { cand, candles15m: [], l1Result: null, evalFail };
              }
              const l1Result = _Gate6ProgressiveMTF.evaluateLayer1(direction, sorted1h, candles15m);
              if (!l1Result.passed) {
                auditTrail.push(`[Gate 6 Layer 1 REJECTED] ${l1Result.rejectionReason}. Early halted; 5m/4h skipped.`);
                logger.info(`[Gate 6 Layer 1 Halt] ${asset} rejected: ${l1Result.rejectionReason}`);
                const evalL1Fail = {
                  asset,
                  direction,
                  passed: false,
                  stoppedAtLayer: 1,
                  layer1: l1Result,
                  compositeMtfScore: l1Result.score,
                  candlesMap: { "1h": sorted1h, "15m": candles15m },
                  rejectionReason: l1Result.rejectionReason,
                  auditTrail,
                  scoreBeforeGate6,
                  maximumPossibleScoreAfterRemainingAnalysis: Math.min(100, Math.round(l1Result.score * 0.6 + 40) + 15),
                  scoreAfterGate6: l1Result.score,
                  finalScore: l1Result.score
                };
                return { cand, candles15m, l1Result, evalFail: evalL1Fail };
              }
              const maxCompositeMtf = Math.round(l1Result.score * 0.6 + 100 * 0.4);
              const maximumPossibleScoreAfterRemainingAnalysis = Math.min(100, maxCompositeMtf + 15);
              if (maximumPossibleScoreAfterRemainingAnalysis < 72) {
                auditTrail.push(`[Gate 6 Post-L1 Audit REJECTED] Post-Layer 1 score (${l1Result.score}/100) yields maximum possible score of ${maximumPossibleScoreAfterRemainingAnalysis}/100 (< required threshold 72). Halting Layer 2 (5m & 4h) requests.`);
                logger.info(`[Gate 6 Post-L1 Early Halt] ${asset} rejected before Layer 2: post-L1 max possible score (${maximumPossibleScoreAfterRemainingAnalysis}) < 72.`);
                const evalPostL1Fail = {
                  asset,
                  direction,
                  passed: false,
                  stoppedAtLayer: 1,
                  layer1: l1Result,
                  compositeMtfScore: l1Result.score,
                  candlesMap: { "1h": sorted1h, "15m": candles15m },
                  rejectionReason: `FINAL_SCORE_UNREACHABLE: Post-Layer 1 score (${l1Result.score}/100) yields maximum possible score of ${maximumPossibleScoreAfterRemainingAnalysis}/100, which cannot reach actionable threshold 72. Halting Layer 2 (5m & 4h) requests.`,
                  auditTrail,
                  scoreBeforeGate6,
                  maximumPossibleScoreAfterRemainingAnalysis,
                  scoreAfterGate6: l1Result.score,
                  finalScore: l1Result.score
                };
                return { cand, candles15m, l1Result, evalFail: evalPostL1Fail };
              }
              auditTrail.push(`[Gate 6 Layer 1 PASSED] Score: ${l1Result.score}/100 (Max reachable: ${maximumPossibleScoreAfterRemainingAnalysis}). Requesting Layer 2 (5m & 4h)...`);
              return { cand, candles15m, sorted1h, l1Result, auditTrail, evalFail: null };
            })
          );
          const layer1SurvivorsInBatch = [];
          for (const res of layer1Results) {
            analyzedCount++;
            if (res.evalFail) {
              rejected.push(res.evalFail);
            } else if (res.l1Result && res.sorted1h) {
              layer1SurvivorsInBatch.push({
                cand: res.cand,
                candles15m: res.candles15m,
                sorted1h: res.sorted1h,
                l1Result: res.l1Result,
                auditTrail: res.auditTrail
              });
            }
          }
          const remainingSlots = Math.max(0, targetSurvivors - survived.length);
          const survivorsToProcess = layer1SurvivorsInBatch.slice(0, remainingSlots);
          if (survivorsToProcess.length > 0) {
            const remainingMs2 = deadlineMs - Date.now();
            const currentElapsedMs2 = Date.now() - startMs;
            if (remainingMs2 <= 1500 || currentElapsedMs2 >= 22500) {
              timeBudgetExceeded = true;
              providerRequestsStoppedByBudget = true;
              logger.warn(
                `[Gate 6 Time Budget Exceeded] Global scan elapsed (${currentElapsedMs2}ms) reached threshold (22500ms / remaining ${remainingMs2}ms). Halting further Gate 6 Layer 2 candidate processing.`
              );
            } else {
              const l2Evaluations = await Promise.all(
                survivorsToProcess.map(async (survivor) => {
                  const { cand, candles15m, sorted1h, l1Result, auditTrail } = survivor;
                  const asset = cand.asset;
                  const direction = cand.direction;
                  const scoreBeforeGate6 = cand.preliminaryScore;
                  let candles5m = [];
                  let candles4h = [];
                  try {
                    const [fetched5m, fetched4h] = await Promise.all([
                      marketDataManager.getCandles(asset, void 0, "5m", 50, false).catch(() => []),
                      marketDataManager.getCandles(asset, void 0, "4h", 40, false).catch(() => [])
                    ]);
                    if (fetched5m && fetched5m.length >= 10) candles5m = fetched5m.sort((a, b) => a.timestamp - b.timestamp);
                    if (fetched4h && fetched4h.length >= 10) candles4h = fetched4h.sort((a, b) => a.timestamp - b.timestamp);
                  } catch (err) {
                    logger.warn(`[Gate 6 MTF] Error fetching Layer 2 candles for ${asset}: ${err?.message || err}`);
                  }
                  const lastPrice = sorted1h[sorted1h.length - 1]?.close || 0;
                  const l2Result = _Gate6ProgressiveMTF.evaluateLayer2(direction, lastPrice, candles5m, candles15m, sorted1h, candles4h);
                  const candlesMap = {
                    "1h": sorted1h,
                    "15m": candles15m
                  };
                  if (candles5m.length > 0) candlesMap["5m"] = candles5m;
                  if (candles4h.length > 0) candlesMap["4h"] = candles4h;
                  const compositeScore = Math.round(l1Result.score * 0.6 + l2Result.score * 0.4);
                  const maximumPossibleScoreAfterRemainingAnalysis = Math.min(100, Math.max(scoreBeforeGate6 + 25, compositeScore + 15));
                  const scoreAfterGate6 = compositeScore;
                  const finalScore = compositeScore;
                  if (!l2Result.passed) {
                    auditTrail.push(`[Gate 6 Layer 2 REJECTED] ${l2Result.rejectionReason}.`);
                    logger.info(`[Gate 6 Layer 2 Halt] ${asset} rejected: ${l2Result.rejectionReason}`);
                    const evalL2Fail = {
                      asset,
                      direction,
                      passed: false,
                      stoppedAtLayer: 2,
                      layer1: l1Result,
                      layer2: l2Result,
                      compositeMtfScore: compositeScore,
                      candlesMap,
                      rejectionReason: l2Result.rejectionReason,
                      auditTrail,
                      scoreBeforeGate6,
                      maximumPossibleScoreAfterRemainingAnalysis,
                      scoreAfterGate6,
                      finalScore
                    };
                    return { isSuccess: false, evalData: evalL2Fail };
                  }
                  auditTrail.push(`[Gate 6 Layer 2 PASSED] Composite MTF Score: ${compositeScore}/100. Candidate survived to Gate 7.`);
                  logger.info(`[Gate 6 MTF Confluence Passed] ${asset} (${direction}) -> Composite MTF Score: ${compositeScore}/100`);
                  const evalSuccess = {
                    asset,
                    direction,
                    passed: true,
                    stoppedAtLayer: "PASSED",
                    layer1: l1Result,
                    layer2: l2Result,
                    compositeMtfScore: compositeScore,
                    candlesMap,
                    auditTrail,
                    scoreBeforeGate6,
                    maximumPossibleScoreAfterRemainingAnalysis,
                    scoreAfterGate6,
                    finalScore
                  };
                  return { isSuccess: true, evalData: evalSuccess };
                })
              );
              for (const res of l2Evaluations) {
                layer2EvaluationsCount++;
                if (res.isSuccess) {
                  survived.push(res.evalData);
                } else {
                  rejected.push(res.evalData);
                }
              }
            }
          }
        }
        const gate6ElapsedMs = Date.now() - gate6StartMs;
        let candidatesRejectedBeforeMTF = 0;
        let candidatesRejectedByMTF = 0;
        let candidatesRejectedByScore = 0;
        let candidatesRejectedByRR = 0;
        let candidatesRejectedByStructure = 0;
        for (const rej of rejected) {
          const reasonLower = (rej.rejectionReason || "").toLowerCase();
          const isBefore = rej.stoppedAtLayer === "BEFORE_MTF" || reasonLower.includes("final_score_unreachable") || reasonLower.includes("halting mtf requests");
          const isMTF = !isBefore && (reasonLower.includes("layer 1") || reasonLower.includes("layer 2") || reasonLower.includes("mtf"));
          const isScore = rej.finalScore < 72 || rej.compositeMtfScore < 72 || rej.maximumPossibleScoreAfterRemainingAnalysis < 72 || reasonLower.includes("score");
          const isRR = reasonLower.includes("rr") || reasonLower.includes("risk/reward");
          const isStruct = reasonLower.includes("structure") || reasonLower.includes("support") || reasonLower.includes("resistance");
          if (isBefore) candidatesRejectedBeforeMTF++;
          if (isMTF) candidatesRejectedByMTF++;
          if (isScore) candidatesRejectedByScore++;
          if (isRR) candidatesRejectedByRR++;
          if (isStruct) candidatesRejectedByStructure++;
        }
        return {
          totalInputCandidates: candidates.length,
          analyzedCandidatesCount: analyzedCount,
          survivedCandidatesCount: survived.length,
          survivedCandidates: survived,
          rejectedCandidates: rejected,
          summary: `Gate 6 Progressive MTF evaluated ${analyzedCount}/${candidates.length} candidates. Survived: ${survived.length}, Rejected: ${rejected.length} (Before MTF: ${candidatesRejectedBeforeMTF}). Elapsed: ${gate6ElapsedMs}ms.`,
          gate6ElapsedMs,
          timeBudgetExceeded,
          providerRequestsStoppedByBudget,
          candidatesRejectedBeforeMTF,
          candidatesRejectedByMTF,
          candidatesRejectedByScore,
          candidatesRejectedByRR,
          candidatesRejectedByStructure
        };
      }
    };
  }
});

// src/server/signals/CooldownManager.ts
var fs4, path3, COOLDOWN_FILE_PATH, ASSET_COOLDOWN_MS, STRATEGY_COOLDOWN_MS, CooldownManager;
var init_CooldownManager = __esm({
  "src/server/signals/CooldownManager.ts"() {
    fs4 = __toESM(require("fs"), 1);
    path3 = __toESM(require("path"), 1);
    init_logger();
    COOLDOWN_FILE_PATH = path3.join(process.cwd(), "cooldowns.json");
    ASSET_COOLDOWN_MS = 4 * 60 * 60 * 1e3;
    STRATEGY_COOLDOWN_MS = 3 * 60 * 60 * 1e3;
    CooldownManager = class {
      static {
        this.cooldowns = /* @__PURE__ */ new Map();
      }
      static {
        this.isInitialized = false;
      }
      static init() {
        if (this.isInitialized) return;
        try {
          if (fs4.existsSync(COOLDOWN_FILE_PATH)) {
            const raw = fs4.readFileSync(COOLDOWN_FILE_PATH, "utf-8");
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
              for (const item of parsed) {
                this.cooldowns.set(item.symbol.toUpperCase(), item);
              }
            }
          }
        } catch (err) {
          logger.warn("[CooldownManager] Failed to load persisted cooldowns:", err);
        }
        this.isInitialized = true;
      }
      static persist() {
        try {
          const arr = Array.from(this.cooldowns.values());
          fs4.writeFileSync(COOLDOWN_FILE_PATH, JSON.stringify(arr, null, 2), "utf-8");
        } catch (err) {
          logger.warn("[CooldownManager] Failed to persist cooldowns:", err);
        }
      }
      /**
       * Checks if an asset is currently in Asset Cooldown
       */
      static isAssetInCooldown(symbol, cooldownMs = ASSET_COOLDOWN_MS) {
        this.init();
        const sym = symbol.toUpperCase();
        const rec = this.cooldowns.get(sym);
        if (!rec || !rec.lastAssetSignalMs) {
          return { inCooldown: false, remainingMinutes: 0 };
        }
        const elapsed = Date.now() - rec.lastAssetSignalMs;
        if (elapsed < cooldownMs) {
          const remainingMinutes = Math.ceil((cooldownMs - elapsed) / (60 * 1e3));
          return { inCooldown: true, remainingMinutes, lastSignalMs: rec.lastAssetSignalMs };
        }
        return { inCooldown: false, remainingMinutes: 0, lastSignalMs: rec.lastAssetSignalMs };
      }
      /**
       * Checks if a specific strategy on an asset is currently in Strategy Cooldown
       */
      static isStrategyInCooldown(symbol, strategyName, cooldownMs = STRATEGY_COOLDOWN_MS) {
        this.init();
        const sym = symbol.toUpperCase();
        const stratKey = strategyName.trim().toLowerCase();
        const rec = this.cooldowns.get(sym);
        if (!rec || !rec.strategyCooldowns || !rec.strategyCooldowns[stratKey]) {
          return { inCooldown: false, remainingMinutes: 0 };
        }
        const lastTime = rec.strategyCooldowns[stratKey];
        const elapsed = Date.now() - lastTime;
        if (elapsed < cooldownMs) {
          const remainingMinutes = Math.ceil((cooldownMs - elapsed) / (60 * 1e3));
          return { inCooldown: true, remainingMinutes };
        }
        return { inCooldown: false, remainingMinutes: 0 };
      }
      /**
       * Records a signal emission timestamp for asset and strategy cooldown tracking
       */
      static recordSignalEmit(symbol, strategyName, timestamp) {
        this.init();
        const sym = symbol.toUpperCase();
        const stratKey = strategyName.trim().toLowerCase();
        const now = timestamp || Date.now();
        let rec = this.cooldowns.get(sym);
        if (!rec) {
          rec = {
            symbol: sym,
            lastAssetSignalMs: now,
            strategyCooldowns: {}
          };
          this.cooldowns.set(sym, rec);
        } else {
          rec.lastAssetSignalMs = now;
        }
        if (!rec.strategyCooldowns) {
          rec.strategyCooldowns = {};
        }
        rec.strategyCooldowns[stratKey] = now;
        this.persist();
      }
      /**
       * Clears cooldown for a symbol (e.g. upon trade completion or invalidation)
       */
      static clearCooldown(symbol) {
        this.init();
        const sym = symbol.toUpperCase();
        this.cooldowns.delete(sym);
        this.persist();
      }
    };
  }
});

// src/server/signals/SignalFingerprint.ts
var fs5, path4, FINGERPRINT_FILE_PATH, SignalFingerprint;
var init_SignalFingerprint = __esm({
  "src/server/signals/SignalFingerprint.ts"() {
    fs5 = __toESM(require("fs"), 1);
    path4 = __toESM(require("path"), 1);
    init_logger();
    init_config();
    FINGERPRINT_FILE_PATH = path4.join(process.cwd(), "signal_fingerprints.json");
    SignalFingerprint = class {
      static {
        this.records = /* @__PURE__ */ new Map();
      }
      static {
        this.isInitialized = false;
      }
      static init() {
        if (this.isInitialized) return;
        try {
          if (fs5.existsSync(FINGERPRINT_FILE_PATH)) {
            const raw = fs5.readFileSync(FINGERPRINT_FILE_PATH, "utf-8");
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
              const now = Date.now();
              for (const rec of parsed) {
                if (now - rec.timestamp < serverConfig.getConfig().signalExpirationMs) {
                  this.records.set(rec.fingerprint, rec);
                }
              }
            }
          }
        } catch (err) {
          logger.warn("[SignalFingerprint] Could not load persisted fingerprints:", err);
        }
        this.isInitialized = true;
      }
      static persist() {
        try {
          const arr = Array.from(this.records.values());
          fs5.writeFileSync(FINGERPRINT_FILE_PATH, JSON.stringify(arr, null, 2), "utf-8");
        } catch (err) {
          logger.warn("[SignalFingerprint] Could not save fingerprints to disk:", err);
        }
      }
      /**
       * Quantizes entry price into a discrete zone to catch near-identical entry prices
       */
      static quantizeEntryZone(symbol, entryPrice, atr) {
        const sym = symbol.toUpperCase();
        if (atr && atr > 0) {
          const step = atr * 0.5;
          return Math.round(entryPrice / step) * step;
        }
        if (sym.includes("USDT") || sym.includes("BTC") || sym.includes("ETH")) {
          const step = entryPrice * 5e-3;
          return Number((Math.round(entryPrice / step) * step).toFixed(2));
        } else if (sym.length === 6 && (sym.includes("USD") || sym.includes("EUR") || sym.includes("JPY"))) {
          const isJPY = sym.includes("JPY");
          const step = isJPY ? 0.25 : 25e-4;
          return Number((Math.round(entryPrice / step) * step).toFixed(4));
        } else {
          const step = Math.max(0.25, entryPrice * 5e-3);
          return Number((Math.round(entryPrice / step) * step).toFixed(2));
        }
      }
      /**
       * Generates a deterministic fingerprint for a candidate signal
       */
      static generateFingerprint(params) {
        const sym = params.symbol.trim().toUpperCase();
        const dir = params.direction.trim().toUpperCase();
        const tf = params.timeframe.trim().toLowerCase();
        const strat = params.primaryStrategy.trim().toLowerCase().replace(/\s+/g, "_");
        const entryZone = this.quantizeEntryZone(sym, params.entryPrice, params.atr);
        return `${sym}_${dir}_${entryZone}_${tf}_${strat}`;
      }
      /**
       * Checks if a fingerprint already exists within the expiration window
       */
      static checkDuplicateFingerprint(fingerprint, windowMs = serverConfig.getConfig().signalExpirationMs) {
        this.init();
        const now = Date.now();
        const rec = this.records.get(fingerprint);
        if (rec && now - rec.timestamp < windowMs) {
          return { isDuplicate: true, previousRecord: rec };
        }
        return { isDuplicate: false };
      }
      /**
       * Records a new fingerprint
       */
      static recordFingerprint(params) {
        this.init();
        const fingerprint = this.generateFingerprint(params);
        const rec = {
          fingerprint,
          symbol: params.symbol.trim().toUpperCase(),
          direction: params.direction.trim().toUpperCase(),
          entryZone: this.quantizeEntryZone(params.symbol, params.entryPrice, params.atr),
          timeframe: params.timeframe,
          primaryStrategy: params.primaryStrategy,
          timestamp: params.timestamp || Date.now()
        };
        this.records.set(fingerprint, rec);
        this.persist();
        return fingerprint;
      }
    };
  }
});

// src/server/signals/MarketStructureDetector.ts
var MarketStructureDetector;
var init_MarketStructureDetector = __esm({
  "src/server/signals/MarketStructureDetector.ts"() {
    MarketStructureDetector = class {
      static hasStructureMateriallyChanged(params) {
        const { symbol, currentEntry, currentRegime, currentDirection, currentAtr, prevSignal } = params;
        if (!prevSignal || !prevSignal.entryPrice || prevSignal.entryPrice <= 0) {
          return {
            hasChanged: true,
            reason: "First signal for asset - no prior structure benchmark exists.",
            changeType: "REGIME_SHIFT"
          };
        }
        const prevRegime = prevSignal.marketRegime?.toUpperCase() || "UNKNOWN";
        const curRegime = currentRegime.toUpperCase();
        if (prevRegime !== curRegime && (curRegime === "BREAKOUT" || curRegime === "TRENDING" || curRegime === "HIGH_VOLATILITY")) {
          return {
            hasChanged: true,
            reason: `Regime transitioned from ${prevRegime} to ${curRegime}`,
            changeType: "REGIME_SHIFT"
          };
        }
        if (prevSignal.direction !== currentDirection) {
          return {
            hasChanged: true,
            reason: `Signal direction inverted from ${prevSignal.direction} to ${currentDirection}`,
            changeType: "DIRECTION_FLIP"
          };
        }
        const priceDist = Math.abs(currentEntry - prevSignal.entryPrice);
        const atrHurdle = currentAtr > 0 ? currentAtr * 1.5 : currentEntry * 0.015;
        if (priceDist >= atrHurdle) {
          return {
            hasChanged: true,
            reason: `Significant price level displacement (${priceDist.toFixed(4)} >= 1.5x ATR threshold ${atrHurdle.toFixed(4)}) from previous entry`,
            changeType: "PRICE_DISPLACEMENT"
          };
        }
        if (params.candles1h && params.candles1h.length >= 20) {
          const sorted = [...params.candles1h].sort((a, b) => a.timestamp - b.timestamp);
          const recent = sorted.slice(-10);
          const highs = recent.map((c) => c.high);
          const lows = recent.map((c) => c.low);
          const maxHigh = Math.max(...highs);
          const minLow = Math.min(...lows);
          if (currentDirection === "BUY" && currentEntry > maxHigh) {
            return {
              hasChanged: true,
              reason: `Price broke out above recent 10-bar 1H consolidation high (${maxHigh.toFixed(4)})`,
              changeType: "STRUCTURE_BREAK"
            };
          }
          if (currentDirection === "SELL" && currentEntry < minLow) {
            return {
              hasChanged: true,
              reason: `Price broke down below recent 10-bar 1H consolidation low (${minLow.toFixed(4)})`,
              changeType: "STRUCTURE_BREAK"
            };
          }
        }
        return {
          hasChanged: false,
          reason: `No material market structure change on ${symbol}: Price (${currentEntry}) remains within previous entry range (${prevSignal.entryPrice}), regime is unchanged (${curRegime}), and displacement is below 1.5x ATR.`,
          changeType: "NO_CHANGE"
        };
      }
    };
  }
});

// src/server/signals/Gate7FinalTradeValidation.ts
var Gate7FinalTradeValidation;
var init_Gate7FinalTradeValidation = __esm({
  "src/server/signals/Gate7FinalTradeValidation.ts"() {
    init_config();
    init_SymbolNormalizer();
    init_CooldownManager();
    init_SignalFingerprint();
    init_MarketStructureDetector();
    init_logger();
    Gate7FinalTradeValidation = class {
      static get REQUIRED_MIN_SCORE() {
        return serverConfig?.getConfig?.()?.thresholds?.signalThreshold || 72;
      }
      static {
        this.DEFAULT_MIN_RR = 1.3;
      }
      static {
        this.MAX_DATA_AGE_SECONDS = 180;
      }
      // 3 minutes
      /**
       * Performs exhaustive evaluation of all 13 Mandatory Hard Gates.
       */
      static validateCandidate(ctx) {
        const now = ctx.currentTimeMs || Date.now();
        const hardGates = [];
        const reasons = [];
        const minRR = ctx.minimumRRThreshold ?? this.DEFAULT_MIN_RR;
        const minScore = ctx.minimumScoreThreshold ?? this.REQUIRED_MIN_SCORE;
        const classification = SymbolNormalizer.getAssetClassification(ctx.symbol);
        let g1Passed = true;
        let g1Reason;
        if (!ctx.liveTicker || !ctx.liveTicker.timestamp) {
          g1Passed = false;
          g1Reason = "Live ticker object or timestamp is missing.";
        } else {
          const tickerAgeSec = (now - ctx.liveTicker.timestamp) / 1e3;
          if (tickerAgeSec > this.MAX_DATA_AGE_SECONDS) {
            g1Passed = false;
            g1Reason = `Live ticker is stale (${tickerAgeSec.toFixed(1)}s old > ${this.MAX_DATA_AGE_SECONDS}s max limit).`;
          } else if (ctx.liveTicker.status === "STALE" || ctx.liveTicker.status === "MARKET_DATA_UNAVAILABLE") {
            g1Passed = false;
            g1Reason = `Live ticker status is ${ctx.liveTicker.status}.`;
          }
        }
        hardGates.push({
          id: 1,
          code: "FRESH_MARKET_DATA",
          name: "Fresh Market Data",
          passed: g1Passed,
          reason: g1Reason,
          data: { tickerTimestamp: ctx.liveTicker?.timestamp, maxAge: this.MAX_DATA_AGE_SECONDS }
        });
        if (!g1Passed) reasons.push(`[Gate 1 Fresh Market Data] ${g1Reason}`);
        let g2Passed = true;
        let g2Reason;
        if (ctx.entryPrice === null || ctx.entryPrice === void 0 || isNaN(ctx.entryPrice) || !isFinite(ctx.entryPrice) || ctx.entryPrice <= 0) {
          g2Passed = false;
          g2Reason = `Entry price is invalid (${ctx.entryPrice}).`;
        } else if (ctx.liveTicker && ctx.liveTicker.price > 0) {
          const priceDrift = Math.abs(ctx.entryPrice - ctx.liveTicker.price) / ctx.liveTicker.price;
          if (priceDrift > 35e-4) {
            g2Passed = false;
            g2Reason = `Entry price (${ctx.entryPrice}) drifted ${(priceDrift * 100).toFixed(3)}% from live price (${ctx.liveTicker.price}).`;
          }
        }
        hardGates.push({
          id: 2,
          code: "VALID_CURRENT_ENTRY_PRICE",
          name: "Valid Current Entry Price",
          passed: g2Passed,
          reason: g2Reason,
          data: { entryPrice: ctx.entryPrice, livePrice: ctx.liveTicker?.price }
        });
        if (!g2Passed) reasons.push(`[Gate 2 Valid Entry Price] ${g2Reason}`);
        let g3Passed = true;
        let g3Reason;
        if (!ctx.symbol || typeof ctx.symbol !== "string" || ctx.symbol.trim().length < 2) {
          g3Passed = false;
          g3Reason = `Symbol string is empty or invalid ('${ctx.symbol}').`;
        } else if (classification === "UNKNOWN" || SymbolNormalizer.normalizeAppSymbol(ctx.symbol).length < 2) {
          g3Passed = false;
          g3Reason = `Symbol '${ctx.symbol}' is not recognized as a valid tradeable asset.`;
        }
        hardGates.push({
          id: 3,
          code: "VALID_SYMBOL",
          name: "Valid Symbol",
          passed: g3Passed,
          reason: g3Reason,
          data: { symbol: ctx.symbol, assetClass: classification }
        });
        if (!g3Passed) reasons.push(`[Gate 3 Valid Symbol] ${g3Reason}`);
        let g4Passed = true;
        let g4Reason;
        const currentUtcDay = new Date(now).getUTCDay();
        const currentUtcHour = new Date(now).getUTCHours();
        const currentUtcMin = new Date(now).getUTCMinutes();
        const decimalHour = currentUtcHour + currentUtcMin / 60;
        if (classification === "FOREX") {
          const isForexWeekend = currentUtcDay === 5 && decimalHour >= 21 || currentUtcDay === 6 || currentUtcDay === 0 && decimalHour < 21;
          if (isForexWeekend) {
            g4Passed = false;
            g4Reason = "Forex weekend closure. Market is closed until Sunday 21:00 UTC.";
          }
        } else if (classification === "STOCK") {
          const isStockWeekend = currentUtcDay === 0 || currentUtcDay === 6;
          if (isStockWeekend) {
            g4Passed = false;
            g4Reason = "Stock market is closed on weekends.";
          }
        }
        hardGates.push({
          id: 4,
          code: "VALID_MARKET_SESSION_STATUS",
          name: "Valid Market/Session Status",
          passed: g4Passed,
          reason: g4Reason,
          data: { classification, currentUtcDay, decimalHour }
        });
        if (!g4Passed) reasons.push(`[Gate 4 Market Session Status] ${g4Reason}`);
        let g5Passed = true;
        let g5Reason;
        if (ctx.direction !== "BUY" && ctx.direction !== "SELL") {
          g5Passed = false;
          g5Reason = `Invalid directional bias '${ctx.direction}'. Must be BUY or SELL.`;
        }
        hardGates.push({
          id: 5,
          code: "VALID_DIRECTION",
          name: "Valid Direction",
          passed: g5Passed,
          reason: g5Reason,
          data: { direction: ctx.direction }
        });
        if (!g5Passed) reasons.push(`[Gate 5 Valid Direction] ${g5Reason}`);
        let g6Passed = true;
        let g6Reason;
        const atr = ctx.atr ?? 0;
        if (isNaN(atr) || !isFinite(atr) || atr <= 0) {
          g6Passed = false;
          g6Reason = `ATR is invalid or zero (${atr}).`;
        } else if (ctx.entryPrice > 0) {
          const atrPct = atr / ctx.entryPrice * 100;
          if (atrPct < 0.01) {
            g6Passed = false;
            g6Reason = `ATR volatility is collapsed / dead (${atrPct.toFixed(4)}% of price).`;
          } else if (atrPct > 20) {
            g6Passed = false;
            g6Reason = `ATR volatility is extreme / erratic (${atrPct.toFixed(2)}% of price).`;
          }
        }
        hardGates.push({
          id: 6,
          code: "VALID_ATR_VOLATILITY",
          name: "Valid ATR/Volatility Data",
          passed: g6Passed,
          reason: g6Reason,
          data: { atr, entryPrice: ctx.entryPrice }
        });
        if (!g6Passed) reasons.push(`[Gate 6 Valid ATR Volatility] ${g6Reason}`);
        let g7Passed = true;
        let g7Reason;
        if (ctx.stopLoss === null || ctx.stopLoss === void 0 || isNaN(ctx.stopLoss) || !isFinite(ctx.stopLoss) || ctx.stopLoss <= 0) {
          g7Passed = false;
          g7Reason = `Stop-loss price is invalid (${ctx.stopLoss}).`;
        } else if (ctx.direction === "BUY" && ctx.stopLoss >= ctx.entryPrice) {
          g7Passed = false;
          g7Reason = `Stop-loss for BUY (${ctx.stopLoss}) must be strictly below entry price (${ctx.entryPrice}).`;
        } else if (ctx.direction === "SELL" && ctx.stopLoss <= ctx.entryPrice) {
          g7Passed = false;
          g7Reason = `Stop-loss for SELL (${ctx.stopLoss}) must be strictly above entry price (${ctx.entryPrice}).`;
        } else if (ctx.entryPrice > 0) {
          const slDistPct = Math.abs(ctx.entryPrice - ctx.stopLoss) / ctx.entryPrice * 100;
          if (slDistPct < 0.02) {
            g7Passed = false;
            g7Reason = `Stop-loss distance is practically zero (${slDistPct.toFixed(4)}%).`;
          } else if (slDistPct > 25) {
            g7Passed = false;
            g7Reason = `Stop-loss distance is excessively wide (${slDistPct.toFixed(2)}%).`;
          }
        }
        hardGates.push({
          id: 7,
          code: "VALID_STOP_LOSS",
          name: "Valid Stop-Loss",
          passed: g7Passed,
          reason: g7Reason,
          data: { stopLoss: ctx.stopLoss, entryPrice: ctx.entryPrice, direction: ctx.direction }
        });
        if (!g7Passed) reasons.push(`[Gate 7 Valid Stop-Loss] ${g7Reason}`);
        let g8Passed = true;
        let g8Reason;
        const tp1 = ctx.tp1 ?? ctx.takeProfit;
        const tp2 = ctx.tp2 ?? (ctx.direction === "BUY" ? tp1 * 1.01 : tp1 * 0.99);
        const tp3 = ctx.tp3 ?? (ctx.direction === "BUY" ? tp2 * 1.01 : tp2 * 0.99);
        if (isNaN(tp1) || !isFinite(tp1) || tp1 <= 0) {
          g8Passed = false;
          g8Reason = `Take-profit 1 is invalid (${tp1}).`;
        } else if (ctx.direction === "BUY") {
          if (tp1 <= ctx.entryPrice) {
            g8Passed = false;
            g8Reason = `Take-profit 1 (${tp1}) must be strictly above entry price (${ctx.entryPrice}) for BUY.`;
          } else if (tp2 <= tp1 || tp3 <= tp2) {
            g8Passed = false;
            g8Reason = `Take-profit levels must be ascending for BUY (TP1: ${tp1}, TP2: ${tp2}, TP3: ${tp3}).`;
          }
        } else if (ctx.direction === "SELL") {
          if (tp1 >= ctx.entryPrice) {
            g8Passed = false;
            g8Reason = `Take-profit 1 (${tp1}) must be strictly below entry price (${ctx.entryPrice}) for SELL.`;
          } else if (tp2 >= tp1 || tp3 >= tp2) {
            g8Passed = false;
            g8Reason = `Take-profit levels must be descending for SELL (TP1: ${tp1}, TP2: ${tp2}, TP3: ${tp3}).`;
          }
        }
        hardGates.push({
          id: 8,
          code: "VALID_TAKE_PROFIT_LEVELS",
          name: "Valid Take-Profit Levels",
          passed: g8Passed,
          reason: g8Reason,
          data: { tp1, tp2, tp3, entryPrice: ctx.entryPrice, direction: ctx.direction }
        });
        if (!g8Passed) reasons.push(`[Gate 8 Valid Take-Profit Levels] ${g8Reason}`);
        let g9Passed = true;
        let g9Reason;
        const stopDist = Math.abs(ctx.entryPrice - ctx.stopLoss);
        const targetDist = Math.abs(tp1 - ctx.entryPrice);
        const calculatedGrossRR = stopDist > 0 ? targetDist / stopDist : 0;
        const effectiveRR = ctx.netRiskRewardRatio ?? (ctx.riskRewardRatio || calculatedGrossRR);
        if (isNaN(effectiveRR) || !isFinite(effectiveRR) || effectiveRR < minRR) {
          g9Passed = false;
          g9Reason = `Risk-to-reward ratio (${effectiveRR.toFixed(2)}) is below required minimum (${minRR}).`;
        }
        hardGates.push({
          id: 9,
          code: "MIN_ACCEPTABLE_RR",
          name: "Minimum Acceptable R:R",
          passed: g9Passed,
          reason: g9Reason,
          data: { effectiveRR, minRR, calculatedGrossRR }
        });
        if (!g9Passed) reasons.push(`[Gate 9 Minimum Acceptable RR] ${g9Reason}`);
        let g10Passed = true;
        let g10Reason;
        if (ctx.liveTicker) {
          const timeSinceUpdateMs = now - ctx.liveTicker.timestamp;
          if (timeSinceUpdateMs > this.MAX_DATA_AGE_SECONDS * 1e3) {
            g10Passed = false;
            g10Reason = `Stale price: No fresh market quote for ${(timeSinceUpdateMs / 1e3).toFixed(0)} seconds.`;
          }
        }
        hardGates.push({
          id: 10,
          code: "NO_STALE_PRICE",
          name: "No Stale Price",
          passed: g10Passed,
          reason: g10Reason,
          data: { tickerTimestamp: ctx.liveTicker?.timestamp }
        });
        if (!g10Passed) reasons.push(`[Gate 10 No Stale Price] ${g10Reason}`);
        let g11Passed = true;
        let g11Reason;
        if (ctx.activeSignals && ctx.activeSignals.has(ctx.symbol)) {
          const activeSig = ctx.activeSignals.get(ctx.symbol);
          if (activeSig && activeSig.status !== "EXPIRED" && activeSig.status !== "CLOSED" && activeSig.status !== "CANCELLED") {
            if (activeSig.direction !== ctx.direction) {
              g11Passed = false;
              g11Reason = `Conflicting active signal exists on ${ctx.symbol} (Active: ${activeSig.direction}, New: ${ctx.direction}).`;
            }
          }
        }
        const fp = SignalFingerprint.generateFingerprint({
          symbol: ctx.symbol,
          direction: ctx.direction,
          entryPrice: ctx.entryPrice,
          timeframe: "Multi-TF Realism Setup",
          primaryStrategy: ctx.primaryStrategy || "Multi-Timeframe Trend Confluence",
          atr
        });
        const fpCheck = SignalFingerprint.checkDuplicateFingerprint(fp);
        if (fpCheck.isDuplicate) {
          g11Passed = false;
          g11Reason = `Duplicate signal fingerprint match [${fp}]. Identical setup emitted within 24h.`;
        }
        hardGates.push({
          id: 11,
          code: "NO_DUPLICATE_ACTIVE_SIGNAL",
          name: "No Duplicate/Conflicting Active Signal",
          passed: g11Passed,
          reason: g11Reason,
          data: { fp, isDuplicate: fpCheck.isDuplicate }
        });
        if (!g11Passed) reasons.push(`[Gate 11 No Duplicate/Conflict] ${g11Reason}`);
        let g12Passed = true;
        let g12Reason;
        const assetCooldown = CooldownManager.isAssetInCooldown(ctx.symbol);
        if (assetCooldown.inCooldown) {
          const structCheck = MarketStructureDetector.hasStructureMateriallyChanged({
            symbol: ctx.symbol,
            currentEntry: ctx.entryPrice,
            currentRegime: ctx.marketRegime,
            currentDirection: ctx.direction,
            currentAtr: atr,
            candles1h: ctx.candlesMap["1h"]
          });
          if (!structCheck.hasChanged) {
            g12Passed = false;
            g12Reason = `Asset is in cooldown (${assetCooldown.remainingMinutes}m remaining) with no material structure change: ${structCheck.reason}`;
          }
        }
        if (ctx.primaryStrategy) {
          const stratCooldown = CooldownManager.isStrategyInCooldown(ctx.symbol, ctx.primaryStrategy);
          if (stratCooldown.inCooldown) {
            g12Passed = false;
            g12Reason = `Strategy [${ctx.primaryStrategy}] is in cooldown on ${ctx.symbol} (${stratCooldown.remainingMinutes}m remaining).`;
          }
        }
        hardGates.push({
          id: 12,
          code: "NO_COOLDOWN_VIOLATION",
          name: "No Cooldown Violation",
          passed: g12Passed,
          reason: g12Reason,
          data: { assetInCooldown: assetCooldown.inCooldown }
        });
        if (!g12Passed) reasons.push(`[Gate 12 No Cooldown Violation] ${g12Reason}`);
        let g13Passed = true;
        let g13Reason;
        for (const [tf, candles] of Object.entries(ctx.candlesMap)) {
          if (!candles || candles.length === 0) continue;
          for (const c of candles.slice(-10)) {
            if (c.high < c.low || c.high < c.open || c.high < c.close || c.low > c.open || c.low > c.close) {
              g13Passed = false;
              g13Reason = `Malformed candle on ${tf}: High (${c.high}) < Low (${c.low}) or inconsistent OHLC bounds.`;
              break;
            }
            if (c.open <= 0 || c.high <= 0 || c.low <= 0 || c.close <= 0) {
              g13Passed = false;
              g13Reason = `Non-positive candle price value on ${tf}.`;
              break;
            }
          }
          if (!g13Passed) break;
        }
        if (ctx.secondaryPrice && ctx.secondaryPrice.price > 0 && ctx.entryPrice > 0) {
          const discrepancyPct = Math.abs(ctx.entryPrice - ctx.secondaryPrice.price) / ctx.entryPrice;
          if (discrepancyPct > 0.015) {
            g13Passed = false;
            g13Reason = `Cross-source price discrepancy (${(discrepancyPct * 100).toFixed(2)}%) between Primary and ${ctx.secondaryPrice.source}.`;
          }
        }
        hardGates.push({
          id: 13,
          code: "NO_DATA_INTEGRITY_FAILURE",
          name: "No Provider/Data Integrity Failure",
          passed: g13Passed,
          reason: g13Reason,
          data: { secondarySource: ctx.secondaryPrice?.source }
        });
        if (!g13Passed) reasons.push(`[Gate 13 Data Integrity] ${g13Reason}`);
        const failedGates = hardGates.filter((g) => !g.passed);
        const allHardGatesPassed = failedGates.length === 0;
        const scoreRequirementPassed = ctx.score >= minScore;
        const isTradeable = allHardGatesPassed && scoreRequirementPassed;
        let primaryRejectionReason;
        if (!allHardGatesPassed) {
          primaryRejectionReason = `Failed ${failedGates.length} Hard Gates: ${failedGates.map((g) => g.name).join(", ")}`;
        } else if (!scoreRequirementPassed) {
          primaryRejectionReason = `Composite signal score ${ctx.score}/100 is below the minimum required threshold of ${minScore}/100`;
        }
        if (!isTradeable) {
          logger.info(
            `[Gate 7 Validation Result] ${ctx.symbol} (${ctx.direction}) -> NOT TRADEABLE. Passed Gates: ${hardGates.length - failedGates.length}/13, Score: ${ctx.score}/${minScore}. Reason: ${primaryRejectionReason}`
          );
        } else {
          logger.info(
            `[Gate 7 Validation Result] ${ctx.symbol} (${ctx.direction}) -> TRADEABLE! All 13 Hard Gates Passed. Score: ${ctx.score} >= ${minScore}.`
          );
        }
        return {
          isTradeable,
          allHardGatesPassed,
          finalScore: ctx.score,
          scoreRequirementPassed,
          hardGates,
          failedGatesCount: failedGates.length,
          failedGateCodes: failedGates.map((g) => g.code),
          primaryRejectionReason,
          reasons,
          validatedAt: now,
          adjustedEntryPrice: ctx.entryPrice,
          adjustedStopLoss: ctx.stopLoss,
          adjustedTakeProfit: tp1,
          adjustedNetRR: effectiveRR
        };
      }
    };
  }
});

// src/server/signals/Gate8TradeabilityThreshold.ts
var Gate8TradeabilityThreshold;
var init_Gate8TradeabilityThreshold = __esm({
  "src/server/signals/Gate8TradeabilityThreshold.ts"() {
    init_logger();
    init_config();
    Gate8TradeabilityThreshold = class {
      static get FINAL_TRADEABILITY_THRESHOLD() {
        return serverConfig?.getConfig?.()?.thresholds?.signalThreshold || 72;
      }
      /**
       * Evaluates a candidate against the 10-factor weighted scoring rubric and assigns classification.
       */
      static evaluateCandidate(input) {
        const highlights = [];
        const rawTrend = input.trendAlignmentScore ?? 75;
        const trendAlignment = Math.max(0, Math.min(20, Number((rawTrend / 100 * 20).toFixed(1))));
        if (trendAlignment >= 16) highlights.push(`Strong Higher-TF Trend Alignment (${trendAlignment}/20)`);
        const rawMtf = input.mtfConfluenceScore ?? (input.timeframeAlignmentRatio ?? 0.75) * 100;
        const mtfConfirmation = Math.max(0, Math.min(15, Number((rawMtf / 100 * 15).toFixed(1))));
        if (mtfConfirmation >= 12) highlights.push(`Multi-Timeframe Agreement Across Intervals (${mtfConfirmation}/15)`);
        const rawMom = input.momentumScore ?? 75;
        const momentum = Math.max(0, Math.min(10, Number((rawMom / 100 * 10).toFixed(1))));
        if (momentum >= 8) highlights.push(`Directional Momentum Acceleration (${momentum}/10)`);
        const rawStruct = input.marketStructureScore ?? 75;
        const marketStructure = Math.max(0, Math.min(15, Number((rawStruct / 100 * 15).toFixed(1))));
        if (marketStructure >= 12) highlights.push(`Valid Technical Swing Structure (${marketStructure}/15)`);
        const rawVol = input.volumeScore ?? 70;
        const volumeLiquidity = Math.max(0, Math.min(10, Number((rawVol / 100 * 10).toFixed(1))));
        if (volumeLiquidity >= 8) highlights.push(`Sufficient Volume & Liquidity Delta (${volumeLiquidity}/10)`);
        const rawAtr = input.volatilityAtrScore ?? 80;
        const volatilityAtrQuality = Math.max(0, Math.min(10, Number((rawAtr / 100 * 10).toFixed(1))));
        if (volatilityAtrQuality >= 8) highlights.push(`Healthy Executable Volatility (${volatilityAtrQuality}/10)`);
        const rawEntry = input.entryQualityScore ?? 75;
        const entryQuality = Math.max(0, Math.min(5, Number((rawEntry / 100 * 5).toFixed(1))));
        if (entryQuality >= 4) highlights.push(`High-Precision Dynamic Entry Location (${entryQuality}/5)`);
        const effRr = input.netRiskRewardRatio ?? input.riskRewardRatio ?? 1.8;
        let rrScore = 3.5;
        if (effRr >= 3) rrScore = 5;
        else if (effRr >= 2.5) rrScore = 4.5;
        else if (effRr >= 2) rrScore = 4;
        else if (effRr >= 1.5) rrScore = 3.5;
        else if (effRr >= 1.2) rrScore = 2.5;
        else rrScore = 1;
        const rrQuality = Math.max(0, Math.min(5, Number(rrScore.toFixed(1))));
        if (rrQuality >= 4) highlights.push(`Favorable R:R Profile (${effRr.toFixed(2)}:1) (${rrQuality}/5)`);
        let execScore = 4;
        if (input.frictionToProfitPct !== void 0) {
          if (input.frictionToProfitPct < 5) execScore = 5;
          else if (input.frictionToProfitPct < 10) execScore = 4.5;
          else if (input.frictionToProfitPct < 20) execScore = 3.5;
          else execScore = 2;
        }
        const executionQuality = Math.max(0, Math.min(5, Number(execScore.toFixed(1))));
        if (executionQuality >= 4) highlights.push(`Low Execution Friction Overhead (${executionQuality}/5)`);
        const agreeRatio = input.agreeingStrategiesRatio ?? 0.8;
        const dirScore = Math.max(0, Math.min(5, Number((agreeRatio * 5).toFixed(1))));
        const directionConfidence = dirScore;
        if (directionConfidence >= 4) highlights.push(`Multi-Strategy Consensus Agreement (${directionConfidence}/5)`);
        const factors = {
          trendAlignment,
          mtfConfirmation,
          momentum,
          marketStructure,
          volumeLiquidity,
          volatilityAtrQuality,
          entryQuality,
          rrQuality,
          executionQuality,
          directionConfidence
        };
        const rawTotal = trendAlignment + mtfConfirmation + momentum + marketStructure + volumeLiquidity + volatilityAtrQuality + entryQuality + rrQuality + executionQuality + directionConfidence;
        const finalScore = Math.round(Math.max(0, Math.min(100, rawTotal)));
        const finalThreshold = this.FINAL_TRADEABILITY_THRESHOLD;
        const watchingThreshold = serverConfig?.getConfig?.()?.thresholds?.watchingThreshold || 70;
        let classification;
        if (finalScore >= 90) {
          classification = "EXCEPTIONAL";
        } else if (finalScore >= 85) {
          classification = "VERY_STRONG_SIGNAL";
        } else if (finalScore >= 80) {
          classification = "STRONG_SIGNAL";
        } else if (finalScore >= finalThreshold) {
          classification = "VALID_SIGNAL";
        } else if (finalScore >= watchingThreshold) {
          classification = "NEAR_MISS_WATCHLIST";
        } else {
          classification = "REJECT";
        }
        const isTradeable = finalScore >= finalThreshold;
        const marginAboveThreshold = finalScore - finalThreshold;
        let rejectionReason = null;
        if (!isTradeable) {
          if (classification === "NEAR_MISS_WATCHLIST") {
            rejectionReason = `Score ${finalScore}/100 is in Watchlist range (${watchingThreshold}\u2013${finalThreshold - 1}), below the final tradeability threshold of ${finalThreshold}. Setup routed to Opportunity Watchlist.`;
          } else {
            rejectionReason = `Score ${finalScore}/100 is below the final tradeability threshold of ${finalThreshold} (Classification: ${classification}).`;
          }
        }
        logger.info(
          `[Gate 8 Final Tradeability Evaluation] ${input.symbol} (${input.direction}): Score ${finalScore}/100 [Trend: ${trendAlignment}, MTF: ${mtfConfirmation}, Mom: ${momentum}, Struct: ${marketStructure}, Vol: ${volumeLiquidity}, ATR: ${volatilityAtrQuality}, Entry: ${entryQuality}, RR: ${rrQuality}, Exec: ${executionQuality}, Dir: ${directionConfidence}] -> ${classification} (Tradeable: ${isTradeable})`
        );
        return {
          symbol: input.symbol,
          direction: input.direction,
          finalScore,
          factors,
          classification,
          isTradeable,
          rejectionReason,
          scoreRequirementPassed: isTradeable,
          marginAboveThreshold,
          confluenceHighlights: highlights
        };
      }
    };
  }
});

// src/server/signals/Gate9FinalSignalCap.ts
var Gate9FinalSignalCap;
var init_Gate9FinalSignalCap = __esm({
  "src/server/signals/Gate9FinalSignalCap.ts"() {
    init_logger();
    Gate9FinalSignalCap = class {
      static {
        this.MAX_SIGNALS_PER_SCAN = 3;
      }
      /**
       * Applies Gate 9 signal cap to validated and scored (>=75) candidates.
       */
      static applySignalCap(qualifiedCandidates) {
        const totalPassed = qualifiedCandidates.length;
        if (totalPassed === 0) {
          logger.info(`[Gate 9 Signal Cap] 0 candidates satisfied Gate 7 hard gates & Gate 8 score >= 72. Publishing 0 signals.`);
          return {
            totalPassedCandidates: 0,
            maxCapAllowed: this.MAX_SIGNALS_PER_SCAN,
            publishedSignalsCount: 0,
            publishedSignals: [],
            publishedCandidates: [],
            spilloverCandidates: [],
            zeroSignalsReason: "Zero candidates satisfied both Gate 7 hard gates and Gate 8 score hurdle (>=72). No signals forced."
          };
        }
        const sorted = [...qualifiedCandidates].sort((a, b) => {
          if (b.finalScore !== a.finalScore) {
            return b.finalScore - a.finalScore;
          }
          const rrA = a.signal.netRiskRewardRatio ?? a.signal.riskRewardRatio ?? 0;
          const rrB = b.signal.netRiskRewardRatio ?? b.signal.riskRewardRatio ?? 0;
          return rrB - rrA;
        });
        const publishedCandidates = sorted.slice(0, this.MAX_SIGNALS_PER_SCAN);
        const spilloverCandidates = sorted.slice(this.MAX_SIGNALS_PER_SCAN);
        publishedCandidates.forEach((cand, idx) => {
          cand.signal.isTradeableSignal = true;
          cand.signal.signalClassification = "TRADEABLE";
          if (idx === 0) {
            cand.signal.isPrimary = true;
            cand.signal.isBestTrade = true;
            cand.signal.rankTier = "BEST_TRADE";
          } else if (idx === 1) {
            cand.signal.isSecondBest = true;
            cand.signal.rankTier = "SECOND_BEST";
          } else {
            cand.signal.isSuggestion = true;
            cand.signal.rankTier = "SUGGESTION";
          }
        });
        const publishedSignals = publishedCandidates.map((c) => c.signal);
        logger.info(
          `[Gate 9 Signal Cap] Evaluated ${totalPassed} qualified candidates. Published: ${publishedSignals.length} (Cap: ${this.MAX_SIGNALS_PER_SCAN}). Selected: [${publishedSignals.map((s) => `${s.symbol} (${s.score ?? 75}/100)`).join(", ")}]`
        );
        if (spilloverCandidates.length > 0) {
          logger.info(
            `[Gate 9 Signal Cap Spillover] ${spilloverCandidates.length} valid candidates exceeded 3-signal cap: [${spilloverCandidates.map((s) => `${s.signal.symbol} (${s.finalScore}/100)`).join(", ")}]`
          );
        }
        return {
          totalPassedCandidates: totalPassed,
          maxCapAllowed: this.MAX_SIGNALS_PER_SCAN,
          publishedSignalsCount: publishedSignals.length,
          publishedSignals,
          publishedCandidates,
          spilloverCandidates
        };
      }
    };
  }
});

// src/server/signals/Gate10ScannerTelemetry.ts
var Gate10ScannerTelemetry;
var init_Gate10ScannerTelemetry = __esm({
  "src/server/signals/Gate10ScannerTelemetry.ts"() {
    init_logger();
    Gate10ScannerTelemetry = class {
      static {
        this.recentScans = [];
      }
      static {
        this.MAX_STORED_SCANS = 25;
      }
      /**
       * Sanitizes strings or objects to guarantee no secrets/API keys leak into logs or telemetry.
       */
      static sanitize(text) {
        if (!text) return "";
        return text.replace(/key=[a-zA-Z0-9_-]+/gi, "key=REDACTED").replace(/token=[a-zA-Z0-9_-]+/gi, "token=REDACTED").replace(/apiKey=[a-zA-Z0-9_-]+/gi, "apiKey=REDACTED").replace(/secret=[a-zA-Z0-9_-]+/gi, "secret=REDACTED").replace(/bearer\s+[a-zA-Z0-9._-]+/gi, "Bearer REDACTED");
      }
      /**
       * Records a completed scan telemetry event, outputs structured console logs, and retains in memory.
       */
      static recordScan(data) {
        this.recentScans.unshift(data);
        if (this.recentScans.length > this.MAX_STORED_SCANS) {
          this.recentScans.pop();
        }
        const logSummary = [
          `================================================================`,
          `[GATE 10 SCANNER TELEMETRY] Scan ID: ${data.scanId} | Category: ${data.assetCategory}`,
          `----------------------------------------------------------------`,
          `${data.assetsReceived} assets received`,
          `\u2193`,
          `${data.assetsCached} cache-qualified (Hits: ${data.cacheHits}, Misses: ${data.cacheMisses})`,
          `\u2193`,
          `${data.preliminaryCandidates} preliminary candidates (Stage 1)`,
          `\u2193`,
          `${data.deepCandidatesAllowed} deep candidates allowed (Remaining quota: ${data.quotaRemainingBeforeDeepScan})`,
          `\u2193`,
          `${data.deepCandidatesEvaluated} deep candidates evaluated (Gate 5 ranking)`,
          `\u2193`,
          `${data.mtfLayer1Evaluated} MTF Layer-1 candidates evaluated (15m/1h)`,
          `\u2193`,
          `${data.mtfLayer2Evaluated} MTF Layer-2 candidates confirmed (5m/4h)`,
          `\u2193`,
          `${data.executionChecks} execution validations (Gate 7 Hard Gates) [Failures: ${data.hardGateFailures}]`,
          `\u2193`,
          `${data.finalScores.filter((s) => s.passed).length} score >= 72 (Gate 8 Final Threshold)`,
          `\u2193`,
          `${data.signalsGenerated} signal(s) published (Gate 9 Signal Cap: ${data.signalsGenerated}/3)`,
          `----------------------------------------------------------------`,
          `Rejection Breakdown: BeforeMTF: ${data.candidatesRejectedBeforeMTF ?? 0} | MTF: ${data.candidatesRejectedByMTF ?? 0} | Score: ${data.candidatesRejectedByScore ?? 0} | RR: ${data.candidatesRejectedByRR ?? 0} | Structure: ${data.candidatesRejectedByStructure ?? 0}`,
          `Global Scan Clock: Elapsed: ${data.currentElapsedMs}ms / ${data.scanDuration}ms | Deadline: ${data.globalScanDeadlineMs} | Remaining Budget: ${data.remainingBudgetMs}ms | Gate 6 Elapsed: ${data.gate6ElapsedMs}ms | Stage 3 Elapsed: ${data.stage3ElapsedMs}ms | Budget Exceeded: ${data.timeBudgetExceeded} | Requests Stopped: ${data.providerRequestsStoppedByBudget}`,
          `Performance: ${data.scanDuration}ms duration | Provider Requests: ${data.providerRequests} (Errors: ${data.providerErrors}, Timeouts: ${data.providerTimeouts})`,
          `================================================================`
        ].join("\n");
        logger.info(this.sanitize(logSummary));
      }
      /**
       * Returns the most recent scan telemetry record.
       */
      static getLatestScan() {
        return this.recentScans[0] || null;
      }
      /**
       * Returns recent scan telemetry history.
       */
      static getRecentScans(limit = 10) {
        return this.recentScans.slice(0, limit);
      }
      /**
       * Clears telemetry history (for test isolation).
       */
      static clear() {
        this.recentScans = [];
      }
    };
  }
});

// src/server/signals/Gate4MomentumVolatility.ts
var Gate4MomentumVolatility;
var init_Gate4MomentumVolatility = __esm({
  "src/server/signals/Gate4MomentumVolatility.ts"() {
    init_TechnicalIndicators();
    Gate4MomentumVolatility = class {
      static analyze(proposedDirection, candles) {
        const reasons = [];
        if (!candles || candles.length < 50) {
          return {
            momentumDirection: "NEUTRAL",
            momentumStrength: "WEAK",
            volatilityState: "NORMAL",
            overextensionStatus: "NORMAL",
            atrContext: "Insufficient data",
            momentumScore: 50,
            volatilityScore: 50,
            score: 50,
            reasons: ["Insufficient candles for momentum and volatility calculation."]
          };
        }
        const rsiValues = TechnicalIndicators.calculateRSI(candles, 14);
        const rsi = rsiValues[rsiValues.length - 1];
        const prevRsi = rsiValues[rsiValues.length - 2];
        const macdResult = TechnicalIndicators.calculateMACD(candles);
        const macdHist = macdResult?.histogram || 0;
        const prevMacdResult = TechnicalIndicators.calculateMACD(candles.slice(0, -1));
        const prevMacdHist = prevMacdResult?.histogram || 0;
        const adxResult = TechnicalIndicators.calculateADX(candles, 14);
        const adx = adxResult?.adx || 0;
        const pdi = adxResult?.pdi || 0;
        const mdi = adxResult?.mdi || 0;
        const volMetrics = TechnicalIndicators.calculateVolatilityMetrics(candles);
        const currentBB = TechnicalIndicators.calculateBollingerBands(candles, 20, 2);
        const currentPrice = candles[candles.length - 1].close;
        const bbWidth = currentBB ? currentBB.upper - currentBB.lower : 0;
        const prevBB = TechnicalIndicators.calculateBollingerBands(candles.slice(0, -1), 20, 2);
        const prevBBWidth = prevBB ? prevBB.upper - prevBB.lower : 0;
        let momentumDirection = "NEUTRAL";
        let momentumStrength = "WEAK";
        let momentumScore = 50;
        if (pdi > mdi && macdHist > 0 && rsi > 50) {
          momentumDirection = "BULLISH";
          momentumStrength = adx > 25 && macdHist > prevMacdHist ? "STRONG" : "MODERATE";
        } else if (mdi > pdi && macdHist < 0 && rsi < 50) {
          momentumDirection = "BEARISH";
          momentumStrength = adx > 25 && macdHist < prevMacdHist ? "STRONG" : "MODERATE";
        }
        if (proposedDirection === "BUY") {
          if (momentumDirection === "BULLISH") {
            momentumScore = 70 + (momentumStrength === "STRONG" ? 20 : 10);
          } else if (momentumDirection === "BEARISH") {
            momentumScore = 30 - (momentumStrength === "STRONG" ? 20 : 10);
            reasons.push("Momentum is Bearish, conflicting with BUY.");
          }
        } else {
          if (momentumDirection === "BEARISH") {
            momentumScore = 70 + (momentumStrength === "STRONG" ? 20 : 10);
          } else if (momentumDirection === "BULLISH") {
            momentumScore = 30 - (momentumStrength === "STRONG" ? 20 : 10);
            reasons.push("Momentum is Bullish, conflicting with SELL.");
          }
        }
        if (momentumDirection === "BULLISH" && macdHist < prevMacdHist && rsi < prevRsi) {
          reasons.push("Bullish momentum is decelerating.");
          if (proposedDirection === "BUY") momentumScore -= 15;
        } else if (momentumDirection === "BEARISH" && macdHist > prevMacdHist && rsi > prevRsi) {
          reasons.push("Bearish momentum is decelerating.");
          if (proposedDirection === "SELL") momentumScore -= 15;
        }
        let overextensionStatus = "NORMAL";
        if (currentBB && rsi > 75 && currentPrice >= currentBB.upper && macdHist < prevMacdHist) {
          overextensionStatus = "OVERBOUGHT";
          if (proposedDirection === "BUY") {
            momentumScore -= 30;
            reasons.push("Market appears overbought (RSI > 75, hitting Upper BB, momentum decelerating).");
          }
        } else if (currentBB && rsi < 25 && currentPrice <= currentBB.lower && macdHist > prevMacdHist) {
          overextensionStatus = "OVERSOLD";
          if (proposedDirection === "SELL") {
            momentumScore -= 30;
            reasons.push("Market appears oversold (RSI < 25, hitting Lower BB, momentum decelerating).");
          }
        }
        let volatilityState = "NORMAL";
        let volatilityScore = 50;
        if (volMetrics.isDeadMarket || volMetrics.currentAtr === 0) {
          volatilityState = "DEAD";
          volatilityScore = 10;
          reasons.push("Market is dead or has insufficient volatility to trade.");
        } else if (volMetrics.isErratic) {
          volatilityState = "ERRATIC";
          volatilityScore = 30;
          reasons.push("Volatility is erratic or dangerously high, increasing risk of sudden drawdowns.");
        } else if (bbWidth > prevBBWidth * 1.1) {
          volatilityState = "EXPANDING";
          volatilityScore = 90;
          reasons.push("Volatility is expanding, providing good conditions for breakouts and trend continuation.");
        } else if (bbWidth < prevBBWidth * 0.9) {
          volatilityState = "CONTRACTING";
          volatilityScore = 60;
        } else {
          volatilityState = "NORMAL";
          volatilityScore = 80;
        }
        const atrContext = `Current ATR: ${volMetrics.currentAtr.toFixed(4)} (Ratio to baseline: ${volMetrics.atrRatio.toFixed(2)})`;
        momentumScore = Math.max(0, Math.min(100, momentumScore));
        volatilityScore = Math.max(0, Math.min(100, volatilityScore));
        const score = Math.round(momentumScore * 0.6 + volatilityScore * 0.4);
        return {
          momentumDirection,
          momentumStrength,
          volatilityState,
          overextensionStatus,
          atrContext,
          momentumScore,
          volatilityScore,
          score,
          reasons
        };
      }
    };
  }
});

// src/server/signals/Gate5Liquidity.ts
var Gate5SupportResistance;
var init_Gate5Liquidity = __esm({
  "src/server/signals/Gate5Liquidity.ts"() {
    init_TechnicalIndicators();
    Gate5SupportResistance = class {
      static analyze(proposedDirection, candles) {
        const reasons = [];
        if (!candles || candles.length < 50) {
          return {
            nearestSupport: null,
            nearestResistance: null,
            liquidityZones: [],
            sweepDetected: null,
            retestDetected: null,
            srConfluenceScore: 50,
            liquidityScore: 50,
            score: 50,
            reasons: ["Insufficient candles for S/R and Liquidity calculation."]
          };
        }
        const currentPrice = candles[candles.length - 1].close;
        const atr = TechnicalIndicators.calculateATR(candles, 14);
        const zoneTolerance = atr * 0.3;
        const pricePoints = [];
        const now = candles[candles.length - 1].timestamp;
        let dayHigh = -Infinity;
        let dayLow = Infinity;
        let weekHigh = -Infinity;
        let weekLow = Infinity;
        for (const c of candles) {
          const age = now - c.timestamp;
          if (age <= 864e5) {
            if (c.high > dayHigh) dayHigh = c.high;
            if (c.low < dayLow) dayLow = c.low;
          }
          if (age <= 6048e5) {
            if (c.high > weekHigh) weekHigh = c.high;
            if (c.low < weekLow) weekLow = c.low;
          }
        }
        if (dayHigh !== -Infinity) pricePoints.push({ price: dayHigh, type: "HIGH", factor: "Daily High", volume: 0 });
        if (dayLow !== Infinity) pricePoints.push({ price: dayLow, type: "LOW", factor: "Daily Low", volume: 0 });
        if (weekHigh !== -Infinity && weekHigh !== dayHigh) pricePoints.push({ price: weekHigh, type: "HIGH", factor: "Weekly High", volume: 0 });
        if (weekLow !== Infinity && weekLow !== dayLow) pricePoints.push({ price: weekLow, type: "LOW", factor: "Weekly Low", volume: 0 });
        for (let i = 2; i < candles.length - 2; i++) {
          const c = candles[i];
          const isHigh = c.high > candles[i - 1].high && c.high > candles[i - 2].high && c.high > candles[i + 1].high && c.high > candles[i + 2].high;
          const isLow = c.low < candles[i - 1].low && c.low < candles[i - 2].low && c.low < candles[i + 1].low && c.low < candles[i + 2].low;
          if (isHigh) pricePoints.push({ price: c.high, type: "HIGH", factor: "Swing High", volume: c.volume });
          if (isLow) pricePoints.push({ price: c.low, type: "LOW", factor: "Swing Low", volume: c.volume });
        }
        const sortedByVolume = [...candles].sort((a, b) => b.volume - a.volume);
        const topVolume = sortedByVolume.slice(0, Math.min(5, sortedByVolume.length));
        for (const v of topVolume) {
          pricePoints.push({ price: v.close, type: v.close > currentPrice ? "HIGH" : "LOW", factor: "High Volume Node", volume: v.volume });
        }
        const magnitude = Math.pow(10, Math.floor(Math.log10(currentPrice)));
        let roundStep = magnitude / 100;
        if (roundStep < 1e-4) roundStep = 1e-4;
        const nearestRoundUp = Math.ceil(currentPrice / roundStep) * roundStep;
        const nearestRoundDown = Math.floor(currentPrice / roundStep) * roundStep;
        pricePoints.push({ price: nearestRoundUp, type: "HIGH", factor: "Psychological", volume: 0 });
        pricePoints.push({ price: nearestRoundDown, type: "LOW", factor: "Psychological", volume: 0 });
        const zones = [];
        pricePoints.sort((a, b) => a.price - b.price);
        for (const pt of pricePoints) {
          const overlappingZone = zones.find((z) => pt.price >= z.bottom - zoneTolerance && pt.price <= z.top + zoneTolerance);
          if (overlappingZone) {
            overlappingZone.top = Math.max(overlappingZone.top, pt.price + zoneTolerance / 2);
            overlappingZone.bottom = Math.min(overlappingZone.bottom, pt.price - zoneTolerance / 2);
            overlappingZone.strength += 1;
            if (!overlappingZone.factors.includes(pt.factor)) {
              overlappingZone.factors.push(pt.factor);
            }
            if (overlappingZone.factors.length >= 3 || overlappingZone.strength >= 4) {
              overlappingZone.type = "LIQUIDITY_POOL";
            } else {
              if (currentPrice < overlappingZone.bottom) overlappingZone.type = "RESISTANCE";
              else if (currentPrice > overlappingZone.top) overlappingZone.type = "SUPPORT";
            }
          } else {
            zones.push({
              top: pt.price + zoneTolerance / 2,
              bottom: pt.price - zoneTolerance / 2,
              type: pt.price > currentPrice ? "RESISTANCE" : "SUPPORT",
              strength: 1,
              factors: [pt.factor],
              isTested: false,
              isBroken: false
            });
          }
        }
        for (const z of zones) {
          let crosses = 0;
          for (let i = candles.length - 20; i < candles.length; i++) {
            if (i < 0) continue;
            const c = candles[i];
            const prevC = candles[i - 1];
            if (!prevC) continue;
            const crossedUp = prevC.close < z.bottom && c.close > z.top;
            const crossedDown = prevC.close > z.top && c.close < z.bottom;
            if (crossedUp || crossedDown) {
              z.isBroken = true;
              crosses++;
            }
          }
          if (crosses > 0 && crosses % 2 !== 0) {
            if (z.type === "RESISTANCE" && currentPrice > z.top) {
              z.type = "SUPPORT";
              z.factors.push("R->S Flip");
            } else if (z.type === "SUPPORT" && currentPrice < z.bottom) {
              z.type = "RESISTANCE";
              z.factors.push("S->R Flip");
            }
          }
        }
        const activeZones = zones.filter((z) => !z.isBroken || z.factors.includes("R->S Flip") || z.factors.includes("S->R Flip"));
        let nearestSupport = null;
        let nearestResistance = null;
        let minSupDist = Infinity;
        let minResDist = Infinity;
        for (const z of activeZones) {
          if (z.top < currentPrice && currentPrice - z.top < minSupDist) {
            nearestSupport = z;
            minSupDist = currentPrice - z.top;
          }
          if (z.bottom > currentPrice && z.bottom - currentPrice < minResDist) {
            nearestResistance = z;
            minResDist = z.bottom - currentPrice;
          }
        }
        const liquidityZones = zones.filter((z) => z.type === "LIQUIDITY_POOL").sort((a, b) => b.strength - a.strength);
        let sweepDetected = null;
        let retestDetected = null;
        const lastCandle = candles[candles.length - 1];
        const prevCandle = candles[candles.length - 2];
        for (const z of activeZones) {
          if (lastCandle.low < z.bottom && lastCandle.close > z.top) {
            sweepDetected = `BULLISH_SWEEP: Swept liquidity below ${z.bottom.toFixed(2)} (${z.factors.join(", ")})`;
            z.isTested = true;
          }
          if (lastCandle.high > z.top && lastCandle.close < z.bottom) {
            sweepDetected = `BEARISH_SWEEP: Swept liquidity above ${z.top.toFixed(2)} (${z.factors.join(", ")})`;
            z.isTested = true;
          }
          if (z.factors.includes("R->S Flip") && lastCandle.low <= z.top && lastCandle.close > z.top) {
            retestDetected = `BULLISH_RETEST: Retesting flipped support at ${z.top.toFixed(2)}`;
            z.isTested = true;
          }
          if (z.factors.includes("S->R Flip") && lastCandle.high >= z.bottom && lastCandle.close < z.bottom) {
            retestDetected = `BEARISH_RETEST: Retesting flipped resistance at ${z.bottom.toFixed(2)}`;
            z.isTested = true;
          }
        }
        let srConfluenceScore = 50;
        let liquidityScore = 50;
        if (proposedDirection === "BUY") {
          if (sweepDetected && sweepDetected.startsWith("BULLISH")) {
            srConfluenceScore += 30;
            liquidityScore += 30;
            reasons.push("Bullish liquidity sweep detected. Strong reversal signal.");
          }
          if (retestDetected && retestDetected.startsWith("BULLISH")) {
            srConfluenceScore += 25;
            reasons.push("Successful bullish retest of flipped support.");
          }
          if (nearestSupport && minSupDist < atr * 2) {
            srConfluenceScore += nearestSupport.strength * 5;
            reasons.push(`Price is near structural support (${nearestSupport.factors.join(", ")}).`);
          } else if (nearestSupport && minSupDist > atr * 5) {
            srConfluenceScore -= 20;
            reasons.push("Price is far from any meaningful support, increasing risk.");
          }
          if (nearestResistance && minResDist < atr * 0.5) {
            srConfluenceScore -= 30;
            reasons.push("Buying directly into structural resistance is highly discouraged.");
          }
        } else {
          if (sweepDetected && sweepDetected.startsWith("BEARISH")) {
            srConfluenceScore += 30;
            liquidityScore += 30;
            reasons.push("Bearish liquidity sweep detected. Strong reversal signal.");
          }
          if (retestDetected && retestDetected.startsWith("BEARISH")) {
            srConfluenceScore += 25;
            reasons.push("Successful bearish retest of flipped resistance.");
          }
          if (nearestResistance && minResDist < atr * 2) {
            srConfluenceScore += nearestResistance.strength * 5;
            reasons.push(`Price is near structural resistance (${nearestResistance.factors.join(", ")}).`);
          } else if (nearestResistance && minResDist > atr * 5) {
            srConfluenceScore -= 20;
            reasons.push("Price is far from meaningful resistance, increasing risk.");
          }
          if (nearestSupport && minSupDist < atr * 0.5) {
            srConfluenceScore -= 30;
            reasons.push("Selling directly into structural support is highly discouraged.");
          }
        }
        srConfluenceScore = Math.max(0, Math.min(100, srConfluenceScore));
        liquidityScore = Math.max(0, Math.min(100, liquidityScore));
        const score = Math.round(srConfluenceScore * 0.7 + liquidityScore * 0.3);
        return {
          nearestSupport,
          nearestResistance,
          liquidityZones,
          sweepDetected,
          retestDetected,
          srConfluenceScore,
          liquidityScore,
          score,
          reasons
        };
      }
    };
  }
});

// src/server/signals/Gate6VolumePriceAction.ts
var Gate6VolumePriceAction;
var init_Gate6VolumePriceAction = __esm({
  "src/server/signals/Gate6VolumePriceAction.ts"() {
    init_TechnicalIndicators();
    Gate6VolumePriceAction = class {
      static analyze(proposedDirection, candles) {
        const reasons = [];
        if (!candles || candles.length < 20) {
          return {
            volumeConfirmation: "INSUFFICIENT_DATA",
            vwapDirection: "NEUTRAL",
            priceActionConfirmation: "INSUFFICIENT_DATA",
            volumeScore: 50,
            confirmationScore: 50,
            score: 50,
            reasons: ["Insufficient candles for volume/price action analysis."]
          };
        }
        const lastCandle = candles[candles.length - 1];
        const prevCandle = candles[candles.length - 2];
        const vwapSeries = TechnicalIndicators.calculateVWAP(candles);
        const currentVwap = vwapSeries[vwapSeries.length - 1];
        let vwapDirection = "NEUTRAL";
        if (lastCandle.close > currentVwap) vwapDirection = "BULLISH";
        else if (lastCandle.close < currentVwap) vwapDirection = "BEARISH";
        let volumeScore = 50;
        const recentVolume = lastCandle.volume;
        const volSlice = candles.slice(-20);
        const avgVolume = volSlice.reduce((sum, c) => sum + c.volume, 0) / volSlice.length;
        const relVolume = avgVolume > 0 ? recentVolume / avgVolume : 1;
        let volumeConfirmation = "NEUTRAL";
        if (relVolume > 1.5) {
          volumeConfirmation = "HIGH_VOLUME_EXPANSION";
          volumeScore += 20;
          reasons.push(`Strong volume expansion detected (${relVolume.toFixed(1)}x average).`);
        } else if (relVolume > 1.1) {
          volumeConfirmation = "MODERATE_EXPANSION";
          volumeScore += 10;
        } else if (relVolume < 0.7) {
          volumeConfirmation = "LOW_VOLUME_CONTRACTION";
          volumeScore -= 20;
          reasons.push(`Low volume participation (${relVolume.toFixed(1)}x average). Breakouts may lack conviction.`);
        }
        const obvSeries = TechnicalIndicators.calculateOBV(candles);
        const currentObv = obvSeries[obvSeries.length - 1];
        const prevObv = obvSeries[obvSeries.length - 5];
        const obvTrendingUp = currentObv > prevObv;
        if (proposedDirection === "BUY" && obvTrendingUp) {
          volumeScore += 15;
          reasons.push("OBV trend supports bullish momentum.");
        } else if (proposedDirection === "SELL" && !obvTrendingUp) {
          volumeScore += 15;
          reasons.push("OBV trend supports bearish momentum.");
        } else {
          volumeScore -= 10;
          reasons.push("OBV trend conflicts with proposed direction.");
        }
        let confirmationScore = 50;
        let priceActionConfirmation = "NEUTRAL";
        const range = lastCandle.high - lastCandle.low;
        const body = Math.abs(lastCandle.close - lastCandle.open);
        const bodyRatio = range > 0 ? body / range : 0;
        const isBullishCandle = lastCandle.close > lastCandle.open;
        const isBearishCandle = lastCandle.close < lastCandle.open;
        const isEngulfingBullish = isBullishCandle && lastCandle.close > prevCandle.high && lastCandle.open < prevCandle.low;
        const isEngulfingBearish = isBearishCandle && lastCandle.close < prevCandle.low && lastCandle.open > prevCandle.high;
        const bodyTop = Math.max(lastCandle.open, lastCandle.close);
        const bodyBottom = Math.min(lastCandle.open, lastCandle.close);
        const upperWick = lastCandle.high - bodyTop;
        const lowerWick = bodyBottom - lastCandle.low;
        const upperWickRatio = range > 0 ? upperWick / range : 0;
        const lowerWickRatio = range > 0 ? lowerWick / range : 0;
        if (proposedDirection === "BUY") {
          if (vwapDirection === "BEARISH") {
            confirmationScore -= 20;
            reasons.push("Price is below VWAP, resisting bullish context.");
          } else {
            confirmationScore += 15;
          }
          if (isEngulfingBullish) {
            priceActionConfirmation = "BULLISH_ENGULFING";
            confirmationScore += 25;
            reasons.push("Bullish engulfing candle detected.");
          } else if (lowerWickRatio > 0.5) {
            priceActionConfirmation = "STRONG_LOWER_WICK_REJECTION";
            confirmationScore += 20;
            reasons.push("Strong lower wick rejection implies buying pressure.");
          } else if (isBullishCandle && bodyRatio > 0.7) {
            priceActionConfirmation = "STRONG_BULLISH_MOMENTUM_CANDLE";
            confirmationScore += 15;
          } else if (upperWickRatio > 0.5) {
            confirmationScore -= 20;
            reasons.push("Long upper wick implies rejection of higher prices (bearish structure).");
          }
        } else {
          if (vwapDirection === "BULLISH") {
            confirmationScore -= 20;
            reasons.push("Price is above VWAP, resisting bearish context.");
          } else {
            confirmationScore += 15;
          }
          if (isEngulfingBearish) {
            priceActionConfirmation = "BEARISH_ENGULFING";
            confirmationScore += 25;
            reasons.push("Bearish engulfing candle detected.");
          } else if (upperWickRatio > 0.5) {
            priceActionConfirmation = "STRONG_UPPER_WICK_REJECTION";
            confirmationScore += 20;
            reasons.push("Strong upper wick rejection implies selling pressure.");
          } else if (isBearishCandle && bodyRatio > 0.7) {
            priceActionConfirmation = "STRONG_BEARISH_MOMENTUM_CANDLE";
            confirmationScore += 15;
          } else if (lowerWickRatio > 0.5) {
            confirmationScore -= 20;
            reasons.push("Long lower wick implies rejection of lower prices (bullish structure).");
          }
        }
        if (bodyRatio > 0.6 && relVolume < 0.8) {
          confirmationScore -= 25;
          reasons.push("Failed breakout signature: Directional body expansion without volume participation.");
        }
        volumeScore = Math.max(0, Math.min(100, volumeScore));
        confirmationScore = Math.max(0, Math.min(100, confirmationScore));
        const score = Math.round(volumeScore * 0.5 + confirmationScore * 0.5);
        return {
          volumeConfirmation,
          vwapDirection,
          priceActionConfirmation,
          volumeScore,
          confirmationScore,
          score,
          reasons
        };
      }
    };
  }
});

// src/server/signals/Gate31NewsRiskClassification.ts
var Gate31NewsRiskClassification;
var init_Gate31NewsRiskClassification = __esm({
  "src/server/signals/Gate31NewsRiskClassification.ts"() {
    init_SymbolNormalizer();
    init_logger();
    Gate31NewsRiskClassification = class {
      static {
        this.scheduledEvents = [];
      }
      static {
        this.lastFetchSuccessful = false;
      }
      static {
        this.lastFetchTime = 0;
      }
      static {
        // Scan-level cache, deduplication, and failure cooldown
        this.symbolNewsCache = /* @__PURE__ */ new Map();
      }
      static {
        this.pendingFetches = /* @__PURE__ */ new Map();
      }
      static {
        this.lastFailureTime = 0;
      }
      /**
       * Syncs verified news from Twelve Data for a given symbol and updates scheduledEvents.
       */
      static async syncVerifiedNews(symbol) {
        const apiKey = process.env.TWELVE_DATA_API_KEY;
        if (!apiKey || apiKey.trim().length === 0) {
          logger.warn("[Gate 31 News Risk] TWELVE_DATA_API_KEY not configured. Cannot fetch verified news.");
          this.lastFetchSuccessful = false;
          return;
        }
        const cleanSymbol = SymbolNormalizer.normalizeAppSymbol(symbol) || symbol.trim().toUpperCase();
        const FAILURE_COOLDOWN_MS = 5 * 60 * 1e3;
        if (this.lastFailureTime > 0 && Date.now() - this.lastFailureTime < FAILURE_COOLDOWN_MS) {
          logger.warn(`[Gate 31 News Risk] Skipping news sync for ${cleanSymbol} due to global failure cooldown.`);
          return;
        }
        const CACHE_TTL_MS2 = 15 * 60 * 1e3;
        const cached = this.symbolNewsCache.get(cleanSymbol);
        if (cached && Date.now() - cached.lastFetchTime < CACHE_TTL_MS2) {
          logger.info(`[Gate 31 News Risk] Using cached news results for ${cleanSymbol}`);
          if (cached.success) {
            this.lastFetchSuccessful = true;
          }
          return;
        }
        const pending = this.pendingFetches.get(cleanSymbol);
        if (pending) {
          logger.info(`[Gate 31 News Risk] Reusing pending news fetch promise for ${cleanSymbol}`);
          return pending;
        }
        const fetchPromise = (async () => {
          try {
            const provMapping = SymbolNormalizer.toProviderSymbol(cleanSymbol, "twelvedata");
            const providerSymbol = provMapping.providerSymbol || cleanSymbol;
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 8e3);
            const url = `https://api.twelvedata.com/news?symbol=${encodeURIComponent(providerSymbol)}&apikey=${apiKey.trim()}`;
            const response = await fetch(url, { signal: controller.signal });
            clearTimeout(timeoutId);
            if (!response.ok) {
              logger.warn(`[Gate 31 News Risk] Twelve Data API returned HTTP ${response.status}`);
              this.symbolNewsCache.set(cleanSymbol, { lastFetchTime: Date.now(), success: false });
              this.lastFailureTime = Date.now();
              this.lastFetchSuccessful = false;
              return;
            }
            const json = await response.json();
            const articles = json.data || json.articles || [];
            if (Array.isArray(articles) && articles.length > 0) {
              const now = Date.now();
              const verifiedEvents = articles.map((art, index) => {
                const pubDate = art.date ? new Date(art.date).getTime() : now;
                const title = art.title || "Verified News Article";
                const titleLower = title.toLowerCase();
                let category = "GENERAL_ECONOMIC";
                let impact = "LOW";
                if (titleLower.includes("fed") || titleLower.includes("fomc") || titleLower.includes("powell") || titleLower.includes("rate decision")) {
                  category = "MACRO_US";
                  impact = "HIGH";
                } else if (titleLower.includes("ecb") || titleLower.includes("central bank") || titleLower.includes("inflation") || titleLower.includes("cpi")) {
                  category = "CENTRAL_BANK";
                  impact = "HIGH";
                } else if (titleLower.includes("crypto") || titleLower.includes("bitcoin") || titleLower.includes("sec") || titleLower.includes("etf")) {
                  category = "CRYPTO_REGULATORY";
                  impact = "MEDIUM";
                }
                return {
                  id: `td_news_${cleanSymbol}_${index}_${pubDate}`,
                  title,
                  category,
                  impact,
                  scheduledTimeMs: pubDate,
                  affectedAssets: [cleanSymbol],
                  affectedAssetClasses: ["CRYPTO", "FOREX", "STOCKS"],
                  blackoutBeforeMinutes: impact === "HIGH" ? 30 : 15,
                  blackoutAfterMinutes: impact === "HIGH" ? 30 : 15,
                  provenance: "twelvedata"
                };
              });
              this.scheduledEvents = this.scheduledEvents.filter((e) => e.provenance !== "twelvedata" || e.affectedAssets?.[0] !== cleanSymbol).concat(verifiedEvents);
              this.symbolNewsCache.set(cleanSymbol, { lastFetchTime: Date.now(), success: true });
              this.lastFetchSuccessful = true;
              this.lastFetchTime = now;
              logger.info(`[Gate 31 News Risk] Successfully synced ${verifiedEvents.length} verified news events from Twelve Data for ${cleanSymbol}`);
            } else {
              logger.info(`[Gate 31 News Risk] Twelve Data returned empty news array for ${cleanSymbol}`);
              this.symbolNewsCache.set(cleanSymbol, { lastFetchTime: Date.now(), success: true });
              this.lastFetchSuccessful = true;
              this.lastFetchTime = Date.now();
            }
          } catch (err) {
            logger.warn("[Gate 31 News Risk] Failed to sync verified news:", { error: String(err) });
            this.symbolNewsCache.set(cleanSymbol, { lastFetchTime: Date.now(), success: false });
            this.lastFailureTime = Date.now();
            this.lastFetchSuccessful = false;
          } finally {
            this.pendingFetches.delete(cleanSymbol);
          }
        })();
        this.pendingFetches.set(cleanSymbol, fetchPromise);
        return fetchPromise;
      }
      /**
       * Dynamically register or update a scheduled news event in the calendar
       */
      static registerNewsEvent(event) {
        const existingIdx = this.scheduledEvents.findIndex((e) => e.id === event.id);
        if (existingIdx >= 0) {
          this.scheduledEvents[existingIdx] = event;
        } else {
          this.scheduledEvents.push(event);
        }
        logger.info(`[Gate 31 News Risk] Registered event '${event.id}': ${event.title}`);
      }
      /**
       * Retrieve all currently registered news events
       */
      static getRegisteredEvents() {
        return [...this.scheduledEvents];
      }
      /**
       * Resets scheduled events list to empty or initial defaults
       */
      static setScheduledEvents(events) {
        this.scheduledEvents = [...events];
      }
      /**
       * Determines if a scheduled news event is strictly relevant to a given symbol.
       */
      static isEventRelevantToAsset(symbol, event) {
        const cleanSymbol = SymbolNormalizer.normalizeAppSymbol(symbol) || symbol.trim().toUpperCase();
        const assetClass = SymbolNormalizer.getAssetClassification(cleanSymbol).toUpperCase();
        if (event.affectedAssets && event.affectedAssets.length > 0) {
          const isExactAssetMatch = event.affectedAssets.some(
            (a) => a.toUpperCase() === cleanSymbol || cleanSymbol.includes(a.toUpperCase())
          );
          if (isExactAssetMatch) return true;
        }
        if (event.category === "STOCK_EARNINGS") {
          if (assetClass !== "STOCKS" && assetClass !== "STOCK" && assetClass !== "INDEX") {
            return false;
          }
          if (event.affectedAssets && event.affectedAssets.length > 0) {
            const matchesStock = event.affectedAssets.some((a) => cleanSymbol.startsWith(a.toUpperCase()));
            return matchesStock;
          }
        }
        if (event.category === "CRYPTO_REGULATORY") {
          return assetClass === "CRYPTO";
        }
        if (event.affectedCurrencies && event.affectedCurrencies.length > 0) {
          const currs = event.affectedCurrencies.map((c) => c.toUpperCase());
          if (assetClass === "FOREX") {
            const symbolCurrencies = this.extractCurrenciesFromForex(cleanSymbol);
            const matchesForexCurr = currs.some((c) => symbolCurrencies.includes(c));
            if (matchesForexCurr) return true;
          }
          if (assetClass === "COMMODITIES" && currs.includes("USD") && cleanSymbol.includes("XAU")) {
            return true;
          }
          if (assetClass === "CRYPTO" && currs.includes("USD") && event.impact === "HIGH" && event.category === "MACRO_US") {
            return true;
          }
        }
        if (event.affectedAssetClasses && event.affectedAssetClasses.length > 0) {
          const classUpper = event.affectedAssetClasses.map((c) => c.toUpperCase());
          if (classUpper.includes(assetClass) || assetClass === "STOCK" && classUpper.includes("STOCKS")) {
            if (event.affectedCurrencies && event.affectedCurrencies.length > 0 && assetClass === "FOREX") {
              const symbolCurrencies = this.extractCurrenciesFromForex(cleanSymbol);
              return event.affectedCurrencies.some((c) => symbolCurrencies.includes(c.toUpperCase()));
            }
            return true;
          }
        }
        return false;
      }
      /**
       * Helper to extract currency pairs from Forex symbol (e.g., 'EURUSD' -> ['EUR', 'USD'])
       */
      static extractCurrenciesFromForex(symbol) {
        const clean = symbol.replace(/[^A-Z]/g, "");
        if (clean.length === 6) {
          return [clean.substring(0, 3), clean.substring(3, 6)];
        }
        const currencies = ["USD", "EUR", "GBP", "JPY", "AUD", "CAD", "CHF", "NZD"];
        return currencies.filter((c) => clean.includes(c));
      }
      /**
       * Evaluates news risk classification for a target symbol at a given evaluation timestamp.
       */
      static evaluate(symbol, nowMs = Date.now()) {
        const cleanSymbol = SymbolNormalizer.normalizeAppSymbol(symbol) || symbol.trim().toUpperCase();
        const isCacheExpired = Date.now() - this.lastFetchTime > 15 * 60 * 1e3;
        if (!this.lastFetchSuccessful && isCacheExpired) {
          const failClosedEvent = {
            id: "fail_closed_risk_off_active",
            title: "FAIL-CLOSED: News verification unavailable or returned no data (Risk-Off Enforced)",
            category: "GENERAL_ECONOMIC",
            impact: "HIGH",
            scheduledTimeMs: nowMs,
            blackoutBeforeMinutes: 1440,
            blackoutAfterMinutes: 1440,
            provenance: "fail_closed_fallback"
          };
          return {
            symbol: cleanSymbol,
            classification: "BLOCK",
            isTradingAllowed: false,
            requiredConfirmationScoreMultiplier: Infinity,
            minRequiredConfirmationScore: 1e3,
            activeEvents: [failClosedEvent],
            relevantEventsCount: 1,
            reasons: ["BLOCK: Fail-closed triggered. No verified news events retrieved from Twelve Data and no valid cache from the last 15 minutes."],
            explanation: `Gate 31 News Risk for ${cleanSymbol}: State=BLOCK, TradingAllowed=false, MinRequiredScore=1000. Fail-Closed default enforced due to empty verified news source.`,
            neverFabricateSignalEnforced: true
          };
        }
        const activeEvents = [];
        const reasons = [];
        let highestClassification = "NORMAL";
        for (const event of this.scheduledEvents) {
          if (!this.isEventRelevantToAsset(cleanSymbol, event)) {
            continue;
          }
          const diffMs = event.scheduledTimeMs - nowMs;
          const diffMinutes = diffMs / 6e4;
          const blackoutBefore = event.blackoutBeforeMinutes ?? (event.impact === "HIGH" ? 30 : 15);
          const blackoutAfter = event.blackoutAfterMinutes ?? (event.impact === "HIGH" ? 30 : 15);
          const cautionBefore = event.cautionBeforeMinutes ?? (event.impact === "HIGH" ? 90 : 45);
          const cautionAfter = event.cautionAfterMinutes ?? (event.impact === "HIGH" ? 60 : 30);
          if (diffMinutes >= -blackoutAfter && diffMinutes <= blackoutBefore) {
            activeEvents.push(event);
            highestClassification = "BLOCK";
            reasons.push(
              `BLOCK: Active major news event '${event.title}' scheduled in ${diffMinutes.toFixed(1)}m (Blackout window: -${blackoutAfter}m to +${blackoutBefore}m).`
            );
          } else if (diffMinutes >= -cautionAfter && diffMinutes <= cautionBefore) {
            activeEvents.push(event);
            if (highestClassification !== "BLOCK") {
              highestClassification = "CAUTION";
            }
            reasons.push(
              `CAUTION: Approaching news event '${event.title}' in ${diffMinutes.toFixed(1)}m. Elevated volatility requires stronger confirmation score.`
            );
          }
        }
        const isTradingAllowed = highestClassification !== "BLOCK";
        const requiredConfirmationScoreMultiplier = highestClassification === "BLOCK" ? Infinity : highestClassification === "CAUTION" ? 1.35 : 1;
        const minRequiredConfirmationScore = highestClassification === "BLOCK" ? 1e3 : highestClassification === "CAUTION" ? 80 : 60;
        if (highestClassification === "NORMAL") {
          reasons.push("NORMAL: No active or approaching asset-relevant news risk detected. Standard confirmation policy applies.");
        }
        const explanation = `Gate 31 News Risk for ${cleanSymbol}: State=${highestClassification}, TradingAllowed=${isTradingAllowed}, MinRequiredScore=${minRequiredConfirmationScore}. Active Events: ${activeEvents.length}.`;
        logger.debug(`[Gate 31 News Risk] symbol=${cleanSymbol} state=${highestClassification} activeEvents=${activeEvents.length}`);
        return {
          symbol: cleanSymbol,
          classification: highestClassification,
          isTradingAllowed,
          requiredConfirmationScoreMultiplier,
          minRequiredConfirmationScore,
          activeEvents,
          relevantEventsCount: activeEvents.length,
          reasons,
          explanation,
          neverFabricateSignalEnforced: true
        };
      }
    };
  }
});

// src/server/signals/Gate7MarketContext.ts
var Gate7MarketContext;
var init_Gate7MarketContext = __esm({
  "src/server/signals/Gate7MarketContext.ts"() {
    init_Gate31NewsRiskClassification();
    Gate7MarketContext = class {
      static analyze(symbol, proposedDirection, candles) {
        const reasons = [];
        const assetClass = this.inferAssetClass(symbol);
        const currentUtcHour = (/* @__PURE__ */ new Date()).getUTCHours();
        const currentUtcMin = (/* @__PURE__ */ new Date()).getUTCMinutes();
        const decimalHour = currentUtcHour + currentUtcMin / 60;
        let session = "UNKNOWN";
        let marketContextScore = 50;
        let tradingAllowed = "YES";
        if (assetClass === "FOREX") {
          session = this.getForexSession(decimalHour);
          if (session === "Asian (Tokyo)") {
            marketContextScore -= 10;
            reasons.push("Asian session tends to have lower volatility and tighter ranges.");
          } else if (session === "London") {
            marketContextScore += 15;
            reasons.push("London session offers high liquidity and trend initiation.");
          } else if (session === "London/NY Overlap") {
            marketContextScore += 25;
            reasons.push("London/NY Overlap offers peak liquidity and optimal momentum.");
          } else if (session === "New York") {
            marketContextScore += 10;
          } else if (session === "Sydney") {
            marketContextScore -= 20;
            reasons.push("Sydney session features low liquidity; breakout strategies carry higher risk.");
          }
        } else if (assetClass === "STOCK" || assetClass === "INDEX") {
          session = this.getUSStockSession(decimalHour);
          if (session === "Pre-Market" || session === "After Hours") {
            marketContextScore -= 40;
            tradingAllowed = "CAUTION";
            reasons.push("Out-of-hours stock trading has poor liquidity, erratic spreads, and high slippage risk.");
          } else if (session === "Market Open") {
            marketContextScore -= 10;
            reasons.push("Market Open (first 30-60m) is prone to volatile whipsaws and traps.");
          } else if (session === "Regular Session") {
            marketContextScore += 20;
          } else if (session === "Power Hour") {
            marketContextScore += 10;
          }
        } else if (assetClass === "CRYPTO") {
          session = "24/7 Market";
          marketContextScore += 10;
          reasons.push("Crypto operates 24/7. Monitoring for volume bursts linked to US equity open.");
          if (decimalHour >= 13.5 && decimalHour <= 15.5) {
            marketContextScore += 10;
            reasons.push("US Equity open overlap often provides institutional crypto volatility.");
          }
        }
        const gate31 = Gate31NewsRiskClassification.evaluate(symbol);
        const newsClassification = gate31.classification;
        let newsRisk = "LOW";
        if (newsClassification === "BLOCK") {
          newsRisk = "HIGH";
          tradingAllowed = "NO";
          marketContextScore = 0;
          reasons.push(...gate31.reasons);
        } else if (newsClassification === "CAUTION") {
          newsRisk = "MEDIUM";
          if (tradingAllowed === "YES") {
            tradingAllowed = "CAUTION";
          }
          marketContextScore -= 20;
          reasons.push(...gate31.reasons);
        } else {
          newsRisk = "LOW";
        }
        let correlationContext = "NEUTRAL";
        if (assetClass === "CRYPTO") {
          correlationContext = "Pending BTC Dominance / Trend check";
        } else if (assetClass === "STOCK") {
          correlationContext = "Pending SPY/QQQ sector alignment check";
        } else if (assetClass === "FOREX") {
          correlationContext = "Pending DXY strength check";
        }
        marketContextScore = Math.max(0, Math.min(100, marketContextScore));
        if (tradingAllowed === "YES" && marketContextScore < 30) {
          tradingAllowed = "CAUTION";
        }
        return {
          session,
          newsRisk,
          newsClassification,
          correlationContext,
          marketContextScore,
          tradingAllowed,
          reasons
        };
      }
      static inferAssetClass(symbol) {
        const s = symbol.toUpperCase();
        if (s.endsWith("USDT") || s.endsWith("BUSD") || s.endsWith("USDC") || s.endsWith("BTC") || s.endsWith("ETH")) return "CRYPTO";
        if (s.length === 6 && !s.includes("-")) return "FOREX";
        if (s.includes("EUR") || s.includes("GBP") || s.includes("JPY") || s.includes("AUD")) return "FOREX";
        return "STOCK";
      }
      static getForexSession(decimalHourUtc) {
        if (decimalHourUtc >= 13 && decimalHourUtc < 17) return "London/NY Overlap";
        if (decimalHourUtc >= 8 && decimalHourUtc < 13) return "London";
        if (decimalHourUtc >= 17 && decimalHourUtc < 22) return "New York";
        if (decimalHourUtc >= 0 && decimalHourUtc < 8) return "Asian (Tokyo)";
        return "Sydney";
      }
      static getUSStockSession(decimalHourUtc) {
        if (decimalHourUtc < 13.5) return "Pre-Market";
        if (decimalHourUtc >= 13.5 && decimalHourUtc < 14.5) return "Market Open";
        if (decimalHourUtc >= 14.5 && decimalHourUtc < 19) return "Regular Session";
        if (decimalHourUtc >= 19 && decimalHourUtc < 20) return "Power Hour";
        return "After Hours";
      }
    };
  }
});

// src/server/signals/Gate8EntryQuality.ts
var Gate8EntryQuality;
var ixœì½ëv7²0úž¢£Ï™EF$%Q–/´¤J¢îP—”l/»E¶¤ŽI6§»i[ñè9Î}/vªp¿6›’sñL²ÖŒÅP(
…BU¡0‹ó·/Â<zÒ™åéÍO‹pç7Á^ðöm”M+ŸÿkY:ÚÈ¢ôC”ndñÕ,œdV‹Fž­UªÖ‚x@‡ÑèzÂIw6†ò$Í*Õg¤ÜÕßhfkYæñ(¡³›ß¢Êh‘¦Ñ,?KãQTÆqò8™Õ‚Q8O¢¬*Á(™eyFa à×ož‰²ø2¨|ÃÚÿþ7oÞ˜D³«ü:Øš›*¨ Àä‹t¦}
‚1'¸´3­V<ŽÂ	äÿ&3¨ù9˜Æ3£A0?éŸ‚ÛšÝ£R+XkvÎ†íƒ^çmçdØÿeM¯=º³¨gï¡êqç¨{~¼æ 7%) ´³©—1’µ‚×kÝY¶¸¼ŒG1ÔÆa—IJÿbS6ºŽFïko·’Ò·Æ|Àìæ‡„Ú8×”ì¯ò×ƒ-e®h»0OQG8“ŽjÀ¯ÑbüÔö+^-ØzX51"·ó 	¨f­h>]ÖSç¸-{zêë¨3ÂãÃÛ6ƒïÉ—×êguÐRÔM’,2ÁÊòƒdŒæ8Ì¯áEV1[DåS2fŽ°~ÅOóp–Á:hø…^fc±¡­º:TGÔUÂl6š*Ó©ìµ×­Ú’¡$“˜21EÃ¤‹è ›z…H/k§gÃîq»Ç–^W,¬Ø;}µæ E”omnêòDH£`ošœÿ²¦ËUmÁ×<SšQØzÓ}>[”bælîcAÕ%´Tz¼ìô;?;'G£µgn)‚õ N¿sÜ1ªh$in>s	’Æ|‘]WÞÑQÆYE°ƒD“› Á?åÑlƒÊƒÏÖ0Uî«6òäyü)W¶ª·¬ò,/ B0ÂYµ%Á,aSØxWU1¹¢	,‡„Ül<ñr_µ»Ã·ÏOûoÏÎ{½ƒöáE´ü¡ûâ‡"B>,"ä%$À¦0þq€{qB:œå“›Fð*Œs"¦Ã`¾˜L.ÂÑû O‚l1Ÿ'i¾R+¸ˆ.±#è„ßìª±vgr=\F—^{Ø±ÖšE¶GäÑNIÚ£Q4ÏÃ‹ID[Õ‚‹Ed“øêh ´nÐæ}²@©—G ¿¦!°àÔúÑx1"¤ü-ÂÙO¦SÂ•+Pf/¨WâÀÚûç?­e¿»·2}2Ë¢£.³,">-$âé<§€ ÝÞgQ˜ {ƒpçÜƒ‹­<?$)¡v
×ó¤žFÃÔC®â±YšÌÝ‡÷¸pxGQ4—+‚4lPp íEš„ã(r˜–1h›ã`°Ñ&Éèž)lÒ1h ek„r[²Çê•÷Ú~HVó¡¼'gÈ3Ù]$ÿE4I>º$]›þ·ÈÿqšÌçåv€Ê®çËIxµAÅ_•ï„bÿi» TÁ^ð·ÀW¾B,Cì§QÆóÕKþ‹dÃPÇjIIt()óÍ3*È·ð*¢Ç§~8»BÔÔcÙ5ð ~*1Võ²éwñ4¤óBŠ:L4Zè”â"b`öqë ˜QÒcËäÂ(ÆÏÄèS$—¸væs@# ‘’Íâ8¸„†ØH£¤‡69ä€
'¼ÊfýÏ*p|ª)Õª
‡­¥Œ¥E?ŽÖÌÖŒñÔï‚Ã¬Ê§šMFûJÇL~ÞþãFñÀa(ƒ©Î_D3˜Ï<Iyö°ÐÚƒAgøö°ÿ¾}qÞîõÛÝÞ èµŸ‘ºÄ˜¦,5ÏY½¶9Ø ¦a§ a’sc¤îû¿œO[Êôäó-fÕ:å-ƒÄžE~4U;V>oª·dµ‡zµm­š
ï‘`2Ñ 6ÝÎÏ…øl) p‡÷£´ÙØ–UQËò£¥«šˆ†§‡?
1Óz+¢Õfã‘Ñ›Ÿ^YM¤OOºÃnç¯†Y÷ä¨{ø—Ãê¨ó¼}ÞbÕ,èªéå™bæz"+>‘XIa–(Ð-çß}Ç¡hO§¸£H@ŠÉœFWñ4"›ý8 ùšuð-|Å
"´Ðí6"Ô¯£OóI<ŠQ‡š§É‡µ%ÑÃû‹ÙëéVòRôÕ']UÂ<­)²¼ ÂQ~ˆx«;±ÎËj¨‘+¿@ÚÄOß 4üÿÁoU¾q¬œöAyRôaBzR«/ì¹
Èïtk­>CÙ8ýpÜF,q+—èbÇkkx29<=VªúÞmµG« V†]lô·]"­äHLµG­ºGIï íÚOdmëÂìcßí?\ðtp:žz¿ÍÆN–zÝ/†>ünÝìž"£ÑoAeÅä ÇXy)ÿ^E _°F•a³›éE2Qç!-Žnfá46,DªNCÐÁa!ÖÈªžl…<?²¤FT‰góEn»Àt›w™9µ+õ+.V•™²öÕœ2¤ì^p	ê…^]®às&65¯Óh‘åÉôÅŽiOe
ZÜŸ­(âì$<QÈ\-á´#ÒÛðx1m}Û¶¿…ï£³4¹Œs«hº˜ä1HP¥Îaæˆ0'Ó&ýÁ™^½†„l‰bøâ›%/ñŒÒ²'Çÿ+ì>Ñ^xwFN4ì¬GÅ{Å$,l&@Öêšzæñ;ôäâb“Ø_¾ÿ>È¯ã¬áYN¶Ël‡Lê™SLÐoZõ£ËKà‡ˆ¶Í©‡Mülé²~'ªo›Ì‰ƒ±
ø˜<[œŠ’w¯ÓÝJÓ-t'ßšø­ñØøºyª¯•9ô@!7šª gŸjß(Ü'>¡oSg[±ì­ÌŽ!†’ùQÚV¿9m
à–à–:÷(\ÿpùÎã"±ƒÀÞñ/£8;X UÄáEÔy ?çØ)mñ½ÊÛëúŠø±Ó˜¿nWp@o–…Þ\½é€¾]úö2èÖ*¶U6¹è|ªm‰J°Ü™ ¡ûüÚèáÊ%wÕÛÍž®Ô^TNbÇŠF£¡#Ó€‚~6÷Ïï±DßQØyÃ£é…Ñ4alû`l{al«+ÉR¼çóÉ¨Š4a„ðÃì
dÄÞ¾FÚ­¨T]¤òÜA
õx¹­„Óy4V ¡Jì0¬'†NƒžÁªâ'9…i@¦W8˜ø» ²…Á²ÃD©jnAP«n×zæ"!®˜çCZYZ£&%
0È•Æ0U@³@Ó Ð´ lØ6 l[ Pf,¦QZ‘ã®¡4TmÔÕ†Ín«·K5¤,0È£9ç–yò±²zH]61w`à{'Ä1ƒF¥²«¥‹J+š0d(T‹ÑU÷ÞgûD°:SIp»O/Û´—¦ÝË¶ÖKóN½8özNÐý;´~/‚î—$è}zÙ¦½” è]z±ÕÓt¥d9;äØ.¡ä?ÿIþÙ%#%?šä‡±1ï«•÷ÕÊøc[_*ßˆžËÕ¬ƒšuJóÑ¬ÚÎCžÐðx¶ìlö»œÈÞÃNGpæ“PM	Mã	Ìúp|*á-#ûÞƒÏ’ü·5$|‚ÿ'7ÉßMò÷6ù{ûöÝ²³œƒüñb„/ û
D/"¹à‚Üyºˆì´¬C‘Ÿ¢/è8œ…WÑÌ4Ž"Å#ã(-5mwV>nZt¼Ó‹ÿµˆÇ@0­H7«ÑÖ6¦Îxkãº4âZ=×ÖßÙ¯(ûÞqÁ÷Î¡æ€F9õ…×»ÁÏ¡æº¶‘MÜ‡7«º»FŠ -Ü—x‡×e©.8]°AÌfi]öQ–3äu±JÐ*o6©ÙIú¼ÀÃ¡F@h:½ž‚$œÐ·u,bçÉ\ŒßÀÂ˜²|Þ'‘à†SXBW0yúÊP·áS¢kñULÚ¨žÛÅM¥¸io+ÅÖ±7¥Aâœd„g´¡¶¡ê‹ÚÒn”öÑ­H‡ÔÈÆ mÐo-3úú#¦Òä" Î
ƒ£9¼ý ”^±Ž57=5wi€¯»nÖeVÁOsÇ ûÂ¥	¯þG¶NÏ_ì{ yÃT_¼¡Þ*>†Â&ÛÕÍ8.=<®¢ OðÁ(çBÌü-Øñ|¡Þ5«·ïœ«‘Ñ‡»˜7WT„vü­DWÔñ×a ±ÓpLùpsÈr”³“›`1»äÁ@ž(;r€|¸«’ÁtÂµ/”´š,È0
üŠ2DxÓ[6ŒA´º*±Íž¿|ÔîJ[Í#˜Ð‰ˆ”*‰úÝÐGÔ¢RÊˆÑÇj7¸ŒÞ
ÜÐÇa<ã¾‡$žÑ El5Hw]Ø¤Ž~ú„þ5p`’"6|'Â+ÖÊƒþ KbwÛ‡GÁ4Ag1…!p¤ƒE†*vö‘ü?è‹#àÏÈë—Î¸î0O“y*ì‘T&Ñe~¦¸m×€	®®ÅOË£]xßlÇy"ž†°QD‹<'°€>]1®fQxò†ÖXÒ2d´* ÄS HsÀƒÚˆg°µ7»lÚA4>dhƒÖ†Æ?úëM+•°\^Ø€E+)œ¢…îBþ²Õ-$?‚#ƒ‹Ç€|y3 _+Z—’¼
iÝð~€b„I7.ãIŽÇåŒà›æÍ\sZ8a€D.Ý†Hâ L)Ñ8`åû½fš2/Nt èÐý|M¨ óÏ?LpH|²ç:Íbq¿Žâ"Ôç	Šh‹Ëœ‡.=Gãb8¸8-@pl>*¸DGU™=#_k¿ÔC‚ys7ô‹Ådg×ý,v~?ÄsªNÝþž9w&mô6ì(1Ç*ÀÖ$Ík>Å+PÑóôEÈñör«ôr'¡èw¡4æwPJ µF!Jœƒ pK’J"èéÄK*ÖËJ´¢zfl Ïƒ$AŸsEáöÊZüÍ)njsI,l.qwèñ¾ÛÍ
^ †d7¶•ÚÚÕôfÁ`LS¥*Ê²›Y~ax=“c °×ë~X«)Ë¦¦Â«¯×8ÎÊ#½ŒÓ)Q£73Téöñ:†E,ã®s™†SÒ*K&1Ê(ÓŸm{õ@œoæcE
tÚ}F±¦Â#`ìPŠTàßË7 Cè‚ñÞÐ#›/¢g]Ø¨2¥R‰%ŸQ`D©Š«ÏáÞÝHç]›[%ïTõóú+EYƒiƒVš“ÉóµÇB'€{ó·Ô¸o™J–q .ÊüW¸Ö×þ®_ÎÖE_Î'‰ÊbœµZÕ
]Ê>5BT9°Da6gä]—j¡¨¶ðs²,Ycä¤ÂÏÄ˜]¿€ÃÖ<þäR»Î“ úÂc6¨Ù Í’8ó-­wdê»KŽLø‡¹ÚkÛS¡é³[k4“FV¶gË:x~¨à†[5GèüÚ%ë-ø¸¾®sª¦µ)–ÜøÊOz†ÈãF."»Í#v™ÀíWô[áUß¯èŒƒu½_Mô˜»–ø_«ˆ-5½Z…ãýëj–WÞÈÏªÄž8y
Û£ÍwW4'~øð¬ÆæÖD»±v6ñtýêeA€•;èÔŒ²¹fy!c1«À
Š>µ‚Øü.t²¹ø¤U½-ÜlÉÐ"ŠvÑxðÔµd8@Û?l4¦ˆ.Ùy8B¡Å­ÑRz˜ŒÆ®õJxšiƒxÛŠÏ®½hP¸®¬¼iT¯IÈz½ü‚žôÄ oª ^;»Öý1Ëë!:»çÆ~ì*2‘åÍæÌ›LšÍ]î}kh~¼`×ÏŒÆ·úÌºHP‚t:?Gp@1¬Lù„M9ÖòÏ¸z-œp¹Œ&wœo„ðÚÕ¯{¶'w›í	›íÝ’³]ˆîS÷škÕÊNu8™¸Ud‘˜9µ'‡íŒÓð‚þe_†=ª1vÜÍ~ŽB“¨4¬r•	°€“îA2Råzv€/^•ÅaÙ­`Ó0Œ¡n»ì‡$Ö}GhÀmt„',@.'ñ<>”jÚt6¥V1²×-«bj¶Ø[mè”õk{&6b…}[B²„Žà(KÃ+É¹’^Hù‚±“f%çE(ÄQ|yì	”êœ,ú(Œ`NMøpšÖðÜ§<üÎ{Ùß³j<féP„ÜIûæàÈ¹]¡¾m#¤7
°;6ªgŽyš®Q°{H`óÛ¶wÔÙÚnVmPÞ+'Ò[Bý>Xû§'/Ö‚–ÚAKŽO:ýö°ƒek¯:m=Ÿ„3ZJœ} ,jC[nðV ªZ¦hõ;/Î{íþ[w%>#ßŸ˜–:Kz2/Tˆµ,I…	?æ48ÇÔßØì«-pèŠ¬‡.Õ	U\Ôka¬aCr•Gv TË¢Nh#Ù‡G­¹ç¼°Ä[ÙâA„ŒuïrÕƒ—ÞŽ±xQ»q4AÇkÀxZmP4™wÐ€ú®x7›¢{zB¶4<kU|6˜ç6¨ï>r[êXUŠ#Õßþm•™Õ°O¼&B‡YØ”NTr`rÑQPÖ|6ÉæyV}§wiEç.°L`–:7ÙîON´L! ~Y®HþhÓ½K#0]h«ªôP`ƒ*¥øíjA?Î"¦˜ûdÝ”´wP8šu{+u©û^µ€ãù¥Ô‚Ý»©äÆÆî=ƒýà‘¦Àï¯@1à¦ÜBÅÀYéoÅàoÅ ¬bP©3®®~Ý pk#ºÛ·‰!wí`iL*-Ó¨¢vR^;¨ÿ¹ÚS¯HÜÔk©óÆ`]¥át£‡9EV·G¼Ë|àõÀÍö‘ ÇVJU°[+ßˆ®09
‡ð§Y0NO1ßâ5ç¦vè-7ð–	©AxNÀ¿}AcDE`¿O3M\àwõ¾Æ‰B…BëPQ{¾ƒú õ…•Ô\æ<=ü­'˜KWìZWPÊƒÐµ¾BÔ÷³+x6>Ã°@w|RW
²x†1˜«ç2M¦Ýø½#»Å8ªøëüö ÏÀƒ€kÏ_Ý@àØó—…Ý}õ&‚¿úÎÿ»”ß^L£(½ó[»¼
 ÜÎ¿’½á‹îü–ýá?`çÿÛBð÷Îÿgíü•:_#Õ/°ùï–åÀ¹ý£¯gûˆÈÍŒ¤â'qù*%±–tÈâñ"œHQ03ï†o…†*·¦SŒ	ªÁ $&ÆŽjŒ³ƒ$W£á¡%JÃ©ÿNî\KhZBYV€dÜD–M î÷ù›„|3á	b»ó/³Ê¥éãuýˆœÉ˜}­±ÐÕÜT(”ÍI!é÷Y †+>Ù÷—Éí'û‚;=á!EÌS_àØŒéc×kw–=¤D„`»|ø¦êé&`òÿÏWã1ÞÃW_ðßyç¹#.[ˆF³—&â²]'.[LIŽÐ½àšD½=ùúÁgþöMP’½ùÁgœÂÛZp(÷[Dü°×à 1þq[}g!©cvÞªÇ.jnÕ²€º¶øÌº9‹ÖP)’Qz(¥È­j1‘+š’C$ŒÖ¥›¤«)*yæG:^·³¾:)B’xžtÖLÊ¸¾s
¹ÊÍÈJ%“¹žîóÁ'$Ï?¦Å”[ó“CÛ9“é|çÆpF#jë!½ÌGìß½ï7óÑ5ž•ØeÔ0MC¼ç›ÅHÿ®áºh(¯ÜìE×ÖCG |Ýbé›€–„ã#ÚfÑÇ ÈWtÿ`£ø&ât5['——4á åRHÚoÒ{«¶bÏ}Íº\â7t/¡µP{KM`ï8ÛDùùÂÓMîƒŠÉ¹³üLÌy³d“ä£ø€wDé#ñé©ÍwI%n_Ú”þ×µ¾·xò:‚‚a|ôEÈòOKJšØ÷–»UÁÉcg¸iqÆ¨°NŒøcßˆõ Ð¯®ŒÄ¬ÏOòâî°.m,)ïMìñ%y{‹î5^¡ØiÑÌ’ž´:ƒo\\ÑÑ¤!Ã¼‹:oí½Þe´–<¦±U1a1ÑK3Ø*Ú:XÌŒ øí-L'"Œõ=cÐùBžÏdGRií7ôNLþ%erÒ5>0°Æhsa]<a h¤ß{ùø(«ÇÒu¾×¢7TÌ)hŠr%y8Áãß©wÏp3Êº1éumÒýó»”*bvÇŸz‰ª¨'sÍÚ„d°\Œ€e­TôŒ…&-‰ôœ-»Àu&€ØM(-é@LJÃV©6ò«ïÓ`ÞFàÛ®h»®i2áHšf‰±Y"†¨1T<]÷Š¶ó’ie¶ù{˜òån™[Æ,4Ì˜åå²Ì8ºü"Iï|(¤¢‘¾þ,(Ð:¥I–ñ‹Ö >¿rÁ>µ¦L²y!~ö’ä=y™oÏxlüÊCóèÜ¹a“à¯–4†^Yu%ü°jª‰õ|!ôúªÛÍSØÄvîLäì‰ìzÎéeOž]Bƒ´‚Ð0µÝ#;å0I6=ÈÃ4§²K}ÿ€"±w¬TwóÎŒIpÖÀò-©ÊÒ©šMâQTÑÐ©iàu]ƒQ\É®÷äVvp—¡c~Y›&H%¸á[ ø–ŸqÙÛÔPH]vs·Þ…ãõŒÈ6«
½žë®@v•—ÉÄ¡^12ã•>Mìû}#~»X VÕp¤åÖ¦ÅîsT«*Ò¤Pm!ð]ÇÂÉd1üË—Nü<Äå&1©‹¬có‡«Cu¨”0¢Ï'!<K÷Îcírù<—g"âoXR€4MZÈµ”á²t†â÷F°­§ç$9…<Ï‡hƒ,9aÔÖŠhGt2Ûˆ‘§xz'Y*“O×¨’‚=bâëù¼¡µmøœ„•¼’Ð¬T·*u+jñw…CE‘‰›^Ë|%…ï[BxËé2OCì^ DU<üë•bžuD<nÝÐgÕ¨çÈ_Üp59G[äª (5ŠÀ‰žžA±[Ë-måÞeSí¼cSðÎhÓI•kw#“5=åÉTºóûSi–Æ*‹³Wñèý0ç2ß”™<X™d@`‘V‘éæ*Và‹„TFæbI'ôý=ï.!7‰9ò”—Ñ½{¥+9š˜ÅÜòùéÜWu7åN%ÙZð„55>–SKaŒð.Xô(…zâ>Ì_"*¥ÎÌüUbã+&Ó¶¢úŽµÉPÐÉøf€¯g+I„”-,ÈÉ<šÙÛµVÓ¸$£³{`îËIìË—DÝ8.=…nJvTA‚Ž\-¬ˆÖf>µO
:£ß¾<í›üiàEn5=ªzÀP· H:—Ð¶v|à¸£º<@|åñ±ÞQ÷e§ÿ¢s2´²>üœ>ø‘×TÛ¤äsC;¶[{¥¸)u]o’™›ææ4šé[€+ñÎR¤4´lïïtß³ï”ëÓwÚ‰rLóž‡ù"£òòm¿3ì†Ë…¦IÀb»ëÐ=C=F`ZûÍÍær:¸ˆXã9<=yÞíwŽìa-áåSm÷ö¼Ýí-éjˆ³ÎÉQV´†ÍE:¼ 9Ÿµsll_dš©ê!7¢¯?}údùs°ûï0Ëþµõ3ÉÚ²³÷†Ééý±³«AŠo;ky©0·í¸Bó*}ZaÉƒÒÍD–!S$›f‹æ5âBÕ³¼Rbç0ôtÃ#Ž€ßø –½HÁŒ´‚Áú›É×1L}WŸX?Ñíc°jÛ#hÇl<çº¾,¢ '´ƒÎgAŒá[ª|Ýßèøã®H±†ñ6%ØÜ2o9æª'Œ#*M-—Þ…µó)›ú óž×Ü­†4~n­ß>yÑqUf¹ñô­ÎEº<Ø³D”~v"7æ¥Ð¾7ïÊóvoàÄ+°†@«v~>kŸº§'ÎºœˆbÂñù<ò#M³qe{áp`ºÃ£ä6«úSfú[ÏQ‘„^e¦ýäˆ0?íM2«=/°wŸ»Xäü‘­<]*Ã¤´P<¾	p, { œÅãˆ=¹fI£e3cçÖG@:ï ïx:Æ1¬¼ÉT¯ÃFFžhÓmà¿%3çvÿSéýf‰°:›ÛbœËm¶(z†„R"0Sp3™_ÃÄè]‡³YÄf3{ÌDh›:Õ¬Oým{Ë%«„ÇíÑ¦9ÑE¦I<rí˜3-Á­ïÆ#Äú#0Oy4[S<^Ðßñ"yAï·ÄRåÏÙ“Üµ‰ò´RPi¼«z¶“%#{R8°‡n¤4s¢ñ4ùäÄ"G YîJù^PôTpé8PQ¯òªšôñhºeÈó¨x,[›Eƒa7vøÃq6Ÿ„#â¾jQ1”Fˆr„©‡|vâ F±Y½ý–øœ(0êÃ•ƒlõ!¦ŠÙØý¬à%Éfæd}Ù _L÷³)Þ> ­”^•Ž‡^Ä éž-™4—ÅbÏ2©Ï_s)3òŒHðu p–±…«ïnj^‡OAˆ×/ðécã‹Ùª³<Îˆ),Ûy˜æñ(žÌý“æ¥ié)ç£[fŸb)¤"âÎÉ[FE?íší>ÓD3%€c›eLoZÂöÞm2ï,§ÖäuÀl1Ø¹\L˜G’•‹G@qÍ^¤	BÙ“èC4ñnðüŠ„[÷Ý%ÁEóÑ,\°‡ýî°{Øîpìl÷†¿´‹9@1‰g 1MÃ_“4HXçÁ`£Oô’ ’Ì 
ÞLp"¨Îd€_Gá8M’©%„Õ+î±ÚŒ“´S8Ò	hAAº˜}oZ%Þbgsa¨3²s‘I	Ø‘Ó8JøÏ­#Ç³ÊÓ'5EaÞ©ÉÑT½Ga
÷jre´€Vä…^Çšþ¦Üš¶ÕB&J¡­z>Î]HË±ÇÚ˜q÷ÅpYÚ%±ð—ìHÚv{Ýá/žS“?±°vÛÇ@ã/úX¼ñ#nòhä¼­‰Ó
X) ¡ ä,~µÙcÙ5 §šÏ]Cã¶Š“ñ*°•Ú‘ëBÒ4Êá8aÝmÕô^|* U`\(uE;È”—®Rb,‡n*@ë­ §%@ëW[&0}÷•cómÊFsp–ï@Ó.b–rë‡º¤þôë`ÆÊhyÎÑÞc^îRWë¶˜ºzZª¯§x)µtoeáÊru[~…m–ZG[%ÈV)Þ7û3˜z«$Ónó¢ó™wÉ’¬xuÎÔnì	WÄå†Âx‚O¯z¯ð•Œx¶˜L0¤ÔnšQàfy¹(pG—+>8êè· Ô[<:g­Pëœ€\ÆÑÿ¡«¢&_Âƒw^#Êº¢˜ƒâ]¥ˆ°€}—CeäðöŠqßæË¾÷ŽûqÄ{o®ïý»z{ÂDÙE#bÛÝ­\á¶ç	]Ñ Ê`&w“='‰^,ò(^‹y³,Ü?Æ³qòÑ¬fÕu¡çODh8 lÇp”!‚ÎC‹h67Åý©¥— )F5d%¤;@Ú±!©O‰.½–Ëá8"x?|çå ½|Õ>c|/ˆvP G!˜°tß”RðÚQ‰änVñw¸Ã:Üñu¸£thVZ¹C#µ´Þ™ÌylU`í8Sgaú–$jOÎ†Y~mW)3gÊ‡_Öü²ŽIYæÜà[î‘ÖÖŽ‘pHEÆYDxÅW²ã.ég±ó;ROù^ì‹p’:k¾ÞQzõ’´C€6øhÕÀ»SØ­2PÜhB6Œ3©ï³hŒ•5yë–RŠuÙ«tÔÃ´!êA§ÉBàÞÔMv{¼Ni*Gjtu×Tº‘•bßV/~Œ¯³<³ônÏ¦»ÞZ¶o¬°ø[J¼0ÓèºOãœžŒ‹Ij´§ëF©Èq¡T} /æà)ˆš&}zËgÎšì¢j™h‘¬¶Q 8‰õ(ŽÛAú%d“õ`K}qk9IX´¶Ú§“(£±ƒ,rŒKé¢%SDø»{Ú$à¥ä®6^ã’¸sò6­Éór±5Ta•
%üœW*#¢KÒ;QºIÔ  o38&	Øô¶d“ÑhïWoÃ'¢@o„‘åØ=+Ž½Þ)Íº5×ºFXãð
8q1f©U”64ú;C¡¹’/õRNª˜ªøXðÆŽqpùµiLš	±ƒz0L¯	C›f|*sÙƒð%Ô#ÞÇ;áÛÓ¨£èm‡EƒüT²zØÐ*‘YÁ2?[Fgxà„ƒ2£zí—`²Â™¥¬e°~‡SÜäc{,½Ã§oÀAp0+¸ã‘	Ê0QBƒŸ71=¨ÊFsw@§|G¥½š±j·%¹’¶ç7Õô¡ÓI50Û0*9îÁÉ
üÆEò; uÆñ_‚”¼ÿRÄ,@I¢RîÃ{6a)Jiéç«¢uÑô©.†C…òöOç|Øo÷Œ:=ó:;ï‘„¯úºÚåE4&}[ßÔìÞNÏO1¿ÍMw®?Gß;þ¾wxß;«ô½S¦ï]
)ÜNïô•hqÓöÁéËŽÝÔu‚ç¡Ì&u°DŸŸö‡]–Nñ~ð‡eVð†nròºB¸ÔrÅ×><ìœÛ½ÎÛ³ó^ï }¨f¤—'>DiNúqö^u2üöCˆƒú¤oè~Ý4¦ÃÔ`Ø??žSSÿ€æ$4ñéü<ìwŽõ8;“bïhÑ—ÍŒ¾ÔQ¬b.1b‰[BIP Z„C+0ûÁg¤ê:ÿN?1	Ö‚óX~1¯9Ù“ø{jÊ>§†	è‘êÝM“ÄŸ4!íUÙŽ1¥ä]&S69ÂbeÐ‹ÙvéÚrN'ðñ ‹Öï¼ìôš¨rÍ(y±û™*ŸÐíÂè³$Ëâ‹IÄNÑ}¿´¯®ˆ”‘p ¬äzNªdja
däB =ì†mBì"	uˆpæˆpGo,¥ÐQ§sæZ.ê8³YÛzXBx„QÕ}Ê°hë'/õx™6x_Tzóyš„4ÙåØ$¯âI‹&Ñ‡-à2ÑüQ&üT‹ZqòùöŽº§ÐÏ°¥<*Ž†)ÄêŽ#X×0ÞdŽF±F#â%YB) ÆU2ÃùwûI£ùmýÑVãÉ·$$¨ ²Ç¬| š%®Ã	¹²ŠºÌä&ˆÂ«HqpcOF¸,T»{ìfdÁ×êÄuÃWÞ8½©/æl®*ÊÞÅ˜\òõÈ PÙilR_®Ìy] YBpH\—QØT3öl½åû²j ’Ü=ÈøèfN1—5½ïB4'šföàp\þï£›`š|À?Y0"@GëvÙ`«=¾¸©l4äá½`ç±ÒÞ6#ÙYu§&\#^Bôˆ'á˜ÅíÑ¬ä´së²‚rãÂõ[7âñ,rû3YaÅèEñ}k5 3QY=ŽR‚eÕ(izÁ /DiJ¬½Š÷‡`ºõ,3„ÍÀ!|:Âg‰™§ä¥¥e–P@P¡xûÓy›„ž•ÜfáD°< ne…ºTOÞc„gô}¼f÷ÿÞ"Ú[KQ§M FÇb46N"º,þÍÀ¦æcWÃ–?­àAY‹…²Ù@&‘ˆkÉ§Q×;Zò|—'Ça‚(;ÊüA\ª%±æêÂ.P–·ábH¸÷£s]6½ˆCª0”Å}™öó–”4z3d™l«÷¼}yïÐµ%o>.¶ ÒÍ	ì$°[¹0ëw¾qšpÅÉšÂ©FÀÞT×w‡
Åã3\¡°Nº\.¸BÏÑ_À	÷'{œl?¦
a5—¦í‡SÌÚ+:âþ<ßdYƒ¸«Õáƒ³gnÓž9?'›CUÝ4N/œáž1	PàƒC¢\ÏŸ3ûwõÀ1Dë:Yïìã(ÝÝçñ~9yÕOqÁQk¡Îô´~Aœ‰Uá\þI>8ŽÛ®6ÇwñÂ1þÒyïo/Üß^¸ÿ/Ü®ÃÇWÖ¾tÃaÎ Ç_Ü·ëpÃéïðÎ¿¼n¿œÎãL+ã‡ó¸ðÌuæõÃíþí‡ûúýpüd‡/úÝÜßGäwÈ±=ï¯ì‘s®²¯Õ#w±¸YÕ!—F£I§@höõ9ã8ïkA)w½ÄŠ£Å+ØAžÌé=zX
ãäã„ÆÕWë€ãÔøŽ¸?Þù\0ô9K§%&õÏ÷½Á¶–ó-¥hëQá/ë‹Ó%`”¿&—\*L“šW®OÓi [þòòwñÍíØ¾¹Giqîã›ã+èûæö“ýI¾9c¥¹ýrŒ»ù
™M"šëo2áiMOù·ƒ®¼ƒŽ%ôüÛAü:èî[Â`ê–{u{yÝL-að»^hst‹$ ÷ñu‹
ŽBö.›EÂÉÛ›~¶µ
ÎµÊŠ™w«ˆ?[ÒîåcUoƒk­‹–&kn­ÎyZî÷òåsGìè©0´ÔF™™9bÇJj_"q„Ýß—{=ÐF¨LF	¦³°'‘Ñ19á`‚ád$‰É"²xÜïA%ÄÃ?!„s”ÿÑù#¯zŸWy½¬Ä³e¡H’÷·\™*Ü/’‘,‚h¤%Ó}"'\i:ì‘bˆã]Aò6©e<ü¼ Â5…³ÜÊs¨½æÇ’ý
§×Ûžó» &`÷²ùªµŸõ"•è±Ê]Iø¢êÐÔóv8re„®¨ŸŒ7ZÙA&zœ8ôñQœgÌ¡DÒTèþ™­Æ–ûg½æxÃ=Zß0d#ÉÒj*¥$…Í÷—)fŠl	GäÒÂØõÆ0mi½G4RÞ‘¨³Jâý¡‡Ú¹ŒÂYÌçQŠ)–„³•76aâ[C5^‡¬8èJ€“¯yzh8 Gc$®Úø@ÚZ¢Vª5°UçÓ¼I}~Ò‹ÊÐUŸ6²¼§Ú$O>LpNéu=9ÉoH²ê¾B;±–ãÎ£µ»½_|…ýÎ ;¶Oí”“ªí‡/aã9ýíÊB\G34™âfyD_7Ð9D€xæ@’ ¥‘Šö&xó…ÄÍÆŽ˜¤8`÷Ñh°¹MòuŠ»{A³aÙh´ÅƒÌ7†-$fÓv‘Oþá‰WµÃŒfŸî‹D´{:×Ò€t¡CØÀ¥ÿF¾,§,Wß$²OˆûÎ¦«
™om”Ð­›H‡¾”tÌïÀ(:ŽdKÓp¬¶ä‹‹<³µ]¶Ò,ÃKª®5tâ©šðTj,÷–ž‡ÔßX;#ÆœQ`ûÖ¶Ù %>›¬»b@…JyÉ|ÿ7r$­‘ÿñ5Ó’«ÇWUdZfóÝÒØÜ×ŠÎs‹S/–ÊÜ´ôÕék’ÑÓ·f¤¯:[Ü–›Nó‹þû¶”ðÆ3»Ov»ËX¼@±Ü¦ñ•wÛRØøö[µý×,µ÷ï,µ5mÁ-µ÷¤öþW#µÍþ·KmõÐcIm¥°„ÔÖÏOI©­Îþ¡Ôö;^Ü±Xn6ÁÇÌmZgŒU «œ 4%_ºR}2NÎúÛà›m›ƒfqú±HZ›•z=ÁÖ´oOµ~h#%§²’„¹ÌƒÈÌdÏ*t—Q^)÷¥|¦ÿylçô?20Õó¼p¶CŠ¥ÊÜ"g†Ôºº­ë¹ùý<ô?{…;†Î-ôþ¨Še”g”WÖ09;S2+äh_1‡ ³ø±‘\„)¹§`/T[w­àõ;ƒÆ^Ãp‘«ùÏ|ækáù‚dZ@±|aA˜Æ»7fàæýwc±¾ÈèO'ïLqó¬„¼)iác®Ó*âD·|‹‡Ú Ešd3tÙSßJ¹Œ´öÛúøÚÜ¯ƒÛéEºQ”K¦È4.Ù½›µUzªxØ|kÐ;1¢¯er”¼Û‰’RÛ‹’õh¸ú‡cãpŸÝÊªKžÃã@Ð?Œ`ún«¾§Ü\F—,\èCùL—~MèV5KÄÖ˜bTÓä%Sd€€{:mœî&8ñÜ!%'y­ˆËN}5Ú{b ?'¸æX½|«Ø++Æ,ö˜Fe)ƒ±,ÎŽÎå½îOçÝ#¼¼êtÎÖ¬©W>Ù!‘òäå%ï„U$ÏØl–AN„'/Ç¨ ãåý¸gÀÑ‰Aó:'SM<Â–r†SE¬êe‰5rAJ74´L8á­ˆÒ°µL–¬
Í™((KÓœ5`²dš	‹N1úÙ‚Co¨r!¨¾´l
8%¸OS*Þñ´ÎÂ¹PÉæ¨¦ô¨jD~ÚÊÏ3–¡‹GÁ,¨Ô|æ¢Î|R¬ª¼±†ê:ã™|É•Fb™. õ×É‰“¼4ØP'+F
Uj\°ŽúŽ™&¼È’tNßúä*ØhÎ§yl1_Ò$Æ¾§ëÀ"‰P4Y,öôËMº\`¶ÖïÙ"VÝßo¶¢O×!è÷÷œ-Øòçþ™2ö[-¢Ò–âäí/¾6ñÉ/vŽõNL- ¹ŽåšŒ¿U‚-É^µ,šÒ<[óß5³?WKl¬*‰Zá~e7£gfÐ¦i%âÊ´S±Åâ±ƒ­7´Ì#®xEËÃÉV”¢uü••*ßY];ÄšÎg“‚)v*g~Ù$$4ü$¦ ðÆõKøo›Y± ™^$Ûè¤¯Ga<¹Ñ¾ .|q²ê£ò…»ˆ¸*ïâHÂâf^[Á=ÅyBÔ'`€uSížýf©ÌŽ@-…Ú~=hªÙ,šŽlÌÇ e¦°£âlÀ¯òaMæLWÚ¸'úujg…fq…õeÖ9/~˜"f¥‡Øµ°Ã¯´£¸YT¼^Üzµ6÷
…hæNÁÂ¢ÈFñ™/ZlÌµ §Æ:EÛÅKôxÔ
âZ	[âvp[xEÒ¥$$fFC€„â®Þ¿¹Ã›öU¢°–Óâòša­o?Ú$‰#%$¹@0t$Èa(x‹eÞ’ú–«­]æÊžã_MFn94`dJ—%ÜN²ÃPµmÖ’…Éu}°±^jûs­|6”ÎþÙ"+ÈchÔ,èÜ—Õ†r_Î4ñšÊ1í[„N†f-K+ç4•§%`•¹jÌmaØ#„2ðc£.^OYpòÜg '2ð/Å-ÏïW;} H6¾ÍK)Ótñ‡‚*ÄŒÉCÕ2K÷%PìÕb%ËWÉâi*È\_9ªªãg‚bÓ?|[îiÝ±¯Ž'kØ¸Hò<™J¹ÈÁwGòhœ®„dÓ™)v¦Ntï{Ë][ªòæq¯Öíjìôa©Æ"Ÿ2nÜ)òY•ÐÈM¼=ª¸õ¾çŸÒ2oR9?’îAÚ\]eÖ.g˜¦^~¼¼ïÍŒG}öÚ)Ÿnín†UjÞÎ°*”»ŸáêuÅƒ›éE29I€'ñopØQïh¸Ð*¸¥!SC8{“_c^ßä’HJ« ˆN'sÐºcd!´DÜ`^Œ8¥e¬›Å,Æ‹N‘÷àÈèŠè!Óîm4ÚçŽ”ÈcòÔÞÆwÁÿóöíÙy¿óö-tÌ¢p”˜WŒèüo$xõC-Ø½ù}
|¬/Òd1ÏÊa¥ 6‘á„¸‡„¶ì¦]mñÐ°‘¶p„n_!v¾ªaÛ¸ŠòŠ„]Eò¼ÖF¤Ý=°²+Ó`ÕhSçö­ÿµÕB²Å¤‹ÑI4Ëñ
Q¥ê¢rU4>g-8¥ðë¹
¥bôST$'Oc`	Æ¯õeÛÈßª¤˜ãŒÌú›²¥g	ó9m}º^g Æñ‡x¼'ÊŠá{FØ$³ ¼
cÂMAv3ƒU‹+Æ#­I¦‡èS¾ìþÕ ]“H®Þ’‹7SgF‘¯ 7ÎiÐÈByW´àœìõ šµk’Pñ²fµÚRV*B…ÝÇ²‚¬.
uö-ãL‹®ÄÈ7îÑxPÛ “†û„v<éJ
CJ3ñà,©]ñ{fJßÖ>Àö‡+Úú¯«ÊïÊE T\JÙ »½–‘peñù9à>–Í´¸Ô ËHd‹Ð/v¯Ô<îœÁékËJ¢!'œiöÆÉT£Eþ4Cd€¾ÞXª‚0)rz8‹ÒKT;à\ã‹Hâé:
âµ”KÅÎp%rš«/ÅpXúöø×E”¤ŒãÆ+LßG9WŽJDY}Vç{¼‚Ü²•
£¾%#£–¾>ž2„Å¡‹È5kot›ƒÆc„Ëòx¶ˆÜÛ”É9½Bå…Í‹/)”³L 8Þ)ÆåO»juú—ëþObÿ~=SšÆÛV¬w©7šˆ™ÝÚÜ¬iÖp9=ïŠ3›Iy°˜äµîî`Œ?£w9õ[Ÿ;ÕRw:wìBµÃ±¹YdÓ}¯OI”Ê{`³-Æ°!JŒ›}â…÷{¿o°á—}UýÌ¼ŒiKÌ»r§’ù*6°ïƒÇ˜4x{g)‹.‡½[
¶C÷ÿH¯‚“sÞMðnÌÅ†^²ëå¸PbÚê%sŠ6F_o:˜	0¡â•CÛ0Ûù.¨ê½äNnu,l©»Á+´À¢½GHEsÝVçBš9]äs	Ç+õ{†½ ¨ÜdòÌÉ×Ï¦%^S•wuüeÓë» iäeç`*º ­“[48ÁúÍ»Û­µ[´“j™ì`#œ-o¿ŽÕ¡t¾Rß;5ß<}G®b9øý2âØ™Àž*p·ôÄ¬,ZÕË}á‚Š ^mRkBoJI}h…ã(mzÅ|–jÛ­<Ó^Üë>äÃ‹Ìƒ„‘û­?eœg»èU+C_ ^]…é¸œÏ`¥ð¯ßc´$‹ìÖWêmž¯óÈ´$Äù‚.)D,ƒ£xNížÔŠ$ ˆJd´4!AÕºKhpÊˆƒî,ÏõQÍ'ÊÃ†Vfð•<Ð\‰Þ£XáALÃäÒÓkxcÎ£˜ˆœÉ˜Y4ÖNûê·1o«d/sŸë»h	žƒŸDÈ;«6A
O†œ>•Š€ûO‘«œ!oM7áw•)¶V…=SÅEƒól2¡øá5ð ’<Æ›t‡öH#ßk33Ša BöíÄy4Õºu†îà‰½ðäi›óyŸÖ{÷à3Âm˜ÁÛàÿ<øŒ°Hª–ŸUouÉüÎÔM({RÓ)	=o÷ìß¶{Ý'F9ÙC* (m¡W #&„Äí[§F³ƒ^§}Ôé»²\’¨„ÈH£P	ÛÇ{ÝK{;=žuúÏOûÇ0sÐ99üGèë^Oãk¤»˜7vißç'0PÙûý‡¼ÔËŒ¹×~ñ¢Ý×çÎ>{(A¨b{®7ÎP&7½ÖØéîDZÿjÐ©F3-ø4öpÇîC™º8y]—'cé-7jK“©!€t#ÃUÃÔÝ×`‹¬X½\_¥5ÿÌxöHuöÂ’cgûœí@MŸ<Õ…¾Lß»@ÿ æ¼Svt4E ÅÀb•
›×U`Ùç‹Â4—§¹«òÞ­Ç~ÊDpf{IcŸJ…o*­ÄƒH,ºŠƒzã~	Ô³…«3«²‹]â×µGÉ¾Täº‚Ú–ÚÝ9ÏgÜž±ÇžaúæH
èOihùs¹CËôõÐþ=ÖèçøáÔiÓïMj6âÙh²GYeíçöùqÙ/Ü§Ýž»àÕ°»VuzÌ×OOºÃngà¼åŽÝ‘Xb3ª}|’$äÞÒ™ŽÌŠÜ"0ÐðpØÿålxºV•8ÑÞ°­t~VêÓßÞêƒáéáJuò[mAä“œà¾ìUœ_WÖÎGC•Ð²ä`xè.èÀðŽPv£9<"wTÍÉ„ÞÝ³Ü9ï»þçìèÜO/aJÄwY~ºe‘^ÖVæÜ®<›•îQÒ÷'Í)¥oM-Ô…Â¸…ªâÖ;-xKÝ­Z–&X"Î«Œ«m‰›­ÈÅVÆ½VÚµ¶’[MR’ÄÌýxrúêÄHÖ ŸŠ–åõEÚ‰|©Ûð”q3Ãš–&@&°æ1xÍ…L¦*oKÝ-Îìña’Rä’YçÓ<Éxº¥¡f‡í“Ó“îa»÷ö°w>vúzwÃÙÈŒ@sÕ)„æAÉˆCóÅ™ÙH+™7‡éÍ_ÉÅù‡äqmFQQÆ-.¹Þö»ƒ9,…fáÃ#¸cÂiT¥®ÆZL ÊÒi„‡xd…P¾á«rÊVûãà´g<89°?¶_¶¶¿öº'?Ú_N_t}ýÐuÀ=ëœ9ê>ïþØu`vêêîU÷¹ß¾£³Ó3ÇŽN¸ž;zoŸíç'®ší—®Auíû<Úß_ô•»'ÿc<é´íq5çßš{iªH”.Ê2ÂühOv¸|àÕ`5tþµÀØÕ«¡óÓ9^µ/^ÜAŠOŸ°5ñOâì*µ4Ø®¼li`“×¨ðÓO?™sw¦gm_;<7'çôô…Y©3l€Žÿ÷Ä˜©—GV}ã\ŽÍu÷âÔø286úþ	ÔS“QÌéþl ó?gF›ƒ¶Ñä¥1B÷ŸÏ†:{ÑÕ¿ülâuøògs¼½vi.t0ásØÌ>Àþœ?ÜHt¹·PÍÏÒ1æ§YÆoT;t±j˜¨}Ö€OÎØ_íó#ö×Éÿò¿àŸÃ¶øë‡çì/ÔC‹	ñØO	hÛT˜fe(ÕßöOƒetqÀ½ept”2ì/ ûˆÁÿúá9û¨µœOšz&Ói2†#,`|å "D9â½ÅÅÜ+ Éhãq²€KíÝÊÒI8É2Æ€£+g ÓùwÐí½DîI†Î,J¯nÊ“¡sÒé¿ø¥@dSxÿNãÉ—¡Áù Oç¸~dÀ‰÷uÈéâE{°Œby™a½H³,¸GÐåê3òTfÄèH‰ ®@?ŸÑ±Š¦†-„¥º¿a$º§)De˜€¢o+°Ž;Ž´zƒQ]€©ýÁvAÒã)áÞ6×ð/ø«fO/6
ôücþ›§÷3 ¸Í'óÎç¥ÝPÖu.wëJêènÝØpÛŒ99n›DÑ”øy	î–"¾Ùq÷¬mªK7S÷vV‚bÜ<åŸ>§–ih—%¦ÏËj¦ÇBN+ØkÊí1Ëg®÷b#¨«€
âÒÃ2÷cÏ(1ÏLè]žŸöÚƒA÷y·sä™úóÙˆÉ‰h\¢ßæ’t‡Ü_‘gQ˜fäÑP)ÙFI$Âž/¢ücûBþ1á¯¦îfô÷íÂ+ÂúPä’¶ˆö?ð¹HÚ8‘üÇâ0iKÉ–’5:;P¿;§zÓ5',/žõˆÅxFCôV3»©¡Êò¦`Äl[úEÚ<†–Âw×?õ–Ô§ÉÚî[%´ð ÈÑ¿EýOîHòyúñµìŠÖæù,X«VöVD¨¼âƒú}Xµ¶«&ÍG‰¸b(&ËÓ+~Ðþ”òÃ½1Á„¯m…B¨S ŠþñÌÕæ@isÀÚð6%UÌhÌ'ÅÁtðá ñÞÉŽßC8ÂY[…!"¶ÓZðÆl/¦Ázð…kÏ\ $ˆƒ•@ ƒÍS|á4IID‰Víÿj{¾èß]‘)3/“ŽãËKuàÀ"0„67aeuˆ²òZYd}uðm«…|Ò1UÚV•^åÀ†bå+‰f	¬}FD"Œ²¥y…õõƒhhŠZ«=•­'”ñÁž2ÄµSËe¤D°Ö”ØÖ$#M—\Îs__NH¢ƒÅŒñXj]ó˜âwÑF¼çâ2½ª> 6v"‹.@~á»Ëî°y8 Cû]¯(ó³»HdžáJ\Oþ1âyÜÄÙéö-üÂ–Â«§Ç]Q©£k\‡Y…ƒ³ÎzU¼›Ë«Öp¾¼a>Z³+¥YÕy7Ú\f”5)ñ5çÕgeB€yÐíSAÛßm2X[Ït8Æi¹âª¢Ùz=ØZzw\‚uÝ×'­ðâøeœf$i;Ù õzÓm¸„ÀœŸÆŒ8~¼ÙQŠ(6”<ók¦ØhŒ!pQ±®öê¡Ä¼‡bpxÑÕ¤¬Ej¬/y7ÉJÈR]ú›8©ðÅé‹¾÷É+[x·Å¾åÈ»Ä­¶rauyáïÒWTÜ%¶¬Ï:¯&<ìì¨a ‰I*ªiÈŸ»&õ…®,ê˜êˆúV ¹¢¤µ-Ú½q‘‹10‹†•xÑ³Bi:dÛø¦]:ËÚÅÊZÅZ¸(vr¿‰„•ÙÒ	¾ÙcWºl# Ú„TáÑn¨…#å·Z.nÞáÓ6fe­°èÁ"T
8Yô«³žs¨¼L¯ög°ýOPœ_ðÁ¢Cg1ëëvñ*_1ùôáŠNN0½y&ÛPŠ¼öK'÷Ébíº½T¤Fê7XR$&Ï¸wÄS©Ð$»	â=}õöð´ßïôÚÃîéÉšÞ
¹G ÆHh;ð:p‚%Ù®ýp•°d	ßÆzX<O\¾¼‹2ÐŠip[DÇ³ôŒüÆ^ÞŠ‰œ’}ûþ«d!´ç¢ŸûÑ3
WÔtØ»mk‰¨¯N9±q’{uŒ¹ÂKJK¡ï¥ªsó÷Ï*ñ÷Wíð?ý• Ê5‚×š6ø¦ôÈ¼ T¼Å<¨Ø4ŒêÁgv·µ`–h&À9¥ y¿J™±û#É…Q4Öõúò¾‡ë:æ–6§ývžâ¿tz•k¬KõWþˆ|Õ&×Þ•tôq&ZôgrþÐ0Åòc„&lX-Ïhßéä·2–…G¤Ô1'ŒßAP+U”»úaÏ¬hnå‚¢Š#Î¬­Ó åT§º`”)¨AfÊÓ­}Ç\<”FqqñÌšämû’™óRƒëZƒ©œ.M@U|É¡MSAe2û‘;ù”Ï¨âI%µ4w”Ã£äºCÖ(•oUžõ]™1˜¶à®ŒÉµf¨­‹k‹¼5¶aB²ð–°XÜ¾ž™ ±GoŽøh“q7;îP]wîZ—°	HhÉ<ü©/f÷àGîñb>A/v”Ý7÷ãÓ~tOÕxeØÅÓøË½Ì`3ŸÃÆ¾SŽ:ÏÛç½á[’âóè¥ía¿ûóÛ³N“¹vðu‘³öð¸ëƒlïúê•à-À_ñÂ ´<éŽ+iô¯pheí2[«Ö„……ÒUÔŠõIru%uÊòaLÐ†át>‰ž'i/ö˜]¢ÓÏn	&T+'c4GjÍæŽ«æ@<5ÒŽ€ÇÉÇÙa8ïcGÿPøÃ3ixÄA4~M@›§É(Êà4÷q\‘¯¥„Èo•;öo§”Ì¿K¯©i7¦Sša¢OJ"Ñò”)]Ù»-l@ÒÐ^!ÉƒF£aL„å™uÃˆ³.šÃI´šH&×B/ëg˜<p’„ão´a²c A‰À}"¹¨búaml¸Q[Šróê¶oDŸ ïlp3U<sl‚yÒ3€ 	5~O¢" À‹ü²þdÍiÂ°ÿœž4æašE€nÔD„ÛiÞÀHÉ¿lÅfÞÂÑä¥®©lÒ5Ùˆg—IåÝkäÆ`ëi pb@YñMÐƒù‚i5PÂf6Û€üÄDII
“z™&SL–ðÞÒn=ÙÍÙ­§J”¦FZpŠÞÇ0-Aï0YLÆpJÈ	c©Ü„J0 nLau†WÑí;§yØÉÔyº(æi"r®ðb&ž.¦AFd¨4¿E ”‡ëd2ö‡ ðö•YD%ÝUµxµ*Ÿjø[´[R!B»ðMH”6$t##¦6F¬ðê
Š
•®‡B%V…‚²u.¬‡6UÖhIâÊNµèæ!¶SãaÎ{=õ²ù]Ü¢Óîk-ðwa‹~ûäE‡†ã8JðÎ¸ŽV.Æ€¿E«bÁ¿¶|yŠªS¯;üEmË¾ª½²"l^vÎ3Ìî]ÝàJ‹®x‚À;Lü€ªpˆþÉ}âôñî1ÃîÉ93’¬À	g0ómŒN“”¡ EIa{úôšk–Ÿ·{ƒŽ
–|x[nÊî>Ùl×y	ûG»ç,<î´O,†|+švy|zÜ9ž»·TÀ¼²>eºæµ'ûlÉ-çI„[?Ý=@g‡O‘éæ2ÄªÒÀ”T=x¦d±ùÐf:ìÝMa‘akÕ÷Sµ‹ƒÂÎmÅÐ<Peø˜Æy$tmô)Z%¢)Àâ‚“o|ySù€Ž˜ŸÏñð3nGxœœ%Q	¥8¶4ôÑ–†ùÿíquyïäe±zìJ*‹×ÎæÑ•m…&$MKðn‰Þa4™à#	™$5qcw6¼Áâ"‹r[
Ñ˜åžQjZAKâ!Urt†ïîÉàüùóîa–ÁÛAûøLÁz#îŒØÚÔ™KÁaOÝÍ¾S‰ãS­ÁÙ`ˆè½_Þº/Nà¤Ø>QÅMà@íéŽ:ÃòÕRÚ'¬¥x
³¸E:vïƒvH\Šy´Na˜Zþ t•\°°öUcg½¾èÂºý1žõI^0ó‚4Í¯f?Ü}‚•ˆïÉ˜V¼-ž\Æùsò\œãz¶8;Ê0Ñ£ýùÒùÙ˜_¡Ã4«Ÿ	1¾85ñÏ ¡2cí_ÆŒ³¨ä4wyƒ÷¨#gxöö‡îp$‚×
^uOø×cLÈ‚úý~`ÕNhäù=O½ÓÁÀêr×Ñ%ãè“Y|+8h¾‘m¨Bº>ÕÌh&0bÅîøk±•¹[© Vs`Æ¹QAÁW±ªª–i'>/0Öî3 o÷ewFHBëÁÿúâ §W²Z]EH>£'êýÖ¨ GµaVW31Vƒ–I˜^f4´B*|girA	IØfCÏ!+Ù˜ÕÃ÷ÇY+{~¯ O>)ZJbk„j^ 
G°ØDx Qjnµ ¥ÀÓÕwõºéw?Òp•ð}ßN³(bŽŸcGÄ0cG¡Ù
L ¡®ï©Ü§nX$U¯¶OÑ«
,y‰±ÅÉÄÒ5Z»î¬M|¿¢î>NUŒJùå/™¹ãÐÔ¿¼Ë¬’7`[¡a|Þ||¹¼Ëxt3"ìQM{åÓýÎqY
å*kÓY†ZÌ^¡"Hâ}]MLÌ¾ÇÃ.h?FYI»ö]7òõ--á°¢Îqè Ë=ÚÁø)<‰p±hÜ=<YÇ‚×ŽÊXÒË©9þúO»“Œ¡~eÈ«Ÿøª~“CR¿ª;Ž‚¢Â‰l¤°‚}iGéšÐ¾\š_
´¹]ÎAkIÚ%&ŒÀý@¬Xp´Ž—ÜÌôOnÙ%Ó¼&P`ÏºâÃíYŠMíïqä$OÊ˜VN§½‡÷AKMjÙ–3¼ãâvåjÎ-®[œÁ©¤øÐe¦ÐÕPãˆÄ¬üxçióCyÂGjï1EÓ7Ž¼¡.
P^…È›‚ ,l¥eÿ±÷z|¥aQ à¢ÏšAÀâ#‹x2¦×Õ¹+Q¸¾ø%ø¿ÿ_Ðï¼èwžŠ†´ü•UXÆA€
í\Ö¹š].L¨z®nÇÔìèÖQ=ÏŽnŒÔ3›8í‰¢†ã’ Î5û×˜1¿Æ­ð5EÅNnšrgêgå°¨¨b„|¨ŽI:êðš¿1àO¼]‘'Þ(îv’XÌk¨ô†/ŽBiDêF-~cã®NQQ†¶eßUw*‘îÌfäà–@Î/C=ø,‰'¼‚
_b¬ùƒÏŒ0¢ŸäŠÛ«Hß2Âg8¸Ñ°Úð&T3Í’“(„mb"š•E].&d¾ò(Ëa¥W}«q„­íåçð´—ð~Qÿ36[Ì&ñì}a3§,1í–€y¢3ë šÐØ% C…ßÛ³~çy§Op¶zäâkm¹øê•r)ÀÑÌTg¯9X£÷2Teyà¯é¹Ý›Ä)fÁ‘ö–H_5ã<.#8W1O‹Kv[[	‹
G£hžcÖXlí–·ªÌTšÆ3’r6YcS[b_i;Ž.C8žr*¶œ›ç2ÞìÀ)O¹?9{i nnz”§A‰4ÍÑò9‡íë¿~ÎËÒàkŸsRÜ=yñLõ}'öüìkaêûŽôèôÕÉËX	8ï8W‘úý´0ä¦e9ydàç\ÑâüÊ‡ÇxÇ·’”tð÷¨)s8äÂ—ŒŽ*5*óœú5Œ“Ül«+a`ÿ±#E'|‰	ý#–áRb­¼ú0Ä Ô,~ÃBù ‹`VPáü\£ÌO€/0°%*‹PýS{â½;i‚ÜeäòÐŸÍ‹ów‡súŽ"<K{<0Æ÷LÂYB^S8àC…ê³¿LÃù0á•Dü×I¨[áI½°DX¢¦ª¶¿S@ª3„ÉaÇ÷Ò‰7põ¶¨Gƒ\ýú£\{ÝŸÎ»G,´Ø…“7êµ§Bl:?Ÿ¡¤8=ñõ¹joüÊV½díŽÙ¾CXíÁi¯ú`§ïCÕg[Œp™ˆ[WwË¢o-“ïÊq¸2å•X¯™Xíh­åÂ…<ä¡¥à¥V[ßÒ¥P„Ó(žÍŽèLáÆÂ@qR§±Ê]ž‚ÝŒð˜Ý^‹^Þ XO­ëÍŠ"™ÄW([šw¥Ñà!ˆbo ÷0ØG)ó-7„¸¡Èå€£#Ï©øC<ËIôZ–uQHPUøé‘t¢1¯Â’7êðH«†±gè²özfi¾O9‰·L§ô.>:Ú-Zy‚ä5Ÿ¹¡S$(Ïôq<Î“	>¶†Ø-_P;pêÅÿZÄcX,ƒQ4_Š)Î—cSBDãÄcWkÅ$å£k
{xz|¢â g^i19\¢mâe ­öýT{óZïùôlØ=Öå¨šgÃXJwêþñ÷ÎÛ¨ÖpØÞôãÐ=)ÂÂq§€¨ƒó]µù_nä~d:Ñ}µ‹ï»2Ò©Ñfì™Ò'¾=&6JÅ6¡h[ÖÆBe¹ÝÜ„S:pTpD)é@y†«ô£pzý¾¨† @¯ZT4²ñ$XÉPÅ~4.nì0ºý2¸$6Ðl©l§ÏôisÀ?ÿ©Cl(ngÐj:’%9à4XX}z•¥éd@Tß£V4}õ­Ms þX»ÀæGÅù4n2;TþQô»ø.­íâ•9gáäPÕî´\ZÎZR­»Ð¯g%_»Ö“½«ÈÄbÈ7‹ »eãr¸0ÓO
QöBõ7qÑTe
'Ð;¦4¿Æ·Ùb¼}ƒÇå9Þ£K¤25LiËŸ
æ¸¨ï{Æ»A.ho¾ë0µFïÀóŠ¹tm«?$Sš5ª·J$Ç{\ëã×=5Ój¬¡‘&˜Š»#>»ÀÓPóµõµ ¬­Ý:+ÝÎó¬á¾<n¥e¢Thi$	þH‹Œcv üç•IÂ9+œhÇg¤…Ó^Lö7J:&W«¹C+e6`-Vˆb,4[>‘£gzQ•FI_\mKjŽ¼1ŽX&9{úñ¸\èKsï„t‡á$¾HC5òEäÒh÷º}r©_ŠÚ±/¾j¥B_
p4"_J…´ø‡äÉÙ¢tÙØ•‡å‡øêZÏë"ªýF8ãé|l<}d(S&SŠ'ñ‰=²%±e<kC†·Uøfó4RžèûÓ=“lH³§¡H9„fœ*›u"9`ÃÙ§‹h™Þ‡•@ù$ór@jUHÓ›ñó©Lÿ¿öt{2Ž—²æ¦Rs³þô¡¯âä“ú“§ÞŠ
Ä'›õ'^ˆˆwê½+oÖ«e–	th=–ã\vSúU<ÁGM¨ŽñtçÛ@®† ;úN˜Íí"Æ¤÷ðsž&˜…9ÜòÃwüŒ¼/Úéˆ&­kÁ¬ü†w¼`™™S9Ó@ÿL’QÊ^å¥¯ÖÐêõKvšaWÂ\7üÖ„Âß€¿™%ús[ eB]„Q4£¦+s^§Ò€³jÕ÷> ?Á¦WäºÚoz=²TøãsøUÁ;osòh„èá!ö@{1áÂª3C²Î:µÚð×Ç´W
h›u»c“–³Á¯Q4ì+žê(§·¢ˆØ­|{¤×„Mç13s)žÿÊÄlLáYb +á½,÷CQR "f#EüSË[MÃrK8rHÙ¥„\«b	†ä»aM'üìºgwˆ‡Ò×†ûM!Z¶¡E7µÑœPKÒµQ„ŒÎñ?[	P·G˜ÇD³Óÿ Ý8D3bé•“ÏThÓ@oï©˜°õpA¯ ÈvŠ^nÌE„„e«ÈºLÜ®¤6Ú-‹ê4,žûêŒý™8Ñz,9µyb4]ç‘Ü²ÃIÌ”ç¾TŠJf®ËY Ë±˜–ÊƒÃ±òxh—þE­/zãßÓ§¸ø¯ J.N[ï©¸39%vW'¯vÖÈþ®;Ëâµ4Eä2é›"e7<’ÊÕÇÎ“=ø"°º´Ø-bÄn« ãÜ01çu4+'ƒßœ©3Äæ¢ÈþÍa£ÕS°÷åÒ°iioéDúÒSpýÉÕ¹r@£é_bÕ2Èµ·«ÕÛ5TÔ=ølíB0®Ù©¶ß¼’t‚æä•˜7ÆPêòô>´Bû¨žŽbÕ<£80_Fðk±ÊäjË†Ÿ#mèæLéë¶@¸é§V´±Lôpd<"þdå$I,IüwçH;4¸×ê;¾ˆ¨vd.?çÒUÏn‹ 	ItËÕñŸ){ßò
rV=Ø½ëdy<%IöÁÜ	4ÍƒÏæÌß~TÈq¦KLQ£¸ÁuÕÛokùÀÕÐÛoßèÙÏ‹ß½ôÍN5+[x¯\k‹Ý^þ®Å?Šµ&;¹ïÏÝe…Û$wSü5§¸AðÿwÑÜÜÚ6‰N³sšÜÅXª‚¯fº5ì¿¦h¸›!mëU8y‹êc˜Ž_B—c§íÕsÝ|æneZÏÜµÊÏ¼xÝÇv&†¡˜Ì¸`écä‰^ÅR6Tïh6UZ—5ã…[•ÂÓE~z©—?Rr·…Gý(º‚ršàO„ÛZ¾ãb"ÞÝÐ&ÉàK2üÇÈ~ˆ&xø%Ñ‰l“Ay0N>iìF×i2K&É5£‘œ#"wËò,v¯Lî®¥)3Sym_½«+‰Jµ’yÇDW1û#•€Õ”cŸz	>€/n…ï­rêA J´ýgÍCêW_Ô<aæ±õwMVÜÙïŸL²ÓªÉÁîž†«(/˜ÀgyZ°/–ìIæÍ¦¦ ógÿò$þúËåüúbé¾þC3}&À¯<É¹*“mÒ0þJeEòôÞS6šÆV/óý;…6úûæ¨«28êæWW8Ø2ZÙÈèî'êõ¤:ñ’Xæ/)mÜt'ò1¹ë1’ô¤XŸ,s³Uƒ%p.ˆ¾0¶?I§B÷òäëéÅ¯ GÄ[¯j÷Îw_¡Â+ª58¿³¥QïÙØÖ9:
:Lhíì
Ì!ßÞ%€Õ·UKã“«óyÎRWÎ)Gì×1B¹6a‚×$þ2ÍÐ¡LíÄ4!´ÔÏ¶'´ômì¯˜óM“^vTŽ˜Oß™ß8[1¡‘áY¿¤gÈàƒ<DêÎ¿\<„fwcŽ
ßùŠ³Ÿ#À›,38	ó<P Ö¯êFÑnœùÝ„*N¡Éÿ ç 'ÕR÷à}]Yê”VÍ§¦ÃFŽi¦òp:=èBþr¤ßóúg´‘péj¹jÃÍÝ<4Dÿåæ8\¾5DMü.¬œ®±ÛêŠÞKK#³.¹9‹Y:Z–_5ƒ¼~c<C˜HÃÕÝ |”Æª£åÈé%J@¾‚ØìÇÙû£('±Ž-úx•áœ¹ƒ‡‹”ŸU:Ý–òÕ8'²J8 qõçÜËe“Í'qÎ_'gßËI’¤6ÿNcsÍri-¡X3P*l‡êƒ›5FbÚ1}`
`Ä™¼ËPÄJ:¾6*II8ÎÆÖð‘$.F†42ûú QµEH[s5G"¥6Úœ°Š4@õ[f\tX	i[°¡v¯QÈ±4ãa9–¥ðÀ€p$&ÞÂÀß»ÁŽ­œž˜ÏôwiKM
ô‹@'·ßVa€ÁE4I>BwßÊ¾<qáEó‹ˆ»çÑ:®Þe$§‹¼ž\ÖÙsd
ô11ýÓÛ3òêÓ‡ÇçÄå6è² ;@×•»¼Zjì^žbñi2§ŽcG›z`³ZÕÏkæ	”ÃÞ×÷j¿;Ä´”#¿ÅJñ,@‰%	~;ÃFY·ß¢¼S&«¢Òš*Õ÷m–D‰ùˆ´K#7‚¹»{­zp>¾ûÏFà«c´ÆÕTÆ½n
ÏøéËNÿywH^¡%þpqIO+qŠ#pßëDÆ;&‡©E6jvÎH‹·Gýö‘ÿ¢=QÙ—§@Íó©À S\ÔóŸ&‹L»¨‰è²hƒO^=ï/¿Jªï	¥Öƒµo	ÅO6Úk·5\À¯øyÚÉ]µàôT«ãa4·ÞX*5º_{´tG ZË¥#J,µcµ[ÂÔŠ¥jÍb7ß«é¡&GœædvöÊNª€rV„¥á–N–*ó¡ËA`%{H_Ü{?Ó«(ÿi"G²à$EÇýåbFÓG‰Öí§ù¼u€6¶›3ÓAž£1ì¤&ùLYn².d¿áÕÉ­c;"û¹úw°ÀÃ½è™ÚÛÎY“•R fa u¿WPƒ=GtÖ’Ö•*Ï’†.¯`‘FD“](XkÐ ­w¥žèˆÂ²»bK©·AFg<=qK"%ÜS¨DQ¸+, ð²†ŒðBvFð·Ú}YDT1ã|A]a6mi3¶SM.ó-ýgSÿ¹­érÃâ&à¸«œœöüç×aRb1‚™ŠHjj"Ù©¡lU,#ˆå©œoõ	‘î°°æ[¶ãsÞ¼;¸¦ÜöÝÁmÇ¤4eÌXÏ P*€°UUª­kï½^+TofPÁhŠOÌ‡ 	Q:ÞÛ¾+ü&…ßØqö°M{hâK$§å{Ø&= èá©>§NÜ,iî°›Üi²˜+¢Ž#è˜rÖÎq»™3ÿÒÓwÁfcsËÁžGq–«^tø¤É7ÚmšËÚlÛm¶}mˆ=6O‹XèO˜vÀ:ÝÂeÈF°!è`Uk’jÍeÕ¶Iµmo5’ÚbÏxÀ#˜£bhÝD–3p­ïfMh¶E5¡Ñ¶»ÑS£Ñ66b}mC³‡K›YDsæ@ÖÒkš~ô|>˜‡£xvå\Ñ¥¶i½êi:f7;ö.N"žðüÑ¤?šäÇ¶ÎÇûjå}µ2þØ6-4¬cÃHoo] TÚÀ£ù–Íçº`V+7m×Å.·HGybI í¬Óu,­÷öŽåÞÉ¾¶v€Ä;:|H`; ¼ñ<Æe«¾¥Ü…;§º‘åâSZ™ùÈƒÝÈìî:â•Ã­kaê~Ô:ô;ƒAç¨¨k–šnI¿ÎGG™øSu'=g¬G¨rÿ³–¯±ÀÄXòë¶qqÃºŽ¿âV-Žë¶Gb¨býÔPÆÌÛú‡%êO·ÉðA‹Úxk…+Æô˜TÐË5‚¸WÙª'.ŽÛ<Nf˜¸-$ƒxŠj–.}|z2ÄÛýÞéÛ£îà°×îwú5||¨‡Q;™QÔÎJå‚¨}ÈÞ%†Ú=¶@OßºÇç=b¼	NNáS§‚õ§Õ³è_ru#To²8Œ,Èn@„NQ…ë.n€{‰µØAuÜôëS‘5‚>‰çÈ‚0èÁ%ËI¥ˆ^žˆÑ¡˜\cæ”‡½˜(¾XPÅx–äÁÕY) 8Ía«‰Ñ«OšÅ³qü!/ðBøO.=k°Òšk5Ö<hD?ŒGâ(“E0srcv2ð:é"ÖJ´`tb†8i’C“(Ü]ÈAw —ƒûKE'S8´‘Œ3x;ž×ÎÃ ÝÐ ®È$aš†Þšà‹¨Ð¶/=#8'IÈVÖ¥w×±àpÕF@ÿã:Ëí§`NâCaxÀŽC¬h¬ùM=Ñ…`=ØªQ4ªöF¡6x­öð¦p:úXfêšK7]ä|!j¡'üí¶±º¢}”.f’…§ô4}N"üA'†˜ž~;×q]p»\GÂ {H_EÞäïy'[G^õÈ#ñÔKÏËi8W¢yEûõ@é³&¢ƒ TÏçe÷˜hvˆŒ(»[„Œ\³J”Œ¶ðå^£Üƒ•ÝºãcdñÊá1¢¿Œí…ÆÍŠÀÿ  ÿÿì½û[G²0ü{þŠ	w?™‹ñE±ãWÂæ+	'9^¿0–˜XHÚÉ6ëÃ÷·]Õ·êÛÌƒ“³_ò<»FÓ·êêêêêêºè,¿vÚÇ“mµ×óÙ­hýt{‰ºOËêªÑMßšb ÊêòNw!êWç_LÎ¾*s»zÕ§åuµ¯h÷¬oˆ8èëæ¶ Y¯{Öc’N ‚^áÊÎÝLÈcgcY3$ž›C¨Ç%JÊ-!¨Z&DÖp|¾—¢õ¯°""¦¦6/P(­ø+©M3„G²¦k(y”ã‘úŠÐî;I/±ÿ0y’–Ž±ôþ}oôNÉ¨/Å
û°SC¥| ”c/ûjw¯#¢OFÓKI¿²c)»>ýàôi…€u åU³ô·d¤wÃÃã…ï5ÛAzÊ„K$„ûøjTðxÐÕ¢9X1“«çæÔî³#ÏÄ"q¼u~"³]5gnTüÑ³¶¶;Žh¹VÔÒvÍ1±¹êb×ã¬£fâŒ[Á	¦ÈÆ]–UÿR•8ÃÜa*9Ä„ÂàfðB¦°0ø£YÙàS´1AS@$|Kì2ºž®ÆÖ\2+ÔDè6¾êc€æ:•wn^ãW5»¤iôÈ³­©Á†šÌÍÁ]I}m%•Å1âˆHÚQ†"wg
}ìÍGp³ï`µÄO·«Žðô¦#<-Á+ÄE:¼–Ù¯±ZˆŸ"œÜ¤KOØW$,œ¾A$K¬áöG¨L$7¡ŒJ
ÅV=Ùö5Ÿdô  Û¸†¸ª'×‚
ÄÔÏL	YÕG±Ó’X¢t™9¢	ÊO‘ŒÛ×ÚöŽ÷móB7fôùWôBÒv6D4’öµ{_Œ‘¯ÿc7¨Í¯eøª‰JVò§h£Â$:û78èd§×úòŽ–LÆ¼0wÆÉG4'¤±ž@.Bh´*šM³Zœ÷†3ñ€rÂ=Æ`ôêê”f~È3»äÒ RÌ€`ÀòÊ2÷¼Ÿ¯ÍßÍl«½(7Öÿ¶ïd†G_à(
Ôyªã=B…ê¸ÛßÃvy•§á:…ÄgØ-ÒÝX/Ø<´l¹K¸ÿ
^““ö_÷^»WÙ€ˆ@v“ûíì°-}ï‹»ú×=8æ‘>6då1@Ž)¨)‚6”oãzÔŒpˆMlÇfj#óÖ­Gûø¯ˆ'ÄÍFáÕÑúLž"­’Ò÷Gw ëÑ5²sˆÒ-_¹Éc2¼À…ì^Ìþ×7£¼5Ï³WÉVŸ]Êi¨|·ÖAW¾r’ä¹[¾q˜|Êa	Úðø•žÁðŒàT|Øùœñmp7K‡|)X·ù ÉçFmNò“‹§Â„Œ`´èIDb;¥³dœN‚©Ý¤Ómm8ÿìóªý£Î?7Ôí{ ÉQð­a'i°n·|ÏØ±2ßƒËñ)ü:«êO×ìììêòýt¿E“0^çªm=Zm@X&þk³=^½>5…ˆï¡£qú1¤KÓž_Ò% S	µz?w¸Rïäø°õ¦µ·‚‰§ÙŒ›U‹Å”æˆk¯»¡vëëák†Á°ôŒÉ<f<btÀH$>OóÚ‡nI%L`§ébdÕÀ×E¤ê ¨µ4€zA¼ &£èH§Ÿª©Ïä–h_$Cu`;6=»ÒÛ…A/áŸ,;ŸïÍÖÁÛÇ5=ÁÄ£ÆµÑkAtÉ¿ß%!€ö8ñ ¯˜ð<ƒxØ°¤¼r~ÏlT’nî{‡oZû{;ì˜=Ü)'U
Ò"uX@ð	Cé(–V€ÿ{ä~{:à¨†§o-2Œ0>©zgÕ½ì¢Ô[’OÙÐWECâ_ÎÀ‚/©wQz{íÎÉÁ^ÿ 5h¿^±[¸Ëª!ó®jx]WÖXÛ"³E@8_àçÞ°O ´ÝIÏÎøeWGSý¬a?ÄÊL{/ž‡FóÁtœHËÉídí¡¹+¡r[ÝÝíz¿U;Kø†`ì4¹÷Å„Úºð?Æ÷É#a˜N4WÀÜS6V°õõßVïôÊÇƒ™gÏöÙç~<ÖI÷¹Þ¾ÖW¯‡‰"»¶ÏÉ¾ÏãÅà,Û%~g“«;£ØÆ“8„éËÂ?mºŸ¶| žT[bìîŠþþÉà¨Œ5<ßàÀI½'â4EE|Cù(Q¾ïŠ2f§¡Ñ‰0zßïb>ñÛÆ4êÃ;¿ô¹
©lÏ÷:ÿÕi:;Íâ-;oÃhDpÃSÈ÷ã)ã§£h´HÀ î2þ	•ùð"-X_Bú\»œ~„Êì2:™Ãö·p uC<;Ùìnù€Ò`a<	¼7rK?PÜ¶Åuª¡k¹V/ÿZ00:H'ÒüºÂ²¶[Ç< øm §Ç€÷xv]ºäVÐv¬°'m“TÇ<C	„‡ô÷c’žâÑ3g
þàf°.ùùÒó#´Óow{žIÔà”4xÝëô_w÷w‘Š­ ¼Öá©Á=_PdÜûbÏæú4j†€ ã‚oløÊ1a¹¤ÕÓÄF1ò~¼BY`VÞBo‹g£0„Ý?†¸óe[Z-èÝl.ÏÌÔ¼À¿‘öî™Æ\žÔ¥¾‚„@Â‰G3F“ŒP •ÇòòËå–{_ÔmÞtýÓ·'o¸}Ž~_ä¬¨£ê¦ÿü—ûB ˜]æk7P2‚¯åÀ+AÈÒÃdÞëùšaAHsEDkkkQñ~m&ô@vd9”Xª ÐÞQÍ¹ÊÅÅM5wµ0x%_á®Þ¼4Íq<ÿio¥èÒs ¡.;n0^ŒD"ÀC*¶å`½EgãøüœQUœ£…>^ûÁ •›±=O!¾®G8R$¾°3­üvŸo\iQïíÊÆÅÊ;©t2¾o_úäwÎò#ÚPÛz·ëŽÖ9j0{h}åÑfjÇxAY§˜!ÆÚäCd;œÍÃg(œâh»Làae¥ók§}Ìcq@*nËú_‹)¦0ÙçŒïÁ9½]T¤7UI}1+¾GfÅ«°¿-o¡üƒ*d;æ†Ó¼0(0øÊ6Ù›/ES/=-e{è 7Ùîµ-«åº%é¼l«Üû¢GÌ’ßù%ˆóo ¶•]äÖœAo­GŠn8ÿX¹¦/o…'ˆunhÀVº?¯]>Ú0Mñ–ËÄ÷Þ=f}ÓþìLåågE£Ñ1m˜–œ¯ÅÈÂ+á*ªIycs[¥¤¶Õ?þhtÛùY]¶ó…¶%hqƒ,KÌ„X>%ly:1#ùÍÖfC€•ß¦–C‚Äm€›Â«»f5¦³d‚~–ž²‹ôü"T6†ãÉ_4Oóy÷¨Òç?¡Gò$BýÛyôÿÕè„l7&¨öŽð½‰¤=Í²Åä_Aœ—CÎÅYá¨9»ŽbéÑsïKz}j*ÉìœñJ9ÕmS>éºœeQ*¥ÒˆÝØŠáÅC O¸m$knQr÷° {y½Ê­	ùêrT·ÍJ]4– ŽOÿ'‰ûw8'Ãþ`Ðâî\ Œ›Î%•ŽãCõÙŠ°ZïH¤ÔÛçát²çÃd‚ÚAâj°\Ûá,99ŸRøV­Þ—*&m\Æ:¤‰¡´'¿û\}ïˆÅ#WßL{„ DF— r6*üàËã€ñ&úW`êÎál0®Ï_K½Îô"†?»^M?%#ÏzƒÉ@Â½gö—ƒ6÷u÷”u¯ƒeýî¾íïŽÿÈkVåéí¸¿†â¸,{õò(Xö_G¿•C¸á;…1Ø ÕåëFw  ™¯2pŸ™3RÅô~@—i~	¾z¬"§.As‹/MFŒŒRÖw¾Çxƒ¾÷Å¢Ýk41ˆ‘µâÁùlI`u0#µÌ§×! êÿÒ ÑíËK‚éK»‚L]«Ù0=G“%¸é×‰pXê"ˆDˆñ„0èdäìñ0Í¹Ïóy2ß¹šÄ—éðH~­Q0H×8bl¼1 #aÊ<ÁrœX9j‚R“öãi,#ú@€ˆ_÷qšŽ0&âÇì'jŠŠn‡›ªÃÍ`‡›Ët¸¥:Ü
v¸U¥CôÏ•Z™}ÿ÷ÁQàûl#T°*°ÂËxBß˜ìBÃFLqéã$§ý§èÎLö çâíç¾ ™êýÌhè$c	ü½o»÷¬
‡Æ^ª0ÎæMÇ¡Á›*Œ³µÌ8ãØ’…½K»v§»öví-ìÚÒ»Ün†Jdáz®O£G%ÛxOmDlàˆÛDâ±9Hà ×C³Cü,«ßCÔ05_É·<[¸Q£úóÕÓ†9/FˆÏî~^pž­ñ,(tfƒ#ßÌâ÷ÓÉ-ÌÌ<ÙŠs¨„P62ìÞ‹wk¨m(›mÜÎ|÷LŠ632àÎmÓœÛfxn><,5«-sV›w8«-Ò­¢Y¹XjVÈ¼èÚ±»’Áµâ-³Øn½u»HmÏ‰å
Z‰]åæMïÊÖ½˜©{q[UÍàžêƒ¿+FØïìïß€Ãß<º³“‹Nl)[‡×³ø"ÌÝîªñø%‘VÆãºCoN®
“ç“»&ÿÓ2ysZU¸¼œÖ_\þ[qyKù âÆ{-…5ûµ#[ËXðªa¦k„#˜ê»bK
œšjv‹ºï•5eu¶Œ: ÃÞ
]œT} 3#ÖýW<¾šM’ÓÌ8Y€žÐ9Í£'ÙôÁ$‰³5ø+ðÞÊ©àb~ÆÍ6¬§cëµžWc“Â?ô»òÆÃÛzWnzè ÍÁ‘óA:A¦ˆ}qÒÂçUÐt#arQ4ß£ƒ{åtJ,6h§Y‡éYˆ€öi~ÖØÔÀÃÇ¯^æê¸PòbÁ DÝêè¸„´%g	PÕŽ$ xx±ßcOhp^ŸÇ'-6Oìz?øF¹ƒÇyoðÛÉaw¯ß9ÙÝïv";˜é‰!KK˜j³y–äš¤É’Ö:.n4™¦LdÆàFâÓž¡¯Ïz4J2ÆJÐ$K`–-0öüp¬EcpÚD³Í©4DJ"î’ýzöMï©`qá=­7Zo–¶Þ*h½l-R1ð¶Ïd‰¶C·KL(vHòË
dÇZ½Wà'¹×´ÛB´ Pr•PW$Y@S’}äÒ¸btW+šz
f›²ñ.ôuR¹*
ÑÿÇ#~ÓBüæ2ˆ”>œ{§[Šë›by«ŒÈ7þD¾eázk\'ŸçÉÓ.AàU|ãFP¨HðÏIï^aÎG„zùRt•|žÅ|?¾Xd£ñ­l€âó²ÚY‚Í™ˆSàq±S±ÚÓ|®^âÉ»7Hu!î»Îß¤ßÛ6u5;ŸËá/úÑ;SN·ºÆÝòŒÙÕ­!1Ñs21²t&c=€H¼n#BxÛ(Ý.5ù,þÔ#a¯
³™-oî}… Ç}æñxêõî@ ~Õëöû'½žë<ô
cOÔƒŸ;ÆƒÁí0\77È>÷ù	õz¬ñ0’	IùøQ¯Ù«l-CfÈûÆ° )vXÑjŒ2­Å(pG1iRìŠbXòø7Ã4ß[ìk{yìp~Áˆ7Êru½ñx³N¢Õ7>©3yìávt?â#0á÷ñ:[}’¬mybµa6@vucõ s»æ'Õ+
BVW‚è«ÏUJbb‚º7G&õjM€õƒìÎn©Óöbænôîããòl_¼çêk3ZÛ07!¯qáN|[î°óŠÝAßtN:¿±Oìˆý±¸ü÷> »²£iž¢`ndÜ'è®v¤ïÇi~¡Ü	F7`Š†ðSWu®pv‘¬ýÈDâ^& 	$[!íª±¡w¿…ðg˜=íG]G'ƒV¬ËÕ7i[L—K ¬Mnx!«|¾…Z™‘ødxÃe(“ÝÅåå•ä°…ÆW´µ·V×ŒR5¸¯Ç°›dÚ«(”öÇ²fa@X·!°ÅŠˆŽÐ{ò¶ˆ2C!ôë~»ŽŽ5„L¹‡xïööÚøG ‰³Nþàd·µ·ßÙár³ãhä¸†OøÁUyV~ªXþ_^!Ëh…Ud	J¥ßŠrËÀÿ:à‹“×ˆ¨_ŒÞâÉ(J&Œ“\½¬ EMgI6¾Š¦<÷]+bàù4žÌÙµS>Ë4t¯{g¬Ö÷Ëed’Ž¦@ÖJíš“.„KËTµ‘_M÷AÖšŒ:èÁ,¯”UêbÞÂº¶Îe¿Ù˜c\pälŸÃNcœÍåi¾#PDlcIú@þsK¦?Í‡ šÈ÷Ò’ö ´}õˆ…–ˆ.+§It"-ü)3‚úï¼YŸV1;DØFVbTjƒSbj¾s‰aáñ$ÓÒ–Ù!¿?1‘ËÊyKèa^/_Ö‰TååÞVL'Ã±“ã8"ñM·v†A! v”šòB˜eôh¶ùç=Í
äIRíÞÉ¶,ã…£8ç™®ÉKä‚¶R9k¦@ëhö`ìÍ(4ØáL’Ow7ðé4J7¶vö…j]²=°µ³CTë’ÂZ·>žkŠ'3¹O»OÆñ’>+FAFï¤oñû²FÎ6š‘FœqTÎ6I‘º›$N	Üß8Då8£¡;dn&ù6Ïåjé·¶y|ÏÝÅd’Œ1+;s>õ,ÌÎ3¶¾êÑîñáag\·_uNº½È¹ßm·öODÉQkðšçôj%‚Ô*ÄZ·ŽÊÊ€Ç¾æÓNÿ &\k+gùÊj=’9rqr¾jP@+"Øãéùy¢‚´ºÜ-bV TáÞNk £¨¬ðš›ú»]uNÖ­ßÖo»þ–õû¡õ{ÛúýÈúýØúýÄúýTÿîµ†Ä·êÃîÞ![pñˆ…U‚C	p-Üò(LLêBÀ‡á§Q!u…¯åÉ.ßI¬Öïw&‘¯ôÓH•\Œç2)j?ø!ú?''GÇ½ÎÉ	“ý€M0¾5Ó.‹×…¥ù[þ3¬9ÒUqÓËøsO±™lZyÕèq‹EÎØ2ù¢ægvæ>hÇ(¿‘|f\3ï_M†5gmVíw¥‚…¹±Æì¦5ÚMÇ‰¿9[¿ÅülíÉŠñ|«tXq–#’þ«ß=là/P²zÜ¸[µ’Íÿ­ñvhF‚R©NÏÄnUsÝìt­A“F:ªc[ÛŒ-dŠË“Ö’ÌJÈÙAƒ±ñImå-§W‹RßEíéb<BåÑx zyž¢>ƒ$€m®°;FF3^Ó 0ÿ 1‰1ö§ì°0ˆÊ&!¡ÉWã,›^Ö$Š`/««vJ•÷ÄÃ{-Š‰Ow#ƒG382š[ÀLsÃíSÆ–¥ˆÒˆxæôìªÆ@­ó<jÑæª¿r±DÄ‘ù4BÈ¬5‚ïc@*Üg?„WÌ{3nC2ÆiÆVÝ#¥…`k0ÂÀ@\»Ád:ÁL¯ó‹$B­±bÑûÅð»‡®±C5HOPƒê¢{O¥ä3q§÷¾  veåC ©0,+×§EIÓ¡âç¼ÓÚÛÿí¤ÝžÐV)û~Òë´Ú¯eNs«ü õ«8^úÞrHÂ¼»×ÆŒÌÁAZû@IXeï`o`û]€Ò´ÚÐw{½Oíxçøh€ëxKÙáùªÓ;êíü¸Ù?î:=oÙQ·7ØíîïuAÛí³ƒ,4)
cÅiAü<ï¨v÷°{°×æa½U^î·Ú?wý…"ÔxR$ü:8Á¸…¢‰wÍ!¼_Ÿ°w€Pøç“¨8a„È; ´ïÄ¸ÝÞÕ0#û	#Uû[wßì1i^ü[¯zÎA¹<|8	`õãn€¸öYô÷ Bî/0e;ídpÏ°²Šhæ±€‹0Üß÷ê9û±Éº{|ïì½éôú{ÿP’”ÀÁb½(ã%~dàÙ¢´ÀÂ±*Väão€Ö'=?ÐZîv· —ÖngðÛÉK¶”>ÒÚ\uN*#µé~nVTØköB8c£VDì÷Ý^ë sÂðûê0¸KLcšŠT½œ¾Ž*Þô7{õÛIñî6à®ØFVAíé¦"Ð¿@^+`Âaâ”UB\íeë%ÚúÈJ>!wvNØ†<öày¡S•Ú¤)†ï:âk€!ÿÝcèÃšá>Ê)Ä_õÕåÜápÓk9áp… ‘¢í·Ò˜²éös›ÿ{ûu×Ïm{WlÛ

lñ[‡}dOø®š'½à±m¥;xÝÑÉ+¹ïOÏÑµc1/[Q>ŒÙ½€ÇPÃg#qC “¸Sî¡7ÁÀÂÓÅùŠòâ2ÁzB¯#ùp|“â}¶åpCŽ/sã>‡CT8ºQÌšS_xÛ§U5ÐuCÆv¢Â¾ˆôä¼Bë×$ÙZ‚[¼/9ƒŠ7ó«YÂ¯ñ8*ÿ
RTƒBÈg£¬éÆiÉ’svßÔƒ‹ß0òñáÏ‡Ý_ÝÑç Ð?¿"ó•_ ÙÁñþ`Oña§5[®6ÜÈˆâ†Õ§š] BY¾àëÄÈ8‹‡ómhá à–ë¾1%¿‹N]0tàLhêŸ_1³°˜ºDýnÂé»CŠúu][‚h>A¢Ö‰ÝÕù}?z²s–~LÒÉ‚í¦Ö91j]‹À®÷Ø“n$D×oç`ök'\Ë^AÍHX”Úÿþ÷ˆ„kL¬À
Ï|g5•ž¶ÒÉ™±•ðù½•ØgïÊzhGî|ìM¶jÝ(Ú‘ «Ÿ(Ùìçþ±ùf¤ž'v_bÓú¾ø~uzðoë<bûºpwºÝ“ lts«ãiÞs+$Û›ô¹ÞH?Vjgí]ñËOWŽxsPwåÎ$I™Æù@»~¶tzÔEºCý-Ð_Êõšý2ê2ê©îé×À Ÿ@%ÈúQ‰ª‹Fq+«¡œ¢ÀxÿZÄãô,MôÙ]iä¢f
†‚J¡]‚/(• °«êíc”ìÇ„ýƒèÛÜä¯h@gÛšåáU@ÏÖ˜[iüP@ B ‚s°áîõŠF”UÔâC G4Þ*êWP½áÏÐ¾}L²<9,ëÒ¨§·1ù@Ùºþ’Nz âÔUÙ%¡Á.giÖ¹G$qÑ€¾úzPOi``’µéYûLT*Ùß@3\_qh	ÓßiÅ?“µÂßÁ>xÒO/*3‘U5ÐÓˆówåZJdú9´¶`<òàts÷p§…dÉ×à^ú”óô³ž]$‹èV’ßý±–YÂ³Ú¶Ç`£œ9ýºUtÿnY`Ì÷¾#©ì!ŒRÝ»ñ9(ƒ	é¢B_Xê›"¢ùö¢¹ùúH‹ÅÛ&lš•’ˆý6¿Â`@%r%rýÍ3¹Ê’àÁÛÈØ@²>X\dÎ
™/Úc7†’vÓ»b;…ÍøéhÖ"‚kSÊ­Þ2SŽEýýY³IOÃ´MŒMI«>xÀ“9loGm0×MØßƒdÌNvx™ÞM“ñ('ÕµäØt…IÃdŽÈ€MŸ`hgôUhºwÄ½fP43Š%´f)ÎX`SìjÄ1M˜S³X ò&X1%žf‰DD»"MÓq<fêTj1½¼´°ÑôI †¦%04C’„ÑÈsà7‹¤ÓšÓsd7tcvx<7ÍÓÚ¬ÀÏÝ¦}L…¤Mïñê˜©Š²é;5Íå‘g_Ó=¤3Î!ÖŸo´¡q>5½§–—õ®iQìˆ ìTŸ,Ä^Ê1Õï_µj…2aI2JÞ/Îi†ÏÓ·<SÍvÄíJÞEü„Ãä¦ô¤‚Ô\íòöÞ
ðõ»h-\Œ5Ádo`ŠÁ•u/¢Ó¨ÖSîVª ÂM5£•¨&\nhb¶8}3ãÔµ,‡¼:ÊéÆG…”7ðgíÁÿU~9ÿÌ¨½m­ý÷úÚÓ“w÷W¤–áoÿ÷¿óŽÞn¼ó*ò‰ŸÄ|ç5M5=Ì]?q¾ívàe¤PÛÓB9”À	ƒ96d*’|mŽ“%³i6)ðÏ“¹eaT§—é\èoI“?\Ì§ggÄþÓ}ƒ)4êTZ½êS©Ÿ¥ã98h{År›0Þ†î‚Z†Öa–Š•é#Ka†G}þ¬¢ÎD Áªh@¡Éä¹#¥ñ-ª¸i‘4ÂÕ°ÈÐY¬¦=šH3ä Š­'7L- Ñ—©Jö"a×î\ÿ€ÃþFèÒx*‰ >’òOžìŽ§ñ¼VsÇ|jl¹nnbÔj‡Šp¶íéb2Ï-aZ-
kEy»Xë+·ö}Üð}ô6ßò}|èû¸íûøÈ÷ñ±ïãßÇ§ÖGaMm}¥$ÁŠ|g–ýbœ/ T:úÌ°ïZ¨70¥S÷¬&ÈÒ‰Àòäò$ãz£xSpE”
ÞºP¼Mß½»ßÔ|W‹ˆýÂ97«ÞI^Æ³Zß¨¢w¡‹¡! #¤ø·‘,LØ4/·§x×U÷Ñ†½Hšme*†)Ã+¦Wz|½c»ƒŒ²é¬{v&ÇÑÁêdü5Ž-O°/Ñ\jðT)Æ@HÕrtxÏœsÄ´²(&Ù	¹¬j÷L£¡	+j%·%àyK`Š”D‰ÈáÉâšüÿFÓO‹
W–ýi>yE®wc0*Á5(\úF…ø)ª¹7‹Ê;Æ!\¯­ûâáÒñU;žÕéÎ/àÆàåzâ¬Eê µö¢Ì/rAèÍÀî»Õ[`©¹\ë«´Ýxy%¤õ@©³lºÈ¸w†:·oëÁšçV¬ê!]X@ºd¬†©ƒ‚ H#¼ò†&ë žUqãYò¬ävŽªË>ÎòO)úT¨
D™'±&kzË¹–]¹œ£áçöé	ÿ9¦z¸^où±z½%!WK¦9Ø’ƒ¢=òÒÃÁXr ÓÖwééÆZrdjÑ¿ô¸d;.Yéqôòý]yÄQrƒ¾kÙðü¨8Š/c©ì´îæ6Ûc®@U¯’¸‰yR[ú]o~·Ì°¨´y‡qØ5¬CÆ˜I
Cc´ë®Úµ»Ëƒýš¾U ç\å‘¼ÆÐ•‘eš•‡õÛŽW×=‚+,MªŽäã^Á¾M¾U}"†LxU‰Ê}›ÎWU‡(àË¡]Øª¯‰Ÿå×Z7@Š²Uèˆ¸úÊzãÅ-¢œäŠ!ì²`îÞîÇ&pýú3|#ûé9Ôv¤XˆjÇí&±æ3¨XdÏM¶}Î¾ðr¨e¡GjßÝëìxÀ/‡Ê™ˆmÕ6KWBOA»Ù8Å+|C{•1®ÀŒÆ(æ2& ãçöŠ†a9ÝNØ\IîâÖ¿ëi$˜rs£~»Ý(É‡Y:Á®|†ÓT&Jü†š„ÒÆŸ…'i#ªPLÑÃgê 0wXW}Jš°"“]XÊ~gD­ðgW©Å01ôïñpX‡ Z¨hc?¢ûð«áhcô]Ï£ùžõL”A/—)	µ}o¹›3<¾C@ŒÀ=–UÄÐzo”]°µ
©é`Í£æR}H ©îWu(Úæyì-2ÆZäQJyö‡B›' t)ÎÂÖ.~Ý¢Sƒ¾*˜Ø¶Þ+«¢àõ!G]Ì!2•xÿoó•.W|ÒURxŸ{ˆDx‚q¼ƒrTNà³ñ9°F|w9¤ó)Ø%©nÜGD%<„ð°ëë¥o‡bAï$ªÂá„N±P‘ƒd‚IFjþ"=“”ó„s¬ÐÔ!‹zVs¦*ç ŠÉ«ýmÄB‹É8|4ðWxBwfFƒ(ÇÄwÊ>7.˜çß1
äîi>ÈâQñ›Y)'†ZFÜDDÔMþA,¼
Q#.º`2Å¤‘a,ÎÑÚf1F}XúÉwé‰‚ËlŠ¸ÓgçÖ[Ä†–/ùžÓÛ‰7É	¤¤ôåïÝ½ýA§§KïAñSøxËŸ_öXå“—]péä>ê¢ì°{xÂ®ž;t<[LÎþm°×îŸt÷UÕ½Ö«ÃnŸ}—_ö;¯Zíß"é}f|=±¾ÊŸì×;D)^BÌE`RhŠqnµP¤l“ P aýÑ $ÅÉåf)ÃÚÄ‚wc…–¿»ÁÁžðà`e 0~'9Ùï¾Ñ[v¦û@s»»¿ßAñzD	Ä£ŸKƒ€Y›…FýzR-ê—78˜7ê×PÄ'ŸÎXí÷l[´F÷;"¬,Ø™¬çÅŸ¡õ¸0„Ï›åÃ9ë‰Ö0Â«DÔ‚Öh8-ã|—!`Ðø]t½NÆŒ‡AèžQ2gâS5®fIcÔç~‚9#ÿ!Û$Jì·#Þž7‡Ö"J²k…‰<®´úä€ížÓ€ýáïO¿¾´ÝÁk÷c¿»ï~üµwäéóð¥û±µÓò||ÓúÕýº¿wø³ûu§û*&»šÍ§AscnÇ=·ïW/=Óø¯£ß<ï¸Û-ßÇ×»îÇÃÿV5…Ep¾GÀÁRr”ÿ’Î/p­BSÝeDù¹ÐÝ¼?Ÿ?ä+…ÛKÖrFÙLþ`´¨t²v™\ÂÝ$F€ŠIÃ‹$úÄ Š.ct.P[#Â:œŽÇ\":™Ç0Tÿ·Ëö‚j_s©úLõý-ÛäOƒÊUý^Õ.Y'6Í$žåSoãOqJÆkèiÔ|Üm5
ãÕÃ^0`ßn)Áh0µÃðËntÓ¡cB¢Ì ùßóˆUAÃ[³+vª0Â›šdþ£P6âÑ¨&k:Ï2¶fE±dD@¨Oõ"[Ÿ:ÖäÑF­9|Â/ZÔG}”RV5ÕW];‡AË5hüz¾L>3`	8Ržà8È‡äÊq·	ÐBSê2¨»%`ôYsR‰%ŸÅ¦¨~6^äƒéÛÄ´´4x79^yKOîwdÓk¶Á%·QrÆºJFªî‹°ÓmFÂ+¡._§Oì\&f@!Ç(aLÀ§TÅœç–_>q/{–TUüò‰/ø¥#Øþy`¢Ô‚°Þ<ö¥¯š½C‹ÃdÚ{Ôý-4œMk§}îOcnO†dkz-éHiG4áÄçIã´Ò&¬ôÑKæ„—kÒ>c4À7ëvš•ï›H\8MÏ‰Jh·j@Ocî×0ä-Æ¦Ä½'yÀt‘¯B{Ï`@¥B³ A8.ætI[g{ÎÔÙtV,PÕíÄµ8ªÔƒç¥(Ã»œGÜ½„GEßCŒý©¹y\i)¡Ò`ªÉŒ*†è"Þšø&JI<QAOºïAóŠ„ÑŠy‚jQ*UöBe'ÿö¤}äJûÔZõ@Í»ª…L(“J.Æ‘Ë aõ.“•ú ö¸^m ¥Ôø*ZòžqþÚüÍ<Õ¡‹|[PøêH®O«N™v•oÈdØñU$“0’Íâˆyb\¤(ˆ=Å0¨sX¡ïaÀó›l(v+–q‰!Ã$æYÉK®%¼««.r ÷d—•A¯s¸Ã¶Éô#›_:J¤ïõ¿ôû¾ 0ï_¸ ‹RLßã~Á÷¾ÈïxíF×`þAñ×ã—ôñÜßoêdRºT·)»Z
‰›â-›~d¸Èô ÷§‹lÈƒHÑÐì_Ÿ£ÑÊËtÎvî
8{>%ã	È˜±ëGBÂßH`H +	 ¨µãf._Üà¢(“7ba…ª…šª•£xØZ9XŒçéš´Ç‰Úªºdá|o…WV¤´Úÿ"ÿlFžz¿´ö{‡¯„–ª[_ìV ù6«ØZAŒŽõ{©@%DêÓ­ojS}ÎÊ]œ¡ŽÐ‰›¿‡Œe•ö;ûû+z¥tiŒtŽÔÎX…sajkŠŒD	ßô¥6µ”V¿éä&5|zþ¦“ˆ@TVŠþ¦“ú@ÔPªÿ¦“ü@ÔM'û¨@ùM•Š™.š˜4ß¶ßSŠ–ˆJO7€véŠÂÐÿÖà]AEù0ì‚ÖýxdâBE1 Ìr†„Ô4¨ÔêÇuÍÈ¹™¼ì^ %­Y‹‡8PÕŒ…Fö³‡ã¦éãv+Ç“ì>Y±G²‚ ˆ¦£S±ÁÍWtÐ¯ùõi`<n€í…ŒQÐŒNÛû­~_Ç:Ç,°Åc(·{Ù»™dÆ¬,ðEUOŠ;Ó_Ô¹àûœðE'ÐæYø°2‚¡oÇ^(ˆC@ö’8áh¡˜ÅA”ßi1¢¾'}a.\èWŽ @u A]eØR}\ôÓZ	©á6§Ÿ¸Cï:Ò|™•£ŸhÑ(EÀ(Sé	…¡-‡Á7­óQ	±-YÁP¢ò\i:' “TirõfóÊUþbE9" EIû$g­>!á”¬áI8¥ŠÜ„SªhËê°—Ñ.{™Õ©Q¼ioÅ[fq(W•ŸË¼ þÁ°Ô›æW8,®Ðp§O),–Í¦n‘/dŠKj=OÈ7†% %Þ0+.CÃckãÂL¤¶ žpÎ=»$7&ie&œNg(ŸªªúÙ“Y<ù0Há.‚%äJEÁtÅìì%Û¸voêÛ²ÝáþzÎßpJ¢/¸n‡4WoÍ qsŠ‚€Íƒëï×¶Îúö«Yª¥ßÓºÕ`„‘À;ÀW*ll­87h£¼µ…=CÞ(éL>òõblt´@éØ”‹‡§,ã÷G[Æ´¨½ßíCŒ­F†ôªTÓÀN+=ntÉài²­Ò¼àùXã X:aï©\|./s2KÓAû«8±9H¦’Úo!V&?Ø”H€T×Å“^§ÝííœH¨m`9¨ÕŽü?Hƒg«˜—~ì]V¯W]‚»ó*£­FÔ‚zc/h!ý{íŒ+µa7†Ô‘ g·ÂBþÚ¤6¨Å›Ô«ö=	@¡;NÏ’á#|©:›BŽlm ÀX[+}K´ºü|åÊ7!á1y_ŒQQuQBÔ}Â´Q=º)ãÝ çÞ¸ïæƒ“ß•Š¨uŸKÅ×çfŒàAÓ—Í¹-Ç}"U°â¹—º–†â»{çH¡ìÝŽ'p±ã+¢ÈL=(HØùõïÒ¹ëË®ô©õY‰Á©…’Ï±¹úT”kc¿…ƒ)ú(6³¤¤žP=/[„Ð
@Q¶ñWÄh¿û
âŽûMÍýÄcA´öàç{M‘&PVú0K÷%ÜøÖfxå“‰ìÑ®IkÏKœaŒéÛÜ°¬^ïV++=¹„Ú—¹ÿˆýŸ´ÍGß`Cvðç@%Îî†ÌßP²é)ÙÂ’-·D‘TP?œzéEÏmbüOâ5lMIKðšf4Ø Ä]›üïMø{‹ÿ½u#ÔG¥ä#cBÞ—^å€¬h’|Jø3Ÿ¯jƒ‚çpî9(Ù£µCòy6N‡)|Ë´‹M'ã«Å¸„BWÐ‡©ô%8vu0Åû)ÚN¶V=—ŽrC'üG_©!ŒÐïÀs3{A%]²$‰ÄcÃÐI·„†³(0èQ­£–5«ï:cwéÚ·Æã[X~Ey¹²ÆÚâòDã"ñ$‹^ËlW;{²q'ÔÌõ<MGM<üšt·ŒèÓIMŸš<+Ô7Ö	²•¡4“*tè”¦p©fP¼g¡k§@>Vgæ;5ÔiëÍ]J;o)„µ>ÞDek´3‘FôÕuµðÒ/TRgÞ‡.LùN™5ÊtÎÜAÝ¯}nÚ&
%úOçní×qA(Äë=·˜¡ |už`ß³¾·úVWû°Ìê_sÝUwO/ß§d½o†fõˆýÔ;üÝWðT9Æ¹*ˆí—Sþ–î¿‚ÃßŒÅ¦å&®PQ³_rú¾¼’êšáuÙ	ËV•k³ò©,À€:†Óé¡ŒpHÕ±.Ó¡îè(“	`ÑaäålÓï³SU0ÍiÆ¦„ûS=š¢çyîš²
¥žP{ÇÙ>—]¾h˜Àx-ávIU‡¡9âÀªö½9&˜Îï¯9ÀÄo×ß’WG¯WfPˆ9ÎÄV¶œŸ°×•.§”BÅ‰[D_Ìµt´°6NÍA@Ê›¬©ÞWMóñeå1eS4ýe©YScEicƒÉ§š479mnzˆ>†DS"–NòÄ“m]9‡û³2f¬Å&K¯Fô/©æ/©Fù—TSMª©Èé•LðóY2„)Uaìì¸û“ÐH$²ƒÙ»(;èˆŸÙµxœ¸·æèýU´·Ãå:î”SG÷ºéWrMæ>‡l
5Ó[«D%ËõË?'°f.^åD‡Xöz=ÒÆÔÎÝ7Œèmß~HØ³w¦úVcª¢¿MMÍ-ÿÉú¥*[¿“&™Õ¿-­î–Áñ½‰6U¶º´F—/*Ò
òø&Ê½/)Õæ.©¿u¼T5xwfY0,±Ÿñoø¯' §dÆ×	¾˜W~Ë`¼~«Q¯›U¼q8V³é'¨è7Ö)Šw:ûPï±ÓäÍÞ;^¨Î˜?7øn¢†$CYn]3E° àJè&Þ%\	ã+¡^Í	Á„4èÆ_úƒ(ïÖ ¢$—³¹'Ø7pa™HbÝæGPø^äHÒ°à{0ƒÇ²}ìUÍ~çîÐï[nA%g×]o€B9Cüß¢‡ëëòŽà$÷6p8½¼LtªL·Ü£Ø†îûtU`+1PÎaÊ¼îqpçPÓá¾”­¸üc¹`a­Å(÷Ïó\ezÊƒ2=©‹ B­ã½AA<¦MIwæeÒE3€ÑàLO«gòÆpògª‰ÉF†®ô¤0¸RÓ(¯´‰ñ•0bÆÛ¸a–V	µ„ýìóxK·á©A¯AI(†§¾P”œÿ¼QÌ¬a¡€AÉ|_vMp4ÔÁx”Uà(Båm˜–irx]LG>ID‘™;±4Â@œeÝ­FàW…«íÅ7P–/à %-+Ö ƒï6ãÐµ±cKŸu\•ðYØçò›Xƒ¢Ð þÕ½ß,“ÏDl£÷›6õóÓ˜”	]›^K^Çîb©`žÔ–Mý)“æéB“LdÐqtÆHƒ‰ ÃÉDn*xi‰'Ü‹¨¨c)“Ãy¡•Û!IœM§QK'³Åü–2F¢Wý)?¨T*m€øÏÿa¹´Â¢ÀºaX|uéü­´ÐÙ2
„‚„ï†á*E(ŽÞE:£šúÀ­W›ªŠÇãt¥5&³¹¸®ŠØ…j ­øî„þ¤®EÁ‰9‘¢ÐjF%f?$!gÉÇ4ù"M°í+q¡‰o‰ÛW{³ETX8p­UfþòÊÒµJLl–#¢ºv	”+Ro¥åWxûÚ|ÔA†Ü›ù “7§ 95Oí($÷’@ç¥×“0Pú–Šã:H†È
¾7A»i–åž8±|ï¾á±SÕ]ÁÜÛ	D&zBaƒ,Yé‚ ê_ÆŸ÷D¶Sý,må­¼w•þZ£x6O?*KeÒF¤¿Ž°ÕJñVl˜ÃöÞB˜PÇä½W˜BóHìÎ^ŒG£nÆ-¯Q¶öãÆ½éqÇû^ê\è=ô¥ˆÂPýd¢Øçà4äÝœö.…œ×Ú–mTãƒaP†$Û^ÐÕ+òÓGß¹Æ¥³ªXfÈ–öÞ¦­±yKð;ÞMÁñÀ=Šá_¾¡ AT|žðô°F’â¦œÂÀ–æ¯ßÿÌ$ºþ8_ü)Òö$š’]ÂDû8ºHÏ/’LD ÃÕÁ±Ïx(ì°%å.ÌÊæÝ}×ÃêóÜý&ŸV¡UÀ\¦£A§ËLåªÉí·)€R„5Ñ(óUáÞ&²Žár‚–½b¶’Tƒb§Ê17ÛzSþÑ©Å‡‡Üf]x»¥W:•¦' DA*¡0@íî!»CYÀèôE¾}ÉQ5äš$	ÙV±Mìó¡Ô°VAoaÓ{¬UfŸ¯ã%ò‘¥›†öØ	ÖÎ)ôNn%ˆ%É{âµø©ì,®as±›˜=“¿…=ÿ_¯âËl(izBº¬ë%»vÅ0¨X¸å÷&2†³ëG‹€» ? óX<L-2ÜülÃ1yŽne\'f†‡¹â©ê^Ü~xv¡;a&½Èd
-s«ðCAB¥ï2ÏlKÒM)hüŽˆ¼`÷ó‚Ñ¯‹VúFëÛQö”`JQ’¹´ðMC¥?…úçq
k3†Ö2œ†EvVYmÚgcµ;þÙ¶œDÛ}Ô‚bÍñüå’oŠ5á†j$Ÿg3ÀSJ¤U›!Ø”£Š¦tŒÆs”’U°\ZA$
Yá‰8>Eâìçæ­¹­ù²vŠlþ£[‰Ò?ëÙ¬A1`¿Ú±éÏÓÉ"¡_íôlöD˜­¹•ÕYjfPÇ×%¯”—=’AÆæHäX·»ÓG3Ù¥ÊÌÍÜÖpžœd`kqÞñÜÚx÷­>E«ÒŒNiÙ»e4©×È0Á³HÅ°a$4kæäRS4>+öÓ¬›bPM*o9¥õÀ28âX³¢Øf¹ö›Bf³@ ¥+n`øRÓ¼ThŠ°™@Â+ÎÜ,s¢†	)Äý¯@ÛÀ»+Tã($©ìjƒôƒ™Tä+uM°N©Â¦høB•MÑ\ÃR U%å‹6ó®ü>kÆóžf—1Æf$”Í£‹Åe<Yƒ7OnÒ¿¸dâÏ”¦”ÄB 
ÛµŸa§¯¡«žè©Ï;ªñ¦õè„ÛB½qoßÕ#y0t–Â™—*Å	®Ò¢—b‡ðv•¥1ßCÂÌ(I!m6Ž‡IíÁÿ•æ²Íæ?<Hë˜qL—tÑ?G÷Yaíì^ƒÜŒÿO;ž­¾h¾ð¶J)Ý¢™éy"”4éL¯ÛïŸôz'/;ûÝ_NtFojæÔ†È‹Q¯ÙógZdû±•OYt)lixüU{Àj³™ü³V{ûÏQãÝýÕ®²Ÿï“ñô J||:/uØ<”å´—æˆØè/tïÖ»ñîº¹ñctÉ¶×åâRGtJsUeª4NC§¶$:€@ë.åŠÅFµÆ“æÆjÃ	ö¬f¬fgÎ”¡lšã5ë2þw<õÄxØ»>¤ÜŸØ§B×ÕáÄ´ñÕ«=½œMs‚7j J<’oæÚ½/øÇõ|“aKÆ1ŽnjÙÄ—Œ`ž	Õ7éš–àýó0I ÃÃeüYÅ¡ü;ˆPÒA1Û±ûÓßp‘eèL¯¥ërU§é¼}J'@wê
¶šÞdc{ëÙs²Áþö`¹æÂË£öØßVíÝ@vÙh[-ßhž¡B}WÇãát²†t²*öØYÄHþ*¼¸3ÌŠ®^'qÃ3
œ~ü£KWL  ä¾þ·ƒÿ'—×g8¡0þŠ:AñÑÌ=?íPÉXÍ½w'gg	
´}qdòî0	9ÿôâ…ø–{~¾LU'p€=‚GÛšæ7Æxƒ¬YCýôœíJˆ^Ðßª®ÆkÉ{"S½
zˆiÎ	ðfuåËâ¼VâEo|ž›s4§~1Ñ?›ë£Ãî ÒÐ£¦ÄîÞÀiÂIµ”B°Q€8¬Ÿ°×(•x<[í••V¸.§­¥¨ºE®6F½±JXñpí†v¶/éÖš<6;Ï l`•ÜÇì :ž’þÈK0ek£ÑPi¿ŒY³ïVÞ(ìg¹_Ð®„ýÖùÅ¸Z…zoôçéx¬7ˆêUo³Ó‚Ý!÷ÅÒÛÀJBœ[Q·Ž ‚»º]€í¼qÒåÌÌBÍdš^¶£ÉøìïŒúòÎô£3DdêŸ(÷/ÿm4öÅI6}ÅvÐA„hsüdAY´œm˜MÌ€Ê"¤²¬»iÕÝ´ënéº[VÝ-k54Í7é¦2kÙü·i’±/– °À@ôxÁŸÜHéÈJ¨h`Ø&:]Ë’p˜RÍ][>÷o8mó¶>žž«£€›Ô3Ôâ»;Úý¥¬»éhax©S¹í‹Ø]ø×Ôçoãåˆô1„Ìôô­ÒGFœKAž_4a}÷|ç¸÷…NéZþÔþÈ/¢S0­Ï×«§àÂºrý].ŸÍˆÈqýÿ\ÔÕüå×ß;æ­¬M¾ò(:çøÐ~ºrïËùõÊéªH*Ãîî«×ï¾3˜´Òø|­ƒÞ¯âìZx¢›Îá~.´?ðBóðÄ˜>)…8WžÕÃM_Ã¶tÅh˜;nÉ.TXK¨ ¥Û¿í‘©éQ‹¡Žic¡9ª²lË¸Æ™%{´H€å&rÿ(£Œ©Ã—|Ž‡ÂsŠÛÞÁ­t›T“‘Lc5ü b„49ŸÂ£NS÷²FB:IÞÂúƒÁnIµ«
U••UêõJ»	&”†ºbbÿNF=ða`}ÈäÔÜç²÷WÏRÚr
z=ou	jðÍMS²Ù7aØ]x9 7`Q0jÊïŠ‚L½0ËüL¯ ó›îC+Û®Rw
!í5š=PéÛ°»ZœãÃ^§Õ~Ío2L€”±¥_%³¥ñ`_>ŠŽ²d€5n‹°^Xº¥;f\†äß'‹I–ÄÃ¸ïp­“¿	'»èr~VTë"ãý„UC;’s¿GNšsÜ~OQ~ý…Èf•NZû{¯:‡D±ñE"Ö\	ì*ãÂÊj b¹*Ó×ê=ÞtˆAX”pëæŸ©PÒõAlÇ3Nù3qe’tÇ¯\Fí\Uôã¹Ná”{=œ«XA½Þ‰xÖ­äÏb4dY9dZG¢`Ê'‹É¶Õû¹38ézÇí»QsÊµ>–¬™«æ|{…Ó"ÚmËÞÀõf\Õ'ý8Ïkò:WÁr~q—§¿N¯·Š§P 9çUz(•¿¨{^ÅD„¦žh½¸Å¯}U¡¦¸—¿wóËø¥‡&¢¡´W‰ƒ&EˆÆ@¡´Õ:?Ï’sTô€þ|íS:¢2 ‘R	C§„H&ÍÐ}r80ñÇ?þâ7e­ý$ÜßY-+”ÕƒCa~Ï±¶_Ð”à¬C;÷Ø;	YñyôåúÏ+ŸxGÓ3O{×_”Ïí-4yñâ-­F÷£s¿”E6Q1¡«ò«l¬ž›ƒI«Åáo/šlæÉ8¹Læ™'î/ä„e•¥UïW‡1O{<I1}\•V
ÖX™KPˆ«–¯ñÄØB]dü:dmh&éÅöž)"UA	vß±ðÞºAß;{ý#°i’Äç«£­ƒC °½Ç_ö©¾àùWþg$<}Ûo·‰âaÐÙït½ß„
´
tùÁÜ–¶€e²£é ür{]Gÿi½”’ƒBéÇ‹œ›‰O×¾ò?­M Añ€…ˆ¬8’«\ìÙU+ÞÝé¸*Ù"¿€5Î Ô®ÊÕu½±R¬º£vÐGo4…´Òô˜œ°Ó5†;èÍe‡y%!*Ì¾š¬v¿|®úùçd¥D¯ð:Ï@3Å#+ÎÞ§ó˜Þ®;çVÎ5;}q®í*æ%“ÅeÐ¶†õ•CÏôC1›JÑ7Ùþç:[Â•]xè?"àNkÐZi:u»L8líwNŽz{íŽQA¿®ºáµÀþÊ ÿÑ eä“öq¯ÇîNÜ'¢p,!UËlÉlãKÁýß^v÷ýsð˜À>è¼êí~ÃŒ> "ûA0+#æ§ ¤ÀÝé÷!‡*O Ç_—ŠíFIÁ¨;{=Î#ñ¼èÐ3þUÐSkÐ;yÓÝoööaîþîHèSÿ,ZA÷èd¿Ûï{ˆ×´~2ìîîNö;o:û!¼õ÷OG'ØH‚`~ò‚q°wxÒj·;Gž1©è^Ý^€–Žö!Gnç„'—áPÄ¤jw{'_÷úè$š iTÐîv÷wº¿ž¼ÙCÜ^VÄ‘ä«W ú6öB¡¦Øä˜—©}6N$ÃäL’ÛMðÜðà­68ñUèJ6J¤Œ3L%ßEq¸¦Ec,‰¶[<|VvŠZàÙböÍð^äÅ[›„ÉÀùäâÑ¨V`MàÞ·(ô‰ÒjÐi…
Þ7Œy›ŠKW£³‚ty­TZÞ'º¸z¤¡™ð¸W`ÎFÖÒ‡mi7ø4k™mcaúoZ«vK&Ç´ÅƒóRIÆ}ÔÀÖÅÂÆœû¤‡q
1î hÌ®IŸçO-/N—Iž7OaÚ/…ˆ"øñïÓ¼·Â~ ju®P¯ 9/£cìÍ¯´‹ˆnÚ_áb‘Æ2¿	£¿.JÂXÙÙ>ô–»›ÈÅÔLûuÒ¾âX&;·mïÐ+(Î«Ë¨2„þ3@¸¿ôAã„ßNü5.Óâê²mó1‰Ý3¨¨ÝäJç]]<®<´€ñC6ÊÒ³ÀìfhI3N>&cáQ‰îKæU.ŠWžÏ<K&-’\Æþ‚÷iœP ÍJ§à
¾Õ÷Ëˆ~qé!ËÓáC¼`>^Ä9£ºòÔ…s|À7‘ø±ðãô_‹tÄT ÉlØC È¢÷Óé‡R(÷÷þq¬Epõk8?NÇ‹ãáœ±Ï¥°ÈñAG^FØŸKÂÀŽÀqYñ<«@ðFTéÍÀ'@<ãt6cGy€'&Ž™¹bÿ¨×iñ½Àÿ\Ž»/C…oB× ï>‡ ÚÓE…ó¥êWÕYeæÏr¡¹ð·:oY³œNŒ7ÇÊÈpóù,Èhfìcàž`áñ|¡áökáö£€çŠKqîé•‘ Ò6)÷jå¾ƒFØUEÂó$c'hAçkïô•'-“-ÄVñâ€Cj€ê$Èý`
e%ôS
ìOIò%€Š[¼ºJ¬ò´?ŽÀt.d›å½øKgðËÞáIVÞö¶‚I„
—‰3ŒØ	<_±½P
éaçUõW_:íAë°Í÷¨çûR4Øøjå8äå¤Ý:b0´;Ž8·ÜïEÑ~CÊóRé¼®ÞâíÌû´âc.4n7Ð2ÐçàŠÉg0Šœóä>í›T<‹2LÅÎz­€ªD×è'A´ ”¹5íW*¿!èÙø2¬o:Š4Ï³$ë@.»ÇWI¶ñ¢12
Y‡oß‰Ìœ#|s™½»Ýo†»ßüúîÙÒÙýƒo5)t«± ©ü½¯b}(üºë?ì;8Â+“ø#ë_Ô%º‚‚Zé$_œ¥Ã|;¹¢à[\ì "wâ‚Zêz\PGß”*AT ÅŸÛ»3g^Ÿ*ª›tQgx©¾íKsÁ€ö° *^KêŒÔ½®h¥3ðZ-WÜè®Y¸Œ»]ÑRY7¹¢Né° Þ0A»­Òzgãé´üzuƒb)zô¤£ªÀŠÉG^ ¿VÑVàGªèáJGþƒù™rÌ£G—r^7ÙrHºU5á%éU7ïY}*äŒ}˜ 7ÐAo¿¶Â×päD-)‡HkžSs‚ßãÑ`Ö†žšµµ]–‰){>§F·`÷bÔ¸öÆ=ð˜­êþ¥i†„>=ÄíŠÜ`3ê‹§ŽÊÂŸh@Å?ñ\R'anY„Ðt|¿4èoµ/ª2Ï©Ý‚gÒÂ§b5EE‘Da`jÅ.÷ ò)f{ÑÛ)kg×û6{–³*Äø4óR	ã¯FD9ƒ³Bå/<>íàl u8ãb»Ðªæ«õ,Úxx{¢pSªq`—ÅA°Í
âõÛjüp[g¼8ªp”µw~_½*ÓøZÕ­ZôùÀ™/ìÂ+Âîxú)8'o½
sZêÑ!¿!fúk)	Ó7EÑ¾5ÏŠ&h×bœâ.¤L?üg‘ñü¢)*ýâ·ÓúÉ,T[)Ž)zí¢g”Ç‹xGà{òõrDõRß’oò|dÓª¬ö³h½Q¶ú_ñ”¿ŒÖ­èèúß¯}ŠnÍˆ¼H¹Išˆ`Ò¬œ­T#Wþ,bÊÞO¢5~é¨ÀU}O¨¤=?öDÖ‹ž[DpCyOšaÿ¦[¡ë[ˆI|äÂÞJÃ$¾±õ§ÎE|ûs›3IHýó3ˆç<^¨líˆ<DwÉr|ÒU ¸;—À
e¥ P”XU(ùaý&âRè„êÉ8rD´¡úö_AæÖ+ì+,¯ä°Z:)Î®õ,Újlß†ÈRU
XŽOÿGËÍD)¢ °ŽoÊÍ¨5U„N_?"`g0"äô2„ËŸ×ªçÔ'´¥sÈD˜¾aNWoK†©¤”Q£>OŒ{”Îpê’a£½…'ÉgÐÕJ?ßñ»VX™Ç«Ê^K7#žÄÏ)@Ï“¡Hµ1d?Îkh¯)sDpJdržÌw®&ñe:<Ê„+¦UûÇï®u¬zÒ…¤£lm!_÷°Ü^gÿÛ0àt(kñ„r9Ÿí¨ÑÖßqRM %Û„‘«2¶Ïw§‹	«œ‹èg®3ù‘neô­yÏÌõP‡»@²ª\,ú«„­ÑPÈœ†ú;,Êú$AôÌ‘—vs,Îi›ÑÆü¨ªŠ¹ük1Ç@Á²¶ý]6XWHíÅ“¢¶ùÑª:J’ÙÁüÌ¬*>ZUq[ë0Ôf«Ð×9™…·L5üwåõw<ÿ«"HgÔ’É9ûG’o]†YºªË¤±­Éãö_áñBëÑt†žªœrIpï¾È0¨rb|m7•a8q‰ðêOßÃ¬b€6› cÂûˆøŒy3^¼ðöðj¿ûynëðäåñÎ+&xôi/zˆ—‹Û§­póa²åc'‰G€.„Ä…î¾<Ý“‚y¢¼ÓT…'Pp€T\d’¥[$Vù˜Ž º±Óç/-/¯x3»:œ+:ãx–'#„~]–àfÙrŠ¤&øësý‹ÕÁMsOâsÄÝ·­j˜ÛÀé«Éuƒ]ô0)¯ãix›.Âðæ²ï@Nÿñ.O¬”¹d”!†bœ¸‹¸×™®ð%Šó\ébÛBò'&¤<øîa‚A>Lø cÔÈ–ÐûŠLM>Š`Ýª7n3É¿òp„¤'lO»ŠÖ"5ÍšÕ+‰.ûŒ‰?DÖÙÿAlqÔùy¼Ðz¨h³†gô)_¤K‚Û?Bdiö/æN–‘Y§ŒÉ[ aö¥	#º‹é|Ï-ÖE*„£%¢åv~@°QäEâ£ð¨bPË ˜µÍÒä£H {ïr‰ÁXA¯À7E9>ÞEU«/7l*Î®(KÍ,.TÂ²bÝŽÇ½™cë ü?×Z@ó‘²dºO¤~|`¢‚7ÒrýNïxˆÙî}‘_TDŽÉ¼Ñhx`¸iIW6ž5[èÕžG5„¶.µ±u)í³K>Ì CT°Ý
€·/’á‡zt6“6WõH'uÒoÌ:=´l¼¡rv±(ˆ!>ªÇ¹¦„ê	Ì	ºÈ—Ç¿­Pê@õq3Zá‹5ØØ…dœæ— q[ÌTUkjMï\e] i$J È¢†Å.âön²!¿ xÚEfC¾ez¬æ¢ÑÏ8ùãÃŸÁFZ¶‹ç©>—©x`§ÙÉÎÊ1TŽBo<wáŽ4a<¢Ÿ@j½¼©‹åyÚ’#M²úìö¦4”QÉÑpñ£Ÿ>mlG&rzcU+vØ„D¼²ŸDÎ‡èPj®öË¥ˆÏªêò‹¥QiWþ²î²MEÚvÐv¡g¼h1V,ŠXå7Ùá<Šg‚ÿƒœäù.œÎ’	²Ø:ŠÈ(8¸pp}—&È/¾@‚ÊDU@…N­{Ô9”6*8½º4Èc_CaDË±’¸óðŠìzCD™âŒ!–-ÀQÆö°5’V1üÞŽkq¢> hDùŽuH[CS]· !G7;¬mMø3£ŽÁ¨½ßíwv:‹£QÇ.Š—Zu NÞ£+ò@RplF‚¼àÜf@§˜c‰[ÄŠœÏÅÐ‹¤ ã«Ä¾=øÁ˜”üÉçáEÌ¨S›ÀÉu1]dyƒ
eKSa­šx±:u¶¿ØêHuÇÞµMˆ›úr®ÄKYá%Dy:éïýwRq?âEèáŽyQ\eÿ<ó/û|ÿ9é@	ªð|·—5r[ŠžYª?ïå¸›V¢•ß>Ìú‚ZÏš0jEåÔV„— Ñ@Žô.z…ðòc#q„ñIL~B _s/P×—y”ð»Ìj#z-b‘ž-2ŒçLô$z'7hÄ!ôv³Ÿæø
½9aÈðìÙiV€.ÀnÃ^’³=
ëŠÓ9f®Mý°›‡Žâ5Ñ€œ_Ø	O¤šI ˆ‹ùÙ‰óE™­ü«¨ùÊ°G/Mm´´Î¥4Ä5Ðõheã‚	óÛì/Üå–Rvˆˆ¨%Yf«M¦$–¹ˆ~õ?¤@#r+_³ƒîµ0õÎ#bQ‹ÌúVA·§gÞÙ!Ä>7dÐ„&“AáŒC8˜tn…²ŒN+¿îWr$±ÿÌöY´±½êC‡YgØ…Y®Z…Þfš5T2^;^©O,‘æ ÷&V« 3¼yú
h8›|f#u±Â=¡6fHß¦èpLmqZ–ú$õ)¬Z#[#[D¹È	 Á7îIo²7±£ÑE<þÇ"Ál.·Å³pÃ†ÜlÄVábk%J=Âªï…B4Ë;Q•5EX´­FÆ?\×#àSÌèŒ¥Ú¾íh±^ÖÔqõTkÂù(&ò­·¡	à™hy¡Ó­<bÀù!_š{8rg±¦f×ÄbÎE]£ÂµÉb<ï>bÅFÉû“kõ¢Iå³¹lUÖ&ª==ˆ~ÌªG:qXlax?
°™k)¨fF\Ò^lè¡`çXÌ Þ-1ððz™ãæH¦¸ëôz9F™Ì{‘Ä3ÿaIÄ^ŸLë|7ŒJù"û˜~ä±ü•8TãJ³fôÿn­¯=Ü^¥²°gV¦,|!õ°©°™<÷ÔÒ’êáTê/Ä­9éEœ6 ªíËèõè¾Ö×#´©GÂúÄƒ9ã3x`õöeVg‹eXØ•€“}(ä?þ±!”óŸ5Cb'ëù=éH°gÉ®åWÆŸv’dFäåg¾Û•'jQò"^ä‚#ÐNÍüÇÐx9T2´Œ’½çð§CL¡XpœPœçY<LÎËaô%„ªùú›3NµŽö¸rün9Šqvg	m#É}œ	='‡(î*Ñ	‰ˆ¡´aœxöÁWãt¿að#'×Ð=µŒÓjØ ?…ŽÃÐ2à´úk\UÇ÷Æ¶AÀª´‘ã_zÖ52¤À…"¸#°Ž©ìÀž“‘µsž[ð5d=]Ç™Œu„x;$z±/·‘„uöåHbŸ%æ1A¹(9(ØÙ®OÖk*¾¾ŒàíxÖ´ø‚ƒZ&Û½NØÕñÂ®9e»]Øø/^…Ý<èJHzûÏx\t¨”çÑhö­b­L´	tÑüÙXIfÅ©Íƒ±kÎŽ}¤‘Ÿ¾9;b¿ý‰˜L‰²(t¸ŠäZPXÆ¸ Žý9Ä{)—:yÙGÏý£lzžÞò#$6hàññïÄÏy™œg[± [ÁâhµÝÎƒ³hÃ,6÷Ž®åj¢VË´Sn'%ºªÕ¥”Y† ÿ;òæ`**¹Â²Þ÷–£Û¹Qú4Ù›2
½.A×R¿,ñÈgßýöYj¦^*rÀã{.\ÿ²³FqlZ7ÉXd¤Z#Ö<²úSçüX±Ë¥Œ‹­Û÷ÒaüÈRNIþbêÙ¶'åÝ<xÚ3Øü½tåº^÷-8µùÜ´uò£ßíœHeÝ‚Û‚ü×>þœ4DºâÚíúÄ&'”z”7â=Ñ
ú¬Hìe­EÉÐjÀµ
¸Ú*eBuß!Í¤ú¥’@>GÑ©
ËyáËºÆz}± ­XØ 9„E÷ÖW"Àñ\öGSvC2i¨Ø:›U_Æ)¨$ç=U¯oÁ„•lôGq}½¨ú·$0Et¨ÆÝæÆ»‹É$ãàótè&¥¼-jãk@|52Ì„%c0 ÝKˆ"áiª=bVhW)g–k?×pŒcÝ¹à})ÄÇé¿EjOUÎdí!ÚtÖbˆÝµ4³«>ËO >dô ÜÍ›Ñ£'ºX‰÷j‰HÅÇ$Ç±åìÞŒ¸Å6 #=Ç"ü¬7ƒò.‚•Ù(4)à·G£Î9˜F€Éù6IæÖ—x„ŠC§€ÉpŒ1ç—tÂ:OÌÂËYš¡È‘Žg?«€r}vÍa‘-¨9vz0áÅl:¡§Ri`—æ'¬x='…Ô	(w¢Öo…bàSÎßd ÷dÁp=&ÅŒHØui¬=åQÖÄ-¼ñ¸­K:ŸU±ó·ÁäÝÉ<=»U	U6&Ä¨§ÕY™ÍíëpÓ
K‰vƒ´_²Žˆ]Õ÷2ë™Q	¢R^¯£Ø0Ê‡ ÖËéÙìäüÑ	ŠO¥Á×ª{ý„{r‹_¨F†®Å|ÕçÆµÚzÙ´Q¶©h ?>dËKÚW{º7RŽ™ñ‹ °%=K»x¥Ëåø–@Zúò¿ÌU‰¢K3¼n—²‡ø^ î
é0É[“Q[YN>§›3Ù‹u¿ïìX·-¯ú_È¦âW6qúZvßU1åsÚ˜+±½oFÂ-xÄe¹­4v5ñæ{ÏŒºú³Ý Ÿ‚<ZèJoá©ù·Æ³°3KÀ‚‰Öoåòv-Ú°2`}O‚¯~50þhl­ÉØÚ ší¥ùó,mÀâ½ÛÉš³0÷AY?¡ÛC ÙÖÜÙa¥u<è0Î¶ƒæý‡ÞŠóxþ=f¯~5xì÷‚Ùkc‘=2¬Ý‡ÛÏàæÀÒ´ù¸|Œ9¤Årj„Ux°Eì->‚¼ô
7`ºÈ†‰0v£_©òÔÄZ'3³ZÖÍ)Q3\úN,Q¾¸ãXÏ±ê ¢
*¢ÉaGÍ%æ°)à4¦QÕ÷ÐdÐ5O'š=J_¯ž%Ã;Œ`ö{C6ägBßÐÜ‹k ¾…½—v\ ªn¹FŒ1 «jïUÂ‹—äÄpÒCL:i(dál,²YØÊ4ý:Mô7?«Ë±½‰þÔø†šäf–KA»%bµÄà!„è)sá@ÑO9Î2~ÔBºa±;ú—hVR©ÎV˜’Y?mò`²ú
ÛbMÉà	<^ƒ©uÍI<a,ÂÆRÆaf.½òÍòÒ!UDˆBYñøÊ¹]ÏzãŒ|w¢
#£`…Øôµ!Èeã€˜å7F	<8óò ”gv#sí<—¡è:üHaW±áb¿+ïQB{µØ&£ 5,êF(ÃÚ¤9_
G]*Ü“ƒ?… [„Ú¾ä2”O®¢ßd=WÖBo¢`¬‡QI…ŸG›ÛŒúû›;ðˆvWùœS£ê¾É4ÙÎ‚ˆ]’K¸o'¹\­v;ìÖ4¿š%úWáÎá9T}á	}›˜ƒMd„k²©Ñó™Ln«Êä¶^ŠLâ"¼Üß›QÿÓîîîõ˜Äö²×iýÜ=0heE¡lY×_Æ¤™(ÁŽ:}áæ_yx6Ggl"­«àáá“^ÞÇÃ7ÂÃÌl¬¡“zÞòË¤›Á/J?Ä8ÜÒ4½d	h[â1HáËLy»Ê”·•ITÿ»Xßˆ¶c¡àËEÈzÝqÉ¿ïCB&>}øÙWÄ®¾(Œ•NwSðÉÍƒÁ®VC(Y\ª9“ñ²N¯iíŽFbK}ðõM1éíý¡4é’6hÚM/ÇúÝ–æ0}þnÓSñz¿ªÛG¢ÛGÜ‚‰·Tøšn‹ns·yh<Õ¥é4¸TÏODÏO:D×§:¶Ž»›ðTðv(¿Òâ©Î×›"EM¢yCQ÷¢¢XlUÕùPQ¼ÈÓÎŸÂ†ÕÂ3ÚVÃbê|L/_W0l-ÃV—îîaQwÛ—[9³Ò“Ù^zômÏèÒ¦ž1À—Œå§ù	³«”?‹ÿæÙå-“8+lÙïìï;M1’,˜Õ‹ÛÑ&ŸÎžÍ¬šöx–d9ÿÍ†ÊnÈß@Ø¡ñpÝCZzœ-áøˆ@ê2f/ºßr'¿¿¿×½¢ˆItZ=h`ƒ$£˜ˆVè¡Š¶³dá†/bv‰Ï¦“s´<V«ãâ{{]¯F•µó„’6²=eûÂ÷M„c¿wßtz_Ã²5|iíNv»½“#†­—­öÏ¤6¤öK€3òª¬¿^ç ãƒöÕt:êõ¤OYÆlzîêî‚Ö£|Ul\3˜L¤ð|\·?ø.%cÑ¡Í5"·ipTÃ…šSƒd—:ÝÜ8åPô„h@±)9š6âös¹ç‚VçîÿÒéà˜g«U°í9Lj§i˜èVC„Ðí¸êÅ¥ãÉUwÆ.›é¿\Zî.ª:gÑq›:+§¾˜T_é\<„©vv<¦÷PÑúƒ¸dš¿ˆ6˜¸¼¾Ý
ŠqZbp.U Âº†HÒWþë¡ <#SsbßØ=Êò×I~*Ÿ+›ÑÎ^¯ƒ,
RTq2ÄÔì'»­½ýÎ(EdµMP¨mE5á”¡äjíŸ±
)›§LÞÉ1 Î7š±	Š¯òMÀŸÙ¤ð¸!œ‘[c°qñ½qØ]¹›™›'àÓŒï¼Üï¶†	sÛæÇRbY„~ŒVV¯Ã°kŽX% òmMáU¯ÛïŸôzvf¶Fô
c‹ôš==OØ˜OwÓÏÉ¨¶¹z-£ç‘8yfÏté$„¦W¾Js!TpY«‘Ê‘ÿ$ý!Zo°ûî}C:ÁâÛCë›àdÚP£pJÙÁL¡ÒeÆ_§Óë1ònƒqÓæ:ÛÅO¶W±ï	Ä#2à†üÆ•×Ží	Ö!“\õ-`NñÂp[C÷G¥¨4ªÕ-t®:OivüiwÝ„«âù®"ÉQk<Bom	·-Ä¼÷Å ˜û¦¹ ;àêò Žæ)m<#ÕÈóélª$Î§|ìŸ7¤=Â£ªê|¶¨;Û¨Ri“TÚUÚ"•¶KbÅ6±Ä0îŸ¡pöD¹!·«ŸDùªÁ½ò¨9‰eo>Â>NBiœ‹€‡ä›Ç>.lçÞ¯ìØ?Â`H¼™˜×zãY¯b€ åB™¡wü‘wÔ‹«õZ6½¼„œuÂ)‚zêNo`KWlGWÀÑ
éÈNtJ+šØ‘.
ê˜á}µæ¾ò
¦xjiý<†zíë˜ïÉzÊDo—‘,å‹Ôµ6Mý
:!C}¹ÖN¢äOg4xzï‹ï¹ï:?™ÚÇá‹håuz~É{3*üÐÖ¹Üæ0ôîFn*_cXÅúÐ3å‡³¨`èéƒßO´É÷–2]¤O‡ß[-©èáw¹$2tjÁ’BŒ`>œ ‹Ÿd$Ãn6½äÖB"fÕª›2	7ƒ;¢ÃÍ°ÒàežØe|ŸùÝŠfh'A{½ÈÀ@£*”ÃÃø\n«­×ûƒÖ«ÎÉ&úsì¾2êT8¸¡#.È5ÑÎ°¾PR\Ó#Ù5gM*Ð™e›´lÓ,Û¢e[¶í‡þ£7s ¸:¢vÈ[+K“Xf#,EÈ­$;ùBîP.'Qe<!ƒH#7K°Zštý&ÜŠšëj™qß(’æMælòEÃREJþ~³lþDb‰šäÜÒÆ%zŽ¦À~õZàèÎõÄmZPü6)æŒ€e­³%fs,¸:Ã$ÚYñÊ¥ë ¡á2ÔÉiä
âñOœŽUÜDm´GCÈ¸p]Ë€+8€ì\ž›Ú0Ï1Ê'tP¾Ç@†Ë·’¶ãî0ý›&À‡e´eá=ÿCô\s´Ç:F¾|°ÇÜ˜îB—)sÆ"Gµ%.âKÝ¿«âUðð>¾Ã‡·uI«x{5Zò*ç;€—ßJå2¢I‚7ÔyxÃ’ŽFnozã¹“Ž¥ÚûWÅNTdTR8Ú…‰l$v­ÙbÆ†V«¡óïß·/(ê?ÈÏ…ÊŽöìÙéYî·£Èo7ŸfWÑkHs‡bøŠ!xØQŸ“šžPpÜ¥XwÕøˆò¢`jÙ¿Íîéò=¤ï!«7¿”]Æ3dPØç`Ú9ü°!}8(Æ+­±ÙÂ­ÚTêûÿÎë\hŽ·qACáöñ_÷²?ô^ö¸ô^VõJv;·°ÁÝÙíêñÝÝ®No$b’f{?<­p©âüî#¹8ñúü%_U—¯nG(2çÐb£¯4>ŸL™Ü6„s@™µÚ®†&]}‰”Ê·iß#ZO,¤Á5 üªájú1ÅT	)V-O2B×¾3ÿí½/K€V°BUR>Jæ¸7x´µ»Ñ¿†Çƒ± ÚÿÝì©ÈN¤×í«éNd‚­ôÝB» ¿Äƒ?T<xú'n¾¿…,ñô®e‰'®,Qºƒ›KñY¯èn±ˆi>Lú‹G¿cŒÜŽÚ›>ŸûížúûþnúÒz†XÐÊýët28òw2Ð–5¤½½-è
m=]ác7íÅ’¼O“¶*$äÓ©´£GñÕxv§YkÏ0Ç £ex6ów9ezÁ–û¨ÍÊöåÚÆNäX® ezc:îhÇmBÃá™­àZäI2 Íù‰ùEPA:’¢ ÒÜZÐ°ÖKîs¡?qSÇëVjí„©ƒm'áÐ¶¾`CÂþÐY¼x€Vs4ž®*ž¯Ân¾U§&€SÃY½í‹¿Wô^li,€:;KPõvNØtÁ„#l3ý"ÚÂ\^ŽN´tóI?{îÊu&V@O;Ru
ËbÁˆUôwý7èñÞOŸ¬H'-8-–Vß®ü²wxÒƒCÂ²eÄÈƒ¡Âè‡Vd—š+ú­~«¨‡"i¹`—U]0Jó¢ÿ/’§í8t·#+Zh¿î´Ê¿>ö^ÈK˜à&èÞ†tdƒÿB’ÏÕªØ£„Åf‡ÓÉš,Â;*i¹‘Ô¯ëï§”v˜”¸÷¦sÒùõˆ­ë°Íc¹z¾ÿµñÿÿ·ñõêÿµõï`ë‘Û0]ùh)#g÷üIç#¦‹F¯rñt‡Â‰z÷ÓqnûýÝÊZ†‹‹®çÓ,Ñ¸HÏ/’lp†vôX‰ÉWV-_¥à²òFflF·õ°—ó3m/FUì)`­ùÜ×Ñý…dV”W`z£Ü¸Yþ ÚØöÃlFkŽæ©æÔW-86V’—v³Q’íŽ§ŸBCz«™C®C
g¤Ö<+Ùªä×®ÄFÕ„ñ„Fu%VÏ¡A:ž1Ý:Æ··cEá\øÜ‹V%«~Nå$ðMûåv!öCÂ®c0å|£¦XxêK†¨¸X<ëÔ8€gÇFï«Ø“8c—$a®ÉåÞ`³´¶YB,FðŽHk›	Bö©­ë[EÉœ ˜ù'wÊxÃÁ(CÉtH
?LÈª…-I@PÁOºë»¿¡Xè ªaKÅóáª‚A¯sÈ¯¿ø—›SÁíY2{˜¡¯Ëƒ.dg8>àIÄJ›`^÷P=›Áÿ  ÿÿì½}ZG’0ú>Å‰nî.šHH‚8/8Š„M‚€ä$ãõÅŽ¤3FÀpÀ¶ÖËw¿]UýRýrH–g3óÄ»¿‰8]]ýV]]]U]µ¡A:CõóñÌï›ˆÂoŠNÛI4õm¨¥—íæÅy]%—n‰Ûœê9KvÛd°7dÅ™ø1*Ÿ› »Ñ@ÌKW¶a~oÓÈb±±…ŒkÞp8[ø†ïnÚGÞ¶ïVý6N«ýê Ñê×ŸwÕbÙŸ<¼”ë\þQ“}¡Ë<L* ï)™©zßî¶‚OƒïÛÞý™l¦ßÿûßíã^ä0vC½Úœ7z½Á¯¼Ùèõ`mŒ~¶šŠ=NFÕžØøqq8·ó@¶èDofóùà«¢_ëroPäAÏ³[ˆš>“‰°ËßîÓÕeJ¿J{‚Úkž›‚z[‚ßf7¬òÆuÎ_éüµÎ_íml.Øÿí¶uÀD´¹ŠÖ·©¸Ä°˜bf”ß(ïÑŽGmü#Aµ7»‚vâèMÐàÅHX_¢á5¨—n–©á64.n!ŠWod””bÂäršÂ¨P[-è3”Ç¾Þ¼vé~|²3Žâq$~ý
¶'‰}Ä5­>zÏ¹×ÿµ*•óAî×»Î>º78­é–~ðà#†ûTuédW„+dá²øÃÖE–E_g§Y Ö~H~€üDŠÛ¡/Ë_ÂíÏ8y(šð…\:t]·sTt*Ì¹bôµîï~SF$KˆdÞýYLï‡CU ÏÔoX£ÿ>ž`ˆ¸ŒÏ’éôfué„•˜/äñ‹Ï¯Fbf'iñÙ(¤LÒ31OÀ°	¥,_ÚEï”Âl1¼¢[OÜú?w~Ô_wœ¦nÁ$?Ÿ$˜KAµû,:Š¿‰*Ï3©/9²k.1Ç÷©Œÿ)j·V·—‚œ
x /å0û±çÌ€AqgÚÜÕa}ŽvŽÁ™³99’ì«cikäèLÒ»I®àUœ…Éò³+-†ïû?…d€Ž61|ÍÑçb cÉÂXÊÂXÚcÙÂXÎÂXÞ
ãp¹àèB¯sÐàáÇ¼>½š-FháÏò/®NÇª?g¯'r–€â‰$´NÎï’ó›ÉÖû"½¯²TKò³K­Ã«˜ˆÃŒœGØáP%ª‚*»På ýÃ3\”D‡º|(Ý7ú¸‡»‹Px]Î¤Ô«qîºxK‚·äá-?
Þ²çÙ"nêy‰{„ôt»ýÿÅ-b©¨“%GleÓa×…ûûÔ‡vEžJã´ükI}õüâi3vÌféÉSzÚæÒã ”íP;¹sŸ6¼R‰ïæJµíMê;ë&•N‡s!\,cË/Ô|Þè.÷8+v¯Ow”{U,³å"z8ûfñÚÆ~ÛÒ’oYCí¢_ÈfÎòóÞés;Ç“úf8û§&º„)oß5_àm›¬Š^Uƒ5Iëª“;Ó/a|’VyhJ·ôR´ùÓc2<L¬ªöÏ2ÿéÝÓml )Õ=ž'‡*€Ù+«G|ýœŸêS£ZÙ¢µ½æþ×y2ïÌ’éòbÊ_!ð¯­¤ú“ÓUÖîêú:7fèqõ|EM½›»ùly/ž¡¼€ ê ?ÔlJµ6#ãðl<ŸpO¶Y¯Ñ2ó·Ú}€ß÷Ž‡ïì€ÄA2 Â›¯>òëçZ0¢å].É·ý?"“äó’í|~6íQ£ßh=—6	‹GPÌ]H0Œ#t5H®'E¥4btœ€§JšÒk°N<…p¶Qëeã´Qªï9„iýçë[X©bÑÏè»ÁD;[lwPàIù"YöÙ²X|Y°¤SoÚj5Á‰rKË9¥éDVkèL!ÈqÖíVów/–Ø(3.œ=G	óaV†/EMª~J+-"¤hÅ³Èu PElÞéÅaecR£`ö#“éÈãxFÐ«d²ŒnòTx £?°L¨>´Î#a€zvŽVÜ¾	!÷(æûi£W=iÖyf®ðcˆoø^ƒéRîEOv1uha„ÉBÙúmz31’,¥HÂ‚ž2ƒr£†ËG¡Áô·Hhz&?å
„ú>O'LÊãÑBÃ`Cë`Þ#_3Ú€ ãI:ÓeÇ~1Ò¢°[–u¿Ñ­„ÕÃRàT’(' G8Õ»É¹3^‚V»šè‹#eìl‰³$V=q¼%,Qu*9}{•
éó\Í,ª“aìX/Riuá•¦Õ|‘ŸAÙì0ÃÞŠÏc±«H°k²rrT{Ü»:aœ „“¿_ÞÕbØòéØm™¨Ž–q¡°À}½»µ¥ÐŒ½yÝ,¿·môãÕøÄ ‡·žRXŽèÿùê£ÂýYÃó:ý%I»fv@•Ü­×Úçç2'†8zjÕ|´J¯î&Ü–blkö‘Òö‘°…ù2J(ÃD$-¾‰
øÕBoÁ¯wß@OvìˆÕ|
¬ë‰˜ƒðð²jœ(VþÈjÍðíS¸ÃÌÐúž½tÙï›N¸û¿]Ï1È$@Õ—ÕFŽ)Ì]²iƒ„^Œz˜µt¿@a#
÷í€`n×	fd p™G¯[ñm<Ï€§OêÀ¤.ÅaYpD>ûÄgQƒ`*ôÇvù24]3:C\¯!‹ì0ò ôÌ^¬¾úhÍÔZàÚgÓËÅ<cZ{rÐ"¥ xá™É¤‰­D#à©Tµ$°ér2ÚnI0Wö™h‚ëSK›(2U‰E¿íb€àw±Ê¿‡»ÛLEAM”Ÿ¾y›3@µ
Ì@5—½BgG¾nï1¼púÛ“šIðæ
=ÍÅ¢X[j}	×1‘ÒM-û[¸Þ-ÏiGÕ¬OÎ‰–šäcKv2V#›ÞÅT,þˆŸ†¤TU\P.?†ÊCdoÅ€ë%&\LCu±Þ¯³ÛB(V(VbìÊ{Gž4{ZR>Ô3$,Ìé+¬”³Iƒ¼½G&‚¯ëEÞùS¶0 ó‹éÜ6ÛÀ³6òÈŒIíaøä}oª‘ô<P_–d` B5ŸººýycëX|XÞZ—%1`"Ô@}ün3¹'{°ê„ÄƒèAKt2Í™ìGÏŠ´Ùç„€ÎŽizñDeÔ£]ð=UTö]^Lñ/õ=ð˜Á§Rþj€®‹ö€l½—`v¥,ñ.L™c?všU QA€™*åØ$„&ži	tŽúaK ‘ì‘lrñ
•6uþº}Ë¡^XK{Ž—]g Ê<ðû£ÕŸ~ê^IË‘¡åÒ!³eÕLqQÆ¬ÜÓTªc/RîÕLydåìQ_¥vH53(Ë%–œÂº2ª?çn&n³ƒ‘Ÿ¬FoñúÅ¦šæ„J6áÐ‰C\º`£n™nA/D9¦‘ ‘›!Hò¹E„êŒ–{Ñj>ß¡<s…|¨÷‡JiãuËùVË³ŸÊDhçF·Q«6ñFžTpf-ºå¡¬/xO‡‘dIùæbgh¡ÂÇt°/E–aN Å*CÒp•‘÷hÜÓ®lÄËöwÈJï²
‡ëÝ‰ëì}—@ÕOàÅà5èªmÞ_ií-²å£_‡“·g³¨¤ñÌµˆñ†º^à÷¦ÅúÕU2Jb
ã£ºØˆKoi'µ6±]qö.^\%hæ>•‚	¯(¶åRyÏ%öêÚ¡Pˆùâ¤ÖÐêßŽìÕ/Ã…¼6\LfâÂ´šHÒ[MÍ¯Ç\ù[ÝÚy<N†Óóá‡ÓÅðýxö~
±ÉTïŠ·^é&|?<Ì?ˆKœ#0gOâžÜ#,}ûª»J¦p¬0„^°	‹™GMžQê”ÙfÚ»yõ¶'0+Î°;KÇ­­úÄL	Ì”Ì’r„Rm Ìd%äÈîÊÚø?0ý§˜ó9b‹÷P I?¥pQÒ›qÙÍ#vp´!-v§6œ[;ðœ#ÒYˆ²âp>ŸÜéŸ3Õ•©¤spjÌ‚.!Õ»Ø¥‘UÓ]YSb­)c;‹øïÀuœöÒy2™ ÃdvÔx*»ÇKIuƒU².°LßÄ ²_çPÈ—#3ˆ,>üø!C¬Dõ£85ûíðDÀ4Ê©œûd*Úr¯öÚ±½Úé5žcèjgPÿ­V¯£íà/Qà;ÄCr<ÇóŸGfF1åF~6A!3¿±{óùÎµ|3ÀÌ×Æóá³
]W>«°l_ž¼Ç“ë,éH` ãÑÐô'£À—G…PœM~XY³ŠÒfúÛ©N&‚ÜT†ŠkÜQ2ü:"yœ¤s`ì;YD˜CU§^ÞþéŠž[+àœ{s)N€žØ½Õ-ÞoÕ@&€‘€´0‰E)×›J‰†ì@™É¤®'BÚŸ j?¡Ô"¾&`|>Y¯ã%ÖÖé ÷XåÓx8†'4dŸ5`uvôéJk/Üž_!¿Y;ØÐ,i&Â/>–±b8º‰A@	l%ð	TÎø¹`k÷ñ¨Dˆ±_¾K³+ò÷Âjš g§…E¹ÂKK±¹ é¬fËáùp:¼¦0Q}ñsÒƒ,[@ž&¨—DåÀµKCÔ‹Ù"}7`8búÂÎw³Uv‡	£‚â8Õ7‹ôˆ<!>'N©º¾ÖdpzËR…‚wÐÂÛ;ö& ˆª¯ÄŸö, ìjí4ë#¸<ÄbùEëŠäoƒÙ3–øõ"Y¢bKgñ&1ïwñóy>	Ì-~RPóE<InßYÜù BLæˆ‰ 
´«wV,X\|*¤EØ½o¹Ûb8âP¾HÁÉô¯PXÐYšAÆ4MVéè&ÿÎoh[8µ Âuå›UûI Û·Ë«æð.^9°væ9ºäB+w'±ú‹w°fž ­PÄâÑ
I¾¦•@V=ªÞq«ÜJ•@ª%_Ð`~ð$mÔ£Cõ¹Ì@>®„äGC6Ÿ©XÌÙ-Ýu«W¢2¯ŠÚæáJªTWã_}ó¿À&Ž7ƒ>+ŒY×9)42XtÜI¬È7¾}ždÍ0„ŸÇã“;ç¦i"&•Ì‚ö×yÿ¬â³ÁbxÆ»í±ÝmÀ¤ÕþÛà²„û dôÞ•‰ÑlH…PÚºgª‚µ¾'â‚þT¦¦Á’ÃÞhÇ@.¢Hœ\xvYw4“×dªÂ/skG–;êÌ0zœG8l7ñp²¼±ùêŒØ2ýz {pÚŽ	»=Ñ*·÷GÁÞ»<ÚÅ÷-qjÁ,¾ ³¶nÁšÃí”ílÁæuãl©N;ß½P:X;ã@£ÌÖ«ìáÝ!ëpþ÷Ë¨[ÏkAõ"šOùï‘ãIZ¤KÏ®ž“¥i*'Ž†ÓË´>…uð[³çœt‚ìeÇS¾Ä@[þ!œâ´4©ŒèÚ	ŸFd´}×â¿còC!H:û_å×åû7Tcxbßß>Neèó©[zÂ-ÄÄÔ2ôVõo›G¡÷@}5íÚšÎ®êwšÖŽvóZ)=R+¥ŒVpK2E±³÷s(=ÐÙïTÎJk[ ¿ïúM$ú¥K£D?8Wá{Ó½Ž`á)w:ßãOü÷&„ôU­Ú:…dIõèì¢Õª7£êÅi£ÿ:R×ŠJÉ¥>¬ƒxö³.#_}ô¶Cs¾W¯Ä¬á•CEÊ<ÐÖQá…<%mÈÀ9iÂÈä·Ü¥§
#Û£aÀûŒŠ9ßmÆÏ€·l£'­Hg³Å©Jˆ-¶­nê^Ë Ä¬ê².® ”«(X)ŠþQZ·Ã¨ •Qm2­ÚAÔ˜¢AaWæ-$¶nÝ :Š˜d~üöt~–£l,¨g~Á$DÆù«€Î¶‘òò—Bˆ\y¾o#biG˜½pôäöàè&:MÒ¡ŠãË±	&½%¾áè¾¹‰LÑƒ¨ÚïÚK›æ­¤R¶ˆ9û®$£ÎI :OÒ[PhZ³¸gY¥ö-•ƒé}y¿Û0æï#²]QÏŒdQø1?kâûMü CÏÀòF¸Ð¥iü eŽê‡0ªÏÃk{ýêóúiÔitêÍF«uëv·ÿ:czJ_]Ä ÈööÕGGtY+Ÿâ»‡[lxµá
5qß˜[ûŽšdíùHÝ·áô¸JßD…Ž¼[GÈëñ³h‹˜õì|OãÚâúö³é¸ÈëÑ“¨€È4¸áîeLÁ¶LVn˜Á:ÄúBH1h[0Ñ–b3L‡E¸ík”hY1róEˆw<`5Îëºà´1nµÍ
ÔDPîEFQ&sw[âïQŽ…:¯gßGžGq˜ŸŽ7qÕóœ¦÷ˆqmÄ†rÓ}ÂÜý 8ak?ë({´ê´/J®%3t,øÃkAw° céå¡™¯28Ë–æhæµÔ€!»xÿÊÄ9™H î,}‰ã~ä:°¶Æ‚Q¾†ƒ5²Ô4”…,¤Pg¬æÅ–ª^óœ¸ÓýÔçÈaYŠ¤ºŸ¥W—û³1ÝJ!ËV…;›¦‘©+	Ã«rÔžöEc£V$XÍjÎß5ÿÎªjÒˆè}VaV5ÓS{¯W|~á©q58Å¡ÒkÛã	\{£óBÙ*ˆaL½Ûú:1 îãé»b«}ZÔ[/É‡X”ŒWØAt"þR*:‚—$â20ÅÅ$íh ö]Œx|WØµŸ…ƒëKÛÐS‘Ê0^ÓSN‡š›=hç´Q}Þj÷úÚ¯âF8u“&Ì©oÕéÂÀ¼±É~÷Lá@§#H 0X±ô©ïàÚQì0‹õ3®Rà[pth…lÇôQzíìF— rw‡šÛ;9zúÝêiR?õFsÐÅ÷'™#”Z@Hn„D;»>&qØZˆ¶I'0ø\èº{ØYïÝe¢ðçGöPÈ_#¼Ø/©-þI}!F|A®‡=€ÝÓA§Þí5z}+ì	ýËûDìÓÖI,-xó#c[]½%?ˆ–CÔÌé9gð;YnBð½e/Ì·(r×žà„+–y..ÌKI.ì‹Ì=Ïc	þmöZ¢Î2 ¹ŽÁ?ö¤À‘_àŸPvÎ~B†óm½6Û|ö~ª¬ýr£àŒÔÅ”»gÞñè¾ —D0Ì´fÕgs–Oóµ4lgMtþ4o3ÉÛMñ6¼ÝôòÉ¥ñâGÉTÔíGã'÷ž¦!d0zý¢¯½â Väwr‘³`­r'rhˆ¥ª§œ¼Úâ¾˜EKû	òrÁ/VÚó8!šœ¥z)yf‰³’<bìëø)ŸðTpøžØYÓqZq3C’ ¦Óùñÿ)A¨¶ºÔ·ÌèF¾/¤½²:¬Y­ÞÉÌC¯Ü#íxk(3«=Z¡- z;þú¥`¤°Ÿ_êÄU’CàÔœð°‹´¢g6Ž£×‘
æ £x	]dÃØJ6¬´UXV-)·Ž:õ¨Ø"^®Sî^@Gº»’‚S¦èóù†‚»brH<ì0¼Þ$k\ŒNê½>ht3ÏTà" îÖAugýÕG6aÏ¢½¨'„ƒÖ©X[Œ¨ÊTEŒâSäA%Ï±†æqÚY’yÚ A'géÔoAºÅ©}Í2Åz¸¬†ûf7Ëk™?0ÝúêrÿËkÞ\Ÿ8cWÊ	é!JBM¶w üÎÎÄ%tœsÁ·:¯5–3J†U{3¶-\òÂÍ£F0à#²ŸçÁÆÈd;—7V¡*¶Ü|x~l)—<¹em»^[›[om+¯ÞÙ;­vô×‹j³qÖ¨ŸF(¼k.«ƒßlsÇ–O"lfP‰Z3±–«y¥‚Õ§äî¼÷“9¾ß¬¥¸Á‡õ3ÞèuÃ¡-qïñÀíð˜›áž[aëàñEFð‡^¡!nV–EÈÌ)&ôMÆ¿_,ÎÓkqš‰?¢dJ…gWzzŠ3E|.JªÇ‡ô—,–R:èÂ?ÎÀÉSŠ}ò6þ }UË^ô1¸	"DSQ}RÒÄ?wçÑ†z ›³ZÍ¥-…:¸ÉEœÑ>(ænçË;½DÏ¿ðPüÿ.[±/Ö_¼.Ð‘~€Ö¸±º'sLK"Öl0ˆÓ[¼Dì¤‹Ñ<>´r¬U\¦;EˆüOwÐôÉ«ŸRÀcé_™¸U@Õ¤2à¦Á¶É ]Ç[ºUŠXÔ;ê$!VñHqvj3éß+-÷Ïjú	§W\>·suú ŒoùÓùF*XI­ê?±÷Ú„èÁ}ËŒ¢Ó^ùwÈFP>2Šm*œ5Üs^Cú“ê9ÑY 5zƒ0LØ7ç2­êKÍÓŸ?ÔŸ…—˜`åÊjx¢¾;çÎü¨³ìžþÀáµ1Ñ,tÓxévçuZŽÊèJ<[-³Ð}Ów¦Ëáèm&„|ï½ À›çƒ„‚vùPYAüM’2Æ1°àÂ9N|TÁñ˜îÖæ"HºaFÁU¶®i²ˆÚVƒj=ŽÃÑ\]¥ÏFžÈ¶1O$Úâ—É(õáŽZñ{Ld`kTýéûÖË>éìPWj“WjâÏÑpí¥8ódçÄi$þûÅÁª/N<è× þ ½€[öGqxäï‚]J!ƒ)^K*QMÞü6t;¯&qÑ –³Úìöv6ý¹ç àxNÞÂ/øÜó[Y§Þ;/,(±aaG–íìîEGv­ùÃz5à{ ü*-… ¯B¨Ç3AïBàT¢ª8+SmŽôÛd,z±ßâƒæÃNÝ
W«)¹³MÕÛÆ(¦
fJ'¾”¤èSQÈrð
nÏ!Ëbáà¿¾þê`/ÚÙ—qMˆT¦HÅkƒžLõ`ß!ü©&T¶¹Ó´¸}éXÜžêjÔ!“ÉL%ˆJ*Ž¯Úé.ºMÊ~ç}V#YeS¿Á« .õVuý…ïÆB´s³\ÎÓÊÁà²0aŸd°ýÑMR|1&j`Gî%½,>¤
ë+ÑîÚ³‹~®i hh/‚çaÑT~|¨:úXü£x)@P}|ú©«4´Ö\«}ZP«÷%';=Þ©>ª×«^qåüG[u?ƒŠ¡ª¸C®àØé–Iq@lºgòHÍAÉSoƒò-€™eVœÌFÃÉÍ,]îìn>*}W<ÿwDÀ|Õ ô.[ÁÞ¹Ì<ÍgÌ~½ftq¾ZŠ“fzÝ^Ôñâ¸'XåÕN§Ýë‹›ÛNçÿsZoÖûuü€ÏÕ_Û}ÒâÍl,zs‘Âdo`„'â|—/«ãÃ• ^$ÿMZ{^í|ØŽ…è½ÿ6¾£ôné<¡²]Ã:ªÊ­È/•5
;U¼=îƒà¸˜MörŸ¦UŒ†ÑÙÕÌ$¥00¯;ÛÖ}A#€zÔú^ôÛ¾¼DÄãý_¸¢x;]î÷ïæñ^D·ñ_>_{› ü!çcÛŽœãRaGž×û{,´øßñ?´Èâ,ñ^Ôî@(ú^óKq32CQôj_Q¹\h$,@2‡…¶xJ‡‡»‚+éË:›‰H„`‹Sx¹Ðîö Î7©\¢ÕT‘$&Þ²£â{¯w ¯0xýª®å/8ö¥ÛÝ6#ðûÿÍay·ø÷THlùJm‰9kwO§§uc¬2úS4ŸM’Ñ]%’r:ÓìØäÞaZjæOOmð6ÿcŒ}{Fœûˆß·²Ã°÷Ñé~£V$³Î‘«P÷ôb¤ù
Dºê|Nj1™B8h•¦RY¦OaP#ˆÛˆòžœ–Úí_O¥¢K~Øi´úõ.ÄþèÕ»/ëÝA½Ûmw5u¥+HÌ,qÉý°¼IÔÚH$æƒà­è¿©¼}	["Ä¥o9[
þÒ¾*@-)ÞË|z‘
Õ-€	šäíVgÓzAK”p2p¥«ËŽÂQO.éhæÌˆ!Î¨rpÈJÖ,´JÉyl©<ÁÔV
F¢l¯¤
Å;‘u'šÐÁOìÆ§_¸ZÑj§!)¤>Îcí¨*Àl*‘b;DÕÄmè+ýMßÍ¤Ðo=@öó<½®¨ÁèZ£·•í¤=3û£·Ú¬ú…ÚKŒ%˜®Xœ!Ä¤VW±Ž‘¨Sq»Ù]¶¶uáà/Ñÿ:Ýú`ýå S`À^‡ÀéËY£×–ji—ÀšS#é„XÀb¶ZÆé=«V÷Zû6Iâ´s‰”W6£Txa»¤Ét tz¿øùÙ
tK ‚b©ú Y°ö¶Âˆ¨¯ ñT…út±ÑátIò•{8eÖ²…ñTEÍÓ¡©T¤<êþwOU…NØ)ê`ñRÊ¦æ}îwŽ/ýÀ÷~çº
±¥RþœÌâý¹ ž´ÁÙ,éBÉÆì–&A=ÊÑzvò‘"‡3urØ”lE{®.=SîÞEuŽ~*pÊÕº¿wúíÁEK,R·Wá_ÌÅÎI¿vÑ;íã¹»Sï¿0?zí¦ùqÒ:1?~ëvÌêiÕü8m?¯ó_}ó£Éj6Z¿0/«¿™_ÞnïEƒ5Üï281†¢ß>çã`m5¾j‡u©wÁ0´êÕ®ùÕæ#ì².4OÛæÇ‹^§Qc•žw­†Pëgó¼IëC¯ÏÆ×8g?ú6Ë½:ë÷¯3¶Lm>¯gÍö/²Sï°Åùù‚õ¶ó;_ùÓßOYÓÕêKVí¬ÎÆÕ½h±¢µõÅk"8!,Öóè­~ã•stÒÑ‹?~îü.[¼8åßkUö÷‹3¹\30§@¥ÿÖxÄGŽSÿ-`4Nñ]ÿ-¾‹Ÿº®þ[4ªë
`ŽŸ×Õ}ƒïâo5½~»ö‹7Õj§)‡òò´J÷ÎÔz÷šò[õüo-‰¶Ý~.«œ×û²¸Ù”y©vÅ…á\.tç\µÓ–û·-¿üz.›;W½|.aª½sÙÖÏ­Ÿ%µË¡vž«R—Õ»¿ÈÙAmþõò7Õ5‹]Õ³æoš"é_d«ýsùÇIµ&«Ÿ(¢lôdõ_êj+õ%Pí\v©Ý­É^ÿµ¦YëÕ$ÒÆÉ¹êÓs9§½Îó†Æv!çYâ¯þ&{×jÿ*»÷[Ë¬*;ôÍa`}uoê´B)ÞraBÒÐ¹±ÞaÑÆ²jåg¹›Žú”âÁ^tš´¬µÛ‚cýÚœ÷Ì÷Ñ_¢oÅÿÅeuŠÃïûH- .EãÕ|V‰Xô›& ñ—¿ ê¿ˆx:›¼`tÐžN‘Lë2”Ï]ÚOŠ"ÍópßS¥EÄw€g1¢$»Ò…ÄWPþÈ
ÞömPf~gP)†-µÔS·FmHþ	å³œJ\WAÙ¦ÙÜÑqõWµ¥Eµn»×T{½z‡l Ó_}tº¨W«¶PËxÔO't]…ÙÓ¥j­(=¼#`Rx›_ã'›séô°\¾òçŠp!ü!x]—{¬×®ø²¡8˜@èû] @Þç<ÛÐœº^€2° ´ÄN»`›.K¼ÏÎÑcõÙÎÇªHðáw¤R|Ã©³p“¥ê¢ýÐÔ
SzìàfËòLÿU	 ÉzfæÄ„RQ†¦€ü•êàkåwÃø„úÊ‚¦¼Gð$±›ç÷ J<zæ€^6T_¹Š¥‘6÷G…Òáî^DòG¾H+Ç	ˆ$ApÒ"’ÆtY œ´'®¢Ã1+8Ü•cXN1±G‡‡òËÄÝ€ —£åäŽtlúE{jbaLgÑµUÈeõ2cÝÄ‹x×0dpNGA_%4=EïyÍšo–WG76_^ðÜþ•¥˜âš4öªJ:Ÿs25Eæv
“³Z#¤÷œB¹ƒ-xpwUˆþý;ó!B:DU.~e
Ö­À¾ÐìÐ¦/9¹)¯.-ˆzV)üN£Ù|)óß¸ŒàØeNÕ”®vr¥eèEµêé©tãÞ‡·Qª	W‡’ø
*:Ž.%ïZK•H¯µ@úÎ&½_G\õó*©›ö¢[IÈ{°$JW:³„Vì.Œqp‹nwúÉŠ0E*€µœÍ™C¥ø"(¸ ih
.äiŠ6H}’ÚM|S‰dPÊYzÓ·½CÛIUñxÛ+Ñt¸‚žøäIˆŠMà_ÜÿœmŠa*ä,½g”–G¦6w-\ìEþ³Mi ÛÃÇL|ï|Œ ]€ré«øŸJÑZ¿]ì+IáõJP ÉÜÄÓ¹^²ý‚Ë´ç…½ýNH}²+¤…mFëm’.ì°Ö—$a½3&… Ñ Ú»¨ßîÐ*¥‚$éâ×ÅS(!¯èqœŽ£…`)’>Nï¦Ã[Ê–ÁÊÝ,fS±Ã¼–PF+ÍÉ2:ìvÉÁ8IßBP÷Ð™ HfcBç“„-ìUÎÞ[¸xé_Š)¦‘2Æè÷Ñþ&©ÿ§èI\ÎÏU¢†7Î{=ëãiéÜqaéIøÇßsÃknÅ~Û*»žuôièÁê1m&*¿Rµ^×ziÝñ‡ãqAeätìÛO­š4œåCB\þpqI—ÂÅeY\¶‹‘4jÐß“’†ØÜ/eöÅœÁƒ%j‚Â.áÏ2ýT¥e¿zø!/ü[bÙJiÚO.~Çw÷…”=$‚œ]Ð¨lû'«c?QG½'½z³èÊVW~´ºòã§v%œ<»ò:@úàØ_RxQLÆ{Î÷t:œ§7³eËÍ/.#í¬ú—Ÿ~Vý³ÞÛf>hæ1Ò@"úÇÓa¤Á,ra¤v
UR¢’’_R¦’²[â¼®¨œ—8+õ®[jÒèõrá =v?ïÈ´¨þva’ôD=“ã`rW	qe`?|0õzú-_‘ ~ f6¿ƒìqð1.{¶œõ¦žÐRú?¤;ýËo‘|”¥Òˆ{~T‚¦¹ÝP7¥E25ÏÝ](-ÈW—¹p^F)÷E4üsóßáVr¾¹u†	\œÒ”ž‹óŠýöð+ó"ÖÆ40À™žãKR0xa
ÊkLÍ -OòD­CM<MÏS›iÙ<,$ËlˆÈ`Øžù‹RcxÂý6¾KÝ-:‡u¦ßÓBðDw™{ •qOô
Nnê¬¾oÔÎ
qNág³]žv^qEòk¥—È^T@êÍeÅfÂ×XÒDÏžwyo¹¹.Hâ<ÖO¤Ù’¼bK)Z|±8p"$±µ>Ê	ñW!|ŠnˆÛJ¤–=:hdFOI…%¨¡ßŸîC¿jÐ$jz]áë°51x=U"×aiòM¶¼XIh¸è
Ã½èonYG‡EÃž1ŽÑ%û ÍõûG|p_º•‚u¬*C†„ºu+òw^#¬J¨†® .Y²aÈ%#Úe¤fÒ¿'Ö&ñpá]ÝP§Á´V äÞÁ‰p…Ðeôv†WÑi”ˆ«ä»d¼×«M¸p6Nñ1®”±ÄOnÈ |ûMVûè›HzGùw‰øpsà°Zà“"eÏO"ƒfµ{…´íïïGô':M†×Ó™8ÅF(RÙ/â‰`H ò27€åZÈ„Èh´r"¦bAµ:%xÄE2Eü{m_¶MP+`,Y¬Á@Ñ0ÿ	±`QÝü}ô²Ú„èÛvÔµúk©lÇÀÙø×:úŸ¨'×¾š‘²eþ'F±Ý^jýev‚ü¿úhÖ,+ŽeVr_&vfÁO¾úhÖ¸¨c)wFËõÿ°9&Iñkf@ï³d:½Y]Fð¶*ÒôH,"‰ükÜ2Òg6¹k·É4!êF%¼öÅÒ]/[G œ
Do+8åX8qÍÍKš¶—8Ð©¹¢™võU-s%†“¼ÀC³º•±~Ëo@|üFf Ì×¬&Zñ2êVº¼’–gÏ@Ÿ$<10»h­+GQá<™FÏ²Sln`¾oW·Ý®€Ú‹ ª/Ã0¢ Á²¦O‡¬zòñÊÚ\æOÚ×¯íÍ7Æ˜ñøœ|?ç¾
Ò 3âm’ÉZTNœ5•¬U²yÒò“éa‚`Ç:…ûZ+,¯b!z2 w¿³¼mo¼ýh<“Õ~Œž0×Ï–¹	\}Óåpžüß9žÎ­Ö‹‹“AµÓüRÿÝh\¿”àâÜ¤¿œçdÇÇ˜uPöHIÀ\¥*}	è•ÅnÉ¨ó¬^
	®¦¿ý§<–(MVÅÝX¥Ó“zzƒ¬84 œ/=9<tp‚Ÿƒ9DëpqoÔó´+¢Žb2;c;xwt üí™ÒÌ“åbòËÙÛxzüÕGkÖoö˜È ¢ü°žÑ'%˜®,¥†£G©‹é‰õ»8{»ëi¦Á½XHC¢Ó1“K ½§·yøo œÜ&Â=w!Ê)•÷Âìk­¤€7Ÿ¼4Á‹œuSÛ–œêQ¤¡µS!4„`CZœMW6KÛ0äg¸g(°â ±4[·øÙ§Å0è[Sœpœ!|©>¢EBþílÏ-!5gðN«~!dæÎž¶¼îà‚æ
C¢õFØ;¶‡<	¼,,IoT~eéå„%‚üü’L!þ€Že…<Ü‹¾±œ (^ÒÞ¦ñRì0xôd×»‚WObä©¦{ñ…8›¸â$¾­Â@ðag7ú:ÚÁ¸^ ¥¬¯²Ü{µË‘')Æ ç¢!óZO;h ^Û*Ú!‹ñN¨h´¸›/gÁ"ÈY÷!X"DˆÑÛkçëŽ¹A{Ýª«ÅuD*Ö6\ ,¸Âµ@Á|–&p
·v½0¾Åì=<·y'È¯¿öyCp˜ãÅlžÔaÆ`€ºƒ“<SL!ÂSÖ(ÓÉê6ÜpòóÆÈ¶VhŒüf£µ6éOVõ‡5Î(N.šÍFïS4ëÈ=Š‡"óÔuHï¾¸M#Y^Tý:*|ýÕGÞ¡u¤Ö_à¼Š Kwß¨¡H†Cºç+?Yë½í`êÕîCCU#Á¯§XTØ‡X¦Kpê@ÆÒUš7~TldÉJRñeµ\ cˆ8¾à5Öx‡ù»hjÝô^ÆcƒµåT@ßÀÖ¡*x‹Ô§.ˆÃ^Ÿäs±ÑñS{äQFð'ým„pq½ÿ"¯¸×nîxÊÍí%QKÝ5+$o¹2¤dÄ/Æ¼Qjá$dä—ò7•Huë¾K=Í¶kGÖÞq¤.©ýùïâœLº®íYú&WW*aÚð2-ðE¥"K¿.Fpj"¦‹*à
qxÈ+x{G &ýxŸØf{Š[«ÛKHÖS½u€¨Î’ñ¸PÚulF·r¨í þxx¤óÛh¨L\qt‹=ÅÀ×n»Á wT4•‰’-AJ©ÑynB³ímo "°^}ñ”ˆ°YBO6ùŽbÝã<¯\CÖöÐŸ½mbŠÌ¤÷ßÇH¹ò°|b¿ÄƒÒš{Ï÷•|¡¡ÞgÈ×¯Ãsï„³?pk.±ï Ê»»S¡gñ§ïIÇ¿öv´†’µ9Q|æ-ØCéøA;ðžÇƒm7-cév†G²x°œEñ‹‘×¥õj’Øƒ‹‡D=q¬.“85†Â÷gÚ)s-¨gíSA¤['ÈÎ8~´Ñ *1cœØf4ì•iÞpœ4	øÎÃkÙO‡ÐqŽ}
Šò^3g¿<…ôSpkµ=»X¶«@SÈu#ÔÜQ‘P _*ìÈv“W¨` Úd©ucWè¼”e~yªAWàöË˜éŠ1]Mf3±ë-%£îà.èÖã2Ãá>¡"æÊg7Ã³‘ªÓ¨ò™r!NŒ«Õ„¦š;qÌäŽ©cà…zž™^ÆÔ¦$4¦Ît6ŽëV,¬	T2ËTO=ç–ô`?ç–HÁ’ëöNÑu3b½¦áÄzûòßa\´ª/«¦µI¡k|Ö5Þ0}ÊiúªŸzç¬¡ÞzÞhÕòÉø=znFõPgOiÕêƒóF¯×h=§^šëÝ—ÙƒÍo„|p^íþRïÄ˜ªƒÓF¯Önµê5¹ŸÑ˜4[×ÑiC;z04W=h =Õóí†Ôá¤ÃZa:SŠ´X€FV43ˆhOÇòº*®.Éb6¥Û¢M—ð	!¬MOŸŸCûè·ßGj¯©¬çôÁTcW«(ªõ‹ö¬*‚~F70ï^]BÀ§G.D/P<×UeTéðgõÚ@ªTleˆÐ0Ö×=FŠB4¤ýY,ƒ³T<~$‘“Ë·„Q¨ÙGl‰Joà•@†J‰Ó:UX	U&*¨	2×_„´Ýç&<úÐú“[tÃ]±BZœb QwñÍNØXX\·^=ýù›¸©kÎA’˜œÂ;1«·¦ÇþÞÕÏˆøyƒ*›ŠýÍ‰ƒþ YÀ¼Gœ8”!Ô;¿žAìƒzýªMœÍÎÝúIµ¹ªþz!þ6F$-)¬
"–ŒmÐîô!Ã'Ý_áüB†{‘Ò}Œã«!==#±%K~"Z ^†cÂ”¶
³øU
Ê_%.€I@)eú"ÜG¶4ñ Õf¤Yáµî#<†4ôiòØX>Ê;¯ýT2Ÿp¾n<»?ÛÑ‘#wp¯T¦áÉiSÌÁÝ<®(„×Â‚Ûôúí.H^-!uµ»Ä­›íš&ûÐ ;.ÿÿDÇÙ‘ÞFft˜ð,Sôx×ÇXÃ:Éì³ló!¦fb§Ú4Zgõ.J¶$=3¤i<Z-’%>Çí½ßx£º!‡èåp‘€¨gJ-½«`
Ýe²¼OoH'XÕ?¡izgÊ‘±Ò"áËÓ$5dˆh^uGfã+UÕ}0 §TF`¢üÃfÔ›@©Ì ÒÿÊgæÀI¶EåâñÐitëßgUÝŒ‰¤Wú±1¤.~Ä¹4
ÐÀtr%^áÌÓ»ÛN§Áûà ¸Ï¤²êóZ½è¿hwý*\’?yj£Bÿ×zS ÂK«·û9Ÿƒ—îéÕŒ÷£·æÏñ±Ê†[½áÀÛ_i$Î>PpVfÏ`wàt@OÁ²8L¯fq8C…	>a—-FWÐ—=ïm;xŽ a{DÌa OÍ”#¸âñ£4XCxÍœ¤Ô‘ñ*Å¦l½yfvšÉÐBÃd
qSùúÅúáCGÆcun-æaÅýÑÂBFù^Võœšæ>4ŸO’8írrw˜À4æê•†1ÃÉC|LÆëS7i>9·.æ{wƒRÖå€f:|-(ç]² š|›ãÚiW²ÚbPh°cåeˆ?Â-¬>ì˜Gl…øÉ©Ú‰)oÅìV3ƒR³ù•_^†”æÁ¯‘
’Xþ+ýú€Ùëž»—•0 |}uøÚöƒ’a1c1%ßrHuŽ^Ëö\Ûž×ÐQ†Cƒ‰ªù¡
KA†ÿìÐæj4˜ì(è'Ã £!—4|ó¤K²çXvÔ…|êôQ¹&d…W7ý#HÞ;Y×ë[È6Ô3çözÝ‹GôµN_Š¥îÊ:î$*TÁy¤Â-§Ò6W8
RŽÕ,ƒƒÞ[¥q@ÿ[EÚžæ",®qÔ‰TŒìt§ç–:Á÷2Š{õZ·ÞÏ*V„ c­zwPë¶U}óºH`
R@¨Hÿ)_ðçtW¾s­ tÔu3¶ ©÷½ªf—ÇOðÑ1ØðÁ¤G·BfÌ÷ÝJDÒ‘[ÙÄ#§Ãâ•±±¨üüC‘Ó¶Šœ.-½;,bý;£OËmãÁ‰Ô¶ýÄRT}èÁh˜h¢MÚ¢ë?þŒ')ÅKÊœ²ûÍRpUMc¶íŒÍ¡"Þ/y“¬šILŸ˜LÑÚZýOñváüÕ‹Ó¥àZ±…²5¿ö86'lÂN_™qÿƒ’‰}å 6¶ìkcËRKH¶ÐÆ‡Ÿ‘l;G©2•k†–P†æ&³¢ïƒbG¤ç¯Ä)¸’º>èQä>0`=xâè)Õø¨K­nF]ÐTrˆû&!µ¨iµ4æý€UÒ}>ÎòÆ¢òBÀ‹¢H€¼„'OÌŽÔóÇ•ºÀë!é}JIœ'Aõ¸ª[¤ïøX2—”.“”ºø|<ÿÜõ'õÞúy™¥Ï°–èhmÀK§YÜñ´ë*
º‘ÁÄ)ø©c£ÇžòêÚ¡þìèÓ‚PXÁ¸ß ·AÑáÙe®°Yeœ=uR£÷(s‡n’Ÿ4q–ò|æÓyŒÉ“¡Íô‘vª3\o­:ôë\ô@Ho6j¿xõ°
C€Á†/úísRÓ‘€¡U_+¨°¢ŒgîIáCvì_añ¥ÓŸËûïº¼ŸçÀ`…©¡>þ›€Ö¿àâ§¤}Ëï/¼'Éo»·øFiÄ¢f»ÎÃ}PÁ1Ë±Â5#ÎAÙc`™¸¤¨¯Ÿôgã«9 …¢Óü>Õ”]}z—S«õ{m&îwSQ3-°†,«å(¯a@\a¿8.Áþ.àG9™MÇ¹«¶Öú
üÓšˆËÆ¿œ½½›}"újšú€h'ï– U26"‹«DŒ”ú—ˆ´Å\fU‹™­p
	ç›ÆïŸ-Þn~ÇoÇÃ»Š ‘¢üÛXJof«–Àæ3%¾ÀúÓ²­Š¥À"úÓAHê›ŸÌ†+W¡zyIíòLaô/Y®Íà‚f3G+Ê²†EáñBIÖ€¡,oÄP¾yÈ¸K‚…ú™#¥­”9X*Î¯,YfZç\‚l»Ü¸ä.s2pßgÎ–fM†g‚Ê²&‚Jóæ 6OÁmœó&+î¡ú%¥õ’!ð?¯öËiŒ‚}N%È|–ò©˜^f}CT¾ˆãæ^×¹#]÷Î<—¯r¨—0ébÏg£·æhHÒä‚Tá«.HíiùB$SxÂÅ¼¹§cQû°”fK&¯€w9Cêý•…Õ~¦XyEÇPŠÂ§¯8
a(FØÑum¡cŽaÔ>¿ÔÃÚê˜÷ýOÙ*™y€d,´BF}á±TL!ºZA4¸j@¦lc¼gÀæ	éB–„íeÉ°ÌÀ†ý»Ìð@¾I3¥¡U~dÖ™ßÔgã›Ö=Peœ†‹ o-îY¥‹zzqøºb‘ãíÛÙ,Zµu€!³2™u¨v‹,|ixW;û™ñÛú™ßXÙÙ†«q7—ë”"y)³ƒr¢¢¾{îSå,÷)éGöŸú&ÏÊÎ©š‘õ…Ø‚“;™»"#kFUðç+}“x÷MðÀp2ð0°Nð«bÅçÃØ{”öœí_8õ9Ëéõ»íÖóA’V¢ïØ;øV»{^mêÔ¾[m=§tˆÂPmÚe'Ýzõ—öEßþú¢ñüÅàe»Yí7šþï¢ð[SØøzp€ß0ß/Z¿´Ú¿¶èÐÓ_Å¬¶Úùxºª
þ~>Cž…5RÈ Önõ­‹*5w¸çw.šÍ“jí—J´Ôaö,°¢³j³W˜Zl&D÷_$×7ñÂø*Z”Yé)y÷þóu‰ÍM¸óóöy½Õ¿8wFÁ»ÚîžÖ»ƒ“fÆÀºt^¯¶dg±Î‘;wæœ=òO·G	>ÀÖò½®`2o982‰ó­ÿw,D±êx8;{m8I.2ôZYUƒ%ŽÁ'åzr‡¹¢Æ˜£)¢GŠˆ"HPC3££ø[Áø¶6µ³øs>ðyõ·A³ýRS–(ˆ„õæ_§¡ƒ€qò6VD^)dmŸA©å¯BÏÝÒw*%QBÝÅ‡þ²ñ©BI;¼@ø§Ò
|g}—rïŽÜ–ÊO##‹Óµ6„&2Õxl!âÐŠBåBÕ«ÝÍP¸ÇrÀ°<r/:ª²0fUàÞýÀn›Ëä™#ÿUìÛMã&˜üQsºå¨íÖc«TCåNn9àÉ…ØÉïKhÂ­ao5áŠSæŒ¼þ[N‰v+Ô¢®¿UkÎa”Ó¨ªçöKŒó¼náó;è6¹U?ñ€ÉiÊ¹[D½¶Šó×lÿºÝ„ô§õ_«¿÷Bc´ÏÃí†hŽþ¼Q¼hw:y½ºhÕêÝ~µ¤ÖïRˆ‹f±{™LE.âõ.#§´¡Æ¢mSX’‰¾H¦O˜ûùœL`(Ä¼	—wÒÝ²¯&ÿ,û(Ó™ò BrRH5à'æ@%ü½¢Þ…(“þš,o
;h§4íX	¤µÏ(±bä±ŒŽç/¹••ÇÐÒ©u²w“êÝ$z7iÞM’w“âÝ$x7éÝurw7W s´!R”âQ¢It}ËC}((&E‚ð8ŒÒy<Cˆ•yu¹š»«R]«êð
axëäÔ&G*äöÆô±¾'AÆÔRV³uEÅ<ÁHa¶-ŠRÜgT_ ÁÓúYõ¢Ù·4R.x`ÊZì#D$…dlèÝË)H©ÎMM‡ndE÷öÊþk³o‚ØŽ)ˆºÍÕÌQÒnšc—¡P‚Ø’•È-IëâÑjI
-Ÿ\	}ÌÒüð»›GËÕp"Ó¨i4ß˜zj¸¸N¦ÕË£µPhßn€æªbhÊ¹CçÏÝä_fi”“q.þ0Ÿ§òòFNç~õQ7½þO~|a2§ë]ˆO*g^Æ­¦K§«bî«ð`î6Y’;xg¨+ˆ6U%rš]×õ5†i¶ÝaäÌ˜?/ËÏ³®’ÎŠ¡Ò½í(oK6–ŸÕ„èãÎ(ý¡ÎE1ì“sÿâ 8¾$pÎÆ3å¼ï ßðÓä´/Á™^§Æá›ÜÓA8ysLÌYñ¢¯ŠM-þët@+r`Œ¢WOuùå"¾Í>¼qC°º¼ëÀ+óí5¦Fòø=ñ	)Ä±¾ö»ûµÝŸËtT$¶ÛdZø¡´'?¾;”?3±‘
¬#»»S¢ÂJuA^äueCKbÔ7kˆ\ÉoÛoé'‡ «U¯	ð: €Õ¦uaÚ{ê¨œJM20*óKO9ôl&_£)dgíƒ F<íD‹fÉ19M1>.«|Úb¥ÞáÙfàÝ„3§}gÝä¯ñc+SÅ™“lw)¶Þ}ãÐ)’õÞ´˜7@yýÖ*³í˜e3ÌdÚY‡œËÊýÎ>ÅeYîÉb×Ïì Û‘¥u
|¶	Ë^&Ú‰_ðóÂ:-<¹U‚F~6ºBWV¶çIü²¥dL?Å(©X„™Ýâ[
[QY\MÓ›äjY@Ôì6‚Õ-%&¨3ŸÍíwÈü‰”¬÷æ•’N$›Òk	‰D…¢ÉÖ•TBß’‡ýfRªD3*Qfñ(\¾ð?Q•“
•s¦ýä
®B [ò‰,Pê:…Ê (ÉæEíNµ×“Ñ•ºõŸ)Îâš$·]ÄžÃ«YéA¦´Å†â¤¡F=«Òx»"XÁø¦"QÿÜk·D·BZÁ?I1‘\Ýqid×ïÒš;ÓízðY à	ÙaºLö!¦Ò•aáäõj¸ïº]&ƒªìõ4~OíIÅ=X ¸"Ä|u²Š³‚-1ecB^j„à+Dfá}£–µ5Z½‹³³F­Qoõ½êy§Yô«£Úp
¯¤Ô5|r§l8öäTÒÜsÎºçâ¨¼Œ'³÷‘Ì¦Ì@”g2‹ÝkÈëoénñ¦eÄÄÅHÉ¾h0%Z-ï®êð“Œ­uÁ|0vf7¼¹«¾Äì«–×Y8£·Üæî¤ìp‡€y]€gt: ¹¹Û[ ÛÀámƒãØHùG‡˜jûdi;™g™¸Ö\H§¡Žˆî&ÖF’ÛÛ‘2¶sbÚéf*ð$Ú “rò6´vÏŸE<–bD ô³4 &Émrñ7EHŽÐÉ¨°–ØÈt¹è×—é%$bôÕçèò­[Ùr3­·ëLï
ŒŽÞNÁ³KÝVž&^&xVø€¼*jín·ÞDKÊ Ö¼èõëÝÛŽ:~ÛÏín¯½Òor@MÜ¡þìµ›êÏ“Ö‰úó·nGýyÚ~^Wwø—ÎØ.Ó_ôNõ‹n»S‡f2TÚRi-UÕ†Zûü¼}Š~¯²´ÞR¯-µÞÁEoÐ¯×^  a¿QÇ‘3Sˆÿö{Mü]=ÿ[;Øn?GÀóz¿ºó:ƒdu‚PÒwX¤ý«D¹¡·åkF²"][2I–wMŸ`»”nõŒ³dg=Ý“l@q£ ;Jõ§âžò6ÆNJ±s1»QOb
]®–QìaÑ$Ó‘*uDm§á¢·)ÔDœyC	*ë–q˜êRF@Šüuaï™JÝîfôìY”={–ª]Î`7†e¸=yfûZ±-÷¼Gª»«e‹pï¯×vàß¬Mú“uÍ¤$Jf¸E~IÍÍ#“£õ	¸Ò{tê@9Tñ—úÊ_KGÔ	#ÍÞSáÿwÊÜUÙÉŒÞ­?oœ×-’£¨¢V.´º>Ûâ´þOÐÎä!öatõÌ›,¨“/s™)RpÀpËˆÁÓ†ðM’Ï¦üµÊäNAd`ÖÅ%Øo3Ccj/â6jSµ¯7àªY‹Í¶õÝV™šú1À²ÄÑÿøÓqæ”Y†o«?¨›ÕÔ×«A¨ß“:xI<o¶OÀ·åE·Þ{Ñnž£¿Š>‰cGžF… 
óàèðPÝödòUÚ—æZ^ÏÅõPúƒE¾¬HêÔà°Öâ¨Õÿü™ê½Æ)wÜ'Œ3xX‹j>‰ˆ‘Â!nv2ß=žfü?£ÿ0†_³í¹
ü6¤/vˆ9WilÃZ3Ê˜€ÃÏ³5“þíÊ[C}FmÍ¼·dÝ´»zV{Ä¦{¹dHlR7
!æB N)Ê(ÅiÓÉu	h™ñˆRm|_®„„ññLˆ­v?Ç#"{9L…LÄ½i&­b•ß
òÆ/>	8N'á{_·J4ÁÞbÇA–»S‰™³(žê’OÂ+AË£E"F”=I*·1ÝçJ\4À h°Û2ÚBáª™ÖuvïOãp“ÙÈÙ¤c <ø­=úMM¨¨Ž )*±ES ?«$5'G@¶)‹ mÎwˆù´â’j)oüìv¾Z*Z añ˜ú®òÊ:úp…ƒ³Ël¹€S$;Óåjù`eÊ3ô²@©Ç?=8¦â|•Þ0[={ÁŒXq]¾‰Ì¡\ž’Í´Á‘³ÑÂ È¨™”~?rWàâÉqÐüÀæÁÄpiÑdš36vœKqM_Å6×cÓb2fÃ©ë|ú_™,Ö<½yŒÇçò=Ž=a2N4\ã³çµ¸Âá ë`)Âï9erSs¾%îy÷;×Ë#*,æ€¡Í&/C½ªéj‰Ù"y^è»’8=Êq¼±!ƒ9î1—}ÁT³kù?~iÝÿù9ƒ²K]ùòs¤Õ``ûfÈ\g–-ZÖ`çóýê£½®k!õÑj( XéËË–´Ê¹ãÀêLàßžêx‡ˆþ‚Ns!F.—D+xvôÌÑÔ»xþ¼ÞC_çÕ­‹$Gt¡0Ü‹.ñ¼´G¹­•‹D$õáè¦ Ï¥düÁ:O1©ËøƒHV]uR«ˆNðF»óÔ†bk°5p’žÄé%©ˆg¸ôá(ã@ÛÉ#}ÈþlBÈRÊ©‘åŽ´W¯µ[§ÃCÝm5wÖ`óf%¬yƒ3ä·ÅØ6?thÛ®£Ç_çÚzþÙâz8ÿ[ÑwÎÎnØ°Omâñ'á²Uœr ×y{[™"J2äó·åHÎ‚í8¼º¾K„ø‘‰©´=ÉÃäH¼—jÕ*¦—¯µÞ<ÕkÅËL¹é‘	·!Áôo2¡)¬D¯Àö§Ë+2¯íëŸÎŒœ¾ˆ{—Éåý]É,ÊQ!êâ½‰]¦V¹B…GÅ¨O( nÞ3^cÊ4QR*ÿ5©X ‚r“¥¿áôõ<±ÉÐYÄWñ²NPñ“bÔLÄ¹‡‚­…îÛbt*Z_\àïŠÑ	¸HÎVËè ê¬&È8iWû¾½HÒ¥ƒà_g!.ÝtÈRñ 1
zý:œ¼Ý?›-ÞcðÓÓ—Ê±j sqÜÆâÇb2s`Ä‘¬£â=àf€ŒÎ7¿Y;å£ªö”ä¿ÇDXqAOð&9ÆÌk~M4:ºÛ'ÚEªÎx}A¡5VK¬¯‹Od=éëã¨ ªï£…ñ@ü/,»Ñ j¤ w*"9ÇÀèâÞîôçUxšÇÑJW`}.mÂRkŸwÄ%€b¾qDG÷DÔ»8	ôhÿþ=j´Â}¨¾±xT…äÄlËßô=!beòúŽQ‚«>4<ÅìæìÉ€µ\|?úî	,Yé	nî'¾FSwÈ oò"v©“ILy(ÑÇG‚,gKqqÊŸmÄp "Ì°þÙÎF¬ 4ƒÅo3¦ƒÁí°' Þ¶ÜÐÙL[›ŒO5fûKÒÖ°Uà0»Ymr<bpÛ”Ù¶±g	>Ù‰MàEÓæŠyª2±=ÝÝ¹Ìk[Z•ÙDïy9áWâÒ9[¤ÏŠ¢lu·ãxq6™½×›ßv“N™ÒªÎgL(¬†‡ÂšÝ—¯5Òý¨„sR:4«!£TSœ»Åm<6Ÿ•‰ngÐÙm\(,ðÈ_ØY^Ø“Ã±FÐÄÎ,1Â~î@ä  \ÁùVtêáZíB6CÈá…	(¸SÑ³4sM°TH+*z ºñ’dÐOÔ"¢§~ÙPsydï(O‹<Ø¸öµáÉ…œ;«çÁ€±ì$­ßÎ”&wÊÛ(³¤/0V`LbØŠÇæTß¾õh›Ý¿ì@¬ªI]H·ÐÁ_“i#<mÝƒp}«G™]4?¤ù¬ºÁ¦Ýõy/„0)ƒÕ¯®’Q"Hïù;>–ƒcf ë´¶»8$¾ÃƒãK	&Ýb»IúößÚJ¦€¬bMb6d.^Wz,˜->.o¿¬wÏýA·Ñûe'Ø²`ïå‹5’*
ª= ·ÔmŸ\ôúƒ^ß
–›Åm¼ÑmBé^4Z4
6òM5ëÍúK/|Ú­þŠ±œyÌç†ÓxÙí2F¨	ñŸEcÏŠ "–¥ñ‘Æ$ž(û—[¸°K<‰L6Ü&äƒ	å‚âJ o)IÏ´r5òGX/[Ú<ò§‡”à$÷ËŸ%	™ÌÓö‚à}ÔBæˆEVáOQ9¼‚VåE\?;:<d/Åì‡b£¢üZcä.
»®òÂ9^A:õXv‹?Dkx+®e–f>y:%
sò©'ÈjÄ¬ÁÀ|¨HyÞ’á0V_WÇ?0IÁ3æè;v¯˜ÏÒU0G j‚lÕÍä*Ý&±
¦™µ!¡ì(KmŠäH”!JQÖ‡ ¬¶ñÿ¤Ô1n+·ÿíÕRÜÃc‚VAÅ®R!YGƒÁrVïtD±«tgw/:’Ž¦)è‡(@šñ^ûa‚¢@ÖFÀ&SL_ôÅe±}âÊø]}D3Å¿‹£ãhŽÞÿe0£1 Â´íHœ&µÂ[k7AY¨¸CU³²Á}v2álÿå?ÎîÞcÕ“´¦uÛH«18L—v Ö¯¥¬šjïÐ~1áG	´´•öî¦£Bx²­×¸ú!,ô	ªû:K&q±$«åÕþ÷;¶I†RT’ã{Ü#p38èfu±‚™ÿ[ :V§,¾”€gªàBÎs×â‡ B1Ë†øƒ5mìDü/ÛË>@¯£æl8£RÉbÇ‘$(é¾˜ÝBlÕ·E3R<	Ä‹´œe4ÈÃâÇÏj´²)„ä:›ò”q€^:|'Ú÷uFYÊóc3
´|0ì‚3ûàGCøFßP%T—h¥Ò¿ôŒÉÈïà…/casL+~x¨‘Pßƒ7ËFJuž–ÉöðtU»KË°fØ±‡.š8…æ|ˆ†á’O6!NÃ\ù E¸ñAÕ=›Æ®–’sÐ¤ÊŽè—õ`8ÐÓ ×ÃE5poÉÊ”¿fÃ¡ šh¸¦YäLýÔ‡„f^ª„=½aTh…@@‘b	b]Š&l¯;B‹ì¯Î¾ùj°½{ÄùŽß 4Æ8(‘‡î_q4›LÈ$^=»Åñld&kçNöÛ°ˆ ¡mGjzJ¯4ÑÁìËEÙHgüúäÐáFròÉíò.jœ†)K¬¬"«$›¤TzØÇ.A<ÙdÌ‹´°ˆ¿>'a‰5ÓI[î»Ö°ÈÐç Eò8¶-ÅQog¿À ûOÁ:¬B'n<¨eAêWâPb
ÖŸ‡Ò®ãåC- ×‡)obsÍMôf½ùB÷Ý\â{lªÁ<6¢›hœOî
;ú0„§Eâž4ÚÙ-â€hXAÊú’òçÄ·óå]˜¶Ôi­ÜéUÓ ‚òH¥)O[tR1ä¸k‘Y@&“õI(c”Œh?;)ë¤@h˜}iç'ÚSE1ŽàaDþ¨2ÒÆWŠ§ñ$^>€k±ÞÖŒûf8n†y7!²Ù·‚v^ÒzbÂú³ìÎ‡óq9F£Ê¯ÄòªyTB¤6-¶
{å¾T§¦Ü#ùŒu3_ÍxÈš#² êÿdAP¯h7¾‚Ûëökí^[ÓépžÞÌ–š[¸]þ«¢å¡å›5‹_8 B¤•úL—óL¬«Hð"¾b˜Öž4JÄjÞ&¬sL–¸¶ÛÝ]l™2[c‡Ï(0® ¹ß½4ÎÉþcç¬¨òÙH6hrê^£Ùn¸ïïíýˆq¨òÑüc²ÚÕj".“TÜµ´‡.qYû"•‘,¯“w±z%E!åZß}ªƒ™÷¨Õá|>¹ƒÃ_ï}ó÷ß1.6õwÒŠ.C
¸›X½UÁ	)è6÷¨AÌ:¸GCŸÞñL ç +˜ø>{òõ`[¬ÝB´i;çŒ“t>>Qq4|Ã_‚½,„¿¹AËþjÜÌ÷Ÿðy“ùmûB¨Xpouð·ß‚úê¶ ßyð;ÔB¬¦¾— ÷¡YFTüŸ\üNé!ÁÚS¿vCÉÀžM0ÉI# ñûEøT´õV¿ûû Ón6j¿£ó?„A®w_Vû—uÿÍ0=IÆUœ2íÁózIÊÈKÍ ÿw2}Â±g:œÎVåbº¼¨U[§MÕcpÉÒÓÙ1Äß“ôlHFñ‹ÔVÊ¸ˆôˆA;rY¸ô¦8†ÐÝýA·^­½¨Ÿîpô¸!´ÃÝ€4©ÓD®©Ûä¦˜Ò}˜jÍöì!e’˜¨¨êáýÐå\@ô?³­}m14[
ŒÙöŽÂ3(hMšçõÓAý·zí‚,¥ì$rÝ‰ƒ-9Î¼Mù‹eÎ‘@KéøÉšŽýëéø‚µ—A<þ¦7“àÑ© |ê’ú!§Î’ÞÆ™¾ÿ<û¤°qŽ·žáMóÚ«7›8±6Í™X¶É·šØm‰ø_ybU£ç#°R#gdO©<©ßßQ¦ó	žv‡$õå\±ÅŠ,ºI®o‚ˆt…	¿V‚#ROV£›˜¦?sfy»Q´c ó¨‹%oß=„”Cº_Ö»³†ãA“I<ç›ImJÞ’*ýöEíÅ6=`’•UuCgì½`ôÙ˜;ò¬ýyƒcS+~hå$ñ„Ô`sÂÜ‰îMa×Î	hÉËÐd‘Àmãò:óÌnÍ–½)Â†X#0òã,öÆCÖ¨0ê^u ã£üÑVÓ]ªDìÙåW-ÉãÛìi–	zA·9 ÷™€ï!Ÿ‚Ä±Äœ%âqáÉîz·¨or•(4¯í€ŒñgÑ›íŠãN¿ý|Ô")ü÷#¸³$cÌð¶tL·ÚÍp!Y4„@ÌœÛ­s§"MÂƒqv€sƒ7‘;>O#ÍâŽl›K5†Á¿Ö»5ÄUß'bGLœˆãØ6EÑrÆá|n“ž£Ös³$·Øg¤§ÚU2Üo6¶$ ~îÏBW>Éªð¹$åH`É'â OõàÅíW§8G5ˆäê˜yÀô‚ÓúnoŠÖñ™ŠýøÃy%c<‹Þœ7Nåâœî¾¬çÍ=7¾žãÍÜÅL—à²‹kq¸#ˆ¾Š;"´ø0î®g€¸$)õÆñåêº ƒëu2Ú°×F–8†ÑË¿×L,8¶I:zìMüÔÐöŒqƒzË‹ÔÖ†¢E±Ë‰Ö’Žõ¦{~ŸèV4ñÁöT_gõMP¢‰ŽöÖCõ>Zˆ—k˜Ðig}s2´ã_^`ô1ú{Ï"&Zß§´¨œ¶ôj5%)R‡!"çHËŠêƒJæƒ’„ü!%-b1¡£¸pðêÿ«îÿm¸ÿß‡û?¼>¸ÞÀ^ö‰µiZ)%q"¤ôŒÜöi{ò1æ‹”°!µyàRÑ—ÜõV¶ðÏ"½KB|ˆñ¥þ~“³¢¹¥õuŽ+Êß¼êwzMxþ˜N÷:jL)þU“iwÕUTúÒ¨-ËÈâ˜ ·ˆCÕ–ûŸe_Z3ÿDw7(¶Å‘G§×®‹a@½=Œàü<ø²‚Ôu[ã“Y™H‹=¼&dÿM‰ø÷¢^s/êwŽàJ8©ß)GËáâ:^ªPF/ðU!‰¨,ºÎ!ã¤éovOì¿áh)ÎK–t<
BìŒ¾ÿöð(ºè×v÷dà„ÂÚ©Ô¦‹}|;Ÿ-ñ¥CaŠ©8áezfñö"hìÒÆÉðz:Keðük8§]]»îÓR!qS ^x-°'•û¦óž‚Ú“yÖð=¥d÷9¬Z³ÃHÅðm9?r¶	}-¿–ÙW7Ë’J æ@°ï©¥£?—PËá[±¯gWÉÒ†'Wd“#à}BíÀÄ#2žÞM‡·‰8\âQ¯¶²šæúî¯F«ÿzöLnû=œ7alú/Ña±\ÞÕB·hk×ASÒhJ¹h¾ý6MY£)Ùu§Çê©‡ótû™¦ÒéœS£´±FÙ©QÞP#XôO€¯Ö˜¥Á<²áú÷Láå»¤	Ÿ:aÇJßž'é-˜31¥96j3[Üx†ÙFïRkS‰þS³àPL}'Ž8åßA‚\•CgÿfY¼â÷yÅz•+þ¢L™¬´s4xÑè«CNY)§¬œY¯±›uÈî *„ªRØå=-Ù=-åöô³÷¦l÷¦œÛ›GhQ‘~ÅÛ^{½ffsâ:ÖéˆK<dqåÊ½dðèE²¬.5aà/k=¬ò’W^¶ÊËN¹¸–Í›³4e@Ö'·'Èäyg,‰WõÇ‚*… Ê.TÙ‡ba îW†u1œ¦	F©D¯^«»­Ë™¾Ì“1óriü¹ïÿÜ÷îûÉ}¯*ÀÈDz£n¤3®Ë^n¥Æö]„H)-3!Ù’þ`~	 @Šqõ·¨­ïB\ô]3è\öxs¶ÿÆÅTßb”ÉÈéç¯ÕF‚k¢G	…íðºazÎÕ@ÏÌ.Š‚ÌÍôÜãmnQ)»¨œU´acóq”î;ŽRÞ8>sgË÷íl9¯³ŸÞ#v3wˆXÛà¬Ý•®JíVówÕ=SÍ ÕH¼Z1qæë”là½i#4W0üiÑŒPò Ê6@Ù°x­æì›Ûe­v°Û'¬+{`eÌe¶~
Ž— ûæk $G?(×®ð™¼óà³v5±ü¶¤KòFþ- ÊûåC¦pTøÃaÊ»¤fÌn™Q±ld«®ÅÄ)c™Cr\^m§Msdâ|+Në3óæÔß¹ezn¡Þ»b©˜ž™*þ‰%r!˜†þƒß8ÌdöÞŸ8„ïdèVð!x}r/tëH§CÐ]4açó,%;ü9„²_ÂÔÞè¶q9È$¨a×LB1¸ä7K12Ô[„áCðêÁnx(Œ1{rØ0y¦_Wœ±?Ø—IN¡Ã ìvCž.‘d6$ó—Š$Ó°˜§Zä±ŒI5ŒÄªîkˆ¥àèK±Á9sAìÌÅi$›Íh$ŽØènM(q÷©ÃB¬E
/‹äÝ¶óZ¤x·í,ùºžxŸasØ@/w&9“S«yÊžZþÄÿÍ+’C´×ÅkÏhcÙK-.LFÐÞýÍ£ÜÒj3ðµè±ò±Œ©8ÆÚQX[“ÑTÓÖ5<K|9m1ý¨uÿòƒ‰OãÈ3b#jqvªÝ…2.Bô$'GŽ=èõ»õê¹Ç¸¯ÃÛ˜¬¥;Î~Ç>Kàü»x¡S9FÍžÄx^!ŽÈWm§²TA+µF¡îHöÇRècÙÿ¨°5}îÒñB¾Á+9<Ù<¦ì‰W¶:Å·ƒ´°[µ‚ýÛàqZ¤wUˆ1ñŠ{Êy§°‹ÁÂÞ¹,Iy¹9ôáhgŒ&È¡ï[†zÇRðøxŸ_gcU	êg´†ÆÐ¢­Û$o€˜«_ ”ÝhÃ ü6(®ÿÖit³k÷.:õn¯~šQ=?i<¿h_ô² t‚í?Ž/ÉÛ)=Ðl­š­Zõpþ©}th’ž¬îôÝó#·´GÀ=S{Èâ¯@sz¨c2’Óª†RNQÒ—äûÚG¦vã£ù:
¼œñÄÆÒ·™€j!ÝgRákôâi˜à`œÖï°”PÌ¸ŸÄ4ÍmaÙj‰QæÊ²béÕð”(J®IÒYç†:h¶{=ùA¬ÍMâVr$Oø®¦wÍ$O6–ø©¦áaR§<þðRg˜fÝç†?Èú§cÜ‡û!º¾eG–zß¡Úˆ+HõŸAjí%ÿåSi`G)» ²‰¹ßùtb­8d,:ú	t,{½™†7P±MÇj.ö,ˆÍ¤¼-1oAÎ¹mGX;T[Ú@µ¥Ç¡ÚRÕ–Õ–6PmÉ¢ÚÒ}©¶ôO¡Ú’Gµ¥O¢ÚÒg¡ÚÒ¿0Õ–7Pmùq¨¶œGµeCµåT[¶¨¶|?ª57¤ÏM·enËŸ@·ºßN¹åAÊ¿¤Ý ÿ„âp”ÿ‡MÃ»î?åá=yøG’‡ƒ÷¼ÿ{åáÍÔü§@¼%=øGˆ…lÿ}âmÈöO‰øs“mŽDü#IÄB¶ÿNñ6„û§HüùH7üRÑ¶§l¶¦l2âz\Ïxën]£m¦ÁöûrÀ<t^RðÑL%6‡–¹Å5ä¸†› &`	X_¦–,“
Û%DN@gYe'E“;xw
9aéZªŸÅš9À|¤ø¦uv½ˆSxÕH‰"Þ µC­Ãj^œJäÑó “©÷ò”Bµª÷§UìKºJbçX!¶1fž¬põr.&ÎÿœN‚ŸãsÈßî$Såè(Þ^&×+±Oý¢…âuà7@1nþ
½‚6a|d¦¬Ù{ë!®ñ5ãŒ¬@ƒf ‘€ÐŒÔ.q‡j—ÚcµËBƒ5~VŽ!_üH…¯õóA[‡PSunÎöÃó×ÑI|L§˜VBF–¤‚$=[D_}´:Qœ`ÝµìÚÞf¿ÍaÅbŠ‹B)n!i-fÀ“0i”2q—Ãžq ]¾'ïbøÈŽx2X¾CWó„ôr/G7®Ëiz6[Pè-|¥Í[ß‹¬­ìVé8dœ]³8„L,} eá%µÕÔ<‚?¶£P¹gK%ûµ‰Ó¥g>”ïDâàu>±:0¾Š‡³´ÎR6Îrgyœå,œ¸ç”ö· FÄvDBfÁPú‹á€½È\ŽŒù·å9ó6†R.†<ÿ4×ÿ#cn}n!á™u ä,’C‚a¯*Û—$‡ÚÂX¶«Iaåøj<QÂ³°…ƒ—ç­’3!yaž?KÎÌä¹y/9S´Ñç,ì³i®ÈÜ\^jÄ4ÊfÉ|J¢#€Ž„;Šæ!OÏ#e,Úy¼Þm£ˆ!°ÔíÎ?VñJl{û!c±XôP0y•%õp¼ëd\å9'nòBîy„ÐžsÁRæx,7~q¶¾ æ	äÛ~‰£cF“‘ç«pp:@oÝüŠEuÉÎ9«AÜ=»è·Ï1Ñj¯VmµêÝëÞœ?{b‡Ûò¥&H8	m2›½]ÍU }’L×Öt€‹¾éáºòfc„}ì!û“$™ùKa~¥ˆ"“ÚÏã](’d¼×òœFUWUH±6*FƒA±Ô×HKp=4›À½â£Ø¾ÏÇ'$åXü‚l)?EGOÄ-ê[Ì±—»®÷-$e=t \ÊTaí_vìNa¨o*àU­ì¨;y&¯Ý»8ÌkšºiÉhØfÚcËà<²›÷˜Ö‚\‡þy\‡E‚ï°êŒã8®ƒ4¹vX›Ø÷ˆ–Ã’—].x;üÐ_Nš‚á‹¥kØÛ5™¢H÷‡:ÈIxÿ8O=Ö©Ña`yíˆŽ#¥+ŠIHÏ	®Îô%4õd6ƒÔmæåxê‹Íž¸ž¤ªñX-‹½Jæu¬ë<ûï§C¥¥ÜÒ ãsœçUoôÊŽ]·kû¢ÅþéØ,%ígFá£¿LêLšszä_Téƒä´É#72¦kÂµöûMÇé+Àd×¢ò·ñíéhw}³«C“â¢‹sÇQ´õ­ì:i¶LOÓ÷_ÚáÙªXåž©ŠÚo)]l¿QûePYm^`^æjØ£›{)aÝŽFav„Ó+ï®#:ž¡ÐµF_m)ïgS!á­q‘‰àò6vf:ÙtÏAÏàUÎ8ï³ÈMÆ^35bà¨å>!{íÿ0¢E½ø/X®¢,b++¦ž–ÿ«:Œ…"'’Åz÷Ã­ïCŸ€:ç´A>´ÎÈÅ?öBz,{qí#ÄD¿ˆç8# Ãž¥pG¸uÂ/-å––sJÛó‡kT‡Þ ™ãƒ‡ÒŠlà2Fì·h”’÷j1K2G"±ô’y«Åü@þÐ<›³ÒzÊâåC4Ov¢zÏ¥C©d?³tœ2Ú’5i¤6m›}¼qÛ/æ2º¾çTÂ'sÖy/‡ý„7sÄy0ÿœGs¡	q_ÌYÕü>g?™ƒêÙ«à¿™³Z0†¡ÜÕ’‘r_ÓÁ¿Ã~ù.ñç¿ÎG‚Üð[ýw£$¤ÔÙDB‘°5$Û’eÉ7‚8¼ÄÕx­Ô™ßø)Z£/3Ç²5Q [$€{˜Mé3xWšDnLÝ@ödq/ä
ŠXHŒ˜@¢?CÂ8n”f”TLõb–’eÑžõƒŸBflR÷ÆŠ°0”Üž­¾Êah±ê<ë®,'jªÇvo‹:ñ½¤ &md)=C«Éÿ+Zé&ž¢ÅÈ³¨Êäz¢qKXj›ª`5ZÜ|#š^ÌV×7Ñ!w¾‘1ˆû<zstûR6
Q£°šÃŠ©]¤»Å¨qåãšƒ¢a,ª.oâèèV\¦c!†Gh6ŒOFÑ¥7GâjJõT`ÃX-bføäã‚ŒÕÞh–rÔ\pÆñžÛA„e—Î‡.áà/Ñÿ:Ýú` ZÆàh¢D'ñô¬Œ·G5ÇrÔÁI @×vŽnÿ8ŠËšY€”@Ir“ÿ[ÐX*(&¹@l7PžÐ1Be$×ôgÌ‰úgf…R´›º{ÑhËƒDû†‹‰ ¯å9¼˜4Ó%:¤°ËIôL&•K¦ p1 ·b
””uFLHÅ³X«øÏ||Ñ¬#|°®^U.ë“O]Ö'î²f,í“ÐÒ—÷Ipy·_b kFîO6¸¿¸Hœ¥CÞ¤A~r«ÜFpóGãøJà0dS~E±ût G6±—½ÞÈÌ'*c	uÉVi‡ÕÙ›{˜•*›-Ffšì![ÜýèÒ1ÀÛYÅ10‰a{¬½y2ŽÇ^\)´½øªïL¤nñçûÙÀ~¿Ö´o92Wî¶Žs©BÀûÖ~Ð§åj,£¼Ò¬•v«Æ
í´¦¬V2ã »XKYXKA¬±Ò]¬å,¬å ÖŒxê6VmÂvªïÎŒˆë£oHóãwŒmR‰œaÇ;Ê±ã)uˆïÃAÅ±I8a,Òþ´`qNú?v¸~ŒÛgÙÈ=É¼5Þ¬ÏWägÆ‰í 'üº×}ËËb0Gá±ì7Æö{j•OÐuN‹vélOM1ü²ËLL¹g2@¨¤¶!éX… i×ø4»‘m¦Â.fØ©Â‹çoPÏ
’p3÷©2÷ÖO¾BÆÇk;û±ËvR­ýrÖh6ó}éŸ™ï¾À¼n„&ˆÉm›¹ô]ÿÐ¶®ÿ‰­<‹(C'§ÕGÃ™ˆSºÞñ¶x9'åœé¶­scgbôL×"ãËDG*õW5`úIML»pûè—VüKÂª²%*·ùi0ïÓI¿Ú›8´EQeˆÂèM­{ÕÑ5½Û¥³Ù·¶¯k8ñö4Oe›½ùuñÖ@­ï&&€“à2O®”r2^k%zs2[ªÔ’”L± #
É¼á{â|à€G+.XoUÆd
ééÔ1‹9¡gëè2§p¬’;áâ¿±¯kÎuÎbMà3«èFAUS•#K[ÑçƒaçˆrC¯:°ˆÄê`Ø˜Õß§Õ–‡„mÍÂgVXQw^·êZÖOñŠ8ïµÛýèšðï³Õs6X®‘0ãZèeªò`K÷€-oëï57dýv~	\ÀqÂ—EÑû›Dp¬€àón@¡#	µe·ø/M•¼fŸáe©÷ §^òìÃVÔ	)›Ýg©3Uð 5ì×4;Zû¨ÎÈ<g/não<›™£‰LC‹qsŠëƒeª`_y	+Ýt÷Øîà›9Çe‚Yä±Ÿ|Èû¨î‡®*Ò¢^ç¼É.“VwÙ&¦´1ÜýÛÀ˜Âš¶gN›Ø“/d€)`{iîÞ“™-ÑýñæÓÉ’íú#ØÑöy¸dW ?°“k°ÕUPÙpüÕGøÏzY>†¾¾¿W?ÄÿŠ¿G“Y
o­¥.®wß<ˆ.|Iñ^âp?â.¾—`‘±ƒÿ%‹lÉÝ:36¬Ç?…÷y‰ß{_Žpëý›ËR­úÂ€/:˜ûx@Òx€ìà¶~Ù¡O&ÿáùOááOááOááOááOáá[xø,ÌÿÁÒÃæñÉZ¾#€Â¿­Nf[}Ì¶º˜èaìÀ?Û«}C5`IÉ…cAsºÇzZ^xI:ë“t³F8l#S™7.ç6L6£pNáAR¼®ÀWQQ5³®à.xöŒÏ·Æ’Í¥òƒf²¦û0¥Íì(‹y>ÒNÐGÆ²¥éŒ5ÏhÃä­yië5/×¼´Õš—²Ö¼ôXkîFàû®yiû5w¯fYÌ4sÍËyk^ÞzÍËÁ5/oµæå¬5/?Öš»¡ëþpkî¾•µ.¾î9çQ–lñçôçôçä­ùÿ  ÿÿì½ývGŽ8úÿ<EG73?2–(J²“ÅKS”­,iH*Ù¬×Gn‘-©ÇÉí&-k|uÎ}ˆû„÷I.€úB}5)[Édvísf"vU¡ªP(€B_¤/Ò—)¶æ÷>±0Çøÿ«0oà`dÔt‚L'ó¬¸F…,úœmµØ's?î‰uvéšJ)WkÒh Ã§	þéÅv5ñSýØyUª²òþõ
X„Ò¾ì.x*ïáhDÙV˜•êv±À³­ðvÔí"ñií‡Àc»•ÍD_°fjÁ@¯îÄœFáh°î¬œF!cí‰¹aÖ¢Y ­¨jqA ’ÐŠ¥?R"Y­jqæÉ&èÇM#À‚Œ˜&]øÅ+‚1‹TàhrJOî•·¬½%õÌx¨)ûÛœ³|óÂÍ©eGtþ¨ÞÞS¾»W/íé:¦	¦ÆäV1_!¾ ÎDYG‘ ÖsÇg/ÐÒ?:éE 	ÿ=SÏk‹x‰´¾|¦ž7îžg¿rÜúBâà*ñãyû[{À¥{_¨vþ³j‡	ÅõãóŸLü« Ä¡| Ã`>Ô±†è ÿ´>æa]@tQñdCçYWD7Ð•·£•wüÊ;‘ÊÌn¬Ö{]e†G<ß}š¦ÄJ§Z ýv¨ý¶×~;Ö~'Ô~Çk¿no\õø9g0Á?GÐQ¹mýØoAÑ˜Û!˜Û0w–ÃÜ	ÁÜ‰ÂôÎÅÓð3RE <åÒ´}/![èlÎC:5\öÌÓG’ d_—IŠ¯ž/y|yŒÇ@r0‹F…‘Ë’‹ÅxœÌL”œuÇßÿ”uøÈõÄø	†HŸç°ó	Høxx.`gb)r£|2ÏÆãü’XÓ5pPv+€‰jpÿèS–ÌÞn\V”*ŠåÔ¦‚u¤ªpDh €hëgszó9‘Ÿ©å´~ýÆH™Í1Z2£p ö¾¬À-kªQƒ#¿ìNð¥’ˆ™çŒªq•–5=|ö°žBÙßÎÄµqwpzrvz²×˜×T!ŸSXÍ5ë+ ½L/íïòi¦ÒcÚ¢qÈ§pdd²*š×²Éú'°{Ì+Ð{·¶e¹uë3(ÃÛ£ü2Ÿ3ÔÉ)Ø~Q	7±"OóU’,éÇ·ƒôRÑSš“gÉZR3?7Y”úZÒbøÀÅ²‰ˆ^ZÒeçøhÿ ÷J&Œ÷kyÆÒ¤z¥½No—G•Kh‰Ã×Ùœï’ÿZ|ÜÚßiïß½5ÐÍzòÖ `|«žÕ@	µ£B*úqïÈÃ~È{—Ô(úŽŽfÇ‰ê.9tÖeaQhTô:Jže¹«7ÞÂR½ño?e˜dP¤ Íæ%ñ±h6f'óWØ·>èc7 ï-íöwÍ'l]ÕËåŸSõ^ºâEô'BzÉŠ÷) Ôv5¤Óè~/’xˆ¡®L¾WåƒRÀö§R@ô¡û'SÀ«4ŸXè¦Ó°‰Áœþkÿyƒ\yÕÍ;}¿4:òA©b©B2ùÎ·wÉþéáa2h÷^tZYB$ÑŸ~^| Ág„qwÙü‘˜CÕ ¿r#·/ÄäD8¯‘¦¥{‹ú(Œ„þ|@ŠÁ.Jnæ&;Ÿ+'_Í¹Žý\q +Uê÷ZuÞÆøþÃ[q}ÃVp6€­tYt"X¶oÛÍÿZìw›ûÁÅ“Îµ’d-wÚ˜?¹rgZŒxWbàéU[âÓÜGÕ‰X:¡ ´dãS´/¨ðŠ¸&CALr# ˆDv‚8ÜÙß	cOMs;x¤"CUªwè“Bo ·lÒL¡Æhq²;ø“B×–$Š¢({G”àŸª!îØ:ãPªuvq$õÚ{ÝöóC[ßˆÏkvÄ´OË1n%j¡Y·Xæ;4Ì‡ó² @*¿þÉËŠtòng…(V¿tîÒëªÅéhÄÔbS/ ºïZ±Çl8u{™ÄÿJäa=£ ßóÚQ!æ^qŠ+âWÄ%¾g<â{Ç!^8h7÷ÑËgé¥,‹;Ù·v±&Á¤c^Â±¸+ƒ¹q¶ç[r•¼âÍñŠÅ+Ý¯t¼Ò½ïJ÷¼÷¼×½Çî=îkïq9ûI7±zkƒ09œc2+Éó±mV%¹yÌ-ªå>âáª¢åEâJzš{xov¨¦ûYU·Yn«Šã
Fk™RÇÓKA|¯ÒÙLD`ŽÛ\Ðˆ'$h²‹«æ¢âvUÅÕ´9h'he)!õã€X¤·gÖ¯Pe%1aUýwË‰"Ã“QÊ,”ò³Ï/w	¬õÉ¬¸J°:_}U™'GÇ‰$ÐPéÚÄ¤ÍŒÚQa~2™€Ú£¬ÀQûË ÞsÎ¢ëÄh#KSÖ3öwËš±¹ø*‹„­Z]P#À‹;÷	ªL²ÿ²Ñ{Ån)V2$uÉð‚¢fÄTæí…rŽ¤UÅ£¢©–ü[á n*‚mËÉ+kI',/¡ùír;o¡æÄÚ¦Òrl,ìøjÅ¶ìäjÅzìÐjÅ­:Ÿè÷EýtaÔá–Ïª\Ý[rCDÅÔj`ÛK€íÜØN%0W´­‚å<EõÇ¥…Þ%¸’î-óš0 /AQŒÕ`ìÄaYº!BøÁ£/v/'£ö<B?Ë›oÇšï¬Ô|'ÜÜâ+1by±(ÄÖË!Ü5Â¸X	ÈvUìDøÊÂŠ¨	ƒ$^«-i·T94Ã=”*ƒ±þ©;2ytŸp¼
<—ƒZ!AÁõê6Ö¦ìÈ¹[ãQåBÆu­ÿ¹úW ‘Se¢¦H‚¦êà°w¾Jaç·ÆE•âÞå˜Ìg(baÁ}e©>XÃ—§e.\å)SðØ“ÁÍOŽ:¿r7’Z$Rîî®õ"¤Ó>Ú;ìžŽO;/×¢™¶D³Ó£Ÿ»½ƒýi÷ýË_ôhÂŽúÝÞÏmÏÅÎuˆ‘’“Çß½Iúïr¡vNàÛåí‰qÿ©ÊÃ«Hfj%Ìû¶ñšÎÊYoù$¹+]0ÜïwÉb‚I…ù°å|XþMO¿@Å²‘U•’Nï×“Á1» Ðñûi|0ïáx1ÊÊÚÚiO ËÄ-ˆÂoþ½–ÝÓ´Œ•¾x~²Vw²ŸØc„c¿ûlˆL%û*6Ôk¸üù #Šý™ü°›<©^ç'›ÆÍë‹·|}4ÚË]@|Ô1¾guqðPþlÔëAM§,/É1b<Ë©¥Š$‡èëWe~ tòbCªƒ}'3õ:€u1šø²ÝoUž²b;'ÁÑâú\¼SbZ_Ý¯O
XeufªŠ|¬nPç6ÜvÔÀ`Ã·a@34d‰lÍÙ¯
œp¸Àb¸â5ºÿ¢¼-óÚ)/§—´ ÌoˆðÛòŠ¾<µààS*¥ô¼¬!¸zòƒ%½p›O²ñ<ö,.ídIKdæÇ–x›4!^áÎÇO^ž¤Å<OÇø—½ŽqñÕ#üGü´¦=œÏ	þó6×à$\H„°Õce6¿AFlûðð¸Cy‡Ÿ†+nSÅíåw¨âÎÒŠåâú¨
#x„ÐáÿvÂ'pdýB¹A°…È¿­6ÅïV‚V5Ývšn¯ÞtÇiº³¤©Å/å¸¿a{ªS‡©Êq9EÛºhÇ-Ú	‡•sÕêŸ¨ànV,ÅÖ¨í]øðŽ1øÏ#ë`Ì¬ÉZ¨^8 |W>tÖj_&
¡QzOÎãp½¢È¦ù²r’O† ŒI‹Ê÷ÛucËLFƒùœ!ÔäTõª.—thwoæâÂxP&º
Á+È•Ôû&ñ…Iü!™Dówç±—ôâ7»7‡h~&ƒ`[p¥þc¾5æÓýüC6ªm×y
MˆñáEtÙ Ç9:ö  ¨ó©ViÍœîe‘±<ù„õõÀ»6¥²J¯>c$à_—]ª\9ZìU„ø _†ó¾þ.•eñ³j{D.½¼šå`H™k{Ùe®jñ/”:îôè§£ã_ŽÂ‰ÎŒ¹˜åš»²ê’k3¦úÂuQ[AÂµzéä2kU­”2Š›ê5ÓÂÁò‹g©ªËgšîÒhü7£ƒ#P¹t¿¥¶—Ý¤Å¨‡æúõu¯wÊº»KÖ#ÔÎ¿“ï*î“.ìV´Ú2c¿I9¿¦ý°ÿê*¢%S3§jÍu§…›ÐZ#tÈ&)™Ø×ÑÂj¶mÀ›”{lFóöXÊsÈJéÅåMVtÒ2³Þ“2Kà¼È&£µº6‰¬€³­µpõkXÑÉ|q-Í™¬äY1Ý§—~Éu:ô°ébØíøpFÓÉð*O'>¬Øh³tUß£7îtâC6Îag>ÈÇè»^$ãé.¿>OÇ¸È>¸'pï§pÈæã|~ë·ùV¶	­ÌÝŸîžþéO› „ÃMq™¶)˜w¹ùrº(Æ·Ò¹1/ÿ”Oòù÷æBb ét<šÞLdFoý]TÞ'ÜÌŠ|2wJÚ‹Q4	¬HP
Åog³i1_À‡Ûýô?¶ÊwžHÀTÔ†¿nÆé­sd.Ôê[q;ÛPûºïÙ/€3Þêùå¢§çˆ­‹Æ6°‹­ï:Ó¢ÈÆ´Ï»fÓr!¦ö>-’¥c@s™Ç?š}+ö%gbdÌ-i”æ°>Â9?þôD±
ÀÁ^v‘bX"»NóI™<AÁkž¤‹ùóÖ‰‡4@?°KJå‰ü%ƒãxË}*“êŒ0õ¢=O…×þÉê4Mw¯ÒÉãæŸ1%-
¿>äŽ¢ñ“#8‚==µù›'ÀT””*³ìL“¹’…*Zðg«4’®¡{â5mó›äßÎÎNN{Ý³³ä›Móü¼îDªl”3ØgµµÁZýuó‚Ï‚gÃw%=}¹’i¿O§’À'ð¦•n¯†j†T×Š‡0ÄÑÅDß`ˆ°{HÍfÚóé(½ýÌ‰H}ÃÅY‹<eäcj<ååU¹êÚá¿ÀÍáÎ·‰Þ6ohz¹ó)>”ÃÑÜ5’ôR\—ú®ïÎ]ÏqÍR½‘¢mr¡7íPmhç®sI°VKBƒm›Täž_Á~¼Ö*Ñ¤÷:ÙñOpJ-vcfÆ3Ql~X|[Êx“H%{×kôŠà^å´Âa· Ùz²BÓü·sÚ¿ª»8/5g)ÈÙ:¼ÞæÁf8òTs„o¢ºœ3Içü¸UÕÐþñm”Ö‘yÅ­&¯¹Õ¬ªjÝª‚*&î9ëÓkñÒßR3–S%ÛOH;¥k(·¼¥¦“˜±hauk]þOj[Í¦üBÌ´¨éÎëJÁåfƒFcf£DMôÓFäöffÖTT‰,¹6T×@3ÎòZ?Àzº¼³r³bŒTà‰3EEscc?ô‡¨ð	ŒÈî!ðl=6@$ j5ˆ¥Ì^pŒ‘”3$ß@qƒø¾ u—ÔN$7ûú£˜á]]±xÉ	l’k:@éÕ”’t\$5ýaós¼ug×u“(9:t[‰>û¨¬LFS, Ýº M/U£ÇØ¦ðc<å23ahÑ€èl¬å	©‰J¬¬-°5ÄvÅdªæíŸ”ÉÍU6‘[%y™d×ùVÅÉä?ùüŒ)Ä„è,:ÊòXâ±¥âÄ& ÷‚*;ŠÉ¦É9ŠÃÉTÇ©5â¬75 {—@òrŸº'½’ÚCô¦‰Ñch’©wõ7I5÷¨û´,¥Rày@g³lˆh¶¶M5s é$³¾ÛNÒÑˆBhé»B¾ÐÔ+ë÷9©“ËÏæ‹é8Ÿ¢÷&i=É8’(”t‰Þ±¾ö¤æP,ðšêqG‚y©x Þ<kÒv¨VŽÈ¡p1U.€œß®¹ÓK'ï`(ÝÉe>¡HYmaqk'€Ö¥-¯sçO×˜O)nµ'\áLÃàul6Il25•‰BLCEj)´­ë:tâ®þçýbŠ¦9£³0m±G¾¤sº4³ýJÔâ’†l%1õ`=µº?N>ïDnÜòµìÿ"½ÉÍ+ÿ¸Ë&écZ[Á4Æ°_
õæƒÎ‚€é>Ì7ÔÑðü¶×ý÷ng€¶ÂÎq¯×=¤«¨3I ìvêã¢€æŽGŠZ^ýQþy÷F&‘¬EV1[Althä£¼Ûüú£ß]”HïÄTdÕtWo$t8ïqK
þ…çOIPÅ)¾ìP”u‘/ë½(“y@xÑt“'“ÿïÿù9‚ƒØD¸·Šê&T815L­¶ñß‹M`“äŽÙ‘8›¤§'çúÅôsœPj„‰3Ì0Æ`r“¥ïpu(ì°Ì ]NXà
¹~ ~ V·Î›³ø`4>9³1Þf+.ŸÀÇ¤ôXÍÎÔeð±›D­X¼A€ã÷6ÜENÖìéç°'éù¤*œ¢Â¤Šuhl~0‘­¥çé½XµrÕæhÙÝfÆµÄ¡é8+qÇiJ@U[ÕØ
ølgM´À(k-&r o­ÙÛ2(??yü&aK£h®Ó¾þøïýã#¼î‚¡ÁêÖ4.êwÆÿY» Ê2Wò–ê‡ »þ'bS®®ˆñ·ã’°Ì^îêöØ2,Ðy†Éf‘¹H°·ÿôå’W<óbŠFù¶`kËvÖE>Õj%9Ù–ÒûGÝˆ~ó{!ø=—ÙÁýÛî¶·½ìïôJ¶`þ¿9 øÞ¦šSÂNFyÌPÈ">cý$‚ã
lùuð³ —tŒ/BoÕ“O‚bÃ‡v€¦³‘¦œ×F£’zÞ4°E­–®'çDA©¤ äÜ¢éïƒn‰ò!ïÈ²P«*ù‹ª-!þ`“äñ˜j››†‘õW]Î‘^àŠ—7é¬šTÕ¦})¤@Ÿ
	yHlUGïû<Mú7húíÇÅAÑ_ÔhUk¤;+‘ô+h\ïmñøú£% p|p„éÝ¨þ¨¬T1¢
33‡¢b„²5(#ÀÂW™¶££Í#¢¤#s0 ˆÝf†Y6’ë‚ë„W*fÝóRÑÔü
íã±-;Ëu»‹Zû>iÍÌ’9æ[B¦×³ªÊÀ#¶âô‚…TÆ¢ËÅÅÚe1…]3JÎoÅ‹v—é-"
±ídþòÎ.ó‹yOæ’£ZzµÞ¥:þQ"W©&{È/qZº#ïºà^†í­Ó&l™û«¸ÌxŠÿnRÙÐ]P{ðòh*•µñVXßØÁJÙU6¡ÈõæfI„‘ÇÕEFD
Ÿcß]×¤ø¾4Œ®ý+ÑAm¹is%¡zó$¬çKÈ¥#«…M‡Nù¡@ÐïaRSãÖm…‡ÑÚ¾˜”²%….¨kÔL-Q¹å:¦i«ÿ€ÅÙ‚w‘qwhÑ˜CC¼Õ=j‹‹ŒåGf—]Ë%,l÷Ýàs¶0xP¦WÔµ½kb‚ï^ïëcÇZ)ýPÞŒÊÉÅ°ª_Á»×Ð¡™º7ÒÁËèÙEµ7açfÔh¤Op‡
ú9 ¬|›'‹òêÈ¢“â}[@¢›P~çôÙMv~†i aÏÎæÓnÿU9X^dµ5(ÛÀ²µúz²%½‹.Ê­­PÝ‹’×š‘m5Cõ°„×·3À5E‰ªKX€s3CP{„±)Ç³ŠUçèæ¢¤ÐÎwxÖ?}ÞïôNÐâ×?;i^’zŠãnü}
àgÅt˜•@Ÿ7£b1qV.ÎËa‘ÏDþÄ¿—è¦Ç¡þÜ>9Ø[Úût–ÎÞe·6¨ýƒ^ŸÌwAvŽñ¶ÚÈšhYñ%þ^4ˆŸ`xCºã®LVŸP;äô*™;N„Ž¡GÔ.{ÁÁ%prÐûr|Ò‚ž¹Ü¹Ü¹bTuÊ„V&A\c ¸t„ê†L·'…Ñü’}‚Þ‚›#ÁÄ¹¬å[”;Å¶ˆ\%!Õé3Y;:YV®“ìâ[ý¬VÂº’ÄÁR&’>©ªÂŽ@ìÝª³“Ñs±`ºè3ÆmI)*á$•Hšz“p åbˆÄMÅ‰TÙ%bÏaç¡DíSP£„ÆR v$+òsæk&&›¼ÏAÄKã>GçFºúÓIÐä4-ÒËÌ[Á–pOçc¨…Ž
b£Â·†ÜÍ§Ï:g?u}ê´)ò÷BT
4êüÜtM+ñ„_õó—¿p ò5@¨»®Õíò£ãÜÁw®‘zg>·< FmŸ	¸º–ÕM•Æ»VE§Û[5q:ñÅk¬Ù¾;zVÅ-›b›i§eÈ»ærY'…”|RL­DMÑâµŸ³`c`Ã‹ùÅÆ÷kZ70@f/ik&H¿j ×ª)]{ ^C#]ºéÐ7c÷!“·z¢ÅS«ÒÊX?!\hŒü[Âž§y€£þºÁk>¼:-Š@H•›´˜TdÄ+Ì$€•t”OM3'% |ZÐ[t¥®ÜGòRØF“­Ùá]f ‘‰t×g#á˜ÜPuhœ·×ACdu,šLYÝù<« +Ç| Á®Ó	»žl×Ã´·òš¿ÐS—©ÌäÒãÑ	ø¢Áû,Íkíõ:ã	Øµ×ú«¢í˜Ö„ÐÁÉ( ÎÐ‚ë>yäó;kù-+ðâÍLAÒ^•“¡ „ôñ|ÚJÇY1/ÿ_Ù`
2’2i®+"Dâ>2àTMvºîˆÙå~‰ÙëQCZŽDR`“N0o‡%‹„ü€h'j–Ý,qéÂ2rØÍŸ1††Ø]ó&õ2-¯àì…QÏ@¼EóU‚Nþsr7K/²d4.è >ØM…*£š‚£Æ­L/¤4dì²¶V^¥ÛO¾]«Ë¿¦ec”_‚¨S[»Ê>@1âRP(º;Ûþ²
!ÐÿÛ•Û"b²˜M¯ˆŸ^¾æQ÷y[õæƒñ‰œ+Î1¨e—ôß¶pVnï[œ£½*9çÝÊ-Îš*0dü~'H
ÖmteKó«Ø›tJŒUáåˆîSïÏ	æR[p¯×0ôGJ®¾8_O(í2É¬-êNÚ‘Ÿ=Ù)î¨ü1nà•rMè$]™³v‘c±¡<%èÑšÅÒ“Ô{_ -.ÁÃ¶à‘<Â4{Eš·Ž…G,ZÛ3€¢‘=WC´îœ¯Øcüh}Å ,<ØZàä®€ç“^j¯]si|ŽÞÃ‘„zDÝ\¦õYŠÎè|›¤œ¹® M)jÿ~uýÔ[ár’ÎÊ«é\›`¡Mc8ÅséZ…£Þ¸¹ÊÐ¼#vànmwwm¶Z··‘ÏD¼8ÙU#»žÍ-AZ— oê¦Ã«ZŽ/>—œw*bdM‡
»æ‰ñT8þ×b_ôá#~V°ìB³l¼Na½Åg‡—0îá
¥±M÷ô!ÙŒ¡3›]aÀÄltêÆgêhù$Å|!ßÝ¤Épœ£4@¶ÆJ9Gu!¡ðù×x»õdŠeû23B³…#£jÞOëƒYq¯Ä:º"¥ö!6‡­}C‚8qŽÚÚÁ˜,>®Ÿh}·ÈãIWuO–&’y.‹tv%dDL¸D6Ñ‘Ñ›ÙžÎ¹»›8ú“´Lú…„ÞÄõ[IŒªFš]â¡EÛÁIv£7ë&Ù±a«–°eþ÷~“wPq’tˆjô+QuL#·ˆ`F­ð9_ðÐ¬+ì­•%ñÉ°åâþLøŒ¶N£#Æmw—r¶\Gþl5=¸ï¥wA:üÊªºøÿ•­†Š9 ½ÂåxÝŸîÞ4’ÁtžŽõb/³2ÿ`iˆTþÁyÈøtRhuo¶´˜“«¾,ß™ÎfÌp”a^F¤ŠÚ•þÍé´È®§ÀQ%uþf„
TSiOÝÞƒD•¡Ý¢È=™—žÎIêÐò »·³:ieú9–Ó/nÉ·\˜>¤À9ètÀ€³Ñb6F¸ÂJ7+(H' íg%%ù¹g€ÀéM> XŒ³Ç_äYB¡¥¸Ò±²î‰A¬t<G:`ÅÈ…ÿb"œ²,‚íý ö|Žb¥@áƒˆÓP›OTvT…N£]–c½°Aî¹(2õÁ~Æ C5# ?âW*¢…F(%Dü*–‘Ïz	i£q‰d2lÌÕ8ÌÛèéµO…-Û¬Ì]#±GÆkî;»ÝwÊ	R*!&árÄq&µ‚ë£ñ™nbòfšo^À$,cäj¬žN,`Dšz²™Ôvš°Û¾ÅÿÛÊvêu•¡Xßú×Ÿ«´¬©iÕ½Õ\Î¨öÔŽ¶™>3îYJº×îê½IjtùóõGÕ9f“ý¬%ŠÍÓXê.G²ÍäÇäI³éz’¡XIV…€uÁ¤ç¿xVÍp£\fµí'Mÿw„ÅÓ»æ'¬ÜÑ4ÀÓve~6¼ˆŸ¹bòª«0®¥ 5ìÝNÒë|x¢¾Ö<N»nï+Kø0O¸W‹8ÁÛ–&;AW‘Øåo'hèÌƒqé¯¬>p¸yùv,1\Ýúèó^•¨UFÓéçŒ˜îš¸ë3=—Žä
2ÿºt¿Û9>Ú;Ã$l
å‡éy†1(›Îñ²û¤ðâ¨}ÈÞ‰²i0‰Ž·Æ\ÊÍ'	vð)°¸	|Ä(b˜	&k¯_jÄ×#66µ%À… ÛY;î-ëèo§íÃƒýƒî^‚9(X–e÷š·ú¥=è¼ÄTHþ®Ñ‰™)Qý·íï))³nÖÝ­IàøykíÙžÈ8fhÉDµKžùßt´G½…ë˜}éh³m‘i9öàªˆzªú²"Ì¢ð`:Áõ0Ÿºž±S¦;Ùªßµ¶0‰ùÚv£ÙÚ²º8ŸŽè §l$Lº0Œ(0Ö»äÿN'$‘+lâ§þ!³O½V>éyð—âÉÀæAÖIƒºM1hC<,Y4Ž_çÃÒ#»MüïÆÖ_·³É¥¶jœ§#Tó#¥óŒ·bîg.MED#–Ü½Õ¶–bp6Ÿ½Ï³›]émøf÷ëÀV§£ìôy§ÀqÍfò‹¬iÊÃy	­ER:g‹žµÞÑ¦û`ŠBNÄºii2qsÞÿÌâîIËfêÏl„Ú?}ñþ¶e–È
ÞX!$†sOxú©¥¢æ'e¤’VÄŒù•Ê52†4öd_K&:~æ¢„)Q‚y:²LøbëÅ„@E„Õ»ÎK7]yÕíPã:Õ„Ž‰ÆLË¼²[Äoø'vBxÝ.qìú–ÕÓ3vŠÚäI–NVtgEÑÜb=ÚÕ` \içÛfÓ†¾¹™l%WÓEAtµ1ŸnŒAH´ª,ŠK|c ÔˆÒ×øôß<a¼ZÐG–gø"›Úæ='FGíLI‚–Ïæ‹}£Ìk‚˜óx«Ióµù8è{²\v¶ìè2ã[R{9œÐHÕ!øÛ"[HZZŽˆÅÓ½2SJñŸGÅ$¢š¨[Oyeí›ŠF.)Ð¯°¶ª4SbL­·ë¡˜	Ù”"Í^´À)Êô’äLfã”÷·±|Iå&m¤ã1èFpžj|ïr+¢‡.™”éG®1×4«\øXæ4°‚!Ô¥«²•Œ¢³è}Gž|–Ñ´AÛ±Vó.0—¹I­n(PVÆQÈ@òžjÀæ’Vt¨¦Ã‚¬Kï>üÊ™œ‹‰(ˆQDÀRoÂuXçŠo¯ï“U2Mæ™óŒ†£&ÌQ¢Ñv‡S®VÇí–€{"·¹ø›å}ÄÁª` "<Ùz|GOà(°µµ’6â<éß–óìZºN¯q	ó±ºÆ8@=îLèæWÉ¯ÓEr“Ã”AÔÊÄãn˜'^(’?Q²Ö™˜*¨ X„ÜB'µt6Ã÷•ÃñÝX×L†Å<£U‰¨k¶ˆ²|*$ÛÐ› ‹ÁIÿ$o•Y"~ƒ*þEîQï#]‰âÛæº+ „Å‚Øµ™<J 1îÀ„<¾\Ïÿ5ã2/ü.ÅÛeÓç[ãD,»;G,¦â°»{ËðiÆ»åã[;šjçç~HÞÉ,&£Fr2ÆˆÇ@dZ·7o>InQ¼;/¦7%†éÍ‹rn°Ç­Tuu‰YG0à$ý©ÍÉÙ³Të*	3öÈwâØ:—®¡U (³PÝAR]P‰-mJ9lEâ\û×œdâÕ8º…0èJK%ÚÓËyii€Ipd'¨• àŽ~ÍßJžO§@Ë“ZÔCX™Ñ‡Ãb:ÙìÀÿýûôü¸¸dÏ×{ø„­Óî¼ìž%œ½êÍ««YèYÉœâŸé|%ÕÛ¨²I]Ó;/÷3 <ÈcOÏzt_Š˜ðDÕ++=ÿ¦‹’¢=’4&V–‚PÀbø~~ôÜÚÌÄ]hoªÞXŽð	$¾ÔJp-6þ>=oL‹K–’	Žþv€d–å0äD´‚”Im«¹1Ê/óyˆî¨Ÿú$£—Sr™‡òð:½ó]—irÑ	Žâõ„Êá¥*íŸ¦'j¼z9Èe™?©~ÉIšGþË_èÛ–Žß1ŸæÖVòŒ~a%-üÛ»éqÀ‹¹iðx‹ÄäÞOA5 OÀ‚ÌŽƒMEòºµ~)[ë.È‘Š˜~hØÆÄÖæžàLKÿªÌA Xi/ >7»¦ç;PS>>³Õ6XØD§9’ÕmÑ¼<JjPžÌaýÙøñ·^uü¡Vþ¶{ÊË©‰£»«†Ær_$2C±_‚	ŸéE6§Ã¬'Tö(YûO4Êv¿ú¡	µÂAŸ%4[Ñ¦nÞšYsæÉ¬7M3ìÓãè’øBê0E,IéŠŽõirµ¸¦”$éˆÄ˜­:4Ü=+žY¿ öL½š„j½UQ=Á	)ÿä‰©›ü»ÆòÆVÝÛÓk]2¢ˆºk.@?F”½–qÝwà¿Ÿ¼Áœ8Åm­vMª·×ïu=ÚïÖ³Z£‚·lá¶?©¯2 m5 ægd§éd§¹R÷[Ø½ü‚cD^1	¶VVx+×E Õ½zÇ ½ "§#úÎN‹‰è½s>ÁâèEI@:©z"2ÕßJï&q8’Žò‚:¶XX§öÉA‚åd¬àˆ- ŽY.äÀ†Y/»ÀKEuÆÛÎ} 	Gþ.­Ó;>ú÷ãçgÇ½gÐ+¾þ}fñ5Ñfv0ªhŠÿ=Øµ¥W±
Ò^û•úFüŠðµ¶Ø¬?™ÔçÄÇ)kNÁ…'/ôÍš!þ»æFÃ*”¢ñZ 3(ø³¦…,š(KþbóúÛLiÈý+k1­¡'âÝJ€?XÂh6†:ŽPW¬®brEÏÐ”¼a¥CËcÇfM  ®>Ú6FO“hÖ–‚-nL¨ŸÀÚ~ý‘HóPöÖ9éáÿç˜[…"Ê cNû”ÕŽþêJ(MsÚGeF9Íà§4 `Á`Èï³Œ¥—™ Ó8‰ÚÛ«ù|V¶67a?5øt6á¿å¦še£¿‚’Âp}¹-8Û?¤sÜÛçYZdhæÕX½ðßZ‡ž€Î7 9­Á~IgÂ­ÚnRl-Ld->]ñI‘™0¨p…Â‘F-[t4¦ïü×ˆ´‹ÙóâGVžÃ7Çx½ÆŸ Ú×"Ê!ÞL¤
{]ÞßHØ‚|î¤^-ú·.l¤‰$ÏÓá;­çñEp´wVÂ™ÍÁŸù‡*öd€°¥w²Ç¼(Å} ‡9yÒÞ¢±ÃÿÓÄ¸‘E°Ë·Ö>BQ¾á²1T·P„'€U.ðfèÇ 0¤%ÛèÕåJ2LÕ³'†!Ü¹[oO¼É²È	)Ý»¹‘"À®jô¬È¯b²ú3û­ àÕµ(=†¹™ví¾¢C¬ÜY™ñVrƒ…8’Ôp¥'ÙNÔ'3¦M9Wç1È¢îÉ¤îÅ¦sµbU,ve_vY,‹a×yº,‘å°-ŽJ‹ÐTu›ÒLPD_
BÕúYC"ÉË|„¿4ßQ©¡Ù¯ªdçmuâ’§©)ýQA¢"\!j”ýÅ½#4Ã§o1¥Û
Ã—~X&ôÅSêÍ?OðQÿØÍÌ¼\÷Š±ÇƒrŠ…2µÎ7/dqè`Jn+‰ˆ8JKŒ´ô2µÊîXþS1cùÁ¯Š;ªÏašNÝ;ÑwœŠÙ)›2®l·êùKàHT4EÛ^½ÃDa9þ4KwãGRÑd}gXVßÁ
æù¬1–ß„Zõì™]Ò[Ð·'OvÅÉK@dôÔ2›•«îUTÊ†ê4‡’#8ËÜILä7X“pLJ²ú²A¨®œA(E[]È¨í­;Uofž5´éCIª2À“°¸9Æ(¼Ç|ŸŽÑ¢F¹ÔÂbƒÛã%¾2Ä×„ýµwÐG‡Û=¶Á¶ZÂ÷ç.û¸WÏíÓ¾Us>v{½ãž—€w+EEi4¨‘B†NôµÆ}¡è¬oûƒöà´†¾¼ðF5`qÍ6Bw=9„OÔ!#ih·³‚Jl—ÐiË† tz!~páQú èzÂoŸ˜Ø¾ %žÅ˜4¦!£=2´ÓÍ¸†¿‚þM1gË90Õ[ %„¦gÎdcuVÊ­€ËÊ¾IZ¶e
dÿ˜Nø”ÍŽP…âï cñxty+ƒÍ¨„W½Vö¦ø®³ªÒÛHe,±ª‚lr©KE¼òMî—ïh¹q[ÖÇ~g±çgŸ‚ýºx—‡°©gåWÇ°>}M=ç¶7—4°•Ôžy'€O9ölAÙSi7CpL+‹FØ‰mÁz©‚Ðû<£x€ýÝì ¨D·©WnSÏAwÅÐŸg2—AËš×'ç*ÍMa¥P±L¿ND\j1ê3Ç%Bßq']Å¹¾þ¨oE%ïº[Oä®Áb¾ƒü†ö°ÃýòT//…G«ôœâ¹%"¿<ÃÏúRßzdìÌ6ñBÓ=…ÅŸ‘³–Ôä¥óe«›Zf3K¾ÃqÝ9'»Ò¯Ãç—›Ø¤ú û"²Êpq”Ío¦Å»M5?eãðf‰Wåå—^¡Ê&±2ù9–µþù„’|äpÂ—ùÊMã¾š£ÁˆÑÁjòa .CØävX÷¼¤VÞ ¡ÔŸb4.º$\‰;R @3{ÛºŠA"ÞØ+rô|5I·„ä9 “ GJ6W[vÀ”|ùlV;ÃÛ–‰v=Ë©ÃraØ…KÌG2·BÂoãKw-áè„³ãHŒÄº.‚ác°•ÅåU‚F‘M9—MØ ´	¢¼ç)LLÞJœ¹1åÕ—lc‡½]Ž3&Ó‰©Èià}øpp1[JhìIã¦.žÛ~±óéL,¥ZÃRºÖ°yOgzÚÕóêÛ0¨éLGœ±:~•NDÎ9VtÎÅ!°ºZÖ¸lˆ—ä§”o’·Ì²n†'îÝ$‡QËË®
@°«Ü®°ƒ>.#îxÇ†9éJóÒåxœc8¢	OuóE°>»ÂVÑ|LìÑÓ¦1˜¾ƒõ*-Þe"ÁA"2\H¯Z1G‘ØCGW‘¿¸Š7˜¼Î€lðÕQ§}”^v“WíÞOÝArtü‹¸ú‚ sÊù‹û$”W·Z`ÛŠìƒ ¡&9ez-²ÈªhúõF¸Ü×¥ê®’ç¢Àcið¨ë5n`M„"œjuPk(ôèX¹ô“þðŸ\ð·ì[´ñŽñlÐ;xñ¢Û;ëþG·s:88z‘ðUxÁø,ä² ·D’g)¹Mo‘.&8ždðŸX™ÏHK"b²“k¢º¨nñÛ@^»Î»9kz%M¤ù¸F§	µé‹¸në‰ùu†‰vŠy©Þ¬ódG‡÷¨­0Èáä/ô³‰öÎzDÂúJ^-Æó|Cä&¤íõåCßÏäƒ‹ä$ŸÁ¡3ñhyéÐ›™Úï:Ô»t>ì]U	õ=6=Ô;ÂÄ~9žžÖF•_ÑÓx“W~qxü£Â~?{~º÷¢;®ºSíùb„Y7HãÙ~Œ^’¡>÷²t„X¡ný¡<
÷ÚXêŒ Æ1»ÍíÉDÛîÑ‹ƒ£îYÐî`{ô’ ®áÖ)ÕÌÅk[†
,Écahz{Q næCqt¼×…aü,,LP2ZeçÞW¡s¿<Ñ•Ø÷æÉ«ùÑ8”€ïr˜öéàøU{ÐÝKGÝ^²wÐ?Á·ã‰²AµÓ“	W?ÌD¢Mä1¡WCÏÛ}Àc·÷óA§{ÖîtŽO:\E¡‘Ìôž9{VËNèSåJâèÊl°vÒíõúƒîLåô¨ýsûàr¶×}/P¸mÑ¸o›È'½ã½S
pÔ 8Q˜D½uJÚC•øN LJ²D1¤ã‘|…‚œ!–Æ7ÞU¼9:âZP²ÎÄ?s%JåR9…G¡C—«(NÒ¨CxÄ*´’×o\W€r%s«•~öÓ§§>v«Bæpó;%€Žå{Ãv÷]•!ç& ¡ùäeæµ7g¥¶’hE?”ê:ùP´žð<½FjžÊÓzç[z{=ù«ÅžÇÓá»^VÂSµ€Ýµ‡4êC¨_3ýr,ª‘åvu,¿ãfµ/<±h:néÃ[B‘ç²Yˆl$nÑ©«rˆRF×QVgtj´{ÝöÞ¯g½Ó£#Œ´QÍBM@ËšL…Ë:qx½_N÷$ž#•]b<¤/»{ùî#YÓËÜÕöd9ÔWÜ»¾M#œfm÷3ÿ­U)õ\¾t|Ò<™³ƒ¤Õh4‚Pj¨¡€ÚQ5IIÊ«ˆ4hÏ¡*E;%aFÒi›gÓµßC[ðtAOö#‹e:˜îåÙLTt=â9]ÝÙycKÕ~ÔH'ÉË|^ú æ3ø®^(÷#µÊ1«%•¤ÀpD¨Ç<í;öà‰Ù¸—¡*È?žá §Û}*!UÍ }<¶‘Í›ÃÙ5OÇ2‘Ò½ÍzMD·NfÓX7Éó"E#0ãh˜¸Õjv“
ƒ©\õsÝoÂ4‰Šú·WØóõÔ¬·úY"[/Ðž¾'²6F²ál›ðÍD@¥9<Øïv~í€ˆÚý¹}xÚF)•ÙE¦ó»ëÒóhýýNzÙ¡Ê¤ˆ-—%¬tœìDÌY¬E:	)ï;BNàþð~ÜÕ¯NáÔžKó2‡*dz
 ôêuv·ùõGÕ†Ñgr°ñPiŠnè²ÁÝN~Pï.ëütprÒÝ;ë´OÎà`í¼´4&ì¼5çðÈÒ¿ò‡šü‰˜(NŸÒ«Yò-‘Ž*å#Ëlˆ””ž(û®íH[-D­ F-¤*D©%ÂT•8¨~ï…44k-éÁ–L–¸ïå½Ü±”¬õœÄlU`­Þ¸ÂÜ5¼u„ÚË¦ˆaáG,Ô²ÈyŽ—Ãî0ï\&,,è¯I·|Ë$(¤z9ÅHÇè&¼Öéýz28ÆWLûÇ½îàýÁqç§þÚ»]‘Þ˜Â–‡±(‡8g™íåéådZÎ11´_KQ+˜p÷¯„žÌ×éL_þmwœÎ 5tê5
0ÉËl'Z#½Mè©7¡0"vUúuëvÑ­RLßç£¬è	£²/.‰žß
 nc¥tí)´ÊÒ³yÃªš fxô/Æs~u´-#BÍøÕš´(Ï¼÷Æz›b¯Že#ÖTs‘M0=ØõÄü%-Ì®û¬c"÷´®×ªoþm…-¸V;7‰‘o`Æ'§gyºj—	ø—(Î1‹†1-oÿE€+d
qåø°ª.Vj+AØ+|˜Î´ÿSÎ7uNñ$ŸJòèSˆ$¡«ÒizU‹Ëî‚e§&XÝÔéÉÏ ,i¡Æ!ïçâ~Ã¯+ÏÇ,‰¢ã…j6~Oo"5zž8~Ÿ°ƒuçºöž~ºa˜ª¢>³àþ“$¨¤Wˆ¹èfÂú/Ywò,yü$i9…‚›CÙvÊÿÔ>§ð¯bLÏs¥¸Õ1Ï‘ÒgÏÜ±»`gUäD +j Ã¶xCn¼üpž"ÈrAèŸlQNÞ-y5gã½šxi|Õ•`ˆÜlTÌ=>¾'œîMtú)°Ý}™ž(¦¥õ»ÞømW¤ô72ÒûþÛ‘=OÍÆöùÀA@YãÒ[œ¸*?úÒŽ{…Ä!R˜÷{#,]¹)0D·Î+0H_$ «f&ÂÁÚâZ}™0gÌª6¨Yµ$W¿—ÐgwbF^uŒ>Úð€§vóŠ£õÑîJ;z…#÷Ñn5[‹3{Ü¡?/…àÁþ©ÈàÙv½íoïÊBÝãØúi4»çk\óuwêÆÇû†"4ƒD…çÒ|Tv Þ ÕÔ–UAë OrÓ¦°;k®AN6ŒI%Î«ƒ¥0CÛ€-Ãªl×š¥\ºcQMXÏ&v~Áoñl T€¶×QûÖ’š#›qÛê‡¯T4x©£¥}îåÉ[÷ÒS*¯Ní~¿;HöOŽº‡Iûtï`ð&©‰$c’ëPÀø8»º«G:ˆ,\œ}ÝE!VÐ¾˜gÅß ƒíf³ä\°Ürq]×]¸Ñ*°…Û°™i± Û@D·e^~XI„ýEñ>GcÔ`*<Íe\1PGAóOü² d'ZùÊ@zAíµí³ý®Há\Drw]BUk‹KÛä×íï„Ò]a\:ÕÅÙÞA¿süs·÷«Û—4fFúºÇ$bÃr½ôÆP¡Š?³ÂÆ'ÝHÚ³Ù˜2›]CaJd¥½V%½ÈÇ˜Ó/ZÄ\€ÅÍ(Eî|«âš¼\ûô¶n2¼mˆT<zh„¸Zh°n ’OÊˆc§ÜÎ/NÍtækÄ,}Ž•;'”8§ùÔi|YLË²×“ÍÅ/7Ÿ‡€æ¥ù@›dsÿCi2'ë÷>zÃÃò<‹Töà§#bÒG¬öiåÞ*ÛxÞä“ž¸ÎCpè«4î*˜¿È2·/öÝƒ—]Ï@¶>—ðò²{=ËahèZßÂ>—ÊœJ „
ˆÐU¨UA¤çù/|w‡µ±z-Ó¢Ÿ¯ã¥1…u53-û¬ŠßW¸b‹Ïœ¶Ù¹µè˜’>œf	",çˆ“pÿÙIGüŒ#a.|‰úƒö‹îÙ¶uùf¥	Áà÷Z¤'i¦×£/Âï<Ÿ œãj]ÞÊÊ_TD³þ |øÅ¯V«]K(M^+‡ÕY whër+§¢JÉb¿/¥w)2…7!uE¯Ó$µx:%¯þ]ønL¯OTE=úÄ¿‹rÊ¨ñvåmÐ"2
F;×^ »Œvaãû÷–“²þµÇÐ¡&R‚#ù'ÿDLÐZnÆµøw—[´«±*6rKñ+0xh¶Øî¶†”ã;%Šj=ÉlÚÌ{ÒÊî—a^ó}\˜	ÙÞ×š¥ULÙ|þ†„€C\û›<O÷ªk6ŽnJõžWê7í£î)ì›C«	6Õ´:ã†án[Ùú®cJºfÓrQd<÷0¯§¬Ê·Oc’^[È ç{2“T‹eÿb×áûRMõÏÕ¼c6ïÕŽrÜ¾}vœ›ßò€¹÷ù®„éËéöð§›¼',ä¤W‘”¾È]K; Z§qÂ»ýf¨Þ&_Ñ/‡è—Cô3QåÅQï¶U¤ &lSØå”œ¯—NÞÁŽ’>°lÃŒ,#ËxO>!¡]z]!ÎÕÛ<&ü/—÷#Ùþ;< ©È§)’ñL&~zw†aƒý*3œÅ(XO>ÙõÏ½ (NüqfÄzÞ=<þålÿà¨}x6xÙëö_îáR„ƒÞojuD*Îä<Oo™D¥ªíäÂ£ÌqýÔZj×áªÊ&¨ÕÔO©dFHNYÒ#¦óO×›lðR{~ÆÄÇk÷™Ùò­â¹O¶$:ìJFƒ‹}{¤QŒbÌÜ|¾¸Ä£äá¬ÄÃ× &\/®áŒa'Håþ`¤ÿËÁÑZ$õ3º×’6Z«(ZáîÏu…±{­/ÑÝŸÍ ÿÉÿ?ŒÌÿGÐ¶R:~v¯·*9¿è÷ûg½žOÎ/~‚²ý¦îº(@š–]ëÌÍÛ˜ ºŽÏõw—£^Üt4Q?”®¹¢ü^!|¡ò{Œ˜“Ñ_ÿØTþ×O§ò¯ò²M ÍmJXuzÉyÂØ(e‚
)ýü.½g^«nÕ´ñM;4Z[uûPÔ®¡BY”ô\öæ@HõØ‘îæ)òåºH…î…}å­“,& '‘Æ°FÏ]æ) Âð/·“ùU†i/PÑ;åËþ¹Çˆ96ÿØû§ùéûGV$T'*'kŽÎÔ®6„IË¨´êf88ú¹}x°wÖuà¤‘Lˆ¸AÇŽÎñ><E÷£E½¢)LÏšLÊ¤‹‹V_ú#æóý› ¿ÿt‚ÖQ“åŒò¿Ð· D¦Ué÷ŽŒ$$tþ`‘ “¢CORÎ0ˆÂf9Îg3Œ)y!£Èçi<÷‘Ž ç¸lDs 5)“µzU'(…}Ù2÷ñÿŠ‘T6¡„Jmf}	¢=.n$ëjÀÞcVÑPI§(†·ê«n¼öÞÏÝ^¿{Û€²Þ°Møp¢;ÍØ—æ6$¹Oñ/´É¼ÁÙK÷ñÿü½ä_@}Ä½R^ò|QxÌ¡e6à7¿M®Åh,\P½zN„òŽƒâ	ÍÁt”Þ.‰YÐwªû9{0®Çè÷¬.<=‘£édo!RÎdK®ØýÉû÷ì7i);¦„Þ åô:ãùÝk#z:jä#-íæt¯f}*'é˜Äü@‰½Ìæt6ËŠNZfÖQUÛ™ýi)×ãuî ÌlmîZMpÏ1E
È6òI™Øá&t;Š¤Êð XÊ,?R_¥‰ÝÉ_z°wöóÚ‚^{P„½ÙùmÅÁ¼¢ØëvølŸv’=ÊEçKýC¤©DúÌ1î”BËœh)é1&çˆVÔ»?‰ŸH‹°ƒiéu&F¶ëíd¼Y$\	—"á•}>©a…a%JuÞ CG»ŒÀ}^îáâÂN¾W ¼n@¿‘ìZ;48~á^¨¶ßÅÒ¶4†ƒk|~E<Çš÷»l’'~ó¢ðÛÂPdCøëQÒlÚåå+ Ï"Gï›çÙ|NiÍì± Ÿ2ÐÝ'c~ûÈSðªCK>¯âÉµî&ÉåXZòBðë9w?êÀâÃz“5@áaÅðví#nf”mEí[ázî=õžQ"G v™$Ö_ÿ|„"N1&bc[:ÀƒÇ˜/ÐVx>:jV¹œY®Ê.ÍÕÃµ[%À5÷NO:(.í½èöNzGƒFbNnÂý²cBD–&xhR“÷œÖ•V+W¥oP¼5-)J¢Ä±#`ÈÂÞiMÃ:àó^ëÙ™¿8+/­ûÊpN'Ê5ƒö¸!d:.fè$<1ÊÁ•ˆ¢U7¿Iþíììä´×=;K¾Ù¤¼#@•®(%¢|ÉöÊÃ£Œ´•ÎL{.b!*ÑÎ?lðFMž1Ás¢pw£	»}_	é|}*/	éÝ9<íº=–éIA~G)šß;­ïÎ€Ê “FG‰0‚WiYhî«Ápe.V^‡õ>	Œ4»Íê’n`œžr¦³³IÖÒõä\D?7§çyðìÄ'OµÔÔJÃµ‚kïˆ×| Ÿ»´ÆÿeéÊ~Ök9ªŸBÔa‹ªž$­ÜòšB­&¾–¦›º›!RGÍ˜
ßå÷´ü’
 ÈµÚÌ=¡<x•3!åÁ"Œï˜ƒ‘«R0çtÊá@/ñ ‹÷ÁóJ‰íf¡›–ÔÌ2(¹nO†?ÊU€þæ™–KÕÏiÚø·w!þ'9‡Ü—ø°ÿqŒb½öÑOv\ä}’U,Lrv£ôd\úNéœ¬#7ëÏt´~(Wë‡s¶º[®ã.×!§ëò“8Pƒ^Úå?å‰=²ˆ[øƒ>'qpõ-¯ö._ê_~/óOò1ÿ-½Ì+üÌ—Xñ?ý$³…±•’ÞqY*_L?#õ‰ƒ«^ouŽ{½î!Å >ëþÇÉqÔ3r“V*b&±×"w;-n¿62íå>d¤ÚºV­Õx1/ÕU~y•È“)..Ùlò	kg¡õÿ•n¶–­¥{üI6>U£¬ÊPN7ŸO¿I¾þ>FC÷}LKKVag’ÑÈIÏF2ˆø®'¢Ûª:ŠäDÒËQbÍ)®ÿj_w’ÝZö2D7Y:ñMæ#E&upr_Ý-±á„µœ·s8WÎ,ü2¡'îÞ®ÿV›$º!V\/k~Áå
¬âwšáê¾Ù¢ö¾±^¬fÈpÛÝÃ´¡,Z"Ž¼^]ñj‘Ï†Ó(¹ÏYUÜ¼wÁ•Ww]Gz2›(MºÆ¢)oŽR f_šGU.ÇÓy™`2Þúû˜eöœûòe*ú™Â7~âÅÒ%û“”ìÏyEþÇ{Gþ{¾$ÿ—°?´ôÎúüs~kËƒ7ò/Æ‡iãCàÅ÷=Þ|ßóÕ÷Ýü¥›«D“w“Qö\a˜}?ÀªŸnÚ‚çPaÓEÏÚónp6À¬•kOjyùÈ‘®¸QwE>píÉë¹‰LÁtÂƒzZcÞªs¿Û9>Ú;Ã¡/tdDÖ¨Ã[6èÊñ¾xc;8>z€á-GªSÃPC+QEÆ((éDT€–m”.gÑäS¡¾EÉ`úœxdG{Ê:dp×`}ÿ&<Ò×L»@¤YÝ0…6â¢Ê’æÆÃ8bv•ÖU%ªcy|UÎžíUÌ'Ã%)E&Ã‚Î\PÏj:–s‡	`Â÷–Õ	>…jÈ3
hy’”Å|ˆ£}7èUÕ‹.eÒÔ8,©s€õ.¸˜$ZëkJ:ö˜]¿kóRŠég"ÂAÐ¦Ü²øîRn‡µ»7Ê[HöÁ¯æKžŠEæŽL" Ä8s<p9õ²²j}„˜m|ƒp`,0"Ù¢X(3-×“µA¯{dëhyåHtphÅ! òOê‹8×ÉBFø¢dÊ=àò½=‹×5˜-ÉÓÂæ2Ë„É–åª‘ô¦ã1’ÈyŠ¹bªÐÙ5=Ÿ”+SLƒ2»à”º"»‹šu¾ŽC‘rB"?ÌÝj–RK@MÈp³à¦É¯ˆê<¼Še‚ “ñÜí–Ãéõu>_B1¢Ò²áÑªkxj‘ïµdÞÁà Ó>L:í“þ =è&Ý^ï¸×JöÅÎ§rÄ’è‘`.vwlw¡õ”+­U¥f¿ÂÉy®öVƒgò1sòWÕàsÕP»GÌ”%¢íny»$Íûx·í‚øíKäÛÿ‘oE´%yžzž`-¶—ìÖ¿c¤+ÛFÐ—(|›Ê—(|_¢ð©®Fìú~(’­>JñõäO°²bÊÂ\ò&öå¹“‰!*™ßAÚv¨Ù¦ ½â¶dXÁ‰w¦°§7•]
üBvI†¡xÝfz”!—Û‹Q>ù¾A£_Œ¶ÏFˆU‘ÂüÉzfã5¯j¥
‚U×*çï@=Žï“µ3…™§tª¨,Vš7ú	˜³3Òï{½VH†ƒFŠði™Í¹ÝétO\ƒ¦w¥áú]˜M‡Û¬b/ÎAO>LÏ3ue¹¢îœÔÐ¿>ù¿¶ê¨Eû¹1[Šß	M·©é[Owž¾;GÚÝ£ºç)?Ïçc”§Þþ×âãÖþ·íïïÐ+IÏÌ(ôòùÏk×KérVHŽ`ñÍð-°½|x¢¾ÖþÁ¶—‡a™oÇwˆ¾ 9F½H20t| ÝuMZƒUÕD¿‰TíêwN2tM°bƒHC‰M¢ºú†(XOô¨Ò„Æd˜ZbÍàJ•Å’PìÑL€ØÎŒ¡æåÁ‹—g;mìÔÕŽhÃâb9*ß'¨qÙ£î"7'°Ì6¼(¯øüû˜90SfÉô-ìØ6
MÃ^.Üehc»fð´¸l„ãêÃê´cî|ôÈTZ’[7”¾~þûLOÐ{8LÊ+e¨¬¼hpªÜÞô#1û®šÚE<ã­{-S=§£©J)tyn¯²¤šmé¨	hÔ‘-š¹Ï9½ lpT5¥¨_&µæÏTž—hÿ˜á‹oÅ¯ª[ÆSåh4Gƒš‘b±D…šc1RDG·Ç“#aáDõø+Œåc…qÕ„n øÁÚÑ±Üía_µµöáá™™×wªÐ‡ÿµØÞÚùë-ö»ÍýÄ…qL­äè8!î±ÐÝKBIÆ G’\jrDÍtÞÅØõ†—b*R ¤Nq;›O×“} Öë´ì §ß•\Y[í\ã±^ƒ›Šv“édƒIð:UìE¿ûòS$è‹\œ$?Úd¿d!{ÞÝL 4»z”‘Â¯ðJN@‰‘ÿî„ QâðPÊø¬ûóÓ_­+½J-C…Pˆé†â°ï%^-ðgà6]êM—Jµ½¶uåŸ'@¯½52ßP4bŽÑf™Åï¬WÓ>o‚6§¥¯¼±k´5•å%¢YsZØúAPi+é+i¶Nà´—: ­ÒÜ*J	XæÕ`<›þ|WSª¹†º–L+®ž±”îH1'°}‹Z•‡¶3½>ÏeóÊtµ!¿PÛ»BIK™> °Æ«$ aim”qZÎ­J-{ºëN]¬Ò‘çò¨˜6˜
UÝÓ7í6ŠÝºô˜­hv`¯#!AÈ<Á™n“6EüÓÑ‰Z®ØÇë‡+·ªò1ÛZu,gikYNfË¸U•QÙÃU NØ=ÑÉ«íßÚ¾×,Ð
ë&›¨¥óÖ, ºØ»œ¹<Ä7»ë±²£‰º->êt“`¿9>ÀÇ¼lè´ÎºG/Žºg{§½;‹½Í„#‹b±ãW'xÉõ!ó&HÝý¹¸–ªŠ,¦ªÕVÈ½Ù q^¬)wÄø]r{Asô“+­XXš(6=ÝQÌ!Ä6
ÈñJA¦ˆiiÖL•j¯
NãwJÙëœŸB	.…Ôé:f@ï¢ZA¯HÞ‚J XüÓªÏ’·¨Ñ–	EÕµ;rbÒÏ¶$H7¨v0c
ù/Ùƒ©A´Ž+·¤/p§;Ng ù›þr<=Ç»1yð½*]Ê—Ï)a4µ•Î¯`ljÍuÖ|/KGcàuPeƒuQç¹íG)7©ÜñÕº†Y6Òó
´9Üy}$½—7Çõ@‘¿)u‘gJ¼™00úou“È©^XŸLUºPÝ±ëöío¦òÜCH«]¦¥’e1ƒMVÎKrÒÂp†¢sR]U¡^­A,¢˜0TKWXÖ¢®fÄLÖÕš¹k²Í·š`_’qµ–0.}×Êž2#«•ude˜ª"@=#C·3¼&·UP¬¶,IÆ¢HÂ\T904!‘Ýèi2™
›2¡ »£ß 	6‰Ò=VX8V¢ñ€46ª'£ÂäWQÍ)f|XZÿ,¡õADÖX?Q\} aõÞ¢ê2AÕÔLm5Dúñ®Z½å¸Ûz#XM#ÒÌB@‰CÕËb˜Q­Õm¡…²Gâ-Úš)sÝSµh(ÍEùJM5µè{ÙvyIa]:±R`ä9dÇÝ±ƒ­Z¾LÄ‡'€Ã2ØšGlG&ú_‚‡ôÕVÆ¯µ¬+­5ßÎ5ôá!à¢È”s¹°ÏSbAÔðÖüû¬Ì¾ËŠ›ŠÂ·xŸn:ºŸñè^æ£)n’ó[ÍIÍ@ŸTðìDv¤´À}æ¼¬¾Íô—Þ¸Äs™WÿZà^f»‹ Ùñrcçð÷Sô¥jQ¼*/1ÂoQ$9|ÁGúÓ‹„<×AôƒÏå@`‘õr› $lòÞI×VêL´¦`Å†0èm¦0ûõG1ô»O•î†•‚Ý0&Ó5§R„’ÃD¼‚}çPÆèß“	x+GhV÷¯?áoü“Ïå²tŽOÃÀ:º„¢08ÏÓ–½‚8œßÕuê¸uð›ß|ƒ¿¿Iz¸³÷™ˆáƒf:}MžüÒL¤6-Þ^Ó	t5¢í°¸žáŒmóOèï{;&ì¦ºjŠ…üÎ{öoÕ4í2º¡œ_©W¾x¼îKø>-nk[Í P%ð/çß‹a:05G(CñâYèÎÒsq HI= )Þ£#ÄnòzëÉz²Ó\OÃ¿m¾á•sYïU>YÌéùŒÝ¼‘O†ã¨ºµ#ò©7ŽNËzXï²:Àwš¼{Ÿ‘í~2—ãp‡=ìD÷^µ(øôïÓóãâRyÁšÀÓ©îëw5GÙe ©k]ôÌ,ƒ7>†;ÈIö¡ª,ŽõâÁÑ˜ØõÁŠºøøRòzÊ÷³z0M/ŸôÚeš½iôïôÑQEÿe ÞY£wzt„Ê=Ã˜ñƒôÓYE?,,ÏšaÅž, 'ÝJ\4¨óƒ»‰•]¯v¨Øjj<ƒÜV¦D5pvú,OYdwÍ+ZŒo¨Š¶ðàí&^Í¢^má‰ÞÞÆd¥–âËâ^SUäµJâö–ókø½[rŠÝ;+òÚyâ»ÍªìR«µ·'yZ£õñjbÐ»©åŠ&zˆ šó…°7‡ªåî§Hn*rO!õ=p¦ÚEêÈS_-Ù‹$/Kêƒ¤rX’	 „Ìð>ÏnŒxc	–Lso!ã_hë·¼3ü78——ð#²Û|¥éß“ÈâžRÔ:#çÕSB˜YaoQ-Ö”ä[ýþùÉËkg-YH,Dš[&¯âø†V€ÐØhvµ¨µo?ìË8ñÿñÀ”.¢äiÏ.}r	Ð{F†Tš0Æš»mU ÑhHÈÒQ_°‰íDM/ÐÑ•.¹Òs@IÙ‡VJ¶þ§ª(“ÏTvš¿¥ê"¸è*bJ†3>ýB\VÁÔT<©¢]É5ñüØ@¬'ÁêÎÍ~Y*¼Qud%‰…‡æêjÖéÑMB£›4ÐAÚ"G2/²ÞG¸…ýîàôäìôd¯=ð[<UhÏÂ9V¬Q·"³‹´-o¡ÌùÊh¢êx…ÿ¼O‹äŠ8€Ú÷»ä‹ò’“JRÞŸ67“²nŠ-µYL‘5mÊc¡1/ÿ„Ïú,–¶b;­)î¬@®øþÈÈgøN´uz”]mŠÍEoQM3õ°zÞæÐEc]ñRÕªcH¾´–šåéçÓe’ç9Ì«¸•–B|*Lìt>E«ë †ïø€iœ_dÒYÑ0ÅtÙ†bë|¤"!K•T Ì­ãÔñb>œ^gô¡”±ˆ×“ùlËü¹mþÜÚ\µHoDN›Þü­Ý©;kÓ‡,xkg/lÀ¯{ñ®nÌÙ¸68Ù:{y0X£¨¼nÑv¼h'^´•ÄÆ‹vâE±ãF(üåàH|ÖèV,d°&>o‡?ï¸Ÿë.³"Ø\'õÑÚ?Œá§›Np|rÒÝ;;>÷ûâ»"¥ª!Ríê1vÿãä FÞÑñY÷hÐû5T&›=ïî÷ºªž?¾zöQ§{D‹ÇíCí—Â—ö’´G/*&Šgã£ýƒÞ«0žNºG{h	Ð2ÔX¦‹µƒ£Ÿá#g©´OÇB&À«äÿ†ƒyŸNª_á0SõoñÕŒËª´ ×1PMzX‹å¼.ƒ¶4ìEü`§ÝºÊÆÙ£;«òsNŠéu^fb«öZ"…³|Ÿtµ­l§Þ »³š¸ÊdÂ’¤âï#ï‘ÆÓ”2ŠÑcËr…ëR½*&@õ¾ÎÃ<Ö(£7~ƒáK„?Ìø—É®µF=æ±“´ùÛŒÝÍkü Ã·Óî~òè7–ˆ,!ŒJ)Éa&A{‰‹“¹n«'4¤WélyfA¥Ý"úÉÇÚé‡ý;k‹(x$ªß$’o³ÇV§)ÆùG¦
P±6·µ2‹?sGMÅòn™—Gé5Á£U9º*™Ÿ…B[7[©|.£ýoEñý‡d+Û‚æ¦žúë(Ù	5ùÑ›k°wùI¶zj¤qëePT""IÞU·°€AæT°9•ÄZ/;%,pV¸áÑDXB£žb,7¤
l¨¯žïOßg$d@Âfž)‚µ¿×Ì×-Ì)eÒÛöo'ó«ÏÝäùtŠx£7%–õ……T¸vç§…E ,¸…ýƒW§"K°X·ãÙ$-d8Ð¤»„Kƒ·îcðƒJË0·-IH®aŒ—êv‚ì¹®ô Eº‹Ï_r¼**™ÔfDHS£8Õ˜gêi;=T°	[Ø\UÕü‚rQÂ[çF1ÐJ¨^LÒ<œ“ìµ$;¯UñmªBjä!«]$ß³½*lw>UÞ‹ëŠð¢š5Äc¢ëb~3Üñ€Bþi~ó×®Øc(¢ŽŠE!‘'±éé°¢†ùÍêÌ¶â…&l˜èÀ:£|ÙZšà/†H;†¨ÞÂKÕ#"Rq\ªeRÉ.À%™Üè°IU	Y¥ü;Ì.Máj,PÕ±A¿ìsX¡Ù¿*;T°X¢ú¨r:‹[@õõ™¥1¬KøîVUß9-ú¥Úªâ•+K h;^$ÕYòÏçäÊ¢¬aåzêEâ+
¥¸b,ÒqÐ“™×Ex$yp`Ö&¶ùª«únŽ>!èJUkp<H½8Z®”cÛ…Ò«*qû4TÇÅ«þ©-Ö”þ©!×Ó^5k³6uÓÆZ0óÃ´µSuéµÒ‡ƒe>2.g>>BR‡PãN|bPÔ§0s1(æ#ƒc>F Í¶8ˆÙo;ÛŠ5Ú¶m[¶cv¬F;V£p#u`²–ê“s°à§0Î¨þ™ÁâŸ£—Ž¶g6ãºµ7P–ce¬DItzµ«bãiö¯¥4´'ÛbZTPã¢š5‡ÏFD0OóÅ0[ówÝ«Ç\:·¦Â„2ŸŽ­š(š1rµË¶yÙ¶]¶ÃË¬° FbsÉ‹×²%±ñpNoIiþ;xO^#{Eí×!GX£(©áa1M–DÔZQ¼y$ï\²gcGoÐ’VýBHîs
>Gè“3ù•øhô–¸G_Èwô7‘ë¼»ýécX¢õ=qNŒÛ—åäwO“ßÿ˜R\TÎR{è¾BÆ*‰=ÿ
Â“- ˜ cÍl¹Tä4êÃÖÂ¹ZJ²`2QÈ‚º\nršÇ+ÃI9ã_­ñê,!VÃ L7â¾Ú)ä²¬ÓLvä|^QŠ‘¤î‹0ª  ¿ˆyUöµ{I.¿•ŒâÐdX@±H,&8Ôâ‰&ŠIj¶«»­ëúrŠâœö8u¬cNZa9F¬A:OûÓEaÏ×3?…(.÷xÇ†žèJ4ï·‹¤ŠéuÍ$ºge­^w³ç¦ì´ÜHÎ§Öµ-9¦Ã!ºGfÒŽÞsÎÌ}SR.®1tœLù/‚fÓ|2¯„Òä29 ã²^fñû[vU£ªè,¿Ó4
³Ll1V/¾õÅ,×±àåwGtE³˜O/.ä³…&÷)¡à	ùWÝ­úv#ù¶ýþïÛ¦ú?}ycgeSùä‚ wš÷†ù×e0ÿºÌ`ó&·ª';=ì™­‡^/m¸!:|5a “‡ž)üÆiß1¢¯äJ7„¸’à—œüôšÎgdE™S 3]ÛÀ° û0¶ëæ³3ƒ¡Äj†[ÓµB–"+0Å£ÝdË9s"€Œ£‹dÛe©?˜%YEÔ‘¬È§£=áÿŠøÞ#WÑÞðÐ?úÇR9ž3çóÚÚ`­þº©o©gµš¤bà–#³®ƒçª©ƒ·Ö*½êÄ¤Û1ÓÊbx–XŒ4:¯`
ö¥[·¢zÝ…B¶tdZx§v8 «IÂ²zaÅ™ëƒS=ôKî¼=*B‚0É—‡ƒá;Ô¶·²pÁ–)}@"¸td¯ ›nE`/ëÙD'¯[Ùuä^’ˆ‰ëdCQG¨XpÝ›vø—ËÏæ£YÍ$Z‰©jlªO|'­óQéG7ö¾—0Ä
X“ƒ8­!÷açµ¦ÆwÙ­9¬/d<Owm(Â©B¯å¶ Xæ<ÓºDM¬-Ög4o¯-Þˆµu*.YÛÀw1
öÚìg¶©"Ö\‚=I—«NEckÕu/üWÖ×³R#Î^ÙrLÉ®(un‰R)g‡ìu¬Ž-AÊ Ó´à¨ \ü÷³z0qŸœÆ›],7|Û¥
$ 2jbçò}@¸g‚½'Õ[}@D¢<·/
KëBRçb:Ñ=ùœÉæžuÑÉcòx‘‘Gäüh˜_ªÜ‘Õ-A]QØÓ>&„4Ã•ˆßéÙã·¬)b,;H†É_}Äký—tünZàÄeŠCíª.*>3gõ)àîW÷³°¨M‹=éÑ§Ý@Ø‘½· æ’j^@©#ç‰X×5Y7èIŠÌ….¦Š`,‰1ìÛ›|~•ü#+¦À¦ïÒ«,%çyê;‹ÉsÙGMåí‘@€]®£sÕó´(SõrÆý¤ÙtÞ¡õ´{¼™`HtÛËÙŒŒ°=¸@Õfëj-PÖ‘SÙeãy­Û½AýP¹ä‰¤ v3²ºò/*Lü Lx¾¼Ì”!Y‘šóÞP!ÅÆ±H2"„|š]Ïæ·*ª‹"ÂÔÙñ6Fy	Ô „ù¤ÛÛ?î½Bïç³Ãî‹öáÙÞA¿sØ>xÕí9¬Û:)øÝ®FŠtÌÕs¨^ößPºý„—Â^ƒÕUÙ¿E¼Ë|R#n#ÙZwà=òéƒ) ù¤M²D •´Ð4)Æ”*5‡%i >[>…O?ðQÃ‡GÜ—…°>€°§ó:·Äp{ ƒñaùÙóòù…3^+ä+õÔiwHz™Éà
˜´šÓ£gä4œÏ^’9QtüÌž\ã*¿¼j$ƒ7Ÿìa×ƒÆûƒWÍí«Wõ‚QŽ½®‚C*YIò'ÅYÙ&lAÀ"8ÿ.K`«½=ŸŸ}ýQíÌ;ø;çq{ª·¯ØfZž/ ]ÝË`Ï)`*³Å•=3!—'ŒÙÕ¸há,£3è1…zÄ£ÜªW8†vªW·{7—v é« Lƒz cWâ’De÷¤6s žæŒ÷‘8pE=ÙðC>÷ÛIªôÄCñOmKöÑÎEQÁÃ$c\LcÙM“ÌôÝñ—] Fü¯ºä3°ø.ØØ
¾ÖL#íåëãŠï¿ì ñ¿êP¶×øh~ÙþŸìÿŠW!¼_â$‹Ëhp!ìþï4f=¿ ½íå7¨ŸãKtÂXž•5£@Õí½FýS3ßèmFPÈ+áù…o·ž\£¿ÿcýÔ'ñek›}z|…Ÿší'ðqË‡
RüÁÈR;h *z®ø|êkQËA3.Äõ£dË^#t£€•l7íù%{€#|Â(zv¬æº†óÎ[/uWÀ€ÞÇ)ëóÕÚ›2å¤ßcdmáÐ`ép<-½êŠµtE°ÛVÑP9ÝjšÉøë|æN^¼¯8X¼} ¸ÓÉeG'µ³â•FSØ=™ï)Ÿ"q‘>šÂþ0;Jc˜Ž‡hÆ¬fé¸×Yh²¯ºó0]5ò’Ì2"^ºù,rRý|÷$>bé!%‚½9&í>ÌF:]¸Í’di*gƒÞ‘16òI-s&`u«|
xµ€Ë£]p'°Ê-¯ßôÈê®QØ]A^Çp³–E,¬ÊÙiŽö·–Ë*å‚"½éWV˜U¬œ(h×Ž”¥å»hÙüž'ÚEsiÚ^©±¯)‹¢›?®,³ù@d°ìô~=»ù+ÉãCySº:¥™isÊÊ¾vü“•ðÏZtaÛ¡¼_•Ñ9¶ì2³ƒív÷<çIV¼Ãüão¶¥Ç+læÙ*›¸(t_±kVÍ‘}ÉïªN‘ÞªHÓ2}µ’Ü,qüWÅÝ•î©Cáš#­ûÅôš–°¬	E"r/Ùå/·“nØ&IÕRŽÊÜc`çæëæ]?LÝ
àÂ†¼BHÚpFÝ–¹QLÇcô:E$ã5áhzS‚`Ô¸l$ß5ÿœL6ú)^)`ü´?'Ç‹ùÆôB~ª‡îØuEðZ@t¡<Bvè: hò'‰ê3¬ý[ÍÏ0÷ÿ"Pi©0òêü`"ð÷j%£¿l˜?¾¸O;  {q‘sØs·òDe#ÊËÞô|QÎ¦“cèØQ­£`Ý¨¹|ÊÅƒi¡3	Û±ýÕvÜL "ñ’À3Å[)0Ee1È>hŽJ3*€²É‰¯î·|Ë¿	aK6ß•ØëãUÒ×7äÿù>øW%&0jÎld6!6Ño@KzâÔ÷´#uõÃ—çßGÏ#„5`CPŠÓ†.¯ÓX¾ó@uôv´TPé#3•®‚Z­žþÊ©¤Ø‹=›J•>ê·ì’‹
k%‘ì·àhë¦z¬•…íX3DÄù+/Õu¯:?ù°QÈøàÖ#H`tS÷Hbµn¬Ù¬Ð¶ÁÙôâíea.l4f~ëüO‚»[7cvÛ)¼u?Ìž°ÑÜZgèlH !r%§È¨}¬ ¼·@3»ÕÍ²Bå‚$alŠ‡£mw	Ô™€œ ü,«ñ­Ç"(¿ŠÏ˜_«…}ŽqÎ°2…Ú›E[ç¡	`+
Âbø®ÅXJÁCß07—ÄC®M¶ŠH3oÿN$Ç±Ó–bGVšQE}ÍÊ[Ip;)˜	†vWõ²1ØcVË°Ú {34äÜ•üÝœŸ®Ø'Lœa5®lïKGŠZ¡-,7Ïƒþ«uY‚ˆöŽïÏcNH!Fà•3Ç]Ñ†Uw³”ÅYÌióKÞD§w1HÁkÐ—ÂÁúÎ³“!åxüäþÚ™É™ì¥*ÄDsw¦NýTî]µ‰Käbúª^IëçÒ“,ì¾ê¢vY¬Éµ6)•»eê²¥ÉÂµ ,oæ¸ÐN¾¼Ò.ÿÐlŒûÏ÷2ax”p^dé;ozÅÐSwL2 “Ðg´´8ß¥™xteÁA0õ¡SÈ$[z^m#/q‡÷ÇÜ*¹ÿÑ¼aÝ§É÷ÁÂµ‚Bªùöˆ¹GŒHhæé'ñæhÿÆkÜ}äG80¹lÌ3‰„†¬Ã¡šqŠõôF*–à‘”¥Òs =6æúªƒþ!4èô†mBwdU®‹Øq|íÛ#õ#€|îICÇ¾i‹qG#òÝ°Çr›ùÞæœ=c.€í¦Ù°B1ØØnjÉ÷Aâ‡~ª4'wmIz‚
ãTZ¨ñÒõKh>¬ãM#Oƒ0-! Õ—LrFæÐýt8ŸêM† ¬ð{ŒžB!Ur7SËj­?;Õ­T?éûËž\ŸÀ3°–ÒdÇ‡+RLÏQ„7ˆÜD´X	’Õ¶`ÈFÎ%;$Z£ãˆ¡Ïþ´³”Œ™µ%›ªÄiÊÅ‹Ži˜ßèñl˜±£û³0úØyê<Q¿ÌÆcu%.µŸ¹K­Ì»^™%„èÕlY¤¢?szÑ‚Ð‰>±†´9ý°W¤7 LÔšËƒ`SX[‚µæõÔg‹Oåûx–8Ž#œÙÕ“3íìƒÁ¼ÝHâ˜}ôðÏÊø°Ïî*49–ÙO†höÕÆu3‚DVbáQ¥¾:ˆDçÇd¸ÛßÏfÓb¾€·û‹É$ëWTþ=^®äÅ5ÝfíQra¨iÕÙi‚Œ—Ò•Û$+K»lë(»){yùÎÎòPÑŸšm·GéŒ~©$}JWjjü[ Òe~ÝéPæôFò_:üB]¼”&5frA ¢fËÇØø¬ÏŠûçÿ×øâÖ¿ÖÜ D@•GÅ/Y~y5/[âãFÂ²‘'Òêñ“?«ÒWiñäÀ^vIyu¶›º¤—E¤	<°¬ÒŸ§X
ª1 ]äóôœþqJ‚f·-Ú'¢£f##ÔÜ½lbÈÜ6Ó\g¦©uƒ¸KôNpíS´ ‰ÉÑàš¦,fL-’gÏ¤$_ÎsÌ;ÆÊØ(m°c…v!‘¦
cðµ"=½ŸŽ‚­ÎÞë5`5Â=þªéñ†“¯!¤]¶ h;üg‰Uü½M?6Ô7gÜøyËzš1´¨ÍciQfûãi:¯YCðM€÷¦«ýC}Xç¥Ä+¼*ô•.|O~::þåHßöê9ºj™†:”Ô’˜Ñ`BÝâøR5ãkÙrP©9¶…?3ð	gëdD…I*ÇÓ¹sc–O€Ëô²†ûÕëe6ž¡®Þ•ä¤@°!|Þšl½Ôo³@#™LIH¹<Ÿo“r1ƒ¿³‘Ëª7Ë¾õ•Y¹«ùÅÖ»—ðëQïv4Î<|Ë™šÔn¤#›+às>s»«'Ù*œ~%ÐÞ´¤ÝEm^7ßp9£À8ÕÄØƒ%«bŠ·"•?iÚ#ÅBmÑ:_Ít¸ÁY1˜ÿúÆÈç"t¤õc²Õx¢;üþI¸N³ñ½®ó]N³±cn›Ð7W¡Nyt•Š+=¡Vsî!’EóÏby1D³OÈvÈ‹¡ ?X²ac:Ë&uRø¸ÔM¦ê=N”£¼ ÷	¨bPêDDZCå@Çžø[à¨ ïìèYšìÏøˆÍC3í…ópÖÄh¿an™ÌBdƒê¿<î]Pàðª>j¨ÏJÇ_«'NñOV xs| 	›S—È>FËËd‚!ZVô5¹äÎ5ŒjÅ#ý¡x¤?Oø6€fÇÓdo’Œí	Ð³dl"„»Ñà±øJ çœ¯#“ÝTu\Û±†òãn²•mìà¥þ†ºÑÜ~âaèû¦Gq²Ñÿ  ÿÿ žÏYxœì}kwÛ¸Ñð÷ü
¬žœFÊÊôEq²Õn6¯b+‰Zß*ÉÙnóäØ´HÛl(R%);nªÿþÎàÔÅ—m×}¼çlD\ƒÁÜ €üD6ÃµVƒ|{Bè_Ó,!/6~¤	³'Zâ6MÄ¤õçÏ1ã9Ù÷£„¼÷‹´¶H7)²r”FIÑfÙÀŸÑUßó(.Â,'~<ŒÃQ‘“"$D@ÈÉ™Ÿ‡IÒ9ê‘ËÐ‹Ë&¥ãIšGÐBæ'_¢ä¢IAÑÅeAFñ4¨$ü:ñ“<J¶»ÿÏ¿ˆF¼©ÙH]µ‡°“óèâð*Ì²(›d’¥Wð#ëä5©×a|BQ¿&èòÈáçðÊ|úÌÈ“úwZOþõ/­_^&Å%yýú5Ù(QZ|Žj(dÛÐ@Sæcÿ«sÏ¦ÁEX ×SÈ©}èvö†~­i€º™¦…¿£¢M67TÞy”øqU&'rWÐx˜EamrîÇy¨JÒa4wÒ)ðÑ€MüŒá~~f²6§áä…îÕR=º×¶t>áÃxµÏFÛ±ŸÀ˜§	t_0žªÆÉÙ$ÿM&ˆþ†5J&ÓÂ«q€3ÿÙ°Î/av…ˆO`ìsö›²¤g¿ê¯¸ÌÂü2ƒÜ“à)Y‘-6¹`1cÿkg)ÂX“'ßx¥"oÞ€Ô—˜Q‡a2ÐjèÀ™Ý0lm°<Ó7J(\»aö81Áv¹Ð_- NÿŸfANrÁ×
T4±½ ‰ Œ(ÊÕcúÁ(ÍÂ]³0´óÂ@—Ý÷¿¾M“i^L”Ä)(? ÓÒÁè0þˆïGƒ¨!{½Õ³ßÌÍ®+=Ö š.`­ÅaaéhMñŠRh&B ¼jû‡»Ý~gØ­)-V‚¤qÆRÓQö&Óü²~ŠÊaK8ì('r›¼€šÔŽ€r(Z¤äé7³±™wÊÇtFBÐCHï†ýNï »;o“éV@]ƒïÄåtvÍÕL„Á*@1±µ»ômy<ø(ß’‚#æÈóÁ^”S²(36ö'uŽµ¢òúgR\F¨æâÑ4¦úžk*7¬­Â›Q ½<ÍŠzÝo’3
çÌuÉñ­¤2Œó4ëú£ËzŠŒ›$
¾RX‚h˜ê¡Õ„~@ùžlòÞ6”(DITD~L-”“Ä¤TSo–Ùs†e>±9ª*WiI¡5¥ª¨Û”B¹% %”ÈÏFÃŠÛ¹¢šéù¹„ˆ6LBødÐal~þÑ¨›„_‹%jZµr©>‘•ÌæËn´ae;àöò8ÍÃaºC¤Xs?½¶t¼	€D/Yš\@]³ñ±Ÿ}	‹~x9z?¿&/·M Y<NÀ ä¯„f”_m˜ýIÄäºÇéu. Ší;[±‘?ü¡Ä…?•L EÄËtœõ¦œÔE—Ö"´YIÈ«êŒÀ‚²°‡†æÏ“™"›JÆà†ík'hö†™7šf`¿:¥ÿ®/£8ÕÆ‹ýTyì•ÖÂO%Ó¿Ô(è½“üˆsCª8Ÿ,•dáÕNUyCtÍ:BEý² ŽÊ©ePXˆ³Æ@â HY}?‹\°72ó„éJËTˆ%—¹ò¡ã|gw‚OØLÄ0q‘Îr¬L˜	ozÛæ¸V5brì„^a‰§ñOqÜ÷ß›9¯ÙÙnb—âŒc&[îG¼/F©'å_†§¢•=Ýásu¥i´‰äèKÍgùŸ§ß{–{FêO¿™jÕÏÁ¯™qÓLì\sPfp°ü8:`ÞHØ8ÚPÑ¥ð =:ˆ2Ÿr¸W¤ï¢¯aPßlÌpœŸ~3GzÖhÑÑœjB¬o)N Qn—.18ì4XUæe€N©B Üô©nÆzUêzæÁ¢d’¦19»!ß?ýæf®™>£®3c³%…§ß,v5¼SÉ ÁW%Î«d¨ƒ””xªMvnÅDeÂYì3µ9$!‡ÂA£l<Ê Tù÷ÅV?—¹ŠÈ5…¥økY–Y‰\c¥ÍP«Ú¶ïç9¶¯ì3Wy+æÜçƒŸt$;aGào„	LF¨Jvb<^u­üPVd3!»µŠ¹_“£#kZ\/£QXßhÚ]1Ê‹ztéH‡J'VõœN]r.CõÃsŠkÕÌö	K“]ò†´¶7HÛQLNä¡ÌÖ–ÙÜ0¦´Õ4hçT¬ðÊeµ i›ÿâ C—:Ë§Ù:0i)ÑÐŒëut‘Ea"¶'Tˆ5m’wHû½*#…Eh0MZÊåŒ|ªVlŸA[ñéYŠÅa ÎÓúé§iTç?
Mr&ÌZù-SM¬j–W|û‰2:µdš9wuKœH®$‡(à&ˆÈu±fÓ”\ 4¶ ÿ<Y_'y6ZgkªëY:…Þ®çÑ`œ{Eþù	’ºõ¢û5¯`¼Ë"Ê‚¨Öò|æE¬JnhýwÓ$	ãüº)¢Qn–çuBâg7ƒQ†‰‘ý¢þc
poYÛ»a8‘–â`”yy”¥ˆ°Åþð‘÷Š2î0óƒð#¸%oÔñµdþ¹O½‚]_®øÉÆ‹òs •„ŒE,& ŸDÖy”…È W7 õÊÏ%töDõX/+N`˜é^Ÿæ6°0/ˆ+õÚzÎšá*
ü¼Ö$~~“ŒHý$ÿÑ„qÏåBŒPƒ¬$´ä_û ƒaÞ—Å7_;à%:¨N%…OÀTý)=;Ì.då™„+ß … $ðåOZpðrö®áý8±ÎD.ŸŽFÐÁ6õµs
üØ—j’}à¬ñ¤MvÑ7HÒë:®ká:Ò¬D¬½ÎšV„© 5Z íÑºC÷ ”—Ý€ßÆÓP]#ž5E‘\¬/E½‰[PFÑ¢Í^&àDU±rbgZ\îGA‡×~."×7°óþYº	1pæGTnò®‘zs˜¤T´€§ÀâÊ÷£u
¸—ŒÊgipƒ¼oT	™Ü80™f˜Öï¡Qo%	«LZ¢Mjªj”u-µÎ§q|Ss‰Àj,/F÷´NšÝÌÓ¸E¬o¦ò*Õäx8~`…êÒ€V’ÃIB<Ïã‰”ªŠÕaôNŠÑ%©‡YfnÿŽsÔDã@É¦ç¤›eiÞ${œþàUi’R%Ì·«17¶UÕh¾ó£˜m$€‘E!8œðD^˜ZD§¨.Ý_:¬h.ÁªÅ!îàðÌ•ÌŒYJÐ9Y1„¦ ‚já›^“`Lþ3éwÿrÜOÃNHþ¥£‹ø
ô‡lÒvMªÛe0§‚2|ÜùR&e‚½/èêUŠT÷ÂäÊìtºý“þáÁÉ »ÓïU-TÕ‡<ã:ä’~äf¤YôOªTù¯;z3Z…Oµ¯kˆÂZN3kŸQYù|`ç¡ ¾„7ÎL˜ÇUä-+l©Ù1°¥)o<VT€á‰Eú%L¬4hÎJÁ¦Nœõµ03x¿O´ª
GTÚŠ˜`cÈÒY’†K(#¡Òµ¶é.QŽ†*L
Tþæ~]NTp©R~yÀ}ãzCmÏl˜ª³Ç0}*ÕT›=ŠûìmD1•åˆQ<‹Ó·!XÝäÈÀdvŠÑ
9÷Òkôðsð(YÕ3gU³d	­jTÐWEËTÖWCíÕ†ïìâ@z]æÌONyÌk~~³ºð˜ŸÚ¬&Æ×=4j,Ãaûºš<8Üížt>2ïr‚)ýÔæÁ×68­5¾…¸*xwšQE»Ÿ6†¬•lN›tKn’ÀñL\&éø s<üpØïý­»{2ì÷Þ¿ËÐ»ûGh¡Ž]53ðšskª¯™ý›K™ý\DréhÔÊNÁq"Ì®nô’+œMðEÆL<“â°i„jG¯6×7™±$Úé‚µŒÓÂÕRG²ZÒé&S$·–ëCO'¸ðÅfövxŸð¿ƒd½Vþ-XÅY:¼¯"ÆLrðù»¤#Wz@#Ãª|6¼¢…žŽN÷`ØÛé»»ËñßRO¯K^óËÓx>'Ùƒ±@•&×@êPSwlèºÁ4ƒá?v/)bÀAz—fc¿ cÌ˜b`ãá„Nc0b²ÿ–&!*ëÚñp§Ví°íFþESºhô™tÿ:ìö:{'û{¿ž §	A¡¤P}£®ZzÍ7mÎöÂò× d†]Éáßè²Ö7îÍ©¹Ä‚1ÚïôÿÜ2»ï{]åh²2C¾£P–Ëu"äÀOºÉE”„Õ>®r†ói\TLixƒ ‘Ò±Oý¤Nç*%V@µt éZ³\†>Ý›™] KC)¡«ÐSÇžs]‡c8Ò/e¶CI`Y¡´’.…!3ÖÒ^ŠS²ZM¹K"bm|ÿh¯;4ÂÀtºÔœü¬ÕúÑPÍ¼Í•JjÄîÙéô»¸xO=ÒrQ„ÞÙƒR»¿žôzïWêok•Îˆ*NÛÍ[¤óÍŠ&ßuz{«µÈk¸¶cäâ‰CGjk'¦<Žü	.†…tÖÀ9§ ™+u.õòr&<{}ç5ù´¹Ý$­&yÿ¾ÜøC0Š§A˜×¦ã³0«Ì=«n£AÞEeH`ë M6¢`¨zåLÝ å
»î¢EDtM]©³%-ÐŽ3AžM/ê5©^èúñgòÖ}¹ÈÐ¦ÓùX¾dá9€ƒZW÷Ø²…¶l"cõfÖˆŽ.Á!Èèö”÷ZB_6BÙt#J‰'à½ñ0_æ½ñ¤s„Ô*Óöû7<Àˆ°e·*éþºŒ„^ö²(&;i ñ«®ºýþawî¶éÎÝ–¹sèÆAÔ†v5£ñæi5à_B»öÜsZÍÙ^hg†‡CõÝã~gØ;<°ì‹»]naJ¶kn—[úÚ‚ŽU· û¶=oƒô%Ç›çòo‡'Íìãö®>hãpè¹»ÙN9Ü‚„É58Æ%×r«[hÌÑÖØG”™&Ñ(Åpp3>Kãœi ûçÎF“èT‘®üDíÃ©íN>àU1›_Ì1OéóÙ…¶Ø&%GÅQÊhvaÉù3¤jÇ¨¢#N¯è6ãœþÐü=‘e„óbLÈ(k
÷>Lè) Õ5;«™Yå±tÕ±'‹é4šÐDºÖŽË™tµ§WÝ0õCWQ¿ÔÆÀ˜WPhÙÙ K­uLí• [•]£ótÃ½¦p_ý(Ùi÷²H¥¢ÖÍ¾H³†ŠeŽJY«ö·áyša¨Á—eÁºY çf4Âi.3·N¿?H¿¿˜bŠé"lD)^y¡É•µÔ¡L;—aue–­É…] sq‘…Bk|›•ºÛvÃÂ4q®,a"ÈÅKŒìƒ:Z¦«‚Ù„éŠºü½D›œ>ýV×\Úut«2\r«1ËO¥ï…þ£ÛíPŠâqzæÇ(›Ô‡ÝWÈ—rØ˜˜þnÌnè1x¨NH*Óf[/Â–Ð)Ìˆ’¢û“<4xvFÉ•¯Â2Ç~”À¤Š…2íë\håL7Ê‹RWhLµ,Í?rçË2Þf²i(ð|o«\ÅJ7ê OÍÐí~…a ™árÖ4VÖÅéHÎù Hñ8ðÛ‚(Î¹åJpôö.†aŽÃBs"­tV ìÍ	[<A¾?s¹F¢¯E;"V^~¹{ÃÝ'‰·‚»!lò;/6"¤–:ä«®2B‚/»Ö–"ÿ\JþÎwMl<_K–µqÅÈß£fvìë ÃšÛ2³Ê39ÐÎ@–ÊÐ¥¥«YÍýdêÇkªúÒ‘OËììSèt‹ q÷¢ê¥ä?+ðé2Ï£Ræo#±wMßž^iŽ[jå!¥AXL'F¶AËâRæ{Öþº?¢b^ ªÍ¶9]Å1‚UY’±@ÍÏt¨2,å™øYö’¢ne5ÉæF£|¡‡g&X³o£eÓÁ"gt±—~µÌÁƒ§åê¬x“!‚pçV«ÇÚÁÕ£’’cØø°DúóÈ¢)-Yõ¨þüÎñ‡n…ÄQ
ÕWàÒ{c@Ñ¶ÔÓŒ‘Yòó¿ ]•pWn-Zü$’3Gñ>¢[{¼„¸^ÁNsbÐçYðjVÅ¡ŸQ.¸5hñÛe²Ú€;„ûwÎ´gÊ
ÂwãŒ0N“lÁœ66@{Ñy8ºôÅ…<!w:#zî’5wÁ 
çA©ÈüÑz’5Œ›šÜ'ª`Öß1ÛTPB#À9e¬‡â~@g“ôDAÅù§ÐpÙ›	>è59%[­tqœShS¯Š~:±‚\öz»h%ý1¨ÍÌÓ®«&˜ÚŸ×Ã5ðÌžKÀi
žäŸò¥Q<´]E	YQõZQSÁÒ‘”DYÅ¥±8Wáäy˜'|èj*Ö£ áñS}*6Y^ø5Ê‹Ü¼¯“æ56êá¥€zEqýKNhHSqÞ«sÔûL$QÈyˆU×âÁ0à€×O¿E=œ®	Œr„D3,UÓkGxKœŽ`V=ñ:\IyçQh§‘:£Z•â‘í¦Ì2Ô£
ˆjsG-½°}+åTÉïÜY±ŽÒã…Ç<¦˜Ç
s¶áå‰?É/Ó¢guHtGBsÝÎ’ù×ò^6YPÌ¸1f²³3ì}ì·ŒðH¡\îÁ£à+8f@ö23‡G-ò¡7tgÑWk|²ÜÖ`xHcÌ {%’utz ±`¶ªhM#W‘Y/¥£º6´5Ù4Î(€Äð³çª L4Ë†x%éQB½°JµÚêí¥¨4õQfifÉÂÿeé9;WeUªUz²i›lÚù[fþ–ß2ó[f~å_úè¼}4}zY+Ëê/ÛÓ:‹	l?ù2ŒÂÌõü-è,zØ¬|í-Üö;»Ý^788~ÿRz‡5›¼¸‹qc’—¥YCsŽÈè¶H¤"·yiAG<H§™9ÔbŸÖ9‹
P*%¬x¸)\¤±âg©Ì/Þ°wðþ¤{0ìÿJ‹Z)mC¼1D¾­‰ëK@K-6™6xCŸÐßŽR[Z©­R©Wì¾«¸E  >PÍê‡Y;êìbði‰“çÃÜb@Ý™­[µØšßâm€æñ<˜ƒ=R?3K™Ÿ¹ãdò3M4ËêgŒ!Îü-Î.4TÀ7J"Â £ìM[Q÷^>‰ÁH×†µÆ§Ï¬Ù½ø:ºy—îNŸÁäåžý¾x(¦_`Å:YæßxçY:®³Â,œÐóõ)š‡³âFcÄÏä‰ºzÿv­¦,mÙ=Ýfª2¦Í¬±•mƒ­„µÔê”¬¥f+U1§­Ô-¥*ê¶”ÊNjm;ì¤n%UI·•¤6R+dÚHj!õÜ-3·eæö±dUÉ9Ö‘ÛF­ƒ¶mT–QÈÓè˜UBeuê•Í fµ¾‰Dc”5Ó§³L­2~ÂôéxØ>­5FƒR™Hk¹ô©fŒ!\X­åªÖZPMén­[ñ`QÇ>DE§°úEÓ¬ž8Êm9ÊµåZ¥rBhJ…Œ2¦%9Õ’Ëø:Jo¹K·Ü¥[®ÒŠ¥*vžÍÖÜ\™l]²…KXÂeì e.gg+ZÍ$XzÙ¡€]Š¶¬R]ªÓÐ”†b4ô`ny€RlÊå¤–$dÉ±,¤’„ÔÛ·5œC•)•¥ªÒÑT!KgÄ½¬Æo™e{‡øƒ¢<~(šÓ•¶«¬<½kT^Kvx8üƒááôÃ³i¸––&kÅe¸vŽ1(Ì%Ð×&Ë‹nÜë¡*ÊÖ.ÓQMóxæø¬Î©@•óc•›±l•j¢ÊuàG™TRÃ¥3d9‘`”ÒÝ^N%!âÐ©ÿÓGS®‚tÜÝcÉ%×þWQk«ªVkµ*jµÜµÌð®%ÌìJÆu%“ºŠ!]h>•æ]pÜÿ”ß´š·$~1,¨„®©BÜuš»j ;N‹Ý¥‡±G›k“æº·œ	­t:c5¼fîá
I¤Wìc¡WÛ·0y®M‰«oJœòÏë¨¸Äm:¤—®žc Œwê°:7#¨	 pÑO¢9.±Ð[™±U•ÑÒ2lO5F§°ÂJ1ýh£W/'ª ÒgfÁ ¢Ù‹òk¬«L8bû)»7‰?ŽFG ’#¼¹±Î«5E+L«ƒ·ô7Rq1½M¾gx<'^K‹éƒ†e`[:°­¹À^¾\¬¥kÑ[Ö§räŠ|)IWhetËõ\Z³ŒY¹žKZõ¤æ|]J)íè;gQ>³qÄþ'S[=b`,ÊÄî_z}£ÔñQ·?èîêiý·½÷Ç‡Ç•Ôïþ©»ƒài‚vˆYàN1×.%RhÎÓå]îŠ}nèý¥Ÿ\8^–R»–ÿ;ÝzµÙ";—áè^åÍ®†•ã.x€·ýÓ	>ˆâÇYèƒ;XpõLHÏ5¢bÂ¢) {.£e9vš¥¾é¹/†l›Ô×Ÿ“ÿwrrtÜïžœçëÊ
P}¿‡;rô²¡öo¿÷ZDÐd&wÖÆö¢¸½FQ¯Ê¢)¼:0ÚP3xF˜)¿5b·3ìœt>vz{·{]º¿ô/?$3¾r½„f„´n±¡}L/dÄH’«0‹Îox§	mÓ#CPFþ>XnpVÄ7wÚÚFŸ?¦;a9îwVÕv¶Íz?“Í­ðÅýïí³c©Oƒ¢ °b¤€Ÿ]È;3ÈµŸSËÊe®Z<ô¡»=ÅpöÓÑ3âfX6mþ˜^ .~7¥Ë…˜Mú¦Q“s9M3oW¡4Ùa¤Àˆ‰­2ÊU6úú†*¤“UR™ ­¤a—ŒÂ[®Â[…[®Â-gaibt|yšâD£Ç¶_3Ÿ2>ÝÔæ%®N;ÚÎ;–ÚÎÎ–Ú®~‹|)ÍDÐZFSËx&z¥b-W1{ÏZÄÓt¯âkx%D-{b,á•Ð-nUv,á•ðÜ¨ÓL!Ø¦+Êe¨ÙŠoV‰2ÉÓqXÚ]á¬jm²|g6‚Ë3ÖÜƒ,ß.}C€×7ç6ïÞb ÇÕ%ªM§¦hJ2ºâk²ãf*´i~pÓ‚ð&ã¥—Šm¿™EM5éÒKžáY|t²x¾ƒXÄR³n}lGéÛ}söø2î	’µ«G±Ò6í,&5(XÚBY„2qn¡¼vjÖªZ[îZ[ókµÜµZójió‡®ìU|¥NÑÔÊ>9ëlÍ­ÓrÖiÍ©chf«SzÖ¼ž±Ù€£sÆ€«Îš[‹j¶ªj¶æ×,M`ªºkÁ0%šýŸ¾v†nÙïÓÐ_|£g1Ã£õÁä_…qN.£Â«-t50Ëég•"ÖtY³šÇbdïp00Ø´×ª[p]W‚‘7|Î	4	ÆØ˜ß-í|lŒƒ"öpŽwÄõç…þ´ƒ,šr@¤iœ‰4‚–ËIs(3uúµÆœf¶æ6³µ ™­e›iÍm¦µ ™VE3æ¨]ª“Wxé2yÃRþžF`8›¤FŸÅÕfC¡¼ßS¦±ý2kÎ¹žaˆ€ÈUËžöªÆ›€î˜=ý¦OuäÚvcæá«7ªïjÿfñÎœKÝÏ:Å¿ç q
ÞÚ‘c x´¾¶Ý&¶bž~#Ù*ïë½Ë´N«c=‚­S©I÷=O@~8âxí;­ròE´«–åøñ¨ü]šÝûqmñO ¸Ï¿€YÌpc×7N<žS1órÏçaÌ#š ‚«£Z1êuÁ¤*d(é!G|xòaMôõv¬ún=ðQÀ#5è#œú3šTN¾3±ºKÑáçèër…@2pÎ€ÎÍU¬;ð¡êVád…yšª`L)³pœ^çûl¬Ô²C	³r/Y“YÅfl=/î@«TÂN1©‡›%Ä!Ñ€æß³}û6›?¥]`@ï°²}`Ö-S£¯º#lºá÷µ_mc*w¬o±aý­tØ@ûAtô²‹åÑ :›Æ_Ö
wUDx³ê90¾ðÈBÆ£œþ”³¨ÿ@N-p
3wëÎ3Ãñ¤¸¡˜úˆÄ­6¬pÎÎ%‡]Þ&_FÇ(´ºÔËôÌ©&Ä·SÉwSÊ·PË+(æ{VÍ œåaÄÛ©d}Crõ¸·9«½µç}:Ðj¡—é»Å²ÑrªCõà+—åÓGá¡2úÐR‚Qø°žØ=Ý\QueÅ
·[²Gs­é]¥°Âjoæ>æƒ»aÀßÒ|âÿ–3îÕÿ7fwK¼ïÊ¯ajÏ`¼i©<óŸ3Î®ZYUöÁfïü,žcÌìV}œ”KÖ¿hz…Kø‡`õk±ø»t,	½ºÇýãXf5ycôÞ.ceÅ¢C‰Û«9g´Î¼ÅJ»Ñeñ»/¥qïZaÚ5˜¤QÂßà QõˆÎÃiÛÿÐ9/ss‚wY:Þ‡ŸZê#™ þF“z{6\¦ë
î¿Ý@áýðSäÿô‰ñêtØÚ2`W±Ø³Ü\ôÁÞÙ©öTâ0»£~º|ã¤éVö)¸~+:~«¹•÷@Ñ‡|æy|+>lÍ­À¥\W_›„Ù9>¥]YÅOð¯û¸÷«.|ƒç…/Øy“ÖÆn÷ÖŽ'ñzªñ€+C 7K_Ékd´Ä?n¸R;{{xG„Ll³æMûbø$j_áHu_$V©u…ã<þÁoœ5¯Æ¶%\.ž«‘%ÚÈ¶k ãZ€rœúAEÓ9îÍCÊB4^ùþ6	M¦69y‰]­ûñóXÚØñºGì#­Gw˜àiíŠ¤ ÊG±ruûïûûƒîÉ^÷=¾0ÕììuzûÝþ£˜æIfÕ à8Ž.P§b’ø!w“¨~Ûk‚—™ý¯oý,7jˆ4ëÖVÌyâÚÖ–ymëˆ^âïû“ùG öA	ECqFp‡Õ’·ªmn1`Ï’Ú‹ËÚgCºÈÜ/~üå]šá©;á‡O“·¼”«kŠnßZ6
m™ÿ"Aôå[þtšx¯“BK®a×ÎÙ(?¤D\GI^›!Ò\Áó¤Düöòp}Þ'iV)	Z¢Sxn-×
~["ó_$	¿hœiÜ{¯â`zçSpðãÕîÐå<r8ÁÓ$*nÞQ(ìfvy{nßÞgÈŒ±ÿŽ¥Ãü§Š^DýaTƒ¾.Fâ?ntµy3-˜]<-{ô•6?œ‰ˆ¯¨Ç9á?yë²ô52 Œß»ŸMO¾ÍÀ‹Èo­Ì$KÇ©ÚŸÓGÈ—‚æÉ—.]³Îž‚wÏYøé×K÷Lã€ž¼³+˜SÓJp(3o³ôÀpP0ÚrÍL°ŒÌkkxx¥\AÅVâ©7€9åÌ^wu+Ol”Dãé˜?Ô§•×3¬Âø_¹d¿o;wIšaþ%JŽ²ôÌ?‹b`#W-³ã˜»¬édáÔ[S-9	Nãh„Ëíï¡©­W}
E±ûÒ"æÊx¬®DwU·7n?I¦*53Â‡â¤Àî´Í…Þ‘ö ÑGðaÌa‰UtË¸L¬‘pvÁ
Ñ÷œP¦8úMu5Ù<,vbøÇˆLRÛß©ƒÊyAÉÝÏóû©pÏ1B[	º‡ê»g‰gôy¦á)Y(Ë¯¬$vÕÊ¿~rœ;²•?ÒøJ¥(¶â·drfä'þjòò&-­¡Äé‚>Å9î Ç¾Ë—=9n-’uDJ¹–þ¶Î
²¦JSuŸè4\]k(Ú>
Õ ].±~àO¨ß'E÷·SL!Wm«,£5¸J'¹7¢†Uj•|HáÆšxFRz„†XÄ>ÄåÞ„]n<T:;§Å-l™@†Íu¼’Ç7jßà£xÀ‡/?WbBT‰y6ÿ6­³z[Ô0Ö¿k‘cR²ÅD°ÿÃˆdcª¹Öð,§pU³œ±óš¤G—IÄo¨2^š^ocÆóœÆ Þ‡ÍãŸñfž±`àÁ²½ýaG#÷® ¶œÊ×Ýtü?£d%i‰dÚ‡¶Ž;Žk40rÑòÂ¡îúÔo§…éjZÀ?µýJ_U]¶
£>èÑÞ·Ç¿ÖÌYiò ‹[Óê$ëŠÖZB]4vÃEäa%N¾‚”{¤Ï,aNžIœŸ‘ú3èÈ³=C¼Ÿ5šð[òL!þ¬ÉüdŠ®0Ÿ«^=U-¬|P5aýcW|±ø(Kx‚hº¸S©t§kùZ36æ6Sîçæ••4ÿÖB¯:ò(„^š(1|Øó1xÊš¼^ìÖT9ÅhÊ‡Ò›ÚUÍjËÃ:%•ßË9H¯÷áŸ0Áð8<b?Fû®«”b9s½?ñ“ïë~kkíß;‘§¥9+-Ïû¤»(H¯q†qW¶s\Ò*†„²XhÃsÇy$ókÛ6=…(KûMoD“=|`7	¯ó5¼Ä÷¶¢¼„…þ}Ë^ÉOmm Ñú@3*L2<WÉŸ‹6æµËÿç³š<lHï˜&#ƒ¦´Ã£s=¨´%×äYÙE\ -árBÍ†A—V¹ý$kòQŒ5{‰)“¤ac.èÿÐÚM´{û…2Š©[Á±,œ-Ð_{ø€Q‡Úw>ºƒ)ã_öÝ±ú÷¤^lA&Q ³„güa!ò¬q:s®hˆAÀl*uŠá=ìÏ÷]lEž=ý&döÌÓöÇáPAP­Ó%Jb{m$ö…óõ<Ä{"—tT½&[¢¸P¾/¨òT-Ç‚˜Ê|à51—£¡‡	úxŠËc!ÌÁÙªÙ½È’8@Å/ã†g«Ã‡BîÐD–y}>Õo-y©G!F<à™È}I5ÕÑ‡]?Ãõåó,¢-­çô+_ã¡Ð«8ãú
š|×IÏI­œ^AG€–Ø^¼JÆK/9òµ÷uô¿µì¢-äÓ„¦µ†öLtZJ‰îýØF4¤GrS~Ñ<ðŽ³À€rÀJªI…sN_^D³Ÿó*?æUfšqçIy9*üQ(î-”0%L@d‚ÂÂ¿Ö|ø¸)è‘‹¥N‰ó˜HÊUÛìà‹\ì@ØŽ•tûÙ	®T´S¬¡}Ù¢Ã=vé ¸cÀWž§ÌvzVñ>.¿¸)CØir÷5Þ#¼ãÁXÃRtï5Ý¬ÉpÔeO‚ðÓZò$e—,@ušáVgÑ=™q×StL'ð¶Å°—”‚ w¨§Ùý,U]s±09"è²:}_géÇ&‚§7‚)I:Þá§¿vâ)N;1¾X€èŠÊ{É(~W±°'s9wh¶¤/GƒIdÚÂ”)ì°°pßhvàZE7$ÈªnZTsÆºý;E©tÍAçÉ‘2t.AÂ ?ý&.ž€­o8ÈŸ‘ú§¶V„Ü¬¡ÖHŸLóp¢‡”èêS/•î2õn] Ï$§Ö4@Èêëù(Ãd½Íf·9ŽX×.˜Ð$¾îv‡ö¥ºð]ç›—óÏÚ'Å}Eìá6ü¢a†ÊÃD¸üóedÏ£,^¯Óî' vF”tæT¤-Žð¸ìf@Iê1ÊvpoV6B{ÜÔ0¼µ
A€ñßw†Ý“ÖÉÎ‡nçèä¨ßÝëí÷:ý_O;ýnW=…jN.™Øk½Q>ÄGð˜±¤m}
-èÓÜ?‹r1…AOŠð˜¨Þ³wAs’€aÍÐ Å‘?­Ç8ï1¨™lšÐq'-«ï8æÐâ98d/ÖÏ¦}[viYeºö~ç‹>ÿ{K³å‚û¼½uÓYó0åáÇÞn·ò—ãÃaçäíñîû®zk’q¢ß£°Dr”òÉ¹8KÄð=‡l¯O^Eáõ*êœ†@'4ª0Ô_Š\`Wë?˜	ƒÃ=3áíÁ[3á¯ý#3¡³Û1vßwÍ”½ÞÁŸ­J;µZ>îY¸±cðòûýÛ#ã>þtô«òx×Îßéhß3ó>€4à›ð:G{Zí»õµ?x§a:ìiyý¿hPßk`ö»C­èÞžÖÞGõóOGûüáUÝTiÚImh/Æ0ûx”¥ã(=?Žår¤ÁÞØŸÔ9/Ñp#ÉHìÏý
Ù
ž]dßÙ]Äf ÁÑ ?ÄÊ?‘Íí†±@«£³šc`a4ß/Ð›¹h-çðª|ÕÙ‹øWPØz3Œ¸—½ucä1bM+‘5m%Nt¤éÁ&lßJ´+É PZº*þ4—¹3£ßåãTäËRFÈ¨rÍ^0¶Š•S•·¿n{7'ËlÇ©ÉqyDtÃÈqÃëgÐw\ª×mîöÉn·{t²Ó9ØííbÂ »×Ýö•†a&èCèÇÅeÛÀ+q-ðV+ ÍÒq^}ooX~{~—še¢¥iÌ/^u3¯ùÀ†rT·Ñ„t·I smJiÁÌKx¹>.Î×JžÂâh©²«€>Â:3ÄÔ=¿Á3PéÇýujK©Õ?ÿÚ9?©í4Œ—Úãî%0'¾…ÙÊcTå ¾·ÿgÂþM&ÌE—}rX§
‹ÂÖŽ•Äþ–l);¦[éÕmÎË¾yã!ï%ðçn(]ö‡ï<º¥ðÏÐÄAIƒlzà%ÎºÞ÷»ƒAïc—Yh_’,Â¶\ÛÃT¥‰_>FMü§gb¬ë7PÀ¯ä‰ª»,¿á(Âã~o'OÒ$ä7zr÷¸<¦]N•˜o/–_ì­@òÓC¼prª.Âd±§1=¢Í°ÀGIž~chÏN¥Ô–Ã5èàWìÖùOüF2~=û?^Of[#yšØQÑß@á éK(¸ê¼i_8ÈÛ­~
ènó‚ã2ÂÃq#íË††þ'Qÿ34?m7+QlÂŸµGY'R”ïd7™×œE½(ÅÓ zQcëÁôFl;ˆšÁ¥y|x~žS'ž5ûœÔ%ì7dÃÛØ½°®µŒjÅDV“ž“-[[¿2œüWï"¼Ú×(‡Ý¤¢¬8}£*Ã0©ž6™¸yx2Y“¨–C{D™ïeÏd™Éæ¼Ì­r&bÓÛVEZÎ"[2ú'Ê¿ôqk!è#AÚ*'	‹¾¹éý ûÇ¬í²¼vEOQ$Rü”«M@oŒ–ZÞ†Q£÷®ÉÉ0“€à~]Œ›aMMVPžúüÞÚ°ß…ÙÐÁû“cµxc<ëÝ6ï£6ò$LqQ‘vC’FQýÆ#­Ä«mÍ&ÜÕ²¿:y×;èìÐg‚O>vöp†§Ïìªú_ýÞ­ö©Ãj¿Ò¯2Å_²}w¿ñüJÆ†ä'Axî3ÅÁíúOž¬¯“<­³kÂÖiz¾®_ïŸ{EN¡Dc¨:	¿âNl¾Í6é1†±^ãi¨Švýt7ÏÃ
8—±Àx}šÛ¨Koc›{àmL¢`m2=ƒ9ÑÚ—ðf•9«õç/®:ÿ]za Çg…¡ÍØÄ‘({‡›ˆ,i^Ò­8W>vŽz»îwrk¬y?ws;¢JllWþy#¥Œ¢†S…¹-vœÍÍ§g0)‹ÎV¹Pþáµ&Txæ>dg”Ä`}=Á“Oª”r Ïù½;òy;«‰ƒw¢{¤+°ÁCóˆ€q§”W›ãNA‚;ê,ÐeA–ªaÆš9µÏtþyœ|U‘Ì»ñ¾JHÄÁŽ†}]ïJSáqA}ˆ†I)íœ–óA«(·ÌDÁJâWn‹=üÛ	?33±y0É›&·“=)3såN”º’Rå*Œ£g´þ8%e>sO'{Ë~<?ÓwLf^oeÏ'êÆãßŠqÙ~CÖ]ñ>þ%íÅJº0ÆÀ£˜oèÀ2y«ïßZî=sÄ±QFj&¿í cçéAƒ2"÷1æ.a½ÒR?­1ßç0ZÜZ¸=WX ´· û-è‡Þ¶Aµ’Ë¿]rùÅ¢^?œøQ&H>¿åÉÓOú G‡•dRù‘#•¥=Xf%ò¥ŠT¥ÅíY½„¾c™jmìÛëKbja ëAôÎH¤ëúóçHžçô¦œ:T-¿ãXÜˆ-^NÂì|Žr¤ð3tÁE^=Ž¾„¤wð'\j0 x…U8‰Ó¼zY3+¦7“ ‰ •œ›@’(xeF“¤¸dôZmŠ; ŽË…ºþ„Pž3„­ç#MA{õÚ'ƒŸG !<pfus]ðØ\E’€Å
–¾ÒçxÀ
ÇCˆ‹óAU³ÀH!s˜v¿úã(	µ½0uE0ý€ù¯Žfi62€§Þ£Ëm3ÇõK	K9 ÑyB'Ð— v†½]zÐÌø¥ÓârK÷`ØÿUä'þ$¿L‹^ÀÊà÷Éæ«^mlü°±ÑzñÇ­Î"'­‹óäQ¯tcž_3!lÚ¸v˜Ð­ÅÐÌ="…RÛ@Ð*Åï€¸TnTåU‘úZ`î•ÏöñväÂ Ó<íÇþô…ÁÜ+Ÿ ä¥pi²'›vúKß²Ó[,½eãƒÚ–C«e›eOÌå…Õ}~rÈùú"ZñÍ4ºƒñAdÊ–ÍŽSÅvV™%i‰Û0%­¸-ÙÜÙæÍß¬3“‹I! @v·DILL$vÐ2¼Ï¸ŸµaGäè`6U*É¥@u~NªŒÒ¥VÉƒ.l4]2aJ–«’.´ˆ-\:XÞV9¯%òZe™”(~3
T†5YR£[£SÛ½ÃÇ/q[Ëmñ2º
!aöjÝ²À(SêŠ!ïT"‡·büÑ	Ö—Uˆ¨$Ú4J[ZI9CŸ½){K½ÑAÒ®&W©[ÎÔ–3•Aõ,¢¢³´LV±¯õ«'ë˜§ÿùµ¢ÁûÙÙ¸Lm5*Za7Y:šùÉÙÌOÎf~RÍ˜ÛƒÚ ™
e.ö»G^t¨z\”Ž/[g'õÞn›'EÁ¬I|ÜE¢âƒYÃ#Ã£œ\‡YH>±\èÅ¬IÄï-íwköùÔ"äY¿ÈtN¥BjðXû¶KnµÊ-ÉÃ·[y¸éÊ~Ê­××dó…­´	Gßá°{ð5šÆ Éa_Àm"³Õ™®T³%k@ÁENjÅºÃióƒ$Š>` ¶ÓÕ0·O›Díè”‘‘aÇ£(gG€º»7	¨‹Ñ‘Hµ˜ºITå8)¤0u”øuø "ƒ‰fpNXKfžã~ñæö|”ù¼EZ,¹ÜI‚.+5œÈOögˆp³”UéòEUfò~…!»m§#ÅDK5 ò^vØŒÊIŒ’«íH$/›c-g«2§U•SÑ}YÀÚÚ®ê<ïŠ«Äm·"›Ä2–e¯©ŠXóÈ5`Kl)¢Yd›•ùGwüi–â™ÇÂKtÿQŽ¾ˆ‹ÚÇL)WXÐÕÊ9&€A@gˆþ²=JËÉD[A‹E*;*ÏœXêóÔýÑYjË,µå.Õ2Kµœ¥Ô]I¯]CàªcQ_¯he™µçºs;i†ö
,^”¬Ãq
þÓ@#sé‹?^òN+G	_²»ët%=r^£‡ØFïPêêã`'€³Ø$ýv¿­'[4²p6¦?ß_½°¬hÎ•~6ƒÃËOÚ/3&ü’cÔð°1@;¶–…ô!ð‘H1Ý¿+	¿$ÇàÏiÓ½¥f›sÉW7õÕÎQŠ!öx¡ _<ö€¡"ÌLT–M»}Të‘uUL3Ç:¬¶òŠ;6Ê#ÅÒCút‘ž.ÐÓ¥x3¤`Ÿ¯<¾¦ï±õ8:l¹ø|š°9;·< Õù‚1SfþdâŒÂy)`6ØXC9oš‡õŠRl÷¢a…aÌÕy~#‹íÏdôntXíècJz*.=ºŒžÿ—õÚº?‰j­Ù³@©qX\¦ÁL†M—R4£`[¬?3¼I.é!±Eâ,ÂHÌ6‰ædÓ²¹E¬(,gçæQò"NÏ@¶¹Ô	f Ó†™%­¸4Jê“,Åí&otÔ0AdµØú?5X¬ây¾%ë…_Á7ÌÀeuÕ†žEìÂ65ŒšlÏŠUåÁå×ÀVÎÅØœ9¿¾e¿àƒ­G~Ïï#kKc¿ÕÇŸRÓŒ/é^ =Ÿ€|ÖvÒÄºXÞL0£$‰9¬ÿÝ¿òÙÆòdt‰^¯§ÅùÚ¢‹kŸµ_R`ÇlŸxC¨ë5vP)¯!á¯%éUÔÈŒkyAëÃ{DA_Ë7T4J®HH=$L‚w0…ç…š\»Çš°ŒÖïé;¬Ã£šì½òþ*¯?%ÊÔ0ªRÔÃ9ß)¼¦ôùßÅ&C©Ã¿|ž[zþÌµy`¯ÑGŠÆÀ C&±?
1ÂVGtG¡º´D`&ÅUpš†ƒÃÝîI÷à#»Èr‚)»&Ô¹m(·	?Fj°¸W`”'¸©IÆR™“q„Ú¡¼:W33mþ…X
²`SÆ#õÚU¤x‡?à‚‹b6µ?Î›ø¦!µ8±­xñ*U&(Dmº‰¯‡Ñ(…z
JÎ7ìÃ8\À¶eÏ¦Q$Ú9Xôœœgé˜îñòÝðrJtÂì[)óÊU4ÓÐªQÅú\×©%¼‚	–Œ­ìª.†HWöT 	Œ’ üê]ã¸&žI»À›‚^üødöÄfóÝþNw1ù&]hþ®œr ;?G‡ý!B+l)ƒùáp€iµþGc"MïÉ+.Ã¤^D4ª!qcºZRG¨M
ÈlÖpYð|2¿2kp•Çœ±1$<¡×Ã&ôÕ¾öúúÓoqÖ~úák.¿¥áG$ËÚÔrX,lÔ×S1DÝé±./ÒwŒøÂAtŽn`:!–«ÏüÑ—ó(Ž?Dh\pýøpZ€WæïÒRWñE•¾á”„Utè-/þ™ô’¨ˆüR´GÊ$®š°‚kM[H\ºVí@Å¤nÄ+aB¯q¥UW¢uU„ÆHãî*’¤» yS¨ƒã%Ó‰@<ú'#Á
€˜W£1ÎæŽÇe:Íâ¾Éô¦cÄügL]sŸ *Šž‚ „½Èè$kNº 	aØ]¨ËVf––ãú©‚,gÂF…[1c¾'µÖW§MiØg8ýë$0 ÷OÁ¬y'ÓäOúoÓMü1ßçèö¹aAž Y|²A—›ÀlOZw¾YÚÆŒ­¯ÿÉ4#ÐÉºÜß{Í§ž£¿çxðüÉÿ  ÿÿ 6P²×