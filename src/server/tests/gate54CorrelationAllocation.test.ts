import { describe, it, expect } from 'vitest';
import { Gate36ConfigurableSignalFrequency } from '../signals/Gate36ConfigurableSignalFrequency.js';

describe('GATE 54 — Correlation Allocation Policy', () => {
  it('1. Allows signal if cluster exposure is below limit', () => {
    const result = Gate36ConfigurableSignalFrequency.evaluateCorrelationAllocation({
      symbol: 'BTCUSDT',
      score: 85,
      direction: 'BUY',
      activeSignalsInCluster: [] // empty
    });

    expect(result.allowed).toBe(true);
    expect(result.cluster).toBeDefined();
    expect(result.existingExposure).toBe(0);
    expect(result.newExposure).toBe(1);
    expect(result.signalToSupersede).toBeUndefined();
  });

  it('2. Rejects signal if there is an equivalent/stronger active signal in the cluster', () => {
    const maxAllowed = Gate36ConfigurableSignalFrequency.getMaxSignalsPerCluster();
    
    // Construct active signals matching the max limit, with some of them stronger
    const activeSignals = Array.from({ length: maxAllowed }, (_, i) => ({
      id: `act_${i}`,
      symbol: 'ETHUSDT',
      score: 90
    }));

    const result = Gate36ConfigurableSignalFrequency.evaluateCorrelationAllocation({
      symbol: 'SOLUSDT',
      score: 85, // weaker than active (90)
      direction: 'BUY',
      activeSignalsInCluster: activeSignals
    });

    expect(result.allowed).toBe(false);
    expect(result.signalToSupersede).toBeUndefined();
    expect(result.reason).toContain('equivalent/stronger correlated signal');
  });

  it('3. Admits stronger signal by superseding/swapping out the weakest active setup in the cluster', () => {
    const maxAllowed = Gate36ConfigurableSignalFrequency.getMaxSignalsPerCluster();
    
    // Fill cluster with signals, ALL of which are weaker than the candidate
    const activeSignals = Array.from({ length: maxAllowed }, (_, i) => ({
      id: `act_${i}`,
      symbol: 'ETHUSDT',
      score: 70 + i // scores are e.g. 70, 71, 72, 73... all less than 85
    }));

    const result = Gate36ConfigurableSignalFrequency.evaluateCorrelationAllocation({
      symbol: 'BTCUSDT',
      score: 85, // stronger than all active signals
      direction: 'BUY',
      activeSignalsInCluster: activeSignals
    });

    expect(result.allowed).toBe(true);
    expect(result.signalToSupersede).toBe('act_0'); // should swap out the weakest (score 70)
    expect(result.reason).toContain('Superseding weaker active signal');
  });
});
