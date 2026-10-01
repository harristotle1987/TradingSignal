/**
 * Neon PostgreSQL Database Connection Manager
 *
 * Provides connection pooling via `@neondatabase/serverless` optimized for serverless/Vercel workloads.
 * Manages SQL query execution, transaction handling, and schema initialization.
 */

import { Pool, neonConfig } from '@neondatabase/serverless';
import { logger } from '../../logger.js';

// Configure Neon WebSocket/HTTP connection pooling for serverless environments
neonConfig.fetchConnectionCache = true;

let pool: Pool | null = null;
let mockPool: any = null;
let schemaInitialized = false;
let schemaInitPromise: Promise<boolean> | null = null;

/**
 * Allows tests to supply a mock connection pool or in-memory database store.
 */
export function setMockNeonPool(mock: any): void {
  mockPool = mock;
  schemaInitialized = false;
  schemaInitPromise = null;
}

export function getMockNeonPool(): any {
  return mockPool;
}

/**
 * Returns the active Neon PostgreSQL connection pool if DATABASE_URL is configured (or active mock).
 */
export function getNeonPool(): Pool | null {
  if (mockPool) {
    return mockPool;
  }
  const dbUrl = process.env.DATABASE_URL?.trim();
  if (!dbUrl) {
    return null;
  }
  if (!pool) {
    try {
      pool = new Pool({ connectionString: dbUrl });
      logger.info('[Neon DB] Created serverless PostgreSQL connection pool');
    } catch (err) {
      logger.error('[Neon DB] Failed to instantiate PostgreSQL pool:', { error: String(err) });
      return null;
    }
  }
  return pool;
}

/**
 * Executes a parameterised query against Neon PostgreSQL (or mock store).
 * Automatically ensures database schema and indexes are initialized before execution.
 */
export async function queryNeon<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  if (mockPool) {
    const res = await mockPool.query(sql, params);
    return res.rows as T[];
  }
  const p = getNeonPool();
  if (!p) {
    throw new Error('Neon DATABASE_URL is not configured or database pool is unavailable.');
  }
  if (!schemaInitialized) {
    await initializeNeonSchema();
  }
  const result = await p.query(sql, params);
  return result.rows as T[];
}

/**
 * Executes a transaction using a checked-out pool client (or transactional mock).
 * Automatically ensures database schema and indexes are initialized before execution.
 */
