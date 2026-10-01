/**
 * Neon PostgreSQL Adapter Implementation of Repository Interfaces
 *
 * Implements provider-neutral repositories using Neon serverless PostgreSQL connection pooling.
 * Converts between PostgreSQL relational rows / JSONB structures and domain models.
 */

import { queryNeon, withNeonTransaction, getNeonPool } from './db.js';
import { logger } from '../../logger.js';
import { NeonAuthService } from '../../auth/NeonAuthService.js';
import {
  User,
  Session,
  Signal,
  SignalOutcome,
  HistoricalTrade,
  AuditEvent,
  ScannerState,
} from '../types.js';
import {
  IAuthRepository,
  IUserRepository,
  ISessionRepository,
  ISignalRepository,
  ISignalOutcomeRepository,
  IHistoricalTradeRepository,
  IAuditEventRepository,
  IScannerStateRepository,
  RepositoryContainer,
} from '../repositories.js';

export class NeonSignalRepository implements ISignalRepository {
  async save(signal: Signal): Promise<{ success: boolean; error?: string }> {
    if (!getNeonPool()) return { success: false, error: 'Neon database unavailable' };

    try {
      const result = await withNeonTransaction(async (client) => {
        const fingerprint = `${signal.symbol}_${signal.direction}_${Math.floor((signal.timestamp || Date.now()) / (300 * 1000))}`;
        
        // Transactional duplicate check
        const fpCheck = await client.query(
          `SELECT id FROM signal_fingerprints WHERE fingerprint = $1`,
          [fingerprint]
        );

        if (fpCheck.rows.length > 0 && fpCheck.rows[0].id !== signal.id) {
          logger.warn('[NeonSignalRepository] Duplicate signal fingerprint rejected:', { fingerprint, symbol: signal.symbol });
          return { success: false, error: `Duplicate signal detected for ${signal.symbol} ${signal.direction}` };
        }

        // Insert fingerprint record
        await client.query(
          `INSERT INTO signal_fingerprints (id, fingerprint, symbol, direction, created_at)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (fingerprint) DO NOTHING`,
          [signal.id, fingerprint, signal.symbol, signal.direction, signal.timestamp || Date.now()]
        );

        const cleanJson = JSON.parse(JSON.stringify(signal));

        // Insert or update signal
        await client.query(
          `INSERT INTO signals (
            id, snapshot_id, symbol, direction, entry_price, stop_loss, take_profit,
            tp1, tp2, tp3, risk_reward_ratio, score, rank_tier, strategy, timeframe,
            data_source, status, timestamp, payload_json
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
          ON CONFLICT (id) DO UPDATE SET
            status = EXCLUDED.status,
            payload_json = EXCLUDED.payload_json,
            score = EXCLUDED.score`,
          [
            signal.id,
            signal.snapshotId || signal.id,
            signal.symbol,
            signal.direction,
            signal.entryPrice || 0,
            signal.stopLoss || 0,
            signal.takeProfit || 0,
            signal.tp1 || null,
            signal.tp2 || null,
            signal.tp3 || null,
            signal.riskRewardRatio || 0,
            signal.score || 0,
            signal.rankTier || 'QUALIFIED',
            signal.strategy || 'NVIDIA_ENHANCED',
            signal.timeframe || '1h',
            signal.dataSource || 'REALTIME',
            signal.status || 'ACTIVE',
            signal.timestamp || Date.now(),
            JSON.stringify(cleanJson),
          ]
        );

        return { success: true };
      });

      return result;
    } catch (err) {
      const errStr = String(err);
      logger.error('[NeonSignalRepository] Transactional save failed:', { error: errStr, id: signal.id });
      return { success: false, error: errStr };
    }
  }

  async findById(id: string): Promise<Signal | null> {
    if (!getNeonPool()) return null;
    try {
      const rows = await queryNeon<{ payload_json: Signal }>(
        `SELECT payload_json FROM signals WHERE id = $1`,
        [id]
      );
      if (rows.length === 0) return null;
      return rows[0].payload_json;
    } catch (err) {
      logger.warn('[NeonSignalRepository] findById failed:', { error: String(err), id });
      return null;
    }
  }

