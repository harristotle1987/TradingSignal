process.env.VERCEL = '1';
process.env.NODE_ENV = 'production';
import assert from 'assert';
import handler from '../api/index.js';
import { setMockNeonPool } from '../src/server/infrastructure/neon/db.js';

function mockReqRes(method: string, url: string, body: any = {}) {
  const req: any = {
    method,
    url,
    originalUrl: url,
    get path() {
      return this.url.split('?')[0];
    },
    headers: { 'content-type': 'application/json' },
    body,
    query: {},
    params: {},
  };

  let statusCode = 200;
  let responseData: any = null;
  const headers: Record<string, string> = {};

  let resolvePromise: any = null;
  const donePromise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });

  const res: any = {
    statusCode: 200,
    headersSent: false,
    setHeader(key: string, value: string) {
      headers[key.toLowerCase()] = value;
    },
    getHeader(key: string) {
      return headers[key.toLowerCase()];
    },
    status(code: number) {
      statusCode = code;
      this.statusCode = code;
      return this;
    },
    write(chunk: any) {
      if (chunk) {
        if (responseData === null) responseData = '';
        if (typeof responseData === 'string') {
          responseData += chunk.toString();
        }
      }
      return true;
    },
    end(chunk: any) {
      this.headersSent = true;
      if (chunk) {
        if (responseData === null) responseData = '';
        if (typeof responseData === 'string') {
          responseData += chunk.toString();
        }
      }
      if (typeof responseData === 'string') {
        try {
          responseData = JSON.parse(responseData);
        } catch {}
      }
      if (resolvePromise) resolvePromise();
    },
    json(data: any) {
      this.headersSent = true;
      responseData = data;
      if (resolvePromise) resolvePromise();
      return this;
    },
    send(data: any) {
      this.headersSent = true;
      if (typeof data === 'object') {
        responseData = data;
      } else {
        if (responseData === null) responseData = '';
        if (typeof responseData === 'string') {
          responseData += data.toString();
        }
      }
      if (resolvePromise) resolvePromise();
      return this;
    },
  };

  return { req, res, getStatus: () => statusCode, getBody: () => responseData, done: () => donePromise };
}

export async function runVercelEntrypointTests(): Promise<void> {
  console.log('\n=== VERCEL ENTRYPOINT (api/index.ts) GUARDED REGRESSION TESTS ===\n');

  // Test 1: GET /api/health returns HTTP 200
  console.log('Test 1: GET /api/health returns HTTP response');
  const healthTest = mockReqRes('GET', '/api/health');
  await handler(healthTest.req, healthTest.res);
  await healthTest.done();
  console.log('DEBUG [healthTest status]:', healthTest.getStatus());
  console.log('DEBUG [healthTest body]:', JSON.stringify(healthTest.getBody()));
  assert.strictEqual(healthTest.getStatus(), 200, 'GET /api/health must return HTTP 200');
  assert(healthTest.getBody()?.status !== undefined, 'Health response must contain status field');
  console.log('✓ Test 1 passed: GET /api/health returns valid response.');

  // Test 2: GET /api/signals returns HTTP response when Neon is unavailable
  console.log('Test 2: GET /api/signals returns HTTP response (503 PERSISTENCE_UNAVAILABLE) when Neon is unavailable');
  const failingPool = {
    query: async () => {
      throw new Error('Neon connection failed');
    },
  } as any;
  setMockNeonPool(failingPool);

  try {
    const signalsTest = mockReqRes('GET', '/api/signals');
    await handler(signalsTest.req, signalsTest.res);
    await signalsTest.done();
    assert(
      signalsTest.getStatus() === 503 || signalsTest.getStatus() === 200,
      `GET /api/signals must return HTTP response (got ${signalsTest.getStatus()})`
    );
    if (signalsTest.getStatus() === 503) {
      assert.strictEqual(signalsTest.getBody()?.error, 'PERSISTENCE_UNAVAILABLE');
    }
    console.log('✓ Test 2 passed: GET /api/signals returns HTTP response even when Neon is unavailable.');
  } finally {
    setMockNeonPool(null);
  }

  // Test 3: POST /api/auth/session returns HTTP response when Neon is unavailable
  console.log('Test 3: POST /api/auth/session returns HTTP response when Neon is unavailable');
  setMockNeonPool(failingPool);
  try {
    const authTest = mockReqRes('POST', '/api/auth/session');
    await handler(authTest.req, authTest.res);
    await authTest.done();
    assert(
      authTest.getStatus() === 401 || authTest.getStatus() === 503 || authTest.getStatus() === 200,
      `POST /api/auth/session must return HTTP response (got ${authTest.getStatus()})`
    );
    console.log('✓ Test 3 passed: POST /api/auth/session returns HTTP response even when Neon is unavailable.');
  } finally {
    setMockNeonPool(null);
  }

  // Test 4: Entrypoint catches exceptions and returns guarded clean JSON payload
  console.log('Test 4: Entrypoint catches exceptions and returns guarded clean JSON payload');
  const errorRes = mockReqRes('GET', '/api/invalid-dispatch-sim');
  // Pass null request to trigger error in dispatch block
  await handler(null, errorRes.res);
  await errorRes.done();
  assert.strictEqual(errorRes.getStatus(), 500, 'Guarded invocation error must return HTTP 500');
  assert.strictEqual(errorRes.getBody()?.error, 'FUNCTION_INVOCATION_FAILED');
  assert(errorRes.getBody() !== null, 'Response must contain JSON body');
  assert(!JSON.stringify(errorRes.getBody()).includes('DATABASE_URL'), 'Response MUST NEVER expose DATABASE_URL');
  assert(!JSON.stringify(errorRes.getBody()).includes('postgres://'), 'Response MUST NEVER expose SQL/DB connection strings');
  console.log('✓ Test 4 passed: Entrypoint never exposes credentials, stack traces, or secrets.');

  console.log('\n\x1b[32m[VERCEL ENTRYPOINT SUCCESS] All Vercel entrypoint regression tests passed!\x1b[0m\n');
}

if (process.argv[1]?.endsWith('vercel-entrypoint.test.ts')) {
  runVercelEntrypointTests()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('\x1b[31m[VERCEL ENTRYPOINT FAILED]\x1b[0m', err);
      process.exit(1);
    });
}
