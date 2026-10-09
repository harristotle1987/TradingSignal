/**
 * Mock Neon Database In-Memory Store
 *
 * Provides a faithful in-memory simulation of Neon PostgreSQL for testing environments
 * where an external DATABASE_URL is not configured.
 * Implements:
 * - Table storage for users, sessions, signals, signal_outcomes, scanner_state, etc.
 * - PostgreSQL partial unique index enforcement: idx_users_single_admin
 * - Atomic transactional serialization: pg_advisory_xact_lock
 * - Strict Fail-Closed semantics when disabled
 */

import { logger } from '../../logger.js';

export interface MockUserRow {
  id: string;
  email: string;
  password_hash: string;
  role: string;
  display_name?: string | null;
  created_at: number;
  last_login_at?: number | null;
}

export interface MockSessionRow {
  id: string;
  user_id: string;
  token: string;
  expires_at: number;
  created_at: number;
  is_valid: boolean;
  client_ip?: string | null;
  user_agent?: string | null;
}

export class MockNeonStore {
  public users: Map<string, MockUserRow> = new Map();
  public sessions: Map<string, MockSessionRow> = new Map();
  public signals: Map<string, any> = new Map();
  public signalOutcomes: Map<string, any> = new Map();
  public historicalTrades: Map<string, any> = new Map();
  public auditEvents: any[] = [];
  public scannerState: Map<string, any> = new Map();
  public fingerprints: Map<string, any> = new Map();
  public cooldowns: Map<string, any> = new Map();

  private advisoryLockHeld = false;
  private advisoryWaiters: (() => void)[] = [];

  public clear(): void {
    this.users.clear();
    this.sessions.clear();
    this.signals.clear();
    this.signalOutcomes.clear();
    this.historicalTrades.clear();
    this.auditEvents = [];
    this.scannerState.clear();
    this.fingerprints.clear();
    this.cooldowns.clear();
    this.advisoryLockHeld = false;
    this.advisoryWaiters = [];
  }

  public async acquireAdvisoryLock(): Promise<void> {
    if (!this.advisoryLockHeld) {
      this.advisoryLockHeld = true;
      return;
    }
    await new Promise<void>((resolve) => {
      this.advisoryWaiters.push(resolve);
    });
    this.advisoryLockHeld = true;
  }

  public releaseAdvisoryLock(): void {
    this.advisoryLockHeld = false;
    const next = this.advisoryWaiters.shift();
    if (next) {
      next();
    }
  }

  public async withTransaction<T>(
    callback: (client: { query: (sql: string, params?: any[]) => Promise<any> }) => Promise<T>
  ): Promise<T> {
    let lockHeldByThisTx = false;
    const client = {
      query: async (sql: string, params: any[] = []) => {
        if (sql.includes('pg_advisory_xact_lock')) {
          await this.acquireAdvisoryLock();
          lockHeldByThisTx = true;
          return { rows: [{ pg_advisory_xact_lock: true }], rowCount: 1 };
        }
        return await this.query(sql, params);
      },
    };

    try {
      const result = await callback(client);
      return result;
    } finally {
      if (lockHeldByThisTx) {
        this.releaseAdvisoryLock();
      }
    }
  }