  async findActive(): Promise<Signal[]> {
    if (!getNeonPool()) return [];
    try {
      const rows = await queryNeon<{ payload_json: Signal }>(
        `SELECT payload_json FROM signals
         WHERE status IN ('ACTIVE', 'TP1_HIT', 'TP2_HIT', 'WAITING_ENTRY')
         ORDER BY timestamp DESC`
      );
      return rows.map((r) => r.payload_json);
    } catch (err) {
      logger.warn('[NeonSignalRepository] findActive failed:', { error: String(err) });
      return [];
    }
  }

  async findAll(limit = 200): Promise<Signal[]> {
    if (!getNeonPool()) return [];
    try {
      const rows = await queryNeon<{ payload_json: Signal }>(
        `SELECT payload_json FROM signals ORDER BY timestamp DESC LIMIT $1`,
        [limit]
      );
      return rows.map((r) => r.payload_json);
    } catch (err) {
      logger.warn('[NeonSignalRepository] findAll failed:', { error: String(err) });
      return [];
    }
  }

  async updateStatus(id: string, status: string, metadata?: Partial<Signal>): Promise<void> {
    if (!getNeonPool()) return;
    try {
      await withNeonTransaction(async (client) => {
        const existingRes = await client.query(`SELECT payload_json FROM signals WHERE id = $1`, [id]);
        if (existingRes.rows.length === 0) return;

        const currentSignal: Signal = existingRes.rows[0].payload_json;
        const updatedSignal = { ...currentSignal, ...metadata, status };

        await client.query(
          `UPDATE signals SET status = $1, payload_json = $2 WHERE id = $3`,
          [status, JSON.stringify(updatedSignal), id]
        );
      });
    } catch (err) {
      logger.warn('[NeonSignalRepository] updateStatus failed:', { error: String(err), id, status });
    }
  }

  async delete(id: string): Promise<void> {
    if (!getNeonPool()) return;
    try {
      await queryNeon(`DELETE FROM signals WHERE id = $1`, [id]);
    } catch (err) {
      logger.warn('[NeonSignalRepository] delete failed:', { error: String(err), id });
    }
  }

  async clear(): Promise<void> {
    if (!getNeonPool()) return;
    try {
      await queryNeon(`DELETE FROM signals`);
    } catch (err) {
      logger.warn('[NeonSignalRepository] clear failed:', { error: String(err) });
    }
  }
}

export class NeonSignalOutcomeRepository implements ISignalOutcomeRepository {
  async save(outcome: SignalOutcome): Promise<void> {
    if (!getNeonPool()) return;
    try {
      await withNeonTransaction(async (client) => {
        const cleanJson = JSON.parse(JSON.stringify(outcome));
        await client.query(
          `INSERT INTO signal_outcomes (id, signal_id, symbol, direction, status, pnl, r_multiple, timestamp, payload_json)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (id) DO UPDATE SET
             status = EXCLUDED.status,
             pnl = EXCLUDED.pnl,
             r_multiple = EXCLUDED.r_multiple,
             payload_json = EXCLUDED.payload_json`,
          [
            outcome.id,
            outcome.id,
            outcome.symbol,
            outcome.direction || 'BUY',
            outcome.status || 'CLOSED',
            0,
            0,
            outcome.timestamp || Date.now(),
            JSON.stringify(cleanJson),
          ]
        );

        // Also update performance_history summary table inside transaction
        await client.query(
          `INSERT INTO historical_trades (id, symbol, direction, entry_price, stop_loss, take_profit, outcome, pnl, r_multiple, entered_at, payload_json)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           ON CONFLICT (id) DO UPDATE SET
             outcome = EXCLUDED.outcome,
             pnl = EXCLUDED.pnl,
             r_multiple = EXCLUDED.r_multiple`,
          [
            outcome.id,
            outcome.symbol,
            outcome.direction || 'BUY',
            outcome.entryPrice || 0,
            outcome.stopLoss || 0,
            outcome.takeProfit || 0,
            outcome.status || 'CLOSED',
            0,
            0,
            outcome.timestamp || Date.now(),
            JSON.stringify(cleanJson),
          ]
        );
      });
    } catch (err) {
      logger.warn('[NeonSignalOutcomeRepository] save failed:', { error: String(err), id: outcome.id });
    }
  }

