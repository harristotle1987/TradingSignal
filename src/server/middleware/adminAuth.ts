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

  // Collect configured admin secrets from server environment
  const configuredSecrets = [
    process.env.ADMIN_API_KEY,
    process.env.ADMIN_SECRET,
    process.env.SCANNER_CRON_SECRET,
    process.env.API_KEY,
  ]
    .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    .map((s) => s.trim());

  let isAuthorized = false;

  if (configuredSecrets.length > 0) {
    if (token && configuredSecrets.includes(token)) {
      isAuthorized = true;
    }
  } else {
    // Development / Test environment fallback when no explicit admin key is set
    if (process.env.NODE_ENV !== 'production') {
      if (token === 'dev-admin-key' || token === 'admin-secret' || (token && token.length > 0)) {
        isAuthorized = true;
      }
    }
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
