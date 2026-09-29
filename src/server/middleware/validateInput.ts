/**
 * Input Validation Middleware
 *
 * Validates request payload, query parameters, or route parameters against a schema validator.
 * Enforces OWASP ASVS V5 Input Validation requirements.
 */

import { Request, Response, NextFunction } from 'express';
import { SchemaValidator } from '../validation/schemas.js';
import { SecurityAuditLogger, SEC_INPUT } from '../security/SecurityService.js';

export function validateInput(
  schema: SchemaValidator,
  source: 'body' | 'query' | 'params' = 'body'
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const input = req[source];
    const result = schema(input);

    if (!result.success) {
      SecurityAuditLogger.logWarning(SEC_INPUT, `Input validation rejected on ${req.method} ${req.path}`, {
        source,
        errors: result.errors,
        input: typeof input === 'object' ? JSON.stringify(input) : String(input),
      });

      res.status(400).json({
        success: false,
        error: 'Validation failed',
        errors: result.errors || ['Invalid input parameter'],
        securityId: SEC_INPUT,
        timestamp: Date.now(),
      });
      return;
    }

    // Attach validated and normalized data back to request
    if (result.data !== undefined) {
      (req as any)[source] = result.data;
    }

    next();
  };
}