  async findById(id: string): Promise<SignalOutcome | null> {
    if (!getNeonPool()) return null;
    try {
      const rows = await queryNeon<{ payload_json: SignalOutcome }>(
        `SELECT payload_json FROM signal_outcomes WHERE id = $1`,
        [id]
      );
      if (rows.length === 0) return null;
      return rows[0].payload_json;
    } catch (err) {
      logger.warn('[NeonSignalOutcomeRepository] findById failed:', { error: String(err), id });
      return null;
    }
  }

  async findAll(limit = 200): Promise<SignalOutcome[]> {
    if (!getNeonPool()) return [];
    try {
      const rows = await queryNeon<{ payload_json: SignalOutcome }>(
        `SELECT payload_json FROM signal_outcomes ORDER BY timestamp DESC LIMIT $1`,
        [limit]
      );
      return rows.map((r) => r.payload_json);
    } catch (err) {
      logger.warn('[NeonSignalOutcomeRepository] findAll failed:', { error: String(err) });
      return [];
    }
  }

  async findBySymbol(symbol: string): Promise<SignalOutcome[]> {
    if (!getNeonPool()) return [];
    try {
      const clean = symbol.toUpperCase().trim();
      const rows = await queryNeon<{ payload_json: SignalOutcome }>(
        `SELECT payload_json FROM signal_outcomes WHERE symbol = $1 ORDER BY timestamp DESC`,
        [clean]
      );
      return rows.map((r) => r.payload_json);
    } catch (err) {
      logger.warn('[NeonSignalOutcomeRepository] findBySymbol failed:', { error: String(err), symbol });
      return [];
    }
  }

  async delete(id: string): Promise<void> {
    if (!getNeonPool()) return;
    try {
      await queryNeon(`DELETE FROM signal_outcomes WHERE id = $1`, [id]);
    } catch (err) {
      logger.warn('[NeonSignalOutcomeRepository] delete failed:', { error: String(err), id });
    }
  }

  async clear(): Promise<void> {
    if (!getNeonPool()) return;
    try {
      await queryNeon(`DELETE FROM signal_outcomes`);
    } catch (err) {
      logger.warn('[NeonSignalOutcomeRepository] clear failed:', { error: String(err) });
    }
  }
}

export class NeonScannerStateRepository implements IScannerStateRepository {
  async getCapState(dateStr: string): Promise<ScannerState | null> {
    if (!getNeonPool()) return null;
    try {
      const rows = await queryNeon<{ state_json: ScannerState }>(
        `SELECT state_json FROM scanner_state WHERE date = $1`,
        [dateStr]
      );
      if (rows.length === 0) return null;
      return rows[0].state_json;
    } catch (err) {
      logger.warn('[NeonScannerStateRepository] getCapState failed:', { error: String(err), dateStr });
      return null;
    }
  }

  async saveCapState(state: ScannerState): Promise<void> {
    if (!getNeonPool()) return;
    try {
      await withNeonTransaction(async (client) => {
        const cleanJson = JSON.parse(JSON.stringify(state));
        await client.query(
          `INSERT INTO scanner_state (date, daily_signal_count, daily_signal_cap, state_json, updated_at)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (date) DO UPDATE SET
             daily_signal_count = EXCLUDED.daily_signal_count,
             daily_signal_cap = EXCLUDED.daily_signal_cap,
             state_json = EXCLUDED.state_json,
             updated_at = EXCLUDED.updated_at`,
          [
            state.date,
            state.dailySignalCount || 0,
            state.dailySignalCap || 10,
            JSON.stringify(cleanJson),
            Date.now(),
          ]
        );
      });
    } catch (err) {
      logger.warn('[NeonScannerStateRepository] saveCapState failed:', { error: String(err) });
    }
  }

