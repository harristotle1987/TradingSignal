/**
 * Input Validation Schemas
 *
 * Defines runtime validation schemas and validator functions for market data,
 * push notification subscriptions, signal requests, and admin endpoints.
 */

export interface ValidationResult<T = any> {
  success: boolean;
  data?: T;
  errors?: string[];
}

export type SchemaValidator<T = any> = (input: unknown) => ValidationResult<T>;

/**
 * Symbol validation schema: 2-20 chars, alphanumeric + dots/hyphens/underscores
 */
export const symbolSchema: SchemaValidator<string> = (input: unknown) => {
  if (typeof input !== 'string' || input.trim().length === 0) {
    return { success: false, errors: ['Symbol must be a non-empty string'] };
  }
  const clean = input.trim().toUpperCase();
  if (!/^[A-Z0-9._\-]{2,20}$/.test(clean)) {
    return {
      success: false,
      errors: ['Symbol must be 2-20 characters alphanumeric (e.g. BTCUSDT, EURUSD, AAPL)'],
    };
  }
  return { success: true, data: clean };
};

/**
 * Market ticker parameter validation
 */
export const tickerParamsSchema: SchemaValidator<{ symbol: string }> = (input: unknown) => {
  if (!input || typeof input !== 'object') {
    return { success: false, errors: ['Parameters object required'] };
  }
  const obj = input as Record<string, unknown>;
  const res = symbolSchema(obj.symbol);
  if (!res.success) return { success: false, errors: res.errors };
  return { success: true, data: { symbol: res.data! } };
};

/**
 * Market candles query validation
 */
export const candlesQuerySchema: SchemaValidator<{
  symbol: string;
  timeframe?: string;
  limit?: number;
}> = (input: unknown) => {
  if (!input || typeof input !== 'object') {
    return { success: false, errors: ['Query parameters object required'] };
  }
  const obj = input as Record<string, unknown>;
  const symbolRes = symbolSchema(obj.symbol);
  if (!symbolRes.success) return { success: false, errors: symbolRes.errors };

  const validTimeframes = ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w'];
  let tf = '1h';
  if (typeof obj.timeframe === 'string' && obj.timeframe.trim().length > 0) {
    const cleanTf = obj.timeframe.trim().toLowerCase();
    if (!validTimeframes.includes(cleanTf)) {
      return {
        success: false,
        errors: [`Invalid timeframe "${cleanTf}". Allowed: ${validTimeframes.join(', ')}`],
      };
    }
    tf = cleanTf;
  }

  let lim = 100;
  if (obj.limit !== undefined) {
    const num = Number(obj.limit);
    if (isNaN(num) || num < 1 || num > 1000) {
      return { success: false, errors: ['Limit must be an integer between 1 and 1000'] };
    }
    lim = Math.floor(num);
  }

  return {
    success: true,
    data: {
      symbol: symbolRes.data!,
      timeframe: tf,
      limit: lim,
    },
  };
};

/**
 * Push Notification Subscription Schema
 */
export interface PushSubscriptionPayload {
  subscription: {
    endpoint: string;
    keys: {
      p256dh: string;
      auth: string;
    };
    expirationTime?: number | null;
  };
  clientMeta?: {
    userAgent?: string;
    subscribedAt?: number;
  };
}

export const pushSubscriptionSchema: SchemaValidator<PushSubscriptionPayload> = (input: unknown) => {
  if (!input || typeof input !== 'object') {
    return { success: false, errors: ['Request body must be an object'] };
  }
  const obj = input as Record<string, any>;
  const sub = obj.subscription;
  if (!sub || typeof sub !== 'object') {
    return { success: false, errors: ['Missing "subscription" object in request body'] };
  }
  if (typeof sub.endpoint !== 'string' || !sub.endpoint.startsWith('https://')) {
    return { success: false, errors: ['"subscription.endpoint" must be a valid secure URL starting with https://'] };
  }
  if (!sub.keys || typeof sub.keys !== 'object') {
    return { success: false, errors: ['Missing "subscription.keys" object'] };
  }
  if (typeof sub.keys.p256dh !== 'string' || sub.keys.p256dh.trim().length === 0) {
    return { success: false, errors: ['"subscription.keys.p256dh" must be a non-empty string'] };
  }
  if (typeof sub.keys.auth !== 'string' || sub.keys.auth.trim().length === 0) {
    return { success: false, errors: ['"subscription.keys.auth" must be a non-empty string'] };
  }

  return {
    success: true,
    data: {
      subscription: {
        endpoint: sub.endpoint,
        keys: {
          p256dh: sub.keys.p256dh,
          auth: sub.keys.auth,
        },
        expirationTime: sub.expirationTime || null,
      },
      clientMeta: obj.clientMeta,
    },
  };
};

/**
 * Admin Login / Token verification schema
 */
export const authCredentialsSchema: SchemaValidator<{ token?: string; password?: string; email?: string }> = (
  input: unknown
) => {
  if (!input || typeof input !== 'object') {
    return { success: false, errors: ['Request body must be an object'] };
  }
  const obj = input as Record<string, any>;
  return {
    success: true,
    data: {
      token: typeof obj.token === 'string' ? obj.token.trim() : undefined,
      password: typeof obj.password === 'string' ? obj.password.trim() : undefined,
      email: typeof obj.email === 'string' ? obj.email.trim().toLowerCase() : undefined,
    },
  };
};
