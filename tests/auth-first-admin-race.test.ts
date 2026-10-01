/**
 * First-Admin Race Condition Test Suite
 *
 * Verifies that concurrent first registrations NEVER produce multiple ADMIN accounts:
 * - Fires N simultaneous registration requests concurrently using Promise.all
 * - Leverages PostgreSQL transactional advisory locks (pg_advisory_xact_lock) and
 *   partial unique index (idx_users_single_admin)
 * - Verifies that exactly ONE user is created as ADMIN and all other users are created as USER
 * - Verifies that the database contains strictly 1 user with role = 'ADMIN'
 * - Verifies subsequent registrations are always assigned USER
 */

import assert from 'assert';
import { NeonAuthService } from '../src/server/auth/NeonAuthService.js';
import { setMockNeonPool } from '../src/server/infrastructure/neon/db.js';
import { MockNeonStore } from '../src/server/infrastructure/neon/mockDb.js';

async function runRaceConditionTests() {
  console.log('\n===============================================================');
  console.log('=== RUNNING FIRST-ADMIN RACE CONDITION TEST (CONCURRENCY)  ===');
  console.log('===============================================================\n');

  // Initialize a fresh mock Neon store simulating PostgreSQL transaction & unique index semantics
  const testStore = new MockNeonStore();
  setMockNeonPool(testStore);

  // Scenario 1: 15 simultaneous first registration requests
  const CONCURRENT_USERS = 15;
  console.log(`Firing ${CONCURRENT_USERS} simultaneous first registration requests in parallel via Promise.all...`);

  const registrationPromises = Array.from({ length: CONCURRENT_USERS }).map((_, i) => {
    return NeonAuthService.register({
      email: `concurrent_candidate_${i}@tradingsignal.io`,
      password: `ConcurrentPass${i}123!`,
      displayName: `Candidate ${i}`,
    });
  });

  const results = await Promise.all(registrationPromises);

  // Verify all registrations completed successfully
  assert.strictEqual(results.length, CONCURRENT_USERS, 'All requests must complete');
  for (let i = 0; i < results.length; i++) {
    assert(results[i].success, `Candidate ${i} registration should succeed, got error: ${results[i].error}`);
  }

  // Count how many users were promoted to ADMIN
  const adminResults = results.filter((r) => r.user?.role === 'ADMIN');
  const userResults = results.filter((r) => r.user?.role === 'USER');
  const firstAdminFlags = results.filter((r) => r.isFirstAdmin === true);

  console.log(`\nRegistration Results:`);
  console.log(`- Total successful accounts created: ${results.length}`);
  console.log(`- Total accounts promoted to ADMIN:   ${adminResults.length}`);
  console.log(`- Total accounts assigned USER:      ${userResults.length}`);
  console.log(`- Accounts with isFirstAdmin=true:   ${firstAdminFlags.length}`);

  // CRITICAL ATOMICITY INVARIANTS:
  assert.strictEqual(
    adminResults.length,
    1,
    `RACE CONDITION DETECTED! Expected exactly 1 ADMIN, found ${adminResults.length}`
  );
  assert.strictEqual(
    firstAdminFlags.length,
    1,
    `Expected exactly 1 account with isFirstAdmin=true, found ${firstAdminFlags.length}`
  );
  assert.strictEqual(
    userResults.length,
    CONCURRENT_USERS - 1,
    `Expected ${CONCURRENT_USERS - 1} accounts to receive USER role, found ${userResults.length}`
  );

  // Directly inspect the database store
  let dbAdminCount = 0;
  let dbUserCount = 0;
  for (const user of testStore.users.values()) {
    if (user.role.toUpperCase() === 'ADMIN') {
      dbAdminCount++;
    } else if (user.role.toUpperCase() === 'USER') {
      dbUserCount++;
    }
  }

  console.log(`\nAuthoritative Database Store Audit:`);
  console.log(`- Users in table:   ${testStore.users.size}`);
  console.log(`- DB ADMIN records: ${dbAdminCount}`);
  console.log(`- DB USER records:  ${dbUserCount}`);

  assert.strictEqual(dbAdminCount, 1, `Database MUST contain exactly 1 ADMIN user! Found ${dbAdminCount}`);
  assert.strictEqual(dbUserCount, CONCURRENT_USERS - 1, `Database MUST contain ${CONCURRENT_USERS - 1} USER records!`);

  // Scenario 2: Subsequent registrations after race condition
  console.log('\nTesting subsequent registration after race condition...');
  const subsequentReg = await NeonAuthService.register({
    email: 'subsequent_user@tradingsignal.io',
    password: 'SubsequentPassword123!',
    displayName: 'Subsequent User',
  });

  assert(subsequentReg.success, 'Subsequent registration must succeed');
  assert.strictEqual(subsequentReg.user?.role, 'USER', 'Subsequent user MUST be assigned USER role');
  assert.strictEqual(subsequentReg.user?.admin, false, 'Subsequent user admin flag MUST be false');
  assert.strictEqual(subsequentReg.isFirstAdmin, false, 'Subsequent user isFirstAdmin MUST be false');
  console.log('✓ Subsequent registration verified: Always assigned USER');

  console.log('\n===============================================================');
  console.log('=== FIRST-ADMIN RACE CONDITION TEST PASSED PERFECTLY (100%) ===');
  console.log('===============================================================\n');
}

runRaceConditionTests().catch((err) => {
  console.error('Race condition test failed:', err);
  process.exit(1);
});