export async function withNeonTransaction<T>(
  callback: (client: { query: (sql: string, params?: any[]) => Promise<any> }) => Promise<T>
): Promise<T> {
  if (mockPool && typeof mockPool.withTransaction === 'function') {
    return await mockPool.withTransaction(callback);
  }
  const p = getNeonPool();
  if (!p) {
    throw new Error('Neon DATABASE_URL is not configured or database pool is unavailable.');
  }
  if (!schemaInitialized) {
    await initializeNeonSchema();
  }
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    const result = await callback({
      query: (sql: string, params: any[] = []) => client.query(sql, params),
    });
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Initializes schema and indexes if DATABASE_URL is available.
 */
export async function initializeNeonSchema(): Promise<boolean> {
  if (schemaInitialized) return true;
  if (schemaInitPromise) return schemaInitPromise;

  const p = getNeonPool();
  if (!p) return false;

  schemaInitPromise = (async () => {
    try {
      await p.query(`
        CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(255) PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash TEXT,
        role VARCHAR(50) NOT NULL DEFAULT 'USER',
        display_name VARCHAR(255),
        created_at BIGINT NOT NULL,
        last_login_at BIGINT
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_single_admin ON users (role) WHERE UPPER(role) = 'ADMIN';

      CREATE TABLE IF NOT EXISTS sessions (
        id VARCHAR(255) PRIMARY KEY,
        user_id VARCHAR(255) REFERENCES users(id) ON DELETE CASCADE,
        token VARCHAR(512) UNIQUE NOT NULL,
        expires_at BIGINT NOT NULL,
        created_at BIGINT NOT NULL,
        is_valid BOOLEAN NOT NULL DEFAULT true,
        client_ip VARCHAR(100),
        user_agent TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
      CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);

      CREATE TABLE IF NOT EXISTS signals (
        id VARCHAR(255) PRIMARY KEY,
        snapshot_id VARCHAR(255) NOT NULL,
        symbol VARCHAR(50) NOT NULL,
        direction VARCHAR(10) NOT NULL,
        entry_price NUMERIC NOT NULL,
        stop_loss NUMERIC NOT NULL,
        take_profit NUMERIC NOT NULL,
        tp1 NUMERIC,
        tp2 NUMERIC,
        tp3 NUMERIC,
        risk_reward_ratio NUMERIC NOT NULL,
        score NUMERIC NOT NULL,
        rank_tier VARCHAR(50) NOT NULL,
        strategy VARCHAR(100) NOT NULL,
        timeframe VARCHAR(20) NOT NULL,
        data_source VARCHAR(100) NOT NULL,
        status VARCHAR(50) NOT NULL,
        timestamp BIGINT NOT NULL,
        payload_json JSONB NOT NULL
      );

      CREATE TABLE IF NOT EXISTS signal_outcomes (
        id VARCHAR(255) PRIMARY KEY,
        signal_id VARCHAR(255),
        symbol VARCHAR(50) NOT NULL,
        direction VARCHAR(10) NOT NULL,
        status VARCHAR(50) NOT NULL,
        pnl NUMERIC,
        r_multiple NUMERIC,
        timestamp BIGINT NOT NULL,
        payload_json JSONB NOT NULL
      );

      CREATE TABLE IF NOT EXISTS historical_trades (
        id VARCHAR(255) PRIMARY KEY,
        symbol VARCHAR(50) NOT NULL,
        direction VARCHAR(10) NOT NULL,
        entry_price NUMERIC NOT NULL,
        exit_price NUMERIC,
        stop_loss NUMERIC NOT NULL,
        take_profit NUMERIC NOT NULL,
        tp1 NUMERIC,
        tp2 NUMERIC,
        tp3 NUMERIC,
        outcome VARCHAR(50) NOT NULL,
        pnl NUMERIC,
        r_multiple NUMERIC,
        entered_at BIGINT NOT NULL,
        closed_at BIGINT,
        strategy VARCHAR(100),
        timeframe VARCHAR(20),
        rank_tier VARCHAR(50),
        score NUMERIC,
        payload_json JSONB NOT NULL
      );

      CREATE TABLE IF NOT EXISTS audit_events (
        id VARCHAR(255) PRIMARY KEY,
        security_id VARCHAR(100) NOT NULL,
        action TEXT NOT NULL,
        timestamp BIGINT NOT NULL,
        severity VARCHAR(20) DEFAULT 'INFO',
        details_json JSONB,
        client_ip VARCHAR(100),
        user_id VARCHAR(255)
      );

      CREATE TABLE IF NOT EXISTS scanner_state (
        date VARCHAR(20) PRIMARY KEY,
        daily_signal_count INT NOT NULL DEFAULT 0,
        daily_signal_cap INT NOT NULL DEFAULT 10,
        state_json JSONB NOT NULL,
        updated_at BIGINT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS scanner_locks (
        lock_name VARCHAR(100) PRIMARY KEY,
        instance_id VARCHAR(255) NOT NULL,
        lock_acquired_at BIGINT NOT NULL,
        is_scanning BOOLEAN NOT NULL DEFAULT true
      );

      CREATE TABLE IF NOT EXISTS signal_fingerprints (
        id VARCHAR(255) PRIMARY KEY,
        fingerprint VARCHAR(255) UNIQUE NOT NULL,
        symbol VARCHAR(50) NOT NULL,
        direction VARCHAR(10) NOT NULL,
        created_at BIGINT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS performance_history (
        id VARCHAR(255) PRIMARY KEY,
        period_key VARCHAR(100) NOT NULL,
        metrics_json JSONB NOT NULL,
        updated_at BIGINT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id VARCHAR(255) PRIMARY KEY,
        endpoint TEXT UNIQUE NOT NULL,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        active BOOLEAN NOT NULL DEFAULT true,
        user_agent TEXT,
        created_at BIGINT NOT NULL
      );

      -- Constraints & Indexes for query performance and data integrity
      CREATE INDEX IF NOT EXISTS idx_signals_status ON signals(status);
      CREATE INDEX IF NOT EXISTS idx_signals_symbol ON signals(symbol);
      CREATE INDEX IF NOT EXISTS idx_signals_direction ON signals(direction);
      CREATE INDEX IF NOT EXISTS idx_signals_timestamp ON signals(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_signal_outcomes_symbol ON signal_outcomes(symbol);
      CREATE INDEX IF NOT EXISTS idx_signal_outcomes_status ON signal_outcomes(status);
      CREATE INDEX IF NOT EXISTS idx_signal_outcomes_direction ON signal_outcomes(direction);
      CREATE INDEX IF NOT EXISTS idx_signal_outcomes_timestamp ON signal_outcomes(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_historical_trades_symbol ON historical_trades(symbol);
      CREATE INDEX IF NOT EXISTS idx_historical_trades_outcome ON historical_trades(outcome);
      CREATE INDEX IF NOT EXISTS idx_historical_trades_direction ON historical_trades(direction);
      CREATE INDEX IF NOT EXISTS idx_historical_trades_entered_at ON historical_trades(entered_at DESC);
      CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_sessions_created_at ON sessions(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_events_timestamp ON audit_events(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_events_user_id ON audit_events(user_id);
      CREATE INDEX IF NOT EXISTS idx_signal_fingerprints_symbol ON signal_fingerprints(symbol);
      CREATE INDEX IF NOT EXISTS idx_signal_fingerprints_fingerprint ON signal_fingerprints(fingerprint);
      CREATE INDEX IF NOT EXISTS idx_signal_fingerprints_created_at ON signal_fingerprints(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_performance_history_period ON performance_history(period_key);
    `);

    logger.info('[Neon DB] PostgreSQL schema & indexes initialized successfully');
    schemaInitialized = true;
    return true;
  } catch (err) {
    logger.error('[Neon DB] Schema initialization error:', { error: String(err) });
    schemaInitPromise = null;
    return false;
  }
  })();

  return schemaInitPromise;
}
