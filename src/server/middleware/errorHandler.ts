/**
 * Global Express API Error Handling Middleware
 */

import { Request, Response, NextFunction } from 'express';
import { logger } from '../logger.js';
import { SecurityAuditLogger, SEC_LOG } from '../security/SecurityService.js';

export class AppError extends Error {
  public statusCode: number;
  public errorCode: string;

  constructor(message: string, statusCode: number = 500, errorCode: string = 'INTERNAL_SERVER_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function globalErrorHandler(
  err: Error | AppError,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
): void {
  const statusCode = err instanceof AppError ? err.statusCode : 500;
  const errorCode = err instanceof AppError ? err.errorCode : 'INTERNAL_SERVER_ERROR';
  const isProd = process.env.NODE_ENV === 'production';
  // OWASP ASVS V7 Error Handling: Never leak internal stack traces or sensitive internal paths to clients
  const clientMessage = isProd && statusCode >= 500
    ? 'An unexpected server error occurred. Please try again later.'
    : err.message || 'An unexpected internal server error occurred.';

  SecurityAuditLogger.logViolation(SEC_LOG, `API Error: ${errorCode}`, {
    path: req.path,
    method: req.method,
    statusCode,
    errorCode,
    errorMsg: err.message,
    stack: !isProd ? err.stack : undefined,
  });

  res.status(statusCode).json({
    success: false,
    securityId: SEC_LOG,
    error: {
      code: errorCode,
      message: clientMessage,
      timestamp: new Date().toISOString(),
      path: req.path,
    },
  });
}
