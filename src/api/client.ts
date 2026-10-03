/**
 * Frontend API Client
 * Clean HTTP client for backend system endpoints.
 */

import {
  HealthResponse,
  ConfigStatusResponse,
  MarketStatusResponse,
  NormalizedTicker,
  SignalGenerationResponse,
  SignalsListResponse,
  PerformanceMetricsResponse,
  HistoricalPerformanceResponse,
  HistoricalPerformanceRange,
  SensitivityProfileName,
  SensitivityProfileConfig,
} from '../types/index.js';

export interface HistoricalTradesQueryOptions {
  page?: number;
  limit?: number;
  status?: string;
  symbol?: string;
  direction?: string;
  range?: string;
  search?: string;
}

export interface HistoricalTradesResponse {
  success: boolean;
  trades: any[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface AuthUser {
  uid: string;
  id?: string;
  email: string;
  admin: boolean;
  role: 'ADMIN' | 'USER';
  displayName?: string;
  createdAt?: number;
  lastLoginAt?: number;
}

export class ApiClient {
  private unauthorizedListeners = new Set<() => void>();
  private authChangeListeners = new Set<(user: AuthUser | null) => void>();

  constructor() {
    // Listen for storage events across tabs to synchronize auth state
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', (e) => {
        if (e.key === 'neon_auth_user' || e.key === 'neon_session_token') {
          const user = this.getStoredUser();
          this.notifyAuthChange(user);
        }
      });
      window.addEventListener('auth:change', (e: any) => {
        const user = e.detail ?? this.getStoredUser();
        for (const listener of this.authChangeListeners) {
          try {
            listener(user);
          } catch (err) {
            console.error('[ApiClient] Error in authChange listener:', err);
          }
        }
      });
    }
  }

  /**
   * Subscribe to auth state changes (login, logout, session expiration)
   */
  public onAuthChange(callback: (user: AuthUser | null) => void): () => void {
    this.authChangeListeners.add(callback);
    return () => this.authChangeListeners.delete(callback);
  }

  private notifyAuthChange(user: AuthUser | null): void {
    for (const listener of this.authChangeListeners) {
      try {
        listener(user);
      } catch (e) {
        console.error('[ApiClient] Error in auth change listener:', e);
      }
    }
  }

  /**
   * Subscribe to 401 Unauthorized events
   */
  public onUnauthorized(callback: () => void): () => void {
    this.unauthorizedListeners.add(callback);
    return () => this.unauthorizedListeners.delete(callback);
  }

  /**
   * Read stored token from sessionStorage or localStorage
   */
  public getStoredToken(): string | null {
    if (typeof sessionStorage !== 'undefined') {
      const token = sessionStorage.getItem('neon_session_token');
      if (token && token.trim().length > 0) return token.trim();
    }
    if (typeof localStorage !== 'undefined') {
      const token = localStorage.getItem('neon_session_token');
      if (token && token.trim().length > 0) {
        // Sync to sessionStorage for current tab session
        if (typeof sessionStorage !== 'undefined') {
          try {
            sessionStorage.setItem('neon_session_token', token.trim());
          } catch {
            // Ignore
          }
        }
        return token.trim();
      }
    }
    return null;
  }

  /**
   * Save auth token to sessionStorage and localStorage for persistence across reloads
   */
  public setStoredToken(token: string | null): void {
    const cleanToken = token?.trim() || null;
    if (cleanToken) {
      if (typeof sessionStorage !== 'undefined') {
        try { sessionStorage.setItem('neon_session_token', cleanToken); } catch {}
      }
      if (typeof localStorage !== 'undefined') {
        try { localStorage.setItem('neon_session_token', cleanToken); } catch {}
      }
    } else {
      if (typeof sessionStorage !== 'undefined') {
        try { sessionStorage.removeItem('neon_session_token'); } catch {}
      }
      if (typeof localStorage !== 'undefined') {
        try { localStorage.removeItem('neon_session_token'); } catch {}
      }
    }
  }

  /**
   * Read stored user profile from sessionStorage or localStorage
   */
  public getStoredUser(): AuthUser | null {
    try {
      const raw = (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('neon_auth_user')) ||
                  (typeof localStorage !== 'undefined' && localStorage.getItem('neon_auth_user'));
      if (raw) {
        const parsed = JSON.parse(raw) as AuthUser;
        if (parsed && typeof parsed === 'object') {
          // Normalize admin boolean to ensure consistency
          const role = String(parsed.role || 'USER').toUpperCase() as 'ADMIN' | 'USER';
          const isAdmin = Boolean(parsed.admin || role === 'ADMIN');
          return {
            ...parsed,
            role: isAdmin ? 'ADMIN' : 'USER',
            admin: isAdmin,
          };
        }
      }
    } catch {
      // ignore JSON parse error
    }
    return null;
  }

  /**
   * Save user profile to sessionStorage and localStorage, then notify subscribers
   */
  public setStoredUser(user: AuthUser | null): void {
    try {
      if (user) {
        const role = String(user.role || 'USER').toUpperCase() as 'ADMIN' | 'USER';
        const isAdmin = Boolean(user.admin || role === 'ADMIN');
        const normalizedUser: AuthUser = {
          ...user,
          role: isAdmin ? 'ADMIN' : 'USER',
          admin: isAdmin,
        };
        const json = JSON.stringify(normalizedUser);
        if (typeof sessionStorage !== 'undefined') {
          try { sessionStorage.setItem('neon_auth_user', json); } catch {}
        }
        if (typeof localStorage !== 'undefined') {
          try { localStorage.setItem('neon_auth_user', json); } catch {}
        }
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('auth:change', { detail: normalizedUser }));
        }
        this.notifyAuthChange(normalizedUser);
      } else {
        if (typeof sessionStorage !== 'undefined') {
          try { sessionStorage.removeItem('neon_auth_user'); } catch {}
        }
        if (typeof localStorage !== 'undefined') {
          try { localStorage.removeItem('neon_auth_user'); } catch {}
        }
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('auth:change', { detail: null }));
        }
        this.notifyAuthChange(null);
      }
    } catch {
      // ignore
    }
  }

  /**
   * Clears local authentication state and notifies listeners
   */
  public clearLocalAuthState(): void {
    this.setStoredToken(null);
    this.setStoredUser(null);
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.removeItem('admin_api_token');
        localStorage.removeItem('admin_token');
        localStorage.removeItem('admin_api_key');
      } catch {}
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('auth:unauthorized'));
      window.dispatchEvent(new CustomEvent('auth:change', { detail: null }));
    }
    for (const listener of this.unauthorizedListeners) {
      try {
        listener();
      } catch (e) {
        console.error('[ApiClient] Error in unauthorized listener:', e);
      }
    }
    this.notifyAuthChange(null);
  }

  /**
   * Deprecated token setting kept for interface compatibility (does not write to localStorage)
   */
  public setAdminToken(_token: string | null): void {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('admin_api_token');
      localStorage.removeItem('admin_token');
      localStorage.removeItem('admin_api_key');
    }
  }

  /**
   * Deprecated token getter kept for interface compatibility
   */
  public getAdminToken(): string | null {
    return this.getStoredToken();
  }

  /**
   * Registers a user account enforcing First-User Admin logic.
   */
  public async register(params: { idToken?: string; email?: string; password?: string; displayName?: string }): Promise<{
    success: boolean;
    authenticated?: boolean;
    user?: AuthUser;
    session?: { id: string; token: string; expiresAt: number };
    isFirstAdmin?: boolean;
    error?: string;
  }> {
    const res = await this.fetchJson<{
      success: boolean;
      authenticated?: boolean;
      user?: AuthUser;
      session?: { id: string; token: string; expiresAt: number };
      isFirstAdmin?: boolean;
      error?: string;
    }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(params),
    });

    if (res?.session?.token) {
      this.setStoredToken(res.session.token);
    }
    if (res?.user) {
      this.setStoredUser(res.user);
    }
    return res;
  }

  /**
   * Authenticates session via email and password credentials against Neon Auth.
   * Sets HttpOnly secure cookie on successful login.
   */
  public async createAuthSession(params: { email?: string; password?: string }): Promise<{
    success: boolean;
    authenticated?: boolean;
    user?: AuthUser;
    session?: { id: string; token: string; expiresAt: number };
    isFirstAdmin?: boolean;
    error?: string;
  }> {
    const res = await this.fetchJson<{
      success: boolean;
      authenticated?: boolean;
      user?: AuthUser;
      session?: { id: string; token: string; expiresAt: number };
      isFirstAdmin?: boolean;
      error?: string;
    }>('/api/auth/session', {
      method: 'POST',
      body: JSON.stringify(params),
    });

    if (res?.session?.token) {
      this.setStoredToken(res.session.token);
    }
    if (res?.user) {
      this.setStoredUser(res.user);
    }
    return res;
  }

  /**
   * Retrieves current authenticated user state based on HttpOnly session cookie or persistent token.
   */
  public async getAuthMe(): Promise<{
    success: boolean;
    authenticated: boolean;
    admin: boolean;
    role: 'ADMIN' | 'USER';
    user?: AuthUser;
    error?: string;
  }> {
    try {
      const res = await this.fetchJson<{
        success: boolean;
        authenticated: boolean;
        admin: boolean;
        role: 'ADMIN' | 'USER';
        user?: AuthUser;
        error?: string;
      }>('/api/auth/me');

      if (res.authenticated && res.user) {
        this.setStoredUser(res.user);
      } else {
        this.clearLocalAuthState();
      }
      return res;
    } catch (err: any) {
      if (err?.status === 401) {
        this.clearLocalAuthState();
      }
      throw err;
    }
  }

  /**
   * Clears the authenticated session cookie and stored token.
   */
  public async logout(): Promise<{ success: boolean; message?: string }> {
    this.clearLocalAuthState();
    return this.fetchJson<{ success: boolean; message?: string }>('/api/auth/logout', {
      method: 'POST',
    });
  }

  private async fetchJson<T>(endpoint: string, options?: RequestInit, retries = 3): Promise<T> {
    try {
      const isNativeCapacitor = typeof window !== 'undefined' && Boolean((window as any).Capacitor?.isNativePlatform?.());
      const envApiUrl = (import.meta as any).env?.VITE_API_URL;
      const windowOrigin = typeof window !== 'undefined' ? window.location.origin : '';
      const defaultProductionUrl = 'https://trading-signal-chi.vercel.app';

      const baseUrl = envApiUrl || (isNativeCapacitor ? defaultProductionUrl : windowOrigin);
      const cleanBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
      const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
      const fullUrl = endpoint.startsWith('http') ? endpoint : `${cleanBaseUrl}${cleanEndpoint}`;

      // Extract CSRF token from cookie for mutating browser requests (Gate 3 & Gate 18)
      let csrfHeader: Record<string, string> = {};
      if (typeof document !== 'undefined' && document.cookie) {
        const match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
        if (match && match[1]) {
          const method = (options?.method || 'GET').toUpperCase();
          if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
            csrfHeader['x-csrf-token'] = decodeURIComponent(match[1]);
          }
        }
      }

      // Attach saved session token for reliable cross-origin / iframe authentication
      let authHeader: Record<string, string> = {};
      const savedToken = this.getStoredToken();
      if (savedToken && savedToken.trim().length > 0) {
        authHeader['Authorization'] = `Bearer ${savedToken.trim()}`;
        authHeader['x-admin-key'] = savedToken.trim();
        authHeader['x-session-token'] = savedToken.trim();
      }

      const response = await fetch(fullUrl, {
        credentials: 'include',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
          'x-client-app': 'trading-signal-ui',
          ...authHeader,
          ...csrfHeader,
          ...(options?.headers || {}),
        },
        ...options,
      });

      const contentType = response.headers.get('content-type') || '';
      const text = await response.text();

      let data: any;
      if (contentType.includes('application/json') || text.trim().startsWith('{') || text.trim().startsWith('[')) {
        try {
          data = JSON.parse(text);
        } catch {
          throw new Error(`Invalid JSON response from ${endpoint}: ${text.slice(0, 100)}`);
        }
      } else {
        throw new Error(`Server returned non-JSON response (${response.status} ${response.statusText})`);
      }

      if (!response.ok && response.status !== 503) {
        if (response.status === 401) {
          // Automatically clear local auth state on 401 Unauthorized
          this.clearLocalAuthState();
        }
        const err = new Error(`HTTP ${response.status} (${response.statusText}): ${JSON.stringify(data)}`);
        (err as any).status = response.status;
        throw err;
      }

      return data as T;
    } catch (error: any) {
      const status = error?.status;
      const isNonRetriable = status === 401 || status === 403 || (status >= 400 && status < 500);
      if (isNonRetriable) {
        throw error;
      }
      if (retries > 0) {
        const delay = (4 - retries) * 400;
        await new Promise((res) => setTimeout(res, delay));
        return this.fetchJson<T>(endpoint, options, retries - 1);
      }
      console.warn(`[ApiClient] Network request to ${endpoint} failed after retries:`, error instanceof Error ? error.message : error);
      throw error;
    }
  }

  /**
   * Fetch backend health check
   */
  async getHealth(): Promise<HealthResponse> {
    return this.fetchJson<HealthResponse>('/api/health');
  }

  /**
   * Fetch backend environment configuration readiness status
   */
  async getConfigStatus(): Promise<ConfigStatusResponse> {
    return this.fetchJson<ConfigStatusResponse>('/api/config/status');
  }

  /**
   * Fetch real market provider health check status
   */
  async getMarketStatus(): Promise<MarketStatusResponse> {
    return this.fetchJson<MarketStatusResponse>('/api/market/status');
  }

  /**
   * Fetch market session details for a symbol
   */
  async getSessionDetails(symbol: string): Promise<any> {
    return this.fetchJson<any>(`/api/market/session?symbol=${encodeURIComponent(symbol)}`);
  }

  /**
   * Fetch price for a symbol from MarketDataManager
   */
  async fetchMarketPrice(symbol: string, provider?: string, reason: string = 'USER_CLICK'): Promise<NormalizedTicker> {
    const query = new URLSearchParams({ symbol });
    if (provider) {
      query.append('provider', provider);
    }
    if (reason) {
      query.append('reason', reason);
    }
    return this.fetchJson<NormalizedTicker>(`/api/market/price?${query.toString()}`);
  }

  /**
   * Explicit user-triggered Forex price fetch
   */
  async fetchForexMarketPrice(symbol: string = 'EURUSD'): Promise<NormalizedTicker> {
    return this.fetchMarketPrice(symbol, undefined, 'USER_CLICK');
  }

  /**
   * Get active signals
   */
  async getSignals(): Promise<SignalsListResponse> {
    return this.fetchJson<SignalsListResponse>('/api/signals');
  }

  /**
   * Generate signal for symbol or asset category
   */
  async generateSignal(symbol = 'EURUSD', category?: string): Promise<SignalGenerationResponse> {
    return this.fetchJson<SignalGenerationResponse>('/api/signals/generate', {
      method: 'POST',
      body: JSON.stringify({ symbol, category }),
    });
  }

  /**
   * Specific trade search & qualification pipeline (Gate 14)
   * Requires admin session authorization
   */
  async searchSpecificTrade(symbol: string): Promise<SignalGenerationResponse> {
    return this.fetchJson<SignalGenerationResponse>('/api/signals/trade-search', {
      method: 'POST',
      body: JSON.stringify({ symbol }),
    });
  }

  /**
   * Delete an active signal by ID
   */
  async deleteSignal(id: string): Promise<{ success: boolean; message: string }> {
    return this.fetchJson<{ success: boolean; message: string }>(`/api/signals/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  /**
   * Clear active signals
   */
  async clearSignals(): Promise<{ success: boolean; message: string }> {
    return this.fetchJson<{ success: boolean; message: string }>('/api/signals', {
      method: 'DELETE',
    });
  }

  /**
   * Delete/clear ALL signals across active cache, persistent sent signals, signal logs, and outcome logs
   */
  async deleteAllSignals(): Promise<{ success: boolean; message: string }> {
    return this.fetchJson<{ success: boolean; message: string }>('/api/signals/all', {
      method: 'DELETE',
    });
  }

  /**
   * Alias for deleteAllSignals
   */
  async clearAllSignals(): Promise<{ success: boolean; message: string }> {
    return this.deleteAllSignals();
  }

  /**
   * Fetch automated hourly scanner settings, market scan state, and cron-job.org status
   */
  async getScannerSettings(): Promise<{ success: boolean; settings: any; cronJobOrg?: any }> {
    return this.fetchJson<{ success: boolean; settings: any; cronJobOrg?: any }>('/api/scanner/settings');
  }

  /**
   * Dedicated method to fetch cron-job.org execution details & history
   */
  async getCronStatus(refresh = false): Promise<{ success: boolean; cronJobOrg: any }> {
    return this.fetchJson<{ success: boolean; cronJobOrg: any }>(`/api/cron/status${refresh ? '?refresh=true' : ''}`);
  }

  /**
   * Update automated hourly scanner settings
   */
  async updateScannerSettings(
    enabled: boolean,
    notificationsEnabled: boolean,
    notifyOnNoTrade?: boolean,
    intervalMinutes?: number
  ): Promise<{ success: boolean; settings: any }> {
    return this.fetchJson<{ success: boolean; settings: any }>('/api/scanner/settings', {
      method: 'POST',
      body: JSON.stringify({ enabled, notificationsEnabled, notifyOnNoTrade, intervalMinutes }),
    });
  }

  /**
   * Resets only the current day's automated signal cap counter to 0.
   */
  async resetDailyCap(): Promise<{ success: boolean; message: string; settings: any; capState?: any }> {
    return this.fetchJson<{ success: boolean; message: string; settings: any; capState?: any }>('/api/scanner/reset-cap', {
      method: 'POST',
    });
  }

  /**
   * Manually trigger a complete background scan or specific symbol scan
   */
  async triggerScannerManualScan(params?: { symbol?: string; category?: string }): Promise<{
    success: boolean;
    status: string;
    message: string;
    timestamp: number;
    lastScanTime: number;
    universeSymbolsScanned?: number;
    preliminaryCandidatesFound?: number;
    candidatesRejectedPreliminary?: number;
    candidatesEvaluated: number;
    candidatesRejectedFinal?: number;
    signalsGenerated?: number;
    signalsAccepted?: number;
    acceptedSignalsCount: number;
    acceptedSignals: any[];
    signalsFound: number;
    qualifiedSetups: any[];
    rejectedCount: number;
    rejectionReasons: string[];
    diagnosticsCount?: number;
    diagnostics?: string[];
    capState: any;
    scanDurationMs?: number;
  }> {
    return this.fetchJson<any>('/api/scanner/manual-trigger', {
      method: 'POST',
      body: params ? JSON.stringify(params) : undefined,
    });
  }

  /**
   * Fetch full scanner history, sent signals today, and rejected audit logs
   */
  async getScannerHistory(): Promise<any> {
    return this.fetchJson<any>('/api/scanner/history');
  }

  /**
   * Fetch dedicated signal logs from the backend
   */
  async getSignalLogs(): Promise<{ success: boolean; logs: any[]; count: number }> {
    return this.fetchJson<{ success: boolean; logs: any[]; count: number }>('/api/signals/log');
  }

  /**
   * Delete an individual dedicated signal log entry by ID
   */
  async deleteSignalLog(id: string): Promise<{ success: boolean; message: string }> {
    return this.fetchJson<{ success: boolean; message: string }>(`/api/signals/log/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  /**
   * Bulk delete dedicated signal log entries by IDs
   */
  async deleteSignalLogs(ids: string[]): Promise<{ success: boolean; message: string }> {
    return this.fetchJson<{ success: boolean; message: string }>('/api/signals/log/bulk-delete', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    });
  }

  /**
   * Clear dedicated signal logs
   */
  async clearSignalLogs(): Promise<{ success: boolean; message: string }> {
    return this.fetchJson<{ success: boolean; message: string }>('/api/signals/log', {
      method: 'DELETE',
    });
  }

  /**
   * Get VAPID Public Key for Web Push subscription
   */
  async getVapidPublicKey(): Promise<{ success: boolean; publicKey: string }> {
    return this.fetchJson<{ success: boolean; publicKey: string }>('/api/notifications/vapid-public-key');
  }

  /**
   * Subscribe to Web Push Notifications
   */
  async subscribePush(subscription: any): Promise<{ success: boolean; message: string; id?: string }> {
    return this.fetchJson<{ success: boolean; message: string; id?: string }>('/api/notifications/subscribe', {
      method: 'POST',
      body: JSON.stringify({ subscription }),
    });
  }

  /**
   * Unsubscribe from Web Push Notifications
   */
  async unsubscribePush(endpoint: string): Promise<{ success: boolean; message: string }> {
    return this.fetchJson<{ success: boolean; message: string }>('/api/notifications/unsubscribe', {
      method: 'POST',
      body: JSON.stringify({ endpoint }),
    });
  }

  /**
   * Send test push notification
   */
  async sendTestPushNotification(subscription?: any): Promise<{ success: boolean; message: string }> {
    return this.fetchJson<{ success: boolean; message: string }>('/api/notifications/test', {
      method: 'POST',
      body: JSON.stringify({ subscription }),
    });
  }

  /**
   * Get push notification subscription status
   */
  async getPushStatus(): Promise<{ success: boolean; subscriberCount: number; vapidConfigured: boolean }> {
    return this.fetchJson<{ success: boolean; subscriberCount: number; vapidConfigured: boolean }>('/api/notifications/status');
  }

  /**
   * Fetch historical trade performance and analytics metrics
   */
  async getPerformanceMetrics(): Promise<PerformanceMetricsResponse> {
    return this.fetchJson<PerformanceMetricsResponse>('/api/signals/performance');
  }

  /**
   * Fetch authoritative historical trades with server-side pagination and filtering (Gate 16)
   */
  async getHistoricalTrades(
    options: HistoricalTradesQueryOptions = {}
  ): Promise<HistoricalTradesResponse> {
    const query = new URLSearchParams();
    if (options.page) query.append('page', String(options.page));
    if (options.limit) query.append('limit', String(options.limit));
    if (options.status) query.append('status', options.status);
    if (options.symbol) query.append('symbol', options.symbol);
    if (options.direction) query.append('direction', options.direction);
    if (options.range) query.append('range', options.range);
    if (options.search) query.append('search', options.search);

    const queryString = query.toString();
    return this.fetchJson<HistoricalTradesResponse>(
      `/api/signals/historical${queryString ? `?${queryString}` : ''}`
    );
  }

  /**
   * Fetch authoritative historical signal performance summary and trend
   */
  async getHistoricalPerformance(
    range: HistoricalPerformanceRange = '30D'
  ): Promise<HistoricalPerformanceResponse> {
    return this.fetchJson<HistoricalPerformanceResponse>(
      `/api/signals/historical-performance?range=${encodeURIComponent(range)}`
    );
  }

  /**
   * Manually check and refresh an individual signal's targets & status
   */
  async refreshSignal(idOrSignal: string | any): Promise<{
    success: boolean;
    changed: boolean;
    message: string;
    currentPrice: number;
    signal: any;
    lastChecked: string;
    timestamp: number;
  }> {
    const payload = typeof idOrSignal === 'string' 
      ? { id: idOrSignal } 
      : { 
          id: idOrSignal.id,
          symbol: idOrSignal.symbol,
          direction: idOrSignal.direction,
          entryPrice: idOrSignal.entryPrice,
          stopLoss: idOrSignal.stopLoss,
          takeProfit: idOrSignal.takeProfit,
          tp1: idOrSignal.tp1,
          tp2: idOrSignal.tp2,
          tp3: idOrSignal.tp3,
          status: idOrSignal.status || idOrSignal.signalStatus,
          tp1Status: idOrSignal.tp1Status,
          tp2Status: idOrSignal.tp2Status,
          tp3Status: idOrSignal.tp3Status,
          slStatus: idOrSignal.slStatus,
          timestamp: idOrSignal.timestamp,
          rankTier: idOrSignal.rankTier || idOrSignal.outcomeType,
          strategy: idOrSignal.strategy,
          timeframe: idOrSignal.timeframe,
          dataSource: idOrSignal.dataSource,
        };

    return this.fetchJson<any>('/api/signals/refresh', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  /**
   * Fetch active Gate 27 regime-adaptive threshold policy and recent evaluation logs
   */
  async getRegimeThresholds(): Promise<{
    success: boolean;
    policy: any;
    recentEvaluations: any[];
    timestamp: number;
  }> {
    return this.fetchJson<any>('/api/signals/regime-thresholds');
  }

  /**
   * Evaluate adaptive threshold for a specific candidate setup
   */
  async evaluateRegimeThreshold(params: {
    symbol: string;
    actualScore: number;
    regime?: string;
    strategy?: string;
    assetClass?: string;
  }): Promise<{
    success: boolean;
    evaluation: any;
    timestamp: number;
  }> {
    return this.fetchJson<any>('/api/signals/regime-thresholds/evaluate', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  /**
   * Fetch Gate 36 configurable frequency metrics
   */
  async getFrequencyConfig(): Promise<{ success: boolean; data: any }> {
    return this.fetchJson<any>('/api/signals/frequency-config');
  }

  /**
   * Update Gate 36 configurable frequency settings
   */
  async updateFrequencyConfig(params: {
    preset: '5' | '10' | '15' | 'CUSTOM';
    customCap?: number;
    maxClusterAllocationPct?: number;
  }): Promise<{ success: boolean; message: string; data: any }> {
    return this.fetchJson<any>('/api/signals/frequency-config', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  /**
   * Run Gate 3 cheap preliminary screening for a symbol
   */
  async getGate3Screen(symbol: string): Promise<any> {
    return this.fetchJson<any>(`/api/signals/gate3/screen/${encodeURIComponent(symbol)}`);
  }

  /**
   * Fetch Gate 4 provider quota and dynamic deep budget status
   */
  async getGate4Budget(): Promise<any> {
    return this.fetchJson<any>('/api/signals/gate4/budget');
  }

  /**
   * Fetch Gate 5 deep candidate selection preview
   */
  async getGate5Preview(): Promise<any> {
    return this.fetchJson<any>('/api/signals/gate5/preview');
  }

  /**
   * Fetch all signal sensitivity profiles and active configuration
   */
  async getSensitivityProfiles(): Promise<{
    success: boolean;
    activeProfile: SensitivityProfileName;
    currentConfig: SensitivityProfileConfig;
    profiles: Record<SensitivityProfileName, SensitivityProfileConfig>;
  }> {
    return this.fetchJson<any>('/api/sensitivity/profiles');
  }

  /**
   * Switch active sensitivity profile or customize thresholds
   */
  async updateSensitivityProfile(
    profile: SensitivityProfileName,
    customOverrides?: Partial<SensitivityProfileConfig>
  ): Promise<{
    success: boolean;
    message: string;
    activeProfile: SensitivityProfileName;
    currentConfig: SensitivityProfileConfig;
  }> {
    return this.fetchJson<any>('/api/sensitivity/profile', {
      method: 'POST',
      body: JSON.stringify({ profile, customOverrides }),
    });
  }

  /**
   * Reset sensitivity profile to recommended BALANCED default
   */
  async resetSensitivityProfile(): Promise<{
    success: boolean;
    message: string;
    activeProfile: SensitivityProfileName;
    currentConfig: SensitivityProfileConfig;
  }> {
    return this.fetchJson<any>('/api/sensitivity/reset', {
      method: 'POST',
    });
  }
}

export const api = new ApiClient();

