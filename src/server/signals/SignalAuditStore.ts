/**
 * Signal Audit Explanation & Transparency Store
 *
 * Stores complete backend explanation records for every candidate setup processed (both generated & rejected):
 * - Strategies that passed
 * - Strategies that failed
 * - Market regime
 * - ATR value
 * - Data freshness (age in seconds)
 * - Provider price agreement (status & disagreement %)
 * - Expected R:R ratio
 * - Rejection reason (or null if accepted)
 * - Deterministic Signal Fingerprint
 *
 * Persisted to disk (`signal_audits.json`) and Firestore collection `scanner_audit_logs`.
 */

import * as fs from 'fs';
import * as path from 'path';
import { queryNeon, getNeonPool } from '../infrastructure/neon/db.js';
import { logger } from '../logger.js';

export interface SignalAuditRecord {
  id: string;
  timestamp: number;
  symbol: string;
  direction?: 'BUY' | 'SELL';
  timeframe: string;
  primaryStrategy: string;
  strategy?: string;
  passedStrategies: string[];
  failedStrategies: string[];
  marketRegime: string;
  regime?: string;
  threshold?: number;
  actualScore?: number;
  marginAboveThreshold?: number;
  atr: number;
  dataFreshnessSeconds: number;
  providerAgreement: boolean;
  providerAgreementPct?: number;
  expectedRR: number;
  score: number;
  status: 'ACCEPTED' | 'REJECTED' | 'CANDIDATE' | 'WATCHING';
  rejectionReason: string | null;
  fingerprint: string;
}

const LOCAL_AUDIT_PATH = path.join(process.cwd(), 'signal_audits.json');

export class SignalAuditStore {
  private static auditLogs: Map<string, SignalAuditRecord> = new Map();
  private static isInitialized = false;
  // Must match the on-disk retention in persistLocal() below — otherwise
  // the in-memory Map grows forever even though the disk snapshot is
  // bounded.
  private static readonly MAX_IN_MEMORY_RECORDS = 1000;

  /**
   * Keeps the in-memory audit map bounded to the most recent records.
   */
  private static pruneInMemory(): void {
    if (this.auditLogs.size <= this.MAX_IN_MEMORY_RECORDS) return;
    const sorted = Array.from(this.auditLogs.entries()).sort((a, b) => b[1].timestamp - a[1].timestamp);
    this.auditLogs = new Map(sorted.slice(0, this.MAX_IN_MEMORY_RECORDS));
  }

  private static init(): void {
    if (this.isInitialized) return;

    if (process.env.NODE_ENV !== 'production') {
      try {
        if (fs.existsSync(LOCAL_AUDIT_PATH)) {
          const raw = fs.readFileSync(LOCAL_AUDIT_PATH, 'utf-8');
          const parsed: SignalAuditRecord[] = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            for (const item of parsed) {
              this.auditLogs.set(item.id, item);
            }
          }
        }
      } catch (err) {
        logger.warn('[SignalAuditStore] Could not load persisted audit records:', err);
      }
    }

    this.isInitialized = true;
  }

  private static persistLocal(): void {
    if (process.env.NODE_ENV === 'production') return;
    try {
      const arr = Array.from(this.auditLogs.values())
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 1000); // Retain latest 1000 records locally
      fs.writeFileSync(LOCAL_AUDIT_PATH, JSON.stringify(arr, null, 2), 'utf-8');
    } catch (err) {
      logger.warn('[SignalAuditStore] Failed to write audit records to local disk:', err);
    }
  }

  private static async persistNeon(record: SignalAuditRecord): Promise<void> {
    try {
      if (getNeonPool()) {
        await queryNeon(
          `INSERT INTO audit_events (id, security_id, action, timestamp, severity, details_json)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (id) DO NOTHING`,
          [
            record.id,
            'SIGNAL_AUDIT',
            `Candidate ${record.symbol} (${record.status}): ${record.rejectionReason || 'Accepted'}`,
            record.timestamp,
            record.status === 'ACCEPTED' ? 'INFO' : 'WARN',
            JSON.stringify(record),
          ]
        );
      }
    } catch (err) {
      logger.debug('[SignalAuditStore] Neon sync omitted:', { error: String(err) });
    }
  }

  /**
   * Logs a full backend audit explanation record for a signal scan candidate
   */
  public static logAudit(input: Omit<SignalAuditRecord, 'id' | 'timestamp'>): SignalAuditRecord {
    this.init();

    const now = Date.now();
    const id = `audit_${now}_${input.symbol}_${Math.random().toString(36).substring(2, 7)}`;

    const record: SignalAuditRecord = {
      id,
      timestamp: now,
      ...input,
    };

    this.auditLogs.set(id, record);
    this.pruneInMemory();
    this.persistLocal();
    this.persistNeon(record).catch(() => {});

    logger.info(`[Signal Audit Logged] ${input.symbol} (${input.status}): ${input.rejectionReason || 'Accepted for Signal Dispatch'}`);
    return record;
  }

  /**
   * Returns recent audit logs for debugging or backend review
   */
  public static getAuditLogs(limit: number = 100): SignalAuditRecord[] {
    this.init();
    return Array.from(this.auditLogs.values())
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  /**
   * Returns audit logs for a specific symbol
   */
  public static getAuditLogsBySymbol(symbol: string, limit: number = 20): SignalAuditRecord[] {
    this.init();
    const sym = symbol.toUpperCase();
    return Array.from(this.auditLogs.values())
      .filter((r) => r.symbol === sym)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }
}
