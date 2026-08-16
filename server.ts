/**
 * Express + Vite Server Entrypoint
 * Binds to 0.0.0.0:3000 as required by AI Studio container runtime.
 */

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';

// Load environment variables
dotenv.config();

import { logger } from './src/server/logger.js';
import { globalErrorHandler } from './src/server/middleware/errorHandler.js';
import healthRouter from './src/server/routes/health.js';
import configStatusRouter from './src/server/routes/configStatus.js';
import marketRouter from './src/server/routes/market.js';
import signalsRouter from './src/server/routes/signals.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;
  const HOST = '0.0.0.0';

  app.use(express.json());

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

  // Global Express Error Handler
  app.use(globalErrorHandler);

  // Vite Middleware in Dev or Static Serve in Prod
  if (process.env.NODE_ENV !== 'production') {
    logger.info('Starting Vite in development middleware mode...');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    logger.info('Serving static build artifacts from dist directory...');
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, HOST, () => {
    logger.info(`Trading Signal System server running on http://${HOST}:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
