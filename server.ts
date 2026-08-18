/**
 * Express + Vite Server Entrypoint
 * Binds to 0.0.0.0:3000 as required by AI Studio container runtime.
 */

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

import { logger } from './src/server/logger.js';
import { globalErrorHandler } from './src/server/middleware/errorHandler.js';
import healthRouter from './src/server/routes/health.js';
import configStatusRouter from './src/server/routes/configStatus.js';
import marketRouter from './src/server/routes/market.js';
import signalsRouter from './src/server/routes/signals.js';
import notificationsRouter from './src/server/routes/notifications.js';
import { hourlyScanner } from './src/server/signals/HourlyScanner.js';
import { RepairService } from './src/server/signals/RepairService.js';
import { SignalLifecycleManager } from './src/server/signals/SignalLifecycleManager.js';
import { PushNotificationService } from './src/server/notifications/PushNotificationService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function createServer() {
  const app = express();

  app.use(express.json());

  // CORS Middleware for Production Connection Resilience
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }
    next();
  });

  // Request logger middleware
  app.use((req, _res, next) => {
    if (req.path.startsWith('/api')) {
      logger.info(`${req.method} ${req.path}`);
    }
    next();
  });

  // Backend API Routes
  app.use('/api', healthRouter);
  app.use('/api', configStatusRouter);
  app.use('/api', marketRouter);
  app.use('/api', signalsRouter);
  app.use('/api', notificationsRouter);

  // Global Express Error Handler
  app.use(globalErrorHandler);

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

// Start listener only when run directly (not as a serverless function)
if (process.env.VERCEL !== '1' && !process.env.VERCEL_ENV) {
  const PORT = 3000;
  const HOST = '0.0.0.0';
  createServer().then((app) => {
    app.listen(PORT, HOST, () => {
      logger.info(`Trading Signal System server running on http://${HOST}:${PORT}`);
      
      // Perform startup repair of any active signals with duplicate or invalid TPs
      RepairService.repairActiveSignals().catch((err) => {
        logger.error('[StartupRepair] Failed to run active signals repair:', { error: String(err) });
      });

      // Perform initial historical outcome backfill across all existing active signals
      SignalLifecycleManager.backfillHistoricalOutcomesForActiveSignals().then((backfillRes) => {
        logger.info('[StartupBackfill] Initial active signals outcome backfill completed:', { ...backfillRes });
      }).catch((err) => {
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
  }).catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}
