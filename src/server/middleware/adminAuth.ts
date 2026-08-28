/**
 * Server-side ADMIN/API Authentication Gate (Gate 69)
 * Protects administrative, destructive, and configuration-changing endpoints.
 */

import { Request, Response, NextFunction } from 'express';
import { logger } from '../logger.js';

/**
 * Extracts authentication token from request headers:
 * - Authorization: Bearer <token>
 * - x-admin-key: <token>
 * - x-api-key: <token>
 */
export function extractAuthToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.trim().length > 0) {
    const parts = authHeader.trim().split(/\s+/);
    if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
      return parts[1].trim();
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

  return null;
}

/**
 * Express middleware to enforce admin authentication.
 */
export function adminAuthMiddleware(req: Request, res: Response, next: NextFunction) {
  const token = extractAuthToken(req);

  // Collect primary admin secrets from server environment
  const adminSecrets = [
    process.env.ADMIN_API_KEY,
    process.env.ADMIN_SECRET,
    process.env.SCANNER_CRON_SECRET,
  ]
    .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    .map((s) => s.trim());

  let isAuthorized = false;

  if (adminSecrets.length === 0) {
    logger.error(`[AdminAuth] FAIL-CLOSED: No valid administrative secrets (ADMIN_API_KEY, ADMIN_SECRET, SCANNER_CRON_SECRET) are configured in the environment.`);
    return res.status(503).json({
      success: false,
      status: 'CONFIGURATION_ERROR',
      message: 'Service Unavailable: Authentication system is not configured on the server.',
      timestamp: Date.now(),
    });
  }

  if (token && adminSecrets.includes(token)) {
    isAuthorized = true;
  }

  if (!isAuthorized) {
    logger.warn(`[AdminAuth] Unauthorized access attempt blocked on ${req.method} ${req.path}`);
    return res.status(401).json({
      success: false,
      status: 'UNAUTHORIZED',
      message: 'Unauthorized: Missing or invalid admin authentication token.',
      timestamp: Date.now(),
    });
  }

  next();
}
