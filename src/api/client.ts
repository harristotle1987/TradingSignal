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
} from '../types/index.js';

class ApiClient {
  private adminToken: string | null = null;

  /**
   * Dynamically sets admin authentication token for administrative requests
   */
  public setAdminToken(token: string | null): void {
    this.adminToken = token;
    if (typeof localStorage !== 'undefined') {
      if (token) {
        localStorage.setItem('admin_token', token);
      } else {
        localStorage.removeItem('admin_token');
      }
    }
  }

  /**
   * Retrieves active admin authentication token
   */
  public getAdminToken(): string | null {
    if (this.adminToken) return this.adminToken;
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem('admin_token') || localStorage.getItem('ADMIN_API_KEY') || null;
    }
    return null;
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

      const activeAdminToken = this.getAdminToken();
      const authHeaders: Record<string, string> = {};
      if (activeAdminToken) {
        authHeaders['Authorization'] = `Bearer ${activeAdminToken}`;
        authHeaders['x-admin-key'] = activeAdminToken;
      }

      const response = await fetch(fullUrl, {
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
          ...authHeaders,
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
        throw new Error(`HTTP ${response.status} (${response.statusText}): ${JSON.stringify(data)}`);
      }

      return data as T;
    } catch (error) {
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
  async fetchMarketPrice(symbol: string, provider?: string): Promise<NormalizedTicker> {
    const query = new URLSearchParams({ symbol });
    if (provider) {
      query.append('provider', provider);
    }
    return this.fetchJson<NormalizedTicker>(`/api/market/price?${query.toString()}`);
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
   * Clear active signals
   */
  async clearSignals(): Promise<{ success: boolean; message: string }> {
    return this.fetchJson<{ success: boolean; message: string }>('/api/signals', {
      method: 'DELETE',
    });
  }

  /**
   * Fetch automated hourly scanner settings and stats
   */
  async getScannerSettings(): Promise<{ success: boolean; settings: any }> {
    return this.fetchJson<{ success: boolean; settings: any }>('/api/scanner/settings');
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
   * Manually trigger a complete background scan
   */
  async triggerScannerManualScan(): Promise<{
    success: boolean;
    status: string;
    message: string;
    timestamp: number;
    lastScanTime: number;
    candidatesEvaluated: number;
    acceptedSignalsCount: number;
    acceptedSignals: any[];
    signalsFound: number;
    qualifiedSetups: any[];
    rejectedCount: number;
    rejectionReasons: string[];
    capState: any;
  }> {
    return this.fetchJson<any>('/api/scanner/manual-trigger', {
      method: 'POST',
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
}

export const api = new ApiClient();

