/**
 * GATE 10 — RATE-LIMIT SAFETY + SCANNER TELEMETRY
 *
 * Records and exposes full funnel counters, rate-limit consumption, and audit trails for every scan.
 *
 * Recorded Telemetry Counters:
 * - assetsReceived: Total symbols in the target universe
 * - assetsCached: Number of symbols served from or qualified by cache
 * - cacheHits: Total market data cache hits
 * - cacheMisses: Total market data cache misses
 * - preliminaryCandidates: Candidates passing Stage 1 / Gate 3 preliminary screen
 * - quotaRemainingBeforeDeepScan: Total available request quota remaining before Gate 6 deep analysis
 * - deepCandidatesAllowed: Max candidates permitted by Gate 4 provider quota budget
 * - deepCandidatesEvaluated: Number of candidates ranked and selected by Gate 5
 * - mtfLayer1Evaluated: Number of candidates entering Gate 6 Layer 1 MTF analysis (15m & 1h)
 * - mtfLayer2Evaluated: Number of candidates advancing to Gate 6 Layer 2 MTF analysis (5m & 4h)
 * - executionChecks: Candidates evaluated in Gate 7 13-point mandatory hard gates
 * - hardGateFailures: Total hard gate failures recorded across candidates
 * - finalScores: Detailed scoring records for all evaluated candidates { symbol, score, classification, passed }
 * - signalsGenerated: Final tradeable signals published (0 to 3)
 * - providerRequests: Network API requests made during this scan
 * - providerErrors: Outbound provider error count
 * - providerTimeouts: Outbound provider timeout count
 * - scanDuration: Scan duration in milliseconds
 *
 * Safety Requirement:
 * - NEVER expose provider secrets, authorization tokens, or API keys in logs or payloads.
 */

import { logger } from '../logger.js';

export interface Gate10CandidateScoreRecord {
  symbol: string;
  direction: 'BUY' | 'SELL';
  score: number;
  classification: string;
  passed: boolean;
  rejectionReason?: string | null;
  factors?: Record<string, number>;
}

export interface Gate10ScanTelemetryData {
  scanId: string;
  timestamp: number;
  assetCategory: string;
  assetsReceived: number;
  assetsCached: number;
  cacheHits: number;
  cacheMisses: number;
  preliminaryCandidates: number;
  quotaRemainingBeforeDeepScan: number;
  deepCandidatesAllowed: number;
  deepCandidatesEvaluated: number;
  mtfLayer1Evaluated: number;
  mtfLayer2Evaluated: number;
  executionChecks: number;
  hardGateFailures: number;
  finalScores: Gate10CandidateScoreRecord[];
  signalsGenerated: number;
  providerRequests: number;
  providerErrors: number;
  providerTimeouts: number;
  scanDuration: number;
  globalScanStartMs: number;
  globalScanDeadlineMs: number;
  currentElapsedMs: number;
  remainingBudgetMs: number;
  gate6ElapsedMs: number;
  stage3ElapsedMs: number;
  timeBudgetExceeded: boolean;
  providerRequestsStoppedByBudget: boolean;
  candidatesRejectedBeforeMTF?: number;
  candidatesRejectedByMTF?: number;
  candidatesRejectedByScore?: number;
  candidatesRejectedByRR?: number;
  candidatesRejectedByStructure?: number;
  stageBreakdown: {
    stage0Screening: { input: number; output: number };
    stage1Preliminary: { input: number; output: number };
    gate4Budget: { health: string; maxAllowed: number };
    gate5Selection: { input: number; output: number };
    gate6Layer1Mtf: { input: number; output: number };
    gate6Layer2Mtf: { input: number; output: number };
    gate7HardGates: { input: number; output: number; failures: number };
    gate8ScoreThreshold: { input: number; output: number; threshold: number };
    gate9SignalCap: { input: number; output: number; cap: number };
  };
}

export class Gate10ScannerTelemetry {
  private static recentScans: Gate10ScanTelemetryData[] = [];
  private static readonly MAX_STORED_SCANS = 25;

