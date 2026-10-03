/**
 * Neon Authentication and Authorization Service
 *
 * Implements authoritative, server-side authentication backed by Neon PostgreSQL:
 * - Atomic First-Registration Admin Promotion (first registered user automatically becomes the ONLY ADMIN)
 * - Race Condition Prevention via PostgreSQL transactional advisory locks & unique partial index (idx_users_single_admin)
 * - Zero-Trust client input handling (client-supplied roles, user IDs, or admin flags are strictly ignored)
 * - Cryptographically secure password hashing (Node.js crypto scrypt + 16-byte random salt + timingSafeEqual)
 * - High-entropy session management with HttpOnly, Secure, SameSite cookies
 * - Strict Fail-Closed architecture: If Neon is unreachable, all auth fails closed without fallback to hardcoded tokens or fake admin identities
 */

import crypto from 'crypto';
import { Response } from 'express';
import { queryNeon, withNeonTransaction, getNeonPool } from '../infrastructure/neon/db.js';
import { logger } from '../logger.js';
import { SecurityAuditLogger, SEC_AUTH, SEC_AUTHZ } from '../security/SecurityService.js';

export const SESSION_COOKIE_NAME = 'neon_session';
export const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: 'ADMIN' | 'USER';
  admin: boolean;
  displayName?: string;
  createdAt: number;
  lastLoginAt?: number;
}

export interface UserSession {
  id: string;
  token: string;
  expiresAt: number;
}

export interface AuthResult {
  success: boolean;
  user?: AuthenticatedUser;
  session?: UserSession;
  isFirstAdmin?: boolean;
  error?: string;
}

export class NeonAuthService {
  /**
   * Hashes a password using scrypt with a random 16-byte salt.
   * Returns salt and hash separated by a colon.
   */
  public static hashPassword(password: string): string {
    const salt = crypto.randomBytes(16).toString('hex');
    const derivedKey = crypto.scryptSync(password, salt, 64);
    return `${salt}:${derivedKey.toString('hex')}`;
  }

  /**
   * Constant-time verification of a password against a salt:hash string.
   */
  public static verifyPassword(password: string, combinedHash?: string | null): boolean {
    if (!combinedHash || typeof combinedHash !== 'string' || !combinedHash.includes(':')) {
      return false;
    }
    const [salt, key] = combinedHash.split(':');
    if (!salt || !key) {
      return false;
    }
    try {
      const keyBuffer = Buffer.from(key, 'hex');
      const derivedKey = crypto.scryptSync(password, salt, 64);
      if (keyBuffer.length !== derivedKey.length) {
        return false;
      }
      return crypto.timingSafeEqual(keyBuffer, derivedKey);
    } catch {
      return false;
    }
  }

