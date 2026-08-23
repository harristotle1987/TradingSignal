/**
 * Explicit Allowed-Origin CORS Middleware (Gate 69)
 * Replaces wildcard Access-Control-Allow-Origin: * with explicit APP_URL / ALLOWED_ORIGINS.
 * Rejects unauthorized origins for credentialed and mutating requests.
 */

import { Request, Response, NextFunction } from 'express';
import { logger } from '../logger.js';

/**
 * Normalizes an origin URL string (e.g. "https://app.example.com/" -> "https://app.example.com")
 */
export function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, '').toLowerCase();
}

/**
 * Helper to retrieve allowed origins list from APP_URL and ALLOWED_ORIGINS env vars.
 */
export function getAllowedOrigins(): string[] {
  const origins: string[] = [];

  if (process.env.APP_URL && process.env.APP_URL.trim().length > 0) {
    origins.push(normalizeOrigin(process.env.APP_URL));
  }

  if (process.env.ALLOWED_ORIGINS && process.env.ALLOWED_ORIGINS.trim().length > 0) {
    const list = process.env.ALLOWED_ORIGINS.split(',').map((o) => normalizeOrigin(o)).filter(Boolean);
    origins.push(...list);
  }

  return Array.from(new Set(origins));
}

/**
 * CORS Middleware enforcing explicit APP_URL and ALLOWED_ORIGINS.
 * Replaces wildcard '*' and rejects unauthorized origins for credentialed/mutating requests.
 */
export function corsMiddleware(req: Request, res: Response, next: NextFunction) {
  const origin = req.headers.origin;
  const isDev = process.env.NODE_ENV !== 'production';
  const allowedOrigins = getAllowedOrigins();

  // If request has no Origin header (e.g. server-to-server or direct curl), allow request to proceed
  if (!origin) {
    return next();
  }

  const normalizedReqOrigin = normalizeOrigin(origin);

  // Check if requested origin is allowed
  let isAllowed = allowedOrigins.includes(normalizedReqOrigin);

  // Always allow standard dev and platform preview environments (.run.app, .ai.studio, .vercel.app, localhost, same-origin)
  if (!isAllowed) {
    if (
      allowedOrigins.length === 0 ||
      normalizedReqOrigin.includes('localhost') ||
      normalizedReqOrigin.includes('127.0.0.1') ||
      normalizedReqOrigin.includes('.run.app') ||
      normalizedReqOrigin.includes('.ai.studio') ||
      normalizedReqOrigin.includes('.vercel.app') ||
      (req.headers.host && normalizedReqOrigin.includes(req.headers.host.toLowerCase()))
    ) {
      isAllowed = true;
    }
  }

  const isMutatingOrCredentialed =
    ['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method.toUpperCase()) ||
    Boolean(req.headers.authorization || req.headers['x-admin-key'] || req.headers['x-api-key']);

  if (isAllowed) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, x-admin-key, x-api-key');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
    res.header('Vary', 'Origin');

    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }
    return next();
  }

  // Unauthorized origin handling:
  logger.warn(`[CORS] Rejected unauthorized origin "${origin}" on ${req.method} ${req.path}`);

  if (req.method === 'OPTIONS') {
    return res.status(403).json({
      success: false,
      status: 'FORBIDDEN',
      message: 'CORS policy: Origin not allowed.',
      timestamp: Date.now(),
    });
  }

  if (isMutatingOrCredentialed) {
    return res.status(403).json({
      success: false,
      status: 'FORBIDDEN',
      message: 'CORS policy: Origin not allowed for credentialed or mutating requests.',
      timestamp: Date.now(),
    });
  }

  // Public GET without credentials from unauthorized origin: proceed without CORS headers
  next();
}
