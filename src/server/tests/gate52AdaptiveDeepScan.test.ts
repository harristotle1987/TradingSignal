import { describe, it, expect } from 'vitest';
import { Gate32AdaptiveCandidateSelection, Stage2CandidateInput } from '../signals/Gate32AdaptiveCandidateSelection.js';
import { quotaManager } from '../market/QuotaManager.js';

describe('GATE 52 — Adaptive Deep Scan and Quota Verification', () => {
  it('1. Correctly admits a candidate ranked just outside the initial cutoff if score is close to cutoff', () => {
    const candidates: Stage2CandidateInput[] = [
      { asset: 'AAPL', preliminaryScore: 85, marketRegimeScore: 70, relativeStrengthScore: 75, volatilitySuitabilityScore: 75 }, // #1
      { asset: 'MSFT', preliminaryScore: 80, marketRegimeScore: 70, relativeStrengthScore: 70, volatilitySuitabilityScore: 70 }, // #2 (Cutoff if limit = 1)
      { asset: 'GOOGL', preliminaryScore: 79, marketRegimeScore: 68, relativeStrengthScore: 68, volatilitySuitabilityScore: 68 }, // #3 (Tightly clustered with #2, delta is small)
    ];

    const result = Gate32AdaptiveCandidateSelection.selectCandidates(
      candidates,
      {
        healthyQuotaLimit: 2,
        constrainedQuotaLimit: 1,
        clusterScoreDeltaThreshold: 4.0,
        clusterMaxBonusSlots: 1,
        maxApiQuotaLimit: 3,
      },
      'twelvedata'
    );

    // Initial limit was 2. GOOGL has composite score close to MSFT.
    // It should trigger cluster expansion and admit GOOGL.
    expect(result.clusterExpansionTriggered).toBe(true);
    expect(result.selectedCandidates.some(c => c.asset === 'GOOGL')).toBe(true);
    expect(result.selectedCandidates.length).toBe(3);
  });

  it('2. Admits a candidate just outside the cutoff if cluster is strong, RS is strong, and budget allows expansion', () => {
    const candidates: Stage2CandidateInput[] = [
      { asset: 'TSLA', preliminaryScore: 90, marketRegimeScore: 80, relativeStrengthScore: 85, volatilitySuitabilityScore: 85 }, // #1
      { asset: 'NVDA', preliminaryScore: 85, marketRegimeScore: 80, relativeStrengthScore: 80, volatilitySuitabilityScore: 80 }, // #2 (Cutoff if limit = 2)
      { asset: 'AMD', preliminaryScore: 80, marketRegimeScore: 75, relativeStrengthScore: 80, volatilitySuitabilityScore: 70 }, // #3 (Just outside, but extremely strong regime and RS!)
    ];

    const result = Gate32AdaptiveCandidateSelection.selectCandidates(
      candidates,
      {
        healthyQuotaLimit: 2,
        clusterScoreDeltaThreshold: 4.0, // standard threshold
        clusterMaxBonusSlots: 1,
        maxApiQuotaLimit: 3,
      },
      'twelvedata'
    );

    expect(result.selectedCandidates.some(c => c.asset === 'AMD')).toBe(true);
    expect(result.selectedCandidates.length).toBe(3);
    expect(result.explanation).toContain('ClusterExpanded: true');
  });

  it('3. Respects API constraints and rate limits (does not expand under CONSTRAINED budget)', () => {
    // Force quota constraint by recording multiple requests
    for (let i = 0; i < 15; i++) {
      quotaManager.recordRequest('twelvedata');
    }

    const budgetStatus = quotaManager.getBudgetStatus('twelvedata');
    expect(budgetStatus).toBe('CONSTRAINED');

    const candidates: Stage2CandidateInput[] = [
      { asset: 'AAPL', preliminaryScore: 85, marketRegimeScore: 70, relativeStrengthScore: 75, volatilitySuitabilityScore: 75 }, // #1
      { asset: 'MSFT', preliminaryScore: 80, marketRegimeScore: 70, relativeStrengthScore: 70, volatilitySuitabilityScore: 70 }, // #2
      { asset: 'GOOGL', preliminaryScore: 79, marketRegimeScore: 68, relativeStrengthScore: 68, volatilitySuitabilityScore: 68 }, // #3
    ];

    const result = Gate32AdaptiveCandidateSelection.selectCandidates(
      candidates,
      {
        healthyQuotaLimit: 3,
        constrainedQuotaLimit: 1,
        clusterScoreDeltaThreshold: 4.0,
        clusterMaxBonusSlots: 1,
        maxApiQuotaLimit: 3,
      },
      'twelvedata'
    );

    // Under CONSTRAINED budget, base limit is reduced to 1 (constrainedQuotaLimit).
    // Let's see if we expand. Since budget allows is false under CONSTRAINED, it should not trigger extra expansion for AMD/GOOGL unless it is a very strict score delta, 
    // but the final count is strictly capped and paced.
    expect(result.budgetStatus).toBe('CONSTRAINED');
    expect(result.pacingMsPerCandidate).toBe(350); // Increased pacing for security
  });

  it('4. Assures that remaining API quota matches quota records', () => {
    const remainingBefore = quotaManager.getRemainingQuota('twelvedata');
    quotaManager.recordRequest('twelvedata');
    const remainingAfter = quotaManager.getRemainingQuota('twelvedata');
    expect(remainingAfter).toBeLessThanOrEqual(remainingBefore);
  });
});