  public async query(sql: string, params: any[] = []): Promise<{ rows: any[]; rowCount: number }> {
    const normalized = sql.trim().replace(/\s+/g, ' ');

    // 1. Advisory Lock
    if (normalized.includes('pg_advisory_xact_lock')) {
      await this.acquireAdvisoryLock();
      return { rows: [{ pg_advisory_xact_lock: true }], rowCount: 1 };
    }

    // 2. Count admin users: SELECT COUNT(*) as admin_count FROM users WHERE UPPER(role) = 'ADMIN'
    if (normalized.includes('COUNT(*)') && normalized.toLowerCase().includes('from users') && normalized.toUpperCase().includes('ADMIN')) {
      let count = 0;
      for (const u of this.users.values()) {
        if (u.role && u.role.toUpperCase() === 'ADMIN') {
          count++;
        }
      }
      return { rows: [{ count, admin_count: count }], rowCount: 1 };
    }

    // 3. Find admin user limit 1: SELECT id FROM users WHERE UPPER(role) = 'ADMIN'
    if (normalized.toLowerCase().includes('from users') && normalized.toUpperCase().includes('ADMIN') && normalized.toLowerCase().includes('limit 1')) {
      for (const u of this.users.values()) {
        if (u.role && u.role.toUpperCase() === 'ADMIN') {
          return { rows: [{ id: u.id, email: u.email, role: u.role, created_at: u.created_at }], rowCount: 1 };
        }
      }
      return { rows: [], rowCount: 0 };
    }

    // 4. Find user by email: SELECT * FROM users WHERE LOWER(email) = LOWER($1)
    if (normalized.toLowerCase().includes('from users where lower(email)')) {
      const searchEmail = String(params[0] || '').toLowerCase().trim();
      for (const u of this.users.values()) {
        if (u.email.toLowerCase().trim() === searchEmail) {
          return { rows: [{ ...u }], rowCount: 1 };
        }
      }
      return { rows: [], rowCount: 0 };
    }

    // 5. Find user by id: SELECT * FROM users WHERE id = $1
    if (normalized.toLowerCase().includes('from users where id = $1')) {
      const searchId = String(params[0] || '');
      const u = this.users.get(searchId);
      if (u) {
        return { rows: [{ ...u }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }

    // 6. Insert into users:
    // INSERT INTO users (id, email, password_hash, role, display_name, created_at) VALUES (...)
    if (normalized.toLowerCase().startsWith('insert into users')) {
      const [id, email, passwordHash, role, displayName, createdAt] = params;
      const cleanEmail = String(email || '').toLowerCase().trim();
      const normRole = String(role || 'USER').toUpperCase();

      // Email uniqueness check
      for (const existing of this.users.values()) {
        if (existing.email.toLowerCase().trim() === cleanEmail && existing.id !== id) {
          throw new Error(`duplicate key value violates unique constraint "users_email_key"`);
        }
      }

      // PostgreSQL idx_users_single_admin UNIQUE constraint enforcement:
      if (normRole === 'ADMIN') {
        for (const existing of this.users.values()) {
          if (existing.role && existing.role.toUpperCase() === 'ADMIN' && existing.id !== id) {
            throw new Error(`duplicate key value violates unique constraint "idx_users_single_admin"`);
          }
        }
      }

      const userRow: MockUserRow = {
        id: String(id),
        email: String(email),
        password_hash: String(passwordHash || ''),
        role: normRole,
        display_name: displayName || null,
        created_at: Number(createdAt || Date.now()),
        last_login_at: null,
      };
      this.users.set(userRow.id, userRow);
      return { rows: [{ ...userRow }], rowCount: 1 };
    }

    // 7. Update user last_login_at
    if (normalized.toLowerCase().includes('update users set last_login_at')) {
      const lastLogin = Number(params[0]);
      const id = String(params[1]);
      const u = this.users.get(id);
      if (u) {
        u.last_login_at = lastLogin;
      }
      return { rows: [], rowCount: u ? 1 : 0 };
    }

    // 8. Session validation join query:
    // SELECT u.id, u.email, u.role, u.display_name, u.created_at, u.last_login_at, s.id AS session_id, s.expires_at, s.is_valid
    // FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.token = $1 AND s.is_valid = true AND s.expires_at > $2
    if (normalized.toLowerCase().includes('from sessions s join users u on s.user_id = u.id')) {
      const token = String(params[0] || '');
      const minExpiry = Number(params[1] || 0);

      for (const s of this.sessions.values()) {
        if (s.token === token && s.is_valid && s.expires_at > minExpiry) {
          const u = this.users.get(s.user_id);
          if (u) {
            return {
              rows: [
                {
                  id: u.id,
                  email: u.email,
                  role: u.role,
                  display_name: u.display_name,
                  created_at: u.created_at,
                  last_login_at: u.last_login_at,
                  session_id: s.id,
                  expires_at: s.expires_at,
                  is_valid: s.is_valid,
                },
              ],
              rowCount: 1,
            };
          }
        }
      }
      return { rows: [], rowCount: 0 };
    }

    // 9. Find session by token: SELECT * FROM sessions WHERE token = $1
    if (normalized.toLowerCase().includes('from sessions where token = $1')) {
      const token = String(params[0] || '');
      for (const s of this.sessions.values()) {
        if (s.token === token) {
          return { rows: [{ ...s }], rowCount: 1 };
        }
      }
      return { rows: [], rowCount: 0 };
    }

    // 10. Insert into sessions
    if (normalized.toLowerCase().startsWith('insert into sessions')) {
      const [id, userId, token, expiresAt, createdAt, isValid, clientIp, userAgent] = params;
      const sessionRow: MockSessionRow = {
        id: String(id),
        user_id: String(userId),
        token: String(token),
        expires_at: Number(expiresAt),
        created_at: Number(createdAt || Date.now()),
        is_valid: Boolean(isValid !== false),
        client_ip: clientIp || null,
        user_agent: userAgent || null,
      };
      this.sessions.set(sessionRow.id, sessionRow);
      return { rows: [{ ...sessionRow }], rowCount: 1 };
    }

    // 11. Revoke session / update sessions: UPDATE sessions SET is_valid = false WHERE token = $1
    if (normalized.toLowerCase().includes('update sessions set is_valid = false')) {
      const token = String(params[0] || '');
      let updated = 0;
      for (const s of this.sessions.values()) {
        if (s.token === token) {
          s.is_valid = false;
          updated++;
        }
      }
      return { rows: [], rowCount: updated };
    }

    // 12. Delete expired sessions
    if (normalized.toLowerCase().includes('delete from sessions where expires_at < $1')) {
      const minExpiry = Number(params[0]);
      let deleted = 0;
      for (const [id, s] of this.sessions.entries()) {
        if (s.expires_at < minExpiry || !s.is_valid) {
          this.sessions.delete(id);
          deleted++;
        }
      }
      return { rows: [], rowCount: deleted };
    }

    // 13. scanner_state queries
    if (normalized.toLowerCase().includes('from scanner_state where date = $1')) {
      const date = String(params[0] || '');
      const state = this.scannerState.get(date);
      if (state) {
        return { rows: [{ state_json: state }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }

    if (normalized.toLowerCase().startsWith('insert into scanner_state')) {
      const date = String(params[0] || '');
      let stateObj: any = {};
      for (const p of params) {
        if (typeof p === 'string' && p.startsWith('{') && p.endsWith('}')) {
          try {
            stateObj = JSON.parse(p);
            break;
          } catch {
            // ignore
          }
        } else if (typeof p === 'object' && p !== null) {
          stateObj = p;
          break;
        }
      }

      const isReset = normalized.toLowerCase().includes('daily_signal_count = 0') || normalized.includes('($1, 0,');
      const count = isReset ? 0 : (stateObj.dailySignalCount ?? (typeof params[1] === 'number' ? params[1] : 0));
      const cap = stateObj.dailySignalCap ?? (typeof params[2] === 'number' && params[2] <= 1000 ? params[2] : (typeof params[1] === 'number' && params[1] <= 1000 ? params[1] : 5));

      const record = {
        date,
        ...stateObj,
        dailySignalCount: count,
        dailySignalCap: cap,
      };
      this.scannerState.set(date, record);
      return { rows: [{ date, state_json: record, ...record }], rowCount: 1 };
    }

    // 14. signal_fingerprints queries
    if (normalized.toLowerCase().includes('from signal_fingerprints where fingerprint = $1')) {
      const fp = String(params[0] || '');
      const rec = this.fingerprints.get(fp);
      if (rec) {
        return { rows: [{ ...rec }], rowCount: 1 };
      }
      for (const val of this.signals.values()) {
        if (val.fingerprint === fp) {
          return { rows: [{ id: val.id, fingerprint: fp }], rowCount: 1 };
        }
      }
      return { rows: [], rowCount: 0 };
    }

    if (normalized.toLowerCase().startsWith('insert into signal_fingerprints')) {
      const [id, fingerprint, symbol, direction, createdAt] = params;
      const fpKey = String(fingerprint);
      if (this.fingerprints.has(fpKey)) {
        // Idempotency: ON CONFLICT DO NOTHING returns 0 inserted rows
        return { rows: [], rowCount: 0 };
      }
      const record = { id: String(id), fingerprint: fpKey, symbol: String(symbol), direction: String(direction), created_at: Number(createdAt || Date.now()) };
      this.fingerprints.set(fpKey, record);
      return { rows: [{ ...record }], rowCount: 1 };
    }

    // 14b. asset_cooldowns queries
    if (normalized.toLowerCase().includes('from asset_cooldowns where symbol = $1')) {
      const sym = String(params[0] || '').toUpperCase();
      const rec = this.cooldowns.get(sym);
      if (rec) {
        return { rows: [{ ...rec }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }

    if (normalized.toLowerCase().includes('from asset_cooldowns')) {
      const rows = Array.from(this.cooldowns.values());
      return { rows, rowCount: rows.length };
    }

    if (normalized.toLowerCase().startsWith('insert into asset_cooldowns')) {
      const sym = String(params[0] || '').toUpperCase();
      const lastMs = Number(params[1] || Date.now());
      let stratCooldowns = params[2];
      if (typeof stratCooldowns === 'string') {
        try { stratCooldowns = JSON.parse(stratCooldowns); } catch { stratCooldowns = {}; }
      }
      const updated = Number(params[3] || Date.now());
      const record = { symbol: sym, last_asset_signal_ms: lastMs, strategy_cooldowns: stratCooldowns || {}, updated_at: updated };
      this.cooldowns.set(sym, record);
      return { rows: [{ ...record }], rowCount: 1 };
    }

    // 15. signals queries
    if (normalized.toLowerCase().startsWith('insert into signals')) {
      const id = String(params[0] || '');
      const payloadStr = params[params.length - 1];
      let payloadObj: any = {};
      try {
        payloadObj = typeof payloadStr === 'string' ? JSON.parse(payloadStr) : payloadStr;
      } catch {
        payloadObj = {};
      }
      const status = String(params[16] || payloadObj.status || 'ACTIVE');
      const signalRecord = {
        id,
        snapshot_id: String(params[1] || id),
        symbol: String(params[2] || payloadObj.symbol || ''),
        direction: String(params[3] || payloadObj.direction || ''),
        status,
        timestamp: Number(params[17] || payloadObj.timestamp || Date.now()),
        payload_json: { ...payloadObj, id, status },
      };
      this.signals.set(id, signalRecord);
      return { rows: [{ ...signalRecord }], rowCount: 1 };
    }

    if (normalized.toLowerCase().startsWith('update signals set status =')) {
      if (normalized.toLowerCase().includes('payload_json =')) {
        const status = String(params[0] || '');
        let payloadObj: any = {};
        try {
          payloadObj = typeof params[1] === 'string' ? JSON.parse(params[1]) : params[1];
        } catch {
          payloadObj = {};
        }
        const id = String(params[2] || '');
        const existing = this.signals.get(id);
        if (existing) {
          existing.status = status;
          existing.payload_json = { ...(existing.payload_json || {}), ...payloadObj, status };
          return { rows: [{ ...existing }], rowCount: 1 };
        }
      } else {
        const status = String(params[0] || '');
        const id = String(params[1] || '');
        const existing = this.signals.get(id);
        if (existing) {
          existing.status = status;
          if (existing.payload_json) {
            existing.payload_json.status = status;
          }
          return { rows: [{ ...existing }], rowCount: 1 };
        }
      }
      return { rows: [], rowCount: 0 };
    }

    if (normalized.toLowerCase().startsWith('delete from signals')) {
      if (normalized.toLowerCase().includes('where id = $1')) {
        const id = String(params[0] || '');
        const deleted = this.signals.delete(id);
        for (const [fp, rec] of this.fingerprints.entries()) {
          if (rec.id === id) {
            this.fingerprints.delete(fp);
          }
        }
        return { rows: [], rowCount: deleted ? 1 : 0 };
      } else if (normalized.toLowerCase().includes('where id in')) {
        let deletedCount = 0;
        for (const p of params) {
          const idStr = String(p);
          if (this.signals.delete(idStr)) {
            deletedCount++;
            for (const [fp, rec] of this.fingerprints.entries()) {
              if (rec.id === idStr) {
                this.fingerprints.delete(fp);
              }
            }
          }
        }
        return { rows: [], rowCount: deletedCount };
      }
      this.signals.clear();
      this.fingerprints.clear();
      return { rows: [], rowCount: 0 };
    }

    if (normalized.toLowerCase().includes('from signals')) {
      if (normalized.toLowerCase().includes('where status in')) {
        const activeRows: any[] = [];
        for (const s of this.signals.values()) {
          const stat = (s.status || s.payload_json?.status || '').toUpperCase();
          if (['ACTIVE', 'TP1_HIT', 'TP2_HIT', 'WAITING_ENTRY'].includes(stat)) {
            activeRows.push({ ...s, payload_json: s.payload_json || s });
          }
        }
        activeRows.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        return { rows: activeRows, rowCount: activeRows.length };
      } else if (normalized.toLowerCase().includes('where id = $1')) {
        const id = String(params[0] || '');
        const s = this.signals.get(id);
        if (s) {
          return { rows: [{ ...s, payload_json: s.payload_json || s }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      } else {
        const allRows: any[] = [];
        for (const s of this.signals.values()) {
          allRows.push({ ...s, payload_json: s.payload_json || s });
        }
        allRows.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        const limit = typeof params[0] === 'number' ? params[0] : 200;
        const sliced = allRows.slice(0, limit);
        return { rows: sliced, rowCount: sliced.length };
      }
    }

    // 16. push_subscriptions queries
    if (normalized.toLowerCase().includes('from push_subscriptions')) {
      const activeSubs: any[] = [];
      for (const sub of (this as any).pushSubscriptions?.values() || []) {
        if (sub.active) {
          activeSubs.push(sub);
        }
      }
      return { rows: activeSubs, rowCount: activeSubs.length };
    }

    if (normalized.toLowerCase().startsWith('insert into push_subscriptions')) {
      if (!(this as any).pushSubscriptions) {
        (this as any).pushSubscriptions = new Map();
      }
      const [id, endpoint, p256dh, auth, active, userAgent, createdAt] = params;
      const record = { id, endpoint, p256dh, auth, active: Boolean(active !== false), user_agent: userAgent, created_at: createdAt };
      (this as any).pushSubscriptions.set(endpoint, record);
      return { rows: [record], rowCount: 1 };
    }

    // 17. signal_outcomes queries
    if (normalized.toLowerCase().startsWith('insert into signal_outcomes')) {
      const id = String(params[0] || '');
      const payloadStr = params[params.length - 1];
      let payloadObj: any = {};
      try {
        payloadObj = typeof payloadStr === 'string' ? JSON.parse(payloadStr) : payloadStr;
      } catch {
        payloadObj = {};
      }
      const outcomeRecord = {
        id,
        signal_id: String(params[1] || ''),
        symbol: String(params[2] || ''),
        direction: String(params[3] || ''),
        status: String(params[4] || ''),
        timestamp: Number(params[7] || Date.now()),
        payload_json: { ...payloadObj, id },
      };
      this.signalOutcomes.set(id, outcomeRecord);
      return { rows: [{ ...outcomeRecord }], rowCount: 1 };
    }

    if (normalized.toLowerCase().includes('from signal_outcomes')) {
      if (normalized.toLowerCase().includes('where signal_id = $1')) {
        const sigId = String(params[0] || '');
        for (const o of this.signalOutcomes.values()) {
          if (o.signal_id === sigId) {
            return { rows: [{ ...o, payload_json: o.payload_json || o }], rowCount: 1 };
          }
        }
        return { rows: [], rowCount: 0 };
      } else {
        const allOutcomes: any[] = [];
        for (const o of this.signalOutcomes.values()) {
          allOutcomes.push({ ...o, payload_json: o.payload_json || o });
        }
        allOutcomes.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        const limit = typeof params[0] === 'number' ? params[0] : 100;
        return { rows: allOutcomes.slice(0, limit), rowCount: Math.min(allOutcomes.length, limit) };
      }
    }

    // Generic fallback for other tables (audit events, historical trades, etc.)
    return { rows: [], rowCount: 0 };
  }
}

export const mockNeonStore = new MockNeonStore();
