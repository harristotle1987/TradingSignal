/**
 * GATE 4 — PROVIDER QUOTA / REQUEST BUDGET GATE
 *
 * OBJECTIVE:
 * Before any expensive analysis, verify current provider request budgets and create
 * a dynamic deep-analysis candidate budget.
 *
 * TRACKS:
 * - Requests used (rolling 1s, rolling 60s, total session)
 * - Requests remaining (accounting for reserved execution buffer)
 * - Requests per second & per minute
 * - Endpoint-specific limits
 * - Recent provider errors & timeouts
 * - Current request latency
 * - Reserved requests for critical trade validation
 *
 * DYNAMIC DEEP-ANALYSIS BUDGET ROUTING:
 * - HIGH quota:     maximum 12 deep candidates
 * - NORMAL quota:   maximum 8–10 deep candidates (10)
 * - LOW quota:      maximum 5–6 deep candidates (6)
 * - CRITICAL quota: maximum 2–3 deep candidates (3)
 * - EXHAUSTED:      perform no expensive analysis (0 candidates)
 *
 * CRITICAL SAFETY RULES:
 * 1. NEVER consume the reserved quota during opportunistic scanning.
 * 2. NEVER continue making requests simply because fewer signals were found.
 * 3. Quota exhaustion gracefully stops deeper analysis without crashing.
 * 4. The scanner returns a valid scan-complete result even when deep analysis is skipped.
 */

import { quotaManager, ProviderQuotaMetrics, ProviderBudgetHealth } from '../market/QuotaManager.js';
import { logger } from '../logger.js';

export interface Gate4BudgetEvaluation {
  passed: boolean; // true if maxDeepCandidates > 0
  overallBudgetHealth: ProviderBudgetHealth;
  maxDeepCandidates: number;
  providerMetrics: Record<string, ProviderQuotaMetrics>;
  reservedQuotaPreserved: boolean;
  reason: string;
  timestamp: number;
}

export class Gate4RequestBudget {
  /**
   * Evaluates the current API request budget state across all providers and
   * calculates the dynamic candidate allowance for deep MTF scanning.
   */
  public static evaluateBudget(category?: string): Gate4BudgetEvaluation {
    const now = Date.now();
    const budget = quotaManager.getDynamicDeepBudget(category);
    const passed = budget.maxDeepCandidates > 0;

    let reason = '';
    switch (budget.overallHealth) {
      case 'HIGH':
        reason = `Gate 4 HIGH Budget: Full capacity available (${budget.maxDeepCandidates} deep candidates permitted). No rate-limits or timeouts.`;
        break;
      case 'NORMAL':
        reason = `Gate 4 NORMAL Budget: Standard capacity (${budget.maxDeepCandidates} deep candidates permitted). Reserved safety buffer active.`;
        break;
      case 'LOW':
        reason = `Gate 4 LOW Budget: Constrained capacity (${budget.maxDeepCandidates} deep candidates permitted). Rate-limit pacing applied.`;
        break;
      case 'CRITICAL':
        reason = `Gate 4 CRITICAL Budget: Severe quota pressure (${budget.maxDeepCandidates} deep candidates permitted). Prioritizing top setups.`;
        break;
      case 'EXHAUSTED':
        reason = `Gate 4 EXHAUSTED Budget: Zero deep candidates permitted. Cooldown/limit lock active. Deep analysis gracefully bypassed.`;
        break;
    }

    logger.info(`[Gate 4 Request Budget] Health: ${budget.overallHealth}, Deep Candidates Cap: ${budget.maxDeepCandidates}, Reason: ${reason}`);

    return {
      passed,
      overallBudgetHealth: budget.overallHealth,
      maxDeepCandidates: budget.maxDeepCandidates,
      providerMetrics: budget.metrics,
      reservedQuotaPreserved: true,
      reason,
      timestamp: now,
    };
  }
}