  async acquireLock(instanceId: string, ttlMs: number): Promise<boolean> {
    if (!getNeonPool()) return true;
    try {
      return await withNeonTransaction(async (client) => {
        const now = Date.now();
        const res = await client.query(
          `SELECT instance_id, lock_acquired_at, is_scanning FROM scanner_locks WHERE lock_name = 'scanner' FOR UPDATE`
        );

        if (res.rows.length > 0) {
          const row = res.rows[0];
          if (row.is_scanning && now < Number(row.lock_acquired_at) + ttlMs) {
            if (row.instance_id !== instanceId) {
              return false; // Active lock held by another instance
            }
          }
        }

        await client.query(
          `INSERT INTO scanner_locks (lock_name, instance_id, lock_acquired_at, is_scanning)
           VALUES ('scanner', $1, $2, true)
           ON CONFLICT (lock_name) DO UPDATE SET
             instance_id = EXCLUDED.instance_id,
             lock_acquired_at = EXCLUDED.lock_acquired_at,
             is_scanning = true`,
          [instanceId, now]
        );

        return true;
      });
    } catch (err) {
      logger.warn('[NeonScannerStateRepository] acquireLock failed:', { error: String(err) });
      return true;
    }
  }

  async releaseLock(instanceId: string): Promise<void> {
    if (!getNeonPool()) return;
    try {
      await queryNeon(
        `UPDATE scanner_locks SET is_scanning = false, lock_acquired_at = 0, instance_id = ''
         WHERE lock_name = 'scanner' AND instance_id = $1`,
        [instanceId]
      );
    } catch (err) {
      logger.warn('[NeonScannerStateRepository] releaseLock failed:', { error: String(err) });
    }
  }
}

export class NeonUserRepository implements IUserRepository {
  async findById(id: string): Promise<User | null> {
    if (!getNeonPool()) return null;
    try {
      const rows = await queryNeon<{
        id: string;
        email: string;
        role: 'admin' | 'user' | 'viewer';
        display_name: string;
        created_at: string;
        last_login_at: string;
      }>(`SELECT * FROM users WHERE id = $1`, [id]);

      if (rows.length === 0) return null;
      const u = rows[0];
      return {
        id: u.id,
        email: u.email,
        role: u.role,
        displayName: u.display_name || undefined,
        createdAt: Number(u.created_at),
        lastLoginAt: u.last_login_at ? Number(u.last_login_at) : undefined,
      };
    } catch (err) {
      logger.warn('[NeonUserRepository] findById failed:', { error: String(err), id });
      return null;
    }
  }

  async findByEmail(email: string): Promise<User | null> {
    if (!getNeonPool()) return null;
    try {
      const rows = await queryNeon<{
        id: string;
        email: string;
        role: 'admin' | 'user' | 'viewer';
        display_name: string;
        created_at: string;
        last_login_at: string;
      }>(`SELECT * FROM users WHERE LOWER(email) = LOWER($1)`, [email]);

      if (rows.length === 0) return null;
      const u = rows[0];
      return {
        id: u.id,
        email: u.email,
        role: u.role,
        displayName: u.display_name || undefined,
        createdAt: Number(u.created_at),
        lastLoginAt: u.last_login_at ? Number(u.last_login_at) : undefined,
      };
    } catch (err) {
      logger.warn('[NeonUserRepository] findByEmail failed:', { error: String(err), email });
      return null;
    }
  }

  async save(user: User): Promise<void> {
    if (!getNeonPool()) return;
    try {
      await queryNeon(
        `INSERT INTO users (id, email, role, display_name, created_at, last_login_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO UPDATE SET
           email = EXCLUDED.email,
           role = EXCLUDED.role,
           display_name = EXCLUDED.display_name,
           last_login_at = EXCLUDED.last_login_at`,
        [
          user.id,
          user.email,
          user.role,
          user.displayName || null,
          user.createdAt,
          user.lastLoginAt || null,
        ]
      );
    } catch (err) {
      logger.warn('[NeonUserRepository] save failed:', { error: String(err), id: user.id });
    }
  }

