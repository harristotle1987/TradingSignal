/**
 * Signal Sensitivity Profiles Test Suite
 *
 * Verifies that sensitivity profiles (Balanced, Conservative, Active, Custom)
 * correctly configure gating thresholds, adjust dynamic regime floors,
 * and provide user-adjustable strictness without violating hard capital preservation gates.
 */

import assert from 'assert';
import { SignalSensitivityManager, CANONICAL_SENSITIVITY_PROFILES } from '../src/server/signals/SignalSensitivityManager.js';
import { serverConfig } from '../src/server/config.js';
import { Gate27RegimeThresholds } from '../src/server/signals/Gate27RegimeThresholds.js';

async function runSensitivityTests() {
  console.log('\n--- Running Signal Sensitivity Profiles Tests ---');

  // Test 1: Canonical Profiles Exist
  const profiles = SignalSensitivityManager.getAllProfiles();
  assert(profiles.BALANCED, 'BALANCED profile must exist');
  assert(profiles.CONSERVATIVE, 'CONSERVATIVE profile must exist');
  assert(profiles.ACTIVE, 'ACTIVE profile must exist');
  assert(profiles.CUSTOM, 'CUSTOM profile must exist');
  console.log('✓ Test 1: Canonical profiles exist');

  // Test 2: Balanced Profile has expected calibrated values
  assert.strictEqual(profiles.BALANCED.signalThreshold, 65, 'BALANCED threshold should be 65');
  assert.strictEqual(profiles.BALANCED.minimumRR, 1.5, 'BALANCED min RR should be 1.5');
  assert.strictEqual(profiles.BALANCED.minimumNetRR, 1.10, 'BALANCED min Net RR should be 1.10');
  console.log('✓ Test 2: BALANCED profile has calibrated 65 score and 1.5:1 R:R thresholds');

  // Test 3: Set Active Profile to BALANCED and check serverConfig sync
  SignalSensitivityManager.setActiveProfile('BALANCED');
  assert.strictEqual(SignalSensitivityManager.getActiveProfileName(), 'BALANCED');
  const currentThresholds = serverConfig.getConfig().thresholds;
  assert.strictEqual(currentThresholds.signalThreshold, 65, 'serverConfig signalThreshold should sync to 65');
  assert.strictEqual(currentThresholds.minimumRR, 1.5, 'serverConfig minimumRR should sync to 1.5');
  console.log('✓ Test 3: Activating BALANCED synchronizes serverConfig thresholds');

  // Test 4: Gate 27 Dynamic Floor Adaptation with BALANCED
  const regimeResBalanced = Gate27RegimeThresholds.resolveThreshold({
    symbol: 'EURUSD',
    regime: 'NORMAL_TREND',
    strategy: 'TREND_CONTINUATION',
    assetClass: 'FOREX',
    actualScore: 66,
  });
  assert.strictEqual(regimeResBalanced.resolvedThreshold, 65, 'Under BALANCED, NORMAL_TREND threshold should adapt to floor 65');
  assert.strictEqual(regimeResBalanced.isExecutable, true, 'Score 66 should pass under BALANCED');
  console.log('✓ Test 4: Gate 27 adapts floor to 65 under BALANCED mode');

  // Test 5: Switch to CONSERVATIVE
  SignalSensitivityManager.setActiveProfile('CONSERVATIVE');
  assert.strictEqual(SignalSensitivityManager.getActiveProfileName(), 'CONSERVATIVE');
  assert.strictEqual(serverConfig.getConfig().thresholds.signalThreshold, 72);
  assert.strictEqual(serverConfig.getConfig().thresholds.minimumRR, 1.8);

  const regimeResConservative = Gate27RegimeThresholds.resolveThreshold({
    symbol: 'EURUSD',
    regime: 'NORMAL_TREND',
    strategy: 'TREND_CONTINUATION',
    assetClass: 'FOREX',
    actualScore: 66,
  });
  assert.strictEqual(regimeResConservative.resolvedThreshold, 72, 'Under CONSERVATIVE, NORMAL_TREND threshold should be 72');
  assert.strictEqual(regimeResConservative.isExecutable, false, 'Score 66 should be rejected under CONSERVATIVE');
  console.log('✓ Test 5: Switch to CONSERVATIVE raises hurdle to 72 score and 1.8:1 R:R');

  // Test 6: Switch to ACTIVE
  SignalSensitivityManager.setActiveProfile('ACTIVE');
  assert.strictEqual(SignalSensitivityManager.getActiveProfileName(), 'ACTIVE');
  assert.strictEqual(serverConfig.getConfig().thresholds.signalThreshold, 62);
  assert.strictEqual(serverConfig.getConfig().thresholds.minimumRR, 1.3);

  const regimeResActive = Gate27RegimeThresholds.resolveThreshold({
    symbol: 'BTCUSDT',
    regime: 'BREAKOUT',
    strategy: 'MOMENTUM_CONTINUATION',
    assetClass: 'CRYPTO',
    actualScore: 63,
  });
  assert.strictEqual(regimeResActive.resolvedThreshold, 62, 'Under ACTIVE, threshold should adapt to floor 62');
  assert.strictEqual(regimeResActive.isExecutable, true, 'Score 63 should pass under ACTIVE');
  console.log('✓ Test 6: Switch to ACTIVE lowers hurdle to 62 score and 1.3:1 R:R');

  // Test 7: Custom configuration with safety bounds
  SignalSensitivityManager.setActiveProfile('CUSTOM', {
    signalThreshold: 58,
    minimumRR: 1.4,
    minimumNetRR: 1.08,
  });
  assert.strictEqual(SignalSensitivityManager.getActiveProfileName(), 'CUSTOM');
  const customConfig = SignalSensitivityManager.getActiveConfig();
  assert.strictEqual(customConfig.signalThreshold, 58);
  assert.strictEqual(customConfig.minimumRR, 1.4);
  console.log('✓ Test 7: Custom fine-tuning applies specified values');

  // Test 8: Reset to Default restores BALANCED
  SignalSensitivityManager.resetToDefault();
  assert.strictEqual(SignalSensitivityManager.getActiveProfileName(), 'BALANCED');
  assert.strictEqual(serverConfig.getConfig().thresholds.signalThreshold, 65);
  console.log('✓ Test 8: Reset to default restores BALANCED profile cleanly');

  console.log('\n--- All Sensitivity Tests Passed Successfully! ---');
  process.exit(0);
}

runSensitivityTests().catch((err) => {
  console.error('Sensitivity test failed:', err);
  process.exit(1);
});
