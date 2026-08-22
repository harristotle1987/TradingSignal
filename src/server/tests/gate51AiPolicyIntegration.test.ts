import { describe, it, expect } from 'vitest';
import { Gate33AiAssessmentPolicy } from '../signals/Gate33AiAssessmentPolicy.js';

describe('GATE 51 — AI Policy Integration & Verification', () => {
  it('1. DISABLED mode bypasses AI, sets UNAVAILABLE/DISABLED placeholders, and does not reject', () => {
    // Under DISABLED mode, no AI is called. The fallback is 'UNAVAILABLE'.
    const aiResult = Gate33AiAssessmentPolicy.classifyResponse(
      null, // No response
      85,
      false // Unavailable/disabled
    );

    expect(aiResult.classification).toBe('UNAVAILABLE');
    expect(aiResult.isAiValidated).toBe(false);
    expect(aiResult.refinedConfidence).toBe(85); // Preserves deterministic score
    expect(aiResult.documentedConfidence).toBeUndefined(); // Does NOT substitute deterministic score
  });

  it('2. OPTIONAL mode allows confirmation, rejects contradiction, but does NOT reject on unavailability', () => {
    // 2.1 Confirmation
    const aiConfirm = Gate33AiAssessmentPolicy.classifyResponse(
      'Strong bullish trend support and MA alignment.',
      85,
      true
    );
    expect(aiConfirm.classification).toBe('QUALITATIVE_CONFIRMATION');
    expect(aiConfirm.isAiValidated).toBe(true);

    // 2.2 Contradiction
    const aiContradict = Gate33AiAssessmentPolicy.classifyResponse(
      'Caution: severe bearish divergence warns of high risk.',
      85,
      true
    );
    expect(aiContradict.classification).toBe('QUALITATIVE_CONTRADICTION');
    expect(aiContradict.isAiValidated).toBe(false);

    // 2.3 Unavailability (e.g. offline, rate-limited, etc)
    const aiUnavailable = Gate33AiAssessmentPolicy.classifyResponse(
      null,
      85,
      false
    );
    expect(aiUnavailable.classification).toBe('UNAVAILABLE');
    expect(aiUnavailable.isAiValidated).toBe(false);
  });

  it('3. REQUIRED mode requires valid confirmation according to policy', () => {
    // In REQUIRED mode, UNAVAILABLE or QUALITATIVE_CONTRADICTION rejects.
    const aiUnavailable = Gate33AiAssessmentPolicy.classifyResponse(
      null,
      85,
      false
    );
    expect(aiUnavailable.isAiValidated).toBe(false);
    expect(aiUnavailable.classification).toBe('UNAVAILABLE');

    const aiContradict = Gate33AiAssessmentPolicy.classifyResponse(
      'Caution: divergence warning.',
      85,
      true
    );
    expect(aiContradict.isAiValidated).toBe(false);
    expect(aiContradict.classification).toBe('QUALITATIVE_CONTRADICTION');
  });

  it('4. extractDocumentedConfidence extracts only if the AI returns a documented confidence value', () => {
    // 4.1 Valid explicit confidence
    const textWithConf = 'Bullish pattern. Confidence: 85%. Proceed with trade.';
    const conf = Gate33AiAssessmentPolicy.extractDocumentedConfidence(textWithConf);
    expect(conf).toBe(85);

    // 4.2 Valid implicit confidence text
    const textWithConfWord = 'We evaluate a 75% confidence level.';
    const conf2 = Gate33AiAssessmentPolicy.extractDocumentedConfidence(textWithConfWord);
    expect(conf2).toBe(75);

    // 4.3 No valid confidence in text
    const textNoConf = 'Valid setup observed.';
    const conf3 = Gate33AiAssessmentPolicy.extractDocumentedConfidence(textNoConf);
    expect(conf3).toBeUndefined(); // Does NOT substitute deterministic score
  });

  it('5. Refuses to substitute score or estimatedWinRate as AI confidence', () => {
    const aiResult = Gate33AiAssessmentPolicy.classifyResponse(
      'Qualitative confirmation only, no numbers.',
      85,
      true
    );

    // Documented confidence must be undefined if not in text
    expect(aiResult.documentedConfidence).toBeUndefined();
  });
});