  async delete(id: string): Promise<void> {
    if (!getNeonPool()) return;
    try {
      await queryNeon(`DELETE FROM users WHERE id = $1`, [id]);
    } catch (err) {
      logger.warn('[NeonUserRepository] delete failed:', { error: String(err), id });
    }
  }
}

export class NeonSessionRepository implements ISessionRepository {
  async findById(id: string): Promise<Session | null> {
    if (!getNeonPool()) return null;
    try {
      const rows = await queryNeon<{
        id: string;
        user_id: string;
        token: string;
        expires_at: string;
        created_at: string;
        is_valid: boolean;
        client_ip: string;
        user_agent: string;
      }>(`SELECT * FROM sessions WHERE id = $1`, [id]);

      if (rows.length === 0) return null;
      const s = rows[0];
      return {
        id: s.id,
        userId: s.user_id,
        token: s.token,
        expiresAt: Number(s.expires_at),
        createdAt: Number(s.created_at),
        isValid: s.is_valid,
        clientIp: s.client_ip || undefined,
        userAgent: s.user_agent || undefined,
      };
    } catch (err) {
      logger.warn('[NeonSessionRepository] findById failed:', { error: String(err), id });
      return null;
    }
  }

  async findByToken(token: string): Promise<Session | null> {
    if (!getNeonPool()) return null;
    try {
      const rows = await queryNeon<{
        id: string;
        user_id: string;
        token: string;
        expires_at: string;
        created_at: string;
        is_valid: boolean;
        client_ip: string;
        user_agent: string;
      }>(`SELECT * FROM sessions WHERE token = $1 AND is_valid = true`, [token]);

      if (rows.length === 0) return null;
      const s = rows[0];
      return {
        id: s.id,
        userId: s.user_id,
        token: s.token,
        expiresAt: Number(s.expires_at),
        createdAt: Number(s.created_at),
        isValid: s.is_valid,
        clientIp: s.client_ip || undefined,
        userAgent: s.user_agent || undefined,
      };
    } catch (err) {
      logger.warn('[NeonSessionRepository] findByToken failed:', { error: String(err) });
      return null;
    }
  }

  async save(session: Session): Promise<void> {
    if (!getNeonPool()) return;
    try {
      await queryNeon(
        `INSERT INTO sessions (id, user_id, token, expires_at, created_at, is_valid, client_ip, user_agent)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO UPDATE SET
           is_valid = EXCLUDED.is_valid,
           expires_at = EXCLUDED.expires_at`,
        [
          session.id,
          session.userId,
          session.token,
          session.expiresAt,
          session.createdAt,
          session.isValid,
          session.clientIp || null,
          session.userAgent || null,
        ]
      );
    } catch (err) {
      logger.warn('[NeonSessionRepository] save failed:', { error: String(err), id: session.id });
    }
  }

  async delete(id: string): Promise<void> {
    if (!getNeonPool()) return;
    try {
      await queryNeon(`DELETE FROM sessions WHERE id = $1`, [id]);
    } catch (err) {
      logger.warn('[NeonSessionRepository] delete failed:', { error: String(err), id });
    }
  }

  async deleteExpired(): Promise<number> {
    if (!getNeonPool()) return 0;
    try {
      const now = Date.now();
      const rows = await queryNeon(`DELETE FROM sessions WHERE expires_at < $1 OR is_valid = false`, [now]);
      return (rows as any).rowCount || 0;
    } catch (err) {
      logger.warn('[NeonSessionRepository] deleteExpired failed:', { error: String(err) });
      return 0;
    }
  }
}

