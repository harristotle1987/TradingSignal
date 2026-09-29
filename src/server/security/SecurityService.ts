/**
 * Security Service & Standard Enforcement Module
 *
 * Implements security requirements based on:
 * - OWASP ASVS (Application Security Verification Standard)
 * - OWASP Cheat Sheet Series (Authentication, Session, Authorization, Input Validation, CSRF, Rate Limiting, Logging)
 * - Firebase Zero-Trust Security Rules Architecture
 *
 * Security Standard Identifiers:
 * - SEC-AUTH: Authentication & Timing-Safe Verification (ASVS V2)
 * - SEC-SESSION: Session Management & Token Integrity (ASVS V3)
 * - SEC-AUTHZ: Authorization & Access Control (ASVS V4)
 * - SEC-INPUT: Input Validation, Schema Enforcement & Sanitization (ASVS V5)
 * - SEC-CSRF: CSRF Protection, CORS Origin Enforcement & Security Headers (ASVS V14)
 * - SEC-RATE: Rate Limiting & Denial-of-Service Protection (ASVS V11)
 * - SEC-SECRETS: Secrets Management & Data Protection (ASVS V6)
 * - SEC-LOG: Structured Security Audit Logging (ASVS V7)
 */

import { Request, Response, NextFunction } from 'express';
import { logger } from '../logger.js';

export type SecurityID =
  | 'SEC-AUTH'
  | 'SEC-SESSION'
  | 'SEC-AUTHZ'
  | 'SEC-INPUT'
  | 'SEC-CSRF'
  | 'SEC-RATE'
  | 'SEC-SECRETS'
  | 'SEC-LOG';

export const SEC_AUTH: SecurityID = 'SEC-AUTH';
export const SEC_SESSION: SecurityID = 'SEC-SESSION';
export const SEC_AUTHZ: SecurityID = 'SEC-AUTHZ';
export const SEC_INPUT: SecurityID = 'SEC-INPUT';
export const SEC_CSRF: SecurityID = 'SEC-CSRF';
export const SEC_RATE: SecurityID = 'SEC-RATE';
export const SEC_SECRETS: SecurityID = 'SEC-SECRETS';
export const SEC_LOG: SecurityID = 'SEC-LOG';

/**
 * SEC-LOG: Structured Security Audit Logger
 */
export class SecurityAuditLogger {
  static logEvent(
    securityId: SecurityID,
    action: string,
    context?: Record<string, unknown>
  ): void {
    const logData = {
      securityId,
      action,
      timestamp: new Date().toISOString(),
      ...(context || {}),
    };
    logger.info(`[${securityId}] ${action}`, logData);
  }

  static logWarning(
    securityId: SecurityID,
    action: string,
    context?: Record<string, unknown>
  ): void {
    const logData = {
      securityId,
      action,
      timestamp: new Date().toISOString(),
      ...(context || {}),
    };
    logger.warn(`[${securityId}] ${action}`, logData);
  }

  static logViolation(
    securityId: SecurityID,
    action: string,
    context?: Record<string, unknown>
  ): void {
    const logData = {
      securityId,
      action,
      timestamp: new Date().toISOString(),
      severity: 'HIGH',
      ...(context || {}),
    };
    logger.error(`[${securityId}] Security Violation: ${action}`, logData);
  }
}

/**
 * SEC-SECRETS: Secrets Management & Redaction
 */
export class SecretsManager {
  private static SENSITIVE_KEY_PATTERNS = [
    /key/i,
    /secret/i,
    /token/i,
    /password/i,
    /auth/i,
    /credential/i,
    /private/i,
    /certificate/i,
    /api_?key/i,
  ];

  /**
   * Masks sensitive credentials for safe logging or display.
   */
  static maskSecret(val?: string | null): string {
    if (!val || typeof val !== 'string') return '[REDACTED]';
    const trimmed = val.trim();
    if (trimmed.length <= 6) return '******';
    const start = trimmed.slice(0, 3);
    const end = trimmed.slice(-3);
    return `${start}***${end}`;
  }

  /**
   * Recursively sanitizes data objects, redacting sensitive properties.
   */
  static sanitizeForLogging<T = unknown>(obj: T, depth = 0): T {
    if (depth > 5 || obj === null || typeof obj !== 'object') {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.sanitizeForLogging(item, depth + 1)) as unknown as T;
    }

    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      const isSensitive = this.SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
      if (isSensitive) {
        sanitized[key] = typeof value === 'string' ? this.maskSecret(value) : '[REDACTED]';
      } else if (typeof value === 'object' && value !== null) {
        sanitized[key] = this.sanitizeForLogging(value, depth + 1);
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized as T;
  }
}

/**
 * SEC-INPUT: Input Validation, Schema Enforcement & Sanitization
 */
export class InputValidator {
  private static SYMBOL_REGEX = /^[A-Z0-9._\-]{2,20}$/;

  /**
   * Validates and normalizes trading symbol inputs.
   */
  static validateSymbol(symbol: unknown): { valid: boolean; normalized?: string; error?: string } {
    if (typeof symbol !== 'string' || symbol.trim().length === 0) {
      return { valid: false, error: 'Symbol must be a non-empty string' };
    }
    const clean = symbol.trim().toUpperCase();
    if (!this.SYMBOL_REGEX.test(clean)) {
      return {
        valid: false,
        error: `Symbol "${clean}" contains invalid characters. Allowed: alphanumeric, dot, underscore, hyphen. Length: 2-20.`,
      };
    }
    return { valid: true, normalized: clean };
  }

