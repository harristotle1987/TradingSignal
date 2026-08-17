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
} from '../types/index.js';

class ApiClient {
  private async fetchJson<T>(endpoint: string, options?: RequestInit, retries = 3): Promise<T> {
    try {
      const baseUrl = (import.meta as any).env?.VITE_API_URL || (typeof window !== 'undefined' ? window.location.origin : '');
      const fullUrl = endpoint.startsWith('http') ? endpoint : `${baseUrl}${endpoint}`;
      const response = await fetch(fullUrl, {
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
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
    notifyOnNoTrade?: boolean
  ): Promise<{ success: boolean; settings: any }> {
    return this.fetchJson<{ success: boolean; settings: any }>('/api/scanner/settings', {
      method: 'POST',
      body: JSON.stringify({ enabled, notificationsEnabled, notifyOnNoTrade }),
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
}

export const api = new ApiClient();