export class NeonHistoricalTradeRepository implements IHistoricalTradeRepository {
  async save(trade: HistoricalTrade): Promise<void> {
    if (!getNeonPool()) return;
    try {
      const cleanJson = JSON.parse(JSON.stringify(trade));
      await queryNeon(
        `INSERT INTO historical_trades (
          id, symbol, direction, entry_price, exit_price, stop_loss, take_profit,
          tp1, tp2, tp3, outcome, pnl, r_multiple, entered_at, closed_at, strategy,
          timeframe, rank_tier, score, payload_json
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
        ON CONFLICT (id) DO UPDATE SET
          outcome = EXCLUDED.outcome,
          pnl = EXCLUDED.pnl,
          r_multiple = EXCLUDED.r_multiple,
          payload_json = EXCLUDED.payload_json`,
        [
          trade.id,
          trade.symbol,
          trade.direction,
          trade.entryPrice,
          trade.exitPrice || null,
          trade.stopLoss,
          trade.takeProfit,
          trade.tp1 || null,
          trade.tp2 || null,
          trade.tp3 || null,
          trade.outcome,
          trade.pnl || null,
          trade.rMultiple || null,
          trade.enteredAt,
          trade.closedAt || null,
          trade.strategy || null,
          trade.timeframe || null,
          trade.rankTier || null,
          trade.score || null,
          JSON.stringify(cleanJson),
        ]
      );
    } catch (err) {
      logger.warn('[NeonHistoricalTradeRepository] save failed:', { error: String(err), id: trade.id });
    }
  }

  async findAll(limit = 200): Promise<HistoricalTrade[]> {
    if (!getNeonPool()) return [];
    try {
      const rows = await queryNeon<{ payload_json: HistoricalTrade }>(
        `SELECT payload_json FROM historical_trades ORDER BY entered_at DESC LIMIT $1`,
        [limit]
      );
      return rows.map((r) => r.payload_json);
    } catch (err) {
      logger.warn('[NeonHistoricalTradeRepository] findAll failed:', { error: String(err) });
      return [];
    }
  }

  async findBySymbol(symbol: string): Promise<HistoricalTrade[]> {
    if (!getNeonPool()) return [];
    try {
      const clean = symbol.toUpperCase().trim();
      const rows = await queryNeon<{ payload_json: HistoricalTrade }>(
        `SELECT payload_json FROM historical_trades WHERE symbol = $1 ORDER BY entered_at DESC`,
        [clean]
      );
      return rows.map((r) => r.payload_json);
    } catch (err) {
      logger.warn('[NeonHistoricalTradeRepository] findBySymbol failed:', { error: String(err), symbol });
      return [];
    }
  }

  async delete(id: string): Promise<void> {
    if (!getNeonPool()) return;
    try {
      await queryNeon(`DELETE FROM historical_trades WHERE id = $1`, [id]);
    } catch (err) {
      logger.warn('[NeonHistoricalTradeRepository] delete failed:', { error: String(err), id });
    }
  }

  async clear(): Promise<void> {
    if (!getNeonPool()) return;
    try {
      await queryNeon(`DELETE FROM historical_trades`);
    } catch (err) {
      logger.warn('[NeonHistoricalTradeRepository] clear failed:', { error: String(err) });
    }
  }
}

