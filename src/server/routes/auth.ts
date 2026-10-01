/**
 * Authoritative Neon Authentication Routes
 *
 * Exposes:
 * - POST /api/auth/register  (Atomic first-admin promotion & user registration)
 * - POST /api/auth/session   (Credential verification & HttpOnly session creation)
 * - GET  /api/auth/me        (Server-side session validation & role resolution)
 * - POST /api/auth/logout     (Session revocation & cookie destruction)
 */

import { Router, Request, Response } from 'express';
import { NeonAuthService, SESSION_COOKIE_NAME } from '../auth/NeonAuthService.js';
import { extractSessionToken } from '../middleware/adminAuth.js';
import { logger } from '../logger.js';
import { SEC_AUTH } from '../security/SecurityService.js';

const router = Router();

/**
 * POST /api/auth/register
 * Registers a new user. The very first user atomically becomes the ONLY ADMIN.
 */
router.post('/auth/register', async (req: Request, res: Response) => {
  try {
    const { email, password, displayName } = req.body || {};

    const clientIp = typeof req.headers['x-forwarded-for'] === 'string'
      ? req.headers['x-forwarded-for'].split(',')[0].trim()
      : req.socket.remoteAddress || '127.0.0.1';
    const userAgent = req.headers['user-agent'] || undefined;

    const result = await NeonAuthService.register({
      email,
      password,
      displayName,
      clientIp,
      userAgent,
    });

    if (!result.success || !result.user || !result.session) {
      return res.status(400).json({
        success: false,
        error: result.error || 'Registration failed.',
        securityId: SEC_AUTH,
        timestamp: Date.now(),
      });
    }

    // Set secure HttpOnly session cookie
    NeonAuthService.setSessionCookie(res, result.session.token);

    return res.status(201).json({
      success: true,
      authenticated: true,
      admin: result.user.admin,
      role: result.user.role,
      user: {
        id: result.user.id,
        uid: result.user.id,
        email: result.user.email,
        role: result.user.role,
        admin: result.user.admin,
        displayName: result.user.displayName,
        createdAt: result.user.createdAt,
      },
      session: {
        id: result.session.id,
        token: result.session.token,
        expiresAt: result.session.expiresAt,
      },
      isFirstAdmin: result.isFirstAdmin,
      message: result.isFirstAdmin
        ? 'Initial administrative account established successfully.'
        : 'User account registered successfully.',
    });
  } catch (err: any) {
    logger.error('[API /auth/register] Fatal registration error:', { error: String(err) });
    return res.status(503).json({
      success: false,
      error: 'Authentication database unavailable (Fail Closed).',
      securityId: SEC_AUTH,
      timestamp: Date.now(),
    });
  }
});

/**
 * POST /api/auth/session
 * Authenticates user credentials and issues an HttpOnly session cookie.
 */
router.post('/auth/session', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body || {};

    const clientIp = typeof req.headers['x-forwarded-for'] === 'string'
      ? req.headers['x-forwarded-for'].split(',')[0].trim()
      : req.socket.remoteAddress || '127.0.0.1';
    const userAgent = req.headers['user-agent'] || undefined;

    const result = await NeonAuthService.authenticate({
      email,
      password,
      clientIp,
      userAgent,
    });

    if (!result.success || !result.user || !result.session) {
      return res.status(401).json({
        success: false,
        error: result.error || 'Invalid email or password.',
        securityId: SEC_AUTH,
        timestamp: Date.now(),
      });
    }

    // Set secure HttpOnly session cookie
    NeonAuthService.setSessionCookie(res, result.session.token);

    return res.status(200).json({
      success: true,
      authenticated: true,
      admin: result.user.admin,
      role: result.user.role,
      user: {
        id: result.user.id,
        uid: result.user.id,
        email: result.user.email,
        role: result.user.role,
        admin: result.user.admin,
        displayName: result.user.displayName,
        createdAt: result.user.createdAt,
        lastLoginAt: result.user.lastLoginAt,
      },
      session: {
        id: result.session.id,
        token: result.session.token,
        expiresAt: result.session.expiresAt,
      },
      message: 'Authenticated successfully.',
    });
  } catch (err: any) {
    logger.error('[API /auth/session] Fatal login error:', { error: String(err) });
    return res.status(503).json({
      success: false,
      error: 'Authentication database unavailable (Fail Closed).',
      securityId: SEC_AUTH,
      timestamp: Date.now(),
    });
  }
});

/**
 * GET /api/auth/me
 * Retrieves the currently authenticated user from HttpOnly session cookie or Bearer token.
 */
router.get('/auth/me', async (req: Request, res: Response) => {
  try {
    const token = extractSessionToken(req);

    if (!token) {
      return res.status(401).json({
        success: false,
        authenticated: false,
        admin: false,
        role: 'USER',
        error: 'No active session found.',
      });
    }

    const validation = await NeonAuthService.validateSession(token);
    if (!validation.valid || !validation.user || !validation.session) {
      return res.status(401).json({
        success: false,
        authenticated: false,
        admin: false,
        role: 'USER',
        error: validation.error || 'Session is invalid or expired.',
      });
    }

    return res.status(200).json({
      success: true,
      authenticated: true,
      admin: validation.user.admin,
      role: validation.user.role,
      user: {
        id: validation.user.id,
        uid: validation.user.id,
        email: validation.user.email,
        role: validation.user.role,
        admin: validation.user.admin,
        displayName: validation.user.displayName,
        createdAt: validation.user.createdAt,
        lastLoginAt: validation.user.lastLoginAt,
      },
      session: {
        id: validation.session.id,
        expiresAt: validation.session.expiresAt,
      },
    });
  } catch (err: any) {
    logger.error('[API /auth/me] Session verification failure:', { error: String(err) });
    return res.status(503).json({
      success: false,
      authenticated: false,
      admin: false,
      role: 'USER',
      error: 'Authentication database unavailable (Fail Closed).',
    });
  }
});

/**
 * POST /api/auth/logout
 * Revokes session and clears HttpOnly session cookie.
 */
router.post('/auth/logout', async (req: Request, res: Response) => {
  try {
    const token = extractSessionToken(req);
    if (token) {
      await NeonAuthService.revokeSession(token);
    }
    NeonAuthService.clearSessionCookie(res);

    return res.status(200).json({
      success: true,
      message: 'Logged out successfully.',
    });
  } catch (err: any) {
    logger.error('[API /auth/logout] Error during logout:', { error: String(err) });
    NeonAuthService.clearSessionCookie(res);
    return res.status(200).json({
      success: true,
      message: 'Session cleared.',
    });
  }
});

export default router;
