import * as fs from 'fs';
import * as path from 'path';
import { queryNeon, getNeonPool } from '../infrastructure/neon/db.js';
import { logger } from '../logger.js';
import { serverConfig } from '../config.js';
import { ExecutionEvidenceState, HistoricalEntryPolicy } from '../../types/index.js';
import { isProductionRecord } from './SignalLogger.js';

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
  displayPrice?: number;
  bid?: number;
  ask?: number;
  executionSide?: 'ASK' | 'BID';
  executionPrice?: number;
  spread?: number;
  entryTriggerTimestamp?: string | null;
  executionEvidence?: ExecutionEvidenceState;
  historicalEntryPolicy?: HistoricalEntryPolicy;
  expiredTimestamp?: number;
  expiresAt?: number;
  finalOutcome?: 'TP1_HIT' | 'TP2_HIT' | 'TP3_HIT' | 'SL_HIT' | 'STOPPED_OUT' | 'COMPLETED' | 'EXPIRED' | 'AMBIGUOUS';
  status: 'WAITING_ENTRY' | 'ACTIVE' | 'TP1_HIT' | 'TP2_HIT' | 'TP3_HIT' | 'SL_HIT' | 'STOPPED_OUT' | 'COMPLETED' | 'EXPIRED' | 'AMBIGUOUS';
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
  runnerStatus?: 'PENDING' | 'ACTIVE' | 'EXITED' | 'INELIGIBLE';
  runnerAllocationPct?: number;
  runnerActivatedAt?: string;
  runnerPeakPrice?: number;
  runnerTrailingStop?: number;
  runnerExitPrice?: number;
  runnerExitAt?: string;
  runnerExitReason?: string;
  timestamp: number; // creation timestamp
  updatedAt: number; // last updated timestamp
  detectedAt?: number;
  eventTime?: number;
  eventSource?: 'HISTORICAL_BACKFILL' | 'LIVE_STREAM' | 'TICK_EVALUATION';
  timeframeUsed?: string;
  isRecovered?: boolean;
  ambiguousDetails?: string;
  provenance?: 'LIVE' | 'HISTORICAL' | 'BACKTEST' | 'SIMULATION' | 'TEST';
  isSynthetic?: boolean;
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
            // Reject any fake 50000/49000/52000 records from memory initialization
            if (item && item.id && item.entryPrice !== 50000 && item.stopLoss !== 49000 && item.takeProfit !== 52000) {
              this.localLogs.set(item.id, item);
            }
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
    // 2. In production mode, signal_outcome_logs.json must NOT be used as a production persistence target
    if (serverConfig.getConfig().nodeEnv === 'production') {
      return;
    }

    try {
      const records = Array.from(this.localLogs.values())
        .filter((r) => r.entryPrice !== 50000 && r.stopLoss !== 49000 && r.takeProfit !== 52000)
        .sort((a, b) => b.updatedAt - a.updatedAt);
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
    const isProd = serverConfig.getConfig().nodeEnv === 'production';

    const isFakePrice = record.entryPrice === 50000 || record.stopLoss === 49000 || record.takeProfit === 52000;
    if (isFakePrice) {
      record.provenance = 'TEST';
      record.isSynthetic = true;
    }

    if (!record.provenance) {
      if (
        process.env.NODE_ENV === 'test' ||
        process.env.TEST_MODE === 'true' ||
        record.isSynthetic ||
        record.id.startsWith('test_') ||
        record.id.startsWith('sim_') ||
        record.id.startsWith('backtest_') ||
        isFakePrice
      ) {
        record.provenance = 'TEST';
      } else {
        record.provenance = 'LIVE';
      }
    }

    // Explicitly reject TEST, SIMULATION, BACKTEST, MOCK, SYNTHETIC or fake prices in production
    if (isProd) {
      if (!isProductionRecord(record as any)) {
        logger.warn(`[SignalOutcomeLogger] Rejected fake/test outcome record in production: ${record.id} (${record.symbol}, entryPrice=${record.entryPrice})`);
        return;
      }
    }

    this.localLogs.set(record.id, record);
    if (!isProd) {
      this.saveLocal();
    }

    if (getNeonPool()) {
      try {
        const cleanJson = JSON.parse(JSON.stringify(record));
        await queryNeon(
          `INSERT INTO signal_outcomes (id, signal_id, symbol, direction, status, pnl, r_multiple, timestamp, payload_json)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (id) DO UPDATE SET
             status = EXCLUDED.status,
             pnl = EXCLUDED.pnl,
             r_multiple = EXCLUDED.r_multiple,
             payload_json = EXCLUDED.payload_json`,
          [
            record.id,
            record.id,
            record.symbol,
            record.direction || 'BUY',
            record.status || record.finalOutcome || 'CLOSED',
            0,
            0,
            record.timestamp || Date.now(),
            JSON.stringify(cleanJson),
          ]
        );
      } catch (err) {
        logger.warn('[SignalOutcomeLogger] Neon failed to save record:', { error: String(err) });
      }
    }
  }

  /**
   * Retrieves an outcome log entry by ID
   */
  public static async getOutcome(id: string): Promise<SignalOutcomeRecord | null> {
    const isProd = serverConfig.getConfig().nodeEnv === 'production';

    if (isProd) {
      if (!getNeonPool()) {
        // Fail safely in production
        return null;
      }
      try {
        const rows = await queryNeon<{ payload_json: SignalOutcomeRecord }>(
          `SELECT payload_json FROM signal_outcomes WHERE id = $1`,
          [id]
        );
        if (rows.length > 0 && rows[0].payload_json) {
          const remote = rows[0].payload_json;
          if (isProductionRecord(remote as any)) {
            return remote;
          }
        }
      } catch (err) {
        logger.warn('[SignalOutcomeLogger] Neon failed to get record in production:', { error: String(err) });
      }
      return null;
    }

    this.init();
    const local = this.localLogs.get(id);
    if (local && local.entryPrice !== 50000) return local;

    if (getNeonPool()) {
      try {
        const rows = await queryNeon<{ payload_json: SignalOutcomeRecord }>(
          `SELECT payload_json FROM signal_outcomes WHERE id = $1`,
          [id]
        );
        if (rows.length > 0 && rows[0].payload_json) {
          const remote = rows[0].payload_json;
          this.localLogs.set(id, remote);
          return remote;
        }
      } catch (err) {
        logger.warn('[SignalOutcomeLogger] Neon failed to get record:', { error: String(err) });
      }
    }
    return null;
  }

  /**
   * Retrieves all outcome logs. Options enable filtering by production status or exact provenance.
   */
  public static async getOutcomeLogs(
    limit = 100,
    productionOnly = true,
    provenanceFilter?: string
  ): Promise<SignalOutcomeRecord[]> {
    const isProd = serverConfig.getConfig().nodeEnv === 'production';
    const isProductionQuery = productionOnly || isProd || (provenanceFilter && provenanceFilter.toUpperCase() === 'LIVE');

    if (isProductionQuery) {
      if (!getNeonPool()) {
        logger.warn('[SignalOutcomeLogger] FAIL SAFELY: Neon database unavailable for production outcome logs query. Returning empty list without local fallback.');
        return [];
      }

      try {
        const rows = await queryNeon<{ payload_json: SignalOutcomeRecord }>(
          `SELECT payload_json FROM signal_outcomes ORDER BY timestamp DESC LIMIT $1`,
          [limit * 2]
        );

        const records: SignalOutcomeRecord[] = [];
        for (const r of rows) {
          if (r.payload_json && isProductionRecord(r.payload_json as any)) {
            records.push(r.payload_json);
          }
        }
        return records.sort((a, b) => (b.updatedAt || b.timestamp) - (a.updatedAt || a.timestamp)).slice(0, limit);
      } catch (err) {
        logger.warn('[SignalOutcomeLogger] FAIL SAFELY: Neon failed to retrieve outcome logs. Returning empty list without local fallback:', { error: String(err) });
        return [];
      }
    }

    // Dev/Test only queries
    this.init();
    let records: SignalOutcomeRecord[] = [];

    if (getNeonPool()) {
      try {
        const rows = await queryNeon<{ payload_json: SignalOutcomeRecord }>(
          `SELECT payload_json FROM signal_outcomes ORDER BY timestamp DESC LIMIT $1`,
          [limit * 2]
        );
        records = rows.map((r) => r.payload_json);
      } catch (err) {
        records = Array.from(this.localLogs.values());
      }
    } else {
      records = Array.from(this.localLogs.values());
    }

    records = records.filter((r) => r.entryPrice !== 50000 && r.stopLoss !== 49000 && r.takeProfit !== 52000);

    if (provenanceFilter && provenanceFilter.toUpperCase() !== 'PRODUCTION') {
      records = records.filter((r) => (r.provenance || '').toUpperCase() === provenanceFilter.toUpperCase());
    }

    return records
      .sort((a, b) => (b.updatedAt || b.timestamp) - (a.updatedAt || a.timestamp))
      .slice(0, limit);
  }

  /**
   * Deletes an outcome log entry by ID
   */
  public static async deleteOutcome(id: string): Promise<boolean> {
    this.init();
    const hadLocal = this.localLogs.delete(id);
    if (hadLocal) {
      this.saveLocal();
    }

    if (getNeonPool()) {
      try {
        await queryNeon(`DELETE FROM signal_outcomes WHERE id = $1`, [id]);
        return true;
      } catch (err) {
        logger.warn('[SignalOutcomeLogger] Neon failed to delete record:', { id, error: String(err) });
      }
    }
    return hadLocal;
  }

  /**
   * Clears outcome logs
   */
  public static async clearLogs(): Promise<void> {
    this.init();
    this.localLogs.clear();
    this.saveLocal();

    if (getNeonPool()) {
      try {
        await queryNeon(`DELETE FROM signal_outcomes`);
      } catch (err) {
        logger.warn('[SignalOutcomeLogger] Neon failed to clear logs:', { error: String(err) });
      }
    }
  }
}