export class NeonAuditEventRepository implements IAuditEventRepository {
  async log(event: AuditEvent): Promise<void> {
    if (!getNeonPool()) return;
    try {
      await queryNeon(
        `INSERT INTO audit_events (id, security_id, action, timestamp, severity, details_json, client_ip, user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO NOTHING`,
        [
          event.id || `audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          event.securityId,
          event.action,
          event.timestamp || Date.now(),
          event.severity || 'INFO',
          event.details ? JSON.stringify(event.details) : null,
          event.clientIp || null,
          event.userId || null,
        ]
      );
    } catch (err) {
      logger.warn('[NeonAuditEventRepository] log failed:', { error: String(err) });
    }
  }

  async findRecent(limit = 100): Promise<AuditEvent[]> {
    if (!getNeonPool()) return [];
    try {
      const rows = await queryNeon<{
        id: string;
        security_id: string;
        action: string;
        timestamp: string;
        severity: 'INFO' | 'WARN' | 'HIGH' | 'CRITICAL';
        details_json: Record<string, unknown>;
        client_ip: string;
        user_id: string;
      }>(`SELECT * FROM audit_events ORDER BY timestamp DESC LIMIT $1`, [limit]);

      return rows.map((r) => ({
        id: r.id,
        securityId: r.security_id,
        action: r.action,
        timestamp: Number(r.timestamp),
        severity: r.severity,
        details: r.details_json || undefined,
        clientIp: r.client_ip || undefined,
        userId: r.user_id || undefined,
      }));
    } catch (err) {
      logger.warn('[NeonAuditEventRepository] findRecent failed:', { error: String(err) });
      return [];
    }
  }

  async clear(): Promise<void> {
    if (!getNeonPool()) return;
    try {
      await queryNeon(`DELETE FROM audit_events`);
    } catch (err) {
      logger.warn('[NeonAuditEventRepository] clear failed:', { error: String(err) });
    }
  }
}

export class NeonAuthRepository implements IAuthRepository {
  async verifyToken(token: string): Promise<{ valid: boolean; user?: User; error?: string }> {
    if (!token || token.length < 8) {
      return { valid: false, error: 'Invalid token' };
    }

    if (!getNeonPool()) {
      // Fail closed: Never use hard-coded token or fallback ADMIN identity
      return { valid: false, error: 'Neon database unavailable (Fail Closed)' };
    }

    try {
      const res = await NeonAuthService.validateSession(token);
      if (res.valid && res.user) {
        return {
          valid: true,
          user: {
            id: res.user.id,
            email: res.user.email,
            role: res.user.role === 'ADMIN' ? 'admin' : 'user',
            displayName: res.user.displayName,
            createdAt: res.user.createdAt,
            lastLoginAt: res.user.lastLoginAt,
          },
        };
      }
      return { valid: false, error: res.error || 'Token expired or invalid' };
    } catch (err) {
      return { valid: false, error: String(err) };
    }
  }

  async createSession(userId: string, ttlMs = 24 * 60 * 60 * 1000): Promise<Session> {
    const session: Session = {
      id: `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      userId,
      token: `tok_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`,
      createdAt: Date.now(),
      expiresAt: Date.now() + ttlMs,
      isValid: true,
    };

    if (getNeonPool()) {
      const sessionRepo = new NeonSessionRepository();
      await sessionRepo.save(session);
    }

    return session;
  }

  async revokeSession(sessionId: string): Promise<void> {
    if (!getNeonPool()) return;
    const sessionRepo = new NeonSessionRepository();
    const session = await sessionRepo.findById(sessionId);
    if (session) {
      session.isValid = false;
      await sessionRepo.save(session);
    }
  }

  /**
   * First-Admin establishment using NeonAuthService.
   */
  async establishFirstAdmin(adminEmail: string, passwordHash?: string): Promise<User> {
    const regResult = await NeonAuthService.register({
      email: adminEmail,
      password: passwordHash || 'TemporaryInitialAdmin123!',
      displayName: 'System Administrator',
    });
    if (!regResult.user) {
      throw new Error(regResult.error || 'Failed to establish first admin');
    }
    return {
      id: regResult.user.id,
      email: regResult.user.email,
      role: 'admin',
      displayName: regResult.user.displayName,
      createdAt: regResult.user.createdAt,
    };
  }
}

/**
 * Creates the complete Neon Repository Container for production.
 */
export function createNeonRepositories(): RepositoryContainer {
  return {
    auth: new NeonAuthRepository(),
    user: new NeonUserRepository(),
    session: new NeonSessionRepository(),
    signal: new NeonSignalRepository(),
    signalOutcome: new NeonSignalOutcomeRepository(),
    historicalTrade: new NeonHistoricalTradeRepository(),
    auditEvent: new NeonAuditEventRepository(),
    scannerState: new NeonScannerStateRepository(),
  };
}