  /**
   * Sanitizes strings or objects to guarantee no secrets/API keys leak into logs or telemetry.
   */
  public static sanitize(text: string): string {
    if (!text) return '';
    return text
      .replace(/key=[a-zA-Z0-9_-]+/gi, 'key=REDACTED')
      .replace(/token=[a-zA-Z0-9_-]+/gi, 'token=REDACTED')
      .replace(/apiKey=[a-zA-Z0-9_-]+/gi, 'apiKey=REDACTED')
      .replace(/secret=[a-zA-Z0-9_-]+/gi, 'secret=REDACTED')
      .replace(/bearer\s+[a-zA-Z0-9._-]+/gi, 'Bearer REDACTED');
  }

  /**
   * Records a completed scan telemetry event, outputs structured console logs, and retains in memory.
   */
  public static recordScan(data: Gate10ScanTelemetryData): void {
    // Add to circular buffer
    this.recentScans.unshift(data);
    if (this.recentScans.length > this.MAX_STORED_SCANS) {
      this.recentScans.pop();
    }

    // Format Human-Readable Funnel Log
    const logSummary = [
      `================================================================`,
      `[GATE 10 SCANNER TELEMETRY] Scan ID: ${data.scanId} | Category: ${data.assetCategory}`,
      `----------------------------------------------------------------`,
      `${data.assetsReceived} assets received`,
      `↓`,
      `${data.assetsCached} cache-qualified (Hits: ${data.cacheHits}, Misses: ${data.cacheMisses})`,
      `↓`,
      `${data.preliminaryCandidates} preliminary candidates (Stage 1)`,
      `↓`,
      `${data.deepCandidatesAllowed} deep candidates allowed (Remaining quota: ${data.quotaRemainingBeforeDeepScan})`,
      `↓`,
      `${data.deepCandidatesEvaluated} deep candidates evaluated (Gate 5 ranking)`,
      `↓`,
      `${data.mtfLayer1Evaluated} MTF Layer-1 candidates evaluated (15m/1h)`,
      `↓`,
      `${data.mtfLayer2Evaluated} MTF Layer-2 candidates confirmed (5m/4h)`,
      `↓`,
      `${data.executionChecks} execution validations (Gate 7 Hard Gates) [Failures: ${data.hardGateFailures}]`,
      `↓`,
      `${data.finalScores.filter((s) => s.passed).length} score >= 70 (Gate 8 Final Threshold)`,
      `↓`,
      `${data.signalsGenerated} signal(s) published (Gate 9 Signal Cap: ${data.signalsGenerated}/3)`,
      `----------------------------------------------------------------`,
      `Rejection Breakdown: BeforeMTF: ${data.candidatesRejectedBeforeMTF ?? 0} | MTF: ${data.candidatesRejectedByMTF ?? 0} | Score: ${data.candidatesRejectedByScore ?? 0} | RR: ${data.candidatesRejectedByRR ?? 0} | Structure: ${data.candidatesRejectedByStructure ?? 0}`,
      `Global Scan Clock: Elapsed: ${data.currentElapsedMs}ms / ${data.scanDuration}ms | Deadline: ${data.globalScanDeadlineMs} | Remaining Budget: ${data.remainingBudgetMs}ms | Gate 6 Elapsed: ${data.gate6ElapsedMs}ms | Stage 3 Elapsed: ${data.stage3ElapsedMs}ms | Budget Exceeded: ${data.timeBudgetExceeded} | Requests Stopped: ${data.providerRequestsStoppedByBudget}`,
      `Performance: ${data.scanDuration}ms duration | Provider Requests: ${data.providerRequests} (Errors: ${data.providerErrors}, Timeouts: ${data.providerTimeouts})`,
      `================================================================`,
    ].join('\n');

    logger.info(this.sanitize(logSummary));
  }

  /**
   * Returns the most recent scan telemetry record.
   */
  public static getLatestScan(): Gate10ScanTelemetryData | null {
    return this.recentScans[0] || null;
  }

  /**
   * Returns recent scan telemetry history.
   */
  public static getRecentScans(limit = 10): Gate10ScanTelemetryData[] {
    return this.recentScans.slice(0, limit);
  }

  /**
   * Clears telemetry history (for test isolation).
   */
  public static clear(): void {
    this.recentScans = [];
  }
}
