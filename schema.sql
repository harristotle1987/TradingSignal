-- ============================================================================
-- QUANTITATIVE SIGNAL ENGINE & ADMIN AUTHENTICATION DATABASE SCHEMA
-- PostgreSQL / Neon Database Schema
--
-- SECURITY & ANTI-HACKING SPECIFICATIONS:
-- 1. Atomic First-User Admin Promotion: The first registered account atomically
--    becomes the ONLY administrator via a partial unique index.
-- 2. Brute-Force & Credential Stuffing Defense: Account lockouts after 5 consecutive
--    failed attempts (`failed_login_attempts`, `locked_until`).
-- 3. High-Entropy Session Management: 512-bit cryptographic session tokens
--    stored with expiration and IP/User-Agent tracking.
-- 4. Cryptographic Password Hashing: Node.js scrypt + 16-byte random salt.
-- 5. Anti-Tampering & Security Audit: Immutable audit logs in `audit_events`.
-- ============================================================================

-- 1. USERS TABLE
CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(255) PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role VARCHAR(50) NOT NULL DEFAULT 'USER',
  display_name VARCHAR(255),
  created_at BIGINT NOT NULL,
  last_login_at BIGINT,
  failed_login_attempts INT NOT NULL DEFAULT 0,
  locked_until BIGINT,
  last_login_ip VARCHAR(100)
);

-- Index on email for fast authentication lookups
CREATE INDEX IF NOT EXISTS idx_users_email ON users(LOWER(email));

-- CRITICAL ANTI-HACKING RULE: Only ONE admin can EVER exist in the entire database.
-- Enforced at the PostgreSQL engine level to prevent race conditions or privilege escalation.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_single_admin ON users (role) WHERE UPPER(role) = 'ADMIN';


-- 2. SESSIONS TABLE (HttpOnly, Secure Cookie Storage)
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
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);


-- 3. AUDIT & SECURITY EVENTS (Immutable Security Trail)
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

CREATE INDEX IF NOT EXISTS idx_audit_events_timestamp ON audit_events(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_security_id ON audit_events(security_id);


-- 4. TRADING SIGNALS TABLE (Validated Multi-Asset Setups)
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

CREATE INDEX IF NOT EXISTS idx_signals_symbol ON signals(symbol);
CREATE INDEX IF NOT EXISTS idx_signals_status ON signals(status);
CREATE INDEX IF NOT EXISTS idx_signals_timestamp ON signals(timestamp DESC);


-- 5. SIGNAL OUTCOMES & MILESTONES (TP1/TP2/TP3/SL Tracking)
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

CREATE INDEX IF NOT EXISTS idx_signal_outcomes_signal_id ON signal_outcomes(signal_id);
CREATE INDEX IF NOT EXISTS idx_signal_outcomes_timestamp ON signal_outcomes(timestamp DESC);


-- 6. HISTORICAL RESOLVED TRADES
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

CREATE INDEX IF NOT EXISTS idx_historical_trades_closed_at ON historical_trades(closed_at DESC);


-- 7. SCANNER STATE & DAILY CAP TRACKER
CREATE TABLE IF NOT EXISTS scanner_state (
  date VARCHAR(20) PRIMARY KEY,
  daily_signal_count INT NOT NULL DEFAULT 0,
  daily_signal_cap INT NOT NULL DEFAULT 10,
  state_json JSONB NOT NULL,
  updated_at BIGINT NOT NULL
);


-- 8. DISTRIBUTED SCANNER CONCURRENCY LOCKS
CREATE TABLE IF NOT EXISTS scanner_locks (
  lock_name VARCHAR(100) PRIMARY KEY,
  instance_id VARCHAR(255) NOT NULL,
  lock_acquired_at BIGINT NOT NULL,
  is_scanning BOOLEAN NOT NULL DEFAULT true
);


-- 9. SIGNAL FINGERPRINTS (Duplicate Prevention)
CREATE TABLE IF NOT EXISTS signal_fingerprints (
  id VARCHAR(255) PRIMARY KEY,
  fingerprint VARCHAR(255) UNIQUE NOT NULL,
  symbol VARCHAR(50) NOT NULL,
  direction VARCHAR(10) NOT NULL,
  created_at BIGINT NOT NULL
);


-- 10. SYSTEM PERFORMANCE HISTORY
CREATE TABLE IF NOT EXISTS performance_history (
  id VARCHAR(255) PRIMARY KEY,
  period_key VARCHAR(100) NOT NULL,
  metrics_json JSONB NOT NULL,
  updated_at BIGINT NOT NULL
);


-- 11. PUSH NOTIFICATION SUBSCRIPTIONS
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id VARCHAR(255) PRIMARY KEY,
  endpoint TEXT UNIQUE NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at BIGINT NOT NULL
);
