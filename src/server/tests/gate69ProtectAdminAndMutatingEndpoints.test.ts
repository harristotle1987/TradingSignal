import express from 'express';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { corsMiddleware, getAllowedOrigins, normalizeOrigin } from '../middleware/cors.js';
import { extractAuthToken } from '../middleware/adminAuth.js';
import healthRouter from '../routes/health.js';
import signalsRouter from '../routes/signals.js';
import notificationsRouter from '../routes/notifications.js';

describe('GATE 69 — Protect Admin and Mutating Endpoints', { timeout: 15000 }, () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    process.env.ADMIN_API_KEY = 'test-gate69-admin-key-999';
    process.env.SCANNER_CRON_SECRET = 'test-gate69-cron-secret-888';
    process.env.APP_URL = 'https://app.tradingsignal.ai';
    process.env.ALLOWED_ORIGINS = 'https://admin.tradingsignal.ai,https://dev.tradingsignal.ai';

    const app = express();
    app.use(express.json());
    app.use(corsMiddleware);
    app.use('/api', healthRouter);
    app.use('/api', signalsRouter);
    app.use('/api', notificationsRouter);

    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const address = server.address() as any;
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

  afterAll(() => {
    if (server) {
      server.close();
    }
  });

  describe('1. Token Extraction Unit Tests', () => {
    it('extracts Bearer token correctly', () => {
      const req = { headers: { authorization: 'Bearer my-secret-token' } } as any;
      expect(extractAuthToken(req)).toBe('my-secret-token');
    });

    it('extracts x-admin-key header correctly', () => {
      const req = { headers: { 'x-admin-key': 'admin-key-123' } } as any;
      expect(extractAuthToken(req)).toBe('admin-key-123');
    });

    it('extracts x-api-key header correctly', () => {
      const req = { headers: { 'x-api-key': 'api-key-456' } } as any;
      expect(extractAuthToken(req)).toBe('api-key-456');
    });

    it('returns null when no token is present', () => {
      const req = { headers: {} } as any;
      expect(extractAuthToken(req)).toBeNull();
    });
  });

  describe('2. CORS Helper Unit Tests', () => {
    it('normalizes origins correctly', () => {
      expect(normalizeOrigin('https://APP.example.com///')).toBe('https://app.example.com');
    });

    it('parses APP_URL and ALLOWED_ORIGINS correctly', () => {
      const origins = getAllowedOrigins();
      expect(origins).toContain('https://app.tradingsignal.ai');
      expect(origins).toContain('https://admin.tradingsignal.ai');
      expect(origins).toContain('https://dev.tradingsignal.ai');
    });
  });

  describe('3. Route Protection Integration Tests', () => {
    const protectedEndpoints: { method: string; path: string; body?: any }[] = [
      { method: 'DELETE', path: '/api/signals' },
      { method: 'DELETE', path: '/api/signals/log' },
      { method: 'DELETE', path: '/api/signals/log/test-id-123' },
      { method: 'DELETE', path: '/api/signals/outcomes' },
      { method: 'POST', path: '/api/signals/backfill-outcomes' },
      { method: 'POST', path: '/api/signals/monitor' },
      { method: 'POST', path: '/api/signals/regime-thresholds/policy', body: { policy: 'DYNAMIC' } },
      { method: 'POST', path: '/api/signals/frequency-config', body: { minIntervalMinutes: 15 } },
      { method: 'DELETE', path: '/api/signals/funnel-analytics' },
      { method: 'POST', path: '/api/signals/test-outcome' },
      { method: 'POST', path: '/api/notifications/test', body: {} },
    ];

    for (const ep of protectedEndpoints) {
      it(`rejects unauthenticated request to ${ep.method} ${ep.path} with 401`, async () => {
        const res = await fetch(`${baseUrl}${ep.path}`, {
          method: ep.method,
          headers: { 'Content-Type': 'application/json' },
          body: ep.body ? JSON.stringify(ep.body) : undefined,
        });

        expect(res.status).toBe(401);
        const data = await res.json();
        expect(data.success).toBe(false);
        expect(data.status).toBe('UNAUTHORIZED');
      });

      it(`allows authenticated request to ${ep.method} ${ep.path} with ADMIN_API_KEY`, async () => {
        const res = await fetch(`${baseUrl}${ep.path}`, {
          method: ep.method,
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.ADMIN_API_KEY}`,
          },
          body: ep.body ? JSON.stringify(ep.body) : undefined,
        });

        // Authorized requests should not return 401 Unauthorized
        expect(res.status).not.toBe(401);
      });
    }

    it('protects POST /api/scanner/trigger with SCANNER_CRON_SECRET', async () => {
      // Unauthenticated
      const resUnauth = await fetch(`${baseUrl}/api/scanner/trigger`, {
        method: 'POST',
      });
      expect(resUnauth.status).toBe(401);

      // Authenticated with valid cron secret
      const resAuth = await fetch(`${baseUrl}/api/scanner/trigger`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.SCANNER_CRON_SECRET}`,
        },
      });
      expect(resAuth.status).not.toBe(401);
    });

    it('allows GET public endpoints without authentication', async () => {
      const publicEndpoints = ['/api/health', '/api/signals', '/api/signals/frequency-config'];

      for (const path of publicEndpoints) {
        const res = await fetch(`${baseUrl}${path}`, { method: 'GET' });
        expect(res.status).not.toBe(401);
      }
    });
  });

  describe('4. CORS Explicit Allowed Origin Tests', () => {
    it('sets Access-Control-Allow-Origin to exact APP_URL when origin is authorized', async () => {
      const res = await fetch(`${baseUrl}/api/health`, {
        headers: { Origin: 'https://app.tradingsignal.ai' },
      });

      expect(res.headers.get('access-control-allow-origin')).toBe('https://app.tradingsignal.ai');
      expect(res.headers.get('access-control-allow-origin')).not.toBe('*');
    });

    it('sets Access-Control-Allow-Origin for ALLOWED_ORIGINS entries', async () => {
      const res = await fetch(`${baseUrl}/api/health`, {
        headers: { Origin: 'https://admin.tradingsignal.ai' },
      });

      expect(res.headers.get('access-control-allow-origin')).toBe('https://admin.tradingsignal.ai');
    });

    it('rejects preflight OPTIONS from unauthorized origin with 403', async () => {
      const res = await fetch(`${baseUrl}/api/signals`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://malicious-site.com',
          'Access-Control-Request-Method': 'POST',
        },
      });

      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.status).toBe('FORBIDDEN');
    });

    it('rejects mutating POST from unauthorized origin with 403', async () => {
      const res = await fetch(`${baseUrl}/api/signals/monitor`, {
        method: 'POST',
        headers: {
          Origin: 'https://malicious-site.com',
          Authorization: `Bearer ${process.env.ADMIN_API_KEY}`,
        },
      });

      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.status).toBe('FORBIDDEN');
    });
  });
});
