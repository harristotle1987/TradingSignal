/**
 * Authentication Test Suite (Neon Auth Architecture)
 *
 * Verifies:
 * - User Registration with atomic First-Admin promotion
 * - Password hashing (Node.js scrypt + 16-byte random salt + timingSafeEqual)
 * - Credential verification & Session provisioning
 * - Server-side session validation via HttpOnly cookie & Bearer token
 * - Session revocation on logout
 * - Fail-closed semantics when Neon is unavailable
 */

import assert from 'assert';
import express from 'express';
import cookieParser from 'cookie-parser';
import { NeonAuthService, SESSION_COOKIE_NAME } from '../src/server/auth/NeonAuthService.js';
import authRouter from '../src/server/routes/auth.js';
import { setMockNeonPool, getMockNeonPool } from '../src/server/infrastructure/neon/db.js';
import { MockNeonStore } from '../src/server/infrastructure/neon/mockDb.js';

async function runAuthTests() {
  console.log('\n======================================================');
  console.log('=== RUNNING AUTHENTICATION TEST SUITE (NEON AUTH) ===');
  console.log('======================================================\n');

  const testStore = new MockNeonStore();
  setMockNeonPool(testStore);

  // Setup express server with authRouter and cookie-parser
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api', authRouter);

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
    // Test 1: Cryptographic password hashing & constant-time verification
    console.log('Test 1: Password hashing and timing-safe verification');
    const password = 'SuperSecretPassword123!';
    const hash = NeonAuthService.hashPassword(password);
    assert(hash.includes(':'), 'Hash must contain salt:key delimiter');
    const [salt, key] = hash.split(':');
    assert(salt.length === 32, 'Salt must be 16 bytes hex (32 characters)');
    assert(key.length === 128, 'Derived key must be 64 bytes hex (128 characters)');
    assert(NeonAuthService.verifyPassword(password, hash) === true, 'Correct password must verify');
    assert(NeonAuthService.verifyPassword('WrongPassword!', hash) === false, 'Wrong password must be rejected');
    assert(NeonAuthService.verifyPassword(password, null) === false, 'Null hash must return false');
    console.log('✓ Test 1: Scrypt password hashing & verification verified');

    // Test 2: First Registration atomically creates ONLY ADMIN
    console.log('\nTest 2: POST /api/auth/register (First registered user becomes ADMIN)');
    const regRes1 = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'first_admin@tradingsignal.io',
        password: 'AdminPassword123!',
        displayName: 'First Admin User',
        // Malicious client attempt to supply role should be ignored
        role: 'SUPER_ROOT',
        admin: false,
      }),
    });

    assert.strictEqual(regRes1.status, 201, `Expected status 201, got ${regRes1.status}`);
    const regData1 = await regRes1.json();
    assert.strictEqual(regData1.success, true, 'Registration must be successful');
    assert.strictEqual(regData1.admin, true, 'First user must be ADMIN');
    assert.strictEqual(regData1.role, 'ADMIN', 'First user role must be ADMIN');
    assert.strictEqual(regData1.isFirstAdmin, true, 'isFirstAdmin must be true');
    assert(regData1.session?.token, 'Must return session token');

    // Check Set-Cookie header contains HttpOnly neon_session
    const setCookieHeader1 = regRes1.headers.get('set-cookie');
    assert(setCookieHeader1, 'Set-Cookie header must be present');
    assert(setCookieHeader1.includes(SESSION_COOKIE_NAME), 'Must set neon_session cookie');
    assert(setCookieHeader1.toLowerCase().includes('httponly'), 'Cookie must be HttpOnly');
    console.log('✓ Test 2: First user registration atomically established ONLY ADMIN');

    // Test 3: Second Registration automatically becomes USER
    console.log('\nTest 3: POST /api/auth/register (Subsequent user becomes USER)');
    const regRes2 = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'second_user@tradingsignal.io',
        password: 'UserPassword123!',
        displayName: 'Second Normal User',
        // Malicious client attempt to elevate to admin must be ignored
        role: 'ADMIN',
        admin: true,
      }),
    });

    assert.strictEqual(regRes2.status, 201, `Expected status 201, got ${regRes2.status}`);
    const regData2 = await regRes2.json();
    assert.strictEqual(regData2.success, true);
    assert.strictEqual(regData2.admin, false, 'Second user must NOT be admin');
    assert.strictEqual(regData2.role, 'USER', 'Second user role must be USER');
    assert.strictEqual(regData2.isFirstAdmin, false, 'isFirstAdmin must be false');
    console.log('✓ Test 3: Subsequent user registration correctly assigned USER role (client role ignored)');

    // Test 4: Duplicate email registration rejected
    console.log('\nTest 4: Duplicate email registration rejection');
    const dupRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'FIRST_ADMIN@tradingsignal.io', // case-insensitive check
        password: 'AnotherPassword123!',
      }),
    });
    assert.strictEqual(dupRes.status, 400);
    const dupData = await dupRes.json();
    assert.strictEqual(dupData.success, false);
    assert(dupData.error.includes('already exists'), 'Error must notify that account already exists');
    console.log('✓ Test 4: Duplicate email rejected cleanly');

    // Test 5: Authentication (POST /api/auth/session) with valid credentials
    console.log('\nTest 5: POST /api/auth/session (Valid credentials)');
    const loginRes = await fetch(`${baseUrl}/api/auth/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'first_admin@tradingsignal.io',
        password: 'AdminPassword123!',
      }),
    });

    assert.strictEqual(loginRes.status, 200);
    const loginData = await loginRes.json();
    assert.strictEqual(loginData.success, true);
    assert.strictEqual(loginData.authenticated, true);
    assert.strictEqual(loginData.user.role, 'ADMIN');
    assert(loginData.session.token, 'Session token must be returned');
    const adminSessionCookie = loginRes.headers.get('set-cookie') || '';
    assert(adminSessionCookie.includes(SESSION_COOKIE_NAME));
    console.log('✓ Test 5: Authentication successful and session issued');

    // Test 6: Authentication with invalid password rejected
    console.log('\nTest 6: POST /api/auth/session with wrong password');
    const wrongPassRes = await fetch(`${baseUrl}/api/auth/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'first_admin@tradingsignal.io',
        password: 'IncorrectPassword999!',
      }),
    });
    assert.strictEqual(wrongPassRes.status, 401);
    const wrongPassData = await wrongPassRes.json();
    assert.strictEqual(wrongPassData.success, false);
    console.log('✓ Test 6: Wrong password rejected with 401');

    // Test 7: GET /api/auth/me resolves identity from HttpOnly Cookie
    console.log('\nTest 7: GET /api/auth/me via Cookie');
    const meResCookie = await fetch(`${baseUrl}/api/auth/me`, {
      headers: {
        Cookie: `${SESSION_COOKIE_NAME}=${loginData.session.token}`,
      },
    });
    assert.strictEqual(meResCookie.status, 200);
    const meDataCookie = await meResCookie.json();
    assert.strictEqual(meDataCookie.authenticated, true);
    assert.strictEqual(meDataCookie.user.email, 'first_admin@tradingsignal.io');
    assert.strictEqual(meDataCookie.user.role, 'ADMIN');
    console.log('✓ Test 7: GET /api/auth/me resolved from HttpOnly session cookie');

    // Test 8: GET /api/auth/me resolves identity from Authorization Bearer token
    console.log('\nTest 8: GET /api/auth/me via Bearer Token');
    const meResBearer = await fetch(`${baseUrl}/api/auth/me`, {
      headers: {
        Authorization: `Bearer ${loginData.session.token}`,
      },
    });
    assert.strictEqual(meResBearer.status, 200);
    const meDataBearer = await meResBearer.json();
    assert.strictEqual(meDataBearer.authenticated, true);
    assert.strictEqual(meDataBearer.user.role, 'ADMIN');
    console.log('✓ Test 8: GET /api/auth/me resolved from Bearer token');

    // Test 9: GET /api/auth/me with no session returns 401
    console.log('\nTest 9: GET /api/auth/me without session');
    const unauthMe = await fetch(`${baseUrl}/api/auth/me`);
    assert.strictEqual(unauthMe.status, 401);
    const unauthData = await unauthMe.json();
    assert.strictEqual(unauthData.authenticated, false);
    console.log('✓ Test 9: Unauthenticated GET /api/auth/me returns 401');

    // Test 10: POST /api/auth/logout revokes session in DB and clears cookie
    console.log('\nTest 10: POST /api/auth/logout');
    const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: {
        Cookie: `${SESSION_COOKIE_NAME}=${loginData.session.token}`,
      },
    });
    assert.strictEqual(logoutRes.status, 200);
    const clearCookieHeader = logoutRes.headers.get('set-cookie') || '';
    assert(clearCookieHeader.includes(`${SESSION_COOKIE_NAME}=;`) || clearCookieHeader.includes('Max-Age=0') || clearCookieHeader.includes('Expires='));

    // Verify session is revoked
    const checkRevoked = await fetch(`${baseUrl}/api/auth/me`, {
      headers: {
        Authorization: `Bearer ${loginData.session.token}`,
      },
    });
    assert.strictEqual(checkRevoked.status, 401, 'Revoked session must be rejected with 401');
    console.log('✓ Test 10: Session revoked and cookie cleared successfully on logout');

    // Test 11: Fail-Closed Architecture when Neon is unavailable
    console.log('\nTest 11: Fail Closed when Neon database is unreachable');
    setMockNeonPool(null); // Simulate total DB unavailability
    const origDbUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;

    const failClosedLogin = await fetch(`${baseUrl}/api/auth/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'first_admin@tradingsignal.io',
        password: 'AdminPassword123!',
      }),
    });
    assert.strictEqual(failClosedLogin.status, 503, 'Must return 503 Service Unavailable when DB is down');
    const failClosedData = await failClosedLogin.json();
    assert.strictEqual(failClosedData.success, false);
    assert(failClosedData.error.includes('Fail Closed'), 'Error must explicitly state Fail Closed');

    // Restore store
    setMockNeonPool(testStore);
    if (origDbUrl) process.env.DATABASE_URL = origDbUrl;
    console.log('✓ Test 11: System fails closed securely without falling back to hardcoded tokens or fake admin identities');

    console.log('\n======================================================');
    console.log('=== ALL AUTHENTICATION TESTS PASSED PERFECTLY (11/11) ===');
    console.log('======================================================\n');
  } finally {
    if (server) {
      server.close();
    }
  }
}

runAuthTests().catch((err) => {
  console.error('Authentication test suite failed:', err);
  process.exit(1);
});
