/**
 * Server-side ADMIN/API Authentication Gate (Gate 1)
 * Protects administrative, destructive, and configuration-changing endpoints.
 * Lightweight, local, and server-side authentication for single-user application.
 */

import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { logger } from '../logger.js';
import { SecurityAuditLogger, SEC_AUTH, SEC_AUTHZ } from '../security/SecurityService.js';

/**
 * Constant-time string comparison to avoid leaking information about how
 * many leading characters of an admin credential matched via response
 * timing (OWASP ASVS V2 Authentication).
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

/**
 * Extracts authentication token from request headers:
 * - Authorization: Bearer <token>
 * - x-admin-key: <token>
 * - x-api-key: <token>
 * - x-admin-secret: <token>
 */
export function extractAuthToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.trim().length > 0) {
    const parts = authHeader.trim().split(/\s+/);
    if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
      return parts[1].trim();
    }
    if (parts.length === 1) {
      return parts[0].trim();
    }
  }

  const xAdminKey = req.headers['x-admin-key'];
  if (xAdminKey && typeof xAdminKey === 'string' && xAdminKey.trim().length > 0) {
    return xAdminKey.trim();
  }

  const xApiKey = req.headers['x-api-key'];
  if (xApiKey && typeof xApiKey === 'string' && xApiKey.trim().length > 0) {
    return xApiKey.trim();
  }

  const xAdminSecret = req.headers['x-admin-secret'];
  if (xAdminSecret && typeof xAdminSecret === 'string' && xAdminSecret.trim().length > 0) {
    return xAdminSecret.trim();
  }

  return null;
}

/**
 * Express middleware to enforce admin authentication for administrative endpoints.
 * Enforces SEC-AUTH (Authentication) and SEC-AUTHZ (Authorization/Access Control).
 */
export function adminAuthMiddleware(req: Request, res: Response, next: NextFunction) {
  const token = extractAuthToken(req);

  // Check server-side environment variables configured for admin access
  const envSecrets = [
    process.env.ADMIN_API_KEY,
    process.env.ADMIN_SECRET,
    process.env.ADMIN_KEY,
    process.env.SCANNER_CRON_SECRET,
  ]
    .filter((s): s is string => Boolean(s && s.trim().length > 0))
    .map((s) => s.trim());

  if (envSecrets.length === 0) {
    if (process.env.NODE_ENV !== 'production') {
      SecurityAuditLogger.logEvent(SEC_AUTH, `Dev mode admin bypass for ${req.method} ${req.path}`);
      return next();
    }
    SecurityAuditLogger.logViolation(SEC_AUTH, `Rejected administrative operation (${req.method} ${req.path}): Missing server credentials`);
    return res.status(401).json({
      success: false,
      error: 'Unauthorized: Server administrative credentials are not configured.',
      securityId: SEC_AUTH,
      timestamp: Date.now(),
    });
  }

  if (!token) {
    SecurityAuditLogger.logWarning(SEC_AUTH, `Unauthenticated administrative request rejected for ${req.method} ${req.path}`);
    return res.status(401).json({
      success: false,
      error: 'Unauthorized: Missing administrative credentials.',
      securityId: SEC_AUTH,
      timestamp: Date.now(),
    });
  }

  const isAuthorized = envSecrets.some((secret) => timingSafeStringEquals(token, secret));

  if (!isAuthorized) {
    SecurityAuditLogger.logViolation(SEC_AUTHZ, `Access denied with invalid credentials for ${req.method} ${req.path}`);
    return res.status(403).json({
      success: false,
      error: 'Forbidden: Invalid administrative credentials.',
      securityId: SEC_AUTHZ,
      timestamp: Date.now(),
    });
  }

  SecurityAuditLogger.logEvent(SEC_AUTHZ, `Authorized administrative request for ${req.method} ${req.path}`);
  next();
}
