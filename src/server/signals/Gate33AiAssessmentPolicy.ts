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
  documentedConfidence?: number; // Real documented confidence returned by the AI service
  isAiValidated: boolean;
  neverBoostConfidenceEnforced: true;
  neverInventProbabilityEnforced: true;
  neverOverrideDeterministicEnforced: true;
  neverGeneratePricesEnforced: true;
}

export class Gate33AiAssessmentPolicy {
  /**
   * Helper to extract a documented confidence value (0-100) from raw AI response text.
   * Only returns a value if the AI service actually returns a documented confidence.
   */
  public static extractDocumentedConfidence(responseText: string | null | undefined): number | undefined {
    if (!responseText) return undefined;
    
    // Look for explicit patterns like "confidence: 85%" or "confidence value is 75" or similar
    const regexes = [
      /confidence:\s*(\d+)%/i,
      /confidence:\s*(\d+)/i,
      /confidence\s*(?:level|score|value)?\s*(?:is|=)?\s*(\d+)%/i,
      /confidence\s*(?:level|score|value)?\s*(?:is|=)?\s*(\d+)/i,
      /(\d+)%\s*confidence/i
    ];
    
    for (const regex of regexes) {
      const match = responseText.match(regex);
      if (match) {
        const val = parseInt(match[1], 10);
        if (!isNaN(val) && val >= 0 && val <= 100) {
          return val;
        }
      }
    }
    
    return undefined;
  }

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
    const docConfidence = this.extractDocumentedConfidence(responseText);

    if (!isAvailable || !responseText || responseText.trim().length === 0) {
      return {
        aiAssessment: responseText || 'NVIDIA AI Assessment UNAVAILABLE. Algorithmic deterministic validation applies.',
        classification: 'UNAVAILABLE',
        refinedConfidence: cleanScore, // NO BOOST (+0)
        documentedConfidence: docConfidence,
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
      documentedConfidence: docConfidence,
      isAiValidated,
      neverBoostConfidenceEnforced: true,
      neverInventProbabilityEnforced: true,
      neverOverrideDeterministicEnforced: true,
      neverGeneratePricesEnforced: true,
    };
  }
}