  /**
   * Strips dangerous script injections, control characters, and truncates to maxLength.
   */
  static sanitizeString(input: unknown, maxLength = 500): string {
    if (typeof input !== 'string') return '';
    // Strip control characters, null bytes, and script tags
    const sanitized = input
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .trim();
    return sanitized.slice(0, maxLength);
  }

  /**
   * Validates numeric bounds.
   */
  static validateNumeric(
    val: unknown,
    min: number,
    max: number,
    fieldName = 'value'
  ): { valid: boolean; value?: number; error?: string } {
    const num = Number(val);
    if (isNaN(num) || !isFinite(num)) {
      return { valid: false, error: `${fieldName} must be a valid finite number` };
    }
    if (num < min || num > max) {
      return { valid: false, error: `${fieldName} must be between ${min} and ${max}. Got ${num}` };
    }
    return { valid: true, value: num };
  }

  /**
   * Express middleware for input validation and sanitization.
   */
  static middleware(req: Request, res: Response, next: NextFunction): void {
    // If symbol parameter is present, validate it
    if (req.params && req.params.symbol) {
      const val = InputValidator.validateSymbol(req.params.symbol);
      if (!val.valid) {
        SecurityAuditLogger.logWarning(SEC_INPUT, 'Invalid symbol parameter rejected', {
          param: req.params.symbol,
          path: req.path,
          error: val.error,
        });
        res.status(400).json({
          success: false,
          error: val.error,
          securityId: SEC_INPUT,
          timestamp: Date.now(),
        });
        return;
      }
      req.params.symbol = val.normalized!;
    }

    if (req.query && typeof req.query.symbol === 'string') {
      const val = InputValidator.validateSymbol(req.query.symbol);
      if (!val.valid) {
        SecurityAuditLogger.logWarning(SEC_INPUT, 'Invalid symbol query rejected', {
          query: req.query.symbol,
          path: req.path,
          error: val.error,
        });
        res.status(400).json({
          success: false,
          error: val.error,
          securityId: SEC_INPUT,
          timestamp: Date.now(),
        });
        return;
      }
      req.query.symbol = val.normalized!;
    }

    next();
  }
}

/**
 * SEC-RATE: Rate Limiting & Denial-of-Service Defense
 */
interface RateLimitBucket {
  count: number;
  resetAt: number;
}

export class RateLimiter {
  private static store = new Map<string, RateLimitBucket>();

  /**
   * Clear rate limiting state (useful in test runners).
   */
  static clear(): void {
    this.store.clear();
  }

  /**
   * Creates an Express rate-limiting middleware using a sliding window algorithm.
   */
  static create(options: {
    windowMs: number;
    maxRequests: number;
    endpointName?: string;
  }) {
    const { windowMs, maxRequests, endpointName = 'API' } = options;

    return (req: Request, res: Response, next: NextFunction): void => {
      // Extract client identifier (IP or forwarded IP or client token)
      const forwarded = req.headers['x-forwarded-for'];
      const clientIp = typeof forwarded === 'string'
        ? forwarded.split(',')[0].trim()
        : req.socket.remoteAddress || '127.0.0.1';

      const key = `${endpointName}:${clientIp}`;
      const now = Date.now();

      let bucket = RateLimiter.store.get(key);
      if (!bucket || now >= bucket.resetAt) {
        bucket = {
          count: 1,
          resetAt: now + windowMs,
        };
        RateLimiter.store.set(key, bucket);
      } else {
        bucket.count++;
      }

      const remaining = Math.max(0, maxRequests - bucket.count);
      const resetSeconds = Math.ceil((bucket.resetAt - now) / 1000);

      res.setHeader('X-RateLimit-Limit', maxRequests);
      res.setHeader('X-RateLimit-Remaining', remaining);
      res.setHeader('X-RateLimit-Reset', resetSeconds);

      if (bucket.count > maxRequests) {
        SecurityAuditLogger.logViolation(SEC_RATE, `Rate limit exceeded on ${endpointName}`, {
          clientIp,
          endpoint: req.path,
          requests: bucket.count,
          limit: maxRequests,
          retryAfterSeconds: resetSeconds,
        });

        res.setHeader('Retry-After', resetSeconds);
        res.status(429).json({
          success: false,
          error: `Too Many Requests: Rate limit of ${maxRequests} requests per ${windowMs / 1000}s exceeded.`,
          retryAfter: resetSeconds,
          securityId: SEC_RATE,
          timestamp: Date.now(),
        });
        return;
      }

      next();
    };
  }
}

/**
 * SEC-CSRF: Anti-CSRF & Safe Mutating Requests Verification
 */
export class CSRFProtection {
  /**
   * Verifies that state-mutating requests (POST, PUT, DELETE, PATCH)
   * include custom headers or standard API request content types.
   */
  static middleware(req: Request, res: Response, next: NextFunction): void {
    const method = req.method.toUpperCase();
    const isMutating = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(method);

    if (!isMutating || !req.path.startsWith('/api')) {
      return next();
    }

    // Check for standard anti-CSRF custom headers or JSON content-type
    const contentType = req.headers['content-type'] || '';
    const hasCustomHeader = Boolean(
      req.headers['authorization'] ||
      req.headers['x-requested-with'] ||
      req.headers['x-admin-key'] ||
      req.headers['x-api-key'] ||
      contentType.includes('application/json')
    );

    if (!hasCustomHeader && req.headers['origin']) {
      SecurityAuditLogger.logWarning(SEC_CSRF, 'Blocked potential cross-origin state mutation without API headers', {
        method,
        path: req.path,
        origin: req.headers['origin'],
      });
      res.status(403).json({
        success: false,
        error: 'Forbidden: Request failed CSRF security validation. Custom API header or application/json required.',
        securityId: SEC_CSRF,
        timestamp: Date.now(),
      });
      return;
    }

    next();
  }
}
