/**
 * Authoritative Scanner Timing & Budget Configuration
 * Single source of truth for all scanner stages, pipelines, and MTF analyzers.
 */

/**
 * Normal operational budget: Stop initiating new expensive provider/API work at 14 seconds
 * and prioritize finalizing existing candidates.
 */
export const OPERATIONAL_SCAN_BUDGET_MS = 14000;

/**
 * Absolute hard deadline: Hard stop any further scanner processing at 17 seconds
 * and finalize/persist available results.
 */
export const HARD_SCAN_DEADLINE_MS = 17000;

/**
 * Target maximum duration for the cron HTTP dispatch response (<2 seconds).
 */
export const CRON_DISPATCH_TIMEOUT_MS = 2000;

/**
 * Distributed scanner execution lock timeout (60 seconds).
 */
export const SCANNER_LOCK_TIMEOUT_MS = 60000;
