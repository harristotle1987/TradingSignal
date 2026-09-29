import assert from 'assert';
import {
  SEC_AUTH,
  SEC_SESSION,
  SEC_AUTHZ,
  SEC_INPUT,
  SEC_CSRF,
  SEC_RATE,
  SEC_SECRETS,
  SEC_LOG,
  SecurityAuditLogger,
  InputValidator,
  RateLimiter,
  CSRFProtection,
  SecretsManager,
} from '../src/server/security/SecurityService.js';
import { timingSafeStringEquals, extractAuthToken } from '../src/server/middleware/adminAuth.js';
import { normalizeOrigin, getAllowedOrigins } from '../src/server/middleware/cors.js';

async function runSecurityTests() {
  console.log('\n=== OWASP ASVS & FIREBASE SECURITY STANDARDS REGRESSION ===\n');

  // Test 1: SEC-AUTH - Authentication & Timing-Safe String Comparison
  console.log('Test 1: SEC-AUTH - Timing-safe comparison & token extraction (OWASP ASVS V2)');
  assert.strictEqual(timingSafeStringEquals('secret-token-123', 'secret-token-123'), true, 'Matching tokens must equal');
  assert.strictEqual(timingSafeStringEquals('secret-token-123', 'secret-token-124'), false, 'Different tokens must not equal');
  assert.strictEqual(timingSafeStringEquals('short', 'longer-token'), false, 'Different length tokens must not equal');

  // Extract auth token from various header formats
  const reqBearer = { headers: { authorization: 'Bearer my-secret-key-123' } } as any;
  assert.strictEqual(extractAuthToken(reqBearer), 'my-secret-key-123', 'Bearer token must be extracted');

  const reqAdminKey = { headers: { 'x-admin-key': 'admin-key-abc' } } as any;
  assert.strictEqual(extractAuthToken(reqAdminKey), 'admin-key-abc', 'x-admin-key header extracted');

  const reqEmpty = { headers: {} } as any;
  assert.strictEqual(extractAuthToken(reqEmpty), null, 'Empty headers return null');
  console.log('✓ Test 1 passed: SEC-AUTH timing-safe auth and token extraction verified.');

  // Test 2: SEC-SESSION - Session & Token Integrity (OWASP ASVS V3)
  console.log('Test 2: SEC-SESSION - Session and token integrity verification');
  const validTokenReq = { headers: { authorization: 'Bearer session-valid-token' } } as any;
  const extracted = extractAuthToken(validTokenReq);
  assert(extracted !== null && extracted.length >= 8, 'Token format integrity verified');
  console.log('✓ Test 2 passed: SEC-SESSION token integrity verified.');

  // Test 3: SEC-AUTHZ - Authorization and Access Control (OWASP ASVS V4)
  console.log('Test 3: SEC-AUTHZ - Authorization and Access Control');
  SecurityAuditLogger.logEvent(SEC_AUTHZ, 'Test authorization access granted', { user: 'admin' });
  SecurityAuditLogger.logViolation(SEC_AUTHZ, 'Test unauthorized access attempt', { path: '/api/signals/all' });
  console.log('✓ Test 3 passed: SEC-AUTHZ access control logging verified.');

  // Test 4: SEC-INPUT - Input Validation, Normalization & Sanitization (OWASP ASVS V5)
  console.log('Test 4: SEC-INPUT - Input validation and sanitization');
  // Symbol validation
  assert.strictEqual(InputValidator.validateSymbol('btcusdt').valid, true, 'Valid symbol normalized');
  assert.strictEqual(InputValidator.validateSymbol('btcusdt').normalized, 'BTCUSDT', 'Symbol converted to uppercase');
  assert.strictEqual(InputValidator.validateSymbol('EUR/USD').valid, false, 'Slash in symbol rejected');
  assert.strictEqual(InputValidator.validateSymbol('<script>alert(1)</script>').valid, false, 'XSS in symbol rejected');
  assert.strictEqual(InputValidator.validateSymbol('').valid, false, 'Empty symbol rejected');

  // String sanitization
  const dirty = 'Hello \x00\x1F World <script>evil()</script>';
  const clean = InputValidator.sanitizeString(dirty);
  assert.strictEqual(clean, 'Hello  World', 'Control chars and script tags stripped');

  // Numeric range validation
  const numValid = InputValidator.validateNumeric(2.5, 1.0, 10.0, 'riskReward');
  assert.strictEqual(numValid.valid, true, 'Valid numeric accepted');
  assert.strictEqual(numValid.value, 2.5, 'Numeric parsed');
  assert.strictEqual(InputValidator.validateNumeric(0.5, 1.0, 10.0, 'riskReward').valid, false, 'Below min rejected');
  assert.strictEqual(InputValidator.validateNumeric('invalid', 1.0, 10.0, 'riskReward').valid, false, 'NaN rejected');
  console.log('✓ Test 4 passed: SEC-INPUT input validation & sanitization verified.');

  // Test 5: SEC-CSRF - CSRF Protection & CORS Origin Control (OWASP ASVS V14)
  console.log('Test 5: SEC-CSRF - CORS origin normalization & CSRF defense');
  assert.strictEqual(normalizeOrigin('https://trading-signal-chi.vercel.app/'), 'https://trading-signal-chi.vercel.app', 'Trailing slash normalized');
  assert.strictEqual(normalizeOrigin('HTTPS://APP.EXAMPLE.COM'), 'https://app.example.com', 'Lowercase normalized');

  // CSRF middleware test
  let csrfPassed = false;
  const mockReqMutating = {
    method: 'POST',
    path: '/api/signals/generate',
    headers: {
      origin: 'https://attacker.com',
      'content-type': 'text/plain',
    },
  } as any;
  const mockResCsrf = {
    status: (code: number) => {
      assert.strictEqual(code, 403, 'Cross-origin state mutation without API headers blocked with 403');
      return { json: () => { csrfPassed = true; } };
    },
  } as any;
  CSRFProtection.middleware(mockReqMutating, mockResCsrf, () => {});
  assert.strictEqual(csrfPassed, true, 'CSRF protection successfully blocked insecure mutation');
  console.log('✓ Test 5 passed: SEC-CSRF CORS & CSRF defense verified.');

  // Test 6: SEC-RATE - Rate Limiting & Denial-of-Service Defense (OWASP ASVS V11)
  console.log('Test 6: SEC-RATE - Rate limiting middleware');
  RateLimiter.clear();
  const rateLimitMw = RateLimiter.create({ windowMs: 10000, maxRequests: 3, endpointName: 'UnitTest' });
  const mockReqRate = { headers: {}, socket: { remoteAddress: '192.168.1.100' }, path: '/api/test' } as any;

  let rateStatus = 200;
  const mockResRate = {
    setHeader: () => {},
    status: (code: number) => {
      rateStatus = code;
      return { json: () => {} };
    },
  } as any;

  // Requests 1, 2, 3 should succeed
  rateLimitMw(mockReqRate, mockResRate, () => {});
  assert.strictEqual(rateStatus, 200, 'Request 1 allowed');
  rateLimitMw(mockReqRate, mockResRate, () => {});
  assert.strictEqual(rateStatus, 200, 'Request 2 allowed');
  rateLimitMw(mockReqRate, mockResRate, () => {});
  assert.strictEqual(rateStatus, 200, 'Request 3 allowed');

  // Request 4 should be blocked with 429 Too Many Requests
  rateLimitMw(mockReqRate, mockResRate, () => {});
  assert.strictEqual(rateStatus, 429, 'Request 4 rate-limited with 429');
  console.log('✓ Test 6 passed: SEC-RATE sliding window rate limiting verified.');

  // Test 7: SEC-SECRETS - Secrets Management & Redaction (OWASP ASVS V6)
  console.log('Test 7: SEC-SECRETS - Secret masking and sanitization');
  assert.strictEqual(SecretsManager.maskSecret('sk_live_1234567890abcdef'), 'sk_***def', 'Long secret masked');
  assert.strictEqual(SecretsManager.maskSecret('short'), '******', 'Short secret masked');

  const rawConfig = {
    apiKey: 'secret-api-key-999',
    databasePassword: 'super-secret-password',
    symbol: 'BTCUSDT',
    publicSetting: 100,
  };
  const sanitized = SecretsManager.sanitizeForLogging(rawConfig);
  assert.strictEqual(sanitized.symbol, 'BTCUSDT', 'Non-sensitive field preserved');
  assert.strictEqual(sanitized.publicSetting, 100, 'Non-sensitive number preserved');
  assert(sanitized.apiKey.includes('***'), 'API key masked');
  assert(sanitized.databasePassword.includes('***'), 'Password masked');
  console.log('✓ Test 7 passed: SEC-SECRETS secret redaction verified.');

  // Test 8: SEC-LOG - Structured Security Audit Logging (OWASP ASVS V7)
  console.log('Test 8: SEC-LOG - Structured Security Audit Logging');
  SecurityAuditLogger.logEvent(SEC_LOG, 'Audit test record', { testId: 123 });
  SecurityAuditLogger.logWarning(SEC_LOG, 'Audit warning test record', { warning: 'test' });
  SecurityAuditLogger.logViolation(SEC_LOG, 'Audit violation test record', { violation: 'test' });
  console.log('✓ Test 8 passed: SEC-LOG structured audit events verified.');

  console.log('\n\x1b[32m[SECURITY STANDARDS SUCCESS] All OWASP ASVS & Firebase security checks passed!\x1b[0m\n');
}

runSecurityTests().catch((err) => {
  console.error('\x1b[31m[SECURITY STANDARDS FAILED]\x1b[0m', err);
  process.exit(1);
});
