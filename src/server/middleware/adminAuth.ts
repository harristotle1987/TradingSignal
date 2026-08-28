/**
 * Server-side ADMIN/API Authentication Gate (Gate 1)
 * Protects administrative, destructive, and configuration-changing endpoints.
 * Lightweight, local, and server-side authentication for single-user application.
 */

import { Request, Response, NextFunction } from 'express';
import { logger } from '../logger.js';

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
    // If no production admin credentials are configured in server environment,
    // do NOT silently authorize requests attempting administrative operations.
    logger.warn(`[AdminAuth] Rejected administrative operation (${req.method} ${req.path}): Server administrative credentials are not configured.`);
    return res.status(401).json({
      success: false,
      error: 'Unauthorized: Server administrative credentials are not configured.',
      timestamp: Date.now(),
    });
  }

  if (!token) {
    logger.warn(`[AdminAuth] Rejected unauthenticated administrative request for ${req.method} ${req.path}`);
    return res.status(401).json({
      success: false,
      error: 'Unauthorized: Missing administrative credentials.',
      timestamp: Date.now(),
    });
  }

  const isAuthorized = envSecrets.includes(token);

  if (!isAuthorized) {
    logger.warn(`[AdminAuth] Rejected administrative request with invalid credentials for ${req.method} ${req.path}`);
    return res.status(403).json({
      success: false,
      error: 'Forbidden: Invalid administrative credentials.',
      timestamp: Date.now(),
    });
  }

  logger.info(`[AdminAuth] Authorized administrative request for ${req.method} ${req.path}`);
  next();
}
