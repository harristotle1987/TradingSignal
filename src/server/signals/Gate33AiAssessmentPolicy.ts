/**
 * GATE 33 — AI ASSESSMENT IS NOT STATISTICAL PROBABILITY
 *
 * OBJECTIVE:
 * Ensure strict separation between qualitative AI qualitative review and deterministic statistical probability:
 * 1. AI Output Classification MUST be strictly qualitative:
 *    - QUALITATIVE_CONFIRMATION: AI qualitative review supports context.
 *    - QUALITATIVE_CONTRADICTION: AI qualitative review detects contextual conflict/caution.
 *    - UNAVAILABLE: AI service offline, unconfigured, or timed out.
 * 2. NO AI Confidence Boost:
 *    - Strictly remove any logic equivalent to `confidence + 2` or arbitrary score inflation.
 *    - AI assessment MUST NOT alter numeric score or statistical confidence.
 * 3. Empirical Probability Integrity:
 *    - EmpiricalProbability (Gate 20 Wilson Score Interval) remains the ONLY statistical probability field.
 *    - AI MUST NEVER invent win probability numbers.
 * 4. Deterministic Primacy:
 *    - AI MUST NOT override deterministic market-data validation, risk gates, or entry/SL/TP price calculations.
 *    - Prices (Entry, SL, TP) are derived purely by deterministic algorithmic engines.
 */

import { logger } from '../logger.js';

export type AiQualitativeClassification =
  | 'QUALITATIVE_CONFIRMATION'
  | 'QUALITATIVE_CONTRADICTION'
  | 'UNAVAILABLE';

export interface AiEvaluationPolicyResult {
  aiAssessment: string;
  classification: AiQualitativeClassification;
  refinedConfidence: number; // Strictly equal to deterministic input score — NEVER boosted by AI!
  isAiValidated: boolean;
  neverBoostConfidenceEnforced: true;
  neverInventProbabilityEnforced: true;
  neverOverrideDeterministicEnforced: true;
  neverGeneratePricesEnforced: true;
}

export class Gate33AiAssessmentPolicy {
  /**
   * Classifies raw AI text response into a strict qualitative category.
   * Checks for contradiction keywords (e.g. 'contradict', 'caution', 'avoid', 'conflict', 'divergence', 'high risk').
   */
  public static classifyResponse(
    responseText: string | null | undefined,
    deterministicScore: number,
    isAvailable: boolean
  ): AiEvaluationPolicyResult {
    const cleanScore = Math.max(0, Math.min(100, Math.round(deterministicScore)));

    if (!isAvailable || !responseText || responseText.trim().length === 0) {
      return {
        aiAssessment: responseText || 'NVIDIA AI Assessment UNAVAILABLE. Algorithmic deterministic validation applies.',
        classification: 'UNAVAILABLE',
        refinedConfidence: cleanScore, // NO BOOST (+0)
        isAiValidated: false,
        neverBoostConfidenceEnforced: true,
        neverInventProbabilityEnforced: true,
        neverOverrideDeterministicEnforced: true,
        neverGeneratePricesEnforced: true,
      };
    }

    const lowerText = responseText.toLowerCase();

    // Check for explicit qualitative contradiction signals
    const contradictionKeywords = [
      'contradict',
      'contradiction',
      'caution',
      'avoid',
      'conflict',
      'divergence against',
      'high risk',
      'invalid',
      'do not trade',
      'reject',
    ];

    const hasContradiction = contradictionKeywords.some((kw) => lowerText.includes(kw));

    const classification: AiQualitativeClassification = hasContradiction
      ? 'QUALITATIVE_CONTRADICTION'
      : 'QUALITATIVE_CONFIRMATION';

    const isAiValidated = classification === 'QUALITATIVE_CONFIRMATION';

    const formattedAssessment = `NVIDIA AI [${classification}]: ${responseText.trim()}`;

    logger.debug(`[Gate 33 AI Assessment Policy] classification=${classification} score=${cleanScore} (boost=0)`);

    return {
      aiAssessment: formattedAssessment,
      classification,
      refinedConfidence: cleanScore, // Strictly preserved deterministic score — NO +2 boost!
      isAiValidated,
      neverBoostConfidenceEnforced: true,
      neverInventProbabilityEnforced: true,
      neverOverrideDeterministicEnforced: true,
      neverGeneratePricesEnforced: true,
    };
  }
}
