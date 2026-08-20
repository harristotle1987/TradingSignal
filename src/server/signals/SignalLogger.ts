/**
 * Dedicated Signal Log Persistence & Analysis Engine
 *
 * Implements a strict, dedicated SIGNAL LOG separate from general application/system logs.
 *
 * Every recorded signal entry contains:
 * - Timestamp
 * - Asset / Symbol
 * - Market Type: Crypto / Forex / Stocks
 * - Provider Used
 * - Direction: BUY / SELL
 * - Entry Price
 * - Stop Loss
 * - Take Profit
 * - Risk-to-Reward Ratio (R:R)
 * - Deterministic Score
 * - Confidence Score
 * - Strategy / Confluence Used
 * - Market Regime (TREND, RANGE, BREAKOUT, HIGH-VOLATILITY, LOW-VOLATILITY)
 * - Signal Status: ACTIVE / TP HIT / SL HIT / EXPIRED / INVALIDATED
 * - Snapshot ID
 *
 * Durability:
 * - Persisted synchronously to local `signal_logs.json`
 * - Persisted asynchronously to Firestore collection `signal_logs`
 * - Restored seamlessly across container / Vercel restarts
 */

import * as fs from 'fs';
import * as path from 'path';
import { TradingSignal } from '../../types/index.js';
import { getFirestoreAdmin } from '../firebaseAdmin.js';
import { logger } from '../logger.js';

export type SignalLogStatus = 'ACTIVE' | 'TP HIT' | 'SL HIT' | 'EXPIRED' | 'INVALIDATED' | 'TP1 HIT' | 'TP2 HIT' | 'TP3 HIT' | 'AMBIGUOUS';

export interface SignalLogRecord {
  id: string;
  timestamp: number;
  symbol: string;
  marketType: 'Crypto' | 'Forex' | 'Stocks';
  provider: string;
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
  score: number;
  confidenceScore: number;
  targetQualityScore?: number;
  strategy: string;
  marketRegime: string;
  status: SignalLogStatus;
  snapshotId: string;
  confluenceReasons?: string[];
  timeframe?: string;
  aiAssessment?: string;
  isTopTrade?: boolean;
  isBestTrade?: boolean;
  entryHitTimestamp?: string | null;
  updatedAt?: number;
}

const LOCAL_SIGNAL_LOG_PATH = path.join(process.cwd(), 'signal_logs.json');
const FIRESTORE_COLLECTION = 'signal_logs';

export class SignalLogger {
  private static logs: Map<string, SignalLogRecord> = new Map();
  private static isInitialized = false;
  private static lastFirestoreSync = 0;

  /**
   * Helper to detect Market Type from Symbol structure
   */
  public static detectMarketType(symbol: string): 'Crypto' | 'Forex' | 'Stocks' {
    const s = symbol.toUpperCase();
    if (
      s.includes('USDT') ||
      s.includes('BTC') ||
      s.includes('ETH') ||
      s.includes('SOL') ||
      s.includes('XRP') ||
      s.includes('BNB') ||
      s.includes('ADA') ||
      s.includes('AVAX') ||
      s.includes('LINK') ||
      s.includes('DOGE')
    ) {
      return 'Crypto';
    }
    if (
      s.includes('EUR') ||
      s.includes('GBP') ||
      s.includes('JPY') ||
      s.includes('AUD') ||
      s.includes('CAD') ||
      s.includes('CHF') ||
      s.includes('NZD') ||
      (s.length === 6 && s.endsWith('USD'))
    ) {
      return 'Forex';
    }
    return 'Stocks';
  }

  /**
   * Re-synchronizes in-memory and local disk cache with master Firestore logs collection.
   */
  public static async syncFromFirestore(): Promise<void> {
    const firestore = getFirestoreAdmin();
    if (!firestore) return;

    try {
      const snapshot = await firestore.collection(FIRESTORE_COLLECTION).get();
      const firestoreIds = new Set<string>();

      snapshot.forEach((doc) => {
        const data = doc.data() as SignalLogRecord;
        if (data && data.id) {
          firestoreIds.add(data.id);
          const existing = this.logs.get(data.id);
          if (!existing || (data.updatedAt || data.timestamp) >= (existing.updatedAt || existing.timestamp)) {
            this.logs.set(data.id, data);
          }
        }
      });

      // Purge any log entries from memory that are missing in Firestore (indicating cross-pod/user deletion)
      for (const id of this.logs.keys()) {
        if (!firestoreIds.has(id)) {
          this.logs.delete(id);
        }
      }

      this.lastFirestoreSync = Date.now();
      this.flushToDisk();
    } catch (err) {
      logger.debug('[SignalLogger] Firestore synchronization deferred:', { reason: String(err) });
    }
  }

