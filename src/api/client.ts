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
}

export const api = new ApiClient();

