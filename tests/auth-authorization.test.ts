/**
 * Authorization Test Suite (Neon Auth Architecture)
 *
 * Verifies server-side authorization enforcement across all ADMIN-only operations:
 * 1. Manual scanner (POST /api/scanner/manual-trigger)
 * 2. Scanner reload (POST /api/scanner/reload)
 * 3. AI scanner (POST /api/signals/generate)
 * 4. Specific trade search (POST /api/signals/trade-search)
 * 5. Active trade refresh (POST /api/signals/refresh)
 * 6. Scanner settings (POST /api/scanner/settings)
 * 7. Daily-cap reset (POST /api/scanner/reset-cap & POST /api/signals/reset-cap)
 * 8. Destructive administrative operations:
 *    - DELETE /api/signals/:id
 *    - DELETE /api/signals
 *    - DELETE /api/signals/all
 *    - DELETE /api/signals/log/:id
 *    - POST /api/signals/log/bulk-delete
 *    - DELETE /api/signals/log
 *    - DELETE /api/signals/outcomes
 *    - DELETE /api/signals/funnel-analytics
 *
 * Checks:
 * - Unauthenticated request rejected with 401 Unauthorized
 * - Standard authenticated USER rejected with 403 Forbidden
 * - Authenticated ADMIN permitted
 * - Fail Closed: Database outage rejected with 503 without fallback
 */

import assert from 'assert';
import express from 'express';
import cookieParser from 'cookie-parser';
import { NeonAuthService } from '../src/server/auth/NeonAuthService.js';
import signalsRouter from '../src/server/routes/signals.js';
import authRouter from '../src/server/routes/auth.js';
import { hourlyScanner } from '../src/server/signals/HourlyScanner.js';
import { signalEngine } from '../src/server/signals/SignalEngine.js';
import { setMockNeonPool } from '../src/server/infrastructure/neon/db.js';
import { MockNeonStore } from '../src/server/infrastructure/neon/mockDb.js';