  /**
   * Initializes signal log state from local disk and Firestore
   */
  public static async init(): Promise<void> {
    if (this.isInitialized) return;

    // 1. Read from local disk file first
    try {
      if (fs.existsSync(LOCAL_SIGNAL_LOG_PATH)) {
        const raw = fs.readFileSync(LOCAL_SIGNAL_LOG_PATH, 'utf-8');
        const parsed: SignalLogRecord[] = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (item && item.id) {
              this.logs.set(item.id, item);
            }
          }
          logger.info(`[SignalLogger] Loaded ${this.logs.size} signal records from local storage.`);
        }
      }
    } catch (err) {
      logger.warn('[SignalLogger] Could not read local signal log file:', { error: String(err) });
    }

    // 2. Sync from Firestore Admin if available
    await this.syncFromFirestore();

    this.isInitialized = true;
  }

  /**
   * Flushes in-memory signal logs to disk synchronously
   */
  private static flushToDisk(): void {
    try {
      const records = Array.from(this.logs.values()).sort((a, b) => b.timestamp - a.timestamp);
      fs.writeFileSync(LOCAL_SIGNAL_LOG_PATH, JSON.stringify(records, null, 2), 'utf-8');
    } catch (err) {
      logger.warn('[SignalLogger] Failed to write signal logs to disk:', { error: String(err) });
    }
  }

  /**
   * Persists a record into Firestore asynchronously
   */
  private static syncToFirestore(record: SignalLogRecord): void {
    const firestore = getFirestoreAdmin();
    if (!firestore) return;

    firestore
      .collection(FIRESTORE_COLLECTION)
      .doc(record.id)
      .set(record, { merge: true })
      .catch((err) => {
        logger.debug(`[SignalLogger] Firestore sync deferred for signal ${record.id}`, { error: String(err) });
      });
  }

  /**
   * Records a newly generated trading signal into the dedicated Signal Log.
   */
  public static async logSignal(
    signal: TradingSignal,
    marketRegime = 'TREND',
    overrideStatus?: SignalLogStatus
  ): Promise<SignalLogRecord> {
    await this.init();

    const id = signal.id || signal.snapshotId || `${signal.symbol}_${signal.timestamp}`;
    const snapshotId = signal.snapshotId || id;
    const marketType = this.detectMarketType(signal.symbol);
    const provider = signal.dataSource || (marketType === 'Crypto' ? 'Bitget' : 'Twelve Data');
    const strategy =
      signal.strategy ||
      (signal.confluenceReasons && signal.confluenceReasons.length > 0
        ? signal.confluenceReasons.join('; ')
        : 'Multi-Strategy Confluence');

    const status: SignalLogStatus = overrideStatus || 'ACTIVE';

    const record: SignalLogRecord = {
      id,
      snapshotId,
      timestamp: signal.validatedAt || signal.timestamp || Date.now(),
      symbol: signal.symbol,
      marketType,
      provider,
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
      riskRewardRatio: Number(signal.riskRewardRatio?.toFixed(2) || 2.0),
      score: signal.score || 0,
      confidenceScore: signal.confidenceScore || 0,
      targetQualityScore: signal.targetQualityScore,
      strategy,
      marketRegime,
      status,
      confluenceReasons: signal.confluenceReasons,
      timeframe: signal.timeframe || '1h',
      aiAssessment: signal.aiAssessment,
      isTopTrade: signal.isTopTrade || signal.rankTier === 'BEST_TRADE',
      isBestTrade: signal.isBestTrade || signal.rankTier === 'BEST_TRADE',
      entryHitTimestamp: signal.entryHitTimestamp ?? null,
      updatedAt: Date.now(),
    };

    this.logs.set(id, record);
    this.flushToDisk();
    this.syncToFirestore(record);

    logger.info(
      `[SignalLogger] RECORDED SIGNAL LOG: ${record.symbol} [${record.direction}] | Type: ${record.marketType} | Provider: ${record.provider} | Status: ${record.status} | Regime: ${record.marketRegime} | Score: ${record.score} | Snapshot: ${record.snapshotId}`
    );

    return record;
  }

  /**
   * Updates the lifecycle status of an existing signal in the Signal Log.
   */
  public static async updateStatus(signalId: string, status: SignalLogStatus): Promise<boolean> {
    await this.init();

    let record = this.logs.get(signalId);

    // If not found by exact ID, search by snapshotId or symbol prefix
    if (!record) {
      for (const r of this.logs.values()) {
        if (r.snapshotId === signalId || r.id.startsWith(signalId)) {
          record = r;
          break;
        }
      }
    }

    if (!record) {
      logger.warn(`[SignalLogger] Cannot update status: signal ${signalId} not found in Signal Log.`);
      return false;
    }

    record.status = status;
    record.updatedAt = Date.now();

    this.logs.set(record.id, record);
    this.flushToDisk();
    this.syncToFirestore(record);

    logger.info(`[SignalLogger] UPDATED SIGNAL LOG STATUS: ${record.symbol} -> ${status}`);
    return true;
  }

  /**
   * Updates the take-profit targets and risk-reward ratio of an existing signal in the Signal Log.
   */
  public static async updateTps(
    signalId: string,
    tp1: number,
    tp2: number,
    tp3: number,
    takeProfit: number,
    riskRewardRatio: number
  ): Promise<boolean> {
    await this.init();

    let record = this.logs.get(signalId);

    // Search by snapshotId or exact id if not found by key
    if (!record) {
      for (const r of this.logs.values()) {
        if (r.snapshotId === signalId || r.id === signalId || r.id.startsWith(signalId)) {
          record = r;
          break;
        }
      }
    }

    if (!record) {
      logger.warn(`[SignalLogger] Cannot update TPs: signal ${signalId} not found in Signal Log.`);
      return false;
    }

    record.tp1 = tp1;
    record.tp2 = tp2;
    record.tp3 = tp3;
    record.takeProfit = takeProfit;
    record.riskRewardRatio = riskRewardRatio;
    record.updatedAt = Date.now();

    this.logs.set(record.id, record);
    this.flushToDisk();
    this.syncToFirestore(record);

    logger.info(`[SignalLogger] UPDATED SIGNAL LOG TPs for ${record.symbol}: T1: ${tp1}, T2: ${tp2}, T3: ${tp3}`);
    return true;
  }

  /**
   * Retrieves all dedicated Signal Log records (sorted newest first).
   */
  public static async getSignalLogs(limit = 100): Promise<SignalLogRecord[]> {
    await this.init();

    const now = Date.now();
    if (now - this.lastFirestoreSync > 5000) {
      await this.syncFromFirestore();
    }

    const sorted = Array.from(this.logs.values()).sort((a, b) => b.timestamp - a.timestamp);
    return sorted.slice(0, limit);
  }

  /**
   * Retrieves the most recent signal for a symbol from the signal log.
   */
  public static getLastSignalForSymbol(symbol: string): SignalLogRecord | undefined {
    const sym = symbol.toUpperCase();
    const records = Array.from(this.logs.values())
      .filter((r) => r.symbol === sym)
      .sort((a, b) => b.timestamp - a.timestamp);
    return records[0];
  }

  /**
   * Deletes a single signal log record by ID from memory, disk, and Firestore.
   */
  public static async deleteLog(id: string): Promise<boolean> {
    await this.init();

    let targetKey: string | null = null;
    if (this.logs.has(id)) {
      targetKey = id;
    } else {
      for (const [key, r] of this.logs.entries()) {
        if (r.snapshotId === id || r.id === id || key.startsWith(id)) {
          targetKey = key;
          break;
        }
      }
    }

    if (!targetKey || !this.logs.has(targetKey)) {
      logger.warn(`[SignalLogger] Cannot delete log entry: ID ${id} not found.`);
      return false;
    }

    this.logs.delete(targetKey);
    this.flushToDisk();

    const firestore = getFirestoreAdmin();
    if (firestore) {
      firestore
        .collection(FIRESTORE_COLLECTION)
        .doc(targetKey)
        .delete()
        .catch((err) => {
          logger.debug(`[SignalLogger] Firestore delete deferred for ${targetKey}:`, { error: String(err) });
        });
    }

    logger.info(`[SignalLogger] DELETED INDIVIDUAL SIGNAL LOG RECORD: ${targetKey}`);
    return true;
  }

  /**
   * Clears the signal log cache and disk file.
   */
  public static async clearLogs(): Promise<void> {
    this.logs.clear();
    this.flushToDisk();

    const firestore = getFirestoreAdmin();
    if (firestore) {
      try {
        const snapshot = await firestore.collection(FIRESTORE_COLLECTION).get();
        const batch = firestore.batch();
        snapshot.docs.forEach((doc) => batch.delete(doc.ref));
        await batch.commit();
      } catch (err) {
        logger.debug('[SignalLogger] Firestore clear logs deferred:', { error: String(err) });
      }
    }
  }
}
