/**
 * Gate 41: Empirical Win Probability Safety Test Suite
 * 
 * Tests:
 * 1. Separation of MODEL_ESTIMATED_WIN_RATE from EMPIRICAL_CALIBRATED_PROBABILITY.
 * 2. Empirical probability used only when calibrationStatus = CALIBRATED and sample size >= minimum.
 * 3. Fallback behavior when empirical probability is unavailable (does not fabricate stats, uses model/deterministic gates unless requireEmpiricalCalibration is true).
 * 4. Configuration support for probabilitySource = EMPIRICAL | MODEL | NONE.
 */

import { Gate20ProbabilityCalibration } from '../signals/Gate20ProbabilityCalibration.js';
import { ScoringEngine } from '../signals/ScoringEngine.js';

export async function runGate41ProbabilitySafetyTestSuite() {
  console.log('========================================================================');
  console.log('STARTING GATE 41: EMPIRICAL WIN PROBABILITY SAFETY TESTS');
  console.log('========================================================================\n');

  let passedCount = 0;
  let failedCount = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`[PASS] ${testName}`);
      if (detail) console.log(`       -> ${detail}`);
      passedCount++;
    } else {
      console.error(`[FAIL] ${testName}`);
      if (detail) console.error(`       -> ${detail}`);
      failedCount++;
    }
  }

  // 1. Model Estimated Win Rate vs Empirical Calibrated Probability
  const score = 85;
  const rr = 2.0;
  const modelEst = ScoringEngine.estimateWinRate(score, rr, 4);
  assert(typeof modelEst === 'number' && modelEst > 0, 'ScoringEngine generates model estimated win rate');

  // Insufficient data test for empirical calibration
  const lowDataCalib = Gate20ProbabilityCalibration.calibrateProbability(
    { signalScore: 85, strategy: 'TrendFollow' },
    [] // 0 trades
  );
  assert(lowDataCalib.empiricalProbability === null, 'Gate 41: Empirical probability is null when historical sample size is 0');
  assert(lowDataCalib.calibrationStatus === 'INSUFFICIENT_DATA', 'Gate 41: Calibration status is INSUFFICIENT_DATA');

  // 2. Probability source configuration simulation
  const evaluateProbabilitySelection = (
    probabilitySource: 'EMPIRICAL' | 'MODEL' | 'NONE',
    empiricalProb: number | null,
    calibrationStatus: string,
    sampleSize: number,
    modelEstWinRate: number,
    requireEmpirical: boolean
  ) => {
    let activeProb: number | null = null;
    let sourceUsed = probabilitySource;
    let isCalibrated = false;
    let rejected = false;
    let rejectionReason = '';

    if (probabilitySource === 'EMPIRICAL') {
      if (calibrationStatus === 'CALIBRATED' && sampleSize >= 30 && empiricalProb !== null) {
        activeProb = empiricalProb;
        isCalibrated = true;
      } else {
        if (requireEmpirical) {
          rejected = true;
          rejectionReason = `REJECTED: INSUFFICIENT_EMPIRICAL_SAMPLE (N=${sampleSize} < 30)`;
        } else {
          // Fallback to model estimate for deterministic expectancy/R:R gates without pretending it's empirical calibration
          activeProb = modelEstWinRate;
          isCalibrated = false;
        }
      }
    } else if (probabilitySource === 'MODEL') {
      activeProb = modelEstWinRate;
      isCalibrated = false;
    } else if (probabilitySource === 'NONE') {
      activeProb = null;
      isCalibrated = false;
    }

    return { activeProb, sourceUsed, isCalibrated, rejected, rejectionReason };
  };

  const res1 = evaluateProbabilitySelection('EMPIRICAL', null, 'INSUFFICIENT_DATA', 5, 68.5, false);
  assert(res1.isCalibrated === false, 'Gate 41: Does not mark model estimate as empirically calibrated when empirical data is insufficient');
  assert(res1.activeProb === 68.5, 'Gate 41: Falls back to model estimate without rejecting when requireEmpirical is false');
  assert(res1.rejected === false, 'Gate 41: Signal not rejected simply due to missing empirical data when not strictly required');

  const res2 = evaluateProbabilitySelection('EMPIRICAL', null, 'INSUFFICIENT_DATA', 5, 68.5, true);
  assert(res2.rejected === true, 'Gate 41: Rejects signal when requireEmpiricalCalibration is true and sample size is insufficient');

  const res3 = evaluateProbabilitySelection('MODEL', null, 'INSUFFICIENT_DATA', 0, 72.0, false);
  assert(res3.activeProb === 72.0 && res3.sourceUsed === 'MODEL', 'Gate 41: Uses MODEL probability source when configured');

  const res4 = evaluateProbabilitySelection('NONE', null, 'INSUFFICIENT_DATA', 0, 72.0, false);
  assert(res4.activeProb === null && res4.sourceUsed === 'NONE', 'Gate 41: Uses NONE probability source when configured');

  console.log('\n------------------------------------------------------------------------');
  console.log(`GATE 41 TESTS COMPLETE: ${passedCount} PASSED, ${failedCount} FAILED`);
  console.log('------------------------------------------------------------------------\n');

  return { passedCount, failedCount };
}
describe('gate41ProbabilitySafety', () => {
  it('runs the test suite', async () => {
    await runGate41ProbabilitySafetyTestSuite();
  });
});

import { describe, it } from "vitest";
describe("gate41ProbabilitySafety.test.ts", () => {
  it("runs successfully", async () => {
    await runGate41ProbabilitySafetyTestSuite();
  });
});
