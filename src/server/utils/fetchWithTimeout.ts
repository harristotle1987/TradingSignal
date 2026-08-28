/**
 * Shared Fetch and Promise Timeout Utilities
 *
 * Implements strict request timeouts using AbortController:
 * - Market data: 3–5 seconds
 * - Slow providers: 5–8 seconds
 * - Database operations: 3–5 seconds
 */

import { logger } from '../logger.js';

export interface FetchTimeoutOptions extends RequestInit {
  timeoutMs?: number;
  globalScanDeadlineMs?: number;
}

/**
 * Shared fetch helper with mandatory AbortController timeout.
 */
export async function fetchWithTimeout(
  url: string,
  options: FetchTimeoutOptions = {}
): Promise<Response> {
  const { timeoutMs = 4000, globalScanDeadlineMs, ...fetchInit } = options;

  const safetyMargin = 100;
  let effectiveTimeoutMs = timeoutMs;

  if (globalScanDeadlineMs) {
    const remainingMs = globalScanDeadlineMs - Date.now();
    if (remainingMs <= safetyMargin) {
      throw new Error(`TIMEOUT: Global scanner deadline reached before fetch (${url})`);
    }
    effectiveTimeoutMs = Math.min(timeoutMs, remainingMs - safetyMargin);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), effectiveTimeoutMs);

  try {
    const response = await fetch(url, {
      ...fetchInit,
      signal: controller.signal,
    });
    return response;
  } catch (err: any) {
    if (err.name === 'AbortError' || controller.signal?.aborted) {
      throw new Error(`TIMEOUT: Request to ${url} timed out after ${effectiveTimeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Wraps any promise (e.g. database operation) with a hard timeout.
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs = 4000,
  operationName = 'Database operation'
): Promise<T> {
  let timeoutId: NodeJS.Timeout;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`TIMEOUT: ${operationName} exceeded ${timeoutMs}ms limit`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId!);
  }
}
