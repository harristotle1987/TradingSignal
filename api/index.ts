import { createServer } from '../server.js';
import { logger } from '../src/server/logger.js';

let cachedApp: any = null;

export default async function handler(req: any, res: any) {
  // 1. Ensure production environment and Vercel flag are set before creating app
  if (!process.env.NODE_ENV) {
    process.env.NODE_ENV = 'production';
  }
  process.env.VERCEL = '1';

  // 2. Wrap application initialization in try/catch
  if (!cachedApp) {
    try {
      cachedApp = await createServer();
    } catch (initError: unknown) {
      const errMsg = initError instanceof Error ? initError.message : String(initError);
      logger.error('[Vercel Entrypoint] Application initialization failed:', {
        error: errMsg,
      });

      if (!res.headersSent) {
        res.status(503).json({
          success: false,
          error: 'FUNCTION_INITIALIZATION_FAILED',
          message: 'The backend is temporarily unavailable.',
        });
      }
      return;
    }
  }

  // 3. Wrap request dispatch in try/catch
  try {
    return await cachedApp(req, res);
  } catch (invocationError: unknown) {
    const errMsg = invocationError instanceof Error ? invocationError.message : String(invocationError);
    logger.error('[Vercel Entrypoint] Request invocation failed:', {
      error: errMsg,
      url: req?.url,
      method: req?.method,
    });

    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: 'FUNCTION_INVOCATION_FAILED',
        message: 'An unexpected server error occurred.',
      });
    }
  }
}
