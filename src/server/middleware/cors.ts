/**
 * Explicit Allowed-Origin CORS Middleware (Gate 97)
 * Replaces wildcard Access-Control-Allow-Origin: * with explicit approved origins.
 * Hard-codes https://trading-signal-chi.vercel.app for production.
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
 * Helper to retrieve allowed origins list.
 * Production hard-codes https://trading-signal-chi.vercel.app.
 * Development allows localhost / 127.0.0.1 and optional APP_URL.
 */
export function getAllowedOrigins(): string[] {
  const isDev = process.env.NODE_ENV !== 'production';
  const origins: string[] = [];

  if (isDev) {
    if (process.env.APP_URL && process.env.APP_URL.trim().length > 0) {
      origins.push(normalizeOrigin(process.env.APP_URL));
    }
  } else {
    // Production hard-coded origin
    origins.push('https://trading-signal-chi.vercel.app');
  }

  return Array.from(new Set(origins));
}

/**
 * CORS Middleware enforcing strict production and development origins.
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

  // Check if requested origin is explicitly allowed
  let isAllowed = allowedOrigins.includes(normalizedReqOrigin);

  // In development mode only, allow localhost and 127.0.0.1
  if (!isAllowed && isDev) {
    if (
      allowedOrigins.length === 0 ||
      normalizedReqOrigin.includes('localhost') ||
      normalizedReqOrigin.includes('127.0.0.1') ||
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

