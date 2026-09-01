/**
 * Structured Server Logger
 * Provides consistent, formatted logging for backend events, health checks, and API errors.
 */

import fs from 'fs';

export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

interface LogContext {
  [key: string]: unknown;
}

class Logger {
  private logToFile(message: string) {
    // Fire-and-forget async append. Logging must never block the event
    // loop — this runs on every info/warn/error/debug call, including hot
    // paths like per-symbol cache lookups and per-candidate audit records.
    fs.appendFile('/tmp/app.log', message + '\n', (err) => {
      if (err) {
        process.stderr.write(`[Logger] Failed to write to log file: ${err.message}\n`);
      }
    });
  }

  private formatMessage(level: LogLevel, message: string, context?: LogContext): string {
    const timestamp = new Date().toISOString();
    const contextStr = context && Object.keys(context).length > 0 
      ? ` | Context: ${JSON.stringify(context)}` 
      : '';
    const formatted = `[${timestamp}] [${level.toUpperCase()}] ${message}${contextStr}`;
    this.logToFile(formatted);
    return formatted;
  }

  info(message: string, context?: LogContext): void {
    console.log(this.formatMessage('info', message, context));
  }

  warn(message: string, context?: LogContext): void {
    console.warn(this.formatMessage('warn', message, context));
  }

  error(message: string, context?: LogContext): void {
    console.error(this.formatMessage('error', message, context));
  }

  debug(message: string, context?: LogContext): void {
    if (process.env.NODE_ENV !== 'production') {
      console.debug(this.formatMessage('debug', message, context));
    }
  }
}

export const logger = new Logger();
