/**
 * Express + Vite Server Entrypoint
 * Binds to 0.0.0.0:3000 as required by AI Studio container runtime.
 */

import express from 'express';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';

const isTestOrVercel =
  process.env.TEST_MODE === 'true' ||
  process.env.VERCEL === '1' ||
  Boolean(process.env.VERCEL_ENV) ||
  process.env.NODE_ENV === 'test';

// Load environment variables
dotenv.config();

if (isTestOrVercel) {
  process.env.TEST_MODE = 'true';
}

import { logger } from './src/server/logger.js';
import { corsMiddleware } from './src/server/middleware/cors.js';
import { globalErrorHandler } from './src/server/middleware/errorHandler.js';
import healthRouter from './src/server/routes/health.js';
import configStatusRouter from './src/server/routes/configStatus.js';
import marketRouter from './src/server/routes/market.js';
import signalsRouter from './src/server/routes/signals.js';
import notificationsRouter from './src/server/routes/notifications.js';
import authRouter from './src/server/routes/auth.js';
import { hourlyScanner } from './src/server/signals/HourlyScanner.js';
import { RepairService } from './src/server/signals/RepairService.js';
import { SignalLifecycleManager } from './src/server/signals/SignalLifecycleManager.js';
import { PushNotificationService } from './src/server/notifications/PushNotificationService.js';
import { SignalSensitivityManager } from './src/server/signals/SignalSensitivityManager.js';
import { RateLimiter, CSRFProtection, InputValidator } from './src/server/security/SecurityService.js';
import { verifyProductionReadiness } from './src/server/infrastructure/index.js';

export async function createServer() {
  // Gate 5: Production Database Readiness Check (Verifies required tables before accepting requests)
  const readiness = await verifyProductionReadiness();
  if (!readiness.ready && process.env.NODE_ENV === 'production') {
    logger.error('[Server Startup] Production readiness check failed:', { missingTables: readiness.missingTables });
  }

  const app = express();

  // Initialize Sensitivity and Calibration Manager
  SignalSensitivityManager.init();

  // Hardened Security Response Headers (OWASP ASVS V14 / SEC-CSRF)
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
  });

  // Strict CORS Middleware (SEC-CSRF)
  app.use(corsMiddleware);

  // Parse JSON payloads with bounded size (SEC-INPUT)
  app.use(express.json({ limit: '1mb' }));

  // Parse Cookie header and populate req.cookies
  app.use(cookieParser());

  // Global Rate Limiting Middleware (SEC-RATE)
  app.use(RateLimiter.create({ windowMs: 60000, maxRequests: 300, endpointName: 'GlobalAPI' }));

  // CSRF Defense for State-Mutating Operations (SEC-CSRF)
  app.use(CSRFProtection.middleware);

  // Input Validation & Normalization Middleware (SEC-INPUT)
  app.use(InputValidator.middleware);

  // Request logger middleware
  app.use((req, _res, next) => {
    if (req.path.startsWith('/api')) {
      logger.info(`${req.method} ${req.path}`);
    }
    next();
  });

  // Backend API Routes
  app.use('/api', authRouter);
  app.use('/api', healthRouter);
  app.use('/api', configStatusRouter);
  app.use('/api', marketRouter);
  app.use('/api', signalsRouter);
  app.use('/api', notificationsRouter);

  // Global Express Error Handler
  app.use(globalErrorHandler);

  // Serve static public assets (icons, manifest, sw.js)
  const publicPath = path.join(process.cwd(), 'public');
  if (fs.existsSync(publicPath)) {
    app.use(express.static(publicPath));
  }

  // Explicit route for Service Worker to prevent catch-all SPA fallback returning HTML
  app.get('/sw.js', (req, res) => {
    let swPath = path.join(process.cwd(), 'public', 'sw.js');
    if (!fs.existsSync(swPath)) {
      swPath = path.join(process.cwd(), 'dist', 'sw.js');
    }

    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Service-Worker-Allowed', '/');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

    if (fs.existsSync(swPath)) {
      return res.sendFile(swPath, (err) => {
        if (err && !res.headersSent) {
          res.status(500).send('// Error serving service worker\nconsole.error("[SW] Error serving service worker");');
        }
      });
    }

    return res.send('// Service worker placeholder\nconsole.log("[SW] Service worker placeholder");');
  });

  // Vite Middleware in Dev or Static Serve in Prod
  if (process.env.NODE_ENV !== 'production') {
    logger.info('Starting Vite in development middleware mode...');
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    logger.info('Serving static build artifacts from dist directory...');
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) {
        return next();
      }
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  return app;
}

// Start listener only when run directly (not as a serverless function or in test mode)
if (
  process.env.VERCEL !== '1' &&
  !process.env.VERCEL_ENV &&
  process.env.TEST_MODE !== 'true' &&
  process.env.NODE_ENV !== 'test'
) {
  const PORT = parseInt(process.env.PORT || '3000', 10);
  const HOST = '0.0.0.0';
  createServer()
    .then((app) => {
      const server = app.listen(PORT, HOST, () => {
        logger.info(`Trading Signal System server running on http://${HOST}:${PORT}`);

        // Perform startup repair of any active signals with duplicate or invalid TPs
        RepairService.repairActiveSignals().catch((err) => {
          logger.error('[StartupRepair] Failed to run active signals repair:', { error: String(err) });
        });

        // Perform initial historical outcome backfill across all existing active signals
        SignalLifecycleManager.backfillHistoricalOutcomesForActiveSignals()
          .then((backfillRes) => {
            logger.info('[StartupBackfill] Initial active signals outcome backfill completed:', { ...backfillRes });
          })
          .catch((err) => {
            logger.warn('[StartupBackfill] Failed to run initial outcome backfill on startup:', { error: String(err) });
          });

        // Initialize Push Notification Service
        PushNotificationService.init().catch((pushInitErr) => {
          logger.warn('[Push Notification] Startup initialization warning:', { error: String(pushInitErr) });
        });

        try {
          hourlyScanner.start();
        } catch (scanErr) {
          logger.error('Failed to start background hourly scanner service:', { error: String(scanErr) });
        }
      });

      server.on('error', (err: any) => {
        if (err?.code === 'EADDRINUSE') {
          logger.warn(`Port ${PORT} is already bound. Standalone listener skipped.`);
        } else {
          logger.error('Server listener error:', { error: String(err) });
        }
      });
    })
    .catch((err) => {
      logger.error('Failed to start server:', { error: String(err) });
    });
}