  /**
   * Atomically registers a user account.
   * The first successfully registered account automatically becomes the ONLY ADMIN.
   * Prevents race conditions via transaction-scoped advisory locks & PostgreSQL unique constraints.
   * Strips and ignores any client-supplied role, userId, or admin flags.
   */
  public static async register(params: {
    email: string;
    password: string;
    displayName?: string;
    clientIp?: string;
    userAgent?: string;
  }): Promise<AuthResult> {
    if (!getNeonPool()) {
      SecurityAuditLogger.logViolation(SEC_AUTH, 'Registration rejected: Neon database unavailable (Fail Closed)');
      throw new Error('Neon database service is unavailable (Fail Closed).');
    }

    const email = (params.email || '').trim().toLowerCase();
    const password = params.password || '';

    // Validation: Require at least 12 characters for production password policy
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email)) {
      return { success: false, error: 'Please provide a valid email address.' };
    }

    if (!password || password.length < 12) {
      return { success: false, error: 'Password must be at least 12 characters long.' };
    }

    const cleanDisplayName = params.displayName?.trim() || email.split('@')[0];

    try {
      const result = await withNeonTransaction(async (client) => {
        // 1. Transactional advisory lock (advisory ID 718293041)
        // Serializes concurrent first registrations to prevent two admins from being created.
        await client.query('SELECT pg_advisory_xact_lock(718293041)');

        // 2. Check if email already registered
        const existingEmail = await client.query(
          'SELECT id FROM users WHERE LOWER(email) = LOWER($1)',
          [email]
        );
        if (existingEmail.rows.length > 0) {
          return { success: false, error: 'An account with this email already exists. Please sign in.' };
        }

        // 3. Atomically check whether an ADMIN already exists
        const adminCheck = await client.query(
          "SELECT COUNT(*) AS admin_count FROM users WHERE UPPER(role) = 'ADMIN'"
        );
        const adminCount = Number(adminCheck.rows[0]?.admin_count ?? adminCheck.rows[0]?.count ?? 0);

        // Strict Server-Side Role Assignment: First user = ADMIN, all subsequent users = USER
        let assignedRole: 'ADMIN' | 'USER' = adminCount === 0 ? 'ADMIN' : 'USER';
        let isFirstAdmin = assignedRole === 'ADMIN';

        // Generate trusted server-side user ID
        const userId = `usr_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
        const passwordHash = NeonAuthService.hashPassword(password);
        const createdAt = Date.now();

        // 4. Insert user into Neon users table
        try {
          await client.query(
            `INSERT INTO users (id, email, password_hash, role, display_name, created_at)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [userId, email, passwordHash, assignedRole, cleanDisplayName, createdAt]
          );
        } catch (insertErr: any) {
          // If PostgreSQL partial unique index idx_users_single_admin caught a race condition:
          if (String(insertErr).includes('idx_users_single_admin') || insertErr.code === '23505') {
            logger.warn('[NeonAuthService] Race condition detected on first-admin registration. Falling back to USER role.');
            assignedRole = 'USER';
            isFirstAdmin = false;
            await client.query(
              `INSERT INTO users (id, email, password_hash, role, display_name, created_at)
               VALUES ($1, $2, $3, 'USER', $4, $5)`,
              [userId, email, passwordHash, cleanDisplayName, createdAt]
            );
          } else {
            throw insertErr;
          }
        }

        // 5. Create authoritative session in Neon sessions table
        const sessionId = `sess_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
        const sessionToken = `tok_${Date.now()}_${crypto.randomBytes(32).toString('hex')}`;
        const expiresAt = Date.now() + SESSION_MAX_AGE_MS;

        await client.query(
          `INSERT INTO sessions (id, user_id, token, expires_at, created_at, is_valid, client_ip, user_agent)
           VALUES ($1, $2, $3, $4, $5, true, $6, $7)`,
          [sessionId, userId, sessionToken, expiresAt, createdAt, params.clientIp || null, params.userAgent || null]
        );

        SecurityAuditLogger.logEvent(
          SEC_AUTH,
          `Registered new user account: ${email} as ${assignedRole} (Admin: ${isFirstAdmin})`,
          { userId, role: assignedRole, isFirstAdmin }
        );

        return {
          success: true,
          user: {
            id: userId,
            email,
            role: assignedRole,
            admin: isFirstAdmin,
            displayName: cleanDisplayName,
            createdAt,
          },
          session: {
            id: sessionId,
            token: sessionToken,
            expiresAt,
          },
          isFirstAdmin,
        };
      });

      return result;
    } catch (err: any) {
      logger.error('[NeonAuthService] Registration failed:', { error: String(err), email });
      return { success: false, error: err.message || 'Registration failed due to a database error.' };
    }
  }

  /**
   * Authenticates user credentials and provisions a Neon session.
   */
  public static async authenticate(params: {
    email: string;
    password: string;
    clientIp?: string;
    userAgent?: string;
  }): Promise<AuthResult> {
    if (!getNeonPool()) {
      SecurityAuditLogger.logViolation(SEC_AUTH, 'Authentication rejected: Neon database unavailable (Fail Closed)');
      throw new Error('Neon database service is unavailable (Fail Closed).');
    }

    const email = (params.email || '').trim().toLowerCase();
    const password = params.password || '';

    if (!email || !password) {
      return { success: false, error: 'Email and password are required.' };
    }

    try {
      const rows = await queryNeon<any>(
        'SELECT id, email, password_hash, role, display_name, created_at, last_login_at, failed_login_attempts, locked_until FROM users WHERE LOWER(email) = LOWER($1)',
        [email]
      );

      if (rows.length === 0) {
        SecurityAuditLogger.logWarning(SEC_AUTH, `Failed login attempt for unknown email: ${email}`);
        return { success: false, error: 'Invalid email or password.' };
      }

      const userRow = rows[0];
      const now = Date.now();

      // Check if account is currently locked out
      if (userRow.locked_until && Number(userRow.locked_until) > now) {
        const remainingMinutes = Math.ceil((Number(userRow.locked_until) - now) / 60000);
        SecurityAuditLogger.logViolation(SEC_AUTH, `Login blocked: Account ${email} is locked for ${remainingMinutes} more minutes`);
        return {
          success: false,
          error: `Account is temporarily locked due to excessive failed login attempts. Please try again in ${remainingMinutes} minute(s).`,
        };
      }

      const isPasswordValid = NeonAuthService.verifyPassword(password, userRow.password_hash);
      if (!isPasswordValid) {
        const currentFailed = Number(userRow.failed_login_attempts || 0) + 1;
        let lockUntil: number | null = null;
        let lockoutMsg = '';

        if (currentFailed >= 5) {
          lockUntil = now + 15 * 60 * 1000; // 15-minute temporary lockout
          lockoutMsg = ' Account locked for 15 minutes due to 5 consecutive failed attempts.';
          SecurityAuditLogger.logViolation(SEC_AUTH, `Account ${email} LOCKED OUT for 15 minutes after 5 failed login attempts`);
        }

        await queryNeon(
          'UPDATE users SET failed_login_attempts = $1, locked_until = $2 WHERE id = $3',
          [currentFailed, lockUntil, userRow.id]
        );

        SecurityAuditLogger.logWarning(SEC_AUTH, `Failed password verification for user: ${email} (Attempt ${currentFailed}/5)`);
        return {
          success: false,
          error: `Invalid email or password.${lockoutMsg}`,
        };
      }

      const role = String(userRow.role || 'USER').toUpperCase() as 'ADMIN' | 'USER';
      const isAdmin = role === 'ADMIN';

      // Reset failed login attempts on successful login & record last login IP
      await queryNeon(
        'UPDATE users SET last_login_at = $1, failed_login_attempts = 0, locked_until = NULL, last_login_ip = $2 WHERE id = $3',
        [now, params.clientIp || null, userRow.id]
      );

      // Create session
      const sessionId = `sess_${now}_${crypto.randomBytes(6).toString('hex')}`;
      const sessionToken = `tok_${now}_${crypto.randomBytes(32).toString('hex')}`;
      const expiresAt = now + SESSION_MAX_AGE_MS;

      await queryNeon(
        `INSERT INTO sessions (id, user_id, token, expires_at, created_at, is_valid, client_ip, user_agent)
         VALUES ($1, $2, $3, $4, $5, true, $6, $7)`,
        [sessionId, userRow.id, sessionToken, expiresAt, now, params.clientIp || null, params.userAgent || null]
      );

      SecurityAuditLogger.logEvent(SEC_AUTH, `Successful authentication for ${email} (Role: ${role})`, {
        userId: userRow.id,
        role,
      });

      return {
        success: true,
        user: {
          id: userRow.id,
          email: userRow.email,
          role,
          admin: isAdmin,
          displayName: userRow.display_name || undefined,
          createdAt: Number(userRow.created_at),
          lastLoginAt: now,
        },
        session: {
          id: sessionId,
          token: sessionToken,
          expiresAt,
        },
      };
    } catch (err: any) {
      logger.error('[NeonAuthService] Authentication error:', { error: String(err), email });
      throw err;
    }
  }

  /**
   * Authoritatively validates a session token against Neon PostgreSQL.
   * Returns user identity and roles.
   */
  public static async validateSession(token: string): Promise<{
    valid: boolean;
    user?: AuthenticatedUser;
    session?: UserSession;
    error?: string;
  }> {
    if (!token || typeof token !== 'string' || token.trim().length < 8) {
      return { valid: false, error: 'Missing or invalid token format.' };
    }

    if (!getNeonPool()) {
      SecurityAuditLogger.logViolation(SEC_AUTH, 'Session validation rejected: Neon database unavailable (Fail Closed)');
      throw new Error('Neon database service is unavailable (Fail Closed).');
    }

    const cleanToken = token.trim();
    const now = Date.now();

    try {
      const rows = await queryNeon<any>(
        `SELECT u.id, u.email, u.role, u.display_name, u.created_at, u.last_login_at,
                s.id AS session_id, s.expires_at, s.is_valid
         FROM sessions s
         JOIN users u ON s.user_id = u.id
         WHERE s.token = $1 AND s.is_valid = true AND s.expires_at > $2`,
        [cleanToken, now]
      );

      if (rows.length === 0) {
        return { valid: false, error: 'Session is expired, revoked, or invalid.' };
      }

      const r = rows[0];
      const role = String(r.role || 'USER').toUpperCase() as 'ADMIN' | 'USER';

      return {
        valid: true,
        user: {
          id: r.id,
          email: r.email,
          role,
          admin: role === 'ADMIN',
          displayName: r.display_name || undefined,
          createdAt: Number(r.created_at),
          lastLoginAt: r.last_login_at ? Number(r.last_login_at) : undefined,
        },
        session: {
          id: r.session_id,
          token: cleanToken,
          expiresAt: Number(r.expires_at),
        },
      };
    } catch (err: any) {
      logger.error('[NeonAuthService] Session validation error:', { error: String(err) });
      throw err;
    }
  }

  /**
   * Revokes an active session in Neon PostgreSQL.
   */
  public static async revokeSession(token: string): Promise<void> {
    if (!token || !getNeonPool()) return;
    try {
      await queryNeon('UPDATE sessions SET is_valid = false WHERE token = $1', [token.trim()]);
    } catch (err) {
      logger.warn('[NeonAuthService] Session revocation error:', { error: String(err) });
    }
  }

  /**
   * Sets secure, HttpOnly session cookie on the Express response.
   */
  public static setSessionCookie(res: Response, token: string): void {
    const isProd = process.env.NODE_ENV === 'production';
    res.cookie(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? 'none' : 'lax',
      maxAge: SESSION_MAX_AGE_MS,
      path: '/',
    });
  }

  /**
   * Clears session cookie on logout.
   */
  public static clearSessionCookie(res: Response): void {
    const isProd = process.env.NODE_ENV === 'production';
    res.clearCookie(SESSION_COOKIE_NAME, {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? 'none' : 'lax',
      path: '/',
    });
  }
}
