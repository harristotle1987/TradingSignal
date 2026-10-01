/**
 * Server-Side Authentication & Authorization Gate (SEC-AUTH / SEC-AUTHZ)
 *
 * Exclusively powered by Neon PostgreSQL:
 * - Server-side session validation
 * - Role-based access control (ADMIN vs USER)
 * - Secure cookie and Bearer token extraction
 * - Strict Fail-Closed enforcement (no hard-coded tokens or fallback ADMIN identities)
 */

import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { NeonAuthService, SESSION_COOKIE_NAME, AuthenticatedUser, UserSession } from '../auth/NeonAuthService.js';
import { logger } from '../logger.js';
import { SecurityAuditLogger, SEC_AUTH, SEC_AUTHZ } from '../security/SecurityService.js';

/**
 * Constant-time string comparison (OWASP ASVS V2 Authentication).
 */
export function timingSafeStringEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

// Extend Express Request type to include authenticated user & session
declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      session?: UserSession;
    }
  }
}

/**
 * Extracts session authentication token from:
 * 1. Authorization: Bearer <session_token>
 * 2. HttpOnly Cookie: neon_session
 * 3. Raw Cookie header fallback
 */
export function extractSessionToken(req: Request): string | null {
  // 1. Authorization header: Bearer <token>
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.trim().length > 0) {
    const parts = authHeader.trim().split(/\s+/);
    if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
      return parts[1].trim();
    }
    if (parts.length === 1 && !parts[0].includes('=')) {
      return parts[0].trim();
    }
  }

  // 2. Custom header token formats (x-admin-key, x-api-key)
  const xAdminKey = req.headers['x-admin-key'];
  if (xAdminKey && typeof xAdminKey === 'string' && xAdminKey.trim().length > 0) {
    return xAdminKey.trim();
  }

  const xApiKey = req.headers['x-api-key'];
  if (xApiKey && typeof xApiKey === 'string' && xApiKey.trim().length > 0) {
    return xApiKey.trim();
  }

  // 3. Cookie parsed by cookie-parser
  if (req.cookies && typeof req.cookies[SESSION_COOKIE_NAME] === 'string' && req.cookies[SESSION_COOKIE_NAME].trim().length > 0) {
    return req.cookies[SESSION_COOKIE_NAME].trim();
  }

  // 3. Raw cookie header fallback
  const rawCookie = req.headers.cookie;
  if (rawCookie) {
    const match = rawCookie.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE_NAME}=([^;]+)`));
    if (match && match[1]) {
      return decodeURIComponent(match[1].trim());
    }
  }

  return null;
}

// Backward-compatible alias
export const extractAuthToken = extractSessionToken;

/**
 * Express middleware enforcing ADMIN authorization.
 * Only authenticated users with role === 'ADMIN' are permitted.
 * Fails closed on database unavailability or invalid session.
 */
export async function adminAuthMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = extractSessionToken(req);

  if (!token) {
    SecurityAuditLogger.logWarning(SEC_AUTH, `Unauthenticated administrative request rejected for ${req.method} ${req.path}`);
    res.status(401).json({
      success: false,
      error: 'Unauthorized: Missing administrative credentials.',
      securityId: SEC_AUTH,
      timestamp: Date.now(),
    });
    return;
  }

  try {
    const validation = await NeonAuthService.validateSession(token);

    if (!validation.valid || !validation.user) {
      SecurityAuditLogger.logViolation(SEC_AUTH, `Invalid or expired administrative session token for ${req.method} ${req.path}`);
      res.status(401).json({
        success: false,
        error: 'Unauthorized: Missing administrative credentials.',
        securityId: SEC_AUTH,
        timestamp: Date.now(),
      });
      return;
    }

    const role = (validation.user.role || '').toUpperCase();
    if (role !== 'ADMIN') {
      SecurityAuditLogger.logViolation(
        SEC_AUTHZ,
        `Access denied for non-admin user ${validation.user.email} (role: ${role}) on ${req.method} ${req.path}`
      );
      res.status(403).json({
        success: false,
        error: 'Forbidden: Invalid administrative credentials.',
        securityId: SEC_AUTHZ,
        timestamp: Date.now(),
      });
      return;
    }

    // Attach verified user and session to request
    req.user = validation.user;
    req.session = validation.session;

    SecurityAuditLogger.logEvent(
      SEC_AUTHZ,
      `Authorized administrative request for ${req.method} ${req.path} by ${validation.user.email}`
    );
    next();
  } catch (err: any) {
    // Fail Closed!
    SecurityAuditLogger.logViolation(
      SEC_AUTH,
      `Fail-Closed: Administrative authentication database unavailable for ${req.method} ${req.path}`,
      { error: String(err) }
    );
    res.status(503).json({
      success: false,
      error: 'Service Unavailable: Authentication database unavailable (Fail Closed).',
      securityId: SEC_AUTH,
      timestamp: Date.now(),
    });
  }
}

/**
 * Express middleware enforcing standard authenticated user access.
 * Permitted for both USER and ADMIN roles.
 */
export async function userAuthMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = extractSessionToken(req);

  if (!token) {
    SecurityAuditLogger.logWarning(SEC_AUTH, `Unauthenticated request rejected for ${req.method} ${req.path}`);
    res.status(401).json({
      success: false,
      error: 'Unauthorized: Authentication required.',
      securityId: SEC_AUTH,
      timestamp: Date.now(),
    });
    return;
  }

  try {
    const validation = await NeonAuthService.validateSession(token);

    if (!validation.valid || !validation.user) {
      res.status(401).json({
        success: false,
        error: 'Unauthorized: Invalid or expired session.',
        securityId: SEC_AUTH,
        timestamp: Date.now(),
      });
      return;
    }

    req.user = validation.user;
    req.session = validation.session;
    next();
  } catch (err: any) {
    // Fail closed
    res.status(503).json({
      success: false,
      error: 'Service Unavailable: Authentication database unavailable (Fail Closed).',
      securityId: SEC_AUTH,
      timestamp: Date.now(),
    });
  }
}