async function runAuthorizationTests() {
  console.log('\n======================================================');
  console.log('=== RUNNING AUTHORIZATION TEST SUITE (NEON RBAC)  ===');
  console.log('======================================================\n');

  const testStore = new MockNeonStore();
  setMockNeonPool(testStore);

  // Stub long-running market scans so auth tests execute instantaneously
  const origTrigger = hourlyScanner.triggerManualScan;
  const origGen = signalEngine.generateSignal;
  hourlyScanner.triggerManualScan = async () => ({ success: true, status: 'COMPLETED', timestamp: Date.now() } as any);
  signalEngine.generateSignal = async () => ({ success: true, symbol: 'EURUSD', score: 80 } as any);

  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api', authRouter);
  app.use('/api', signalsRouter);

  let server: any;
  let baseUrl: string;

  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address() as any;
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });

  try {
    // 1. Establish the First ADMIN account
    console.log('Setting up test accounts...');
    const adminReg = await NeonAuthService.register({
      email: 'admin_rbac@tradingsignal.io',
      password: 'AdminPassword123!',
      displayName: 'System Admin',
    });
    assert(adminReg.success && adminReg.user?.role === 'ADMIN', 'First registration must be ADMIN');
    const adminToken = adminReg.session!.token;

    // 2. Establish a standard USER account
    const userReg = await NeonAuthService.register({
      email: 'user_rbac@tradingsignal.io',
      password: 'UserPassword123!',
      displayName: 'Standard User',
    });
    assert(userReg.success && userReg.user?.role === 'USER', 'Second registration must be USER');
    const userToken = userReg.session!.token;
    console.log('✓ Accounts established: 1 ADMIN, 1 USER');

    // List of all ADMIN-only operations
    const adminOperations: Array<{
      name: string;
      method: string;
      endpoint: string;
      body?: any;
    }> = [
      { name: 'Manual Scanner', method: 'POST', endpoint: '/api/scanner/manual-trigger' },
      { name: 'Scanner Reload', method: 'POST', endpoint: '/api/scanner/reload' },
      { name: 'AI Scanner', method: 'POST', endpoint: '/api/signals/generate', body: { symbol: 'EURUSD' } },
      { name: 'Specific Trade Search', method: 'POST', endpoint: '/api/signals/trade-search', body: { symbol: 'BTCUSD' } },
      { name: 'Active Trade Refresh', method: 'POST', endpoint: '/api/signals/refresh' },
      { name: 'Scanner Settings Update', method: 'POST', endpoint: '/api/scanner/settings', body: { enabled: true } },
      { name: 'Daily Cap Reset (Scanner)', method: 'POST', endpoint: '/api/scanner/reset-cap' },
      { name: 'Daily Cap Reset (Signals)', method: 'POST', endpoint: '/api/signals/reset-cap' },
      { name: 'Delete Signal By ID', method: 'DELETE', endpoint: '/api/signals/test_sig_id_1' },
      { name: 'Clear Active Signals', method: 'DELETE', endpoint: '/api/signals' },
      { name: 'Clear All Signals & Logs', method: 'DELETE', endpoint: '/api/signals/all' },
      { name: 'Delete Signal Log By ID', method: 'DELETE', endpoint: '/api/signals/log/test_log_1' },
      { name: 'Bulk Delete Signal Logs', method: 'POST', endpoint: '/api/signals/log/bulk-delete', body: { ids: ['id1', 'id2'] } },
      { name: 'Clear All Signal Logs', method: 'DELETE', endpoint: '/api/signals/log' },
      { name: 'Clear Outcomes History', method: 'DELETE', endpoint: '/api/signals/outcomes' },
      { name: 'Clear Funnel Analytics', method: 'DELETE', endpoint: '/api/signals/funnel-analytics' },
    ];

    console.log(`\nTesting ${adminOperations.length} Administrative Operations for Access Boundaries:\n`);

    for (const op of adminOperations) {
      // Step A: Unauthenticated request MUST return 401 Unauthorized
      const unauthRes = await fetch(`${baseUrl}${op.endpoint}`, {
        method: op.method,
        headers: { 'Content-Type': 'application/json' },
        body: op.body ? JSON.stringify(op.body) : undefined,
      });
      assert.strictEqual(
        unauthRes.status,
        401,
        `[${op.name}] Unauthenticated request to ${op.method} ${op.endpoint} must return 401 Unauthorized, got ${unauthRes.status}`
      );

      // Step B: Standard USER request MUST return 403 Forbidden
      const userRes = await fetch(`${baseUrl}${op.endpoint}`, {
        method: op.method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${userToken}`,
        },
        body: op.body ? JSON.stringify(op.body) : undefined,
      });
      assert.strictEqual(
        userRes.status,
        403,
        `[${op.name}] Standard USER request to ${op.method} ${op.endpoint} must return 403 Forbidden, got ${userRes.status}`
      );
      const userJson = await userRes.json();
      assert.strictEqual(userJson.success, false);
      assert(userJson.error.includes('Forbidden'), 'Response must indicate Forbidden access');

      // Step C: Authenticated ADMIN request MUST NOT be rejected by auth gate (status is not 401 or 403)
      const adminRes = await fetch(`${baseUrl}${op.endpoint}`, {
        method: op.method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`,
        },
        body: op.body ? JSON.stringify(op.body) : undefined,
      });
      assert(
        adminRes.status !== 401 && adminRes.status !== 403,
        `[${op.name}] ADMIN request must be authorized by auth gate! Received ${adminRes.status}`
      );

      console.log(`  ✓ [RBAC Gate Verified] ${op.name.padEnd(28)}: Unauth=401, User=403, Admin=Authorized (${adminRes.status})`);
    }

    // Test Fail-Closed on DB Outage
    console.log('\nTesting Fail-Closed semantics on database unavailability...');
    setMockNeonPool(null);
    const origDbUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;

    const failClosedRes = await fetch(`${baseUrl}/api/scanner/settings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ enabled: false }),
    });

    assert.strictEqual(failClosedRes.status, 503, 'Must fail closed with 503 on database unavailability');
    const failClosedData = await failClosedRes.json();
    assert.strictEqual(failClosedData.success, false);
    assert(failClosedData.error.includes('Fail Closed'), 'Error must explicitly state Fail Closed');

    setMockNeonPool(testStore);
    if (origDbUrl) process.env.DATABASE_URL = origDbUrl;
    console.log('✓ Fail-Closed verified: Database outage rejects administrative actions with 503 without fallback');

    console.log('\n======================================================');
    console.log('=== ALL AUTHORIZATION TESTS PASSED PERFECTLY (17/17) ===');
    console.log('======================================================\n');
  } finally {
    hourlyScanner.triggerManualScan = origTrigger;
    signalEngine.generateSignal = origGen;
    if (server) {
      server.close();
    }
  }
}

runAuthorizationTests().catch((err) => {
  console.error('Authorization test suite failed:', err);
  process.exit(1);
});
